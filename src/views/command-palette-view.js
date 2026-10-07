/* Paleta de comandos (Ctrl/⌘ K): un buscador único para saltar a cualquier
   tarea, contacto, cliente o reunión, o lanzar una acción. */
(function(){
  const {esc} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  /* Resalta la primera aparición de la búsqueda dentro del texto. */
  function highlight(text, query){
    const t = String(text || '');
    const q = query.trim().toLowerCase();
    const i = q ? t.toLowerCase().indexOf(q) : -1;
    if(i === -1) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
  }

  class CommandPaletteView {
    constructor(){
      this.dlg = $('dlgCommand');
      this.input = $('cmdInput');
      this.list = $('cmdList');
      this.trigger = $('btnCommand');
      this.hint = $('cmdHint');
      this.items = [];
      this.active = 0;
      this.query = '';

      if(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)){
        this.hint.textContent = '⌘K';
        this.trigger.setAttribute('aria-label', 'Buscar (⌘K)');
      }

      this.list.addEventListener('pointermove', (ev) => {
        const el = ev.target.closest('.cmdk-item');
        if(el) this._setActive(+el.getAttribute('data-index'), false);
      });
      this.input.addEventListener('keydown', (ev) => {
        if(ev.key === 'ArrowDown'){ ev.preventDefault(); this._move(1); }
        else if(ev.key === 'ArrowUp'){ ev.preventDefault(); this._move(-1); }
        else if(ev.key === 'PageDown'){ ev.preventDefault(); this._move(6); }
        else if(ev.key === 'PageUp'){ ev.preventDefault(); this._move(-6); }
      });
      /* Clic fuera del recuadro (en el fondo) cierra. */
      this.dlg.addEventListener('click', (ev) => { if(ev.target === this.dlg) this.close(); });
    }

    bindTrigger(handler){ this.trigger.addEventListener('click', handler); }

    bindQuery(handler){
      this.input.addEventListener('input', () => {
        this.query = this.input.value;
        handler(this.query);
      });
    }

    /* handler(item) */
    bindChoose(handler){
      this.list.addEventListener('click', (ev) => {
        const el = ev.target.closest('.cmdk-item');
        if(el) handler(this.items[+el.getAttribute('data-index')]);
      });
      this.input.addEventListener('keydown', (ev) => {
        if(ev.key === 'Enter' && this.items[this.active]){
          ev.preventDefault();
          handler(this.items[this.active]);
        }
      });
    }

    isOpen(){ return this.dlg.open; }

    open(){
      this.input.value = '';
      this.query = '';
      if(!this.dlg.open) this.dlg.showModal();
      this.input.focus();
    }

    close(){ if(this.dlg.open) this.dlg.close(); }

    /* groups: [{label, items:[{id, kind, title, meta, icon}]}] */
    render(groups){
      this.items = [];
      let html = '';
      groups.forEach((g) => {
        if(!g.items.length) return;
        html += '<div class="cmdk-group" role="presentation">' + esc(g.label) + '</div>';
        g.items.forEach((it) => {
          const i = this.items.length;
          this.items.push(it);
          html += '<div class="cmdk-item" role="option" id="cmd-o' + i + '" data-index="' + i + '" aria-selected="false">' +
            '<span class="cmdk-icon" aria-hidden="true">' + (it.icon || '') + '</span>' +
            '<span class="cmdk-title" translate="no">' + highlight(it.title, this.query) + '</span>' +
            (it.meta ? '<span class="cmdk-meta" translate="no">' + highlight(it.meta, this.query) + '</span>' : '') +
            '<kbd class="kbd cmdk-enter" aria-hidden="true">↵</kbd>' +
            '</div>';
        });
      });
      this.list.innerHTML = html || '<div class="cmdk-empty">' + Workhub.views.sumi.svg({mood:'dormido', size:48, cls:'is-sleep'}) + '<span>Sin resultados para «' + esc(this.query.trim()) + '»</span></div>';
      this._setActive(0, true);
    }

    _setActive(i, scroll){
      if(!this.items.length){ this.input.removeAttribute('aria-activedescendant'); return; }
      this.active = Math.max(0, Math.min(this.items.length - 1, i));
      this.list.querySelectorAll('.cmdk-item').forEach((el) => {
        const on = +el.getAttribute('data-index') === this.active;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-selected', on);
      });
      this.input.setAttribute('aria-activedescendant', 'cmd-o' + this.active);
      if(scroll){
        const el = this.list.querySelector('[data-index="' + this.active + '"]');
        if(el) el.scrollIntoView({block:'nearest'});
      }
    }

    _move(delta){ this._setActive(this.active + delta, true); }
  }

  Workhub.views.CommandPaletteView = CommandPaletteView;
})();
