/* Campos personalizados, intervalo de fechas de una tarea (cronograma) y su paso por la copia de
   seguridad: definiciones saneadas, valores validados por tipo, fechas ausentes o inválidas y
   exportar/importar sin perder ni duplicar nada. */
process.env.TZ = 'UTC';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {
  models:{}, utils:{urls:{safeUrl:(url) => url || ''}}, services:{}, i18n:{locale:'es-ES'},
  t:(text, params) => (params ? text.replace(/\{(\w+)\}/g, (_, k) => params[k]) : text),
  views:{team:{enabled:() => false, meUid:() => '', name:() => '', assigned:() => []}}
};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'models/collection-model', 'models/project-templates', 'models/custom-fields', 'models/task-model', 'models/backup-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {CustomFields:CF, TaskModel, BackupModel} = Workhub.models;
const plain = (x) => JSON.parse(JSON.stringify(x));
const ok = (name) => console.log('OK   ' + name);

const FIELDS = [
  {id:'f1', name:'Presupuesto', type:'number', card:true},
  {id:'f2', name:'Referencia', type:'text'},
  {id:'f3', name:'Entrega', type:'date'},
  {id:'f4', name:'Facturable', type:'checkbox'},
  {id:'f5', name:'Prioridad', type:'select', options:[{id:'o1', label:'Alta'}, {id:'o2', label:'Baja'}]}
];

/* ---------- Definiciones ---------- */
{
  const clean = plain(CF.normalize(FIELDS.concat([
    {id:'f1', name:'Repetido', type:'text'},
    {id:'f6', name:'   ', type:'text'},
    {id:'f7', name:'Tipo raro', type:'color'},
    null, 'texto',
    {id:'f8', name:'x'.repeat(200), type:'select', options:[{id:'a', label:'Uno'}, {id:'a', label:'Otra vez'}, {id:'b', label:''}, null]}
  ])));
  assert.deepEqual(clean.map((f) => f.id), ['f1', 'f2', 'f3', 'f4', 'f5', 'f8'], 'fuera los repetidos, sin nombre o de tipo desconocido');
  assert.equal(clean[0].card, true);
  assert.equal(clean[1].card, false);
  assert.equal(clean[5].name.length, CF.MAX_NAME);
  assert.deepEqual(clean[5].options, [{id:'a', label:'Uno'}]);
  assert.ok(!('options' in clean[0]), 'solo las listas llevan opciones');
  const many = Array.from({length:80}, (_, i) => ({id:'m' + i, name:'Campo ' + i, type:'text'}));
  assert.equal(CF.normalize(many).length, CF.MAX_FIELDS);
  assert.deepEqual(plain(CF.normalize(undefined)), []);
  ok('definiciones: se guardan saneadas y con tope');
}

