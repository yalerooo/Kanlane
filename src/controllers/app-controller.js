/* Controlador principal: crea modelos, vistas y controladores, conecta con el
   almacenamiento y gestiona la navegación entre secciones. */
(function(){
  const M = Workhub.models;
  const V = Workhub.views;
  const C = Workhub.controllers;
  const platform = Workhub.services.platform;
  const prefs = Workhub.services.preferences;

  const TAB_PREF = 'tablero_tab';

  class AppController {
    constructor(){
      this.models = {
        clients: new M.ClientModel(),
        tasks: new M.TaskModel(),
        contacts: new M.ContactModel(),
        meetings: new M.MeetingModel(),
        vault: new M.VaultModel(),
        settings: new M.SettingsModel()
      };
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

      this.shell.bindTabClick((view) => this.navigate(view));
      this.shell.setStorageMode(platform.isLocal());
    }

    /* Nombres de cliente ordenados, para los desplegables. */
    clientNames(){
      return this.models.clients.names();
    }

    /* Crea un cliente desde cualquier formulario; false si aún no hay conexión. */
    createClient(name){
      if(!this.models.clients.isReady()) return false;
      return this.models.clients.create(name);
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
    }

    start(){
      const board = this.controllers.tasks.board;
      if(!platform.isAvailable()){
        board.setMessage('Esta vista no admite el tablero interactivo.');
        return;
      }
      platform.connectDb().then((db) => {
        if(!db){
          board.setMessage('No se pudo conectar al almacenamiento de tareas en esta vista.');
          return;
        }
        const m = this.models;
        [m.clients, m.tasks, m.contacts, m.vault, m.meetings].forEach((model) => model.connect(db));

        const savedTab = prefs.read(TAB_PREF, null);
        if(savedTab && savedTab !== 'tasks' && V.ShellView.VIEWS.indexOf(savedTab) !== -1) this.navigate(savedTab);
      }).catch(() => {
        board.setMessage('No se pudo conectar al almacenamiento de tareas.');
      });
    }
  }

  C.AppController = AppController;
})();
