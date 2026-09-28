/* Clientes: alta, renombrado en línea y borrado con confirmación en dos pasos. */
(function(){
  const {esc, closest} = Workhub.utils.html;
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
        if(name) handler(name);
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

    resetNewForm(){ this.formNew.reset(); }

    showError(msg){
      this.stateMsg.hidden = false;
      this.stateMsg.textContent = msg;
    }

    setDeleting(btn){
      btn.disabled = true;
      btn.textContent = 'Eliminando…';
    }

    /* state: {editingId, pendingDeleteId, taskCount(name)} */
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
        const count = state.taskCount(c.nombre);
        const pending = state.pendingDeleteId === c.id;
        return '<div class="client-card" data-id="' + esc(c.id) + '">' +
          '<div><h3>' + esc(c.nombre) + '</h3><div class="meta">' + count + ' tarea' + (count === 1 ? '' : 's') + '</div></div>' +
          '<div class="client-card-actions">' +
          '<button type="button" class="icon-btn" data-action="edit-client" data-id="' + esc(c.id) + '">Editar</button>' +
          '<button type="button" class="btn ' + (pending ? 'btn-danger' : 'btn-ghost') + '" data-action="delete" data-id="' + esc(c.id) + '">' + (pending ? '¿Seguro? Eliminar' : 'Eliminar') + '</button>' +
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
