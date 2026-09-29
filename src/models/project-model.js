/* Proyectos: cada uno tiene sus propias tareas, reuniones, contactos,
   contraseñas y clientes.
   - El registro vive en la colección 'projects' de la raíz.
   - El proyecto principal ('main') usa la raíz tal cual, así los datos que ya
     existían antes de haber proyectos siguen en su sitio, sin migrar nada.
   - El resto guarda sus datos bajo projects/{id}/… (ver scope()). */
(function(){
  const MAIN_ID = 'main';
  const MAIN_NAME = 'Proyecto principal';
  /* Colecciones de datos de un proyecto (las que se borran al eliminarlo). */
  const DATA_COLLECTIONS = ['tasks', 'clients', 'contacts', 'meetings', 'vault', 'plugin_data'];
  const VAULT_META_PATH = 'vault_meta/check';

  class ProjectModel extends Workhub.models.CollectionModel {
    constructor(){
      super('projects');
      this.loaded = false;
    }

    static get MAIN_ID(){ return MAIN_ID; }

    connect(db){
      this.loaded = false;
      super.connect(db);
      const off = this.on('change', () => {
        if(!this.col) return;
        this.loaded = true;
        off();
      });
    }

    /* Base de datos acotada a un proyecto: mismas llamadas (collection, doc),
       con las rutas dentro de projects/{id}/. Se recorre referencia a
       referencia (doc → collection → doc…) en vez de concatenar la ruta, que
       es lo que admiten los tres almacenes (Firestore, local y claude.ai). */
    static scope(db, id){
      if(!id || id === MAIN_ID) return db;
      const walk = (path) => {
        const parts = path.split('/').filter(Boolean);
        let ref = db.collection('projects').doc(id);
        parts.forEach((part, i) => { ref = i % 2 === 0 ? ref.collection(part) : ref.doc(part); });
        return ref;
      };
      return {collection:walk, doc:walk};
    }

    /* Lista ordenada: el principal primero y después por fecha de creación.
       El principal existe siempre, aunque nunca se haya renombrado. */
    list(){
      const stored = this.items.filter((p) => p.id !== MAIN_ID);
      const mainDoc = this.items.find((p) => p.id === MAIN_ID) || {};
      const main = Object.assign({createdAt:0}, mainDoc, {id:MAIN_ID, nombre:mainDoc.nombre || Workhub.t(MAIN_NAME)});
      stored.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
      return [main].concat(stored);
    }

    get(id){
      return this.list().find((p) => p.id === id) || null;
    }

    exists(id){
      return !!this.get(id);
    }

    hueOf(project){
      if(project && typeof project.color === 'number') return project.color;
      return Workhub.utils.html.hueFor(project ? project.nombre : '');
    }

    /* Etapas y clientes de un proyecto: {tipo, stages, clients} (ver ProjectTemplates). */
    configOf(project){
      return Workhub.models.ProjectTemplates.resolve(project);
    }

    /* config: campos del tipo de proyecto (ProjectTemplates.fieldsFor). */
    create(nombre, color, config){
      const data = Object.assign({nombre:nombre, createdAt:Date.now()}, config || {});
      if(typeof color === 'number') data.color = color;
      return this.add(data);
    }

    /* set con merge: el documento del principal puede no existir todavía. */
    save(id, nombre, color, config){
      const current = this.get(id) || {};
      const data = Object.assign({nombre:nombre, createdAt:current.createdAt || (id === MAIN_ID ? 0 : Date.now())}, config || {});
      if(typeof color === 'number') data.color = color;
      return this.set(id, data);
    }

    /* Borra todos los datos del proyecto y después su entrada del registro.
       El principal no se puede eliminar. rootDb: base de datos sin acotar. */
    removeProject(id, rootDb, assets){
      if(!id || id === MAIN_ID) return Promise.reject(new Error('main-project'));
      const db = ProjectModel.scope(rootDb, id);
      const assetIds = [];
      const wipeTasks = db.collection('tasks').get().then((snap) => Promise.all(snap.docs.map((d) => {
        const ref = db.collection('tasks').doc(d.id);
        return ref.collection('notes').get().then((notes) => Promise.all(notes.docs.map((n) => {
          const data = n.data() || {};
          if(data.imageAssetId) assetIds.push(data.imageAssetId);
          return ref.collection('notes').doc(n.id).delete();
        }))).then(() => ref.delete());
      })));
      const wipeOthers = DATA_COLLECTIONS.filter((c) => c !== 'tasks').map((name) => {
        const col = db.collection(name);
        return col.get().then((snap) => Promise.all(snap.docs.map((d) => col.doc(d.id).delete())));
      });
      const wipeMeta = db.doc(VAULT_META_PATH).delete();
      return Promise.all([wipeTasks, wipeMeta].concat(wipeOthers)).then(() => {
        /* Las imágenes son lo menos importante: si alguna falla, se sigue. */
        if(!assets || !assets.delete) return null;
        return Promise.all(assetIds.map((a) => assets.delete(a).catch(() => null)));
      }).then(() => this.remove(id));
    }
  }

  Workhub.models.ProjectModel = ProjectModel;
})();
