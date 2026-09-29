/* Proyectos: selector de la barra lateral (botón + menú) y diálogo para crear,
   renombrar, cambiar el color o eliminar un proyecto. */
(function(){
  const {esc, closest, initials} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');

  const CHECK = '<svg class="dd-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
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

    /* handler(id|null, nombre, color|null) */
    bindSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const nombre = this.nameInput.value.trim();
        if(!nombre){ this.nameInput.focus(); return; }
        handler(this.idInput.value || null, nombre, this.color);
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
      this._open(null, '', null);
      this.title.textContent = 'Nuevo proyecto';
      this.btnSave.textContent = 'Crear proyecto';
    }

    /* canDelete: false para el proyecto principal. */
    openEdit(project, canDelete){
      this._open(project.id, project.nombre, typeof project.color === 'number' ? project.color : null);
      this.title.textContent = 'Editar proyecto';
      this.btnSave.textContent = 'Guardar';
      this.btnDelete.hidden = !canDelete;
    }

    _open(id, nombre, color){
      this.idInput.value = id || '';
      this.nameInput.value = nombre;
      this.color = color;
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
