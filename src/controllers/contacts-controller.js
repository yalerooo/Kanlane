/* Personas de contacto: verlas, añadirlas, editarlas y borrarlas (diálogos). Se listan en el
   perfil de cada cliente: ver clients-controller.js. */
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
      /* De ver a editar: se cierra la ficha y se abre el formulario con ese contacto. */
      this.view.bindDetailEdit((id) => { this.view.closeDetail(); this.openEdit(id); });
      /* Si el contacto que se está viendo cambia (o se borra), la ficha se pone al día. */
      this.contacts.on('change', () => {
        if(!this.view.viewDlg.open) return;
        const c = this.contacts.find(this.view.viewDlg.getAttribute('data-id'));
        if(c) this.view.openDetail(c, this.hueOf(c));
        else this.view.closeDetail();
      });
      this.view.cliente.bindCreate((name) => app.createClient(name));
    }

    openNew(presetCliente){
      this.view.openNew(this.app.clientNames(), presetCliente || this.contacts.lastClient());
    }

    /* La ficha de un contacto: a quién escribir o llamar, sus datos y sus notas. */
    openDetail(id){
      const c = this.contacts.find(id);
      if(c) this.view.openDetail(c, this.hueOf(c));
    }

    /* El color de su cliente, o null si no tiene (o ya no existe). */
    hueOf(c){
      const clients = this.app.models.clients;
      return c.cliente && clients.items.some((x) => x.nombre === c.cliente) ? clients.hueOf(c.cliente) : null;
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
