/* Proyectos con cifrado total (docs/CIFRADO-PROYECTOS.md, 8.2 y 8.3):
   - pantalla de desbloqueo en el área de contenido (contraseña, o clave de recuperación);
   - diálogo para cambiar la contraseña de cifrado o crear una clave de recuperación nueva.
   También publica lo que comparte con el asistente de «Nuevo proyecto»: el medidor de contraseña y
   el panel que enseña una clave de recuperación (Workhub.views.shared.privacy). */
(function(){
  const {copyWithFeedback} = Workhub.utils.ui;
  const $ = (id) => document.getElementById(id);
  const LEVELS = {short:1, weak:2, fair:3, good:4};

  /* Medidor: cuatro segmentos planos y el texto del resultado de passwordCheck(). */
  function paintMeter(meter, result){
    const n = result ? LEVELS[result.level] || 0 : 0;
    meter.setAttribute('data-level', result ? result.level : '');
    meter.querySelectorAll('i').forEach((el, i) => el.classList.toggle('is-on', i < n));
    meter.querySelector('.pw-meter-text').textContent = result ? result.message : '';
  }

  /* Panel de una clave de recuperación: caja, «Copiar», «Descargar .txt» y la casilla obligatoria.
     els: {box, copy, download, saved}. onDownload(texto) → Promise. onSaved(marcada). */
  function keyPanel(els, onDownload, onSaved){
    els.copy.addEventListener('click', () => copyWithFeedback(els.copy, els.box.textContent));
    els.download.addEventListener('click', () => {
      Promise.resolve(onDownload(els.box.textContent)).catch(() => {});
    });
    els.saved.addEventListener('change', () => { if(onSaved) onSaved(els.saved.checked); });
    return {
      show(text){
        els.box.textContent = text;
        els.saved.checked = false;
        if(onSaved) onSaved(false);
      },
      clear(){
        els.box.textContent = '';
        els.saved.checked = false;
      },
      isSaved(){ return els.saved.checked; }
    };
  }

  class ProjectLockView {
    constructor(){
      this.screen = $('projectLockScreen');
      this.card = $('plCard');
      this.desc = $('plDesc');
      this.unlockForm = $('plUnlockForm');
      this.pass = $('plPass');
      this.trusted = $('plTrusted');
      this.error = $('plError');
      this.btnUnlock = $('plUnlock');
      this.forgotWrap = $('plForgotWrap');
      this.recoverForm = $('plRecoverForm');
      this.recovery = $('plRecovery');
      this.newPass = $('plNew');
      this.newPass2 = $('plNew2');
      this.meter = $('plMeter');
      this.recoverError = $('plRecoverError');
      this.btnRecover = $('plRecover');
      this.keyCard = $('plKeyCard');
      this.btnKeyContinue = $('plKeyContinue');
      this.keyError = $('plKeyError');

      this.dlg = $('dlgEncKey');
      this.ekForm = $('ekForm');
      this.ekTitle = $('ekTitle');
      this.ekLead = $('ekLead');
      this.ekFields = $('ekFields');
      this.ekCurrent = $('ekCurrent');
      this.ekNewWrap = $('ekNewWrap');
      this.ekNew = $('ekNew');
      this.ekNew2 = $('ekNew2');
      this.ekMeter = $('ekMeter');
      this.ekKeyPanel = $('ekKeyPanel');
      this.ekError = $('ekError');
      this.ekSubmit = $('ekSubmit');
      this.ekMode = '';
    }

    /* handlers: {unlock(pw, trusted), recover(clave, pw, pw2, trusted), keyDone(), check(pw) → resultado,
       download(clave) → Promise, change(actual, nueva, repetida), newRecovery(actual), recoveryDone()} */
    bind(handlers){
      this.handlers = handlers;
      this.unlockForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if(this.pass.value) handlers.unlock(this.pass.value, this.trusted.checked);
      });
      $('plForgot').addEventListener('click', (ev) => {
        ev.preventDefault();
        this.recoverForm.hidden = !this.recoverForm.hidden;
        if(!this.recoverForm.hidden) this.recovery.focus();
      });
      this.newPass.addEventListener('input', () => paintMeter(this.meter, this.newPass.value ? handlers.check(this.newPass.value) : null));
      this.recoverForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        handlers.recover(this.recovery.value, this.newPass.value, this.newPass2.value, this.trusted.checked);
      });
      this.lockKey = keyPanel({box:$('plKey'), copy:$('plKeyCopy'), download:$('plKeyDownload'), saved:$('plKeySaved')},
        handlers.download, (on) => { this.btnKeyContinue.disabled = !on; });
      this.btnKeyContinue.addEventListener('click', () => handlers.keyDone());

      this.ekNew.addEventListener('input', () => paintMeter(this.ekMeter, this.ekNew.value ? handlers.check(this.ekNew.value) : null));
      this.ekKey = keyPanel({box:$('ekKey'), copy:$('ekKeyCopy'), download:$('ekKeyDownload'), saved:$('ekKeySaved')},
        handlers.download, (on) => { if(this.ekMode === 'recovery-key') this.ekSubmit.disabled = !on; });
      $('ekCancel').addEventListener('click', () => this.closeDialog());
      this.ekForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if(this.ekMode === 'password') handlers.change(this.ekCurrent.value, this.ekNew.value, this.ekNew2.value);
        else if(this.ekMode === 'recovery') handlers.newRecovery(this.ekCurrent.value);
        else if(this.ekMode === 'recovery-key' && this.ekKey.isSaved()) handlers.recoveryDone();
      });
      this.dlg.addEventListener('close', () => this._resetDialog());
    }

    /* ---------- pantalla de desbloqueo ---------- */

    show(name){
      this.desc.textContent = Workhub.t('Escribe la contraseña de cifrado de «{nombre}». Solo se usa en tu navegador.', {nombre:name || ''});
      this.card.hidden = false;
      this.keyCard.hidden = true;
      this.recoverForm.hidden = true;
      this.pass.value = '';
      this.recovery.value = '';
      this.newPass.value = '';
      this.newPass2.value = '';
      this.trusted.checked = false;
      this.error.hidden = true;
      this.recoverError.hidden = true;
      this.keyError.hidden = true;
      paintMeter(this.meter, null);
      this.lockKey.clear();
      this.setBusy(false);
    }

    focus(){
      if(!this.screen.hidden && !this.card.hidden) this.pass.focus();
    }

    /* Mientras se deriva la clave (PBKDF2 tarda): sin círculo de carga, solo el texto del botón. */
    setBusy(on, which){
      this.btnUnlock.disabled = on;
      this.btnRecover.disabled = on;
      this.btnKeyContinue.disabled = on || !this.lockKey.isSaved();
      this.btnUnlock.textContent = on && which === 'unlock' ? 'Comprobando la contraseña…' : 'Desbloquear';
      this.btnRecover.textContent = on && which === 'recover' ? 'Comprobando la contraseña…' : 'Recuperar el acceso';
    }

    showError(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
    }

    showRecoverError(msg){
      this.card.hidden = false;
      this.keyCard.hidden = true;
      this.recoverForm.hidden = false;
      this.recoverError.textContent = msg;
      this.recoverError.hidden = false;
    }

    /* Tras recuperar el acceso: la clave de recuperación nueva (la anterior deja de valer). */
    showKey(text){
      this.card.hidden = true;
      this.keyCard.hidden = false;
      this.keyError.hidden = true;
      this.lockKey.show(text);
    }

    showKeyError(msg){
      this.keyError.textContent = msg;
      this.keyError.hidden = false;
    }

    /* ---------- diálogo: cambiar la contraseña o crear otra clave de recuperación ---------- */

    openPassword(){
      this._openDialog('password', 'Cambiar la contraseña de cifrado',
        'La contraseña nueva sustituye a la anterior en todos tus dispositivos. La clave de recuperación no cambia.', 'Guardar');
    }

    openRecovery(){
      this._openDialog('recovery', 'Crear una clave de recuperación nueva',
        'Escribe tu contraseña de cifrado. Se creará una clave de recuperación nueva y la anterior dejará de valer.', 'Siguiente');
    }

    _openDialog(mode, title, lead, button){
      this._resetDialog();
      this.ekMode = mode;
      this.ekTitle.textContent = title;
      this.ekLead.textContent = lead;
      this.ekSubmit.textContent = button;
      this.ekNewWrap.hidden = mode !== 'password';
      this.dlg.showModal();
      this.ekCurrent.focus();
    }

    /* Segundo paso de «clave de recuperación nueva»: se enseña antes de guardarla. */
    showDialogKey(text){
      this.ekMode = 'recovery-key';
      this.ekFields.hidden = true;
      this.ekKeyPanel.hidden = false;
      this.ekError.hidden = true;
      this.ekLead.textContent = 'Es la única forma de abrir este proyecto si olvidas la contraseña. Kanlane no puede restablecerla ni enviártela por correo. Guárdala fuera de Kanlane: en un gestor de contraseñas o en papel.';
      this.ekSubmit.textContent = 'Usar esta clave';
      this.ekKey.show(text);
    }

    setDialogBusy(on){
      this.ekSubmit.disabled = on || (this.ekMode === 'recovery-key' && !this.ekKey.isSaved());
    }

    showDialogError(msg){
      this.ekError.textContent = msg;
      this.ekError.hidden = false;
    }

    closeDialog(){
      if(this.dlg.open) this.dlg.close();
    }

    _resetDialog(){
      this.ekMode = '';
      this.ekCurrent.value = '';
      this.ekNew.value = '';
      this.ekNew2.value = '';
      this.ekFields.hidden = false;
      this.ekKeyPanel.hidden = true;
      this.ekError.hidden = true;
      this.ekSubmit.disabled = false;
      paintMeter(this.ekMeter, null);
      this.ekKey.clear();
    }
  }

  Workhub.views.shared = Workhub.views.shared || {};
  Workhub.views.shared.privacy = {paintMeter, keyPanel};
  Workhub.views.ProjectLockView = ProjectLockView;
})();
