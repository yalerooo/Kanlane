/* Pruebas de src/services/keystore.js sin navegador, con un doble mínimo de IndexedDB escrito aquí
   (el repositorio no tiene fake-indexeddb y no se añaden dependencias). Lo que solo puede comprobar
   un navegador de verdad (CryptoKey guardada por clonado estructurado, no extraíble, tras recargar)
   está en tests/e2e/keystore-check.js. Uso: node tests/crypto/keystore.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../src/services/keystore.js'), 'utf8');
const later = (fn) => setTimeout(fn, 0);

/* ---------- doble de IndexedDB ---------- */
function fakeIndexedDB(opts){
  const o = opts || {};
  const dbs = new Map();
  function makeDb(data){
    return {
      objectStoreNames:{contains:(n) => data.stores.has(n)},
      createObjectStore(n, cfg){ data.stores.set(n, {keyPath:cfg.keyPath, rows:new Map()}); },
      close(){},
      transaction(storeName, mode){
        const st = data.stores.get(storeName);
        if(!st) throw new Error('NotFoundError');
        const snapshot = new Map(st.rows);
        const tx = {oncomplete:null, onabort:null, onerror:null, error:null, aborted:false};
        let pending = 0, finished = false;
        const maybeComplete = () => later(() => {
          if(pending === 0 && !finished && !tx.aborted){ finished = true; if(tx.oncomplete) tx.oncomplete({}); }
        });
        const request = (fn) => {
          const r = {result:undefined, onsuccess:null, onerror:null};
          pending++;
          later(() => {
            pending--;
            if(tx.aborted) return;
            r.result = fn();
            if(r.onsuccess) r.onsuccess({});
            maybeComplete();
          });
          return r;
        };
        tx.abort = () => {
          if(finished) return;
          tx.aborted = true; finished = true;
          st.rows = snapshot;
          later(() => { if(tx.onabort) tx.onabort({}); });
        };
        tx.objectStore = () => ({
          put(v){
            if(mode !== 'readwrite') throw new Error('ReadOnlyError');
            if(o.cloneFails){ const e = new Error('No se puede clonar'); e.name = 'DataCloneError'; throw e; }
            const copy = structuredClone(v);
            return request(() => { st.rows.set(copy[st.keyPath], copy); return copy[st.keyPath]; });
          },
          get(k){ return request(() => (st.rows.has(k) ? structuredClone(st.rows.get(k)) : undefined)); },
          openCursor(){
            const keys = [...st.rows.keys()];
            let i = 0;
            const r = {result:null, onsuccess:null};
            const step = () => {
              pending++;
              later(() => {
                pending--;
                if(tx.aborted) return;
                while(i < keys.length && !st.rows.has(keys[i])) i++;
                if(i < keys.length){
                  const k = keys[i++];
                  r.result = {
                    value:structuredClone(st.rows.get(k)),
                    delete(){
                      if(mode !== 'readwrite') throw new Error('ReadOnlyError');
                      return request(() => { st.rows.delete(k); });
                    },
                    continue(){ step(); }
                  };
                }else{
                  r.result = null;
                }
                if(r.onsuccess) r.onsuccess({});
                maybeComplete();
              });
            };
            step();
            return r;
          }
        });
        maybeComplete();
        return tx;
      }
    };
  }
  return {
    opened:0,
    open(name, version){
      this.opened++;
      if(o.throwOnOpen){ const e = new Error('Sin IndexedDB en navegación privada'); e.name = 'SecurityError'; throw e; }
      const req = {result:null, error:null, onsuccess:null, onerror:null, onupgradeneeded:null};
      if(o.hang) return req;
      later(() => {
        if(o.failOpen){ req.error = new Error('InvalidStateError'); if(req.onerror) req.onerror({preventDefault(){}}); return; }
        let data = dbs.get(name);
        if(!data){ data = {version:0, stores:new Map()}; dbs.set(name, data); }
        req.result = makeDb(data);
        if(data.version < version){ data.version = version; if(req.onupgradeneeded) req.onupgradeneeded({}); }
        if(req.onsuccess) req.onsuccess({});
      });
      return req;
    },
    rows(name){ const d = dbs.get(name); return d ? [...d.stores.get('keys').rows.values()] : []; }
  };
}

/* ---------- BroadcastChannel entre «pestañas» simuladas ---------- */
function bus(){
  const members = new Set();
  return class FakeChannel{
    constructor(name){ this.name = name; this.onmessage = null; members.add(this); }
    postMessage(data){
      const copy = structuredClone(data);
      members.forEach((m) => { if(m !== this && m.name === this.name && m.onmessage) later(() => m.onmessage({data:copy})); });
    }
    close(){ members.delete(this); }
  };
}

