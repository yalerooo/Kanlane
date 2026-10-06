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
  /* Datos que se copian al convertir un proyecto personal. Las contraseñas ('vault') van aparte:
     solo si se ha abierto el cofre con la contraseña maestra (ver convert). */
  const COPY_COLLECTIONS = ['clients', 'contacts', 'meetings', 'plugin_data', 'tasks'];
  const TeamVault = () => Workhub.models.TeamVault;
  /* 'github' lleva el enlace con el GitHub Project (sin ningún token): cada miembro conecta su cuenta. */
  const CONFIG_KEYS = ['tipo', 'stages', 'clients', 'labels', 'github'];
  /* Escrituras a la vez al copiar. No se usan lotes (batch): las reglas consultan el
     documento del equipo en cada escritura y Firestore limita esas consultas a unas
     20 por lote entero, así que un proyecto con más de unas pocas tareas fallaba con
     permission-denied. De una en una el límite es por operación y no se alcanza. */
  const WRITE_CONCURRENCY = 12;
  /* Lo que dura el código de acceso de una invitación a un equipo cifrado. La caducidad de verdad la
     aplican las reglas al leer la clave envuelta; expiresAt solo sirve para la interfaz. */
  const INVITE_TTL = 24 * 60 * 60 * 1000;
  const JPEG_PREFIX = 'data:image/jpeg;base64,';

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

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

    /* Comprueba el correo y el rol de una invitación; devuelve el correo normalizado. */
    checkInvite(project, email, role){
      email = String(email || '').trim().toLowerCase();
      if(!EMAIL.test(email)) throw new Error('bad-email');
      if(role !== 'editor' && role !== 'viewer') throw new Error('bad-role');
      const already = this.projects.membersOf(project).some((m) => String(m.email).toLowerCase() === email);
      if(already) throw new Error('already-member');
      return email;
    }

    /* Invita a un correo a un equipo del que soy propietario.
       Equipo con cifrado total (docs/CIFRADO-PROYECTOS.md, 10.3): secret = {enc:{pid, kid, kcv},
       wrap:{salt, iter, iv, ct}} es la clave del proyecto envuelta con el código de acceso. Va en
       invites/{id}/key/wrap y se escribe en el mismo lote que la invitación. */
    invite(project, email, role, secret){
      try{ email = this.checkInvite(project, email, role); }catch(err){ return Promise.reject(err); }
      const {teams, me} = this.db;
      const tid = project.teamId;
      const id = tid + '_' + email;
      const now = Date.now();
      const data = {
        teamId: tid,
        teamName: project.nombre,
        email: email,
        role: role,
        invitedByUid: me.uid,
        invitedByName: me.name,
        createdAt: now
      };
      if(!PM.isEncrypted(project)) return teams.invite(id).set(data);
      /* Sin la clave envuelta, quien aceptase entraría en el equipo sin poder leer nada. */
      if(!secret || !secret.wrap || !secret.enc) return Promise.reject(fail('needs-secret'));
      data.enc = {pid:secret.enc.pid, kid:secret.enc.kid, kcv:secret.enc.kcv};
      data.expiresAt = now + INVITE_TTL;
      const key = teams.inviteKey(id);
      /* Invitar otra vez al mismo correo: la clave envuelta anterior no se puede sobrescribir. */
      const old = this.sent.items.some((i) => i.id === id) ? key.delete().catch(() => null) : Promise.resolve();
      return old.then(() => {
        const batch = teams.batch();
        batch.set(teams.invite(id), data);
        batch.set(key, Object.assign({}, secret.wrap, {kid:secret.enc.kid, kcv:secret.enc.kcv, createdAt:teams.serverTimestamp()}));
        return batch.commit();
      });
    }

    /* invite: la invitación o su id. La clave envuelta se borra primero (su regla consulta la invitación). */
    revoke(invite){
      const teams = this.db.teams;
      const inv = typeof invite === 'string' ? (this.sent.find(invite) || this.incoming.find(invite) || {id:invite}) : invite;
      const key = inv.enc ? teams.inviteKey(inv.id).delete().catch(() => null) : Promise.resolve();
      /* Con la invitación se va el acceso a las contraseñas que se le hubiera preparado. */
      const grant = inv.teamId && inv.email ? TeamVault().revoke(this.db, inv.teamId, inv.email) : Promise.resolve();
      return Promise.all([key, grant]).then(() => teams.invite(inv.id).delete());
    }

    /* Clave del proyecto envuelta con el código de acceso. Pasadas 24 h las reglas no dejan leerla. */
    readInviteKey(invite){
      return this.db.teams.inviteKey(invite.id).get().then((snap) => {
        if(!snap.exists) throw fail('no-key');
        return snap.data();
      });
    }

    static isExpired(invite){
      return !!invite && !!invite.enc && typeof invite.expiresAt === 'number' && invite.expiresAt < Date.now();
    }

    /* El propietario retira las invitaciones cifradas caducadas (ya no sirven: es solo orden). */
    cleanExpired(){
      return Promise.all(this.sent.items.filter((i) => TeamModel.isExpired(i)).map((i) => this.revoke(i).catch(() => null)));
    }

    /* Acepto una invitación: entro en el equipo con el rol que me dieron y la borro.
       Equipo con cifrado total (10.4): secret = {crypto} es mi clave envuelta (crypto/{uid}), que se
       guarda en el mismo lote junto al borrado de la clave envuelta con el código (un solo uso). */
    accept(invite, secret){
      const {teams, me} = this.db;
      if(invite.enc && !(secret && secret.crypto)) return Promise.reject(fail('needs-secret'));
      const FV = teams.FieldValue;
      const batch = teams.batch();
      batch.update(teams.doc(invite.teamId), {
        memberIds: FV.arrayUnion(me.uid),
        ['members.' + me.uid]: {role:invite.role, name:me.name, email:me.email, photo:me.photo}
      });
      if(invite.enc){
        batch.set(teams.cryptoDoc(invite.teamId, me.uid), secret.crypto);
        batch.delete(teams.inviteKey(invite.id));
      }
      batch.delete(teams.invite(invite.id));
      return batch.commit();
    }

    decline(invite){
      return this.revoke(invite);
    }

    /* ---------- Miembros ---------- */

    setRole(project, uid, role){
      if(role !== 'editor' && role !== 'viewer') return Promise.reject(new Error('bad-role'));
      return this.db.teams.doc(project.teamId).update({['members.' + uid + '.role']: role});
    }

    /* En un equipo cifrado se borra también su clave envuelta (10.7). Lo que ya vio o copió no se
       le puede quitar: eso lo dice la confirmación. */
    removeMember(project, uid){
      const teams = this.db.teams;
      const FV = teams.FieldValue;
      const member = this.projects.membersOf(project).find((m) => m.uid === uid);
      /* Su clave del cofre se borra antes de salir: después ya no sería miembro para borrarla él. */
      return TeamVault().forgetMember(this.db, project.teamId, uid, member ? member.email : '').then(() =>
        teams.doc(project.teamId).update({memberIds: FV.arrayRemove(uid), ['members.' + uid]: FV.delete()})
      ).then(() => {
        if(!PM.isEncrypted(project)) return null;
        /* Con su clave envuelta se van su clave pública y la clave nueva que tuviera pendiente (PR10). */
        const team = this.db.team(project.teamId);
        return Promise.all([
          teams.cryptoDoc(project.teamId, uid).delete().catch(() => null),
          team.collection('pubkeys').doc(uid).delete().catch(() => null),
          team.collection('rekey').doc(uid).delete().catch(() => null)
        ]);
      });
    }

    /* Salgo del equipo (el propietario no puede: tiene que eliminarlo). */
    leave(project){
      const me = this.db.me.uid;
      return this.removeMember(project, me).then(() => {
        const keystore = Workhub.services.keystore;
        if(PM.isEncrypted(project) && keystore) return keystore.forgetProject(project.id, me).catch(() => null);
        return null;
      });
    }

    /* ---------- Convertir un proyecto personal en uno de equipo ---------- */

    /* Crea un equipo con la configuración del proyecto y una copia de sus
       tareas (con notas e imágenes), clientes, contactos, reuniones y datos de
       plugins. Aquí no se toca el proyecto original: quien llama lo elimina
       después si todo se copió (TeamController.runConvert). Devuelve {id} del equipo.

       vault = {check, key} (TeamVault.prepareMove): el cofre pasa al equipo con sus credenciales.
       Sin él, las contraseñas no se copian y las tareas pierden sus vínculos con ellas.

       Proyecto con cifrado total (docs/CIFRADO-PROYECTOS.md, 10.2): secret = {tid, enc, crypto, src, dst}.
       El equipo tiene su propia clave: cada documento se lee con el cifrador del original (src) y se
       vuelve a cifrar con el del equipo (dst); enc es el campo del equipo y crypto mi clave envuelta.
       Lo que no se pueda descifrar no se copia (el resultado dice cuántos en .skipped). */
    convert(project, onProgress, secret, vault){
      const db = this.db;
      const src = PM.scope(db, project.id);
      const encrypted = PM.isEncrypted(project);
      if(encrypted && !(secret && secret.enc && secret.crypto && secret.src && secret.dst)) return Promise.reject(fail('needs-secret'));
      const tid = (secret && secret.tid) || db.teams.newId();
      const dst = db.team(tid);
      const config = {};
      CONFIG_KEYS.forEach((k) => { if(project[k] !== undefined && !(encrypted && k === 'github')) config[k] = project[k]; });
      if(encrypted) config.enc = secret.enc;
      let skipped = 0;
      /* Documento del original → documento para el equipo (o null si no se puede leer). */
      const recode = (path, id, raw) => {
        if(!encrypted) return Promise.resolve(raw);
        /* Las marcas de instalación de plugins van en claro también en un proyecto cifrado. */
        if(raw._kind) return Promise.resolve(raw);
        if(!secret.src.isSealed(raw)) return secret.dst.seal(path, id, raw);
        return secret.src.open(path, id, raw).then((r) => secret.dst.seal(path, id, Object.assign({}, secret.src.clearOf(path, raw), r.plain)),
          () => { skipped++; return null; });
      };
      const recodeAsset = (id, raw) => {
        if(!encrypted) return Promise.resolve(raw);
        const bytes = secret.src.isSealed(raw) ? secret.src.openBytes('assets', id, raw)
          : Promise.resolve().then(() => {
            if(typeof raw.data !== 'string' || raw.data.indexOf(JPEG_PREFIX) !== 0) throw fail('bad-asset');
            return Workhub.services.crypto.b64decode(raw.data.slice(JPEG_PREFIX.length));
          });
        return bytes.then((b) => secret.dst.sealBytes('assets', id, b)).then((sealed) => Object.assign({createdAt:raw.createdAt || Date.now()}, sealed),
          () => { skipped++; return null; });
      };
      const ops = [];   /* [ref, data] o [ref, función que devuelve los datos (o null para saltarlo)] */
      const step = (text) => { if(onProgress) onProgress(text); };
      /* En qué paso está, para decir cuál falló. */
      let phase = 'crear el equipo';
      let created = false;

      step('Creando el equipo…');
      return this.projects.createTeam(project.nombre, typeof project.color === 'number' ? project.color : null, config, tid).then(() => {
        created = true;
        if(!encrypted) return null;
        phase = 'guardar la clave del equipo';
        return db.teams.cryptoDoc(tid, db.me.uid).set(secret.crypto);
      }).then(() => {
        if(!vault) return null;
        phase = 'guardar la clave de las contraseñas';
        return dst.doc(TeamVault().CHECK).set(vault.check).then(() => dst.doc(TeamVault().keyPath(db.me.uid)).set(vault.key));
      }).then(() => {
        phase = 'leer los datos del proyecto';
        step('Leyendo los datos…');
        return Promise.all(COPY_COLLECTIONS.concat(vault ? ['vault'] : []).map((name) => src.collection(name).get().then((snap) => ({name:name, docs:snap.docs}))));
      }).then((groups) => {
        const assetIds = {};
        const notesJobs = [];
        groups.forEach((g) => g.docs.forEach((d) => {
          const data = d.data() || {};
          if(g.name === 'tasks'){
            /* Sin el cofre, las contraseñas vinculadas no viajan. */
            if(!vault) delete data.linkedVault;
            notesJobs.push(src.collection('tasks/' + d.id + '/notes').get().then((notes) => {
              notes.docs.forEach((n) => {
                const nd = n.data() || {};
                if(nd.imageAssetId) assetIds[nd.imageAssetId] = true;
                ops.push([dst.collection('tasks/' + d.id + '/notes').doc(n.id), () => recode('tasks/' + d.id + '/notes', n.id, nd)]);
              });
            }));
          }
          ops.push([dst.collection(g.name).doc(d.id), () => recode(g.name, d.id, data)]);
        }));
        return Promise.all(notesJobs).then(() => Object.keys(assetIds));
      }).then((assetIds) => {
        /* Las imágenes de las notas pasan a las del equipo, con el mismo id. */
        return Promise.all(assetIds.map((id) => db.collection('assets').doc(id).get().then((snap) => {
          if(snap.exists) ops.push([dst.collection('assets').doc(id), () => recodeAsset(id, snap.data() || {})]);
        }).catch(() => null)));
      }).then(() => {
        phase = 'copiar los datos al equipo';
        return runPool(ops, WRITE_CONCURRENCY, (op) => op[1]().then((data) => (data ? op[0].set(data) : null)), (n) => step('Copiando… ' + n + ' de ' + ops.length));
      }).then(() => ({id: PM.teamKey(tid), teamId: tid, skipped: skipped}), (err) => {
        /* A medias no sirve de nada: se deshace lo que se hubiera creado (también mi clave envuelta,
           que removeProject no ve si el equipo aún no ha llegado a la lista). */
        const undo = created
          ? (encrypted ? db.teams.cryptoDoc(tid, db.me.uid).delete().catch(() => null) : Promise.resolve())
            .then(() => this.projects.removeProject(PM.teamKey(tid), db, null)).catch(() => null)
          : Promise.resolve();
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
