/* La estación del año que boot.js pone en <html data-season> para el paisaje del acceso:
   sale del mes y del hemisferio (deducido de la zona horaria), o de ?estacion= para probar. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const boot = fs.readFileSync(path.join(root, 'src/boot.js'), 'utf8');

/* Ejecuta boot.js con un navegador de mentira y devuelve lo que deja en <html> y en <head>. */
function run({month, zone, search = '', firebase = false, narrow = false, store = {}}){
  const attrs = {}, classes = new Set(), links = [];
  const html = {
    classList: {add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c)},
    setAttribute: (k, v) => { attrs[k] = v; }
  };
  class FakeDate extends Date { getMonth(){ return month; } }
  vm.runInNewContext(boot, {
    window: {WORKHUB_FIREBASE: firebase ? {apiKey: 'k', projectId: 'p'} : {}, matchMedia: () => ({matches: narrow})},
    document: {documentElement: html, createElement: () => ({}), head: {appendChild: (el) => links.push(el)}},
    location: {protocol: 'https:', search},
    localStorage: {getItem: (k) => (k in store ? store[k] : null)},
    navigator: {language: 'es-ES', languages: ['es-ES']},
    Intl: {DateTimeFormat: () => ({resolvedOptions: () => ({timeZone: zone})})},
    Date: FakeDate,
    setTimeout: () => {}
  });
  return {season: attrs['data-season'], classes, sheets: links.filter((l) => l.rel === 'stylesheet').map((l) => l.href),
    preloads: links.filter((l) => l.rel === 'preload' && /auth-scene/.test(l.href)).map((l) => l.as + ' ' + l.href)};
}

let passed = 0;
function test(name, fn){ fn(); passed++; console.log('ok   ' + name); }

test('hemisferio norte: marzo-mayo primavera, junio-agosto verano, septiembre-noviembre otoño, diciembre-febrero invierno', () => {
  const expected = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  expected.forEach((season, month) => assert.equal(run({month, zone: 'Europe/Madrid'}).season, season, 'mes ' + (month + 1)));
});

test('hemisferio sur: las estaciones van al revés', () => {
  const expected = ['summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer'];
  ['America/Argentina/Buenos_Aires', 'America/Santiago', 'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland', 'Africa/Johannesburg', 'America/Montevideo', 'America/Lima'].forEach((zone) => {
    expected.forEach((season, month) => assert.equal(run({month, zone}).season, season, zone + ', mes ' + (month + 1)));
  });
});

test('zonas del norte que se parecen a las del sur no se confunden', () => {
  ['America/New_York', 'America/Mexico_City', 'America/Bogota', 'Africa/Cairo', 'Asia/Tokyo', 'Pacific/Honolulu', 'Atlantic/Canary', 'America/Bahia_Banderas', 'America/Los_Angeles', 'Europe/London'].forEach((zone) => {
    assert.equal(run({month: 9, zone}).season, 'autumn', zone);
  });
});

test('sin zona horaria (o desconocida) se toma el norte', () => {
  assert.equal(run({month: 0, zone: ''}).season, 'winter');
  assert.equal(run({month: 0, zone: undefined}).season, 'winter');
});

test('?estacion= fuerza una, para probarlas', () => {
  assert.equal(run({month: 6, zone: 'Europe/Madrid', search: '?estacion=invierno'}).season, 'winter');
  assert.equal(run({month: 0, zone: 'Europe/Madrid', search: '?registro&estacion=otono'}).season, 'autumn');
  assert.equal(run({month: 0, zone: 'Europe/Madrid', search: '?estacion=primavera'}).season, 'spring');
  assert.equal(run({month: 0, zone: 'Europe/Madrid', search: '?estacion=verano'}).season, 'summer');
  /* Un valor que no existe no cuenta. */
  assert.equal(run({month: 0, zone: 'Europe/Madrid', search: '?estacion=monzon'}).season, 'winter');
});

/* El paisaje, pedido con el botón del acceso. */
const SCENE = {workhub_scene: 'on'};

test('las fotos de espera de la estación solo se enlazan con el paisaje pedido, con acceso y fuera de móviles', () => {
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: true, store: SCENE}).sheets, ['../assets/css/seasons/autumn.css']);
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: true, narrow: true, store: SCENE}).sheets, []);
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: false, store: SCENE}).sheets, []);
});

test('el acceso sale sin paisaje (html.scene-off) salvo que se haya pedido', () => {
  /* Por defecto, y también para quien lo quitó cuando el paisaje salía siempre ('off'). */
  [{}, {workhub_scene: 'off'}].forEach((store) => {
    const off = run({month: 9, zone: 'Europe/Madrid', firebase: true, store});
    assert.ok(off.classes.has('scene-off'));
    assert.deepEqual(off.sheets, []);
  });
  const on = run({month: 9, zone: 'Europe/Madrid', firebase: true, store: SCENE});
  assert.ok(!on.classes.has('scene-off'));
  assert.equal(on.sheets.length, 1);
});

test('la escena se empieza a bajar ya solo si se va a ver el acceso con paisaje', () => {
  const scene = ['script ../src/views/auth-scene.js'];
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: true, store: SCENE}).preloads, scene);
  /* Con la sesión iniciada no se ve el acceso; ni en móviles, ni sin paisaje (lo habitual), ni en modo local. */
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: true, store: {workhub_scene: 'on', workhub_session: '1'}}).preloads, []);
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: true, narrow: true, store: SCENE}).preloads, []);
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: true}).preloads, []);
  assert.deepEqual(run({month: 9, zone: 'Europe/Madrid', firebase: false, store: SCENE}).preloads, []);
});

test('cada estación tiene su árbol y sus fotos de espera', () => {
  const scene = fs.readFileSync(path.join(root, 'src/views/auth-scene.js'), 'utf8');
  const trees = scene.match(/const TREE_URL = '\.\.\/assets\/img\/' \+ \[([^\]]+)\]\[SEASON\]/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.equal(trees.length, 4);
  trees.forEach((t) => assert.ok(fs.existsSync(path.join(root, 'assets/img', t + '.webp')), t + '.webp'));
  ['spring', 'summer', 'autumn', 'winter'].forEach((s) => {
    const css = fs.readFileSync(path.join(root, 'assets/css/seasons', s + '.css'), 'utf8');
    ['--sc-poster-light', '--sc-tree-light', '--sc-poster-dark', '--sc-tree-dark'].forEach((v) => assert.ok(css.includes(v + ':url(data:image/webp'), s + '.css: ' + v));
  });
});

console.log('OK   estación del año (' + passed + ' pruebas)');
