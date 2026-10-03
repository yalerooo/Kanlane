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
      /* Agrupadas por cliente, conservando dentro de cada grupo el orden manual. */
      const groups = [];
      const byClient = {};
      entries.forEach((v) => {
        const key = Workhub.clientsEnabled === false ? '' : (v.cliente || '');
        if(!byClient[key]) groups.push(byClient[key] = {name:key, items:[]});
        byClient[key].items.push(v);
      });
      const showGroups = Workhub.clientsEnabled !== false;
      this.grid.innerHTML = '<div class="vault-head" aria-hidden="true"><span>Nombre</span><span>Usuario</span><span>Contraseña</span><span>Dominio o host</span><span>Puerto</span></div>' +
        groups.map((g) => (showGroups
          ? '<div class="vault-group" translate="no">' + (g.name ? '<i class="client-dot" style="--h:' + clientColors.hueOf(g.name) + '"></i>' + esc(g.name) : '<span translate="yes">' + esc(Workhub.t('Sin cliente')) + '</span>') + '</div>'
          : '') + g.items.map((v) => cardHtml(v, vault)).join('')).join('');
      const meta = document.getElementById('vaultMeta');
      if(meta) meta.textContent = entries.length + (entries.length === 1 ? ' credencial' : ' credenciales');
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

  const TYPE_ICON = {correo:'mail', usuario:'user', servidor:'server', rdp:'monitor', vpn:'link'};
  const EYE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.2 7.6A16.500 16.500 0 0 0 2.500 12S6 18.5 12 18.5a9.300 9.300 0 0 0 3.900-.9M9.900 9.900a2.800 2.800 0 0 0 4 4"/></svg>'.replace(/(\d)\.(\d)00\b/g, '$1.$2');
  const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h.5"/></svg>';

  /* Fila de la tabla: nombre con icono, usuario, contraseña oculta con mostrar y copiar,
     dominio o host y puerto (estos dos, en Geist Mono). */
  function cardHtml(v, vault){
    const tipo = v.tipo || 'correo';
    /* Sin etiqueta, el título ya es el correo/usuario/IP: no repetirlo en su columna. */
    const titled = (text) => (v.label ? (text || '') : '');
    let user = '', host = '';
    if(tipo === 'correo'){ user = titled(v.correo); host = v.web || ''; }
    else if(tipo === 'usuario'){ user = titled(v.usuario); host = v.web || ''; }
    else if(tipo === 'rdp'){ user = v.dominio ? v.dominio + '\\' + (v.usuario || '') : (v.usuario || ''); host = v.label ? (v.ip || '') : ''; }
    else if(tipo === 'vpn'){ user = titled(v.usuario); }
    else { user = v.usuario || ''; host = titled(v.ip); }
    const visible = vault.isVisible(v.id);
    const data = vault.revealed[v.id];
    const notesHtml = visible && data && data.notas ? '<div class="vault-notes" translate="no">' + esc(data.notas) + '</div>' : '';
    const cell = (cls, text, label) => '<span class="' + cls + '" translate="no"' + (text ? ' title="' + esc(text) + '"' : '') + ' data-label="' + esc(Workhub.t(label)) + '">' + (text ? esc(text) : '<span class="v-none" aria-hidden="true">—</span>') + '</span>';
    return '<div class="vault-card" draggable="true" data-id="' + esc(v.id) + '">' +
      '<span class="v-name"><i class="v-ic" title="' + esc(Workhub.t(VaultModel.typeLabel(tipo))) + '">' + iconSpan(TYPE_ICON[tipo] || 'link') + '</i><span translate="no">' + esc(VaultModel.titleFor(v)) + '</span></span>' +
      cell('v-user', user, 'Usuario') +
      '<span class="pass-row"><span class="pass-value' + (visible ? ' is-shown' : '') + '" translate="no">' + esc(vault.passwordText(v.id)) + '</span>' +
      '<button type="button" class="icon-only is-sm" data-action="toggle" data-id="' + esc(v.id) + '" aria-label="' + (visible ? 'Ocultar' : 'Mostrar') + '" title="' + (visible ? 'Ocultar' : 'Mostrar') + '">' + (visible ? EYE_OFF_ICON : EYE_ICON) + '</button>' +
      '<button type="button" class="icon-only is-sm" data-action="copy" data-id="' + esc(v.id) + '" aria-label="Copiar" title="Copiar">' + COPY_ICON + '</button></span>' +
      cell('v-host mono', host, 'Dominio o host') +
      cell('v-port mono', v.puerto ? String(v.puerto) : '', 'Puerto') +
      notesHtml +
      '</div>';
  }

  /* Lo que comparten los archivos que completan esta vista. */
  Workhub.views.shared = Workhub.views.shared || {};
  Workhub.views.shared.vault = {LOCK_TEXT};

  Workhub.views.VaultView = VaultView;
})();
