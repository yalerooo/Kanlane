/* Diálogo «Compartir»: en un proyecto personal ofrece convertirlo en uno de
   equipo; en uno de equipo muestra los miembros con su rol, deja invitar por
   correo (solo al propietario) y salir del equipo (al resto). */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const T = Workhub.views.team;
  const $ = (id) => document.getElementById(id);


  class ShareView {
    constructor(){
      this.dlg = $('dlgShare');
      this.title = $('shTitle');
      this.lead = $('shLead');
      this.personal = $('shPersonal');
      this.teamEl = $('shTeam');
      this.members = $('shMembers');
      this.inviteForm = $('shInviteForm');
      this.email = $('shEmail');
      this.role = $('shRole');
      this.inviteBtn = $('shInviteBtn');
      this.pendingWrap = $('shPendingWrap');
      this.pending = $('shPending');
      this.error = $('shError');
      this.progress = $('shProgress');
      this.btnConvert = $('shConvert');
      this.btnLeave = $('shLeave');
      this.handlers = {};

      this.inviteForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.error.hidden = true;
        const email = this.email.value.trim();
        if(!email){ this.email.focus(); return; }
        if(this.handlers.invite) this.handlers.invite(email, this.role.value);
      });
      this.email.addEventListener('input', () => { this.error.hidden = true; });
      this.btnConvert.addEventListener('click', () => this.handlers.convert && this.handlers.convert());
      this.btnLeave.addEventListener('click', () => this.handlers.leave && this.handlers.leave());
      this.members.addEventListener('change', (ev) => {
        if(ev.target.matches('select[data-uid]') && this.handlers.setRole) this.handlers.setRole(ev.target.getAttribute('data-uid'), ev.target.value);
      });
      const click = (ev) => {
        const b = closest(ev.target, 'button[data-act]');
        if(!b || b.disabled) return;
        const act = b.getAttribute('data-act');
        if(act === 'remove' && this.handlers.remove) this.handlers.remove(b.getAttribute('data-uid'));
        else if(act === 'revoke' && this.handlers.revoke) this.handlers.revoke(b.getAttribute('data-id'));
      };
      this.members.addEventListener('click', click);
      this.pending.addEventListener('click', click);
    }

    /* handlers: {invite(email, role), revoke(id), setRole(uid, role), remove(uid), leave(), convert()} */
    bind(handlers){
      this.handlers = handlers;
    }

    isOpen(){ return this.dlg.open; }

    close(){ if(this.dlg.open) this.dlg.close(); }

    /* Proyecto personal: convertirlo en equipo. */
    openPersonal(project){
      this.title.textContent = Workhub.t('Compartir «{name}»', {name:project.nombre});
      this.lead.textContent = 'Este proyecto es personal, solo tú lo ves. Para trabajar con otras personas y repartir tareas hay que convertirlo en un proyecto de equipo.';
      this.personal.hidden = false;
      this.teamEl.hidden = true;
      this.btnLeave.hidden = true;
      this.setBusy(false);
      this.progress.hidden = true;
      this.error.hidden = true;
      if(!this.dlg.open) this.dlg.showModal();
    }

    setProgress(text){
      this.progress.hidden = !text;
      this.progress.textContent = text || '';
    }

    setBusy(busy){
      this.btnConvert.disabled = busy;
      this.inviteBtn.disabled = busy;
      this.btnLeave.disabled = busy;
      this.dlg.querySelectorAll('.member-list button, .member-list select').forEach((el) => { el.disabled = busy; });
    }

    showError(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
      this.error.scrollIntoView({block:'nearest'});
    }

    /* Proyecto de equipo. s: {project, members, pending, isOwner, meUid} */
    openTeam(s){
      this.personal.hidden = true;
      this.teamEl.hidden = false;
      this.error.hidden = true;
      this.progress.hidden = true;
      this.render(s);
      /* Sin restos de una operación anterior (p. ej. una conversión que acaba de terminar). */
      this.setBusy(false);
      if(!this.dlg.open) this.dlg.showModal();
    }

    render(s){
      const p = s.project;
      this.title.textContent = Workhub.t('Compartir «{name}»', {name:p.nombre});
      this.lead.textContent = s.isOwner
        ? 'Invita a otras personas por su correo. Cuando acepten podrás asignarles tareas. Editor: crea y modifica tareas y datos. Lector: solo puede verlos.'
        : (p.role === 'editor'
          ? 'Eres editor de este proyecto. Solo el propietario puede invitar o cambiar roles.'
          : 'Eres lector de este proyecto. Solo el propietario puede invitar o cambiar roles.');
      this.inviteForm.hidden = !s.isOwner;
      this.members.innerHTML = s.members.map((m) => this._member(m, s)).join('');
      this.pendingWrap.hidden = !s.isOwner || !s.pending.length;
      this.pending.innerHTML = s.pending.map((i) =>
        '<li class="member-row is-pending"><span class="member-text"><span class="member-name" translate="no">' + esc(i.email) + '</span>' +
        '<span class="member-mail">' + esc(Workhub.t(T.roleLabel(i.role))) + ' · ' + esc(Workhub.t('pendiente')) + '</span></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="revoke" data-id="' + esc(i.id) + '">' + esc(Workhub.t('Cancelar invitación')) + '</button></li>'
      ).join('');
      this.btnLeave.hidden = s.isOwner;
    }

    _member(m, s){
      const you = m.uid === s.meUid;
      let role;
      if(m.role === 'owner' || !s.isOwner){
        role = '<span class="member-role-text">' + esc(Workhub.t(T.roleLabel(m.role))) + '</span>';
      } else {
        role = '<select class="member-role" data-uid="' + esc(m.uid) + '" aria-label="' + esc(Workhub.t('Rol de {name}', {name:m.name})) + '">' +
          '<option value="editor"' + (m.role === 'editor' ? ' selected' : '') + '>' + esc(Workhub.t('Editor')) + '</option>' +
          '<option value="viewer"' + (m.role === 'viewer' ? ' selected' : '') + '>' + esc(Workhub.t('Lector')) + '</option></select>';
      }
      const remove = s.isOwner && m.role !== 'owner'
        ? '<button type="button" class="icon-only" data-act="remove" data-uid="' + esc(m.uid) + '" title="' + esc(Workhub.t('Quitar del equipo')) + '" aria-label="' + esc(Workhub.t('Quitar a {name} del equipo', {name:m.name})) + '">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>'
        : '';
      return '<li class="member-row">' + T.avatar(m, 'is-sm') +
        '<span class="member-text"><span class="member-name" translate="no">' + esc(m.name) + (you ? ' <em>(' + esc(Workhub.t('tú')) + ')</em>' : '') + '</span>' +
        '<span class="member-mail" translate="no">' + esc(m.email) + '</span></span>' + role + remove + '</li>';
    }
  }

  Workhub.views.ShareView = ShareView;
})();
