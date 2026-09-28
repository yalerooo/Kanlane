/* Modelo base: una colección de la base de datos sincronizada en memoria.
   Emite 'change' cada vez que llegan datos nuevos y 'error' si falla la escucha. */
Workhub.models.CollectionModel = class CollectionModel extends Workhub.Emitter {
  constructor(name){
    super();
    this.name = name;
    this.items = [];
    this.col = null;
    this.db = null;
  }

  connect(db){
    this.db = db;
    this.col = db.collection(this.name);
    this.col.onSnapshot((snap) => {
      this.items = snap.docs.map((d) => {
        const data = d.data() || {};
        data.id = d.id;
        return data;
      });
      this.emit('change');
    }, (err) => this.emit('error', err));
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
    return this.col.add(data);
  }

  update(id, patch){
    return this.col.doc(id).update(patch);
  }

  set(id, data){
    return this.col.doc(id).set(data);
  }

  remove(id){
    return this.col.doc(id).delete();
  }

  /* Ids de los documentos cuyo campo es exactamente igual a value. */
  idsWhere(field, value){
    return this.col.where(field, '==', value).get().then((snap) => snap.docs.map((d) => d.id));
  }

  updateWhere(field, value, patch){
    return this.idsWhere(field, value).then((ids) => Promise.all(ids.map((id) => this.update(id, patch))));
  }

  removeWhere(field, value){
    return this.idsWhere(field, value).then((ids) => Promise.all(ids.map((id) => this.remove(id))));
  }

  /* Cambio optimista en memoria (la base de datos confirmará después). */
  patchLocal(id, patch){
    const item = this.find(id);
    if(!item) return null;
    Object.assign(item, patch);
    this.emit('change');
    return item;
  }
};
