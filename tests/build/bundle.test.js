/* scripts/bundle.js: al publicar, los scripts y las hojas de estilo de cada página se unen en
   unos pocos archivos. Se prueba con una dist/ de juguete y, al final, con la app de verdad. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {bundle, DIR} = require('../../scripts/bundle');

const repo = path.join(__dirname, '../..');
let passed = 0;
function test(name, fn){
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kanlane-bundle-'));
  try{ fn(out); }finally{ fs.rmSync(out, {recursive:true, force:true}); }
  passed++;
  console.log('ok   ' + name);
}
function write(out, files){
  Object.keys(files).forEach((rel) => {
    fs.mkdirSync(path.dirname(path.join(out, rel)), {recursive:true});
    fs.writeFileSync(path.join(out, rel), files[rel]);
  });
}
const read = (out, rel) => fs.readFileSync(path.join(out, rel), 'utf8');
const tags = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
const SCRIPTS = /<script src="([^"]+)"/g;
const SHEETS = /<link rel="stylesheet" href="([^"]+)"/g;

test('un grupo de scripts pasa a ser uno, en el mismo orden, y los sueltos se quitan', (out) => {
  write(out, {
    'app/index.html': '<body>\n<script src="../src/a.js"></script>\n<!-- comentario -->\n<script src="../src/b.js"></script>\n<script src="../src/c.js"></script>\n</body>',
    'src/a.js': 'var order = ["a"]',
    'src/b.js': '(function(){ order.push("b"); })()',
    'src/c.js': 'order.push("c") // sin salto de línea al final'
  });
  const r = bundle(out);
  const srcs = tags(read(out, 'app/index.html'), SCRIPTS);
  assert.equal(srcs.length, 1);
  assert.match(srcs[0], /^\.\.\/assets\/bundle\/[0-9a-f]{12}\.js$/);
  assert.deepEqual(r.removed, ['src/a.js', 'src/b.js', 'src/c.js']);
  assert.ok(!fs.existsSync(path.join(out, 'src/a.js')));
  const box = {};
  vm.runInNewContext(read(out, r.bundles[0]), box);
  assert.deepEqual(Array.from(box.order), ['a', 'b', 'c']);
});

test('[paquete aparte] corta el grupo y un script solo se queda como está', (out) => {
  write(out, {
    'app/index.html': '<script src="../src/a.js"></script>\n<!-- [paquete aparte] primero -->\n<script src="../src/b.js"></script>\n<script src="../src/c.js"></script>',
    'src/a.js': '1', 'src/b.js': '2', 'src/c.js': '3'
  });
  const r = bundle(out);
  const srcs = tags(read(out, 'app/index.html'), SCRIPTS);
  assert.equal(srcs[0], '../src/a.js');
  assert.equal(srcs.length, 2);
  assert.ok(fs.existsSync(path.join(out, 'src/a.js')));
  assert.deepEqual(r.removed, ['src/b.js', 'src/c.js']);
});

test('no toca etiquetas con más atributos ni de otros dominios', (out) => {
  const html = '<script src="https://www.gstatic.com/x.js"></script>\n<script src="../src/a.js"></script>\n<script src="../src/b.js" defer></script>\n<link rel="stylesheet" href="../a.css" media="print">\n<link rel="stylesheet" href="../b.css">';
  write(out, {'app/index.html': html, 'src/a.js': '1', 'src/b.js': '2', 'a.css': '', 'b.css': ''});
  const r = bundle(out);
  assert.equal(read(out, 'app/index.html'), html);
  assert.deepEqual(r.bundles, []);
});

test('las hojas se unen y sus url() relativas siguen apuntando al mismo archivo', (out) => {
  write(out, {
    'index.html': '<link rel="stylesheet" href="assets/css/fonts.css">\n<link rel="stylesheet" href="assets/css/views/x.css">',
    'assets/css/fonts.css': "@font-face{src:url('../fonts/G.woff2') format('woff2');}",
    'assets/css/views/x.css': '.a{background:url(../../img/a.png);}.b{background:url("/assets/img/b.svg");}.c{background:url(data:image/png;base64,AAAA);}',
    'assets/fonts/G.woff2': '', 'assets/img/a.png': ''
  });
  const r = bundle(out);
  const hrefs = tags(read(out, 'index.html'), SHEETS);
  assert.equal(hrefs.length, 1);
  assert.match(hrefs[0], /^assets\/bundle\/[0-9a-f]{12}\.css$/);
  const css = read(out, r.bundles[0]);
  assert.ok(css.includes("url('../fonts/G.woff2')"));
  assert.ok(css.includes('url(../img/a.png)'));
  assert.ok(css.includes('url("/assets/img/b.svg")'));
  assert.ok(css.includes('url(data:image/png;base64,AAAA)'));
});

test('dos páginas con el mismo grupo comparten paquete; las rutas absolutas siguen absolutas', (out) => {
  const page = '<script src="/src/a.js"></script><script src="/src/b.js"></script>';
  write(out, {'legal/uno/index.html': page, 'legal/dos/index.html': page, 'src/a.js': '1', 'src/b.js': '2'});
  const r = bundle(out);
  assert.equal(r.bundles.length, 1);
  assert.equal(r.pages, 2);
  assert.deepEqual(tags(read(out, 'legal/uno/index.html'), SCRIPTS), ['/' + r.bundles[0]]);
  assert.ok(r.bundles[0].startsWith(DIR + '/'));
});

test('un archivo que otra página sigue cargando suelto no se quita', (out) => {
  write(out, {
    'app/index.html': '<script src="../src/a.js"></script><script src="../src/b.js"></script>',
    'plugins/p/index.html': '<script src="../../src/a.js"></script><script src="../../src/b.js"></script><script src="../../src/c.js"></script>',
    'otra/index.html': '<script src="../src/b.js" defer></script>',
    'src/a.js': '1', 'src/b.js': '2', 'src/c.js': '3'
  });
  const r = bundle(out, ['plugins']);
  assert.deepEqual(r.removed, []);
  assert.equal(tags(read(out, 'plugins/p/index.html'), SCRIPTS).length, 3, 'las páginas de plugins no se tocan');
});

test("falla si un script no se puede unir ('use strict' suelto, currentScript o no existe)", (out) => {
  const page = '<script src="../src/a.js"></script><script src="../src/b.js"></script>';
  write(out, {'app/index.html': page, 'src/a.js': "/* nota */\n'use strict';\nvar a;", 'src/b.js': '2'});
  assert.throws(() => bundle(out), /use strict/);
  write(out, {'src/a.js': 'var s = document.currentScript;'});
  assert.throws(() => bundle(out), /currentScript/);
  fs.rmSync(path.join(out, 'src/a.js'));
  assert.throws(() => bundle(out), /no existe/);
});

