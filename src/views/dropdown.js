/* Desplegable propio que sustituye visualmente a cada <select>.
   El <select> nativo sigue en el DOM (oculto) y es la fuente de verdad: el
   resto de la app lee su value y escucha su evento 'change' como siempre.
   Este componente solo lo pinta mejor: lista flotante con la opción marcada,
   buscador cuando hay muchas opciones, teclado completo y posición automática
   (arriba o abajo según el espacio).

   Atributos opcionales en el <select>:
   - data-placeholder: la opción vacía es solo un texto de ayuda y no se lista.
   - data-dots="status": muestra el color de estado de cada opción. */
(function(){
  const {esc} = Workhub.utils.html;
  const SEARCH_THRESHOLD = 8;
  const MENU_GAP = 6;
  const MENU_MAX_HEIGHT = 320;
  const NEW_VALUE = '__new__';
  const STATUS_DOT = {pendiente:'--st-pend', proceso:'--st-proc', espera:'--st-wait', completada:'--st-done'};
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');

  const CHEVRON = '<svg class="dd-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const CHECK = '<svg class="dd-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  let openInstance = null;
  let uid = 0;

  class Dropdown {
    constructor(select){
      this.select = select;
      this.id = 'dd' + (++uid);
      this.activeIndex = -1;
      this.query = '';

      this.root = document.createElement('div');
      this.root.className = 'dd';
      select.parentNode.insertBefore(this.root, select);
      this.root.appendChild(select);
      select.classList.add('dd-native');
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'dd-trigger';
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.setAttribute('aria-controls', this.id + '-menu');
      this.trigger.innerHTML = '<span class="dd-value"></span>' + CHEVRON;
      this.valueEl = this.trigger.firstChild;
      this.root.appendChild(this.trigger);

      this.menu = document.createElement('div');
      this.menu.className = 'dd-menu';
      this.menu.id = this.id + '-menu';
      if(supportsPopover) this.menu.setAttribute('popover', 'manual');
      else this.menu.hidden = true;
      this.menu.innerHTML = '<div class="dd-search" hidden><input type="text" autocomplete="off" spellcheck="false" placeholder="Buscar…" aria-label="Buscar opción"></div>' +
        '<div class="dd-list" role="listbox" tabindex="-1"></div>';
      this.searchWrap = this.menu.firstChild;
      this.searchInput = this.searchWrap.firstChild;
      this.list = this.menu.lastChild;
      this.root.appendChild(this.menu);

      this._linkLabel();
      this._observeSelect();
      this._bindEvents();
      this.refresh();
    }

    /* ---------- Sincronización con el <select> ---------- */

    _linkLabel(){
      const label = this.select.id ? document.querySelector('label[for="' + this.select.id + '"]') : null;
      if(label){
        if(!label.id) label.id = this.id + '-label';
        this.trigger.setAttribute('aria-labelledby', label.id + ' ' + this.id + '-value');
        this.valueEl.id = this.id + '-value';
        label.addEventListener('click', (ev) => {
          ev.preventDefault();
          this.trigger.focus();
        });
      } else if(this.select.getAttribute('aria-label')){
        this.trigger.setAttribute('aria-label', this.select.getAttribute('aria-label'));
      }
    }

    /* Los cambios hechos por código (value, selectedIndex, innerHTML, reset)
       no disparan eventos: se interceptan para mantener el botón al día. */
    _observeSelect(){
      const self = this;
      const proto = HTMLSelectElement.prototype;
      ['value', 'selectedIndex'].forEach((prop) => {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        Object.defineProperty(this.select, prop, {
          configurable: true,
          get(){ return desc.get.call(this); },
          set(v){ desc.set.call(this, v); self.refresh(); }
        });
      });
      new MutationObserver(() => this.refresh()).observe(this.select, {childList:true, subtree:true, characterData:true});
      this.select.addEventListener('change', () => this.refresh());
      if(this.select.form){
        this.select.form.addEventListener('reset', () => setTimeout(() => this.refresh(), 0));
      }
    }

    _isPlaceholder(opt){
      return this.select.hasAttribute('data-placeholder') && opt && opt.value === '';
    }

    _dotFor(value){
      if(this.select.getAttribute('data-dots') !== 'status') return '';
      const v = STATUS_DOT[value];
      return v ? '<span class="dd-dot" style="background:var(' + v + ')"></span>' : '';
    }

    refresh(){
      const opt = this.select.options[this.select.selectedIndex];
      const placeholder = !opt || this._isPlaceholder(opt);
      this.valueEl.innerHTML = opt ? this._dotFor(opt.value) + '<span class="dd-text">' + esc(opt.textContent) + '</span>' : '';
      this.trigger.classList.toggle('is-placeholder', placeholder);
      this.trigger.disabled = this.select.disabled;
      if(this.isOpen()) this._renderList();
    }

    /* ---------- Lista ---------- */

    _visibleOptions(){
      const q = this.query.trim().toLowerCase();
      return Array.from(this.select.options).map((opt, index) => ({opt, index})).filter(({opt}) => {
        if(opt.hidden || this._isPlaceholder(opt)) return false;
        if(q && opt.value !== NEW_VALUE && opt.textContent.toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
    }

    _renderList(){
      const items = this._visibleOptions();
      const selected = this.select.selectedIndex;
      if(!items.some((it) => it.index === this.activeIndex)){
        const sel = items.find((it) => it.index === selected);
        this.activeIndex = sel ? sel.index : (items[0] ? items[0].index : -1);
      }
      if(!items.length){
        this.list.innerHTML = '<div class="dd-empty">Sin resultados</div>';
        this.list.removeAttribute('aria-activedescendant');
        return;
      }
      this.list.innerHTML = items.map(({opt, index}) => {
        const isAction = opt.value === NEW_VALUE;
        const isSel = index === selected && !isAction;
        const cls = 'dd-option' + (isAction ? ' is-action' : '') + (isSel ? ' is-selected' : '') + (index === this.activeIndex ? ' is-active' : '');
        return (isAction ? '<div class="dd-sep" role="separator"></div>' : '') +
          '<div class="' + cls + '" role="option" id="' + this.id + '-o' + index + '" data-index="' + index + '" aria-selected="' + isSel + '">' +
          (isAction ? PLUS : this._dotFor(opt.value)) +
          '<span class="dd-text">' + esc(isAction ? opt.textContent.replace(/^\+\s*/, '') : opt.textContent) + '</span>' +
          (isSel ? CHECK : '') + '</div>';
      }).join('');
      this.list.setAttribute('aria-activedescendant', this.id + '-o' + this.activeIndex);
    }

    _setActive(index, scroll){
      this.activeIndex = index;
      this.list.querySelectorAll('.dd-option').forEach((el) => {
        el.classList.toggle('is-active', +el.getAttribute('data-index') === index);
      });
      this.list.setAttribute('aria-activedescendant', this.id + '-o' + index);
      if(scroll){
        const el = this.list.querySelector('[data-index="' + index + '"]');
        if(el) el.scrollIntoView({block:'nearest'});
      }
    }

    _moveActive(delta){
      const items = this._visibleOptions();
      if(!items.length) return;
      let pos = items.findIndex((it) => it.index === this.activeIndex);
      if(delta === Infinity) pos = items.length - 1;
      else if(delta === -Infinity) pos = 0;
      else pos = Math.min(items.length - 1, Math.max(0, pos + delta));
      this._setActive(items[pos].index, true);
    }

    choose(index){
      if(index < 0) return;
      const changed = this.select.selectedIndex !== index;
      this.select.selectedIndex = index;
      this.close(true);
      if(changed || this.select.value === NEW_VALUE){
        this.select.dispatchEvent(new Event('change', {bubbles:true}));
      }
    }

    /* ---------- Abrir y cerrar ---------- */

    isOpen(){
      return this.root.classList.contains('is-open');
    }

    open(){
      if(this.isOpen() || this.trigger.disabled) return;
      if(openInstance) openInstance.close(false);
      openInstance = this;
      this.query = '';
      this.searchInput.value = '';
      this.activeIndex = -1;
      const many = this.select.options.length > SEARCH_THRESHOLD;
      this.searchWrap.hidden = !many;
      this._renderList();
      this.root.classList.add('is-open');
      this.trigger.setAttribute('aria-expanded', 'true');
      if(supportsPopover) this.menu.showPopover();
      else this.menu.hidden = false;
      this.position();
      this._setActive(this.activeIndex, true);
      (many ? this.searchInput : this.list).focus({preventScroll:true});
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
      const width = Math.max(r.width, 200);
      const below = vh - r.bottom - MENU_GAP - 8;
      const above = r.top - MENU_GAP - 8;
      const natural = Math.min(this.menu.scrollHeight, MENU_MAX_HEIGHT);
      const placeAbove = below < Math.min(natural, 200) && above > below;
      const maxH = Math.max(120, Math.min(MENU_MAX_HEIGHT, placeAbove ? above : below));
      const m = this.menu.style;
      m.width = width + 'px';
      m.maxHeight = maxH + 'px';
      m.left = Math.max(8, Math.min(r.left, vw - width - 8)) + 'px';
      if(placeAbove){
        m.top = 'auto';
        m.bottom = (vh - r.top + MENU_GAP) + 'px';
      } else {
        m.bottom = 'auto';
        m.top = (r.bottom + MENU_GAP) + 'px';
      }
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
        } else if(ev.key.length === 1 && /\S/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey){
          /* Como en un select nativo: escribir una letra salta a la opción. */
          const k = ev.key.toLowerCase();
          const opts = Array.from(this.select.options);
          const start = this.select.selectedIndex + 1;
          const order = opts.slice(start).concat(opts.slice(0, start));
          const match = order.find((o) => !this._isPlaceholder(o) && o.value !== NEW_VALUE && o.textContent.trim().toLowerCase().startsWith(k));
          if(match && match.index !== this.select.selectedIndex){
            this.select.selectedIndex = match.index;
            this.select.dispatchEvent(new Event('change', {bubbles:true}));
          }
        }
      });

      this.list.addEventListener('pointermove', (ev) => {
        const opt = ev.target.closest('.dd-option');
        if(opt) this._setActive(+opt.getAttribute('data-index'), false);
      });
      this.list.addEventListener('click', (ev) => {
        const opt = ev.target.closest('.dd-option');
        if(opt) this.choose(+opt.getAttribute('data-index'));
      });

      this.searchInput.addEventListener('input', () => {
        this.query = this.searchInput.value;
        this.activeIndex = -1;
        this._renderList();
      });

      this.menu.addEventListener('keydown', (ev) => {
        switch(ev.key){
          case 'ArrowDown': ev.preventDefault(); this._moveActive(1); break;
          case 'ArrowUp': ev.preventDefault(); this._moveActive(-1); break;
          case 'PageDown': ev.preventDefault(); this._moveActive(8); break;
          case 'PageUp': ev.preventDefault(); this._moveActive(-8); break;
          case 'Home': if(ev.target === this.list){ ev.preventDefault(); this._moveActive(-Infinity); } break;
          case 'End': if(ev.target === this.list){ ev.preventDefault(); this._moveActive(Infinity); } break;
          case 'Enter':
          case ' ':
            if(ev.key === ' ' && ev.target === this.searchInput) break;
            ev.preventDefault();
            this.choose(this.activeIndex);
            break;
          case 'Escape':
            /* Que Escape cierre solo la lista, no el diálogo que la contiene. */
            ev.preventDefault();
            ev.stopPropagation();
            this.close(true);
            break;
          case 'Tab':
            this.close(false);
            break;
        }
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
  /* Un diálogo que se cierra se lleva su lista abierta. */
  document.addEventListener('close', (ev) => {
    if(openInstance && ev.target.contains && ev.target.contains(openInstance.root)) openInstance.close(false);
  }, true);

  Dropdown.enhanceAll = function(root){
    (root || document).querySelectorAll('select:not(.dd-native)').forEach((s) => new Dropdown(s));
  };

  Workhub.views.Dropdown = Dropdown;
})();
