/* Firestore en memoria para las pruebas de los modelos: colecciones, documentos, subcolecciones,
   onSnapshot (asíncrono, con la colección entera), where y orderBy. No aplica reglas: eso lo prueba
   tests/rules contra el emulador. */
const clone = (v) => JSON.parse(JSON.stringify(v));

function fakeDb(){
  const cols = new Map();
  const log = {writes:[], wheres:0};
  let auto = 0;
  function store(p){
    if(!cols.has(p)) cols.set(p, {docs:new Map(), listeners:new Set()});
    return cols.get(p);
  }
  function snapOf(c, orderBy, filter){
    let rows = [...c.docs.entries()];
    if(filter) rows = rows.filter(([, data]) => data[filter.field] === filter.value);
    if(orderBy) rows.sort((a, b) => (a[1][orderBy] || 0) - (b[1][orderBy] || 0));
    return {docs:rows.map(([id, data]) => ({id, data:() => clone(data)}))};
  }
  function notify(c){
    c.listeners.forEach((l) => Promise.resolve().then(() => { if(c.listeners.has(l)) l.cb(snapOf(c, l.orderBy, l.filter)); }));
  }
  function listen(c, orderBy, filter, cb){
    const l = {cb, orderBy, filter};
    c.listeners.add(l);
    Promise.resolve().then(() => { if(c.listeners.has(l)) cb(snapOf(c, orderBy, filter)); });
    return () => c.listeners.delete(l);
  }
  function docRef(p, docId){
    const c = store(p);
    return {
      id:docId,
      get(){ return Promise.resolve({exists:c.docs.has(docId), id:docId, data:() => (c.docs.has(docId) ? clone(c.docs.get(docId)) : undefined)}); },
      set(data){ c.docs.set(docId, clone(data)); log.writes.push({op:'set', path:p, id:docId, data:clone(data)}); notify(c); return Promise.resolve(); },
      update(patch){
        if(!c.docs.has(docId)) return Promise.reject(new Error('not-found'));
        const next = Object.assign({}, c.docs.get(docId));
        Object.keys(patch).forEach((k) => {
          if(patch[k] && patch[k].__delete) delete next[k];
          else next[k] = clone(patch[k]);
        });
        c.docs.set(docId, next);
        log.writes.push({op:'update', path:p, id:docId, data:Object.assign({}, patch)});
        notify(c);
        return Promise.resolve();
      },
      delete(){ c.docs.delete(docId); log.writes.push({op:'delete', path:p, id:docId}); notify(c); return Promise.resolve(); },
      collection(name){ return collection(p + '/' + docId + '/' + name); }
    };
  }
  function collection(p){
    const c = store(p);
    return {
      path:p,
      doc(id){ return docRef(p, id || 'auto' + (++auto)); },
      add(data){ const ref = this.doc(); return ref.set(data).then(() => ref); },
      onSnapshot(cb){ return listen(c, null, null, cb); },
      get(){ return Promise.resolve(snapOf(c)); },
      where(field, op, value){
        log.wheres++;
        const filter = {field, value};
        return {get:() => Promise.resolve(snapOf(c, null, filter)), onSnapshot:(cb) => listen(c, null, filter, cb)};
      },
      orderBy(field){
        return {onSnapshot:(cb) => listen(c, field, null, cb), get:() => Promise.resolve(snapOf(c, field))};
      }
    };
  }
  /* db.doc('colección/id'), como la base acotada de la app. */
  function doc(p){
    const i = p.lastIndexOf('/');
    return docRef(p.slice(0, i), p.slice(i + 1));
  }
  return {
    collection, doc, log,
    raw:(p, id) => store(p).docs.get(id),
    rawAll:(p) => store(p).docs,
    put:(p, id, data) => { const c = store(p); c.docs.set(id, clone(data)); notify(c); }
  };
}

module.exports = {fakeDb, clone};
