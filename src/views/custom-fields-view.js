/* Campos personalizados (ver models/custom-fields.js): lo que comparten las vistas (qué campos
   tiene el proyecto abierto, cómo se pintan en la tarjeta y en el formulario de tarea) y el
   diálogo para definirlos. */
(function(){
  const {esc, closest, iconSpan} = Workhub.utils.html;
  const CF = Workhub.models.CustomFields;
  const $ = (id) => document.getElementById(id);

  let current = [];

  /* ---------- Compartido por las vistas ---------- */

  const fields = {
    /* Definiciones del proyecto abierto (las pone ProjectsController). */
    set(list){ current = CF.normalize(list); },
    list(){ return current.slice(); },

    /* Valores marcados para verse en la tarjeta. */
    cardHtml(t){
      if(!current.length || !t || !t.custom) return '';
      return current.filter((f) => f.card).map((f) => {
        const text = CF.format(f, t.custom[f.id]);
        if(!text) return '';
        const value = f.type === 'checkbox' ? iconSpan('check') : '<b>' + esc(text) + '</b>';
        return '<span class="cf-badge" translate="no" title="' + esc(f.name + ': ' + text) + '"><span>' + esc(f.name) + '</span>' + value + '</span>';
      }).join('');
    },

    /* Los campos con valor de una tarea: [{name, text}] (para la ficha). */
    filled(t){
      const custom = (t && t.custom) || {};
      return current.map((f) => ({name:f.name, type:f.type, text:CF.format(f, custom[f.id])})).filter((x) => x.text);
    },

    /* Controles del formulario de tarea, con los valores de `custom`. */
    formHtml(custom){
      const vals = CF.values(current, custom);
      return current.map((f) => {
        const id = 'fCf_' + f.id;
        const v = vals[f.id];
        const attr = ' id="' + esc(id) + '" data-cf="' + esc(f.id) + '"';
        const label = '<label for="' + esc(id) + '" translate="no">' + esc(f.name) + '</label>';
        let control;
        if(f.type === 'checkbox'){
          return '<div class="cf-field is-check"><label class="cf-check" translate="no"><input type="checkbox"' + attr + (v ? ' checked' : '') + '> ' + esc(f.name) + '</label></div>';
        }
        if(f.type === 'text') control = '<input type="text" maxlength="' + CF.MAX_TEXT + '" autocomplete="off" translate="no"' + attr + ' value="' + esc(v === undefined ? '' : v) + '">';
        else if(f.type === 'number') control = '<input type="text" inputmode="decimal" autocomplete="off" maxlength="24"' + attr + ' value="' + esc(v === undefined ? '' : v) + '">';
        else if(f.type === 'date') control = '<input type="date" data-dp' + attr + ' value="' + esc(v === undefined ? '' : v) + '">';
        else control = '<select' + attr + '><option value="">' + esc(Workhub.t('Sin valor')) + '</option>' +
          f.options.map((o) => '<option value="' + esc(o.id) + '"' + (o.id === v ? ' selected' : '') + ' translate="no">' + esc(o.label) + '</option>').join('') + '</select>';
        return '<div class="cf-field">' + label + control + '</div>';
      }).join('');
    },

    /* Lee el formulario: {values} o {error, el} con el primer campo que no vale. */
    readForm(root){
      const out = {};
      for(let i = 0; i < current.length; i++){
        const f = current[i];
        const el = root.querySelector('[data-cf="' + f.id + '"]');
        if(!el) continue;
        const r = CF.clean(f, f.type === 'checkbox' ? el.checked : el.value);
        if(r.error) return {error:'«' + f.name + '»: ' + Workhub.t(r.error), el:el};
        if(r.value !== undefined) out[f.id] = r.value;
      }
      return {values:out};
    }
  };

  /* ---------- Diálogo «Campos personalizados» ---------- */

  const UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const DOWN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
  const TRASH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

  class FieldsDialogView {
    constructor(){
      this.dlg = $('dlgFields');
      this.listEl = $('cfList');
      this.newName = $('cfNewName');
      this.newType = $('cfNewType');
      this.error = $('cfError');
      this.btnSave = $('btnFieldsSave');
      /* Copia de trabajo: no se guarda nada hasta pulsar «Guardar» (salvo eliminar un campo). */
      this.draft = [];
      this.saved = {};
      this.onRemove = null;

      this.newType.innerHTML = CF.TYPES.map((t) => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('');
      const add = () => this._add();
      $('cfNewAdd').addEventListener('click', add);
      this.newName.addEventListener('keydown', (ev) => { if(ev.key === 'Enter'){ ev.preventDefault(); add(); } });
      $('btnFieldsCancel').addEventListener('click', () => this.close());

      this.listEl.addEventListener('input', (ev) => {
        const f = this._field(ev.target);
        if(!f) return;
        this.error.hidden = true;
        if(ev.target.classList.contains('cf-name')) f.name = ev.target.value;
        else if(ev.target.classList.contains('cf-option-name')){
          const o = f.options[+closest(ev.target, '[data-o]').getAttribute('data-o')];
          if(o) o.label = ev.target.value;
        }
      });
      this.listEl.addEventListener('change', (ev) => {
        const f = this._field(ev.target);
        if(f && ev.target.classList.contains('cf-card-box')) f.card = ev.target.checked;
      });
      this.listEl.addEventListener('keydown', (ev) => {
        if(ev.key !== 'Enter' || !ev.target.matches('input[type=text]')) return;
        ev.preventDefault();
        if(ev.target.classList.contains('cf-option-new')) this._addOption(ev.target);
      });
      this.listEl.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-act]');
        const f = btn && this._field(btn);
        if(!f) return;
        const i = this.draft.indexOf(f);
        const act = btn.getAttribute('data-act');
        if(act === 'up' || act === 'down'){
          const j = i + (act === 'up' ? -1 : 1);
          if(j < 0 || j >= this.draft.length) return;
          this.draft.splice(j, 0, this.draft.splice(i, 1)[0]);
          this._render();
          const again = this.listEl.querySelector('.cf-item[data-i="' + j + '"] [data-act="' + act + '"]');
          (again && !again.disabled ? again : this.listEl.querySelector('.cf-item[data-i="' + j + '"] .cf-name')).focus();
        } else if(act === 'del'){
          /* Un campo ya guardado se borra con sus valores, previo aviso; uno recién añadido, sin más. */
          const drop = () => { this.draft = this.draft.filter((x) => x !== f); delete this.saved[f.id]; this._render(); this.newName.focus(); };
          if(this.saved[f.id] && this.onRemove) this.onRemove(this.saved[f.id]).then((ok) => { if(ok) drop(); });
          else drop();
        } else if(act === 'opt-add'){
          this._addOption(btn.parentNode.querySelector('.cf-option-new'));
        } else if(act === 'opt-del'){
          f.options.splice(+closest(btn, '[data-o]').getAttribute('data-o'), 1);
          this._render();
        }
      });
    }

    _field(el){
      const item = closest(el, '.cf-item');
      return item ? this.draft[+item.getAttribute('data-i')] : null;
    }

    _add(){
      const name = this.newName.value.trim();
      if(!name){ this.newName.focus(); return; }
      if(this.draft.length >= CF.MAX_FIELDS){ this.showError('Un proyecto admite 50 campos como mucho.'); return; }
      const f = {id:CF.newId('f'), name:name.slice(0, CF.MAX_NAME), type:this.newType.value, card:false};
      if(f.type === 'select') f.options = [];
      this.draft.push(f);
      this.newName.value = '';
      this.error.hidden = true;
      this._render();
      const item = this.listEl.querySelector('.cf-item[data-i="' + (this.draft.length - 1) + '"]');
      (f.type === 'select' ? item.querySelector('.cf-option-new') : this.newName).focus();
    }

    _addOption(input){
      const f = this._field(input);
      const label = input.value.trim();
      if(!f || !label){ input.focus(); return; }
      if(f.options.length >= CF.MAX_OPTIONS) return;
      f.options.push({id:CF.newId('o'), label:label.slice(0, CF.MAX_NAME)});
      const i = this.draft.indexOf(f);
      this._render();
      this.listEl.querySelector('.cf-item[data-i="' + i + '"] .cf-option-new').focus();
    }

    _render(){
      const n = this.draft.length;
      this.listEl.innerHTML = n ? this.draft.map((f, i) => {
        const options = f.type !== 'select' ? '' : '<div class="cf-options" role="group" aria-label="' + esc(Workhub.t('Opciones de la lista')) + '">' +
          f.options.map((o, oi) => '<div class="cf-option" data-o="' + oi + '"><input type="text" class="cf-option-name" maxlength="' + CF.MAX_NAME + '" value="' + esc(o.label) + '" aria-label="' + esc(Workhub.t('Opción')) + '" translate="no" autocomplete="off">' +
            '<button type="button" class="icon-btn" data-act="opt-del" aria-label="' + esc(Workhub.t('Quitar opción')) + '" title="' + esc(Workhub.t('Quitar opción')) + '">' + iconSpan('close') + '</button></div>').join('') +
          '<div class="cf-option is-new"><input type="text" class="cf-option-new" maxlength="' + CF.MAX_NAME + '" placeholder="' + esc(Workhub.t('Añadir una opción')) + '" aria-label="' + esc(Workhub.t('Nueva opción')) + '" autocomplete="off">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="opt-add">' + esc(Workhub.t('Añadir')) + '</button></div></div>';
        return '<div class="cf-item" data-i="' + i + '">' +
          '<div class="cf-item-main">' +
            '<input type="text" class="cf-name" maxlength="' + CF.MAX_NAME + '" value="' + esc(f.name) + '" aria-label="' + esc(Workhub.t('Nombre del campo')) + '" translate="no" autocomplete="off">' +
            '<span class="cf-type">' + esc(Workhub.t(CF.typeLabel(f.type))) + '</span>' +
            '<label class="cf-card"><input type="checkbox" class="cf-card-box"' + (f.card ? ' checked' : '') + '> ' + esc(Workhub.t('En la tarjeta')) + '</label>' +
            '<span class="cf-tools">' +
              '<button type="button" class="icon-only" data-act="up" aria-label="' + esc(Workhub.t('Subir campo')) + '" title="' + esc(Workhub.t('Subir')) + '"' + (i === 0 ? ' disabled' : '') + '>' + UP + '</button>' +
              '<button type="button" class="icon-only" data-act="down" aria-label="' + esc(Workhub.t('Bajar campo')) + '" title="' + esc(Workhub.t('Bajar')) + '"' + (i === n - 1 ? ' disabled' : '') + '>' + DOWN + '</button>' +
              '<button type="button" class="icon-only is-danger" data-act="del" aria-label="' + esc(Workhub.t('Eliminar campo')) + '" title="' + esc(Workhub.t('Eliminar campo')) + '">' + TRASH + '</button>' +
            '</span>' +
          '</div>' + options + '</div>';
      }).join('') : '<p class="cf-empty">' + esc(Workhub.t('Este proyecto aún no tiene campos personalizados.')) + '</p>';
    }

    /* handler(list): guarda las definiciones; devuelve una promesa con true si se guardaron. */
    bindSave(handler){
      this.btnSave.addEventListener('click', () => {
        const names = {};
        for(let i = 0; i < this.draft.length; i++){
          const f = this.draft[i];
          const name = f.name.trim();
          const focus = (sel) => { const el = this.listEl.querySelector('.cf-item[data-i="' + i + '"] ' + sel); if(el) el.focus(); };
          if(!name){ this.showError('Cada campo necesita un nombre.'); focus('.cf-name'); return; }
          if(names[name.toLowerCase()]){ this.showError('Hay dos campos con el mismo nombre.'); focus('.cf-name'); return; }
          names[name.toLowerCase()] = true;
          if(f.type === 'select' && !f.options.some((o) => o.label.trim())){ this.showError('Una lista desplegable necesita al menos una opción.'); focus('.cf-option-new'); return; }
        }
        this.btnSave.disabled = true;
        Promise.resolve(handler(CF.normalize(this.draft))).then((ok) => {
          this.btnSave.disabled = false;
          if(ok) this.close();
          else this.showError('No se pudieron guardar los campos.');
        });
      });
    }

    /* handler(field): avisa, borra el campo y sus valores; promesa con true si se borró. */
    bindRemove(handler){ this.onRemove = handler; }

    showError(msg){
      this.error.textContent = Workhub.t(msg);
      this.error.hidden = false;
    }

    open(list){
      this.draft = CF.normalize(list).map((f) => Object.assign({}, f, f.options ? {options:f.options.map((o) => Object.assign({}, o))} : {}));
      this.saved = {};
      this.draft.forEach((f) => { this.saved[f.id] = CF.normalize([f])[0]; });
      this.error.hidden = true;
      this.newName.value = '';
      this.btnSave.disabled = false;
      this._render();
      this.dlg.showModal();
    }

    isOpen(){ return this.dlg.open; }

    close(){ if(this.dlg.open) this.dlg.close(); }
  }

  Workhub.views.fields = fields;
  Workhub.views.FieldsDialogView = FieldsDialogView;
})();
