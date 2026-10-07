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
      this.models.team = new M.TeamModel(this.models.projects);

      V.clientColors.setResolver((name) => this.models.clients.hueOf(name));
      this.shell = new V.ShellView();
      V.Dropdown.enhanceAll(document);
      V.DatePicker.enhanceAll(document);
      this.shell.addDialogCloseButtons();
      /* Hasta abrir un proyecto de equipo, lo que es solo de equipos queda oculto. */
      this.shell.setTeamMode(false);

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
      this.controllers.crypto = new C.ProjectCryptoController(this, new V.ProjectLockView());
      this.controllers.projects = new C.ProjectsController(this, new V.ProjectView());
      /* Una copia importada puede traer campos personalizados que el proyecto no tiene. */
      this.models.backup.onCustomFields = (list) => this.controllers.projects.saveCustomFields(list);
      this.controllers.teamCrypto = new C.TeamCryptoController(this, new V.JoinView());
      this.controllers.rotation = new C.KeyRotationController(this, this.controllers.crypto.view);
      this.controllers.convert = new C.ProjectConvertController(this, this.controllers.crypto.view);
      this.controllers.team = new C.TeamController(this, new V.ShareView());
      this.controllers.plugins = new C.PluginsController(this, new V.PluginsView());
      this.controllers.command = new C.CommandController(this, new V.CommandPaletteView());
      this.controllers.github = new C.GithubController(this, new V.GithubView());
      this.controllers.reminders = new C.RemindersController(this, new V.RemindersView());
      this.controllers.automations = new C.AutomationsController(this, new V.AutomationsView());
      this.controllers.account = new C.AccountController(this, new V.AccountView());
      this.controllers.projects.render();

      /* Contadores de la barra lateral. */
      const m = this.models;
      [m.tasks, m.clients, m.meetings, m.vault].forEach((model) => model.on('change', () => this.updateCounts()));
      /* Al llegar la lista de proyectos se sabe si el abierto tiene cifrado total. */
      m.projects.on('change', () => this.syncEncryption());

      /* Botones y etiquetas de plugins: repintar donde aparecen. */
      V.extensions.on('change', () => {
        V.extensions.fillSlots(document);
        const c = this.controllers;
        c.tasks.render();
        c.tasks.refreshDetail();
        c.clients.render();
        c.calendar.fillExtensions();
      });

      this.shell.bindTabClick((view) => {
        if(view === 'plugins' && this.controllers.plugins.active) this.controllers.plugins.close();
        this.navigate(view);
      });
      this.shell.bindPluginNav((id) => this.controllers.plugins.open(id));
      this.shell.bindThemeToggle((theme) => this.controllers.settings.setTheme(theme));
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
      if(view === 'settings'){ c.settings.render(); c.account.render(); }
      if(view === 'calendar') c.calendar.render();
      if(view === 'clients') c.clients.render();
      if(view === 'vault') c.vault.onShow();
      if(view === 'plugins') c.plugins.onShow();
      if(view === 'data') c.backup.onShow();
    }

    /* ---------- Proyectos ---------- */

    /* {id, nombre, color} del último proyecto abierto en este navegador. */
    cachedProject(){
      return this.rememberedProject() || {id:M.ProjectModel.MAIN_ID, nombre:Workhub.t('Proyecto principal')};
    }

    /* Lo guardado por rememberProject(), o null si este navegador aún no ha abierto ningún proyecto. */
    rememberedProject(){
      try{
        const p = JSON.parse(prefs.read(PROJECT_PREF, 'null'));
        return p && typeof p.id === 'string' && p.id ? p : null;
      }catch(e){
        return null;
      }
    }

    rememberProject(p){
      const data = {id:p.id, nombre:p.nombre};
      if(typeof p.color === 'number') data.color = p.color;
      /* Tipo y etapas, para pintar bien el tablero antes de que llegue la lista. */
      if(p.tipo) data.tipo = p.tipo;
      if(Array.isArray(p.stages)) data.stages = p.stages;
      if(typeof p.clients === 'boolean') data.clients = p.clients;
      if(Array.isArray(p.labels)) data.labels = p.labels.slice(0, 1000);
      if(Array.isArray(p.customFields)) data.customFields = p.customFields.slice(0, 50);
      /* Cifrado total: para no conectar los datos antes de tener la clave. */
      if(M.ProjectModel.isEncrypted(p) || p.enc === true) data.enc = true;
      prefs.write(PROJECT_PREF, JSON.stringify(data));
    }

    /* Conecta los modelos con los datos del proyecto abierto. Si tiene cifrado total
       (docs/CIFRADO-PROYECTOS.md) se conectan con su cifrador, y solo si la clave está en este
       navegador; sin ella no se conecta nada y se muestra «Proyecto cifrado». Nunca se conecta
       sin saber antes si el proyecto está cifrado. */
    connectProject(){
      const P = M.ProjectModel;
      const seq = this.connectSeq = (this.connectSeq || 0) + 1;
      /* Las imágenes de un proyecto de equipo se guardan con el equipo (ver firebase-backend). */
      window.__teamId = P.isTeam(this.projectId) ? P.teamId(this.projectId) : '';
      /* Solo hay proyectos cifrados con cuenta (ni en modo local ni como invitado). */
      const account = !!(this.rootDb && this.rootDb.me);
      let enc = null;
      let known = true;
      if(account){
        const p = this.models.projects.loaded ? this.models.projects.get(this.projectId) : null;
        const r = this.rememberedProject();
        if(p){
          enc = P.isEncrypted(p) ? p.enc : null;
        }else if(this.models.projects.loaded){
          /* Recién creado con cifrado total y aún no está en la lista: se espera a que llegue. */
          known = !(r && r.id === this.projectId && r.enc);
        }else{
          /* Sin la lista todavía: vale lo recordado en este navegador, si dice que no está cifrado. */
          known = !!r && r.id === this.projectId && !r.enc;
        }
      }
      if(!known){
        /* syncEncryption() volverá a llamar cuando llegue la lista de proyectos. */
        this.disconnectProject();
        this.pendingConnect = true;
        this.encSig = '';
        return;
      }
      this.pendingConnect = false;
      if(!enc){
        this.openProject(null, '');
        return;
      }
      this.disconnectProject();
      this.encSig = AppController.encSig(enc);
      this.projectKey(enc).then((cipher) => {
        if(seq !== this.connectSeq) return;
        if(cipher) this.openProject(cipher, this.encSig);
        else this.lockProject();
      });
    }

    /* Sin la clave en este navegador: no se conecta nada y se pide la contraseña de cifrado. */
    lockProject(){
      this.shell.setProjectLocked(true);
      this.controllers.crypto.onLocked();
      this.controllers.backup.syncEncrypted();
    }

    openProject(cipher, sig){
      const P = M.ProjectModel;
      this.cipher = cipher;
      this.encSig = sig;
      this.shell.setProjectLocked(false);
      /* Equipo cifrado: los cambios de campos secretos van en transacción (dos personas a la vez). */
      if(cipher) cipher.transaction = P.isTeam(this.projectId) && this.rootDb.teams && this.rootDb.teams.runTransaction
        ? (fn) => this.rootDb.teams.runTransaction(fn) : null;
      /* Las imágenes las cifra y descifra firebase-backend, que no sabe de proyectos. */
      window.__assetCipher = cipher ? {
        sealBytes: (id, bytes) => cipher.sealBytes('assets', id, bytes),
        openBytes: (id, doc) => cipher.openBytes('assets', id, doc)
      } : null;
      const db = P.scope(this.rootDb, this.projectId);
      /* En un equipo el cofre es compartido y cada persona guarda su propia clave (ver team-vault.js). */
      const me = this.rootDb.me, pid = this.projectId, projects = this.models.projects;
      this.models.vault.team = P.isTeam(pid) && me ? {
        tid:P.teamId(pid), uid:me.uid, email:me.email, teams:this.rootDb.teams,
        /* Mi rol puede llegar después de conectar: se mira cada vez. */
        get owner(){ const p = projects.get(pid); return !!p && p.role === 'owner'; }
      } : null;
      PROJECT_MODELS.forEach((name) => this.models[name].connect(db, cipher));
      this.models.plugins.connect(db, this.projectId === P.MAIN_ID);
      /* La sección de copias cambia con el cifrado (exportar cifrado o no). */
      if(this.controllers && this.controllers.backup) this.controllers.backup.syncEncrypted();
      /* Cifrado: publicar mi clave pública en el equipo y terminar un cambio de clave a medias. */
      if(cipher && this.controllers && this.controllers.rotation) this.controllers.rotation.onOpen();
      /* Y terminar una conversión a cifrado total que se cortó. */
      if(cipher && this.controllers && this.controllers.convert) this.controllers.convert.onOpen();
    }

    disconnectProject(){
      this.cipher = null;
      window.__assetCipher = null;
      this.shell.setProjectLocked(false);
      PROJECT_MODELS.forEach((name) => this.models[name].disconnect());
      this.models.plugins.disconnect();
    }

    /* Lo que identifica el cifrado de un proyecto: si cambia (otra clave, un cambio de clave que
       empieza o termina) hay que volver a conectar. */
    static encSig(enc){
      return enc ? [enc.pid, enc.kid, enc.rot && enc.rot.kid ? enc.rot.kid : ''].join('|') : '';
    }

    /* Cifrador del proyecto si su clave está guardada en este navegador y es la vigente; si no, null.
       Durante un cambio de clave (enc.rot) lleva además la anterior, si está aquí, para leer lo que
       aún no se ha vuelto a cifrar. */
    projectKey(enc){
      const keystore = Workhub.services.keystore;
      const PC = Workhub.services.projectCrypto;
      const P = M.ProjectModel;
      if(!keystore || !PC || !PC.isAvailable() || !M.ProjectCipher) return Promise.resolve(null);
      const uid = this.rootDb.me.uid;
      /* Clave guardada de una versión (kid) del proyecto, comprobada con su kcv. */
      const find = (slot, kid, kcv) => keystore.get(uid, slot).then((rec) => {
        if(!rec || rec.kid !== kid) return null;
        return PC.checkKcv(rec.key, enc.pid, kid, kcv).then((ok) => (ok ? rec.key : null));
      });
      return find(enc.pid, enc.kid, enc.kcv).then((key) => {
        if(!key) return null;
        const rot = enc.rot && enc.rot.kid ? enc.rot : null;
        return (rot ? find(P.keySlot(enc.pid, rot.kid), rot.kid, rot.kcv).catch(() => null) : Promise.resolve(null)).then((old) => {
          return new M.ProjectCipher({pid:enc.pid, kid:enc.kid, key:key, prev:old ? [{kid:rot.kid, key:old}] : []});
        });
      }).catch(() => null);
    }

    /* Con la lista de proyectos cargada: conecta lo que estaba esperando y reconecta si lo conectado
       no cuadra con el cifrado del proyecto (lo recordado en el navegador estaba anticuado). */
    syncEncryption(){
      if(!this.rootDb || !this.rootDb.me || !this.models.projects.loaded) return;
      const p = this.models.projects.get(this.projectId);
      const sig = AppController.encSig(M.ProjectModel.isEncrypted(p) ? p.enc : null);
      if(this.pendingConnect || sig !== (this.encSig || '')) this.connectProject();
    }

    /* Cambia de proyecto sin recargar: cierra lo que hubiera abierto, vacía los
       filtros y reconecta los modelos a los datos del otro proyecto. */
    switchProject(id){
      if(!this.rootDb || id === this.projectId) return;
      this.controllers.plugins.beforeProjectChange();
      /* El diálogo de proyectos se queda: desde él se puede estar eliminando este. */
      document.querySelectorAll('dialog[open]:not(#dlgProject)').forEach((dlg) => {
        const dismiss = dlg.querySelector('[data-dismiss]');
        if(dismiss) dismiss.click();
        if(dlg.open) dlg.close();
      });
      this.projectId = id;
      const p = this.models.projects.get(id) || {id:id, nombre:''};
      if(p.nombre) this.rememberProject(p);
      if(this.controllers.tasks) this.controllers.tasks.board.resetQuick();
      this.shell.resetFilters();
      this.connectProject();
      this.controllers.backup.scheduleAuto();
      /* Primero el tipo del proyecto (etapas, clientes): lo que sigue ya lo usa. */
      this.controllers.projects.render();
      this.controllers.vault.onProjectChange();
      this.controllers.plugins.onProjectChange();
      this.controllers.github.onProjectChange();
      this.updateCounts();
    }

    /* Borra un proyecto y todos sus datos. Si es el abierto, antes se pasa a otro
       (si no queda ninguno, se pedirá crear uno). */
    deleteProject(id){
      if(!this.rootDb) return Promise.reject(new Error('not-ready'));
      if(id === this.projectId){
        const next = this.models.projects.list().find((p) => p.id !== id);
        if(next) this.switchProject(next.id);
      }
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
        this.models.team.connect();
        this.connectProject();
        this.controllers.backup.scheduleAuto();
        this.controllers.account.start();

        /* El invitado aterriza siempre en Tareas: la última vista recordada es de este navegador, no
           suya (podía ser la de otra persona, o «Copia de seguridad» de la sesión anterior). */
        const auth = this.controllers.auth;
        if(auth && auth.guest) return;
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
