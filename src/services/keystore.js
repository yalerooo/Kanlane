/* Almacén de las claves de los proyectos cifrados en este navegador. Plan: docs/CIFRADO-PROYECTOS.md, 5.8 y 6.1.
   PR1: existe y está probado, pero todavía no lo usa ninguna parte de la app.

   - IndexedDB «workhub-keys», almacén «keys» (keyPath «id» = uid + ':' + pid). Cada registro:
     {id, uid, pid, projectId, kid, key, trusted, savedAt}. key es una CryptoKey AES-GCM NO extraíble
     guardada por clonado estructurado: JavaScript puede usarla, pero no leer sus bytes.
   - trusted («Este dispositivo es de confianza») viene desmarcado por defecto (D4).
   - Si IndexedDB no existe, falla al abrir (navegación privada), tarda demasiado o no admite guardar
     una CryptoKey, la clave se queda solo en memoria de esta pestaña y se pedirá en la próxima recarga.
     Ninguna función lanza por un fallo de IndexedDB: las lecturas devuelven null.
   - Nunca se usa localStorage para claves.
   - BroadcastChannel «workhub-keys»: avisa a las otras pestañas de que se guardó u olvidó una clave
     (solo ids, nunca la clave). */
(function(){
  'use strict';
  const DB_NAME = 'workhub-keys';
  const STORE = 'keys';
  const DB_VERSION = 1;
  const CHANNEL = 'workhub-keys';
  const OPEN_TIMEOUT = 4000;

  const memory = new Map();      /* respaldo cuando IndexedDB no está o no guarda la clave */
  const listeners = new Set();
  let dbPromise = null;
  let disabled = false;
  let channel = null;

  function factory(){
    try{ return typeof indexedDB !== 'undefined' && indexedDB ? indexedDB : null; }catch(e){ return null; }
  }
  /* true si hay IndexedDB y no ha fallado al abrirla. Aunque sea false, put/get funcionan en memoria. */
  function isAvailable(){
    return !disabled && !!factory();
  }

  function openDb(){
    if(disabled) return Promise.resolve(null);
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const idb = factory();
      if(!idb){ resolve(null); return; }
      let done = false;
      let timer = null;
      const finish = (db) => {
        if(done){ if(db){ try{ db.close(); }catch(e){} } return; }
        done = true;
        if(timer) clearTimeout(timer);
        resolve(db);
      };
      timer = setTimeout(() => finish(null), OPEN_TIMEOUT);
      let req;
      try{ req = idb.open(DB_NAME, DB_VERSION); }catch(e){ finish(null); return; }
      req.onupgradeneeded = () => {
        try{
          const db = req.result;
          if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath:'id'});
        }catch(e){}
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { try{ db.close(); }catch(e){} dbPromise = null; };
        finish(db);
      };
      req.onerror = (ev) => {
        if(ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        finish(null);
      };
    }).then((db) => {
      if(!db){ disabled = true; dbPromise = null; }
      return db;
    }, () => { disabled = true; dbPromise = null; return null; });
    return dbPromise;
  }

  /* Ejecuta fn(store) en una transacción y resuelve {ok, value} al terminarla. Nunca rechaza. */
  function run(mode, fn){
    return openDb().then((db) => {
      if(!db) return {ok:false};
      return new Promise((resolve) => {
        const box = {value:undefined};
        let tx;
        try{
          tx = db.transaction(STORE, mode);
          tx.oncomplete = () => resolve({ok:true, value:box.value});
          tx.onabort = () => resolve({ok:false, error:tx.error});
          fn(tx.objectStore(STORE), box);
        }catch(e){
          try{ if(tx) tx.abort(); }catch(_){}
          resolve({ok:false, error:e});
        }
      });
    }).catch((e) => ({ok:false, error:e}));
  }

  function validId(s){
    return typeof s === 'string' && s.length > 0 && s.length <= 1500;
  }
  function makeId(uid, pid){ return uid + ':' + pid; }
  function isLockedKey(key){
    return !!key && typeof key === 'object' && key.type === 'secret' && key.extractable === false &&
      !!key.algorithm && key.algorithm.name === 'AES-GCM';
  }
  function fail(code){
    const err = new Error('keystore: ' + code);
    err.name = 'KeystoreError';
    err.code = code;
    return err;
  }
  function publicEntry(rec){
    return {uid:rec.uid, pid:rec.pid, projectId:rec.projectId, kid:rec.kid, key:rec.key, trusted:rec.trusted === true, savedAt:rec.savedAt};
  }

  /* ---------- avisos entre pestañas ---------- */

  function getChannel(){
    if(channel) return channel;
    try{
      if(typeof BroadcastChannel === 'undefined') return null;
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (ev) => {
        const msg = ev && ev.data;
        if(!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
        const safe = {type:msg.type, uid:msg.uid || null, pid:msg.pid || null, projectId:msg.projectId || null};
        listeners.forEach((cb) => { try{ cb(safe); }catch(e){} });
      };
    }catch(e){ channel = null; }
    return channel;
  }
  function notify(msg){
    const ch = getChannel();
    if(!ch) return;
    try{ ch.postMessage(msg); }catch(e){}
  }
  /* onChange(cb) → función para dejar de escuchar. cb({type:'put'|'forget', uid, pid, projectId})
     se llama cuando OTRA pestaña guarda u olvida claves. */
  function onChange(cb){
    if(typeof cb !== 'function') return () => {};
    listeners.add(cb);
    getChannel();
    return () => { listeners.delete(cb); };
  }

  /* ---------- API ---------- */

  /* put({uid, pid, projectId, kid, key, trusted}) → 'disk' | 'memory'.
     Rechaza (KeystoreError 'bad-entry' / 'extractable-key') si la entrada no es válida:
     nunca se guarda una clave extraíble. */
  function put(entry){
    const e = entry || {};
    if(!validId(e.uid) || !validId(e.pid) || !validId(e.kid)) return Promise.reject(fail('bad-entry'));
    if(!e.key || typeof e.key !== 'object' || e.key.type !== 'secret') return Promise.reject(fail('bad-entry'));
    if(!isLockedKey(e.key)) return Promise.reject(fail('extractable-key'));
    const rec = {
      id:makeId(e.uid, e.pid),
      uid:e.uid,
      pid:e.pid,
      projectId:validId(e.projectId) ? e.projectId : null,
      kid:e.kid,
      key:e.key,
      trusted:e.trusted === true,
      savedAt:Date.now()
    };
    return run('readwrite', (store) => { store.put(rec); }).then((res) => {
      if(res.ok) memory.delete(rec.id);
      else memory.set(rec.id, rec);
      notify({type:'put', uid:rec.uid, pid:rec.pid, projectId:rec.projectId});
      return res.ok ? 'disk' : 'memory';
    });
  }

  /* get(uid, pid) → {uid, pid, projectId, kid, key, trusted, savedAt} | null. Nunca rechaza. */
  function get(uid, pid){
    if(!validId(uid) || !validId(pid)) return Promise.resolve(null);
    const id = makeId(uid, pid);
    return run('readonly', (store, box) => {
      const req = store.get(id);
      req.onsuccess = () => { box.value = req.result || null; };
    }).then((res) => {
      /* La memoria solo tiene lo que no se pudo guardar en disco: si está, es lo más reciente. */
      const disk = res.ok && res.value && isLockedKey(res.value.key) ? res.value : null;
      const rec = memory.get(id) || disk;
      return rec ? publicEntry(rec) : null;
    }, () => null);
  }

  /* Borra los registros que cumplan pred (en disco y en memoria) → número borrado, o null si
     IndexedDB falló a mitad (puede quedar alguno). */
  function removeWhere(pred, msg){
    let removed = 0;
    memory.forEach((rec, id) => { if(pred(rec)){ memory.delete(id); removed++; } });
    return run('readwrite', (store) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if(!cursor) return;
        if(pred(cursor.value)){
          const del = cursor.delete();
          del.onsuccess = () => { removed++; };
        }
        cursor.continue();
      };
    }).then((res) => {
      if(removed) notify(msg);
      if(!res.ok && isAvailable()) return null;
      return removed;
    }, () => null);
  }

  /* forget(uid, pid): olvida la clave de un proyecto en este navegador. */
  function forget(uid, pid){
    if(!validId(uid) || !validId(pid)) return Promise.resolve(0);
    return removeWhere((rec) => rec.uid === uid && rec.pid === pid, {type:'forget', uid:uid, pid:pid});
  }
  /* forgetProject(projectId, uid): al borrar un proyecto. Pasa uid siempre que se pueda: el id del
     principal es «main» en todas las cuentas y sin uid se olvidaría también el de otras cuentas. */
  function forgetProject(projectId, uid){
    if(!validId(projectId)) return Promise.resolve(0);
    const byUid = validId(uid);
    return removeWhere((rec) => rec.projectId === projectId && (!byUid || rec.uid === uid),
      {type:'forget', uid:byUid ? uid : null, projectId:projectId});
  }
  /* forgetUser(uid, {keepTrusted}): al cerrar sesión. keepTrusted:true conserva las de confianza. */
  function forgetUser(uid, opts){
    if(!validId(uid)) return Promise.resolve(0);
    const keep = !!(opts && opts.keepTrusted);
    return removeWhere((rec) => rec.uid === uid && !(keep && rec.trusted === true), {type:'forget', uid:uid});
  }
  /* purgeUntrusted(): al arrancar sin sesión; borra todas las claves no marcadas como de confianza. */
  function purgeUntrusted(){
    return removeWhere((rec) => rec.trusted !== true, {type:'forget'});
  }

  Workhub.services.keystore = Object.freeze({
    DB_NAME, STORE, CHANNEL,
    isAvailable, put, get, forget, forgetProject, forgetUser, purgeUntrusted, onChange
  });
})();
