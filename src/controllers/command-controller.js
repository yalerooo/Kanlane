/* Paleta de comandos y atajos de teclado globales:
   - Ctrl/⌘ K: abre o cierra la paleta (también el botón "Buscar…").
   - N: nueva tarea.   - /: buscar dentro de la sección actual. */
(function(){
  const t = Workhub.t;
  const TaskModel = Workhub.models.TaskModel;
  const MAX_PER_GROUP = 6;

  const svg = (d) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const ICONS = {
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    go: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    meeting: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    theme: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    project: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    download: svg('<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>'),
    note: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>')
  };
  const projectIcon = (hue, name) => '<span class="project-mark is-xs" style="--h:' + hue + '">' + Workhub.utils.html.esc(Workhub.utils.html.initials(name)) + '</span>';
  const clientIcon = (hue) => '<span class="dot" style="border-radius:2px;background:hsl(' + hue + ' 62% 52%)"></span>';

  const VIEW_NAMES = {tasks:'Tareas', calendar:'Calendario', clients:'Clientes y contactos', vault:'Contraseñas', plugins:'Plugins', data:'Copia de seguridad', settings:'Ajustes'};
  const SEARCH_INPUTS = {tasks:'search', clients:'searchClients', vault:'searchVault'};

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
        {title:t('Nueva tarea'), meta:'N', icon:ICONS.plus, run:() => this.newTask()},
        {title:t('Nueva reunión'), icon:ICONS.plus, run:() => { app.navigate('calendar'); c.calendar.openNewMeeting(); }},
        {title:t('Nuevo contacto'), icon:ICONS.plus, run:() => { app.navigate('clients'); c.contacts.openNew(c.clients.selectedClientName()); }},
        {title:t('Nueva credencial'), icon:ICONS.plus, run:() => { app.navigate('vault'); if(app.models.vault.unlocked) c.vault.openNew(); }},
        {title:t('Nuevo cliente'), icon:ICONS.plus, run:() => { app.navigate('clients'); const el = document.getElementById('newClientName'); if(el) el.focus(); }}
      ];
      /* Acciones que añaden los plugins a la paleta. */
      Workhub.views.extensions.buttonsAt('command').forEach((b) => {
        list.push({title:b.label, meta:b.pluginName, icon:Workhub.views.pluginIcons.svg(b.icon || 'puzzle', 16), run:() => Workhub.views.extensions.trigger(b.key, {})});
      });
      app.models.plugins.list().forEach((p) => {
        const name = c.plugins.manifestOf(p).name || p.id;
        list.push({title:t('Abrir plugin: {name}', {name:name}), icon:ICONS.go, run:() => c.plugins.open(p.id)});
      });
      if(c.github && c.github.sync.isLinked()){
        list.push({title:t('Sincronizar con GitHub'), icon:ICONS.go, run:() => { app.navigate('tasks'); c.github.syncNow(false); }});
      }
      if(Workhub.views.team.enabled()){
        list.push({title:t('Mis tareas'), icon:ICONS.go, run:() => { app.navigate('tasks'); c.tasks.showMine(); }});
      }
      if(c.team && c.team.enabled()){
        list.push({title:t('Compartir proyecto'), icon:ICONS.go, run:() => c.team.open()});
      }
      list.push({title:t('Nuevo proyecto'), icon:ICONS.project, run:() => c.projects.openNew()});
      list.push({title:t('Editar proyecto actual'), icon:ICONS.project, run:() => c.projects.openEdit()});
      Object.keys(VIEW_NAMES).forEach((v) => {
        list.push({title:t('Ir a {view}', {view:t(VIEW_NAMES[v])}), go:true, icon:ICONS.go, run:() => app.navigate(v)});
      });
      [['light', 'Usar tema claro'], ['dark', 'Usar tema oscuro'], ['system', 'Usar tema del sistema']].forEach((pair) => {
        list.push({title:t(pair[1]), icon:ICONS.theme, run:() => c.settings.setTheme(pair[0])});
      });
      list.push({title:t('Exportar copia de seguridad'), icon:ICONS.download, run:() => { app.navigate('data'); c.backup.exportData(); }});
      if(c.auth && c.auth.user){
        list.push({title:t('Cerrar sesión'), meta:c.auth.user.email || '', icon:ICONS.go, run:() => c.auth.signOut()});
      }
      return list;
    }

    /* Cambiar a cualquier otro proyecto. */
    projectItems(){
      const projects = this.app.models.projects;
      return projects.list().filter((p) => p.id !== this.app.projectId).map((p) => ({
        title: p.nombre,
        meta: t('Cambiar de proyecto'),
        icon: projectIcon(projects.hueOf(p), p.nombre),
        run: () => this.app.switchProject(p.id, true)
      }));
    }

    /* Trozo de texto alrededor de la primera coincidencia ("…lo que buscabas aquí…"). */
    snippet(text, q){
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      const i = clean.toLowerCase().indexOf(q);
      if(i === -1) return '';
      const from = Math.max(0, i - 24);
      const to = Math.min(clean.length, i + q.length + 48);
      return (from > 0 ? '…' : '') + clean.slice(from, to) + (to < clean.length ? '…' : '');
    }

    /* Puntúa una coincidencia: título que empieza por lo buscado > título que lo contiene > el resto. */
    score(title, q){
      const t = String(title || '').toLowerCase();
      if(t.indexOf(q) === 0) return 3;
      if(t.indexOf(q) !== -1) return 2;
      return 1;
    }

    /* Notas de todas las tareas (están en subcolecciones): se leen una vez y se guardan un minuto. */
    loadNotes(){
      const now = Date.now();
      const tasks = this.app.models.tasks;
      if(!tasks.isReady()) return Promise.resolve([]);
      if(this.notesCache && this.notesCache.project === this.app.projectId && now - this.notesCache.at < 60000) return this.notesCache.promise;
      const promise = tasks.withNotes().then((list) => {
        const out = [];
        list.forEach((t) => (t.notes || []).forEach((n) => { if(n.text) out.push({taskId:t.id, title:t.title, text:n.text}); }));
        return out;
      }).catch(() => []);
      this.notesCache = {at:now, project:this.app.projectId, promise:promise};
      return promise;
    }

    search(query){
      const q = query.trim().toLowerCase();
      this.view.render(this.groups(q, []));
      /* Las notas de las tareas se leen aparte y se añaden cuando llegan. */
      if(q.length >= 3){
        this.loadNotes().then((notes) => {
          if(this.view.query.trim().toLowerCase() !== q || !this.view.isOpen()) return;
          this.view.render(this.groups(q, notes));
        });
      }
    }

    groups(q, allNotes){
      const m = this.app.models;
      const has = (...fields) => fields.some((f) => String(f || '').toLowerCase().indexOf(q) !== -1);
      const clientColors = Workhub.views.clientColors;
      /* Lo que se busca y no está en el título se enseña como un trocito de texto. */
      const why = (title, ...fields) => {
        if(!q || has(title)) return '';
        for(let i = 0; i < fields.length; i++){ const s = this.snippet(fields[i], q); if(s) return s; }
        return '';
      };
      const rank = (items, key) => items.map((it, i) => ({it, i, s:this.score(key(it), q)}))
        .sort((x, y) => (y.s - x.s) || (x.i - y.i)).map((x) => x.it);

      const actions = this.actions().filter((a) => !q || has(a.title));

      const checks = (t) => (Array.isArray(t.checklist) ? t.checklist : []).map((c) => c.text).join(' ');
      const taskMatches = m.tasks.items
        .filter((t) => q ? has(t.title, t.cliente, t.contacto, t.desc, checks(t)) : !TaskModel.isDone(t))
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const tasks = (q ? rank(taskMatches, (t) => t.title) : taskMatches)
        .slice(0, MAX_PER_GROUP)
        .map((t) => {
          const s = TaskModel.statusOf(t.status);
          const hit = why(t.title, t.desc, checks(t), t.contacto);
          return {
            title: t.title || Workhub.t('Sin título'),
            meta: hit || [t.cliente, Workhub.t(s.label)].filter(Boolean).join(' · '),
            icon: '<span class="dot" style="background:' + s.dot + '"></span>',
            run: () => { this.app.navigate('tasks'); this.app.controllers.tasks.openDetail(t.id); }
          };
        });

      const notes = !q ? [] : allNotes
        .filter((n) => n.text.toLowerCase().indexOf(q) !== -1)
        .slice(0, MAX_PER_GROUP)
        .map((n) => ({
          title: this.snippet(n.text, q) || n.text.slice(0, 80),
          meta: n.title || Workhub.t('Sin título'),
          icon: ICONS.note,
          run: () => { this.app.navigate('tasks'); this.app.controllers.tasks.openDetail(n.taskId); }
        }));

      const contacts = !q ? [] : rank(m.contacts.items.filter((ct) => has(ct.nombre, ct.email, ct.telefono, ct.cliente, ct.notas)), (ct) => ct.nombre)
        .slice(0, MAX_PER_GROUP)
        .map((ct) => ({
          title: ct.nombre || Workhub.t('Sin nombre'),
          meta: why(ct.nombre, ct.notas, ct.email, ct.telefono) || [ct.email, ct.cliente].filter(Boolean).join(' · '),
          icon: ICONS.user,
          run: () => this.app.controllers.clients.showContact(ct.id)
        }));

      const meetings = !q ? [] : rank(m.meetings.items.filter((mt) => has(mt.title, mt.cliente, mt.notas)), (mt) => mt.title)
        .slice(0, MAX_PER_GROUP)
        .map((mt) => ({
          title: mt.title || Workhub.t('Reunión'),
          meta: why(mt.title, mt.notas) || [mt.date, mt.cliente].filter(Boolean).join(' · '),
          icon: ICONS.meeting,
          run: () => {
            this.app.navigate('calendar');
            this.app.controllers.calendar.selectDate(mt.date);
            this.app.controllers.calendar.openMeetingDetail(mt.id);
          }
        }));

      const clients = !q ? [] : rank(m.clients.items.filter((cl) => has(cl.nombre)), (cl) => cl.nombre)
        .slice(0, MAX_PER_GROUP)
        .map((cl) => ({
          title: cl.nombre,
          meta: Workhub.t('Ver ficha y contactos'),
          icon: clientIcon(clientColors.hueOf(cl.nombre)),
          run: () => { this.app.navigate('clients'); this.app.controllers.clients.select(cl.id, true); }
        }));

      /* Contraseñas: solo por título, usuario y cliente (nunca el secreto) y con el baúl abierto. */
      const VaultModel = Workhub.models.VaultModel;
      const vault = !q || !m.vault.unlocked ? [] : rank(m.vault.items.filter((v) => has(VaultModel.titleFor(v), v.cliente, v.usuario, v.correo, v.ip, v.web)), (v) => VaultModel.titleFor(v))
        .slice(0, MAX_PER_GROUP)
        .map((v) => ({
          title: VaultModel.titleFor(v),
          meta: [VaultModel.typeLabel(v.tipo), v.cliente].filter(Boolean).join(' · '),
          icon: ICONS.key,
          run: () => { this.app.navigate('vault'); this.app.controllers.vault.openDetail(v.id); }
        }));

      const projects = this.projectItems().filter((p) => !q || has(p.title, 'proyecto')).slice(0, MAX_PER_GROUP);

      /* Si lo escrito es el principio de una acción ("nueva…", "ir a…"), las acciones van primero. */
      const actionFirst = actions.some((a) => a.title.toLowerCase().indexOf(q) === 0);
      const actionGroup = {label:'Acciones', items:actions.slice(0, MAX_PER_GROUP)};
      return q
        ? (actionFirst ? [actionGroup] : []).concat(
            [{label:'Tareas', items:tasks}, {label:'Notas de tareas', items:notes}, {label:'Contactos', items:contacts},
             {label:'Reuniones', items:meetings}, {label:'Clientes', items:clients}, {label:'Contraseñas', items:vault},
             {label:'Proyectos', items:projects}],
            actionFirst ? [] : [actionGroup])
        : [{label:'Acciones', items:actions.slice(0, 5)}, {label:'Tareas abiertas recientes', items:tasks},
           {label:'Proyectos', items:projects},
           {label:'Ir a', items:actions.filter((a) => a.go)}];
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
