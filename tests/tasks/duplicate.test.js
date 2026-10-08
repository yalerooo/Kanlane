/* Duplicar tareas y columnas: la copia lleva todo el contenido de la original y nada de su historia,
   queda justo debajo de ella y una columna entera se copia tal cual, sin disparar automatizaciones.
   Uso: node tests/tasks/duplicate.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}, utils:{}, services:{}, views:{team:{enabled:() => false}}, t:(text) => text};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'utils/pool', 'models/collection-model', 'models/project-templates', 'models/task-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TaskModel} = Workhub.models;
const ok = (name) => console.log('OK   ' + name);
const plain = (v) => JSON.parse(JSON.stringify(v));
/* Solo los campos definidos de t, en copia plana (sin undefined). */
const pick = (t, keys) => plain(keys.reduce((o, k) => (t[k] !== undefined && (o[k] = t[k]), o), {}));

/* Colección en memoria con la forma que usa el modelo: update mezcla, delete borra, add crea. */
function model(seed, opts){
  const o = opts || {};
  const docs = new Map(seed.map((d) => [d.id, Object.assign({}, d)]));
  let counter = 0;
  const m = new TaskModel();
  const load = () => { m.items = Array.from(docs.values()).map((d) => Object.assign({}, d)); };
  m.col = {
    add:(data) => {
      if(o.reject && o.reject(data)) return Promise.reject(new Error('permission-denied'));
      const id = 'n' + (++counter);
      docs.set(id, Object.assign(plain(data), {id:id}));
      load();
      return Promise.resolve({id:id});
    },
    doc:(id) => ({
      update:(patch) => {
        if(o.reject && o.reject(id, patch)) return Promise.reject(new Error('permission-denied'));
        Object.assign(docs.get(id), patch);
        load();
        return Promise.resolve();
      },
      set:(data) => { docs.set(id, Object.assign({id:id}, data)); load(); return Promise.resolve(); },
      delete:() => { docs.delete(id); load(); return Promise.resolve(); },
      collection:() => ({get:() => Promise.resolve({docs:[]})})
    })
  };
  load();
  return {m:m, docs:docs};
}
const ids = (list) => list.map((t) => t.id);
const STAGES = [{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'done', label:'Hecho', done:true}];
const SEED = [
  {id:'a', title:'Uno', desc:'Texto', status:'todo', order:1, labels:['web'], checklist:[{id:'c1', text:'Paso', done:true}], dueDate:'2030-01-02', updatedAt:5},
  {id:'b', title:'Dos', status:'doing', order:2, updatedAt:5},
  {id:'c', title:'Tres', status:'doing', order:3, updatedAt:5},
  {id:'d', title:'Cuatro', status:'done', order:4, updatedAt:5}
];
/* Campos que una copia debe llevar igual que la original. */
const CONTENT = ['title', 'desc', 'cliente', 'contacto', 'status', 'labels', 'checklist', 'assignees', 'dueDate', 'dueTime',
  'startDate', 'repeat', 'custom', 'linkedContacts', 'linkedVault'];
/* Campos que una copia nunca lleva. */
const NOT_COPIED_KEYS = ['followers', 'archivedAt', 'repeatSpawned', 'ghItemId', 'ghUrl', 'ghNumber', 'ghSyncedAt'];

