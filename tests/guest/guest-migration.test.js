/* «Crear cuenta y llevarme mis datos»: la copia del modo invitado a una cuenta, con dos bases de
   datos en memoria (la del navegador y la de la cuenta). Las reglas no se aplican aquí.
   Uso: node tests/guest/guest-migration.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fakeDb} = require('../crypto/fake-firestore.js');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);

const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const Workhub = {services:{}, models:{}, utils:{}, t:(s) => s};
['src/core/emitter.js', 'src/utils/pool.js', 'src/models/collection-model.js', 'src/models/project-model.js',
  'src/models/guest-migration.js'
].forEach((rel) => new Function('Workhub', 'localStorage', read(rel))(Workhub, localStorage));
const migration = Workhub.models.guestMigration;

function fail(code){
  const err = new Error(code);
  err.code = code;
  return err;
}

/* La misma base, pero set() falla cuando lo diga `when(colección, id, datos)` (devuelve el error). */
function guard(db, when){
  const wrapDoc = (ref, p) => Object.assign({}, ref, {
    set: (data) => { const err = when(p, ref.id, data); return err ? Promise.reject(err) : ref.set(data); },
    collection: (name) => wrapCol(ref.collection(name))
  });
  const wrapCol = (col) => Object.assign({}, col, {doc: (id) => wrapDoc(col.doc(id), col.path)});
  return {
    collection: (p) => wrapCol(db.collection(p)),
    doc: (p) => wrapDoc(db.doc(p), p.slice(0, p.lastIndexOf('/')))
  };
}

/* Un invitado con el proyecto principal (en la raíz) y otro proyecto. */
function guest(){
  const db = fakeDb();
  db.put('projects', 'main', {nombre:'Mi trabajo', tipo:'desarrollo', createdAt:0, labels:[{name:'urgente', color:2}]});
  db.put('projects', 'p2', {nombre:'Segundo', createdAt:50});
  db.put('tasks', 't1', {title:'Con nota', status:'todo', linkedContacts:['c1'], linkedVault:['v1'], createdAt:1});
  db.put('tasks/t1/notes', 'n1', {text:'con foto', imageAssetId:'img-local', createdAt:2, kind:'note'});
  db.put('tasks/t1/notes', 'n2', {text:'sin foto', imageAssetId:'', createdAt:3, kind:'note'});
  db.put('tasks', 't2', {title:'Otra', status:'doing', createdAt:4});
  db.put('clients', 'cl1', {nombre:'Acme', createdAt:1});
  db.put('contacts', 'c1', {cliente:'Acme', nombre:'Ana', createdAt:1});
  db.put('meetings', 'm1', {title:'Kickoff', date:'2026-10-07', createdAt:1});
  db.put('vault', 'v1', {cliente:'Acme', iv:'iv', cipher:'ct', createdAt:1});
  db.put('vault_meta', 'check', {saltPassword:'salt'});
  db.put('plugin_data', 'workhub.informe', {values:{a:'1'}, updatedAt:1});
  db.put('plugins', 'workhub.temporizador', {url:'/plugins/temporizador/', manifest:{id:'workhub.temporizador'}, granted:['tasks'], installedAt:5, userValues:{k:'"v"'}});
  db.put('settings', 'plugin-user:workhub.smartgp', {userValues:{x:'1'}, updatedAt:1});
  db.put('settings', 'preferences', {accent:'rosa'});
  db.put('projects/p2/tasks', 't9', {title:'Del segundo', status:'todo', createdAt:9});
  db.put('projects/p2/plugin_data', 'install:workhub.informe', {_kind:'plugin-install', pluginId:'workhub.informe', url:'/plugins/informe/'});
  return db;
}

function assets(){
  const uploads = [];
  return {
    uploads,
    read: (id) => Promise.resolve(id === 'img-local' ? {blob:id} : null),
    upload: (blob) => { uploads.push(blob); return Promise.resolve({id:'img-cuenta-' + uploads.length}); }
  };
}

