/* Versiones locales de copias: máximo siete por cuenta y proyecto. El archivo
   original sigue pudiéndose descargar; estas versiones viven solo en este navegador.
   Las de un proyecto con cifrado total se guardan selladas con la clave del proyecto (campo e en
   lugar de json): sin la clave en este navegador no se pueden abrir. */
(function(){
  const DB_NAME = 'workhub-backup-history';
  const STORE = 'versions';
  const LIMIT = 7;
  let opening;

  function open(){
    if(!opening) opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, {keyPath:'id'});
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => { opening = null; throw err; });
    return opening;
  }

  function request(mode, operation){
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = operation(tx.objectStore(STORE));
      let value;
      req.onsuccess = () => { value = req.result; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function list(scope){
    return request('readonly', (store) => store.getAll()).then((all) =>
      all.filter((entry) => entry.scope === scope).sort((a, b) => b.createdAt - a.createdAt));
  }

  /* Ruta lógica de la AAD del cifrado; el id de la versión va detrás. */
  const SEAL_PATH = 'backup-history';

  function sealed(entry, json, cipher){
    return cipher.sealBlob(SEAL_PATH, entry.id, json).then((e) => {
      const out = Object.assign({}, entry, {e:e, kid:cipher.kid});
      delete out.json;
      return out;
    });
  }

  /* cipher: cifrador del proyecto si tiene cifrado total (si no, se guarda como siempre). */
  function save(scope, backup, cipher){
    const createdAt = Date.now();
    const base = {id:scope + ':' + createdAt + ':' + Math.random().toString(36).slice(2, 8),
      scope, createdAt, filename:backup.filename, counts:backup.counts};
    const ready = cipher ? sealed(base, backup.json, cipher) : Promise.resolve(Object.assign(base, {json:backup.json}));
    return ready.then((entry) => request('readwrite', (store) => store.put(entry)).then(() => list(scope)).then((entries) =>
      Promise.all(entries.slice(LIMIT).map((old) => remove(old.id)))).then(() => entry));
  }

  /* Devuelve la versión con su json. Una versión sellada necesita el cifrador de su proyecto. */
  function get(id, cipher){
    return request('readonly', (store) => store.get(id)).then((entry) => {
      if(!entry || !entry.e) return entry;
      if(!cipher) throw new Error('locked');
      return cipher.openBlob(SEAL_PATH, entry.id, entry.e).then((json) => Object.assign({}, entry, {json:json}));
    });
  }
  function remove(id){ return request('readwrite', (store) => store.delete(id)); }

  /* Versiones de un proyecto cifrado guardadas en claro por una versión anterior de la app: se sellan. */
  function sealPlain(scope, cipher){
    return list(scope).then((entries) => Promise.all(entries.filter((entry) => typeof entry.json === 'string').map((entry) =>
      sealed(entry, entry.json, cipher).then((out) => request('readwrite', (store) => store.put(out))))));
  }

  Workhub.services.backupHistory = {list, save, get, remove, sealPlain};
})();
