/* Verificación en dos pasos del gestor de contraseñas: la ruta /__/kms/v1/totp del Worker.
   Los ID token se firman aquí con una clave RSA de prueba, como en kms.test.js.
   Uso: node tests/worker/totp.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const PROJECT = 'workhub-26f50';
const MASTER = nodeCrypto.randomBytes(32);
const b64url = (data) => Buffer.from(data).toString('base64url');

/* TOTP de referencia (RFC 6238 con SHA-1, 30 s, 6 cifras), hecho con node:crypto. */
function totp(secret, atMs){
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(atMs / 30000), 4);
  const mac = nodeCrypto.createHmac('sha1', secret).update(msg).digest();
  const at = mac[19] & 15;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1000000).padStart(6, '0');
}

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../worker/index.js'), 'utf8');
  const {default:worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const ok = (m) => console.log('OK   ' + m);

  const good = nodeCrypto.generateKeyPairSync('rsa', {modulusLength:2048});
  const jwk = Object.assign(good.publicKey.export({format:'jwk'}), {kid:'clave-1', alg:'RS256', use:'sig'});
  globalThis.fetch = async () => new Response(JSON.stringify({keys:[jwk]}), {headers:{'Cache-Control':'public, max-age=3600'}});

  const now = Math.floor(Date.now() / 1000);
  function token(uid, since){
    const head = b64url(JSON.stringify({alg:'RS256', kid:'clave-1', typ:'JWT'}));
    const body = b64url(JSON.stringify({iss:'https://securetoken.google.com/' + PROJECT, aud:PROJECT, sub:uid,
      iat:since != null ? since : now - 10, exp:now + 3600, auth_time:since != null ? since : now - 20, email_verified:true, firebase:{sign_in_provider:'google.com'}}));
    return head + '.' + body + '.' + b64url(nodeCrypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), good.privateKey));
  }
  const ALICE = token('uid-alice'), BOB = token('uid-bob');

  let limited = [];
  const env = (over) => Object.assign({
    ASSETS:{fetch:async () => new Response('archivo')}, KMS_MASTER_V1:MASTER.toString('base64'),
    TOTP_RATE_LIMIT:{limit:async ({key}) => { limited.push(key); return {success:true}; }}
  }, over || {});
  function call(tok, body, opts){
    const o = opts || {};
    const headers = Object.assign({'Content-Type':'application/json'}, tok ? {Authorization:'Bearer ' + tok} : {}, o.headers || {});
    return worker.fetch(new Request('https://kanlane.com/__/kms/v1/totp', {
      method:o.method || 'POST', headers, body:(o.method || 'POST') === 'POST' ? JSON.stringify(body) : undefined
    }), o.env || env());
  }

  /* Vector del RFC 6238: secreto «12345678901234567890», segundo 59 → 94287082 (aquí, 6 cifras). */
  const realNow = Date.now;
  const rfc = Buffer.from('12345678901234567890');
  assert.equal(totp(rfc, 59000), '287082');
  Date.now = () => 59000;
  let res = await call(token('uid-alice', 0), {op:'enroll', secret:b64url(rfc), code:'287082'});
  Date.now = realNow;
  assert.equal(res.status, 200, 'el Worker calcula el mismo código que el RFC');
  ok('el código del vector del RFC 6238 se acepta');

  /* Alta: con el código de ahora devuelve el token y la clave. */
  const secret = nodeCrypto.randomBytes(20);
  res = await call(ALICE, {op:'enroll', secret:b64url(secret), code:totp(secret, Date.now())});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const made = await res.json();
  assert.deepEqual(Object.keys(made).sort(), ['share', 'token', 'v']);
  assert.match(made.token, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(Buffer.from(made.share, 'base64url').length, 32);
  assert.equal(Buffer.from(made.token, 'base64url').indexOf(secret), -1, 'el token no lleva el secreto en claro');
  assert.deepEqual(limited.slice(-1), ['totp:uid-alice'], 'el límite va por cuenta');
  ok('el alta devuelve token y clave');

  /* Verificación: el mismo token y un código válido dan la misma clave; también el código anterior y el siguiente. */
  for(const shift of [0, -30000, 30000]){
    res = await call(ALICE, {op:'verify', token:made.token, code:totp(secret, Date.now() + shift)});
    assert.equal(res.status, 200, 'desfase de ' + shift + ' ms');
    assert.equal((await res.json()).share, made.share);
  }
  ok('un código válido devuelve siempre la misma clave');

  /* Otra alta del mismo secreto da otro token y otra clave: desactivar y volver a activar invalida lo anterior. */
  const again = await (await call(ALICE, {op:'enroll', secret:b64url(secret), code:totp(secret, Date.now())})).json();
  assert.notEqual(again.token, made.token);
  assert.notEqual(again.share, made.share);

  /* Códigos que no valen: sin clave en la respuesta. */
  const wrong = totp(secret, Date.now()) === '000000' ? '000001' : '000000';
  for(const [name, body] of Object.entries({
    'código incorrecto': {op:'verify', token:made.token, code:wrong},
    'código de hace dos minutos': {op:'verify', token:made.token, code:totp(secret, Date.now() - 120000)},
    'alta con código incorrecto': {op:'enroll', secret:b64url(secret), code:wrong}
  })){
    res = await call(ALICE, body);
    assert.equal(res.status, 403, name);
    assert.equal((await res.text()).indexOf('share'), -1, name);
  }
  ok('un código incorrecto o caducado se rechaza');

  /* El token está atado a la cuenta: con la sesión de otra persona no se abre, ni manipulado. */
  res = await call(BOB, {op:'verify', token:made.token, code:totp(secret, Date.now())});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'token');
  const tampered = made.token.slice(0, 20) + (made.token[20] === 'A' ? 'B' : 'A') + made.token.slice(21);
  assert.equal((await call(ALICE, {op:'verify', token:tampered, code:totp(secret, Date.now())})).status, 400);
  /* Y con otro secreto maestro tampoco. */
  assert.equal((await call(ALICE, {op:'verify', token:made.token, code:totp(secret, Date.now())},
    {env:env({KMS_MASTER_V1:nodeCrypto.randomBytes(32).toString('base64')})})).status, 400);
  ok('el token solo vale para su cuenta y sin manipular');

  /* Peticiones mal formadas: se rechazan antes de gastar un intento. */
  limited = [];
  for(const [name, body] of Object.entries({
    'sin operación': {token:made.token, code:'123456'},
    'operación desconocida': {op:'reset', token:made.token, code:'123456'},
    'código de 5 cifras': {op:'verify', token:made.token, code:'12345'},
    'código con letras': {op:'verify', token:made.token, code:'12a456'},
    'código numérico, no texto': {op:'verify', token:made.token, code:123456},
    'token corto': {op:'verify', token:'abc', code:'123456'},
    'alta sin secreto': {op:'enroll', code:'123456'},
    'cuerpo enorme': {op:'verify', token:made.token, code:'123456', relleno:'x'.repeat(600)}
  })){
    assert.equal((await call(ALICE, body)).status, 400, name);
  }
  assert.equal((await call(ALICE, {op:'enroll', secret:b64url(nodeCrypto.randomBytes(10)), code:'123456'})).status, 400, 'secreto de 10 bytes');
  assert.deepEqual(limited, ['totp:uid-alice'], 'solo la última, bien formada, gasta un intento');
  ok('las peticiones mal formadas se rechazan');

  /* Límite de intentos por cuenta, y sin límite configurado no se responde. */
  res = await call(ALICE, {op:'verify', token:made.token, code:totp(secret, Date.now())},
    {env:env({TOTP_RATE_LIMIT:{limit:async () => ({success:false})}})});
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  res = await call(ALICE, {op:'verify', token:made.token, code:totp(secret, Date.now())}, {env:env({TOTP_RATE_LIMIT:undefined})});
  assert.equal(res.status, 503);
  ok('demasiados intentos → 429; sin límite configurado → 503');

  /* Lo mismo que la otra ruta de claves: sesión, método, origen y secreto. */
  assert.equal((await call(null, {op:'verify', token:made.token, code:'123456'})).status, 401);
  assert.equal((await call(ALICE, null, {method:'GET'})).status, 405);
  assert.equal((await call(ALICE, {op:'verify', token:made.token, code:'123456'}, {headers:{Origin:'https://otra.example'}})).status, 403);
  assert.equal((await call(ALICE, {op:'verify', token:made.token, code:'123456'}, {env:env({KMS_MASTER_V1:''})})).status, 503);
  ok('sin sesión, desde otro origen o sin secreto no hay clave');
})().catch((error) => { console.error(error); process.exitCode = 1; });
