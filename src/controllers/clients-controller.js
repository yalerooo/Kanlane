/* Clientes y contactos: lista de clientes, ficha de cada uno con sus personas
   de contacto y búsqueda conjunta (cliente, nombre, email, teléfono, notas). */
(function(){
  const toast = Workhub.views.toast;
  /* Entrada de la lista para los contactos cuyo cliente ya no existe. */
  const ORPHANS_ID = '__sin_cliente__';

  class ClientsController {
    constructor(app, view){
      this.app = app;
      this.clients = app.models.clients;
      this.tasks = app.models.tasks;
      this.meetings = app.models.meetings;
      this.contacts = app.models.contacts;
      this.vault = app.models.vault;
      this.view = view;

      this.selectedId = null;
      this.editing = false;
      this.pendingDelete = false;
      this.colorOpen = false;

      [this.clients, this.tasks, this.contacts, this.vault].forEach((m) => m.on('change', () => this.render()));

      this.view.bindCreate((name) => {
        const p = this.app.createClient(name);
        if(p) p.then((ref) => {
          toast.success('Cliente «' + name + '» añadido');
          if(ref && ref.id) this.select(ref.id, true);
        }).catch(() => {
          toast.error('No se pudo añadir el cliente');
          this.view.restoreNewName(name);
        });
        else this.view.restoreNewName(name);
      });
      this.view.bindSearch(() => this.render());
      this.view.bindNewContact(() => this.app.controllers.contacts.openNew(this.selectedClientName()));
      this.view.bindSelect((id, openPane) => this.select(id, openPane));

      this.view.bindActions({
        edit: () => { this.editing = true; this.colorOpen = false; this.pendingDelete = false; this.render(); },
        cancel: () => { this.editing = false; this.render(); },
        save: (name) => this.rename(name),
        remove: () => { this.pendingDelete = true; this.colorOpen = false; this.render(); },
        cancelRemove: () => { this.pendingDelete = false; this.render(); },
        confirmRemove: (btn) => this.remove(btn),
        toggleColor: () => { this.colorOpen = !this.colorOpen; this.pendingDelete = false; this.render(); },
        color: (hue) => {
          const id = this.selectedId;
          if(this.clients.isReady() && this.clients.find(id)) this.clients.setColor(id, hue).catch(() => {});
        },
        addContact: () => this.app.controllers.contacts.openNew(this.selectedClientName()),
        openContact: (id) => this.app.controllers.contacts.openEdit(id),
        viewTasks: () => this.app.controllers.command.showClientTasks(this.selectedClientName()),
        viewVault: () => this.viewVault(this.selectedClientName()),
        back: () => { this.view.showDetailPane(false); this.view.focusSelected(); }
      });
    }

    /* ---------- Datos ---------- */

    /* Clientes (y, si los hay, contactos sin cliente) que encajan con la búsqueda. */
    entries(){
      const q = this.view.query();
      const has = (c) => ['nombre', 'email', 'telefono', 'notas'].some((f) => String(c[f] || '').toLowerCase().indexOf(q) !== -1);
      const byName = (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es');
      const byClient = {};
      this.contacts.items.forEach((c) => { (byClient[c.cliente || ''] = byClient[c.cliente || ''] || []).push(c); });

      const list = this.clients.sortedByName().map((client) => {
        const contacts = (byClient[client.nombre] || []).slice().sort(byName);
        delete byClient[client.nombre];
        return {
          id: client.id,
          nombre: client.nombre,
          client: client,
          contacts: contacts,
          stats: this.tasks.statsByClient(client.nombre),
          vaultCount: this.vault.items.filter((v) => v.cliente === client.nombre).length
        };
      });
      const orphans = Object.keys(byClient).reduce((all, k) => all.concat(byClient[k]), []).sort(byName);
      if(orphans.length){
        list.push({id:ORPHANS_ID, nombre:'Sin cliente', client:null, contacts:orphans, stats:{total:0, open:0}, vaultCount:0});
      }
      if(!q) return list;
      return list.map((e) => {
        const nameMatch = !!e.client && e.nombre.toLowerCase().indexOf(q) !== -1;
        const matches = e.contacts.filter(has).length;
        return Object.assign({}, e, {nameMatch:nameMatch, matches:matches});
      }).filter((e) => e.nameMatch || e.matches);
    }

    selectedClientName(){
      const c = this.clients.find(this.selectedId);
      return c ? c.nombre : undefined;
    }

    render(){
      const entries = this.entries();
      /* Si el elegido ya no está (borrado, o fuera de la búsqueda), el primero. */
      if(!entries.some((e) => e.id === this.selectedId)){
        this.selectedId = entries.length ? entries[0].id : null;
        this.editing = false;
        this.pendingDelete = false;
        this.colorOpen = false;
      }
      this.view.render(entries, {
        selectedId: this.selectedId,
        query: this.view.query(),
        editing: this.editing,
        pendingDelete: this.pendingDelete,
        colorOpen: this.colorOpen,
        colors: Workhub.models.ClientModel.COLORS,
        hasAny: this.clients.items.length > 0 || this.contacts.items.length > 0
      });
    }

    select(id, openPane){
      if(id !== this.selectedId){
        this.selectedId = id;
        this.editing = false;
        this.pendingDelete = false;
        this.colorOpen = false;
        this.render();
      }
      if(openPane) this.view.showDetailPane(true);
    }

    /* Abre la ficha del cliente de ese contacto y su diálogo de edición
       (desde la paleta de comandos o los vínculos de una tarea). */
    showContact(contactId){
      const c = this.contacts.find(contactId);
      this.app.navigate('clients');
      if(!c) return;
      const client = this.clients.items.find((x) => x.nombre === c.cliente);
      this.select(client ? client.id : ORPHANS_ID, true);
      this.app.controllers.contacts.openEdit(contactId);
    }

    viewVault(name){
      this.app.navigate('vault');
      const select = document.getElementById('filterClienteVault');
      if(!select || !name) return;
      select.value = name;
      select.dispatchEvent(new Event('change', {bubbles:true}));
    }

    /* ---------- Acciones ---------- */

    rename(rawName){
      const newName = (rawName || '').trim();
      const client = this.clients.find(this.selectedId);
      if(!client || !this.clients.isReady()) return;
      if(!newName || newName === client.nombre){
        this.editing = false;
        this.render();
        return;
      }
      if(this.clients.items.some((c) => c.id !== client.id && c.nombre === newName)){
        toast.error('Ya hay un cliente llamado «' + newName + '»');
        return;
      }
      this.clients.rename(client.id, newName, [this.tasks, this.meetings, this.contacts, this.vault]).then(() => {
        toast.success('Cliente renombrado');
      }).catch(() => {
        toast.error('No se pudo renombrar el cliente. Inténtalo de nuevo.');
      }).finally(() => {
        this.editing = false;
        this.render();
      });
    }

    remove(btn){
      const client = this.clients.find(this.selectedId);
      if(!client || !this.clients.isReady() || !this.tasks.isReady()) return;
      this.view.setDeleting(btn);
      const name = client.nombre;
      this.clients.removeWithTasks(client.id, this.tasks).then(() => {
        toast.success('Cliente «' + name + '» eliminado');
      }).catch(() => {
        toast.error('No se pudo eliminar el cliente. Inténtalo de nuevo.');
      }).finally(() => {
        this.pendingDelete = false;
        this.render();
      });
    }
  }

  Workhub.controllers.ClientsController = ClientsController;
})();
