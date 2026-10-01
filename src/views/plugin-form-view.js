/* Formulario que un plugin pide mostrar (wh.ui.form). Lo dibuja Kanlane con
   sus propios componentes a partir de una descripción declarativa: el plugin
   nunca inserta HTML. Devuelve lo que la persona rellena, o null si cancela.
   Campos: number, text, select (con «añadir nuevo» opcional) y dates
   (calendario para elegir varios días). */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);
  const NEW = '__new__';
  const PALETTE = ['#2F6BFF', '#16A36A', '#E0457B', '#EA6A1F', '#7C5CFF', '#E6A310', '#0E9AA7', '#8B8B94'];
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const CHEVRON_L = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  const CHEVRON_R = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  class PluginFormView {
    constructor(){
      this.dlg = $('dlgPluginForm');
      this.form = $('formPluginForm');
      this.who = $('pfWho');
      this.title = $('pfTitle');
      this.sub = $('pfSub');
      this.intro = $('pfIntro');
      this.body = $('pfBody');
      this.error = $('pfError');
      this.btnOk = $('pfSubmit');
      this.btnCancel = $('pfCancel');
      this.resolve = null;
      this.spec = null;
      this.state = {};

      this.form.addEventListener('submit', (ev) => { ev.preventDefault(); this._submit(); });
      this.btnCancel.addEventListener('click', () => this._finish(null));
      /* Escape o la X: es lo mismo que cancelar. */
      this.dlg.addEventListener('close', () => this._finish(null));
      this.body.addEventListener('click', (ev) => this._click(ev));
      this.body.addEventListener('change', (ev) => this._change(ev));
      this.body.addEventListener('input', () => { this.error.hidden = true; });
    }

    /* spec: descripción ya validada por el controlador. who: {name, hue, icon}. */
    open(spec, who){
      return new Promise((resolve) => {
        this.resolve = resolve;
        this.spec = spec;
        this.state = {};
        const icons = Workhub.views.pluginIcons;
        this.who.innerHTML = '<span class="pf-badge" style="--h:' + (typeof who.hue === 'number' ? who.hue : 214) + '" aria-hidden="true">' + icons.svg(who.icon || 'puzzle', 13) + '</span>' +
          '<span translate="no">' + esc(who.name) + '</span>';
        this.title.textContent = spec.title;
        this.sub.textContent = spec.subtitle;
        this.sub.hidden = !spec.subtitle;
        this.intro.textContent = spec.intro;
        this.intro.hidden = !spec.intro;
        this.btnOk.textContent = spec.submit || Workhub.t('Guardar');
        this.btnCancel.textContent = spec.cancel || Workhub.t('Omitir');
        /* Aviso del plugin (p. ej. «ese día ya está completo»): sale en rojo hasta que se escribe. */
        this.error.textContent = spec.notice || '';
        this.error.hidden = !spec.notice;
        this.body.innerHTML = spec.fields.map((f) => this._field(f)).join('');
        spec.fields.forEach((f) => { if(f.type === 'dates') this._renderDates(f); });
        /* Los desplegables usan el componente de la app (no el nativo del navegador). */
        Workhub.views.Dropdown.enhanceAll(this.body);
        spec.fields.forEach((f) => {
          /* Sin opciones, solo «añadir nuevo»: se oculta el desplegable y se ve el nombre. */
          if(f.type === 'select' && f.allowNew && !f.options.length){
            const wrap = $('pf_' + f.key).closest('.dd');
            if(wrap) wrap.hidden = true;
          }
        });
        this.dlg.showModal();
        /* Al primer campo de escritura, con su contenido seleccionado para escribir encima. */
        const first = this.body.querySelector('input[type="number"], input[type="text"]:not([hidden])');
        if(first && first.offsetParent !== null){ first.focus(); first.select(); }
      });
    }

    _finish(value){
      const resolve = this.resolve;
      if(!resolve) return;
      this.resolve = null;
      if(this.dlg.open) this.dlg.close();
      resolve(value);
    }

    /* ---------- Campos ---------- */

    _field(f){
      const id = 'pf_' + f.key;
      const label = '<label for="' + id + '" translate="no">' + esc(f.label) + '</label>';
      const hint = f.hint ? '<p class="field-help" translate="no">' + esc(f.hint) + '</p>' : '';
      if(f.type === 'number'){
        return '<div class="field">' + label + '<div class="pf-number"><input id="' + id + '" type="number" inputmode="decimal"' +
          (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + ' step="' + (f.step || 'any') + '"' +
          (f.value != null ? ' value="' + f.value + '"' : '') + '>' + (f.unit ? '<span class="pf-unit" translate="no">' + esc(f.unit) + '</span>' : '') + '</div>' + hint + '</div>';
      }
      if(f.type === 'text'){
        return '<div class="field">' + label + '<input id="' + id + '" type="text" maxlength="' + f.maxlength + '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off" translate="no">' + hint + '</div>';
      }
      if(f.type === 'select'){
        const onlyNew = f.allowNew && !f.options.length;
        const startNew = f.allowNew && (onlyNew || f.value === NEW);
        const opts = f.options.map((o) => '<option value="' + esc(o.value) + '"' + (!startNew && o.value === f.value ? ' selected' : '') + ' translate="no">' + esc(o.label) + '</option>').join('') +
          (f.allowNew ? '<option value="' + NEW + '"' + (startNew ? ' selected' : '') + '>' + esc(f.newLabel) + '</option>' : '');
        const color = /^#[0-9a-fA-F]{6}$/.test(f.newColorValue || '') ? f.newColorValue : PALETTE[0];
        this.state[f.key] = {color:color};
        const swatches = PALETTE.map((c) => '<button type="button" class="pf-swatch' + (c === color ? ' is-selected' : '') + '" data-pf-color="' + c + '" data-pf-key="' + f.key + '" style="--c:' + c + '" role="radio" aria-checked="' + (c === color) + '" aria-label="' + c + '"></button>').join('');
        return '<div class="field">' + label + '<select id="' + id + '"' + (onlyNew ? ' hidden' : '') + ' data-pf-select="' + f.key + '">' + opts + '</select>' +
          (f.allowNew ? '<div class="pf-new" id="pfNew_' + f.key + '"' + (startNew ? '' : ' hidden') + '><input type="text" id="pfNewName_' + f.key + '" maxlength="160" value="' + esc(f.newName || '') + '" placeholder="' + esc(f.newPlaceholder) + '" autocomplete="off" translate="no">' +
            (f.newColor ? '<div class="pf-colors"><div class="pf-swatches" role="radiogroup">' + swatches + '</div><label class="pf-custom-color"><input type="color" data-pf-custom="' + f.key + '" value="' + color + '"><span>' + Workhub.t('Otro color') + '</span></label></div>' : '') + '</div>' : '') + hint + '</div>';
      }
      /* dates */
      const now = f.value.length ? parse(f.value[0]) : new Date();
      this.state[f.key] = {sel:new Set(f.value), year:now.getFullYear(), month:now.getMonth()};
      return '<div class="field"><span class="field-label" translate="no">' + esc(f.label) + '</span><div class="pf-dates" id="pfDates_' + f.key + '"></div>' + hint + '</div>';
    }

    _renderDates(f){
      const st = this.state[f.key];
      const box = $('pfDates_' + f.key);
      const locale = Workhub.i18n.locale;
      const monthName = new Intl.DateTimeFormat(locale, {month:'long', year:'numeric'}).format(new Date(st.year, st.month, 1));
      const wd = [];
      for(let i = 0; i < 7; i++) wd.push(new Intl.DateTimeFormat(locale, {weekday:'narrow'}).format(new Date(2024, 0, 1 + i)));
      const first = (new Date(st.year, st.month, 1).getDay() + 6) % 7;
      const days = new Date(st.year, st.month + 1, 0).getDate();
      const today = ymd(new Date());
      let cells = '';
      for(let i = 0; i < first; i++) cells += '<span></span>';
      for(let d = 1; d <= days; d++){
        const key = st.year + '-' + pad(st.month + 1) + '-' + pad(d);
        const on = st.sel.has(key);
        cells += '<button type="button" class="pf-day' + (on ? ' is-on' : '') + (key === today ? ' is-today' : '') + '" data-pf-day="' + key + '" data-pf-key="' + f.key + '" aria-pressed="' + on + '">' + d + '</button>';
      }
      const n = st.sel.size;
      box.innerHTML = '<div class="pf-dates-head"><button type="button" class="icon-only" data-pf-nav="-1" data-pf-key="' + f.key + '" aria-label="' + esc(Workhub.t('Mes anterior')) + '">' + CHEVRON_L + '</button>' +
        '<strong>' + esc(monthName) + '</strong>' +
        '<button type="button" class="icon-only" data-pf-nav="1" data-pf-key="' + f.key + '" aria-label="' + esc(Workhub.t('Mes siguiente')) + '">' + CHEVRON_R + '</button></div>' +
        '<div class="pf-dates-week" aria-hidden="true">' + wd.map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' +
        '<div class="pf-dates-grid">' + cells + '</div>' +
        '<div class="pf-dates-foot"><span>' + esc(Workhub.t(n === 1 ? '{n} día seleccionado' : '{n} días seleccionados', {n:n})) + '</span>' +
        '<span class="pf-dates-quick"><button type="button" class="link-btn" data-pf-quick="today" data-pf-key="' + f.key + '">' + esc(Workhub.t('Hoy')) + '</button>' +
        '<button type="button" class="link-btn" data-pf-quick="yesterday" data-pf-key="' + f.key + '">' + esc(Workhub.t('Ayer')) + '</button></span></div>';
    }

    /* ---------- Eventos ---------- */

    _click(ev){
      const day = closest(ev.target, '[data-pf-day]');
      const nav = closest(ev.target, '[data-pf-nav]');
      const quick = closest(ev.target, '[data-pf-quick]');
      const sw = closest(ev.target, '[data-pf-color]');
      const field = (key) => this.spec.fields.find((f) => f.key === key);
      if(day){
        const key = day.getAttribute('data-pf-key');
        const st = this.state[key];
        const d = day.getAttribute('data-pf-day');
        if(st.sel.has(d)) st.sel.delete(d);
        else if(st.sel.size < field(key).max) st.sel.add(d);
        this.error.hidden = true;
        this._renderDates(field(key));
      } else if(nav){
        const key = nav.getAttribute('data-pf-key');
        const st = this.state[key];
        const m = new Date(st.year, st.month + (+nav.getAttribute('data-pf-nav')), 1);
        st.year = m.getFullYear();
        st.month = m.getMonth();
        this._renderDates(field(key));
      } else if(quick){
        const key = quick.getAttribute('data-pf-key');
        const st = this.state[key];
        const d = new Date();
        if(quick.getAttribute('data-pf-quick') === 'yesterday') d.setDate(d.getDate() - 1);
        const k = ymd(d);
        if(st.sel.has(k)) st.sel.delete(k);
        else if(st.sel.size < field(key).max) st.sel.add(k);
        st.year = d.getFullYear();
        st.month = d.getMonth();
        this.error.hidden = true;
        this._renderDates(field(key));
      } else if(sw){
        const key = sw.getAttribute('data-pf-key');
        this.state[key].color = sw.getAttribute('data-pf-color');
        this.body.querySelectorAll('[data-pf-key="' + key + '"][data-pf-color]').forEach((b) => {
          const on = b === sw;
          b.classList.toggle('is-selected', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        const custom = this.body.querySelector('[data-pf-custom="' + key + '"]');
        if(custom) custom.value = this.state[key].color;
      }
    }

    /* «Añadir nuevo…» en un desplegable enseña el nombre (y el color). */
    _change(ev){
      const custom = closest(ev.target, '[data-pf-custom]');
      if(custom){
        const key = custom.getAttribute('data-pf-custom');
        this.state[key].color = custom.value;
        this.body.querySelectorAll('[data-pf-key="' + key + '"][data-pf-color]').forEach((b) => {
          b.classList.remove('is-selected');
          b.setAttribute('aria-checked', 'false');
        });
        return;
      }
      const sel = closest(ev.target, '[data-pf-select]');
      if(!sel) return;
      const key = sel.getAttribute('data-pf-select');
      const box = $('pfNew_' + key);
      if(!box) return;
      box.hidden = sel.value !== NEW;
      if(!box.hidden) $('pfNewName_' + key).focus();
    }

    /* ---------- Envío ---------- */

    _fail(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
      return null;
    }

    _submit(){
      const values = {};
      for(const f of this.spec.fields){
        const id = 'pf_' + f.key;
        const missing = () => this._fail(Workhub.t('Falta: {campo}', {campo:f.label}));
        if(f.type === 'number'){
          const raw = $(id).value.trim();
          const n = raw === '' ? NaN : parseFloat(raw.replace(',', '.'));
          if(isNaN(n)){ if(f.required){ missing(); return; } values[f.key] = null; continue; }
          if(f.min != null && n < f.min){ this._fail(Workhub.t('{campo}: mínimo {n}', {campo:f.label, n:f.min.toLocaleString(Workhub.i18n.locale)})); return; }
          if(f.max != null && n > f.max){ this._fail(Workhub.t('{campo}: máximo {n}', {campo:f.label, n:f.max.toLocaleString(Workhub.i18n.locale)})); return; }
          values[f.key] = n;
        } else if(f.type === 'text'){
          const t = $(id).value.trim();
          if(!t && f.required){ missing(); return; }
          values[f.key] = t;
        } else if(f.type === 'select'){
          const v = $(id).value;
          if(v === NEW){
            const name = $('pfNewName_' + f.key).value.trim();
            if(!name){ $('pfNewName_' + f.key).focus(); missing(); return; }
            values[f.key] = {new:name, color:this.state[f.key].color};
          } else {
            if(!v && f.required){ missing(); return; }
            values[f.key] = v || null;
          }
        } else {
          const list = Array.from(this.state[f.key].sel).sort();
          if(!list.length && f.required){ missing(); return; }
          values[f.key] = list;
        }
      }
      this._finish(values);
    }
  }

  Workhub.views.PluginFormView = PluginFormView;
})();
