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

test('el aviso de una columna o una persona borrada dice su nombre, no su identificador', () => {
  const full = ctx();
  const saved = A.withNames(rule({trigger:{type:'moved', stage:'doing'}, cond:{assignee:'luis'}, actions:[{type:'move', stage:'review'}, {type:'assign', uid:'ana'}]}), full);
  assert.equal(saved.trigger.stageName, 'En curso');
  assert.equal(saved.cond.assigneeName, 'Luis');
  assert.equal(saved.actions[0].stageName, 'Revisión');
  assert.equal(saved.actions[1].memberName, 'Ana');
  /* Los nombres sobreviven a guardar y volver a leer. */
  const kept = A.normalize(JSON.parse(JSON.stringify(saved)));
  assert.equal(kept.trigger.stageName, 'En curso');
  /* Se borra la columna «En curso» (clave interna «doing»). */
  const noDoing = ctx({stages:full.stages.filter((s) => s.key !== 'doing')});
  assert.equal(A.problem(kept, noDoing), 'la columna «En curso» ya no existe');
  assert.match(A.describe(kept, noDoing), /^Cuando una tarea se mueve a «En curso» y está asignada a Luis: moverla a «Revisión», asignarla a Ana\.$/);
  assert.equal(A.title(kept, noDoing), 'Al mover a «En curso»');
  /* Se va Luis del equipo. */
  assert.equal(A.problem(kept, ctx({members:[{uid:'ana', name:'Ana'}]})), 'Luis ya no está en el proyecto');
  /* Sin columna borrada, el nombre guardado no manda: se usa el de ahora (si se renombra, cambia). */
  const renamed = ctx({stages:full.stages.map((s) => (s.key === 'doing' ? {key:'doing', label:'En marcha'} : s))});
  assert.match(A.describe(kept, renamed), /se mueve a «En marcha»/);
  assert.equal(A.withNames(kept, renamed).trigger.stageName, 'En marcha');
  /* Una regla antigua, sin nombre guardado: nunca enseña la clave interna. */
  const old = rule({trigger:{type:'moved', stage:'doing'}, actions:[{type:'move', stage:'s9x2'}]});
  assert.equal(A.problem(old, noDoing), 'una de sus columnas ya no existe');
  assert.equal(A.describe(old, noDoing), 'Cuando una tarea se mueve a «columna borrada»: moverla a «columna borrada».');
  assert.equal(A.title(old, noDoing), 'Al mover a «columna borrada»');
  assert.ok(A.describe(old, noDoing).indexOf('doing') === -1 && A.describe(old, noDoing).indexOf('s9x2') === -1);
  /* Si la columna sigue existiendo, una regla antigua recibe su nombre al cargarla (withNames). */
  assert.equal(A.withNames(old, full).trigger.stageName, 'En curso');
  assert.equal(A.withNames(old, full).actions[0].stageName, undefined, 'lo que ya no existe se queda sin nombre');
  /* Una persona sin nombre guardado. */
  assert.equal(A.problem(rule({trigger:{type:'completed'}, cond:{assignee:'seFue'}, actions:[{type:'due', days:1}]}), full), 'la persona asignada ya no está en el proyecto');
  assert.match(A.describe(rule({trigger:{type:'completed'}, actions:[{type:'assign', uid:'seFue'}]}), full), /asignarla a alguien que ya no está\.$/);
  /* Una etiqueta se guarda por su nombre: borrada, se sigue pudiendo leer. */
  const tagged = rule({trigger:{type:'completed'}, cond:{label:'Web'}, actions:[{type:'label', name:'Urgente'}]});
  const noLabels = ctx({labels:[]});
  assert.equal(A.problem(tagged, noLabels), 'la etiqueta «Web» ya no existe');
  assert.match(A.describe(tagged, noLabels), /lleva la etiqueta «Web»: añadir la etiqueta «Urgente»\.$/);
});

test('estado efectivo: la casilla es la intención; en pausa es otra cosa', () => {
  const c = ctx();
  const ok = rule({trigger:{type:'completed'}, actions:[{type:'due', days:1}]});
  const broken = rule({trigger:{type:'moved', stage:'borrada'}, actions:[{type:'complete'}]});
  assert.equal(A.status(ok, A.problem(ok, c)), 'active');
  assert.equal(A.status(broken, A.problem(broken, c)), 'paused');
  assert.equal(broken.on, true, 'sigue activada: lo que cambia es el estado, no la intención');
  assert.equal(A.status(Object.assign({}, ok, {on:false}), ''), 'off');
  assert.equal(A.status(Object.assign({}, broken, {on:false}), A.problem(broken, c)), 'off');
});

