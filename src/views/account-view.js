/* Ajustes → «Tu cuenta»: nombre y foto, cambio de contraseña y eliminación de la cuenta.
   Solo se ve con una cuenta (ni en modo local ni como invitado). */
(function(){
  const {esc, initials, hueFor} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  class AccountView {
    constructor(){
      this.card = $('accountCard');
      this.photo = $('accountPhoto');
      this.photoFile = $('accountPhotoFile');
      this.photoRemove = $('btnAccountPhotoRemove');
      this.nameInput = $('accountNameInput');
      this.profileMsg = $('accountProfileMsg');
      this.passwordDesc = $('accountPasswordDesc');
      this.passwordBtn = $('btnAccountPassword');

      this.dlgPassword = $('dlgAccountPassword');
      this.pwCurrent = $('apCurrent');
      this.pwNew = $('apNew');
      this.pwRepeat = $('apRepeat');
      this.pwError = $('apError');
      this.pwSubmit = $('apSubmit');

      this.dlgDelete = $('dlgAccountDelete');
      this.delSummary = $('adSummary');
      this.delPassField = $('adPassField');
      this.delPass = $('adPass');
      this.delProvider = $('adProvider');
      this.delWord = $('adWord');
      this.delError = $('adError');
      this.delProgress = $('adProgress');
      this.delSubmit = $('adSubmit');
      this.delCancel = $('adCancel');

      $('btnAccountPhoto').addEventListener('click', () => this.photoFile.click());
      $('apCancel').addEventListener('click', () => this.dlgPassword.close());
      this.delCancel.addEventListener('click', () => { if(!this.deleting) this.dlgDelete.close(); });
      /* Mientras se borra no se puede cerrar el diálogo (ni con Esc). */
      this.dlgDelete.addEventListener('cancel', (ev) => { if(this.deleting) ev.preventDefault(); });
      this.delWord.addEventListener('input', () => this.syncDelete());
    }

    /* ---------- Eventos hacia el controlador ---------- */

    /* handlers: {name(texto), photo(File), removePhoto()} */
    bindProfile(handlers){
      $('accountProfile').addEventListener('submit', (ev) => {
        ev.preventDefault();
        handlers.name(this.nameInput.value.trim());
      });
      this.photoFile.addEventListener('change', () => {
        const file = this.photoFile.files && this.photoFile.files[0];
        this.photoFile.value = '';
        if(file) handlers.photo(file);
      });
      this.photoRemove.addEventListener('click', () => handlers.removePhoto());
    }

    /* handlers: {open(), submit(actual, nueva)} */
    bindPassword(handlers){
      this.passwordBtn.addEventListener('click', () => handlers.open());
      $('apForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        if(this.pwSubmit.disabled) return;
        const next = this.pwNew.value;
        if(Array.from(next).length < 8){ this.showPasswordError('La contraseña debe tener al menos 8 caracteres.'); return; }
        if(next !== this.pwRepeat.value){ this.showPasswordError('Las dos contraseñas nuevas no coinciden.'); return; }
        handlers.submit(this.pwCurrent.value, next);
      });
    }

    /* handlers: {open(), submit(contraseña)} */
    bindDelete(handlers){
      $('btnAccountDelete').addEventListener('click', () => handlers.open());
      $('adForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        if(this.delSubmit.disabled) return;
        handlers.submit(this.delPass.value);
      });
    }

    /* ---------- Tarjeta ---------- */

    /* o: {name, email, uid, photo, ownPhoto, hasPassword, provider} o null (sin cuenta). */
    render(o){
      this.card.hidden = !o;
      if(!o) return;
      if(document.activeElement !== this.nameInput) this.nameInput.value = o.name;
      this.paintPhoto(o);
      this.photoRemove.hidden = !o.ownPhoto;
      this.passwordBtn.hidden = !o.hasPassword;
      this.passwordDesc.textContent = o.hasPassword
        ? Workhub.t('Cámbiala cuando quieras: te pediremos la actual.')
        : Workhub.t('Entras con {provider}: no tienes una contraseña en Kanlane.', {provider:o.provider});
    }

    paintPhoto(o){
      this.photo.style.setProperty('--h', hueFor(o.uid));
      this.photo.textContent = '';
      if(o.photo){
        const img = document.createElement('img');
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.src = o.photo;
        this.photo.appendChild(img);
      }else{
        this.photo.textContent = initials(o.name);
      }
    }

    showProfileMessage(text, isError){
      this.profileMsg.textContent = Workhub.t(text);
      this.profileMsg.classList.toggle('is-error', !!isError);
      this.profileMsg.hidden = !text;
    }

    setProfileBusy(busy){
      $('btnAccountName').disabled = busy;
      $('btnAccountPhoto').disabled = busy;
      this.photoRemove.disabled = busy;
    }

    /* ---------- Cambiar contraseña ---------- */

    openPassword(){
      [this.pwCurrent, this.pwNew, this.pwRepeat].forEach((el) => { el.value = ''; });
      this.pwError.hidden = true;
      this.setPasswordBusy(false);
      this.dlgPassword.showModal();
      this.pwCurrent.focus();
    }

    closePassword(){
      if(this.dlgPassword.open) this.dlgPassword.close();
    }

    setPasswordBusy(busy){
      this.pwSubmit.disabled = busy;
      this.pwSubmit.textContent = Workhub.t(busy ? 'Cambiando…' : 'Cambiar contraseña');
    }

    /* field: 'current' pone el cursor en la contraseña actual. */
    showPasswordError(text, field){
      this.pwError.textContent = Workhub.t(text);
      this.pwError.hidden = false;
      const el = field === 'current' ? this.pwCurrent : this.pwNew;
      el.focus();
      el.select();
    }

    /* ---------- Eliminar cuenta ---------- */

    /* o: {email, hasPassword, provider, summary:{personal, owned:[{nombre, others}], joined}} */
    openDelete(o){
      const t = Workhub.t;
      const s = o.summary;
      const items = [
        t('Tu cuenta ({email}) y tu acceso a Kanlane.', {email:'<strong translate="no">' + esc(o.email) + '</strong>'}),
        esc(t('Tus proyectos personales ({n}), con sus tareas, notas, imágenes, clientes, contactos, reuniones y contraseñas.', {n:s.personal}))
      ];
      s.owned.forEach((team) => {
        items.push(t(team.others
          ? 'El equipo {nombre}, del que eres propietario: se elimina para todos sus miembros ({n} además de ti).'
          : 'El equipo {nombre}, del que eres propietario.',
        {nombre:'<strong translate="no">' + esc(team.nombre) + '</strong>', n:team.others}));
      });
      if(s.joined) items.push(esc(t('Tu participación en {n} equipos de otras personas: sales de ellos; lo que escribiste allí se queda en el equipo.', {n:s.joined})));
      items.push(esc(t('Las copias cifradas de tu cuenta, tus preferencias y tu foto.')));
      this.delSummary.innerHTML = items.map((html) => '<li>' + html + '</li>').join('');
      this.delPassField.hidden = !o.hasPassword;
      this.delPass.required = !!o.hasPassword;
      this.delPass.value = '';
      this.delProvider.hidden = !!o.hasPassword;
      this.delProvider.textContent = o.hasPassword ? '' : t('Al continuar se abrirá {provider} para confirmar que eres tú.', {provider:o.provider});
      this.delWord.value = '';
      this.delError.hidden = true;
      this.delProgress.hidden = true;
      this.setDeleting(false);
      this.dlgDelete.showModal();
      (o.hasPassword ? this.delPass : this.delWord).focus();
    }

    /* La palabra de confirmación, sin distinguir mayúsculas (en inglés, la traducida). */
    confirmWord(){
      return Workhub.t('ELIMINAR');
    }

    syncDelete(){
      const ok = this.delWord.value.trim().toUpperCase() === this.confirmWord().toUpperCase();
      this.delSubmit.disabled = this.deleting || !ok;
    }

    setDeleting(on){
      this.deleting = on;
      this.delCancel.disabled = on;
      this.delPass.readOnly = on;
      this.delWord.readOnly = on;
      this.dlgDelete.classList.toggle('is-busy', on);
      this.syncDelete();
    }

    showDeleteProgress(text){
      this.delProgress.textContent = Workhub.t(text);
      this.delProgress.hidden = false;
      this.delError.hidden = true;
    }

    showDeleteError(text, field){
      this.delError.textContent = Workhub.t(text);
      this.delError.hidden = false;
      this.delProgress.hidden = true;
      if(field === 'password'){ this.delPass.focus(); this.delPass.select(); }
    }
  }

  Workhub.views.AccountView = AccountView;
})();
