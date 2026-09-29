/* Controlador principal: crea modelos, vistas y controladores, conecta con el
   almacenamiento y gestiona la navegación entre secciones. */
(function(){
  const M = Workhub.models;
  const V = Workhub.views;
  const C = Workhub.controllers;
  const platform = Workhub.services.platform;
  const prefs = Workhub.services.preferences;

  const TAB_PREF = 'tablero_tab';
  const PROJECT_PREF = 'workhub_project';
  /* Modelos con los datos de cada proyecto (se reconectan al cambiar). */
  const PROJECT_MODELS = ['clients', 'tasks', 'contacts', 'vault', 'meetings'];

  class AppController {
    constructor(){
      this.models = {
        clients: new M.ClientModel(),
        tasks: new M.TaskModel(),
        contacts: new M.ContactModel(),
        meetings: new M.MeetingModel(),
        vault: new M.VaultModel(),
        settings: new M.SettingsModel(),
        projects: new M.ProjectModel(),
        plugins: new M.PluginModel()
      };
      /* Base de datos sin acotar y proyecto abierto. */
      this.rootDb = null;
      this.projectId = this.cachedProject().id;
      this.models.backup = new M.BackupModel(this.models);

      V.clientColors.setResolver((name) => this.models.clients.hueOf(name));
      this.shell = new V.ShellView();
      V.Dropdown.enhanceAll(document);
      this.shell.addDialogCloseButtons();

      /* Ajustes primero: aplica acento y tema antes de pintar nada más. */
      this.controllers = {
        settings: new C.SettingsController(this, new V.SettingsView()),
        clients: new C.ClientsController(this, new V.ClientsView()),
        tasks: new C.TasksController(this, new V.BoardView(), new V.TaskDialogView(), new V.TaskDetailView()),
        calendar: new C.CalendarController(this, new V.CalendarView()),
        contacts: new C.ContactsController(this, new V.ContactsView()),
        vault: new C.VaultController(this, new V.VaultView()),
        backup: new C.BackupController(this, new V.BackupView())
      };
      this.controllers.projects = new C.ProjectsController(this, new V.ProjectView());
      this.controllers.plugins = new C.PluginsController(this, new V.PluginsView());
      this.controllers.command = new C.CommandController(this, new V.CommandPaletteView());
      this.controllers.github = new C.GithubController(this, new V.GithubView());
      this.controllers.projects.render();

      /* Contadores de la barra lateral. */
      const m = this.models;
      [m.tasks, m.clients, m.meetings, m.vault].forEach((model) => model.on('change', () => this.updateCounts()));

      /* Botones y etiquetas de plugins: repintar donde aparecen. */
      V.extensions.on('change', () => {
        V.extensions.fillSlots(document);
        const c = this.controllers;
        c.tasks.render();
        c.tasks.refreshDetail();
        c.clients.render();
        c.calendar.fillExtensions();
      });

      this.shell.bindTabClick((view) => this.navigate(view));
      this.shell.setStorageMode(platform.mode());
    }

    /* Nombres de cliente ordenados, para los desplegables. */
    clientNames(){
      return this.models.clients.names();
    }

    clientsEnabled(){
      return this.config ? this.config.clients : true;
    }

    /* Aplica el tipo del proyecto abierto: etapas del tablero y si hay clientes.
       Solo repinta si algo cambió respecto a lo último aplicado. */
    applyProjectConfig(cfg){
      const sig = JSON.stringify(cfg);
      if(this.configSig === sig) return;
      const clientsChanged = !this.config || this.config.clients !== cfg.clients;
      this.config = cfg;
      this.configSig = sig;
      M.TaskModel.setStages(cfg.stages);
      this.fillStatusSelects();
      Workhub.clientsEnabled = cfg.clients;
      this.shell.setClientsEnabled(cfg.clients);
      if(!cfg.clients && this.shell.isVisible('clients')) this.navigate('tasks');
      const c = this.controllers;
      c.tasks.render();
      c.tasks.refreshDetail();
      c.calendar.render();
      if(clientsChanged) c.clients.render();
      this.updateCounts();
    }

    /* Las opciones de estado de los formularios salen de las etapas del proyecto. */
    fillStatusSelects(){
      const html = M.TaskModel.STATUS.map((s) => '<option value="' + Workhub.utils.html.esc(s.key) + '">' + Workhub.utils.html.esc(s.label) + '</option>').join('');
      ['fEstado', 'tvEstado'].forEach((id) => {
        const el = document.getElementById(id);
        const prev = el.value;
        el.innerHTML = html;
        el.value = M.TaskModel.STATUS.some((s) => s.key === prev) ? prev : M.TaskModel.STATUS[0].key;
      });
    }

    /* Crea un cliente desde cualquier formulario; false si aún no hay conexión. */
    createClient(name){
      if(!this.models.clients.isReady()) return false;
      return this.models.clients.create(name);
    }

    updateCounts(){
      const m = this.models;
      const TaskModel = M.TaskModel;
      const today = Workhub.utils.dates.todayYmd();
      const open = m.tasks.items.filter((t) => !TaskModel.isDone(t));
      const overdue = open.some((t) => TaskModel.dueState(t) === 'overdue');
      const todayCount = m.meetings.items.filter((x) => x.date === today).length +
        open.filter((t) => t.dueDate === today).length;
      this.shell.setCounts({
        tasks: open.length,
        calendar: todayCount,
        vault: m.vault.items.length,
        clients: m.clients.items.length
      }, {tasks: overdue});
    }

    navigate(view){
      this.shell.show(view);
      prefs.write(TAB_PREF, view);
      const c = this.controllers;
      if(view === 'tasks') c.tasks.board.fitHeight();
      if(view === 'settings') c.settings.render();
      if(view === 'calendar') c.calendar.render();
      if(view === 'clients') c.clients.render();
      if(view === 'vault') c.vault.onShow();
      if(view === 'plugins') c.plugins.onShow();
    }

    /* ---------- Proyectos ---------- */

    /* {id, nombre, color} del último proyecto abierto en este navegador. */
    cachedProject(){
      const main = {id:M.ProjectModel.MAIN_ID, nombre:Workhub.t('Proyecto principal')};
      try{
        const p = JSON.parse(prefs.read(PROJECT_PREF, 'null'));
        return p && typeof p.id === 'string' && p.id ? p : main;
      }catch(e){
        return main;
      }
    }

    rememberProject(p){
      const data = {id:p.id, nombre:p.nombre};
      if(typeof p.color === 'number') data.color = p.color;
      /* Tipo y etapas, para pintar bien el tablero antes de que llegue la lista. */
      if(p.tipo) data.tipo = p.tipo;
      if(Array.isArray(p.stages)) data.stages = p.stages;
      if(typeof p.clients === 'boolean') data.clients = p.clients;
      prefs.write(PROJECT_PREF, JSON.stringify(data));
    }

    connectProject(){
      const db = M.ProjectModel.scope(this.rootDb, this.projectId);
      PROJECT_MODELS.forEach((name) => this.models[name].connect(db));
    }

    /* Cambia de proyecto sin recargar: cierra lo que hubiera abierto, vacía los
       filtros y reconecta los modelos a los datos del otro proyecto. */
    switchProject(id, announce){
      if(!this.rootDb || id === this.projectId) return;
      /* El diálogo de proyectos se queda: desde él se puede estar eliminando este. */
      document.querySelectorAll('dialog[open]:not(#dlgProject)').forEach((dlg) => {
        const dismiss = dlg.querySelector('[data-dismiss]');
        if(dismiss) dismiss.click();
        if(dlg.open) dlg.close();
      });
      this.projectId = id;
      const p = this.models.projects.get(id) || {id:id, nombre:''};
      if(p.nombre) this.rememberProject(p);
      this.shell.resetFilters();
      this.connectProject();
      /* Primero el tipo del proyecto (etapas, clientes): lo que sigue ya lo usa. */
      this.controllers.projects.render();
      this.controllers.vault.onProjectChange();
      this.controllers.plugins.onProjectChange();
      this.controllers.github.onProjectChange();
      this.updateCounts();
      if(announce && p.nombre) Workhub.views.toast.success('Ahora estás en «' + p.nombre + '»');
    }

    /* Borra un proyecto y todos sus datos. Si es el abierto, antes se pasa al principal. */
    deleteProject(id){
      if(!this.rootDb) return Promise.reject(new Error('not-ready'));
      if(id === this.projectId) this.switchProject(M.ProjectModel.MAIN_ID, false);
      return platform.connectAssets().catch(() => null).then((assets) => {
        return this.models.projects.removeProject(id, this.rootDb, assets);
      });
    }

    start(){
      const board = this.controllers.tasks.board;
      this.shell.setStorageMode(platform.mode());
      if(!platform.isAvailable()){
        board.setMessage('Esta vista no admite el tablero interactivo.');
        return;
      }
      platform.connectDb().then((db) => {
        if(!db){
          board.setMessage('No se pudo conectar al almacenamiento de tareas en esta vista.');
          return;
        }
        this.rootDb = db;
        this.models.settings.connect(db);
        this.models.projects.connect(db);
        this.models.plugins.connect(db);
        this.connectProject();

        /* "Contactos" ahora está dentro de "Clientes". */
        let savedTab = prefs.read(TAB_PREF, null);
        if(savedTab === 'contacts') savedTab = 'clients';
        if(savedTab && savedTab !== 'tasks' && V.ShellView.VIEWS.indexOf(savedTab) !== -1) this.navigate(savedTab);
      }).catch(() => {
        board.setMessage('No se pudo conectar al almacenamiento de tareas.');
      });
    }
  }

  C.AppController = AppController;
})();
