/* Automatizaciones (src/models/automation-model.js): reglas, acciones y el motor que las encadena,
   con tareas en memoria. Cubre los casos límite del encargo: bucles, cadenas largas, columna o
   etiqueta borrada, muchas ejecuciones a la vez y las reglas por fecha. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/models/automation-model.js'), 'utf8'), {Workhub, Date, Math, Promise});
const A = Workhub.models.Automations;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const ctx = (over) => Object.assign({
  stages:[{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'review', label:'Revisión'}, {key:'done', label:'Hecho', done:true}],
  labels:['Urgente', 'Web'], members:[{uid:'ana', name:'Ana'}, {uid:'luis', name:'Luis'}], team:true, me:'ana'
}, over);
const rule = (r) => A.normalize(Object.assign({cond:{}}, r));

/* Un proyecto en memoria: tareas, reglas y lo que el motor va haciendo. */
function world(rules, tasks, c){
  const w = {tasks:tasks, rules:rules, log:[], warns:[], clock:1000, today:0, ctx:c || ctx()};
  w.engine = new A.Engine({
    rules:() => w.rules, ctx:() => w.ctx,
    task:(id) => w.tasks.find((t) => t.id === id) || null,
    update:(id, patch) => { Object.assign(w.tasks.find((t) => t.id === id), patch); return Promise.resolve(); },
    log:(id, r, did) => { w.log.push({id:id, rule:r.id, did:did}); return Promise.resolve(); },
    warn:(code) => w.warns.push(code),
    dateIn:(n) => 'D+' + n,
    daysUntil:(date) => Number(date.slice(2)) - w.today,
    now:() => w.clock
  });
  return w;
}

test('normalize limpia y descarta lo que no sirve', () => {
  assert.equal(A.normalize(null), null);
  assert.equal(A.normalize({trigger:{type:'otro'}, actions:[{type:'complete'}]}), null);
  assert.equal(A.normalize({trigger:{type:'moved'}, actions:[{type:'complete'}]}), null, 'mover necesita columna');
  assert.equal(A.normalize({trigger:{type:'completed'}, actions:[{type:'label', name:'  '}]}), null, 'sin acciones válidas');
  const r = A.normalize({name:'  Mía  ', trigger:{type:'due', days:'2.4', stage:'x'}, cond:{label:' Web '}, actions:[{type:'due', days:999}, {type:'borrar'}, {type:'subtask', text:'x'.repeat(300)}]});
  assert.equal(r.name, 'Mía');
  assert.deepEqual(JSON.parse(JSON.stringify(r.trigger)), {type:'due', days:2});
  assert.equal(r.cond.label, 'Web');
  assert.deepEqual(r.actions.map((a) => a.type), ['due', 'subtask']);
  assert.equal(r.actions[0].days, 365);
  assert.equal(r.actions[1].text.length, 120);
  assert.equal(r.on, true);
  assert.ok(r.id);
  assert.equal(A.normalizeAll(Array.from({length:50}, () => ({trigger:{type:'completed'}, actions:[{type:'due', days:1}]}))).length, A.MAX_RULES);
});

test('qué dispara cada regla', () => {
  const c = ctx();
  const moved = rule({trigger:{type:'moved', stage:'review'}, actions:[{type:'complete'}]});
  assert.equal(A.matches(moved, {type:'moved', from:'todo', to:'review'}, {status:'review'}, c), true);
  assert.equal(A.matches(moved, {type:'moved', from:'todo', to:'doing'}, {status:'doing'}, c), false);
  assert.equal(A.matches(moved, {type:'created', to:'review'}, {status:'review'}, c), false, 'crear no es mover');
  const created = rule({trigger:{type:'created', stage:'todo'}, actions:[{type:'due', days:1}]});
  assert.equal(A.matches(created, {type:'created', to:'todo'}, {status:'todo'}, c), true);
  assert.equal(A.matches(created, {type:'created', to:'doing'}, {status:'doing'}, c), false);
  const done = rule({trigger:{type:'completed'}, actions:[{type:'due', days:0}]});
  assert.equal(A.matches(done, {type:'moved', from:'doing', to:'done'}, {status:'done'}, c), true);
  assert.equal(A.matches(done, {type:'moved', from:'done', to:'done'}, {status:'done'}, c), false);
  assert.equal(A.matches(done, {type:'created', to:'done'}, {status:'done'}, c), true);
  /* Condiciones. */
  const only = rule({trigger:{type:'created'}, cond:{label:'web', assignee:'none'}, actions:[{type:'assign', uid:'ana'}]});
  assert.equal(A.matches(only, {type:'created', to:'todo'}, {status:'todo', labels:['Web']}, c), true);
  assert.equal(A.matches(only, {type:'created', to:'todo'}, {status:'todo', labels:['Web'], assignees:['luis']}, c), false);
  assert.equal(A.matches(only, {type:'created', to:'todo'}, {status:'todo', labels:[]}, c), false);
});

