/* Límite de las imágenes de las notas: el cliente (src/services/firebase-backend.js) nunca
   debe aceptar una imagen que las reglas de Firestore (firestore.rules) vayan a rechazar.
   Sin navegador: la compresión con canvas se apoya en fitImage(), que es pura y se prueba
   aquí con un «render» simulado que devuelve data: URL de la longitud que se le pida. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const backendSource = fs.readFileSync(path.join(root, 'src/services/firebase-backend.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

/* El IIFE del backend solo define funciones y publica Workhub.services.firebase. */
const Workhub = {services:{}, utils:{}};
vm.runInNewContext(backendSource, {Workhub, window:{}});
const limits = Workhub.services.firebase.imageLimits;
assert.ok(limits, 'firebase-backend publica imageLimits');

let passed = 0;
function test(name, fn){
  fn();
  passed++;
  console.log('ok   ' + name);
}

const PREFIX = 'data:image/jpeg;base64,';
const dataUrl = (length) => PREFIX + 'A'.repeat(Math.max(0, length - PREFIX.length));

/* ---------- Cliente frente a reglas ---------- */

test('las reglas limitan el campo data de assets y el cliente queda por debajo', () => {
  const m = rules.match(/col != 'assets'[\s\S]*?textWithin\(data, 'data', (\d+)\)/);
  assert.ok(m, 'firestore.rules valida data en la colección assets con textWithin');
  const rulesMax = Number(m[1]);
  assert.equal(limits.maxChars, 880000);
  assert.ok(limits.maxChars < rulesMax, 'cliente ' + limits.maxChars + ' < reglas ' + rulesMax);
  assert.ok(rulesMax - limits.maxChars >= 10000, 'queda margen frente a las reglas');
});

test('el límite del cliente se mide en caracteres reales, no en bytes estimados', () => {
  assert.doesNotMatch(backendSource, /IMAGE_MAX_BYTES/);
  assert.doesNotMatch(backendSource, /\.length \* 0\.75/);
  assert.match(backendSource, /const IMAGE_MAX_CHARS = (\d+);/);
  assert.equal(Number(backendSource.match(/const IMAGE_MAX_CHARS = (\d+);/)[1]), limits.maxChars);
});

test('las imágenes de equipo pasan por la misma validación', () => {
  const team = rules.match(/function isTeamCollection\(col\) \{\s*return col in \[([^\]]*)\]/);
  assert.ok(team && /'assets'/.test(team[1]), 'assets es colección de equipo');
  /* Desde el PR 2 del cifrado la escritura pasa por validWrite, que sin sellar cae en validData (donde está el límite de assets). */
  assert.match(rules, /allow create: if isTeamCollection\(col\) && canEdit\(tid\) && validWrite\(col\)/);
  /* Desde el PR 10 se añade teamKid (lo sellado, con la clave vigente del equipo): no afecta a las imágenes en claro. */
  /* Y, con las automatizaciones, una condición más que solo afecta a plugin_data/kanlane.automations. */
  assert.match(rules, /allow update: if isTeamCollection\(col\) && canEdit\(tid\) && validWrite\(col\) && teamKid\(tid\)/);
  assert.match(rules, /function validWrite\(col\) \{[^}]*validData\(col\)/);
});

test('un trozo de archivo adjunto cabe en un documento de assets', () => {
  const files = Workhub.services.firebase.fileLimits;
  assert.ok(files, 'firebase-backend publica fileLimits');
  const chars = files.prefix.length + Math.ceil(files.chunkBytes / 3) * 4;
  assert.ok(chars <= limits.maxChars, 'trozo ' + chars + ' <= ' + limits.maxChars);
  /* El máximo por archivo (platform.js) no pasa de los ids que admite una nota (400 en las reglas). */
  const platformSource = fs.readFileSync(path.join(root, 'src/services/platform.js'), 'utf8');
  const maxBytes = Function('return ' + platformSource.match(/const FILE_MAX_BYTES = ([^;]+);/)[1])();
  const perNote = Number(platformSource.match(/const NOTE_MAX_FILES = (\d+);/)[1]);
  const idsMax = Number(rules.match(/listWithin\(data, 'assetIds', (\d+)\)/)[1]);
  assert.ok(Math.ceil(maxBytes / files.chunkBytes) * perNote <= idsMax, 'los trozos de una nota llena caben en assetIds');
  assert.ok(perNote <= Number(rules.match(/listWithin\(data, 'attachments', (\d+)\)/)[1]));
});

test('un documento de imagen al límite cabe en 1 MiB de Firestore', () => {
  const doc = {data: dataUrl(limits.maxChars), contentType: 'image/jpeg', createdAt: Date.now()};
  assert.ok(Buffer.byteLength(JSON.stringify(doc)) < 1048576 - 1024);
});

