/* Preferencias de apariencia (SettingsModel): acento por defecto, paso único de azul a
   Grafito del rediseño «cristal limpio» y ajuste de navegación (lateral o arriba). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');

/* Un «navegador»: su localStorage (store) y, si se indica, el documento de la cuenta. */
function boot(store, account){
  const Workhub = {models:{}, services:{}, i18n:{lang:'es', LANGS:{es:1, en:1}, setLang(){}}};
  Workhub.services.preferences = {
    read: (key, fallback) => (key in store ? store[key] : fallback),
    write: (key, value) => { store[key] = value; }
  };
  const context = {Workhub, Date, Promise, Object, String, sessionStorage:{getItem(){ return null; }, setItem(){}}};
  vm.runInNewContext(src('core/emitter.js'), context);
  vm.runInNewContext(src('models/settings-model.js'), context);
  const model = new Workhub.models.SettingsModel();
  if(account){
    const db = {doc(){
      return {
        onSnapshot(fn){ fn({exists:account.doc !== null, data:() => account.doc}); return () => {}; },
        set(value){ account.doc = value; return Promise.resolve(); },
        update(patch){ account.doc = Object.assign({}, account.doc, patch); return Promise.resolve(); }
      };
    }};
    model.connect(db);
  }
  return model;
}

let ok = 0;
const test = (name, fn) => { fn(); ok++; console.log('OK   ' + name); };

test('navegador nuevo: Grafito y navegación lateral', () => {
  const store = {};
  const m = boot(store);
  assert.equal(m.accent, 'grafito');
  assert.equal(m.nav, 'side');
  assert.equal(m.currentAccent().hueA, '#71717A');
});

test('quien tenía azul pasa a Grafito una sola vez y después puede volver a elegirlo', () => {
  const store = {workhub_accent:'azul'};
  let m = boot(store);
  assert.equal(m.accent, 'grafito');
  assert.equal(store.workhub_accent, 'grafito');
  m.setAccent('azul');
  m = boot(store);
  assert.equal(m.accent, 'azul', 'elegirlo después del rediseño se respeta');
});

test('los demás acentos guardados no se tocan', () => {
  ['lavanda', 'rosa', 'menta', 'melocoton', 'limon'].forEach((key) => {
    assert.equal(boot({workhub_accent:key}).accent, key);
  });
});

test('cuenta con azul anterior al rediseño: pasa a Grafito y queda marcada', () => {
  const account = {doc:{accent:'azul', theme:'dark', lang:'es'}};
  const m = boot({}, account);
  assert.equal(m.accent, 'grafito');
  assert.equal(m.theme, 'dark', 'el tema de la cuenta se conserva');
  assert.equal(account.doc.accent, 'grafito');
  assert.equal(account.doc.av, 2);
});

test('cuenta que eligió azul después del rediseño: se respeta en otro navegador', () => {
  const account = {doc:{accent:'azul', av:2, theme:'light', nav:'top', lang:'es'}};
  const m = boot({}, account);
  assert.equal(m.accent, 'azul');
  assert.equal(m.nav, 'top', 'la navegación de la cuenta se adopta');
});

test('cuenta nueva: se sube lo de este navegador, con la navegación', () => {
  const account = {doc:null};
  const store = {};
  const m = boot(store, account);
  m.setNav('top');
  assert.equal(store.workhub_nav, 'top');
  assert.deepEqual([account.doc.accent, account.doc.av, account.doc.nav], ['grafito', 2, 'top']);
  m.setNav('cualquiera');
  assert.equal(m.nav, 'side', 'un valor desconocido vuelve al lateral');
});

test('cada acento trae su par claro/oscuro, el texto sobre el acento y los dos tonos del velo', () => {
  const Workhub = {models:{}, services:{preferences:{read:(k, f) => f, write(){}}}, i18n:{lang:'es', LANGS:{}}};
  const context = {Workhub, Date, Promise, Object, String};
  vm.runInNewContext(src('core/emitter.js'), context);
  vm.runInNewContext(src('models/settings-model.js'), context);
  const list = Workhub.models.SettingsModel.ACCENTS;
  assert.deepEqual(Array.from(list, (a) => a.key).sort(), ['azul', 'grafito', 'lavanda', 'limon', 'melocoton', 'menta', 'rosa']);
  list.forEach((a) => {
    ['solid', 'solidD', 'textL', 'textD', 'hueA', 'hueB'].forEach((k) => assert.match(a[k], /^#[0-9A-F]{6}$/, a.key + '.' + k));
    assert.equal(a.ink, '#FFFFFF');
    assert.equal(a.inkD, '#0A0A0C');
  });
});

console.log('Ajustes: ' + ok + ' pruebas correctas');