test('qué reglas quedarían en pausa al borrar una columna, una etiqueta o quitar a una persona', () => {
  const rules = [
    rule({id:'a', trigger:{type:'moved', stage:'review'}, actions:[{type:'complete'}]}),
    rule({id:'b', trigger:{type:'completed'}, actions:[{type:'move', stage:'review'}, {type:'label', name:'Urgente'}]}),
    rule({id:'c', trigger:{type:'created', stage:'todo'}, cond:{label:'web', assignee:'luis'}, actions:[{type:'assign', uid:'ana'}]}),
    rule({id:'d', name:'Botón', trigger:{type:'button'}, actions:[{type:'subtask', text:'x'}]})
  ];
  const ids = (gone) => A.affected(rules, gone).map((r) => r.id);
  assert.deepEqual(ids({stage:'review'}), ['a', 'b']);
  assert.deepEqual(ids({stage:'todo'}), ['c']);
  assert.deepEqual(ids({stage:'doing'}), []);
  assert.deepEqual(ids({label:'URGENTE'}), ['b'], 'sin distinguir mayúsculas, como al ejecutar');
  assert.deepEqual(ids({label:'Web'}), ['c']);
  assert.deepEqual(ids({member:'luis'}), ['c']);
  assert.deepEqual(ids({member:'ana'}), ['c']);
  assert.deepEqual(ids({member:'none'}), []);
  /* Lo que affected() anuncia es justo lo que problem() dirá después. */
  const c = ctx();
  const without = ctx({stages:c.stages.filter((x) => x.key !== 'review')});
  rules.forEach((r) => assert.equal(!!A.problem(r, without), ids({stage:'review'}).indexOf(r.id) !== -1, r.id));
});

test('límite de profundidad, en el borde: tres reglas seguidas sí, la cuarta no', async () => {
  const c = ctx({stages:['s0', 's1', 's2', 's3', 's4', 's5'].map((k) => ({key:k, label:k}))});
  const hop = (n) => rule({id:'r' + n, trigger:{type:'moved', stage:'s' + n}, actions:[{type:'move', stage:'s' + (n + 1)}]});
  assert.equal(A.MAX_DEPTH, 3);
  /* Justo el máximo: corre entera y no avisa. */
  const exact = world([hop(1), hop(2), hop(3)], [{id:'t', status:'s1'}], c);
  await exact.engine.handle({type:'moved', id:'t', from:'s0', to:'s1'});
  assert.deepEqual(exact.log.map((l) => l.rule), ['r1', 'r2', 'r3']);
  assert.deepEqual(exact.warns, []);
  /* Una más: se corta en la cuarta, con un solo aviso. */
  const over = world([hop(1), hop(2), hop(3), hop(4)], [{id:'t', status:'s1'}], c);
  await over.engine.handle({type:'moved', id:'t', from:'s0', to:'s1'});
  assert.equal(over.log.length, 3);
  assert.deepEqual(over.warns, ['depth']);
  /* Lo mismo cuando la cadena la empieza un botón o una fecha: esa regla cuenta como la primera. */
  const button = (rules) => world([rule({id:'b', name:'Ir', trigger:{type:'button'}, actions:[{type:'move', stage:'s1'}]})].concat(rules), [{id:'t', status:'s0'}], c);
  const two = button([hop(1), hop(2)]);
  await two.engine.press('b', 't');
  assert.deepEqual(two.log.map((l) => l.rule), ['b', 'r1', 'r2']);
  assert.deepEqual(two.warns, []);
  const three = button([hop(1), hop(2), hop(3)]);
  await three.engine.press('b', 't');
  assert.deepEqual(three.log.map((l) => l.rule), ['b', 'r1', 'r2']);
  assert.deepEqual(three.warns, ['depth']);
  assert.equal(three.tasks[0].status, 's3');
});

test('límite de frecuencia, en el borde y con reloj simulado: 60 en un minuto, la 61 no, y al cumplirse el minuto vuelve', async () => {
  assert.equal(A.MAX_PER_MINUTE, 60);
  const tasks = Array.from({length:70}, (x, i) => ({id:'t' + i, status:'todo', labels:[]}));
  const w = world([rule({id:'a', trigger:{type:'created'}, actions:[{type:'label', name:'Web'}]})], tasks);
  const create = (i) => w.engine.handle({type:'created', id:'t' + i, to:'todo'});
  w.clock = 100000;
  for(let i = 0; i < 60; i++) await create(i);
  assert.equal(w.log.length, 60);
  assert.deepEqual(w.warns, [], 'la número 60 entra sin aviso');
  await create(60);
  assert.equal(w.log.length, 60);
  assert.deepEqual(w.warns, ['rate']);
  assert.deepEqual(w.tasks[60].labels, [], 'la que no cabe no se ejecuta a medias');
  /* Un milisegundo antes de cumplirse el minuto, sigue sin cupo. */
  w.clock = 100000 + 59999;
  await create(61);
  assert.equal(w.log.length, 60);
  /* Justo al minuto, las 60 primeras han caducado. */
  w.clock = 100000 + 60000;
  await create(62);
  assert.equal(w.log.length, 61);
  /* El cupo es una ventana deslizante: las de después siguen contando. */
  w.clock = 100000 + 60001;
  for(let i = 0; i < 59; i++) w.engine.budget();
  assert.equal(w.engine.budget(), false);
});