(async () => {
  TaskModel.setStages(STAGES);

  /* ---------- Copia de una tarea ---------- */
  {
    const original = {id:'t1', title:'Original', desc:'Texto', cliente:'Acme', contacto:'Ana', status:'doing', order:7,
      labels:['web', 'urgente'],
      checklist:[{id:'c1', text:'Paso uno', done:true}, {id:'c2', text:'Paso dos', done:false}],
      assignees:['uid1', 'uid2'], dueDate:'2030-01-02', dueTime:'10:00', startDate:'2029-12-30', repeat:'weekly',
      custom:{f1:'x', f2:3}, linkedContacts:['k1'], linkedVault:['v1'],
      followers:['uid1'], archivedAt:5, repeatSpawned:true, ghItemId:'g1', ghUrl:'https://example.com/1', ghNumber:4,
      ghSyncedAt:5, createdAt:5, updatedAt:5, _plainInEncrypted:true};
    const copy = TaskModel.copyOf(original);
    CONTENT.forEach((k) => {
      assert.deepEqual(plain(copy[k]), plain(original[k]), 'la copia lleva ' + k);
    });
    assert.deepEqual(copy.checklist.map((c) => c.done), [true, false], 'las subtareas conservan su estado');
    NOT_COPIED_KEYS.forEach((k) => assert.equal(k in copy, false, 'no se copia ' + k));
    assert.equal(Object.keys(copy).some((k) => k.charAt(0) === '_'), false, 'no se copian los campos internos');
    assert.equal('id' in copy, false);
    assert.equal('order' in copy, false);
    assert.equal(copy.createdAt, copy.updatedAt);
    assert.ok(copy.createdAt > 5 && copy.updatedAt > 5, 'la copia empieza ahora');

    const over = TaskModel.copyOf(original, {title:'Otra', status:'done'});
    assert.equal(over.title, 'Otra', 'lo que se pasa como segundo argumento gana');
    assert.equal(over.status, 'done');
    ok('copia: una tarea copia todo su contenido y no su historia');
  }

  /* ---------- La copia es independiente ---------- */
  {
    const src = {id:'t2', title:'Fuente', labels:['a'], checklist:[{id:'c1', text:'Paso', done:false}],
      custom:{f1:'x'}, assignees:['uid1'], updatedAt:5};
    const before = plain(src);
    const copy = TaskModel.copyOf(src);
    copy.labels.push('nueva');
    copy.checklist[0].done = true;
    copy.custom.f1 = 'y';
    copy.assignees.push('uid2');
    assert.deepEqual(plain(src), before, 'cambiar la copia no toca la original');
    ok('copia: la copia no comparte nada con la original');
  }

  /* ---------- Duplicar pone la copia justo debajo ---------- */
  {
    const {m, docs} = model(SEED);
    const before = plain(docs.get('b'));
    const ref = await m.duplicate('b', {title:'Dos (copia)'});
    const copyDoc = docs.get(ref.id);
    assert.equal(copyDoc.title, 'Dos (copia)');
    assert.equal(copyDoc.status, 'doing', 'en su misma columna');
    assert.ok(copyDoc.order > 2 && copyDoc.order < 3, 'entre la original y la siguiente');
    assert.deepEqual(ids(m.inStatus('doing')), ['b', ref.id, 'c']);
    assert.deepEqual(plain(docs.get('b')), before, 'la original no cambia');

    const last = await m.duplicate('c');
    assert.equal(docs.get(last.id).order, 3 + 1024, 'si es la última, 1024 más');
    assert.deepEqual(ids(m.inStatus('doing')), ['b', ref.id, 'c', last.id]);
    ok('duplicar: la copia queda justo debajo de la original');
  }

  /* ---------- Duplicar cuenta como tarea creada por una persona ---------- */
  {
    const {m} = model(SEED);
    const events = [];
    m.on('auto', (e) => events.push(e));
    const ref = await m.duplicate('b');
    assert.equal(events.length, 1, 'un solo aviso');
    assert.equal(JSON.stringify(events[0]), JSON.stringify({type:'created', id:ref.id, to:'doing'}));
    ok('duplicar: cuenta como tarea creada por una persona');
  }

  /* ---------- Lo que no se puede duplicar ---------- */
  {
    const {m, docs} = model(SEED.concat([
      {id:'u', title:'Cifrada', status:'todo', order:9, _undecryptable:true},
      {id:'z', title:'Archivada', status:'todo', order:10, archivedAt:5}
    ]));
    const count = docs.size;
    await assert.rejects(() => m.duplicate('nope'), 'una tarea que no existe');
    await assert.rejects(() => m.duplicate('u'), 'una tarea que no se pudo descifrar');
    await assert.rejects(() => m.duplicate('z'), 'una tarea archivada');
    await m.archive(['a']);
    await assert.rejects(() => m.duplicate('a'), 'una tarea archivada a mano');
    assert.equal(docs.size, count, 'no se crea ningún documento');
    ok('duplicar: no se pueden copiar tareas inexistentes, cifradas ni archivadas');
  }

  /* ---------- Una tarea cuya columna ya no existe ---------- */
  {
    const {m, docs} = model(SEED.concat([{id:'x', title:'Huérfana', status:'borrada', order:1}]));
    const ref = await m.duplicate('x');
    assert.equal(docs.get(ref.id).status, 'todo', 'la copia cae en la primera columna');
    ok('duplicar: una tarea de una columna borrada se copia a la primera');
  }

  /* ---------- Duplicar una columna entera ---------- */
  {
    /* «nueva» tiene que ser una etapa para que inStatus la vea. */
    TaskModel.setStages(STAGES.concat([{key:'nueva', label:'Nueva'}]));
    const {m, docs} = model(SEED);
    const originals = m.inStatus('doing').map((t) => plain(docs.get(t.id)));
    const events = [];
    m.on('auto', (e) => events.push(e));
    const out = await m.duplicateInto(m.inStatus('doing'), 'nueva');
    assert.equal(out.failed, 0);
    assert.equal(out.ids.length, 2);
    assert.equal(events.length, 0, 'es una copia en bloque: no dispara automatizaciones');
    const copies = out.ids.map((id) => docs.get(id));
    const copyOf = (title) => copies.find((c) => c.title === title);
    copies.forEach((copy) => {
      const orig = originals.find((o) => o.title === copy.title);
      assert.ok(orig, 'cada copia tiene su original');
      assert.equal(copy.status, 'nueva');
      assert.deepEqual(pick(copy, ['title', 'desc', 'labels', 'checklist']), pick(orig, ['title', 'desc', 'labels', 'checklist']));
    });
    assert.equal(copyOf('Dos').order, 1024, 'el orden sale de la posición en la lista: primera 1024');
    assert.equal(copyOf('Tres').order, 2048, 'segunda 2048');
    assert.deepEqual(ids(m.inStatus('nueva')), originals.map((o) => copyOf(o.title).id), 'en el mismo orden que las originales');
    originals.forEach((o) => {
      assert.deepEqual(plain(docs.get(o.id)), o, 'las originales no cambian');
    });
    assert.deepEqual(ids(m.inStatus('doing')), ['b', 'c']);

    /* Dos originales con el mismo orden salen en el orden de la lista. */
    const twins = model([{id:'p', title:'Primera', status:'doing', order:5}, {id:'q', title:'Segunda', status:'doing', order:5}]);
    const out2 = await twins.m.duplicateInto([twins.m.find('q'), twins.m.find('p')], 'nueva');
    assert.equal(out2.failed, 0);
    const twinCopies = out2.ids.map((id) => twins.docs.get(id));
    const twinOf = (title) => twinCopies.find((c) => c.title === title);
    assert.equal(twinOf('Segunda').order, 1024);
    assert.equal(twinOf('Primera').order, 2048);
    assert.deepEqual(ids(twins.m.inStatus('nueva')), [twinOf('Segunda').id, twinOf('Primera').id], 'la lista manda, no el orden original');
    TaskModel.setStages(STAGES);
    ok('columna: duplicar una columna copia las tareas en el orden de la lista, sin avisos');
  }

  /* ---------- Un fallo no detiene el resto ---------- */
  {
    const {m, docs} = model(SEED, {reject:(data) => data.title === 'Dos'});
    const list = [m.find('b'), m.find('c'), {id:'u', title:'Cifrada', status:'doing', order:9, _undecryptable:true}];
    const out = await m.duplicateInto(list, 'nueva');
    assert.equal(out.failed, 1, 'la que falla se cuenta');
    assert.equal(out.ids.length, 1, 'las demás se crean');
    assert.equal(docs.get(out.ids[0]).title, 'Tres');
    assert.equal(Array.from(docs.values()).some((d) => d.title === 'Cifrada'), false, 'la que no se descifra se salta');
    ok('columna: un fallo no detiene la copia y lo que no se descifra se salta');
  }

  console.log('Todo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
