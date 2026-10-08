/* Servidor MCP (worker/mcp.mjs): tokens, permisos y herramientas, con una base de datos en memoria;
   y lo que la ruta /__/mcp/v1 de worker/index.js rechaza antes de llegar a él.
   Uso: node tests/worker/mcp.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {memoryStore} = require('./mail-fixtures.js');

const NOW = Date.UTC(2026, 9, 7, 9, 0, 0);
const ENV = {MCP_SECRET: nodeCrypto.randomBytes(32).toString('base64')};
const STAGES = [{key: 'todo', label: 'Por hacer'}, {key: 'doing', label: 'En curso'}, {key: 'done', label: 'Hecho', done: true}];

(async () => {
  const M = await import(pathToFileURL(path.join(__dirname, '../../worker/mcp.mjs')).href);
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('ok   ' + name); };

  function world() {
    const w = {store: memoryStore(), clock: NOW, n: 0};
    w.deps = {store: w.store, now: () => w.clock};
    w.manage = (who, body, env) => M.manage(who, body, env || ENV, w.deps);
    w.rpc = (token, method, params, id) => M.rpc(token, Object.assign({jsonrpc: '2.0', method: method}, id === null ? {} : {id: id === undefined ? ++w.n : id}, params ? {params: params} : {}), ENV, w.deps);
    /* Llama a una herramienta y devuelve lo que contesta: {error} o el JSON de su texto. */
    w.call = async (token, name, args) => {
      const out = await w.rpc(token, 'tools/call', {name: name, arguments: args || {}});
      assert.equal(out.status, 200, JSON.stringify(out.body));
      const res = out.body.result;
      return res.isError ? {error: res.content[0].text} : JSON.parse(res.content[0].text);
    };
    w.tasks = (root) => w.store.paths(root + '/tasks/').filter((p) => p.split('/tasks/')[1].indexOf('/') === -1).map((p) => Object.assign({id: p.split('/tasks/')[1]}, w.store.data(p)));
    w.notes = (taskPath) => w.store.paths(taskPath + '/notes/').map((p) => w.store.data(p)).sort((a, b) => a.createdAt - b.createdAt);
    return w;
  }
  const ana = {uid: 'ana'}, bob = {uid: 'bob'}, carol = {uid: 'carol'}, dave = {uid: 'dave'};
  const ROOT = 'users/ana/projects/p1';
  const task = (over) => Object.assign({title: 'Tarea', desc: '', status: 'todo', cliente: '', contacto: '', dueDate: '', labels: [], checklist: [], order: 1, createdAt: 1, updatedAt: 1}, over);
  /* Proyecto personal de Ana con tres tareas y un token. */
  async function personal(w, opts) {
    w.store.put(ROOT, {nombre: 'Personal', tipo: 'personalizado', stages: STAGES});
    w.store.put(ROOT + '/tasks/a', task({title: 'Pendiente', order: 10}));
    w.store.put(ROOT + '/tasks/b', task({title: 'En marcha', status: 'doing', order: 20, labels: ['web'], cliente: 'Acme'}));
    w.store.put(ROOT + '/tasks/c', task({title: 'Terminada', status: 'done', order: 30}));
    const out = await w.manage(ana, Object.assign({op: 'create', pid: 'p1', name: 'Portátil'}, opts));
    assert.equal(out.status, 200, JSON.stringify(out.body));
    return out.body.token;
  }
  const TEAM = 'teams/t1';
  function team(w, over) {
    w.store.put(TEAM, Object.assign({nombre: 'Equipo', ownerUid: 'ana', memberIds: ['ana', 'bob', 'carol'], tipo: 'personalizado', stages: STAGES,
      members: {ana: {role: 'owner', name: 'Ana'}, bob: {role: 'editor', name: 'Bob'}, carol: {role: 'viewer', name: 'Carol'}}}, over));
    w.store.put(TEAM + '/tasks/a', task({title: 'Del equipo'}));
  }

  await test('sin el secreto o sin base de datos no hay MCP', async () => {
    const w = world();
    assert.equal((await w.manage(ana, {op: 'list', pid: 'main'}, {})).status, 503);
    assert.equal((await w.manage(ana, {op: 'list', pid: 'main'}, {MCP_SECRET: 'corto'})).status, 503);
    assert.equal((await M.manage(ana, {op: 'list', pid: 'main'}, ENV, {now: () => NOW})).status, 503, 'sin cuenta de servicio');
    assert.equal((await M.rpc('kl_' + 'a'.repeat(32), {jsonrpc: '2.0', id: 1, method: 'ping'}, {}, w.deps)).status, 503);
  });

  await test('crear: el token se enseña una vez y en la base de datos solo queda su hash', async () => {
    const w = world();
    const token = await personal(w);
    assert.match(token, /^kl_[a-z2-7]{32}$/);
    const all = JSON.stringify(Array.from(w.store.docs.entries()));
    assert.ok(all.indexOf(token) === -1 && all.indexOf(token.slice(3)) === -1 && all.indexOf(token.slice(19)) === -1, 'ni el token ni su mitad secreta están guardados');
    const listed = await w.manage(ana, {op: 'list', pid: 'p1'});
    assert.equal(listed.body.token, undefined, 'listar no lo devuelve');
    assert.deepEqual(listed.body.tokens.map((t) => [t.name, t.readOnly, t.mine, t.usedAt]), [['Portátil', false, true, 0]]);
    assert.equal(listed.body.tokens[0].id, token.slice(3, 19));
    assert.equal((await w.manage(ana, {op: 'create', pid: 'p1', name: '   '})).status, 400, 'sin nombre');
    assert.equal((await w.manage(ana, {op: 'create', pid: '../x', name: 'x'})).status, 400);
    assert.equal((await w.manage(bob, {op: 'list', pid: 'p1'})).status, 404, 'el proyecto personal de otra persona no existe para Bob');
    for (let i = 1; i < M.LIMITS.tokens; i++) assert.equal((await w.manage(ana, {op: 'create', pid: 'p1', name: 'n' + i})).status, 200);
    assert.deepEqual((await w.manage(ana, {op: 'create', pid: 'p1', name: 'uno más'})).body, {error: 'limit'});
  });

  await test('un token inventado se rechaza sin leer la base de datos; uno revocado deja de valer', async () => {
    const w = world();
    const token = await personal(w);
    const reads = w.store.reads;
    for (const bad of ['kl_' + 'a'.repeat(32), token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a'), token.slice(3), 'kl_corto', '', null]) {
      assert.equal((await w.rpc(bad, 'ping')).status, 401, String(bad));
    }
    assert.equal(w.store.reads, reads, 'ninguna lectura');
    assert.equal((await w.rpc(token, 'ping')).status, 200);
    const out = await w.manage(ana, {op: 'revoke', pid: 'p1', id: token.slice(3, 19)});
    assert.deepEqual([out.status, out.body.tokens.length], [200, 0]);
    assert.equal((await w.rpc(token, 'ping')).status, 401);
    assert.equal((await w.manage(ana, {op: 'revoke', pid: 'p1', id: token.slice(3, 19)})).status, 404, 'ya no existe');
  });

  await test('protocolo: initialize, tools/list, ping, notificaciones y mensajes no válidos', async () => {
    const w = world();
    const token = await personal(w);
    const init = await w.rpc(token, 'initialize', {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'prueba', version: '1'}}, 'abc');
    assert.deepEqual([init.status, init.body.id, init.body.result.protocolVersion, init.body.result.serverInfo.name], [200, 'abc', '2025-03-26', 'kanlane']);
    assert.deepEqual(init.body.result.capabilities, {tools: {}});
    assert.equal((await w.rpc(token, 'initialize', {protocolVersion: '1999-01-01'})).body.result.protocolVersion, '2025-06-18', 'una versión desconocida: la más reciente');
    const tools = (await w.rpc(token, 'tools/list')).body.result.tools;
    assert.deepEqual(tools.map((t) => t.name), ['list_tasks', 'get_task', 'move_task', 'add_note', 'create_task']);
    assert.ok(tools.every((t) => t.inputSchema.type === 'object' && t.description && t.write === undefined));
    assert.deepEqual(await w.rpc(token, 'notifications/initialized', null, null), {status: 202, body: null});
    assert.equal((await w.rpc(token, 'resources/list')).body.error.code, -32601);
    assert.equal((await w.rpc(token, 'tools/call', {name: 'borrar_todo'})).body.error.code, -32602);
    for (const bad of [[{jsonrpc: '2.0', id: 1, method: 'ping'}], {id: 1, method: 'ping'}, {jsonrpc: '2.0', id: 1}, 'ping', null]) {
      const out = await M.rpc(token, bad, ENV, w.deps);
      assert.deepEqual([out.status, out.body.error.code], [400, -32600], JSON.stringify(bad));
    }
  });

  await test('list_tasks: por defecto las abiertas; por columna (clave o nombre); límite', async () => {
    const w = world();
    const token = await personal(w);
    const open = await w.call(token, 'list_tasks');
    assert.equal(open.project, 'Personal');
    assert.deepEqual(open.columns, [{key: 'todo', label: 'Por hacer', done: false}, {key: 'doing', label: 'En curso', done: false}, {key: 'done', label: 'Hecho', done: true}]);
    assert.deepEqual(open.tasks.map((t) => [t.id, t.title, t.column, t.column_key, t.done]), [['a', 'Pendiente', 'Por hacer', 'todo', false], ['b', 'En marcha', 'En curso', 'doing', false]]);
    assert.deepEqual([open.tasks[1].labels, open.tasks[1].client, open.truncated], [['web'], 'Acme', false]);
    assert.deepEqual((await w.call(token, 'list_tasks', {include_done: true})).tasks.map((t) => t.id), ['a', 'b', 'c']);
    assert.deepEqual((await w.call(token, 'list_tasks', {column: 'en curso'})).tasks.map((t) => t.id), ['b'], 'por nombre, sin distinguir mayúsculas');
    assert.deepEqual((await w.call(token, 'list_tasks', {column: 'done'})).tasks.map((t) => t.id), ['c'], 'por clave, también una columna de hechas');
    assert.match((await w.call(token, 'list_tasks', {column: 'Archivo'})).error, /Unknown column "Archivo".*Por hacer \(todo\)/);
    /* Una tarea con un estado que ya no existe cae en la primera columna, como en la app. */
    w.store.put(ROOT + '/tasks/z', task({title: 'Huérfana', status: 'borrada', order: 5}));
    assert.deepEqual((await w.call(token, 'list_tasks', {column: 'Por hacer'})).tasks.map((t) => [t.id, t.column_key]), [['z', 'todo'], ['a', 'todo']]);
    const one = await w.call(token, 'list_tasks', {limit: 1});
    assert.deepEqual([one.tasks.length, one.truncated], [1, true]);
  });

  await test('lo archivado en la app (una tarea o una columna entera) no se lista ni se mueve', async () => {
    const w = world();
    const token = await personal(w);
    w.store.put(ROOT + '/tasks/x', task({title: 'Archivada', order: 15, archivedAt: NOW - 1000}));
    assert.deepEqual((await w.call(token, 'list_tasks', {include_done: true})).tasks.map((t) => t.id), ['a', 'b', 'c']);
    assert.deepEqual((await w.call(token, 'list_tasks', {column: 'todo'})).tasks.map((t) => t.id), ['a']);
    assert.equal((await w.call(token, 'get_task', {id: 'x'})).archived, true, 'leerla sí, y dice que está archivada');
    assert.equal((await w.call(token, 'get_task', {id: 'a'})).archived, undefined);
    assert.match((await w.call(token, 'move_task', {id: 'x', column: 'done'})).error, /archived/);
    assert.equal(w.store.data(ROOT + '/tasks/x').status, 'todo', 'no se ha movido');
    /* La columna «En curso» archivada: deja de ser una columna y sus tareas no caen en la primera. */
    w.store.put(ROOT, {nombre: 'Personal', tipo: 'personalizado', stages: [STAGES[0], Object.assign({archived: true}, STAGES[1]), STAGES[2]]});
    const open = await w.call(token, 'list_tasks', {include_done: true});
    assert.deepEqual(open.columns.map((c) => c.key), ['todo', 'done']);
    assert.deepEqual(open.tasks.map((t) => t.id), ['a', 'c']);
    assert.match((await w.call(token, 'list_tasks', {column: 'En curso'})).error, /Unknown column/);
    assert.match((await w.call(token, 'move_task', {id: 'b', column: 'done'})).error, /archived/);
    assert.match((await w.call(token, 'move_task', {id: 'a', column: 'doing'})).error, /Unknown column/, 'tampoco se mueve nada a una columna archivada');
  });

  await test('get_task: la tarea entera con sus notas, de la más antigua a la más reciente', async () => {
    const w = world();
    const token = await personal(w);
    w.store.put(ROOT + '/tasks/a', task({title: 'Pendiente', desc: 'Con **detalle**', dueDate: '2026-10-20', dueTime: '10:30', checklist: [{id: 'x', text: 'Uno', done: true}, {id: 'y', text: 'Dos', done: false}]}));
    w.store.put(ROOT + '/tasks/a/notes/n2', {text: 'Segunda', createdAt: 200, kind: 'comment', actorName: 'Ana'});
    w.store.put(ROOT + '/tasks/a/notes/n1', {text: 'Primera', createdAt: 100, kind: 'activity'});
    w.store.put(ROOT + '/tasks/a/notes/n3', {text: '', createdAt: 300, kind: 'note', attachments: [{name: 'plano.pdf', parts: ['p']}]});
    const t = await w.call(token, 'get_task', {id: 'a'});
    assert.deepEqual([t.title, t.description, t.due_date, t.due_time, t.column], ['Pendiente', 'Con **detalle**', '2026-10-20', '10:30', 'Por hacer']);
    assert.deepEqual([t.checklist, t.checklist_items], [{done: 1, total: 2}, [{text: 'Uno', done: true}, {text: 'Dos', done: false}]]);
    assert.deepEqual(t.notes.map((n) => [n.kind, n.text, n.author, n.attachments]), [['activity', 'Primera', undefined, undefined], ['note', 'Segunda', 'Ana', undefined], ['note', '', undefined, ['plano.pdf']]]);
    assert.equal((await w.call(token, 'get_task', {id: 'no-existe'})).error, 'Task not found.');
    assert.equal((await w.call(token, 'get_task', {id: '../../otro'})).error, 'Invalid task id.');
  });

  await test('move_task: cambia la columna, va al final y lo apunta en la actividad', async () => {
    const w = world();
    const token = await personal(w);
    const out = await w.call(token, 'move_task', {id: 'a', column: 'En curso'});
    assert.deepEqual([out.moved, out.from, out.task.column_key], [true, 'Por hacer', 'doing']);
    assert.deepEqual([w.store.data(ROOT + '/tasks/a').status, w.store.data(ROOT + '/tasks/a').order, w.store.data(ROOT + '/tasks/a').updatedAt, w.store.data(ROOT + '/tasks/a').title], ['doing', NOW, NOW, 'Pendiente']);
    assert.deepEqual(w.notes(ROOT + '/tasks/a').map((n) => [n.kind, n.text]), [['activity', 'Movida de «Por hacer» a «En curso» por MCP (token «Portátil»).']]);
    const again = await w.call(token, 'move_task', {id: 'a', column: 'doing'});
    assert.deepEqual([again.moved, w.notes(ROOT + '/tasks/a').length], [false, 1], 'ya estaba: ni escritura ni actividad');
    assert.match((await w.call(token, 'move_task', {id: 'a', column: 'Nada'})).error, /Unknown column/);
    assert.equal((await w.call(token, 'move_task', {id: 'nope', column: 'done'})).error, 'Task not found.');
    assert.equal(w.tasks(ROOT).length, 3, 'una tarea sin repetición no crea otra al completarse');
  });

  await test('move_task: si la tarea cambia mientras tanto, no la pisa', async () => {
    const w = world();
    const token = await personal(w);
    const commit = w.store.commit;
    w.store.commit = async (writes) => {
      /* Alguien la edita en la app justo antes de que entre la escritura. */
      if (writes.some((x) => x.path === ROOT + '/tasks/a' && x.updateTime)) w.store.put(ROOT + '/tasks/a', task({title: 'Editada en la app', status: 'doing'}));
      return commit(writes);
    };
    assert.match((await w.call(token, 'move_task', {id: 'a', column: 'done'})).error, /changed or was deleted/);
    assert.deepEqual([w.store.data(ROOT + '/tasks/a').title, w.store.data(ROOT + '/tasks/a').status, w.notes(ROOT + '/tasks/a').length], ['Editada en la app', 'doing', 0]);
  });

  await test('move_task: completar una tarea que se repite crea la siguiente, una sola vez', async () => {
    const w = world();
    const token = await personal(w);
    w.store.put(ROOT + '/tasks/r', task({title: 'Informe', repeat: 'weekly', dueDate: '2026-10-05', startDate: '2026-10-03', dueTime: '09:00', labels: ['mes'],
      checklist: [{id: 'x', text: 'Paso', done: true}], custom: {f1: 3}, assignees: ['ana']}));
    const out = await w.call(token, 'move_task', {id: 'r', column: 'Hecho'});
    assert.equal(out.next_occurrence, '2026-10-12', 'la siguiente que no está en el pasado (hoy es 7 de octubre)');
    assert.equal(w.store.data(ROOT + '/tasks/r').repeatSpawned, true);
    const next = w.tasks(ROOT).find((t) => t.title === 'Informe' && t.id !== 'r');
    assert.deepEqual([next.status, next.dueDate, next.startDate, next.dueTime, next.repeat, next.labels, next.checklist, next.custom, next.assignees, next.repeatSpawned],
      ['todo', '2026-10-12', '2026-10-10', '09:00', 'weekly', ['mes'], [{id: 'x', text: 'Paso', done: false}], {f1: 3}, ['ana'], undefined]);
    await w.call(token, 'move_task', {id: 'r', column: 'todo'});
    await w.call(token, 'move_task', {id: 'r', column: 'Hecho'});
    assert.equal(w.tasks(ROOT).filter((t) => t.title === 'Informe').length, 2, 'volver a completarla no crea otra');
    assert.deepEqual([M.nextDue('2026-01-31', 'monthly', '2026-02-01'), M.nextDue('2024-02-29', 'yearly', '2024-03-01'), M.nextDue('2026-10-05', 'daily', '2026-10-07'), M.nextDue('2026-10-05', 'nunca', '2026-10-07'), M.nextDue('', 'daily', '2026-10-07')],
      ['2026-02-28', '2025-02-28', '2026-10-07', '', '']);
  });

  await test('add_note y create_task', async () => {
    const w = world();
    const token = await personal(w);
    assert.deepEqual(await w.call(token, 'add_note', {id: 'a', text: '  Hecho el **cambio**.\r\nQueda probar.‮  '}), {added: true, task_id: 'a'});
    assert.deepEqual(w.notes(ROOT + '/tasks/a').map((n) => [n.kind, n.text, n.actorUid, n.actorName]), [['note', 'Hecho el **cambio**.\nQueda probar.', '', 'MCP']]);
    assert.equal((await w.call(token, 'add_note', {id: 'a', text: '   '})).error, 'The note is empty.');
    assert.equal((await w.call(token, 'add_note', {id: 'nope', text: 'x'})).error, 'Task not found.');

    const made = await w.call(token, 'create_task', {title: ' Nueva\ntarea ', description: 'Detalle', column: 'En curso', due_date: '2026-11-02', labels: ['a', 'a', ' b ', 7]});
    assert.deepEqual([made.created, made.task.title, made.task.column_key, made.task.due_date, made.task.labels], [true, 'Nueva tarea', 'doing', '2026-11-02', ['a', 'b', '7']]);
    const saved = w.store.data(ROOT + '/tasks/' + made.task.id);
    assert.deepEqual([saved.desc, saved.cliente, saved.checklist, saved.order, saved.createdAt], ['Detalle', '', [], NOW, NOW]);
    assert.deepEqual(w.notes(ROOT + '/tasks/' + made.task.id).map((n) => [n.kind, n.text]), [['activity', 'Creada por MCP (token «Portátil»).']]);
    assert.equal((await w.call(token, 'create_task', {title: 'Por defecto'})).task.column_key, 'todo', 'sin columna: la primera');
    assert.equal((await w.call(token, 'create_task', {title: ''})).error, 'The title is empty.');
    assert.match((await w.call(token, 'create_task', {title: 'x', due_date: '2026-02-31'})).error, /Invalid due_date/);
    assert.match((await w.call(token, 'create_task', {title: 'x', column: 'Nada'})).error, /Unknown column/);
    assert.match((await w.call(token, 'create_task', {title: 'x', labels: 'una'})).error, /Invalid labels/);
  });

  await test('un token de solo lectura no ve ni usa las herramientas que escriben', async () => {
    const w = world();
    const token = await personal(w, {readOnly: true});
    assert.equal((await w.manage(ana, {op: 'list', pid: 'p1'})).body.tokens[0].readOnly, true);
    assert.deepEqual((await w.rpc(token, 'tools/list')).body.result.tools.map((t) => t.name), ['list_tasks', 'get_task']);
    assert.match((await w.rpc(token, 'initialize', {})).body.result.instructions, /read-only/);
    assert.equal((await w.call(token, 'list_tasks')).tasks.length, 2);
    for (const [name, args] of [['move_task', {id: 'a', column: 'done'}], ['add_note', {id: 'a', text: 'x'}], ['create_task', {title: 'x'}]]) {
      assert.equal((await w.call(token, name, args)).error, 'This token is read-only.');
    }
    assert.deepEqual([w.store.data(ROOT + '/tasks/a').status, w.tasks(ROOT).length, w.notes(ROOT + '/tasks/a').length], ['todo', 3, 0]);
  });

  await test('equipo: cada token vale lo que el papel actual de quien lo creó', async () => {
    const w = world();
    team(w);
    const make = async (who, name) => (await w.manage(who, {op: 'create', tid: 't1', name: name})).body.token;
    const tAna = await make(ana, 'de Ana'), tBob = await make(bob, 'de Bob'), tCarol = await make(carol, 'de Carol');
    assert.equal((await w.manage(dave, {op: 'create', tid: 't1', name: 'x'})).status, 404, 'quien no es miembro');
    assert.equal((await w.manage(ana, {op: 'list', tid: 't1', pid: 'p1'})).status, 400);

    /* Cada persona ve los suyos; la propietaria, los de todos. */
    assert.deepEqual((await w.manage(ana, {op: 'list', tid: 't1'})).body.tokens.map((t) => [t.name, t.by, t.mine, t.readOnly]), [['de Ana', 'Ana', true, false], ['de Bob', 'Bob', false, false], ['de Carol', 'Carol', false, true]]);
    assert.deepEqual((await w.manage(bob, {op: 'list', tid: 't1'})).body.tokens.map((t) => t.name), ['de Bob']);
    assert.equal((await w.manage(bob, {op: 'revoke', tid: 't1', id: tAna.slice(3, 19)})).status, 404, 'un editor no revoca el de otra persona');

    /* El de la lectora nació de solo lectura. */
    assert.equal((await w.call(tCarol, 'move_task', {id: 'a', column: 'done'})).error, 'This token is read-only.');
    /* El editor escribe, y queda firmado con su nombre. */
    await w.call(tBob, 'add_note', {id: 'a', text: 'Revisado'});
    w.clock += 1000;
    await w.call(tBob, 'move_task', {id: 'a', column: 'En curso'});
    assert.deepEqual(w.notes(TEAM + '/tasks/a').map((n) => [n.kind, n.actorUid, n.actorName, n.text]),
      [['comment', 'bob', 'Bob · MCP', 'Revisado'], ['activity', '', '', 'Movida de «Por hacer» a «En curso» por Bob · MCP (token «de Bob»).']]);

    /* Bob pasa a lector: su token deja de escribir sin tocarlo. */
    const doc = w.store.data(TEAM);
    doc.members.bob.role = 'viewer';
    w.store.put(TEAM, doc);
    assert.equal((await w.call(tBob, 'move_task', {id: 'a', column: 'done'})).error, 'This token is read-only.');
    assert.equal((await w.call(tBob, 'list_tasks')).tasks.length, 1);

    /* Bob sale del equipo: el token no vale y se retira. */
    doc.memberIds = ['ana', 'carol'];
    delete doc.members.bob;
    w.store.put(TEAM, doc);
    assert.equal((await w.rpc(tBob, 'ping')).status, 401);
    assert.deepEqual((await w.manage(ana, {op: 'list', tid: 't1'})).body.tokens.map((t) => t.name), ['de Ana', 'de Carol']);

    /* La propietaria revoca el de otra persona. */
    assert.equal((await w.manage(ana, {op: 'revoke', tid: 't1', id: tCarol.slice(3, 19)})).status, 200);
    assert.equal((await w.rpc(tCarol, 'ping')).status, 401);
    assert.equal((await w.rpc(tAna, 'ping')).status, 200);
  });

  await test('un token no sale de su proyecto', async () => {
    const w = world();
    const token = await personal(w);
    w.store.put('users/ana/projects/p2', {nombre: 'Otro', tipo: 'personalizado', stages: STAGES});
    w.store.put('users/ana/projects/p2/tasks/x', task({title: 'De otro proyecto'}));
    assert.equal((await w.call(token, 'get_task', {id: 'x'})).error, 'Task not found.');
    assert.ok((await w.call(token, 'list_tasks', {include_done: true})).tasks.every((t) => t.id !== 'x'));
    /* Un documento manipulado que apunta a otro proyecto no se acepta. */
    const hash = w.store.paths('mcp_tokens/')[0];
    w.store.put(hash, Object.assign(w.store.data(hash), {pid: 'p2'}));
    assert.equal((await w.rpc(token, 'ping')).status, 401);
  });

  await test('proyecto cifrado o borrado: sin MCP, y los tokens se retiran', async () => {
    const w = world();
    const token = await personal(w);
    w.store.put(ROOT, {nombre: 'Personal', tipo: 'personalizado', stages: STAGES, enc: {mode: 'managed'}});
    assert.equal((await w.rpc(token, 'tools/list')).status, 401);
    assert.equal(w.store.paths('mcp_tokens/').length, 0, 'retirado');
    const listed = await w.manage(ana, {op: 'list', pid: 'p1'});
    assert.deepEqual([listed.status, listed.body.available, listed.body.reason], [200, false, 'encrypted']);
    assert.deepEqual((await w.manage(ana, {op: 'create', pid: 'p1', name: 'x'})).body, {error: 'encrypted'});

    const w2 = world();
    const t2 = await personal(w2);
    w2.store.put(ROOT, {nombre: 'Personal', deleted: true});
    assert.equal((await w2.rpc(t2, 'ping')).status, 401);
    assert.equal(w2.store.paths('mcp_tokens/').length, 0);
  });

  await test('tope diario de cambios por proyecto, y su limpieza', async () => {
    const w = world();
    const token = await personal(w);
    await w.call(token, 'add_note', {id: 'a', text: 'uno'});
    const ratePath = 'mcp_rate/u~ana~p1~20261007';
    assert.deepEqual(w.store.data(ratePath), {day: '20261007', key: 'u~ana~p1', n: 1});
    w.store.put(ratePath, {day: '20261007', key: 'u~ana~p1', n: M.LIMITS.writesPerDay});
    for (const [name, args] of [['move_task', {id: 'a', column: 'done'}], ['add_note', {id: 'a', text: 'x'}], ['create_task', {title: 'x'}]]) {
      assert.match((await w.call(token, name, args)).error, /Daily limit/);
    }
    assert.equal((await w.call(token, 'list_tasks')).tasks.length, 2, 'leer no cuenta');
    w.clock += 86400000;
    assert.equal((await w.call(token, 'add_note', {id: 'a', text: 'mañana sí'})).added, true);
    w.clock += 4 * 86400000;
    assert.deepEqual(await M.sweep(ENV, w.deps), {configured: true, rate: 2});
    assert.equal(w.store.paths('mcp_rate/').length, 0);
    assert.deepEqual(await M.sweep({}, {now: () => NOW}), {configured: false, rate: 0});
  });

  await test('«usado por última vez» se apunta como mucho una vez por hora', async () => {
    const w = world();
    const token = await personal(w);
    const hash = w.store.paths('mcp_tokens/')[0];
    await w.rpc(token, 'ping');
    assert.equal(w.store.data(hash).usedAt, NOW);
    const commits = w.store.commits;
    w.clock += 600000;
    await w.rpc(token, 'ping');
    assert.deepEqual([w.store.commits, w.store.data(hash).usedAt], [commits, NOW]);
    w.clock += 3600000;
    await w.rpc(token, 'ping');
    assert.equal(w.store.data(hash).usedAt, w.clock);
    assert.equal((await w.manage(ana, {op: 'list', pid: 'p1'})).body.tokens[0].usedAt, w.clock);
  });

  await test('al eliminar la cuenta se retiran sus tokens, también los de equipos', async () => {
    const w = world();
    await personal(w);
    team(w);
    await w.manage(ana, {op: 'create', tid: 't1', name: 'equipo'});
    const tBob = (await w.manage(bob, {op: 'create', tid: 't1', name: 'de Bob'})).body.token;
    assert.deepEqual((await w.manage(ana, {op: 'purge'})).body, {v: 1, removed: 2});
    assert.equal(w.store.paths('mcp_tokens/').length, 1);
    assert.equal((await w.rpc(tBob, 'ping')).status, 200, 'los de otras personas siguen');
  });

  await test('al borrar un proyecto se retiran todos sus tokens: solo quien puede borrarlo', async () => {
    const w = world();
    team(w);
    const tAna = (await w.manage(ana, {op: 'create', tid: 't1', name: 'de Ana'})).body.token;
    await w.manage(bob, {op: 'create', tid: 't1', name: 'de Bob'});
    assert.deepEqual([(await w.manage(bob, {op: 'clear', tid: 't1'})).status, w.store.paths('mcp_tokens/').length], [403, 2], 'un editor no');
    assert.deepEqual((await w.manage(ana, {op: 'clear', tid: 't1'})).body, {v: 1, removed: 2});
    assert.equal((await w.rpc(tAna, 'ping')).status, 401);
    /* Un proyecto personal que ya no existe: su dueña aún puede retirarlos; otra cuenta, no los suyos. */
    const w2 = world();
    await personal(w2);
    w2.store.docs.delete(ROOT);
    assert.equal((await w2.manage(ana, {op: 'list', pid: 'p1'})).status, 404);
    assert.deepEqual((await w2.manage(bob, {op: 'clear', pid: 'p1'})).body, {v: 1, removed: 0});
    assert.equal(w2.store.paths('mcp_tokens/').length, 1);
    assert.deepEqual((await w2.manage(ana, {op: 'clear', pid: 'p1'})).body, {v: 1, removed: 1});
  });

  await test('ruta /__/mcp/v1: lo que se rechaza antes de mirar nada', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../worker/index.js'), 'utf8');
    const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const limited = [];
    const env = {ASSETS: {fetch: async () => new Response('archivo')}, MCP_RATE_LIMIT: {limit: async ({key}) => { limited.push(key); return {success: limited.length < 3}; }}};
    const good = 'kl_' + 'abcdefghijklmnop' + 'qrstuvwxyz234567';
    const send = (o) => worker.fetch(new Request('https://kanlane.com/__/mcp/v1' + (o.path || ''), {method: o.method || 'POST',
      headers: Object.assign({'Content-Type': 'application/json'}, o.token === null ? {} : {Authorization: 'Bearer ' + (o.token || good)}, o.headers),
      body: (o.method || 'POST') === 'POST' ? (o.body === undefined ? '{"jsonrpc":"2.0","id":1,"method":"ping"}' : o.body) : undefined}), o.env || env);
    const get = await send({method: 'GET'});
    assert.deepEqual([get.status, get.headers.get('Allow')], [405, 'POST']);
    assert.equal((await send({headers: {Origin: 'https://otra.example'}})).status, 403, 'una página de otro origen');
    for (const token of [null, 'un-id-token.de.firebase', 'kl_CORTO', good + 'a']) {
      const res = await send({token: token});
      assert.deepEqual([res.status, res.headers.get('WWW-Authenticate'), (await res.json()).error.code], [401, 'Bearer', -32001], String(token));
    }
    assert.equal(limited.length, 0, 'sin token con forma de token no se gasta el límite');
    const big = await send({body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'ping', params: {x: 'a'.repeat(70000)}})});
    assert.equal(big.status, 413);
    assert.equal((await send({body: '{no es json'})).status, 400);
    assert.deepEqual(limited, ['mcp:abcdefghijklmnop', 'mcp:abcdefghijklmnop'], 'el límite va por el identificador del token');
    const blocked = await send({});
    assert.deepEqual([blocked.status, blocked.headers.get('Retry-After'), blocked.headers.get('Cache-Control')], [429, '60', 'no-store']);
    const tokens = await worker.fetch(new Request('https://kanlane.com/__/mcp/v1/tokens', {method: 'POST', body: '{"op":"list","pid":"main"}'}), env);
    assert.equal(tokens.status, 401, 'la gestión de tokens pide la sesión de Firebase');
    assert.equal((await worker.fetch(new Request('https://kanlane.com/__/mcp/v1/tokens'), env)).status, 405);
  });

  console.log('\n' + passed + ' correctas');
})().catch((error) => { console.error(error); process.exitCode = 1; });
