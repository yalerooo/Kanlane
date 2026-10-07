/* Servidor MCP contra el Firestore emulado, por HTTP y sin navegador: lo que la prueba en memoria
   (tests/worker/mcp.test.js) no ve, que es la capa REST de verdad. Las consultas (por columna, por
   exclusión, las notas ordenadas), las escrituras con condición y los contadores los resuelve el
   emulador; las rutas son las de scripts/dev.js, que cargan el mismo worker/mcp.mjs.
   Uso: dentro de «firebase emulators:exec» (ver .github/workflows/checks.yml). */
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');

const root = path.resolve(__dirname, '../..');
const port = 58661;
const base = 'http://localhost:' + port;
const env = {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8187', FIREBASE_PROJECT: 'demo-workhub'};
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd: root, stdio: 'ignore'});
const stamp = Date.now().toString(36);
const uid = 'mcp-ana-' + stamp;
const STAGES = [{key: 'todo', label: 'Por hacer'}, {key: 'doing', label: 'En curso'}, {key: 'done', label: 'Hecho', done: true}];

async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/app/')).ok) return; } catch (e) { /* aún no */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('No arrancó el servidor');
}

/* Un ID token como los del emulador de Authentication: sin firma (dev.js no la comprueba). */
const idToken = (user) => ['{"alg":"none"}', JSON.stringify({user_id: user, sub: user}), ''].map((p) => Buffer.from(p).toString('base64url')).join('.');
const post = (route, bearer, body) => fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer}, body: JSON.stringify(body)});

