/* Prueba el reparto de dominios del Worker (worker/index.js):
   kanlane.com (canónico), kanlane.yalero.net (espejo con noindex) y los nombres antiguos
   (workhub.yalero.net, www.kanlane.com), que redirigen al canónico. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../worker/index.js'), 'utf8');
  const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const asset = () => new Response('<html>pagina</html>', {status: 200, headers: {'Content-Type': 'text/html'}});
  const env = (extra) => Object.assign({ASSETS: {fetch: async () => asset()}, REDIRECT_TARGET: 'https://kanlane.com', LEGACY_STATUS: '302'}, extra || {});
  const get = (u, e) => worker.fetch(new Request(u, {redirect: 'manual'}), env(e));
  const ok = (m) => console.log('OK   ' + m);

  /* Canónico: se sirve tal cual, sin cabecera noindex. */
  let r = await get('https://kanlane.com/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-Robots-Tag'), null);
  ok('kanlane.com se sirve sin noindex');

  /* Espejo: se sirve, pero sin indexar. */
  r = await get('https://kanlane.yalero.net/app/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
  ok('kanlane.yalero.net se sirve con noindex');

  /* Las páginas de captación pasan por el Worker también en el espejo y los dominios antiguos. */
  const wrangler = fs.readFileSync(path.join(__dirname, '../../wrangler.jsonc'), 'utf8');
  for(const landing of ['alternativa-a-trello', 'gestion-de-proyectos', 'alternativa-a-asana', 'alternativa-a-notion', 'gestor-de-clientes', 'crm-para-autonomos']){
    assert.ok(wrangler.includes('"/' + landing + '"'), landing + ' sin barra final pasa por el Worker');
    assert.ok(wrangler.includes('"/' + landing + '/*"'), landing + ' pasa por el Worker');
    r = await get('https://kanlane.yalero.net/' + landing + '/');
    assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
    r = await get('https://www.kanlane.com/' + landing + '/');
    assert.equal(r.headers.get('Location'), 'https://kanlane.com/' + landing + '/');
  }
  ok('las páginas SEO respetan canónico y noindex del espejo');

  /* Dominios antiguos: redirección temporal que conserva ruta y parámetros. */
  r = await get('https://workhub.yalero.net/app/?registro=1');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), 'https://kanlane.com/app/?registro=1');
  r = await get('https://www.kanlane.com/legal/privacidad/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), 'https://kanlane.com/legal/privacidad/');
  ok('los dominios antiguos redirigen al canónico con la misma ruta');

  /* Permanente cuando se decide. */
  r = await get('https://workhub.yalero.net/', {LEGACY_STATUS: '301'});
  assert.equal(r.status, 301);
  ok('LEGACY_STATUS=301 hace la redirección permanente');

  /* Marcha atrás: cambiar la variable lleva a los antiguos al espejo, y el espejo ya no lleva noindex. */
  r = await get('https://workhub.yalero.net/', {REDIRECT_TARGET: 'https://kanlane.yalero.net'});
  assert.equal(r.headers.get('Location'), 'https://kanlane.yalero.net/');
  r = await get('https://kanlane.yalero.net/', {REDIRECT_TARGET: 'https://kanlane.yalero.net'});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-Robots-Tag'), null);
  ok('cambiando REDIRECT_TARGET se vuelve al espejo y este pasa a indexarse');

  /* Un dominio antiguo que fuera también el destino no se redirige a sí mismo (sin bucle). */
  r = await get('https://workhub.yalero.net/', {REDIRECT_TARGET: 'https://workhub.yalero.net'});
  assert.equal(r.status, 200);
  ok('sin bucles si el destino es el propio dominio');

  /* El acceso de Firebase (/__/) no se redirige en los dominios antiguos. */
  let proxied = false;
  const prev = globalThis.fetch;
  globalThis.fetch = async (u) => { proxied = String(u).startsWith('https://workhub-26f50.firebaseapp.com/__/auth/'); return new Response('ok'); };
  r = await get('https://workhub.yalero.net/__/auth/handler?x=1');
  globalThis.fetch = prev;
  assert.notEqual(r.status, 302);
  assert.ok(proxied, 'el acceso de Firebase se reenvía en el dominio antiguo');
  ok('el inicio de sesión en curso en un dominio antiguo no se rompe');

  /* El service worker del dominio antiguo se desinstala solo. */
  r = await get('https://workhub.yalero.net/sw.js');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /unregister/);
  ok('el dominio antiguo entrega un service worker que se desinstala');

  /* En el dominio canónico, /sw.js es el de la app. */
  r = await get('https://kanlane.com/sw.js');
  assert.equal(r.status, 200);
  assert.doesNotMatch(await r.text(), /unregister/);
  ok('kanlane.com entrega el service worker de la app');
})().catch((error) => { console.error(error); process.exitCode = 1; });
