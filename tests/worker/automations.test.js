/* Automatizaciones por fecha en el servidor (worker/automations.mjs): el proceso que el cron del
   Worker lanza con Kanlane cerrado. Aquí la base de datos es un objeto en memoria; la capa REST se
   prueba contra el emulador en tests/e2e/automation-cron.js. Uso: node tests/worker/automations.test.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {pathToFileURL} = require('node:url');

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);   /* 6 de octubre de 2026, 09:00 UTC */

const stages = [{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'review', label:'Revisión'}, {key:'done', label:'Hecho', done:true}];
const ctx = {stages, labels:['Urgente'], members:[{uid:'ana', name:'Ana'}], team:false};
const dueRule = (extra) => Object.assign({id:'d', name:'Vence pronto', on:true, trigger:{type:'due', days:2}, cond:{}, actions:[{type:'label', name:'Urgente'}]}, extra);
const job = (extra) => Object.assign({v:1, kind:'u', uid:'ana', pid:'main', tz:'Europe/Madrid', ctx, rules:[dueRule()], updatedAt:1}, extra);

/* Base de datos en memoria con la misma forma que restStore. */
function fakeStore(tasks, state){
  const s = {tasks, state:state || null, commits:[], queries:[]};
  s.tasksDue = async (root, maxDate) => { s.queries.push({root, maxDate}); return tasks.filter((t) => t.data.dueDate && t.data.dueDate <= maxDate); };
  s.get = async (p) => (/automations\.state$/.test(p) ? s.state : null);
  s.commit = async (writes) => {
    s.commits.push(writes);
    writes.forEach((w) => {
      const task = /\/tasks\/([^/]+)$/.exec(w.path);
      if(task && w.patch) Object.assign(tasks.find((t) => t.id === task[1]).data, w.patch);
      if(/automations\.state$/.test(w.path)) s.state = Object.assign({}, s.state, w.set || w.patch);
    });
  };
  return s;
}
const notesOf = (s) => s.commits.flat().filter((w) => w.create).map((w) => [w.path.split('/tasks/')[1].split('/')[0], w.create.text]);

