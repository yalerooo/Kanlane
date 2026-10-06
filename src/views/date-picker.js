/* Selector de fecha propio que sustituye visualmente a un <input type="date">.
   Como el desplegable (dropdown.js): el campo nativo sigue en el DOM (oculto) y es la fuente
   de verdad; el resto de la app lee su value como siempre. Este componente pinta un botón con
   la fecha elegida y, al pulsarlo, un calendario flotante con el aspecto de la app: mes con
   la semana empezando en lunes, atajos (hoy, mañana, en una semana) y teclado completo.

   Atributos en el <input type="date">:
   - data-dp: lo convierte (DatePicker.enhanceAll).
   - data-dp-time="id": añade al calendario un campo de hora con ese id. Su value es 'HH:MM'
     o '' y se lee igual que el de la fecha. Sin fecha no hay hora. */
(function(){
  const {esc} = Workhub.utils.html;
  const {ymd, parseYmd, todayYmd, capitalize} = Workhub.utils.dates;
  const MENU_GAP = 6;
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const PRESETS = ['09:00', '12:00', '15:00', '18:00'];
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');

  const svg = (size, width, path) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' + width + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  const CALENDAR = svg(15, 1.8, '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>');
  const CLOCK = svg(14, 1.8, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
  const PREV = svg(15, 2, '<path d="M15 6l-6 6 6 6"/>');
  const NEXT = svg(15, 2, '<path d="M9 6l6 6-6 6"/>');
  const CROSS = svg(13, 2.2, '<path d="M6 6l12 12M18 6L6 18"/>');

  let openInstance = null;
  let uid = 0;

  const addDays = (date, n) => { const d = parseYmd(date); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };

  class DatePicker {
    constructor(input){
      this.input = input;
      this.id = 'dp' + (++uid);
      const timeId = input.getAttribute('data-dp-time');

      this.root = document.createElement('div');
      this.root.className = 'dp';
      input.parentNode.insertBefore(this.root, input);
      this.root.appendChild(input);
      input.classList.add('dp-native');
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'dp-trigger is-placeholder';
      this.trigger.setAttribute('aria-haspopup', 'dialog');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.setAttribute('aria-controls', this.id + '-menu');
      this.trigger.innerHTML = CALENDAR + '<span class="dp-value" id="' + this.id + '-value"><span class="dp-placeholder">Sin fecha</span><span class="dp-text" translate="no" hidden></span></span>';
      this.placeholder = this.trigger.querySelector('.dp-placeholder');
      this.text = this.trigger.querySelector('.dp-text');
      this.root.appendChild(this.trigger);

      this.clear = document.createElement('button');
      this.clear.type = 'button';
      this.clear.className = 'dp-clear';
      this.clear.setAttribute('aria-label', 'Quitar fecha');
      this.clear.title = 'Quitar fecha';
      this.clear.innerHTML = CROSS;
      this.clear.hidden = true;
      this.root.appendChild(this.clear);

      this.menu = document.createElement('div');
      this.menu.className = 'dp-menu';
      this.menu.id = this.id + '-menu';
      this.menu.setAttribute('role', 'dialog');
      this.menu.setAttribute('aria-label', 'Elegir fecha');
      if(supportsPopover) this.menu.setAttribute('popover', 'manual');
      else this.menu.hidden = true;
      this.menu.innerHTML =
        '<div class="dp-head">' +
          '<button type="button" class="dp-nav" data-nav="-1" aria-label="Mes anterior">' + PREV + '</button>' +
          '<span class="dp-month" translate="no" aria-live="polite"></span>' +
          '<button type="button" class="dp-nav" data-nav="1" aria-label="Mes siguiente">' + NEXT + '</button>' +
        '</div>' +
        '<div class="dp-week" translate="no" aria-hidden="true"></div>' +
        '<div class="dp-grid" translate="no"></div>' +
        '<div class="dp-quick">' +
          '<button type="button" data-quick="0">Hoy</button>' +
          '<button type="button" data-quick="1">Mañana</button>' +
          '<button type="button" data-quick="7">En una semana</button>' +
        '</div>' +
        (timeId ?
          '<div class="dp-time">' +
            '<label for="' + esc(timeId) + '">' + CLOCK + '<span>Hora</span></label>' +
            '<input type="time" id="' + esc(timeId) + '">' +
            '<button type="button" class="dp-notime" hidden>Sin hora</button>' +
            '<div class="dp-presets" translate="no">' + PRESETS.map((p) => '<button type="button" data-time="' + p + '">' + p + '</button>').join('') + '</div>' +
          '</div>' : '') +
        '<div class="dp-foot">' +
          '<button type="button" class="dp-remove">Quitar fecha</button>' +
          '<button type="button" class="dp-done">Listo</button>' +
        '</div>';
      this.monthLabel = this.menu.querySelector('.dp-month');
      this.week = this.menu.querySelector('.dp-week');
      this.grid = this.menu.querySelector('.dp-grid');
      this.time = timeId ? this.menu.querySelector('.dp-time input') : null;
      this.noTime = this.menu.querySelector('.dp-notime');
      this.remove = this.menu.querySelector('.dp-remove');
      this.root.appendChild(this.menu);

      this.active = todayYmd();
      this.view = this._monthOf(this.active);
      this._linkLabel();
      this._observe(this.input);
      if(this.time) this._observe(this.time);
      this._bindEvents();
      this.refresh();
    }

    /* ---------- Sincronización con los campos ---------- */

    _linkLabel(){
      const label = this.input.id ? document.querySelector('label[for="' + this.input.id + '"]') : null;
      if(!label) return;
      if(!label.id) label.id = this.id + '-label';
      this.trigger.setAttribute('aria-labelledby', label.id + ' ' + this.id + '-value');
      label.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.trigger.focus();
      });
    }

    /* Los cambios hechos por código (value, reset del formulario) no disparan eventos. */
    _observe(field){
      const self = this;
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      Object.defineProperty(field, 'value', {
        configurable: true,
        get(){ return desc.get.call(this); },
        set(v){ desc.set.call(this, v); self.refresh(); }
      });
      if(field.form) field.form.addEventListener('reset', () => setTimeout(() => this.refresh(), 0));
    }

    date(){ return YMD.test(this.input.value) ? this.input.value : ''; }

    hour(){ return this.time && this.date() && TIME.test(this.time.value) ? this.time.value : ''; }

    /* Lo que elige la persona: avisa con 'change' en el campo de fecha, como uno nativo. */
    _set(date, hour){
      const before = this.date() + ' ' + this.hour();
      this.input.value = date;
      if(this.time && this.time.value !== (date ? hour : '')) this.time.value = date ? hour : '';
      if(before !== this.date() + ' ' + this.hour()) this.input.dispatchEvent(new Event('change', {bubbles:true}));
    }

    refresh(){
      const date = this.date();
      const hour = this.hour();
      this.placeholder.hidden = !!date;
      this.text.hidden = !date;
      this.clear.hidden = !date;
      this.trigger.classList.toggle('is-placeholder', !date);
      if(date){
        const d = parseYmd(date);
        const opts = {weekday:'short', day:'numeric', month:'short'};
        if(d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        this.text.innerHTML = '<span>' + esc(capitalize(d.toLocaleDateString(Workhub.i18n.locale, opts))) + '</span>' +
          (hour ? '<span class="dp-at">' + esc(hour) + '</span>' : '');
      }
      if(this.isOpen()) this._render();
    }

    /* ---------- Calendario ---------- */

    _monthOf(date){
      const d = parseYmd(date);
      return {y:d.getFullYear(), m:d.getMonth()};
    }

    _render(){
      const loc = Workhub.i18n.locale;
      const first = new Date(this.view.y, this.view.m, 1);
      const offset = (first.getDay() + 6) % 7;
      const today = todayYmd();
      const selected = this.date();
      this.monthLabel.textContent = capitalize(first.toLocaleDateString(loc, {month:'long', year:'numeric'}));
      if(!this.week.firstChild){
        /* El 1 de enero de 2024 fue lunes. */
        this.week.innerHTML = [0, 1, 2, 3, 4, 5, 6].map((i) => '<span>' + esc(new Date(2024, 0, 1 + i).toLocaleDateString(loc, {weekday:'narrow'}).toUpperCase()) + '</span>').join('');
      }
      let html = '';
      for(let i = 0; i < 42; i++){
        const d = new Date(this.view.y, this.view.m, 1 - offset + i);
        const key = ymd(d);
        const cls = 'dp-day' + (d.getMonth() !== this.view.m ? ' is-out' : '') + (key === today ? ' is-today' : '') + (key === selected ? ' is-selected' : '');
        html += '<button type="button" class="' + cls + '" data-date="' + key + '" tabindex="' + (key === this.active ? '0' : '-1') + '"' +
          ' aria-label="' + esc(d.toLocaleDateString(loc, {weekday:'long', day:'numeric', month:'long', year:'numeric'})) + '"' +
          ' aria-pressed="' + (key === selected) + '">' + d.getDate() + '</button>';
      }
      this.grid.innerHTML = html;
      this.remove.disabled = !selected;
      if(this.time){
        const hour = this.hour();
        this.noTime.hidden = !hour;
        this.menu.querySelectorAll('.dp-presets button').forEach((b) => b.classList.toggle('is-selected', b.getAttribute('data-time') === hour));
      }
    }

    /* Mueve el día activo (el que tiene el foco del teclado) y enseña su mes. */
    _goTo(date, focus){
      this.active = date;
      this.view = this._monthOf(date);
      this._render();
      if(focus) this._focusActive();
    }

    _focusActive(){
      const el = this.grid.querySelector('[data-date="' + this.active + '"]');
      if(el) el.focus({preventScroll:true});
    }

    _shiftMonth(delta, focus){
      const d = parseYmd(this.active);
      const last = new Date(d.getFullYear(), d.getMonth() + delta + 1, 0).getDate();
      this._goTo(ymd(new Date(d.getFullYear(), d.getMonth() + delta, Math.min(d.getDate(), last))), focus);
    }

    _pick(date){
      this.active = date;
      this.view = this._monthOf(date);
      this._set(date, this.hour());
      /* Con hora, el calendario sigue abierto para poder ponerla; sin ella, ya está todo elegido. */
      if(!this.time) this.close(true);
      else this._focusActive();
    }

    /* ---------- Abrir y cerrar ---------- */

    isOpen(){
      return this.root.classList.contains('is-open');
    }

    open(){
      if(this.isOpen() || this.trigger.disabled) return;
      if(openInstance) openInstance.close(false);
      openInstance = this;
      this.active = this.date() || todayYmd();
      this.view = this._monthOf(this.active);
      this.root.classList.add('is-open');
      this.trigger.setAttribute('aria-expanded', 'true');
      this._render();
      if(supportsPopover) this.menu.showPopover();
      else this.menu.hidden = false;
      this.position();
      this._focusActive();
    }

    close(focusTrigger){
      if(!this.isOpen()) return;
      this.root.classList.remove('is-open');
      this.trigger.setAttribute('aria-expanded', 'false');
      if(supportsPopover){
        try{ this.menu.hidePopover(); }catch(e){}
      } else {
        this.menu.hidden = true;
      }
      if(openInstance === this) openInstance = null;
      if(focusTrigger) this.trigger.focus({preventScroll:true});
    }

    /* Debajo del botón si cabe; si no, encima. Siempre dentro de la ventana. */
    position(){
      const r = this.trigger.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = this.menu.offsetWidth, h = this.menu.offsetHeight;
      const below = vh - r.bottom - MENU_GAP - 8;
      const above = r.top - MENU_GAP - 8;
      const placeAbove = below < h && above > below;
      const top = placeAbove ? r.top - MENU_GAP - h : r.bottom + MENU_GAP;
      const m = this.menu.style;
      m.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
      m.top = Math.max(8, Math.min(top, vh - h - 8)) + 'px';
      this.menu.classList.toggle('is-above', placeAbove);
    }

    /* ---------- Eventos ---------- */

    _bindEvents(){
      this.trigger.addEventListener('click', () => {
        if(this.isOpen()) this.close(true);
        else this.open();
      });
      this.trigger.addEventListener('keydown', (ev) => {
        if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
          ev.preventDefault();
          this.open();
        }
      });
      this.clear.addEventListener('click', () => {
        this._set('', '');
        this.close(false);
        this.trigger.focus({preventScroll:true});
      });

      this.menu.addEventListener('click', (ev) => {
        const el = ev.target.closest('button');
        if(!el) return;
        if(el.hasAttribute('data-date')) this._pick(el.getAttribute('data-date'));
        else if(el.hasAttribute('data-nav')) this._shiftMonth(+el.getAttribute('data-nav'), false);
        else if(el.hasAttribute('data-quick')) this._pick(addDays(todayYmd(), +el.getAttribute('data-quick')));
        else if(el.hasAttribute('data-time')) this._set(this.date() || todayYmd(), el.getAttribute('data-time'));
        else if(el === this.noTime){ this._set(this.date(), ''); this.time.focus({preventScroll:true}); }
        else if(el === this.remove){ this._set('', ''); this.close(true); }
        else if(el.classList.contains('dp-done')) this.close(true);
      });

      if(this.time){
        /* Escribir una hora sin fecha pone la de hoy: una hora suelta no significa nada. */
        this.time.addEventListener('input', () => {
          const v = this.time.value;
          if(TIME.test(v) && !this.date()) this._set(todayYmd(), v);
          else { this.refresh(); this.input.dispatchEvent(new Event('change', {bubbles:true})); }
        });
      }

      this.grid.addEventListener('keydown', (ev) => {
        const step = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7}[ev.key];
        if(step){
          ev.preventDefault();
          this._goTo(addDays(this.active, step), true);
        } else if(ev.key === 'PageUp' || ev.key === 'PageDown'){
          ev.preventDefault();
          this._shiftMonth(ev.key === 'PageUp' ? -1 : 1, true);
        } else if(ev.key === 'Home' || ev.key === 'End'){
          ev.preventDefault();
          const weekday = (parseYmd(this.active).getDay() + 6) % 7;
          this._goTo(addDays(this.active, ev.key === 'Home' ? -weekday : 6 - weekday), true);
        }
      });

      this.menu.addEventListener('keydown', (ev) => {
        if(ev.key === 'Escape'){
          /* Que Escape cierre solo el calendario, no el diálogo que lo contiene. */
          ev.preventDefault();
          ev.stopPropagation();
          this.close(true);
        } else if(ev.key === 'Enter' && ev.target === this.time){
          /* Intro en la hora la da por buena; no envía el formulario. */
          ev.preventDefault();
          this.close(true);
        }
      });
      /* El foco que sale del calendario (Tab) lo cierra. */
      this.menu.addEventListener('focusout', (ev) => {
        if(ev.relatedTarget && !this.root.contains(ev.relatedTarget)) this.close(false);
      });
    }
  }

  /* Cierre global: clic fuera, scroll de la página o cambio de tamaño. */
  document.addEventListener('pointerdown', (ev) => {
    if(openInstance && !openInstance.root.contains(ev.target)) openInstance.close(false);
  }, true);
  document.addEventListener('scroll', (ev) => {
    if(openInstance && !openInstance.menu.contains(ev.target)) openInstance.position();
  }, true);
  window.addEventListener('resize', () => { if(openInstance) openInstance.close(false); });
  /* Un diálogo que se cierra se lleva su calendario abierto. */
  document.addEventListener('close', (ev) => {
    if(openInstance && ev.target.contains && ev.target.contains(openInstance.root)) openInstance.close(false);
  }, true);

  DatePicker.enhanceAll = function(root){
    (root || document).querySelectorAll('input[data-dp]:not(.dp-native)').forEach((i) => new DatePicker(i));
  };

  Workhub.views.DatePicker = DatePicker;
})();
