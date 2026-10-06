/* Diálogo «Automatizaciones» del proyecto abierto: la lista de reglas (activar, editar, eliminar),
   las plantillas de ejemplo y el formulario «Cuando… entonces…». Solo DOM: lo que se guarda y lo
   que se ejecuta lo decide el controlador. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const A = Workhub.models.Automations;
  const $ = (id) => document.getElementById(id);
  const t = (text, params) => Workhub.t(text, params);

  const REMOVE_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const option = (value, label, selected) => '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';

  class AutomationsView {
    constructor(){
      this.dlg = $('dlgAutomations');
      this.body = $('autoBody');
      this.foot = $('autoFoot');
      this.btnNew = $('btnAutoNew');
      this.ctx = null;
      this.draft = null;
      this.on = {};

      this.body.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-auto]');
        if(!btn) return;
        const action = btn.getAttribute('data-auto');
        if(action === 'add-action' || action === 'del-action'){
          this.readDraft();
          if(action === 'add-action') this.draft.actions.push({type:'subtask', text:''});
          else this.draft.actions.splice(+btn.getAttribute('data-row'), 1);
          this.renderForm();
          const rows = this.body.querySelectorAll('.auto-action');
          const last = rows[rows.length - 1];
          const focus = action === 'add-action' && last ? last.querySelector('.dd button, select') : this.body.querySelector('[data-auto="add-action"]');
          if(focus) focus.focus();
        } else if(this.on[action]) this.on[action](btn.getAttribute('data-id'));
      });
      this.body.addEventListener('change', (ev) => {
        const toggle = closest(ev.target, 'input[data-auto-toggle]');
        if(toggle){ this.on.toggle(toggle.getAttribute('data-auto-toggle'), toggle.checked); return; }
        /* Cambiar el tipo de disparador o de acción cambia los campos que hacen falta. */
        if(closest(ev.target, '#autoTrigger, .auto-a-type')){
          this.readDraft();
          this.renderForm();
        }
      });
      this.body.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.readDraft();
        this.on.save(this.draft);
      });
    }

    /* handlers: {open, close, create, edit(id), remove(id), toggle(id, on), use(i), save(draft), cancel, upgrade} */
    bind(handlers){
      this.on = handlers;
      $('btnAutomations').addEventListener('click', () => handlers.open());
      $('btnAutoClose').addEventListener('click', () => handlers.close());
      this.btnNew.addEventListener('click', () => handlers.create());
      this.dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); handlers.close(); });
    }

    show(){ if(!this.dlg.open) this.dlg.showModal(); }
    hide(){ if(this.dlg.open) this.dlg.close(); }
    isOpen(){ return this.dlg.open; }

    message(text){
      this.foot.hidden = false;
      this.btnNew.hidden = true;
      this.body.innerHTML = '<p class="auto-note">' + esc(text) + '</p>';
    }

    /* Como invitado: se explica por qué hace falta una cuenta. */
    showGuest(){
      this.foot.hidden = false;
      this.btnNew.hidden = true;
      this.body.innerHTML = '<div class="auto-guest"><p>' + esc(t('Las automatizaciones necesitan una cuenta: se guardan con el proyecto y se ejecutan en tu nombre, también desde otros dispositivos.')) + '</p>' +
        '<p>' + esc(t('Crea una cuenta y tus datos de invitado se copian a ella.')) + '</p>' +
        '<button type="button" class="btn btn-primary" data-auto="upgrade">' + esc(t('Crear cuenta y llevarme mis datos')) + '</button></div>';
    }

    /* s: {rules:[{rule, text, problem}], templates:[{name, text}], canManage, team, max} */
    showList(s){
      this.draft = null;
      this.foot.hidden = false;
      this.btnNew.hidden = !s.canManage;
      this.btnNew.disabled = s.rules.length >= s.max;
      const rules = s.rules.map((r) => {
        const rule = r.rule;
        return '<li class="auto-rule' + (rule.on ? '' : ' is-off') + (r.problem ? ' is-broken' : '') + '">' +
          '<input type="checkbox" data-auto-toggle="' + esc(rule.id) + '"' + (rule.on ? ' checked' : '') + (s.canManage ? '' : ' disabled') +
          ' aria-label="' + esc(t('Activar «{name}»', {name:rule.name})) + '">' +
          '<div class="auto-rule-main"><b translate="no">' + esc(rule.name) + '</b>' + (rule.trigger.type === 'button' ? ' <span class="auto-tag">' + esc(t('Botón')) + '</span>' : '') +
          '<p translate="no">' + esc(r.text) + '</p>' +
          (r.problem ? '<p class="auto-broken">' + esc(t('En pausa: {why}.', {why:r.problem})) + '</p>' : '') + '</div>' +
          (s.canManage ? '<div class="auto-rule-actions"><button type="button" class="icon-btn" data-auto="edit" data-id="' + esc(rule.id) + '">' + esc(t('Editar')) + '</button>' +
            '<button type="button" class="icon-btn" data-auto="remove" data-id="' + esc(rule.id) + '">' + esc(t('Eliminar')) + '</button></div>' : '') +
          '</li>';
      }).join('');
      const templates = s.canManage && s.templates.length ? '<h3 class="auto-sub">' + esc(t('Ejemplos para empezar')) + '</h3><ul class="auto-templates">' +
        s.templates.map((x, i) => '<li><div><b>' + esc(x.name) + '</b><p>' + esc(x.text) + '</p></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-auto="use" data-id="' + i + '">' + esc(t('Usar')) + '</button></li>').join('') + '</ul>' : '';
      this.body.innerHTML =
        (s.rules.length ? '<ul class="auto-rules">' + rules + '</ul>' : '<p class="auto-empty">' + esc(t('Todavía no hay ninguna automatización en este proyecto.')) + '</p>') +
        (s.canManage ? '' : '<p class="auto-note">' + esc(t(s.team ? 'Solo quien es propietario del equipo puede crear o cambiar las automatizaciones.' : 'No tienes permiso para cambiar las automatizaciones de este proyecto.')) + '</p>') +
        templates +
        '<p class="auto-note">' + esc(t(s.server ? 'Las automatizaciones por fecha se ejecutan aunque nadie tenga Kanlane abierto: el servidor las revisa cada media hora.'
          : 'En este proyecto las automatizaciones por fecha solo se ejecutan mientras alguien que puede editarlo tiene Kanlane abierto.')) + '</p>';
    }

    /* Formulario de una regla (nueva o existente). ctx: el de Automations. */
    showForm(rule, ctx){
      this.ctx = ctx;
      this.draft = JSON.parse(JSON.stringify(rule));
      this.renderForm();
      const name = $('autoName');
      if(name) name.focus();
    }

    showError(text){
      const el = $('autoError');
      if(!el) return;
      el.textContent = text;
      el.hidden = false;
    }

    /* Lo escrito en el formulario → borrador (sin validar: eso lo hace Automations.normalize). */
    readDraft(){
      const d = this.draft;
      if(!d || !$('autoForm')) return d;
      const val = (id) => { const el = $(id); return el ? el.value : ''; };
      d.name = val('autoName');
      d.trigger = {type:val('autoTrigger'), stage:val('autoStage'), days:val('autoDays')};
      d.cond = {label:val('autoCondLabel'), assignee:val('autoCondAssignee')};
      d.actions = Array.prototype.map.call(this.body.querySelectorAll('.auto-action'), (row) => {
        const type = row.querySelector('.auto-a-type').value;
        const el = row.querySelector('.auto-a-val');
        const value = el ? el.value : '';
        return type === 'move' ? {type:type, stage:value} : type === 'assign' ? {type:type, uid:value}
          : type === 'label' ? {type:type, name:value} : type === 'subtask' ? {type:type, text:value}
          : type === 'due' ? {type:type, days:value} : {type:type};
      });
      return d;
    }

    renderForm(){
      const d = this.draft, ctx = this.ctx;
      const stages = (selected, any) => (any ? option('', t('Cualquier columna'), !selected) : '') + ctx.stages.map((s) => option(s.key, s.label, s.key === selected)).join('');
      const tr = d.trigger || {};
      const triggers = [['moved', 'una tarea se mueve a una columna'], ['created', 'se crea una tarea'], ['completed', 'una tarea se completa'], ['due', 'se acerca la fecha límite'], ['button', 'alguien pulsa su botón en la tarea']];
      const isButton = tr.type === 'button';
      const types = [['move', 'Mover a la columna'], ['complete', 'Marcar como completada'], ['label', 'Añadir la etiqueta'], ['subtask', 'Añadir la subtarea'], ['due', 'Poner la fecha límite']]
        .concat(ctx.team ? [['assign', 'Asignar a']] : []);
      const param = (a, i) => {
        const label = ' aria-label="' + esc(t('Valor de la acción {n}', {n:i + 1})) + '"';
        if(a.type === 'move') return '<select class="auto-a-val"' + label + '>' + stages(a.stage || (ctx.stages[0] || {}).key) + '</select>';
        if(a.type === 'label') return ctx.labels.length
          ? '<select class="auto-a-val"' + label + '>' + ctx.labels.map((l) => option(l, l, l === a.name)).join('') + '</select>'
          : '<span class="auto-hint">' + esc(t('El proyecto no tiene etiquetas todavía.')) + '</span>';
        if(a.type === 'assign') return '<select class="auto-a-val"' + label + '>' + ctx.members.map((m) => option(m.uid, m.name, m.uid === a.uid)).join('') + '</select>';
        if(a.type === 'subtask') return '<input type="text" class="auto-a-val" maxlength="120" value="' + esc(a.text || '') + '" placeholder="' + esc(t('Texto de la subtarea')) + '"' + label + '>';
        if(a.type === 'due') return '<span class="auto-days"><input type="number" class="auto-a-val" min="0" max="365" value="' + esc(a.days == null || a.days === '' ? 7 : a.days) + '"' + label + '><span>' + esc(t('días desde hoy')) + '</span></span>';
        return '';
      };
      const actions = d.actions.map((a, i) => '<div class="auto-action" data-row="' + i + '">' +
        '<select class="auto-a-type" aria-label="' + esc(t('Acción {n}', {n:i + 1})) + '">' + types.map((x) => option(x[0], t(x[1]), x[0] === a.type)).join('') + '</select>' +
        param(a, i) +
        (d.actions.length > 1 ? '<button type="button" class="icon-only is-sm" data-auto="del-action" data-row="' + i + '" aria-label="' + esc(t('Quitar la acción {n}', {n:i + 1})) + '" title="' + esc(t('Quitar')) + '">' + REMOVE_ICON + '</button>' : '') +
        '</div>').join('');
      this.foot.hidden = true;
      this.body.innerHTML = '<form id="autoForm" class="auto-form" novalidate>' +
        '<div class="field"><label for="autoName">' + esc(t(isButton ? 'Texto del botón' : 'Nombre (opcional)')) + '</label><input id="autoName" maxlength="' + (isButton ? 40 : 80) + '" autocomplete="off" value="' + esc(d.name || '') + '" placeholder="' + esc(t('Por ejemplo: Enviar a revisión')) + '"></div>' +
        '<fieldset class="auto-block"><legend>' + esc(t('Cuando…')) + '</legend>' +
          '<select id="autoTrigger" aria-label="' + esc(t('Qué tiene que pasar')) + '">' + triggers.map((x) => option(x[0], t(x[1]), x[0] === tr.type)).join('') + '</select>' +
          (tr.type === 'moved' || tr.type === 'created' ? '<select id="autoStage" aria-label="' + esc(t('Columna')) + '">' + stages(tr.stage || (tr.type === 'moved' ? (ctx.stages[0] || {}).key : ''), tr.type === 'created') + '</select>' : '') +
          (tr.type === 'due' ? '<span class="auto-days"><input type="number" id="autoDays" min="0" max="365" value="' + esc(tr.days == null || tr.days === '' ? 2 : tr.days) + '" aria-label="' + esc(t('Días antes de la fecha límite')) + '"><span>' + esc(t('días antes (0 = el mismo día)')) + '</span></span>' : '') +
        '</fieldset>' +
        (isButton ? '<p class="auto-note auto-note-form">' + esc(t('El botón sale en la ficha de cada tarea, para quien puede editar el proyecto.')) + '</p>' : '') +
        '<fieldset class="auto-block"' + (isButton ? ' hidden' : '') + '><legend>' + esc(t('Solo si… (opcional)')) + '</legend>' +
          '<select id="autoCondLabel" aria-label="' + esc(t('Etiqueta que tiene que llevar')) + '">' + option('', t('Con cualquier etiqueta o sin ninguna'), !d.cond.label) + ctx.labels.map((l) => option(l, t('Lleva la etiqueta «{name}»', {name:l}), l === d.cond.label)).join('') + '</select>' +
          (ctx.team ? '<select id="autoCondAssignee" aria-label="' + esc(t('Quién la tiene asignada')) + '">' + option('', t('La tenga quien la tenga'), !d.cond.assignee) + option('none', t('No tiene a nadie asignado'), d.cond.assignee === 'none') +
            ctx.members.map((m) => option(m.uid, t('Está asignada a {name}', {name:m.name}), m.uid === d.cond.assignee)).join('') + '</select>' : '') +
        '</fieldset>' +
        '<fieldset class="auto-block"><legend>' + esc(t('Entonces…')) + '</legend>' + actions +
          (d.actions.length < A.MAX_ACTIONS ? '<button type="button" class="btn btn-ghost btn-sm" data-auto="add-action">' + esc(t('Añadir otra acción')) + '</button>' : '') +
        '</fieldset>' +
        '<p class="lock-error" id="autoError" role="alert" hidden></p>' +
        '<div class="dlg-actions"><button type="button" class="btn btn-ghost" data-auto="cancel">' + esc(t('Cancelar')) + '</button>' +
        '<button type="submit" class="btn btn-primary">' + esc(t('Guardar')) + '</button></div></form>';
      Workhub.views.Dropdown.enhanceAll(this.body);
    }
  }

  Workhub.views.AutomationsView = AutomationsView;
})();
