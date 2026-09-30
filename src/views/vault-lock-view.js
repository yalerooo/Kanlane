/* Pantallas de bloqueo de las contraseñas: desbloquear, recuperar y mostrar la clave de recuperación.
   Se añade a VaultView (ver vault-view.js). */
(function(){
  const {LOCK_TEXT} = Workhub.views.shared.vault;
  const {esc} = Workhub.utils.html;
  const {copyWithFeedback, flashLabel, showMessage} = Workhub.utils.ui;

  Object.assign(Workhub.views.VaultView.prototype, {
    /* screen: 'lock' | 'recovery' | 'content' */
    showScreen(screen){
      this.lockScreen.hidden = screen !== 'lock';
      this.recoveryReveal.hidden = screen !== 'recovery';
      this.content.hidden = screen !== 'content';
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
      this.recoverForm.hidden = true;
      this.unlockForm.hidden = false;
      this.lockTitle.textContent = text.title;
      this.lockDesc.textContent = text.desc;
      this.masterPass2Wrap.hidden = state !== 'none';
      this.forgotLinkWrap.hidden = state !== 'current';
      this.setUnlocking(false);
    },

    setUnlocking(busy, state){
      if(state) this.lockMode = state;
      this.btnUnlock.disabled = busy;
      this.btnUnlock.textContent = busy ? 'Comprobando…' : (LOCK_TEXT[this.lockMode] || LOCK_TEXT.current).button;
    },

    showLockError(msg){ showMessage(this.lockError, msg); },

    clearPasswords(){
      this.lockError.hidden = true;
      this.masterPass.value = '';
      this.masterPass2.value = '';
    },

    showRecoverForm(){
      this.recoverError.hidden = true;
      this.recoveryInput.value = '';
      this.newPass1.value = '';
      this.newPass2.value = '';
      this.unlockForm.hidden = true;
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
      this.showScreen('recovery');
    },

    /* ---------- Eventos hacia el controlador ---------- */

    bindUnlock(handler){
      this.unlockForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.lockError.hidden = true;
        handler(this.masterPass.value, this.masterPass2.value);
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
