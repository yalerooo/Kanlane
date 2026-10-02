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

/* Bloques JSON-LD de una página, ya interpretados. Lanza Error si alguno no es JSON válido. */
function jsonLd(html, where){
  return (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).map((s) => {
    try{ return JSON.parse(s.replace(/^<script[^>]*>|<\/script>$/g, '')); }
    catch(e){ throw new Error((where || 'página') + ': el JSON-LD no es JSON válido (' + e.message + ')'); }
  });
}

/* Valores de "dateModified" de todos los nodos del JSON-LD de una página. */
function jsonLdDates(html, where){
  const dates = [];
  const walk = (n) => {
    if(Array.isArray(n)) return n.forEach(walk);
    if(n && typeof n === 'object'){
      if(typeof n.dateModified === 'string') dates.push(n.dateModified);
      Object.keys(n).forEach((k) => walk(n[k]));
    }
  };
  jsonLd(html, where).forEach(walk);
  return dates;
}

/* Rutas (con barra final; '' = portada) de todos los index.html que cuelgan de una carpeta. */
function indexRoutes(dir, rel, acc){
  fs.readdirSync(path.join(dir, rel), {withFileTypes: true}).forEach((d) => {
    if(d.isDirectory()) indexRoutes(dir, rel + d.name + '/', acc);
    else if(d.name === 'index.html') acc.push(rel);
  });
  return acc;
}

/* ---------- Fecha de modificación ---------- */

/* Formato de <meta name="last-modified" content="YYYY-MM-DD">: debe ser una fecha real. */
function validDate(v){
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v || "")) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}

/* Ficheros index.html (relativos a root, con "/") de las páginas indexables del repositorio:
   la portada y las carpetas de pageDirs() con sus subcarpetas, sin las que llevan noindex. */
function pageFiles(root){
  const files = [];
  const add = (rel) => {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    if(!/noindex/i.test(metaContent(html, 'robots') || '')) files.push(rel);
  };
  add('index.html');
  pageDirs(root).forEach((d) => indexRoutes(root, d + '/', []).forEach((r) => add(r + 'index.html')));
  return files.sort();
}

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
  const missing = [];
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
    const meta = metaContent(html, 'last-modified');
    if(meta !== null && !validDate(meta)) throw new Error('sitemap: <meta name="last-modified"> de ' + where + ' vale "' + meta + '" y debe ser una fecha YYYY-MM-DD válida');
    if(meta === null) missing.push(where);
    /* El JSON-LD debe ser válido y su dateModified (si lo hay) coincidir con la meta: si no, el dato
       estructurado diría una fecha distinta a la del sitemap. node scripts/update-lastmod.js los sincroniza. */
    jsonLdDates(html, where).forEach((d) => {
      if(meta === null) return; /* sin meta solo avisa (ver `missing`) */
      if(d !== meta) throw new Error('sitemap: el "dateModified" del JSON-LD de ' + where + ' es "' + d + '" y <meta name="last-modified"> es "' + meta + '". Ejecuta: node scripts/update-lastmod.js');
    });
    let lastmod = gitDate(srcRoot, route + 'index.html');
    let source = 'git';
    if(!lastmod){
      lastmod = meta;
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
  return {xml: xml, count: entries.length, sources: sources, missing: missing};
}

module.exports = {ORIGIN, NOT_PAGES, pageDirs, pageFiles, buildSitemap, validDate, metaContent, jsonLd, jsonLdDates, gitDate, git};
