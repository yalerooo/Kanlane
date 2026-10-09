/* scripts/minify.js: el JavaScript se publica minificado, sin comentarios y con las variables
   internas renombradas, pero sin tocar los nombres que comparten los scripts ni lo que hacen.
   Al final se construye dist/ y se comprueba lo publicado: node tests/build/minify.test.js */
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {minify, minifyTree} = require('../../scripts/minify');

const repo = path.join(__dirname, '../..');
const ok = (name) => console.log('ok   ' + name);

{
  const src = [
    '/* Comentario del archivo: no se publica. */',
    'const Compartido = {veces:0};',
    'function saludo(nombreLargo){',
    '  // comentario de línea',
    '  const textoInterno = "Hola " + nombreLargo;',
    '  Compartido.veces++;',
    '  return textoInterno;',
    '}',
    '(function(){ const soloAqui = saludo("Ana"); Compartido.ultimo = soloAqui; })();'
  ].join('\n');
  const small = minify(src, 'prueba');
  assert.ok(small.length < src.length);
  assert.ok(!/Comentario|comentario de línea/.test(small), 'sin comentarios');
  assert.ok(!/nombreLargo|textoInterno|soloAqui/.test(small), 'las variables internas se renombran');
  assert.ok(/\bCompartido\b/.test(small) && /\bsaludo\b/.test(small), 'los nombres de primer nivel se conservan: otro script puede usarlos');
  assert.ok(/veces/.test(small) && /ultimo/.test(small), 'las propiedades no se tocan');
  const ctx = vm.createContext({});
  vm.runInContext(small + ';this.r = [Compartido.veces, Compartido.ultimo, saludo("Luis")];', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.r)), [1, 'Hola Ana', 'Hola Luis']);
  ok('minifica sin cambiar lo que hace ni los nombres compartidos');
}

{
  assert.throws(() => minify('function (', 'roto.js'), /minify: roto\.js/);
  ok('un archivo que no se puede leer hace fallar el build, con su nombre');
}

{
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kanlane-minify-'));
  try{
    const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(out, rel)), {recursive:true}); fs.writeFileSync(path.join(out, rel), text); };
    const code = '/* nota */\nfunction f(valorLargo){ return valorLargo + 1; }\n';
    ['src/a.js', 'plugins/p/p.js', 'assets/bundle/x.js', 'sw.js'].forEach((f) => write(f, code));
    write('src/a.css', '/* nota */ a{color:red}');
    const res = minifyTree(out, ['plugins', 'assets/bundle', 'sw.js']);
    const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
    assert.equal(res.files, 1);
    assert.ok(res.after < res.before);
    assert.ok(!/nota/.test(read('src/a.js')));
    ['plugins/p/p.js', 'assets/bundle/x.js', 'sw.js'].forEach((f) => assert.equal(read(f), code, f + ' no se toca'));
    assert.ok(/nota/.test(read('src/a.css')), 'solo JavaScript');
    ok('minifica los .js de una carpeta y respeta lo que se le dice que salte');
  }finally{ fs.rmSync(out, {recursive:true, force:true}); }
}

/* Lo publicado de verdad: ningún .js de dist/ (salvo los plugins, que son páginas aparte) lleva
   comentarios de bloque ni los nombres de los archivos de origen, y todos se pueden leer. */
{
  cp.execFileSync(process.execPath, [path.join(repo, 'scripts/build-public.js')], {cwd: repo, stdio: 'pipe'});
  const dist = path.join(repo, 'dist');
  const list = (dir) => fs.readdirSync(dir, {withFileTypes:true}).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? (full === path.join(dist, 'plugins') ? [] : list(full)) : (d.name.endsWith('.js') ? [full] : []);
  });
  const files = list(dist);
  assert.ok(files.length >= 5, 'hay scripts publicados');
  files.forEach((file) => {
    const rel = path.relative(dist, file);
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(() => new vm.Script(text, {filename: rel}), rel + ' es JavaScript válido');
    assert.ok(!/\/\* src\/[\w/.-]+\.js \*\//.test(text), rel + ' no lleva los nombres de los archivos de origen');
    assert.ok(text.split('\n').length < 60, rel + ' va en pocas líneas (minificado)');
  });
  const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
  assert.ok(/\bBUILD\s*=\s*"[0-9a-f]{10}"/.test(sw) && /\bFILES\s*=\s*\["\/"/.test(sw), 'sw.js conserva su versión y su lista de archivos');
  ok('dist/: ' + files.length + ' scripts publicados, todos minificados');
}
console.log('\nTodo correcto.');
