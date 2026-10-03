/* Capa de cifrado de los modelos (CollectionModel, TaskModel y sus notas) con Web Crypto real de Node
   y un Firestore en memoria que imita onSnapshot. Plan: docs/CIFRADO-PROYECTOS.md, 6.3 y 14.2.
   Uso: node tests/crypto/collection-model.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);

const Workhub = {
  services:{}, models:{}, utils:{}, t:(s) => s, i18n:{locale:'es-ES'},
  views:{team:{enabled:() => false, meUid:() => '', name:() => '', assigned:() => []}}
};
['src/core/emitter.js', 'src/utils/dates.js', 'src/utils/pool.js', 'src/services/crypto.js',
  'src/services/project-crypto.js', 'src/models/enc-schema.js', 'src/models/project-cipher.js',
  'src/models/collection-model.js', 'src/models/project-templates.js', 'src/models/task-model.js'
].forEach((rel) => new Function('Workhub', 'window', 'crypto', read(rel))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto));

const PC = Workhub.services.projectCrypto;
const {CollectionModel, TaskModel, ProjectCipher, EncSchema} = Workhub.models;

const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const code = (c) => (err) => { assert.equal(err && err.name, 'ProjectCipherError', 'error tipado: ' + (err && err.message)); assert.equal(err.code, c); return true; };

/* ---------- Firestore en memoria ---------- */
function fakeDb(){
  const cols = new Map();
  const log = {writes:[], wheres:0};
  let auto = 0;
  function store(p){
    if(!cols.has(p)) cols.set(p, {docs:new Map(), listeners:new Set()});
    return cols.get(p);
  }
  function snapOf(c, orderBy){
    let rows = [...c.docs.entries()];
    if(orderBy) rows.sort((a, b) => (a[1][orderBy] || 0) - (b[1][orderBy] || 0));
    return {docs:rows.map(([id, data]) => ({id, data:() => clone(data)}))};
  }
  function notify(c){
    c.listeners.forEach((l) => Promise.resolve().then(() => { if(c.listeners.has(l)) l.cb(snapOf(c, l.orderBy)); }));
  }
  function listen(c, orderBy, cb){
    const l = {cb, orderBy};
    c.listeners.add(l);
    Promise.resolve().then(() => { if(c.listeners.has(l)) cb(snapOf(c, orderBy)); });
    return () => c.listeners.delete(l);
  }
  function collection(p){
    const c = store(p);
    return {
      path:p,
      doc(id){
        const docId = id || 'auto' + (++auto);
        return {
          id:docId,
          set(data){ c.docs.set(docId, clone(data)); log.writes.push({op:'set', path:p, id:docId, data:clone(data)}); notify(c); return Promise.resolve(); },
          update(patch){
            if(!c.docs.has(docId)) return Promise.reject(new Error('not-found'));
            c.docs.set(docId, Object.assign({}, c.docs.get(docId), clone(patch)));
            log.writes.push({op:'update', path:p, id:docId, data:clone(patch)});
            notify(c);
            return Promise.resolve();
          },
          delete(){ c.docs.delete(docId); log.writes.push({op:'delete', path:p, id:docId}); notify(c); return Promise.resolve(); },
          collection(name){ return collection(p + '/' + docId + '/' + name); }
        };
      },
      add(data){ const ref = this.doc(); return ref.set(data).then(() => ref); },
      onSnapshot(cb){ return listen(c, null, cb); },
      get(){ return Promise.resolve(snapOf(c)); },
      where(field, op, value){
        log.wheres++;
        return {get:() => Promise.resolve({docs:snapOf(c).docs.filter((d) => d.data()[field] === value)})};
      },
      orderBy(field){
        return {onSnapshot:(cb) => listen(c, field, cb), get:() => Promise.resolve(snapOf(c, field))};
      }
    };
  }
  return {collection, log, raw:(p, id) => store(p).docs.get(id), rawAll:(p) => store(p).docs,
    put:(p, id, data) => { const c = store(p); c.docs.set(id, clone(data)); notify(c); }};
}

async function newCipher(){
  const key = await PC.importDek(PC.newDekBytes());
  const cipher = new ProjectCipher({pid:PC.newPid(), kid:PC.newKid(), key});
  /* Cuenta los descifrados y permite retenerlos para provocar solapamientos. */
  const realOpen = cipher.open.bind(cipher);
  cipher.opens = 0;
  cipher.gate = null;
  cipher.open = (p, id, raw) => {
    cipher.opens++;
    return (cipher.gate || Promise.resolve()).then(() => realOpen(p, id, raw));
  };
  return cipher;
}

