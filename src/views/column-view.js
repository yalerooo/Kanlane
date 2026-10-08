/* Columnas del tablero: menú de la cabecera (editar, límite, ocultar, eliminar,
   mover), diálogo para editar una columna y diálogo de confirmación. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const PT = Workhub.models.ProjectTemplates;
  const $ = (id) => document.getElementById(id);
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');

  const svg = (d) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICONS = {
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    limit: svg('<path d="M4 6h16M4 12h10M4 18h6"/>'),
    hide: svg('<path d="M9.9 4.2A10 10 0 0 1 12 4c6 0 10 8 10 8a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s4 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    archive: svg('<path d="M3 4h18v5H3z"/><path d="M5 9v11h14V9"/><path d="M10 13h4"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
    sort: svg('<path d="M3 6h11M3 12h8M3 18h5M18 5v14M14.5 15.5 18 19l3.5-3.5"/>'),
    left: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
    right: svg('<path d="M5 12h14M12 5l7 7-7 7"/>')
  };

  class ColumnView {
    constructor(){
      /* Menú de la cabecera de columna. */
      this.menu = document.createElement('div');
      this.menu.className = 'dd-menu project-menu col-menu';
      this.menu.setAttribute('role', 'menu');
      if(supportsPopover) this.menu.setAttribute('popover', 'auto');
      else this.menu.hidden = true;
      document.body.appendChild(this.menu);
      this.menu.addEventListener('keydown', (ev) => this._menuKeys(ev));
      window.addEventListener('resize', () => this.closeMenu());
      this.trigger = null;
      this.status = null;

      /* Diálogo de edición. */
      this.dlg = $('dlgColumn');
      this.form = $('formColumn');
      this.nameInput = $('colName');
      this.colors = $('colColors');
      this.limitInput = $('colLimit');
      this.doneChk = $('colDone');
      this.error = $('colError');
      this.color = 'gray';
      this.editing = null;
      this.colors.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-color]');
        if(!b) return;
        this.color = b.getAttribute('data-color');
        this._renderColors();
      });
      $('btnCancelColumn').addEventListener('click', () => this.dlg.close());

      /* Confirmación. */
      this.confirmDlg = $('dlgConfirm');
      this.confirmOk = $('btnConfirmOk');
      this.confirmResolve = null;
      this.confirmOk.addEventListener('click', () => this._settle(true));
      this.confirmDlg.addEventListener('close', () => this._settle(false));
      $('btnConfirmCancel').addEventListener('click', () => this.confirmDlg.close());
    }

    /* ---------- Menú ---------- */

    /* handlers: {edit(status, field), hide, duplicate, archive, sort(status, by), archiveAll, removeAll, remove, move(status, dir)} */
    bindMenu(handlers){
      this.menu.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-act]');
        if(!b || b.disabled) return;
        const status = this.status;
        const act = b.getAttribute('data-act');
        this.closeMenu();
        if(act === 'edit') handlers.edit(status);
        else if(act === 'limit') handlers.edit(status, 'limit');
        else if(act === 'hide') handlers.hide(status);
        else if(act === 'duplicate') handlers.duplicate(status);
        else if(act === 'archive') handlers.archive(status);
        else if(act === 'sort') handlers.sort(status, b.getAttribute('data-by'));
        else if(act === 'archiveAll') handlers.archiveAll(status);
        else if(act === 'removeAll') handlers.removeAll(status);
        else if(act === 'remove') handlers.remove(status);
        else if(act === 'left') handlers.move(status, -1);
        else if(act === 'right') handlers.move(status, 1);
      });
    }

    /* info: {index, count, visible, tasks, canRemove, canArchive, archiveWhy, canDuplicate}
       archiveWhy: por qué no se puede archivar la columna (se enseña al pasar el ratón). */
    openMenu(btn, status, info){
      this.status = status;
      this.trigger = btn;
      const item = (act, icon, label, opts) => {
        const o = opts || {};
        return '<button type="button" class="dd-option' + (o.danger ? ' is-danger' : '') + '" role="menuitem" data-act="' + act + '"' + (o.by ? ' data-by="' + o.by + '"' : '') + (o.disabled ? ' disabled' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' +
          icon + '<span class="dd-text">' + label + '</span></button>';
      };
      this.menu.innerHTML =
        '<p class="project-menu-label">Columna</p>' +
        item('edit', ICONS.edit, 'Editar detalles') +
        item('limit', ICONS.limit, 'Establecer límite') +
        item('hide', ICONS.hide, 'Ocultar de la vista', {disabled: info.visible <= 1}) +
        item('duplicate', ICONS.copy, 'Duplicar columna', {disabled: !info.canDuplicate}) +
        item('archive', ICONS.archive, 'Archivar columna', {disabled: !info.canArchive, title: info.canArchive ? '' : info.archiveWhy}) +
        item('remove', ICONS.trash, 'Eliminar columna', {danger:true, disabled: !info.canRemove}) +
        '<div class="dd-sep"></div><p class="project-menu-label">Ordenar por</p>' +
        item('sort', ICONS.sort, 'Fecha límite', {by:'due', disabled: info.tasks < 2}) +
        item('sort', ICONS.sort, 'Título', {by:'title', disabled: info.tasks < 2}) +
        item('sort', ICONS.sort, 'Fecha de creación', {by:'created', disabled: info.tasks < 2}) +
        '<div class="dd-sep"></div><p class="project-menu-label">Tarjetas</p>' +
        item('archiveAll', ICONS.archive, 'Archivar todas', {disabled: !info.tasks}) +
        item('removeAll', ICONS.trash, 'Eliminar todas', {danger:true, disabled: !info.tasks}) +
        '<div class="dd-sep"></div><p class="project-menu-label">Posición</p>' +
        item('left', ICONS.left, 'Mover a la izquierda', {disabled: info.index === 0}) +
        item('right', ICONS.right, 'Mover a la derecha', {disabled: info.index === info.count - 1});
      if(supportsPopover) this.menu.showPopover();
      else this.menu.hidden = false;
      this._position(btn);
      btn.setAttribute('aria-expanded', 'true');
      const first = this.menu.querySelector('button:not(:disabled)');
      if(first) first.focus();
    }

    isMenuOpen(){
      return supportsPopover ? this.menu.matches(':popover-open') : !this.menu.hidden;
    }

    closeMenu(){
      if(this.trigger) this.trigger.setAttribute('aria-expanded', 'false');
      if(!this.isMenuOpen()) return;
      if(supportsPopover) this.menu.hidePopover();
      else this.menu.hidden = true;
    }

    _position(btn){
      const r = btn.getBoundingClientRect();
      const width = Math.min(232, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      const top = r.bottom + 6;
      Object.assign(this.menu.style, {
        left: left + 'px',
        top: top + 'px',
        width: width + 'px',
        maxHeight: Math.max(200, window.innerHeight - top - 12) + 'px'
      });
    }

    _menuKeys(ev){
      const items = Array.from(this.menu.querySelectorAll('button:not(:disabled)'));
      const i = items.indexOf(document.activeElement);
      if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
        ev.preventDefault();
        const next = ev.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      } else if(ev.key === 'Escape' || ev.key === 'Tab'){
        if(ev.key === 'Escape' && this.trigger){ ev.preventDefault(); this.trigger.focus(); }
        this.closeMenu();
      }
    }

    /* ---------- Editar columna ---------- */

    /* handler(status, {label, color, limit, done}) */
    bindSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const label = this.nameInput.value.trim();
        if(!label){ this.nameInput.focus(); return; }
        const raw = this.limitInput.value.trim();
        const limit = raw === '' ? 0 : Math.floor(+raw);
        if(raw !== '' && !(limit >= 1 && limit <= 999)){
          this.showError('El límite tiene que estar entre 1 y 999, o vacío si no quieres límite.');
          this.limitInput.focus();
          return;
        }
        handler(this.editing, {label:label, color:this.color, limit:limit, done:this.doneChk.checked});
      });
    }

    openEdit(stage, focusField){
      this.editing = stage.key;
      this.nameInput.value = stage.label;
      this.color = stage.color;
      this.limitInput.value = stage.limit ? String(stage.limit) : '';
      this.doneChk.checked = !!stage.done;
      this.error.hidden = true;
      this._renderColors();
      this.dlg.showModal();
      const el = focusField === 'limit' ? this.limitInput : this.nameInput;
      el.focus();
      el.select();
    }

    closeEdit(){
      if(this.dlg.open) this.dlg.close();
    }

    showError(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
    }

    _renderColors(){
      this.colors.innerHTML = PT.COLORS.map((c) => {
        const on = c.key === this.color;
        return '<button type="button" class="stage-color is-lg' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-color="' + c.key + '" style="--c:' + c.dot + '" title="' + esc(c.name) + '" aria-label="' + esc(c.name) + '"></button>';
      }).join('');
    }

    /* ---------- Confirmación ---------- */

    /* Devuelve una promesa con true si se confirma. warn (opcional): una consecuencia que conviene
       leer antes de aceptar; va en su propio párrafo. */
    confirm(title, text, label, warn){
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      $('confirmWarn').textContent = warn || '';
      $('confirmWarn').hidden = !warn;
      this.confirmOk.textContent = label;
      this._settle(false);
      return new Promise((resolve) => {
        this.confirmResolve = resolve;
        this.confirmDlg.showModal();
        $('btnConfirmCancel').focus();
      });
    }

    _settle(ok){
      const resolve = this.confirmResolve;
      this.confirmResolve = null;
      if(ok && this.confirmDlg.open) this.confirmDlg.close();
      if(resolve) resolve(ok);
    }
  }

  Workhub.views.ColumnView = ColumnView;
})();
