/* Pantalla de acceso: botones de proveedores (Google, GitHub…) y formulario
   de correo con tres modos: entrar, crear cuenta y recuperar contraseña.
   También pinta la cuenta en la barra lateral y en Ajustes. */
(function(){
  const {esc, initials, hueFor} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  /* Los botones de los proveedores y los textos de cada modo están en auth-early.js, que los
     necesita antes de que exista nada de esto (pinta el formulario en el primer fotograma). */
  const EARLY = window.WORKHUB_AUTH;
  const {PROVIDERS, TEXT, SPIN} = EARLY;
  /* La escena se pide aparte y solo si se va a ver (auth-early.js): si ya ha llegado, queda en
     su sitio de siempre; si llega después, se pone ella. En móviles no llega nunca. */
  Workhub.views.authScene = EARLY.scene;
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
      this.migrate = $('authMigrate');
      this.guestPrev = $('authGuestPrev');
      this.resume = $('authResume');
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
        if(!b) return;
        const code = b.getAttribute('data-lang-choice');
        /* Con el formulario a la vista el idioma cambia en vivo, sin recargar (la recarga cortaba
           la escena y hacía parpadear la página). En los demás estados, como siempre. */
        if(this.panel.hidden || this.busy){ Workhub.i18n.setLang(code); return; }
        Workhub.i18n.setLang(code, {live:true}).then((changed) => { if(changed) this.relabel(); });
      });
      $('authLang').querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-lang-choice') === Workhub.i18n.lang ? 'true' : 'false');
      });

      this.buildScene();
      this.buildDesk();
      /* El botón del paisaje: lo quita del todo (fondo liso y Sumi en el panel) o lo devuelve. */
      const sceneBtn = $('authSceneToggle');
      const paintSceneBtn = () => {
        const on = !EARLY.sceneOff();
        const label = Workhub.t(on ? 'Quitar el paisaje animado' : 'Mostrar el paisaje animado');
        sceneBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        sceneBtn.setAttribute('aria-label', label);
        sceneBtn.title = label;
      };
      this.paintSceneBtn = paintSceneBtn;
      paintSceneBtn();
      sceneBtn.addEventListener('click', () => {
        EARLY.setScene(EARLY.sceneOff());
        paintSceneBtn();
        this.playDesk();
      });
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

    /* Paisaje en 3D de detrás del acceso (src/views/auth-scene.js), si ya se ha cargado (si
       no, arranca sola al llegar). Si no hay WebGL se queda el degradado de cielo de auth.css. */
    buildScene(){
      const canvas = $('authCanvas');
      if(canvas && Workhub.views.authScene) Workhub.views.authScene.start(canvas, this.screen, $('authWindow'));
    }

    scene(o){
      const s = Workhub.views.authScene;
      if(s) s.signal(o);
      /* Sin paisaje, quien se entera es Sumi. */
      if(o.error && this.deskReact) this.deskReact('error');
    }

    /* ---------- Sin paisaje (y en móviles): Sumi en el agua ----------
       Detrás de la tarjeta hay agua (auth.css, .auth-ink) y en ella nada Sumi, uno solo para
       toda la pantalla. Rescata las tareas que suben del fondo, se las lleva al panel de
       cristal, las pega en el tablero y las va pasando de columna; en el móvil, que no tiene
       panel, las sube hasta arriba y las suelta ya hechas. Va por detrás de todo: tras el
       cristal se le ve desenfocado y tras la tarjeta del formulario no se le ve.
       Está animado como un personaje, no movido de un punto a otro (playDesk): nada a
       brazadas, se encoge antes de impulsarse y se estira al salir, los brazos le van detrás
       con su retraso, lo que lleva colgado se balancea, mira adonde va y cambia de cara según
       lo que hace. */
    buildDesk(){
      const sumi = Workhub.views.sumi;
      this.desk = $('authDesk');
      this.ink = this.screen.querySelector('.auth-ink');
      this.swimmer = $('authSwimmer');
      /* Con los brazos sueltos (flow) pero sin que ondulen solos (calm): los mueve playDesk. */
      this.swimmer.innerHTML = sumi.svg({size:104, cls:'is-alive', flow:true, calm:true});
      this.deskSumi = this.swimmer.firstChild;
      this.deskMood = 'normal';
      this.deskTimers = [];
      this.deskRun = 0;
      this.deskRaf = 0;
      /* deskFocus: a qué campo del formulario atiende ('pass', 'mail' o null); deskBack: está de
         espaldas; deskAt: dónde está, para seguir desde ahí al cambiar de tarea; deskTap: lo que
         hace con cada letra del correo; deskOn: está en marcha. */
      this.deskFocus = null;
      this.deskBack = false;
      this.deskAt = null;
      this.deskTap = null;
      this.deskOn = false;
      this.deskPointer = null;
      /* deskErrorAt, deskOkAt: cuándo dijo el formulario que algo fue mal o que se entró;
         deskDropped: dónde estaba la tarjeta que llevaba en ese momento. deskSleep: dormido;
         deskWoke: lo acaban de despertar; deskSeen: la última vez que se tocó algo. */
      this.deskErrorAt = 0;
      this.deskOkAt = 0;
      this.deskDropped = null;
      this.deskSleep = false;
      this.deskWoke = false;
      this.deskSeen = performance.now();
      sumi.follow(this.deskSumi);
      /* El formulario manda. Con la contraseña deja lo que esté haciendo, se va al cristal y se
         da la vuelta para no mirar; al escribir el correo (o el nombre) se va también al
         cristal y acompaña lo que se escribe. Al salir del campo vuelve a lo suyo. */
      const attend = (what, field) => {
        /* Mientras espera a Google o a GitHub no lo distrae el foco, que al abrirse y cerrarse
           esa ventana sale del campo y vuelve a entrar. */
        if(this.deskFocus === 'wait' && what !== 'wait') return;
        this.deskFocus = what; this.deskField = field || null;
        if(this.deskOn) this.playDesk(true);
      };
      /* Entrar con Google o con GitHub (setBusy): mientras su ventana está abierta, Sumi espera
         el resultado en el cristal (playDesk, 'wait'). deskVia: se está entrando así, para que
         al conseguirlo lo celebre más; dura un poco más que la espera, porque el formulario se
         libera a la vez que llega la sesión. deskLeaving: ya se entró y Sumi se está yendo. */
      this.deskVia = false;
      this.deskLeaving = false;
      this.deskWait = (busy, who) => {
        const btn = busy && who && who !== 'submit' ? this.alt.querySelector('[data-provider="' + who + '"]') : null;
        if(btn){
          clearTimeout(this.deskViaTimer);
          this.deskVia = true;
          attend('wait', btn);
          return;
        }
        if(busy || this.deskFocus !== 'wait') return;
        this.deskViaTimer = setTimeout(() => { this.deskVia = false; }, 2000);
        this.deskFocus = document.activeElement === this.pass ? 'pass' : null;
        this.deskField = null;
        if(this.deskOn && !this.deskLeaving) this.playDesk(true);
      };
      this.pass.addEventListener('focus', () => attend('pass'));
      this.pass.addEventListener('blur', () => attend(null));
      [this.email, this.name].forEach((field) => {
        if(!field) return;
        /* Con solo tener el cursor dentro no acude: al entrar el correo ya lo tiene, y así no
           se le veía nunca rescatar tareas (lo vio el dueño). Va cuando se empieza a escribir;
           si se deja de escribir un rato, o se sale del campo, vuelve a lo suyo. */
        field.addEventListener('input', () => {
          if(this.deskFocus !== 'mail') attend('mail', field);
          if(this.deskTap) this.deskTap(field);
          clearTimeout(this.deskIdle);
          this.deskIdle = setTimeout(() => { if(this.deskFocus === 'mail') attend(null); }, 4500);
        });
        field.addEventListener('blur', () => { clearTimeout(this.deskIdle); if(this.deskFocus === 'mail') attend(null); });
      });
      /* Por dónde anda el cursor, por si le da por acercarse a curiosear. */
      document.addEventListener('pointermove', (ev) => { if(ev.pointerType === 'mouse') this.deskPointer = [ev.clientX, ev.clientY, performance.now()]; }, {passive:true});
      /* El cursor mueve dos cosas más (auth.css): la luz del cristal, que lo sigue por el panel
         (--gx, --gy; --go la enciende cuando anda cerca), y la profundidad del agua, cuyas
         motas se desplazan un poco al contrario, las de cerca más (--px, --py, de -1 a 1). */
      const pane = this.desk.parentNode;
      let lit = 0;
      document.addEventListener('pointermove', (ev) => {
        if(ev.pointerType !== 'mouse' || this.screen.hidden || lit) return;
        lit = requestAnimationFrame(() => {
          lit = 0;
          const r = pane.getBoundingClientRect();
          const near = r.width && ev.clientX > r.left - 150 && ev.clientX < r.right + 150 && ev.clientY > r.top - 150 && ev.clientY < r.bottom + 150;
          pane.style.setProperty('--gx', Math.round(ev.clientX - r.left) + 'px');
          pane.style.setProperty('--gy', Math.round(ev.clientY - r.top) + 'px');
          pane.style.setProperty('--go', near ? '1' : '0');
          this.ink.style.setProperty('--px', ((ev.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
          this.ink.style.setProperty('--py', ((ev.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
        });
      }, {passive:true});
      /* Lo que le dice el formulario: 'error' (algo fue mal) u 'ok' (se entró). Deja lo que
         esté haciendo y reacciona (playDesk). */
      this.deskReact = (kind) => {
        if(!this.deskOn) return;
        const carried = this.ink.querySelector('.auth-float.is-held');
        this.deskDropped = carried ? carried.getBoundingClientRect() : null;
        if(kind === 'ok') this.deskOkAt = performance.now();
        else this.deskErrorAt = performance.now();
        this.playDesk(true);
      };
      /* Un minuto sin que nadie toque nada: se duerme, y todo lo del agua se para (también
         ahorra batería). Cualquier movimiento lo despierta, con un respingo. */
      const stir = () => {
        this.deskSeen = performance.now();
        if(!this.deskSleep) return;
        this.deskSleep = false;
        this.deskWoke = true;
        this.ink.classList.remove('is-asleep');
        if(this.deskOn) this.playDesk(true);
      };
      ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach((type) => document.addEventListener(type, stir, {passive:true}));
      setInterval(() => {
        if(!this.deskOn || this.deskSleep || this.deskFocus || this.deskCalm() || document.hidden || performance.now() - this.deskSeen < 60000) return;
        this.deskSleep = true;
        this.playDesk(true);
      }, 5000);
      /* Al pasar de ventana ancha a estrecha (o al revés) cambia lo que hace: se empieza de nuevo. */
      if(EARLY.plain.addEventListener) EARLY.plain.addEventListener('change', () => this.playDesk());
    }

    deskCalm(){
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-motion') === 'reduced';
    }

    /* keep: no es que se pare, es que cambia de tarea (playDesk): sigue a la vista. */
    stopDesk(keep){
      /* deskRun cambia: lo que estuviera a medias (playDesk) no sigue. */
      this.deskRun++;
      this.deskOn = false;
      this.deskTap = null;
      this.deskTimers.splice(0).forEach(clearTimeout);
      cancelAnimationFrame(this.deskRaf);
      /* Solo lo que se animó desde aquí: el reposo de Sumi (una animación de CSS) no se toca. */
      this.deskSumi.getAnimations().forEach((a) => { if(!(window.CSSAnimation && a instanceof CSSAnimation)) a.cancel(); });
      this.deskSumi.style.scale = '';
      if(!keep) this.swimmer.classList.remove('is-in');
      this.ink.querySelectorAll('.auth-float:not(.is-ghost), .auth-bub').forEach((n) => n.remove());
      if(!keep) this.ink.classList.remove('is-asleep');
      this.desk.querySelectorAll('.auth-desk-card').forEach((c) => {
        c.getAnimations().forEach((a) => a.cancel());
        c.classList.remove('is-fly', 'is-landed');
      });
      this.desk.querySelectorAll('.auth-desk-col').forEach((c) => c.classList.remove('is-hit'));
    }

    /* Lo que hace Sumi, en bucle mientras la pantalla esté a la vista. Su cuaderno
       (docs/marca/cuaderno-sumi.html) dice que todo ocurre una vez y termina: esta pantalla es
       la excepción, a petición del dueño. Con «reducir movimiento» se queda quieto, con el
       tablero ya adelantado. Cada vuelta:
       1. Sube una tarea del fondo. Sumi la ve (se sorprende, da un respingo), nada hasta ella
          y la coge estirando el brazo del medio.
       2. Concentrado, se la lleva tras el cristal y la pega en «Por hacer» (en el móvil la
          sube y la suelta).
       3. Pasa la que haya en «En curso» a «Hecho» y lo celebra; luego, una de «Por hacer» a
          «En curso». Si en «Hecho» hay más de dos, la más antigua se va.
       4. Un rato a su aire: se acerca al cursor si anda por el agua, saluda, guiña un ojo o
          se da un paseo.
       Cómo se mueve (tick): no va de un punto a otro con una curva hecha, sino que se le dice
       adónde ir y nada hasta allí a brazadas. En cada brazada se encoge un instante
       (anticipación), sale impulsado y estirado, y planea frenándose. Los brazos son tres
       muelles que persiguen a su raíz: van con retraso y se pasan un poco al frenar; lo que
       lleva colgado es un péndulo. Todo se mide en el momento, así que sirve para cualquier
       tamaño de ventana. */
    playDesk(keep){
      this.stopDesk(keep);
      const run = this.deskRun, alive = () => run === this.deskRun;
      const sumi = Workhub.views.sumi, el = this.deskSumi, me = this.swimmer, ink = this.ink;
      const face = el.querySelector('.sumi-face');
      const plain = EARLY.plain.matches;
      const cols = Array.from(this.desk.querySelectorAll('.auth-desk-col'));
      /* De espaldas no hay cara que cambiar. */
      const mood = (m) => { this.deskMood = m; if(!this.deskBack) sumi.setMood(el, m); };
      const card = () => { const c = document.createElement('i'); c.className = 'auth-desk-card'; return c; };
      /* El tablero, como al principio: una por hacer y una en curso. Al cambiar de tarea
         (keep) se queda como esté. */
      if(!keep){
        this.deskLeaving = false;
        this.desk.querySelectorAll('.auth-desk-card').forEach((c) => c.remove());
        cols[0].appendChild(card());
        cols[1].appendChild(card());
      }
      /* La tarjeta que hubiera puesta sin verse, a la espera de que llegara Sumi con ella. */
      this.desk.querySelectorAll('.auth-desk-card').forEach((c) => { if(c.style.visibility === 'hidden') c.remove(); });
      mood('normal');
      if(this.screen.hidden || (!plain && !EARLY.sceneOff())) return;

      const size = me.offsetWidth || 104, unit = 64 / size;
      const wait = (ms) => new Promise((done) => this.deskTimers.push(setTimeout(done, ms)));
      const again = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
      const mid = (node) => { const r = node.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      const count = (i) => cols[i].querySelectorAll('.auth-desk-card').length;
      const first = (i) => cols[i].querySelector('.auth-desk-card');
      const move = (x, y) => 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      const shell = () => this.screen.querySelector('.auth-shell').getBoundingClientRect();
      /* Dónde se pone Sumi para tocar una tarjeta del tablero: encima de su columna, con los
         brazos colgando sobre ella. A la altura de la tarjeta, como va por detrás, lo taparía. */
      const over = (node) => { const r = node.getBoundingClientRect(); return [r.left + r.width / 2, node.closest('.auth-desk-col').getBoundingClientRect().top - size * 0.36]; };
      /* Dónde hay agua a la vista, fuera de la tarjeta: a los lados, por debajo y por arriba. */
      const spots = () => {
        const s = shell(), w = window.innerWidth, h = window.innerHeight, out = [];
        if(s.left > size * 1.3) out.push([s.left / 2, h * 0.38], [s.left / 2, h * 0.68]);
        if(w - s.right > size * 1.3) out.push([(s.right + w) / 2, h * 0.34], [(s.right + w) / 2, h * 0.7]);
        if(h - s.bottom > size * 1.25) out.push([w * 0.3, (s.bottom + h) / 2], [w * 0.64, (s.bottom + h) / 2]);
        if(s.top > size * 1.25) out.push([w * 0.3, s.top / 2], [w * 0.6, s.top / 2]);
        if(!out.length) out.push([size * 0.7, h - size * 0.7], [w - size * 0.7, h - size * 0.7]);
        return out;
      };

      /* ---- El cuerpo ---- */
      const start = keep && this.deskAt ? this.deskAt : spots()[0];
      this.deskOn = true;
      /* x, y: dónde está (su centro); vx, vy: velocidad; rot: cuánto se ladea; sx, sy: cuánto
         se encoge o se estira (vsx, vsy: a qué velocidad cambia, porque es de gelatina: se pasa
         un poco y vuelve); to: adónde va (null: flota); home: su sitio, al que vuelve solo si
         algo lo mueve; beat: por dónde va de la brazada; pose: un encogimiento o estirón pedido
         a mano, que se va solo; jump: un salto en marcha; fly: sale disparado. */
      const body = {x:start[0], y:start[1], vx:0, vy:0, rot:0, sx:1, sy:1, vsx:0, vsy:0, to:null, done:null, home:null, beat:0, pose:null, poseT:0, t:0, jump:null, fly:false};
      /* Los brazos. Cada uno es una cadena de SEG tramos, todos igual de largos, que cuelga de
         su hombro: un punto dentro del cuerpo, a medio ancho de brazo del borde, así que el
         extremo redondo del trazo no asoma nunca y el brazo puede girar entero sin que se le
         abra una muesca en la unión. De cada tramo se guarda hacia dónde apunta (a, en
         radianes; 0 es hacia abajo) y a qué velocidad gira (w). El hombro persigue la postura
         que se le pide y cada tramo, a medias, esa postura y al tramo anterior, con su
         retraso: el gesto baja por el brazo como por un látigo, y la punta llega la última y
         se pasa un poco. El agua, además, los arrastra: se quedan atrás de por donde va. El brazo mide siempre lo mismo salvo lo que
         se le pida (ext): antes, al levantarlo, se estiraba como una goma hasta el doble.
         lift: cuánto lo tiene levantado (0, colgando; 1, abierto hacia fuera con la punta arriba;
         algo menos de 0, recogido). hook: cuánto de más se le enrosca la punta hacia arriba. */
      const geo = sumi.geometry(false), SEG = 6;
      const arms = geo.arms.map((a, i) => {
        const top = geo.root - a[1] / 2;
        return {node:el.querySelector('.sumi-arm-' + i), x:a[0] + a[1] / 2, y:top, side:i - 1, len:(a[2] - geo.top) * 1.45 - (top - geo.top),
          a:Array.from({length:SEG}, () => 0), w:Array.from({length:SEG}, () => 0), ext:0, extV:0, lift:0, liftTo:0, hook:0, sp:1.3 + i * 0.37, ph:i * 2.1};
      });
      /* reach: lo que se alarga de más el del medio para coger o empujar. */
      let reachTo = 0;
      /* El saludo: abre el brazo derecho y lo mece. */
      const wave = (ms) => { arms[2].liftTo = 1; this.deskTimers.push(setTimeout(() => { arms[2].liftTo = 0; }, ms)); };
      /* Para celebrar: los dos brazos de fuera abiertos, con la punta arriba, y un meneo del cuerpo que
         empieza y se apaga solo; el del medio lo encoge, como quien salta con las piernas
         recogidas. high: cuánto de «arriba del todo»; party: lo que le queda
         de meneo. */
      let high = 0, highTo = 0, party = 0;
      /* shake: cuánto niega con la cabeza (se apaga solo). asleep: dormido del todo; el bucle
         de cada fotograma se para. */
      let shake = 0, asleep = false;
      const cheer = (on) => { arms[0].liftTo = arms[2].liftTo = on ? 1 : 0; highTo = on ? 1 : 0; reachTo = on ? -7 : 0; if(on) party = 1; };
      /* Lo que lleva colgado y cuánto se balancea. */
      let held = null, swing = 0, swingV = 0;
      /* Burbujas sueltas en ese punto, que suben y se deshacen. */
      const puff = (x, y, n) => {
        for(let i = 0; i < n; i++){
          const b = document.createElement('i'), s = 4 + Math.random() * 7;
          const x0 = x + (Math.random() - 0.5) * 24 - s / 2, up = 70 + Math.random() * 120, sway = (Math.random() - 0.5) * 34;
          b.className = 'auth-bub';
          b.style.width = b.style.height = s.toFixed(1) + 'px';
          ink.appendChild(b);
          b.animate([
            {transform:move(x0, y) + ' scale(.5)', opacity:0},
            {opacity:0.9, offset:0.15},
            {transform:move(x0 + sway, y - up) + ' scale(1.1)', opacity:0}
          ], {duration:1100 + Math.random() * 900, easing:'ease-out'}).onfinish = () => b.remove();
        }
      };
      /* Hacia dónde mira: los ojos se van hacia ese punto (sin punto, al frente). Si el cursor
         se mueve, lo siguen a él (sumi.follow). */
      const look = (p) => {
        if(!face) return;
        if(!p){ face.style.translate = ''; return; }
        const dx = p[0] - body.x, dy = p[1] - body.y, d = Math.hypot(dx, dy) || 1;
        face.style.translate = (dx / d * 1.8).toFixed(2) + 'px ' + (dy / d * 1.3).toFixed(2) + 'px';
      };
      /* Un gesto del cuerpo: se pone así de ancho y de alto durante ms y vuelve solo. */
      const pose = (sx, sy, ms) => { body.pose = [sx, sy]; body.poseT = body.t + ms / 1000; };

      let last = 0;
      const tick = (now) => {
        if(!alive() || asleep) return;
        this.deskRaf = requestAnimationFrame(tick);
        const dt = Math.min(0.034, last ? (now - last) / 1000 : 0.016);
        last = now;
        body.t += dt;
        this.deskAt = [body.x, body.y];
        let tsx = 1, tsy = 1, curl = 0, spread = 0;
        if(body.fly || body.jump){
          if(body.fly){
            /* Sale disparado hacia arriba, cada vez más deprisa, soltando burbujas. */
            body.vy -= 2600 * dt;
            if(Math.random() < dt * 34) puff(body.x + (Math.random() - 0.5) * size * 0.4, body.y + size * 0.45, 1);
          } else {
            /* Un salto: sube frenándose, arriba la gravedad afloja (se queda un instante
               colgado, que es cuando se le ve la cara) y cae cada vez más deprisa hasta su sitio. */
            const j = body.jump;
            body.vy += j.g * (Math.abs(body.vy) < j.v * 0.3 ? 0.5 : 1) * dt;
            if(body.vy > 0 && body.y >= j.y){ body.y = j.y; body.vy = 0; body.jump = null; j.done(); }
          }
          body.vx *= Math.exp(-dt * 3);
          /* En el aire se estira según lo deprisa que va, y adelgaza lo que se alarga. */
          tsy = 1 + Math.min(0.2, Math.abs(body.vy) / 1900); tsx = 1 - (tsy - 1) * 0.85;
        } else if(body.to){
          const dx = body.to[0] - body.x, dy = body.to[1] - body.y, d = Math.hypot(dx, dy) || 1;
          if(d < 7 && Math.hypot(body.vx, body.vy) < 40){
            /* Ha llegado. */
            const done = body.done;
            body.home = body.to;
            body.to = null; body.done = null;
            if(done) done();
          } else {
            /* Va hacia allí acelerando y frenando con suavidad: la velocidad que quiere llevar es
               mayor cuanto más lejos está (hasta un tope) y la que lleva la persigue, así que
               arranca despacio, no se pasa de largo y llega posándose. Encima va el pulso de un
               pulpo al nadar: abre los brazos, los cierra, y con cada cierre avanza un poco más. */
            const top = held ? 340 : 430, want = Math.min(top, d * 2.8), go = want / top;
            body.beat += dt * 1.3;
            const beat = Math.sin(body.beat * 6.283);
            const k = want * (1 + 0.2 * beat) / d;
            body.vx += (dx * k - body.vx) * Math.min(1, dt * 3.2);
            body.vy += (dy * k - body.vy) * Math.min(1, dt * 3.2);
            tsx = 1 - 0.045 * beat * go; tsy = 1 + 0.055 * beat * go;
            spread = -beat * 0.24 * go; curl = beat * 2.2 * go;
            if(Math.random() < dt * 2.4 * go) puff(body.x, body.y + size * 0.3, 1);
          }
        } else {
          /* Flota en su sitio: si algo lo mueve (un respingo, un toque), vuelve meciéndose. Sin
             esto, cada respingo lo dejaba un poco más arriba y acababa saliéndose. */
          if(body.home){ body.vx += (body.home[0] - body.x) * 18 * dt; body.vy += (body.home[1] - body.y) * 18 * dt; }
          const stop = Math.exp(-dt * 4);
          body.vx *= stop; body.vy *= stop;
        }
        body.x += body.vx * dt; body.y += body.vy * dt;
        /* Se ladea un poco hacia donde va; no se tumba. El meneo de la fiesta entra y sale de
           cero, sin golpe. */
        const lean = clamp(body.vx * 0.045, -13, 13);
        const sway = (party > 0 ? Math.sin((1 - party) * 15.7) * 7 * Math.sin(party * 3.1416) : 0) + (shake > 0 ? Math.sin((1 - shake) * 21) * 14 * shake : 0);
        body.rot += (lean - body.rot) * Math.min(1, dt * 4);
        if(body.pose){
          if(body.t < body.poseT){ tsx = body.pose[0]; tsy = body.pose[1]; }
          else body.pose = null;
        }
        body.vsx += ((tsx - body.sx) * 240 - body.vsx * 17) * dt; body.sx += body.vsx * dt;
        body.vsy += ((tsy - body.sy) * 240 - body.vsy * 17) * dt; body.sy += body.vsy * dt;
        me.style.transform = move(body.x - size / 2, body.y - size / 2) + ' rotate(' + (body.rot + sway).toFixed(2) + 'deg)';
        el.style.scale = body.sx.toFixed(3) + ' ' + body.sy.toFixed(3);

        /* Los brazos. fx, fy: cómo le viene el agua, vista desde el propio Sumi (que va
           ladeado): al contrario de por donde va. */
        const c = Math.cos(-body.rot / 57.3), s = Math.sin(-body.rot / 57.3);
        let fx = -(body.vx * c - body.vy * s) * unit, fy = -(body.vx * s + body.vy * c) * unit;
        const f = Math.hypot(fx, fy);
        if(f > 330){ fx *= 330 / f; fy *= 330 / f; }
        high += (highTo - high) * Math.min(1, dt * 8);
        party = Math.max(0, party - dt * 0.7);
        shake = Math.max(0, shake - dt * 1.05);
        arms.forEach((a, i) => {
          /* Lo sube con calma y lo baja más despacio todavía (lo deja caer). */
          a.lift += (a.liftTo - a.lift) * Math.min(1, dt * (a.liftTo > a.lift ? 7 : 4.5));
          const up = a.lift, wag = Math.sin(body.t * (6 + high) + i * 0.45);
          /* La postura: adónde apunta el hombro y cuánto se dobla cada tramo respecto al
             anterior. El hombro se abre poco: el brazo sale siempre por abajo, por donde está
             unido al cuerpo, y es la curva la que lo lleva hacia fuera y le sube la punta. Si
             girara entero desde el hombro asomaría por el costado de la cabeza, como una pieza
             pegada encima (lo vio el dueño). Levantado, lo mece despacio; al nadar, los de fuera
             se abren y se cierran con la brazada. */
          const base = a.side * (up * (0.5 + 0.06 * high + 0.07 * wag) + spread);
          const bend = a.side * (up * (0.2 + 0.03 * high + 0.035 * wag) + a.hook);
          for(let k = 0; k < SEG; k++){
            const und = Math.sin(body.t * a.sp - k * 0.85 + a.ph) * (0.05 + k * 0.012) * (1 - 0.6 * Math.max(0, up));
            const want = (k ? (a.a[k - 1] + bend) * 0.55 + (base + k * bend) * 0.45 : base) + und;
            const stiff = k ? 150 - k * 12 : 170, damp = k ? 16 - k : 21;
            /* El agua empuja cada tramo de lado (más cuanto más cerca de la punta) y, al caer,
               le abre los brazos de fuera. A un brazo levantado lo mueve menos: lo sujeta él. */
            const drag = ((fx * Math.cos(a.a[k]) - fy * Math.sin(a.a[k])) * 0.1 * (0.35 + k * 0.3) + a.side * Math.max(0, -fy) * 0.05) * (1 - 0.75 * Math.max(0, up));
            a.w[k] += ((want - a.a[k]) * stiff - a.w[k] * damp + drag) * dt;
            a.a[k] += a.w[k] * dt;
            /* Topes: ni el hombro se abre más de la cuenta ni un tramo se quiebra sobre el
               anterior, pase lo que pase con los muelles. */
            const from = k ? a.a[k - 1] : 0, most = k ? 0.42 : 0.72;
            if(Math.abs(a.a[k] - from) > most){ a.a[k] = from + Math.sign(a.a[k] - from) * most; a.w[k] *= 0.5; }
          }
          const extTo = (i === 1 ? reachTo : 0) + curl + (up > 0 ? up * (i ? 2 : 4) : up * 3);
          a.extV += ((extTo - a.ext) * 300 - a.extV * 24) * dt; a.ext += a.extV * dt;
          /* El trazo: de la mitad de un tramo a la mitad del siguiente con una curva que tiene
             la articulación por punto de control, así que no se le ve ningún codo. */
          const seg = Math.max(1.6, (a.len + a.ext) / SEG);
          let px = a.x, py = a.y, d = 'M' + px + ' ' + py;
          for(let k = 0; k < SEG; k++){
            const nx = px + seg * Math.sin(a.a[k]), ny = py + seg * Math.cos(a.a[k]);
            const mx = ((px + nx) / 2).toFixed(2) + ' ' + ((py + ny) / 2).toFixed(2);
            d += k ? 'Q' + px.toFixed(2) + ' ' + py.toFixed(2) + ' ' + mx : 'L' + mx;
            px = nx; py = ny;
          }
          a.node.setAttribute('d', d + 'L' + px.toFixed(2) + ' ' + py.toFixed(2));
        });
        /* Lo que lleva colgado se balancea: un péndulo que tira hacia atrás de donde va. */
        if(held){
          swingV += ((clamp(fx * 0.9, -32, 32) - swing) * 34 - swingV * 4.5) * dt;
          swing += swingV * dt;
          held.style.rotate = swing.toFixed(2) + 'deg';
        }
      };

      /* Nada hasta ahí. Mira adonde va. */
      const swim = (x, y) => new Promise((done) => {
        look([x, y]);
        body.home = null;
        body.to = [x, y];
        body.done = done;
      });
      /* Un respingo: se encoge, salta un poco y se estira. */
      const hop = async (power) => {
        pose(1.14, 0.86, 130);
        await wait(130);
        body.vy -= power || 150;
        pose(0.9, 1.13, 190);
        puff(body.x, body.y + size * 0.3, 3);
      };
      /* Un salto de verdad, de esa altura y más o menos esos segundos: sube, se queda un
         instante arriba y cae en el mismo sitio (lo lleva tick). Se cumple al tocar suelo. */
      const leap = (h, secs) => new Promise((done) => {
        const g = 8 * h / (secs * secs), v = Math.sqrt(2 * g * h);
        body.to = null; body.done = null; body.home = null;
        body.jump = {y:body.y, g:g, v:v, done:() => { body.home = [body.x, body.y]; done(); }};
        body.vy = -v;
      });
      /* Los destellos de la cara de fiesta, que salen de golpe y se asientan. */
      const sparkle = () => {
        const x = el.querySelector('.sumi-extra');
        if(x) x.animate([{transform:'scale(.2) rotate(-20deg)', opacity:0}, {transform:'scale(1.3) rotate(6deg)', opacity:1, offset:0.55}, {transform:'none', opacity:1}], {duration:460, easing:'cubic-bezier(.2,.8,.3,1)'});
      };
      /* Una tarea que sube del fondo y se queda flotando en ese punto. */
      const float = (x, y) => {
        const f = document.createElement('i');
        f.className = 'auth-float';
        ink.insertBefore(f, me);
        const left = x - f.offsetWidth / 2, top = y - f.offsetHeight / 2;
        f.style.transform = move(left, top);
        f.animate([
          {transform:move(left - 14, top + 150) + ' rotate(-14deg)', opacity:0},
          {transform:move(left + 8, top + 50) + ' rotate(9deg)', opacity:1, offset:0.55},
          {transform:move(left, top) + ' rotate(0deg)', opacity:1}
        ], {duration:1300, easing:'cubic-bezier(.2,.7,.3,1)'});
        puff(x, y + 40, 5);
        return f;
      };
      /* La coge: toma impulso hacia arriba, alarga el brazo del medio hasta ella y, al
         recogerlo, se la queda colgada. */
      const grab = async (f) => {
        pose(1.1, 0.9, 150);
        body.vy -= 50;
        await wait(170);
        reachTo = 9;
        pose(0.93, 1.1, 220);
        await wait(230);
        f.getAnimations().forEach((a) => a.cancel());
        f.style.transform = '';
        f.classList.add('is-held');
        me.appendChild(f);
        held = f; swing = 0; swingV = 140;
        reachTo = 2;
        f.animate([{scale:'1.18 .84'}, {scale:'.94 1.07', offset:0.5}, {scale:'1 1'}], {duration:360, easing:'ease-out'});
        puff(body.x, body.y + size * 0.6, 3);
        mood('concentrado');
        await wait(260);
      };
      const drop = () => { const f = held; held = null; reachTo = 0; if(f) f.style.rotate = ''; return f; };
      /* La lleva tras el cristal y la pega en «Por hacer»: la del agua desaparece y aparece la
         del tablero, que ya estaba puesta en su sitio, sin verse, para saber adónde ir. */
      const deliver = async () => {
        const c = card();
        c.style.visibility = 'hidden';
        cols[0].appendChild(c);
        const to = mid(c), up = over(c);
        await swim(up[0], up[1]);
        if(!alive()){ c.remove(); return; }
        look(to);
        reachTo = 10;
        pose(0.94, 1.08, 200);
        await wait(210);
        const f = drop();
        if(f) f.remove();
        c.style.visibility = '';
        c.animate([{transform:'translateY(-14px) scale(.7)', opacity:0}, {transform:'translateY(2px) scale(1.08, .94)', opacity:1, offset:0.55}, {transform:'translateY(-1px) scale(.98, 1.03)', offset:0.8}, {transform:'none', opacity:1}], {duration:480, easing:'ease-out'});
        again(cols[0], 'is-hit');
        again(c, 'is-landed');
        puff(to[0], to[1], 5);
        mood('contento');
        pose(1.08, 0.93, 160);
        await wait(620);
        mood('normal');
      };
      /* Sin panel (móvil): la sube hasta arriba y la suelta, ya hecha; se va hacia la superficie. */
      const surface = async () => {
        const s = shell();
        await swim(window.innerWidth * (0.26 + Math.random() * 0.4), Math.max(size * 0.62, s.top * 0.52));
        if(!alive()) return;
        const f = drop();
        if(!f) return;
        f.classList.add('is-done');
        mood('fiesta');
        const r = f.getBoundingClientRect();
        ink.insertBefore(f, me);
        f.classList.remove('is-held');
        f.style.transform = move(r.left, r.top);
        f.animate([{transform:move(r.left, r.top), opacity:1}, {transform:move(r.left + 10, r.top - 70) + ' rotate(8deg)', opacity:1, offset:0.5}, {transform:move(r.left - 6, r.top - 150) + ' rotate(-6deg)', opacity:0}], {duration:1200, easing:'ease-in'}).onfinish = () => f.remove();
        puff(r.left + r.width / 2, r.top, 6);
        await hop(170);
        await wait(900);
        mood('normal');
      };
      /* Pasa esa tarjeta a otra columna: va hasta ella, le da un toque con el brazo (la tarjeta
         se encoge antes de salir) y la acompaña. Las que deja atrás suben a ocupar su hueco. */
      const push = async (c, to) => {
        const up = over(c);
        await swim(up[0], up[1]);
        if(!alive()) return;
        look(mid(c));
        pose(1.08, 0.92, 140);
        await wait(150);
        reachTo = 10;
        await wait(170);
        c.animate([{transform:'none'}, {transform:'scale(1.1, .86)'}, {transform:'none'}], {duration:200, easing:'ease-out'});
        await wait(170);
        reachTo = 0;
        const all = Array.from(this.desk.querySelectorAll('.auth-desk-card')), before = all.map((n) => n.getBoundingClientRect());
        let landed = null;
        cols[to].appendChild(c);
        all.forEach((n, i) => {
          const now = n.getBoundingClientRect(), dx = before[i].left - now.left, dy = before[i].top - now.top;
          if(!dx && !dy) return;
          const from = 'translate(' + dx + 'px,' + dy + 'px)';
          if(n !== c){
            n.animate([{transform:from}, {transform:'translateY(-3px)', offset:0.8}, {transform:'none'}], {duration:460, delay:160, fill:'backwards', easing:'cubic-bezier(.2,.8,.2,1)'});
            return;
          }
          n.classList.add('is-fly');
          const fly = n.animate([
            {transform:from + ' rotate(0deg) scale(1)'},
            {transform:'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 30) + 'px) rotate(' + (dx < 0 ? 9 : -9) + 'deg) scale(1.1)', offset:0.5},
            {transform:'translate(0px,3px) rotate(0deg) scale(1.06, .92)', offset:0.82},
            {transform:'translate(0px,-2px) scale(.98, 1.03)', offset:0.92},
            {transform:'none'}
          ], {duration:760, easing:'cubic-bezier(.3,.7,.3,1)'});
          fly.onfinish = () => n.classList.remove('is-fly');
          landed = fly.finished.catch(() => {});
        });
        again(cols[to], 'is-hit');
        /* La acompaña y espera a que se pose: antes celebraba (y la tarjeta soltaba su anillo)
           con ella todavía en el aire. */
        const next = over(c);
        await Promise.all([swim(next[0], next[1]), landed]);
        if(!alive() || to !== 2) return;
        /* A «Hecho»: anillo verde y burbujas en la tarjeta, y Sumi lo celebra como lo haría un
           dibujo animado: se agacha y recoge los brazos para coger impulso (anticipación),
           salta estirado con los brazos arrastrando detrás, al llegar arriba los abre hacia los lados y
           se menea con cara de fiesta, cae, se aplasta al posarse, da un botecito más pequeño
           y se recompone mientras los brazos bajan solos. Antes el salto era un empujón que se
           frenaba en el agua y luego volvía nadando, y los brazos se estiraban al doble
           doblándose en U y agitando la punta a sacudidas. */
        again(c, 'is-landed');
        puff(mid(c)[0], mid(c)[1], 7);
        look(null);
        mood('contento');
        pose(1.2, 0.8, 210);
        reachTo = -5;
        arms[0].liftTo = arms[2].liftTo = -0.2;
        await wait(210);
        if(!alive()) return;
        mood('fiesta');
        sparkle();
        reachTo = 0;
        arms[0].liftTo = arms[2].liftTo = 0;
        puff(body.x, body.y + size * 0.42, 6);
        const air = leap(size * 0.62, 0.66);
        await wait(110);
        if(!alive()) return;
        cheer(true);
        puff(body.x - size * 0.5, body.y - size * 0.3, 2);
        puff(body.x + size * 0.5, body.y - size * 0.3, 2);
        await air;
        if(!alive()) return;
        /* Se posa: se aplasta, suelta burbujas y bota una vez más, más bajo. */
        pose(1.2, 0.8, 110);
        reachTo = 0;
        puff(body.x, body.y + size * 0.45, 4);
        await wait(120);
        if(!alive()) return;
        await leap(size * 0.2, 0.36);
        if(!alive()) return;
        pose(1.11, 0.9, 110);
        cheer(false);
        await wait(760);
        mood('normal');
      };
      const release = (c) => {
        const r = c.getBoundingClientRect();
        c.animate([{opacity:1, transform:'none'}, {opacity:0, transform:'translateY(-18px) scale(.9)'}], {duration:440, easing:'ease-in', fill:'forwards'}).onfinish = () => c.remove();
        puff(r.left + r.width / 2, r.top, 4);
      };
      /* Un sitio con agua, más bien lejos de donde está, para que se le vea cruzar. */
      const pick = () => {
        let best = null, far = -1;
        spots().forEach((p) => { const d = Math.hypot(p[0] - body.x, p[1] - body.y) + Math.random() * 240; if(d > far){ far = d; best = p; } });
        return [best[0] + (Math.random() - 0.5) * 50, best[1] + (Math.random() - 0.5) * 36];
      };
      /* Un rato a su aire. Si el cursor anda por el agua (fuera de la tarjeta), se acerca a
         curiosear; si no, se da un paseo. Y al llegar, a veces saluda o guiña un ojo. */
      const idle = async () => {
        const p = this.deskPointer, s = shell();
        const inWater = p && performance.now() - p[2] < 4000 && (p[0] < s.left - 30 || p[0] > s.right + 30 || p[1] < s.top - 30 || p[1] > s.bottom + 30);
        if(inWater){
          await swim(clamp(p[0] + (p[0] < body.x ? 70 : -70), size * 0.6, window.innerWidth - size * 0.6), clamp(p[1] - 20, size * 0.6, window.innerHeight - size * 0.6));
          if(!alive()) return;
          look(null);
          mood('contento');
          wave(1500);
          await wait(1500);
          mood('normal');
          return;
        }
        const to = pick();
        await swim(to[0], to[1]);
        if(!alive()) return;
        look(null);
        const whim = Math.random();
        if(whim < 0.3){ mood('guino'); await hop(90); await wait(700); mood('normal'); }
        else if(whim < 0.55){ sumi.play(el, 'look'); await wait(1500); }
        else await wait(500 + Math.random() * 600);
      };

      me.style.transform = move(body.x - size / 2, body.y - size / 2);
      me.classList.add('is-in');
      if(this.deskCalm()){
        cols[2].appendChild(card());
        mood('contento');
        return;
      }
      this.deskRaf = requestAnimationFrame(tick);
      /* Se da la vuelta: se estrecha hasta ponerse de canto y, al abrirse otra vez, ya está de
         espaldas (sin cara) o de frente. */
      const turn = async (back) => {
        el.animate([{scale:'1 1'}, {scale:'.06 1', offset:0.5}, {scale:'1 1'}], {duration:440, easing:'ease-in-out'});
        await wait(220);
        if(!alive()) return;
        this.deskBack = back;
        if(back){
          if(face) face.innerHTML = '';
          const extra = el.querySelector('.sumi-extra');
          if(extra) extra.setAttribute('d', '');
        } else sumi.setMood(el, this.deskMood);
        await wait(220);
      };
      /* Su sitio en el cristal: centrado en el panel, encima del tablero (en el móvil, que no
         tiene panel, arriba y en el centro). */
      const glass = () => {
        const b = this.desk.querySelector('.auth-desk-board');
        if(!plain && b && b.offsetParent){ const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top - size * 0.62]; }
        return [window.innerWidth / 2, Math.max(size * 0.62, shell().top * 0.52)];
      };
      /* Una tarjeta suelta en el agua, donde estaba la que llevaba: se le cae (fall) o se va
         hacia arriba, ya hecha (rise). */
      const ghost = (r, how) => {
        const f = document.createElement('i');
        f.className = 'auth-float is-ghost' + (how === 'rise' ? ' is-done' : '');
        f.style.animation = 'none';
        ink.insertBefore(f, me);
        const fall = how === 'fall';
        f.animate(fall
          ? [{transform:move(r.left, r.top) + ' rotate(0deg)', opacity:1}, {transform:move(r.left - 16, r.top + 60) + ' rotate(-16deg)', opacity:1, offset:0.45}, {transform:move(r.left + 10, r.top + 190) + ' rotate(-34deg)', opacity:0}]
          : [{transform:move(r.left, r.top), opacity:1}, {transform:move(r.left, r.top - 70) + ' scale(.9)', opacity:0}],
          {duration:fall ? 1050 : 560, easing:fall ? 'cubic-bezier(.45,0,.85,.55)' : 'ease-out', fill:'forwards'}).onfinish = () => f.remove();
      };
      const recent = (when) => when && performance.now() - when < 300;
      /* Acceso correcto: la tarjeta que llevara se desvanece y él se agacha, recoge los brazos y
         sale disparado hacia arriba, fuera de la pantalla, mientras se pasa a la aplicación.
         Si se entró con Google o GitHub (deskVia), que lo ha tenido esperando en el cristal,
         antes lo celebra con un salto y los brazos arriba. */
      if(recent(this.deskOkAt)){
        const via = this.deskVia;
        this.deskOkAt = 0;
        this.deskVia = false;
        if(this.deskDropped) ghost(this.deskDropped, 'rise');
        this.deskDropped = null;
        this.deskBack = false;
        sumi.setMood(el, 'fiesta');
        sparkle();
        look(null);
        (async () => {
          const crouch = async () => {
            pose(1.2, 0.8, 180);
            arms[0].liftTo = arms[2].liftTo = -0.2;
            reachTo = -5;
            await wait(180);
            reachTo = 0;
          };
          await crouch();
          if(!alive()) return;
          if(via){
            puff(body.x, body.y + size * 0.42, 6);
            const air = leap(size * 0.58, 0.6);
            await wait(90);
            if(!alive()) return;
            cheer(true);
            puff(body.x - size * 0.5, body.y - size * 0.3, 3);
            puff(body.x + size * 0.5, body.y - size * 0.3, 3);
            await air;
            if(!alive()) return;
            puff(body.x, body.y + size * 0.45, 4);
            await crouch();
            if(!alive()) return;
          }
          /* Despega con los brazos pegados al cuerpo; el agua se los deja atrás. */
          cheer(false);
          party = 0;
          body.to = null; body.home = null;
          body.vy = -240;
          body.fly = true;
          puff(body.x, body.y + size * 0.4, 8);
        })();
        return;
      }
      /* Dormido: se le cierran los ojos, deja de nadar y, al rato, se para todo lo del agua
         (él sigue meciéndose). Lo despierta cualquier movimiento (stir, en buildDesk). */
      if(this.deskSleep){
        (async () => {
          mood('dormido');
          look(null);
          await wait(1800);
          if(!alive()) return;
          ink.classList.add('is-asleep');
          asleep = true;
        })();
        return;
      }
      /* Lo que hace antes de ponerse a otra cosa: negar con la cabeza si algo fue mal en el
         formulario (y se le cae lo que llevara), o el respingo de quien se acaba de despertar. */
      let intro = Promise.resolve();
      if(recent(this.deskErrorAt)){
        if(this.deskDropped) ghost(this.deskDropped, 'fall');
        this.deskDropped = null;
        shake = 1;
        if(!this.deskBack) sumi.setMood(el, 'triste');
        intro = wait(1150).then(() => { if(alive() && !this.deskBack) sumi.setMood(el, this.deskMood); });
      } else if(this.deskWoke){
        this.deskWoke = false;
        sumi.setMood(el, 'aviso');
        intro = hop(160).then(() => wait(560)).then(() => { if(alive() && !this.deskBack) sumi.setMood(el, this.deskMood); });
      }
      if(this.deskBack && this.deskFocus !== 'pass') turn(false);
      if(this.deskFocus === 'pass'){
        /* La contraseña: deja lo que estuviera haciendo, se va a su sitio en el cristal y se
           da la vuelta. De espaldas, silba (unas burbujas) y se balancea hasta que se sale. */
        (async () => {
          await intro;
          if(!alive()) return;
          const at = glass();
          await swim(at[0], at[1]);
          if(!alive()) return;
          look(null);
          if(!this.deskBack) await turn(true);
          while(alive()){
            await wait(1500 + Math.random() * 900);
            if(!alive()) return;
            pose(1.05, 0.95, 240);
            body.vy -= 26;
            puff(body.x + size * 0.16, body.y - size * 0.04, 2);
          }
        })();
        return;
      }
      if(this.deskFocus === 'wait'){
        /* Se ha abierto la ventana de Google o de GitHub: se va a su sitio en el cristal y
           espera el resultado con los ojos como platos, mirando al botón que se pulsó, los
           brazos a medio levantar y dando botecitos de impaciencia; de vez en cuando mira al
           frente, a quien está al otro lado. Lo que venga después (entrar, un error o cerrar
           la ventana) lo saca de aquí. */
        (async () => {
          const btn = this.deskField, at = glass();
          const eye = () => look(btn ? mid(btn) : null);
          await intro;
          if(!alive()) return;
          mood('normal');
          await swim(at[0], at[1]);
          if(!alive()) return;
          eye();
          mood('aviso');
          await hop(110);
          arms[0].liftTo = arms[2].liftTo = 0.25;
          arms[0].hook = arms[2].hook = 0.2;
          for(let n = 1; alive(); n++){
            await wait(560 + Math.random() * 240);
            if(!alive()) return;
            pose(1.08, 0.93, 140);
            body.vy -= 46;
            arms[0].extV += 34; arms[2].extV += 34;
            if(n % 2) puff(body.x + (Math.random() - 0.5) * size * 0.5, body.y + size * 0.45, 1);
            if(n % 4 === 0){
              look(null);
              mood('contento');
              this.deskTimers.push(setTimeout(() => { if(alive()){ eye(); mood('aviso'); } }, 700));
            }
          }
        })();
        return;
      }
      if(this.deskFocus === 'mail'){
        /* El correo: se va a su sitio en el cristal, saluda y mira lo que se escribe. Con cada
           letra da un toquecito con un brazo, alternando, como si tecleara él también; y
           cuando aquello ya parece un correo, guiña un ojo. */
        (async () => {
          const field = this.deskField || this.email, at = glass();
          const eye = () => { const r = field.getBoundingClientRect(); look([r.left + Math.min(r.width - 10, 24 + (field.value || '').length * 8), r.top + r.height / 2]); };
          const whole = (v) => /[^ @]+@[^ @]+[.][^ @]{2,}/.test(v || '');
          let side = 0, seen = whole(field.value);
          this.deskTap = (f) => {
            if(!alive()) return;
            eye();
            side = 2 - side;
            arms[side].extV += 70; arms[1].extV += 26;
            pose(1.05, 0.95, 90);
            body.vy -= 12;
            if(Math.random() < 0.3) puff(body.x + (side - 1) * size * 0.25, body.y + size * 0.45, 1);
            const ok = whole(f.value);
            if(ok && !seen){
              mood('guino');
              hop(100);
              this.deskTimers.push(setTimeout(() => { if(alive()) mood('contento'); }, 950));
            }
            seen = ok;
          };
          await intro;
          if(!alive()) return;
          mood('contento');
          await swim(at[0], at[1]);
          if(!alive()) return;
          eye();
          wave(1500);
        })();
        return;
      }
      (async () => {
        await intro;
        await wait(700);
        while(alive()){
          if(plain || count(0) < 2){
            const p = pick(), f = float(p[0], p[1]);
            await wait(750);
            /* La ve: se sorprende y da un respingo. */
            look(p);
            mood('aviso');
            await hop(120);
            await wait(430);
            if(!alive()) return;
            mood('normal');
            await swim(p[0], p[1] - size * 0.62);
            if(!alive()) return;
            await grab(f);
            if(!alive()) return;
            await (plain ? surface() : deliver());
            if(!alive()) return;
          }
          if(!plain){
            if(count(1)){ await push(first(1), 2); if(!alive()) return; }
            if(count(0)){ await push(first(0), 1); if(!alive()) return; }
            if(count(2) > 2) release(first(2));
          }
          await idle();
          if(!alive()) return;
        }
      })();
    }

    /* Acceso correcto: la pantalla del ordenador lo celebra un instante antes de pasar a la app.
       Devuelve una promesa que se cumple al acabar, o null si no hay nada que enseñar (escena
       parada, sin WebGL o con movimiento reducido): entonces no se espera. */
    celebrate(){
      const s = Workhub.views.authScene;
      const st = s && s.state();
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-motion') === 'reduced';
      /* Sin paisaje lo celebra Sumi: sale disparado hacia arriba y eso hace de paso a la app. */
      if(this.deskOn && !calm && !this.screen.hidden){
        /* Con Google o GitHub lo celebra antes de irse (playDesk): dura algo más. */
        const via = this.deskVia;
        this.deskLeaving = true;
        this.setBusy(true);
        this.deskReact('ok');
        return new Promise((resolve) => setTimeout(resolve, via ? 1500 : 780));
      }
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

    /* handler(nombre, id): sin id es alguien nuevo; con id, un invitado de antes que vuelve. */
    bindGuest(handler){
      const back = (ev) => {
        const btn = ev.target.closest('[data-guest]');
        const g = btn && (this.guests || [])[+btn.getAttribute('data-guest')];
        if(g) handler(g.name || Workhub.t('Invitado'), g.id);
      };
      this.guestPrev.addEventListener('click', back);
      this.resume.addEventListener('click', back);
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

    /* «Crear cuenta y llevarme mis datos», en la barra lateral y en Ajustes (solo como invitado). */
    bindUpgrade(handler){
      $('btnGuestUpgrade').addEventListener('click', handler);
      $('btnGuestUpgradeSide').addEventListener('click', handler);
    }

    /* «Seguir como invitado», en el aviso de la pantalla de acceso. */
    bindMigrateCancel(handler){
      $('authMigrateCancel').addEventListener('click', handler);
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
      /* Si el formulario ya está a la vista (auth-early.js), se queda: ocultarlo aquí lo hacía
         parpadear hasta que Firebase contestaba. */
      if(!EARLY.shown) this.screen.hidden = true;
    }

    /* Ya hay sesión y se están cargando los datos: esqueleto de la página principal. */
    showAppSkeleton(){
      document.documentElement.classList.remove('auth-early');
      document.documentElement.classList.add('skel-on');
      this.screen.hidden = true;
    }

    /* blocked: hay red pero el servicio de acceso no contesta (no se culpa a la conexión). */
    showLoadError(onRetry, blocked){
      document.documentElement.classList.remove('auth-early');
      window.__hideBootSkeleton();
      EARLY.take(false);
      this.screen.hidden = false;
      this.panel.hidden = true;
      this.loading.hidden = false;
      this.loading.classList.add('is-error');
      const t = Workhub.t;
      this.loading.innerHTML =
        '<span class="auth-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.5a10.5 10.5 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M3 3l18 18"/></svg></span>' +
        '<strong class="auth-verify-title">' + esc(t(blocked ? 'El servicio de acceso no responde' : 'Sin conexión con el acceso')) + '</strong>' +
        '<span class="auth-sent-text">' + esc(t(blocked
          ? 'No se pudo contactar con el servicio de acceso aunque tu conexión funciona. Puede estar bloqueado temporalmente, o por una extensión del navegador o un filtro de red. Espera unos minutos y vuelve a intentarlo.'
          : 'No se pudo conectar con el servicio de acceso. Comprueba tu conexión.')) + '</span>';
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
      /* early: el formulario ya está a la vista desde el primer fotograma (auth-early.js). */
      const early = EARLY.shown;
      /* El fondo ya se estaba viendo (src/boot.js); desde aquí manda el atributo hidden. */
      document.documentElement.classList.remove('auth-early');
      window.__hideBootSkeleton();
      document.body.classList.add('is-authing');
      this.screen.hidden = false;
      this.loading.hidden = true;
      this.panel.hidden = false;
      const social = providers.filter((p) => PROVIDERS[p]);
      this.social = social;
      this.hasPassword = providers.indexOf('password') !== -1;
      if(!early || early.providers !== social.join(',')) this.paintProviders();
      this.providersEl.hidden = !social.length;
      this.divider.hidden = !social.length || !this.hasPassword;
      this.form.hidden = !this.hasPassword;
      this.allowSignup = allowSignup !== false;
      this.setGuestStep(false);
      /* Venir de «Crear cuenta» en la portada abre directamente el registro (una sola vez). */
      const wantsSignup = this.registroRequested && this.hasPassword && this.allowSignup;
      this.registroRequested = false;
      const mode = wantsSignup ? 'signup' : 'signin';
      /* Ya pintado así: no es un cambio de modo (no se vacía la contraseña ni se repite la
         entrada) y el cursor se queda donde lo tenga la persona. */
      if(early && early.mode === mode) this.mode = mode;
      this.setMode(mode, !early || !this.panel.contains(document.activeElement));
      /* Lo que se pulsó mientras cargaba la app se atiende ahora. */
      EARLY.take(true);
      this.playDesk();
    }

    paintProviders(){
      this.providersEl.innerHTML = EARLY.providersHtml(this.social || [], Workhub.t);
    }

    /* Tras cambiar de idioma sin recargar: se vuelve a pintar lo que esta vista escribió con el
       idioma anterior (lo demás lo traduce o lo devuelve al español el módulo de idiomas). */
    relabel(){
      $('authLang').querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-lang-choice') === Workhub.i18n.lang ? 'true' : 'false');
      });
      const guest = this.panel.classList.contains('is-guest');
      const shown = this.pass.type === 'text';
      this.paintProviders();
      this.paintSceneBtn();
      this.showGuests(this.guests);
      if(guest) this.setGuestStep(true); else this.setMode(this.mode);
      this.setPassVisible(shown);
      this.panel.classList.remove('is-swap');
      void this.panel.offsetWidth;
      this.panel.classList.add('is-swap');
    }

    /* Cuenta de correo sin verificar. handlers: {check() → Promise<bool>,
       resend() → Promise<bool>, signOut()} */
    showVerify(email, handlers){
      document.documentElement.classList.remove('auth-early');
      window.__hideBootSkeleton();
      EARLY.take(false);
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

    /* Viene de «Crear cuenta y llevarme mis datos»: aviso de que los datos de invitado se copiarán
       a la cuenta que entre, con la vuelta atrás. El nombre del invitado ya va puesto. */
    showMigrate(name){
      this.migrate.hidden = false;
      this.resume.hidden = true;
      if(name && !this.name.value) this.name.value = name;
    }

    /* Cuenta dentro, copiando los datos de invitado: puede tardar si hay muchas imágenes. */
    showMigrating(){
      document.documentElement.classList.remove('auth-early');
      window.__hideBootSkeleton();
      EARLY.take(false);
      document.body.classList.add('is-authing');
      this.screen.hidden = false;
      this.panel.hidden = true;
      this.loading.hidden = false;
      this.loading.classList.remove('is-error');
      this.loading.classList.add('is-verify');
      const t = Workhub.t;
      this.loading.innerHTML =
        '<span class="auth-badge is-busy" aria-hidden="true">' + SPIN + '</span>' +
        '<strong class="auth-verify-title">' + esc(t('Llevando tus datos a tu cuenta')) + '</strong>' +
        '<span class="auth-sent-text">' + esc(t('Estamos copiando tus proyectos de invitado. No cierres esta pestaña.')) + '</span>';
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
      EARLY.take(false);
      document.documentElement.classList.remove('auth-gate', 'auth-early');
      document.body.classList.remove('is-authing');
      this.screen.hidden = true;
      this.verifyRun = null;
      this.stopTimers();
      this.stopDesk();
      this.scene({reset:true});
    }

    /* Invitados de antes con datos en este navegador ([{id, name}]): cada uno puede volver a lo
       suyo; quien escribe un nombre entra como alguien nuevo, sin ver lo de los demás. Se ofrecen
       en el paso «invitado» y, para que nadie dé su trabajo por perdido al encontrarse con el
       acceso (una recarga, la sesión de invitado borrada), también en la primera pantalla. */
    showGuests(list){
      this.guests = list || [];
      const t = Workhub.t;
      const label = (g) => esc(g.name ? t('Continuar como {name}', {name:g.name}) : t('Continuar con los datos de invitado de este navegador'));
      this.guestPrev.hidden = !this.guests.length;
      /* Con el aviso de «Crear cuenta y llevarme mis datos» ya hay vuelta atrás: no se repite. */
      this.resume.hidden = !this.guests.length || !this.migrate.hidden;
      $('authResumeList').innerHTML = this.guests.map((g, i) =>
        '<button type="button" class="auth-link" data-guest="' + i + '" translate="no">' + label(g) + '</button>').join('');
      this.guestPrev.innerHTML = this.guests.map((g, i) =>
        '<button type="button" class="btn btn-ghost auth-guest-back" data-guest="' + i + '" translate="no">' + label(g) + '</button>').join('') +
        '<p class="auth-guest-or">' + esc(t('O entra como alguien nuevo, con un espacio vacío:')) + '</p>';
    }

    /* Paso «invitado»: solo el nombre; sustituye al resto del formulario de acceso. */
    setGuestStep(on){
      this.panel.classList.toggle('is-guest', on);
      this.guestForm.hidden = !on;
      this.guestMsg.hidden = true;
      /* El pie del invitado no habla de subir nada: sus datos no salen del navegador. */
      $('authFootCrypto').hidden = on;
      $('authFootGuest').hidden = !on;
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
      if(this.deskWait) this.deskWait(busy, who);
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
      $('guestUpgrade').hidden = false;
      $('btnGuestUpgradeSide').hidden = false;
    }

    /* ownPhoto: la foto que la persona ha subido en Ajustes (data: URL), si tiene; manda sobre la
       del proveedor de acceso. */
    showAccount(user, ownPhoto){
      const name = user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario');
      this.accountBox.hidden = false;
      this.accountName.textContent = name;
      this.accountMail.textContent = user.email || '';
      /* La foto viene del proveedor (Google, GitHub): solo se acepta https. */
      const fromProvider = Workhub.utils.urls.safeUrl(user.photoURL);
      const own = Workhub.models.AccountModel.isPhoto(ownPhoto) ? ownPhoto : '';
      const photo = own || (fromProvider && fromProvider.indexOf('https:') === 0 ? fromProvider : '');
      this.accountAvatar.style.setProperty('--h', hueFor(user.uid));
      this.accountAvatar.textContent = '';
      if(photo){
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
