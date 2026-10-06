/* «Crear cuenta y llevarme mis datos»: copia a una cuenta lo que hay en el modo invitado.

   El invitado guarda todo en el almacén local del navegador (core/local-storage-shim.js) y la
   cuenta en Firestore. Al pedirlo se apunta en este navegador (workhub_guest_migrate) y se va a la
   pantalla de acceso; en cuanto entra una cuenta —nueva o ya existente—, run() copia los datos
   antes de arrancar la app (AuthController.bringGuestData).

   - Cada proyecto del invitado pasa a ser un proyecto NUEVO de la cuenta: nunca se mezcla con lo
     que la cuenta ya tuviera ni lo pisa. Si la cuenta estaba vacía, su proyecto principal (que
     quedaría vacío) se marca como eliminado, igual que al entrar en un equipo con una cuenta nueva.
   - Los documentos conservan su id, así que los contactos y contraseñas enlazados a tareas siguen
     enlazados (una copia de seguridad importada los pierde). Las imágenes de las notas se suben a
     la cuenta y la nota apunta a la nueva.
   - Se puede repetir sin duplicar nada: el estado guarda el id nuevo de cada proyecto e imagen y
     qué proyectos están terminados. Un fallo pasajero (sin conexión) corta la copia y se vuelve a
     intentar en la siguiente carga; lo que las reglas rechazan (firestore.rules) se cuenta en
     `skipped` y se sigue con lo demás. */
