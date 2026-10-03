/* Modo gestionado (docs/CIFRADO-PROYECTOS.md, apartado 12): la ruta /__/kms/v1/kek del Worker.
   Los ID token se firman aquí con una clave RSA de prueba y las claves públicas de Google se
   sustituyen por la de esa clave. Uso: node tests/worker/kms.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const PROJECT = 'workhub-26f50';
const PID = 'p'.repeat(22), KID = 'k'.repeat(11);
const MASTER = nodeCrypto.randomBytes(32);

const b64url = (data) => Buffer.from(data).toString('base64url');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../worker/index.js'), 'utf8');
  const {default:worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

  const good = nodeCrypto.generateKeyPairSync('rsa', {modulusLength:2048});
  const other = nodeCrypto.generateKeyPairSync('rsa', {modulusLength:2048});
  const jwk = Object.assign(good.publicKey.export({format:'jwk'}), {kid:'clave-1', alg:'RS256', use:'sig'});
  let jwksCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input && input.url ? input.url : input);
    assert.ok(target.indexOf('securetoken@system.gserviceaccount.com') !== -1, 'el Worker solo pide las claves de Google: ' + target);
    jwksCalls++;
    return new Response(JSON.stringify({keys:[jwk]}), {headers:{'Cache-Control':'public, max-age=3600'}});
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = (over) => Object.assign({iss:'https://securetoken.google.com/' + PROJECT, aud:PROJECT, sub:'uid-alice',
    iat:now - 10, exp:now + 3600, auth_time:now - 20, email:'alice@x.com', email_verified:true,
    firebase:{sign_in_provider:'google.com'}}, over || {});
  function token(payload, opts){
    const o = opts || {};
    const head = b64url(JSON.stringify(Object.assign({alg:'RS256', kid:'clave-1', typ:'JWT'}, o.header || {})));
    const body = b64url(JSON.stringify(payload));
    const sig = nodeCrypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), (o.key || good).privateKey);
    return head + '.' + body + '.' + b64url(sig);
  }

  const env = (over) => Object.assign({ASSETS:{fetch:async () => new Response('archivo')}, KMS_MASTER_V1:MASTER.toString('base64')}, over || {});
  function call(tok, body, opts){
    const o = opts || {};
    const headers = Object.assign({'Content-Type':'application/json'}, tok ? {Authorization:'Bearer ' + tok} : {}, o.headers || {});
    return worker.fetch(new Request('https://kanlane.com/__/kms/v1/kek', {
      method:o.method || 'POST', headers, body:(o.method || 'POST') === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body || {pid:PID, kid:KID})) : undefined
    }), o.env || env());
  }
  const expected = (uid, pid, kid) => b64url(Buffer.from(nodeCrypto.hkdfSync('sha256', MASTER, Buffer.from('kanlane-kms-v1'), Buffer.from('u:' + uid + '|' + pid + '|' + kid), 32)));

  /* Petición válida. */
  const ok = await call(token(claims()));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  const data = await ok.json();
  assert.deepEqual(Object.keys(data).sort(), ['kek', 'kmsv', 'v']);
  assert.equal(data.kmsv, 1);
  assert.equal(data.kek, expected('uid-alice', PID, KID), 'la clave es HKDF-SHA256 del secreto con uid, pid y kid');
  assert.equal((await (await call(token(claims()))).json()).kek, data.kek, 'la derivación es determinista');
  assert.equal(jwksCalls, 1, 'las claves públicas se piden una vez y se guardan');

  /* Otra cuenta, otro proyecto u otra clave dan una clave distinta. */
  const bob = await (await call(token(claims({sub:'uid-bob'})))).json();
  assert.equal(bob.kek, expected('uid-bob', PID, KID));
  assert.notEqual(bob.kek, data.kek);
  const otherPid = await (await call(token(claims()), {pid:'q'.repeat(22), kid:KID})).json();
  const otherKid = await (await call(token(claims()), {pid:PID, kid:'z'.repeat(11)})).json();
  assert.notEqual(otherPid.kek, data.kek);
  assert.notEqual(otherKid.kek, data.kek);
  /* Y otro secreto también. */
  const otherMaster = await (await call(token(claims()), null, {env:env({KMS_MASTER_V1:nodeCrypto.randomBytes(32).toString('base64')})})).json();
  assert.notEqual(otherMaster.kek, data.kek);

  /* El uid sale del token: mandarlo en el cuerpo no cambia nada. */
  const spoof = await (await call(token(claims()), {pid:PID, kid:KID, uid:'uid-bob'})).json();
  assert.equal(spoof.kek, data.kek);

  /* Correo y contraseña con el correo verificado. */
  assert.equal((await call(token(claims({firebase:{sign_in_provider:'password'}})))).status, 200);

  /* Tokens que no valen. */
  const rejected = {
    'sin token': null,
    'token que no es un JWT': 'abc',
    'firmado con otra clave': token(claims(), {key:other}),
    'caducado': token(claims({exp:now - 1})),
    'de otro proyecto (aud)': token(claims({aud:'otro-proyecto'})),
    'de otro emisor (iss)': token(claims({iss:'https://securetoken.google.com/otro-proyecto'})),
    'emitido en el futuro': token(claims({iat:now + 3600})),
    'auth_time en el futuro': token(claims({auth_time:now + 3600})),
    'sin sub': token(claims({sub:''})),
    'sin exp': token(claims({exp:undefined})),
    'contraseña con el correo sin verificar': token(claims({email_verified:false, firebase:{sign_in_provider:'password'}})),
    'clave de firma desconocida': token(claims(), {header:{kid:'clave-desconocida'}}),
    'algoritmo distinto de RS256': token(claims(), {header:{alg:'HS256'}})
  };
  for(const name of Object.keys(rejected)){
    const res = await call(rejected[name]);
    assert.equal(res.status, 401, name);
    assert.equal((await res.text()).indexOf('kek'), -1, name + ': sin clave en la respuesta');
  }
  /* Sin firma (alg none), como los tokens del emulador. */
  const none = b64url(JSON.stringify({alg:'none', typ:'JWT'})) + '.' + b64url(JSON.stringify(claims())) + '.';
  assert.equal((await call(none)).status, 401, 'un token sin firma se rechaza');
  /* Cuerpo del token manipulado con la firma de otro. */
  const parts = token(claims()).split('.');
  parts[1] = b64url(JSON.stringify(claims({sub:'uid-bob'})));
  assert.equal((await call(parts.join('.'))).status, 401, 'un token manipulado se rechaza');

  /* Peticiones mal formadas. */
  const good1 = token(claims());
  assert.equal((await call(good1, {pid:'corto', kid:KID})).status, 400);
  assert.equal((await call(good1, {pid:PID, kid:'k|k'.repeat(4).slice(0, 11)})).status, 400, 'kid con «|» se rechaza');
  assert.equal((await call(good1, {pid:[PID], kid:KID})).status, 400, 'pid que no es texto se rechaza');
  assert.equal((await call(good1, 'no es json')).status, 400);
  assert.equal((await call(good1, JSON.stringify({pid:PID, kid:KID, x:'y'.repeat(600)}))).status, 400, 'cuerpo demasiado grande');
  const get = await call(good1, null, {method:'GET'});
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('Allow'), 'POST');

  /* Otro origen. */
  assert.equal((await call(good1, null, {headers:{Origin:'https://malo.example'}})).status, 403);
  assert.equal((await call(good1, null, {headers:{Origin:'https://kanlane.com'}})).status, 200);

  /* Sin secreto (o con uno demasiado corto) no hay claves. */
  assert.equal((await call(good1, null, {env:env({KMS_MASTER_V1:undefined})})).status, 503);
  assert.equal((await call(good1, null, {env:env({KMS_MASTER_V1:Buffer.alloc(16, 1).toString('base64')})})).status, 503);

  /* Límite de peticiones por IP, antes de verificar nada. */
  let limited = 0;
  const blocked = await call(good1, null, {headers:{'CF-Connecting-IP':'192.0.2.7'},
    env:env({AUTH_RATE_LIMIT:{limit:async ({key}) => { limited++; assert.equal(key, '192.0.2.7'); return {success:false}; }}})});
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(limited, 1);

  /* El resto de rutas sigue igual. */
  assert.equal((await worker.fetch(new Request('https://kanlane.com/__/kms/v1/otra', {method:'POST'}), env())).status, 404);

  globalThis.fetch = realFetch;
  console.log('OK   Worker: clave del modo gestionado');
})().catch((error) => {console.error(error); process.exitCode = 1;});
