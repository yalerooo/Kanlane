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
      sumi.follow(this.deskSumi);
      /* El formulario manda. Con la contraseña deja lo que esté haciendo, se va al cristal y se
         da la vuelta para no mirar; con el correo (o el nombre) se va también al cristal y
         acompaña lo que se escribe. Al salir del campo vuelve a lo suyo. */
      const attend = (what, field) => { this.deskFocus = what; this.deskField = field || null; if(this.deskOn) this.playDesk(true); };
      this.pass.addEventListener('focus', () => attend('pass'));
      this.pass.addEventListener('blur', () => attend(null));
      [this.email, this.name].forEach((field) => {
        if(!field) return;
        field.addEventListener('focus', () => attend('mail', field));
        field.addEventListener('blur', () => attend(null));
        field.addEventListener('input', () => { if(this.deskTap) this.deskTap(field); });
      });
      /* Por dónde anda el cursor, por si le da por acercarse a curiosear. */
      document.addEventListener('pointermove', (ev) => { if(ev.pointerType === 'mouse') this.deskPointer = [ev.clientX, ev.clientY, performance.now()]; }, {passive:true});
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
      this.ink.querySelectorAll('.auth-float, .auth-bub').forEach((n) => n.remove());
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
         se encoge o se estira; to: adónde va (null: flota); beat: por dónde va de la brazada;
         pose: un encogimiento o estirón pedido a mano, que se va solo. */
      const body = {x:start[0], y:start[1], vx:0, vy:0, rot:0, sx:1, sy:1, to:null, done:null, beat:0, pose:null, poseT:0, t:0};
      /* Los brazos: de cada uno, dónde lleva la punta respecto a su sitio (ox, oy) y a qué
         velocidad (vx, vy). reach: lo que se alarga de más el del medio para coger o empujar. */
      const geo = sumi.geometry(false);
      const arms = geo.arms.map((a, i) => ({node:el.querySelector('.sumi-arm-' + i), x:a[0] + a[1] / 2, len:(a[2] - geo.top) * 1.45 - 8, ox:0, oy:0, vx:0, vy:0, w:1.3 + i * 0.37, ph:i * 2.1}));
      let reach = 0, reachTo = 0;
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
        if(!alive()) return;
        this.deskRaf = requestAnimationFrame(tick);
        const dt = Math.min(0.034, last ? (now - last) / 1000 : 0.016);
        last = now;
        body.t += dt;
        this.deskAt = [body.x, body.y];
        let tsx = 1, tsy = 1, curl = 0, spread = 0;
        if(body.to){
          const dx = body.to[0] - body.x, dy = body.to[1] - body.y, d = Math.hypot(dx, dy) || 1;
          if(d < 7 && Math.hypot(body.vx, body.vy) < 40){
            /* Ha llegado. */
            const done = body.done;
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
            spread = -beat * 2.6 * go; curl = beat * 2.2 * go;
            if(Math.random() < dt * 2.4 * go) puff(body.x, body.y + size * 0.3, 1);
          }
        } else {
          const stop = Math.exp(-dt * 3);
          body.vx *= stop; body.vy *= stop;
        }
        body.x += body.vx * dt; body.y += body.vy * dt;
        /* Se ladea un poco hacia donde va; no se tumba. */
        const lean = clamp(body.vx * 0.045, -13, 13);
        body.rot += (lean - body.rot) * Math.min(1, dt * 4);
        if(body.pose){
          if(body.t < body.poseT){ tsx = body.pose[0]; tsy = body.pose[1]; }
          else body.pose = null;
        }
        body.sx += (tsx - body.sx) * Math.min(1, dt * 16);
        body.sy += (tsy - body.sy) * Math.min(1, dt * 16);
        me.style.transform = move(body.x - size / 2, body.y - size / 2) + ' rotate(' + body.rot.toFixed(2) + 'deg)';
        el.style.scale = body.sx.toFixed(3) + ' ' + body.sy.toFixed(3);

        /* Los brazos. La velocidad, vista desde el propio Sumi (que va ladeado): las puntas se
           quedan atrás de por donde va, se mecen cada una a su ritmo y, al encogerse o
           estirarse el cuerpo, se recogen o se alargan. Cada punta es un muelle. */
        const c = Math.cos(-body.rot / 57.3), s = Math.sin(-body.rot / 57.3);
        const lx = (body.vx * c - body.vy * s) * unit, ly = (body.vx * s + body.vy * c) * unit;
        reach += (reachTo - reach) * Math.min(1, dt * 18);
        arms.forEach((a, i) => {
          const tx = clamp(-lx * 0.05, -5, 5) + Math.sin(body.t * a.w + a.ph) * 1.8 + (i - 1) * spread;
          const ty = clamp(-ly * 0.04, -3, 6) + Math.cos(body.t * a.w * 0.8 + a.ph) * 0.8 + curl;
          a.vx += ((tx - a.ox) * 46 - a.vx * 6.5) * dt; a.ox += a.vx * dt;
          a.vy += ((ty - a.oy) * 46 - a.vy * 7.5) * dt; a.oy += a.vy * dt;
          /* Sale recta del cuerpo hasta pasada su raíz (que no se vea corte en la unión) y de
             ahí para abajo se curva hasta la punta. */
          const len = Math.max(6, a.len + a.oy + (i === 1 ? reach : 0)), y = geo.top + 8;
          a.node.setAttribute('d', 'M' + a.x + ' ' + geo.top + 'V' + y + 'C' + a.x + ' ' + (y + len * 0.42).toFixed(2) + ' ' + (a.x + a.ox * 0.5).toFixed(2) + ' ' + (y + len * 0.74).toFixed(2) + ' ' + (a.x + a.ox).toFixed(2) + ' ' + (y + len).toFixed(2));
        });
        /* Lo que lleva colgado se balancea: un péndulo que tira hacia atrás de donde va. */
        if(held){
          swingV += ((clamp(-lx * 0.9, -32, 32) - swing) * 34 - swingV * 4.5) * dt;
          swing += swingV * dt;
          held.style.rotate = swing.toFixed(2) + 'deg';
        }
      };

      /* Nada hasta ahí. Mira adonde va. */
      const swim = (x, y) => new Promise((done) => {
        look([x, y]);
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
          n.animate([
            {transform:from + ' rotate(0deg) scale(1)'},
            {transform:'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 30) + 'px) rotate(' + (dx < 0 ? 9 : -9) + 'deg) scale(1.1)', offset:0.5},
            {transform:'translate(0px,3px) rotate(0deg) scale(1.06, .92)', offset:0.82},
            {transform:'translate(0px,-2px) scale(.98, 1.03)', offset:0.92},
            {transform:'none'}
          ], {duration:760, easing:'cubic-bezier(.3,.7,.3,1)'}).onfinish = () => n.classList.remove('is-fly');
        });
        again(cols[to], 'is-hit');
        const next = over(c);
        await swim(next[0], next[1]);
        if(!alive() || to !== 2) return;
        /* A «Hecho»: anillo verde, burbujas, cara de fiesta y una voltereta. */
        again(c, 'is-landed');
        puff(mid(c)[0], mid(c)[1], 7);
        mood('fiesta');
        look(null);
        pose(1.14, 0.86, 140);
        await wait(140);
        body.vy -= 190;
        pose(0.9, 1.12, 240);
        el.animate([{rotate:'0deg'}, {rotate:'360deg'}], {duration:820, easing:'cubic-bezier(.35,0,.25,1)'});
        await wait(1150);
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
          sumi.play(el, 'wave');
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
      if(this.deskBack && this.deskFocus !== 'pass') turn(false);
      if(this.deskFocus === 'pass'){
        /* La contraseña: deja lo que estuviera haciendo, se va a su sitio en el cristal y se
           da la vuelta. De espaldas, silba (unas burbujas) y se balancea hasta que se sale. */
        (async () => {
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
            arms[side].vy += 75; arms[1].vy += 28;
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
          mood('contento');
          await swim(at[0], at[1]);
          if(!alive()) return;
          eye();
          sumi.play(el, 'wave');
        })();
        return;
      }
      (async () => {
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
