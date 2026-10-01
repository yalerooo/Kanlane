/* Proyectos: cada uno tiene sus propias tareas, reuniones, contactos,
   contraseñas y clientes.
   - El registro vive en la colección 'projects' de la raíz.
   - El proyecto principal ('main') usa la raíz tal cual, así los datos que ya
     existían antes de haber proyectos siguen en su sitio, sin migrar nada.
     Se puede eliminar: se vacía la raíz y su documento queda marcado con
     deleted:true para que no vuelva a salir en la lista. Crear de nuevo el
     primer proyecto lo reescribe.
   - El resto guarda sus datos bajo projects/{id}/… (ver scope()).
   - Los proyectos de equipo viven en teams/{id} (compartidos con otras
     cuentas). Aquí tienen el id 't:{id}' y se mezclan con los personales en
     list(); se distinguen por team:true y por role (owner, editor, viewer). */
(function(){
  const MAIN_ID = 'main';
  const MAIN_NAME = 'Proyecto principal';
  /* Colecciones de datos de un proyecto (las que se borran al eliminarlo). */
  const DATA_COLLECTIONS = ['tasks', 'clients', 'contacts', 'meetings', 'vault', 'plugin_data'];
  const VAULT_META_PATH = 'vault_meta/check';
  const TEAM_PREFIX = 't:';
  /* En un equipo no hay gestor de contraseñas (todavía) y las imágenes viven en assets. */
  const TEAM_DATA_COLLECTIONS = ['tasks', 'clients', 'contacts', 'meetings', 'plugin_data', 'assets'];
  /* Campos del documento de un equipo que no son de configuración. */
  const TEAM_PROTECTED = ['ownerUid', 'memberIds', 'members', 'createdAt'];
  const TEAM_DERIVED = ['id', 'team', 'teamId', 'role'];

  class ProjectModel extends Workhub.models.CollectionModel {
    constructor(){
      super('projects');
      this.loaded = false;
      this.rootDb = null;
      this.teamItems = [];
      this.personalLoaded = false;
      this.teamsLoaded = false;
      this.teamsStop = null;
    }

    static get MAIN_ID(){ return MAIN_ID; }

    static isTeam(id){ return typeof id === 'string' && id.indexOf(TEAM_PREFIX) === 0; }
    static teamId(id){ return String(id).slice(TEAM_PREFIX.length); }
    static teamKey(tid){ return TEAM_PREFIX + tid; }

    /* "Cargado" cuando han llegado los proyectos personales y los equipos. */
    _updateLoaded(){
      this.loaded = this.personalLoaded && this.teamsLoaded;
    }

    connect(db){
      this.loaded = false;
      this.personalLoaded = false;
      this.rootDb = db;
      this.teamItems = [];
      /* Sin equipos (modo local o claude.ai) no hay nada que esperar. */
      this.teamsLoaded = !db.teams;
      if(this.teamsStop){ this.teamsStop(); this.teamsStop = null; }
      super.connect(db);
      const off = this.on('change', () => {
        if(!this.col) return;
        this.personalLoaded = true;
        this._updateLoaded();
        off();
      });
      if(db.teams){
        const gen = this.generation;
        this.teamsStop = db.teams.query().onSnapshot((snap) => {
          if(gen !== this.generation) return;
          this.teamItems = snap.docs.map((d) => Object.assign({}, d.data(), {id:TEAM_PREFIX + d.id, team:true, teamId:d.id}));
          this.teamsLoaded = true;
          this._updateLoaded();
          this.emit('change');
        }, () => {
          /* Sin permiso o sin conexión: se sigue con los proyectos personales. */
          if(gen !== this.generation) return;
          this.teamsLoaded = true;
          this._updateLoaded();
          this.emit('change');
        });
      }
    }

    disconnect(){
      if(this.teamsStop){ this.teamsStop(); this.teamsStop = null; }
      this.teamItems = [];
      super.disconnect();
    }

    /* Mi rol en un equipo: 'owner', 'editor' o 'viewer' (o '' si el proyecto es personal). */
    roleOf(project){
      if(!project || !project.team) return '';
      const me = this.rootDb && this.rootDb.me ? this.rootDb.me.uid : '';
      const m = project.members && project.members[me];
      return (m && m.role) || 'viewer';
    }

    /* Miembros de un equipo: [{uid, role, name, email, photo}]; primero el propietario. */
    membersOf(project){
      if(!project || !project.team || !project.members) return [];
      const order = {owner:0, editor:1, viewer:2};
      return Object.keys(project.members).map((uid) => Object.assign({uid:uid}, project.members[uid]))
        .sort((a, b) => (order[a.role] - order[b.role]) || String(a.name).localeCompare(String(b.name), 'es'));
    }

    /* Base de datos acotada a un proyecto: mismas llamadas (collection, doc),
       con las rutas dentro de projects/{id}/. Se recorre referencia a
       referencia (doc → collection → doc…) en vez de concatenar la ruta, que
       es lo que admiten los tres almacenes (Firestore, local y claude.ai). */
    static scope(db, id){
      if(!id || id === MAIN_ID) return db;
      if(ProjectModel.isTeam(id) && db.team) return db.team(ProjectModel.teamId(id));
      const walk = (path) => {
        const parts = path.split('/').filter(Boolean);
        let ref = db.collection('projects').doc(id);
        parts.forEach((part, i) => { ref = i % 2 === 0 ? ref.collection(part) : ref.doc(part); });
        return ref;
      };
      return {collection:walk, doc:walk};
    }

    /* Lista ordenada: el principal primero y después por fecha de creación.
       El principal existe aunque nunca se haya renombrado, salvo que se haya
       eliminado. */
    list(){
      const teams = this.teamItems.map((t) => Object.assign({createdAt:0}, t, {role:this.roleOf(t)}));
      const stored = this.items.filter((p) => p.id !== MAIN_ID).concat(teams);
      const mainDoc = this.items.find((p) => p.id === MAIN_ID) || {};
      stored.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
      if(mainDoc.deleted) return stored;
      const main = Object.assign({createdAt:0}, mainDoc, {id:MAIN_ID, nombre:mainDoc.nombre || Workhub.t(MAIN_NAME)});
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

    /* Escrituras: los equipos van a teams/{id}. Los miembros (ownerUid, memberIds
       y members) nunca se reescriben desde aquí, así un cambio de configuración
       no pisa a alguien que acaba de entrar. Solo se envían los campos que han
       cambiado. */
    set(id, data){
      if(!ProjectModel.isTeam(id)) return super.set(id, data);
      const cur = this.teamItems.find((t) => t.id === id) || {};
      const FV = this.rootDb.teams.FieldValue;
      const skip = TEAM_PROTECTED.concat(TEAM_DERIVED);
      const upd = {};
      Object.keys(data).forEach((k) => {
        if(skip.indexOf(k) !== -1) return;
        if(JSON.stringify(data[k]) !== JSON.stringify(cur[k])) upd[k] = data[k];
      });
      Object.keys(cur).forEach((k) => {
        if(skip.indexOf(k) === -1 && !(k in data)) upd[k] = FV.delete();
      });
      if(!Object.keys(upd).length) return Promise.resolve();
      return this.rootDb.teams.doc(ProjectModel.teamId(id)).update(upd);
    }

    update(id, patch){
      if(!ProjectModel.isTeam(id)) return super.update(id, patch);
      return this.rootDb.teams.doc(ProjectModel.teamId(id)).update(patch);
    }

    remove(id){
      if(!ProjectModel.isTeam(id)) return super.remove(id);
      return this.rootDb.teams.doc(ProjectModel.teamId(id)).delete();
    }

    /* Proyecto de equipo nuevo: yo soy su único miembro y su propietario. */
    createTeam(nombre, color, config, tid){
      const me = this.rootDb.me;
      tid = tid || this.rootDb.teams.newId();
      const data = Object.assign({
        nombre: nombre,
        createdAt: Date.now(),
        ownerUid: me.uid,
        memberIds: [me.uid],
        members: {[me.uid]: {role:'owner', name:me.name, email:me.email, photo:me.photo}}
      }, config || {});
      if(typeof color === 'number') data.color = color;
      return this.rootDb.teams.doc(tid).set(data).then(() => ({id:TEAM_PREFIX + tid, teamId:tid}));
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
      /* La integración con GitHub sobrevive a los cambios de nombre, color y tipo. */
      if(current.github && !data.github) data.github = current.github;
      if(current.labels && !data.labels) data.labels = current.labels;
      if(typeof color === 'number') data.color = color;
      return this.set(id, data);
    }

    /* Cambia campos sueltos conservando el resto del documento. Un valor
       null o undefined quita el campo. */
    patch(id, fields){
      const cur = Object.assign({}, this.get(id) || {});
      delete cur.id;
      if(id === MAIN_ID && !cur.nombre) cur.nombre = Workhub.t(MAIN_NAME);
      Object.keys(fields).forEach((k) => {
        if(fields[k] === null || fields[k] === undefined) delete cur[k];
        else cur[k] = fields[k];
      });
      return this.set(id, cur);
    }

    /* Borra todos los datos del proyecto y después su entrada del registro.
       El principal (la raíz) se vacía y queda marcado como eliminado.
       rootDb: base de datos sin acotar. */
    removeProject(id, rootDb, assets){
      if(!id) return Promise.reject(new Error('no-project'));
      const db = ProjectModel.scope(rootDb, id);
      const isTeam = ProjectModel.isTeam(id);
      const assetIds = [];
      const wipeTasks = db.collection('tasks').get().then((snap) => Promise.all(snap.docs.map((d) => {
        const ref = db.collection('tasks').doc(d.id);
        return ref.collection('notes').get().then((notes) => Promise.all(notes.docs.map((n) => {
          const data = n.data() || {};
          if(data.imageAssetId) assetIds.push(data.imageAssetId);
          return ref.collection('notes').doc(n.id).delete();
        }))).then(() => ref.delete());
      })));
      const wipeOthers = (isTeam ? TEAM_DATA_COLLECTIONS : DATA_COLLECTIONS).filter((c) => c !== 'tasks').map((name) => {
        const col = db.collection(name);
        return col.get().then((snap) => Promise.all(snap.docs.map((d) => col.doc(d.id).delete())));
      });
      /* El proyecto principal conserva las instalaciones antiguas en esta
         colección raíz; borrarlo también debe quitar sus plugins. */
      if(id === MAIN_ID){
        const col = rootDb.collection('plugins');
        wipeOthers.push(col.get().then((snap) => Promise.all(snap.docs.map((d) => {
          const data = d.data() || {};
          const keepUserData = data.userValues && Object.keys(data.userValues).length
            ? rootDb.doc('settings/plugin-user:' + d.id).get().then((old) => old.exists ? null : rootDb.doc('settings/plugin-user:' + d.id).set({userValues:data.userValues, updatedAt:Date.now()}))
            : Promise.resolve();
          return keepUserData.then(() => col.doc(d.id).delete());
        }))));
      }
      /* En un equipo no hay gestor de contraseñas, y las reglas no lo permiten. */
      const wipeMeta = isTeam ? Promise.resolve() : db.doc(VAULT_META_PATH).delete();
      return Promise.all([wipeTasks, wipeMeta].concat(wipeOthers)).then(() => {
        /* Las imágenes son lo menos importante: si alguna falla, se sigue. */
        if(!assets || !assets.delete) return null;
        return Promise.all(assetIds.map((a) => assets.delete(a).catch(() => null)));
      }).then(() => {
        /* Las invitaciones pendientes de un equipo que ya no existe se cancelan. */
        if(!isTeam) return null;
        return rootDb.teams.invitesFrom(ProjectModel.teamId(id)).get()
          .then((snap) => Promise.all(snap.docs.map((d) => d.ref.delete())))
          .catch(() => null);
      }).then(() => id === MAIN_ID ? this.set(MAIN_ID, {deleted:true, createdAt:0}) : this.remove(id));
    }
  }

  Workhub.models.ProjectModel = ProjectModel;
})();
