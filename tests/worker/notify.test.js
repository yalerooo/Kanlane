/* Avisos push (worker/notify.mjs): suscripciones, a quién se avisa y con qué texto, con una base de
   datos en memoria y un servicio de push de mentira que guarda lo que recibe.
   Uso: node tests/worker/notify.test.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {memoryStore} = require('./mail-fixtures.js');

const NOW = Date.UTC(2026, 9, 8, 9, 0, 0);
const STAGES = [{key: 'todo', label: 'Por hacer'}, {key: 'doing', label: 'En curso'}, {key: 'done', label: 'Hecho', done: true}];
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/* Un navegador de mentira: sus claves, y cómo abre lo que le llega (RFC 8291, lado receptor). */
function browser(host) {
  const ecdh = nodeCrypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const b = {endpoint: 'https://' + (host || 'fcm.googleapis.com') + '/fcm/send/' + b64url(nodeCrypto.randomBytes(12)), p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth)};
  b.open = (body) => {
    const buf = Buffer.from(body);
    const salt = buf.subarray(0, 16), idlen = buf[20], as = buf.subarray(21, 21 + idlen), data = buf.subarray(21 + idlen);
    const secret = ecdh.computeSecret(as);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), as]);
    const ikm = Buffer.from(nodeCrypto.hkdfSync('sha256', secret, auth, info, 32));
    const cek = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
  };
  return b;
}