(async () => {
  await ready();
  const {restStore} = await import(pathToFileURL(path.join(root, 'worker/automations.mjs')).href);
  const store = restStore(env, {fetch: (u, init) => fetch(u, init), now: () => Date.now()});
  const project = 'users/' + uid + '/projects/p1';
  const task = (over) => Object.assign({title: 'Tarea', desc: '', status: 'todo', cliente: '', contacto: '', dueDate: '', labels: [], checklist: [], order: 1, createdAt: 1, updatedAt: 1}, over);
  await store.commit([
    {path: project, set: {nombre: 'Proyecto MCP', tipo: 'personalizado', stages: STAGES}},
    {path: project + '/tasks/a', set: task({title: 'Pendiente', order: 10})},
    {path: project + '/tasks/b', set: task({title: 'En marcha', status: 'doing', order: 20})},
    {path: project + '/tasks/c', set: task({title: 'Terminada', status: 'done', order: 30})},
    {path: project + '/tasks/z', set: task({title: 'Huérfana', status: 'columna-borrada', order: 5})},
    {path: project + '/tasks/r', set: task({title: 'Informe', status: 'doing', order: 40, repeat: 'weekly', dueDate: '2026-01-05'})},
    {path: project + '/tasks/a/notes/n1', set: {text: 'Primera', createdAt: 100, kind: 'note'}},
    {path: project + '/tasks/a/notes/n2', set: {text: 'Segunda', createdAt: 200, kind: 'note'}}
  ]);

  /* ---------- tokens ---------- */
  const made = await post('/__/mcp/v1/tokens', idToken(uid), {op: 'create', pid: 'p1', name: 'Prueba'});
  assert.equal(made.status, 200);
  const token = (await made.json()).token;
  assert.match(token, /^kl_[a-z2-7]{32}$/);
  assert.equal((await post('/__/mcp/v1/tokens', idToken('otra-cuenta'), {op: 'list', pid: 'p1'})).status, 404, 'el proyecto de otra persona no existe');
  assert.equal((await post('/__/mcp/v1/tokens', 'no-es-un-token', {op: 'list', pid: 'p1'})).status, 401);

  let n = 0;
  const rpc = async (method, params, bearer) => {
    const res = await post('/__/mcp/v1', bearer || token, Object.assign({jsonrpc: '2.0', id: ++n, method: method}, params ? {params: params} : {}));
    return {status: res.status, body: res.status === 202 ? null : await res.json()};
  };
  const call = async (name, args) => {
    const out = await rpc('tools/call', {name: name, arguments: args || {}});
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const res = out.body.result;
    return res.isError ? {error: res.content[0].text} : JSON.parse(res.content[0].text);
  };

  /* ---------- protocolo ---------- */
  const init = await rpc('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'prueba', version: '1'}});
  assert.deepEqual([init.status, init.body.result.protocolVersion, init.body.result.serverInfo.name], [200, '2025-06-18', 'kanlane']);
  assert.equal((await rpc('tools/list')).body.result.tools.length, 5);
  assert.equal((await rpc('ping', null, 'kl_' + 'a'.repeat(32))).status, 401, 'un token inventado');

  /* ---------- lectura: las consultas de verdad ---------- */
  const ids = (out) => out.tasks.map((t) => t.id);
  assert.deepEqual(ids(await call('list_tasks')), ['z', 'a', 'b', 'r'], 'abiertas: excluye las hechas y conserva la huérfana en la primera columna');
  assert.deepEqual(ids(await call('list_tasks', {include_done: true})), ['z', 'a', 'b', 'r', 'c']);
  assert.deepEqual(ids(await call('list_tasks', {column: 'En curso'})), ['b', 'r']);
  assert.deepEqual(ids(await call('list_tasks', {column: 'Por hacer'})), ['z', 'a']);
  assert.deepEqual(ids(await call('list_tasks', {column: 'done'})), ['c']);
  assert.deepEqual((await call('get_task', {id: 'a'})).notes.map((x) => x.text), ['Primera', 'Segunda']);

  /* ---------- escritura ---------- */
  const moved = await call('move_task', {id: 'a', column: 'En curso'});
  assert.deepEqual([moved.moved, moved.task.column_key], [true, 'doing']);
  const saved = await store.get(project + '/tasks/a');
  assert.deepEqual([saved.status, saved.title, saved.order > 1000], ['doing', 'Pendiente', true], 'solo cambia lo movido');
  assert.deepEqual((await call('get_task', {id: 'a'})).notes.map((x) => [x.kind, x.text]).pop(), ['activity', 'Movida de «Por hacer» a «En curso» por MCP (token «Prueba»).']);

  assert.equal((await call('add_note', {id: 'a', text: 'Hecho desde la prueba'})).added, true);
  assert.equal((await call('get_task', {id: 'a'})).notes.pop().text, 'Hecho desde la prueba');

  const created = await call('create_task', {title: 'Creada por MCP', column: 'Por hacer', due_date: '2026-12-01', labels: ['mcp']});
  assert.deepEqual([created.task.column_key, created.task.due_date, created.task.labels], ['todo', '2026-12-01', ['mcp']]);
  assert.ok(ids(await call('list_tasks', {column: 'todo'})).indexOf(created.task.id) !== -1);

  /* Completar la que se repite crea la siguiente en la misma escritura. */
  const done = await call('move_task', {id: 'r', column: 'Hecho'});
  assert.match(done.next_occurrence, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await store.get(project + '/tasks/r')).repeatSpawned, true);
  const after = await call('list_tasks', {column: 'todo'});
  assert.ok(after.tasks.some((t) => t.title === 'Informe' && t.due_date === done.next_occurrence && t.repeat === 'weekly'));

  /* El contador del día: una suma por cada cambio (mover, nota, crear, completar). */
  const d = new Date();
  const day = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  assert.equal((await store.get('mcp_rate/u~' + uid + '~p1~' + day)).n, 4);

  /* ---------- revocar ---------- */
  const listed = await (await post('/__/mcp/v1/tokens', idToken(uid), {op: 'list', pid: 'p1'})).json();
  assert.deepEqual([listed.tokens.length, listed.tokens[0].name, listed.tokens[0].usedAt > 0], [1, 'Prueba', true]);
  assert.equal((await post('/__/mcp/v1/tokens', idToken(uid), {op: 'revoke', pid: 'p1', id: listed.tokens[0].id})).status, 200);
  assert.equal((await rpc('ping')).status, 401, 'revocado');

  console.log('OK   servidor MCP contra el emulador: tokens, consultas, escrituras y contador');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.kill());
