/* Prueba de la lógica del aviso de cookies (src/consent/consent.js) con un navegador
   simulado: node tests/consent/consent.test.js
   Comprueba lo que exige la normativa: nada premarcado, rechazar = aceptar en esfuerzo,
   el consentimiento caduca a los 12 meses, se puede retirar y, si el navegador bloquea el
   almacenamiento, no se rompe. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'consent', 'consent.js'), 'utf8');
const DAY = 24 * 60 * 60 * 1000;
let failed = 0;
function ok(cond, msg){
  console.log((cond ? 'OK   ' : 'FALLA ') + msg);
  if(!cond) failed++;
}

function node(tag){
  return {
    tag, attrs: {}, children: [], parentNode: null, open: false, checked: false, textContent: '',
    setAttribute(k, v){ this.attrs[k] = v; },
    getAttribute(k){ return this.attrs[k]; },
    appendChild(c){ this.children.push(c); c.parentNode = this; return c; },
    removeChild(c){ this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    addEventListener(){},
    closest(){ return null; },
    showModal(){ this.open = true; },
    close(){ this.open = false; }
  };
}

function env(opts){
  opts = opts || {};
  const store = {};
  const document = {readyState: 'complete', body: node('body'), createElement: node, addEventListener(){}};
  const localStorage = {
    getItem(k){ if(opts.blocked) throw new Error('bloqueado'); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v){ if(opts.blocked) throw new Error('bloqueado'); store[k] = String(v); },
    removeItem(k){ delete store[k]; }
  };
  const window = {};
  const ctx = {window, document, localStorage, navigator: {language: 'es-ES'}};
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {C: window.WorkhubConsent, store, document};
}
const banners = (e) => e.document.body.children.filter((c) => c.attrs['class'] === 'consent').length;

/* 1. Primera visita */
let e = env();
ok(e.C.get() === null, 'primera visita: no hay decisión guardada');
ok(e.C.has('necessary') === true, 'las necesarias siempre están activas');
ok(e.C.has('analytics') === false, 'sin decisión, la analítica NO está permitida (nada premarcado)');
ok(banners(e) === 1, 'se muestra el aviso');

/* 2. Aceptar */
e = env();
e.C.accept();
ok(e.C.has('analytics') === true, 'aceptar: la analítica queda permitida');
const saved = JSON.parse(e.store.workhub_consent);
ok(saved.v === 1 && saved.analytics === true && Math.abs(Date.now() - saved.at) < 5000, 'aceptar: se guarda versión, elección y fecha');
ok(banners(e) === 0, 'aceptar: el aviso desaparece');

/* 3. Rechazar */
e = env();
e.C.reject();
ok(e.C.has('analytics') === false && JSON.parse(e.store.workhub_consent).analytics === false, 'rechazar: se guarda la negativa');
ok(e.C.get() !== null && banners(e) === 0, 'rechazar: cuenta como decisión (no se vuelve a preguntar)');

/* 4. Retirar el consentimiento */
e = env();
e.C.accept();
e.C.set({analytics: false});
ok(e.C.has('analytics') === false, 'se puede retirar el consentimiento después de darlo');

/* 5. Caducidad y versión */
const e300 = env();
e300.store.workhub_consent = JSON.stringify({v: 1, at: Date.now() - 300 * DAY, analytics: true});
ok(e300.C.has('analytics') === true, 'a los 300 días la decisión sigue vigente');
const eOld = env();
eOld.store.workhub_consent = JSON.stringify({v: 1, at: Date.now() - 366 * DAY, analytics: true});
ok(eOld.C.get() === null && eOld.C.has('analytics') === false, 'a los 12 meses caduca: se vuelve a preguntar');
const eVer = env();
eVer.store.workhub_consent = JSON.stringify({v: 99, at: Date.now(), analytics: true});
ok(eVer.C.get() === null, 'si cambia la versión de las categorías, se vuelve a preguntar');
const eBad = env();
eBad.store.workhub_consent = '{esto no es json';
ok(eBad.C.get() === null && eBad.C.has('analytics') === false, 'un valor corrupto se ignora sin romper');

/* 6. Avisos de cambio */
e = env();
const seen = [];
e.C.onChange((c) => seen.push(c.analytics));
e.C.accept(); e.C.reject();
ok(seen.length === 2 && seen[0] === true && seen[1] === false, 'onChange avisa de cada cambio (para cargar o descargar scripts)');

/* 7. Navegador que bloquea el almacenamiento */
e = env({blocked: true});
let threw = false;
try{ e.C.accept(); }catch(err){ threw = true; }
ok(!threw && e.C.has('analytics') === true, 'con el almacenamiento bloqueado no falla y recuerda la decisión mientras dura la página');

console.log(failed ? '\n' + failed + ' fallida(s)' : '\nTodo correcto');
process.exit(failed ? 1 : 0);
