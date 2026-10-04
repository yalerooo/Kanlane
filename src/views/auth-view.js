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

  const SPIN = '<span class="auth-spin" aria-hidden="true"></span>';
  const MAIL_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
  const METER_LEVELS = {short:1, weak:2, fair:3, good:4};
  const RESEND_WAIT = 30;

  /* Medidor de la contraseña de la cuenta (mínimo 8; la del cifrado de un proyecto es otra, más
     exigente). Solo orienta: lo único que bloquea es que sea corta. */
  function strength(pw){
    const len = Array.from(pw).length;
    if(len < 8) return {level:'short', message:Workhub.t('Mínimo 8 caracteres.')};
    let classes = 0;
    [/[a-zà-ÿ]/, /[A-ZÀ-Þ]/, /[0-9]/, /[^A-Za-z0-9À-ÿ]/].forEach((re) => { if(re.test(pw)) classes++; });
    if(new Set(Array.from(pw.toLowerCase())).size < 5) classes = 1;
    if((len >= 14 && classes >= 2) || (len >= 12 && classes >= 3)) return {level:'good', message:Workhub.t('Buena')};
    if((len >= 10 && classes >= 2) || classes >= 3) return {level:'fair', message:Workhub.t('Aceptable')};
    return {level:'weak', message:Workhub.t('Débil: alárgala o mezcla letras, números y símbolos.')};
  }

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
      this.submitLabel = $('authSubmitLabel');
      this.emailErr = $('authEmailErr');
      this.passErr = $('authPassErr');
      this.caps = $('authCaps');
      this.meter = $('authMeter');
      this.sent = $('authSent');
      this.timers = [];
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
      /* La pantalla del ordenador de la escena acompaña al formulario: mientras se escribe
         enseña un cuadro de acceso con el correo (o el nombre) letra a letra. De la contraseña
         solo se le pasa cuántos caracteres hay, y salen como puntos. */
      const fields = [this.name, this.email, this.pass, this.guestName];
      const typing = (ev) => {
        const el = ev.target;
        if(el && el.tagName === 'INPUT') this.scene({chars:el.value.length, text:el === this.pass ? null : el.value, active:fields.some((f) => !!f.value)});
      };
      ['input', 'focusin'].forEach((type) => this.panel.addEventListener(type, typing));

      /* Ver u ocultar la contraseña mientras se escribe. */
      this.passToggle = $('authPassToggle');
      this.passToggle.addEventListener('click', () => this.setPassVisible(this.pass.type === 'password'));

      /* Al corregir un campo se quita su aviso. */
      this.email.addEventListener('input', () => { this.clearFieldError('email'); this.msg.hidden = true; });
      this.pass.addEventListener('input', () => { this.clearFieldError('password'); this.msg.hidden = true; this.paintMeter(); });
      /* Bloq Mayús: se avisa mientras se escribe la contraseña. */
      const caps = (ev) => { if(ev.getModifierState) this.caps.hidden = !ev.getModifierState('CapsLock'); };
      this.pass.addEventListener('keydown', caps);
      this.pass.addEventListener('keyup', caps);
      this.pass.addEventListener('blur', () => { this.caps.hidden = true; });

      this.switchLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        if(this.busy) return;
        this.setMode(this.mode === 'signin' ? 'signup' : 'signin', true);
      });
      $('authSentBack').addEventListener('click', () => this.setMode('signin', true));
      this.guestBtn.addEventListener('click', () => this.setGuestStep(true));
      $('authGuestBack').addEventListener('click', () => this.setGuestStep(false));
      this.forgot.addEventListener('click', (ev) => {
        ev.preventDefault();
        if(this.busy) return;
        this.setMode('reset', true);
      });
    }

    /* Paisaje en 3D de detrás del acceso (src/views/auth-scene.js). Si no hay WebGL se queda
       el degradado de cielo de auth.css. */
    buildScene(){
      const canvas = $('authCanvas');
      if(canvas && Workhub.views.authScene) Workhub.views.authScene.start(canvas, this.screen, $('authWindow'));
    }

    scene(o){
      const s = Workhub.views.authScene;
      if(s) s.signal(o);
    }

    /* Acceso correcto: la pantalla del ordenador lo celebra un instante antes de pasar a la app.
       Devuelve una promesa que se cumple al acabar, o null si no hay nada que enseñar (escena
       parada, sin WebGL o con movimiento reducido): entonces no se espera. */
    celebrate(){
      const s = Workhub.views.authScene;
      const st = s && s.state();
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-motion') === 'reduced';
      if(!st || st.frozen || calm || this.screen.hidden) return null;
      this.setBusy(true);
      s.signal({ok:true});
      return new Promise((resolve) => setTimeout(resolve, 850));
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
        if(this.busy) return;
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
        const next = dark ? 'light' : 'dark';
        /* Con la escena en marcha no se usa el cambio de tema «en círculo» del resto de la app:
           ese efecto congela la página en una foto mientras dura, y la hierba y las luciérnagas
           se quedaban paradas. Aquí el cielo pasa solo de atardecer a noche, sin parar nada, y
           la tarjeta cambia de color con una transición corta. */
        const s = Workhub.views.authScene;
        const st = s && s.state();
        if(!st || st.frozen){ Workhub.utils.ui.themeSwitch(btn, () => handler(next)); return; }
        this.screen.classList.add('is-theming');
        clearTimeout(this.themingTimer);
        this.themingTimer = setTimeout(() => this.screen.classList.remove('is-theming'), 900);
        handler(next);
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
      const t = Workhub.t;
      this.loading.innerHTML =
        '<span class="auth-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.5a10.5 10.5 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M3 3l18 18"/></svg></span>' +
        '<strong class="auth-verify-title">' + esc(t('Sin conexión con el acceso')) + '</strong>' +
        '<span class="auth-sent-text">' + esc(t('No se pudo conectar con el servicio de acceso. Comprueba tu conexión.')) + '</span>';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary auth-submit';
      btn.textContent = t('Reintentar');
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
          PROVIDERS[p].icon + SPIN + '<span translate="no">' + esc(PROVIDERS[p].label.replace('Continuar con ', '')) + '</span></button>'
      ).join('');
      this.providersEl.hidden = !social.length;
      this.divider.hidden = !social.length || !this.hasPassword;
      this.form.hidden = !this.hasPassword;
      this.allowSignup = allowSignup !== false;
      this.setGuestStep(false);
      /* Venir de «Crear cuenta» en la portada abre directamente el registro (una sola vez). */
      const wantsSignup = this.registroRequested && this.hasPassword && this.allowSignup;
      this.registroRequested = false;
      this.setMode(wantsSignup ? 'signup' : 'signin', true);
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
      const t = Workhub.t;
      const mail = email ? '<strong class="auth-mail" translate="no">' + esc(email) + '</strong>' : esc(t('tu correo'));
      this.loading.innerHTML =
        '<span class="auth-badge" aria-hidden="true">' + MAIL_ICON + '</span>' +
        '<strong class="auth-verify-title">' + esc(t('Verifica tu correo')) + '</strong>' +
        '<span class="auth-sent-text">' + t('Te hemos enviado un enlace a {email}. Ábrelo para activar la cuenta.', {email:mail}) + '</span>' +
        '<span class="auth-sent-hint">' + esc(t('Al abrirlo, esta página lo detecta sola cuando vuelvas a ella. Si no lo ves, mira en la carpeta de spam.')) + '</span>' +
        '<span class="auth-verify-msg" role="status"></span>' +
        '<div class="auth-verify-actions">' +
          '<button type="button" class="btn btn-primary auth-submit" data-act="check">' + SPIN + '<span>' + esc(t('Ya lo he verificado')) + '</span></button>' +
          '<button type="button" class="btn btn-ghost auth-guest-back" data-act="resend">' + esc(t('Reenviar correo')) + '</button>' +
          '<button type="button" class="auth-link" data-act="out">' + esc(t('Usar otra cuenta')) + '</button>' +
        '</div>';
      this.verifyMsg = this.loading.querySelector('.auth-verify-msg');
      const check = this.loading.querySelector('[data-act="check"]');
      const resend = this.loading.querySelector('[data-act="resend"]');
      let checking = false;
      /* quiet: comprobación automática al volver a la pestaña; no dice nada si aún no está verificado. */
      const run = (quiet) => {
        if(checking) return;
        checking = true;
        if(!quiet){ check.disabled = true; check.classList.add('is-busy'); this.showVerifyMessage(''); }
        handlers.check().then((ok) => {
          if(!ok && !quiet) this.showVerifyMessage(t('Todavía no consta como verificado. Abre el enlace del correo y vuelve a probar.'));
        }, () => {
          if(!quiet) this.showVerifyMessage(t('No se pudo comprobar. Revisa tu conexión.'));
        }).finally(() => { checking = false; check.disabled = false; check.classList.remove('is-busy'); });
      };
      check.addEventListener('click', () => run(false));
      resend.addEventListener('click', () => {
        resend.disabled = true;
        handlers.resend().then((ok) => {
          if(ok){ this.showVerifyMessage(t('Correo reenviado.'), true); this.cooldown(resend); }
          else resend.disabled = false;
        }, () => { resend.disabled = false; });
      });
      this.loading.querySelector('[data-act="out"]').addEventListener('click', handlers.signOut);
      if(!this.verifyWatch){
        this.verifyWatch = () => { if(document.visibilityState === 'visible' && this.verifyRun) this.verifyRun(true); };
        document.addEventListener('visibilitychange', this.verifyWatch);
        window.addEventListener('focus', this.verifyWatch);
      }
      this.verifyRun = run;
    }

    /* Tras enviar un correo, «Reenviar» descansa unos segundos (evita reenvíos en ráfaga). */
    cooldown(btn){
      const label = Workhub.t('Reenviar correo');
      let left = RESEND_WAIT;
      btn.disabled = true;
      const paint = () => { btn.textContent = Workhub.t('Reenviar en {n} s', {n:left}); };
      paint();
      const done = () => { clearInterval(timer); btn.disabled = false; btn.textContent = label; };
      const timer = setInterval(() => {
        left--;
        if(left > 0) paint(); else done();
      }, 1000);
      this.timers.push(done);
    }

    stopTimers(){
      this.timers.splice(0).forEach((stop) => stop());
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
      this.verifyRun = null;
      this.stopTimers();
      this.scene({reset:true});
    }

    /* Paso «invitado»: solo el nombre; sustituye al resto del formulario de acceso. */
    setGuestStep(on){
      this.panel.classList.toggle('is-guest', on);
      this.guestForm.hidden = !on;
      this.guestMsg.hidden = true;
      if(on){
        this.setSent(false);
        this.sub.hidden = false;
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

    /* focus: el cambio lo ha pedido la persona; el cursor va al primer campo vacío. */
    setMode(mode, focus){
      const changed = this.mode !== mode;
      this.mode = mode;
      this.setPassVisible(false);
      this.stopTimers();
      this.setSent(false);
      const t = TEXT[mode];
      this.title.textContent = t.title;
      this.sub.textContent = t.sub;
      this.sub.hidden = false;
      this.submitLabel.textContent = t.submit;
      /* La contraseña no pasa de un modo a otro; el correo, sí. */
      if(changed) this.pass.value = '';
      this.scene({chars:0, text:null, active:!!(this.email.value || this.name.value)});
      this.email.autocomplete = mode === 'signup' ? 'email' : 'username';
      this.caps.hidden = true;
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
      this.paintMeter();
      if(changed){
        /* Vuelve a lanzar la entrada suave del contenido. */
        this.panel.classList.remove('is-swap');
        void this.panel.offsetWidth;
        this.panel.classList.add('is-swap');
      }
      if(focus) this.focusFirst();
    }

    /* Cursor en el primer campo vacío. En pantallas táctiles no: abriría el teclado sin pedirlo. */
    focusFirst(){
      if(this.form.hidden || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      const fields = [this.nameField.hidden ? null : this.name, this.email, this.passField.hidden ? null : this.pass].filter(Boolean);
      (fields.find((el) => !el.value) || fields[fields.length - 1]).focus({preventScroll:true});
    }

    /* who: 'submit' o la clave del proveedor; ese botón enseña el indicador de carga. */
    setBusy(busy, who){
      this.busy = busy;
      this.panel.classList.toggle('is-busy', busy);
      this.panel.setAttribute('aria-busy', busy ? 'true' : 'false');
      this.submit.disabled = busy;
      this.submit.classList.toggle('is-busy', busy && who === 'submit');
      this.alt.querySelectorAll('button').forEach((b) => {
        b.disabled = busy;
        b.classList.toggle('is-busy', busy && !!who && b.getAttribute('data-provider') === who);
      });
      [this.name, this.email, this.pass].forEach((el) => { el.readOnly = busy; });
      this.scene({busy:busy});
    }

    showMessage(text, isInfo){
      this.msg.textContent = text;
      this.msg.classList.toggle('is-info', !!isInfo);
      this.msg.hidden = false;
      if(!isInfo) this.scene({error:true});
    }

    /* Aviso pegado al campo que hay que corregir ('email' | 'password'), con el cursor en él. */
    showFieldError(field, text){
      const input = field === 'email' ? this.email : this.pass;
      const box = field === 'email' ? this.emailErr : this.passErr;
      box.textContent = text;
      box.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      this.msg.hidden = true;
      this.scene({error:true});
      input.focus();
      if(field === 'password') input.select();
    }

    clearFieldError(field){
      const input = field === 'email' ? this.email : this.pass;
      const box = field === 'email' ? this.emailErr : this.passErr;
      box.hidden = true;
      input.removeAttribute('aria-invalid');
    }

    clearMessage(){
      this.msg.hidden = true;
      this.notice.hidden = true;
      this.clearFieldError('email');
      this.clearFieldError('password');
    }

    /* Medidor de la contraseña: solo al crear la cuenta y con algo escrito. */
    paintMeter(){
      const on = this.mode === 'signup' && !!this.pass.value;
      this.meter.hidden = !on;
      if(!on) return;
      const r = strength(this.pass.value);
      const n = METER_LEVELS[r.level];
      this.meter.setAttribute('data-level', r.level);
      this.meter.querySelectorAll('i').forEach((el, i) => el.classList.toggle('is-on', i < n));
      this.meter.querySelector('.pw-meter-text').textContent = r.message;
    }

    setSent(on){
      this.panel.classList.toggle('is-sent', on);
      this.sent.hidden = !on;
      $('authBadge').hidden = !on;
    }

    /* Enlace de cambio de contraseña pedido: paso propio, con «Reenviar». onResend() → Promise<bool>. */
    showResetSent(email, onResend){
      const t = Workhub.t;
      this.stopTimers();
      this.clearMessage();
      this.setSent(true);
      this.title.textContent = t('Revisa tu correo');
      this.sub.hidden = true;
      $('authSentText').innerHTML = t('Si existe una cuenta con {email}, te hemos enviado un enlace para cambiar la contraseña.',
        {email:'<strong class="auth-mail" translate="no">' + esc(email) + '</strong>'});
      const msg = $('authSentMsg');
      msg.hidden = true;
      const resend = $('authSentResend');
      resend.onclick = () => {
        resend.disabled = true;
        onResend().then((ok) => {
          msg.textContent = ok ? t('Correo reenviado.') : t('No se pudo reenviar. Inténtalo dentro de un momento.');
          msg.classList.toggle('is-info', !!ok);
          msg.hidden = false;
          if(ok) this.cooldown(resend); else resend.disabled = false;
        });
      };
      this.cooldown(resend);
      $('authSentBack').focus();
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
