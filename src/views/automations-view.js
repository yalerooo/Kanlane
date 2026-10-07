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
        } else if(action === 'cap-save'){
          this.on['cap-save'](this.readCapture());
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

    /* handlers: {open, close, create, edit(id), remove(id), toggle(id, on), use(i), save(draft), cancel, upgrade,
       'cap-enable', 'cap-copy', 'cap-regen', 'cap-off', 'cap-save'({stage, allow})} */
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
        '<p>' + esc(t('Crear tareas enviando un correo también necesita una cuenta: solo se acepta el correo que llega desde la dirección de una cuenta de Kanlane.')) + '</p>' +
        '<p>' + esc(t('Crea una cuenta y tus datos de invitado se copian a ella.')) + '</p>' +
        '<button type="button" class="btn btn-primary" data-auto="upgrade">' + esc(t('Crear cuenta y llevarme mis datos')) + '</button></div>';
    }

    /* Lo escrito en el apartado de correo: {stage, allow:[correos]}. */
    readCapture(){
      const stage = $('capStage'), allow = $('capAllow');
      return {stage:stage ? stage.value : '', allow:(allow ? allow.value : '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)};
    }

    /* Aviso corto dentro del apartado de correo (dirección copiada, cambios guardados, error). */
    captureNote(text, isError){
      const el = $('capNote');
      if(!el) return;
      el.textContent = text;
      el.className = isError ? 'lock-error' : 'auto-note cap-ok';
      el.hidden = !text;
    }

    /* Apartado «Tareas por correo». c: lo que dice el controlador:
       {state:'hidden'|'loading'|'error'|'encrypted'|'off'|'on', role, address, alt:[…], stage,
        stageMissing, allow:[…], limits:{messageMb, fileMb, files}, busy, stages:[{key, label}], me} */
    captureHtml(c){
      if(!c || c.state === 'hidden') return '';
      const head = '<h3 class="auto-sub" id="capTitle">' + esc(t('Tareas por correo')) + '</h3>';
      const p = (text, cls) => '<p class="auto-note' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</p>';
      const open = '<section class="cap" aria-labelledby="capTitle">' + head;
      if(c.state === 'loading') return open + p(t('Cargando…')) + '</section>';
      if(c.state === 'error') return open + p(t('No se pudo consultar la captura por correo. Cierra y vuelve a abrir este diálogo para intentarlo otra vez.')) + '</section>';
      if(c.state === 'encrypted'){
        return open + p(t('Este proyecto tiene cifrado total y no admite tareas por correo. Un correo llega sin cifrar al servidor de Kanlane, que no tiene la clave del proyecto: guardarlo así rompería lo que el cifrado promete.')) + '</section>';
      }
      const owner = c.role === 'owner';
      const busy = c.busy ? ' disabled' : '';
      if(c.state === 'off'){
        return open + p(t('Activa una dirección de correo para este proyecto: cada correo que le envíes crea una tarea. El asunto es el título y el cuerpo, la descripción.')) +
          (owner ? '<button type="button" class="btn btn-ghost btn-sm" data-auto="cap-enable"' + busy + '>' + esc(t('Activar la dirección de correo')) + '</button>'
            : p(t(c.team ? 'Solo quien es propietario del equipo puede activarla.' : 'No tienes permiso para activarla.'))) +
          '<p id="capNote" role="status" hidden></p></section>';
      }
      /* Activada. Quien solo puede leer el proyecto no envía correo, así que no ve la dirección. */
      if(!c.address){
        return open + p(t('Este proyecto crea tareas a partir del correo que le envían quienes pueden editarlo.')) + '</section>';
      }
      const limits = c.limits || {};
      const stages = '<option value=""' + (c.stage ? '' : ' selected') + '>' + esc(t('La primera columna')) + '</option>' +
        (c.stageMissing ? option(c.stage, t('{name} (ya no existe)', {name:t('columna borrada')}), true) : '') +
        c.stages.map((s) => option(s.key, s.label, s.key === c.stage && !c.stageMissing)).join('');
      return open +
        '<div class="field"><label for="capAddress">' + esc(t('Dirección de este proyecto')) + '</label>' +
          '<div class="cap-row"><input id="capAddress" class="cap-address" readonly translate="no" spellcheck="false" value="' + esc(c.address) + '" aria-describedby="capSecret">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-auto="cap-copy">' + esc(t('Copiar')) + '</button></div></div>' +
        (c.alt && c.alt.length ? '<p class="auto-note cap-alt">' + esc(t('Dirección de respaldo, por si la principal fallara:')) + ' <span translate="no" class="cap-mono">' + esc(c.alt.join(', ')) + '</span></p>' : '') +
        '<p class="auto-note" id="capSecret">' + esc(t('Trátala como una contraseña: no la publiques. Aun así, conocerla no basta: solo se acepta el correo de quien puede editar el proyecto, enviado desde la dirección de su cuenta de Kanlane y firmado por su proveedor de correo.')) + '</p>' +
        (c.me ? '<p class="auto-note">' + esc(t('Tú envías desde:')) + ' <span translate="no" class="cap-mono">' + esc(c.me) + '</span></p>' : '') +
        p(t('Hasta {files} adjuntos de {file} MB cada uno; el mensaje entero, {message} MB como mucho. No se guardan programas ni otros archivos que puedan ejecutarse. El mismo correo dos veces en 30 días crea una sola tarea.',
          {files:limits.files, file:limits.fileMb, message:limits.messageMb})) +
        p(t('El correo pasa sin cifrar por Cloudflare y por el servidor de Kanlane antes de guardarse como tarea.')) +
        (owner
          ? '<div class="field"><label for="capStage">' + esc(t('Columna donde se crean las tareas')) + '</label><select id="capStage"' + busy + '>' + stages + '</select></div>' +
            (c.stageMissing ? '<p class="auto-broken" role="note">' + esc(t('La columna elegida ya no existe: mientras no elijas otra, las tareas se crean en la primera.')) + '</p>' : '') +
            '<div class="field"><label for="capAllow">' + esc(t('Remitentes permitidos (opcional)')) + '</label>' +
            '<textarea id="capAllow" rows="2" spellcheck="false" autocomplete="off" aria-describedby="capAllowHelp"' + busy + '>' + esc((c.allow || []).join('\n')) + '</textarea>' +
            '<p class="auto-note" id="capAllowHelp">' + esc(t('Un correo por línea. Vacío: cualquiera que pueda editar el proyecto. La lista solo restringe: no deja entrar a quien no es miembro.')) + '</p></div>' +
            '<div class="cap-actions"><button type="button" class="btn btn-ghost btn-sm" data-auto="cap-save"' + busy + '>' + esc(t('Guardar cambios')) + '</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-auto="cap-regen"' + busy + '>' + esc(t('Regenerar la dirección')) + '</button>' +
            '<button type="button" class="btn btn-ghost btn-sm is-danger" data-auto="cap-off"' + busy + '>' + esc(t('Desactivar')) + '</button></div>'
          : p(t('Solo quien es propietario del equipo puede cambiarla o desactivarla.'))) +
        '<p id="capNote" role="status" hidden></p></section>';
    }

    /* s: {rules:[{rule, text, problem}], templates:[{name, text}], canManage, team, max, capture}
       La casilla es la intención (activada o no). El estado efectivo va escrito al lado, con
       palabras: «Activa», «En pausa» o «Desactivada»; la casilla lo lleva como descripción. */
    showList(s){
      this.draft = null;
      this.foot.hidden = false;
      this.btnNew.hidden = !s.canManage;
      this.btnNew.disabled = s.rules.length >= s.max;
      const STATUS = {active:'Activa', paused:'En pausa', off:'Desactivada'};
      const rules = s.rules.map((r, i) => {
        const rule = r.rule;
        const state = A.status(rule, r.problem);
        return '<li class="auto-rule' + (rule.on ? '' : ' is-off') + (r.problem ? ' is-broken' : '') + '" data-status="' + state + '">' +
          '<input type="checkbox" data-auto-toggle="' + esc(rule.id) + '"' + (rule.on ? ' checked' : '') + (s.canManage ? '' : ' disabled') +
          ' aria-label="' + esc(t('Activar «{name}»', {name:rule.name})) + '" aria-describedby="autoStatus' + i + (r.problem ? ' autoWhy' + i : '') + '">' +
          '<div class="auto-rule-main"><b translate="no">' + esc(rule.name) + '</b>' + (rule.trigger.type === 'button' ? ' <span class="auto-tag">' + esc(t('Botón')) + '</span>' : '') +
          ' <span class="auto-status is-' + state + '" id="autoStatus' + i + '">' + esc(t(STATUS[state])) + '</span>' +
          '<p translate="no">' + esc(r.text) + '</p>' +
          (r.problem ? '<p class="auto-broken" id="autoWhy' + i + '">' + esc(t(rule.on ? 'No se ejecuta: {why}.' : 'Aunque la actives no se ejecutará: {why}.', {why:r.problem})) +
            (s.canManage ? ' ' + esc(t('Edítala para arreglarlo.')) : '') + '</p>' : '') + '</div>' +
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
        (s.rules.some((r) => r.rule.on && r.problem) ? '<p class="auto-note">' + esc(t('La casilla dice si quieres que la automatización se ejecute. Una automatización marcada puede estar en pausa porque le falta algo: mientras tanto no hace nada.')) + '</p>' : '') +
        '<p class="auto-note">' + esc(t(s.server ? 'Las automatizaciones por fecha se ejecutan aunque nadie tenga Kanlane abierto: el servidor las revisa cada media hora.'
          : 'En este proyecto las automatizaciones por fecha solo se ejecutan mientras alguien que puede editarlo tiene Kanlane abierto.')) + '</p>' +
        this.captureHtml(s.capture);
      Workhub.views.Dropdown.enhanceAll(this.body);
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
      /* El nombre guardado de una columna o una persona sigue con ella mientras no se elija otra:
         si ya no existe, es lo único que queda para decir cuál era. */
      const old = {trigger:d.trigger || {}, cond:d.cond || {}, actions:d.actions || []};
      const kept = (name, same) => (same && name ? name : undefined);
      d.name = val('autoName');
      d.trigger = {type:val('autoTrigger'), stage:val('autoStage'), days:val('autoDays')};
      d.trigger.stageName = kept(old.trigger.stageName, old.trigger.stage === d.trigger.stage);
      d.cond = {label:val('autoCondLabel'), assignee:val('autoCondAssignee')};
      d.cond.assigneeName = kept(old.cond.assigneeName, old.cond.assignee === d.cond.assignee);
      d.actions = Array.prototype.map.call(this.body.querySelectorAll('.auto-action'), (row, i) => {
        const type = row.querySelector('.auto-a-type').value;
        const el = row.querySelector('.auto-a-val');
        const value = el ? el.value : '';
        const was = old.actions[i] || {};
        if(type === 'move') return {type:type, stage:value, stageName:kept(was.stageName, was.type === type && was.stage === value)};
        if(type === 'assign') return {type:type, uid:value, memberName:kept(was.memberName, was.type === type && was.uid === value)};
        return type === 'label' ? {type:type, name:value} : type === 'subtask' ? {type:type, text:value}
          : type === 'due' ? {type:type, days:value} : {type:type};
      });
      return d;
    }

    renderForm(){
      const d = this.draft, ctx = this.ctx;
      /* Lo que la regla tenía elegido y ya no existe sigue en su lista, dicho con su nombre: así
         se ve qué falta y hay que elegir otra cosa a propósito (no se cambia sola por la primera). */
      const gone = (value, name) => option(value, t('{name} (ya no existe)', {name:name}), true);
      const stages = (selected, any, name) => (any ? option('', t('Cualquier columna'), !selected) : '') +
        (selected && !ctx.stages.some((s) => s.key === selected) ? gone(selected, name || t('columna borrada')) : '') +
        ctx.stages.map((s) => option(s.key, s.label, s.key === selected)).join('');
      const hasLabel = (name) => ctx.labels.some((l) => l.trim().toLowerCase() === String(name).trim().toLowerCase());
      const hasMember = (uid) => ctx.members.some((m) => m.uid === uid);
      const tr = d.trigger || {};
      const triggers = [['moved', 'una tarea se mueve a una columna'], ['created', 'se crea una tarea'], ['completed', 'una tarea se completa'], ['due', 'se acerca la fecha límite'], ['button', 'alguien pulsa su botón en la tarea']];
      const isButton = tr.type === 'button';
      const types = [['move', 'Mover a la columna'], ['complete', 'Marcar como completada'], ['label', 'Añadir la etiqueta'], ['subtask', 'Añadir la subtarea'], ['due', 'Poner la fecha límite']]
        .concat(ctx.team ? [['assign', 'Asignar a']] : []);
      const param = (a, i) => {
        const label = ' aria-label="' + esc(t('Valor de la acción {n}', {n:i + 1})) + '"';
        if(a.type === 'move') return '<select class="auto-a-val"' + label + '>' + stages(a.stage || (ctx.stages[0] || {}).key, false, a.stageName) + '</select>';
        if(a.type === 'label') return ctx.labels.length || a.name
          ? '<select class="auto-a-val"' + label + '>' + (a.name && !hasLabel(a.name) ? gone(a.name, a.name) : '') + ctx.labels.map((l) => option(l, l, l === a.name)).join('') + '</select>'
          : '<span class="auto-hint">' + esc(t('El proyecto no tiene etiquetas todavía.')) + '</span>';
        if(a.type === 'assign') return '<select class="auto-a-val"' + label + '>' + (a.uid && !hasMember(a.uid) ? gone(a.uid, a.memberName || t('alguien que ya no está')) : '') +
          ctx.members.map((m) => option(m.uid, m.name, m.uid === a.uid)).join('') + '</select>';
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
          (tr.type === 'moved' || tr.type === 'created' ? '<select id="autoStage" aria-label="' + esc(t('Columna')) + '">' + stages(tr.stage || (tr.type === 'moved' ? (ctx.stages[0] || {}).key : ''), tr.type === 'created', tr.stageName) + '</select>' : '') +
          (tr.type === 'due' ? '<span class="auto-days"><input type="number" id="autoDays" min="0" max="365" value="' + esc(tr.days == null || tr.days === '' ? 2 : tr.days) + '" aria-label="' + esc(t('Días antes de la fecha límite')) + '"><span>' + esc(t('días antes (0 = el mismo día)')) + '</span></span>' : '') +
        '</fieldset>' +
        (isButton ? '<p class="auto-note auto-note-form">' + esc(t('El botón sale en la ficha de cada tarea, para quien puede editar el proyecto.')) + '</p>' : '') +
        '<fieldset class="auto-block"' + (isButton ? ' hidden' : '') + '><legend>' + esc(t('Solo si… (opcional)')) + '</legend>' +
          '<select id="autoCondLabel" aria-label="' + esc(t('Etiqueta que tiene que llevar')) + '">' + option('', t('Con cualquier etiqueta o sin ninguna'), !d.cond.label) + (d.cond.label && !hasLabel(d.cond.label) ? gone(d.cond.label, d.cond.label) : '') + ctx.labels.map((l) => option(l, t('Lleva la etiqueta «{name}»', {name:l}), l === d.cond.label)).join('') + '</select>' +
          (ctx.team ? '<select id="autoCondAssignee" aria-label="' + esc(t('Quién la tiene asignada')) + '">' + option('', t('La tenga quien la tenga'), !d.cond.assignee) + option('none', t('No tiene a nadie asignado'), d.cond.assignee === 'none') +
            (d.cond.assignee && d.cond.assignee !== 'none' && !hasMember(d.cond.assignee) ? gone(d.cond.assignee, d.cond.assigneeName || t('alguien que ya no está')) : '') +
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