/* ---------- Valores por tipo ---------- */
{
  const [num, text, date, check, select] = CF.normalize(FIELDS);
  assert.equal(CF.clean(num, '1250,5').value, 1250.5);
  assert.equal(CF.clean(num, ' -3 ').value, -3);
  assert.equal(CF.clean(num, 0).value, 0, 'el cero es un valor');
  assert.equal(CF.clean(num, '').value, undefined);
  assert.ok(CF.clean(num, '12x').error);
  assert.ok(CF.clean(num, '1e999').error);
  assert.ok(CF.clean(num, Infinity).error);
  assert.equal(CF.clean(text, '  hola  ').value, 'hola');
  assert.equal(CF.clean(text, '   ').value, undefined);
  assert.ok(CF.clean(text, 'a'.repeat(CF.MAX_TEXT + 1)).error, 'texto demasiado largo');
  assert.equal(CF.clean(text, 'a'.repeat(CF.MAX_TEXT)).value.length, CF.MAX_TEXT);
  assert.equal(CF.clean(date, '2026-10-07').value, '2026-10-07');
  assert.ok(CF.clean(date, '2026-02-31').error, 'un día que no existe');
  assert.ok(CF.clean(date, '07/10/2026').error);
  assert.equal(CF.clean(date, '').value, undefined);
  assert.equal(CF.clean(check, true).value, true);
  assert.equal(CF.clean(check, false).value, undefined, 'una casilla sin marcar no se guarda');
  assert.equal(CF.clean(select, 'o2').value, 'o2');
  assert.equal(CF.clean(select, 'borrada').value, undefined, 'una opción que ya no existe cuenta como vacío');
  ok('valores: cada tipo valida lo suyo y lo vacío no se guarda');

  const values = plain(CF.values(FIELDS, {f1:10, f2:'', f3:'no es fecha', f4:true, f5:'o1', fantasma:'x'}));
  assert.deepEqual(values, {f1:10, f4:true, f5:'o1'});
  assert.deepEqual(plain(CF.values(FIELDS, null)), {});
  assert.deepEqual(plain(CF.values(FIELDS, 'texto')), {});
  assert.equal(CF.format(select, 'o1'), 'Alta');
  assert.equal(CF.format(select, 'borrada'), '');
  assert.equal(CF.format(text, undefined), '');
  assert.equal(CF.format(check, true), 'Sí');
  ok('valores: de una tarea solo cuentan los de los campos que existen');

  const tasks = [{id:'a', custom:{f1:1, f2:'x'}}, {id:'b', custom:{f2:'y'}}, {id:'c'}, {id:'d', custom:null}];
  assert.deepEqual(CF.usedBy(tasks, 'f2').map((t) => t.id), ['a', 'b']);
  assert.deepEqual(plain(CF.without(tasks[0].custom, 'f2')), {f1:1});
  assert.deepEqual(plain(tasks[0].custom), {f1:1, f2:'x'}, 'no se toca el original');
  const merged = plain(CF.merge([FIELDS[0]], [Object.assign({}, FIELDS[0], {name:'Otro nombre'}), FIELDS[1]]));
  assert.deepEqual(merged.map((f) => f.name), ['Presupuesto', 'Referencia'], 'al importar no se pisa un campo que ya existe');
  ok('campos: quién los usa, quitar uno y juntar definiciones');
}

/* ---------- Intervalo de una tarea ---------- */
{
  assert.equal(TaskModel.rangeOf({}), null, 'sin fechas no hay intervalo');
  assert.equal(TaskModel.rangeOf({startDate:'ayer', dueDate:''}), null);
  assert.deepEqual(plain(TaskModel.rangeOf({dueDate:'2026-10-09'})), {start:'2026-10-09', end:'2026-10-09'}, 'solo fecha límite: un día');
  assert.deepEqual(plain(TaskModel.rangeOf({startDate:'2026-10-06'})), {start:'2026-10-06', end:'2026-10-06'}, 'solo inicio: un día');
  assert.deepEqual(plain(TaskModel.rangeOf({startDate:'2026-10-06', dueDate:'2026-10-09'})), {start:'2026-10-06', end:'2026-10-09'});
  assert.deepEqual(plain(TaskModel.rangeOf({startDate:'2026-10-12', dueDate:'2026-10-09'})), {start:'2026-10-09', end:'2026-10-09'}, 'un inicio posterior no alarga la barra');
  assert.equal(TaskModel.shiftYmd('2026-10-31', 1), '2026-11-01');
  assert.equal(TaskModel.shiftYmd('2026-03-01', -1), '2026-02-28');
  assert.equal(TaskModel.daysBetween('2026-10-06', '2026-10-09'), 3);
  ok('intervalo: fechas ausentes, de un día e inválidas');

  /* setRange y reschedule sobre un modelo con una colección de mentira. */
  const writes = [];
  const model = new TaskModel();
  model.col = {doc:(id) => ({update:(patch) => { writes.push({id, patch:plain(patch)}); return Promise.resolve(); }})};
  model.items = [
    {id:'a', title:'A', status:'pendiente', startDate:'2026-10-06', dueDate:'2026-10-09'},
    {id:'b', title:'B', status:'pendiente', dueDate:'2026-10-09'},
    {id:'c', title:'C', status:'pendiente'}
  ];
  assert.equal(model.setRange('a', '2026-10-10', '2026-10-09'), false, 'inicio posterior a la fecha límite');
  assert.equal(model.setRange('a', '', ''), false, 'ninguna fecha');
  assert.equal(model.setRange('a', '2026-10-06', '2026-10-09'), false, 'sin cambios no se escribe');
  assert.equal(model.setRange('zzz', '2026-10-06', '2026-10-09'), false);
  assert.equal(writes.length, 0);
  assert.equal(model.setRange('a', '2026-10-07', '2026-10-12'), true);
  assert.deepEqual([model.find('a').startDate, model.find('a').dueDate], ['2026-10-07', '2026-10-12']);
  assert.equal(model.setRange('b', '', '2026-10-10'), true);
  assert.ok(!('startDate' in writes[1].patch), 'una tarea sin inicio no gana el campo');
  assert.equal(model.setRange('a', '', '2026-10-12'), true);
  assert.equal(writes[2].patch.startDate, '', 'quitar el inicio lo deja vacío');
  ok('setRange: valida el intervalo y solo escribe lo que cambia');

  model.items[0].startDate = '2026-10-07';
  model.reschedule('a', '2026-10-05');
  assert.deepEqual([model.find('a').startDate, model.find('a').dueDate], ['2026-09-30', '2026-10-05'], 'la barra se mueve entera');
  model.reschedule('a', '2026-10-20');
  assert.deepEqual([model.find('a').startDate, model.find('a').dueDate], ['2026-09-30', '2026-10-20'], 'alargar no toca el inicio');
  ok('reschedule: el inicio nunca queda después de la fecha límite');
}

