/* Contactos de clientes. */
(function(){
  class ContactsController {
    constructor(app, view){
      this.app = app;
      this.contacts = app.models.contacts;
      this.view = view;

      this.contacts.on('change', () => this.render());
      this.contacts.on('error', (err) => {
        this.view.showError('No se pudieron cargar los contactos (' + (err && err.code || 'error') + ').');
      });
      app.models.clients.on('change', () => this.view.cliente.populate(app.clientNames()));

      this.view.bindNew(() => this.openNew());
      this.view.bindSearch(() => this.render());
      this.view.bindOpen((id) => this.openEdit(id));
      this.view.bindSubmit((id, values) => this.save(id, values));
      this.view.bindDelete((id) => this.remove(id));
      this.view.cliente.bindCreate((name) => app.createClient(name));
    }

    render(){
      this.view.render(this.contacts.search(this.view.query()), this.contacts.items.length > 0);
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
      this.contacts.save(id, values).then(() => this.view.close(), () => this.view.close());
    }

    remove(id){
      if(!id || !this.contacts.isReady()) return;
      this.contacts.remove(id).then(() => this.view.close(), () => this.view.close());
    }
  }

  Workhub.controllers.ContactsController = ContactsController;
})();
