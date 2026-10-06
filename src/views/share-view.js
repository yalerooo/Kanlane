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
      this.managedNote = $('shManagedNote');
      this.convertPassWrap = $('shConvertPassWrap');
      this.convertPass = $('shConvertPass');
      this.keyBox = $('shKeyPanel');
      this.invitePassWrap = $('shInvitePassWrap');
      this.invitePass = $('shInvitePass');
      this.codePanel = $('shCodePanel');
      this.code = $('shCode');
      /* Contraseñas compartidas (team-vault.js): la contraseña maestra para llevarse el cofre al
         convertir, y para dar acceso al invitar o a un miembro; el enlace se enseña una sola vez. */
      this.vaultNote = $('shVaultNote');
      this.vaultPassWrap = $('shVaultPassWrap');
      this.vaultPass = $('shVaultPass');
      this.masterWrap = $('shMasterPassWrap');
      this.master = $('shMasterPass');
      this.codeWrap = $('shCodeWrap');
      this.linkWrap = $('shLinkWrap');
      this.link = $('shLink');
      $('shLinkCopy').addEventListener('click', () => Workhub.utils.ui.copyWithFeedback($('shLinkCopy'), this.link.textContent));
      /* Tras quitar a alguien de un equipo cifrado: cambiar la clave para que la suya deje de servir. */
      this.rotateHint = $('shRotateHint');
      $('shRotate').addEventListener('click', () => this.handlers.rotate && this.handlers.rotate());
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
        if(this.handlers.invite) this.handlers.invite(email, this.role.value, this.invitePass.value, this.master.value);
      });
      this.email.addEventListener('input', () => { this.error.hidden = true; });
      /* «Cerrar» (y la X, que lo pulsa: ver ShellView.addDialogCloseButtons). */
      $('btnShareClose').addEventListener('click', () => this.close());
      this.btnConvert.addEventListener('click', () => {
        this.error.hidden = true;
        if(this.convertStep === 'key'){ if(this.key.isSaved() && this.handlers.convertConfirm) this.handlers.convertConfirm(); }
        else if(this.handlers.convert) this.handlers.convert(this.convertPass.value, this.vaultPass.value);
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
        else if(act === 'grant' && this.handlers.grant){ this.error.hidden = true; this.handlers.grant(b.getAttribute('data-uid'), this.master.value); }
        else if(act === 'revoke' && this.handlers.revoke) this.handlers.revoke(b.getAttribute('data-id'));
      };
      this.members.addEventListener('click', click);
      this.pending.addEventListener('click', click);
    }

    /* handlers: {invite(email, role, password, maestra), grant(uid, maestra), revoke(id), setRole(uid, role),
       remove(uid), leave(), convert(password, maestra), convertConfirm(), codeDone(), download(texto), rotate()} */
    bind(handlers){
      this.handlers = handlers;
    }

    isOpen(){ return this.dlg.open; }

    close(){ if(this.dlg.open) this.dlg.close(); }

    /* Nada de lo escrito o enseñado (contraseñas, clave, código) sobrevive al cierre del diálogo. */
    _resetSecrets(){
      this.convertPass.value = '';
      this.invitePass.value = '';
      this.vaultPass.value = '';
      this.master.value = '';
      this.key.clear();
      this.code.textContent = '';
      this.link.textContent = '';
      this.convertStep = 'start';
      this.codeOpen = false;
      this.codePanel.hidden = true;
      this.keyBox.hidden = true;
      this.rotateHint.hidden = true;
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
      /* Los gestionados por Kanlane todavía no se comparten: sin aviso de código ni contraseña. */
      const managed = Workhub.models.ProjectModel.isManaged(project);
      this.encNote.hidden = !isEncrypted(project) || managed;
      this.convertPassWrap.hidden = !isEncrypted(project) || managed;
      this.managedNote.hidden = !managed;
      this.setVaultMove(false);
      this.btnConvert.hidden = managed;
      this.teamEl.hidden = true;
      this.btnLeave.hidden = true;
      this.setBusy(false);
      this.progress.hidden = true;
      this.error.hidden = true;
      if(!this.dlg.open) this.dlg.showModal();
    }

    /* El proyecto personal tiene contraseñas guardadas: para llevarlas al equipo se pide la maestra. */
    setVaultMove(on){
      this.vaultNote.hidden = !on;
      this.vaultPassWrap.hidden = !on || this.convertStep === 'key';
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
      this.vaultPass.value = '';
      this.vaultPassWrap.hidden = true;
      this.keyBox.hidden = false;
      this.btnConvert.textContent = 'Crear el equipo';
      this.key.show(text);
      this.keyBox.scrollIntoView({block:'nearest'});
    }

    /* Lo que hay que darle a esa persona, y que solo se enseña una vez: el código de acceso de una
       invitación a un equipo cifrado y/o el enlace de acceso a las contraseñas del equipo. */
    showCode(email, code, link){
      this.codeOpen = true;
      this.invitePass.value = '';
      this.master.value = '';
      this.title.textContent = Workhub.t(code ? 'Código de acceso para {correo}' : 'Enlace de acceso para {correo}', {correo:email});
      this.lead.hidden = true;
      this.teamEl.hidden = true;
      this.btnLeave.hidden = true;
      this.code.textContent = code || '';
      this.codeWrap.hidden = !code;
      this.link.textContent = link || '';
      this.linkWrap.hidden = !link;
      this.codePanel.hidden = false;
    }

    hideCode(){
      this.codeOpen = false;
      this.code.textContent = '';
      this.link.textContent = '';
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

    showRotateHint(on){
      this.rotateHint.hidden = !on;
      if(on) this.rotateHint.scrollIntoView({block:'nearest'});
    }

    showError(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
      this.error.scrollIntoView({block:'nearest'});
    }

    /* Proyecto de equipo. s: {project, members, pending, isOwner, meUid, fps, vault}; fps = {uid: huella
       de su clave pública} en un equipo con cifrado total; vault: el equipo tiene contraseñas compartidas. */
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
      this.masterWrap.hidden = !s.isOwner || !s.vault;
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
      /* El propietario da acceso a las contraseñas a quien ya es miembro (con su contraseña maestra). */
      const grant = s.isOwner && s.vault && !you
        ? '<button type="button" class="icon-only" data-act="grant" data-uid="' + esc(m.uid) + '" title="' + esc(Workhub.t('Dar acceso a las contraseñas')) + '" aria-label="' + esc(Workhub.t('Dar acceso a las contraseñas a {name}', {name:m.name})) + '">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/></svg></button>'
        : '';
      return '<li class="member-row">' + T.avatar(m, 'is-sm') +
        '<span class="member-text"><span class="member-name" translate="no">' + esc(m.name) + (you ? ' <em>(' + esc(Workhub.t('tú')) + ')</em>' : '') + '</span>' +
        '<span class="member-mail" translate="no">' + esc(m.email) + '</span>' +
        (s.fps && s.fps[m.uid] ? '<span class="member-mail member-fp" title="' + esc(Workhub.t('Huella de su clave pública. Compárala con esa persona por otro canal antes de cambiar la clave del proyecto.')) + '">' +
          esc(Workhub.t('Huella')) + ' <span translate="no">' + esc(s.fps[m.uid]) + '</span></span>' : '') +
        '</span>' + role + grant + remove + '</li>';
    }
  }

  Workhub.views.ShareView = ShareView;
})();
