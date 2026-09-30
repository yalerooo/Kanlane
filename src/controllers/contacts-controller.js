/* Alta, edición y borrado de personas de contacto (diálogo). Se listan en la
   ficha de cada cliente: ver clients-controller.js. */
(function(){
  const toast = Workhub.views.toast;
  class ContactsController {
    constructor(app, view){
      this.app = app;
      this.contacts = app.models.contacts;
      this.view = view;

      this.contacts.on('error', (err) => {
        toast.error('No se pudieron cargar los contactos (' + (err && err.code || 'error') + ')');
      });
      app.models.clients.on('change', () => this.view.cliente.populate(app.clientNames()));

      this.view.bindSubmit((id, values) => this.save(id, values));
      this.view.bindDelete((id) => this.remove(id));
      this.view.cliente.bindCreate((name) => app.createClient(name));
    }

    openNew(presetCliente){
      this.view.openNew(this.app.clientNames(), presetCliente || this.contacts.lastClient());
    }

    openEdit(id){
      const c = this.contacts.find(id);
      if(c) this.view.openEdit(c, this.app.clientNames());
    }

    save(id, values){
      if(!this.contacts.isReady()){ this.view.close(); return; }
      if(!values.cliente) return;
      this.contacts.save(id, values).then(() => {
        toast.success(id ? 'Contacto actualizado' : 'Contacto añadido');
        this.view.close();
      }, () => {
        toast.error('No se pudo guardar el contacto');
        this.view.close();
      });
    }

    remove(id){
      if(!id || !this.contacts.isReady()) return;
      const snap = this.contacts.snapshot(id);
      this.contacts.remove(id).then(() => {
        toast.undoable('Contacto eliminado', () => this.contacts.restore(snap), 'Contacto restaurado');
        this.view.close();
      }, () => {
        toast.error('No se pudo eliminar el contacto');
        this.view.close();
      });
    }
  }

  Workhub.controllers.ContactsController = ContactsController;
})();
