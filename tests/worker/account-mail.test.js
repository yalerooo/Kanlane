/* Correos de la cuenta (worker/account-mail.mjs): a quién se escribe, con qué enlace y qué texto,
   los topes y qué pasa cuando algo falla, con una base de datos en memoria y un Firebase y un
   Resend de mentira que guardan lo que reciben.
   Uso: node tests/worker/account-mail.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {memoryStore} = require('./mail-fixtures.js');

const NOW = Date.UTC(2026, 9, 9, 9, 0, 0);
const KEY = nodeCrypto.generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({type: 'pkcs8', format: 'pem'});
const ENV = {MAIL_FROM: 'Kanlane <noreply@kanlane.com>', RESEND_API_KEY: 're_prueba', REDIRECT_TARGET: 'https://kanlane.com',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({client_email: 'worker@workhub-26f50.iam.gserviceaccount.com', private_key: KEY, project_id: 'workhub-26f50'})};
const ANA = {uid: 'ana', email: 'ana@ejemplo.test', emailVerified: false, name: 'Ana <b>López</b>'};

(async () => {
  const M = await import(pathToFileURL(path.join(__dirname, '../../worker/account-mail.mjs')).href);
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('ok   ' + name); };

  /* Un mundo: la base de datos, las cuentas que existen en Firebase y lo que llega a cada servicio. */
  function world(accounts) {
    const w = {store: memoryStore(), clock: NOW, accounts: accounts || ['ana@ejemplo.test'], oob: [], sent: [], resend: 200, codes: 0};
    w.deps = {store: w.store, now: () => w.clock, fetch: async (url, init) => {
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token: 'token-de-google', expires_in: 3600});
      if (url === 'https://identitytoolkit.googleapis.com/v1/projects/workhub-26f50/accounts:sendOobCode') {
        const body = JSON.parse(init.body);
        w.oob.push({auth: init.headers.authorization, body: body});
        if (w.accounts.indexOf(body.email) === -1) return Response.json({error: {message: 'EMAIL_NOT_FOUND'}}, {status: 400});
        return Response.json({email: body.email, oobLink: 'https://kanlane.com/__/auth/action?mode=x&oobCode=Codigo_' + (++w.codes) + '-abc&apiKey=clave&lang=es'});
      }
      if (url === 'https://api.resend.com/emails') {
        w.sent.push({auth: init.headers.authorization, mail: JSON.parse(init.body)});
        return Response.json({id: 'x'}, {status: w.resend});
      }
      throw new Error('petición inesperada: ' + url);
    }};
    w.manage = (who, body, env) => M.manage(who, body, env || ENV, w.deps);
    return w;
  }

  await test('sin configurar responde 503 y no llama a nadie', async () => {
    for (const env of [{}, Object.assign({}, ENV, {MAIL_FROM: ''}), Object.assign({}, ENV, {RESEND_API_KEY: ''}), Object.assign({}, ENV, {FIREBASE_SERVICE_ACCOUNT: ''})]) {
      const w = world();
      const deps = env.FIREBASE_SERVICE_ACCOUNT ? w.deps : {fetch: w.deps.fetch, now: w.deps.now};
      assert.deepEqual(await M.manage(ANA, {op: 'verify'}, env, deps), {status: 503, body: {error: 'not-configured'}});
      assert.equal(w.oob.length + w.sent.length, 0);
    }
  });

  await test('verificación: escribe al correo del token, con botón y enlace a la app', async () => {
    const w = world();
    const out = await w.manage(ANA, {op: 'verify', lang: 'es', email: 'otra@ejemplo.test'});
    assert.deepEqual(out, {status: 200, body: {v: 1, sent: true}});
    assert.deepEqual(w.oob, [{auth: 'Bearer token-de-google', body: {requestType: 'VERIFY_EMAIL', email: 'ana@ejemplo.test', returnOobLink: true}}]);
    assert.equal(w.sent.length, 1);
    const {auth, mail} = w.sent[0];
    assert.equal(auth, 'Bearer re_prueba');
    assert.equal(mail.from, 'Kanlane <noreply@kanlane.com>');
    assert.deepEqual(mail.to, ['ana@ejemplo.test'], 'el correo del cuerpo no cuenta');
    assert.equal(mail.subject, 'Verifica tu correo en Kanlane');
    const link = 'https://kanlane.com/app/?mode=verifyEmail&amp;oobCode=Codigo_1-abc&amp;lang=es';
    assert.ok(mail.html.includes('<a href="' + link + '" target="_blank" style="display:inline-block;'), 'el botón lleva el enlace');
    assert.ok(mail.html.includes('>Verificar correo</a>'));
    assert.ok(mail.html.includes('>' + link + '</a>'), 'y el enlace va también escrito, por si el botón no funciona');
    assert.ok(!mail.html.includes('apiKey'), 'sin la clave de la API');
    assert.ok(mail.html.includes('Hola, Ana &lt;b&gt;López&lt;/b&gt;:'), 'el nombre va escapado');
    assert.ok(mail.text.includes('https://kanlane.com/app/?mode=verifyEmail&oobCode=Codigo_1-abc&lang=es'), 'versión en texto');
  });

  await test('verificación: hace falta sesión, y una cuenta ya verificada no recibe nada', async () => {
    const w = world();
    assert.equal((await w.manage(null, {op: 'verify'})).status, 401);
    assert.equal((await w.manage({uid: 'ana', email: ''}, {op: 'verify'})).status, 401);
    assert.deepEqual(await w.manage(Object.assign({}, ANA, {emailVerified: true}), {op: 'verify'}), {status: 200, body: {v: 1, sent: false, verified: true}});
    assert.equal(w.oob.length + w.sent.length, 0);
  });

  await test('contraseña: en inglés, y sin nombre', async () => {
    const w = world();
    const out = await w.manage(null, {op: 'reset', email: ' Ana@Ejemplo.test ', lang: 'en'});
    assert.deepEqual(out, {status: 200, body: {v: 1, sent: true}});
    assert.equal(w.oob[0].body.requestType, 'PASSWORD_RESET');
    const mail = w.sent[0].mail;
    assert.deepEqual(mail.to, ['ana@ejemplo.test']);
    assert.equal(mail.subject, 'Reset your Kanlane password');
    assert.ok(mail.html.includes('mode=resetPassword&amp;oobCode=Codigo_1-abc&amp;lang=en'));
    assert.ok(mail.html.includes('>Change password</a>') && mail.html.includes('ana@ejemplo.test'));
  });

  await test('contraseña: un correo sin cuenta responde igual y no envía nada', async () => {
    const w = world();
    const known = await w.manage(null, {op: 'reset', email: 'ana@ejemplo.test'});
    const unknown = await w.manage(null, {op: 'reset', email: 'nadie@ejemplo.test'});
    assert.deepEqual(unknown, known);
    assert.deepEqual(w.sent.map((s) => s.mail.to[0]), ['ana@ejemplo.test']);
    for (const email of ['', 'sin-arroba', 'a@b', 'a b@c.de', 'x'.repeat(250) + '@c.de', 42]) {
      assert.equal((await w.manage(null, {op: 'reset', email: email})).status, 400, String(email));
    }
    assert.equal((await w.manage(null, {op: 'otra'})).status, 400);
  });

  await test('topes por cuenta y por correo, y limpieza de contadores', async () => {
    const w = world(['ana@ejemplo.test', 'bob@ejemplo.test']);
    for (let i = 0; i < M.LIMITS.verifyPerDay; i++) assert.equal((await w.manage(ANA, {op: 'verify'})).status, 200);
    assert.deepEqual(await w.manage(ANA, {op: 'verify'}), {status: 429, body: {error: 'rate'}});
    assert.equal((await w.manage({uid: 'bob', email: 'bob@ejemplo.test'}, {op: 'verify'})).status, 200, 'otra cuenta sí puede');
    /* Por correo, exista o no la cuenta: la respuesta no dice cuál es el caso. */
    for (const email of ['ana@ejemplo.test', 'nadie@ejemplo.test']) {
      for (let i = 0; i < M.LIMITS.resetPerDay; i++) assert.equal((await w.manage(null, {op: 'reset', email: email})).status, 200);
      assert.equal((await w.manage(null, {op: 'reset', email: email})).status, 429);
    }
    assert.equal(w.sent.length, M.LIMITS.verifyPerDay + 1 + M.LIMITS.resetPerDay);
    assert.ok(w.store.paths('mail_rate/').every((p) => p.indexOf('@') === -1), 'ningún correo en los nombres de los contadores');
    assert.equal(w.store.data('mail_rate/all~20261009').n, w.sent.length, 'el contador global solo cuenta lo que se envía');
    w.clock += 86400000;
    assert.equal((await w.manage(ANA, {op: 'verify'})).status, 200, 'al día siguiente vuelve a poder');
    assert.deepEqual(await M.sweep(ENV, w.deps), {configured: true, rate: 0});
    w.clock += 5 * 86400000;
    const counters = w.store.paths('mail_rate/').length;
    assert.deepEqual(await M.sweep(ENV, w.deps), {configured: true, rate: counters});
    assert.deepEqual(w.store.paths('mail_rate/'), []);
    assert.deepEqual(await M.sweep({}, w.deps), {configured: false, rate: 0});
  });

  await test('cupo del día agotado o Resend caído: 503, para que lo envíe Firebase', async () => {
    let w = world();
    w.store.put('mail_rate/all~20261009', {day: '20261009', n: M.LIMITS.allPerDay});
    assert.deepEqual(await w.manage(ANA, {op: 'verify'}), {status: 503, body: {error: 'quota'}});
    assert.equal(w.oob.length + w.sent.length, 0);
    assert.equal((await w.manage(ANA, {op: 'verify'}, Object.assign({}, ENV, {MAIL_DAILY_MAX: '500'}))).status, 200, 'MAIL_DAILY_MAX lo sube');
    w = world();
    w.resend = 500;
    await assert.rejects(w.manage(ANA, {op: 'verify'}), /resend 500/, 'la ruta lo convierte en 503 (worker/index.js)');
  });

  /* La ruta del Worker: sin sesión no hay correo de verificación, y solo desde la propia web. */
  await test('ruta /__/mail/v1', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../worker/index.js'), 'utf8');
    const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const call = (init) => worker.fetch(new Request('https://kanlane.com/__/mail/v1', init), {ASSETS: {fetch: async () => new Response('x')}});
    const post = (body, headers) => call({method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, headers), body: JSON.stringify(body)});
    assert.equal((await call({method: 'GET'})).status, 405);
    assert.equal((await post({op: 'reset', email: 'a@b.cd'}, {Origin: 'https://malo.example'})).status, 403);
    assert.equal((await post({op: 'verify'})).status, 401);
    assert.equal((await post({op: 'verify'}, {Authorization: 'Bearer no.es.un-token'})).status, 401);
    assert.equal((await call({method: 'POST', body: 'no es json'})).status, 400);
    const wrangler = fs.readFileSync(path.join(__dirname, '../../wrangler.jsonc'), 'utf8');
    assert.ok(wrangler.includes('"/__/mail/*"'), '/__/mail/* pasa antes por el Worker');
  });

  console.log('\n' + passed + ' pruebas correctas');
})().catch((err) => { console.error(err); process.exit(1); });
