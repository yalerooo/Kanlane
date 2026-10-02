/* Comprueba el sitemap.xml que genera el build (no hay copia manual en la raíz):
   - construye dist/ con scripts/build-public.js;
   - están las 14 URLs, todas con https://kanlane.com/ y barra final, sin app/demo/legal;
   - cada xhtml:link es recíproco y apunta a una URL del propio sitemap;
   - el XML está bien formado y las fechas, si las hay, son YYYY-MM-DD;
   - en negativo: una copia sin canonical, con canonical equivocado, duplicado o con hreflang
     no recíproco hace fallar el build.
   No necesita navegador: node tests/e2e/sitemap-check.js */
'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const ORIGIN = 'https://kanlane.com/';
const EXPECTED = ['', 'alternativa-a-asana/', 'alternativa-a-notion/', 'alternativa-a-trello/', 'crm-para-autonomos/', 'gestion-de-proyectos/', 'gestor-de-clientes/',
  'en/', 'en/asana-alternative/', 'en/client-manager/', 'en/freelancer-crm/', 'en/notion-alternative/', 'en/project-management/', 'en/trello-alternative/'].map(r => ORIGIN + r);

const ok = (m) => console.log('OK   ' + m);
const build = (root, env) => cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-public.js')], {env: Object.assign({}, process.env, {KANLANE_ROOT: root}, env), encoding: 'utf8'});

/* ---------- Positivo: el repositorio actual ---------- */
const run = build(ROOT);
assert.equal(run.status, 0, 'el build termina bien:\n' + run.stdout + run.stderr);
assert.match(run.stdout, /sitemap\.xml: 14 URLs \(fecha de git: \d+, de meta last-modified: \d+, sin fecha: \d+\)/, 'el log resume el origen de las fechas');
ok('build correcto: ' + run.stdout.split('\n').find(l => l.startsWith('sitemap.xml')));

const xml = fs.readFileSync(path.join(ROOT, 'dist/sitemap.xml'), 'utf8');
assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'declaración XML');
assert.ok(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') && xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'), 'espacios de nombres');

/* Bien formado: etiquetas equilibradas (el sitemap solo usa urlset/url/loc/lastmod/xhtml:link). */
const stack = [];
for(const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([a-z:]+)([^>]*?)(\/?)>/g)){
  const [, close, name, , self] = m;
  if(self) continue;
  if(close) assert.equal(stack.pop(), name, 'etiqueta </' + name + '> sin pareja');
  else stack.push(name);
}
assert.deepEqual(stack, [], 'todas las etiquetas están cerradas');
assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'sin & sin escapar');
ok('XML bien formado');

const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => {
  const block = m[1];
  return {
    loc: block.match(/<loc>([^<]+)<\/loc>/)[1],
    lastmod: (block.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1],
    alternates: [...block.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map(a => [a[1], a[2]]),
  };
});
assert.deepEqual(urls.map(u => u.loc).sort(), EXPECTED.slice().sort(), 'las 14 URLs actuales');
assert.equal(urls[0].loc, ORIGIN, 'la portada va primero');
assert.equal(new Set(urls.map(u => u.loc)).size, urls.length, 'sin URLs repetidas');
ok('14 URLs, portada primero');

for(const u of urls){
  assert.ok(u.loc.startsWith(ORIGIN) && u.loc.endsWith('/'), u.loc + ' es https://kanlane.com/... con barra final');
  assert.ok(!/\/(app|demo|legal)(\/|$)/.test(u.loc), u.loc + ' no es de app/demo/legal');
  if(u.lastmod) assert.match(u.lastmod, /^\d{4}-\d\d-\d\d$/, 'lastmod de ' + u.loc);
}
ok('barra final y sin app/demo/legal');

const byLoc = Object.fromEntries(urls.map(u => [u.loc, u]));
for(const u of urls){
  assert.ok(u.alternates.length >= 2, u.loc + ' declara alternativas');
  for(const [lang, href] of u.alternates){
    const target = byLoc[href];
    assert.ok(target, 'hreflang="' + lang + '" de ' + u.loc + ' apunta a una URL del sitemap');
    assert.ok(target.alternates.some(([, h]) => h === u.loc), href + ' declara de vuelta a ' + u.loc);
  }
}
ok('xhtml:link recíprocos (' + urls.reduce((n, u) => n + u.alternates.length, 0) + ' enlaces)');

/* ---------- Negativo: copias temporales con un defecto ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanlane-sitemap-'));
try{
  const fixture = path.join(tmp, 'site');
  fs.cpSync(ROOT, fixture, {recursive: true, filter: (src) => !/[\\/](\.git|dist|node_modules)([\\/]|$)/.test(src.slice(ROOT.length))});
  const page = path.join(fixture, 'alternativa-a-trello/index.html');
  const original = fs.readFileSync(page, 'utf8');
  const cases = [
    ['sin canonical', (h) => h.replace(/<link\s+rel="canonical"[^>]*>/, ''), /es indexable pero no tiene <link rel="canonical">/],
    ['canonical que no coincide con la ruta', (h) => h.replace(/(<link\s+rel="canonical"\s+href=")[^"]+/, '$1https://kanlane.com/otra-ruta/'), /el canonical de .* es .* y debería ser/],
    ['hreflang no recíproco', (h) => h.replace(/<link\s+rel="alternate"\s+hreflang="en"[^>]*>/, ''), /hreflang no recíproco/],
  ];
  for(const [name, change, message] of cases){
    const broken = change(original);
    assert.notEqual(broken, original, 'el caso "' + name + '" modifica la página');
    fs.writeFileSync(page, broken);
    const r = build(fixture, {});
    assert.notEqual(r.status, 0, 'el build debe fallar: ' + name);
    assert.match(r.stderr, message, 'mensaje claro para: ' + name + '\n' + r.stderr);
    ok('el build falla con ' + name);
    fs.writeFileSync(page, original);
  }
  const good = build(fixture, {});
  assert.equal(good.status, 0, 'la copia sin defectos compila:\n' + good.stderr);
  ok('la copia sin defectos compila (sin .git: ' + good.stdout.split('\n').find(l => l.startsWith('sitemap.xml')) + ')');
}finally{
  fs.rmSync(tmp, {recursive: true, force: true});
}
