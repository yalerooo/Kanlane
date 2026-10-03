/* Trabajo en equipo: invitaciones, miembros y roles de los proyectos de
   equipo (teams/{id}, ver ProjectModel), y conversión de un proyecto personal
   en uno de equipo. Solo existe con el backend de Firebase (db.teams).

   Roles: owner (todo: miembros, ajustes, borrar), editor (tareas y datos del
   proyecto) y viewer (solo lectura). Las reglas de Firestore (firestore.rules)
   son las que lo hacen cumplir; esto solo lo usa para pintar la interfaz. */
(function(){
  const PM = Workhub.models.ProjectModel;
  const ROLES = ['owner', 'editor', 'viewer'];
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  /* Datos que se copian al convertir un proyecto personal (sin el gestor de contraseñas). */
  const COPY_COLLECTIONS = ['clients', 'contacts', 'meetings', 'plugin_data', 'tasks'];
  /* 'github' lleva el enlace con el GitHub Project (sin ningún token): cada miembro conecta su cuenta. */
  const CONFIG_KEYS = ['tipo', 'stages', 'clients', 'labels', 'github'];
  /* Escrituras a la vez al copiar. No se usan lotes (batch): las reglas consultan el
     documento del equipo en cada escritura y Firestore limita esas consultas a unas
     20 por lote entero, así que un proyecto con más de unas pocas tareas fallaba con
     permission-denied. De una en una el límite es por operación y no se alcanza. */
  const WRITE_CONCURRENCY = 12;

  const runPool = Workhub.utils.pool.run;

  /* Invitaciones: las que ha recibido mi correo, o las que envié desde un equipo. */
  class InviteModel extends Workhub.models.CollectionModel {
    constructor(){
      super('invites');
    }

    /* query: consulta de Firestore (db.teams.invitesForMe / invitesFrom). */
    connectQuery(query){
      this.connect({collection: () => query});
    }
  }

  class TeamModel {
    constructor(projects){
      this.projects = projects;
      this.incoming = new InviteModel();
      this.sent = new InviteModel();
    }

    get db(){ return this.projects.rootDb; }

    /* Los equipos solo funcionan con cuenta (Firebase) y con un correo conocido. */
    enabled(){
      return !!(this.db && this.db.teams && this.db.me);
    }

    /* Empieza a escuchar las invitaciones que ha recibido mi correo. */
    connect(){
      if(!this.enabled() || !this.db.me.email) return;
      this.incoming.connectQuery(this.db.teams.invitesForMe());
    }

    watchSent(tid){
      if(this.enabled()) this.sent.connectQuery(this.db.teams.invitesFrom(tid));
    }

    stopSent(){
      this.sent.disconnect();
    }

    static isRole(role){ return ROLES.indexOf(role) !== -1; }

    /* ---------- Permisos (para la interfaz) ---------- */

    canEdit(project){
      return !project || !project.team || project.role === 'owner' || project.role === 'editor';
    }

    isOwner(project){
      return !!project && !!project.team && project.role === 'owner';
    }

    /* ---------- Invitaciones ---------- */

    /* Invita a un correo a un equipo del que soy propietario. */
    invite(project, email, role){
      email = String(email || '').trim().toLowerCase();
      if(!EMAIL.test(email)) return Promise.reject(new Error('bad-email'));
      if(role !== 'editor' && role !== 'viewer') return Promise.reject(new Error('bad-role'));
      const already = this.projects.membersOf(project).some((m) => String(m.email).toLowerCase() === email);
      if(already) return Promise.reject(new Error('already-member'));
      const me = this.db.me;
      const tid = project.teamId;
      return this.db.teams.invite(tid + '_' + email).set({
        teamId: tid,
        teamName: project.nombre,
        email: email,
        role: role,
        invitedByUid: me.uid,
        invitedByName: me.name,
        createdAt: Date.now()
      });
    }

    revoke(inviteId){
      return this.db.teams.invite(inviteId).delete();
    }

    /* Acepto una invitación: entro en el equipo con el rol que me dieron y la borro. */
    accept(invite){
      const {teams, me} = this.db;
      const FV = teams.FieldValue;
      const batch = teams.batch();
      batch.update(teams.doc(invite.teamId), {
        memberIds: FV.arrayUnion(me.uid),
        ['members.' + me.uid]: {role:invite.role, name:me.name, email:me.email, photo:me.photo}
      });
      batch.delete(teams.invite(invite.id));
      return batch.commit();
    }

    decline(invite){
      return this.revoke(invite.id);
    }

    /* ---------- Miembros ---------- */

    setRole(project, uid, role){
      if(role !== 'editor' && role !== 'viewer') return Promise.reject(new Error('bad-role'));
      return this.db.teams.doc(project.teamId).update({['members.' + uid + '.role']: role});
    }

    removeMember(project, uid){
      const FV = this.db.teams.FieldValue;
      return this.db.teams.doc(project.teamId).update({memberIds: FV.arrayRemove(uid), ['members.' + uid]: FV.delete()});
    }

    /* Salgo del equipo (el propietario no puede: tiene que eliminarlo). */
    leave(project){
      return this.removeMember(project, this.db.me.uid);
    }

    /* ---------- Convertir un proyecto personal en uno de equipo ---------- */

    /* Crea un equipo con la configuración del proyecto y una copia de sus
       tareas (con notas e imágenes), clientes, contactos, reuniones y datos de
       plugins. No copia las contraseñas guardadas (todavía no se comparten) y
       el proyecto original se queda como está. Devuelve {id} del equipo. */
    convert(project, onProgress){
      const db = this.db;
      const src = PM.scope(db, project.id);
      const tid = db.teams.newId();
      const dst = db.team(tid);
      const config = {};
      CONFIG_KEYS.forEach((k) => { if(project[k] !== undefined) config[k] = project[k]; });
      const ops = [];   /* [ref, data] */
      const step = (text) => { if(onProgress) onProgress(text); };
      /* En qué paso está, para decir cuál falló. */
      let phase = 'crear el equipo';
      let created = false;

      step('Creando el equipo…');
      return this.projects.createTeam(project.nombre, typeof project.color === 'number' ? project.color : null, config, tid).then(() => {
        created = true;
        phase = 'leer los datos del proyecto';
        step('Leyendo los datos…');
        return Promise.all(COPY_COLLECTIONS.map((name) => src.collection(name).get().then((snap) => ({name:name, docs:snap.docs}))));
      }).then((groups) => {
        const assetIds = {};
        const notesJobs = [];
        groups.forEach((g) => g.docs.forEach((d) => {
          const data = d.data() || {};
          /* Las contraseñas vinculadas no viajan: en el equipo no hay gestor. */
          if(g.name === 'tasks'){
            delete data.linkedVault;
            notesJobs.push(src.collection('tasks/' + d.id + '/notes').get().then((notes) => {
              notes.docs.forEach((n) => {
                const nd = n.data() || {};
                if(nd.imageAssetId) assetIds[nd.imageAssetId] = true;
                ops.push([dst.collection('tasks/' + d.id + '/notes').doc(n.id), nd]);
              });
            }));
          }
          ops.push([dst.collection(g.name).doc(d.id), data]);
        }));
        return Promise.all(notesJobs).then(() => Object.keys(assetIds));
      }).then((assetIds) => {
        /* Las imágenes de las notas pasan a las del equipo, con el mismo id. */
        return Promise.all(assetIds.map((id) => db.collection('assets').doc(id).get().then((snap) => {
          if(snap.exists) ops.push([dst.collection('assets').doc(id), snap.data()]);
        }).catch(() => null)));
      }).then(() => {
        phase = 'copiar los datos al equipo';
        return runPool(ops, WRITE_CONCURRENCY, (op) => op[0].set(op[1]), (n) => step('Copiando… ' + n + ' de ' + ops.length));
      }).then(() => ({id: PM.teamKey(tid), teamId: tid}), (err) => {
        /* A medias no sirve de nada: se deshace lo que se hubiera creado. */
        const undo = created ? this.projects.removeProject(PM.teamKey(tid), db, null).catch(() => null) : Promise.resolve();
        return undo.then(() => {
          if(err && typeof err === 'object') err.phase = phase;
          throw err;
        });
      });
    }
  }

  TeamModel.ROLES = ROLES;
  Workhub.models.InviteModel = InviteModel;
  Workhub.models.TeamModel = TeamModel;
})();
