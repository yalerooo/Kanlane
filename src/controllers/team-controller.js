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

  class TeamController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.projects = app.models.projects;
      this.team = app.models.team;
      this.shareId = null;

      this.view.bind({
        invite: (email, role) => this.invite(email, role),
        revoke: (id) => this.run(this.team.revoke(id), 'No se pudo cancelar la invitación.'),
        setRole: (uid, role) => this.run(this.team.setRole(this.current(), uid, role), 'No se pudo cambiar el rol.'),
        remove: (uid) => this.removeMember(uid),
        leave: () => this.leave(),
        convert: () => this.convert()
      });

      this.pendingOpen = null;
      /* Al cerrar el diálogo (Cerrar, X o Esc) se deja de escuchar las invitaciones enviadas. */
      this.view.dlg.addEventListener('close', () => { if(!this.view.isOpen()) this.team.stopSent(); });
      this.projects.on('change', () => this.refresh());
      this.team.sent.on('change', () => this.refresh());
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
      this.team.stopSent();
      if(p.team){
        if(p.role === 'owner') this.team.watchSent(p.teamId);
        this.view.openTeam(this.state(p));
      } else {
        this.view.openPersonal(p);
      }
    }

    state(p){
      return {
        project: p,
        members: this.projects.membersOf(p),
        pending: p.role === 'owner' ? this.team.sent.items.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [],
        isOwner: p.role === 'owner',
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
      if(!this.view.isOpen()) return;
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

    invite(email, role){
      const p = this.current();
      if(!p) return;
      let promise;
      try{ promise = this.team.invite(p, email, role); }catch(e){ promise = Promise.reject(e); }
      this.view.setBusy(true);
      promise.then(() => {
        this.view.email.value = '';
        toast.success(Workhub.t('Invitación enviada a {email}', {email:email.toLowerCase()}));
      }, (err) => {
        this.view.showError(ERRORS[err && err.message] || 'No se pudo enviar la invitación. Inténtalo de nuevo.');
      }).then(() => this.view.setBusy(false));
    }

    removeMember(uid){
      const p = this.current();
      const m = p && this.projects.membersOf(p).find((x) => x.uid === uid);
      if(!m) return;
      this.confirm(Workhub.t('Quitar del equipo'), Workhub.t('«{name}» dejará de ver este proyecto.', {name:m.name}), Workhub.t('Quitar'))
        .then((ok) => { if(ok) this.run(this.team.removeMember(p, uid), 'No se pudo quitar a esa persona.'); });
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
          if(this.app.projectId === p.id && next) this.app.switchProject(next.id, false);
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

    /* Proyecto personal → equipo. Crea una copia compartida y la abre. */
    convert(){
      const p = this.current();
      if(!p || p.team) return;
      this.view.setBusy(true);
      this.view.setProgress('Preparando…');
      this.team.convert(p, (text) => this.view.setProgress(text)).then((t) => {
        this.view.setProgress('');
        this.view.close();
        const pc = this.app.controllers.projects;
        pc.justCreated = t.id;
        /* El enlace con GitHub pasa al equipo: el original deja de sincronizar el mismo tablero. */
        if(p.github) this.projects.patch(p.id, {github:null}).catch(() => {});
        this.app.rememberProject({id:t.id, nombre:p.nombre, color:p.color, tipo:p.tipo, stages:p.stages, clients:p.clients, labels:p.labels});
        this.app.switchProject(t.id, false);
        toast.success(Workhub.t('«{name}» ya es un proyecto de equipo. El original sigue como estaba.', {name:p.nombre}));
        this.pendingOpen = t.id;
        this.refresh();
      }).catch((err) => {
        this.view.setBusy(false);
        this.view.setProgress('');
        const where = err && err.phase ? ' ' + Workhub.t('Falló al {phase}.', {phase:Workhub.t(err.phase)}) : '';
        this.view.showError(Workhub.t('No se pudo crear el proyecto de equipo.') + where + reason(err));
      });
    }
  }

  Workhub.controllers.TeamController = TeamController;
})();
