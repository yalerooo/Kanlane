/* Captura de tareas por correo (worker/capture.mjs): gestión de la dirección y recepción, con una
   base de datos en memoria y mensajes firmados con DKIM de prueba. La capa REST y la pantalla se
   prueban contra los emuladores en tests/e2e/mail-capture.js. Uso: node tests/worker/capture.test.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {buildMail, dkimSign, dkimKey, message, memoryStore} = require('./mail-fixtures.js');

const NOW = Date.UTC(2026, 9, 7, 9, 0, 0);
const SECRET = nodeCrypto.randomBytes(32).toString('base64');
const ENV = {CAPTURE_SECRET: SECRET, CAPTURE_DOMAINS: 'in.kanlane.test, respaldo.kanlane.test', CAPTURE_PLAN: 'paid'};
const keys = {'ejemplo.test': dkimKey(), 'otra.test': dkimKey()};

(async () => {
  const C = await import(pathToFileURL(path.join(__dirname, '../../worker/capture.mjs')).href);
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('ok   ' + name); };

  /* Un mundo: base de datos, reloj, DNS y registro. */
  function world() {
    const w = {store: memoryStore(), clock: NOW, logs: [], dns: 0};
    w.deps = {store: w.store, now: () => w.clock, log: (line) => w.logs.push(line),
      resolveTxt: async (name) => { w.dns++; const d = name.replace('sel._domainkey.', ''); return keys[d] ? [keys[d].txt] : []; }};
    w.manage = (who, body, env) => C.manage(who, body, env || ENV, w.deps);
    w.send = (to, o, opts) => {
      const x = opts || {};
      let raw = buildMail(Object.assign({to: to}, o));
      const domain = x.signAs || (/@([^>\s]+)>?\s*$/.exec(o.from || 'ana@ejemplo.test') || [])[1];
      if (x.sign !== false && keys[domain]) raw = dkimSign(raw, {domain: domain, key: keys[domain].key, time: Math.floor(w.clock / 1000)});
      const msg = message(x.raw ? x.raw(raw) : raw, to, x.envelope);
      return C.receive(msg, x.env || ENV, w.deps).then((out) => Object.assign({rejected: msg.rejected}, out));
    };
    w.tasks = (root) => w.store.paths(root + '/tasks/').filter((p) => p.split('/tasks/')[1].indexOf('/') === -1).map((p) => Object.assign({path: p}, w.store.data(p)));
    w.notes = (taskPath) => w.store.paths(taskPath + '/notes/').map((p) => w.store.data(p)).sort((a, b) => a.createdAt - b.createdAt);
    return w;
  }
  const ana = {uid: 'ana', email: 'Ana@Ejemplo.test', emailVerified: true};
  const bob = {uid: 'bob', email: 'bob@ejemplo.test', emailVerified: true};
  const carol = {uid: 'carol', email: 'carol@ejemplo.test', emailVerified: true};
  const dave = {uid: 'dave', email: 'dave@otra.test', emailVerified: true};
  const teamDoc = (over) => Object.assign({nombre: 'Equipo', ownerUid: 'ana', memberIds: ['ana', 'bob', 'carol'], tipo: 'desarrollo',
    members: {ana: {role: 'owner', name: 'Ana', email: 'ana@ejemplo.test'}, bob: {role: 'editor', name: 'Bob', email: 'bob@ejemplo.test'}, carol: {role: 'viewer', name: 'Carol', email: 'carol@ejemplo.test'}}}, over);
  /* Proyecto personal con columnas propias y captura activada. */
  async function personal(w, pid) {
    const id = pid || 'p1';
    w.store.put('users/ana/projects/' + id, {nombre: 'Personal', tipo: 'personalizado', stages: [{key: 'todo', label: 'Por hacer'}, {key: 'doing', label: 'En curso'}, {key: 'done', label: 'Hecho', done: true}]});
    const out = await w.manage(ana, {op: 'enable', pid: id});
    assert.equal(out.status, 200, JSON.stringify(out.body));
    return out.body.address;
  }
  const rejectedAsUnknown = (out) => { assert.equal(out.result, 'rejected'); assert.equal(out.rejected, 'This address does not accept mail.'); };

  await test('sin configurar (secreto, dominios o base de datos) no hay captura', async () => {
    const w = world();
    assert.equal((await w.manage(ana, {op: 'status', pid: 'main'}, {CAPTURE_DOMAINS: 'in.kanlane.test'})).status, 503);
    assert.equal((await w.manage(ana, {op: 'status', pid: 'main'}, {CAPTURE_SECRET: SECRET})).status, 503);
    assert.equal((await w.manage(ana, {op: 'status', pid: 'main'}, {CAPTURE_SECRET: 'corto', CAPTURE_DOMAINS: 'in.kanlane.test'})).status, 503);
    assert.equal((await C.manage(ana, {op: 'status', pid: 'main'}, ENV, {now: () => NOW})).status, 503, 'sin cuenta de servicio');
    const out = await w.send('abcdefghijklmnopqrstuvwxyz234567@in.kanlane.test', {text: 'x'}, {env: {CAPTURE_DOMAINS: 'in.kanlane.test'}});
    rejectedAsUnknown(out);
  });

  await test('activar: dirección larga, al azar, en los dos dominios, y en la base de datos solo su hash', async () => {
    const w = world();
    const first = await w.manage(ana, {op: 'status', pid: 'main'});
    assert.deepEqual([first.status, first.body.available, first.body.on, first.body.address], [200, true, false, undefined]);
    assert.deepEqual(first.body.limits, {messageMb: 25, fileMb: 10, files: 10});
    const on = await w.manage(ana, {op: 'enable', pid: 'main'});
    assert.equal(on.status, 200);
    assert.match(on.body.address, /^[a-z2-7]{32}@in\.kanlane\.test$/);
    assert.deepEqual(on.body.alt, [on.body.address.replace('in.kanlane.test', 'respaldo.kanlane.test')], 'la misma dirección en el dominio de respaldo');
    const local = on.body.address.split('@')[0];
    const all = JSON.stringify(Array.from(w.store.docs.entries()));
    assert.ok(all.indexOf(local) === -1 && all.indexOf(local.slice(16)) === -1, 'ni la dirección ni su mitad secreta están guardadas');
    assert.deepEqual(w.store.paths('mail_capture/').length, 1);
    assert.match(w.store.paths('mail_capture/')[0], /^mail_capture\/[0-9a-f]{64}$/);
    assert.equal(w.store.data(w.store.paths('mail_capture/')[0]).email, 'ana@ejemplo.test', 'el remitente autorizado es el correo comprobado de la cuenta');
    /* Volver a activar o consultar da la misma; otra activación en otro proyecto, otra distinta. */
    assert.equal((await w.manage(ana, {op: 'enable', pid: 'main'})).body.address, on.body.address);
    assert.equal((await w.manage(ana, {op: 'status', pid: 'main'})).body.address, on.body.address);
    w.store.put('users/ana/projects/p2', {nombre: 'Otro'});
    assert.notEqual((await w.manage(ana, {op: 'enable', pid: 'p2'})).body.address, on.body.address);
    /* Con otro secreto la misma base de datos da otra dirección: sin el secreto no se reconstruye. */
    const other = await w.manage(ana, {op: 'status', pid: 'main'}, Object.assign({}, ENV, {CAPTURE_SECRET: nodeCrypto.randomBytes(32).toString('base64')}));
    assert.notEqual(other.body.address, on.body.address);
  });

  await test('quién gestiona: solo el dueño; en un equipo, solo el propietario', async () => {
    const w = world();
    w.store.put('teams/t1', teamDoc());
    w.store.put('users/ana/projects/p1', {nombre: 'De Ana'});
    /* Una cuenta sin el correo comprobado no activa la captura de un proyecto personal. */
    assert.deepEqual((await w.manage({uid: 'ana', email: 'ana@ejemplo.test', emailVerified: false}, {op: 'enable', pid: 'p1'})).body, {error: 'email'});
    /* El proyecto de otra persona no existe para quien pregunta: el uid sale del token. */
    assert.equal((await w.manage(bob, {op: 'enable', pid: 'p1'})).status, 404);
    assert.equal((await w.manage(bob, {op: 'enable', pid: 'p1', uid: 'ana'})).status, 404, 'mandar un uid en el cuerpo no cambia nada');
    assert.equal(w.store.paths('mail_capture').length, 0);
    /* Equipo. */
    assert.equal((await w.manage(bob, {op: 'enable', tid: 't1'})).status, 403);
    assert.equal((await w.manage(carol, {op: 'enable', tid: 't1'})).status, 403);
    assert.equal((await w.manage(dave, {op: 'status', tid: 't1'})).status, 404, 'alguien de fuera no sabe ni si existe');
    assert.equal((await w.manage(dave, {op: 'status', tid: 'noexiste'})).status, 404);
    const on = await w.manage(ana, {op: 'enable', tid: 't1'});
    assert.equal(on.status, 200);
    /* El editor puede enviar, así que ve la dirección; no la cambia. La lectora no la ve. */
    const asEditor = await w.manage(bob, {op: 'status', tid: 't1'});
    assert.deepEqual([asEditor.body.role, asEditor.body.address], ['editor', on.body.address]);
    const asViewer = await w.manage(carol, {op: 'status', tid: 't1'});
    assert.deepEqual([asViewer.body.role, asViewer.body.on, asViewer.body.address, asViewer.body.allow], ['viewer', true, undefined, undefined]);
    for (const op of ['regenerate', 'disable', 'configure']) assert.equal((await w.manage(bob, {op: op, tid: 't1', stage: ''})).status, 403, op);
    assert.equal((await w.manage(bob, {op: 'status', tid: 't1'})).body.address, on.body.address, 'nada cambió');
    /* Peticiones mal formadas. */
    for (const body of [null, {}, {op: 'status'}, {op: 'status', pid: '../x'}, {op: 'status', pid: 'a', tid: 't1'}, {op: 'otra', pid: 'main'}, {op: 'status', tid: 't1/x'}]) {
      assert.equal((await w.manage(ana, body)).status, 400, JSON.stringify(body));
    }
  });

  await test('correo válido de la dueña: exactamente una tarea, con título, descripción, columna y registro', async () => {
    const w = world();
    const address = await personal(w);
    const out = await w.send(address, {subject: 'Preparar el presupuesto de otoño', text: 'Hola:\r\n\r\nHay que enviarlo el viernes.\r\n'});
    assert.deepEqual([out.result, out.code, out.rejected, out.files], ['created', 'created', null, 0]);
    const tasks = w.tasks('users/ana/projects/p1');
    assert.equal(tasks.length, 1);
    const t = tasks[0];
    assert.deepEqual({title: t.title, desc: t.desc, status: t.status, labels: t.labels, checklist: t.checklist, cliente: t.cliente, dueDate: t.dueDate},
      {title: 'Preparar el presupuesto de otoño', desc: 'Hola:\n\nHay que enviarlo el viernes.', status: 'todo', labels: [], checklist: [], cliente: '', dueDate: ''});
    assert.deepEqual([t.createdAt, t.updatedAt, t.order], [NOW, NOW, NOW]);
    assert.equal(t.path.split('/').pop(), out.taskId);
    /* Solo los campos que la app admite en una tarea (si no, no podría editarla después). */
    assert.deepEqual(Object.keys(t).filter((k) => k !== 'path').sort(), ['checklist', 'cliente', 'contacto', 'createdAt', 'desc', 'dueDate', 'labels', 'order', 'status', 'title', 'updatedAt']);
    const notes = w.notes(t.path);
    assert.deepEqual(notes.map((n) => [n.kind, n.text, n.actorUid]), [['activity', 'Creada desde un correo de ana@ejemplo.test.', '']]);
    /* Nada más cambió: ni el proyecto, ni automatizaciones, ni otras tareas. */
    assert.deepEqual(w.store.paths('users/ana/').filter((p) => p.indexOf('/tasks/') === -1), ['users/ana/projects/p1']);
    /* El mismo correo en el dominio de respaldo entra igual (otro mensaje distinto, para que no sea duplicado). */
    const alt = await w.send(address.replace('in.kanlane.test', 'respaldo.kanlane.test'), {subject: 'Por el respaldo', text: 'x'});
    assert.equal(alt.result, 'created');
    assert.equal(w.tasks('users/ana/projects/p1').length, 2);
    /* El proyecto principal vive en la raíz de la cuenta. */
    const main = (await w.manage(ana, {op: 'enable', pid: 'main'})).body.address;
    assert.equal((await w.send(main, {subject: 'Al principal', text: 'x'})).result, 'created');
    assert.equal(w.tasks('users/ana')[0].title, 'Al principal');
    assert.equal(w.tasks('users/ana')[0].status, 'pendiente', 'la primera columna de la plantilla por defecto');
  });

  await test('equipo: envía quien puede editar; la tarea y su registro quedan en el equipo', async () => {
    const w = world();
    w.store.put('teams/t1', teamDoc());
    const address = (await w.manage(ana, {op: 'enable', tid: 't1'})).body.address;
    const fromEditor = await w.send(address, {from: 'Bob <bob@ejemplo.test>', subject: 'Del editor', text: 'cuerpo', attachments: [{name: 'nota.txt', data: 'hola', type: 'text/plain'}]});
    assert.deepEqual([fromEditor.result, fromEditor.files], ['created', 1]);
    assert.equal((await w.send(address, {from: 'ana@ejemplo.test', subject: 'De la propietaria', text: 'cuerpo'})).result, 'created');
    const tasks = w.tasks('teams/t1');
    assert.deepEqual(tasks.map((t) => t.title).sort(), ['De la propietaria', 'Del editor']);
    const t = tasks.find((x) => x.title === 'Del editor');
    const notes = w.notes(t.path);
    assert.equal(notes[0].text, 'Creada desde un correo de bob@ejemplo.test.');
    /* Los adjuntos van a nombre de quien los envió y a las imágenes y archivos del equipo. */
    assert.deepEqual([notes[1].kind, notes[1].actorUid, notes[1].actorName, notes[1].attachments[0].name], ['comment', 'bob', 'Bob', 'nota.txt']);
    assert.equal(w.store.paths('teams/t1/assets/').length, 1);
    assert.equal(w.store.paths('users/').length, 0);
    /* Lectora, alguien de fuera con firma válida de su dominio, y un miembro al que se quitó: nada. */
    for (const from of ['carol@ejemplo.test', 'dave@otra.test']) {
      const no = await w.send(address, {from: from, subject: 'No', text: 'x'});
      assert.deepEqual([no.result, no.code], ['rejected', 'sender-member'], from);
      assert.match(no.rejected, /^Sender not authorized/);
    }
    w.store.put('teams/t1', teamDoc({memberIds: ['ana', 'carol'], members: {ana: teamDoc().members.ana, carol: teamDoc().members.carol}}));
    assert.equal((await w.send(address, {from: 'bob@ejemplo.test', subject: 'Ya no estoy', text: 'x'})).code, 'sender-member');
    /* Un «propietario» que no es el del equipo (documento manipulado) tampoco cuenta. */
    w.store.put('teams/t1', teamDoc({members: Object.assign({}, teamDoc().members, {carol: {role: 'owner', name: 'Carol', email: 'carol@ejemplo.test'}})}));
    assert.equal((await w.send(address, {from: 'carol@ejemplo.test', subject: 'Me subo', text: 'x'})).code, 'sender-member');
    assert.equal(w.tasks('teams/t1').length, 2);
  });

  await test('el From no prueba nada: sin firma, con la firma de otro dominio o manipulado, no entra', async () => {
    const w = world();
    const address = await personal(w);
    const none = await w.send(address, {subject: 'Sin firma', text: 'x'}, {sign: false});
    assert.deepEqual([none.result, none.code], ['rejected', 'sender-none']);
    /* Alguien que conoce la dirección y pone el From de la dueña, firmando con su propio dominio. */
    const spoof = await w.send(address, {from: 'Ana <ana@ejemplo.test>', subject: 'Suplantación', text: 'x'}, {signAs: 'otra.test'});
    assert.deepEqual([spoof.result, spoof.code], ['rejected', 'sender-none']);
    /* Cuerpo cambiado por el camino. */
    const tampered = await w.send(address, {subject: 'Cambiado', text: 'original'}, {raw: (raw) => Buffer.from(raw.toString('latin1').replace(Buffer.from('original').toString('base64'), Buffer.from('cambiado').toString('base64')), 'latin1')});
    assert.equal(tampered.code, 'sender-body');
    /* Otra cuenta, con su firma en regla: conocer la dirección no la hace miembro. */
    const stranger = await w.send(address, {from: 'dave@otra.test', subject: 'Extraño', text: 'x'});
    assert.equal(stranger.code, 'sender-member');
    /* Dos From, From con dos direcciones o sin From. */
    assert.equal((await w.send(address, {subject: 'x', text: 'x', headers: [['From', 'dave@otra.test']]})).code, 'sender');
    assert.equal((await w.send(address, {from: 'ana@ejemplo.test, dave@otra.test', subject: 'x', text: 'x'}, {sign: false})).code, 'sender');
    /* Todos reciben la misma explicación, sin datos del proyecto. */
    [none, spoof, tampered, stranger].forEach((o) => assert.equal(o.rejected, none.rejected));
    assert.ok(!/Personal|p1|ana/i.test(none.rejected));
    assert.equal(w.tasks('users/ana/projects/p1').length, 0);
    assert.equal(w.store.paths('mail_seen').length + w.store.paths('mail_rate').length, 0, 'un rechazo no escribe nada');
  });

  await test('lista de remitentes: solo restringe; nunca deja entrar a quien no es miembro', async () => {
    const w = world();
    w.store.put('teams/t1', teamDoc());
    const address = (await w.manage(ana, {op: 'enable', tid: 't1'})).body.address;
    const set = await w.manage(ana, {op: 'configure', tid: 't1', allow: ['ANA@ejemplo.test', 'dave@otra.test', 'ana@ejemplo.test']});
    assert.deepEqual(set.body.allow, ['ana@ejemplo.test', 'dave@otra.test']);
    assert.equal(set.body.address, address, 'configurar no cambia la dirección');
    assert.equal((await w.send(address, {from: 'ana@ejemplo.test', subject: 'En la lista y miembro', text: 'x'})).result, 'created');
    assert.equal((await w.send(address, {from: 'bob@ejemplo.test', subject: 'Miembro fuera de la lista', text: 'x'})).code, 'sender-member');
    assert.equal((await w.send(address, {from: 'dave@otra.test', subject: 'En la lista sin ser miembro', text: 'x'})).code, 'sender-member');
    /* Vaciarla vuelve a dejar entrar a todos los que pueden editar. */
    await w.manage(ana, {op: 'configure', tid: 't1', allow: []});
    assert.equal((await w.send(address, {from: 'bob@ejemplo.test', subject: 'Otra vez', text: 'x'})).result, 'created');
    /* Listas que no valen. */
    for (const allow of ['a@b.test', ['no es un correo'], [1], Array.from({length: 21}, (x, i) => 'a' + i + '@b.test'), ['a@b.test\r\nBcc: x@y.test']]) {
      assert.deepEqual((await w.manage(ana, {op: 'configure', tid: 't1', allow: allow})).body, {error: 'allow'});
    }
  });

  await test('regenerar o desactivar: la dirección anterior deja de funcionar al momento', async () => {
    const w = world();
    const first = await personal(w);
    assert.equal((await w.send(first, {subject: 'Antes', text: 'x'})).result, 'created');
    const again = await w.manage(ana, {op: 'regenerate', pid: 'p1'});
    assert.notEqual(again.body.address, first);
    assert.equal(w.store.paths('mail_capture/').length, 1, 'el hash anterior se borra');
    rejectedAsUnknown(await w.send(first, {subject: 'A la vieja', text: 'x'}));
    assert.equal((await w.send(again.body.address, {subject: 'A la nueva', text: 'x'})).result, 'created');
    const off = await w.manage(ana, {op: 'disable', pid: 'p1'});
    assert.deepEqual([off.body.on, off.body.address], [false, undefined]);
    assert.equal(w.store.paths('mail_capture').length, 0, 'no queda nada de la dirección');
    rejectedAsUnknown(await w.send(again.body.address, {subject: 'Desactivada', text: 'x'}));
    /* Volver a activar da una dirección nueva: la de antes no revive. */
    const back = await w.manage(ana, {op: 'enable', pid: 'p1'});
    assert.ok(back.body.address !== first && back.body.address !== again.body.address);
    rejectedAsUnknown(await w.send(again.body.address, {subject: 'La de antes', text: 'x'}));
    assert.deepEqual(w.tasks('users/ana/projects/p1').map((t) => t.title).sort(), ['A la nueva', 'Antes']);
  });

  await test('direcciones inventadas se descartan sin leer la base de datos, y otros dominios también', async () => {
    const w = world();
    const address = await personal(w);
    const reads = w.store.reads;
    const local = address.split('@')[0];
    const flip = (s, i) => s.slice(0, i) + (s[i] === 'a' ? 'b' : 'a') + s.slice(i + 1);
    for (const to of ['a'.repeat(32) + '@in.kanlane.test', flip(local, 3) + '@in.kanlane.test', flip(local, 30) + '@in.kanlane.test', local.toUpperCase().slice(0, 31) + '@in.kanlane.test',
      'hola@in.kanlane.test', local + '@otro.test', local + '@in.kanlane.test.malo.test', local, '', local + '+x@in.kanlane.test']) {
      rejectedAsUnknown(await w.send(to, {subject: 'x', text: 'x'}));
    }
    assert.equal(w.store.reads, reads, 'ni una lectura');
    assert.equal(w.dns, 0, 'ni una consulta de DNS');
    /* Mayúsculas en la dirección: el correo no las distingue. */
    assert.equal((await w.send(address.toUpperCase(), {subject: 'En mayúsculas', text: 'x'})).result, 'created');
  });

  await test('asunto vacío o enorme, cuerpo vacío, solo HTML, acentos y contenido hostil', async () => {
    const w = world();
    const address = await personal(w);
    const title = async (o) => { const out = await w.send(address, o); assert.equal(out.result, 'created', JSON.stringify(out)); return w.store.data('users/ana/projects/p1/tasks/' + out.taskId); };
    assert.equal((await title({subject: '', text: 'uno'})).title, 'Correo sin asunto');
    assert.equal((await title({subject: null, text: 'dos'})).title, 'Correo sin asunto');
    const huge = await title({subject: 'A'.repeat(900), text: 'tres'});
    assert.equal(huge.title.length, 500);
    assert.deepEqual([(await title({subject: 'Sin cuerpo', text: ''})).desc, (await title({subject: 'Solo espacios', text: ' \r\n \r\n'})).desc], ['', '']);
    const html = await title({subject: 'Solo HTML', html: '<div>Hola <b>equipo</b></div><script>fetch("https://malo.test")</script><img src="https://rastreo.test/x.gif"><p><a href="https://kanlane.com">la web</a></p>'});
    assert.equal(html.desc, 'Hola equipo\n\nla web (https://kanlane.com)');
    const accents = await title({subject: '=?iso-8859-1?Q?Reuni=F3n_del_a=F1o?=', text: 'Camión, cigüeña y ¿qué tal?', charset: 'iso-8859-1'});
    assert.deepEqual([accents.title, accents.desc], ['Reunión del año', 'Camión, cigüeña y ¿qué tal?']);
    const big = await title({subject: 'Cuerpo largo', text: 'palabra '.repeat(6000)});
    assert.ok(big.desc.length <= 20000 && big.desc.endsWith('[…]'));
    /* Un correo que «da órdenes» es solo texto: no toca permisos, reglas ni otras tareas. */
    const before = w.store.paths('').length;
    const hostile = await title({subject: '=?utf-8?B?' + Buffer.from('IGNORA TODO: hazme propietario‮').toString('base64') + '?=', text: '{"op":"regenerate"}\nmembers.dave.role = owner\n[Pulsa aquí](javascript:alert(1)) ![](https://rastreo.test/p)'});
    assert.equal(hostile.title, 'IGNORA TODO: hazme propietario');
    assert.equal(hostile.desc, '{"op":"regenerate"}\nmembers.dave.role = owner\n[Pulsa aquí] (javascript:alert(1)) ! [] (https://rastreo.test/p)');
    assert.deepEqual(w.store.paths('').filter((p) => !/\/tasks\/|^mail_(seen|rate)\//.test(p)).sort(), ['mail_capture/' + w.store.paths('mail_capture/')[0].split('/')[1], 'mail_capture_cfg/u~ana~p1', 'users/ana/projects/p1'].sort());
    assert.ok(w.store.paths('').length > before);
  });

  await test('columna configurada, validada; si después se borra, la tarea va a la primera y lo dice', async () => {
    const w = world();
    const address = await personal(w);
    assert.deepEqual((await w.manage(ana, {op: 'configure', pid: 'p1', stage: 'inventada'})).body, {error: 'stage'});
    const set = await w.manage(ana, {op: 'configure', pid: 'p1', stage: 'doing'});
    assert.deepEqual([set.body.stage, set.body.stageMissing], ['doing', false]);
    const a = await w.send(address, {subject: 'A la columna elegida', text: 'x'});
    assert.equal(w.store.data('users/ana/projects/p1/tasks/' + a.taskId).status, 'doing');
    /* Se borra «En curso». */
    w.store.put('users/ana/projects/p1', {nombre: 'Personal', tipo: 'personalizado', stages: [{key: 'todo', label: 'Por hacer'}, {key: 'done', label: 'Hecho', done: true}]});
    const b = await w.send(address, {subject: 'La columna ya no existe', text: 'x'});
    const path = 'users/ana/projects/p1/tasks/' + b.taskId;
    assert.equal(w.store.data(path).status, 'todo');
    assert.equal(w.notes(path)[0].text, 'Creada desde un correo de ana@ejemplo.test. La columna elegida para el correo ya no existe: se creó en «Por hacer».');
    assert.equal((await w.manage(ana, {op: 'status', pid: 'p1'})).body.stageMissing, true, 'y la pantalla puede avisarlo');
    /* Con la columna borrada se puede seguir regenerando la dirección y cambiando los remitentes;
       lo que no se puede es volver a elegirla. */
    const regen = await w.manage(ana, {op: 'regenerate', pid: 'p1'});
    assert.deepEqual([regen.status, regen.body.stage, regen.body.stageMissing], [200, 'doing', true]);
    assert.equal((await w.manage(ana, {op: 'configure', pid: 'p1', allow: ['ana@ejemplo.test']})).status, 200);
    assert.deepEqual((await w.manage(ana, {op: 'configure', pid: 'p1', stage: 'doing'})).body, {error: 'stage'});
    /* Volver a «la primera» se guarda como vacío. */
    assert.equal((await w.manage(ana, {op: 'configure', pid: 'p1', stage: ''})).body.stageMissing, false);
  });

  await test('adjuntos: se guardan en trozos como los de la app y se recomponen byte a byte', async () => {
    const w = world();
    const address = await personal(w);
    const big = nodeCrypto.randomBytes(1500000);
    const small = Buffer.from('%PDF-1.7 contenido');
    const out = await w.send(address, {subject: 'Con dos adjuntos', text: 'Van adjuntos', attachments: [{name: 'copia.bin', data: big}, {name: 'informe año.pdf', type: 'application/pdf', data: small}]});
    assert.deepEqual([out.result, out.files, out.refused], ['created', 2, 0]);
    const path = 'users/ana/projects/p1/tasks/' + out.taskId;
    const notes = w.notes(path);
    assert.equal(notes.length, 2);
    const files = notes[1];
    assert.deepEqual([files.kind, files.text, files.imageAssetId, files.actorUid], ['note', '', '', '']);
    assert.deepEqual(files.attachments.map((a) => [a.name, a.type, a.size, a.image, a.parts.length]), [['copia.bin', 'application/octet-stream', 1500000, false, 3], ['informe año.pdf', 'application/pdf', small.length, false, 1]]);
    assert.deepEqual(files.assetIds, files.attachments[0].parts.concat(files.attachments[1].parts));
    assert.deepEqual(Object.keys(files).sort(), ['actorName', 'actorUid', 'assetIds', 'attachments', 'createdAt', 'imageAssetId', 'kind', 'text'], 'solo los campos que la app admite en una nota');
    const read = (a) => Buffer.concat(a.parts.map((id) => {
      const doc = w.store.data('users/ana/assets/' + id);
      assert.deepEqual(Object.keys(doc).sort(), ['contentType', 'createdAt', 'data']);
      assert.ok(doc.data.length < 900000, 'cada trozo cabe en un documento');
      assert.ok(doc.data.indexOf('data:application/octet-stream;base64,') === 0);
      return Buffer.from(doc.data.slice(doc.data.indexOf(',') + 1), 'base64');
    }));
    assert.ok(read(files.attachments[0]).equals(big));
    assert.ok(read(files.attachments[1]).equals(small));
    assert.equal(w.store.paths('users/ana/assets/').length, 4);
    assert.equal(w.store.data(w.store.paths('mail_seen/')[0]).files, 'done');
  });

  await test('adjuntos que no se guardan: ejecutables, tipos no permitidos, más de 10 MB, vacíos y de más', async () => {
    const w = world();
    const address = await personal(w);
    const out = await w.send(address, {subject: 'Mezcla', text: 'x', attachments: [
      {name: 'bueno.txt', data: 'vale', type: 'text/plain'},
      {name: 'instalar.exe', data: 'MZ\x90\x00\x03'},
      {name: 'foto.jpg', type: 'image/jpeg', data: 'MZ\x90\x00 disfrazado'},
      {name: '../../../pagina.html', type: 'text/html', data: '<script>alert(1)</script>'},
      {name: 'enorme.zip', type: 'application/zip', data: Buffer.alloc(10 * 1024 * 1024 + 1, 1)},
      {name: 'vacio.txt', data: ''}
    ]});
    assert.deepEqual([out.result, out.files, out.refused], ['created', 1, 5]);
    const notes = w.notes('users/ana/projects/p1/tasks/' + out.taskId);
    assert.equal(notes[1].text, 'Adjuntos del correo que no se guardaron: instalar.exe (tipo no permitido), foto.jpg (tipo no permitido), pagina.html (tipo no permitido), enorme.zip (más de 10 MB), vacio.txt (vacío).');
    assert.equal(notes[1].kind, 'activity');
    assert.deepEqual(notes[2].attachments.map((a) => [a.name, a.size]), [['bueno.txt', 4]]);
    /* Justo 10 MB sí entra. */
    const exact = await w.send(address, {subject: 'Justo', text: 'x', attachments: [{name: 'justo.zip', type: 'application/zip', data: Buffer.alloc(10 * 1024 * 1024, 2)}]});
    assert.deepEqual([exact.files, exact.refused], [1, 0]);
    assert.equal(w.notes('users/ana/projects/p1/tasks/' + exact.taskId)[1].attachments[0].size, 10 * 1024 * 1024);
    /* Dos de 10 MB ya no caben en un mensaje (25 MiB con su codificación): se rechaza entero, con el motivo. */
    const two = await w.send(address, {subject: 'Dos grandes', text: 'x', attachments: [{name: 'a.zip', data: Buffer.alloc(10 * 1024 * 1024, 3)}, {name: 'b.zip', data: Buffer.alloc(10 * 1024 * 1024, 4)}]});
    assert.deepEqual([two.result, two.code], ['rejected', 'size']);
    const stored = JSON.stringify(w.store.paths('users/ana/assets/').map((p) => w.store.data(p).data.slice(0, 80)));
    assert.ok(stored.indexOf(Buffer.from('<script>').toString('base64').slice(0, 8)) === -1, 'lo rechazado no se guarda en ningún sitio');
    /* Más de 10 archivos: los diez primeros. */
    const many = await w.send(address, {subject: 'Doce', text: 'x', attachments: Array.from({length: 12}, (x, i) => ({name: 'f' + i + '.txt', data: 'contenido ' + i}))});
    assert.deepEqual([many.files, many.refused], [10, 2]);
    assert.match(w.notes('users/ana/projects/p1/tasks/' + many.taskId)[1].text, /f10\.txt \(demasiados adjuntos\), f11\.txt \(demasiados adjuntos\)\.$/);
    /* Plan gratuito: el tope total es menor. */
    const free = Object.assign({}, ENV, {CAPTURE_PLAN: 'free'});
    assert.deepEqual(C.limitsOf(free), {messageBytes: 8 * 1024 * 1024, filesBytes: 6 * 1024 * 1024, fileBytes: 10 * 1024 * 1024, files: 10, ms: 20000});
    assert.equal(C.limitsOf({}).messageBytes, 8 * 1024 * 1024, 'sin decir nada, el gratuito');
    assert.equal(C.limitsOf({CAPTURE_PLAN: 'paid', CAPTURE_MAX_MESSAGE_MB: '12'}).messageBytes, 12 * 1024 * 1024);
    const tight = await w.send(address, {subject: 'Gratuito', text: 'x', attachments: [{name: 'a.bin', data: Buffer.alloc(3 * 1024 * 1024, 3)}, {name: 'b.bin', data: Buffer.alloc(2 * 1024 * 1024 - 300000, 4)}, {name: 'c.txt', data: 'pequeño'}]}, {env: free});
    assert.deepEqual([tight.result, tight.files, tight.refused], ['created', 3, 0], 'por debajo del tope total, entran todos');
    const over = await w.send(address, {subject: 'Gratuito de más', text: 'x', attachments: [{name: 'a.bin', data: Buffer.alloc(4 * 1024 * 1024, 5), encoding: '8bit'}, {name: 'b.bin', data: Buffer.alloc(2 * 1024 * 1024 + 1024, 6), encoding: '8bit'}]}, {env: free});
    assert.deepEqual([over.files, over.refused], [1, 1]);
    assert.match(w.notes('users/ana/projects/p1/tasks/' + over.taskId)[1].text, /b\.bin \(el correo supera el tamaño admitido\)\.$/);
  });

  await test('un mensaje demasiado grande se rechaza antes de leerlo, con el motivo', async () => {
    const w = world();
    const address = await personal(w);
    const free = Object.assign({}, ENV, {CAPTURE_PLAN: 'free'});
    const raw = buildMail({to: address, subject: 'Grande', text: 'x', attachments: [{name: 'a.bin', data: Buffer.alloc(7 * 1024 * 1024, 1)}]});
    let read = false;
    const msg = message(raw, address);
    Object.defineProperty(msg, 'raw', {get: () => { read = true; return raw; }});
    const reads = w.store.reads;
    const out = await C.receive(msg, free, w.deps);
    assert.deepEqual([out.result, out.code, msg.rejected], ['rejected', 'size', 'Message too large for this address (limit 8 MB).']);
    assert.equal(read, false);
    assert.equal(w.store.reads, reads);
    /* Si el tamaño declarado miente, cuenta el real. */
    const liar = message(raw, address);
    liar.rawSize = 100;
    assert.equal((await C.receive(liar, free, w.deps)).code, 'size');
    assert.equal(w.tasks('users/ana/projects/p1').length, 0);
  });

  await test('duplicados: reintentos, entregas repetidas y el mismo correo reenviado no crean otra tarea', async () => {
    const w = world();
    const address = await personal(w);
    const mail = {subject: 'Una sola vez', text: 'Cuerpo del mensaje', messageId: 'unico@ejemplo.test', attachments: [{name: 'a.txt', data: 'adjunto'}]};
    assert.equal((await w.send(address, mail)).result, 'created');
    /* Reintento del servidor de correo: el mismo mensaje, tal cual. */
    const retry = await w.send(address, mail);
    assert.deepEqual([retry.result, retry.code, retry.rejected], ['dropped', 'duplicate', null], 'se acepta en silencio: un rechazo haría rebotar un correo que sí entró');
    /* Reenviado: otro Message-ID y «Fwd:» delante, mismo contenido. */
    assert.equal((await w.send(address, Object.assign({}, mail, {messageId: 'otro@ejemplo.test', subject: 'Fwd: RE: Una sola vez'}))).code, 'duplicate');
    /* El mismo Message-ID con otro contenido (un servidor que reescribe el cuerpo): también es el mismo mensaje. */
    assert.equal((await w.send(address, Object.assign({}, mail, {text: 'Cuerpo reescrito'}))).code, 'duplicate');
    /* Por la dirección de respaldo, lo mismo. */
    assert.equal((await w.send(address.replace('in.kanlane.test', 'respaldo.kanlane.test'), mail)).code, 'duplicate');
    assert.equal(w.tasks('users/ana/projects/p1').length, 1);
    assert.equal(w.store.paths('users/ana/assets/').length, 1, 'ni adjuntos repetidos');
    /* Sin Message-ID: decide el contenido. */
    const bare = {subject: 'Sin identificador', text: 'Mismo texto', messageId: null};
    assert.equal((await w.send(address, bare)).result, 'created');
    assert.equal((await w.send(address, bare)).code, 'duplicate');
    assert.equal((await w.send(address, Object.assign({}, bare, {text: 'Mismo   texto\r\n'}))).code, 'duplicate', 'los espacios no cuentan');
    assert.equal((await w.send(address, Object.assign({}, bare, {text: 'Otro texto'}))).result, 'created');
    /* Lo que NO es un duplicado: mismo asunto y cuerpo con otro adjunto, o mismo cuerpo con otro asunto. */
    assert.equal((await w.send(address, {subject: 'Una sola vez', text: 'Cuerpo del mensaje', attachments: [{name: 'a.txt', data: 'otro adjunto'}]})).result, 'created');
    assert.equal((await w.send(address, {subject: 'Otra cosa', text: 'Cuerpo del mensaje', attachments: [{name: 'a.txt', data: 'adjunto'}]})).result, 'created');
    assert.equal(w.tasks('users/ana/projects/p1').length, 5);
  });

  await test('duplicados: no chocan entre proyectos, aguantan dos entregas a la vez y caducan a los 30 días', async () => {
    const w = world();
    const one = await personal(w, 'p1');
    const two = await personal(w, 'p2');
    const mail = {subject: 'A los dos', text: 'Mismo correo', messageId: 'compartido@ejemplo.test'};
    assert.equal((await w.send(one, mail)).result, 'created');
    assert.equal((await w.send(two, mail)).result, 'created', 'el mismo mensaje a otro proyecto es otra tarea');
    /* Concurrencia: cinco entregas del mismo mensaje a la vez. */
    const burst = {subject: 'Ráfaga', text: 'A la vez', messageId: 'rafaga@ejemplo.test', attachments: [{name: 'a.txt', data: 'x'}]};
    const results = await Promise.all(Array.from({length: 5}, () => w.send(one, burst)));
    assert.deepEqual(results.map((r) => r.result).sort(), ['created', 'dropped', 'dropped', 'dropped', 'dropped']);
    assert.equal(w.tasks('users/ana/projects/p1').filter((t) => t.title === 'Ráfaga').length, 1);
    assert.equal(w.store.paths('users/ana/assets/').length, 1);
    /* Y sin Message-ID, que solo tienen la marca del contenido. */
    const bare = await Promise.all(Array.from({length: 4}, () => w.send(one, {subject: 'Ráfaga sin id', text: 'A la vez', messageId: null})));
    assert.equal(bare.filter((r) => r.result === 'created').length, 1);
    /* A los 29 días sigue siendo duplicado; pasados 30, entra otra vez (y la marca se renueva). */
    w.clock = NOW + 29 * 86400000;
    assert.equal((await w.send(one, mail)).code, 'duplicate');
    w.clock = NOW + 30 * 86400000 + 1;
    assert.equal((await w.send(one, mail)).result, 'created');
    assert.equal((await w.send(one, mail)).code, 'duplicate');
    const mark = w.store.data(w.store.paths('mail_seen/').find((p) => w.store.data(p).at === w.clock));
    assert.deepEqual([mark.expireAt, mark.key], [w.clock + 30 * 86400000, 'u~ana~p1']);
    assert.ok(mark.ttl, 'lleva la fecha con la que Firestore puede borrarla sola');
  });

  await test('fallo parcial: si los adjuntos no se pueden guardar, la tarea queda, lo dice y no hay trozos sueltos', async () => {
    const w = world();
    const address = await personal(w);
    const mail = {subject: 'Adjuntos que fallan', text: 'x', messageId: 'falla@ejemplo.test', attachments: [{name: 'a.bin', data: nodeCrypto.randomBytes(6 * 1024 * 1024)}, {name: 'b.bin', data: nodeCrypto.randomBytes(4 * 1024 * 1024)}]};
    /* La primera tanda de trozos entra y la segunda falla. */
    let assetCommits = 0;
    w.store.failWhen = (writes) => writes.some((x) => x.create && x.path.indexOf('/assets/') !== -1) && ++assetCommits === 2;
    const out = await w.send(address, mail);
    assert.deepEqual([out.result, out.code, out.rejected, out.files], ['created', 'files-failed', null, 0]);
    w.store.failWhen = null;
    assert.equal(w.store.paths('users/ana/assets/').length, 0, 'los trozos que llegaron a escribirse se borran');
    const path = 'users/ana/projects/p1/tasks/' + out.taskId;
    assert.equal(w.store.data(path).title, 'Adjuntos que fallan');
    assert.deepEqual(w.notes(path).map((n) => n.text), ['Creada desde un correo de ana@ejemplo.test.', 'No se pudieron guardar los adjuntos del correo (2).']);
    assert.equal(w.store.data(w.store.paths('mail_seen/')[0]).files, 'failed');
    /* Un reintento no crea otra tarea ni vuelve a intentarlo sin fin. */
    assert.equal((await w.send(address, mail)).code, 'duplicate');
    assert.equal(w.tasks('users/ana/projects/p1').length, 1);

    /* Si lo que falla es crear la tarea, no queda nada y el fallo se propaga: quien envía reintenta. */
    const w2 = world();
    const a2 = await personal(w2);
    w2.store.failWhen = (writes) => writes.some((x) => x.create && /\/tasks\/[^/]+$/.test(x.path));
    await assert.rejects(w2.send(a2, mail), /503/);
    w2.store.failWhen = null;
    assert.equal(w2.tasks('users/ana/projects/p1').length + w2.store.paths('mail_seen').length + w2.store.paths('users/ana/assets').length, 0);
    const second = await w2.send(a2, mail);
    assert.deepEqual([second.result, second.files], ['created', 2], 'el reintento entra entero');
  });

  await test('proceso cortado a medias (límite de CPU): un reintento posterior retoma los adjuntos sin crear otra tarea', async () => {
    const w = world();
    const address = await personal(w);
    const data = nodeCrypto.randomBytes(900000);
    const mail = {subject: 'Se corta', text: 'x', messageId: 'corte@ejemplo.test', attachments: [{name: 'a.bin', data: data}]};
    /* Tras crear la tarea no vuelve a poder escribir nada: ni adjuntos, ni limpieza, ni aviso. */
    let created = false;
    w.store.failWhen = (writes) => { if (created) return true; created = writes.some((x) => x.create && /\/tasks\/[^/]+$/.test(x.path)); return false; };
    const cut = await w.send(address, mail);
    assert.equal(cut.code, 'files-failed');
    w.store.failWhen = null;
    assert.equal(w.store.data(w.store.paths('mail_seen/')[0]).files, 'working', 'queda apuntado que estaba a medias');
    assert.equal(w.notes('users/ana/projects/p1/tasks/' + cut.taskId).length, 1);
    /* Un reintento inmediato no lo toca (podría seguir en marcha). */
    w.clock = NOW + 60000;
    assert.equal((await w.send(address, mail)).code, 'duplicate');
    /* Pasados diez minutos, dos reintentos a la vez: solo uno lo retoma. */
    w.clock = NOW + 11 * 60000;
    const both = await Promise.all([w.send(address, mail), w.send(address, mail)]);
    assert.deepEqual(both.map((r) => r.code).sort(), ['duplicate', 'files-resumed']);
    assert.equal(both.find((r) => r.code === 'files-resumed').taskId, cut.taskId);
    assert.equal(w.tasks('users/ana/projects/p1').length, 1, 'sigue habiendo una sola tarea');
    const notes = w.notes('users/ana/projects/p1/tasks/' + cut.taskId);
    assert.equal(notes.length, 2);
    const stored = Buffer.concat(notes[1].attachments[0].parts.map((id) => Buffer.from(w.store.data('users/ana/assets/' + id).data.split(',')[1], 'base64')));
    assert.ok(stored.equals(data));
    assert.equal((await w.send(address, mail)).code, 'duplicate');
    assert.equal(w.store.paths('users/ana/assets/').length, 2);
  });

  await test('tiempo de proceso: si se agota guardando adjuntos, se para y lo dice', async () => {
    const w = world();
    const address = await personal(w);
    const free = Object.assign({}, ENV, {CAPTURE_PLAN: 'free'});
    const real = w.store.commit;
    w.store.commit = async (writes) => { w.clock += 15000; return real(writes); };
    const out = await w.send(address, {subject: 'Lento', text: 'x', attachments: [{name: 'a.bin', data: nodeCrypto.randomBytes(5 * 1024 * 1024)}]}, {env: free});
    assert.equal(out.code, 'files-failed');
    assert.equal(w.store.paths('users/ana/assets/').length, 0);
    assert.match(w.logs.join('\n'), /adjuntos sin guardar \(timeout\)/);
  });

  await test('correo masivo, respuestas automáticas y bucles: límites sin rebotes', async () => {
    const w = world();
    const address = await personal(w);
    /* 20 por remitente y hora. */
    for (let i = 0; i < 20; i++) assert.equal((await w.send(address, {subject: 'Mensaje ' + i, text: 'x'})).result, 'created');
    const over = await w.send(address, {subject: 'Mensaje 21', text: 'x'});
    assert.deepEqual([over.result, over.code, over.rejected], ['rejected', 'rate', 'Too many messages for this project. Try again later.']);
    /* A la hora siguiente vuelve a entrar. */
    w.clock = NOW + 3600000;
    assert.equal((await w.send(address, {subject: 'Otra hora', text: 'x'})).result, 'created');
    const rate = w.store.data('mail_rate/u~ana~p1~20261007');
    assert.deepEqual([rate.n, rate.h09, rate.h10, rate.day], [21, 20, 1, '20261007']);
    assert.ok(Object.keys(rate).every((k) => k.indexOf('ana') === -1 && k.indexOf('@') === -1), 'el contador no guarda la dirección del remitente');
    /* Respuestas automáticas, rebotes y boletines: se descartan sin rechazo (no hay a quién contestar sin provocar otro). */
    const quiet = async (o, opts) => { const out = await w.send(address, Object.assign({subject: 'Auto ' + Math.random(), text: 'x'}, o), opts); assert.equal(out.result, 'dropped', JSON.stringify(out)); assert.equal(out.rejected, null); return out.code; };
    assert.equal(await quiet({headers: [['Auto-Submitted', 'auto-replied']]}), 'auto-submitted');
    assert.equal(await quiet({headers: [['Precedence', 'bulk']]}), 'bulk');
    assert.equal(await quiet({headers: [['List-Unsubscribe', '<mailto:baja@ejemplo.test>']]}), 'list');
    assert.equal(await quiet({headers: [['X-Auto-Response-Suppress', 'OOF, AutoReply']]}), 'auto-reply');
    assert.equal(await quiet({}, {envelope: ''}), 'bounce');
    assert.equal(await quiet({}, {envelope: 'MAILER-DAEMON@ejemplo.test'}), 'bounce');
    assert.equal(await quiet({headers: Array.from({length: 51}, (x, i) => ['Received', 'from a' + i + ' by b'])}), 'loop');
    assert.equal(w.tasks('users/ana/projects/p1').length, 21);
    /* Tope del proyecto por hora (30) con varios remitentes. */
    const t = world();
    t.store.put('teams/t1', teamDoc());
    const team = (await t.manage(ana, {op: 'enable', tid: 't1'})).body.address;
    for (let i = 0; i < 30; i++) assert.equal((await t.send(team, {from: i % 2 ? 'ana@ejemplo.test' : 'bob@ejemplo.test', subject: 'Equipo ' + i, text: 'x'})).result, 'created');
    assert.equal((await t.send(team, {from: 'ana@ejemplo.test', subject: 'Equipo 31', text: 'x'})).code, 'rate');
  });

  await test('proyecto borrado, cuenta eliminada o proyecto que pasa a cifrado total: sin tareas y sin dirección', async () => {
    const w = world();
    const address = await personal(w);
    /* Se borra el proyecto sin haber desactivado la captura. */
    w.store.docs.delete('users/ana/projects/p1');
    rejectedAsUnknown(await w.send(address, {subject: 'A un proyecto borrado', text: 'x'}));
    assert.equal(w.store.paths('mail_capture').length, 0, 'la dirección se retira sola');
    assert.equal(w.store.paths('users/').length, 0);
    /* El principal, marcado como eliminado. */
    const main = (await w.manage(ana, {op: 'enable', pid: 'main'})).body.address;
    w.store.put('users/ana/projects/main', {deleted: true, createdAt: 0});
    rejectedAsUnknown(await w.send(main, {subject: 'Al principal eliminado', text: 'x'}));
    assert.equal((await w.manage(ana, {op: 'status', pid: 'main'})).status, 404);
    /* Un equipo borrado. */
    w.store.put('teams/t1', teamDoc());
    const team = (await w.manage(ana, {op: 'enable', tid: 't1'})).body.address;
    w.store.docs.delete('teams/t1');
    rejectedAsUnknown(await w.send(team, {subject: 'A un equipo borrado', text: 'x'}));
    /* Eliminar la cuenta: se van todas sus direcciones de una vez, también las de sus equipos. */
    w.store.put('users/ana/projects/p2', {nombre: 'Dos'});
    w.store.put('users/ana/projects/p3', {nombre: 'Tres'});
    w.store.put('teams/t2', teamDoc());
    w.store.put('users/bob/projects/b1', {nombre: 'De Bob'});
    const mine = [(await w.manage(ana, {op: 'enable', pid: 'p2'})).body.address, (await w.manage(ana, {op: 'enable', pid: 'p3'})).body.address, (await w.manage(ana, {op: 'enable', tid: 't2'})).body.address];
    const his = (await w.manage(bob, {op: 'enable', pid: 'b1'})).body.address;
    assert.deepEqual((await w.manage(ana, {op: 'purge'})).body, {v: 1, removed: 3});
    for (const a of mine) rejectedAsUnknown(await w.send(a, {subject: 'Tras eliminar la cuenta ' + a, text: 'x'}));
    assert.equal((await w.send(his, {from: 'bob@ejemplo.test', subject: 'Lo de Bob sigue', text: 'x'})).result, 'created');
    assert.deepEqual(w.store.paths('mail_capture_cfg/'), ['mail_capture_cfg/u~bob~b1']);
    /* Cifrado total: ni se activa, ni sobrevive una dirección de antes. */
    w.store.put('users/bob/projects/b1', {nombre: 'De Bob', enc: {v: 1, mode: 'pw', kid: 'k'}});
    rejectedAsUnknown(await w.send(his, {from: 'bob@ejemplo.test', subject: 'A un proyecto cifrado', text: 'texto que no debe guardarse en claro'}));
    assert.equal(w.store.paths('mail_capture').length, 0);
    assert.equal(w.tasks('users/bob/projects/b1').filter((t) => t.title === 'A un proyecto cifrado').length, 0);
    const status = await w.manage(bob, {op: 'status', pid: 'b1'});
    assert.deepEqual([status.status, status.body.available, status.body.reason, status.body.on], [200, false, 'encrypted', false]);
    assert.deepEqual((await w.manage(bob, {op: 'enable', pid: 'b1'})).body, {error: 'encrypted'});
    w.store.put('teams/t3', teamDoc({enc: {v: 1, mode: 'pw', kid: 'k'}}));
    assert.equal((await w.manage(ana, {op: 'enable', tid: 't3'})).status, 409);
  });

  await test('los registros no llevan direcciones, tokens ni contenido', async () => {
    const w = world();
    const address = await personal(w);
    await w.send(address, {subject: 'Asunto reservado', text: 'Cuerpo reservado', attachments: [{name: 'nomina.pdf', data: '%PDF', type: 'application/pdf'}]});
    await w.send(address, {subject: 'Asunto reservado', text: 'Cuerpo reservado', attachments: [{name: 'nomina.pdf', data: '%PDF', type: 'application/pdf'}]});
    await w.send(address, {from: 'dave@otra.test', subject: 'Extraño', text: 'x'});
    await w.send('a'.repeat(32) + '@in.kanlane.test', {subject: 'x', text: 'x'});
    await w.send(address, {subject: 'Auto', text: 'x', headers: [['Auto-Submitted', 'auto-generated']]});
    const logs = w.logs.join('\n');
    assert.deepEqual(w.logs, ['captura: tarea creada con 1 adjuntos', 'captura: descartado (duplicate)', 'captura: rechazado (sender-member)', 'captura: rechazado (address)', 'captura: descartado (auto-submitted)']);
    [address, address.split('@')[0], 'ana@', 'dave@', 'reservado', 'nomina', 'p1'].forEach((secret) => assert.ok(logs.indexOf(secret) === -1, secret));
  });

  console.log('\n' + passed + ' pruebas correctas');
})().catch((err) => { console.error(err); process.exit(1); });
