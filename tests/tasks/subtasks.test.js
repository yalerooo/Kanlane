/* Subtareas en equipos: cada una se asigna a una persona y guarda quién la completó y cuándo,
   sin tocar a quién está asignada la tarea. La repetición conserva la asignación y no la marca.
   Uso: node tests/tasks/subtasks.test.js */
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

/* Colección en memoria: update mezcla (o falla si reject lo dice) y add crea. */
function model(task, reject){
  const doc = plain(task);
  const made = [];
  const m = new TaskModel();
  m.items = [plain(task)];
  m.col = {
    add:(data) => { made.push(plain(data)); return Promise.resolve({id:'n' + made.length}); },
    doc:() => ({update:(patch) => {
      if(reject) return Promise.reject(new Error('permission-denied'));
      Object.assign(doc, plain(patch));
      return Promise.resolve();
    }})
  };
  return {m:m, doc:doc, made:made};
}

const TASK = {id:'a', title:'Tarea', status:'todo', assignees:['ana'], order:1, createdAt:1, updatedAt:1,
  checklist:[{id:'c1', text:'Uno', done:false}, {id:'c2', text:'Dos', done:false, assignee:'luis'}]};

(async () => {
  {
    const {m, doc} = model(TASK);
    assert.equal(await m.assignCheck('a', 'c1', 'ana'), true);
    assert.deepEqual(doc.checklist, [{id:'c1', text:'Uno', done:false, assignee:'ana'}, {id:'c2', text:'Dos', done:false, assignee:'luis'}]);
    assert.deepEqual(plain(m.find('a').checklist), doc.checklist, 'lo que se ve es lo que se guardó');
    assert.deepEqual(doc.assignees, ['ana'], 'la asignación de la tarea no cambia');
    assert.equal(await m.assignCheck('a', 'c1', 'ana'), false, 'asignar a quien ya la tiene no escribe nada');
    assert.equal(await m.assignCheck('a', 'c2', ''), true);
    assert.deepEqual(doc.checklist[1], {id:'c2', text:'Dos', done:false}, 'sin asignar no deja el campo');
    assert.equal(await m.assignCheck('a', 'no-existe', 'ana'), false);
    ok('asignar y desasignar una subtarea');
  }
  {
    const {m} = model(TASK, true);
    await assert.rejects(m.assignCheck('a', 'c1', 'ana'));
    assert.deepEqual(plain(m.find('a').checklist), TASK.checklist);
    ok('si no se puede guardar, la asignación se deshace');
  }
  {
    const {m, doc} = model(TASK);
    const before = Date.now();
    await m.toggleCheck('a', 'c2', true, 'ana');
    const done = doc.checklist[1];
    assert.deepEqual([done.done, done.assignee, done.doneBy], [true, 'luis', 'ana'], 'la completa otra persona y sigue asignada a la suya');
    assert.ok(done.doneAt >= before && done.doneAt <= Date.now());
    assert.deepEqual(doc.checklist[0], {id:'c1', text:'Uno', done:false}, 'las demás no cambian');
    await m.toggleCheck('a', 'c2', false, 'ana');
    assert.deepEqual(doc.checklist[1], {id:'c2', text:'Dos', done:false, assignee:'luis'}, 'al reabrirla se borra quién la completó');
    await m.toggleCheck('a', 'c1', true);
    assert.deepEqual(doc.checklist[0], {id:'c1', text:'Uno', done:true}, 'fuera de un equipo no se guarda nadie');
    ok('quién completa una subtarea, y cuándo');
  }
  {
    assert.deepEqual(plain(TaskModel.checkItem({id:'c', text:'T', done:true, assignee:'ana', doneBy:'luis', doneAt:5, extra:1})),
      {id:'c', text:'T', done:true, assignee:'ana', doneBy:'luis', doneAt:5});
    assert.deepEqual(plain(TaskModel.checkItem({id:'c', text:'T', done:false, doneBy:'luis', doneAt:5})), {id:'c', text:'T', done:false});
    assert.deepEqual(plain(TaskModel.checkItem({id:'c', text:'T'})), {id:'c', text:'T', done:false});
    ok('la subtarea que se guarda desde el formulario');
  }
  {
    const repeated = Object.assign({}, TASK, {dueDate:'2090-01-10', repeat:'weekly',
      checklist:[{id:'c1', text:'Uno', done:true, assignee:'ana', doneBy:'luis', doneAt:5}, {id:'c2', text:'Dos', done:false}]});
    const {m, made} = model(repeated);
    await m.spawnNext(m.find('a'));
    assert.deepEqual(made[0].checklist, [{id:'c1', text:'Uno', done:false, assignee:'ana'}, {id:'c2', text:'Dos', done:false}]);
    ok('la repetición conserva la asignación y empieza sin completar');
  }
  console.log('\nTodo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
