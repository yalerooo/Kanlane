/* Clientes: alta, renombrado en línea y borrado con confirmación en dos pasos. */
(function(){
  const {esc, closest, initials} = Workhub.utils.html;
  const clientColors = Workhub.views.clientColors;
  const COLOR_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3.5-4 3.5h-2.2a1.8 1.8 0 0 0-1.3 3.1A1.8 1.8 0 0 1 12 22Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1.2" fill="currentColor"/></svg>';
  const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const TRASH_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
  const $ = (id) => document.getElementById(id);

  class ClientsView {
    constructor(){
      this.grid = $('clientsGrid');
      this.stateMsg = $('stateMsgClients');
      this.formNew = $('formNewClient');
      this.newName = $('newClientName');
    }

    bindCreate(handler){
      this.formNew.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = this.newName.value.trim();
        if(!name) return;
        /* Se vacía ya, no al terminar de guardar: así no se pierde lo que
           se empiece a escribir mientras tanto. */
        this.newName.value = '';
        handler(name);
      });
    }

    /* handlers: {edit(id), cancel(), save(id, name), remove(id, button),
                 toggleColor(id), color(id, hue|null)} */
    bindActions(handlers){
      this.grid.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-action]');
        if(!btn) return;
        const id = btn.getAttribute('data-id');
        switch(btn.getAttribute('data-action')){
          case 'edit-client': handlers.edit(id); break;
          case 'cancel-client': handlers.cancel(); break;
          case 'save-client': handlers.save(id, this._editValue(id)); break;
          case 'delete': handlers.remove(id, btn); break;
          case 'toggle-color': handlers.toggleColor(id); break;
          case 'set-color': {
            const hue = btn.getAttribute('data-hue');
            handlers.color(id, hue === '' ? null : +hue);
            break;
          }
        }
      });
      this.grid.addEventListener('keydown', (ev) => {
        const input = ev.target;
        if(!input || !input.hasAttribute || !input.hasAttribute('data-edit-input')) return;
        if(ev.key === 'Enter'){
          ev.preventDefault();
          handlers.save(input.getAttribute('data-edit-input'), input.value);
        }
        if(ev.key === 'Escape') handlers.cancel();
      });
    }

    _editValue(id){
      const input = this.grid.querySelector('[data-edit-input="' + id + '"]');
      return input ? input.value : '';
    }

    /* Si no se pudo guardar, devuelve el nombre al campo (si sigue vacío). */
    restoreNewName(name){
      if(!this.newName.value) this.newName.value = name;
    }

    showError(msg){
      this.stateMsg.hidden = false;
      this.stateMsg.textContent = msg;
    }

    setDeleting(btn){
      btn.disabled = true;
      btn.textContent = 'Eliminando…';
    }

    /* state: {editingId, pendingDeleteId, colorOpenId, colors, taskStats(name) → {total, open}} */
    render(clients, state){
      if(!clients.length){
        this.grid.hidden = true;
        this.stateMsg.hidden = false;
        this.stateMsg.textContent = 'Sin clientes todavía. Añade el primero arriba.';
        return;
      }
      this.stateMsg.hidden = true;
      this.grid.hidden = false;
      this.grid.innerHTML = clients.map((c) => {
        if(state.editingId === c.id){
          return '<div class="client-card client-card-editing" data-id="' + esc(c.id) + '">' +
            '<div class="client-edit-row">' +
              '<input type="text" class="client-edit-input" data-edit-input="' + esc(c.id) + '" value="' + esc(c.nombre) + '" maxlength="60">' +
              '<button type="button" class="btn btn-primary" data-action="save-client" data-id="' + esc(c.id) + '">Guardar</button>' +
              '<button type="button" class="btn btn-ghost" data-action="cancel-client" data-id="' + esc(c.id) + '">Cancelar</button>' +
            '</div></div>';
        }
        const stats = state.taskStats(c.nombre);
        const pending = state.pendingDeleteId === c.id;
        const meta = stats.total
          ? stats.total + ' tarea' + (stats.total === 1 ? '' : 's') + (stats.open ? ' · ' + stats.open + ' abierta' + (stats.open === 1 ? '' : 's') : ' · todas completadas')
          : 'Sin tareas';
        const colorOpen = state.colorOpenId === c.id;
        const hue = clientColors.hueOf(c.nombre);
        return '<div class="client-card' + (pending ? ' is-pending-delete' : '') + (colorOpen ? ' is-color-open' : '') + '" data-id="' + esc(c.id) + '" style="--h:' + hue + '">' +
          '<div class="client-row">' +
          '<button type="button" class="avatar is-square avatar-btn" data-action="toggle-color" data-id="' + esc(c.id) + '" aria-label="Cambiar color de ' + esc(c.nombre) + '" aria-expanded="' + colorOpen + '" title="Cambiar color">' + esc(initials(c.nombre)) + '</button>' +
          '<div class="client-main"><h3>' + esc(c.nombre) + '</h3><div class="meta">' + meta + '</div></div>' +
          '<div class="client-card-actions">' +
          (pending
            ? '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' + esc(c.id) + '">¿Seguro? Eliminar</button>'
            : '<button type="button" class="icon-only' + (colorOpen ? ' is-active' : '') + '" data-action="toggle-color" data-id="' + esc(c.id) + '" aria-label="Color de ' + esc(c.nombre) + '" aria-expanded="' + colorOpen + '" title="Color">' + COLOR_ICON + '</button>' +
              '<button type="button" class="icon-only" data-action="edit-client" data-id="' + esc(c.id) + '" aria-label="Editar ' + esc(c.nombre) + '" title="Editar">' + EDIT_ICON + '</button>' +
              '<button type="button" class="icon-only is-danger" data-action="delete" data-id="' + esc(c.id) + '" aria-label="Eliminar ' + esc(c.nombre) + '" title="Eliminar">' + TRASH_ICON + '</button>') +
          '</div></div>' +
          (colorOpen ? colorPickerHtml(c, state.colors) : '') +
          '</div>';
      }).join('');
      if(state.editingId){
        const input = this.grid.querySelector('[data-edit-input="' + state.editingId + '"]');
        if(input){ input.focus(); input.select(); }
      }
    }
  }

  /* Muestras de color: "Auto" (derivado del nombre) y la paleta fija. */
  function colorPickerHtml(c, colors){
    const custom = typeof c.color === 'number';
    const auto = Workhub.utils.html.hueFor(c.nombre);
    const swatch = (hue, label, selected, extraCls) =>
      '<button type="button" class="color-swatch' + (extraCls || '') + (selected ? ' is-selected' : '') + '" role="radio" aria-checked="' + selected + '" data-action="set-color" data-id="' + esc(c.id) + '" data-hue="' + (hue === null ? '' : hue) + '" style="--h:' + (hue === null ? auto : hue) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + (selected ? CHECK_SMALL : '') + '</button>';
    return '<div class="color-picker" role="radiogroup" aria-label="Color de ' + esc(c.nombre) + '">' +
      swatch(null, 'Automático', !custom, ' is-auto') +
      '<span class="color-sep" aria-hidden="true"></span>' +
      colors.map((col) => swatch(col.hue, col.name, custom && c.color === col.hue)).join('') +
      '</div>';
  }

  Workhub.views.ClientsView = ClientsView;
})();
