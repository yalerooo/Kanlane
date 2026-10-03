/* Cifrado por proyecto, PR6 del plan (docs/CIFRADO-PROYECTOS.md, 6.4, 11.3 y 14.2): renombrar y
   eliminar un cliente en un proyecto con cifrado total, exportar e importar una copia cifrada y las
   versiones locales de las copias. Web Crypto real de Node y el Firestore en memoria de las pruebas.
   Uso: node tests/crypto/backup-clients.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fakeDb} = require('./fake-firestore.js');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/* IndexedDB mínimo para backup-history.js: un almacén con keyPath 'id' y transacciones que terminan
   en la siguiente vuelta. */
function fakeIndexedDB(){
  const rows = new Map();
  const copy = (v) => (v === undefined ? undefined : structuredClone(v));
  const request = (run) => {
    const req = {};
    Promise.resolve().then(() => { req.result = run(); if(req.onsuccess) req.onsuccess(); });
    return req;
  };
  const store = {
    getAll: () => request(() => [...rows.values()].map(copy)),
    get: (id) => request(() => copy(rows.get(id))),
    put: (entry) => request(() => { rows.set(entry.id, copy(entry)); }),
    delete: (id) => request(() => { rows.delete(id); })
  };
  const db = {
    createObjectStore: () => store,
    transaction: () => {
      const tx = {objectStore: () => store};
      setTimeout(() => { if(tx.oncomplete) tx.oncomplete(); }, 0);
      return tx;
    }
  };
  return {
    rows,
    open: () => {
      const req = {result:db};
      Promise.resolve().then(() => { if(req.onupgradeneeded) req.onupgradeneeded(); if(req.onsuccess) req.onsuccess(); });
      return req;
    }
  };
}
const idb = fakeIndexedDB();

const Workhub = {
  services:{platform:{mode:() => 'firebase'}}, models:{}, t:(s) => s, i18n:{locale:'es-ES'},
  utils:{html:{hueFor:() => 0}, urls:{safeUrl:(url) => url || ''}},
  views:{team:{enabled:() => false, meUid:() => '', name:() => '', assigned:() => []}}
};
['src/core/emitter.js', 'src/utils/dates.js', 'src/utils/pool.js', 'src/services/crypto.js',
  'src/services/project-crypto.js', 'src/models/enc-schema.js', 'src/models/project-cipher.js',
  'src/models/collection-model.js', 'src/models/project-templates.js', 'src/models/task-model.js',
  'src/models/client-model.js', 'src/models/vault-model.js', 'src/models/backup-model.js', 'src/services/backup-history.js'
].forEach((rel) => new Function('Workhub', 'window', 'crypto', 'indexedDB', read(rel))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto, idb));

const PC = Workhub.services.projectCrypto;
const history = Workhub.services.backupHistory;
const {CollectionModel, TaskModel, ClientModel, VaultModel, BackupModel, ProjectCipher} = Workhub.models;
const partial = (n) => (err) => { assert.equal(err && err.name, 'ProjectCipherError', String(err && err.message)); assert.equal(err.code, 'partial'); assert.equal(err.pending, n); return true; };

const PASSWORD = 'una contraseña de cifrado larga';

/* Proyecto con cifrado total: clave, envoltorios como los de crypto/{uid} y el campo enc. */
async function newProject(uid){
  const raw = PC.newDekBytes(), pid = PC.newPid(), kid = PC.newKid();
  const ctx = {pid:pid, kid:kid, uid:uid};
  const key = await PC.importDek(raw);
  const recovery = PC.newRecoveryKey();
  const pw = await PC.wrapPassword(raw, PASSWORD, ctx);
  const rk = await PC.wrapRecovery(raw, recovery.bytes, ctx);
  const enc = {v:1, mode:'pw', pid:pid, kid:kid, kcv:await PC.kcv(key, pid, kid)};
  raw.fill(0);
  return {cipher:new ProjectCipher({pid:pid, kid:kid, key:key}), enc:enc, wrap:{kdf:pw.kdf, pw:pw.pw, rk:rk.rk}, recovery:recovery.text, uid:uid};
}

