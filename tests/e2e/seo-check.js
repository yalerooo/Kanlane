/* Comprueba el SEO estructurado de las 16 páginas indexables y llms.txt, sin navegador:
   - construye dist/ con scripts/build-public.js;
   - cada página lleva JSON-LD válido y un WebPage cuyo `about` es una referencia por @id
     (https://kanlane.com/#aplicacion), que declara la portada en su SoftwareApplication;
   - las páginas con <details> visibles tienen un FAQPage con EXACTAMENTE las mismas preguntas y
     respuestas (mismo texto, mismo orden); las que no, no llevan FAQPage;
   - `dateModified` del JSON-LD coincide con <meta name="last-modified">, y el build falla con un
     mensaje claro si no coinciden;
   - el pie de la portada enlaza a las 7 páginas de captación de SU idioma (y solo a esas), todas en el sitemap;
   - dist/llms.txt existe, sus URLs de kanlane.com son exactamente las del sitemap, no lleva noindex
     ni está en el sitemap, y el service worker lo precachea como el resto de archivos públicos.
   No necesita navegador: node tests/e2e/seo-check.js */
'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {jsonLd} = require('../../scripts/site-pages');

const ROOT = path.join(__dirname, '../..');
const ORIGIN = 'https://kanlane.com/';
const APP_ID = ORIGIN + '#aplicacion';
const ES = ['alternativa-a-trello', 'alternativa-a-asana', 'alternativa-a-notion', 'gestion-de-proyectos', 'gestor-de-clientes', 'crm-para-autonomos', 'gestor-de-contrasenas-para-clientes'];
const EN = ['trello-alternative', 'asana-alternative', 'notion-alternative', 'project-management', 'client-manager', 'freelancer-crm', 'client-password-manager'];
const PAGES = ['index.html', 'en/index.html'].concat(ES.map(s => s + '/index.html'), EN.map(s => 'en/' + s + '/index.html'));

const ok = (m) => console.log('OK   ' + m);
/* En Windows los archivos se descargan con CRLF (core.autocrlf): se comparan siempre con LF. */
const readText = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const build = (root) => cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-public.js')], {env: Object.assign({}, process.env, {KANLANE_ROOT: root}), encoding: 'utf8'});

const run = build(ROOT);
assert.equal(run.status, 0, 'el build termina bien:\n' + run.stdout + run.stderr);

const sitemap = readText(path.join(ROOT, 'dist/sitemap.xml'));
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
assert.equal(locs.length, 16, 'el sitemap tiene 16 URLs');
const urlOf = (f) => ORIGIN + f.slice(0, -'index.html'.length);
assert.deepEqual(PAGES.map(urlOf).sort(), locs.slice().sort(), 'las 16 páginas son las del sitemap');

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const meta = (html) => (html.match(/<meta\s+name="last-modified"\s+content="([^"]*)"/i) || [])[1];

/* ---------- JSON-LD ---------- */
for(const f of PAGES){
  const html = readText(path.join(ROOT, f));
  const blocks = jsonLd(html, f);
  assert.ok(blocks.length >= 1, f + ' lleva JSON-LD');
  const nodes = blocks.flatMap(b => b['@graph'] || [b]);
  const byType = (t) => nodes.filter(n => n['@type'] === t);

  const pages = byType('WebPage');
  assert.equal(pages.length, 1, f + ' tiene un WebPage');
  const page = pages[0];
  assert.equal(page.url, urlOf(f), f + ': la url del WebPage es su canonical');
  assert.deepEqual(page.about, {'@id': APP_ID}, f + ': about referencia a la aplicación por @id');
  assert.equal(page.dateModified, meta(html), f + ': dateModified coincide con <meta name="last-modified">');
  assert.ok(/^\d{4}-\d\d-\d\d$/.test(page.dateModified), f + ': dateModified es YYYY-MM-DD');

  const apps = byType('SoftwareApplication');
  if(f === 'index.html' || f === 'en/index.html'){
    assert.equal(apps.length, 1, f + ' declara la SoftwareApplication');
    assert.equal(apps[0]['@id'], APP_ID, f + ': la SoftwareApplication tiene el @id esperado');
    const org = byType('Organization')[0];
    assert.ok(org && org.sameAs.includes('https://github.com/yalerooo/Kanlane'), f + ': Organization con sameAs del repositorio');
  }else{
    assert.equal(apps.length, 0, f + ' no define una SoftwareApplication anónima');
  }

  /* FAQ: lo visible y lo estructurado, idénticos. */
  const details = [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)].map(m => [decode(m[1].trim()), decode(m[2].trim())]);
  assert.equal(details.length, (html.match(/<details/g) || []).length, f + ': todos los <details> tienen summary y un párrafo');
  const faqs = byType('FAQPage');
  if(details.length === 0){
    assert.equal(faqs.length, 0, f + ' no tiene FAQ visible: no debe llevar FAQPage');
  }else{
    assert.equal(faqs.length, 1, f + ' tiene un FAQPage');
    const qa = faqs[0].mainEntity.map(q => [q.name, q.acceptedAnswer.text]);
    assert.equal(qa.length, details.length, f + ': mismo número de preguntas que <details>');
    assert.deepEqual(qa, details, f + ': preguntas y respuestas idénticas a las visibles');
  }
}
ok('JSON-LD válido en las 16 páginas: about por @id, FAQPage = <details> visibles, dateModified = meta');