(function(){
  const P = Workhub.models.ProjectModel;
  const pool = Workhub.utils.pool;
  const PENDING_KEY = 'workhub_guest_migrate';
  const MAIN_NAME = 'Proyecto principal';
  /* Datos de un proyecto que se copian tal cual (las tareas van aparte, por sus notas). */
  const COLLECTIONS = ['clients', 'contacts', 'meetings', 'vault', 'plugin_data'];
  /* Con algo aquí, la raíz de una base de datos tiene un proyecto principal en uso. */
  const ROOT_DATA = ['tasks', 'clients', 'contacts', 'meetings', 'vault'];
  const VAULT_META = 'vault_meta/check';
  const USER_VALUES = 'plugin-user:';
  const LIMIT = 8;
  /* No van a salir bien por mucho que se repitan: se saltan en vez de cortar la copia. */
  const PERMANENT = ['permission-denied', 'invalid-argument', 'image-too-large', 'image-unreadable'];
  /* Límites de firestore.rules para el documento de un proyecto. */
  const MAX_STAGES = 8;
  const MAX_LABELS = 60;

  /* ---------- Lo pendiente, en este navegador ---------- */

  /* null, o {name, id, open, ids, done, assets, blank}. */
  function pending(){
    try{
      const s = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
    }catch(e){ return null; }
  }

  function save(state){
    try{ localStorage.setItem(PENDING_KEY, JSON.stringify(state)); return true; }catch(e){ return false; }
  }

  /* name e id: el invitado (el id dice cuál es su base de datos; '' = la de siempre); open: proyecto
     que tenía abierto. false si no se pudo apuntar. */
  function request(name, open, id){
    return save({name:String(name || ''), id:String(id || ''), open:String(open || '')});
  }

  function clear(){
    try{ localStorage.removeItem(PENDING_KEY); }catch(e){}
  }

  /* ---------- La copia ---------- */

  function isEmpty(db, names){
    return Promise.all(names.map((name) => db.collection(name).get().then((snap) => !snap.docs.length)))
      .then((flags) => flags.every(Boolean));
  }

  /* Proyectos del invitado: [{id, doc}], el principal primero. El principal no tiene por qué tener
     documento (usa la raíz): cuenta si lo tiene o si hay datos en la raíz, y no si se eliminó. */
  function guestProjects(from){
    return from.collection('projects').get().then((snap) => {
      const docs = snap.docs.map((d) => ({id:d.id, doc:d.data() || {}}));
      const main = docs.find((p) => p.id === P.MAIN_ID);
      const rest = docs.filter((p) => p.id !== P.MAIN_ID)
        .sort((a, b) => (a.doc.createdAt || 0) - (b.doc.createdAt || 0));
      if(main) return main.doc.deleted ? rest : [main].concat(rest);
      return isEmpty(from, ROOT_DATA).then((empty) => (empty ? rest : [{id:P.MAIN_ID, doc:{}}].concat(rest)));
    });
  }

  /* Documento del proyecto en la cuenta. Fuera lo que no viaja: la marca de eliminado y el cifrado
     (un invitado no tiene proyectos cifrados, y `enc` sin sus claves dejaría el proyecto cerrado). */
  function projectDoc(doc){
    const data = Object.assign({}, doc);
    delete data.id;
    delete data.deleted;
    delete data.enc;
    data.nombre = String(data.nombre || Workhub.t(MAIN_NAME)).slice(0, 200);
    if(typeof data.createdAt !== 'number') data.createdAt = Date.now();
    if(Array.isArray(data.stages)) data.stages = data.stages.slice(0, MAX_STAGES);
    if(Array.isArray(data.labels)) data.labels = data.labels.slice(0, MAX_LABELS);
    return data;
  }

  /* o: {from, to, assets, state, save}
     - from / to: base de datos del invitado y de la cuenta (sin acotar a ningún proyecto).
     - assets: {read(id) → Promise<Blob|null>, upload(blob) → Promise<{id}>}: imágenes de las notas.
     - state: lo pendiente (pending()); save(state) lo guarda tras cada paso.
     Devuelve {projects:[{id, nombre, …}], open, counts:{projects, tasks}, skipped}: `open` es el
     proyecto de la cuenta que corresponde al que el invitado tenía abierto. Se rechaza ante un
     fallo pasajero, con lo ya hecho apuntado en state. */
  function run(o){
    const from = o.from, to = o.to, state = o.state;
    const keep = () => { if(o.save) o.save(state); };
    const counts = {projects:0, tasks:0};
    const out = [];
    let skipped = 0;
    state.ids = state.ids || {};
    state.done = state.done || {};
    state.assets = state.assets || {};

    /* Escribe un documento; true si quedó guardado y false si se saltó. */
    const put = (ref, data) => ref.set(data).then(() => true, (err) => {
      if(!err || PERMANENT.indexOf(err.code) === -1) throw err;
      skipped++;
      return false;
    });

    /* Imagen de una nota: id en la cuenta ('' si ya no existe o no se pudo subir). */
    const image = (id) => {
      if(state.assets[id]) return Promise.resolve(state.assets[id]);
      if(!o.assets) return Promise.resolve('');
      return o.assets.read(id).then((blob) => {
        if(!blob) return '';
        return o.assets.upload(blob).then((res) => {
          state.assets[id] = res.id;
          keep();
          return res.id;
        });
      }).catch((err) => {
        if(!err || PERMANENT.indexOf(err.code) === -1) throw err;
        skipped++;
        return '';
      });
    };

    const copyCollection = (src, dst, name) => src.collection(name).get().then((snap) =>
      pool.run(snap.docs, LIMIT, (d) => put(dst.collection(name).doc(d.id), d.data() || {})));

    const copyTask = (src, dst, d) => {
      const target = dst.collection('tasks').doc(d.id);
      return put(target, d.data() || {}).then((ok) => {
        if(!ok) return null;
        counts.tasks++;
        return src.collection('tasks').doc(d.id).collection('notes').get().then((notes) =>
          pool.run(notes.docs, LIMIT, (n) => {
            const note = Object.assign({}, n.data() || {});
            const linked = note.imageAssetId ? image(note.imageAssetId) : Promise.resolve('');
            return linked.then((assetId) => {
              if(note.imageAssetId) note.imageAssetId = assetId;
              return put(target.collection('notes').doc(n.id), note);
            });
          }));
      });
    };

    /* El principal guarda sus plugins en la colección raíz `plugins`; el resto de proyectos, en
       plugin_data/install:{id} (models/plugin-model.js). Aquí deja de ser el principal. */
    const copyMainPlugins = (dst) => from.collection('plugins').get().then((snap) =>
      pool.run(snap.docs, LIMIT, (d) => {
        const data = Object.assign({}, d.data() || {});
        const values = data.userValues;
        delete data.userValues;
        const install = put(dst.doc('plugin_data/install:' + d.id), Object.assign({_kind:'plugin-install', pluginId:d.id}, data));
        if(!values || !Object.keys(values).length) return install;
        return install.then(() => userValues(d.id, {userValues:values, updatedAt:Date.now()}));
      }));

    /* wh.storage.user de un plugin: es de la cuenta, no de un proyecto. Lo que ya tenga no se pisa. */
    const userValues = (pluginId, data) => {
      const ref = to.doc('settings/' + USER_VALUES + pluginId);
      return ref.get().then((snap) => (snap.exists ? null : put(ref, data)));
    };

    const copyProject = (g) => {
      if(!state.ids[g.id]){
        state.ids[g.id] = to.collection('projects').doc().id;
        keep();
      }
      const id = state.ids[g.id];
      const data = projectDoc(g.doc);
      out.push(Object.assign({id:id, from:g.id}, data));
      if(state.done[g.id]) return Promise.resolve();
      const src = P.scope(from, g.id);
      const dst = P.scope(to, id);
      /* Primero el proyecto: si la copia se corta, lo ya copiado se ve y la siguiente la termina. */
      return put(to.collection('projects').doc(id), data).then((ok) => {
        if(!ok) return null;
        counts.projects++;
        return Promise.all(COLLECTIONS.map((name) => copyCollection(src, dst, name)))
          .then(() => src.collection('tasks').get())
          .then((snap) => pool.run(snap.docs, LIMIT, (d) => copyTask(src, dst, d)))
          .then(() => src.doc(VAULT_META).get())
          .then((meta) => (meta.exists ? put(dst.doc(VAULT_META), meta.data() || {}) : null))
          .then(() => (g.id === P.MAIN_ID ? copyMainPlugins(dst) : null))
          .then(() => {
            state.done[g.id] = true;
            keep();
          });
      });
    };

    return guestProjects(from).then((list) => {
      if(!list.length) return null;
      const blank = typeof state.blank === 'boolean' ? Promise.resolve(state.blank)
        : Promise.all([isEmpty(to, ['projects']), isEmpty(to, ROOT_DATA)]).then((flags) => {
          state.blank = flags.every(Boolean);
          keep();
          return state.blank;
        });
      return blank.then(() => list.reduce((chain, g) => chain.then(() => copyProject(g)), Promise.resolve()))
        .then(() => from.collection('settings').get())
        .then((snap) => pool.run(snap.docs.filter((d) => d.id.indexOf(USER_VALUES) === 0), LIMIT,
          (d) => userValues(d.id.slice(USER_VALUES.length), d.data() || {})))
        .then(() => (state.blank ? put(to.collection('projects').doc(P.MAIN_ID), {deleted:true, createdAt:0}) : null));
    }).then(() => {
      const open = out.find((p) => p.from === state.open) || out[0] || null;
      return {projects:out, open:open, counts:counts, skipped:skipped};
    });
  }

  Workhub.models.guestMigration = {pending, request, clear, save, run};
})();
