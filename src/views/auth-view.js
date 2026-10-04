/* Pantalla de acceso: botones de proveedores (Google, GitHub…) y formulario
   de correo con tres modos: entrar, crear cuenta y recuperar contraseña.
   También pinta la cuenta en la barra lateral y en Ajustes. */
(function(){
  const {esc, initials, hueFor} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  const PROVIDERS = {
    google: {label:'Continuar con Google', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6H1.4a12 12 0 0 0 0 10.9l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>'},
    github: {label:'Continuar con GitHub', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"/></svg>'},
    microsoft: {label:'Continuar con Microsoft', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M1 1h10.5v10.5H1z"/><path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z"/><path fill="#00A4EF" d="M1 12.5h10.5V23H1z"/><path fill="#FFB900" d="M12.5 12.5H23V23H12.5z"/></svg>'},
    apple: {label:'Continuar con Apple', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.5a10 10 0 0 0 1.4-2.8 4.4 4.4 0 0 1-2.1-4.1zM13.9 5.1a4.4 4.4 0 0 0 1-3.2 4.5 4.5 0 0 0-2.9 1.5 4.2 4.2 0 0 0-1.1 3.1c1.1.1 2.2-.5 3-1.4z"/></svg>'}
  };

  const TEXT = {
    signin: {title:'Inicia sesión', sub:'Accede a tu espacio de trabajo.', submit:'Iniciar sesión', switchText:'¿No tienes cuenta?', switchLink:'Crear una'},
    signup: {title:'Crea tu cuenta', sub:'Empieza a organizar el trabajo de tus clientes.', submit:'Crear cuenta', switchText:'¿Ya tienes cuenta?', switchLink:'Iniciar sesión'},
    reset: {title:'Recupera tu contraseña', sub:'Te enviaremos un enlace para crear una nueva.', submit:'Enviar enlace', switchText:'¿La recuerdas?', switchLink:'Volver a iniciar sesión'}
  };

  class AuthView {
    constructor(){
      this.screen = $('authScreen');
      this.loading = $('authLoading');
      this.panel = $('authPanel');
      this.title = $('authTitle');
      this.sub = $('authSub');
      this.providersEl = $('authProviders');
      this.divider = $('authDivider');
      this.form = $('authEmailForm');
      this.nameField = $('authNameField');
      this.name = $('authName');
      this.email = $('authEmail');
      this.passField = $('authPassField');
      this.pass = $('authPass');
      this.forgot = $('authForgot');
      this.msg = $('authMsg');
      this.notice = $('authNotice');
      this.submit = $('authSubmit');
      this.switchWrap = $('authSwitch');
      this.switchText = $('authSwitchText');
      this.switchLink = $('authSwitchLink');
      this.guest = $('authGuest');
      this.guestBtn = $('authGuestBtn');
      this.alt = $('authAlt');
      this.guestForm = $('authGuestForm');
      this.guestName = $('authGuestName');
      this.guestMsg = $('authGuestMsg');
      /* La portada enlaza a /app/?registro para abrir directamente «Crear cuenta». */
      this.registroRequested = /[?&]registro(=|&|$)/.test(location.search);
      this.mode = 'signin';
      this.hasPassword = true;
      this.allowSignup = true;

      this.accountBox = $('accountBox');
      this.accountAvatar = $('accountAvatar');
      this.accountName = $('accountName');
      this.accountMail = $('accountMail');
      this.settingsAccount = $('settingsAccount');
      this.settingsAccountLabel = $('settingsAccountLabel');
      this.settingsAccountMail = $('settingsAccountMail');

      /* Idioma en la pantalla de acceso (antes de entrar no hay cuenta). */
      $('authLang').addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-lang-choice]');
        if(b) Workhub.i18n.setLang(b.getAttribute('data-lang-choice'));
      });
      $('authLang').querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-lang-choice') === Workhub.i18n.lang ? 'true' : 'false');
      });

      this.buildScene();

      /* Ver u ocultar la contraseña mientras se escribe. */
      this.passToggle = $('authPassToggle');
      this.passToggle.addEventListener('click', () => this.setPassVisible(this.pass.type === 'password'));

      this.switchLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.setMode(this.mode === 'signin' ? 'signup' : 'signin');
      });
      this.guestBtn.addEventListener('click', () => this.setGuestStep(true));
      $('authGuestBack').addEventListener('click', () => this.setGuestStep(false));
      this.forgot.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.setMode('reset');
      });
    }

    /* Paisaje en 3D de detrás del acceso (src/views/auth-scene.js). Si no hay WebGL se queda
       el degradado de cielo de auth.css. */
    buildScene(){
      const canvas = $('authCanvas');
      if(canvas && Workhub.views.authScene) Workhub.views.authScene.start(canvas, this.screen, $('authWindow'));
    }

    /* ---------- Eventos hacia el controlador ---------- */

    bindProvider(handler){
      this.providersEl.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-provider]');
        if(btn) handler(btn.getAttribute('data-provider'));
      });
    }

    /* handler(mode, {name, email, password}) */
    bindEmail(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.clearMessage();
        handler(this.mode, {name:this.name.value.trim(), email:this.email.value.trim(), password:this.pass.value});
      });
    }

    /* handler(nombre) */
    bindGuest(handler){
      this.guestForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.guestMsg.hidden = true;
        const name = this.guestName.value.trim();
        if(!name){
          this.guestMsg.textContent = 'Escribe tu nombre.';
          this.guestMsg.hidden = false;
          return;
        }
        handler(name);
      });
    }

    /* handler('light' | 'dark'): el botón de sol/luna de la pantalla de acceso. */
    bindTheme(handler){
      const btn = $('authTheme');
      btn.addEventListener('click', () => {
        const attr = document.documentElement.getAttribute('data-theme');
        const dark = attr ? attr === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
        Workhub.utils.ui.themeSwitch(btn, () => handler(dark ? 'light' : 'dark'));
      });
    }

    bindSignOut(handler){
      $('btnSignOut').addEventListener('click', handler);
      $('btnSignOutSettings').addEventListener('click', handler);
    }

    /* ---------- Estados ---------- */

    /* Comprobando la sesión: no se pinta nada (negro), o el esqueleto de la página si ya
       había entrado antes (lo pone boot.js). Solo aparece algo si hay que iniciar sesión. */
    showLoading(){
      this.screen.hidden = true;
    }

    /* Ya hay sesión y se están cargando los datos: esqueleto de la página principal. */
    showAppSkeleton(){
      document.documentElement.classList.add('skel-on');
      this.screen.hidden = true;
    }

    showLoadError(onRetry){
      window.__hideBootSkeleton();
      this.screen.hidden = false;
      this.panel.hidden = true;
      this.loading.hidden = false;
      this.loading.classList.add('is-error');
      this.loading.innerHTML = '<span>No se pudo conectar con el servicio de acceso. Comprueba tu conexión.</span>';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.textContent = 'Reintentar';
      btn.addEventListener('click', onRetry);
      this.loading.appendChild(btn);
    }

    /* providers: lista de claves ('google', 'github', …, 'password').
       allowSignup: false oculta "Crear una cuenta". */
    showSignIn(providers, allowSignup){
      window.__hideBootSkeleton();
      document.body.classList.add('is-authing');
      this.screen.hidden = false;
      this.loading.hidden = true;
      this.panel.hidden = false;
      const social = providers.filter((p) => PROVIDERS[p]);
      this.hasPassword = providers.indexOf('password') !== -1;
      this.providersEl.innerHTML = social.map((p) =>
        '<button type="button" class="auth-provider" data-provider="' + p + '" title="' + esc(Workhub.t(PROVIDERS[p].label)) + '" aria-label="' + esc(Workhub.t(PROVIDERS[p].label)) + '">' +
          PROVIDERS[p].icon + '<span translate="no">' + esc(PROVIDERS[p].label.replace('Continuar con ', '')) + '</span></button>'
      ).join('');
      this.providersEl.hidden = !social.length;
      this.divider.hidden = !social.length || !this.hasPassword;
      this.form.hidden = !this.hasPassword;
      this.allowSignup = allowSignup !== false;
      this.setGuestStep(false);
      /* Venir de «Crear cuenta» en la portada abre directamente el registro (una sola vez). */
      const wantsSignup = this.registroRequested && this.hasPassword && this.allowSignup;
      this.registroRequested = false;
      this.setMode(wantsSignup ? 'signup' : 'signin');
    }

    /* Cuenta de correo sin verificar. handlers: {check() → Promise<bool>,
       resend() → Promise<bool>, signOut()} */
    showVerify(email, handlers){
      window.__hideBootSkeleton();
      document.body.classList.add('is-authing');
      this.screen.hidden = false;
      this.panel.hidden = true;
      this.loading.hidden = false;
      this.loading.classList.remove('is-error');
      this.loading.classList.add('is-verify');
      this.loading.textContent = '';
      const title = document.createElement('strong');
      title.textContent = 'Verifica tu correo';
      const text = document.createElement('span');
      text.textContent = 'Te hemos enviado un enlace a ' + (email || 'tu correo') + '. Ábrelo para activar la cuenta y después pulsa "Ya lo he verificado". Si no lo ves, mira en la carpeta de spam.';
      this.verifyMsg = document.createElement('span');
      this.verifyMsg.className = 'auth-verify-msg';
      this.verifyMsg.setAttribute('role', 'status');
      const actions = document.createElement('div');
      actions.className = 'auth-noaccess-actions';
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'btn btn-primary';
      check.textContent = 'Ya lo he verificado';
      const resend = document.createElement('button');
      resend.type = 'button';
      resend.className = 'btn btn-ghost';
      resend.textContent = 'Reenviar correo';
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'btn btn-ghost';
      out.textContent = 'Usar otra cuenta';
      check.addEventListener('click', () => {
        check.disabled = true;
        handlers.check().then((ok) => {
          if(!ok) this.showVerifyMessage('Todavía no consta como verificado. Abre el enlace del correo y vuelve a probar.');
        }, () => this.showVerifyMessage('No se pudo comprobar. Revisa tu conexión.')).finally(() => { check.disabled = false; });
      });
      resend.addEventListener('click', () => {
        resend.disabled = true;
        handlers.resend().then((ok) => { if(ok) this.showVerifyMessage('Correo reenviado.', true); }).finally(() => { resend.disabled = false; });
      });
      out.addEventListener('click', handlers.signOut);
      actions.append(check, resend, out);
      this.loading.append(title, text, this.verifyMsg, actions);
    }

    showVerifyMessage(text, isInfo){
      if(!this.verifyMsg) return;
      this.verifyMsg.textContent = text;
      this.verifyMsg.classList.toggle('is-info', !!isInfo);
    }

    hide(){
      document.documentElement.classList.remove('auth-gate');
      document.body.classList.remove('is-authing');
      this.screen.hidden = true;
    }

    /* Paso «invitado»: solo el nombre; sustituye al resto del formulario de acceso. */
    setGuestStep(on){
      this.panel.classList.toggle('is-guest', on);
      this.guestForm.hidden = !on;
      this.guestMsg.hidden = true;
      if(on){
        this.title.textContent = Workhub.t('Entrar como invitado');
        this.sub.textContent = Workhub.t('Solo necesitas un nombre. No hace falta cuenta.');
        this.guestName.focus();
      } else {
        this.setMode(this.mode);
      }
    }

    setPassVisible(on){
      const label = Workhub.t(on ? 'Ocultar contraseña' : 'Mostrar contraseña');
      this.pass.type = on ? 'text' : 'password';
      this.passToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      this.passToggle.setAttribute('aria-label', label);
      this.passToggle.title = label;
    }

    setMode(mode){
      this.mode = mode;
      this.setPassVisible(false);
      const t = TEXT[mode];
      this.title.textContent = t.title;
      this.sub.textContent = t.sub;
      this.submit.textContent = t.submit;
      this.switchText.textContent = t.switchText;
      this.switchLink.textContent = t.switchLink;
      this.nameField.hidden = mode !== 'signup';
      this.passField.hidden = mode === 'reset';
      this.pass.required = mode !== 'reset';
      this.pass.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
      this.forgot.hidden = mode !== 'signin';
      this.providersEl.hidden = mode === 'reset' || !this.providersEl.children.length;
      /* Bajo el formulario: «o continúa con» y la fila de accesos (proveedores e invitado). */
      this.divider.hidden = mode === 'reset' || !this.hasPassword;
      this.alt.hidden = mode === 'reset';
      this.switchWrap.hidden = !this.hasPassword || (mode !== 'reset' && !this.allowSignup);
      this.guest.hidden = mode === 'reset';
      this.clearMessage();
    }

    setBusy(busy){
      this.submit.disabled = busy;
      this.providersEl.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
    }

    showMessage(text, isInfo){
      this.msg.textContent = text;
      this.msg.classList.toggle('is-info', !!isInfo);
      this.msg.hidden = false;
    }

    clearMessage(){
      this.msg.hidden = true;
      this.notice.hidden = true;
    }

    /* El correo ya tiene cuenta con otro método: aviso con la explicación y los dos pasos. */
    showLinkNotice(email, provider){
      const t = Workhub.t;
      const pill = '<span class="auth-notice-mail" translate="no">' + esc(email) + '</span>';
      this.notice.innerHTML =
        '<div class="auth-notice-head">' +
          '<span class="auth-notice-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>' +
          '<strong>' + esc(t('Esta cuenta ya existe')) + '</strong>' +
        '</div>' +
        '<p>' + t('{email} ya tiene una cuenta con otro método de acceso.', {email:pill}) + '</p>' +
        '<ol class="auth-notice-steps">' +
          '<li><span class="auth-notice-n">1</span>' + esc(t('Entra con el método que usaste al crearla')) + '</li>' +
          '<li><span class="auth-notice-n">2</span>' + esc(t('{provider} se une a esa misma cuenta', {provider:provider})) + '</li>' +
        '</ol>';
      this.notice.hidden = false;
      this.msg.hidden = true;
    }

    /* ---------- Cuenta ---------- */

    /* Invitado: sin cuenta, los datos viven solo en este navegador. */
    showGuest(name){
      this.accountBox.hidden = false;
      this.accountName.textContent = name;
      this.accountMail.textContent = Workhub.t('Invitado');
      this.accountAvatar.style.setProperty('--h', hueFor(name));
      this.accountAvatar.textContent = initials(name);
      this.settingsAccount.hidden = false;
      this.settingsAccountLabel.textContent = Workhub.t('Modo invitado');
      this.settingsAccountMail.textContent = name;
      $('btnSignOut').title = Workhub.t('Salir del modo invitado');
      $('btnSignOutSettings').textContent = Workhub.t('Salir del modo invitado');
    }

    showAccount(user){
      const name = user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario');
      this.accountBox.hidden = false;
      this.accountName.textContent = name;
      this.accountMail.textContent = user.email || '';
      /* La foto viene del proveedor (Google, GitHub): solo se acepta https. */
      const photo = Workhub.utils.urls.safeUrl(user.photoURL);
      this.accountAvatar.style.setProperty('--h', hueFor(user.uid));
      this.accountAvatar.textContent = '';
      if(photo && photo.indexOf('https:') === 0){
        const img = document.createElement('img');
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.src = photo;
        this.accountAvatar.appendChild(img);
      } else {
        this.accountAvatar.textContent = initials(name);
      }
      this.settingsAccount.hidden = false;
      this.settingsAccountLabel.textContent = Workhub.t('Sesión iniciada como');
      this.settingsAccountMail.textContent = user.email || name;
    }
  }

  Workhub.views.AuthView = AuthView;
})();
