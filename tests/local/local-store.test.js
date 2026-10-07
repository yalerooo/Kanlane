/* Almacén local (modo local e invitado): con una escritura a medias, no se entrega a quien escucha
   una lectura con el dato anterior. Si se entregase, pisaría el cambio que la app ya enseña y la
   siguiente acción partiría de un dato viejo (mover dos veces seguidas una tarea la dejaba donde no era). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* IndexedDB de mentira: una operación por turno, en el orden en que se piden, como el de verdad. */
function fakeIndexedDB(){
  const stores = {docs:new Map(), assets:new Map()};
  let chain = Promise.resolve();
  const later = (fn) => { chain = chain.then(() => new Promise((resolve) => setTimeout(() => { fn(); resolve(); }, 1))); };
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const idb = {
    objectStoreNames:{contains:() => true},
    transaction(name){
      const tx = {};
      tx.objectStore = (store) => ({
        get(key){ const req = {}; later(() => { req.result = clone(stores[store].get(key)); req.onsuccess(); }); return req; },
        getAll(){ const req = {}; later(() => { req.result = Array.from(stores[store].values()).map(clone); req.onsuccess(); }); return req; },
        put(record){ later(() => { stores[store].set(record.path || record.id, clone(record)); if(tx.oncomplete) tx.oncomplete(); }); },
        delete(key){ later(() => { stores[store].delete(key); if(tx.oncomplete) tx.oncomplete(); }); }
      });
      return tx;
    }
  };
  return {open(){ const req = {}; setTimeout(() => { req.result = idb; req.onsuccess(); }, 0); return req; }};
}

const win = {};
const ctx = vm.createContext({window:win, indexedDB:fakeIndexedDB(), localStorage:{getItem:() => null}, Promise, JSON, Date, Math, Object, String, setTimeout, console});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/local-storage-shim.js'), 'utf8'), ctx);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const db = win.__localStore.db;
  const col = db.collection('tasks');
  const doc = col.doc('a');
  await doc.set({due:'hoy'});

  /* Lo que ve la app: su propio cambio al momento y, después, lo que le va llegando. */
  let shown = 'hoy';
  const seen = [];
  col.onSnapshot((snap) => { shown = snap.docs[0].data().due; seen.push(shown); });
  await wait(30);
  assert.deepEqual(seen, ['hoy']);

  /* Dos cambios seguidos: el segundo se pide justo cuando termina el primero, con su aviso en camino. */
  shown = 'mañana';
  const first = doc.update({due:'mañana'});
  const second = first.then(() => { shown = 'pasado'; return doc.update({due:'pasado'}); });
  let stale = false;
  const watch = setInterval(() => { if(shown === 'mañana' && seen.indexOf('mañana') !== -1) stale = true; }, 0);
  await second;
  await wait(60);
  clearInterval(watch);
  assert.equal(seen.indexOf('mañana'), -1, 'no llega la lectura anterior al segundo cambio');
  assert.equal(stale, false);
  assert.equal(shown, 'pasado');
  assert.equal(seen[seen.length - 1], 'pasado', 'al terminar llega el dato bueno');
  console.log('OK   almacén local: una escritura a medias no deja pasar una lectura anterior');

  /* Un documento suelto se escucha igual. */
  const one = [];
  doc.onSnapshot((snap) => one.push(snap.data().due));
  await wait(30);
  const a = doc.update({due:'uno'});
  await a.then(() => doc.update({due:'dos'}));
  await wait(60);
  assert.equal(one.indexOf('uno'), -1);
  assert.equal(one[one.length - 1], 'dos');
  console.log('OK   almacén local: lo mismo al escuchar un solo documento');

  /* Sin escrituras a medias todo llega, y otra colección no se ve afectada. */
  const other = [];
  db.collection('clients').onSnapshot((snap) => other.push(snap.size));
  await wait(30);
  await db.collection('clients').doc('c').set({nombre:'Ana'});
  await wait(30);
  assert.deepEqual(other, [0, 1]);
  await doc.delete();
  await wait(30);
  assert.equal((await col.get()).size, 0);
  console.log('OK   almacén local: las lecturas normales siguen llegando');

  console.log('\nTodo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
