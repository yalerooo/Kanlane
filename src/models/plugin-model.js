/* Plugins instalados por el usuario (colección 'plugins' de su cuenta, común a
   todos sus proyectos). Cada documento: {url, manifest, granted, official,
   installedAt, updatedAt}; el id del documento es el del plugin.

   Los datos que guarda cada plugin (storage) van por proyecto, en
   plugin_data/{idDelPlugin}: {values:{clave: JSON}, updatedAt}. */
(function(){
  const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
  const MAX_VALUE_BYTES = 100 * 1024;
  const MAX_TOTAL_BYTES = 800 * 1024;

  function fail(code, message){
    const e = new Error(message);
    e.code = code;
    return e;
  }

  class PluginModel extends Workhub.models.CollectionModel {
    constructor(){
      super('plugins');
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

    /* ---------- Datos propios de cada plugin (por proyecto) ---------- */

    static dataRef(db, pluginId){
      return db.doc('plugin_data/' + pluginId);
    }

    static readValues(db, pluginId){
      return PluginModel.dataRef(db, pluginId).get().then((snap) => {
        const d = snap.exists ? snap.data() || {} : {};
        return d.values && typeof d.values === 'object' ? d.values : {};
      });
    }

    static storageGet(db, pluginId, key){
      if(!KEY_RE.test(String(key))) return Promise.reject(fail('bad-key', 'Clave no válida (letras, números, "_", "-" o ".", hasta 64).'));
      return PluginModel.readValues(db, pluginId).then((values) => {
        if(!Object.prototype.hasOwnProperty.call(values, key)) return null;
        try{ return JSON.parse(values[key]); }catch(e){ return null; }
      });
    }

    static storageKeys(db, pluginId){
      return PluginModel.readValues(db, pluginId).then((values) => Object.keys(values).sort());
    }

    static storageSet(db, pluginId, key, value){
      if(!KEY_RE.test(String(key))) return Promise.reject(fail('bad-key', 'Clave no válida (letras, números, "_", "-" o ".", hasta 64).'));
      let json;
      try{ json = JSON.stringify(value === undefined ? null : value); }catch(e){ return Promise.reject(fail('bad-value', 'El valor no se puede guardar (tiene que ser JSON).')); }
      if(json.length > MAX_VALUE_BYTES) return Promise.reject(fail('too-large', 'El valor ocupa demasiado (máximo 100 KB por clave).'));
      return PluginModel.readValues(db, pluginId).then((values) => {
        values[key] = json;
        const total = Object.keys(values).reduce((n, k) => n + k.length + values[k].length, 0);
        if(total > MAX_TOTAL_BYTES) throw fail('quota', 'El plugin ha llenado su espacio (800 KB por proyecto).');
        return PluginModel.dataRef(db, pluginId).set({values:values, updatedAt:Date.now()});
      });
    }

    static storageRemove(db, pluginId, key){
      return PluginModel.readValues(db, pluginId).then((values) => {
        if(!Object.prototype.hasOwnProperty.call(values, key)) return null;
        delete values[key];
        return PluginModel.dataRef(db, pluginId).set({values:values, updatedAt:Date.now()});
      });
    }

    static clearData(db, pluginId){
      return PluginModel.dataRef(db, pluginId).delete();
    }
  }

  Workhub.models.PluginModel = PluginModel;
})();
