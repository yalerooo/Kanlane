/* Proyectos: selector de la barra lateral (botón + menú) y diálogo para crear,
   renombrar, cambiar el color o eliminar un proyecto. */
(function(){
  const {esc, closest, initials} = Workhub.utils.html;
  const PT = Workhub.models.ProjectTemplates;
  const $ = (id) => document.getElementById(id);
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');

  const CHECK = '<svg class="dd-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ARROW_UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const ARROW_DOWN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
  const TRASH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  /* Cuadrado con las iniciales en el color del proyecto. */
  function markHtml(project, hue, cls){
    return '<span class="project-mark' + (cls ? ' ' + cls : '') + '" style="--h:' + hue + '" aria-hidden="true">' + esc(initials(project.nombre)) + '</span>';
  }

  class ProjectView {
    constructor(){
      this.trigger = $('btnProject');
      this.mark = $('projectMark');
      this.name = $('projectName');
      this.menu = $('projectMenu');
      if(supportsPopover){
        this.menu.setAttribute('popover', 'auto');
        this.menu.hidden = false;
      }

      this.dlg = $('dlgProject');
      this.form = $('formProject');
      this.title = $('dlgProjectTitle');
      this.idInput = $('pId');
      this.nameInput = $('pNombre');
      this.colors = $('pColors');
      this.btnSave = $('btnSaveProject');
      this.btnDelete = $('btnDeleteProject');
      this.btnCancel = $('btnCancelProject');
      this.deleteNote = $('pDeleteNote');
      this.error = $('pError');
      this.typesEl = $('pTypes');
      this.customEl = $('pCustom');
      this.stagesEl = $('pStages');
      this.addStageBtn = $('pAddStage');
      this.clientsChk = $('pClients');
      this.typeNote = $('pTypeNote');

      this.tipo = PT.DEFAULT_TYPE;
      this.stages = [];
      this.clients = false;
      this.color = null;
      this.pendingDelete = false;

      this.trigger.addEventListener('click', () => this.toggleMenu());
      this.menu.addEventListener('keydown', (ev) => this._menuKeys(ev));
      if(supportsPopover){
        this.menu.addEventListener('toggle', (ev) => {
          this.trigger.setAttribute('aria-expanded', ev.newState === 'open' ? 'true' : 'false');
        });
      } else {
        document.addEventListener('mousedown', (ev) => {
          if(this.isMenuOpen() && !this.menu.contains(ev.target) && !this.trigger.contains(ev.target)) this.closeMenu();
        });
        document.addEventListener('keydown', (ev) => {
          if(ev.key === 'Escape' && this.isMenuOpen()){ this.closeMenu(); this.trigger.focus(); }
        });
      }
      window.addEventListener('resize', () => { if(this.isMenuOpen()) this.closeMenu(); });

      this.colors.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-hue]');
        if(!b) return;
        const hue = b.getAttribute('data-hue');
        this.color = hue === '' ? null : +hue;
        this._renderColors();
      });
      this.nameInput.addEventListener('input', () => {
        if(this.color === null) this._renderColors();
        this.error.hidden = true;
      });
      this.typesEl.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-type]');
        if(b) this._pickType(b.getAttribute('data-type'));
      });
      this.stagesEl.addEventListener('click', (ev) => this._stageClick(ev));
      this.stagesEl.addEventListener('input', (ev) => {
        const row = closest(ev.target, '.stage-row');
        if(!row || !ev.target.classList.contains('stage-name')) return;
        this.stages[+row.getAttribute('data-i')].label = ev.target.value;
        this.error.hidden = true;
      });
      this.stagesEl.addEventListener('change', (ev) => {
        const row = closest(ev.target, '.stage-row');
        if(!row || ev.target.name !== 'pDone') return;
        this.stages.forEach((st, i) => { st.done = i === +row.getAttribute('data-i'); });
      });
      this.addStageBtn.addEventListener('click', () => {
        if(this.stages.length >= PT.MAX_STAGES) return;
        this.stages.push({key:'e' + Date.now().toString(36) + this.stages.length, label:'', color:'gray', done:false});
        this._renderStages();
        const inputs = this.stagesEl.querySelectorAll('.stage-name');
        inputs[inputs.length - 1].focus();
      });
      this.clientsChk.addEventListener('change', () => { this.clients = this.clientsChk.checked; });
      this.btnCancel.addEventListener('click', () => this.closeDialog());
      this.dlg.addEventListener('close', () => this._resetDelete());
    }

    /* ---------- Botón de la barra lateral ---------- */

    renderCurrent(project, hue){
      this.mark.style.setProperty('--h', hue);
      this.mark.textContent = initials(project.nombre);
      this.name.textContent = project.nombre;
      this.trigger.setAttribute('title', 'Proyecto: ' + project.nombre);
    }

    /* ---------- Menú ---------- */

    /* handlers: {pick(id), edit(id), create()} */
    bindMenu(handlers){
      this.menu.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-menu]');
        if(!b) return;
        const id = b.getAttribute('data-id');
        this.closeMenu();
        switch(b.getAttribute('data-menu')){
          case 'pick': handlers.pick(id); break;
          case 'edit': handlers.edit(id); break;
          case 'new': handlers.create(); break;
        }
      });
    }

    /* Se llama antes de abrir el menú para pintarlo con los datos del momento. */
    bindMenuSource(fn){
      this.menuSource = fn;
    }

    isMenuOpen(){
      return supportsPopover ? this.menu.matches(':popover-open') : !this.menu.hidden;
    }

    toggleMenu(){
      if(this.isMenuOpen()) this.closeMenu();
      else this.openMenu();
    }

    openMenu(){
      const data = this.menuSource ? this.menuSource() : {projects:[], currentId:null, hueOf:() => 0};
      this.renderMenu(data.projects, data.currentId, data.hueOf);
      if(supportsPopover) this.menu.showPopover();
      else { this.menu.hidden = false; this.trigger.setAttribute('aria-expanded', 'true'); }
      this._position();
      const current = this.menu.querySelector('[data-menu="pick"][aria-checked="true"]') || this.menu.querySelector('button');
      if(current) current.focus();
    }

    closeMenu(){
      if(!this.isMenuOpen()) return;
      if(supportsPopover) this.menu.hidePopover();
      else { this.menu.hidden = true; this.trigger.setAttribute('aria-expanded', 'false'); }
    }

    renderMenu(projects, currentId, hueOf){
      this.menu.innerHTML = '<p class="project-menu-label">Proyectos</p>' +
        '<div class="project-menu-list">' +
        projects.map((p) => {
          const current = p.id === currentId;
          return '<div class="project-row' + (current ? ' is-current' : '') + '">' +
            '<button type="button" class="dd-option project-pick' + (current ? ' is-selected' : '') + '" role="menuitemradio" aria-checked="' + current + '" data-menu="pick" data-id="' + esc(p.id) + '">' +
              markHtml(p, hueOf(p), 'is-sm') + '<span class="dd-text" translate="no">' + esc(p.nombre) + '</span>' + (current ? CHECK : '') +
            '</button>' +
            '<button type="button" class="icon-only project-edit" role="menuitem" data-menu="edit" data-id="' + esc(p.id) + '" aria-label="Editar ' + esc(p.nombre) + '" title="Editar proyecto">' + EDIT + '</button>' +
            '</div>';
        }).join('') +
        '</div><div class="dd-sep"></div>' +
        '<button type="button" class="dd-option is-action" role="menuitem" data-menu="new">' + PLUS + '<span class="dd-text">Nuevo proyecto</span></button>';
    }

    /* Debajo del botón; en móvil, pegado a su borde izquierdo y sin salirse. */
    _position(){
      const r = this.trigger.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 248), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = r.bottom + 6;
      Object.assign(this.menu.style, {
        left: left + 'px',
        top: top + 'px',
        width: width + 'px',
        maxHeight: Math.max(160, window.innerHeight - top - 12) + 'px'
      });
    }

    /* Flechas arriba/abajo entre las opciones; Escape vuelve al botón. */
    _menuKeys(ev){
      const items = Array.from(this.menu.querySelectorAll('button'));
      const i = items.indexOf(document.activeElement);
      if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
        ev.preventDefault();
        const next = ev.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      } else if(ev.key === 'Home' || ev.key === 'End'){
        ev.preventDefault();
        items[ev.key === 'Home' ? 0 : items.length - 1].focus();
      } else if(ev.key === 'Escape' || ev.key === 'Tab'){
        if(ev.key === 'Escape'){ ev.preventDefault(); this.trigger.focus(); }
        this.closeMenu();
      }
    }

    /* ---------- Diálogo ---------- */

    /* handler(id|null, nombre, color|null, config): config son los campos del tipo de proyecto. */
    bindSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const nombre = this.nameInput.value.trim();
        if(!nombre){ this.nameInput.focus(); return; }
        if(this.tipo === PT.CUSTOM_TYPE){
          const named = this.stages.filter((st) => st.label.trim());
          if(named.length < PT.MIN_STAGES){
            this.showError('Añade al menos ' + PT.MIN_STAGES + ' etapas con nombre.');
            return;
          }
          this.stages = named;
        }
        handler(this.idInput.value || null, nombre, this.color, PT.fieldsFor(this.tipo, this.stages, this.clients));
      });
    }

    /* Primer clic: avisa de lo que se va a borrar. Segundo: handler(id). */
    bindDelete(handler){
      this.btnDelete.addEventListener('click', () => {
        const id = this.idInput.value;
        if(!id) return;
        if(!this.pendingDelete){
          this.pendingDelete = true;
          this.deleteNote.hidden = false;
          this.btnDelete.textContent = 'Sí, eliminar todo';
          return;
        }
        handler(id);
      });
    }

    openNew(){
      this._open(null, '', null, PT.resolve(null));
      this.title.textContent = 'Nuevo proyecto';
      this.btnSave.textContent = 'Crear proyecto';
    }

    /* canDelete: false para el proyecto principal. cfg: ProjectTemplates.resolve(project). */
    openEdit(project, canDelete, cfg){
      this._open(project.id, project.nombre, typeof project.color === 'number' ? project.color : null, cfg);
      this.title.textContent = 'Editar proyecto';
      this.btnSave.textContent = 'Guardar';
      this.btnDelete.hidden = !canDelete;
    }

    _open(id, nombre, color, cfg){
      this.idInput.value = id || '';
      this.nameInput.value = nombre;
      this.color = color;
      this.tipo = cfg.tipo;
      this.stages = cfg.stages.map((st) => Object.assign({}, st));
      this.clients = cfg.clients;
      this.typeNote.hidden = !id;
      this._renderTypes();
      this._renderCustom();
      this.btnDelete.hidden = true;
      this.error.hidden = true;
      this._resetDelete();
      this.setBusy(false);
      this._renderColors();
      this.dlg.showModal();
      this.nameInput.focus();
      this.nameInput.select();
    }

    closeDialog(){
      if(this.dlg.open) this.dlg.close();
    }

    setBusy(busy, label){
      this.btnSave.disabled = busy;
      this.btnDelete.disabled = busy;
      if(busy && label) this.btnDelete.textContent = label;
    }

    showError(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
    }

    _resetDelete(){
      this.pendingDelete = false;
      this.deleteNote.hidden = true;
      this.btnDelete.textContent = 'Eliminar proyecto';
    }

    /* ---------- Tipo de proyecto ---------- */

    _pickType(tipo){
      if(tipo === this.tipo) return;
      /* Al pasar un proyecto que ya existe a "personalizado" se parte de sus
         etapas actuales; uno nuevo empieza con las de la plantilla. */
      if(tipo === PT.CUSTOM_TYPE && this.tipo !== PT.CUSTOM_TYPE){
        const from = this.idInput.value ? this.tipo : PT.CUSTOM_TYPE;
        this.stages = PT.stagesOf(from);
        this.clients = PT.template(from).clients;
      }
      this.tipo = tipo;
      this.error.hidden = true;
      this._renderTypes();
      this._renderCustom();
    }

    _renderTypes(){
      this.typesEl.innerHTML = PT.TEMPLATES.map((t) => {
        const on = t.key === this.tipo;
        const chips = t.key === PT.CUSTOM_TYPE
          ? '<span class="type-chip is-plain">Etapas y clientes a tu gusto</span>'
          : t.stages.map((st) => '<span class="type-chip"><i style="background:' + PT.colorOf(st.color).dot + '"></i>' + esc(st.label) + '</span>').join('') +
            '<span class="type-chip is-plain">' + (t.clients ? 'Con clientes' : 'Sin clientes') + '</span>';
        return '<button type="button" class="type-option' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-type="' + t.key + '">' +
          '<span class="type-radio" aria-hidden="true"></span>' +
          '<span class="type-body"><span class="type-name">' + esc(t.name) + '</span>' +
          '<span class="type-desc">' + esc(t.desc) + '</span>' +
          '<span class="type-chips">' + chips + '</span></span></button>';
      }).join('');
    }

    _renderCustom(){
      const custom = this.tipo === PT.CUSTOM_TYPE;
      this.customEl.hidden = !custom;
      if(!custom) return;
      this.clientsChk.checked = this.clients;
      this._renderStages();
    }

    _renderStages(){
      const n = this.stages.length;
      this.stagesEl.innerHTML = this.stages.map((st, i) => {
        const c = PT.colorOf(st.color);
        return '<div class="stage-row" data-i="' + i + '">' +
          '<button type="button" class="stage-color" data-act="color" style="--c:' + c.dot + '" title="Color: ' + esc(c.name) + '" aria-label="Cambiar color (' + esc(c.name) + ')"></button>' +
          '<input class="stage-name" maxlength="40" value="' + esc(st.label) + '" placeholder="Nombre de la etapa" aria-label="Nombre de la etapa ' + (i + 1) + '" autocomplete="off" translate="no">' +
          '<label class="stage-done" title="Las tareas de esta etapa cuentan como terminadas"><input type="radio" name="pDone"' + (st.done ? ' checked' : '') + ' aria-label="Etapa final (tareas terminadas)"><span>Final</span></label>' +
          '<button type="button" class="icon-only stage-btn" data-act="up"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir etapa" title="Subir">' + ARROW_UP + '</button>' +
          '<button type="button" class="icon-only stage-btn" data-act="down"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Bajar etapa" title="Bajar">' + ARROW_DOWN + '</button>' +
          '<button type="button" class="icon-only stage-btn" data-act="del"' + (n <= PT.MIN_STAGES ? ' disabled' : '') + ' aria-label="Quitar etapa" title="Quitar">' + TRASH + '</button>' +
          '</div>';
      }).join('');
      this.addStageBtn.disabled = n >= PT.MAX_STAGES;
    }

    _stageClick(ev){
      const b = closest(ev.target, 'button[data-act]');
      const row = closest(ev.target, '.stage-row');
      if(!b || !row) return;
      const i = +row.getAttribute('data-i');
      const act = b.getAttribute('data-act');
      if(act === 'color'){
        const at = PT.COLORS.findIndex((c) => c.key === this.stages[i].color);
        this.stages[i].color = PT.COLORS[(at + 1) % PT.COLORS.length].key;
      } else if(act === 'up' && i > 0){
        this.stages.splice(i - 1, 0, this.stages.splice(i, 1)[0]);
      } else if(act === 'down' && i < this.stages.length - 1){
        this.stages.splice(i + 1, 0, this.stages.splice(i, 1)[0]);
      } else if(act === 'del' && this.stages.length > PT.MIN_STAGES){
        const removed = this.stages.splice(i, 1)[0];
        if(removed.done) this.stages[this.stages.length - 1].done = true;
      }
      this._renderStages();
    }

    _renderColors(){
      const colors = Workhub.models.ClientModel.COLORS;
      const auto = Workhub.utils.html.hueFor(this.nameInput.value.trim());
      const swatch = (hue, label, selected, extra) =>
        '<button type="button" class="color-swatch' + (extra || '') + (selected ? ' is-selected' : '') + '" role="radio" aria-checked="' + selected + '" data-hue="' + (hue === null ? '' : hue) + '" style="--h:' + (hue === null ? auto : hue) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + (selected ? CHECK_SMALL : '') + '</button>';
      this.colors.innerHTML = swatch(null, 'Automático', this.color === null, ' is-auto') +
        '<span class="color-sep" aria-hidden="true"></span>' +
        colors.map((c) => swatch(c.hue, c.name, this.color === c.hue)).join('');
    }
  }

  ProjectView.markHtml = markHtml;
  Workhub.views.ProjectView = ProjectView;
})();
