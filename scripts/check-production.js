/* Comprobación pública y sin credenciales: falla el job programado cuando la
   web o los recursos imprescindibles dejan de responder correctamente. */
const assert = require('node:assert/strict');

const origin = process.env.WORKHUB_HEALTH_ORIGIN || 'https://kanlane.com';
const checks = [
  {path:'/', marker:'Kanlane', type:'text/html', canonical:'https://kanlane.com/'},
  {path:'/alternativa-a-trello/', marker:'Una alternativa a Trello', type:'text/html', canonical:'https://kanlane.com/alternativa-a-trello/'},
  {path:'/gestion-de-proyectos/', marker:'El gestor de proyectos', type:'text/html', canonical:'https://kanlane.com/gestion-de-proyectos/'},
  {path:'/sitemap.xml', marker:'https://kanlane.com/alternativa-a-trello/', type:'xml'},
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
    const body = await response.text();
    assert.ok(body.includes(check.marker), check.path + ' sirve el contenido esperado');
    if(check.canonical){
      assert.ok(body.includes('<link rel="canonical" href="' + check.canonical + '">'), check.path + ' indica el canónico');
      assert.ok(!/noindex/i.test(response.headers.get('x-robots-tag') || ''), check.path + ' no lleva noindex en cabeceras');
      assert.ok(!/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(body), check.path + ' no lleva noindex en HTML');
    }
    console.log('OK   ' + check.path);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