(async () => {
  /* ---------- Lo pendiente, en el navegador ---------- */
  assert.equal(migration.pending(), null);
  assert.equal(migration.request('Lola', 'p2'), true);
  assert.deepEqual(migration.pending(), {name:'Lola', open:'p2'});
  migration.clear();
  assert.equal(migration.pending(), null);
  ok('lo pendiente se apunta y se borra en este navegador');

  /* ---------- Cuenta nueva ---------- */
  {
    const from = guest(), to = fakeDb(), imgs = assets();
    const state = {name:'Lola', open:'p2'};
    const res = await migration.run({from, to, assets:imgs, state, save:() => {}});
    const mainId = state.ids.main, p2Id = state.ids.p2;
    assert.ok(mainId && p2Id && mainId !== 'main' && mainId !== p2Id, 'cada proyecto del invitado es uno nuevo en la cuenta');
    assert.deepEqual(res.counts, {projects:2, tasks:3});
    assert.equal(res.skipped, 0);
    assert.equal(res.open.id, p2Id, 'se abre el que el invitado tenía abierto');
    assert.equal(res.open.nombre, 'Segundo');

    assert.deepEqual(to.raw('projects', mainId), {nombre:'Mi trabajo', tipo:'desarrollo', createdAt:0, labels:[{name:'urgente', color:2}]});
    assert.deepEqual(to.raw('projects', 'main'), {deleted:true, createdAt:0}, 'el principal vacío de una cuenta nueva no se queda');
    const base = 'projects/' + mainId + '/';
    assert.deepEqual(to.raw(base + 'tasks', 't1').linkedContacts, ['c1'], 'los enlaces siguen valiendo: mismos ids');
    assert.ok(to.raw(base + 'contacts', 'c1') && to.raw(base + 'vault', 'v1') && to.raw(base + 'clients', 'cl1') && to.raw(base + 'meetings', 'm1'));
    assert.deepEqual(to.raw(base + 'vault_meta', 'check'), {saltPassword:'salt'}, 'el cofre llega con su contraseña maestra');
    assert.equal(to.raw(base + 'tasks/t1/notes', 'n1').imageAssetId, 'img-cuenta-1', 'la imagen de la nota se sube a la cuenta');
    assert.equal(to.raw(base + 'tasks/t1/notes', 'n2').imageAssetId, '');
    assert.equal(imgs.uploads.length, 1);
    assert.deepEqual(to.raw(base + 'plugin_data', 'workhub.informe'), {values:{a:'1'}, updatedAt:1});
    assert.deepEqual(to.raw(base + 'plugin_data', 'install:workhub.temporizador'), {
      _kind:'plugin-install', pluginId:'workhub.temporizador', url:'/plugins/temporizador/',
      manifest:{id:'workhub.temporizador'}, granted:['tasks'], installedAt:5
    }, 'los plugins del principal pasan a ser instalaciones del proyecto');
    assert.deepEqual(to.raw('settings', 'plugin-user:workhub.temporizador').userValues, {k:'"v"'});
    assert.deepEqual(to.raw('settings', 'plugin-user:workhub.smartgp').userValues, {x:'1'});
    assert.equal(to.raw('settings', 'preferences'), undefined, 'las preferencias de la cuenta no se tocan');
    assert.equal(to.raw('projects/' + p2Id + '/tasks', 't9').title, 'Del segundo');
    assert.equal(to.raw('projects/' + p2Id + '/plugin_data', 'install:workhub.informe').pluginId, 'workhub.informe');
    assert.equal(to.rawAll('tasks').size, 0, 'nada cae en la raíz de la cuenta');
    assert.equal(from.raw('tasks', 't1').title, 'Con nota', 'la copia no toca los datos del navegador');
    ok('cuenta nueva: proyectos, tareas, notas, imágenes, cofre y plugins');
  }

  /* ---------- Cuenta que ya tenía datos ---------- */
  {
    const from = guest(), to = fakeDb();
    to.put('projects', 'main', {nombre:'Lo de siempre', createdAt:0});
    to.put('tasks', 'mia', {title:'Ya estaba', status:'todo'});
    to.put('settings', 'plugin-user:workhub.smartgp', {userValues:{x:'de la cuenta'}});
    const state = {name:'Lola', open:'nada'};
    const res = await migration.run({from, to, assets:assets(), state, save:() => {}});
    assert.deepEqual(to.raw('projects', 'main'), {nombre:'Lo de siempre', createdAt:0}, 'el principal de la cuenta sigue ahí');
    assert.equal(to.raw('tasks', 'mia').title, 'Ya estaba');
    assert.equal(to.rawAll('tasks').size, 1, 'no se mezcla con los datos de la cuenta');
    assert.deepEqual(to.raw('settings', 'plugin-user:workhub.smartgp').userValues, {x:'de la cuenta'}, 'no pisa lo que la cuenta ya tenía');
    assert.equal(res.open.id, state.ids.main, 'sin proyecto abierto conocido, el primero');
    assert.equal(to.rawAll('projects').size, 3);
    ok('cuenta con datos: se añaden proyectos y no se toca nada de lo que había');
  }

  /* ---------- Un corte a medias y se repite ---------- */
  {
    const from = guest(), to = fakeDb(), imgs = assets();
    const state = {name:'Lola', open:'main'};
    let saves = 0, cut = true;
    const flaky = guard(to, (col, id) => (cut && col.indexOf('/tasks') !== -1 && id === 't2' ? fail('unavailable') : null));
    await assert.rejects(migration.run({from, to:flaky, assets:imgs, state, save:() => { saves++; }}), (err) => err.code === 'unavailable');
    assert.ok(saves > 0 && state.ids.main && !state.done.main, 'lo hecho queda apuntado y el proyecto, sin terminar');
    const firstId = state.ids.main;
    cut = false;
    const res = await migration.run({from, to:flaky, assets:imgs, state, save:() => {}});
    assert.equal(state.ids.main, firstId, 'el mismo proyecto, no otro');
    assert.equal(to.rawAll('projects').size, 3, 'dos proyectos y el principal marcado: sin duplicados');
    assert.equal(to.raw('projects/' + firstId + '/tasks', 't2').title, 'Otra');
    assert.equal(imgs.uploads.length, 1, 'la imagen no se sube dos veces');
    assert.deepEqual(to.raw('projects', 'main'), {deleted:true, createdAt:0}, 'la cuenta estaba vacía al empezar: se recuerda');
    assert.equal(res.skipped, 0);
    /* Y con todo terminado, repetir no escribe nada nuevo. */
    const before = to.log.writes.length;
    await migration.run({from, to:flaky, assets:imgs, state, save:() => {}});
    assert.equal(to.log.writes.filter((w, i) => i >= before && w.path.indexOf('/tasks') !== -1).length, 0);
    ok('un fallo pasajero corta la copia y la siguiente la termina sin duplicar');
  }

  /* ---------- Lo que las reglas rechazan ---------- */
  {
    const from = guest(), to = fakeDb();
    const state = {name:'Lola', open:'main'};
    const strict = guard(to, (col, id) => (id === 't1' || id === 'c1' ? fail('permission-denied') : null));
    const res = await migration.run({from, to:strict, assets:assets(), state, save:() => {}});
    assert.equal(res.skipped, 2, 'se cuentan los que no entran');
    assert.deepEqual(res.counts, {projects:2, tasks:2});
    const base = 'projects/' + state.ids.main + '/';
    assert.equal(to.raw(base + 'tasks', 't1'), undefined);
    assert.equal(to.rawAll(base + 'tasks/t1/notes').size, 0, 'sin la tarea, sus notas tampoco');
    assert.equal(to.raw(base + 'tasks', 't2').title, 'Otra', 'lo demás sí llega');
    assert.ok(state.done.main && state.done.p2);
    ok('un documento rechazado se salta y se cuenta; el resto se copia');
  }

  /* ---------- Qué cuenta como proyecto del invitado ---------- */
  {
    const from = fakeDb(), to = fakeDb();
    from.put('projects', 'main', {deleted:true, createdAt:0});
    from.put('projects', 'p2', {nombre:'El único', createdAt:5, enc:{pid:'x'}});
    const state = {};
    const res = await migration.run({from, to, state, save:() => {}});
    assert.deepEqual(Object.keys(state.ids), ['p2'], 'el principal eliminado no se lleva');
    assert.deepEqual(to.raw('projects', state.ids.p2), {nombre:'El único', createdAt:5}, 'sin marca de cifrado');
    assert.equal(res.projects.length, 1);

    const legacy = fakeDb(), to2 = fakeDb(), state2 = {};
    legacy.put('tasks', 't', {title:'De antes de haber proyectos'});
    await migration.run({from:legacy, to:to2, state:state2, save:() => {}});
    assert.equal(to2.raw('projects', state2.ids.main).nombre, 'Proyecto principal', 'el principal sin documento también cuenta');
    assert.equal(to2.raw('projects/' + state2.ids.main + '/tasks', 't').title, 'De antes de haber proyectos');

    const nothing = await migration.run({from:fakeDb(), to:fakeDb(), state:{}, save:() => {}});
    assert.deepEqual(nothing, {projects:[], open:null, counts:{projects:0, tasks:0}, skipped:0});
    ok('principal eliminado, principal sin documento e invitado sin nada');
  }

  console.log('Migración del modo invitado: correcta');
})().catch((error) => { console.error(error); process.exitCode = 1; });
