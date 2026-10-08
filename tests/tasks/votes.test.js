/* Votos de una tarea: un voto por persona, se pone y se quita, y no pasa a las copias. La
   ubicación es un texto más de la tarea: aquí solo se comprueba qué se lleva la copia.
   Uso: node tests/tasks/votes.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}, utils:{}, services:{}, views:{team:{enabled:() => false}}, t:(text) => text};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'models/collection-model', 'models/project-templates', 'models/task-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TaskModel} = Workhub.models;
const ok = (name) => console.log('OK   ' + name);
const plain = (v) => JSON.parse(JSON.stringify(v));

function model(seed, opts){
  const o = opts || {};
  const docs = new Map(seed.map((d) => [d.id, Object.assign({}, d)]));
  const writes = [];
  const added = [];
  const m = new TaskModel();
  m.col = {
    add:(data) => { added.push(data); return Promise.resolve({id:'n' + added.length}); },
    doc:(id) => ({update:(patch) => {
      if(o.reject) return Promise.reject(new Error('permission-denied'));
      writes.push({id:id, patch:plain(patch)});
      Object.assign(docs.get(id), patch);
      return Promise.resolve();
    }})
  };
  m.items = Array.from(docs.values()).map((d) => Object.assign({}, d));
  return {m:m, docs:docs, writes:writes, added:added};
}

TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'done', label:'Hecho', done:true}]);

(async () => {
  assert.deepEqual(plain(TaskModel.votesOf({})), []);
  assert.deepEqual(plain(TaskModel.votesOf({votes:['ana', 'ana', '', 3, null, 'bob']})), ['ana', 'bob'], 'un voto por persona; lo que no es un id se ignora');
  assert.deepEqual(plain(TaskModel.votesOf({votes:5})), []);
  assert.deepEqual(plain(TaskModel.votesOf(null)), []);
  ok('quién ha votado');

  {
    const {m, docs, writes} = model([{id:'a', title:'A', status:'todo', updatedAt:5}, {id:'b', title:'B', status:'todo'}]);
    assert.equal(await m.toggleVote('a', 'ana'), true);
    assert.equal(await m.toggleVote('a', 'bob'), true);
    assert.deepEqual(plain(docs.get('a').votes), ['ana', 'bob']);
    assert.deepEqual(plain(TaskModel.votesOf(m.find('a'))), ['ana', 'bob']);
    assert.equal(await m.toggleVote('a', 'ana'), false, 'votar otra vez quita mi voto');
    assert.deepEqual(plain(docs.get('a').votes), ['bob']);
    assert.ok(writes.every((w) => Object.keys(w.patch).join() === 'votes'), 'solo se escriben los votos');
    assert.equal(docs.get('a').updatedAt, 5, 'votar no cambia la última modificación');
    assert.ok(!('votes' in docs.get('b')), 'una tarea sin votos no lleva el campo');
    await assert.rejects(m.toggleVote('no-existe', 'ana'));
    await assert.rejects(m.toggleVote('a', ''), 'sin saber quién vota no se vota');
    ok('votar y quitar el voto');
  }

  {
    const {m} = model([{id:'a', title:'A', status:'todo', votes:['bob']}], {reject:true});
    await assert.rejects(m.toggleVote('a', 'ana'));
    assert.deepEqual(plain(TaskModel.votesOf(m.find('a'))), ['bob'], 'si no se guarda, lo local vuelve a como estaba');
    ok('escritura rechazada');
  }

  /* Copias: la ubicación pasa, los votos no. */
  const copy = TaskModel.copyOf({id:'a', title:'A', votes:['ana'], location:'Puerta del Sol'});
  assert.ok(!('votes' in copy));
  assert.equal(copy.location, 'Puerta del Sol');
  {
    const {m, added} = model([{id:'a', title:'A', status:'done', dueDate:'2030-01-01', repeat:'weekly', votes:['ana'], location:'Sala 2'},
      {id:'b', title:'B', status:'done', dueDate:'2030-01-01', repeat:'weekly'}]);
    await m.spawnNext(m.find('a'));
    await m.spawnNext(m.find('b'));
    assert.deepEqual(plain(added.map((t) => [t.location || null, 'votes' in t])), [['Sala 2', false], [null, false]]);
  }
  ok('duplicar y repetir conservan la ubicación, no los votos');
  console.log('Todo correcto.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