/* ---------- Pie de la portada ---------- */
for(const [file, lang, expected] of [['index.html', 'es', ES.map(s => '/' + s + '/')], ['en/index.html', 'en', EN.map(s => '/en/' + s + '/')]]){
  const html = readText(path.join(ROOT, file));
  const foot = html.match(/<footer class="foot">[\s\S]*?<\/footer>/)[0];
  const links = [...foot.matchAll(/<a\s+[^>]*href="([^"#]+)"/g)].map(m => m[1]);
  const guides = links.filter(h => /^\/(en\/)?[a-z-]+\/$/.test(h) && h !== '/' && h !== '/en/');
  assert.deepEqual(guides, expected, file + ': el pie enlaza exactamente a las 7 páginas de ' + lang);
  for(const h of guides) assert.ok(locs.includes('https://kanlane.com' + h), file + ': ' + h + ' está en el sitemap');
  assert.equal(guides.some(h => lang === 'es' ? h.startsWith('/en/') : !h.startsWith('/en/')), false, file + ': el pie no enlaza a otro idioma (salvo el selector)');
}
ok('el pie de / y de /en/ enlaza a las 7 páginas de su idioma, todas del sitemap');

/* ---------- llms.txt ---------- */
const llmsPath = path.join(ROOT, 'dist/llms.txt');
assert.ok(fs.existsSync(llmsPath), 'dist/llms.txt existe');
const llms = readText(llmsPath);
assert.ok(llms.startsWith('# Kanlane\n'), 'llms.txt empieza por «# Kanlane»');
assert.match(llms, /\n> [^\n]+\n/, 'lleva un blockquote con la descripción');
assert.match(llms, /Última actualización: \d{4}-\d\d-\d\d/, 'lleva fecha de actualización');
const urls = [...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
const own = urls.filter(u => u.startsWith(ORIGIN));
assert.deepEqual(own.slice().sort(), locs.slice().sort(), 'las URLs de kanlane.com en llms.txt son exactamente las del sitemap');
for(const u of urls.filter(u => !u.startsWith(ORIGIN))) assert.match(u, /^https:\/\/github\.com\/yalerooo\/Kanlane(\/|$)/, 'enlace externo permitido: ' + u);
assert.ok(!sitemap.includes('llms.txt'), 'llms.txt no está en el sitemap');
const headers = readText(path.join(ROOT, 'dist/_headers'));
assert.ok(!/llms\.txt/.test(headers), '_headers no trata llms.txt aparte (ni noindex)');
const all = headers.split(/\n(?=\S)/).find(b => b.startsWith('/*'));
assert.ok(all && !/X-Robots-Tag/i.test(all), 'la regla global de _headers no lleva noindex');
assert.ok(JSON.parse(readText(path.join(ROOT, 'dist/sw.js')).match(/const FILES = (\[.*\]);/)[1]).includes('/llms.txt'), 'el service worker precachea /llms.txt');
ok('dist/llms.txt: ' + urls.length + ' enlaces, URLs propias = sitemap, sin noindex');

/* ---------- Negativo: dateModified distinto de la meta hace fallar el build ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanlane-seo-'));
try{
  const fixture = path.join(tmp, 'site');
  fs.cpSync(ROOT, fixture, {recursive: true, filter: (src) => !/[\\/](\.git|dist|node_modules)([\\/]|$)/.test(src.slice(ROOT.length))});
  const page = path.join(fixture, 'gestor-de-clientes/index.html');
  const original = fs.readFileSync(page, 'utf8');
  const broken = original.replace(/"dateModified":"[^"]*"/, '"dateModified":"2020-01-01"');
  assert.notEqual(broken, original, 'el caso modifica dateModified');
  fs.writeFileSync(page, broken);
  const r = build(fixture);
  assert.notEqual(r.status, 0, 'el build debe fallar con dateModified distinto de la meta');
  assert.match(r.stderr, /dateModified.*gestor-de-clientes.*2020-01-01.*last-modified.*update-lastmod/s, 'mensaje claro:\n' + r.stderr);
  fs.writeFileSync(page, original.replace(/<script type="application\/ld\+json">\{/, '<script type="application/ld+json">{,'));
  const r2 = build(fixture);
  assert.notEqual(r2.status, 0, 'el build debe fallar con JSON-LD roto');
  assert.match(r2.stderr, /JSON-LD no es JSON válido/, 'mensaje claro para JSON roto:\n' + r2.stderr);
  ok('el build falla con dateModified desincronizado y con JSON-LD roto');
}finally{
  fs.rmSync(tmp, {recursive: true, force: true});
}