test('la app de verdad: pocos archivos, el acceso va primero y el diccionario no viaja con el resto', (out) => {
  ['app', 'src', 'assets/css', 'assets/fonts'].forEach((d) => fs.cpSync(path.join(repo, d), path.join(out, d), {recursive:true}));
  const before = tags(read(out, 'app/index.html'), SCRIPTS);
  const r = bundle(out);
  const html = read(out, 'app/index.html');
  const srcs = tags(html, SCRIPTS);
  assert.ok(before.length > 90 && srcs.length <= 5, 'de ' + before.length + ' scripts a ' + srcs.length);
  assert.equal(tags(html, SHEETS).length, 1);
  /* El script que enseña el formulario va solo; la escena no está en la página (la pide él
     cuando hace falta), así que se queda suelta en dist/. */
  assert.equal(srcs[1], '../src/views/auth-early.js');
  assert.ok(!before.includes('../src/views/auth-scene.js') && fs.existsSync(path.join(out, 'src/views/auth-scene.js')));
  /* El diccionario se baja aparte y solo en inglés: ni está en la página ni dentro de un paquete. */
  assert.ok(!before.includes('../src/i18n/en.js'));
  assert.ok(fs.existsSync(path.join(out, 'src/i18n/en.js')));
  const all = r.bundles.filter((b) => b.endsWith('.js')).map((b) => read(out, b));
  assert.ok(all.every((js) => !js.includes("Workhub.i18n.add('en'")));
  /* El paquete del idioma es pequeño: va antes que el grande para pedir el diccionario cuanto antes. */
  const core = all.find((js) => js.includes('/* src/i18n/i18n.js */'));
  assert.ok(core && core.length < 40000 && !core.includes('/* src/main.js */'));
  all.forEach((js) => new vm.Script(js));
});

console.log('OK   empaquetado de scripts y estilos (' + passed + ' pruebas)');
