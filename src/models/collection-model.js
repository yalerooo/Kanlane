/* Modelo base: una colección de la base de datos sincronizada en memoria.
   Emite 'change' cada vez que llegan datos nuevos y 'error' si falla la escucha.

   Con un cifrador (connect(db, cipher), proyectos con cifrado total; docs/CIFRADO-PROYECTOS.md, 6.3)
   los documentos se guardan sellados y `items` lleva el contenido ya descifrado. Sin cifrador
   (proyectos de siempre, modo local, invitado, demo) no cambia nada. */
Workhub.models.CollectionModel = class CollectionModel extends Workhub.Emitter {
  constructor(name){
    super();
    this.name = name;
    this.items = [];
    this.col = null;
    this.db = null;
    this.stop = null;
    this.cipher = null;
    /* Sube en cada conexión: descarta lo que llegue de una escucha anterior. */
    this.generation = 0;
  }

  connect(db, cipher){
    this.disconnect();
    const gen = ++this.generation;
    this.db = db;
    this.col = db.collection(this.name);
    if(cipher){
      this._connectSealed(gen, cipher);
      return;
    }
    this.stop = this.col.onSnapshot((snap) => {
      if(gen !== this.generation) return;
      this.items = snap.docs.map((d) => {
        const data = d.data() || {};
        data.id = d.id;
        return data;
      });
      this.emit('change');
    }, (err) => { if(gen === this.generation) this.emit('error', err); });
  }

  /* Deja de escuchar y vacía los datos (al cambiar de proyecto). */
  disconnect(){
    if(!this.col) return;
    this.generation++;
    if(typeof this.stop === 'function') this.stop();
    this.stop = null;
    this.col = null;
    this.db = null;
    this.items = [];
    if(this.cipher){
      this.cipher = null;
      this.loaded = false;
      this._plain = {};
    }
    this.emit('change');
  }

  isReady(){
    return !!this.col;
  }

  find(id){
    return this.items.find((x) => x.id === id);
  }

  doc(id){
    return this.col.doc(id);
  }

  add(data){
    if(this.cipher){
      /* El id va en la AAD del cifrado: hay que conocerlo antes de escribir. */
      const ref = this.col.doc();
      return this.set(ref.id, data).then(() => ref);
    }
    return this.col.add(data);
  }

  update(id, patch){
    if(this.cipher) return this._updateSealed(id, patch);
    return this.col.doc(id).update(patch);
  }

  set(id, data){
    if(this.cipher) return this._setSealed(id, data);
    return this.col.doc(id).set(data);
  }

  remove(id){
    return this.col.doc(id).delete();
  }

  /* Ids de los documentos cuyo campo es exactamente igual a value.
     En un proyecto cifrado el servidor no ve los campos secretos: se filtra en memoria. */
  idsWhere(field, value){
    if(this.cipher && !Workhub.models.EncSchema.isClear(this.name, field)){
      if(!this.loaded) return Promise.reject(Workhub.models.ProjectCipher.error('not-ready'));
      return Promise.resolve(this.items.filter((x) => !x._undecryptable && x[field] === value).map((x) => x.id));
    }
    return this.col.where(field, '==', value).get().then((snap) => snap.docs.map((d) => d.id));
  }

  /* onProgress(hechos, total) solo se usa en proyectos cifrados, donde se escribe de uno en uno. */
  updateWhere(field, value, patch, onProgress){
    if(this.cipher) return this.idsWhere(field, value).then((ids) => this._eachSealed(ids, (id) => this.update(id, patch), onProgress));
    return this.idsWhere(field, value).then((ids) => Promise.all(ids.map((id) => this.update(id, patch))));
  }

  removeWhere(field, value, onProgress){
    if(this.cipher) return this.idsWhere(field, value).then((ids) => this._eachSealed(ids, (id) => this.remove(id), onProgress));
    return this.idsWhere(field, value).then((ids) => Promise.all(ids.map((id) => this.remove(id))));
  }

  /* Copia de documentos para poder devolverlos con restore() (deshacer un borrado).
     Guarda la colección de ahora: si se cambia de proyecto entre medias, no restaura. */
  snapshot(ids){
    const items = (Array.isArray(ids) ? ids : [ids]).map((id) => this.find(id)).filter(Boolean).map((x) => {
      const copy = Object.assign({}, x);
      /* Lo que no se pudo descifrar se devuelve tal cual estaba guardado. */
      if(this.cipher && x._undecryptable && this._plain[x.id]) copy._raw = this._plain[x.id].raw;
      return copy;
    });
    return {col:this.col, items:items};
  }

  restore(snap){
    if(!snap || !snap.col || snap.col !== this.col) return Promise.reject(new Error('project-changed'));
    return Promise.all(snap.items.map((it) => {
      if(this.cipher){
        /* Se vuelve a cifrar (IV nuevo); nunca se escribe en claro. */
        if(it._undecryptable) return it._raw ? snap.col.doc(it.id).set(it._raw) : Promise.resolve();
        return this.set(it.id, it);
      }
      const data = Object.assign({}, it);
      delete data.id;
      return snap.col.doc(it.id).set(data);
    }));
  }

  /* Cambio optimista en memoria (la base de datos confirmará después). */
  patchLocal(id, patch){
    const item = this.find(id);
    if(!item) return null;
    Object.assign(item, patch);
    this.emit('change');
    return item;
  }

  /* ---------- Proyectos con cifrado total ---------- */

  /* Caché por documento: this._plain[id] = {iv, w, clear, plain} (o {bad, raw} si no se abre, o
     {legacy} si está en claro). `iv` es la firma del blob: si no cambia, el contenido tampoco, y un
     cambio de campos en claro (mover, reprogramar) no vuelve a descifrar. `w` es el número de la
     escritura local que la creó (0 si viene del servidor). */
  _connectSealed(gen, cipher){
    this.cipher = cipher;
    this.loaded = false;
    this._plain = {};
    this._inflight = {};
    this._chain = {};
    this._writeNo = 0;
    this._seq = 0;
    this._queue = Promise.resolve();
    this.stop = this.col.onSnapshot((snap) => {
      if(gen !== this.generation) return;
      /* Las instantáneas se procesan en orden; descifrar es asíncrono. */
      const seq = ++this._seq;
      this._queue = this._queue.then(() => this._applySealed(gen, seq, snap)).catch((err) => {
        if(gen === this.generation) this.emit('error', err);
      });
    }, (err) => { if(gen === this.generation) this.emit('error', err); });
  }

  _applySealed(gen, seq, snap){
    /* Otro proyecto, o ya espera una instantánea más nueva (cada una trae la colección entera). */
    if(gen !== this.generation || seq !== this._seq) return Promise.resolve();
    const cipher = this.cipher;
    const startNo = this._writeNo;
    const docs = snap.docs.map((d) => ({id:d.id, raw:d.data() || {}}));
    const next = {};
    const todo = [];
    docs.forEach((d) => {
      if(!cipher.isSealed(d.raw)){
        /* No debería existir: lo escribiría un cliente antiguo. Se muestra y se cifra al guardarlo. */
        const parts = cipher.split(this.name, d.raw);
        next[d.id] = {iv:null, w:0, legacy:true, clear:parts.clear, plain:parts.secret};
        return;
      }
      const cached = this._plain[d.id];
      if(cached && cached.iv === cipher.ivOf(d.raw.e)){
        cached.clear = cipher.clearOf(this.name, d.raw);
        if(cached.bad) cached.raw = d.raw;
        next[d.id] = cached;
      }else{
        todo.push(d);
      }
    });

    const openOne = (d) => {
      const clear = cipher.clearOf(this.name, d.raw);
      return cipher.open(this.name, d.id, d.raw).then((r) => {
        next[d.id] = {iv:r.iv, w:0, clear:clear, plain:r.plain};
      }, () => {
        next[d.id] = {iv:cipher.ivOf(d.raw.e), w:0, bad:true, clear:clear, raw:d.raw};
      });
    };
    const BATCH = 50;
    let work = Promise.resolve();
    for(let i = 0; i < todo.length; i += BATCH){
      const slice = todo.slice(i, i + BATCH);
      work = work.then(() => (gen === this.generation ? Promise.all(slice.map(openOne)) : null));
    }

    return work.then(() => {
      if(gen !== this.generation) return;
      /* Una escritura local hecha mientras se descifraba, o aún en vuelo, es más nueva que esta instantánea. */
      const newer = (id, local, got) => local && !local.bad && (!got || got.iv !== local.iv) &&
        (this._inflight[id] > 0 || local.w > startNo);
      docs.forEach((d) => {
        const local = this._plain[d.id];
        if(!newer(d.id, local, next[d.id])) return;
        local.clear = Object.assign({}, local.clear, next[d.id].clear);
        next[d.id] = local;
      });
      Object.keys(this._plain).forEach((id) => {
        if(!next[id] && newer(id, this._plain[id], null)) next[id] = this._plain[id];
      });
      this._plain = next;
      this.items = docs.map((d) => this._itemOf(d.id, next[d.id]));
      this.loaded = true;
      this.emit('change');
    });
  }

  _itemOf(id, entry){
    if(entry.bad) return Object.assign({}, entry.clear, {id:id, _undecryptable:true});
    const item = Object.assign({}, entry.clear, entry.plain, {id:id});
    if(entry.legacy) item._plainInEncrypted = true;
    return item;
  }

  _updateSealed(id, patch){
    const PCi = Workhub.models.ProjectCipher;
    const cipher = this.cipher;
    let parts;
    try{ parts = cipher.split(this.name, patch); }catch(err){ return Promise.reject(err); }
    /* Solo campos en claro (mover, reprogramar, reordenar): no se toca el blob. */
    if(!Object.keys(parts.secret).length) return this.col.doc(id).update(parts.clear);

    const entry = this._plain[id];
    if(!entry) return Promise.reject(PCi.error('stale'));
    if(entry.bad) return Promise.reject(PCi.error('undecryptable'));
    const secret = Object.assign({}, entry.plain, parts.secret);
    const clear = Object.assign({}, entry.clear, parts.clear);
    try{ cipher.check(this.name, secret); }catch(err){ return Promise.reject(err); }
    /* Un documento en claro dentro de un proyecto cifrado se sustituye entero por su versión sellada. */
    if(entry.legacy) return this._writeSealed(id, secret, clear, (col, s) => col.doc(id).set(Object.assign({}, clear, s)));
    /* Equipo cifrado y con conexión: el blob es un solo campo, así que dos personas que cambian a la
       vez campos secretos distintos se pisarían. Se lee, se mezcla y se escribe en una transacción. */
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if(cipher.transaction && online){
      return this._writeSealed(id, secret, clear, (col, s, written) => this._updateInTransaction(col, id, parts, s, written));
    }
    return this._writeSealed(id, secret, clear, (col, s) => col.doc(id).update(Object.assign({}, parts.clear, s)));
  }

  /* s: el sellado hecho con lo que había en memoria (se usa si no hay conexión). written: la entrada
     de la caché de esta escritura, que se corrige con lo que de verdad se guarda. */
  _updateInTransaction(col, id, parts, s, written){
    const cipher = this.cipher, path = this.name;
    const ref = col.doc(id);
    return cipher.transaction((tx) => tx.get(ref).then((snap) => {
      const raw = snap.exists ? snap.data() || {} : null;
      if(!raw || !cipher.isSealed(raw)){
        tx.update(ref, Object.assign({}, parts.clear, s));
        return null;
      }
      return cipher.open(path, id, raw).then((r) => {
        const merged = Object.assign({}, r.plain, parts.secret);
        return cipher.sealSecret(path, id, merged).then((sealed) => {
          tx.update(ref, Object.assign({}, parts.clear, sealed));
          /* Antes de confirmar: la instantánea que traiga esta escritura tiene que reconocerla. */
          if(this.cipher === cipher && this._plain[id] === written){
            written.plain = merged;
            written.iv = cipher.ivOf(sealed.e);
          }
          return null;
        });
      });
    })).catch((err) => {
      /* Sin conexión una transacción no puede leer: se escribe con la caché, como en un proyecto personal. */
      if(err && err.code === 'unavailable') return ref.update(Object.assign({}, parts.clear, s));
      throw err;
    });
  }

  _setSealed(id, data){
    const PCi = Workhub.models.ProjectCipher;
    const cipher = this.cipher;
    const entry = this._plain[id];
    /* Lo que no se pudo leer nunca se sustituye. */
    if(entry && entry.bad) return Promise.reject(PCi.error('undecryptable'));
    let parts;
    try{
      parts = cipher.split(this.name, data);
      cipher.check(this.name, parts.secret);
    }catch(err){ return Promise.reject(err); }
    return this._writeSealed(id, parts.secret, parts.clear, (col, s) => col.doc(id).set(Object.assign({}, parts.clear, s)));
  }

  /* Cifra y escribe. La caché se actualiza AL MOMENTO con el nuevo contenido, para que dos cambios
     seguidos al mismo documento (marcar dos subtareas) no se pisen; los cifrados de un mismo
     documento se encadenan para que las escrituras salgan en el orden en que se pidieron. */
  _writeSealed(id, secret, clear, issue){
    const cipher = this.cipher, col = this.col, path = this.name;
    const inflight = this._inflight, chain = this._chain;
    const before = this._plain[id];
    const w = ++this._writeNo;
    const entry = {iv:'~' + w, w:w, clear:clear, plain:secret};
    this._plain[id] = entry;
    inflight[id] = (inflight[id] || 0) + 1;
    const mine = () => this.cipher === cipher && this._plain[id] === entry;

    const issued = (chain[id] || Promise.resolve()).then(() => cipher.sealSecret(path, id, secret)).then((s) => {
      if(mine()) entry.iv = cipher.ivOf(s.e);
      /* Sin conexión la escritura no termina hasta volver la red: la cadena no espera por ella. */
      return {write:issue(col, s, entry)};
    });
    const tail = issued.then(() => {}, () => {});
    chain[id] = tail;
    tail.then(() => { if(chain[id] === tail) delete chain[id]; });

    return issued.then((x) => x.write).then((res) => {
      inflight[id]--;
      return res;
    }, (err) => {
      inflight[id]--;
      if(mine()){
        if(before) this._plain[id] = before;
        else delete this._plain[id];
      }
      throw err;
    });
  }

  /* De una en una y con concurrencia limitada, nunca con lotes (límite de las reglas en equipos).
     Un fallo no detiene el resto: al terminar se rechaza con 'partial' y cuántos quedan (.pending),
     para que quien llama pueda decirlo y volver a intentarlo. */
  _eachSealed(ids, worker, onProgress){
    let pending = 0;
    let done = 0;
    return Workhub.utils.pool.run(ids, 12, (id) => worker(id).then(null, () => { pending++; }).then(() => {
      done++;
      if(onProgress) onProgress(done, ids.length);
    })).then(() => {
      if(pending) throw Workhub.models.ProjectCipher.error('partial', {pending:pending, total:ids.length});
    });
  }
};
