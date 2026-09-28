/* Gestión de clientes. */
(function(){
  const DELETE_CONFIRM_MS = 4000;

  class ClientsController {
    constructor(app, view){
      this.app = app;
      this.clients = app.models.clients;
      this.tasks = app.models.tasks;
      this.meetings = app.models.meetings;
      this.view = view;

      this.editingId = null;
      this.pendingDeleteId = null;
      this.pendingDeleteTimer = null;

      this.clients.on('change', () => this.render());
      this.tasks.on('change', () => this.render());

      this.view.bindCreate((name) => {
        const p = this.app.createClient(name);
        if(p) p.then(() => this.view.resetNewForm()).catch(() => {});
      });

      this.view.bindActions({
        edit: (id) => { this.editingId = id; this.render(); },
        cancel: () => { this.editingId = null; this.render(); },
        save: (id, name) => this.rename(id, name),
        remove: (id, btn) => this.remove(id, btn)
      });
    }

    render(){
      this.view.render(this.clients.sortedByName(), {
        editingId: this.editingId,
        pendingDeleteId: this.pendingDeleteId,
        taskCount: (name) => this.tasks.countByClient(name)
      });
    }

    rename(id, rawName){
      const newName = (rawName || '').trim();
      const client = this.clients.find(id);
      if(!client || !this.clients.isReady()) return;
      if(!newName || newName === client.nombre){
        this.editingId = null;
        this.render();
        return;
      }
      this.clients.rename(id, newName, this.tasks, this.meetings).then(() => {
        this.editingId = null;
        this.render();
      }).catch(() => {
        this.view.showError('No se pudo renombrar el cliente. Inténtalo de nuevo.');
        this.editingId = null;
        this.render();
      });
    }

    /* Primer clic: pide confirmación durante unos segundos. Segundo clic: elimina. */
    remove(id, btn){
      if(this.pendingDeleteId !== id){
        this.pendingDeleteId = id;
        clearTimeout(this.pendingDeleteTimer);
        this.pendingDeleteTimer = setTimeout(() => {
          this.pendingDeleteId = null;
          this.render();
        }, DELETE_CONFIRM_MS);
        this.render();
        return;
      }
      clearTimeout(this.pendingDeleteTimer);
      this.pendingDeleteId = null;
      if(!this.clients.find(id) || !this.clients.isReady() || !this.tasks.isReady()) return;
      this.view.setDeleting(btn);
      this.clients.removeWithTasks(id, this.tasks).then(() => this.render()).catch(() => {
        this.view.showError('No se pudo eliminar el cliente. Inténtalo de nuevo.');
        this.render();
      });
    }
  }

  Workhub.controllers.ClientsController = ClientsController;
})();