test('las acciones solo cuentan lo que cambia: aplicar dos veces no hace nada la segunda', () => {
  const c = ctx();
  const io = {dateIn:(n) => 'D+' + n};
  const r = rule({trigger:{type:'created'}, actions:[{type:'move', stage:'review'}, {type:'assign', uid:'luis'}, {type:'label', name:'Urgente'}, {type:'subtask', text:'Revisar'}, {type:'due', days:3}]});
  const task = {id:'t', status:'todo', labels:['Web'], checklist:[]};
  const first = A.plan(r, task, c, io);
  assert.deepEqual(Object.keys(first.patch).sort(), ['assignees', 'checklist', 'dueDate', 'labels', 'status']);
  assert.deepEqual(JSON.parse(JSON.stringify(first.moved)), {from:'todo', to:'review'});
  assert.equal(first.did.length, 5);
  assert.deepEqual(first.patch.labels, ['Web', 'Urgente']);
  assert.equal(first.patch.checklist[0].text, 'Revisar');
  const second = A.plan(r, Object.assign({}, task, first.patch), c, io);
  assert.deepEqual(Object.keys(second.patch), []);
  assert.equal(second.moved, null);
  /* Completar: a la primera etapa final; ya completada, nada. Asignar fuera de un equipo, nada. */
  const fin = rule({trigger:{type:'created'}, actions:[{type:'complete'}, {type:'assign', uid:'ana'}]});
  assert.equal(A.plan(fin, {status:'doing'}, ctx({team:false}), io).patch.status, 'done');
  assert.deepEqual(Object.keys(A.plan(fin, {status:'done'}, ctx({team:false}), io).patch), []);
});

test('una regla que apunta a algo borrado tiene un problema', () => {
  const c = ctx();
  assert.equal(A.problem(rule({trigger:{type:'moved', stage:'review'}, actions:[{type:'label', name:'urgente'}, {type:'assign', uid:'ana'}]}), c), '');
  assert.match(A.problem(rule({trigger:{type:'moved', stage:'borrada'}, actions:[{type:'complete'}]}), c), /columna/);
  assert.match(A.problem(rule({trigger:{type:'completed'}, actions:[{type:'move', stage:'borrada'}]}), c), /columna/);
  assert.match(A.problem(rule({trigger:{type:'completed'}, actions:[{type:'label', name:'Vieja'}]}), c), /etiqueta/);
  assert.match(A.problem(rule({trigger:{type:'completed'}, cond:{label:'Vieja'}, actions:[{type:'due', days:1}]}), c), /etiqueta/);
  assert.match(A.problem(rule({trigger:{type:'completed'}, actions:[{type:'assign', uid:'seFue'}]}), c), /persona/);
  assert.match(A.problem(rule({trigger:{type:'completed'}, actions:[{type:'assign', uid:'ana'}]}), ctx({team:false})), /equipo/);
  assert.match(A.problem(rule({trigger:{type:'created'}, actions:[{type:'complete'}]}), ctx({stages:[{key:'a', label:'A'}]})), /etapa final/);
});

test('la frase de la regla', () => {
  const c = ctx();
  assert.equal(A.describe(rule({trigger:{type:'moved', stage:'done'}, cond:{label:'Web', assignee:'none'}, actions:[{type:'complete'}, {type:'subtask', text:'Avisar'}]}), c),
    'Cuando una tarea se mueve a «Hecho» y lleva la etiqueta «Web» y no tiene a nadie asignado: marcarla como completada, añadir la subtarea «Avisar».');
  assert.equal(A.describe(rule({trigger:{type:'due', days:2}, actions:[{type:'label', name:'Urgente'}]}), c),
    'Cuando faltan 2 días para la fecha límite: añadir la etiqueta «Urgente».');
});

test('las plantillas salen válidas para el proyecto', () => {
  const c = ctx();
  const list = A.templates(c);
  assert.ok(list.length >= 3 && list.length <= 5, 'entre 3 y 5: ' + list.length);
  list.forEach((x) => { assert.ok(x.name && x.text && x.rule); assert.equal(A.problem(x.rule, c), '', x.name); });
  /* Sin etiquetas ni equipo siguen saliendo las que no los necesitan. */
  const solo = A.templates(ctx({labels:[], team:false, members:[], me:''}));
  assert.ok(solo.length >= 3);
  solo.forEach((x) => assert.equal(A.problem(x.rule, ctx({labels:[], team:false, members:[]})), '', x.name));
});

test('mover a «Hecho» dispara la regla una sola vez y queda registrada', async () => {
  const w = world([rule({id:'a', trigger:{type:'moved', stage:'done'}, actions:[{type:'label', name:'Web'}]})], [{id:'t', status:'done', labels:[]}]);
  await w.engine.handle({type:'moved', id:'t', from:'doing', to:'done'});
  assert.deepEqual(w.tasks[0].labels, ['Web']);
  assert.equal(w.log.length, 1);
  assert.equal(w.log[0].rule, 'a');
  assert.deepEqual(w.warns, []);
  /* Una regla desactivada o rota no se ejecuta. */
  w.rules[0].on = false;
  w.tasks[0].labels = [];
  await w.engine.handle({type:'moved', id:'t', from:'doing', to:'done'});
  assert.deepEqual(w.tasks[0].labels, []);
});

