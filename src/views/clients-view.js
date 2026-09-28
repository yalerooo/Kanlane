/* Clientes: alta, renombrado en línea y borrado con confirmación en dos pasos. */
(function(){
  const {esc, closest, hueFor, initials} = Workhub.utils.html;
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

    /* handlers: {edit(id), cancel(), save(id, name), remove(id, button)} */
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

    /* state: {editingId, pendingDeleteId, taskStats(name) → {total, open}} */
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
        return '<div class="client-card' + (pending ? ' is-pending-delete' : '') + '" data-id="' + esc(c.id) + '">' +
          '<span class="avatar is-square" style="--h:' + hueFor(c.nombre) + '" aria-hidden="true">' + esc(initials(c.nombre)) + '</span>' +
          '<div class="client-main"><h3>' + esc(c.nombre) + '</h3><div class="meta">' + meta + '</div></div>' +
          '<div class="client-card-actions">' +
          (pending
            ? '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' + esc(c.id) + '">¿Seguro? Eliminar</button>'
            : '<button type="button" class="icon-only" data-action="edit-client" data-id="' + esc(c.id) + '" aria-label="Editar ' + esc(c.nombre) + '" title="Editar">' + EDIT_ICON + '</button>' +
              '<button type="button" class="icon-only is-danger" data-action="delete" data-id="' + esc(c.id) + '" aria-label="Eliminar ' + esc(c.nombre) + '" title="Eliminar">' + TRASH_ICON + '</button>') +
          '</div></div>';
      }).join('');
      if(state.editingId){
        const input = this.grid.querySelector('[data-edit-input="' + state.editingId + '"]');
        if(input){ input.focus(); input.select(); }
      }
    }
  }

  Workhub.views.ClientsView = ClientsView;
})();
