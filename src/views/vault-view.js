/* Contraseñas: pantalla de bloqueo, recuperación, rejilla de credenciales,
   ficha de solo lectura y formulario de edición. */
(function(){
  const {esc, iconSpan, closest} = Workhub.utils.html;
  const clientColors = Workhub.views.clientColors;
  const {copyWithFeedback, flashLabel, showMessage, bindDragAndDrop, consumeDragClick} = Workhub.utils.ui;
  const VaultModel = Workhub.models.VaultModel;
  const $ = (id) => document.getElementById(id);

  const LOCK_TEXT = {
    none: {
      title: 'Crea tu contraseña maestra',
      desc: 'Es la primera vez que entras aquí. Elige una contraseña maestra segura: cifrará todas las contraseñas de este tablero. Al terminar te daremos una clave de recuperación — guárdala bien, es la única forma de recuperar el acceso si olvidas la contraseña.',
      button: 'Crear y desbloquear'
    },
    legacy: {
      title: 'Desbloquear contraseñas',
      desc: 'Introduce tu contraseña maestra actual. Al entrar se activará automáticamente tu clave de recuperación (este tablero aún no tenía una).',
      button: 'Desbloquear y actualizar'
    },
    current: {
      title: 'Desbloquear contraseñas',
      desc: 'Introduce tu contraseña maestra. Se usa solo en tu navegador para cifrar y descifrar — nunca se guarda ni se envía a ningún sitio.',
      button: 'Desbloquear'
    }
  };

  /* Campos del formulario que se muestran según el tipo de credencial. */
  const TYPE_SECTIONS = {
    correo: 'camposCorreo',
    usuario: 'camposUsuario',
    servidor: 'camposServidor',
    rdp: 'camposRdp',
    vpn: 'camposVpn'
  };

  class VaultView {
    constructor(){
      /* Bloqueo */
      this.lockScreen = $('vaultLockScreen');
      this.lockTitle = $('lockTitle');
      this.lockDesc = $('lockDesc');
      this.lockError = $('lockError');
      this.unlockForm = $('unlockForm');
      this.masterPass = $('masterPass');
      this.masterPass2Wrap = $('masterPass2Wrap');
      this.masterPass2 = $('masterPass2');
      this.btnUnlock = $('btnUnlock');
      this.forgotLinkWrap = $('forgotLinkWrap');
      this.linkForgot = $('linkForgot');

      /* Recuperación */
      this.recoverForm = $('recoverForm');
      this.recoveryInput = $('recoveryInput');
      this.newPass1 = $('newPass1');
      this.newPass2 = $('newPass2');
      this.recoverError = $('recoverError');
      this.btnRecover = $('btnRecover');
      this.linkCancelRecover = $('linkCancelRecover');

      /* Nueva clave de recuperación */
      this.recoveryReveal = $('recoveryReveal');
      this.recoveryKeyBox = $('recoveryKeyBox');
      this.btnCopyRecovery = $('btnCopyRecovery');
      this.btnDownloadRecovery = $('btnDownloadRecovery');
      this.recoveryConfirmChk = $('recoveryConfirmChk');
      this.btnRecoveryContinue = $('btnRecoveryContinue');

      /* Contenido */
      this.content = $('vaultContent');
      this.search = $('searchVault');
      this.filterTipo = $('filterTipo');
      this.filterCliente = $('filterClienteVault');
      this.btnNew = $('btnNewVault');
      this.btnLock = $('btnLock');
      this.grid = $('vaultGrid');
      this.stateMsg = $('stateMsgVault');

      /* Formulario */
      this.dlg = $('dlgVault');
      this.form = $('formVault');
      this.formTitle = $('dlgVaultTitle');
      this.formError = $('vaultFormError');
      this.btnCancel = $('btnCancelVault');
      this.btnDelete = $('btnDeleteVault');
      this.tipo = $('vTipo');
      this.cliente = new Workhub.views.ClientSelect('v');
      this.f = {};
      ['vId', 'vLabel', 'vCorreo', 'vWeb', 'vUserUsuario', 'vUserWeb', 'vIp', 'vUsuario',
        'vRdpHost', 'vRdpPuerto', 'vRdpUsuario', 'vRdpDominio', 'vVpnUsuario', 'vPass', 'vNotas']
        .forEach((id) => { this.f[id] = $(id); });

      /* Ficha */
      this.viewDlg = $('dlgVaultView');
      this.vvCliente = $('vvCliente');
      this.vvTipo = $('vvTipo');
      this.vvTitle = $('vvTitle');
      this.vvFields = $('vvFields');
      this.vvPassValue = $('vvPassValue');
      this.btnVvToggle = $('btnVvToggle');
      this.btnVvCopy = $('btnVvCopy');
      this.vvNotasWrap = $('vvNotasWrap');
      this.vvNotas = $('vvNotas');
      this.btnVvClose = $('btnVvClose');
      this.btnVvEdit = $('btnVvEdit');

      this._bindLocalUi();
    }

    _bindLocalUi(){
      this.linkForgot.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.showRecoverForm();
      });
      this.linkCancelRecover.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.recoverForm.hidden = true;
        this.unlockForm.hidden = false;
        this.forgotLinkWrap.hidden = false;
      });
      this.recoveryConfirmChk.addEventListener('change', () => {
        this.btnRecoveryContinue.disabled = !this.recoveryConfirmChk.checked;
      });
      this.tipo.addEventListener('change', () => this._toggleTypeFields());
      this.btnCancel.addEventListener('click', () => this.dlg.close());
      this.btnVvClose.addEventListener('click', () => this.viewDlg.close());
    }

    /* ---------- Pantallas ---------- */

    /* screen: 'lock' | 'recovery' | 'content' */
    showScreen(screen){
      this.lockScreen.hidden = screen !== 'lock';
      this.recoveryReveal.hidden = screen !== 'recovery';
      this.content.hidden = screen !== 'content';
    }

    showCryptoUnavailable(){
      this.lockTitle.textContent = 'Cifrado no disponible';
      this.lockDesc.textContent = 'Este navegador no admite cifrado (Web Crypto). Prueba con una versión reciente de Chrome, Edge o Safari.';
      this.unlockForm.hidden = true;
      this.forgotLinkWrap.hidden = true;
    }

    setLockMode(state){
      this.lockMode = state;
      const text = LOCK_TEXT[state] || LOCK_TEXT.current;
      this.recoverForm.hidden = true;
      this.unlockForm.hidden = false;
      this.lockTitle.textContent = text.title;
      this.lockDesc.textContent = text.desc;
      this.masterPass2Wrap.hidden = state !== 'none';
      this.forgotLinkWrap.hidden = state !== 'current';
      this.setUnlocking(false);
    }

    setUnlocking(busy, state){
      if(state) this.lockMode = state;
      this.btnUnlock.disabled = busy;
      this.btnUnlock.textContent = busy ? 'Comprobando…' : (LOCK_TEXT[this.lockMode] || LOCK_TEXT.current).button;
    }

    showLockError(msg){ showMessage(this.lockError, msg); }

    clearPasswords(){
      this.lockError.hidden = true;
      this.masterPass.value = '';
      this.masterPass2.value = '';
    }

    showRecoverForm(){
      this.recoverError.hidden = true;
      this.recoveryInput.value = '';
      this.newPass1.value = '';
      this.newPass2.value = '';
      this.unlockForm.hidden = true;
      this.forgotLinkWrap.hidden = true;
      this.recoverForm.hidden = false;
    }

    showRecoverError(msg){ showMessage(this.recoverError, msg); }

    setRecovering(busy){
      this.btnRecover.disabled = busy;
      this.btnRecover.textContent = busy ? 'Restableciendo…' : 'Restablecer con la clave';
    }

    presentRecoveryKey(formattedKey, isReset){
      this.recoveryKeyBox.textContent = formattedKey;
      const titleEl = this.recoveryReveal.querySelector('h2');
      if(titleEl) titleEl.textContent = isReset ? 'Nueva clave de recuperación' : 'Guarda tu clave de recuperación';
      const descEl = this.recoveryReveal.querySelector('.lock-desc');
      if(descEl && isReset){
        descEl.textContent = 'Tu contraseña se ha restablecido. La clave de recuperación anterior ya no sirve — guarda esta nueva en un lugar seguro.';
      }
      this.recoverForm.hidden = true;
      this.recoveryConfirmChk.checked = false;
      this.btnRecoveryContinue.disabled = true;
      this.clearPasswords();
      this.showScreen('recovery');
    }

    /* ---------- Eventos hacia el controlador ---------- */

    bindUnlock(handler){
      this.unlockForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.lockError.hidden = true;
        handler(this.masterPass.value, this.masterPass2.value);
      });
    }

    bindRecover(handler){
      this.recoverForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.recoverError.hidden = true;
        handler(this.recoveryInput.value, this.newPass1.value, this.newPass2.value);
      });
    }

    bindRecoveryActions(handlers){
      this.btnRecoveryContinue.addEventListener('click', handlers.continue);
      this.btnCopyRecovery.addEventListener('click', () => {
        copyWithFeedback(this.btnCopyRecovery, this.recoveryKeyBox.textContent);
      });
      this.btnDownloadRecovery.addEventListener('click', () => {
        handlers.download(this.recoveryKeyBox.textContent).then(() => {
          flashLabel(this.btnDownloadRecovery, 'Descargado');
        }).catch(() => {});
      });
    }

    bindLock(handler){ this.btnLock.addEventListener('click', handler); }

    bindNew(handler){ this.btnNew.addEventListener('click', () => handler()); }

    bindFilters(handler){
      this.search.addEventListener('input', handler);
      this.filterTipo.addEventListener('change', handler);
      this.filterCliente.addEventListener('change', handler);
    }

    /* handlers: {open(id), toggle(id), copy(id, button)} */
    bindGrid(handlers){
      this.grid.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-action]');
        if(btn){
          const id = btn.getAttribute('data-id');
          const action = btn.getAttribute('data-action');
          if(action === 'toggle') handlers.toggle(id);
          if(action === 'copy') handlers.copy(id, btn);
          return;
        }
        if(closest(ev.target, '.pass-row')) return;
        const card = closest(ev.target, '.vault-card');
        if(!card || consumeDragClick(card)) return;
        handlers.open(card.getAttribute('data-id'));
      });
    }

    bindReorder(handler){
      bindDragAndDrop(this.grid, {
        itemSelector: '.vault-card',
        targetSelector: '.vault-card',
        getPayload: (card) => card.getAttribute('data-id'),
        onDrop: (draggedId, card) => {
          const targetId = card.getAttribute('data-id');
          if(draggedId && targetId) handler(draggedId, targetId);
        }
      });
    }

    bindSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.formError.hidden = true;
        handler(this.f.vId.value, this.formValues());
      });
    }

    bindDelete(handler){
      this.btnDelete.addEventListener('click', () => handler(this.f.vId.value));
    }

    /* handlers: {toggle(id), copy(id, button), edit(id)} */
    bindDetail(handlers){
      const currentId = () => this.viewDlg.getAttribute('data-id');
      this.btnVvToggle.addEventListener('click', () => handlers.toggle(currentId()));
      this.btnVvCopy.addEventListener('click', () => handlers.copy(currentId(), this.btnVvCopy));
      this.btnVvEdit.addEventListener('click', () => {
        const id = currentId();
        this.viewDlg.close();
        if(id) handlers.edit(id);
      });
    }

    /* ---------- Rejilla ---------- */

    filters(){
      return {query:this.search.value, tipo:this.filterTipo.value, cliente:this.filterCliente.value};
    }

    setClientOptions(names){
      Workhub.views.ClientSelect.populateFilter(this.filterCliente, names);
    }

    render(entries, hasAny, vault){
      if(!entries.length){
        this.grid.hidden = true;
        this.stateMsg.hidden = false;
        this.stateMsg.textContent = hasAny ? 'Sin resultados para esa búsqueda.' : 'Sin credenciales guardadas todavía. Añade la primera.';
        return;
      }
      this.stateMsg.hidden = true;
      this.grid.hidden = false;
      this.grid.innerHTML = entries.map((v) => cardHtml(v, vault)).join('');
    }

    showGridMessage(msg, hideGrid){
      this.stateMsg.hidden = false;
      if(hideGrid) this.grid.hidden = true;
      this.stateMsg.textContent = msg;
    }

    copy(btn, text){ return copyWithFeedback(btn, text); }

    /* ---------- Ficha de solo lectura ---------- */

    openDetail(entry, vault){
      this.viewDlg.setAttribute('data-id', entry.id);
      this.vvCliente.textContent = entry.cliente || '';
      this.vvTipo.textContent = VaultModel.typeLabel(entry.tipo);
      this.vvTitle.textContent = VaultModel.titleFor(entry);
      this.vvFields.innerHTML = fieldRowsHtml(entry);
      this.renderDetailSecret(entry.id, vault);
      this.viewDlg.showModal();
    }

    renderDetailSecret(id, vault){
      const visible = vault.isVisible(id);
      const data = vault.revealed[id];
      this.vvPassValue.textContent = vault.passwordText(id);
      this.btnVvToggle.textContent = visible ? 'Ocultar' : 'Mostrar';
      const notas = visible && data && data.notas ? data.notas : '';
      this.vvNotasWrap.hidden = !notas;
      this.vvNotas.textContent = notas;
    }

    /* ---------- Formulario ---------- */

    _toggleTypeFields(){
      const tipo = this.tipo.value;
      Object.keys(TYPE_SECTIONS).forEach((k) => { $(TYPE_SECTIONS[k]).hidden = k !== tipo; });
    }

    openNew(clientNames, defaultCliente){
      this.form.reset();
      this.f.vId.value = '';
      this.formTitle.textContent = 'Nueva credencial';
      this.formError.hidden = true;
      this.tipo.value = 'correo';
      this._toggleTypeFields();
      this.cliente.reset(clientNames, defaultCliente);
      this.btnDelete.hidden = true;
      this.dlg.showModal();
    }

    openEdit(entry, secret, clientNames){
      const f = this.f;
      f.vId.value = entry.id;
      this.formTitle.textContent = 'Editar credencial';
      this.formError.hidden = true;
      this.cliente.reset(clientNames, entry.cliente || '');
      f.vLabel.value = entry.label || '';
      this.tipo.value = entry.tipo || 'correo';
      this._toggleTypeFields();
      f.vCorreo.value = entry.correo || '';
      f.vWeb.value = entry.web || '';
      f.vUserUsuario.value = entry.usuario || '';
      f.vUserWeb.value = entry.web || '';
      f.vIp.value = entry.ip || '';
      f.vUsuario.value = entry.usuario || '';
      f.vRdpHost.value = entry.ip || '';
      f.vRdpPuerto.value = entry.puerto || '';
      f.vRdpUsuario.value = entry.usuario || '';
      f.vRdpDominio.value = entry.dominio || '';
      f.vVpnUsuario.value = entry.usuario || '';
      f.vPass.value = secret.password || '';
      f.vNotas.value = secret.notas || '';
      this.btnDelete.hidden = false;
      this.dlg.showModal();
    }

    /* Devuelve {cliente, meta, secret} con solo los campos del tipo elegido. */
    formValues(){
      const f = this.f;
      const tipo = this.tipo.value;
      const val = (el) => el.value.trim();
      const meta = {
        tipo: tipo,
        cliente: this.cliente.value(),
        label: val(f.vLabel),
        correo: '', web: '', ip: '', usuario: '', puerto: '', dominio: ''
      };
      if(tipo === 'correo'){
        meta.correo = val(f.vCorreo);
        meta.web = val(f.vWeb);
      } else if(tipo === 'usuario'){
        meta.usuario = val(f.vUserUsuario);
        meta.web = val(f.vUserWeb);
      } else if(tipo === 'servidor'){
        meta.ip = val(f.vIp);
        meta.usuario = val(f.vUsuario);
      } else if(tipo === 'rdp'){
        meta.ip = val(f.vRdpHost);
        meta.puerto = val(f.vRdpPuerto);
        meta.usuario = val(f.vRdpUsuario);
        meta.dominio = val(f.vRdpDominio);
      } else if(tipo === 'vpn'){
        meta.usuario = val(f.vVpnUsuario);
      }
      return {meta:meta, secret:{password:f.vPass.value, notas:f.vNotas.value}};
    }

    showFormError(msg){ showMessage(this.formError, msg); }

    closeForm(){ this.dlg.close(); }
  }

  function viewRow(label, value){
    if(!value) return '';
    return '<div class="view-row"><span class="view-label">' + esc(label) + '</span><span class="view-value">' + esc(value) + '</span></div>';
  }

  function fieldRowsHtml(v){
    switch(v.tipo || 'correo'){
      case 'correo': return viewRow('Correo', v.correo) + viewRow('Web', v.web);
      case 'usuario': return viewRow('Usuario', v.usuario) + viewRow('Web', v.web);
      case 'servidor': return viewRow('IP / host', v.ip) + viewRow('Usuario', v.usuario);
      case 'rdp': return viewRow('IP / host', v.ip) + viewRow('Puerto', v.puerto) + viewRow('Usuario', v.usuario) + viewRow('Dominio', v.dominio);
      case 'vpn': return viewRow('Usuario', v.usuario);
      default: return '';
    }
  }

  function line(icon, text){
    return text ? '<p class="line">' + iconSpan(icon) + esc(text) + '</p>' : '';
  }

  function cardHtml(v, vault){
    const tipo = v.tipo || 'correo';
    let lines;
    if(tipo === 'correo'){
      lines = line('mail', v.correo) + line('link', v.web);
    } else if(tipo === 'usuario'){
      lines = line('user', v.usuario) + line('link', v.web);
    } else if(tipo === 'rdp'){
      const hostText = v.ip ? (v.puerto ? v.ip + ':' + v.puerto : v.ip) : '';
      const userText = v.dominio ? v.dominio + '\\' + (v.usuario || '') : v.usuario;
      lines = line('monitor', hostText) + line('user', userText);
    } else if(tipo === 'vpn'){
      lines = line('user', v.usuario);
    } else {
      lines = line('server', v.ip) + line('user', v.usuario);
    }
    const visible = vault.isVisible(v.id);
    const data = vault.revealed[v.id];
    const notesHtml = visible && data && data.notas ? '<div class="notes">' + esc(data.notas) + '</div>' : '';
    return '<div class="vault-card" draggable="true" data-id="' + esc(v.id) + '">' +
      '<div class="cat">' + (v.cliente ? clientColors.chip(v.cliente) : '<span></span>') + '<span class="type-badge">' + esc(VaultModel.typeLabel(tipo)) + '</span></div>' +
      '<h3>' + esc(VaultModel.titleFor(v)) + '</h3>' +
      lines +
      '<div class="pass-row"><span class="pass-value">' + esc(vault.passwordText(v.id)) + '</span>' +
      '<button type="button" class="icon-btn" data-action="toggle" data-id="' + esc(v.id) + '">' + (visible ? 'Ocultar' : 'Mostrar') + '</button>' +
      '<button type="button" class="icon-btn" data-action="copy" data-id="' + esc(v.id) + '">Copiar</button></div>' +
      notesHtml +
      '</div>';
  }

  Workhub.views.VaultView = VaultView;
})();
