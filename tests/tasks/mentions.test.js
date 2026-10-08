/* Menciones en los comentarios (src/views/mentions.js): a quién se menciona en un texto.
   Uso: node tests/tasks/mentions.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {views:{}, utils:{html:{esc:(s) => String(s)}}, t:(text) => text};
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/views/mentions.js'), 'utf8'), vm.createContext({Workhub}));
const {find, spans} = Workhub.views.mentions;
const ok = (name) => console.log('OK   ' + name);

const TEAM = [{uid:'ana', name:'Ana'}, {uid:'anag', name:'Ana García'}, {uid:'bob', name:'Bob'}, {uid:'jose', name:'José Ñu'}, {uid:'vacio', name:''}];
const who = (text) => Array.from(find(text, TEAM)).join(',');

assert.equal(who('Hola @Bob, ¿lo miras?'), 'bob');
assert.equal(who('@bob y @ANA: revisad esto'), 'bob,ana', 'sin distinguir mayúsculas, en el orden en que aparecen');
assert.equal(who('(@Bob) «@Ana»\n@José Ñu'), 'bob,ana,jose');
assert.equal(who('@Bob @Bob @Bob'), 'bob', 'sin repetir');
ok('menciones sencillas');

assert.equal(who('Para @Ana García'), 'anag', 'el nombre largo no cuenta además como el corto');
assert.equal(who('Para @Ana Garcíaz'), 'ana', 'si el largo no es el nombre entero, vale el corto');
assert.equal(who('@Ana García y @Ana'), 'anag,ana');
ok('nombres que empiezan igual');

assert.equal(who('correo bob@Bob.com'), '', 'una arroba pegada a otra palabra no es una mención');
assert.equal(who('@Bobby y @Anabel'), '', 'ni un nombre que sigue con más letras');
assert.equal(who('@ Bob, @Nadie, @'), '');
assert.equal(who(''), '');
assert.equal(Array.from(find('@Bob', [])).length, 0);
assert.equal(Array.from(find(null, TEAM)).length, 0);
ok('lo que no es una mención');

assert.deepEqual(JSON.parse(JSON.stringify(spans('Hola @Ana García.', TEAM))), [{start:5, end:16, uid:'anag'}]);
ok('posición de cada mención en el texto');
console.log('Todo correcto.');