/* ---------- Copia de seguridad ---------- */
(async () => {
  const added = [];
  const empty = {items:[], isReady:() => true, add:async () => ({id:'x'})};
  const tasks = {
    items:[], isReady:() => true,
    add:async (t) => { added.push(plain(t)); return {id:'t' + added.length}; },
    addNoteRaw:async () => {},
    withNotes:async () => [{id:'a', title:'Con todo', startDate:'2026-10-06', dueDate:'2026-10-09', custom:{f1:10, f5:'o1'}, notes:[]}]
  };
  const vault = {items:[], getMeta:async () => ({exists:false})};
  let project = CF.normalize(FIELDS);
  Workhub.views.fields = {list:() => project.slice()};
  const backup = new BackupModel({tasks, contacts:empty, meetings:empty, clients:empty, vault});

  const file = JSON.parse((await backup.build('Proyecto')).json);
  assert.equal(file.customFields.length, 5);
  assert.deepEqual(file.tasks[0].custom, {f1:10, f5:'o1'});
  assert.equal(file.tasks[0].startDate, '2026-10-06');
  ok('copia: exporta las definiciones y los valores');

  /* Restaurar en un proyecto que no tiene los campos: se crean una vez. */
  project = [];
  const savedLists = [];
  backup.onCustomFields = async (list) => { savedLists.push(plain(list)); project = list; return true; };
  file.tasks.push({title:'Rara', startDate:'2026-10-20', dueDate:'2026-10-09', custom:{f1:'no es número', fantasma:1}});
  file.tasks.push({title:'Sin nada'});
  const res = await backup.import(file);
  assert.equal(res.counts.tasks, 3);
  assert.equal(savedLists.length, 1);
  assert.deepEqual(savedLists[0].map((f) => f.id), ['f1', 'f2', 'f3', 'f4', 'f5']);
  assert.deepEqual(added[0].custom, {f1:10, f5:'o1'});
  assert.equal(added[0].startDate, '2026-10-06');
  assert.ok(!('custom' in added[1]) && !('startDate' in added[1]), 'lo que no vale no se importa');
  assert.ok(!('custom' in added[2]) && !('startDate' in added[2]), 'una tarea sin campos no los gana');
  ok('copia: restaura definiciones y valores, y descarta lo inválido');

  /* Importar otra vez sobre el mismo proyecto no vuelve a guardar las definiciones. */
  await backup.import(file);
  assert.equal(savedLists.length, 1);
  /* Una copia antigua, sin campos, se importa como siempre. */
  added.length = 0;
  await backup.import({tasks:[{title:'Antigua', dueDate:'2025-01-01'}]});
  assert.deepEqual(Object.keys(added[0]).sort(), ['cliente', 'contacto', 'createdAt', 'desc', 'dueDate', 'labels', 'order', 'status', 'title', 'updatedAt']);
  ok('copia: no duplica definiciones y las copias antiguas siguen valiendo');

  console.log('\nTodo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
