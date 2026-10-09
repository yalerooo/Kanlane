/* Minifica el JavaScript que se publica (lo usa scripts/build-public.js).

   En el repositorio el código va comentado y con nombres largos; publicado, sin comentarios, sin
   espacios y con las variables internas de cada función renombradas: pesa menos y no se lee a
   simple vista. No lo esconde: el JavaScript de una web siempre llega al navegador, y nada de lo
   que proteja datos puede depender de que no se lea (para eso están las reglas de Firestore y
   el Worker).

   - Los nombres de primer nivel de cada archivo no se tocan: los scripts son clásicos y comparten
     el ámbito global (window.Workhub…), así que renombrarlos rompería lo que otro archivo espera.
     Tampoco las propiedades de los objetos.
   - Usa terser, la única dependencia del build (scripts/package.json, versión fijada). Si no
     está instalada se instala sola con «npm ci» en scripts/; si no se puede, el build falla:
     nunca se publica sin minificar por un descuido. */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const OPTIONS = {compress: true, mangle: true, format: {comments: false}};

let lib = null;
function terser(){
  if(lib) return lib;
  try{ lib = require('terser'); }
  catch(e){
    console.log('minify: instalando terser (npm ci en scripts/)…');
    cp.execSync('npm ci --no-audit --no-fund', {cwd: __dirname, stdio: 'inherit'});
    lib = require('terser');
  }
  return lib;
}

/* name: de dónde sale el código, para el mensaje si no se puede leer. */
function minify(code, name){
  try{
    return terser().minify_sync(code, OPTIONS).code;
  }catch(e){
    throw new Error('minify: ' + name + ': ' + e.message + (e.line ? ' (línea ' + e.line + ')' : ''));
  }
}

/* Minifica en su sitio todos los .js de dir. skip: rutas (relativas a dir, con /) de archivos o
   carpetas que no se tocan. Devuelve {files, before, after}: cuántos y sus bytes. */
function minifyTree(dir, skip){
  const out = {files: 0, before: 0, after: 0};
  const walk = (rel) => {
    for(const d of fs.readdirSync(path.join(dir, rel), {withFileTypes: true})){
      const at = rel ? rel + '/' + d.name : d.name;
      if((skip || []).indexOf(at) !== -1) continue;
      if(d.isDirectory()){ walk(at); continue; }
      if(!d.name.endsWith('.js')) continue;
      const file = path.join(dir, at);
      const code = fs.readFileSync(file, 'utf8');
      const small = minify(code, at);
      fs.writeFileSync(file, small);
      out.files++;
      out.before += Buffer.byteLength(code);
      out.after += Buffer.byteLength(small);
    }
  };
  walk('');
  return out;
}

module.exports = {minify, minifyTree};
