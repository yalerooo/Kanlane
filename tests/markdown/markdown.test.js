/* Markdown de las descripciones y las notas (src/utils/markdown.js): formato, casillas y,
   sobre todo, que nada de lo escrito llegue como HTML ni como enlace peligroso. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {utils:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/utils/markdown.js'), 'utf8'), {Workhub});
const md = Workhub.utils.markdown;

let passed = 0;
function test(name, fn){
  fn();
  passed++;
  console.log('ok   ' + name);
}

test('el texto plano se conserva con sus saltos de línea', () => {
  assert.equal(md.render('Hola\nmundo\n\nOtro párrafo'), '<p>Hola<br>mundo</p><p>Otro párrafo</p>');
  assert.equal(md.render(''), '');
  assert.equal(md.render(null), '');
});

test('el HTML escrito se escapa siempre', () => {
  const out = md.render('<img src=x onerror=alert(1)> **<b>hola</b>** `<script>`\n\n```\n<script>alert(1)</script>\n```');
  assert.doesNotMatch(out, /<img|<script|<b>/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /<strong>&lt;b&gt;hola&lt;\/b&gt;<\/strong>/);
  assert.match(out, /<pre><code>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code><\/pre>/);
});

test('negrita, cursiva, tachado y código', () => {
  assert.equal(md.render('**a** __b__ *c* _d_ ~~e~~ `f*g*`'),
    '<p><strong>a</strong> <strong>b</strong> <em>c</em> <em>d</em> <del>e</del> <code>f*g*</code></p>');
  /* Los guiones bajos y los asteriscos sueltos no son formato. */
  assert.equal(md.render('mi_variable_larga y 2 * 3 * 4'), '<p>mi_variable_larga y 2 * 3 * 4</p>');
});

test('solo se enlazan direcciones http, https y mailto', () => {
  assert.equal(md.render('[web](https://kanlane.com/a?b=1&c=2)'),
    '<p><a href="https://kanlane.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">web</a></p>');
  assert.match(md.render('[correo](mailto:hola@kanlane.com)'), /href="mailto:hola@kanlane.com"/);
  ['[x](javascript:alert(1))', '[x](data:text/html,hola)', '[x](vbscript:msgbox)', '[x](//evil.example)'].forEach((src) => {
    assert.doesNotMatch(md.render(src), /<a /, src);
  });
  /* Una comilla no cierra el atributo. */
  assert.doesNotMatch(md.render('[x](https://a.com/"onmouseover="alert(1))'), /"onmouseover/);
});

test('las direcciones sueltas se enlazan sin la puntuación final', () => {
  assert.equal(md.render('Mira https://kanlane.com/app_demo.'),
    '<p>Mira <a href="https://kanlane.com/app_demo" target="_blank" rel="noopener noreferrer nofollow">https://kanlane.com/app_demo</a>.</p>');
});

test('una imagen de Markdown sale como enlace: no se carga nada de fuera', () => {
  const out = md.render('![captura](https://example.com/a.png)');
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /<a href="https:\/\/example.com\/a.png"[^>]*>captura<\/a>/);
});

test('títulos, citas, líneas y bloques de código', () => {
  assert.equal(md.render('# Uno\n#### Cuatro'),
    '<p class="md-h md-h1" role="heading" aria-level="3">Uno</p><p class="md-h md-h3" role="heading" aria-level="5">Cuatro</p>');
  assert.equal(md.render('> cita\n> sigue'), '<blockquote>cita<br>sigue</blockquote>');
  assert.equal(md.render('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
  assert.equal(md.render('```js\nconst a = **1**;\n```'), '<pre><code>const a = **1**;</code></pre>');
  /* Sin cerrar: el bloque llega hasta el final. */
  assert.equal(md.render('```\nabierto'), '<pre><code>abierto</code></pre>');
});

test('listas con viñetas, numeradas y anidadas', () => {
  assert.equal(md.render('- uno\n- dos\n  - dentro\n- tres'),
    '<ul><li>uno</li><li>dos<ul><li>dentro</li></ul></li><li>tres</li></ul>');
  assert.equal(md.render('1. uno\n2) dos'), '<ol><li>uno</li><li>dos</li></ol>');
  assert.equal(md.render('texto\n- lista\ntexto'), '<p>texto</p><ul><li>lista</li></ul><p>texto</p>');
});

test('las casillas se numeran en orden y solo se pueden marcar si se pide', () => {
  const src = '- [ ] uno\n- [x] dos\n\ntexto\n\n1. [X] tres';
  const fixed = md.render(src);
  assert.equal((fixed.match(/disabled/g) || []).length, 3);
  const live = md.render(src, {tasks:'interactive'});
  assert.doesNotMatch(live, /disabled/);
  assert.match(live, /<li class="md-task"><input type="checkbox" data-md-task="0"><span>uno<\/span><\/li>/);
  assert.match(live, /<li class="md-task is-done"><input type="checkbox" data-md-task="1" checked><span>dos<\/span><\/li>/);
  assert.match(live, /data-md-task="2" checked/);
});

test('toggleTask cambia solo la casilla pedida y se salta el código', () => {
  const src = '```\n- [ ] no cuenta\n```\n- [ ] uno\n* [x] dos\n- sin casilla\n- [ ] tres';
  assert.equal(md.toggleTask(src, 0, true), src.replace('- [ ] uno', '- [x] uno'));
  assert.equal(md.toggleTask(src, 1, false), src.replace('* [x] dos', '* [ ] dos'));
  assert.equal(md.toggleTask(src, 2, true), src.replace('- [ ] tres', '- [x] tres'));
  assert.equal(md.toggleTask(src, 9, true), src);
  /* El número coincide con el de render(). */
  assert.match(md.render(md.toggleTask(src, 2, true), {tasks:'interactive'}), /data-md-task="2" checked/);
});

test('plain quita las marcas para los resúmenes', () => {
  assert.equal(md.plain('# Título\n**negrita** y [enlace](https://a.com)\n- [ ] pendiente\n- [x] hecha\n- viñeta\n```\ncódigo\n```'),
    'Título\nnegrita y enlace\n☐ pendiente\n☑ hecha\n· viñeta\ncódigo');
  assert.equal(md.plain('texto normal_con_guiones'), 'texto normal_con_guiones');
});

console.log('\n' + passed + ' pruebas correctas');
