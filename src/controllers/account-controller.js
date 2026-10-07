/* Gestión de la cuenta desde Ajustes: nombre y foto, contraseña y eliminación (lo que el RGPD
   llama rectificación y supresión, sin tener que pedirlo por correo). Solo con cuenta. */
(function(){
  const firebase = Workhub.services.firebase;
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;
  const AccountModel = Workhub.models.AccountModel;
  const PROVIDER_NAMES = {'google.com':'Google', 'github.com':'GitHub', 'microsoft.com':'Microsoft', 'apple.com':'Apple'};
  /* Lo que se enseña en el acceso tras eliminar la cuenta (la página se recarga al quedarse sin sesión). */
  const DELETED_FLAG = 'workhub_account_deleted';
  const MAX_NAME = 80;

  const ERRORS = {
    'auth/wrong-password': 'La contraseña actual no es correcta.',
    'auth/invalid-credential': 'La contraseña actual no es correcta.',
    'auth/invalid-login-credentials': 'La contraseña actual no es correcta.',
    'auth/missing-password': 'Escribe tu contraseña actual.',
    'auth/weak-password': 'La contraseña debe tener al menos 8 caracteres.',
    'auth/password-does-not-meet-requirements': 'La contraseña no cumple los requisitos: usa al menos 8 caracteres, con mayúsculas, minúsculas y números.',
    'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un momento.',
    'auth/network-request-failed': 'Sin conexión. Comprueba tu red e inténtalo de nuevo.',
    'auth/user-mismatch': 'Has confirmado con otra cuenta. Usa la misma con la que has entrado.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de acceso. Permite las ventanas emergentes para este sitio.',
    'auth/requires-recent-login': 'Por seguridad, cierra sesión, vuelve a entrar y repítelo.'
  };
  /* Hay red y aun así no se llega al servicio de acceso: no se le echa la culpa a la conexión. */
  const BLOCKED = 'No se pudo contactar con el servicio de acceso aunque tu conexión funciona. Puede estar bloqueado temporalmente, o por una extensión del navegador o un filtro de red. Espera unos minutos y vuelve a intentarlo.';
  const textFor = (err) => (firebase.accessFailure(err, firebase.isOnline()) === 'blocked' ? BLOCKED : ERRORS[err && err.code]);
  /* Cerrar la ventana de confirmación no es un error. */
  const SILENT = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];
  const WRONG_PASSWORD = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/missing-password'];

  class AccountController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.model = new AccountModel(app.models.projects, app.models.team);
      /* Foto propia (data: URL) o '' si se usa la del proveedor de acceso. */
      this.ownPhoto = '';

      this.view.bindProfile({
        name: (name) => this.saveName(name),
        photo: (file) => this.savePhoto(file),
        removePhoto: () => this.removePhoto()
      });
      this.view.bindPassword({
        open: () => this.view.openPassword(),
        submit: (current, next) => this.changePassword(current, next)
      });
      this.view.bindDelete({
        open: () => this.openDelete(),
        submit: (password) => this.deleteAccount(password)
      });
    }

    /* La cuenta que ha entrado, o null (modo local, invitado, claude.ai). */
    user(){
      return platform.mode() === 'firebase' && firebase.currentUser ? firebase.currentUser() : null;
    }

    /* Con la app ya conectada: se trae la foto propia, si la hay. */
    start(){
      if(!this.user()) return;
      this.model.readPhoto().then((photo) => {
        this.ownPhoto = photo;
        this.paint();
      }).catch(() => {});
    }

    info(){
      const user = this.user();
      if(!user) return null;
      const providers = (user.providerData || []).map((p) => p.providerId);
      const social = providers.filter((id) => id !== 'password')[0];
      const fromProvider = Workhub.utils.urls.safeUrl(user.photoURL);
      return {
        uid: user.uid,
        email: user.email || '',
        name: user.displayName || (user.email ? user.email.split('@')[0] : ''),
        photo: this.ownPhoto || (fromProvider && fromProvider.indexOf('https:') === 0 ? fromProvider : ''),
        ownPhoto: !!this.ownPhoto,
        hasPassword: firebase.hasPassword(user),
        provider: PROVIDER_NAMES[social] || Workhub.t('tu proveedor de acceso')
      };
    }

    render(){
      this.view.render(this.info());
    }

    /* Tarjeta de Ajustes y cuenta de la barra lateral, con el nombre y la foto de ahora. */
    paint(){
      const user = this.user();
      if(!user) return;
      this.render();
      this.app.controllers.auth.view.showAccount(user, this.ownPhoto);
    }

    /* ---------- Perfil ---------- */

    saveName(name){
      const user = this.user();
      if(!user) return;
      name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
      if(!name){ this.view.showProfileMessage('Escribe tu nombre.', true); return; }
      this.view.setProfileBusy(true);
      firebase.updateName(name).then(() => {
        /* Lo que se escriba desde ahora (comentarios, invitaciones) ya lleva el nombre nuevo. */
        if(this.app.rootDb && this.app.rootDb.me) this.app.rootDb.me.name = name;
        return this.model.renameInTeams(name);
      }).then(() => {
        this.view.showProfileMessage('Nombre guardado.');
        this.paint();
      }).catch((err) => this.view.showProfileMessage(textFor(err) || 'No se pudo guardar el nombre. Inténtalo de nuevo.', true))
        .finally(() => this.view.setProfileBusy(false));
    }

    savePhoto(file){
      if(!this.user()) return;
      this.view.setProfileBusy(true);
      AccountController.thumbnail(file).then((dataUrl) => this.model.savePhoto(dataUrl).then(() => {
        this.ownPhoto = dataUrl;
        this.view.showProfileMessage('Foto guardada.');
        this.paint();
      })).catch((err) => this.view.showProfileMessage(err && err.code === 'bad-photo'
        ? 'Ese archivo no es una imagen que se pueda usar.' : 'No se pudo guardar la foto. Inténtalo de nuevo.', true))
        .finally(() => this.view.setProfileBusy(false));
    }

    removePhoto(){
      if(!this.user()) return;
      this.view.setProfileBusy(true);
      this.model.removePhoto().then(() => {
        this.ownPhoto = '';
        this.view.showProfileMessage('Foto quitada.');
        this.paint();
      }).catch(() => this.view.showProfileMessage('No se pudo quitar la foto. Inténtalo de nuevo.', true))
        .finally(() => this.view.setProfileBusy(false));
    }

    /* Miniatura cuadrada de una imagen, como data: URL JPEG. */
    static thumbnail(file){
      const bad = () => { const err = new Error('bad-photo'); err.code = 'bad-photo'; return err; };
      return new Promise((resolve, reject) => {
        if(!file || !/^image\//.test(file.type || '')){ reject(bad()); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try{
            const c = AccountModel.crop(img.naturalWidth, img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = c.out;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.out, c.out);
            ctx.drawImage(img, c.sx, c.sy, c.side, c.side, 0, 0, c.out, c.out);
            const out = canvas.toDataURL('image/jpeg', 0.85);
            if(AccountModel.isPhoto(out)) resolve(out); else reject(bad());
          }catch(e){ reject(bad()); }
          URL.revokeObjectURL(url);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(bad()); };
        img.src = url;
      });
    }

    /* ---------- Contraseña ---------- */

    changePassword(current, next){
      if(!this.user()) return;
      this.view.setPasswordBusy(true);
      firebase.changePassword(current, next).then(() => {
        this.view.closePassword();
        toast.success('Contraseña cambiada', {important:true});
      }).catch((err) => {
        this.view.setPasswordBusy(false);
        const code = err && err.code;
        this.view.showPasswordError(textFor(err) || 'No se pudo cambiar la contraseña. Inténtalo de nuevo.',
          WRONG_PASSWORD.indexOf(code) !== -1 ? 'current' : 'new');
      });
    }

    /* ---------- Eliminar la cuenta ---------- */

    openDelete(){
      const info = this.info();
      if(!info) return;
      if(!this.app.models.projects.loaded){ toast.error('El tablero todavía se está cargando, prueba de nuevo en unos segundos.'); return; }
      this.view.openDelete({email:info.email, hasPassword:info.hasPassword, provider:info.provider, summary:this.model.summary()});
    }

    /* Primero se confirma que es su dueño (contraseña, o la ventana de su proveedor): así no se
       borra nada si luego no se pudiera eliminar la cuenta. Después el contenido y, al final, la
       cuenta. Al quedarse sin sesión la página se recarga (AuthController.onUser) y el acceso lo
       confirma. Si el borrado se corta, la cuenta sigue existiendo y se puede repetir. */
    deleteAccount(password){
      const user = this.user();
      if(!user || this.deleting) return;
      if(typeof navigator !== 'undefined' && navigator.onLine === false){
        this.view.showDeleteError('Sin conexión. Para eliminar la cuenta hace falta conexión.');
        return;
      }
      const uid = user.uid;
      this.deleting = true;
      /* Mientras desaparecen los proyectos no se ofrece crear el primero (ProjectsController), no se
         guardan copias automáticas y las preferencias dejan de subirse solas a la cuenta. */
      this.app.closingAccount = true;
      this.app.models.settings.disconnect();
      this.view.setDeleting(true);
      this.view.showDeleteProgress('Confirmando que eres tú…');
      firebase.reauthenticate(password).then(() => {
        return this.model.wipe((text) => this.view.showDeleteProgress(text)).then(() => {
          this.view.showDeleteProgress('Eliminando tu cuenta…');
          this.forgetBrowser(uid);
          try{ sessionStorage.setItem(DELETED_FLAG, '1'); }catch(e){}
          return firebase.deleteUser();
        }, (err) => {
          const failed = new Error('wipe-failed');
          failed.code = 'wipe-failed';
          failed.cause = err;
          throw failed;
        });
      }).catch((err) => {
        this.deleting = false;
        this.app.closingAccount = false;
        if(this.app.rootDb) this.app.models.settings.connect(this.app.rootDb);
        try{ sessionStorage.removeItem(DELETED_FLAG); }catch(e){}
        this.view.setDeleting(false);
        const code = err && err.code;
        if(SILENT.indexOf(code) !== -1){ this.view.showDeleteError('No se ha confirmado tu identidad: no se ha borrado nada.'); return; }
        if(code === 'wipe-failed'){
          this.view.showDeleteError('No se pudo borrar todo tu contenido. Tu cuenta sigue existiendo: comprueba la conexión y vuelve a intentarlo para terminar.');
          return;
        }
        this.view.showDeleteError(textFor(err) ? (WRONG_PASSWORD.indexOf(code) !== -1 ? 'La contraseña no es correcta.' : textFor(err))
          : 'No se pudo eliminar la cuenta. Inténtalo de nuevo.', WRONG_PASSWORD.indexOf(code) !== -1 ? 'password' : '');
      });
    }

    /* Lo que este navegador guarda de la cuenta: claves de cifrado, la clave de las copias en la
       nube, el acceso a GitHub y las marcas de sesión. */
    forgetBrowser(uid){
      const keystore = Workhub.services.keystore;
      if(keystore) keystore.forgetUser(uid).catch(() => {});
      try{ Workhub.services.cloudBackup.forgetKey(uid); }catch(e){}
      ['workhub_session', 'workhub_project', 'workhub_gh_token'].forEach((key) => { try{ localStorage.removeItem(key); }catch(e){} });
    }

    /* ¿Se acaba de eliminar una cuenta en esta pestaña? (lo pregunta el acceso, una sola vez) */
    static takeDeleted(){
      try{
        const was = sessionStorage.getItem(DELETED_FLAG) === '1';
        sessionStorage.removeItem(DELETED_FLAG);
        return was;
      }catch(e){ return false; }
    }
  }

  Workhub.controllers.AccountController = AccountController;
})();
