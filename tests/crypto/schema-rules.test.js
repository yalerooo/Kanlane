/* El esquema del cliente (src/models/enc-schema.js) tiene que coincidir con firestore.rules:
   campos de un documento sellado (encFields), tamaño de `e` (encMax), colecciones sellables
   (isSealable) y los límites de texto y de listas que el servidor aplicaba en claro (validData).
   Plan: docs/CIFRADO-PROYECTOS.md, 6.2 y 14.1. Uso: node tests/crypto/schema-rules.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);

const Workhub = {models:{}};
new Function('Workhub', read('src/models/enc-schema.js'))(Workhub);
const Schema = Workhub.models.EncSchema;
const rules = read('firestore.rules');

/* Cuerpo de una función de las reglas. */
function body(name){
  const start = rules.indexOf('function ' + name + '(');
  assert.ok(start !== -1, 'las reglas tienen ' + name + '()');
  const open = rules.indexOf('{', start);
  let depth = 0;
  for(let i = open; i < rules.length; i++){
    if(rules[i] === '{') depth++;
    else if(rules[i] === '}' && --depth === 0) return rules.slice(open + 1, i);
  }
  throw new Error('función sin cerrar: ' + name);
}
const names = (list) => (list.match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
const sorted = (list) => list.slice().sort();

/* isSealable */
const sealable = names(body('isSealable').match(/\[([^\]]*)\]/)[1]);
assert.deepEqual(sorted(sealable), sorted(Schema.COLLECTIONS));
ok('colecciones sellables: ' + sealable.join(', '));

/* encFields */
const fieldsBody = body('encFields');
const ruleFields = {};
const re = /col == '([a-z_]+)' \? \[([^\]]*)\]/g;
let m;
while((m = re.exec(fieldsBody))) ruleFields[m[1]] = names(m[2]);
assert.deepEqual(sorted(Object.keys(ruleFields)), sorted(Schema.COLLECTIONS), 'encFields cubre todas las colecciones');
Schema.COLLECTIONS.forEach((col) => {
  assert.deepEqual(sorted(ruleFields[col]), sorted(Schema.sealedFields(col)), 'campos sellados de ' + col);
  ['e', 'ev', 'kid'].forEach((k) => assert.ok(!Schema.isClear(col, k), k + ' no es un campo en claro'));
});
ok('encFields() coincide con EncSchema en las ' + Schema.COLLECTIONS.length + ' colecciones');

/* encMax: «col == 'x' ? N» y un valor final para las demás. */
const maxBody = body('encMax');
const ruleMax = {};
const reMax = /col == '([a-z_]+)' \? (\d+)/g;
while((m = reMax.exec(maxBody))) ruleMax[m[1]] = Number(m[2]);
const rest = Number(maxBody.match(/:\s*(\d+)\s*;/)[1]);
Schema.COLLECTIONS.forEach((col) => {
  assert.equal(Schema.maxE(col), col in ruleMax ? ruleMax[col] : rest, 'tamaño máximo de e en ' + col);
});
ok('encMax() coincide con EncSchema');

/* validData: límites de texto y de listas por colección. */
const dataBody = body('validData');
const blocks = {};
const parts = dataBody.split(/\(col != '/).slice(1);
parts.forEach((part) => {
  const col = part.slice(0, part.indexOf("'"));
  const text = {}, list = {};
  const reText = /textWithin\(data, '([A-Za-z0-9]+)', (\d+)\)/g;
  const reList = /listWithin\(data, '([A-Za-z0-9]+)', (\d+)\)/g;
  let x;
  while((x = reText.exec(part))) text[x[1]] = Number(x[2]);
  while((x = reList.exec(part))) list[x[1]] = Number(x[2]);
  blocks[col] = {text, list};
});
/* Campos que no existen en la forma sellada: los bytes de la imagen van dentro de `e`, cuyo tope es encMax. */
const GONE = {assets:['data']};
Schema.COLLECTIONS.forEach((col) => {
  const rule = blocks[col] || {text:{}, list:{}};
  /* Los campos que siguen en claro los sigue validando el servidor (validSealed): aquí, solo los secretos. */
  const secretOnly = (o) => Object.fromEntries(Object.entries(o)
    .filter(([k]) => !Schema.isClear(col, k) && (GONE[col] || []).indexOf(k) === -1));
  assert.deepEqual(secretOnly(Schema.textLimits(col)), secretOnly(rule.text), 'límites de texto de ' + col);
  /* assignees va en claro y lo limitan las dos partes. */
  const lists = Schema.listLimits(col);
  Object.keys(rule.list).forEach((k) => assert.equal(lists[k], rule.list[k], 'límite de la lista ' + col + '.' + k));
  assert.deepEqual(sorted(Object.keys(lists)), sorted(Object.keys(rule.list)), 'listas limitadas de ' + col);
});
ok('los límites de texto y de listas coinciden con validData()');

/* Utilidades del esquema. */
assert.equal(Schema.collectionOf('tasks/abc/notes'), 'notes');
assert.equal(Schema.collectionOf('tasks'), 'tasks');
assert.equal(Schema.isSealable('projects'), false);
assert.deepEqual(Schema.sealedFields('projects'), []);
assert.ok(Object.isFrozen(Schema));
ok('collectionOf, isSealable y el objeto congelado');

console.log('\nTodo correcto.');