/* Espera a que el modelo haya procesado todo lo pendiente. */
async function settle(model){
  for(let i = 0; i < 6; i++){
    await tick(2);
    if(model._queue) await model._queue;
  }
}
const stripId = (x) => { const c = Object.assign({}, x); delete c.id; return c; };

(async () => {
  /* ---------- sin cifrador: como siempre ---------- */
  {
    const db = fakeDb();
    const model = new CollectionModel('tasks');
    let changes = 0;
    model.on('change', () => changes++);
    model.connect(db);
    const ref = await model.add({title:'Llamar a Ana', status:'pendiente', order:1});
    await tick(2);
    assert.deepEqual(db.raw('tasks', ref.id), {title:'Llamar a Ana', status:'pendiente', order:1});
    assert.deepEqual(model.items, [{title:'Llamar a Ana', status:'pendiente', order:1, id:ref.id}]);
    await model.update(ref.id, {title:'Llamar a Ana hoy'});
    await tick(2);
    assert.equal(model.items[0].title, 'Llamar a Ana hoy');
    assert.equal(model.cipher, null);
    assert.equal(model.loaded, undefined, 'sin cifrador no se toca `loaded` (lo usa ProjectModel a su manera)');
    assert.deepEqual(await model.idsWhere('status', 'pendiente'), [ref.id]);
    assert.equal(db.log.wheres, 1, 'la consulta va al servidor');
    assert.ok(changes >= 2);
    ok('sin cifrador el modelo guarda y lee en claro, igual que antes');
  }

  /* ---------- con cifrador: nada secreto en la base ---------- */
  const cipher = await newCipher();
  const db = fakeDb();
  const tasks = new TaskModel();
  tasks.connect(db, cipher);
  await settle(tasks);
  assert.equal(tasks.loaded, true, 'loaded tras la primera instantánea, aunque esté vacía');

  const body = {title:'Preparar la propuesta de Año Nuevo', desc:'Con el presupuesto ñ €', cliente:'Finba', contacto:'Ana',
    status:'pendiente', dueDate:'2026-11-02', labels:['urgente'], checklist:[{id:'a', text:'Borrador', done:false}, {id:'b', text:'Revisar', done:false}],
    linkedContacts:['c1'], linkedVault:[]};
  const ref = await tasks.save(null, Object.assign({}, body));
  await settle(tasks);
  const id = ref.id;
  const stored = db.raw('tasks', id);
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'dueDate', 'e', 'ev', 'kid', 'linkedContacts', 'linkedVault', 'order', 'status', 'updatedAt']);
  Object.keys(stored).forEach((k) => assert.ok(EncSchema.sealedFields('tasks').indexOf(k) !== -1, 'campo permitido por las reglas: ' + k));
  assert.equal(stored.ev, 1);
  assert.equal(stored.kid, cipher.kid);
  const flat = JSON.stringify(stored);
  ['Preparar', 'presupuesto', 'Finba', 'Ana', 'urgente', 'Borrador'].forEach((w) => assert.ok(flat.indexOf(w) === -1, 'no aparece en claro: ' + w));
  const item = tasks.find(id);
  assert.equal(item.title, body.title);
  assert.equal(item.desc, body.desc);
  assert.deepEqual(item.checklist, body.checklist);
  assert.equal(item.status, 'pendiente');
  assert.equal(item._undecryptable, undefined);
  ok('una tarea nueva se guarda sellada y se lee descifrada');

  /* Otro navegador con la misma clave ve lo mismo. */
  {
    const other = new TaskModel();
    other.connect(db, new ProjectCipher({pid:cipher.pid, kid:cipher.kid, key:cipher.key}));
    await settle(other);
    assert.deepEqual(other.items, tasks.items);
    other.disconnect();
    assert.equal(other.loaded, false);
    assert.equal(other.cipher, null);
    ok('otra sesión con la misma clave lee el mismo contenido');
  }

  /* ---------- mover no vuelve a cifrar ni a descifrar ---------- */
  {
    const before = db.raw('tasks', id).e;
    const opens = cipher.opens;
    tasks.move(id, 'proceso');
    tasks.reschedule(id, '2026-11-05');
    await settle(tasks);
    const now = db.raw('tasks', id);
    assert.equal(now.e, before, 'el blob no se reescribe');
    assert.equal(now.status, 'proceso');
    assert.equal(now.dueDate, '2026-11-05');
    assert.equal(cipher.opens, opens, 'no se descifra de nuevo');
    assert.equal(tasks.find(id).title, body.title);
    assert.equal(tasks.find(id).status, 'proceso');
    ok('mover y reprogramar solo tocan campos en claro (caché por IV)');
  }

  /* ---------- dos cambios seguidos al mismo documento ---------- */
  {
    const p1 = tasks.toggleCheck(id, 'a', true);
    const p2 = tasks.toggleCheck(id, 'b', true);
    await Promise.all([p1, p2]);
    await settle(tasks);
    assert.deepEqual(tasks.find(id).checklist.map((c) => c.done), [true, true]);
    const fresh = new TaskModel();
    fresh.connect(db, cipher);
    await settle(fresh);
    assert.deepEqual(fresh.find(id).checklist.map((c) => c.done), [true, true], 'lo guardado tiene las dos marcas');
    fresh.disconnect();

    const a = tasks.update(id, {title:'Título nuevo'});
    const b = tasks.update(id, {desc:'Descripción nueva'});
    const c = tasks.update(id, {status:'pendiente'});
    await Promise.all([a, b, c]);
    await settle(tasks);
    const t = tasks.find(id);
    assert.equal(t.title, 'Título nuevo');
    assert.equal(t.desc, 'Descripción nueva');
    assert.equal(t.status, 'pendiente');
    assert.deepEqual(t.checklist.map((x) => x.done), [true, true]);
    ok('dos cambios seguidos a campos secretos no se pisan (caché de escritura y orden)');
  }

  /* ---------- IV nuevo en cada escritura ---------- */
  {
    const e1 = db.raw('tasks', id).e;
    await tasks.update(id, {title:'Título nuevo'});
    await settle(tasks);
    const e2 = db.raw('tasks', id).e;
    assert.notEqual(e1, e2);
    assert.notEqual(cipher.ivOf(e1), cipher.ivOf(e2));
    ok('reescribir el mismo contenido usa un IV nuevo');
  }

  /* ---------- cambio remoto ---------- */
  {
    const remote = await cipher.seal('tasks', id, Object.assign({}, stripId(tasks.find(id)), {title:'Cambiado en otro equipo'}));
    const opens = cipher.opens;
    db.put('tasks', id, remote);
    await settle(tasks);
    assert.equal(tasks.find(id).title, 'Cambiado en otro equipo');
    assert.equal(cipher.opens, opens + 1, 'solo se descifra el documento que cambió');
    db.put('tasks', id, Object.assign({}, remote, {order:5}));
    await settle(tasks);
    assert.equal(tasks.find(id).order, 5);
    assert.equal(cipher.opens, opens + 1, 'un cambio remoto de campos en claro no descifra');
    ok('un cambio remoto se descifra una sola vez');
  }

  /* ---------- instantáneas que se solapan: gana la última ---------- */
  {
    let release;
    cipher.gate = new Promise((r) => { release = r; });
    const base = stripId(tasks.find(id));
    db.put('tasks', id, await cipher.seal('tasks', id, Object.assign({}, base, {title:'Primera'})));
    await tick(2);
    db.put('tasks', id, await cipher.seal('tasks', id, Object.assign({}, base, {title:'Segunda'})));
    db.put('tasks', id, await cipher.seal('tasks', id, Object.assign({}, base, {title:'Tercera'})));
    await tick(2);
    const seen = [];
    const off = tasks.on('change', () => seen.push(tasks.find(id).title));
    cipher.gate = null;
    release();
    await settle(tasks);
    off();
    assert.equal(tasks.find(id).title, 'Tercera');
    assert.equal(seen[seen.length - 1], 'Tercera');
    assert.ok(seen.indexOf('Segunda') === -1, 'la instantánea intermedia se salta');
    ok('instantáneas solapadas durante el descifrado: gana la última');
  }

  /* ---------- una escritura local durante el descifrado no se pierde ---------- */
  {
    let release;
    cipher.gate = new Promise((r) => { release = r; });
    const base = stripId(tasks.find(id));
    db.put('tasks', id, await cipher.seal('tasks', id, Object.assign({}, base, {desc:'Remoto, anterior'})));
    await tick(2);                                    /* la instantánea remota está descifrándose */
    const w = tasks.update(id, {title:'Local, posterior'});
    cipher.gate = null;
    release();
    await w;
    await settle(tasks);
    assert.equal(tasks.find(id).title, 'Local, posterior');
    assert.equal(tasks._plain[id].plain.title, 'Local, posterior');
    ok('una escritura local hecha mientras se descifra una instantánea vieja no se pierde');
  }

  /* ---------- documento ilegible ---------- */
  {
    const foreign = await newCipher();
    const sealed = await foreign.seal('tasks', 'ajena', {title:'De otra clave', status:'pendiente', order:9});
    db.put('tasks', 'ajena', sealed);
    /* Blob copiado de otro documento: la AAD lleva el id. */
    db.put('tasks', 'copiada', Object.assign({}, db.raw('tasks', id)));
    await settle(tasks);
    const bad = tasks.find('ajena');
    assert.equal(bad._undecryptable, true);
    assert.equal(bad.title, undefined);
    assert.equal(bad.status, 'pendiente', 'los campos en claro sí se ven');
    assert.equal(tasks.find('copiada')._undecryptable, true);
    await assert.rejects(tasks.update('ajena', {title:'x'}), code('undecryptable'));
    await assert.rejects(tasks.set('ajena', {title:'x', status:'pendiente'}), code('undecryptable'));
    assert.deepEqual(db.raw('tasks', 'ajena'), sealed, 'no se ha sobrescrito');
    await tasks.update('ajena', {status:'proceso'});
    await settle(tasks);
    assert.equal(db.raw('tasks', 'ajena').e, sealed.e);
    assert.equal(tasks.find('ajena').status, 'proceso');
    /* Deshacer un borrado lo devuelve tal cual estaba. */
    const snap = tasks.snapshot(['ajena']);
    await tasks.remove('ajena');
    await settle(tasks);
    assert.equal(tasks.find('ajena'), undefined);
    await tasks.restore(snap);
    await settle(tasks);
    assert.equal(db.raw('tasks', 'ajena').e, sealed.e);
    await tasks.remove('ajena');
    await tasks.remove('copiada');
    await settle(tasks);
    ok('lo que no se puede descifrar se marca y nunca se sustituye');
  }

  /* ---------- documento en claro dentro de un proyecto cifrado ---------- */
  {
    db.put('tasks', 'vieja', {title:'Escrita por un cliente antiguo', desc:'en claro', status:'pendiente', order:3, createdAt:1});
    await settle(tasks);
    const t = tasks.find('vieja');
    assert.equal(t._plainInEncrypted, true);
    assert.equal(t.title, 'Escrita por un cliente antiguo');
    await tasks.update('vieja', {title:'Ya cifrada'});
    await settle(tasks);
    const now = db.raw('tasks', 'vieja');
    assert.equal(now.title, undefined);
    assert.equal(now.desc, undefined);
    assert.equal(now.ev, 1);
    assert.equal(now.status, 'pendiente');
    assert.equal(tasks.find('vieja').title, 'Ya cifrada');
    assert.equal(tasks.find('vieja').desc, 'en claro');
    assert.equal(tasks.find('vieja')._plainInEncrypted, undefined);
    await tasks.remove('vieja');
    ok('un documento en claro se muestra con aviso y se cifra al guardarlo');
  }

  /* ---------- límites y campos de GitHub ---------- */
  {
    await assert.rejects(tasks.update(id, {title:'x'.repeat(501)}), code('too-large'));
    await assert.rejects(tasks.update(id, {labels:new Array(61).fill('a')}), code('too-large'));
    await assert.rejects(tasks.add({title:'x', desc:'d'.repeat(20001), status:'pendiente'}), code('too-large'));
    await assert.rejects(tasks.update(id, {ghItemId:'PVTI_1'}), code('github-field'));
    await assert.rejects(tasks.saveSynced(id, {title:'x'}), code('encrypted'));
    await assert.rejects(tasks.markSynced(id, 1), code('encrypted'));
    await tasks.update(id, {title:'Sigue funcionando'});
    await settle(tasks);
    assert.equal(tasks.find(id).title, 'Sigue funcionando', 'un rechazo no estropea la caché');
    ok('límites antes de cifrar, sin campos gh* y sin sincronización con GitHub');
  }

  /* ---------- consultas por campos secretos: en memoria y de una en una ---------- */
  {
    for(let i = 0; i < 30; i++) await tasks.add({title:'Tarea ' + i, cliente:i % 2 ? 'UNIA' : 'Mondragón', status:'pendiente', order:100 + i});
    await settle(tasks);
    const wheres = db.log.wheres;
    const before = db.log.writes.length;
    assert.equal((await tasks.idsWhere('cliente', 'UNIA')).length, 15);
    await tasks.updateWhere('cliente', 'UNIA', {cliente:'UNIA Sevilla'});
    await settle(tasks);
    assert.equal(db.log.wheres, wheres, 'no se pregunta al servidor por un campo cifrado');
    assert.equal(tasks.items.filter((t) => t.cliente === 'UNIA Sevilla').length, 15);
    assert.equal(tasks.items.filter((t) => t.cliente === 'UNIA').length, 0);
    assert.equal(db.log.writes.length - before, 15, 'una escritura por documento');
    assert.ok(db.log.writes.slice(before).every((w) => w.op === 'update' && !('cliente' in w.data) && w.data.e));
    await tasks.removeWhere('cliente', 'Mondragón');
    await settle(tasks);
    assert.equal(tasks.items.filter((t) => t.cliente === 'Mondragón').length, 0);
    /* Un campo en claro sí se consulta en el servidor. */
    await tasks.idsWhere('status', 'pendiente');
    assert.equal(db.log.wheres, wheres + 1);

    const cold = new TaskModel();
    cold.connect(db, cipher);
    await assert.rejects(cold.idsWhere('cliente', 'UNIA Sevilla'), code('not-ready'));
    await assert.rejects(cold.update(id, {title:'x'}), code('stale'));
    cold.disconnect();
    ok('updateWhere/removeWhere por un campo secreto filtran en memoria y escriben de una en una');
  }

  /* ---------- deshacer un borrado vuelve a cifrar ---------- */
  {
    const before = db.raw('tasks', id).e;
    const snap = tasks.snapshot([id]);
    await tasks.remove(id);
    await settle(tasks);
    assert.equal(tasks.find(id), undefined);
    await tasks.restore(snap);
    await settle(tasks);
    const now = db.raw('tasks', id);
    assert.equal(now.title, undefined);
    assert.notEqual(now.e, before, 'IV nuevo');
    assert.equal(tasks.find(id).title, 'Sigue funcionando');
    const elsewhere = new TaskModel();
    elsewhere.connect(fakeDb(), cipher);
    await assert.rejects(elsewhere.restore(snap), /project-changed/);
    elsewhere.disconnect();
    ok('restore() vuelve a cifrar y no restaura en otro proyecto');
  }

  /* ---------- notas ---------- */
  {
    Workhub.views.team = {enabled:() => true, meUid:() => 'uid-ana', name:() => 'Ana', assigned:() => []};
    const seen = [];
    let errors = 0;
    const stop = tasks.watchNotes(id, (docs) => seen.push(docs), () => errors++);
    await tasks.addNote(id, 'Primera nota con ñ', 'asset1');
    await tick(5);
    await tasks.addActivity(id, 'movió la tarea');
    await tick(20);
    const last = seen[seen.length - 1];
    assert.equal(last.length, 2);
    assert.equal(typeof last[0].data, 'function');
    const n0 = last[0].data(), n1 = last[1].data();
    assert.ok(n0.createdAt <= n1.createdAt, 'en orden de createdAt');
    assert.equal(n0.text, 'Primera nota con ñ');
    assert.equal(n0.imageAssetId, 'asset1');
    assert.equal(n0.kind, 'comment');
    assert.equal(n0.actorName, 'Ana');
    assert.equal(n1.kind, 'activity');
    const rawNotes = [...db.rawAll('tasks/' + id + '/notes').values()];
    assert.equal(rawNotes.length, 2);
    rawNotes.forEach((raw) => {
      Object.keys(raw).forEach((k) => assert.ok(EncSchema.sealedFields('notes').indexOf(k) !== -1, 'campo de nota permitido: ' + k));
      assert.equal(raw.text, undefined);
      assert.equal(raw.actorName, undefined);
      assert.ok(JSON.stringify(raw).indexOf('Primera') === -1);
    });
    /* Una nota movida a otra tarea no se abre: la ruta va en la AAD. */
    db.put('tasks/' + id + '/notes', 'movida', Object.assign({}, rawNotes[0]));
    await tick(20);
    const moved = seen[seen.length - 1].find((d) => d.id === 'movida').data();
    assert.equal(moved._undecryptable, true);
    assert.equal(moved.text, '');
    stop();
    const count = seen.length;
    await tasks.addNote(id, 'Ya no escucha', '');
    await tick(20);
    assert.equal(seen.length, count, 'tras dejar de escuchar no llega nada');
    assert.equal(errors, 0);

    const full = await tasks.withNotes();
    const mine = full.find((t) => t.id === id);
    assert.equal(mine.notes.length, 4);
    assert.ok(mine.notes.some((n) => n.text === 'Ya no escucha'));
    assert.ok(mine.notes.every((n) => n.e === undefined), 'la copia no lleva el blob');
    assert.equal(mine.notes.filter((n) => n._undecryptable).length, 1);
    await tasks.removeNote(id, 'movida');
    Workhub.views.team = {enabled:() => false, meUid:() => '', name:() => '', assigned:() => []};
    ok('las notas se guardan selladas y llegan a las vistas como {id, data()} en claro');
  }

  /* ---------- cambio de proyecto a mitad de descifrado ---------- */
  {
    let release;
    const slow = await newCipher();
    const dbA = fakeDb(), dbB = fakeDb();
    dbA.put('tasks', 'a1', await slow.seal('tasks', 'a1', {title:'Del proyecto A', status:'pendiente'}));
    const model = new TaskModel();
    const titles = [];
    model.on('change', () => titles.push(model.items.map((t) => t.title).join(',')));
    slow.gate = new Promise((r) => { release = r; });
    model.connect(dbA, slow);
    await tick(5);
    model.connect(dbB);            /* proyecto sin cifrar */
    await tick(5);
    release();
    await tick(20);
    assert.ok(titles.every((t) => t.indexOf('Del proyecto A') === -1), 'no se emite nada de la conexión anterior');
    assert.deepEqual(model.items, []);
    assert.equal(model.cipher, null);
    ok('cambiar de proyecto a mitad de descifrado descarta la generación vieja');
  }

  /* ---------- ProjectCipher ---------- */
  {
    assert.throws(() => new ProjectCipher({pid:'corto', kid:cipher.kid, key:cipher.key}));
    const parts = cipher.split('tasks', {id:'x', title:'t', status:'s', e:'zzz', ev:1, kid:'k', _undecryptable:true, otro:1});
    assert.deepEqual(parts, {clear:{status:'s'}, secret:{title:'t', otro:1}});
    assert.deepEqual(cipher.merge({a:1}, {b:2}), {a:1, b:2});
    assert.equal(ProjectCipher.isSealed({ev:1}), true);
    assert.equal(ProjectCipher.isSealed({ev:'1'}), false);
    assert.equal(ProjectCipher.isSealed({title:'x'}), false);
    const doc = await cipher.seal('clients', 'c1', {nombre:'Finba', color:210, createdAt:5});
    assert.deepEqual(Object.keys(doc).sort(), ['color', 'createdAt', 'e', 'ev', 'kid']);
    assert.deepEqual((await cipher.open('clients', 'c1', doc)).plain, {nombre:'Finba'});
    await assert.rejects(cipher.open('contacts', 'c1', doc), code('undecryptable'));
    await assert.rejects(cipher.open('clients', 'c2', doc), code('undecryptable'));
    await assert.rejects(cipher.open('clients', 'c1', Object.assign({}, doc, {kid:PC.newKid()})), code('undecryptable'));
    await assert.rejects(cipher.open('clients', 'c1', Object.assign({}, doc, {ev:2})), code('undecryptable'));
    await assert.rejects(cipher.seal('clients', 'c1', {nombre:'x'.repeat(201)}), code('too-large'));
    const bytes = new Uint8Array([255, 216, 255, 0, 1, 2]);
    const img = await cipher.sealBytes('assets', 'img1', bytes);
    assert.deepEqual([...await cipher.openBytes('assets', 'img1', img)], [...bytes]);
    await assert.rejects(cipher.openBytes('assets', 'img2', img), code('undecryptable'));
    ok('ProjectCipher: split, seal, open, AAD por ruta e id, imágenes');
  }

  tasks.disconnect();
  console.log('\nTodo correcto.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
