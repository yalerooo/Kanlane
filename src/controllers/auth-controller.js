/* Acceso con cuenta cuando Kanlane está publicado con Firebase.
   gate() devuelve una promesa que se resuelve cuando la app puede arrancar:
   al instante si Firebase no está configurado (modo local / claude.ai), o
   cuando hay una sesión iniciada. Cerrar sesión o cambiar de cuenta recarga
   la página para no mezclar datos de dos usuarios. */
(function(){
  const firebase = Workhub.services.firebase;
  const platform = Workhub.services.platform;
  const migration = Workhub.models.guestMigration;
  const MIN_PASSWORD = 8;
  /* Margen tras volver de la ventana de acceso antes de soltar los botones (ms): da tiempo a que
     un acceso correcto entre en la app sin que el formulario parpadee. */
  const POPUP_GRACE = 600;
  /* Datos de la sesión que se guardan en este navegador y se borran al salir. */
  const SESSION_PREFS = ['workhub_project'];
  /* Modo invitado: solo el nombre, en este navegador. Los datos van al almacén local (IndexedDB). */
  const GUEST_KEY = 'workhub_guest';
  /* «Ya entró antes en este navegador»: lo lee boot.js para pintar el esqueleto sin esperar a Firebase. */
  const SESSION_KEY = 'workhub_session';

  /* Invitados que han usado este navegador y siguen teniendo aquí sus datos: [{id, name, at}], el
     más reciente primero. Cada uno tiene su base de datos (core/local-storage-shim.js); id '' es
     la base de siempre, la de quien fue invitado antes de que hubiera una por persona. */
  const GUESTS_KEY = 'workhub_guests';
  const MAX_GUESTS = 5;

  /* El invitado que está dentro: {name, id}, o null. */
  function currentGuest(){
    try{
      const g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
      const name = g && typeof g.name === 'string' ? g.name.trim().slice(0, 40) : '';
      return name ? {name:name, id:typeof g.id === 'string' ? g.id : ''} : null;
    }catch(e){ return null; }
  }

  function knownGuests(){
    try{
      const list = JSON.parse(localStorage.getItem(GUESTS_KEY) || '[]');
      return (Array.isArray(list) ? list : []).filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string')
        .map((g) => ({id:g.id, name:g.name.slice(0, 40), at:+g.at || 0}));
    }catch(e){ return []; }
  }

  function saveGuests(list){
    try{ localStorage.setItem(GUESTS_KEY, JSON.stringify(list.slice(0, MAX_GUESTS))); }catch(e){}
  }

  function rememberGuest(guest){
    saveGuests([{id:guest.id, name:guest.name, at:Date.now()}].concat(knownGuests().filter((g) => g.id !== guest.id)));
  }

  function forgetGuest(id){
    saveGuests(knownGuests().filter((g) => g.id !== id));
  }

  /* Los datos de invitado solo se llevan a una cuenta NUEVA, nunca a una que ya existía. Lo es si
     no ha vuelto a iniciar sesión desde que se creó (alta y último acceso coinciden: las dos fechas
     las pone el servidor), o si se creó después de pedir la copia (`at`, cuando se pulsó «Crear
     cuenta y llevarme mis datos»): cubre a quien crea la cuenta, sale y vuelve a entrar. */
  const SAME_SIGN_IN = 1000;
  function isNewAccount(user, at){
    const meta = (user && user.metadata) || {};
    const created = Date.parse(meta.creationTime || '');
    const last = Date.parse(meta.lastSignInTime || '');
    if(!isFinite(created)) return false;
    return (isFinite(last) && Math.abs(last - created) < SAME_SIGN_IN) || (!!at && created >= at);
  }
  /* Lo que se espera a la copia con su pantalla delante. Si tarda más (conexión lenta o cortada: las
     escrituras de Firestore no terminan hasta que el servidor contesta), se entra en la app y la
     copia sigue por detrás. */
  const MIGRATE_WAIT = 15000;

  function newGuestId(){
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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
  /* Errores que se enseñan pegados a su campo; el resto va en el aviso general del formulario. */
  const FIELD_OF = {
    'auth/invalid-email':'email', 'auth/missing-email':'email', 'auth/email-already-in-use':'email',
    'auth/user-not-found':'password', 'auth/wrong-password':'password', 'auth/invalid-credential':'password',
    'auth/invalid-login-credentials':'password', 'auth/missing-password':'password', 'auth/weak-password':'password',
    'auth/password-does-not-meet-requirements':'password'
  };
  /* Forma de un correo: algo@algo.algo, sin espacios. Lo demás lo decide el servidor. */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PROVIDER_NAMES ={'github.com':'GitHub', 'google.com':'Google', 'microsoft.com':'Microsoft', 'apple.com':'Apple'};
  /* Cerrar la ventana de acceso no es un error. */
  const SILENT = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];

  /* Hay red y aun así no se llega al servicio de acceso: no se le echa la culpa a la conexión. */
  const BLOCKED = 'No se pudo contactar con el servicio de acceso aunque tu conexión funciona. Puede estar bloqueado temporalmente, o por una extensión del navegador o un filtro de red. Espera unos minutos y vuelve a intentarlo.';

  function messageFor(err){
    const code = err && err.code;
    if(firebase.accessFailure(err, firebase.isOnline()) === 'blocked') return BLOCKED;
    if(ERRORS[code]) return ERRORS[code];
    return 'No se pudo iniciar sesión' + (code ? ' (' + code + ')' : '') + '. Inténtalo de nuevo.';
  }

  class AuthController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.user = null;
      this.guest = '';
      this.guestId = '';

      this.view.bindGuest((name, id) => this.enterGuest(name, id));
      this.view.bindUpgrade(() => this.upgradeGuest());
      this.view.bindMigrateCancel(() => this.cancelUpgrade());
      this.view.bindProvider((key) => this.signInWith(key));
      this.view.bindEmail((mode, values) => this.submitEmail(mode, values));
      this.view.bindSignOut(() => this.signOut());
      /* Antes de entrar no hay cuenta: el tema se queda en este navegador. */
      this.view.bindTheme((theme) => this.app.controllers.settings.setTheme(theme));
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
      const guest = currentGuest();
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
       limpio con el almacén local, sin ninguna sesión de Firebase de por medio.
       Sin id es alguien nuevo: estrena su propia base de datos, vacía, y no ve lo de quien
       fuera invitado antes en este navegador. Con id (aunque sea '') vuelve uno de los de antes. */
    enterGuest(name, id){
      name = String(name || '').trim().slice(0, 40);
      if(!name) return;
      const guest = {name:name, id:typeof id === 'string' ? id : newGuestId()};
      try{ localStorage.setItem(GUEST_KEY, JSON.stringify(guest)); }catch(e){
        this.view.showMessage('Este navegador no permite guardar datos, así que no se puede usar el modo invitado.');
        return;
      }
      rememberGuest(guest);
      /* Vuelve a ser invitado: ya no hay nada pendiente de llevar a una cuenta. */
      migration.clear();
      location.reload();
    }

    /* Invitados de antes con datos en este navegador, para ofrecer «Continuar como…». Quien salió
       antes de que se apuntaran no está en la lista: se mira si la base de siempre tiene algo. */
    previousGuests(){
      const list = knownGuests();
      const local = window.__localStore;
      if(!local || local.guestId || list.some((g) => !g.id)) return Promise.resolve(list);
      return Promise.all(['projects', 'tasks'].map((name) => local.db.collection(name).get()))
        .then((snaps) => (snaps.some((s) => s.docs.length) ? list.concat({id:'', name:'', at:0}) : list))
        .catch(() => list);
    }

    /* «Crear cuenta y llevarme mis datos»: se apunta en este navegador y se va a la pantalla de
       acceso (abierta en «Crear cuenta»). Los datos siguen donde están; se copian a la cuenta
       que entre (bringGuestData). Hasta entonces se puede volver atrás (cancelUpgrade). */
    upgradeGuest(){
      if(!this.guest) return;
      if(!migration.request(this.guest, this.app.projectId, this.guestId)) return;
      /* Al entrar con la cuenta se abre el tablero, no Ajustes (desde donde se suele pedir). */
      this.app.navigate('tasks');
      rememberGuest({name:this.guest, id:this.guestId});
      try{ localStorage.removeItem(GUEST_KEY); }catch(e){}
      location.assign(location.pathname + '?registro');
    }

    /* «Seguir como invitado» desde la pantalla de acceso. */
    cancelUpgrade(){
      const state = migration.pending();
      if(state) this.enterGuest(state.name || Workhub.t('Invitado'), state.id || '');
    }

    /* Con una cuenta ya dentro: copia a ella los datos del modo invitado, si se pidió. Va antes de
       arrancar la app, así al abrirse ya están. Nunca se rechaza: si algo falla se entra igual, los
       datos siguen en este navegador y se vuelve a intentar en la siguiente carga.
       Solo a una cuenta nueva: si la que entra ya existía no se copia nada (lo pendiente sigue
       apuntado, por si después se crea una). Y no se espera sin fin: pasado MIGRATE_WAIT se entra
       en la app y la copia termina por detrás (ver enterWhileCopying). */
    bringGuestData(user){
      const local = window.__localStore;
      /* Solo los datos del invitado que lo pidió: la base abierta tiene que ser la suya. */
      const mine = (state) => !!state && !!local && (state.id || '') === local.guestId;
      const pending = migration.pending();
      if(!mine(pending)) return Promise.resolve();
      if(!isNewAccount(user, pending.at)){
        this.migrated = {existing:true};
        return Promise.resolve();
      }
      this.view.showMigrating();
      this.migrating = true;
      /* De una en una: con la app en dos pestañas (p. ej. al volver del correo de verificación) la
         segunda espera, y si la primera ya lo ha hecho no queda nada pendiente. */
      const copy = () => {
        const state = migration.pending();
        if(!mine(state)) return Promise.resolve(null);
        return Promise.all([platform.connectDb(), platform.connectAssets()]).then((r) => migration.run({
          from: local.db, to: r[0], state: state, save: migration.save,
          assets: {read: (id) => local.blob(id), upload: (blob) => r[1].upload(blob), uploadFile: (blob) => r[1].uploadFile(blob)},
          onPlan: (plan) => { this.copyPlan = plan; }
        })).then((res) => this.afterCopy(res, state, local));
      };
      const locks = navigator.locks;
      const done = (locks && locks.request ? locks.request('workhub-guest-migrate', copy) : copy())
        .catch(() => { this.migrated = {failed:true}; }).then(() => {
          this.migrating = false;
          if(!this.copyingBehind) return;
          /* Ya dentro de la app: se avisa ahora, y se comprueba lo que se dejó para después. */
          this.copyingBehind = false;
          this.reportMigration();
          this.app.controllers.projects.checkFirstRun();
        });
      const wait = new Promise((resolve) => setTimeout(resolve, MIGRATE_WAIT));
      return Promise.race([done, wait]).then(() => {
        if(this.migrating) this.enterWhileCopying();
        this.view.showAppSkeleton();
      });
    }

    /* La copia tarda: se entra en la app con ella en marcha. Lo ya escrito se ve (Firestore lo
       enseña desde su copia local aunque el servidor no haya contestado) y el resto va llegando.
       Mientras, no se ofrece crear el primer proyecto (ProjectsController.checkFirstRun) y lo
       pendiente sigue apuntado: si se recarga, la copia se retoma sin duplicar nada. */
    enterWhileCopying(){
      this.copyingBehind = true;
      this.migrated = {slow:true};
      const open = this.copyPlan && this.copyPlan.open;
      if(open) this.openMigrated(open);
    }

    /* Abre el proyecto de la cuenta que corresponde al que el invitado tenía abierto. */
    openMigrated(project){
      const projects = this.app.controllers.projects;
      if(!this.app.rootDb){
        /* La app aún no ha arrancado: empieza ya en él. */
        this.app.projectId = project.id;
        this.app.rememberProject(project);
        /* Puede no estar todavía en la lista: que no se cambie a otro mientras llega. */
        projects.justCreated = project.id;
      }else if(this.app.projectId !== project.id){
        projects.pendingSwitch = project.id;
        projects.onProjectsChange();
      }
    }

    /* La copia ha terminado: nada pendiente, y se abre el proyecto que el invitado tenía abierto. */
    afterCopy(res, state, local){
      if(!res) return null;
      migration.clear();
      /* «?registro» ya cumplió: fuera de la dirección, para que recargar no lo repita. */
      try{ history.replaceState(null, '', location.pathname); }catch(e){}
      if(res.open) this.openMigrated(res.open);
      this.migrated = res;
      /* Todo está en la cuenta: no se deja una copia en este navegador, y ese invitado deja de
         ofrecerse en el acceso. Si algo no se pudo copiar, se queda aquí para no perderlo (se ve
         entrando otra vez como ese invitado). */
      if(res.skipped) return null;
      forgetGuest(state.id || '');
      return local.wipe().catch(() => null);
    }

    /* Ya dentro de la app: se cuenta cómo ha ido la copia de los datos de invitado. */
    reportMigration(){
      const res = this.migrated;
      if(!res) return;
      this.migrated = null;
      const toast = Workhub.views.toast;
      const t = Workhub.t;
      if(res.existing) toast.error(t('Esta cuenta ya existía, así que no hemos copiado tus datos de invitado: solo se llevan a una cuenta nueva. Siguen en este navegador; cierra sesión y crea una cuenta nueva, o continúa como invitado.'), {important:true});
      else if(res.slow) toast.success(t('Tus datos de invitado se están terminando de copiar a tu cuenta. No cierres esta pestaña.'), {important:true});
      else if(res.failed) toast.error(t('No se pudieron copiar tus datos de invitado. Siguen en este navegador: recarga la página para volver a intentarlo.'), {important:true});
      else if(res.skipped) toast.error(t('Tus datos de invitado ya están en tu cuenta, salvo {n} elementos que no se pudieron copiar. Esos siguen en este navegador, en el modo invitado.', {n:res.skipped}), {important:true});
      else if(res.projects.length) toast.success(t('Tus datos de invitado ya están en tu cuenta.'), {important:true});
    }

    /* El almacén local (window.claude del shim) ya está activo: solo hay que mostrar la app. */
    startGuest(guest){
      this.guest = guest.name;
      this.guestId = guest.id;
      this.view.hide();
      this.view.showGuest(guest.name);
    }

    boot(){
      this.view.showLoading();
      firebase.init().then(() => {
        firebase.redirectResult().catch((err) => this.showError(err));
        firebase.onAuthChange((user) => this.onUser(user));
      }).catch((err) => this.loadError(err));
    }

    /* No se llegó al servicio de acceso: se distingue estar sin red de que el servicio no conteste. */
    loadError(err){
      this.view.showLoadError(() => location.reload(), firebase.accessFailure(err, firebase.isOnline()) === 'blocked');
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
        /* Se acaba de eliminar la cuenta desde Ajustes: se confirma aquí, ya sin sesión. */
        if(Workhub.controllers.AccountController.takeDeleted()) this.view.showMessage(Workhub.t('Tu cuenta y todo tu contenido se han eliminado.'), true);
        this.previousGuests().then((list) => this.view.showGuests(list));
        /* Viene de «Crear cuenta y llevarme mis datos»: se avisa de que se copiarán al entrar. */
        const move = migration.pending();
        if(move) this.view.showMigrate(move.name);
      }
    }

    /* Sesión válida: caché local, datos del usuario y arranque de la app. */
    enter(user){
      try{ localStorage.setItem(SESSION_KEY, '1'); }catch(e){}
      /* El idioma se cambió en la pantalla de acceso sin recargar: dentro de la app hay textos
         calculados con el anterior. Se recarga una vez (la sesión ya está iniciada y la página
         vuelve directamente a la app, en el idioma nuevo). */
      if(Workhub.i18n.stale){
        Promise.resolve(this.view.celebrate()).then(() => location.reload());
        return;
      }
      /* Si se entra desde el formulario, la pantalla de acceso se queda un instante con la
         señal de «hecho» mientras se preparan los datos (no añade espera si tardan más que ella).
         Si ya había sesión al abrir la página, va directo al esqueleto de la app. */
      const beat = this.view.celebrate();
      if(!beat) this.view.showAppSkeleton();
      Promise.all([firebase.startSession(), beat]).then(() => {
        if(beat) this.view.showAppSkeleton();
        firebase.install(user);
        this.bringGuestData(user).then(() => {
          this.view.hide();
          this.view.showAccount(user);
          if(this.resolveGate) this.resolveGate();
          this.reportMigration();
        });
        /* Firestore se carga aparte del acceso (firebase.init): si no llegó, se avisa. */
      }, (err) => this.loadError(err));
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
      const field = err && FIELD_OF[err.code];
      if(field) this.view.showFieldError(field, messageFor(err));
      else this.view.showMessage(messageFor(err));
    }

    /* Aviso de que un acceso nuevo (p. ej. GitHub) se unió a la cuenta. */
    linkedNotice(res){
      if(!res || !res.linked) return;
      const provider = PROVIDER_NAMES[res.linked] || Workhub.t('el nuevo método');
      try{ Workhub.views.toast.success(Workhub.t('Listo: ahora también puedes entrar con {provider}.', {provider:provider}), {important:true}); }catch(e){}
    }

    signInWith(key){
      this.view.clearMessage();
      const turn = this.hold(key);
      /* Firebase tarda varios segundos en darse cuenta de que se ha cerrado la ventana de acceso.
         No se espera a eso: en cuanto esta página recupera el foco, los botones vuelven a servir.
         Si la ventana se cerró porque el acceso salió bien, la app entra igualmente. */
      let timer = 0;
      const back = () => { timer = setTimeout(() => this.release(turn), POPUP_GRACE); };
      window.addEventListener('focus', back, {once:true});
      firebase.signInWith(key).then((res) => this.linkedNotice(res)).catch((err) => {
        /* Un intento que ya se dio por abandonado no pinta errores sobre el siguiente. */
        if(this.busyTurn === turn || !this.busyTurn) this.showError(err);
      }).finally(() => {
        window.removeEventListener('focus', back);
        clearTimeout(timer);
        this.release(turn);
      });
    }

    /* Ocupa el formulario y devuelve el turno; solo ese turno puede liberarlo (un intento anterior
       que termina tarde no desbloquea el siguiente). */
    hold(who){
      this.turns = (this.turns || 0) + 1;
      this.busyTurn = this.turns;
      this.view.setBusy(true, who);
      return this.busyTurn;
    }

    release(turn){
      if(this.busyTurn !== turn) return;
      this.busyTurn = 0;
      this.view.setBusy(false);
    }

    submitEmail(mode, v){
      if(!v.email){ this.view.showFieldError('email', ERRORS['auth/missing-email']); return; }
      if(!EMAIL_RE.test(v.email)){ this.view.showFieldError('email', ERRORS['auth/invalid-email']); return; }
      let p;
      if(mode === 'reset'){
        /* No revelar si el correo tiene cuenta: «no existe» cuenta como enviado. */
        const send = () => firebase.resetPassword(v.email).catch((err) => {
          if(!err || err.code !== 'auth/user-not-found') throw err;
        });
        p = send().then(() => {
          this.view.showResetSent(v.email, () => send().then(() => true, () => false));
        }).catch((err) => this.showError(err));
      } else if(!v.password){
        this.view.showFieldError('password', ERRORS['auth/missing-password']);
        return;
      } else if(mode === 'signup'){
        if(Array.from(v.password).length < MIN_PASSWORD){ this.view.showFieldError('password', ERRORS['auth/weak-password']); return; }
        /* El nombre se guarda justo después de crear la cuenta: se repinta al terminar. */
        p = firebase.signUpWithEmail(v.email, v.password, v.name).then((cred) => {
          if(this.user && cred && cred.user) this.view.showAccount(cred.user);
        }).catch((err) => this.showError(err));
      } else {
        p = firebase.signInWithEmail(v.email, v.password).then((res) => this.linkedNotice(res)).catch((err) => this.showError(err));
      }
      const turn = this.hold('submit');
      p.finally(() => this.release(turn));
    }

    /* Al salir se recarga la página (onUser) y, ya sin sesión, se borra la
       copia local de los datos (clearLocalCache). */
    signOut(){
      if(this.guest){
        /* Los datos se quedan en el navegador, en la base de este invitado: puede volver a ellos
           desde la pantalla de acceso («Continuar como…»). Quien entre como otro invitado no los ve. */
        rememberGuest({name:this.guest, id:this.guestId});
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