test('textWithin cuenta caracteres y una data: URL solo tiene ASCII', () => {
  assert.match(rules, /function textWithin\(data, key, max\) \{\s*return data\.get\(key, ''\) is string && data\.get\(key, ''\)\.size\(\) <= max;/);
  assert.equal(Buffer.byteLength(dataUrl(1000)), dataUrl(1000).length);
});

/* ---------- fits ---------- */

test('fits acepta hasta el límite exacto y rechaza un carácter más', () => {
  assert.equal(limits.fits(dataUrl(limits.maxChars)), true);
  assert.equal(limits.fits(dataUrl(limits.maxChars + 1)), false);
  assert.equal(limits.fits(null), false);
});

/* ---------- fit (compresión) ---------- */

test('una imagen pequeña se queda en el primer intento, a 0,85 y sin agrandar', () => {
  const calls = [];
  const out = limits.fit(800, 600, (w, h, q) => { calls.push([w, h, q]); return dataUrl(50000); });
  assert.equal(out.length, 50000);
  assert.deepEqual(calls, [[800, 600, 0.85]]);
});

test('el lado mayor se limita a 1600 px conservando la proporción', () => {
  const calls = [];
  limits.fit(4000, 3000, (w, h, q) => { calls.push([w, h, q]); return dataUrl(1000); });
  assert.deepEqual(calls[0], [1600, 1200, 0.85]);
});

test('el caso del error: una imagen que el cliente antiguo aceptaba ya no llega a las reglas', () => {
  /* El código anterior aceptaba si length * 0.75 <= 850 * 1024, es decir, hasta ~1 160 000
     caracteres, y las reglas rechazan más de 900 000. */
  const oldAccepted = 1100000;
  assert.ok(oldAccepted * 0.75 <= 850 * 1024, 'el cliente antiguo la habría aceptado');
  const sizes = {0.85: oldAccepted, 0.75: 950000, 0.65: 881000, 0.55: 700000};
  const calls = [];
  const out = limits.fit(1600, 1200, (w, h, q) => { calls.push(q); return dataUrl(sizes[q]); });
  assert.ok(out.length <= limits.maxChars);
  assert.deepEqual(calls, [0.85, 0.75, 0.65, 0.55]);
});

test('baja la calidad hasta 0,55 y después reduce el lado un 25 % por intento', () => {
  const calls = [];
  assert.throws(() => limits.fit(3200, 1600, (w, h, q) => { calls.push([w, h, q]); return dataUrl(limits.maxChars + 1); }),
    (err) => err.code === 'image-too-large' && err.message === 'image-too-large');
  assert.equal(calls.length, limits.maxAttempts);
  assert.deepEqual(calls.slice(0, 5).map((c) => c[2]), [0.85, 0.75, 0.65, 0.55, 0.55]);
  assert.deepEqual(calls.slice(3, 6).map((c) => c[0]), [1600, 1200, 900]);
  for(let i = 1; i < calls.length; i++) assert.ok(calls[i][0] * calls[i][1] * calls[i][2] < calls[i - 1][0] * calls[i - 1][1] * calls[i - 1][2], 'cada intento es más pequeño');
});

test('una salida que no es imagen (canvas sin dibujar) da image-unreadable', () => {
  assert.throws(() => limits.fit(100, 100, () => 'data:,'), (err) => err.code === 'image-unreadable');
  assert.throws(() => limits.fit(0, 100, () => dataUrl(10)), (err) => err.code === 'image-unreadable');
});

test('propiedad: con cualquier compresor, nunca devuelve algo que las reglas rechacen', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rulesMax = Number(rules.match(/col != 'assets'[\s\S]*?textWithin\(data, 'data', (\d+)\)/)[1]);
  let accepted = 0, refused = 0;
  for(let i = 0; i < 2000; i++){
    const bytesPerPixel = 0.05 + rand() * 1.5;
    const width = 1 + Math.floor(rand() * 8000), height = 1 + Math.floor(rand() * 8000);
    try {
      const out = limits.fit(width, height, (w, h, q) => dataUrl(Math.round(w * h * bytesPerPixel * q * 4 / 3) + PREFIX.length));
      assert.ok(out.length <= limits.maxChars && out.length <= rulesMax);
      accepted++;
    } catch(err){
      assert.equal(err.code, 'image-too-large');
      refused++;
    }
  }
  assert.ok(accepted > 1900, 'casi todas caben tras reducir (' + accepted + ' de 2000, ' + refused + ' rechazadas)');
});

console.log('OK   ' + passed + ' pruebas del límite de imágenes');
