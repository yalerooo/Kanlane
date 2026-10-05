/* Une los scripts y las hojas de estilo de cada página de dist/ (lo usa scripts/build-public.js).

   En el repositorio cada página carga sus archivos sueltos (la app, más de cien scripts y casi
   treinta hojas): cómodo para desarrollar, lento de bajar. Al publicar, cada grupo de etiquetas
   seguidas se sustituye por una sola que apunta a dist/assets/bundle/<resumen>.js o .css, con el
   contenido de todas en el mismo orden. No hace falta instalar nada: solo se pegan los archivos.

   - Un grupo son dos o más <script src="…"></script> (o <link rel="stylesheet" href="…">)
     seguidos, separados solo por espacios o comentarios. Las etiquetas con más atributos (defer,
     media…) y las de otros dominios no se tocan.
   - Un comentario con [paquete aparte] entre dos etiquetas corta el grupo: lo de antes y lo de
     después van en archivos distintos (para lo que tiene que ejecutarse cuanto antes).
   - El nombre lleva el resumen del contenido: si no cambia nada, el navegador reutiliza el que
     tiene (se sirven con caché de un año, ver _headers); dos páginas con el mismo grupo lo comparten.
   - Los archivos sueltos que ya no carga ninguna página se quitan de dist/, para que el service
     worker no los guarde por duplicado. Los que se piden por su ruta desde el código (el
     diccionario src/i18n/en.js) no están en ninguna etiqueta, así que se quedan. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = 'assets/bundle';
const LOCAL = '(?!https?:|//)[^"]+';
const GAP = '(?:\\s|<!--(?:(?!-->|\\[paquete aparte\\])[\\s\\S])*-->)*';
const KINDS = [
  {ext: 'js', tag: '<script src="(' + LOCAL + ')"></script>', html: (url) => '<script src="' + url + '"></script>'},
  {ext: 'css', tag: '<link rel="stylesheet" href="(' + LOCAL + ')">', html: (url) => '<link rel="stylesheet" href="' + url + '">'}
];

const posix = (p) => p.split(path.sep).join('/');

function htmlFiles(dir){
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? htmlFiles(full) : (d.name.endsWith('.html') ? [full] : []);
  });
}

/* Archivo de dist/ al que apunta una URL escrita en una página (o en una hoja de estilos). */
function resolve(out, fromDir, url){
  const clean = url.split(/[?#]/)[0];
  const file = clean[0] === '/' ? path.join(out, clean) : path.resolve(fromDir, clean);
  if(path.relative(out, file).startsWith('..')) throw new Error('bundle: ' + url + ' sale de dist/');
  return file;
}

/* Las url(…) relativas de una hoja valen desde su carpeta: se reescriben para la del paquete. */
function cssFrom(out, file){
  const css = fs.readFileSync(file, 'utf8');
  if(/@import\b/.test(css)) throw new Error('bundle: ' + posix(path.relative(out, file)) + ' usa @import; no se puede unir');
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, quote, url) => {
    if(/^(data:|https?:|\/|#)/.test(url)) return all;
    return 'url(' + quote + posix(path.relative(path.join(out, DIR), resolve(out, path.dirname(file), url))) + quote + ')';
  });
}

function jsFrom(out, file){
  const js = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rel = posix(path.relative(out, file));
  /* Unidos, un 'use strict' suelto valdría para todos los demás y currentScript sería el paquete. */
  if(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*['"]use strict['"]/.test(js)) throw new Error('bundle: ' + rel + " tiene 'use strict' fuera de una función; no se puede unir");
  if(/document\.currentScript/.test(js)) throw new Error('bundle: ' + rel + ' usa document.currentScript; no se puede unir');
  /* El punto y coma evita que un archivo sin él al final se pegue al paréntesis del siguiente. */
  return '/* ' + rel + ' */\n' + js + '\n;\n';
}

/* out: la carpeta dist/. skip: carpetas de primer nivel cuyas páginas no se tocan.
   Devuelve {bundles, removed, pages}. */
function bundle(out, skip){
  const pages = htmlFiles(out).filter((f) => (skip || []).indexOf(posix(path.relative(out, f)).split('/')[0]) === -1);
  const made = new Map();     /* resumen → ruta del paquete */
  const used = new Set();     /* archivos que han entrado en algún paquete */
  let touched = 0;

  for(const page of pages){
    const dir = path.dirname(page);
    let html = fs.readFileSync(page, 'utf8');
    const before = html;
    for(const kind of KINDS){
      const run = new RegExp(kind.tag + '(?:' + GAP + kind.tag + ')+', 'g');
      html = html.replace(run, (group) => {
        const urls = [...group.matchAll(new RegExp(kind.tag, 'g'))].map((m) => m[1]);
        const files = urls.map((u) => {
          const file = resolve(out, dir, u);
          if(!fs.existsSync(file)) throw new Error('bundle: ' + posix(path.relative(out, page)) + ' carga ' + u + ', que no existe');
          return file;
        });
        const text = files.map((f) => (kind.ext === 'js' ? jsFrom(out, f) : cssFrom(out, f))).join(kind.ext === 'js' ? '' : '\n');
        const name = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12) + '.' + kind.ext;
        const target = path.join(out, DIR, name);
        if(!made.has(name)){
          fs.mkdirSync(path.dirname(target), {recursive: true});
          fs.writeFileSync(target, text);
          made.set(name, target);
        }
        files.forEach((f) => used.add(f));
        /* Con el mismo estilo de ruta que tenía la página: absoluta o relativa. */
        return kind.html(urls[0][0] === '/' ? '/' + DIR + '/' + name : posix(path.relative(dir, target)));
      });
    }
    if(html !== before){ fs.writeFileSync(page, html); touched++; }
  }

  /* Lo que alguna página de dist/ (también las que no se han tocado) sigue cargando suelto, se queda. */
  const kept = new Set();
  for(const page of htmlFiles(out)){
    const html = fs.readFileSync(page, 'utf8');
    for(const m of html.matchAll(/\s(?:src|href)="((?!https?:|\/\/|data:|#|mailto:)[^"]+)"/g)){
      try{ kept.add(resolve(out, path.dirname(page), m[1])); }catch(e){}
    }
  }
  const removed = [...used].filter((f) => !kept.has(f));
  removed.forEach((f) => fs.rmSync(f));

  return {bundles: [...made.values()].map((f) => posix(path.relative(out, f))).sort(), removed: removed.map((f) => posix(path.relative(out, f))).sort(), pages: touched};
}

module.exports = {bundle, DIR};
