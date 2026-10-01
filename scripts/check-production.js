/* Comprobación pública y sin credenciales: falla el job programado cuando la
   web o los recursos imprescindibles dejan de responder correctamente. */
const assert = require('node:assert/strict');

const origin = process.env.WORKHUB_HEALTH_ORIGIN || 'https://kanlane.com';
const checks = [
  {path:'/', marker:'Kanlane', type:'text/html'},
  {path:'/app/', marker:'id="authPanel"', type:'text/html'},
  {path:'/robots.txt', marker:'Sitemap:', type:'text/plain'},
  {path:'/sw.js', marker:'self.addEventListener', type:'javascript'},
  {path:'/legal/privacidad/', marker:'Política de privacidad', type:'text/html'}
];

(async () => {
  for(const check of checks){
    const response = await fetch(origin + check.path, {signal:AbortSignal.timeout(15000), redirect:'follow'});
    assert.equal(response.status, 200, check.path + ' responde con 200');
    assert.ok((response.headers.get('content-type') || '').includes(check.type), check.path + ' tiene el tipo esperado');
    assert.ok((await response.text()).includes(check.marker), check.path + ' sirve el contenido esperado');
    console.log('OK   ' + check.path);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
