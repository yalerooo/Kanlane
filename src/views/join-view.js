/* Diálogo «Unirte a un equipo con cifrado total» (docs/CIFRADO-PROYECTOS.md, 8.5 y 10.4): código de
   acceso que da quien invita, contraseña de cifrado propia y, antes de entrar, la clave de
   recuperación propia con su confirmación obligatoria. */
(function(){
  const $ = (id) => document.getElementById(id);
  const {paintMeter, keyPanel} = Workhub.views.shared.privacy;

  class JoinView {
    constructor(){
      this.dlg = $('dlgJoin');
      this.title = $('jnTitle');
      this.lead = $('jnLead');
      this.fields = $('jnFields');
      this.code = $('jnCode');
      this.pass = $('jnPass');
      this.pass2 = $('jnPass2');
      this.meter = $('jnMeter');
      this.keyBox = $('jnKeyPanel');
      this.error = $('jnError');
      this.submit = $('jnSubmit');
      /* 'fields' (código y contraseña) o 'key' (clave de recuperación). */
      this.step = 'fields';
    }

    /* handlers: {check(pw), open(code, pw, pw2), finish(), download(texto), closed()} */
    bind(handlers){
      this.key = keyPanel({box:$('jnKey'), copy:$('jnKeyCopy'), download:$('jnKeyDownload'), saved:$('jnKeySaved')},
        handlers.download, (on) => { if(this.step === 'key') this.submit.disabled = !on; });
      this.pass.addEventListener('input', () => paintMeter(this.meter, this.pass.value ? handlers.check(this.pass.value) : null));
      $('jnForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.error.hidden = true;
        if(this.step === 'fields') handlers.open(this.code.value, this.pass.value, this.pass2.value);
        else if(this.key.isSaved()) handlers.finish();
      });
      $('jnCancel').addEventListener('click', () => this.close());
      this.dlg.addEventListener('close', () => {
        this._reset();
        handlers.closed();
      });
    }

    _reset(){
      this.step = 'fields';
      this.code.value = '';
      this.pass.value = '';
      this.pass2.value = '';
      paintMeter(this.meter, null);
      this.key.clear();
      this.fields.hidden = false;
      this.keyBox.hidden = true;
      this.error.hidden = true;
      this.setBusy(false);
    }

    /* invite: la invitación (teamName, invitedByName). */
    open(invite){
      this._reset();
      this.title.textContent = Workhub.t('Unirte a «{equipo}»', {equipo:invite.teamName || ''});
      this.lead.textContent = Workhub.t('Este proyecto tiene cifrado total. Escribe el código de acceso que te ha dado {nombre} y elige tu propia contraseña de cifrado para este proyecto.', {nombre:invite.invitedByName || ''});
      this.dlg.showModal();
      this.code.focus();
    }

    isOpen(){ return this.dlg.open; }
    close(){ if(this.dlg.open) this.dlg.close(); }

    /* Derivar la clave tarda: sin círculo de carga, solo el texto del botón. */
    setBusy(on){
      this.submit.disabled = on || (this.step === 'key' && !this.key.isSaved());
      this.submit.textContent = on ? (this.step === 'fields' ? 'Comprobando el código…' : 'Entrando en el equipo…')
        : (this.step === 'fields' ? 'Continuar' : 'Unirme al equipo');
    }

    /* El código es bueno: se enseña la clave de recuperación propia antes de guardar nada. */
    showKey(text){
      this.step = 'key';
      this.fields.hidden = true;
      this.keyBox.hidden = false;
      this.lead.textContent = 'Esta es tu clave de recuperación de este proyecto. Es la única forma de abrirlo si olvidas tu contraseña de cifrado: guárdala fuera de Kanlane.';
      this.key.show(text);
      this.setBusy(false);
    }

    showError(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
    }
  }

  Workhub.views.JoinView = JoinView;
})();
