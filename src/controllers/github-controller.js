/* Integración con GitHub Projects: conecta la vista con el motor de
   sincronización y lo lanza al abrir, al volver a la pestaña, cada pocos
   minutos y poco después de cambiar algo en Workhub. */
(function(){
  const api = Workhub.services.github;
  const toast = Workhub.views.toast;

  const INTERVAL = 2 * 60 * 1000;     /* sincronización periódica */
  const PUSH_DELAY = 2000;            /* espera tras un cambio local */
  const FOCUS_GAP = 30 * 1000;        /* al volver a la pestaña, si hace más de esto */

  class GithubController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.sync = new Workhub.models.GithubSync(app);
      this.connecting = false;
      this.connectError = '';
      this.tokenError = '';
      this.timer = 0;
      this.pushTimer = 0;

      this.view.bind({
        connect: (v) => this.connect(v),
        sync: () => this.syncNow(),
        unlink: () => this.unlink(),
        forget: () => { api.setToken(''); this.render(); },
        saveToken: (v) => this.saveToken(v),
        pushNew: (on) => this.sync.setPushNew(on)
      });

      this.sync.on('change', () => this.render());
      /* Un instante después: ProjectModel marca "loaded" en su propio listener, que va detrás de este. */
      app.models.projects.on('change', () => Promise.resolve().then(() => { this.render(); this.schedule(); }));
      /* Lo borrado en Workhub no vuelve a importarse desde GitHub. */
      app.models.tasks.on('removed', (t) => this.sync.ignore(t));
      /* Cambios locales: se envían enseguida (con un pequeño retraso). */
      app.models.tasks.on('change', () => this.queuePush());

      document.addEventListener('visibilitychange', () => {
        if(document.visibilityState !== 'visible' || !this.sync.isLinked()) return;
        const last = this.sync.lastResult;
        if(!last || Date.now() - last.at > FOCUS_GAP) this.syncNow(true);
      });
      window.addEventListener('online', () => this.syncNow(true));
      this.render();
    }

    render(){
      const cfg = this.sync.config();
      this.view.render({
        linked: !!cfg,
        cfg: cfg,
        busy: this.sync.busy,
        error: this.sync.error,
        last: this.sync.lastResult,
        hasToken: !!api.token(),
        projects: this.app.models.projects.list().map((p) => ({id:p.id, nombre:p.nombre, linked:!!p.github})),
        currentId: this.app.projectId,
        connecting: this.connecting,
        connectError: this.connectError,
        tokenError: this.tokenError
      });
    }

    /* Al abrir otro proyecto: se limpia el estado y, si está enlazado, se sincroniza. */
    onProjectChange(){
      this.sync.lastResult = null;
      this.sync.error = null;
      this.sync.pendingCfg = null;
      this.sync.sent = {};
      this.connectError = '';
      clearInterval(this.timer);
      this.timer = 0;
      this.render();
      this.schedule();
    }

    /* Temporizador de la sincronización periódica (solo si el proyecto está enlazado). */
    schedule(){
      const linked = this.sync.isLinked();
      if(linked && !this.timer){
        this.timer = setInterval(() => {
          if(document.visibilityState === 'visible') this.syncNow(true);
        }, INTERVAL);
        this.waitAndSync();
      } else if(!linked && this.timer){
        clearInterval(this.timer);
        this.timer = 0;
      }
    }

    /* Primera sincronización: cuando las tareas del proyecto ya están cargadas. */
    waitAndSync(){
      if(this.app.models.tasks.isReady() && this.sync.isLinked()) { this.syncNow(true); return; }
      const off = this.app.models.tasks.on('change', () => {
        if(!this.app.models.tasks.isReady()) return;
        off();
        if(this.sync.isLinked()) this.syncNow(true);
      });
    }

    queuePush(){
      if(!this.sync.isLinked() || this.sync.busy) return;
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => {
        if(this.sync.hasPending()) this.syncNow(true);
      }, PUSH_DELAY);
    }

    /* quiet: no avisa con un mensaje cuando todo va bien. */
    syncNow(quiet){
      if(!this.sync.isLinked()) return Promise.resolve();
      if(!api.token()){
        /* Sin token en este navegador: se lleva al usuario a donde puede pegarlo. */
        if(!quiet){
          this.app.navigate('settings');
          toast.error('Añade el token de GitHub en este navegador para sincronizar.');
        }
        return Promise.resolve();
      }
      /* Con un token rechazado no se reintenta solo: lo arregla el usuario desde Ajustes. */
      const e = this.sync.error;
      if(quiet && e && (e.code === 'auth' || e.code === 'scopes')) return Promise.resolve();
      return this.sync.sync().then((r) => {
        if(!quiet && r && !this.sync.error) toast.success('Sincronizado con GitHub');
        if(!quiet && this.sync.error) toast.error(this.sync.error.message);
      });
    }

    /* Proyecto ya enlazado desde otro navegador: guarda el token aquí y sincroniza. */
    saveToken(value){
      this.tokenError = '';
      if(!value){
        this.tokenError = 'Pega un token de GitHub.';
        this.render();
        return Promise.resolve();
      }
      api.setToken(value);
      this.sync.error = null;
      this.render();
      return this.syncNow(true).then(() => {
        const e = this.sync.error;
        if(e && (e.code === 'auth' || e.code === 'scopes')){
          api.setToken('');
          this.tokenError = e.message;
          this.sync.error = null;
        } else if(!e){
          toast.success('Token guardado. Sincronizado con GitHub');
        }
        this.render();
      });
    }

    connect(v){
      if(this.connecting) return;
      this.connectError = '';
      if(!api.token() && !v.token){
        this.connectError = 'Pega un token de GitHub.';
        this.render();
        return;
      }
      if(!v.url){
        this.connectError = 'Pega el enlace de tu proyecto de GitHub.';
        this.render();
        return;
      }
      this.connecting = true;
      this.render();
      this.sync.link(v).then(() => {
        this.connecting = false;
        this.schedule();
        this.render();
        if(!this.sync.error) toast.success('Proyecto conectado con GitHub');
      }).catch((err) => {
        this.connecting = false;
        this.connectError = (err && err.message) || 'No se pudo conectar con GitHub.';
        /* Un token rechazado no se conserva. */
        if(err && (err.code === 'auth' || err.code === 'scopes')) api.setToken('');
        this.render();
      });
    }

    /* ¿Se puede pedir a GitHub la actividad de esta tarea? */
    canLoadDetails(t){
      return !!api.token() && !!t.ghContentId && (t.ghType === 'Issue' || t.ghType === 'PullRequest');
    }

    /* Actividad, etiquetas y pull requests de una incidencia (se guarda 1 minuto). */
    loadDetails(t){
      this.detailCache = this.detailCache || {};
      const hit = this.detailCache[t.ghContentId];
      if(hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.data);
      return api.fetchDetails(t.ghContentId).then((data) => {
        this.detailCache[t.ghContentId] = {at:Date.now(), data:data};
        return data;
      });
    }

    /* Desde el diálogo de «Nuevo proyecto → Desde GitHub»: crea el proyecto y lo abre. */
    createFromGithub(v){
      if(!api.token() && !v.token) return Promise.reject(new Error('Pega un token de GitHub.'));
      if(!v.url) return Promise.reject(new Error('Pega el enlace de tu proyecto de GitHub.'));
      return this.sync.link({url:v.url, token:v.token, target:Workhub.models.GithubSync.NEW, name:v.nombre}).then(() => {
        this.schedule();
        this.render();
        toast.success('Proyecto creado desde GitHub');
      }).catch((err) => {
        if(err && (err.code === 'auth' || err.code === 'scopes')) api.setToken('');
        this.render();
        throw err;
      });
    }

    unlink(){
      this.sync.unlink().then(() => {
        this.schedule();
        this.render();
        toast.success('Proyecto desconectado de GitHub');
      });
    }
  }

  Workhub.controllers.GithubController = GithubController;
})();
