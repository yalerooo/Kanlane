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
      /* Qué clientes se enseñan en la lista: 'all', 'open' (con tareas abiertas) o 'late' (con vencidas). */
      this.filter = 'all';
      this.editing = false;
      this.pendingDelete = false;
      this.colorOpen = false;
      /* Texto del botón mientras se renombra o se elimina (con el avance si hay muchos documentos). */
      this.busy = '';

      [this.clients, this.tasks, this.contacts, this.vault, this.meetings].forEach((m) => m.on('change', () => this.render()));

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
      this.view.bindFilter((filter) => { this.filter = filter; this.render(); });
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
        openTask: (id) => this.app.controllers.tasks.openDetail(id),
        /* Tarea o reunión nuevas, ya con este cliente puesto. */
        newTask: () => {
          const name = this.selectedClientName();
          const tasks = this.app.controllers.tasks;
          tasks.openNew();
          if(name) tasks.dialog.setCliente(this.app.clientNames(), name);
        },
        newMeeting: () => {
          const cal = this.app.controllers.calendar;
          cal.view.openNewMeeting(this.app.clientNames(), this.selectedClientName() || '', Workhub.utils.dates.todayYmd());
        },
        openMeeting: (id) => this.app.controllers.calendar.openMeetingDetail(id),
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
          vaultCount: this.vault.items.filter((v) => v.cliente === client.nombre).length,
          /* Para la ficha: tareas sin terminar (por fecha) y las próximas reuniones, de lo que ya hay cargado. */
          openTasks: this.openTasks(client.nombre),
          meetings: this.upcomingMeetings(client.nombre)
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

    /* Tareas sin terminar del cliente: primero las que tienen fecha, de la más próxima a la más lejana. */
    openTasks(name){
      const TaskModel = Workhub.models.TaskModel;
      return this.tasks.items.filter((t) => t.cliente === name && !TaskModel.isDone(t))
        .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || TaskModel.byOrder(a, b));
    }

    /* Reuniones del cliente de hoy en adelante, la más próxima primero (como mucho cuatro). */
    upcomingMeetings(name){
      const today = Workhub.utils.dates.todayYmd();
      const MeetingModel = Workhub.models.MeetingModel;
      return this.meetings.items.filter((m) => m.cliente === name && m.date && m.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || MeetingModel.byStart(a, b)).slice(0, 4);
    }

    selectedClientName(){
      const c = this.clients.find(this.selectedId);
      return c ? c.nombre : undefined;
    }

    render(){
      const entries = this.entries();
      /* Si el elegido ya no está (borrado, o fuera de la búsqueda o del filtro), el primero. */
      const visible = this.view.visible(entries, this.filter);
      if(!visible.some((e) => e.id === this.selectedId)){
        this.selectedId = visible.length ? visible[0].id : null;
        this.editing = false;
        this.pendingDelete = false;
        this.colorOpen = false;
      }
      this.view.render(entries, {
        selectedId: this.selectedId,
        query: this.view.query(),
        filter: this.filter,
        editing: this.editing,
        pendingDelete: this.pendingDelete,
        colorOpen: this.colorOpen,
        busy: this.busy,
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
      if(!client || !this.clients.isReady() || this.busy) return;
      if(!newName || newName === client.nombre){
        this.editing = false;
        this.render();
        return;
      }
      if(this.clients.items.some((c) => c.id !== client.id && c.nombre === newName)){
        toast.error('Ya hay un cliente llamado «' + newName + '»');
        return;
      }
      this.setBusy('Guardando…');
      const progress = this.progress('Renombrando… {n} de {total}');
      this.clients.rename(client.id, newName, [this.tasks, this.meetings, this.contacts, this.vault], progress).then(() => {
        toast.success('Cliente renombrado');
      }).catch((err) => {
        toast.error(this.isPartial(err)
          ? Workhub.t('No se pudo cambiar el nombre en todas las tareas: {n} pendientes. Vuelve a renombrarlo para terminar.', {n:err.pending})
          : 'No se pudo renombrar el cliente. Inténtalo de nuevo.');
      }).finally(() => {
        this.editing = false;
        this.busy = '';
        this.render();
      });
    }

    setBusy(text){
      this.busy = text;
      this.render();
    }

    /* En un proyecto con cifrado total cada documento se vuelve a cifrar de uno en uno: con más de
       50 se enseña el avance en el botón. */
    progress(template){
      return (done, total) => {
        if(total <= 50) return;
        this.busy = Workhub.t(template, {n:done, total:total});
        this.view.setBusyText(this.busy);
      };
    }

    isPartial(err){
      return Workhub.models.ProjectCipher.isError(err, 'partial');
    }

    remove(btn){
      const client = this.clients.find(this.selectedId);
      if(!client || !this.clients.isReady() || !this.tasks.isReady() || this.busy) return;
      this.setBusy('Eliminando…');
      const name = client.nombre;
      const taskSnap = this.tasks.snapshot(this.tasks.items.filter((t) => t.cliente === name).map((t) => t.id));
      const clientSnap = this.clients.snapshot(client.id);
      this.clients.removeWithTasks(client.id, this.tasks, this.progress('Eliminando… {n} de {total}')).then(() => {
        toast.undoable('Cliente «' + name + '» eliminado', () => this.clients.restore(clientSnap).then(() => this.tasks.restore(taskSnap)), 'Cliente «' + name + '» restaurado');
      }).catch((err) => {
        if(this.isPartial(err)){
          /* Parte de las tareas ya se borró: se pueden recuperar. El cliente sigue ahí. */
          toast.undoable(Workhub.t('No se pudieron eliminar todas las tareas del cliente: {n} pendientes.', {n:err.pending}),
            () => this.tasks.restore(taskSnap), 'Tareas restauradas');
          return;
        }
        toast.error('No se pudo eliminar el cliente. Inténtalo de nuevo.');
      }).finally(() => {
        this.pendingDelete = false;
        this.busy = '';
        this.render();
      });
    }
  }

  Workhub.controllers.ClientsController = ClientsController;
})();