(async () => {
  const M = await import(pathToFileURL(path.join(__dirname, '../../worker/notify.mjs')).href);
  const W = await import(pathToFileURL(path.join(__dirname, '../../worker/webpush.mjs')).href);
  const keys = await W.generateVapidKeys();
  const ENV = {VAPID_PUBLIC: keys.publicKey, VAPID_PRIVATE: keys.privateKey, VAPID_SUBJECT: 'mailto:avisos@kanlane.test'};
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('ok   ' + name); };

  /* Un mundo: la base de datos, el servicio de push (lo enviado y qué responde) y el equipo t1. */
  function world(teamOver) {
    const w = {store: memoryStore(), clock: NOW, sent: [], status: {}};
    w.deps = {store: w.store, now: () => w.clock, fetch: async (url, init) => {
      w.sent.push({url: url, headers: init.headers, body: init.body});
      return new Response('', {status: w.status[url] || 201});
    }};
    w.manage = (uid, body, env) => M.manage({uid: uid}, body, env || ENV, w.deps);
    w.event = (uid, body) => w.manage(uid, Object.assign({op: 'event', tid: 't1', taskId: 'a'}, body));
    w.browsers = {};
    /* Activa los avisos de `uid` en un navegador nuevo y lo devuelve. */
    w.join = async (uid, lang, host) => {
      const b = browser(host);
      const out = await w.manage(uid, {op: 'subscribe', endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth, lang: lang || 'es'});
      assert.deepEqual([out.status, out.body], [200, {v: 1, on: true}]);
      w.browsers[b.endpoint] = b;
      return b;
    };
    /* Lo que ha recibido un navegador, ya descifrado. */
    w.got = (b) => w.sent.filter((s) => s.url === b.endpoint).map((s) => b.open(s.body));
    w.subs = () => w.store.paths('push_subs/').map((p) => w.store.data(p));
    w.store.put('teams/t1', Object.assign({nombre: 'Estudio', ownerUid: 'ana', memberIds: ['ana', 'bob', 'carol', 'dave'], tipo: 'personalizado', stages: STAGES,
      members: {ana: {role: 'owner', name: 'Ana'}, bob: {role: 'editor', name: 'Bob'}, carol: {role: 'viewer', name: 'Carol'}, dave: {role: 'editor', name: 'Dave'}}}, teamOver));
    w.store.put('teams/t1/tasks/a', {title: 'Portada nueva', status: 'doing', assignees: ['bob'], followers: ['carol', 'ana']});
    return w;
  }

  await test('sin las claves VAPID o sin base de datos no hay avisos', async () => {
    const w = world();
    assert.equal((await w.manage('ana', {op: 'key'}, {})).status, 503);
    assert.equal((await w.manage('ana', {op: 'key'}, Object.assign({}, ENV, {VAPID_SUBJECT: 'nadie'}))).status, 503);
    assert.equal((await M.manage({uid: 'ana'}, {op: 'key'}, ENV, {now: () => NOW})).status, 503, 'sin cuenta de servicio');
    assert.deepEqual((await w.manage('ana', {op: 'key'})).body, {v: 1, key: keys.publicKey});
    assert.equal((await w.manage('ana', {op: 'otra'})).status, 400);
    assert.equal((await w.manage('ana', null)).status, 400);
  });

  await test('activar y quitar los avisos en un navegador', async () => {
    const w = world();
    const b = await w.join('bob', 'en');
    assert.deepEqual(w.subs().map((s) => [s.uid, s.endpoint, s.lang, s.createdAt]), [['bob', b.endpoint, 'en', NOW]]);
    const commits = w.store.commits;
    assert.equal((await w.manage('bob', {op: 'subscribe', endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth, lang: 'en'})).status, 200);
    assert.equal(w.store.commits, commits, 'repetirlo al abrir la app no escribe nada');
    /* Lo que no es un servicio de push conocido no se guarda: el Worker no manda nada a otro sitio. */
    for (const endpoint of ['https://evil.test/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.test/x', '', null]) {
      assert.deepEqual((await w.manage('bob', {op: 'subscribe', endpoint: endpoint, p256dh: b.p256dh, auth: b.auth})).body, {error: 'endpoint'});
    }
    assert.equal((await w.manage('bob', {op: 'subscribe', endpoint: b.endpoint, p256dh: 'corta', auth: b.auth})).status, 400);
    /* Otra persona no puede quitar la suscripción de Bob; Bob sí. */
    await w.manage('ana', {op: 'unsubscribe', endpoint: b.endpoint});
    assert.equal(w.subs().length, 1);
    assert.deepEqual((await w.manage('bob', {op: 'unsubscribe', endpoint: b.endpoint})).body, {v: 1, on: false});
    assert.equal(w.subs().length, 0);
  });

  await test('el mismo navegador con otra cuenta pasa a ser de esa cuenta; tope de navegadores por cuenta', async () => {
    const w = world();
    const b = await w.join('bob');
    await w.manage('ana', {op: 'subscribe', endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth, lang: 'es'});
    assert.deepEqual(w.subs().map((s) => s.uid), ['ana']);
    const first = await w.join('dave');
    for (let i = 1; i < M.LIMITS.subs + 2; i++) { w.clock += 1000; await w.join('dave'); }
    const mine = w.subs().filter((s) => s.uid === 'dave');
    assert.equal(mine.length, M.LIMITS.subs);
    assert.ok(!mine.some((s) => s.endpoint === first.endpoint), 'se retira el más antiguo');
    assert.deepEqual((await w.manage('dave', {op: 'purge'})).body, {v: 1, removed: M.LIMITS.subs});
    assert.deepEqual(w.subs().map((s) => s.uid), ['ana'], 'al eliminar la cuenta se van las suyas, no las de otros');
  });

  await test('comentario: aviso de mención al mencionado y de comentario a quien sigue la tarea', async () => {
    const w = world();
    const bob = await w.join('bob'), carol = await w.join('carol', 'en'), ana = await w.join('ana'), dave = await w.join('dave');
    const out = await w.event('ana', {kind: 'comment', to: ['bob', 'ana', 'nadie']});
    assert.deepEqual([out.status, out.body], [200, {v: 1, sent: 2}]);
    assert.deepEqual(w.got(bob), [{title: 'Ana te mencionó', body: '«Portada nueva» · Estudio', tag: 'kl-a', project: 't:t1', task: 'a'}]);
    assert.deepEqual(w.got(carol), [{title: 'Ana commented on a task you follow', body: '«Portada nueva» · Estudio', tag: 'kl-a', project: 't:t1', task: 'a'}], 'en su idioma');
    assert.deepEqual(w.got(ana), [], 'a quien lo provoca no se le avisa, aunque siga la tarea o se mencione');
    assert.deepEqual(w.got(dave), [], 'ni a quien no sigue la tarea');
    assert.match(w.sent[0].headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.equal(w.sent[0].headers['Content-Encoding'], 'aes128gcm');
    assert.ok(JSON.stringify(w.sent.map((s) => Buffer.from(s.body).toString('latin1'))).indexOf('Portada') === -1, 'el contenido va cifrado para el navegador');
    /* Mencionado que además sigue la tarea: un solo aviso, el de la mención. */
    w.sent.length = 0;
    await w.event('bob', {kind: 'comment', to: ['carol']});
    assert.deepEqual(w.got(carol).map((m) => m.title), ['Bob mentioned you']);
    assert.deepEqual(w.got(ana).map((m) => m.title), ['Bob comentó en una tarea que sigues']);
  });

  await test('asignación: solo a quien de verdad está asignado; mover: a quien sigue, con la columna', async () => {
    const w = world();
    const bob = await w.join('bob'), carol = await w.join('carol'), dave = await w.join('dave');
    assert.deepEqual((await w.event('ana', {kind: 'assigned', to: ['bob', 'dave']})).body, {v: 1, sent: 1});
    assert.deepEqual(w.got(bob).map((m) => [m.title, m.body]), [['Ana te asignó una tarea', '«Portada nueva» · Estudio']]);
    assert.deepEqual(w.got(dave), [], 'Dave no está en assignees: el navegador no decide a quién se avisa');
    assert.deepEqual(w.got(carol), [], 'una asignación no avisa a quien sigue la tarea');
    w.sent.length = 0;
    assert.deepEqual((await w.event('bob', {kind: 'moved'})).body, {v: 1, sent: 1});
    assert.deepEqual(w.got(carol).map((m) => [m.title, m.body]), [['Bob movió una tarea que sigues', '«Portada nueva» → En curso']]);
  });

  await test('quién puede provocar avisos: editores y propietario del equipo, no lectores ni gente de fuera', async () => {
    const w = world();
    const bob = await w.join('bob');
    assert.deepEqual([(await w.event('carol', {kind: 'comment', to: ['bob']})).status, (await w.event('eve', {kind: 'comment', to: ['bob']})).status], [403, 404]);
    assert.equal((await w.manage('ana', {op: 'event', tid: 'otro', taskId: 'a', kind: 'comment', to: ['bob']})).status, 404);
    assert.equal((await w.event('ana', {kind: 'comment', taskId: 'nohay', to: ['bob']})).status, 404);
    assert.equal((await w.event('ana', {kind: 'borrar'})).status, 400);
    assert.equal((await w.event('ana', {kind: 'comment', taskId: '../x'})).status, 400);
    assert.deepEqual(w.got(bob), []);
    /* Alguien que ya no está en el equipo no recibe nada aunque siguiera la tarea. */
    await w.join('carol');
    w.store.put('teams/t1', Object.assign(w.store.data('teams/t1'), {memberIds: ['ana', 'bob', 'dave']}));
    assert.deepEqual((await w.event('bob', {kind: 'comment'})).body, {v: 1, sent: 0}, 'Ana sigue la tarea pero no tiene avisos activados; Carol ya no es miembro');
  });

  await test('proyecto con cifrado total: el aviso solo dice que hay novedades', async () => {
    const w = world({enc: {v: 1, mode: 'pw', pid: 'p'.repeat(16), kid: 'k'.repeat(8), kcv: 'x'}});
    w.store.put('teams/t1/tasks/a', {status: 'doing', assignees: ['bob'], followers: ['carol'], e: 'AAAA', ev: 1, kid: 'k'.repeat(8)});
    const bob = await w.join('bob'), carol = await w.join('carol', 'en');
    await w.event('ana', {kind: 'comment', to: ['bob']});
    assert.deepEqual(w.got(bob), [{title: 'Kanlane', body: 'Tienes novedades en «Estudio»', tag: 'kl-a', project: 't:t1', task: 'a'}]);
    assert.deepEqual(w.got(carol).map((m) => m.body), ['There is news in «Estudio»']);
  });

  await test('una suscripción que el navegador ya no quiere se retira; un fallo pasajero no', async () => {
    const w = world();
    const bob = await w.join('bob'), carol = await w.join('carol');
    w.status[bob.endpoint] = 410;
    w.status[carol.endpoint] = 500;
    assert.deepEqual((await w.event('ana', {kind: 'comment', to: ['bob']})).body, {v: 1, sent: 0});
    assert.deepEqual(w.subs().map((s) => s.uid), ['carol']);
  });

  await test('tope diario por cuenta y limpieza de contadores', async () => {
    const w = world();
    await w.join('bob');
    await w.event('ana', {kind: 'comment', to: ['bob']});
    await w.event('ana', {kind: 'comment'});
    const rate = w.store.paths('notify_rate/');
    assert.equal(rate.length, 1);
    assert.equal(w.store.data(rate[0]).n, 2, 'cuenta también los que no tenían a quién avisar');
    w.store.put(rate[0], Object.assign(w.store.data(rate[0]), {n: M.LIMITS.eventsPerDay}));
    assert.deepEqual([(await w.event('ana', {kind: 'comment', to: ['bob']})).status, (await w.event('bob', {kind: 'comment'})).status], [429, 200]);
    w.clock += 86400000;
    assert.equal((await w.event('ana', {kind: 'comment', to: ['bob']})).status, 200, 'al día siguiente vuelve a poder');
    assert.deepEqual(await M.sweep(ENV, w.deps), {configured: true, rate: 0});
    w.clock += 5 * 86400000;
    assert.deepEqual(await M.sweep(ENV, w.deps), {configured: true, rate: 3});
    assert.deepEqual(w.store.paths('notify_rate/'), []);
    assert.deepEqual(await M.sweep({}, w.deps), {configured: false, rate: 0});
  });

  console.log('\n' + passed + ' pruebas correctas');
})().catch((err) => { console.error(err); process.exit(1); });
