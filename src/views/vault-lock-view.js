/* Pantallas de bloqueo de las contraseñas: desbloquear, recuperar y mostrar la clave de recuperación.
   Se añade a VaultView (ver vault-view.js). */
(function(){
  const {LOCK_TEXT} = Workhub.views.shared.vault;
  const {esc} = Workhub.utils.html;
  const {copyWithFeedback, flashLabel, showMessage} = Workhub.utils.ui;
  /* El medidor es el de los proyectos cifrados (project-lock-view.js, que se carga después). */
  const paintMeter = (meter, result) => Workhub.views.shared.privacy.paintMeter(meter, result);
  const $ = (id) => document.getElementById(id);

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
      this.passFields = [this.masterPass, this.masterPass2, this.newPass1, this.newPass2, this.vtPass];
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
      this.passTools = Array.from(document.querySelectorAll('#viewVault .pass-tools')).map((box) => {
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

    /* ---------- Segundo paso ---------- */

    showTotpStep(){
      this.lockTitle.textContent = 'Verificación en dos pasos';
      this.lockDesc.textContent = 'La contraseña maestra es correcta. Escribe ahora el código de tu aplicación de autenticación. Si no la tienes a mano, puedes entrar con tu clave de recuperación.';
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

    /* setup: {secret, uri} para activarla; sin setup, el diálogo es el de desactivarla. */
    openTotp(setup){
      this.vtError.hidden = true;
      this.vtSetup.hidden = !setup;
      this.vtSecret.textContent = setup ? setup.secret : '';
      /* Sin QR (el enlace no cabe) queda la clave para teclearla. */
      this.vtQr.innerHTML = setup ? Workhub.utils.qr.svg(setup.uri) : '';
      this.vtQr.hidden = !this.vtQr.firstChild;
      this.vtOpen.setAttribute('href', setup ? setup.uri : '#');
      this.vtLead.textContent = setup
        ? 'Además de la contraseña maestra, al desbloquear se pedirá un código de tu aplicación de autenticación (Google Authenticator, Aegis, 1Password…). Escanea este código con la aplicación y escribe abajo el código de 6 cifras que te dé.'
        : 'Para desactivarla escribe tu contraseña maestra y un código de la aplicación. Después, al desbloquear solo se pedirá la contraseña maestra.';
      this.totpMode = setup ? 'on' : 'off';
      this._resetPasswordFields([this.vtPass]);
      this.vtCode.value = '';
      this.setTotpBusy(false);
      this.totpDlg.showModal();
    },

    showTotpError(msg){ showMessage(this.vtError, msg); },

    setTotpBusy(busy){
      this.vtSubmit.disabled = busy;
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

    /* handlers: {open(), submit(contraseña, código)} */
    bindTotp(handlers){
      this.btnVaultTotp.addEventListener('click', () => handlers.open());
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
      this.unlockForm.hidden = true;
      this.totpForm.hidden = true;
      this.forgotLinkWrap.hidden = true;
      this.recoverForm.hidden = false;
    },

    showRecoverError(msg){ showMessage(this.recoverError, msg); },

    setRecovering(busy){
      this.btnRecover.disabled = busy;
      this.btnRecover.textContent = busy ? 'Restableciendo…' : 'Restablecer con la clave';
    },

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
      this._resetPasswordFields([this.newPass1, this.newPass2]);
      this.showScreen('recovery');
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
        handler(this.recoveryInput.value, this.newPass1.value, this.newPass2.value);
      });
    },

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
    },

    bindLock(handler){ this.btnLock.addEventListener('click', handler); },

    bindNew(handler){ this.btnNew.addEventListener('click', () => handler()); },
  });
})();
