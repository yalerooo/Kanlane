/* Instalaciones por proyecto. El principal conserva la colección raíz 'plugins'
   para respetar lo ya instalado; los demás guardan cada instalación en
   plugin_data/install:{id}, distinguida por _kind. Los datos de wh.storage
   siguen en plugin_data/{id}; wh.storage.user vive en settings/plugin-user:{id}. */
(function(){
  const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
  const MAX_VALUE_BYTES = 100 * 1024;
  const MAX_TOTAL_BYTES = 800 * 1024;
  /* En un proyecto con cifrado total el cajón va en un solo blob cifrado y en base64: 800 KB no caben
     en un documento de Firestore (1 MiB). */
  const MAX_TOTAL_BYTES_ENCRYPTED = 600 * 1024;
  const INSTALL_KIND = 'plugin-install';
  const INSTALL_PREFIX = 'install:';
  /* Bases de datos en las que la migración de los datos antiguos ya se comprobó en esta sesión. */
  const MIGRATED = new WeakSet();

  function fail(code, message){
    const e = new Error(message);
    e.code = code;
    return e;
  }

  class PluginModel extends Workhub.models.CollectionModel {
    constructor(){
      super('plugins');
      this.main = true;
    }

    connect(db, main){
      this.disconnect();
      this.main = !!main;
      this.migrating = this.main;
      const gen = ++this.generation;
      this.db = db;
      this.col = db.collection(this.main ? 'plugins' : 'plugin_data');
      const subscribe = () => {
        if(gen !== this.generation) return;
        this.migrating = false;
        const source = this.main ? this.col : this.col.where('_kind', '==', INSTALL_KIND);
        this.stop = source.onSnapshot((snap) => {
          if(gen !== this.generation) return;
          this.items = snap.docs.map((d) => {
            const data = d.data() || {};
            data.id = this.main ? d.id : (data.pluginId || d.id.slice(INSTALL_PREFIX.length));
            return data;
          });
          this.emit('change');
        }, (err) => { if(gen === this.generation) this.emit('error', err); });
      };
      /* La migración se comprueba una vez por sesión y base de datos: al volver al proyecto
         principal desde otro no se vuelven a leer sus marcas. Si falla, se reintenta la próxima vez. */
      if(this.main && !MIGRATED.has(db)) PluginModel.migrateLegacyMain(db).then(() => { MIGRATED.add(db); }).catch((err) => {
        if(gen === this.generation) this.emit('error', err);
      }).then(subscribe);
      else subscribe();
    }

    isReady(){
      return !!this.col && !this.migrating;
    }

    /* Smart GP y Apariencia guardaban su estado en storage.user. Copia íntegra
       al proyecto principal antes de arrancar sus marcos. El origen
       se conserva como respaldo; un proyecto que ya tiene datos no se pisa. */
    static migrateLegacyMain(db){
      return db.doc('projects/main').get().then((project) => {
        if(project.exists && (project.data() || {}).deleted) return;
        return Promise.all(['workhub.smartgp', 'workhub.apariencia'].map((id) => {
          const dest = db.doc('plugin_data/' + id);
          const marker = db.doc('settings/plugin-migrated:' + id);
          return marker.get().then((done) => {
            if(done.exists) return;
            return dest.get().then((current) => {
              if(current.exists) return;
              return db.doc('plugins/' + id).get().then((legacy) => {
                const old = legacy.exists ? legacy.data() || {} : {};
                if(old.userValues && Object.keys(old.userValues).length) return old.userValues;
                return db.doc('settings/plugin-user:' + id).get().then((saved) => {
                  const data = saved.exists ? saved.data() || {} : {};
                  return data.userValues || {};
                });
              }).then((values) => Object.keys(values).length ? dest.set({values:values, updatedAt:Date.now()}) : null);
            }).then(() => marker.set({done:true, updatedAt:Date.now()}));
          });
        }));
      });
    }

    doc(id){
      return this.col.doc(this.main ? id : INSTALL_PREFIX + id);
    }

    set(id, data){
      return this.doc(id).set(this.main ? data : Object.assign({_kind:INSTALL_KIND, pluginId:id}, data));
    }

    update(id, patch){
      return this.doc(id).update(patch);
    }

    remove(id){
      return this.doc(id).delete();
    }

    list(){
      return this.items.slice().sort((a, b) => (a.installedAt || 0) - (b.installedAt || 0));
    }

    install(url, manifest, granted, official){
      const existing = this.find(manifest.id);
      return this.set(manifest.id, {
        url: url,
        manifest: manifest,
        granted: granted,
        official: !!official,
        installedAt: existing ? existing.installedAt || Date.now() : Date.now(),
        updatedAt: Date.now()
      });
    }

    setGranted(id, granted, manifest){
      const patch = {granted:granted, updatedAt:Date.now()};
      if(manifest) patch.manifest = manifest;
      return this.update(id, patch);
    }

    /* ---------- Datos propios de cada plugin ----------
       Un "cajón" es {read() → Promise<values>, write(values) → Promise}:
       - por proyecto: plugin_data/{id} → {values}
       - por usuario (común a todos los proyectos): settings/plugin-user:{id}.
         Se leen los datos antiguos de plugins/{id} si aún no se migraron. */

    static projectBucket(db, pluginId, cipher){
      const ref = db.doc('plugin_data/' + pluginId);
      const valuesOf = (d) => (d && d.values && typeof d.values === 'object' ? d.values : {});
      if(cipher){
        /* Cifrado total: {values} va dentro del blob; solo updatedAt queda en claro. */
        return {
          maxBytes: MAX_TOTAL_BYTES_ENCRYPTED,
          read: () => ref.get().then((snap) => {
            const d = snap.exists ? snap.data() || {} : {};
            if(!cipher.isSealed(d)) return valuesOf(d);
            return cipher.open('plugin_data', pluginId, d).then((r) => valuesOf(r.plain));
          }),
          write: (values) => cipher.seal('plugin_data', pluginId, {values:values, updatedAt:Date.now()}).then((doc) => ref.set(doc))
        };
      }
      return {
        read: () => ref.get().then((snap) => valuesOf(snap.exists ? snap.data() || {} : {})),
        write: (values) => ref.set({values:values, updatedAt:Date.now()})
      };
    }

    static userBucket(rootDb, pluginId){
      const ref = rootDb.doc('settings/plugin-user:' + pluginId);
      const old = rootDb.doc('plugins/' + pluginId);
      return {
        read: () => ref.get().then((snap) => {
          if(snap.exists){
            const d = snap.data() || {};
            return d.userValues && typeof d.userValues === 'object' ? d.userValues : {};
          }
          return old.get().then((legacy) => {
            const d = legacy.exists ? legacy.data() || {} : {};
            const values = d.userValues && typeof d.userValues === 'object' ? d.userValues : {};
            return Object.keys(values).length ? ref.set({userValues:values, updatedAt:Date.now()}).then(() => values).catch(() => values) : {};
          });
        }),
        write: (values) => ref.set({userValues:values, updatedAt:Date.now()})
      };
    }

    static storageGet(bucket, key){
      if(!KEY_RE.test(String(key))) return Promise.reject(fail('bad-key', 'Clave no válida (letras, números, "_", "-" o ".", hasta 64).'));
      return bucket.read().then((values) => {
        if(!Object.prototype.hasOwnProperty.call(values, key)) return null;
        try{ return JSON.parse(values[key]); }catch(e){ return null; }
      });
    }

    static storageKeys(bucket){
      return bucket.read().then((values) => Object.keys(values).sort());
    }

    static storageSet(bucket, key, value){
      if(!KEY_RE.test(String(key))) return Promise.reject(fail('bad-key', 'Clave no válida (letras, números, "_", "-" o ".", hasta 64).'));
      let json;
      try{ json = JSON.stringify(value === undefined ? null : value); }catch(e){ return Promise.reject(fail('bad-value', 'El valor no se puede guardar (tiene que ser JSON).')); }
      if(json.length > MAX_VALUE_BYTES) return Promise.reject(fail('too-large', 'El valor ocupa demasiado (máximo 100 KB por clave).'));
      return bucket.read().then((values) => {
        values[key] = json;
        const total = Object.keys(values).reduce((n, k) => n + k.length + values[k].length, 0);
        const max = bucket.maxBytes || MAX_TOTAL_BYTES;
        if(total > max) throw fail('quota', 'El plugin ha llenado su espacio (' + Math.round(max / 1024) + ' KB).');
        return bucket.write(values);
      });
    }

    static storageRemove(bucket, key){
      return bucket.read().then((values) => {
        if(!Object.prototype.hasOwnProperty.call(values, key)) return null;
        delete values[key];
        return bucket.write(values);
      });
    }

    static clearData(db, pluginId){
      return db.doc('plugin_data/' + pluginId).delete();
    }
  }

  Workhub.models.PluginModel = PluginModel;
})();
