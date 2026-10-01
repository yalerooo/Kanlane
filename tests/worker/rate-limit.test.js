const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../worker/index.js'), 'utf8');
  const {default:worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  let calls = 0;
  const env = {
    ASSETS:{fetch:async () => new Response('archivo', {status:200})},
    AUTH_RATE_LIMIT:{limit:async ({key}) => { calls++; assert.equal(key, '192.0.2.1'); return {success:false}; }}
  };
  const headers = {'CF-Connecting-IP':'192.0.2.1'};
  const page = await worker.fetch(new Request('https://workhub.yalero.net/index.html', {headers}), env);
  assert.equal(page.status, 200);
  assert.equal(calls, 0, 'el límite no consume recursos estáticos');
  const blocked = await worker.fetch(new Request('https://workhub.yalero.net/__/auth/handler', {headers}), env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(calls, 1);
  const invalid = await worker.fetch(new Request('https://workhub.yalero.net/__/otro/ruta', {headers}), env);
  assert.equal(invalid.status, 404);
  assert.equal(calls, 1, 'las rutas no permitidas se rechazan antes de consumir el límite');
  console.log('OK   Worker: límite del proxy de acceso');
})().catch((error) => {console.error(error); process.exitCode = 1;});
