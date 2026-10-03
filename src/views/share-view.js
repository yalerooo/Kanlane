/* Diálogo «Compartir»: en un proyecto personal ofrece convertirlo en uno de
   equipo; en uno de equipo muestra los miembros con su rol, deja invitar por
   correo (solo al propietario) y salir del equipo (al resto). */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const T = Workhub.views.team;
  const $ = (id) => document.getElementById(id);
  const isEncrypted = (p) => Workhub.models.ProjectModel.isEncrypted(p);


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
      this.githubNote = $('shGithubNote');
      this.btnLeave = $('shLeave');
      /* Proyectos con cifrado total (docs/CIFRADO-PROYECTOS.md, 8.5). */
      this.encNote = $('shEncNote');
      this.convertPassWrap = $('shConvertPassWrap');
      this.convertPass = $('shConvertPass');
      this.keyBox = $('shKeyPanel');
      this.invitePassWrap = $('shInvitePassWrap');
      this.invitePass = $('shInvitePass');
      this.codePanel = $('shCodePanel');
      this.code = $('shCode');
      /* Al convertir un proyecto cifrado: 'start' (pide la contraseña) o 'key' (clave de recuperación del equipo). */
      this.convertStep = 'start';
      this.codeOpen = false;
      this.handlers = {};
      this.key = Workhub.views.shared.privacy.keyPanel({box:$('shKey'), copy:$('shKeyCopy'), download:$('shKeyDownload'), saved:$('shKeySaved')},
        (text) => this.handlers.download && this.handlers.download(text),
        (on) => { if(this.convertStep === 'key') this.btnConvert.disabled = !on; });
      $('shCodeCopy').addEventListener('click', () => Workhub.utils.ui.copyWithFeedback($('shCodeCopy'), this.code.textContent));
      $('shCodeDone').addEventListener('click', () => this.handlers.codeDone && this.handlers.codeDone());
      this.dlg.addEventListener('close', () => this._resetSecrets());

      this.inviteForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.error.hidden = true;
        const email = this.email.value.trim();
        if(!email){ this.email.focus(); return; }
        if(this.handlers.invite) this.handlers.invite(email, this.role.value, this.invitePass.value);
      });
      this.email.addEventListener('input', () => { this.error.hidden = true; });
      /* «Cerrar» (y la X, que lo pulsa: ver ShellView.addDialogCloseButtons). */
      $('btnShareClose').addEventListener('click', () => this.close());
      this.btnConvert.addEventListener('click', () => {
        this.error.hidden = true;
        if(this.convertStep === 'key'){ if(this.key.isSaved() && this.handlers.convertConfirm) this.handlers.convertConfirm(); }
        else if(this.handlers.convert) this.handlers.convert(this.convertPass.value);
      });
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

    /* handlers: {invite(email, role, password), revoke(id), setRole(uid, role), remove(uid), leave(),
       convert(password), convertConfirm(), codeDone(), download(texto)} */
    bind(handlers){
      this.handlers = handlers;
    }

    isOpen(){ return this.dlg.open; }

    close(){ if(this.dlg.open) this.dlg.close(); }

    /* Nada de lo escrito o enseñado (contraseñas, clave, código) sobrevive al cierre del diálogo. */
    _resetSecrets(){
      this.convertPass.value = '';
      this.invitePass.value = '';
      this.key.clear();
      this.code.textContent = '';
      this.convertStep = 'start';
      this.codeOpen = false;
      this.codePanel.hidden = true;
      this.keyBox.hidden = true;
      this.lead.hidden = false;
      this.btnConvert.textContent = 'Convertir en proyecto de equipo';
    }

    /* Proyecto personal: convertirlo en equipo. */
    openPersonal(project){
      this.title.textContent = Workhub.t('Compartir «{name}»', {name:project.nombre});
      this.lead.textContent = 'Este proyecto es personal, solo tú lo ves. Para trabajar con otras personas y repartir tareas hay que convertirlo en un proyecto de equipo.';
      this._resetSecrets();
      this.personal.hidden = false;
      this.githubNote.hidden = !project.github;
      this.encNote.hidden = !isEncrypted(project);
      this.convertPassWrap.hidden = !isEncrypted(project);
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

    /* Convertir un proyecto cifrado: la contraseña es buena y se enseña la clave de recuperación del
       equipo; hasta marcar la casilla no se crea nada. */
    showConvertKey(text){
      this.convertStep = 'key';
      this.convertPass.value = '';
      this.convertPassWrap.hidden = true;
      this.keyBox.hidden = false;
      this.btnConvert.textContent = 'Crear el equipo';
      this.key.show(text);
      this.keyBox.scrollIntoView({block:'nearest'});
    }

    /* Código de acceso de una invitación a un equipo cifrado: se enseña una sola vez. */
    showCode(email, code){
      this.codeOpen = true;
      this.invitePass.value = '';
      this.title.textContent = Workhub.t('Código de acceso para {correo}', {correo:email});
      this.lead.hidden = true;
      this.teamEl.hidden = true;
      this.btnLeave.hidden = true;
      this.code.textContent = code;
      this.codePanel.hidden = false;
    }

    hideCode(){
      this.codeOpen = false;
      this.code.textContent = '';
      this.codePanel.hidden = true;
      this.lead.hidden = false;
      this.teamEl.hidden = false;
    }

    setBusy(busy){
      this.btnConvert.disabled = busy || (this.convertStep === 'key' && !this.key.isSaved());
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
      this._resetSecrets();
      this.lead.hidden = false;
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
      this.invitePassWrap.hidden = !isEncrypted(p);
      this.members.innerHTML = s.members.map((m) => this._member(m, s)).join('');
      this.pendingWrap.hidden = !s.isOwner || !s.pending.length;
      this.pending.innerHTML = s.pending.map((i) =>
        '<li class="member-row is-pending"><span class="member-text"><span class="member-name" translate="no">' + esc(i.email) +
        (i.enc ? '<span class="enc-badge">' + esc(Workhub.t('Cifrado')) + '</span>' : '') + '</span>' +
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