test('bucle: A mueve y B devuelve; se corta con aviso y cada regla corre una vez', async () => {
  const w = world([
    rule({id:'a', trigger:{type:'moved', stage:'doing'}, actions:[{type:'move', stage:'review'}]}),
    rule({id:'b', trigger:{type:'moved', stage:'review'}, actions:[{type:'move', stage:'doing'}]})
  ], [{id:'t', status:'doing'}]);
  await w.engine.handle({type:'moved', id:'t', from:'todo', to:'doing'});
  assert.deepEqual(w.log.map((l) => l.rule), ['a', 'b']);
  assert.deepEqual(w.warns, ['loop']);
  assert.equal(w.tasks[0].status, 'doing');
});

test('una cadena de reglas distintas no pasa de tres saltos', async () => {
  const c = ctx({stages:['s0', 's1', 's2', 's3', 's4', 's5'].map((k) => ({key:k, label:k}))});
  const hop = (n) => rule({id:'r' + n, trigger:{type:'moved', stage:'s' + n}, actions:[{type:'move', stage:'s' + (n + 1)}]});
  const w = world([hop(1), hop(2), hop(3), hop(4)], [{id:'t', status:'s1'}], c);
  await w.engine.handle({type:'moved', id:'t', from:'s0', to:'s1'});
  assert.deepEqual(w.log.map((l) => l.rule), ['r1', 'r2', 'r3']);
  assert.equal(w.tasks[0].status, 's4');
  assert.deepEqual(w.warns, ['depth']);
});

test('muchas ejecuciones a la vez: límite por minuto, y se recupera al pasar el minuto', async () => {
  const tasks = Array.from({length:200}, (x, i) => ({id:'t' + i, status:'todo', labels:[]}));
  const w = world([rule({id:'a', trigger:{type:'created'}, actions:[{type:'label', name:'Web'}]})], tasks);
  await Promise.all(tasks.map((t) => w.engine.handle({type:'created', id:t.id, to:'todo'})));
  assert.equal(w.log.length, A.MAX_PER_MINUTE);
  assert.ok(w.warns.length && w.warns.every((x) => x === 'rate'));
  w.clock += 61000;
  await w.engine.handle({type:'created', id:'t199', to:'todo'});
  assert.equal(w.log.length, A.MAX_PER_MINUTE + 1);
});

test('reglas por fecha: una vez por tarea y fecha, sin las terminadas, y otra vez si la fecha cambia', async () => {
  const w = world([rule({id:'d', trigger:{type:'due', days:2}, actions:[{type:'label', name:'Urgente'}]})], [
    {id:'cerca', status:'todo', dueDate:'D+2', labels:[]},
    {id:'lejos', status:'todo', dueDate:'D+9', labels:[]},
    {id:'vencida', status:'doing', dueDate:'D+-3', labels:[]},
    {id:'hecha', status:'done', dueDate:'D+1', labels:[]},
    {id:'sinFecha', status:'todo', labels:[]}
  ]);
  const fired = {};
  assert.equal(await w.engine.checkDue(w.tasks, fired), true);
  assert.deepEqual(w.log.map((l) => l.id).sort(), ['cerca', 'vencida']);
  assert.deepEqual(JSON.parse(JSON.stringify(fired)), {'d:cerca':'D+2', 'd:vencida':'D+-3'});
  /* Quitar la etiqueta a mano no la vuelve a poner. */
  w.tasks[0].labels = [];
  assert.equal(await w.engine.checkDue(w.tasks, fired), false);
  assert.deepEqual(w.tasks[0].labels, []);
  /* Pasan los días: «lejos» entra en el plazo. Y si se cambia la fecha de «cerca», vuelve a contar. */
  w.today = 7;
  w.tasks[0].dueDate = 'D+8';
  assert.equal(await w.engine.checkDue(w.tasks, fired), true);
  assert.deepEqual(w.tasks[1].labels, ['Urgente']);
  assert.deepEqual(w.tasks[0].labels, ['Urgente']);
});

test('una regla por fecha que mueve la tarea encadena con las demás, sin repetirse', async () => {
  const w = world([
    rule({id:'d', trigger:{type:'due', days:0}, actions:[{type:'move', stage:'review'}]}),
    rule({id:'m', trigger:{type:'moved', stage:'review'}, actions:[{type:'subtask', text:'Revisar'}]})
  ], [{id:'t', status:'todo', dueDate:'D+0'}]);
  await w.engine.checkDue(w.tasks, {});
  assert.deepEqual(w.log.map((l) => l.rule), ['d', 'm']);
  assert.equal(w.tasks[0].checklist[0].text, 'Revisar');
});

(async () => {
  for(const [name, fn] of tests){
    await fn();
    console.log('ok   ' + name);
  }
  console.log('\n' + tests.length + ' pruebas correctas');
})().catch((err) => { console.error(err); process.exit(1); });
