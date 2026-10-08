/* Filtros de tareas: etiqueta, fecha límite (vencidas, sin fecha) y sin asignar, solos y combinados
   con los que ya había (búsqueda, cliente, miembro). Filtrar solo lee: no cambia ninguna tarea.
   Uso: node tests/tasks/filter.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* Equipo de mentira: Ana (yo) y Bob. */
let teamOn = true;
const team = {
  enabled:() => teamOn,
  meUid:() => 'ana',
  assigned:(t) => (Array.isArray(t.assignees) ? t.assignees : []),
  name:(uid) => ({ana:'Ana', bob:'Bob'}[uid] || '')
};
const Workhub = {models:{}, utils:{}, services:{}, views:{team:team}, t:(text) => text};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'models/collection-model', 'models/project-templates', 'models/task-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TaskModel} = Workhub.models;
const ok = (name) => console.log('OK   ' + name);

const {ymd} = Workhub.utils.dates;
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };

TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'done', label:'Hecho', done:true}]);
const m = new TaskModel();
m.items = [
  {id:'a', title:'Portada', status:'todo', cliente:'Acme', labels:['Web', 'Urgente'], dueDate:day(-2), assignees:['ana']},
  {id:'b', title:'Factura', status:'doing', cliente:'Acme', labels:['Cobros'], dueDate:day(5), assignees:[]},
  {id:'c', title:'Logo', status:'doing', cliente:'Beta', labels:['web'], dueDate:'', assignees:['bob']},
  {id:'d', title:'Entrega', status:'done', cliente:'Beta', labels:['Web'], dueDate:day(-9)},
  {id:'e', title:'Idea suelta', status:'todo', cliente:'', dueDate:''},
  {id:'f', title:'Archivada', status:'todo', cliente:'Acme', labels:['Web'], dueDate:day(-1), archivedAt:5}
];
const before = JSON.stringify(m.everything());
const ids = (query, cliente, assignee, more) => m.filter(query, cliente, assignee, more).map((t) => t.id).join('');

assert.equal(ids(), 'abcde', 'sin filtros, todas las que están a la vista');
assert.equal(ids('', '', '', {}), 'abcde');
assert.equal(ids('', '', '', {label:'', due:''}), 'abcde');
ok('sin filtros no se quita nada');

assert.equal(ids('', '', '', {label:'Web'}), 'acd', 'sin distinguir mayúsculas');
assert.equal(ids('', '', '', {label:'cobros'}), 'b');
assert.equal(ids('', '', '', {label:'Inexistente'}), '');
assert.equal(ids('', '', '', {label:'We'}), '', 'el nombre entero, no un trozo');
ok('por etiqueta');

assert.equal(ids('', '', '', {due:'overdue'}), 'a', 'vencida y sin terminar: la completada no cuenta');
assert.equal(ids('', '', '', {due:'none'}), 'ce');
ok('por fecha límite: vencidas y sin fecha');

assert.equal(ids('', '', 'none'), 'bde', 'sin asignar, también las que no tienen el campo');
assert.equal(ids('', '', 'me'), 'a');
assert.equal(ids('', '', 'bob'), 'c');
ok('por miembro y sin asignar (como antes)');

assert.equal(ids('', 'Acme', '', {label:'web'}), 'a');
assert.equal(ids('', 'Beta', '', {label:'web', due:'none'}), 'c');
assert.equal(ids('', '', 'none', {due:'none'}), 'e');
assert.equal(ids('', '', 'none', {label:'web'}), 'd');
assert.equal(ids('logo', '', '', {label:'web'}), 'c');
assert.equal(ids('', '', 'me', {label:'web', due:'overdue'}), 'a');
assert.equal(ids('', '', 'bob', {due:'overdue'}), '', 'una combinación sin resultados');
ok('combinados entre sí y con búsqueda, cliente y miembro');

assert.equal(ids('', '', '', {noLabel:true}), 'e', 'las que no llevan ninguna etiqueta (o no tienen el campo)');
assert.equal(ids('', 'Acme', '', {noLabel:true}), '');
ok('sin etiqueta');

/* b vence en 5 días; g mañana, h hoy, i en 20 días, j en 40; k mañana pero ya completada. */
const base = m.everything().slice();
m.items = base.concat([
  {id:'g', title:'Mañana', status:'todo', dueDate:day(1)},
  {id:'h', title:'Hoy', status:'todo', dueDate:day(0)},
  {id:'i', title:'Veinte', status:'todo', dueDate:day(20)},
  {id:'j', title:'Cuarenta', status:'todo', dueDate:day(40)},
  {id:'k', title:'Hecha', status:'done', dueDate:day(1)}
]);
assert.equal(ids('', '', '', {due:'day'}), 'gh', 'de hoy a mañana, sin las vencidas ni las completadas');
assert.equal(ids('', '', '', {due:'week'}), 'bgh');
assert.equal(ids('', '', '', {due:'month'}), 'bghi');
assert.equal(ids('', 'Acme', '', {due:'month'}), 'b');
ok('por fecha límite: vencen pronto (2, 7 y 30 días)');

assert.equal(ids('', '', '', {done:'done'}), 'dk');
assert.equal(ids('', '', '', {done:'open'}), 'abceghij');
assert.equal(ids('', '', '', {done:'done', label:'web'}), 'd');
assert.equal(ids('', '', '', {done:'done', due:'overdue'}), '', 'una completada nunca está vencida');
assert.equal(ids('', '', '', {done:'open', due:'none'}), 'ce');
ok('completadas y sin completar');
m.items = base;

/* Fuera de un equipo no hay asignaciones: ese filtro no se aplica y los nuevos sí. */
teamOn = false;
assert.equal(ids('', '', 'none', {label:'web'}), 'acd');
teamOn = true;
ok('sin equipo, el filtro por miembro no cuenta');

assert.equal(JSON.stringify(m.everything()), before);
ok('filtrar no modifica ninguna tarea');
console.log('Todo correcto.');
