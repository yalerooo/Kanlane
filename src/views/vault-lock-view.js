/* Pantallas de bloqueo de las contraseñas: desbloquear, recuperar y mostrar la clave de recuperación.
   Se añade a VaultView (ver vault-view.js). */
(function(){
  const {LOCK_TEXT} = Workhub.views.shared.vault;
  const {esc} = Workhub.utils.html;
  const {copyWithFeedback, flashLabel, showMessage} = Workhub.utils.ui;
  /* El medidor es el de los proyectos cifrados (project-lock-view.js, que se carga después). */
  const paintMeter = (meter, result) => Workhub.views.shared.privacy.paintMeter(meter, result);
  const $ = (id) => document.getElementById(id);

  const RECOVERY_TEXT = {
    'new': {title:'Guarda tu clave de recuperación', desc:'Es la única forma de recuperar el acceso si olvidas tu contraseña maestra. Guárdala en un lugar seguro — no la compartas ni la subas a ningún sitio. Quien la tenga, junto con acceso a este tablero, podría leer las contraseñas guardadas.'},
    'reset': {title:'Nueva clave de recuperación', desc:'Tu contraseña se ha restablecido. La clave de recuperación anterior ya no sirve — guarda esta nueva en un lugar seguro.'},
    'totp-on': {title:'Verificación en dos pasos activada', desc:'Tu clave de recuperación ha cambiado: la anterior ya no sirve. Desde ahora, para restablecer la contraseña maestra con esta clave hará falta además un código de la aplicación o uno de respaldo.'},
    'totp-off': {title:'Verificación en dos pasos desactivada', desc:'Tu clave de recuperación ha cambiado: la anterior ya no sirve. Esta vuelve a bastar ella sola para restablecer la contraseña maestra, así que guárdala bien.'},
    'codes': {title:'Códigos de respaldo nuevos', desc:'Los códigos anteriores ya no sirven. Tu clave de recuperación no cambia.'}
  };

  const EYE = '<svg class="ic-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '<svg class="ic-eye-off" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.5 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a10.6 10.6 0 0 0 5.4-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  Object.assign(Workhub.views.VaultView.prototype, {
    /* screen: 'lock' | 'recovery' | 'content' */
    showScreen(screen){
      this.lockScreen.hidden = screen !== 'lock';
      this.recoveryReveal.hidden = screen !== 'recovery';
      this.content.hidden = screen !== 'content';
      /* Buscador, filtros y «Nueva credencial» están en la barra de la vista: solo con el cofre abierto. */
      const tools = document.getElementById('vaultTools');
      if(tools) tools.classList.toggle('is-locked', screen !== 'content');
    },

    showCryptoUnavailable(){
      this.lockTitle.textContent = 'Cifrado no disponible';
      this.lockDesc.textContent = 'Este navegador no admite cifrado (Web Crypto). Prueba con una versión reciente de Chrome, Edge o Safari.';
      this.unlockForm.hidden = true;
      this.forgotLinkWrap.hidden = true;
    },

    setLockMode(state){
      this.lockMode = state;
      const text = LOCK_TEXT[state] || LOCK_TEXT.current;
      const creating = state === 'none' || state === 'grant';
      this.recoverForm.hidden = true;
      this.totpForm.hidden = true;
      this.unlockForm.hidden = state === 'absent';
      this.lockTitle.textContent = text.title;
      this.lockDesc.textContent = text.desc;
      /* Con un código de acceso también se crea una contraseña maestra: se pide dos veces. */
      this.masterPass2Wrap.hidden = !creating;
      /* Medidor y generador: solo al elegir una contraseña nueva. */
      this.masterPassTools.hidden = !creating;
      $('vaultCodeWrap').hidden = state !== 'grant';
      this.forgotLinkWrap.hidden = state !== 'current';
      this.setUnlocking(false);
    },

    /* ---------- Campos de contraseña: ver/ocultar, medidor y generador ---------- */

    /* Cada contraseña de estas pantallas lleva el botón de verla. Las que crean una nueva tienen
       además un bloque .pass-tools (data-for: el campo; data-repeat: el de repetirla) con el
       medidor, «Generar una segura» y «Copiar». */
    _bindPasswordFields(){
      this.passFields = [this.masterPass, this.masterPass2, this.newPass1, this.newPass2, this.vtPass, this.vpCurrent, this.vpNew, this.vpNew2];
      this.passFields.forEach((input) => {
        const wrap = document.createElement('div');
        wrap.className = 'auth-pass';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'auth-pass-toggle';
        btn.innerHTML = EYE;
        wrap.appendChild(btn);
        btn.addEventListener('click', () => this._showPassword(input, input.type === 'password'));
        this._showPassword(input, false);
      });
      this.passTools = Array.from(document.querySelectorAll('.pass-tools')).map((box) => {
        const t = {
          box: box, input: $(box.getAttribute('data-for')), repeat: $(box.getAttribute('data-repeat')),
          meter: box.querySelector('.pw-meter'), gen: box.querySelector('[data-act="gen"]'),
          copy: box.querySelector('[data-act="copy"]'), note: box.querySelector('.pass-gen-note')
        };
        t.input.addEventListener('input', () => {
          this._setGenerated(t, false);
          this._paintTools(t);
        });
        t.gen.addEventListener('click', () => {
          const pass = Workhub.services.crypto.generatePassword();
          t.input.value = pass;
          t.repeat.value = pass;
          /* Se enseña: hay que poder copiarla o apuntarla. */
          this._showPassword(t.input, true);
          this._showPassword(t.repeat, true);
          this._setGenerated(t, true);
          this._paintTools(t);
          /* Un «no coinciden» o «demasiado corta» de antes ya no viene a cuento. */
          const error = box.closest('form').querySelector('.lock-error');
          if(error) error.hidden = true;
        });
        t.copy.addEventListener('click', () => copyWithFeedback(t.copy, t.input.value));
        return t;
      });
    },

    _showPassword(input, shown){
      const btn = input.parentNode.querySelector('.auth-pass-toggle');
      const label = shown ? 'Ocultar contraseña' : 'Mostrar contraseña';
      input.type = shown ? 'text' : 'password';
      btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
      btn.setAttribute('aria-label', label);
      btn.title = label;
    },

    _setGenerated(t, on){
      t.copy.hidden = !on;
      t.note.hidden = !on;
    },

    _paintTools(t){
      paintMeter(t.meter, t.input.value && this.checkPassword ? this.checkPassword(t.input.value) : null);
    },

    /* check(contraseña) → resultado de passwordCheck(), para el medidor. */
    bindPasswordCheck(check){ this.checkPassword = check; },

    /* Vacía las contraseñas de estas pantallas y las deja ocultas. */
    _resetPasswordFields(inputs){
      inputs.forEach((input) => {
        input.value = '';
        this._showPassword(input, false);
      });
      this.passTools.forEach((t) => {
        if(inputs.indexOf(t.input) === -1) return;
        this._setGenerated(t, false);
        this._paintTools(t);
      });
    },

    /* ---------- Contraseña maestra débil y cambiarla ---------- */

    setWeak(on){ this.weakNote.hidden = !on; },

    openPass(){
      this.vpError.hidden = true;
      this._clearPass();
      this.setPassBusy(false);
      this.passDlg.showModal();
    },

    showPassError(msg){ showMessage(this.vpError, msg); },

    setPassBusy(busy){
      this.vpSubmit.disabled = busy;
      this.vpSubmit.textContent = busy ? 'Comprobando…' : 'Cambiar contraseña';
    },

    closePass(){
      this._clearPass();
      this.passDlg.close();
    },

    _clearPass(){ this._resetPasswordFields([this.vpCurrent, this.vpNew, this.vpNew2]); },

    /* handlers: {open(), submit(actual, nueva, repetida)} */
    bindPass(handlers){
      this.btnVaultPass.addEventListener('click', () => handlers.open());
      this.btnVaultWeak.addEventListener('click', () => handlers.open());
      this.vpForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.vpError.hidden = true;
        handlers.submit(this.vpCurrent.value, this.vpNew.value, this.vpNew2.value);
      });
    },

    /* ---------- Segundo paso ---------- */

    showTotpStep(){
      this.lockTitle.textContent = 'Verificación en dos pasos';
      this.lockDesc.textContent = 'La contraseña maestra es correcta. Escribe ahora el código de tu aplicación de autenticación o, si no tienes el teléfono, uno de tus códigos de respaldo.';
      this.unlockForm.hidden = true;
      this.recoverForm.hidden = true;
      this.totpError.hidden = true;
      this.totpCode.value = '';
      this.totpForm.hidden = false;
      this.forgotLinkWrap.hidden = false;
      this.setTotpChecking(false);
      this.totpCode.focus();
    },

    showTotpStepError(msg){ showMessage(this.totpError, msg); },

    setTotpChecking(busy){
      this.btnTotp.disabled = busy;
      this.btnTotp.textContent = busy ? 'Comprobando…' : 'Verificar';
    },

    /* handlers: {verify(código), back()} */
    bindTotpStep(handlers){
      this.totpForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.totpError.hidden = true;
        handlers.verify(this.totpCode.value);
      });
      this.linkTotpBack.addEventListener('click', (ev) => {
        ev.preventDefault();
        handlers.back();
      });
    },

    /* ---------- Activar o desactivar la verificación en dos pasos ---------- */

    /* available: se puede activar aquí (hay cuenta). enabled: este cofre ya la tiene. */
    setTotpState(available, enabled){
      this.btnVaultTotp.hidden = !available && !enabled;
      this.btnVaultTotp.textContent = enabled ? 'Verificación en dos pasos activada' : 'Activar verificación en dos pasos';
    },

    /* setup: {secret, uri} para activarla; sin setup, el diálogo es el de desactivarla o pedir
       códigos de respaldo nuevos, y left dice cuántos quedan sin usar. */
    openTotp(setup, left){
      this.vtError.hidden = true;
      this.vtSetup.hidden = !setup;
      this.vtSecret.textContent = setup ? setup.secret : '';
      /* Sin QR (el enlace no cabe) queda la clave para teclearla. */
      this.vtQr.innerHTML = setup ? Workhub.utils.qr.svg(setup.uri) : '';
      this.vtQr.hidden = !this.vtQr.firstChild;
      this.vtOpen.setAttribute('href', setup ? setup.uri : '#');
      this.vtLead.textContent = setup
        ? 'Además de la contraseña maestra, al desbloquear se pedirá un código de tu aplicación de autenticación (Google Authenticator, Aegis, 1Password…). Escanea este código con la aplicación y escribe abajo el código de 6 cifras que te dé.'
        : 'Para desactivarla, o para cambiar tus códigos de respaldo por otros nuevos, escribe tu contraseña maestra y un código de la aplicación o de respaldo.';
      this.vtLeft.hidden = !!setup || typeof left !== 'number';
      this.vtLeft.textContent = this.vtLeft.hidden ? '' : 'Códigos de respaldo sin usar: ' + left + '.';
      this.vtCodeLabel.textContent = setup ? 'Código de verificación' : 'Código de verificación o de respaldo';
      this.vtCodes.hidden = !!setup;
      this.totpMode = setup ? 'on' : 'off';
      this._resetPasswordFields([this.vtPass]);
      this.vtCode.value = '';
      this.setTotpBusy(false);
      this.totpDlg.showModal();
    },

    showTotpError(msg){ showMessage(this.vtError, msg); },

    setTotpBusy(busy){
      this.vtSubmit.disabled = busy;
      this.vtCodes.disabled = busy;
      this.vtSubmit.textContent = busy ? 'Comprobando…' : (this.totpMode === 'off' ? 'Desactivar' : 'Activar');
    },

    closeTotp(){
      this._clearTotp();
      this.totpDlg.close();
    },

    /* Al cerrar no queda en la página ni la clave del autenticador ni la contraseña. */
    _clearTotp(){
      this.vtSecret.textContent = '';
      this.vtQr.innerHTML = '';
      this.vtOpen.setAttribute('href', '#');
      this._resetPasswordFields([this.vtPass]);
      this.vtCode.value = '';
    },

    /* handlers: {open(), submit(contraseña, código), codes(contraseña, código)} */
    bindTotp(handlers){
      this.btnVaultTotp.addEventListener('click', () => handlers.open());
      this.vtCodes.addEventListener('click', () => {
        this.vtError.hidden = true;
        handlers.codes(this.vtPass.value, this.vtCode.value);
      });
      this.vtForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.vtError.hidden = true;
        handlers.submit(this.vtPass.value, this.vtCode.value);
      });
    },

    setUnlocking(busy, state){
      if(state) this.lockMode = state;
      this.btnUnlock.disabled = busy;
      this.btnUnlock.textContent = busy ? 'Comprobando…' : (LOCK_TEXT[this.lockMode] || LOCK_TEXT.current).button;
    },

    showLockError(msg){ showMessage(this.lockError, msg); },

    clearPasswords(){
      this.lockError.hidden = true;
      this._resetPasswordFields([this.masterPass, this.masterPass2]);
      this.totpCode.value = '';
      $('vaultCode').value = '';
    },

    /* Código del enlace de acceso con el que se abrió la app. */
    setAccessCode(code){
      if(!$('vaultCode').value) $('vaultCode').value = code || '';
    },

    showRecoverForm(){
      this.recoverError.hidden = true;
      this.recoveryInput.value = '';
      this._resetPasswordFields([this.newPass1, this.newPass2]);
      this.recoverCodeWrap.hidden = true;
      this.recoverCode.value = '';
      this.unlockForm.hidden = true;
      this.totpForm.hidden = true;
      this.forgotLinkWrap.hidden = true;
      this.recoverForm.hidden = false;
    },

    /* La clave de recuperación es buena, pero el cofre tiene verificación en dos pasos. */
    showRecoverCode(){
      this.recoverCodeWrap.hidden = false;
      this.recoverCode.focus();
    },

    showRecoverError(msg){ showMessage(this.recoverError, msg); },

    setRecovering(busy){
      this.btnRecover.disabled = busy;
      this.btnRecover.textContent = busy ? 'Restableciendo…' : 'Restablecer con la clave';
    },

    /* kind: 'new' (cofre recién creado), 'reset' (restablecido con la clave anterior), 'totp-on' o
       'totp-off' (al cambiar la verificación en dos pasos la clave también cambia) y 'codes'
       (solo códigos de respaldo nuevos: formattedKey va vacío).
       codes: códigos de respaldo que enseñar, si los hay. */
    presentRecoveryKey(formattedKey, kind, codes){
      const text = RECOVERY_TEXT[kind] || RECOVERY_TEXT['new'];
      const hasKey = !!formattedKey;
      this.recoveryKeyBox.textContent = formattedKey || '';
      this.recoveryKeyBox.hidden = !hasKey;
      this.recoveryCheckWrap.hidden = !hasKey;
      this.recoveryWarning.hidden = !hasKey;
      this.recoveryReveal.querySelector('h2').textContent = text.title;
      this.recoveryReveal.querySelector('.lock-desc').textContent = text.desc;
      this.backupCodes = codes && codes.length ? codes.slice() : null;
      this.backupCodesWrap.hidden = !this.backupCodes;
      this.backupCodesBox.textContent = this.backupCodes ? this.backupCodes.join('\n') : '';
      /* Hay que escribir un grupo de la clave elegido al azar: marcar una casilla no prueba nada. */
      const groups = hasKey ? formattedKey.split('-') : [];
      const n = 1 + Math.floor(Math.random() * groups.length);
      this.recoveryGroup = hasKey ? groups[n - 1] : null;
      this.recoveryCheckN.textContent = String(n);
      this.recoveryCheck.value = '';
      this.recoverForm.hidden = true;
      this.recoveryConfirmChk.checked = false;
      this._paintRecoveryContinue();
      this.clearPasswords();
      this._resetPasswordFields([this.newPass1, this.newPass2]);
      this.recoverCode.value = '';
      this.showScreen('recovery');
    },

    _paintRecoveryContinue(){
      const typed = this.recoveryCheck.value.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
      this.btnRecoveryContinue.disabled = !this.recoveryConfirmChk.checked || (!!this.recoveryGroup && typed !== this.recoveryGroup);
    },

    /* Al seguir no quedan en la página ni la clave ni los códigos. */
    clearRecoveryKey(){
      this.recoveryKeyBox.textContent = '';
      this.backupCodesBox.textContent = '';
      this.backupCodes = null;
      this.recoveryGroup = null;
      this.recoveryCheck.value = '';
    },

    /* ---------- Eventos hacia el controlador ---------- */

    bindUnlock(handler){
      this.unlockForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.lockError.hidden = true;
        handler(this.masterPass.value, this.masterPass2.value, $('vaultCode').value);
      });
    },

    bindRecover(handler){
      this.recoverForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.recoverError.hidden = true;
        handler(this.recoveryInput.value, this.newPass1.value, this.newPass2.value, this.recoverCodeWrap.hidden ? '' : this.recoverCode.value);
      });
    },

    bindRecoveryActions(handlers){
      this.btnRecoveryContinue.addEventListener('click', handlers.continue);
      this.btnCopyRecovery.addEventListener('click', () => {
        const parts = [this.recoveryKeyBox.textContent, this.backupCodes ? this.backupCodes.join('\n') : ''];
        copyWithFeedback(this.btnCopyRecovery, parts.filter(Boolean).join('\n\n'));
      });
      this.btnDownloadRecovery.addEventListener('click', () => {
        handlers.download(this.recoveryKeyBox.textContent, this.backupCodes).then(() => {
          flashLabel(this.btnDownloadRecovery, 'Descargado');
        }).catch(() => {});
      });
    },

    bindLock(handler){ this.btnLock.addEventListener('click', handler); },

    bindNew(handler){ this.btnNew.addEventListener('click', () => handler()); },
  });
})();
