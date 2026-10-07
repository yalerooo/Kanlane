/* Fallo al llegar al servicio de acceso: Firebase lo llama siempre «fallo de red», pero solo lo es
   si el navegador está sin conexión. Con red, es el servicio el que no contesta o rechaza la
   petición (App Check con 403, un bloqueador), y el aviso no debe culpar a la conexión. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const Workhub = {services:{}, utils:{}};
vm.runInNewContext(read('src/services/firebase-backend.js'), {Workhub, window:{}});
const firebase = Workhub.services.firebase;
const coded = (code) => Object.assign(new Error(code), {code});

let passed = 0;
function test(name, fn){
  fn();
  passed++;
  console.log('ok   ' + name);
}

test('sin red, el fallo de red es falta de conexión', () => {
  assert.equal(firebase.accessFailure(coded('auth/network-request-failed'), false), 'offline');
  assert.equal(firebase.accessFailure(new Error('sdk-load'), false), 'offline');
});

test('con red, el mismo fallo es el servicio bloqueado', () => {
  assert.equal(firebase.accessFailure(coded('auth/network-request-failed'), true), 'blocked');
  assert.equal(firebase.accessFailure(new Error('sdk-load'), true), 'blocked');
  assert.equal(firebase.accessFailure(coded('unavailable'), true), 'blocked');
});

test('un rechazo de App Check es bloqueo aunque el navegador diga que no hay red', () => {
  assert.equal(firebase.accessFailure(coded('appCheck/throttled'), true), 'blocked');
  assert.equal(firebase.accessFailure(coded('appCheck/fetch-status-error'), false), 'blocked');
  assert.equal(firebase.accessFailure(coded('auth/firebase-app-check-token-is-invalid'), true), 'blocked');
});

test('los demás errores no se reclasifican', () => {
  assert.equal(firebase.accessFailure(coded('auth/wrong-password'), true), null);
  assert.equal(firebase.accessFailure(coded('permission-denied'), true), null);
  assert.equal(firebase.accessFailure(null, true), null);
});

test('sin navigator se da por hecho que hay red', () => {
  assert.equal(firebase.isOnline(), true);
});

test('los dos avisos son distintos y están en español e inglés', () => {
  const blocked = 'No se pudo contactar con el servicio de acceso aunque tu conexión funciona. Puede estar bloqueado temporalmente, o por una extensión del navegador o un filtro de red. Espera unos minutos y vuelve a intentarlo.';
  const offline = 'Sin conexión. Comprueba tu red e inténtalo de nuevo.';
  const en = read('src/i18n/en.js');
  ['src/controllers/auth-controller.js', 'src/controllers/account-controller.js', 'src/views/auth-view.js'].forEach((file) => {
    assert.ok(read(file).indexOf(blocked) !== -1, file + ' tiene el aviso de servicio bloqueado');
  });
  [blocked, offline, 'El servicio de acceso no responde', 'Sin conexión con el acceso'].forEach((text) => {
    assert.ok(en.indexOf("'" + text + "':") !== -1, 'traducido: ' + text);
  });
});

console.log('OK   ' + passed + ' pruebas del fallo de acceso');
