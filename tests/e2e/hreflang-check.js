/* Comprueba que el hreflang entre las páginas en español y en inglés es recíproco.
   Para cada par, las dos páginas declaran es, en y x-default con las mismas URLs,
   cada URL coincide con el canonical de la página a la que apunta y está en sitemap.xml.
   No necesita navegador: node tests/e2e/hreflang-check.js */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const ORIGIN = 'https://kanlane.com/';
/* Ruta en español -> ruta en inglés (relativas a la raíz, con barra final). */
const PAIRS = {
  '': 'en/',
  'alternativa-a-trello/': 'en/trello-alternative/',
  'alternativa-a-asana/': 'en/asana-alternative/',
  'alternativa-a-notion/': 'en/notion-alternative/',
  'gestion-de-proyectos/': 'en/project-management/',
  'gestor-de-clientes/': 'en/client-manager/',
  'crm-para-autonomos/': 'en/freelancer-crm/',
};

const ok = (m) => console.log('OK   ' + m);
const read = (route) => fs.readFileSync(path.join(ROOT, route, 'index.html'), 'utf8');
const canonicalOf = (html, route) => {
  const found = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(found.length, 1, 'un único canonical en /' + route);
  return found[0];
};
const alternatesOf = (html, route) => {
  const map = {};
  for(const m of html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"/g)){
    assert.equal(map[m[1]], undefined, 'hreflang="' + m[1] + '" repetido en /' + route);
    map[m[1]] = m[2];
  }
  return map;
};

const sitemap = new Set([...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
const pages = {};
for(const [es, en] of Object.entries(PAIRS)){
  for(const route of [es, en]){
    const html = read(route);
    pages[route] = {canonical: canonicalOf(html, route), alternates: alternatesOf(html, route)};
  }
}

for(const [es, en] of Object.entries(PAIRS)){
  /* Las dos páginas del par declaran el mismo conjunto, con x-default en la española. */
  const expected = {es: ORIGIN + es, en: ORIGIN + en, 'x-default': ORIGIN + es};
  for(const route of [es, en]){
    const page = pages[route];
    assert.equal(page.canonical, ORIGIN + route, 'canonical de /' + route);
    assert.deepEqual(page.alternates, expected, 'hreflang de /' + route);
    const self = route === es ? 'es' : 'en';
    assert.equal(page.alternates[self], page.canonical, '/' + route + ' se declara a sí misma');
    for(const [lang, url] of Object.entries(page.alternates)){
      const target = url.slice(ORIGIN.length);
      assert.ok(url.startsWith(ORIGIN) && pages[target], 'hreflang="' + lang + '" de /' + route + ' apunta a una página conocida');
      assert.equal(url, pages[target].canonical, 'hreflang="' + lang + '" de /' + route + ' coincide con el canonical de destino');
      assert.ok(sitemap.has(url), url + ' está en sitemap.xml');
    }
  }
  ok('/' + es + ' <-> /' + en);
}
