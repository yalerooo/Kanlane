/* Ajustes: muestras de color de acento, selector de tema y almacenamiento.
   También aplica acento y tema al documento (variables CSS y data-theme). */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  class SettingsView {
    constructor(){
      this.swatches = $('accentSwatches');
      this.themeSegment = $('themeSegment');
      this.storageCard = $('storageCard');
      this.storageTitle = $('storageTitle');
      this.storageDesc = $('storageDesc');
      this.langSegment = $('langSegment');
      this.navSegment = $('navSegment');
      this.nav = $('settingsNav');
      this.bindIndex();
    }

    /* Índice de la izquierda: lleva a cada grupo y marca el que se está viendo. */
    bindIndex(){
      if(!this.nav) return;
      const buttons = Array.from(this.nav.querySelectorAll('button[data-sec]'));
      const mark = (id) => buttons.forEach((b) => {
        if(b.getAttribute('data-sec') === id) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
      this.nav.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-sec]');
        const target = b && $(b.getAttribute('data-sec'));
        if(!target) return;
        const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({behavior:calm ? 'auto' : 'smooth', block:'start'});
        mark(b.getAttribute('data-sec'));
      });
      if(typeof IntersectionObserver !== 'function') return;
      const seen = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if(e.isIntersecting) mark(e.target.id); });
      }, {rootMargin:'-20% 0px -70% 0px'});
      buttons.forEach((b) => { const el = $(b.getAttribute('data-sec')); if(el) seen.observe(el); });
    }

    bindNav(handler){
      this.navSegment.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-nav-choice]');
        if(b) handler(b.getAttribute('data-nav-choice'));
      });
    }

    bindLang(handler){
      this.langSegment.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-lang-choice]');
        if(b) handler(b.getAttribute('data-lang-choice'));
      });
    }

    bindAccent(handler){
      this.swatches.addEventListener('click', (ev) => {
        const b = closest(ev.target, '.swatch');
        if(b) handler(b.getAttribute('data-accent'));
      });
    }

    bindTheme(handler){
      this.themeSegment.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-theme-choice]');
        if(b) handler(b.getAttribute('data-theme-choice'));
      });
    }

    applyAccent(a){
      const s = document.documentElement.style;
      s.setProperty('--acc-solid-l', a.solid);
      s.setProperty('--acc-ink-l', a.ink);
      s.setProperty('--acc-text-l', a.textL);
      s.setProperty('--acc-soft-l', a.softL);
      s.setProperty('--acc-solid-d', a.solidD || a.solid);
      s.setProperty('--acc-ink-d', a.inkD || a.ink);
      s.setProperty('--acc-text-d', a.textD);
      s.setProperty('--acc-soft-d', a.softD);
      /* Velo de color de las dos esquinas del fondo. */
      s.setProperty('--hue-a', a.hueA || a.solid);
      s.setProperty('--hue-b', a.hueB || a.hueA || a.solid);
    }

    /* 'side' (lateral, por defecto) | 'top' (barra arriba). Lo lee layout.css. */
    applyNav(nav){
      const root = document.documentElement;
      if(nav === 'top') root.setAttribute('data-nav', 'top');
      else root.removeAttribute('data-nav');
    }

    /* 'system' solo quita el atributo si lo ha pedido el usuario: al arrancar se
       respeta el que ya tuviera la página (p. ej. el que fija el visor de Claude). */
    applyTheme(choice, fromUser){
      const root = document.documentElement;
      if(choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
      else if(fromUser) root.removeAttribute('data-theme');
    }

    /* mode: 'local' | 'firebase' | 'claude' */
    render(accents, currentAccent, currentTheme, mode, currentNav){
      this.storageModeNow = mode;
      if(!this.watchingConnection){
        this.watchingConnection = true;
        const again = () => this.renderStorage(this.storageModeNow);
        window.addEventListener('online', again);
        window.addEventListener('offline', again);
      }
      this.swatches.innerHTML = accents.map((a) => {
        const sel = a.key === currentAccent;
        return '<button type="button" class="swatch" role="radio" aria-checked="' + (sel ? 'true' : 'false') + '" data-accent="' + a.key + '" style="--sw:' + a.solid + ';--sw-d:' + (a.solidD || a.solid) + '">' +
          '<span class="swatch-dot" aria-hidden="true"></span>' + esc(a.name) + '</button>';
      }).join('');
      this.langSegment.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-lang-choice') === Workhub.i18n.lang ? 'true' : 'false');
      });
      this.themeSegment.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-theme-choice') === currentTheme ? 'true' : 'false');
      });
      this.navSegment.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-nav-choice') === (currentNav || 'side') ? 'true' : 'false');
      });
      this.renderStorage(mode);
    }

    renderStorage(mode){
      const info = Workhub.views.storageInfo(mode);
      this.storageCard.setAttribute('data-mode', info.mode);
      this.storageTitle.textContent = info.title;
      this.storageDesc.textContent = info.desc;
    }
  }

  Workhub.views.SettingsView = SettingsView;
})();
