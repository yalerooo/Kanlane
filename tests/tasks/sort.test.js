/* Ordenar una columna por fecha límite, título o creación: se ordena una vez (reescribe el orden
   manual), no se pierde ninguna tarea, no toca las demás columnas y después se sigue arrastrando.
   Uso: node tests/tasks/sort.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}, utils:{}, services:{}, views:{team:{enabled:() => false}}, i18n:{locale:'es-ES'}, t:(text) => text};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'models/collection-model', 'models/project-templates', 'models/task-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TaskModel} = Workhub.models;
const ok = (name) => console.log('OK   ' + name);

/* Colección en memoria con la forma que usa el modelo; apunta lo que se escribe. */
function model(seed){
  const docs = new Map(seed.map((d) => [d.id, Object.assign({}, d)]));
  const writes = [];
  const m = new TaskModel();
  m.col = {doc:(id) => ({update:(patch) => { writes.push({id:id, patch:patch}); Object.assign(docs.get(id), patch); return Promise.resolve(); }})};
  m.items = Array.from(docs.values()).map((d) => Object.assign({}, d));
  return {m:m, docs:docs, writes:writes};
}
const ids = (list) => list.map((t) => t.id).join('');

TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'done', label:'Hecho', done:true}]);
/* Orden manual de «Por hacer»: a b c d e f. La g está archivada y la h en otra columna. */
const SEED = [
  {id:'a', title:'Zapatos', status:'todo', order:1, createdAt:50, dueDate:'2030-03-01'},
  {id:'b', title:'árbol', status:'todo', order:2, createdAt:40, dueDate:''},
  {id:'c', title:'Tarea 10', status:'todo', order:3, createdAt:60, dueDate:'2030-01-15', dueTime:'09:00'},
  {id:'d', title:'tarea 2', status:'todo', order:4, createdAt:10, dueDate:'2030-01-15'},
  {id:'e', title:'Beta', status:'todo', order:5, createdAt:30},
  {id:'f', title:'Alfa', status:'todo', order:6, createdAt:20, dueDate:'2029-12-31'},
  {id:'g', title:'Archivada', status:'todo', order:0, createdAt:1, dueDate:'2020-01-01', archivedAt:5},
  {id:'h', title:'Otra columna', status:'doing', order:9, createdAt:5, dueDate:'2030-01-01'}
];

{
  const {m, docs, writes} = model(SEED);
  const before = m.sortColumn('todo', 'due');
  assert.equal(ids(m.inStatus('todo')), 'fcdabe', 'la más próxima primero; mismo día, antes la que tiene hora; sin fecha al final y en el orden que tenían');
  assert.equal(ids(before), 'abcdef', 'devuelve el orden anterior');
  assert.equal(m.items.length, 7, 'no se pierde ninguna tarea');
  assert.ok(writes.every((w) => Object.keys(w.patch).join() === 'order'), 'solo se escribe el orden');
  assert.ok(writes.every((w) => 'abcdef'.indexOf(w.id) !== -1), 'ni la archivada ni la otra columna se tocan');
  assert.equal(docs.get('h').order, 9);
  assert.equal(docs.get('g').order, 0);
  assert.equal(m.sortColumn('todo', 'due'), null, 'ya ordenada: no hace nada');
  ok('por fecha límite, con tareas sin fecha');

  /* Deshacer: vuelve el orden manual de antes. */
  m.setOrders(before);
  assert.equal(ids(m.inStatus('todo')), 'abcdef');
  ok('se puede deshacer');
}

{
  const {m} = model(SEED);
  m.sortColumn('todo', 'title');
  assert.equal(ids(m.inStatus('todo')), 'fbedca', 'sin distinguir mayúsculas ni acentos y con los números por su valor (2 antes que 10)');
  assert.equal(m.inStatus('todo').length, 6);
  ok('por título');
}

{
  const {m} = model(SEED);
  m.sortColumn('todo', 'created');
  assert.equal(ids(m.inStatus('todo')), 'dfebac', 'las más antiguas primero');
  ok('por fecha de creación');

  /* Después de ordenar se sigue arrastrando, y una tarea nueva va al final. */
  m.move('c', 'todo', 'd');
  assert.equal(ids(m.inStatus('todo')), 'cdfeba');
  m.move('h', 'todo', 'f');
  assert.equal(ids(m.inStatus('todo')), 'cdhfeba');
  ok('arrastrar sigue funcionando');
}

{
  const {m, writes} = model(SEED);
  assert.equal(m.sortColumn('todo', 'otra-cosa'), null);
  assert.equal(m.sortColumn('done', 'title'), null, 'columna vacía');
  assert.equal(m.sortColumn('doing', 'title'), null, 'una sola tarea');
  assert.equal(writes.length, 0);
  ok('criterio desconocido o nada que ordenar: no escribe');
}
console.log('Todo correcto.');
