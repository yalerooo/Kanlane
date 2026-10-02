/* Comprueba que el hreflang entre las páginas en español y en inglés es recíproco.
   Para cada par, las dos páginas declaran es, en y x-default con las mismas URLs,
   cada URL coincide con el canonical de la página a la que apunta. (El sitemap.xml lo genera el build
   y lo comprueba tests/e2e/sitemap-check.js.)
   Además, el selector de idioma ES | EN de cada página (cabecera y pie) apunta a su equivalente
   y coincide con el hreflang alternativo.
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
  'gestor-de-contrasenas-para-clientes/': 'en/client-password-manager/',
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
    }
  }
  /* Selector de idioma: marca el idioma actual y enlaza (con hreflang/lang) al equivalente declarado en hreflang. */
  for(const [route, other, self, otherLang] of [[es, en, 'es', 'en'], [en, es, 'en', 'es']]){
    const html = read(route);
    const header = (html.match(/<div class="lang-switch"[\s\S]*?<\/div>/) || [])[0];
    assert.ok(header, '/' + route + ' tiene el selector de idioma en la cabecera');
    assert.equal((html.match(/class="lang-switch"/g) || []).length, 1, '/' + route + ' tiene un único selector');
    assert.match(header, new RegExp('<span class="lang-opt" lang="' + self + '" aria-current="true">' + self.toUpperCase() + '</span>'), '/' + route + ' marca ' + self.toUpperCase() + ' como idioma actual');
    const links = [...header.matchAll(/<a class="lang-opt" href="([^"]+)" hreflang="([^"]+)" lang="([^"]+)"[^>]*aria-label="[^"]+">([^<]+)<\/a>/g)];
    assert.equal(links.length, 1, '/' + route + ' tiene un único enlace en el selector');
    const [, href, hreflang, lang, text] = links[0];
    assert.equal(href, '/' + other, '/' + route + ' enlaza a su equivalente /' + other);
    assert.equal(ORIGIN + href.slice(1), pages[route].alternates[otherLang], 'el enlace del selector de /' + route + ' coincide con su hreflang="' + otherLang + '"');
    assert.deepEqual([hreflang, lang, text], [otherLang, otherLang, otherLang.toUpperCase()], 'atributos del enlace del selector de /' + route);
    const foot = [...html.matchAll(/<a (?:class="foot-lang" )?href="([^"]+)" hreflang="([^"]+)" lang="([^"]+)">(English|Español)<\/a>/g)];
    assert.equal(foot.length, 1, '/' + route + ' tiene un enlace de idioma en el pie');
    assert.equal(foot[0][1], href, 'el enlace del pie de /' + route + ' coincide con el del selector');
    assert.equal(foot[0][4], otherLang === 'en' ? 'English' : 'Español', 'texto del enlace del pie de /' + route);
    assert.ok(!html.includes('class="lang-link"'), '/' + route + ' no conserva el enlace de idioma antiguo');
  }
  ok('/' + es + ' <-> /' + en + ' (selector de idioma incluido)');
}