/* Cada carga es una pestaña nueva con su propio estado en memoria. */
function load(env){
  const e = env || {};
  const Workhub = {services:{}};
  new Function('Workhub', 'indexedDB', 'BroadcastChannel', 'setTimeout', 'clearTimeout', source)(
    Workhub, e.indexedDB, e.BroadcastChannel, e.setTimeout || setTimeout, e.clearTimeout || clearTimeout);
  return Workhub.services.keystore;
}

const aes = (extractable) => globalThis.crypto.subtle.generateKey({name:'AES-GCM', length:256}, extractable, ['encrypt', 'decrypt']);
const ok = (msg) => console.log('OK   ' + msg);
const code = (c) => (err) => { assert.equal(err.name, 'KeystoreError'); assert.equal(err.code, c); return true; };

(async () => {
  /* ---------- guardar y leer ---------- */
  const idb = fakeIndexedDB();
  const ks = load({indexedDB:idb});
  assert.equal(ks.DB_NAME, 'workhub-keys');
  assert.equal(ks.isAvailable(), true);
  assert.ok(Object.isFrozen(ks));
  assert.equal(await ks.get('ana', 'pidA'), null, 'vacío al principio');
  const key = await aes(false);
  assert.equal(await ks.put({uid:'ana', pid:'pidA', projectId:'p1', kid:'kid1', key}), 'disk');
  const got = await ks.get('ana', 'pidA');
  assert.equal(got.kid, 'kid1');
  assert.equal(got.projectId, 'p1');
  assert.equal(got.trusted, false, 'D4: «dispositivo de confianza» desmarcado por defecto');
  assert.equal(got.key.extractable, false);
  assert.equal(got.key.algorithm.name, 'AES-GCM');
  assert.ok(typeof got.savedAt === 'number');
  const rows = idb.rows('workhub-keys');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'ana:pidA', 'keyPath id = uid:pid');
  /* La clave guardada sirve para cifrar y descifrar. */
  const iv = new Uint8Array(12);
  const ct = await globalThis.crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode('hola'));
  assert.equal(new TextDecoder().decode(await globalThis.crypto.subtle.decrypt({name:'AES-GCM', iv}, got.key, ct)), 'hola');
  assert.equal(await ks.get('ana', 'otro'), null);
  assert.equal(await ks.get('', 'pidA'), null);
  assert.equal(await ks.get(), null);
  /* Otra «pestaña» (otra carga) ve lo guardado en disco. */
  assert.equal((await load({indexedDB:idb}).get('ana', 'pidA')).kid, 'kid1');
  /* Sobrescribir la misma clave: un solo registro, gana la última. */
  assert.equal(await ks.put({uid:'ana', pid:'pidA', projectId:'p1', kid:'kid2', key, trusted:true}), 'disk');
  assert.equal(idb.rows('workhub-keys').length, 1);
  assert.deepEqual([(await ks.get('ana', 'pidA')).kid, (await ks.get('ana', 'pidA')).trusted], ['kid2', true]);
  ok('put/get: CryptoKey no extraíble, trusted false por defecto, un registro por uid:pid');

  /* ---------- entradas no válidas ---------- */
  await assert.rejects(ks.put({uid:'ana', pid:'pidB', kid:'k', key:await aes(true)}), code('extractable-key'));
  await assert.rejects(ks.put({uid:'ana', pid:'pidB', kid:'k', key:'texto'}), code('bad-entry'));
  await assert.rejects(ks.put({pid:'pidB', kid:'k', key}), code('bad-entry'));
  await assert.rejects(ks.put({uid:'ana', pid:'pidB', key}), code('bad-entry'));
  await assert.rejects(ks.put(null), code('bad-entry'));
  assert.equal(idb.rows('workhub-keys').length, 1, 'no se guardó nada inválido');
  ok('put rechaza claves extraíbles y entradas incompletas');

  /* ---------- olvidar ---------- */
  const fresh = fakeIndexedDB();
  const k2 = load({indexedDB:fresh});
  const put = (uid, pid, projectId, trusted) => k2.put({uid, pid, projectId, kid:'kid', key, trusted});
  await put('ana', 'a1', 'main', false);
  await put('ana', 'a2', 'p2', true);
  await put('ana', 'a3', 'p3', false);
  await put('bea', 'b1', 'main', false);
  await put('bea', 'b2', 'p9', true);
  assert.equal(await k2.forget('ana', 'a3'), 1);
  assert.equal(await k2.get('ana', 'a3'), null);
  assert.equal(await k2.forget('ana', 'a3'), 0, 'olvidar dos veces no falla');
  assert.equal(await k2.forgetProject('main', 'ana'), 1, 'con uid solo olvida el principal de esa cuenta');
  assert.ok(await k2.get('bea', 'b1'), 'el principal («main») de otra cuenta sigue');
  await put('ana', 'a1', 'main', false);
  assert.equal(await k2.forgetUser('ana', {keepTrusted:true}), 1, 'cierre de sesión: solo las no confiables');
  assert.equal(await k2.get('ana', 'a1'), null);
  assert.ok(await k2.get('ana', 'a2'), 'la de confianza sobrevive al cierre de sesión');
  assert.ok(await k2.get('bea', 'b1'), 'las de otra cuenta no se tocan');
  assert.equal(await k2.purgeUntrusted(), 1, 'arranque sin sesión: borra todas las no confiables');
  assert.equal(await k2.get('bea', 'b1'), null);
  assert.deepEqual(fresh.rows('workhub-keys').map((r) => r.id).sort(), ['ana:a2', 'bea:b2']);
  assert.equal(await k2.forgetUser('ana'), 1, 'sin opciones olvida también las de confianza');
  assert.equal(await k2.forgetProject('p9'), 1, 'sin uid, por id de proyecto');
  assert.deepEqual(fresh.rows('workhub-keys'), []);
  assert.equal(await k2.forget(), 0);
  assert.equal(await k2.forgetUser(''), 0);
  ok('forget, forgetProject, forgetUser({keepTrusted}) y purgeUntrusted borran lo que deben');

  /* ---------- sin IndexedDB (navegación privada y similares) ---------- */
  const scenarios = {
    'sin indexedDB':{indexedDB:undefined},
    'open lanza (SecurityError)':{indexedDB:fakeIndexedDB({throwOnOpen:true})},
    'open falla (onerror)':{indexedDB:fakeIndexedDB({failOpen:true})},
    'open no responde':{indexedDB:fakeIndexedDB({hang:true}), setTimeout:(fn) => setTimeout(fn, 0)}
  };
  for(const [name, env] of Object.entries(scenarios)){
    const k = load(env);
    assert.equal(await k.get('ana', 'x'), null, name + ': get devuelve null');
    assert.equal(await k.put({uid:'ana', pid:'x', projectId:'p', kid:'kid', key}), 'memory', name + ': la clave queda en memoria');
    assert.equal(k.isAvailable(), false, name + ': isAvailable falso');
    assert.equal((await k.get('ana', 'x')).kid, 'kid', name + ': se lee de memoria');
    assert.equal(await k.forgetUser('ana', {keepTrusted:true}), 1, name + ': y se olvida');
    assert.equal(await k.get('ana', 'x'), null);
    assert.equal(await k.purgeUntrusted(), 0);
    if(env.indexedDB) assert.equal(env.indexedDB.opened, 1, name + ': no reintenta abrir en cada llamada');
    /* Otra pestaña no ve la clave en memoria: tendrá que pedir la contraseña. */
    assert.equal(await load(env).get('ana', 'x'), null);
  }
  /* El navegador no sabe guardar una CryptoKey (DataCloneError): memoria, y lo de memoria manda. */
  const noClone = fakeIndexedDB({cloneFails:true});
  const k3 = load({indexedDB:noClone});
  assert.equal(await k3.put({uid:'ana', pid:'x', projectId:'p', kid:'kid', key}), 'memory');
  assert.equal((await k3.get('ana', 'x')).kid, 'kid');
  assert.equal(k3.isAvailable(), true, 'IndexedDB sigue abierta');
  assert.deepEqual(noClone.rows('workhub-keys'), []);
  ok('sin IndexedDB, si falla al abrir, si no responde o si no clona la clave: memoria y ningún error');

  /* ---------- avisos entre pestañas ---------- */
  const Channel = bus();
  const shared = fakeIndexedDB();
  const tabA = load({indexedDB:shared, BroadcastChannel:Channel});
  const tabB = load({indexedDB:shared, BroadcastChannel:Channel});
  const seen = [];
  const stop = tabB.onChange((msg) => seen.push(msg));
  tabB.onChange(() => { throw new Error('un oyente que falla no rompe a los demás'); });
  await tabA.put({uid:'ana', pid:'pidZ', projectId:'pz', kid:'kid', key});
  await tabA.forget('ana', 'pidZ');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, [
    {type:'put', uid:'ana', pid:'pidZ', projectId:'pz'},
    {type:'forget', uid:'ana', pid:'pidZ', projectId:null}
  ]);
  assert.ok(seen.every((m) => !('key' in m)), 'el aviso nunca lleva la clave');
  stop();
  await tabA.put({uid:'ana', pid:'pidZ', projectId:'pz', kid:'kid', key});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(seen.length, 2, 'tras dejar de escuchar no llegan avisos');
  assert.equal(typeof load({}).onChange(() => {}), 'function', 'sin BroadcastChannel no falla');
  ok('onChange avisa a las otras pestañas (sin la clave) y se puede dejar de escuchar');

  const plain = source.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/localStorage|sessionStorage/.test(plain), 'keystore no usa localStorage');
  ok('keystore no usa localStorage');
})().catch((err) => { console.error(err); process.exitCode = 1; });