test('botón de tarea: un clic ejecuta sus acciones, encadena y deja su línea', async () => {
  assert.equal(A.normalize({trigger:{type:'button'}, actions:[{type:'complete'}]}), null, 'un botón necesita nombre');
  const w = world([
    rule({id:'b', name:'Enviar a revisión', trigger:{type:'button'}, actions:[{type:'move', stage:'review'}, {type:'subtask', text:'Revisar'}]}),
    rule({id:'m', name:'Plazo', trigger:{type:'moved', stage:'review'}, actions:[{type:'due', days:2}]})
  ], [{id:'t', status:'todo'}]);
  /* Mover la tarea a mano no pulsa el botón. */
  await w.engine.handle({type:'moved', id:'t', from:'doing', to:'todo'});
  assert.equal(w.log.length, 0);
  await w.engine.press('b', 't');
  assert.equal(w.tasks[0].status, 'review');
  assert.equal(w.tasks[0].checklist[0].text, 'Revisar');
  assert.equal(w.tasks[0].dueDate, 'D+2');
  assert.deepEqual(w.log.map((l) => l.rule), ['b', 'm']);
  assert.equal(A.logText(w.rules[0], w.log[0].did), 'Botón «Enviar a revisión»: movió la tarea a «Revisión», añadió la subtarea «Revisar»');
  assert.equal(A.logText(w.rules[1], w.log[1].did), 'Automatización «Plazo»: puso la fecha límite el D+2');
  /* Pulsarlo otra vez no cambia nada; uno desactivado o que no es botón, tampoco. */
  await w.engine.press('b', 't');
  await w.engine.press('m', 't');
  w.rules[0].on = false;
  w.tasks[0].status = 'todo';
  await w.engine.press('b', 't');
  assert.equal(w.log.length, 2);
  assert.equal(w.tasks[0].status, 'todo');
});

test('un botón que choca con otra regla también se corta, y respeta el cupo por minuto', async () => {
  const w = world([
    rule({id:'b', name:'Ida', trigger:{type:'button'}, actions:[{type:'move', stage:'review'}]}),
    rule({id:'v', name:'Vuelta', trigger:{type:'moved', stage:'review'}, actions:[{type:'move', stage:'doing'}]}),
    rule({id:'o', name:'Otra', trigger:{type:'moved', stage:'doing'}, actions:[{type:'move', stage:'review'}]})
  ], [{id:'t', status:'todo'}]);
  await w.engine.press('b', 't');
  assert.deepEqual(w.log.map((l) => l.rule), ['b', 'v', 'o']);
  assert.deepEqual(w.warns, ['loop']);
  const many = world([rule({id:'b', name:'Etiqueta', trigger:{type:'button'}, actions:[{type:'label', name:'Web'}]})],
    Array.from({length:100}, (x, i) => ({id:'t' + i, status:'todo', labels:[]})));
  await Promise.all(many.tasks.map((t) => many.engine.press('b', t.id)));
  assert.equal(many.log.length, A.MAX_PER_MINUTE);
  assert.ok(many.warns.every((x) => x === 'rate') && many.warns.length === 100 - A.MAX_PER_MINUTE);
});

test('las reglas por fecha respetan lo que el motor no debe tocar (skip) y gastan un cupo por ejecución', async () => {
  const w = world([rule({id:'d', trigger:{type:'due', days:5}, actions:[{type:'complete'}]})],
    Array.from({length:80}, (x, i) => ({id:'t' + i, status:'todo', dueDate:'D+1', repeat:i === 0 ? 'weekly' : ''})));
  w.engine.io.skip = (r, task) => !!task.repeat;
  const fired = {};
  await w.engine.checkDue(w.tasks, fired);
  assert.equal(w.tasks[0].status, 'todo', 'la que se repite se deja para el navegador');
  assert.equal(fired['d:t0'], undefined);
  assert.equal(w.log.length, A.MAX_PER_MINUTE, 'un cupo por ejecución, no dos');
  assert.equal(Object.keys(fired).length, A.MAX_PER_MINUTE);
});

(async () => {
  for(const [name, fn] of tests){
    await fn();
    console.log('ok   ' + name);
  }
  console.log('\n' + tests.length + ' pruebas correctas');
})().catch((err) => { console.error(err); process.exit(1); });
