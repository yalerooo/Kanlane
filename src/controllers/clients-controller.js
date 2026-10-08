/* Clientes y contactos: la portada con una tarjeta por cliente, el perfil de cada uno (a página
   completa, con pestañas) y la búsqueda conjunta (cliente, nombre, email, teléfono, notas). */
(function(){
  const toast = Workhub.views.toast;
  /* Entrada de la portada para los contactos cuyo cliente ya no existe. */
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

      /* Cliente cuyo perfil está abierto (null: la portada) y la pestaña que se ve. */
      this.openId = null;
      this.tab = 'overview';
      /* Qué clientes se enseñan en la portada: 'all', 'open' (con tareas abiertas) o 'late' (con vencidas). */
      this.filter = 'all';
      /* Cliente que se está editando en el diálogo (null si el diálogo es de «nuevo»). */
      this.editingId = null;
      this.busy = false;

      [this.clients, this.tasks, this.contacts, this.vault, this.meetings].forEach((m) => m.on('change', () => this.render()));

      this.view.bindSearch(() => this.render());
      this.view.bindFilter((filter) => { this.filter = filter; this.render(); });
      this.view.bindNewContact(() => this.app.controllers.contacts.openNew(this.selectedClientName()));
      this.view.bindNewClient(() => this.openNew());
      this.view.bindOpen((id) => this.select(id, true), () => this.openNew());
      this.view.bindDialog({
        save: (name, hue) => this.saveDialog(name, hue),
        remove: () => this.remove()
      });

      this.view.bindActions({
        back: () => { this.openId = null; this.render(); },
        tab: (id) => { this.tab = id; this.render(); },
        edit: () => this.openEdit(),
        addContact: () => this.app.controllers.contacts.openNew(this.selectedClientName()),
        openContact: (id) => this.app.controllers.contacts.openDetail(id),
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
        openMeeting: (id) => this.app.controllers.calendar.openMeetingDetail(id)
      });
    }

    /* ---------- Datos ---------- */

    /* Clientes (y, si los hay, contactos sin cliente). Con q, solo los que encajan con la búsqueda. */
    entries(q){
      const has = (c) => ['nombre', 'email', 'telefono', 'notas'].some((f) => String(c[f] || '').toLowerCase().indexOf(q) !== -1);
      const byName = (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es');
      const byClient = {};
      this.contacts.items.forEach((c) => { (byClient[c.cliente || ''] = byClient[c.cliente || ''] || []).push(c); });

      const list = this.clients.sortedByName().map((client) => {
        const contacts = (byClient[client.nombre] || []).slice().sort(byName);
        delete byClient[client.nombre];
        const meetings = this.meetingsOf(client.nombre);
        return {
          id: client.id,
          nombre: client.nombre,
          client: client,
          contacts: contacts,
          stats: this.tasks.statsByClient(client.nombre),
          vaultCount: this.vault.items.filter((v) => v.cliente === client.nombre).length,
          /* Tareas sin terminar (por fecha) y reuniones (próximas y anteriores), de lo que ya hay cargado. */
          openTasks: this.openTasks(client.nombre),
          meetings: meetings.upcoming,
          past: meetings.past
        };
      });
      const orphans = Object.keys(byClient).reduce((all, k) => all.concat(byClient[k]), []).sort(byName);
      if(orphans.length){
        list.push({id:ORPHANS_ID, nombre:'Sin cliente', client:null, contacts:orphans, stats:{total:0, open:0}, vaultCount:0, openTasks:[], meetings:[], past:[]});
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

    /* Reuniones del cliente: las de hoy en adelante (la más próxima primero) y las ocho últimas
       ya pasadas (la más reciente primero). */
    meetingsOf(name){
      const today = Workhub.utils.dates.todayYmd();
      const MeetingModel = Workhub.models.MeetingModel;
      const mine = this.meetings.items.filter((m) => m.cliente === name && m.date);
      const asc = (a, b) => a.date.localeCompare(b.date) || MeetingModel.byStart(a, b);
      return {
        upcoming: mine.filter((m) => m.date >= today).sort(asc),
        past: mine.filter((m) => m.date < today).sort((a, b) => asc(b, a)).slice(0, 8)
      };
    }

    selectedClientName(){
      const c = this.clients.find(this.openId);
      return c ? c.nombre : undefined;
    }

    render(){
      const q = this.view.query();
      const all = this.entries('');
      /* Un cliente recién creado se abre en cuanto aparece en la lista (el aviso de que se ha
         guardado puede llegar antes que el propio cliente). */
      if(this.pendingOpen && all.some((e) => e.id === this.pendingOpen)){
        this.openId = this.pendingOpen;
        this.tab = 'overview';
        this.pendingOpen = null;
      }
      /* El perfil abierto no depende de la búsqueda: solo se cierra si el cliente ya no existe. */
      const open = this.openId ? (all.find((e) => e.id === this.openId) || null) : null;
      if(this.openId && !open) this.openId = null;
      this.view.render(q ? this.entries(q) : all, {
        query: q,
        filter: this.filter,
        open: open,
        tab: this.tab,
        hasAny: this.clients.items.length > 0 || this.contacts.items.length > 0
      });
    }

    /* Abre el perfil de un cliente (también desde la paleta de comandos). */
    select(id){
      if(id !== this.openId){
        this.openId = id;
        this.tab = 'overview';
      }
      this.render();
    }

    /* Abre el perfil del cliente de ese contacto, en su pestaña de contactos, y su ficha
       (desde la paleta de comandos o los vínculos de una tarea). */
    showContact(contactId){
      const c = this.contacts.find(contactId);
      this.app.navigate('clients');
      if(!c) return;
      const client = this.clients.items.find((x) => x.nombre === c.cliente);
      this.openId = client ? client.id : ORPHANS_ID;
      this.tab = 'contacts';
      this.render();
      this.app.controllers.contacts.openDetail(contactId);
    }

    viewVault(name){
      this.app.navigate('vault');
      const select = document.getElementById('filterClienteVault');
      if(!select || !name) return;
      select.value = name;
      select.dispatchEvent(new Event('change', {bubbles:true}));
    }

    /* ---------- Diálogo de cliente ---------- */

    openNew(){
      this.editingId = null;
      this.view.openDialog({mode:'new', name:'', hue:null, colors:Workhub.models.ClientModel.COLORS});
    }

    openEdit(){
      const client = this.clients.find(this.openId);
      if(!client) return;
      this.editingId = client.id;
      this.view.openDialog({
        mode: 'edit',
        name: client.nombre,
        hue: typeof client.color === 'number' ? client.color : null,
        colors: Workhub.models.ClientModel.COLORS,
        tasks: this.tasks.statsByClient(client.nombre).total
      });
    }

    saveDialog(name, hue){
      if(this.busy || !this.clients.isReady()) return;
      if(this.editingId) this.saveEdit(name, hue);
      else this.create(name, hue);
    }

    create(name, hue){
      if(this.clients.items.some((c) => c.nombre === name)){
        toast.error('Ya hay un cliente llamado «' + name + '»');
        return;
      }
      const p = this.app.createClient(name);
      if(!p) return;
      this.setBusy('Creando…');
      p.then((ref) => {
        const id = ref && ref.id;
        const colored = id && hue !== null ? this.clients.setColor(id, hue).catch(() => {}) : Promise.resolve();
        return colored.then(() => {
          toast.success('Cliente «' + name + '» añadido');
          this.view.closeDialog();
          if(id){ this.pendingOpen = id; this.render(); }
        });
      }).catch(() => {
        toast.error('No se pudo añadir el cliente');
      }).finally(() => this.setBusy(''));
    }

    /* Guarda el color y, si ha cambiado, el nombre (que hay que cambiar también en sus tareas,
       reuniones, contactos y contraseñas). */
    saveEdit(newName, hue){
      const client = this.clients.find(this.editingId);
      if(!client) return;
      if(newName !== client.nombre && this.clients.items.some((c) => c.id !== client.id && c.nombre === newName)){
        toast.error('Ya hay un cliente llamado «' + newName + '»');
        return;
      }
      const current = typeof client.color === 'number' ? client.color : null;
      const colored = hue !== current ? this.clients.setColor(client.id, hue).catch(() => {}) : Promise.resolve();
      if(newName === client.nombre){
        colored.then(() => this.view.closeDialog());
        return;
      }
      this.setBusy('Guardando…');
      const progress = this.progress('Renombrando… {n} de {total}');
      colored.then(() => this.clients.rename(client.id, newName, [this.tasks, this.meetings, this.contacts, this.vault], progress)).then(() => {
        toast.success('Cliente renombrado');
      }).catch((err) => {
        toast.error(this.isPartial(err)
          ? Workhub.t('No se pudo cambiar el nombre en todas las tareas: {n} pendientes. Vuelve a renombrarlo para terminar.', {n:err.pending})
          : 'No se pudo renombrar el cliente. Inténtalo de nuevo.');
      }).finally(() => {
        this.setBusy('');
        this.view.closeDialog();
        this.render();
      });
    }

    setBusy(text){
      this.busy = !!text;
      this.view.setDialogBusy(text ? Workhub.t(text) : '');
    }

    /* En un proyecto con cifrado total cada documento se vuelve a cifrar de uno en uno: con más de
       50 se enseña el avance en el botón. */
    progress(template){
      return (done, total) => {
        if(total <= 50) return;
        this.view.setDialogBusy(Workhub.t(template, {n:done, total:total}));
      };
    }

    isPartial(err){
      return Workhub.models.ProjectCipher.isError(err, 'partial');
    }

    remove(){
      const client = this.clients.find(this.editingId);
      if(!client || !this.clients.isReady() || !this.tasks.isReady() || this.busy) return;
      this.setBusy('Eliminando…');
      const name = client.nombre;
      const taskSnap = this.tasks.snapshot(this.tasks.everything().filter((t) => t.cliente === name).map((t) => t.id));
      const clientSnap = this.clients.snapshot(client.id);
      this.clients.removeWithTasks(client.id, this.tasks, this.progress('Eliminando… {n} de {total}')).then(() => {
        toast.undoable('Cliente «' + name + '» eliminado', () => this.clients.restore(clientSnap).then(() => this.tasks.restore(taskSnap)), 'Cliente «' + name + '» restaurado');
        /* Vuelve a la portada: ese perfil ya no existe. */
        this.openId = null;
      }).catch((err) => {
        if(this.isPartial(err)){
          /* Parte de las tareas ya se borró: se pueden recuperar. El cliente sigue ahí. */
          toast.undoable(Workhub.t('No se pudieron eliminar todas las tareas del cliente: {n} pendientes.', {n:err.pending}),
            () => this.tasks.restore(taskSnap), 'Tareas restauradas');
          return;
        }
        toast.error('No se pudo eliminar el cliente. Inténtalo de nuevo.');
      }).finally(() => {
        this.setBusy('');
        this.view.closeDialog();
        this.render();
      });
    }
  }

  Workhub.controllers.ClientsController = ClientsController;
})();
