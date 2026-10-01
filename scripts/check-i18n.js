#!/usr/bin/env node
/* Busca textos en español que no tienen traducción al inglés.

   Kanlane traduce por coincidencia exacta con el texto en español (src/i18n/en.js),
   así que si alguien cambia un texto de la interfaz la traducción se pierde sin
   avisar. Este script lo detecta:
   - textos y atributos (placeholder, title, aria-label, alt) de app/index.html;
   - los textos literales que se pasan a Workhub.t('…') en src/.
   Un texto cuenta como traducido si está en el diccionario o encaja con algún patrón.

   Uso:  node scripts/check-i18n.js           lista lo que falta
         node scripts/check-i18n.js --strict  termina con error si falta algo (para CI) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const strict = process.argv.includes('--strict');

/* ---------- Diccionario ---------- */
const dict = {};
const patterns = [];
const sandbox = {
  Workhub: {i18n: {add: (code, exact, pats) => {
    if(code !== 'en') return;
    Object.assign(dict, exact || {});
    (pats || []).forEach((p) => patterns.push(p[0]));
  }}}
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'src/i18n/en.js'), 'utf8'), sandbox);

function translated(text){
  if(Object.prototype.hasOwnProperty.call(dict, text)) return true;
  return patterns.some((re) => re.test(text));
}

/* Ejemplos de campos, nombres propios o del sistema: no se traducen. */
const IGNORE = new Set(['XXXX-XXXX-XXXX-…', 'ghp_…', 'Español', 'start-workhub.bat']);

function needsTranslation(text){
  if(IGNORE.has(text)) return false;
  if(!/[a-záéíóúñü]{3,}/i.test(text)) return false;
  if(/^[\w.+-]+@[\w.-]+$/.test(text)) return false;       /* correos */
  if(/^https?:\/\//.test(text)) return false;
  if(/^[A-Z]\w*$/.test(text)) return false;                /* nombres propios de una palabra */
  return true;
}

/* Marca entre los trozos de una frase partida por etiquetas en línea (<b>, <code>…). */
const SEP = String.fromCharCode(1);
const found = new Map();   /* texto → dónde */

function clean(t){ return t.replace(/\s+/g, ' ').trim(); }

function note(text, where){
  const parts = text.split(SEP);
  const whole = clean(parts.join(''));
  /* Con etiquetas en línea vale la frase entera o cada trozo por separado. */
  if(parts.length > 1 && (translated(whole) || parts.every((p) => { const t = clean(p); return !needsTranslation(t) || translated(t); }))) return;
  if(!whole || !needsTranslation(whole) || translated(whole) || found.has(whole)) return;
  found.set(whole, where);
}

/* ---------- index.html ---------- */
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<\/?(?:b|strong|i|em|code|a|kbd|mark)\b[^>]*>/g, SEP);
let m;
const attr = /\b(?:placeholder|title|aria-label|alt)="([^"]+)"/g;
while((m = attr.exec(html))) note(m[1], 'index.html');
const nodes = />([^<>]+)</g;
while((m = nodes.exec(html))) note(m[1], 'index.html');

/* ---------- Archivos de src/ ---------- */
function walk(dir, out){
  fs.readdirSync(dir, {withFileTypes: true}).forEach((d) => {
    const p = path.join(dir, d.name);
    if(d.isDirectory()) walk(p, out);
    else if(d.name.endsWith('.js') && !p.includes(path.join('src', 'i18n'))) out.push(p);
  });
  return out;
}
walk(path.join(root, 'src'), []).forEach((file) => {
  const src = fs.readFileSync(file, 'utf8');
  const call = /\bWorkhub\.t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  let c;
  while((c = call.exec(src))){
    const text = (c[1] != null ? c[1] : c[2]).replace(/\\(.)/g, '$1');
    note(text, path.relative(root, file));
  }
});

/* ---------- Resultado ---------- */
if(!found.size){
  console.log('Todos los textos tienen traducción.');
  process.exit(0);
}
console.log('Textos sin traducción al inglés (' + found.size + '):\n');
found.forEach((where, text) => console.log('  ' + where.padEnd(34) + ' ' + text));
console.log('\nAñádelos a src/i18n/en.js.');
process.exit(strict ? 1 : 0);
