/* Acceso con cuenta cuando Workhub está publicado con Firebase.
   gate() devuelve una promesa que se resuelve cuando la app puede arrancar:
   al instante si Firebase no está configurado (modo local / claude.ai), o
   cuando hay una sesión iniciada. Cerrar sesión o cambiar de cuenta recarga
   la página para no mezclar datos de dos usuarios. */
(function(){
  const firebase = Workhub.services.firebase;
  const MIN_PASSWORD = 8;
  /* Datos de la sesión que se guardan en este navegador y se borran al salir. */
  const SESSION_PREFS = ['workhub_project'];

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
    'auth/admin-restricted-operation': 'Esta cuenta no tiene acceso a Workhub.',
    'auth/user-disabled': 'Esta cuenta está desactivada.',
    'auth/account-exists-with-different-credential': 'Ya tienes una cuenta con ese correo usando otro método de acceso. Entra con ese método.',
    'auth/operation-not-allowed': 'Este método de acceso no está activado en Firebase (Authentication → Sign-in method).',
    'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains).',
    'auth/network-request-failed': 'Sin conexión. Comprueba tu red e inténtalo de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un momento.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de acceso. Permite las ventanas emergentes para este sitio.'
  };
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
      return new Promise((resolve) => {
        this.resolveGate = resolve;
        this.boot();
      });
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
        this.view.showLoading();
        /* Solo las cuentas de la lista de acceso (firestore.rules) llegan a la
           app. Es un aviso: quien impide leer o guardar datos es el servidor. */
        firebase.startSession(user).then((access) => {
          if(access === 'denied'){
            this.view.showNoAccess(user, () => this.signOut());
            return;
          }
          firebase.install(user);
          this.view.hide();
          this.view.showAccount(user);
          if(this.resolveGate) this.resolveGate();
        });
      } else if(this.user){
        location.reload();
      } else {
        firebase.clearLocalCache();
        this.view.showSignIn(firebase.providers(), firebase.allowSignup());
      }
    }

    showError(err){
      if(err && SILENT.indexOf(err.code) !== -1) return;
      this.view.showMessage(messageFor(err));
    }

    signInWith(key){
      this.view.clearMessage();
      this.view.setBusy(true);
      firebase.signInWith(key).catch((err) => this.showError(err)).finally(() => this.view.setBusy(false));
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
        p = firebase.signInWithEmail(v.email, v.password).catch((err) => this.showError(err));
      }
      this.view.setBusy(true);
      p.finally(() => this.view.setBusy(false));
    }

    /* Al salir se recarga la página (onUser) y, ya sin sesión, se borra la
       copia local de los datos (clearLocalCache). */
    signOut(){
      if(!this.user) return;
      SESSION_PREFS.forEach((key) => { try{ localStorage.removeItem(key); }catch(e){} });
      firebase.signOut().catch(() => location.reload());
    }
  }

  Workhub.controllers.AuthController = AuthController;
})();
