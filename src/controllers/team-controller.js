/* Compartir un proyecto: invitar, cambiar roles, quitar miembros, salir del
   equipo y convertir un proyecto personal en uno de equipo. Las invitaciones
   recibidas se aceptan desde el menú de proyectos (ver ProjectsController). */
(function(){
  const toast = Workhub.views.toast;

  /* Por qué falla una operación con Firestore, en cristiano. */
  function reason(err){
    const code = err && err.code;
    if(code === 'permission-denied') return ' ' + Workhub.t('Firestore ha rechazado la operación (permission-denied): comprueba que has publicado las reglas nuevas de firestore.rules (ver docs/EQUIPOS.md) y que tu correo está verificado.');
    if(code === 'unavailable' || code === 'deadline-exceeded') return ' ' + Workhub.t('Parece un problema de conexión; inténtalo de nuevo.');
    if(code === 'resource-exhausted') return ' ' + Workhub.t('Se ha superado la cuota de Firestore por hoy.');
    return code ? ' (' + code + ')' : '';
  }

  const ERRORS = {
    'bad-email': 'Escribe un correo válido.',
    'already-member': 'Esa persona ya está en el equipo.'
  };
  const P = Workhub.models.ProjectModel;
  const TeamVault = Workhub.models.TeamVault;
  const BAD_PASSWORD = 'Contraseña incorrecta.';
  /* Errores al abrir el cofre con la contraseña maestra (TeamVault). */
  const VAULT_ERRORS = {
    'bad-pass': 'Contraseña maestra incorrecta.',
    'totp': 'Tus contraseñas tienen la verificación en dos pasos activada. Desactívala en la sección Contraseñas para hacer esto y vuelve a activarla después.',
    'no-access': 'Todavía no tienes acceso a las contraseñas de este equipo.',
    'no-vault': 'Este equipo todavía no tiene contraseñas compartidas.',
    'needs-vault-pass': 'Escribe la contraseña maestra de las contraseñas de este proyecto.',
    'legacy': 'Las contraseñas de este proyecto tienen el formato antiguo. Abre la sección Contraseñas y desbloquéalas para actualizarlas antes de compartir el proyecto.'
  };
  const isBadPassword = (err) => Workhub.services.projectCrypto.isError(err, 'bad-password');

  class TeamController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.projects = app.models.projects;
      this.team = app.models.team;
      this.shareId = null;

      this.view.bind({
        invite: (email, role, password, master) => this.invite(email, role, password, master),
        grant: (uid, master) => this.grantVault(uid, master),
        revoke: (id) => this.run(this.team.revoke(id), 'No se pudo cancelar la invitación.'),
        setRole: (uid, role) => this.run(this.team.setRole(this.current(), uid, role), 'No se pudo cambiar el rol.'),
        remove: (uid) => this.removeMember(uid),
        leave: () => this.leave(),
        convert: (password, vaultPassword) => this.convert(password, vaultPassword),
        convertConfirm: () => this.convertConfirm(),
        codeDone: () => { this.view.hideCode(); this.refresh(); },
        download: (text) => { const p = this.current(); return this.app.controllers.crypto.download(text, p ? p.nombre : ''); },
        rotate: () => { const p = this.current(); this.view.close(); if(p) this.app.controllers.crypto.action('rotate', p.id); }
      });
      /* Huellas de las claves públicas de los miembros de un equipo cifrado: {uid: huella}. */
      this.fps = null;
      /* El equipo del diálogo tiene contraseñas compartidas. */
      this.hasVault = false;
      /* Conversión de un proyecto cifrado a la espera de que se confirme la clave de recuperación. */
      this.prepared = null;

      this.pendingOpen = null;
      /* Al cerrar el diálogo (Cerrar, X o Esc) se deja de escuchar las invitaciones enviadas. */
      this.view.dlg.addEventListener('close', () => { if(!this.view.isOpen()){ this.team.stopSent(); this.prepared = null; } });
      this.projects.on('change', () => this.refresh());
      this.team.sent.on('change', () => {
        /* Las invitaciones cifradas caducan a las 24 h: el propietario las retira al verlas. */
        if(this.team.sent.items.some((i) => Workhub.models.TeamModel.isExpired(i))) this.team.cleanExpired();
        this.refresh();
      });
    }

    enabled(){
      return this.team.enabled();
    }

    current(){
      return this.projects.get(this.shareId);
    }

    /* Abre el diálogo de compartir de un proyecto (por defecto, el abierto). */
    open(id){
      if(!this.enabled()) return;
      const p = this.projects.get(id || this.app.projectId);
      if(!p) return;
      this.shareId = p.id;
      this.fps = null;
      this.hasVault = false;
      this.team.stopSent();
      if(p.team && P.isEncrypted(p)) this.loadFingerprints(p.id);
      if(p.team){
        if(p.role === 'owner') this.team.watchSent(p.teamId);
        this.view.openTeam(this.state(p));
      } else {
        this.view.openPersonal(p);
      }
      this.loadVault(p);
    }

    get rootDb(){
      return this.projects.rootDb;
    }

    /* Equipo: ¿tiene contraseñas compartidas? Personal: ¿tiene contraseñas que llevarse al equipo? */
    loadVault(p){
      const id = p.id;
      const src = P.scope(this.rootDb, id);
      const has = p.team ? TeamVault.exists(this.rootDb, p.teamId)
        : Promise.all([src.doc(TeamVault.CHECK).get(), src.collection('vault').get()]).then((s) => s[0].exists && s[1].docs.length > 0);
      has.then((on) => {
        if(this.shareId !== id || !this.view.isOpen()) return;
        if(p.team){ this.hasVault = !!on; this.refresh(); }
        else this.view.setVaultMove(!!on);
      }, () => {});
    }

    loadFingerprints(id){
      const rotation = this.app.controllers.rotation;
      if(!rotation) return;
      rotation.pubkeys(id).then((keys) => {
        if(this.shareId !== id) return;
        this.fps = {};
        Object.keys(keys).forEach((uid) => { this.fps[uid] = keys[uid].fp; });
        this.refresh();
      }, () => {});
    }

    state(p){
      return {
        project: p,
        members: this.projects.membersOf(p),
        pending: p.role === 'owner' ? this.team.sent.items.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [],
        isOwner: p.role === 'owner',
        fps: this.fps,
        vault: this.hasVault,
        meUid: this.app.models.projects.rootDb.me.uid
      };
    }

    /* Los miembros o las invitaciones cambiaron mientras el diálogo estaba abierto. */
    refresh(){
      /* Tras convertir un proyecto, se abre para invitar en cuanto llega a la lista. */
      if(this.pendingOpen && this.projects.get(this.pendingOpen)){
        const id = this.pendingOpen;
        this.pendingOpen = null;
        this.open(id);
        return;
      }
      /* Con el código de acceso en pantalla no se repinta nada: solo se enseña una vez. */
      if(!this.view.isOpen() || this.view.codeOpen) return;
      const p = this.current();
      if(!p){ this.view.close(); return; }
      if(p.team) this.view.render(this.state(p));
    }

    /* Ejecuta una operación con el diálogo bloqueado y muestra el error si falla. */
    run(promise, failText){
      this.view.setBusy(true);
      return promise.then(() => true, (err) => {
        this.view.showError(failText || 'No se pudo completar la acción.');
        return false;
      }).then((ok) => {
        this.view.setBusy(false);
        return ok;
      });
    }

    /* password: la contraseña de cifrado de quien invita, solo en equipos con cifrado total.
       master: mi contraseña maestra, si además se le da acceso a las contraseñas del equipo. */
    invite(email, role, password, master){
      const p = this.current();
      if(!p) return;
      const encrypted = P.isEncrypted(p);
      const tid = p.teamId;
      const to = String(email || '').trim().toLowerCase();
      let promise;
      try{
        this.team.checkInvite(p, email, role);
        if(encrypted && !password) throw new Error('no-password');
        /* La contraseña maestra se comprueba antes de invitar: si es mala, no se envía nada. */
        promise = (master && this.hasVault ? TeamVault.unlock(this.rootDb, tid, master) : Promise.resolve(null)).then((opened) => {
          /* Equipo cifrado: código de acceso nuevo y la clave del proyecto envuelta con él. */
          const sent = encrypted
            ? this.app.controllers.teamCrypto.prepareInvite(p, password).then((made) => this.team.invite(p, email, role, made.secret).then(() => made.code))
            : this.team.invite(p, email, role).then(() => '');
          return sent.then((code) => {
            if(!opened) return {code:code, link:''};
            return TeamVault.grant(this.rootDb, tid, to, opened).then((vc) => ({code:code, link:TeamVault.linkFor(tid, vc)}), () => {
              toast.error(Workhub.t('La invitación se ha enviado, pero no se pudo crear el enlace de las contraseñas. Dale acceso cuando entre, desde la lista de miembros.'));
              return {code:code, link:''};
            });
          });
        });
      }catch(e){ promise = Promise.reject(e); }
      this.view.setBusy(true);
      promise.then((res) => {
        this.view.email.value = '';
        toast.success(Workhub.t('Invitación enviada a {email}', {email:to}), {important:true});
        if(res.code || res.link) this.view.showCode(to, res.code, res.link);
      }, (err) => {
        this.view.showError(ERRORS[err && err.message] || VAULT_ERRORS[err && err.code] || (err && err.message === 'no-password' ? 'Escribe tu contraseña de cifrado.'
          : isBadPassword(err) ? BAD_PASSWORD : 'No se pudo enviar la invitación. Inténtalo de nuevo.'));
      }).then(() => this.view.setBusy(false));
    }

    /* Enlace de acceso a las contraseñas para alguien que ya es miembro (no lo recibió al entrar, lo
       dejó caducar o perdió su contraseña maestra y su clave de recuperación). */
    grantVault(uid, master){
      const p = this.current();
      const m = p && this.projects.membersOf(p).find((x) => x.uid === uid);
      if(!m || !m.email) return;
      if(!master){ this.view.showError('Escribe tu contraseña maestra para dar acceso a las contraseñas.'); return; }
      const tid = p.teamId;
      this.view.setBusy(true);
      TeamVault.unlock(this.rootDb, tid, master).then((opened) => TeamVault.grant(this.rootDb, tid, m.email, opened)).then((code) => {
        this.view.showCode(m.email, '', TeamVault.linkFor(tid, code));
      }, (err) => {
        this.view.showError(VAULT_ERRORS[err && err.code] || 'No se pudo crear el enlace de acceso. Inténtalo de nuevo.');
      }).then(() => this.view.setBusy(false));
    }

    removeMember(uid){
      const p = this.current();
      const m = p && this.projects.membersOf(p).find((x) => x.uid === uid);
      if(!m) return;
      const text = P.isEncrypted(p)
        ? Workhub.t('{nombre} dejará de poder abrir el proyecto, pero lo que ya haya visto o descargado no se le puede quitar. Después conviene cambiar la clave del proyecto para que la que tenía deje de servir.', {nombre:m.name})
        : Workhub.t('«{name}» dejará de ver este proyecto.', {name:m.name});
      const vaultText = this.hasVault ? ' ' + Workhub.t('Si tenía acceso a las contraseñas, pudo copiarlas: conviene cambiar las más importantes.') : '';
      this.confirm(Workhub.t('Quitar del equipo'), text + vaultText, Workhub.t('Quitar'))
        .then((ok) => {
          if(!ok) return;
          this.run(this.team.removeMember(p, uid), 'No se pudo quitar a esa persona.').then((done) => {
            if(done && P.isEncrypted(p) && this.view.isOpen()) this.view.showRotateHint(true);
          });
        });
    }

    leave(){
      const p = this.current();
      if(!p) return;
      this.confirm(Workhub.t('Salir del equipo'), Workhub.t('Dejarás de ver «{name}». Para volver a entrar te tendrán que invitar otra vez.', {name:p.nombre}), Workhub.t('Salir'))
        .then((ok) => {
          if(!ok) return;
          this.view.setBusy(true);
          /* Antes de salir se pasa a otro proyecto, o se dejaría de tener acceso al abierto. */
          const next = this.projects.list().find((x) => x.id !== p.id);
          if(this.app.projectId === p.id && next) this.app.switchProject(next.id);
          this.team.leave(p).then(() => {
            this.view.close();
            toast.success(Workhub.t('Has salido de «{name}»', {name:p.nombre}));
          }, () => {
            this.view.setBusy(false);
            this.view.showError('No se pudo salir del equipo.');
          });
        });
    }

    confirm(title, text, label){
      return this.app.controllers.tasks.columns.confirm(title, text, label);
    }

    /* Proyecto personal → equipo. El proyecto se MUEVE: se crea el equipo con todo lo que tiene y,
       si todo llegó, el personal se elimina (no quedan dos proyectos con el mismo nombre).
       Si tiene contraseñas guardadas se pide la contraseña maestra (vaultPassword) y el cofre pasa
       al equipo. Con cifrado total (10.2) se comprueba además la contraseña del proyecto y se enseña
       la clave de recuperación del equipo; la copia empieza al confirmarla (convertConfirm). */
    convert(password, vaultPassword){
      const p = this.current();
      if(!p || p.team) return;
      if(P.isManaged(p)){ this.view.showError('Los proyectos gestionados por Kanlane todavía no se pueden compartir.'); return; }
      const encrypted = P.isEncrypted(p);
      if(encrypted){
        if(this.app.projectId !== p.id || !this.app.cipher){ this.view.showError('Abre y desbloquea este proyecto para poder compartirlo.'); return; }
        if(!password){ this.view.showError('Escribe la contraseña de cifrado del proyecto.'); return; }
      }
      this.view.setBusy(true);
      /* Antes de crear nada: la contraseña maestra abre el cofre (o no hay nada que llevarse). */
      TeamVault.prepareMove(P.scope(this.rootDb, p.id), this.rootDb.me.uid, vaultPassword).then((vault) => {
        if(!encrypted){ this.runConvert(p, null, vault); return null; }
        return this.app.controllers.teamCrypto.prepareConvert(p, password).then((prepared) => {
          if(this.current() !== p && this.shareId !== p.id) return;
          prepared.vault = vault;
          this.prepared = prepared;
          this.view.showConvertKey(prepared.recovery);
          this.view.setBusy(false);
        });
      }).catch((err) => {
        this.view.setBusy(false);
        this.view.showError(VAULT_ERRORS[err && err.code] || (isBadPassword(err) ? BAD_PASSWORD : 'No se pudo comprobar la contraseña. Comprueba la conexión e inténtalo de nuevo.'));
      });
    }

    convertConfirm(){
      const p = this.current();
      const prepared = this.prepared;
      if(!p || p.team || !prepared) return;
      this.prepared = null;
      this.runConvert(p, prepared, prepared.vault);
    }

    /* El proyecto personal ya está entero en el equipo: se elimina. Sus imágenes son las de la
       cuenta, sea cual sea el proyecto abierto ahora (las del equipo tienen el mismo id). */
    removeOriginal(p){
      const rootDb = this.rootDb;
      const assets = {delete:(id) => rootDb.collection('assets').doc(id).delete()};
      return this.projects.removeProject(p.id, rootDb, assets).then(() => {
        toast.success(Workhub.t('«{name}» ya es un proyecto de equipo.', {name:p.nombre}), {important:true});
      }, () => {
        toast.error(Workhub.t('«{name}» ya es un proyecto de equipo, pero no se pudo eliminar el proyecto personal original. Elimínalo desde el menú de proyectos.', {name:p.nombre}));
      });
    }

    /* prepared: lo que devuelve TeamCryptoController.prepareConvert (null en un proyecto sin cifrar).
       vault: lo que devuelve TeamVault.prepareMove (null si no hay contraseñas que llevarse). */
    runConvert(p, prepared, vault){
      const tc = this.app.controllers.teamCrypto;
      this.view.setBusy(true);
      this.view.setProgress('Preparando…');
      /* La clave del equipo va a este navegador antes de crearlo: así se abre sin pedir la contraseña. */
      (prepared ? tc.keepConverted(prepared) : Promise.resolve()).then(() =>
        this.team.convert(p, (text) => this.view.setProgress(text), prepared ? prepared.secret : null, vault)
      ).then((t) => {
        this.view.setProgress('');
        this.view.close();
        const pc = this.app.controllers.projects;
        pc.justCreated = t.id;
        this.app.rememberProject({id:t.id, nombre:p.nombre, color:p.color, tipo:p.tipo, stages:p.stages, clients:p.clients, labels:p.labels, enc:prepared ? true : undefined});
        this.app.switchProject(t.id);
        if(t.skipped){
          /* Algo no se pudo leer: el original se queda, para no perderlo. El enlace con GitHub pasa
             al equipo y el original deja de sincronizar el mismo tablero. */
          if(p.github) this.projects.patch(p.id, {github:null}).catch(() => {});
          toast.error(Workhub.t('{n} elementos no se pudieron descifrar y no se han copiado al equipo. El proyecto personal se conserva para que no los pierdas.', {n:t.skipped}));
        } else {
          this.removeOriginal(p);
        }
        this.pendingOpen = t.id;
        this.refresh();
      }).catch((err) => {
        if(prepared) tc.dropConverted(prepared);
        this.view.setBusy(false);
        this.view.setProgress('');
        const where = err && err.phase ? ' ' + Workhub.t('Falló al {phase}.', {phase:Workhub.t(err.phase)}) : '';
        this.view.showError(Workhub.t('No se pudo crear el proyecto de equipo.') + where + reason(err));
      });
    }
  }

  Workhub.controllers.TeamController = TeamController;
})();
