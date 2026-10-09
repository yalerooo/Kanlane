/* Diálogo de tarea: formulario, notas con imágenes y contactos/contraseñas vinculados. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const {fmtDateTime} = Workhub.utils.dates;
  const {copySecret, showMessage} = Workhub.utils.ui;
  const platform = Workhub.services.platform;
  const VaultModel = Workhub.models.VaultModel;
  const md = Workhub.utils.markdown;
  const attachments = Workhub.views.attachments;

  const $ = (id) => document.getElementById(id);
  /* Cómo se nombra cada relación desde la tarea abierta. */
  const RELATION_LABEL = {related:'Relacionada con', blockedBy:'Bloqueada por', blocks:'Bloquea a'};

  class TaskDialogView {
    constructor(){
      this.dlg = $('dlg');
      this.form = $('form');
      this.title = $('dlgTitle');
      this.fields = {
        id: $('taskId'),
        title: $('fTitle'),
        desc: $('fDesc'),
        estado: $('fEstado'),
        contacto: $('fContacto'),
        ubicacion: $('fUbicacion'),
        fecha: $('fFecha'),
        inicio: $('fInicio'),
        repeat: $('fRepeat')
      };
      /* Campos personalizados del proyecto (los pinta Workhub.views.fields). */
      this.customField = $('fCustomField');
      this.customEl = $('fCustom');
      this.formError = $('fFormError');
      /* Los avisos del título y del cliente van junto a su campo: el general queda al final del formulario, fuera de la vista. */
      this.titleError = $('fTitleError');
      this.clienteError = $('fClienteError');
      this.repeatError = $('fRepeatError');
      this.form.addEventListener('input', () => { this._clearErrors(); });
      this.form.addEventListener('change', () => { this._clearErrors(); });
      /* Subtareas: [{id, text, done}] y, en equipos, assignee, doneBy y doneAt (TaskModel.checkItem). */
      this.checklist = [];
      this.checkList = $('fChecklist');
      this.checkNew = $('fCheckNew');
      this.checkSummary = $('fChecklistSummary');
      this.checkProgress = $('fChecklistProgress');
      this.checkProgressFill = $('fChecklistProgressFill');
      this._bindChecklist();
      this.cliente = new Workhub.views.ClientSelect('f');
      this.btnCancel = $('btnCancel');
      this.btnDelete = $('btnDelete');
      this.btnArchive = $('btnArchiveTask');

      this.notesSection = $('taskNotesSection');
      this.notesList = $('taskNotesList');
      this.noteText = $('noteText');
      this.btnAddNote = $('btnAddNote');
      this.noteError = $('noteError');
      /* Archivos adjuntos a la nota que se está escribiendo (se suben al añadirla). */
      this.picker = new attachments.Picker({
        input:$('noteImageInput'), button:$('btnAttachImage'), list:$('noteFiles'),
        drop:$('noteAddBox'), paste:this.noteText, onError:(msg) => this.showNoteError(msg)
      });

      this.linksSection = $('taskLinksSection');
      this.linksSection2 = $('taskLinksSection2');
      this.linkedContactsList = $('linkedContactsList');
      this.linkContactPicker = $('linkContactPicker');
      this.linkedVaultList = $('linkedVaultList');
      this.linkVaultPicker = $('linkVaultPicker');
      /* Relaciones con otras tareas: se guardan al momento, como los demás vínculos. */
      this.relationsSection = $('taskRelationsSection');
      this.relatedList = $('relatedTasksList');
      this.relationKind = $('relationKind');
      this.relationPicker = $('relationTaskPicker');
      this.relationError = $('relationError');

      /* Asignadas a (solo en equipos): uids de los miembros elegidos. */
      this.assigneesEl = $('fAssignees');
      this.assigned = [];
      this.assigneesEl.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-uid]');
        if(!b) return;
        const uid = b.getAttribute('data-uid');
        const at = this.assigned.indexOf(uid);
        if(at === -1) this.assigned.push(uid); else this.assigned.splice(at, 1);
        this._renderAssignees();
      });

      /* Etiquetas: las elegidas y el catálogo del proyecto. */
      this.labelsEl = $('fLabels');
      this.labelNew = $('fLabelNew');
      this.labelName = $('fLabelName');
      this.labelColors = $('fLabelColors');
      this.labelAdd = $('fLabelAdd');
      this.selected = [];
      this.catalog = [];
      this.newColor = Workhub.views.labels.PALETTE[0];
      this.onCreateLabel = null;

      /* Portada: null, {color} o {asset}. Las imágenes que se ofrecen son las de las notas de la tarea. */
      this.coverEl = $('fCover');
      this.cover = null;
      this.hadCover = false;
      this.coverImages = [];
      this.coverEl.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-cover]');
        if(!b) return;
        const kind = b.getAttribute('data-cover');
        const value = b.getAttribute('data-value');
        this.cover = kind === 'color' ? {color:value} : kind === 'asset' ? {asset:value} : null;
        this._renderCover();
      });

      this._bindLocalUi();
      this._bindLabels();
    }

    /* ---------- Portada ---------- */

    _renderCover(){
      const cur = this.cover || {};
      const images = this.coverImages.slice();
      if(cur.asset && images.indexOf(cur.asset) === -1) images.unshift(cur.asset);
      const option = (kind, value, on, cls, label, inner, style) =>
        '<button type="button" class="' + cls + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-cover="' + kind + '" data-value="' + esc(value) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"' + (style || '') + '>' + (inner || '') + '</button>';
      this.coverEl.innerHTML =
        option('none', '', !this.cover, 'cover-none', Workhub.t('Sin portada'), '<span>' + esc(Workhub.t('Sin portada')) + '</span>') +
        Workhub.models.ProjectTemplates.COLORS.map((c) => option('color', c.key, cur.color === c.key, 'stage-color is-lg', Workhub.t(c.name), '', ' style="--c:' + c.dot + '"')).join('') +
        images.map((id, i) => {
          const src = platform.assetUrlNow(id);
          return option('asset', id, cur.asset === id, 'cover-thumb', Workhub.t('Imagen {n}', {n:i + 1}),
            '<img' + (src ? ' src="' + esc(src) + '"' : '') + ' data-asset-id="' + esc(id) + '" alt="">');
        }).join('');
      platform.hydrateAssetImages(this.coverEl);
    }

    /* ---------- Asignaciones ---------- */

    _renderAssignees(){
      const T = Workhub.views.team;
      this.assigneesEl.innerHTML = T.members().map((m) => {
        const on = this.assigned.indexOf(m.uid) !== -1;
        const you = m.uid === T.meUid();
        return '<button type="button" class="assignee-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-uid="' + esc(m.uid) + '" translate="no">' +
          T.avatar(m, 'is-mini') + '<span>' + esc(m.name) + (you ? ' (' + esc(Workhub.t('yo')) + ')' : '') + '</span></button>';
      }).join('');
    }

    /* ---------- Etiquetas ---------- */

    _bindLabels(){
      this.labelsEl.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-label], button[data-label-new]');
        if(!b) return;
        if(b.hasAttribute('data-label-new')){
          this.labelNew.hidden = !this.labelNew.hidden;
          if(!this.labelNew.hidden) this.labelName.focus();
          return;
        }
        const name = b.getAttribute('data-label');
        const at = this.selected.findIndex((n) => n.toLowerCase() === name.toLowerCase());
        if(at === -1) this.selected.push(name);
        else this.selected.splice(at, 1);
        this._renderLabels();
      });
      this.labelColors.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-color]');
        if(!b) return;
        this.newColor = b.getAttribute('data-color');
        this._renderLabelColors();
      });
      const create = () => {
        const name = this.labelName.value.trim();
        if(!name) { this.labelName.focus(); return; }
        if(!this.catalog.some((l) => l.name.toLowerCase() === name.toLowerCase())) this.catalog.push({name:name, color:this.newColor});
        if(!this.selected.some((n) => n.toLowerCase() === name.toLowerCase())) this.selected.push(name);
        if(this.onCreateLabel) this.onCreateLabel(name, this.newColor);
        this.labelName.value = '';
        this.labelNew.hidden = true;
        this._renderLabels();
      };
      this.labelAdd.addEventListener('click', create);
      /* Enter crea la etiqueta en vez de guardar la tarea. */
      this.labelName.addEventListener('keydown', (ev) => {
        if(ev.key === 'Enter'){ ev.preventDefault(); create(); }
      });
    }

    /* handler(name, color): guarda la etiqueta nueva en el catálogo del proyecto. */
    bindCreateLabel(handler){
      this.onCreateLabel = handler;
    }

    setLabelCatalog(list){
      this.catalog = (list || []).map((l) => ({name:l.name, color:l.color}));
      this._renderLabels();
    }

    _renderLabels(){
      const L = Workhub.views.labels;
      /* Las elegidas que no estén en el catálogo (p. ej. venidas de GitHub) también se ven. */
      const extra = this.selected.filter((n) => !this.catalog.some((l) => l.name.toLowerCase() === n.toLowerCase())).map((n) => ({name:n, color:''}));
      this.labelsEl.innerHTML = this.catalog.concat(extra).map((l) => {
        const on = this.selected.some((n) => n.toLowerCase() === l.name.toLowerCase());
        return '<button type="button" class="label-chip is-toggle' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-label="' + esc(l.name) + '" translate="no" style="--lc:#' + L.color(l.color) + '">' + esc(l.name) + '</button>';
      }).join('') + '<button type="button" class="label-add" data-label-new>+ Nueva etiqueta</button>';
      this._renderLabelColors();
    }

    _renderLabelColors(){
      const L = Workhub.views.labels;
      this.labelColors.innerHTML = L.PALETTE.map((c) => {
        const on = c === this.newColor;
        return '<button type="button" class="stage-color' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-color="' + c + '" style="--c:#' + c + '" aria-label="#' + c + '"></button>';
      }).join('');
    }

    /* Interacciones que no tocan datos: ampliar una imagen o descargar un archivo de una nota. */
    _bindLocalUi(){
      attachments.bind(this.notesList);
    }

    /* ---------- Eventos hacia el controlador ---------- */

    bindSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        /* Intro en una subtarea nunca guarda la tarea, tampoco si llega como envío del formulario
           (teclados que no avisan de la tecla): añade la subtarea o pasa al campo de añadir. */
        const at = document.activeElement;
        if(at === this.checkNew){ this._addCheck(); return; }
        if(at && this.checkList.contains(at) && at.matches('input[type=text]')){ this.checkNew.focus(); return; }
        const extra = this._extras();
        if(extra.error){
          this._clearErrors();
          showMessage(extra.at || this.formError, extra.error);
          if(extra.el && extra.el.focus) extra.el.focus();
          return;
        }
        handler(this.fields.id.value, this.values(extra));
      });
    }

    _clearErrors(){
      this.formError.hidden = true;
      this.titleError.hidden = true;
      this.clienteError.hidden = true;
      this.repeatError.hidden = true;
    }

    /* Fecha de inicio y campos personalizados: {startDate, custom} o {error, el} si algo no vale.
       El título y el cliente también se comprueban aquí: el formulario no usa la validación del navegador. */
    _extras(){
      if(!this.fields.title.value.trim()) return {error:'El título es obligatorio.', el:this.fields.title, at:this.titleError};
      /* Con los clientes desactivados el campo está oculto y no se exige. */
      const field = this.cliente.select.closest('.field');
      if(!field.classList.contains('clients-off') && !this.cliente.value()){
        const el = this.cliente.newWrap.hidden ? field.querySelector('.dd-trigger') || this.cliente.select : this.cliente.newInput;
        return {error:'Elige un cliente o proyecto.', el:el, at:this.clienteError};
      }
      const start = this.fields.inicio.value || '';
      const due = this.fields.fecha.value || '';
      if(start && due && start > due){
        return {error:'La fecha de inicio no puede ser posterior a la fecha límite.', el:this.fields.inicio.parentNode.querySelector('.dp-trigger') || this.fields.inicio};
      }
      /* Sin fecha límite no hay repetición: se avisa en vez de quitarla al guardar sin decir nada. */
      if(!due && this.fields.repeat.value && !this.fields.repeat.closest('.field').hidden){
        return {error:'La repetición necesita una fecha límite. Pon una fecha o elige «No se repite».', el:this.fields.fecha.parentNode.querySelector('.dp-trigger') || this.fields.fecha, at:this.repeatError};
      }
      const read = Workhub.views.fields.readForm(this.customEl);
      if(read.error) return read;
      return {startDate:start, custom:read.values};
    }

    _renderCustom(custom){
      const list = Workhub.views.fields.list();
      this.customField.hidden = !list.length;
      this.customEl.innerHTML = Workhub.views.fields.formHtml(custom);
      Workhub.views.Dropdown.enhanceAll(this.customEl);
      Workhub.views.DatePicker.enhanceAll(this.customEl);
    }

    /* Escape pasa por el mismo cierre que Cancelar y la ×, para que el controlador pueda
       preguntar antes de descartar lo escrito. */
    bindCancel(handler){
      this.btnCancel.addEventListener('click', handler);
      this.dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); handler(); });
    }

    /* Lo que hay escrito en el formulario, para saber si ha cambiado desde que se abrió. */
    _snapshot(){
      /* data-transient: controles que no son datos de la tarea (el tipo de relación que se va a añadir). */
      const controls = Array.prototype.filter.call(this.form.elements, (el) => el.tagName !== 'BUTTON' && el.tagName !== 'FIELDSET' && !el.hasAttribute('data-transient'))
        .map((el, i) => [el.id || el.name || i, el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value]);
      return JSON.stringify([controls, this.checklist, this.selected, this.assigned, this.cover]);
    }

    /* Da por guardado lo que hay ahora: a partir de aquí, cualquier cambio cuenta. */
    markClean(){ this.clean = this._snapshot(); }

    isDirty(){ return this.dlg.open && this._snapshot() !== this.clean; }

    isOpen(){ return this.dlg.open; }

    bindDelete(handler){
      this.btnDelete.addEventListener('click', () => handler(this.fields.id.value));
    }

    bindArchive(handler){
      this.btnArchive.addEventListener('click', () => handler(this.fields.id.value));
    }

    bindAddNote(handler){
      this.btnAddNote.addEventListener('click', () => {
        this.noteError.hidden = true;
        const text = this.noteText.value.trim();
        const files = this.picker.files.slice();
        if(!text && !files.length){
          showMessage(this.noteError, 'Escribe algo o adjunta un archivo.');
          return;
        }
        handler(text, files);
      });
    }

    /* Casillas del texto de una nota. handler(noteId, n, checked). */
    bindNoteTasks(handler){
      this.notesList.addEventListener('change', (ev) => {
        const box = closest(ev.target, 'input[data-md-task]');
        const note = box && closest(box, '.note-item[data-id]');
        if(note) handler(note.getAttribute('data-id'), +box.getAttribute('data-md-task'), box.checked);
      });
    }

    bindDeleteNote(handler){
      this.notesList.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-action="delnote"]');
        if(btn) handler(btn.getAttribute('data-id'));
      });
    }

    bindLinkPickers(onLinkContact, onLinkVault){
      this.linkContactPicker.addEventListener('change', () => {
        const id = this.linkContactPicker.value;
        this.linkContactPicker.value = '';
        if(id) onLinkContact(id);
      });
      this.linkVaultPicker.addEventListener('change', () => {
        const id = this.linkVaultPicker.value;
        this.linkVaultPicker.value = '';
        if(id) onLinkVault(id);
      });
    }

    /* handler(action, id, button) */
    bindLinkedActions(handler){
      const delegate = (ev) => {
        const btn = closest(ev.target, 'button[data-action]');
        if(btn) handler(btn.getAttribute('data-action'), btn.getAttribute('data-id'), btn);
      };
      this.linkedContactsList.addEventListener('click', delegate);
      this.linkedVaultList.addEventListener('click', delegate);
      this.relatedList.addEventListener('click', delegate);
    }

    /* handler(kind, taskId): relacionar la tarea abierta con otra ('related' | 'blockedBy' | 'blocks'). */
    bindRelationPicker(handler){
      this.relationPicker.addEventListener('change', () => {
        const id = this.relationPicker.value;
        this.relationPicker.value = '';
        this.relationError.hidden = true;
        if(id) handler(this.relationKind.value, id);
      });
    }

    /* relations: [{id, kind, task}] (TaskModel.relationsOf); candidates: tareas que aún se pueden elegir. */
    renderRelations(relations, candidates){
      const TaskModel = Workhub.models.TaskModel;
      const t = Workhub.t;
      this.relatedList.innerHTML = relations.length ? relations.map((r) => {
        const s = TaskModel.statusOf(r.task.status);
        const waiting = r.kind === 'blockedBy' && !TaskModel.isDone(r.task);
        return '<div class="linked-row' + (waiting ? ' is-blocking' : '') + '" data-id="' + esc(r.id) + '">' +
          '<div class="linked-main"><div class="linked-title" translate="no">' + esc(r.task.title || t('Sin título')) + '</div>' +
          '<div class="linked-meta">' + esc(t(RELATION_LABEL[r.kind])) + ' · <span translate="no">' + esc(s.label) + '</span></div></div>' +
          '<div class="linked-actions">' +
          '<button type="button" class="icon-btn" data-action="open-task" data-id="' + esc(r.id) + '">' + esc(t('Abrir')) + '</button>' +
          '<button type="button" class="icon-btn" data-action="unlink-task" data-id="' + esc(r.id) + '">' + esc(t('Quitar')) + '</button>' +
          '</div></div>';
      }).join('') : '<p class="linked-empty">' + esc(t('Sin tareas relacionadas.')) + '</p>';
      this.relationPicker.innerHTML = '<option value="">' + esc(t('+ Elegir tarea…')) + '</option>' +
        candidates.map((c) => '<option value="' + esc(c.id) + '">' + esc((c.title || t('Sin título')) + ' — ' + TaskModel.statusOf(c.status).label) + '</option>').join('');
      this.relationPicker.closest('.relation-add').hidden = !candidates.length;
    }

    showRelationError(msg){ showMessage(this.relationError, msg); }

    /* ---------- Subtareas ---------- */

    _bindChecklist(){
      const add = () => {
        const text = this.checkNew.value.trim();
        if(!text) return;
        this.checklist.push({id:'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text:text, done:false});
        this.checkNew.value = '';
        this._renderChecklist();
        this.checkNew.focus();
      };
      $('fCheckAdd').addEventListener('click', add);
      this._addCheck = add;
      this.checkNew.addEventListener('keydown', (ev) => {
        if(ev.key === 'Enter'){ ev.preventDefault(); add(); }
      });
      const find = (el) => {
        const row = el.closest('[data-cid]');
        return row ? this.checklist.find((c) => c.id === row.getAttribute('data-cid')) : null;
      };
      this.checkList.addEventListener('change', (ev) => {
        const c = find(ev.target);
        if(c && ev.target.matches('input[type=checkbox]')){
          c.done = ev.target.checked;
          /* En un equipo queda quién la completa y cuándo; al reabrirla se borra. */
          const T = Workhub.views.team;
          delete c.doneBy;
          delete c.doneAt;
          if(c.done && T.enabled()){ c.doneBy = T.meUid(); c.doneAt = Date.now(); }
          const row = ev.target.closest('.check-row');
          const who = row.querySelector('.check-who');
          if(who) who.remove();
          row.querySelector('input[type="text"]').insertAdjacentHTML('afterend', T.checkWho(c));
          ev.target.closest('.check-row').classList.toggle('is-done', c.done);
          this._updateChecklistProgress();
        }
      });
      this.checkList.addEventListener('input', (ev) => {
        const c = find(ev.target);
        if(c && ev.target.matches('input[type=text]')) c.text = ev.target.value;
      });
      this.checkList.addEventListener('keydown', (ev) => {
        if(ev.key === 'Enter' && ev.target.matches('input[type=text]')){ ev.preventDefault(); this.checkNew.focus(); }
      });
      this.checkList.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-act]');
        const c = btn && find(btn);
        if(!c) return;
        const action = btn.getAttribute('data-act');
        if(action === 'check-assign'){
          Workhub.views.team.pick(btn, btn.getAttribute('data-uid'), (uid) => {
            if(uid) c.assignee = uid; else delete c.assignee;
            this._renderChecklist();
            const again = this.checkList.querySelector('[data-cid="' + c.id + '"] [data-act="check-assign"]');
            if(again) again.focus();
          });
          return;
        }
        if(action === 'check-del') this.checklist = this.checklist.filter((x) => x !== c);
        else if(action === 'check-up' || action === 'check-down'){
          const from = this.checklist.indexOf(c);
          const to = from + (action === 'check-up' ? -1 : 1);
          if(to < 0 || to >= this.checklist.length) return;
          this.checklist.splice(from, 1);
          this.checklist.splice(to, 0, c);
        } else return;
        this._renderChecklist();
        if(action !== 'check-del') this.checkList.querySelector('[data-cid="' + c.id + '"] input[type="text"]').focus();
      });
      let dragged = null;
      this.checkList.addEventListener('dragstart', (ev) => {
        const handle = ev.target.closest('[data-act="check-drag"]');
        const c = handle && find(handle);
        if(!c){ ev.preventDefault(); return; }
        dragged = c.id;
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', c.id);
        handle.closest('.check-row').classList.add('is-dragging');
      });
      this.checkList.addEventListener('dragover', (ev) => {
        const row = ev.target.closest('.check-row');
        if(!dragged || !row || row.getAttribute('data-cid') === dragged) return;
        ev.preventDefault();
        this.checkList.querySelectorAll('.drop-before,.drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
        row.classList.add(ev.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'drop-before' : 'drop-after');
      });
      this.checkList.addEventListener('drop', (ev) => {
        const row = ev.target.closest('.check-row');
        if(!dragged || !row) return;
        ev.preventDefault();
        const from = this.checklist.findIndex((c) => c.id === dragged);
        const target = this.checklist.findIndex((c) => c.id === row.getAttribute('data-cid'));
        if(from >= 0 && target >= 0 && from !== target){
          const after = ev.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
          const [item] = this.checklist.splice(from, 1);
          this.checklist.splice(target + (after && from > target ? 1 : 0) - (!after && from < target ? 1 : 0), 0, item);
          this._renderChecklist();
        }
        dragged = null;
        this.checkList.querySelectorAll('.drop-before,.drop-after,.is-dragging').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'is-dragging'));
      });
      this.checkList.addEventListener('dragend', () => {
        dragged = null;
        this.checkList.querySelectorAll('.drop-before,.drop-after,.is-dragging').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'is-dragging'));
      });
    }

    _renderChecklist(){
      this.checkList.innerHTML = this.checklist.map((c, i) =>
        '<div class="check-row' + (c.done ? ' is-done' : '') + '" data-cid="' + esc(c.id) + '">' +
        '<button type="button" class="check-drag" data-act="check-drag" draggable="true" aria-label="Arrastrar subtarea" title="Arrastrar para ordenar"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="3" r="1"/><circle cx="11" cy="3" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="5" cy="13" r="1"/><circle cx="11" cy="13" r="1"/></svg></button>' +
        '<input type="checkbox"' + (c.done ? ' checked' : '') + ' aria-label="Hecha">' +
        '<input type="text" maxlength="120" value="' + esc(c.text) + '" aria-label="Subtarea" translate="no" autocomplete="off">' +
        Workhub.views.team.checkWho(c) +
        '<button type="button" class="check-move" data-act="check-up" aria-label="Subir subtarea" title="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="check-move" data-act="check-down" aria-label="Bajar subtarea" title="Bajar"' + (i === this.checklist.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="icon-btn check-del" data-act="check-del" aria-label="Quitar subtarea" title="Quitar">' + Workhub.utils.html.iconSpan('close') + '</button>' +
        '</div>').join('');
      this._updateChecklistProgress();
    }

    _updateChecklistProgress(){
      const total = this.checklist.length;
      const done = this.checklist.filter((c) => c.done).length;
      const percent = total ? Math.round(done / total * 100) : 0;
      this.checkSummary.hidden = this.checkProgress.hidden = !total;
      this.checkSummary.textContent = percent + '%';
      this.checkProgress.setAttribute('aria-valuenow', percent);
      this.checkProgressFill.style.width = percent + '%';
    }

    /* ---------- Estado del formulario ---------- */

    values(extra){
      extra = extra || this._extras();
      const fecha = this.fields.fecha.value || '';
      const hora = fecha ? this._hora().value || '' : '';
      const values = {
        title: this.fields.title.value.trim(),
        desc: this.fields.desc.value.trim(),
        cliente: this.cliente.value() || '',
        status: this.fields.estado.value,
        contacto: this.fields.contacto.value.trim(),
        dueDate: fecha,
        /* Repetir necesita una fecha de la que partir. */
        repeat: fecha ? (this.fields.repeat.value || '') : '',
        checklist: this.checklist.filter((c) => c.text.trim()).map((c) => Object.assign(Workhub.models.TaskModel.checkItem(c), {text:c.text.trim()})),
        labels: this.selected.slice(),
        /* Fuera de un equipo no se toca el campo. */
        assignees: Workhub.views.team.enabled() ? this.assigned.slice() : undefined
      };
      /* La hora solo se escribe si la hay o si hay que quitar la que tenía: las tareas sin hora no llevan el campo. */
      if(hora || this.hadTime) values.dueTime = hora;
      /* Lo mismo con el inicio y los campos personalizados: una tarea que no los usa no los lleva. */
      if(extra.startDate || this.hadStart) values.startDate = extra.startDate || '';
      if(extra.custom && (Object.keys(extra.custom).length || this.hadCustom)) values.custom = extra.custom;
      const ubicacion = this.fields.ubicacion.value.trim();
      if(ubicacion || this.hadLocation) values.location = ubicacion;
      /* Y con la portada: {} quita la que tenía. */
      if(this.cover || this.hadCover) values.cover = this.cover || {};
      return values;
    }

    /* El campo de la hora lo crea el selector de fecha (data-dp-time en #fFecha). */
    _hora(){ return $('fHora') || {value:''}; }

    openNew(clientNames, defaultCliente, status){
      this.form.reset();
      this.resetNoteForm();
      this.fields.id.value = '';
      this.hadTime = false;
      this.hadStart = this.hadCustom = this.hadLocation = false;
      this.cover = null;
      this.hadCover = false;
      this.coverImages = [];
      this._renderCover();
      this._clearErrors();
      this._renderCustom({});
      this.checklist = [];
      this._renderChecklist();
      this.selected = [];
      this.assigned = [];
      this._renderAssignees();
      this.labelNew.hidden = true;
      this._renderLabels();
      this.title.textContent = 'Nueva tarea';
      this.fields.estado.value = status || Workhub.models.TaskModel.STATUS[0].key;
      this.cliente.reset(clientNames, defaultCliente);
      this.notesSection.hidden = true;
      this.linksSection.hidden = true;
      this.linksSection2.hidden = true;
      this.relationsSection.hidden = true;
      this.btnDelete.hidden = true;
      this.btnArchive.hidden = true;
      this.dlg.showModal();
    }

    openEdit(t, clientNames){
      this.resetNoteForm();
      this.fields.id.value = t.id;
      this.title.textContent = 'Editar tarea';
      this.fields.title.value = t.title || '';
      this.fields.desc.value = t.desc || '';
      this.fields.estado.value = Workhub.models.TaskModel.stageKey(t);
      this.fields.contacto.value = t.contacto || '';
      this.fields.ubicacion.value = typeof t.location === 'string' ? t.location : '';
      this.hadLocation = !!this.fields.ubicacion.value;
      this.fields.fecha.value = t.dueDate || '';
      this._hora().value = t.dueDate ? (t.dueTime || '') : '';
      this.hadTime = !!t.dueTime;
      this.fields.inicio.value = t.startDate || '';
      this.hadStart = !!t.startDate;
      this.hadCustom = !!(t.custom && Object.keys(t.custom).length);
      this.cover = Workhub.models.TaskModel.coverOf(t);
      this.hadCover = !!this.cover;
      this.coverImages = [];
      this._renderCover();
      this._clearErrors();
      this._renderCustom(t.custom || {});
      this.fields.repeat.value = t.repeat || '';
      this.checklist = (Array.isArray(t.checklist) ? t.checklist : []).map((c) => Object.assign(Workhub.models.TaskModel.checkItem(c), {text:c.text || ''}));
      this._renderChecklist();
      this.selected = Array.isArray(t.labels) ? t.labels.slice() : [];
      this.assigned = Workhub.views.team.assigned(t);
      this._renderAssignees();
      this.labelNew.hidden = true;
      this._renderLabels();
      this.cliente.reset(clientNames, t.cliente || '');
      this.btnDelete.hidden = false;
      this.btnArchive.hidden = false;
      this.notesSection.hidden = false;
      this.notesList.innerHTML = 'Cargando notas…';
      this.linksSection.hidden = false;
      this.linksSection2.hidden = false;
      this.relationsSection.hidden = false;
      this.relationKind.value = 'related';
      this.relationError.hidden = true;
      this.dlg.showModal();
    }

    setDueDate(date){ this.fields.fecha.value = date; }

    setCliente(clientNames, value){ this.cliente.populate(clientNames, value); }

    close(){ this.dlg.close(); }

    /* ---------- Notas ---------- */

    _clearNoteImage(){ this.picker.clear(); }

    resetNoteForm(){
      this.noteText.value = '';
      this.noteError.hidden = true;
      this._clearNoteImage();
    }

    setAddingNote(busy){
      this.btnAddNote.disabled = busy;
      this.btnAddNote.textContent = busy ? 'Añadiendo…' : 'Añadir nota';
    }

    showNoteError(msg){ showMessage(this.noteError, msg); }

    renderNotes(docs){
      this.notesList.innerHTML = docs.length
        ? docs.map(noteHtml).join('')
        : '<p class="line" style="opacity:.65">Sin notas todavía.</p>';
      platform.hydrateAssetImages(this.notesList);
      /* Las imágenes de las notas son las que se pueden poner de portada. Si se elimina la nota
         que tenía la elegida, el formulario se queda sin portada (TaskModel.removeNote hace lo mismo). */
      const before = this.coverImages;
      this.coverImages = docs.reduce((ids, d) => ids.concat(Workhub.models.TaskModel.attachmentsOf(d.data() || {})
        .filter((a) => a.image).map((a) => a.parts[0])), []).filter((id, i, all) => all.indexOf(id) === i);
      const gone = this.cover && this.cover.asset && before.indexOf(this.cover.asset) !== -1 && this.coverImages.indexOf(this.cover.asset) === -1;
      if(gone){
        /* No cuenta como un cambio sin guardar: la tarea ya está así. */
        const wasClean = !this.isDirty();
        this.cover = null;
        this.hadCover = false;
        if(wasClean) this.markClean();
      }
      this._renderCover();
    }

    showNotesError(){
      this.notesList.innerHTML = '<p class="line" style="opacity:.65">No se pudieron cargar las notas.</p>';
    }

    /* ---------- Vínculos ---------- */

    renderLinkedContacts(linkedIds, contacts){
      if(!linkedIds.length){
        this.linkedContactsList.innerHTML = '<p class="linked-empty">Sin contactos vinculados.</p>';
      } else {
        this.linkedContactsList.innerHTML = linkedIds.map((id) => {
          const c = contacts.find((x) => x.id === id);
          if(!c) return '';
          return '<div class="linked-row" data-id="' + esc(id) + '">' +
            '<div class="linked-main"><div class="linked-title" translate="no">' + esc(c.nombre || 'Sin nombre') + '</div>' +
            '<div class="linked-meta">' + esc(c.email || c.cliente || '') + '</div></div>' +
            '<div class="linked-actions">' +
            '<button type="button" class="icon-btn" data-action="open-contact" data-id="' + esc(id) + '">Abrir</button>' +
            '<button type="button" class="icon-btn" data-action="unlink-contact" data-id="' + esc(id) + '">Quitar</button>' +
            '</div></div>';
        }).join('');
      }
      const available = contacts.filter((c) => linkedIds.indexOf(c.id) === -1)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      this.linkContactPicker.innerHTML = '<option value="">+ Vincular contacto existente…</option>' +
        available.map((c) => {
          const label = (c.nombre || 'Sin nombre') + ' — ' + (c.cliente || 'Sin cliente');
          return '<option value="' + esc(c.id) + '">' + esc(label) + '</option>';
        }).join('');
    }

    renderLinkedVault(linkedIds, vault){
      if(!linkedIds.length){
        this.linkedVaultList.innerHTML = '<p class="linked-empty">Sin contraseñas vinculadas.</p>';
      } else {
        this.linkedVaultList.innerHTML = linkedIds.map((id) => {
          const v = vault.find(id);
          if(!v) return '';
          const actionBtn = vault.unlocked
            ? '<button type="button" class="icon-btn" data-action="toggle-linked-vault" data-id="' + esc(id) + '">' + (vault.isVisible(id) ? 'Ocultar' : 'Mostrar') + '</button>'
            : '<button type="button" class="icon-btn" data-action="goto-vault" data-id="' + esc(id) + '">Desbloquear</button>';
          const copyBtn = vault.unlocked
            ? '<button type="button" class="icon-btn" data-action="copy-linked-vault" data-id="' + esc(id) + '">Copiar</button>'
            : '';
          return '<div class="linked-row" data-id="' + esc(id) + '">' +
            '<div class="linked-main"><div class="linked-title" translate="no">' + esc(VaultModel.titleFor(v)) + '</div>' +
            '<div class="linked-meta">' + esc(VaultModel.typeLabel(v.tipo)) + ' · ' + esc(v.cliente || '') + '</div></div>' +
            '<div class="linked-actions">' +
            '<span class="linked-pass">' + esc(vault.passwordText(id)) + '</span>' +
            actionBtn + copyBtn +
            '<button type="button" class="icon-btn" data-action="unlink-vault" data-id="' + esc(id) + '">Quitar</button>' +
            '</div></div>';
        }).join('');
      }
      const available = vault.items.filter((v) => linkedIds.indexOf(v.id) === -1)
        .sort((a, b) => (a.cliente || '').localeCompare(b.cliente || ''));
      this.linkVaultPicker.innerHTML = '<option value="">+ Vincular contraseña existente…</option>' +
        available.map((v) => {
          const label = VaultModel.titleFor(v) + ' — ' + VaultModel.typeLabel(v.tipo) + ' — ' + (v.cliente || 'Sin cliente');
          return '<option value="' + esc(v.id) + '">' + esc(label) + '</option>';
        }).join('');
    }

    /* La contraseña de una credencial vinculada: se borra sola del portapapeles al minuto. */
    copy(btn, text){ return copySecret(btn, text); }
  }

  function noteHtml(d){
    const n = d.data() || {};
    const text = n._undecryptable ? Workhub.t('No se puede descifrar') : (n.text ? (n.kind === 'activity' ? Workhub.t(n.text) : n.text) : '');
    const actor = n.actorName ? '<span translate="no">' + esc(n.actorName) + '</span> · ' : '';
    return '<div class="note-item" data-id="' + esc(d.id) + '">' +
      (n.kind === 'activity' ? '' : '<button type="button" class="note-del" data-action="delnote" data-id="' + esc(d.id) + '">Eliminar</button>') +
      '<div class="note-date">' + actor + esc(fmtDateTime(n.createdAt)) + '</div>' +
      (text ? '<div class="note-text' + (n._undecryptable || n.kind === 'activity' ? (n._undecryptable ? ' is-undecryptable' : '') + '" translate="no">' + esc(text) : ' md" translate="no">' + md.render(text, {tasks:Workhub.views.team.canEdit() ? 'interactive' : 'static'})) + '</div>' : '') +
      attachments.html(n) +
      '</div>';
  }

  Workhub.views.TaskDialogView = TaskDialogView;
})();
