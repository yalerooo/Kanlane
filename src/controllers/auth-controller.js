/* Acceso con cuenta cuando Kanlane está publicado con Firebase.
   gate() devuelve una promesa que se resuelve cuando la app puede arrancar:
   al instante si Firebase no está configurado (modo local / claude.ai), o
   cuando hay una sesión iniciada. Cerrar sesión o cambiar de cuenta recarga
   la página para no mezclar datos de dos usuarios. */
(function(){
  const firebase = Workhub.services.firebase;
  const MIN_PASSWORD = 8;
  /* Datos de la sesión que se guardan en este navegador y se borran al salir. */
  const SESSION_PREFS = ['workhub_project'];
  /* Modo invitado: solo el nombre, en este navegador. Los datos van al almacén local (IndexedDB). */
  const GUEST_KEY = 'workhub_guest';
  /* «Ya entró antes en este navegador»: lo lee boot.js para pintar el esqueleto sin esperar a Firebase. */
  const SESSION_KEY = 'workhub_session';

  function guestName(){
    try{
      const g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
      return g && typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 40) : '';
    }catch(e){ return ''; }
  }

  const ERRORS = {
    'auth/invalid-email': 'El correo no es válido.',
    'auth/missing-email': 'Escribe tu correo.',
    'auth/user-not-found': 'Correo o contraseña incorrectos.',
    'auth/wrong-password': 'Correo o contraseña incorrectos.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
    'auth/missing-password': 'Escribe tu contraseña.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Inicia sesión.',
    'auth/weak-password': 'La contraseña debe tener al menos 8 caracteres.',
    'auth/password-does-not-meet-requirements': 'La contraseña no cumple los requisitos: usa al menos 8 caracteres, con mayúsculas, minúsculas y números.',
    'auth/admin-restricted-operation': 'Esta cuenta no tiene acceso a Kanlane.',
    'auth/user-disabled': 'Esta cuenta está desactivada.',
    'auth/account-exists-with-different-credential': 'Ya tienes una cuenta con ese correo usando otro método de acceso. Entra con ese método.',
    'auth/operation-not-allowed': 'Este método de acceso no está activado en Firebase (Authentication → Sign-in method).',
    'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains).',
    'auth/network-request-failed': 'Sin conexión. Comprueba tu red e inténtalo de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un momento.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de acceso. Permite las ventanas emergentes para este sitio.'
  };
  const PROVIDER_NAMES = {'github.com':'GitHub', 'google.com':'Google', 'microsoft.com':'Microsoft', 'apple.com':'Apple'};
  /* Cerrar la ventana de acceso no es un error. */
  const SILENT = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];

  function messageFor(err){
    const code = err && err.code;
    if(ERRORS[code]) return ERRORS[code];
    return 'No se pudo iniciar sesión' + (code ? ' (' + code + ')' : '') + '. Inténtalo de nuevo.';
  }

  class AuthController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.user = null;
      this.guest = '';

      this.view.bindGuest((name) => this.enterGuest(name));
      this.view.bindProvider((key) => this.signInWith(key));
      this.view.bindEmail((mode, values) => this.submitEmail(mode, values));
      this.view.bindSignOut(() => this.signOut());
    }

    isEnabled(){
      return firebase.isEnabled();
    }

    gate(){
      if(!this.isEnabled()){
        /* Sin Firebase (p. ej. dentro de claude.ai): la app se muestra ya. */
        document.documentElement.classList.remove('auth-gate');
        return Promise.resolve();
      }
      /* Invitado recordado: no se contacta con Firebase en ningún momento. */
      const guest = guestName();
      if(guest){
        this.startGuest(guest);
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        this.resolveGate = resolve;
        this.boot();
      });
    }

    /* Entra como invitado desde la pantalla de acceso. Se recarga para arrancar
       limpio con el almacén local, sin ninguna sesión de Firebase de por medio. */
    enterGuest(name){
      name = String(name || '').trim().slice(0, 40);
      if(!name) return;
      try{ localStorage.setItem(GUEST_KEY, JSON.stringify({name:name})); }catch(e){
        this.view.showMessage('Este navegador no permite guardar datos, así que no se puede usar el modo invitado.');
        return;
      }
      location.reload();
    }

    /* El almacén local (window.claude del shim) ya está activo: solo hay que mostrar la app. */
    startGuest(name){
      this.guest = name;
      this.view.hide();
      this.view.showGuest(name);
    }

    boot(){
      this.view.showLoading();
      firebase.init().then(() => {
        firebase.redirectResult().catch((err) => this.showError(err));
        firebase.onAuthChange((user) => this.onUser(user));
      }).catch(() => this.view.showLoadError(() => location.reload()));
    }

    onUser(user){
      if(user){
        if(this.user){
          /* Otra cuenta en otra pestaña: empezar de cero. */
          if(this.user.uid !== user.uid) location.reload();
          return;
        }
        this.user = user;
        if(firebase.needsVerification(user)){
          this.showVerify(user);
          return;
        }
        this.enter(user);
      } else if(this.user){
        location.reload();
      } else {
        try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
        firebase.clearLocalCache();
        /* Sesión caducada o cerrada desde otra pestaña: fuera las claves de cifrado que no sean de confianza. */
        this.purgeKeys();
        this.view.showSignIn(firebase.providers(), firebase.allowSignup());
      }
    }

    /* Sesión válida: caché local, datos del usuario y arranque de la app. */
    enter(user){
      try{ localStorage.setItem(SESSION_KEY, '1'); }catch(e){}
      this.view.showAppSkeleton();
      firebase.startSession().then(() => {
        firebase.install(user);
        this.view.hide();
        this.view.showAccount(user);
        if(this.resolveGate) this.resolveGate();
      });
    }

    /* Cuenta de correo sin verificar: no llega a la app hasta que pulse el
       enlace del correo (firestore.rules tampoco le deja leer ni guardar). */
    showVerify(user){
      this.view.showVerify(user.email, {
        check: () => firebase.refreshVerification().then((ok) => {
          if(ok) this.enter(firebase.currentUser ? firebase.currentUser() : user);
          return ok;
        }),
        resend: () => firebase.sendVerification().then(() => true, (err) => {
          this.view.showVerifyMessage(messageFor(err));
          return false;
        }),
        signOut: () => this.signOut()
      });
    }

    showError(err){
      if(err && SILENT.indexOf(err.code) !== -1) return;
      /* El correo ya tiene cuenta con otro método: se explica cómo unirlos. */
      if(err && err.code === 'auth/account-exists-with-different-credential' && err.email){
        const provider = PROVIDER_NAMES[err.credential && err.credential.providerId] || Workhub.t('el nuevo método');
        this.view.showLinkNotice(err.email, provider);
        return;
      }
      this.view.showMessage(messageFor(err));
    }

    /* Aviso de que un acceso nuevo (p. ej. GitHub) se unió a la cuenta. */
    linkedNotice(res){
      if(!res || !res.linked) return;
      const provider = PROVIDER_NAMES[res.linked] || Workhub.t('el nuevo método');
      try{ Workhub.views.toast.success(Workhub.t('Listo: ahora también puedes entrar con {provider}.', {provider:provider}), {important:true}); }catch(e){}
    }

    signInWith(key){
      this.view.clearMessage();
      this.view.setBusy(true);
      firebase.signInWith(key).then((res) => this.linkedNotice(res)).catch((err) => this.showError(err)).finally(() => this.view.setBusy(false));
    }

    submitEmail(mode, v){
      if(!v.email){ this.view.showMessage(ERRORS['auth/missing-email']); return; }
      let p;
      if(mode === 'reset'){
        p = firebase.resetPassword(v.email).then(() => {
          this.view.setMode('signin');
          this.view.showMessage('Si existe una cuenta con ' + v.email + ', te hemos enviado un enlace para cambiar la contraseña.', true);
        }).catch((err) => {
          /* No revelar si el correo tiene cuenta. */
          if(err && err.code === 'auth/user-not-found'){
            this.view.setMode('signin');
            this.view.showMessage('Si existe una cuenta con ' + v.email + ', te hemos enviado un enlace para cambiar la contraseña.', true);
          } else this.showError(err);
        });
      } else if(!v.password){
        this.view.showMessage(ERRORS['auth/missing-password']);
        return;
      } else if(mode === 'signup'){
        if(v.password.length < MIN_PASSWORD){ this.view.showMessage(ERRORS['auth/weak-password']); return; }
        /* El nombre se guarda justo después de crear la cuenta: se repinta al terminar. */
        p = firebase.signUpWithEmail(v.email, v.password, v.name).then((cred) => {
          if(this.user && cred && cred.user) this.view.showAccount(cred.user);
        }).catch((err) => this.showError(err));
      } else {
        p = firebase.signInWithEmail(v.email, v.password).then((res) => this.linkedNotice(res)).catch((err) => this.showError(err));
      }
      this.view.setBusy(true);
      p.finally(() => this.view.setBusy(false));
    }

    /* Al salir se recarga la página (onUser) y, ya sin sesión, se borra la
       copia local de los datos (clearLocalCache). */
    signOut(){
      if(this.guest){
        /* Los datos se quedan en el navegador: al volver a entrar como invitado siguen ahí. */
        try{ localStorage.removeItem(GUEST_KEY); }catch(e){}
        SESSION_PREFS.forEach((key) => { try{ localStorage.removeItem(key); }catch(e){} });
        location.reload();
        return;
      }
      if(!this.user) return;
      SESSION_PREFS.forEach((key) => { try{ localStorage.removeItem(key); }catch(e){} });
      try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
      /* Las claves de los proyectos con cifrado total se borran de este navegador, salvo en los
         dispositivos marcados como de confianza. Se espera a que termine antes de recargar. */
      const keystore = Workhub.services.keystore;
      const forget = keystore ? keystore.forgetUser(this.user.uid, {keepTrusted:true}).catch(() => null) : Promise.resolve();
      forget.then(() => firebase.signOut()).catch(() => location.reload());
    }

    purgeKeys(){
      const keystore = Workhub.services.keystore;
      if(keystore) keystore.purgeUntrusted().catch(() => {});
    }
  }

  Workhub.controllers.AuthController = AuthController;
})();