(async () => {
  const M = await import(pathToFileURL(path.join(__dirname, '../../worker/automations.mjs')).href);
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('ok   ' + name); };

  await test('fechas: el día de hoy va en la zona horaria del dueño', async () => {
    const late = Date.UTC(2026, 9, 6, 23, 30, 0);
    assert.equal(M.todayIn('Europe/Madrid', late), '2026-10-07');
    assert.equal(M.todayIn('America/Los_Angeles', late), '2026-10-06');
    assert.equal(M.todayIn('No/Existe', late), '2026-10-06', 'una zona que no vale cae en UTC');
    assert.equal(M.addDays('2026-10-30', 3), '2026-11-02');
    assert.equal(M.daysBetween('2026-10-06', '2026-10-04'), -2);
  });

  await test('los valores van y vuelven en el formato de la API REST', async () => {
    const doc = {title:'Tarea', order:1791312000123, ratio:0.5, done:false, labels:['a', 'b'], checklist:[{id:'c1', text:'Paso', done:true}], nada:null};
    assert.deepEqual(M.decodeFields(M.encodeFields(doc)), doc);
    assert.deepEqual(M.encode(7), {integerValue:'7'});
  });

  await test('de qué proyecto es un trabajo lo dice su identificador, y los campos tienen que coincidir', async () => {
    assert.equal(M.rootOf('u~ana~main', {kind:'u', uid:'ana', pid:'main'}), 'users/ana');
    assert.equal(M.rootOf('u~ana~p1', {kind:'u', uid:'ana', pid:'p1'}), 'users/ana/projects/p1');
    assert.equal(M.rootOf('t~equipo1', {kind:'t', uid:'ana', tid:'equipo1'}), 'teams/equipo1');
    assert.equal(M.rootOf('u~ana~main', {kind:'u', uid:'otra', pid:'main'}), null);
    assert.equal(M.rootOf('u~ana~main', {kind:'t', tid:'equipo1'}), null);
    assert.equal(M.rootOf('t~equipo1', {kind:'t', tid:'otro'}), null);
    assert.equal(M.rootOf('u~ana~../otra', {kind:'u', uid:'ana', pid:'../otra'}), null);
    assert.equal(M.rootOf('x~ana', {kind:'u'}), null);
  });

  await test('el token de la cuenta de servicio va firmado con su clave', async () => {
    const pair = nodeCrypto.generateKeyPairSync('rsa', {modulusLength:2048});
    const jwt = await M.serviceJwt({client_email:'cron@proyecto.iam.gserviceaccount.com', private_key:pair.privateKey.export({type:'pkcs8', format:'pem'})}, NOW);
    const [head, body, sig] = jwt.split('.');
    assert.equal(nodeCrypto.verify('RSA-SHA256', Buffer.from(head + '.' + body), pair.publicKey, Buffer.from(sig, 'base64url')), true);
    const claims = JSON.parse(Buffer.from(body, 'base64url'));
    assert.equal(claims.iss, 'cron@proyecto.iam.gserviceaccount.com');
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/datastore');
    assert.equal(claims.exp - claims.iat, 3600);
  });

  await test('sin el secreto de la cuenta de servicio, el cron no hace nada', async () => {
    let calls = 0;
    const out = await M.run({}, {fetch:async () => { calls++; return {ok:false, status:500}; }, now:() => NOW});
    assert.deepEqual(out, {configured:false, jobs:0, ran:0});
    assert.equal(calls, 0);
  });

  await test('regla por fecha con la app cerrada: cambia la tarea, deja su línea y no se repite', async () => {
    const s = fakeStore([
      {id:'cerca', data:{title:'A', status:'todo', dueDate:'2026-10-08', labels:[]}},
      {id:'vencida', data:{title:'B', status:'doing', dueDate:'2026-10-01', labels:['Urgente']}},
      {id:'lejos', data:{title:'C', status:'todo', dueDate:'2026-10-20', labels:[]}},
      {id:'hecha', data:{title:'D', status:'done', dueDate:'2026-10-07', labels:[]}}
    ]);
    const res = await M.runJob('u~ana~main', job(), s, NOW);
    assert.deepEqual(res, {status:'ok', ran:1, warns:[]});
    assert.deepEqual(s.queries, [{root:'users/ana', maxDate:'2026-10-08'}]);
    assert.deepEqual(s.tasks[0].data.labels, ['Urgente']);
    assert.equal(s.tasks[0].data.updatedAt, NOW);
    assert.deepEqual(notesOf(s), [['cerca', 'Automatización «Vence pronto»: añadió la etiqueta «Urgente»']]);
    assert.equal(s.commits.length, 1, 'todo en una sola escritura');
    const patch = s.commits[0].find((w) => w.path === 'users/ana/tasks/cerca');
    assert.deepEqual(Object.keys(patch.patch).sort(), ['labels', 'updatedAt'], 'solo se escriben los campos que cambian');
    /* La que ya llevaba la etiqueta queda marcada, sin línea. */
    assert.deepEqual(JSON.parse(s.state.values.fired), {'d:cerca':'2026-10-08', 'd:vencida':'2026-10-01'});
    /* Siguiente vuelta: nada nuevo, aunque alguien quite la etiqueta a mano. */
    s.tasks[0].data.labels = [];
    assert.deepEqual(await M.runJob('u~ana~main', job(), s, NOW + 1800000), {status:'idle', ran:0, warns:[]});
    assert.equal(s.commits.length, 1);
    assert.deepEqual(s.tasks[0].data.labels, []);
  });

  await test('respeta las marcas que dejó un navegador y las de otras reglas', async () => {
    const s = fakeStore([{id:'t', data:{status:'todo', dueDate:'2026-10-07', labels:[]}}], {values:{fired:JSON.stringify({'d:t':'2026-10-07', 'otra:x':'2026-01-01'})}, updatedAt:5});
    assert.equal((await M.runJob('u~ana~main', job(), s, NOW)).status, 'idle');
    /* Cambia la fecha: vuelve a contar, y las marcas ajenas siguen ahí. */
    s.tasks[0].data.dueDate = '2026-10-08';
    assert.equal((await M.runJob('u~ana~main', job(), s, NOW)).ran, 1);
    assert.deepEqual(JSON.parse(s.state.values.fired), {'d:t':'2026-10-08', 'otra:x':'2026-01-01'});
    const mark = s.commits[0].find((w) => /state$/.test(w.path));
    assert.deepEqual(mark.mask, ['values.fired', 'updatedAt'], 'no pisa otras claves del documento');
  });

  await test('corte de bucle en el servidor: la regla por fecha mueve, otra devuelve y la tercera se para', async () => {
    const rules = [
      dueRule({name:'A revisión', actions:[{type:'move', stage:'review'}]}),
      {id:'v', name:'Vuelta', on:true, trigger:{type:'moved', stage:'review'}, cond:{}, actions:[{type:'move', stage:'doing'}]},
      {id:'o', name:'Otra', on:true, trigger:{type:'moved', stage:'doing'}, cond:{}, actions:[{type:'move', stage:'review'}]}
    ];
    const s = fakeStore([{id:'t', data:{status:'todo', dueDate:'2026-10-07'}}]);
    const res = await M.runJob('u~ana~main', job({rules}), s, NOW);
    assert.equal(res.status, 'ok');
    assert.ok(res.warns.indexOf('loop') !== -1, 'avisa del bucle: ' + res.warns);
    assert.deepEqual(notesOf(s).map((n) => n[1].split('»')[0]), ['Automatización «A revisión', 'Automatización «Vuelta', 'Automatización «Otra']);
    assert.equal(s.tasks[0].data.status, 'review');
    assert.equal(s.tasks[0].data.order, NOW, 'al final de su columna');
  });

  await test('tope de ejecuciones en el servidor: 60 por proyecto y vuelta; el resto, a la siguiente', async () => {
    const tasks = Array.from({length:150}, (x, i) => ({id:'t' + i, data:{status:'todo', dueDate:'2026-10-07', labels:[]}}));
    const s = fakeStore(tasks);
    const first = await M.runJob('u~ana~main', job(), s, NOW);
    assert.equal(first.ran, 60);
    assert.deepEqual(first.warns, ['rate']);
    assert.equal(tasks.filter((t) => t.data.labels.length).length, 60);
    const second = await M.runJob('u~ana~main', job(), s, NOW + 1800000);
    assert.equal(second.ran, 60);
    await M.runJob('u~ana~main', job(), s, NOW + 3600000);
    assert.equal(tasks.filter((t) => t.data.labels.length).length, 150);
  });

  await test('proyecto con cifrado total: no se lee ni se escribe nada, y la copia se borra', async () => {
    const s = fakeStore([{id:'t', data:{status:'todo', dueDate:'2026-10-07', ev:1, kid:'k', e:'AAAA'}}]);
    const res = await M.runJob('u~ana~main', job(), s, NOW);
    assert.equal(res.status, 'encrypted');
    assert.deepEqual(s.commits, [[{path:'automation_jobs/u~ana~main', remove:true}]]);
    assert.equal(s.tasks[0].data.labels, undefined);
    /* Lo mismo si lo sellado son las marcas. */
    const sealedState = fakeStore([{id:'t', data:{status:'todo', dueDate:'2026-10-07'}}], {ev:1, kid:'k', e:'AAAA'});
    assert.equal((await M.runJob('u~ana~main', job(), sealedState, NOW)).status, 'encrypted');
  });

  await test('lo que el servidor no ejecuta', async () => {
    const one = () => fakeStore([{id:'t', data:{status:'todo', dueDate:'2026-10-07', labels:[], repeat:'weekly'}}]);
    /* Un trabajo que no es de quien dice, o de otra versión. */
    assert.equal((await M.runJob('u~otra~main', job(), one(), NOW)).status, 'bad-job');
    assert.equal((await M.runJob('u~ana~main', job({v:2}), one(), NOW)).status, 'bad-job');
    /* Sin reglas por fecha activas, o con una que apunta a una columna que ya no existe: ni consulta. */
    const idle = one();
    assert.equal((await M.runJob('u~ana~main', job({rules:[dueRule({on:false})]}), idle, NOW)).status, 'no-rules');
    assert.equal((await M.runJob('u~ana~main', job({rules:[dueRule({actions:[{type:'move', stage:'borrada'}]})]}), idle, NOW)).status, 'no-rules');
    assert.equal(idle.queries.length, 0);
    /* Completar una tarea que se repite: se deja para la app (crear la siguiente es cosa suya). */
    const rep = one();
    assert.equal((await M.runJob('u~ana~main', job({rules:[dueRule({actions:[{type:'complete'}]})]}), rep, NOW)).status, 'idle');
    assert.equal(rep.tasks[0].data.status, 'todo');
    /* Pero etiquetarla sí. */
    assert.equal((await M.runJob('u~ana~main', job(), one(), NOW)).ran, 1);
    /* Los botones y «al crear» nunca corren aquí, aunque vengan en la copia. */
    const extra = fakeStore([{id:'t', data:{status:'todo', dueDate:'2026-10-07', labels:[]}}]);
    await M.runJob('u~ana~main', job({rules:[dueRule(), {id:'b', name:'Botón', on:true, trigger:{type:'button'}, cond:{}, actions:[{type:'complete'}]}]}), extra, NOW);
    assert.equal(extra.tasks[0].data.status, 'todo');
  });

  await test('un equipo: asigna a quien dice la regla y escribe en el equipo', async () => {
    const team = {stages, labels:[], members:[{uid:'luis', name:'Luis'}], team:true};
    const s = fakeStore([{id:'t', data:{status:'todo', dueDate:'2026-10-06', assignees:[]}}]);
    const res = await M.runJob('t~eq1', job({kind:'t', pid:undefined, tid:'eq1', ctx:team, rules:[dueRule({trigger:{type:'due', days:0}, cond:{assignee:'none'}, actions:[{type:'assign', uid:'luis'}]})]}), s, NOW);
    assert.equal(res.ran, 1);
    assert.deepEqual(s.queries[0], {root:'teams/eq1', maxDate:'2026-10-06'});
    assert.deepEqual(s.tasks[0].data.assignees, ['luis']);
    assert.deepEqual(notesOf(s), [['t', 'Automatización «Vence pronto»: asignó la tarea a Luis']]);
  });

  console.log('\n' + passed + ' pruebas correctas');
})().catch((err) => { console.error(err); process.exit(1); });