function models(db, cipher){
  const m = {tasks:new TaskModel(), clients:new ClientModel(), contacts:new CollectionModel('contacts'),
    meetings:new CollectionModel('meetings'), vault:new VaultModel()};
  Object.keys(m).forEach((k) => m[k].connect(db, cipher || undefined));
  return m;
}
async function settle(m){
  for(let i = 0; i < 6; i++){
    await tick(2);
    await Promise.all(Object.keys(m).map((k) => m[k]._queue));
  }
}
/* Las palabras que se buscan tienen que ser largas o llevar un espacio: una de tres letras («Ana»)
   aparece por azar en el base64 de cientos de documentos cifrados y la prueba fallaba a veces. */
const noPlain = (db, col, words) => {
  const text = JSON.stringify([...db.rawAll(col).values()]);
  words.forEach((w) => assert.ok(text.indexOf(w) === -1, col + ': «' + w + '» no está en claro'));
};

(async () => {
  /* ---------- renombrar un cliente con 300 tareas ---------- */
  {
    const p = await newProject('u1');
    const db = fakeDb();
    const m = models(db, p.cipher);
    await settle(m);
    const client = await m.clients.create('Agencia Norte');
    await m.clients.create('Otro Cliente');
    await Promise.all(Array.from({length:300}, (_, i) => m.tasks.add({title:'Tarea ' + i, cliente:'Agencia Norte', status:'pendiente', order:i, createdAt:i})));
    await Promise.all(Array.from({length:5}, (_, i) => m.tasks.add({title:'Ajena ' + i, cliente:'Otro Cliente', status:'pendiente', order:i, createdAt:i})));
    await m.contacts.add({nombre:'Ana Contacto', cliente:'Agencia Norte', createdAt:1});
    await m.meetings.add({title:'Reunión', cliente:'Agencia Norte', date:'2026-10-05', createdAt:1});
    await settle(m);
    assert.equal(m.tasks.items.length, 305);

    const wheres = db.log.wheres;
    const seen = [];
    await m.clients.rename(client.id, 'Agencia Sur', [m.tasks, m.meetings, m.contacts, m.vault], (done, total) => seen.push(done + '/' + total));
    await settle(m);
    assert.equal(m.tasks.items.filter((t) => t.cliente === 'Agencia Sur').length, 300, 'las 300 tareas llevan el nombre nuevo');
    assert.equal(m.tasks.items.filter((t) => t.cliente === 'Otro Cliente').length, 5, 'las de otro cliente no cambian');
    assert.equal(m.contacts.items[0].cliente, 'Agencia Sur');
    assert.equal(m.meetings.items[0].cliente, 'Agencia Sur');
    assert.equal(m.clients.find(client.id).nombre, 'Agencia Sur');
    assert.equal(db.log.wheres, wheres, 'no se consulta al servidor por un campo secreto');
    assert.equal(seen.length, 302, 'un aviso de avance por documento');
    assert.equal(seen[seen.length - 1], '302/302');
    assert.equal(seen[0], '1/302');
    ['tasks', 'clients', 'contacts', 'meetings'].forEach((col) => noPlain(db, col, ['Agencia', 'Tarea ', 'Ana Contacto', 'Reunión']));
    ok('clientes: renombrar con 300 tareas en un proyecto cifrado las actualiza todas, con avance y sin texto en claro');

    /* Fallo a medias: el cliente conserva su nombre y repetir el cambio termina. */
    const realUpdate = m.tasks.update.bind(m.tasks);
    let calls = 0;
    m.tasks.update = (id, patch) => (++calls % 3 === 0 ? Promise.reject(new Error('unavailable')) : realUpdate(id, patch));
    await assert.rejects(m.clients.rename(client.id, 'Agencia Este', [m.tasks, m.meetings, m.contacts, m.vault]), partial(100));
    await settle(m);
    assert.equal(m.clients.find(client.id).nombre, 'Agencia Sur', 'con fallos el cliente no se renombra');
    assert.equal(m.tasks.items.filter((t) => t.cliente === 'Agencia Este').length, 200);
    assert.equal(m.tasks.items.filter((t) => t.cliente === 'Agencia Sur').length, 100);
    m.tasks.update = realUpdate;
    await m.clients.rename(client.id, 'Agencia Este', [m.tasks, m.meetings, m.contacts, m.vault]);
    await settle(m);
    assert.equal(m.tasks.items.filter((t) => t.cliente === 'Agencia Este').length, 300);
    assert.equal(m.clients.find(client.id).nombre, 'Agencia Este');
    ok('clientes: un renombrado a medias dice cuántos quedan y se completa al repetirlo');

    /* Eliminar: si no se borran todas las tareas, el cliente se queda. */
    const realRemove = m.tasks.remove.bind(m.tasks);
    calls = 0;
    m.tasks.remove = (id) => (++calls % 2 === 0 ? Promise.reject(new Error('unavailable')) : realRemove(id));
    await assert.rejects(m.clients.removeWithTasks(client.id, m.tasks), partial(150));
    await settle(m);
    assert.ok(m.clients.find(client.id), 'el cliente sigue ahí');
    assert.equal(m.tasks.items.filter((t) => t.cliente === 'Agencia Este').length, 150);
    m.tasks.remove = realRemove;
    const progress = [];
    await m.clients.removeWithTasks(client.id, m.tasks, (done, total) => progress.push(done + '/' + total));
    await settle(m);
    assert.equal(m.clients.find(client.id), undefined);
    assert.equal(m.tasks.items.length, 5);
    assert.equal(progress[progress.length - 1], '150/150');
    ok('clientes: eliminar a medias conserva el cliente y avisa de lo pendiente');
    Object.keys(m).forEach((k) => m[k].disconnect());
  }

  /* ---------- sin cifrado: renombrar sigue igual ---------- */
  {
    const db = fakeDb();
    const m = models(db, null);
    await tick(5);
    const client = await m.clients.create('Agencia Norte');
    await m.tasks.add({title:'Tarea', cliente:'Agencia Norte', status:'pendiente', order:1, createdAt:1});
    await tick(5);
    const wheres = db.log.wheres;
    await m.clients.rename(client.id, 'Agencia Sur', [m.tasks, m.meetings, m.contacts, m.vault]);
    await tick(5);
    assert.equal(m.tasks.items[0].cliente, 'Agencia Sur');
    assert.equal(m.clients.items[0].nombre, 'Agencia Sur');
    assert.equal(db.log.wheres, wheres + 4, 'en un proyecto sin cifrar se sigue consultando al servidor');
    ok('clientes: en un proyecto sin cifrar renombrar funciona como siempre');
    Object.keys(m).forEach((k) => m[k].disconnect());
  }

  /* ---------- exportar cifrado e importar ---------- */
  {
    const p = await newProject('u1');
    const db = fakeDb();
    const m = models(db, p.cipher);
    await settle(m);
    await m.clients.create('Cliente Reservado');
    const ref = await m.tasks.add({title:'Tarea secreta', desc:'Descripción reservada', cliente:'Cliente Reservado', status:'proceso', order:3,
      createdAt:10, labels:['urgente'], dueDate:'2026-11-01'});
    await m.tasks.addNote(ref.id, 'Nota confidencial', '');
    await m.contacts.add({nombre:'Ana Reservada', cliente:'Cliente Reservado', email:'ana@example.test', createdAt:5});
    await m.meetings.add({title:'Reunión privada', cliente:'Cliente Reservado', date:'2026-10-05', notas:'Orden del día', createdAt:6});
    await settle(m);

    const backup = new BackupModel(m);
    const copy = await backup.build('Proyecto Ñandú');
    const file = await BackupModel.seal(copy, {cipher:p.cipher, enc:p.enc, wrap:p.wrap, uid:p.uid, projectName:'Proyecto Ñandú'});
    assert.match(file.filename, /^kanlane-copia-cifrada-proyecto-nandu-\d{4}-\d{2}-\d{2}\.json$/);
    assert.deepEqual(file.counts, copy.counts);
    ['Tarea secreta', 'Descripción reservada', 'Cliente Reservado', 'Nota confidencial', 'Ana Reservada', 'Reunión privada', 'urgente'].forEach((w) =>
      assert.ok(file.json.indexOf(w) === -1, 'el archivo cifrado no lleva «' + w + '»'));
    const parsed = JSON.parse(file.json);
    assert.equal(parsed.format, 'kanlane-encrypted-backup');
    assert.equal(parsed.v, 1);
    assert.deepEqual([parsed.pid, parsed.kid, parsed.kcv, parsed.uid], [p.enc.pid, p.enc.kid, p.enc.kcv, 'u1']);
    assert.ok(parsed.kdf && parsed.pw && parsed.rk && typeof parsed.data === 'string');
    assert.equal(BackupModel.isEncryptedFile(parsed), true);
    assert.equal(BackupModel.isEncryptedFile(JSON.parse(copy.json)), false);
    assert.equal(BackupModel.sameKey(parsed, p.cipher), true);

    const plain = JSON.parse(copy.json);
    assert.deepEqual(await BackupModel.open(parsed, {cipher:p.cipher}), plain, 'con la clave del mismo proyecto');
    assert.deepEqual(await BackupModel.open(parsed, {secret:PASSWORD}), plain, 'con la contraseña de cifrado');
    assert.deepEqual(await BackupModel.open(parsed, {secret:p.recovery.toLowerCase()}), plain, 'con la clave de recuperación');
    ok('copias: el archivo cifrado no lleva nada en claro y se abre con la clave, la contraseña o la clave de recuperación');

    const bad = (c) => (err) => { assert.equal(err.name, 'BackupError'); assert.equal(err.code, c); return true; };
    await assert.rejects(BackupModel.open(parsed, {secret:'otra contraseña distinta'}), bad('bad-secret'));
    await assert.rejects(BackupModel.open(parsed, {secret:''}), bad('bad-secret'));
    await assert.rejects(BackupModel.open(parsed, {secret:PC.newRecoveryKey().text}), bad('bad-secret'));
    const other = await newProject('u1');
    assert.equal(BackupModel.sameKey(parsed, other.cipher), false);
    await assert.rejects(BackupModel.open(parsed, {cipher:other.cipher}), bad('bad-secret'), 'otra clave no abre: pide el secreto');
    const flip = (s) => s.slice(0, 40) + (s[40] === 'A' ? 'B' : 'A') + s.slice(41);
    await assert.rejects(BackupModel.open(Object.assign({}, parsed, {data:flip(parsed.data)}), {secret:PASSWORD}), bad('bad-format'));
    await assert.rejects(BackupModel.open(Object.assign({}, parsed, {exportedAt:'2020-01-01T00:00:00.000Z'}), {secret:PASSWORD}), bad('bad-format'), 'la fecha va en la AAD');
    await assert.rejects(BackupModel.open(Object.assign({}, parsed, {v:2}), {secret:PASSWORD}), bad('bad-format'));
    await assert.rejects(BackupModel.open(Object.assign({}, parsed, {uid:'u2'}), {secret:PASSWORD}), bad('bad-secret'), 'los envoltorios son de la cuenta que exportó');
    await assert.rejects(BackupModel.open(Object.assign({}, parsed, {kdf:Object.assign({}, parsed.kdf, {iter:1000})}), {secret:PASSWORD}), bad('bad-format'));
    await assert.rejects(BackupModel.open({format:'kanlane-encrypted-backup'}, {secret:PASSWORD}), bad('bad-format'));
    await assert.rejects(BackupModel.open(Object.assign({}, parsed, {kcv:other.enc.kcv}), {secret:PASSWORD}), bad('bad-secret'), 'la clave abierta tiene que ser la del archivo (kcv)');
    ok('copias: contraseña errónea, otra clave, archivo manipulado o de otra versión no se abren');

    /* Importar en otro proyecto cifrado: se vuelve a cifrar con la clave del destino. */
    const dest = await newProject('u1');
    const db2 = fakeDb();
    const m2 = models(db2, dest.cipher);
    await settle(m2);
    const result = await new BackupModel(m2).import(await BackupModel.open(parsed, {secret:PASSWORD}));
    await settle(m2);
    assert.deepEqual(result.counts, {clients:1, tasks:1, notes:1, meetings:1, contacts:1, vault:0});
    const t2 = m2.tasks.items[0];
    assert.deepEqual([t2.title, t2.desc, t2.cliente, t2.status, t2.dueDate, t2.labels], ['Tarea secreta', 'Descripción reservada', 'Cliente Reservado', 'proceso', '2026-11-01', ['urgente']]);
    const notes = db2.rawAll('tasks/' + t2.id + '/notes');
    assert.equal(notes.size, 1);
    const note = [...notes.values()][0];
    assert.ok(note.e && note.ev === 1 && note.kid === dest.enc.kid, 'la nota importada va sellada con la clave del destino');
    assert.equal(note.text, undefined);
    ['tasks', 'clients', 'contacts', 'meetings', 'tasks/' + t2.id + '/notes'].forEach((col) =>
      noPlain(db2, col, ['Tarea secreta', 'Descripción reservada', 'Cliente Reservado', 'Nota confidencial', 'Ana Reservada', 'Reunión privada']));
    const again = JSON.parse((await new BackupModel(m2).build('Destino')).json);
    const shape = (d) => ({
      clients:d.clients.map((c) => c.nombre),
      tasks:d.tasks.map((t) => [t.title, t.desc, t.cliente, t.status, t.dueDate, t.labels, t.notes.map((n) => [n.text, n.kind])]),
      contacts:d.contacts.map((c) => [c.nombre, c.cliente, c.email]),
      meetings:d.meetings.map((x) => [x.title, x.cliente, x.date, x.notas])
    });
    assert.deepEqual(shape(again), shape(plain), 'exportar cifrado → importar → mismo contenido');
    ok('copias: importar una copia cifrada en otro proyecto cifrado conserva el contenido y lo sella con su clave');

    /* Importar en un proyecto sin cifrar: las notas se guardan como siempre. */
    const db3 = fakeDb();
    const m3 = models(db3, null);
    await tick(5);
    await new BackupModel(m3).import(plain);
    await tick(5);
    const t3 = m3.tasks.items[0];
    assert.equal([...db3.rawAll('tasks/' + t3.id + '/notes').values()][0].text, 'Nota confidencial');
    ok('copias: importar en un proyecto sin cifrar guarda las notas como antes');
    [m, m2, m3].forEach((x) => Object.keys(x).forEach((k) => x[k].disconnect()));
  }

  /* ---------- versiones locales ---------- */
  {
    const p = await newProject('u1');
    const copy = {filename:'copia.json', json:JSON.stringify({tasks:[{title:'Tarea secreta'}]}), counts:{tasks:1}};
    const scope = 'firebase:u1:p1';

    const plainEntry = await history.save(scope, copy);
    assert.equal(idb.rows.get(plainEntry.id).json, copy.json, 'sin cifrador se guarda como siempre');
    assert.equal((await history.get(plainEntry.id)).json, copy.json);

    const sealedEntry = await history.save(scope, copy, p.cipher);
    const stored = idb.rows.get(sealedEntry.id);
    assert.equal(stored.json, undefined);
    assert.ok(typeof stored.e === 'string' && stored.kid === p.enc.kid);
    assert.ok(JSON.stringify(stored).indexOf('Tarea secreta') === -1, 'la versión sellada no lleva el contenido en claro');
    assert.deepEqual(stored.counts, {tasks:1});
    assert.equal((await history.get(sealedEntry.id, p.cipher)).json, copy.json);
    await assert.rejects(history.get(sealedEntry.id), /locked/);
    const other = await newProject('u1');
    await assert.rejects(history.get(sealedEntry.id, other.cipher), (err) => err.code === 'undecryptable');
    /* El id va en la AAD: una versión copiada sobre otra no se abre. */
    idb.rows.set('otra', Object.assign({}, stored, {id:'otra'}));
    await assert.rejects(history.get('otra', p.cipher), (err) => err.code === 'undecryptable');
    idb.rows.delete('otra');
    ok('versiones locales: en un proyecto cifrado se guardan selladas y solo se abren con su clave');

    /* Las que quedaron en claro de una versión anterior de la app se sellan. */
    await history.sealPlain(scope, p.cipher);
    const migrated = idb.rows.get(plainEntry.id);
    assert.equal(migrated.json, undefined);
    assert.equal((await history.get(plainEntry.id, p.cipher)).json, copy.json);
    assert.equal(idb.rows.get(sealedEntry.id).e, stored.e, 'las ya selladas no se tocan');
    assert.equal((await history.list(scope)).length, 2);

    /* Máximo siete por proyecto, también selladas. */
    for(let i = 0; i < 8; i++){ await history.save(scope, copy, p.cipher); await tick(2); }
    assert.equal((await history.list(scope)).length, 7);
    ok('versiones locales: las antiguas en claro se sellan y se conservan siete');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
