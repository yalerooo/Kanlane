/* Versiones locales de copias: máximo siete por cuenta y proyecto. El archivo
   original sigue pudiéndose descargar; estas versiones viven solo en este navegador. */
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

  function save(scope, backup){
    const createdAt = Date.now();
    const entry = {id:scope + ':' + createdAt + ':' + Math.random().toString(36).slice(2, 8),
      scope, createdAt, filename:backup.filename, counts:backup.counts, json:backup.json};
    return request('readwrite', (store) => store.put(entry)).then(() => list(scope)).then((entries) =>
      Promise.all(entries.slice(LIMIT).map((old) => remove(old.id)))).then(() => entry);
  }

  function get(id){ return request('readonly', (store) => store.get(id)); }
  function remove(id){ return request('readwrite', (store) => store.delete(id)); }

  Workhub.services.backupHistory = {list, save, get, remove};
})();
