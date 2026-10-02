/* Páginas públicas del sitio: qué carpetas son páginas indexables y cómo se genera
   sitemap.xml. Lo usan scripts/build-public.js (build y cabeceras) y scripts/dev.js.
   Para añadir una página o un idioma basta con crear su carpeta con un index.html
   que lleve <link rel="canonical"> y los <link rel="alternate" hreflang>. */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ORIGIN = 'https://kanlane.com/';

/* Carpetas de primer nivel que NO son páginas de captación indexables: la app, la demo y las
   páginas legales llevan noindex (y sus propias cabeceras); el resto son recursos o herramientas. */
const NOT_PAGES = ['app', 'demo', 'legal', 'assets', 'src', 'plugins', 'dist', 'docs', 'scripts', 'tests', 'worker', 'node_modules'];

/* Carpetas de primer nivel con index.html que son páginas públicas (es: alternativa-a-trello/…; idiomas: en/). */
function pageDirs(root){
  return fs.readdirSync(root, {withFileTypes: true})
    .filter((d) => d.isDirectory() && d.name[0] !== '.' && NOT_PAGES.indexOf(d.name) === -1 && fs.existsSync(path.join(root, d.name, 'index.html')))
    .map((d) => d.name)
    .sort();
}

/* ---------- Lectura del HTML ---------- */

const tagsOf = (html, name) => (html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || []);
const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i')); return m ? m[1] : null; };
const linksWith = (html, rel) => tagsOf(html, 'link').filter((t) => (attr(t, 'rel') || '').toLowerCase() === rel);
const metaContent = (html, name) => { const t = tagsOf(html, 'meta').find((x) => (attr(x, 'name') || '').toLowerCase() === name); return t ? attr(t, 'content') : null; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Rutas (con barra final; '' = portada) de todos los index.html que cuelgan de una carpeta. */
function indexRoutes(dir, rel, acc){
  fs.readdirSync(path.join(dir, rel), {withFileTypes: true}).forEach((d) => {
    if(d.isDirectory()) indexRoutes(dir, rel + d.name + '/', acc);
    else if(d.name === 'index.html') acc.push(rel);
  });
  return acc;
}

/* ---------- Fecha de modificación ---------- */

let gitUsable = null;
function git(root, args){
  return cp.execFileSync('git', args, {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
}
/* En un clon superficial (--depth) todos los archivos figurarían con la fecha del último commit:
   sería una fecha falsa, así que ahí no se usa git. */
function gitDate(root, file){
  if(gitUsable === null){
    try{ gitUsable = git(root, ['rev-parse', '--is-shallow-repository']) === 'false'; }catch(e){ gitUsable = false; }
  }
  if(!gitUsable) return null;
  try{
    const iso = git(root, ['log', '-1', '--format=%cI', '--', file]);
    return /^\d{4}-\d\d-\d\d/.test(iso) ? iso.slice(0, 10) : null;
  }catch(e){ return null; }
}

/* ---------- sitemap.xml ----------
   Recorre los index.html de dist/ (portada y carpetas de pages), salta los noindex y devuelve
   {xml, count, sources}. Lanza Error con un mensaje claro si algo no cuadra. */
function buildSitemap(dist, srcRoot, pages){
  gitUsable = null;
  const routes = indexRoutes(dist, '', []).filter((r) => r === '' || pages.indexOf(r.split('/')[0]) !== -1);
  const entries = [];
  const seen = {};
  routes.forEach((route) => {
    const where = '/' + route + 'index.html';
    const html = fs.readFileSync(path.join(dist, route, 'index.html'), 'utf8');
    if(/noindex/i.test(metaContent(html, 'robots') || '')) return;
    const canon = linksWith(html, 'canonical').map((t) => attr(t, 'href'));
    if(canon.length === 0) throw new Error('sitemap: ' + where + ' es indexable pero no tiene <link rel="canonical">');
    if(canon.length > 1) throw new Error('sitemap: ' + where + ' tiene ' + canon.length + ' canonical (debe tener uno)');
    if(canon[0] !== ORIGIN + route) throw new Error('sitemap: el canonical de ' + where + ' es "' + canon[0] + '" y debería ser "' + ORIGIN + route + '"');
    if(seen[canon[0]]) throw new Error('sitemap: canonical duplicado ' + canon[0] + ' (' + where + ' y ' + seen[canon[0]] + ')');
    seen[canon[0]] = where;
    const alternates = [];
    linksWith(html, 'alternate').forEach((t) => {
      const lang = attr(t, 'hreflang');
      if(lang === null) return;
      if(alternates.some((a) => a.lang === lang)) throw new Error('sitemap: hreflang="' + lang + '" repetido en ' + where);
      alternates.push({lang: lang, href: attr(t, 'href')});
    });
    let lastmod = gitDate(srcRoot, route + 'index.html');
    let source = 'git';
    if(!lastmod){
      const meta = metaContent(html, 'last-modified');
      lastmod = meta && /^\d{4}-\d\d-\d\d$/.test(meta) ? meta : null;
      source = lastmod ? 'meta' : 'sin fecha';
    }
    entries.push({loc: canon[0], where: where, alternates: alternates, lastmod: lastmod, source: source});
  });

  /* hreflang recíproco: cada alternativa apunta a una página incluida que declara de vuelta a esta. */
  entries.forEach((e) => e.alternates.forEach((a) => {
    const target = entries.find((x) => x.loc === a.href);
    if(!target) throw new Error('sitemap: hreflang="' + a.lang + '" de ' + e.where + ' apunta a ' + a.href + ', que no es una página indexable del sitio');
    if(target !== e && !target.alternates.some((b) => b.href === e.loc)) throw new Error('sitemap: hreflang no recíproco: ' + e.where + ' declara ' + a.href + ' pero esa página no declara ' + e.loc);
  }));

  /* Portada primero y el resto por ruta: orden estable. */
  entries.sort((a, b) => (a.loc === ORIGIN ? -1 : b.loc === ORIGIN ? 1 : a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
  const sources = {git: 0, meta: 0, 'sin fecha': 0};
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    .concat(entries.map((e) => {
      sources[e.source]++;
      return ['  <url>', '    <loc>' + esc(e.loc) + '</loc>']
        .concat(e.lastmod ? ['    <lastmod>' + e.lastmod + '</lastmod>'] : [])
        .concat(e.alternates.map((a) => '    <xhtml:link rel="alternate" hreflang="' + esc(a.lang) + '" href="' + esc(a.href) + '"/>'))
        .concat(['  </url>']).join('\n');
    }), ['</urlset>', '']).join('\n');
  return {xml: xml, count: entries.length, sources: sources};
}

module.exports = {ORIGIN, NOT_PAGES, pageDirs, buildSitemap};
