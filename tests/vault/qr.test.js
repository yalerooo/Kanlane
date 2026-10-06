/* Código QR de la verificación en dos pasos (src/utils/qr.js).
   Las piezas se comparan con valores conocidos de la norma. El símbolo entero se compara con una
   huella: la de un símbolo que, al escribir este archivo, se leyó bien con un lector independiente
   (jsQR), igual que todas las longitudes de 1 a 213 bytes. Si se cambia el generador a propósito,
   hay que volver a leerlo con un lector antes de cambiar la huella.
   Uso: node tests/vault/qr.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const Workhub = {utils:{}};
new Function('Workhub', fs.readFileSync(path.join(__dirname, '../../src/utils/qr.js'), 'utf8'))(Workhub);
const qr = Workhub.utils.qr;
const ok = (msg) => console.log('OK   ' + msg);
const URI = 'otpauth://totp/Kanlane%3Aana%40example.com?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Kanlane';

/* Reed-Solomon: el ejemplo clásico «HELLO WORLD» en 1-M. */
assert.deepEqual(qr.ecc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
/* Bits de formato (corrección M) y de versión, tablas de la norma. */
assert.equal(qr.formatBits(0), 0b101010000010010);
assert.equal(qr.formatBits(5), 0b100000011001110);
assert.equal(qr.versionBits(7), 0b000111110010010100);
assert.equal(qr.versionBits(10), 0b001010010011010011);
ok('corrección de errores, formato y versión coinciden con la norma');

/* Tamaño según lo que hay que guardar, y el límite. */
const size = (n) => { const m = qr.matrix('x'.repeat(n)); return m && m.size; };
[[1, 21], [14, 21], [15, 25], [122, 45], [123, 49], [180, 53], [181, 57], [213, 57]].forEach(([n, s]) => assert.equal(size(n), s, n + ' bytes'));
assert.equal(qr.matrix('x'.repeat(214)), null, 'lo que no cabe no se pinta a medias');
assert.equal(qr.svg('x'.repeat(214)), '');
assert.equal(qr.matrix('ñ'.repeat(107)), null, 'cuenta bytes, no letras');
ok('elige la versión por el tamaño y rechaza lo que no cabe');

/* Estructura: los tres localizadores y la línea de sincronización. */
const m = qr.matrix(URI);
assert.equal(m.size, 41);
const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
[[0, 0], [m.size - 7, 0], [0, m.size - 7]].forEach(([ox, oy]) => {
  FINDER.forEach((row, y) => row.split('').forEach((c, x) => assert.equal(m.dark(ox + x, oy + y), c === '1', 'localizador en ' + ox + ',' + oy)));
});
for(let i = 8; i < m.size - 8; i++){
  assert.equal(m.dark(i, 6), i % 2 === 0);
  assert.equal(m.dark(6, i), i % 2 === 0);
}
assert.equal(m.dark(8, m.size - 8), true, 'el módulo siempre oscuro');
ok('localizadores, sincronización y módulo oscuro en su sitio');

/* El símbolo entero. */
let bits = '';
for(let y = 0; y < m.size; y++) for(let x = 0; x < m.size; x++) bits += m.dark(x, y) ? 1 : 0;
assert.equal(nodeCrypto.createHash('sha256').update(bits).digest('hex'), '882df0bf05ae592fb28dcc6f6cf1bda7632ce3931a2cb50d312f1561f4b19190');
ok('el símbolo de referencia no ha cambiado');

/* El SVG: negro sobre blanco, con margen, y solo con trazos (nada que venga del texto). */
const svg = qr.svg(URI);
assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 49 49"/);
assert.ok(svg.includes('<rect width="49" height="49" fill="#fff"/>'));
assert.match(svg, /<path d="(M\d+ \d+h1v1h-1z)+" fill="#000"\/><\/svg>$/);
assert.equal(svg.indexOf('otpauth'), -1);
assert.equal(qr.svg('"><script>alert(1)</script>').indexOf('script'), -1);
ok('el SVG lleva fondo blanco, margen y solo trazos');
