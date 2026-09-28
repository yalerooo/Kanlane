/* Paleta de comandos y atajos de teclado globales:
   - Ctrl/⌘ K: abre o cierra la paleta (también el botón "Buscar…").
   - N: nueva tarea.   - /: buscar dentro de la sección actual. */
(function(){
  const TaskModel = Workhub.models.TaskModel;
  const MAX_PER_GROUP = 6;

  const svg = (d) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const ICONS = {
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    go: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    meeting: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    theme: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    download: svg('<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>')
  };
  const clientIcon = (hue) => '<span class="dot" style="border-radius:2px;background:hsl(' + hue + ' 62% 52%)"></span>';

  const VIEW_NAMES = {tasks:'Tareas', calendar:'Calendario', contacts:'Contactos', vault:'Contraseñas', clients:'Clientes', data:'Copia de seguridad', settings:'Ajustes'};
  const SEARCH_INPUTS = {tasks:'search', contacts:'searchContacts', vault:'searchVault'};

  function isTyping(el){
    if(!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  class CommandController {
    constructor(app, view){
      this.app = app;
      this.view = view;

      this.view.bindTrigger(() => this.open());
      this.view.bindQuery((q) => this.search(q));
      this.view.bindChoose((item) => {
        this.view.close();
        if(item) item.run();
      });

      document.addEventListener('keydown', (ev) => this.onKey(ev));
    }

    open(){
      this.view.open();
      this.search('');
    }

    onKey(ev){
      const mod = ev.ctrlKey || ev.metaKey;
      if(mod && !ev.altKey && (ev.key === 'k' || ev.key === 'K')){
        ev.preventDefault();
        if(this.view.isOpen()) this.view.close();
        else if(!document.querySelector('dialog[open]')) this.open();
        return;
      }
      if(mod || ev.altKey || isTyping(ev.target) || document.querySelector('dialog[open]')) return;
      if(ev.key === 'n' || ev.key === 'N'){
        ev.preventDefault();
        this.newTask();
      } else if(ev.key === '/'){
        const id = SEARCH_INPUTS[this.currentView()];
        const input = id && document.getElementById(id);
        if(input && input.offsetParent){
          ev.preventDefault();
          input.focus();
          input.select();
        }
      }
    }

    currentView(){
      const tab = document.querySelector('.tab.active');
      return tab ? tab.getAttribute('data-view') : 'tasks';
    }

    newTask(){
      this.app.navigate('tasks');
      this.app.controllers.tasks.openNew();
    }

    /* ---------- Resultados ---------- */

    actions(){
      const app = this.app;
      const c = app.controllers;
      const list = [
        {title:'Nueva tarea', meta:'N', icon:ICONS.plus, run:() => this.newTask()},
        {title:'Nueva reunión', icon:ICONS.plus, run:() => { app.navigate('calendar'); c.calendar.openNewMeeting(); }},
        {title:'Nuevo contacto', icon:ICONS.plus, run:() => { app.navigate('contacts'); c.contacts.openNew(); }},
        {title:'Nueva credencial', icon:ICONS.plus, run:() => { app.navigate('vault'); if(app.models.vault.unlocked) c.vault.openNew(); }},
        {title:'Nuevo cliente', icon:ICONS.plus, run:() => { app.navigate('clients'); const el = document.getElementById('newClientName'); if(el) el.focus(); }}
      ];
      Object.keys(VIEW_NAMES).forEach((v) => {
        list.push({title:'Ir a ' + VIEW_NAMES[v], icon:ICONS.go, run:() => app.navigate(v)});
      });
      [['light', 'claro'], ['dark', 'oscuro'], ['system', 'del sistema']].forEach((pair) => {
        list.push({title:'Usar tema ' + pair[1], icon:ICONS.theme, run:() => c.settings.setTheme(pair[0])});
      });
      list.push({title:'Exportar copia de seguridad', icon:ICONS.download, run:() => { app.navigate('data'); c.backup.exportData(); }});
      return list;
    }

    search(query){
      const q = query.trim().toLowerCase();
      const m = this.app.models;
      const has = (...fields) => fields.some((f) => String(f || '').toLowerCase().indexOf(q) !== -1);
      const clientColors = Workhub.views.clientColors;

      const actions = this.actions().filter((a) => !q || has(a.title));

      const tasks = m.tasks.items
        .filter((t) => q ? has(t.title, t.cliente, t.contacto, t.desc) : t.status !== 'completada')
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        .slice(0, MAX_PER_GROUP)
        .map((t) => {
          const s = TaskModel.statusOf(t.status);
          return {
            title: t.title || 'Sin título',
            meta: [t.cliente, s.label].filter(Boolean).join(' · '),
            icon: '<span class="dot" style="background:' + s.dot + '"></span>',
            run: () => { this.app.navigate('tasks'); this.app.controllers.tasks.openDetail(t.id); }
          };
        });

      const contacts = !q ? [] : m.contacts.items
        .filter((ct) => has(ct.nombre, ct.email, ct.telefono, ct.cliente))
        .slice(0, MAX_PER_GROUP)
        .map((ct) => ({
          title: ct.nombre || 'Sin nombre',
          meta: [ct.email, ct.cliente].filter(Boolean).join(' · '),
          icon: ICONS.user,
          run: () => { this.app.navigate('contacts'); this.app.controllers.contacts.openEdit(ct.id); }
        }));

      const meetings = !q ? [] : m.meetings.items
        .filter((mt) => has(mt.title, mt.cliente))
        .slice(0, MAX_PER_GROUP)
        .map((mt) => ({
          title: mt.title || 'Reunión',
          meta: [mt.date, mt.cliente].filter(Boolean).join(' · '),
          icon: ICONS.meeting,
          run: () => {
            this.app.navigate('calendar');
            this.app.controllers.calendar.selectDate(mt.date);
            this.app.controllers.calendar.openMeetingDetail(mt.id);
          }
        }));

      const clients = !q ? [] : m.clients.items
        .filter((cl) => has(cl.nombre))
        .slice(0, MAX_PER_GROUP)
        .map((cl) => ({
          title: cl.nombre,
          meta: 'Ver tareas del cliente',
          icon: clientIcon(clientColors.hueOf(cl.nombre)),
          run: () => this.showClientTasks(cl.nombre)
        }));

      /* Si lo escrito es el principio de una acción ("nueva…", "ir a…"), las acciones van primero. */
      const actionFirst = actions.some((a) => a.title.toLowerCase().indexOf(q) === 0);
      const actionGroup = {label:'Acciones', items:actions.slice(0, MAX_PER_GROUP)};
      const groups = q
        ? (actionFirst ? [actionGroup] : []).concat(
            [{label:'Tareas', items:tasks}, {label:'Contactos', items:contacts}, {label:'Reuniones', items:meetings},
             {label:'Clientes', items:clients}],
            actionFirst ? [] : [actionGroup])
        : [{label:'Acciones', items:actions.slice(0, 5)}, {label:'Tareas abiertas recientes', items:tasks},
           {label:'Ir a', items:actions.filter((a) => a.title.indexOf('Ir a') === 0)}];
      this.view.render(groups);
    }

    /* Tablero filtrado por ese cliente. */
    showClientTasks(name){
      this.app.navigate('tasks');
      const select = document.getElementById('filterCliente');
      select.value = name;
      select.dispatchEvent(new Event('change', {bubbles:true}));
    }
  }

  Workhub.controllers.CommandController = CommandController;
})();
