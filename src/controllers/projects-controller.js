/* Proyectos: cambiar de proyecto, crearlos, editarlos y eliminarlos. */
(function(){
  const toast = Workhub.views.toast;
  const ProjectModel = Workhub.models.ProjectModel;

  class ProjectsController {
    constructor(app, view){
      this.app = app;
      this.projects = app.models.projects;
      this.view = view;

      app.models.team.incoming.on('change', () => this.onInvitesChange());
      this.projects.on('change', () => {
        this.onProjectsChange();
        /* Un instante después: ProjectModel marca "loaded" en su propio listener, que va detrás de este. */
        Promise.resolve().then(() => this.checkFirstRun());
      });

      this.view.bindMenuSource(() => ({
        projects: this.projects.list(),
        currentId: this.app.projectId,
        hueOf: (p) => this.projects.hueOf(p),
        invites: this.invites(),
        canShare: this.app.models.team.enabled()
      }));
      this.view.bindMenu({
        pick: (id) => this.app.switchProject(id),
        edit: (id) => this.openEdit(id),
        create: () => this.openNew(),
        share: () => this.app.controllers.team.open(),
        accept: (id) => this.acceptInvite(id),
        decline: (id) => this.declineInvite(id)
      });
      this.view.bindInviteActions({
        accept: (id) => this.acceptInvite(id),
        decline: (id) => this.declineInvite(id)
      });
      this.view.bindSubmit((id, nombre, color, config, seed) => this.save(id, nombre, color, config, seed));
      this.view.bindDelete((id) => this.remove(id));
      /* Cifrado total: pasos de privacidad del asistente y ajustes de privacidad al editar. */
      const crypto = app.controllers.crypto;
      this.view.bindEncryption({
        check: (pw, nombre) => crypto.check(pw, nombre),
        prepare: () => crypto.prepare(),
        reset: () => crypto.resetWizard(),
        download: (text, nombre) => crypto.download(text, nombre),
        create: (d) => this.createEncrypted(d),
        action: (kind, id) => {
          if(kind === 'convert'){ this.app.controllers.convert.start(id); return; }
          if(kind === 'forget') this.view.closeDialog();
          crypto.action(kind, id);
        }
      });
      /* «Conectar con GitHub» sin pegar un token. */
      this.view.bindGithubOAuth(() => {
        const g = this.app.controllers.github;
        g.connectOAuth().then((ok) => {
          if(ok) this.view.refreshGithub();
          else if(g.connectError) this.view.showError(g.connectError);
        });
      });
      /* «Desde GitHub»: crea el proyecto con las columnas y los elementos de un GitHub Project. */
      this.view.bindGithubSubmit((v) => {
        if(!this.projects.isReady()) return;
        this.view.setBusy(true);
        this.app.controllers.github.createFromGithub(v).then(() => {
          this.view.closeDialog();
        }).catch((err) => {
          this.view.setBusy(false);
          /* Aviso de GitHub cancelado: se vuelve al formulario sin error. */
          if(err && err.code === 'cancelled') return;
          this.view.showError((err && err.message) || 'No se pudo conectar con GitHub.');
        });
      });
    }

    /* Cuenta nueva: sin proyectos y sin datos en la raíz. No se crea ninguno por
       defecto: se obliga a crear el primero, con el nombre y el tipo que elija.
       Ese primero ocupa el sitio del proyecto principal (la raíz de la base de
       datos), así que las cuentas que ya tienen datos no cambian nada. */
    checkFirstRun(){
      if(!this.projects.loaded || !this.app.rootDb || this.firstRun || this.firstRunSaving) return;
      /* Se están copiando a la cuenta los proyectos del modo invitado (AuthController): ya llegan. */
      if(this.app.controllers.auth && this.app.controllers.auth.migrating) return;
      /* Se está eliminando la cuenta (AccountController): los proyectos desaparecen a propósito. */
      if(this.app.closingAccount) return;
      /* Se eliminó el último proyecto: hay que crear uno nuevo. */
      if(!this.projects.list().length){ this.startFirstRun(); return; }
      if(this.firstRunChecked) return;
      this.firstRunChecked = true;
      if(this.projects.items.length || this.projects.teamItems.length) return;
      const db = this.app.rootDb;
      const empty = ['tasks', 'clients', 'contacts', 'meetings', 'vault'].map((name) =>
        db.collection(name).get().then((snap) => !snap.docs.length));
      Promise.all(empty).then((flags) => {
        if(!flags.every(Boolean) || this.projects.items.length || this.projects.teamItems.length) return;
        this.startFirstRun();
      }).catch(() => { this.firstRunChecked = false; });
    }

    startFirstRun(){
      if(this.firstRun) return;
      this.firstRun = true;
      window.__hideBootSkeleton();
      document.body.classList.add('is-onboarding');
      this.view.setPrivacyAvailable(this.app.controllers.crypto.canCreate(), this.app.controllers.crypto.canCreateManaged());
      this.view.openOnboarding();
      /* Si ya te habían invitado a un equipo, puedes aceptarlo en vez de crear uno. */
      this.view.renderInvites(this.invites());
    }

    finishFirstRun(){
      this.firstRun = false;
      document.body.classList.remove('is-onboarding');
      this.view.endOnboarding();
      this.view.closeDialog();
      this.app.navigate('tasks');
    }

    /* Mientras llega la lista (o justo tras crear uno) se usa la copia que
       guarda este navegador, para no enseñar un nombre equivocado. */
    current(){
      const id = this.app.projectId;
      const found = this.projects.loaded || id === ProjectModel.MAIN_ID ? this.projects.get(id) : null;
      if(found) return found;
      const cached = this.app.cachedProject();
      if(cached && cached.id === id) return cached;
      /* Sin proyectos (recién eliminados): un marcador hasta que se cree el primero. */
      return this.projects.get(ProjectModel.MAIN_ID) || {id:ProjectModel.MAIN_ID, nombre:Workhub.t('Proyecto principal')};
    }

    /* Invitaciones que ha recibido mi correo. */
    invites(){
      return this.app.models.team.incoming.items.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    /* Llegó, se aceptó o se canceló una invitación. */
    onInvitesChange(){
      const list = this.invites();
      this.view.setInviteBadge(list.length);
      if(this.firstRun) this.view.renderInvites(list);
    }

    acceptInvite(id){
      const inv = this.invites().find((i) => i.id === id);
      if(!inv) return;
      const joined = () => {
        /* Cuando el equipo llegue a la lista se abre (ver onProjectsChange). */
        this.pendingSwitch = Workhub.models.ProjectModel.teamKey(inv.teamId);
        this.onProjectsChange();
      };
      /* Equipo con cifrado total: hacen falta el código de acceso y una contraseña de cifrado propia. */
      if(inv.enc){
        this.app.controllers.teamCrypto.openJoin(inv, joined);
        return;
      }
      this.app.models.team.accept(inv).then(joined, () => toast.error('No se pudo aceptar la invitación. Puede que ya no exista.'));
    }

    declineInvite(id){
      const inv = this.invites().find((i) => i.id === id);
      if(inv) this.app.models.team.decline(inv).catch(() => toast.error('No se pudo rechazar la invitación.'));
    }

    /* Contexto de equipo del proyecto abierto: miembros, mi rol y qué se ve. */
    applyTeam(p){
      const T = Workhub.views.team;
      const me = this.projects.rootDb && this.projects.rootDb.me ? this.projects.rootDb.me.uid : '';
      T.set(p, this.projects.membersOf(p), me);
      document.body.classList.toggle('team-project', T.enabled());
      document.body.classList.toggle('is-readonly', !T.canEdit());
      const sig = T.signature();
      if(sig === this.teamSig) return;
      this.teamSig = sig;
      this.app.shell.setTeamMode(T.enabled());
      const t = this.app.controllers.tasks;
      if(t) t.applyTeam();
    }

    render(){
      const p = this.current();
      this.view.renderCurrent(p, this.projects.hueOf(p));
      this.app.applyProjectConfig(this.projects.configOf(p));
      this.applyLabels(p);
      this.applyCustomFields(p);
      this.applyTeam(p);
      document.title = this.projects.list().length > 1 ? p.nombre + ' · Kanlane' : 'Kanlane';
    }

    /* Si el proyecto abierto ya no existe (borrado desde otro dispositivo, o el
       recordado en este navegador es de otra cuenta), se pasa a otro. Si no
       queda ninguno, checkFirstRun pide crear uno. */
    onProjectsChange(){
      /* Acabo de aceptar una invitación: abre ese equipo en cuanto llegue. */
      if(this.pendingSwitch && this.projects.exists(this.pendingSwitch)){
        const key = this.pendingSwitch;
        this.pendingSwitch = null;
        if(this.firstRun){
          /* Cuenta nueva que entra en un equipo: no se queda con un proyecto vacío por defecto. */
          this.projects.set(ProjectModel.MAIN_ID, {deleted:true, createdAt:0});
          this.finishFirstRun();
        }
        this.justCreated = key;
        this.app.switchProject(key);
        return;
      }
      const id = this.app.projectId;
      if(this.projects.loaded && !this.projects.exists(id) && id !== this.justCreated){
        const next = this.projects.list()[0];
        if(next){
          this.app.switchProject(next.id);
          return;
        }
      }
      if(this.projects.exists(id)) this.justCreated = null;
      const p = this.current();
      if(p.id === id) this.app.rememberProject(p);
      this.render();
    }

    /* Catálogo de etiquetas del proyecto abierto; repinta si cambia. */
    labels(){
      const p = this.current();
      return p && Array.isArray(p.labels) ? p.labels : [];
    }

    applyLabels(p){
      const list = Array.isArray(p.labels) ? p.labels : [];
      const sig = JSON.stringify(list);
      if(sig === this.labelsSig) return;
      this.labelsSig = sig;
      Workhub.views.labels.setCatalog(list);
      const t = this.app.controllers.tasks;
      if(t){ t.render(); t.refreshDetail(); t.dialog.setLabelCatalog(list); }
    }

    /* Campos personalizados del proyecto abierto (models/custom-fields.js). */
    customFields(){
      const p = this.current();
      return Workhub.models.CustomFields.normalize(p && p.customFields);
    }

    applyCustomFields(p){
      const list = Workhub.models.CustomFields.normalize(p && p.customFields);
      const sig = JSON.stringify(list);
      if(sig === this.fieldsSig) return;
      this.fieldsSig = sig;
      Workhub.views.fields.set(list);
      const t = this.app.controllers.tasks;
      if(t){ t.render(); t.refreshDetail(); }
    }

    /* Guarda las definiciones (crear, renombrar, ordenar, quitar). Se ve al instante. */
    saveCustomFields(list){
      const p = this.current();
      if(!p || !this.projects.isReady() || !Workhub.views.team.canEdit()) return Promise.resolve(false);
      const clean = Workhub.models.CustomFields.normalize(list);
      this.applyCustomFields({customFields:clean});
      return this.projects.patch(p.id, {customFields:clean.length ? clean : null}).then(() => true, () => {
        this.applyCustomFields(this.current());
        return false;
      });
    }

    /* Etiqueta nueva desde el formulario de tarea. */
    addLabel(name, color){
      const p = this.current();
      if(!p || !this.projects.isReady()) return Promise.resolve(false);
      const list = this.labels();
      if(list.some((l) => l.name.toLowerCase() === name.toLowerCase())) return Promise.resolve(true);
      return this.projects.patch(p.id, {labels:list.concat({name:name, color:color}).slice(0, 1000)}).then(() => true, () => false);
    }

    /* Cambia las etapas del proyecto abierto desde el tablero (renombrar, color,
       límite, orden, archivar…). fn recibe una copia editable de todas, también
       las archivadas (archived: true), y puede devolver false para cancelar. Un
       proyecto de un tipo predefinido pasa a ser personalizado. */
    updateStages(fn){
      const PT = Workhub.models.ProjectTemplates;
      const p = this.current();
      if(!p || !this.projects.isReady()) return Promise.resolve(false);
      const cfg = this.projects.configOf(p);
      const stages = PT.allStages(p);
      if(fn(stages) === false) return Promise.resolve(false);
      const clean = PT.normalizeStages(stages);
      if(clean.filter((s) => !s.archived).length < PT.MIN_STAGES) return Promise.resolve(false);
      const fields = PT.fieldsFor(PT.CUSTOM_TYPE, clean, cfg.clients);
      const next = Object.assign({}, p, fields);
      /* Se ve al instante; la base de datos confirma después. */
      this.app.rememberProject(next);
      this.app.applyProjectConfig(PT.resolve(next));
      return this.projects.save(p.id, p.nombre, typeof p.color === 'number' ? p.color : null, fields)
        .then(() => true)
        .catch(() => { toast.error('No se pudo guardar el cambio'); return false; });
    }

    openNew(){
      if(!this.projects.isReady()) return;
      this.view.setPrivacyAvailable(this.app.controllers.crypto.canCreate(), this.app.controllers.crypto.canCreateManaged());
      this.view.openNew();
    }

    openEdit(id){
      const p = this.projects.get(id || this.app.projectId);
      if(!p) return;
      this.view.openEdit(p, true, this.projects.configOf(p));
      /* La privacidad se elige al crear el proyecto; después solo se puede pasar de «Solo contraseñas»
         a «Cifrado total». Solo existe con cuenta. */
      this.view.setPrivacyInfo(this.app.controllers.crypto.me
        ? {encrypted:ProjectModel.isEncrypted(p), managed:ProjectModel.isManaged(p), canRotate:this.app.controllers.rotation.canRotate(p),
          canConvert:this.app.controllers.convert.canConvert(p)} : null);
    }

    /* Proyecto con cifrado total, desde el último paso del asistente: d = {nombre, color, config,
       password, trusted}. O gestionado por Kanlane, desde el paso de privacidad: d = {nombre, color,
       config, managed:true}. */
    createEncrypted(d){
      if(!this.projects.isReady()) return;
      const first = this.firstRun;
      /* Las tareas con las que nace (plantilla o Trello) se escriben después, ya con el cifrado puesto. */
      const seed = d.seed || null;
      d = Object.assign({}, d);
      delete d.seed;
      this.view.setEncBusy(true);
      if(first) this.firstRunSaving = true;
      this.app.controllers.crypto.create(Object.assign({id:first ? ProjectModel.MAIN_ID : null}, d)).then((id) => {
        this.seedProject(id, seed, true);
        if(first){
          setTimeout(() => { this.firstRunSaving = false; }, 1500);
          this.finishFirstRun();
          this.app.rememberProject({id:id, nombre:d.nombre, color:d.color, enc:true});
          this.app.connectProject();
          this.render();
        } else {
          this.justCreated = id;
          this.app.rememberProject(Object.assign({id:id, nombre:d.nombre, color:d.color, enc:true}, d.config));
          this.app.switchProject(id);
          this.view.closeDialog();
        }
        toast.success(Workhub.t(d.managed ? 'Proyecto «{nombre}» creado con cifrado gestionado por Kanlane' : 'Proyecto «{nombre}» creado con cifrado total', {nombre:d.nombre}), {important:true});
      }).catch((err) => {
        this.firstRunSaving = false;
        this.view.setEncBusy(false);
        this.view.showError(this.app.controllers.crypto.createError(err));
      });
    }

    /* Crea un proyecto y lo abre. Devuelve la referencia del documento nuevo. */
    createAndOpen(nombre, color, config){
      return this.projects.create(nombre, color, config).then((ref) => {
        this.justCreated = ref.id;
        this.app.rememberProject(Object.assign({id:ref.id, nombre:nombre, color:color}, config));
        this.app.switchProject(ref.id);
        return ref;
      });
    }

    /* Rellena un proyecto recién creado con las tareas de su semilla (plantilla o tablero de Trello;
       ver project-seed.js). Espera a que el tablero esté conectado a ese proyecto, con su cifrado si
       lo tiene, y deja de escribir si se abre otro. */
    seedProject(id, seed, encrypted){
      if(!seed || !Array.isArray(seed.tasks) || !seed.tasks.length) return Promise.resolve();
      const tasks = this.app.models.tasks;
      const total = seed.tasks.length;
      const here = () => this.app.projectId === id && tasks.isReady() && !!tasks.cipher === !!encrypted;
      const ready = new Promise((resolve, reject) => {
        const until = Date.now() + 60000;
        const tick = () => {
          if(here()) resolve();
          else if(Date.now() > until) reject(new Error('timeout'));
          else setTimeout(tick, 100);
        };
        tick();
      });
      return ready.then(() => {
        const col = tasks.col;
        return Workhub.models.ProjectSeed.write(tasks, seed, {alive:() => this.app.projectId === id && tasks.col === col});
      }).then((res) => {
        if(res.failed){
          toast.error(Workhub.t('Solo se crearon {done} de {total} tareas. El resto no se pudo guardar.', {done:res.tasks, total:total}), {important:true});
        } else if(seed.source === 'trello'){
          toast.success(Workhub.t('Tablero de Trello importado: {n} tareas', {n:res.tasks}), {important:true});
        }
        return res;
      }, () => {
        toast.error('No se pudieron crear las tareas del proyecto.', {important:true});
        return null;
      });
    }

    save(id, nombre, color, config, seed){
      if(!this.projects.isReady()) return;
      this.view.setBusy(true);
      if(!id && this.firstRun){
        /* El primero es el proyecto principal, con lo que haya elegido el usuario. */
        this.firstRunSaving = true;
        this.projects.save(ProjectModel.MAIN_ID, nombre, color, config).then(() => {
          setTimeout(() => { this.firstRunSaving = false; }, 1500);
          this.finishFirstRun();
          this.render();
          toast.success('Proyecto «' + nombre + '» creado');
          this.seedProject(ProjectModel.MAIN_ID, seed, false);
        }).catch(() => {
          this.firstRunSaving = false;
          this.view.setBusy(false);
          this.view.showError('No se pudo crear el proyecto. Inténtalo de nuevo.');
        });
        return;
      }
      if(!id){
        this.createAndOpen(nombre, color, config).then((ref) => {
          this.view.closeDialog();
          toast.success('Proyecto «' + nombre + '» creado');
          this.seedProject(ref.id, seed, false);
        }).catch(() => {
          this.view.setBusy(false);
          this.view.showError('No se pudo crear el proyecto. Inténtalo de nuevo.');
        });
        return;
      }
      config = this.keepArchived(id, config);
      this.confirmStages(id, config).then((ok) => {
        if(!ok){ this.view.setBusy(false); return null; }
        return this.projects.save(id, nombre, color, config).then(() => {
          this.view.closeDialog();
          this.render();
          toast.success('Proyecto guardado');
        });
      }).catch(() => {
        this.view.setBusy(false);
        this.view.showError('No se pudo guardar el proyecto. Inténtalo de nuevo.');
      });
    }

    /* El diálogo de proyecto solo enseña las columnas del tablero: al guardar, las archivadas
       siguen en el proyecto (salvo que una del tablero use ya su clave). */
    keepArchived(id, config){
      const PT = Workhub.models.ProjectTemplates;
      const p = this.projects.get(id);
      if(!p || !config || config.tipo !== PT.CUSTOM_TYPE || !Array.isArray(config.stages)) return config;
      const keys = config.stages.map((s) => s.key);
      const kept = this.projects.configOf(p).archived.filter((s) => keys.indexOf(s.key) === -1);
      return kept.length ? Object.assign({}, config, {stages:config.stages.concat(kept)}) : config;
    }

    /* Al guardar el proyecto abierto sin alguna de sus columnas: si una automatización la usaba, se
       avisa antes (quedará en pausa). → Promise<bool>: seguir o no. */
    confirmStages(id, config){
      const autos = this.app.controllers.automations;
      const p = this.projects.get(id);
      if(!autos || !p || id !== this.app.projectId) return Promise.resolve(true);
      const next = Workhub.models.ProjectTemplates.resolve(Object.assign({}, p, config)).stages.map((s) => s.key);
      const gone = this.projects.configOf(p).stages.filter((s) => next.indexOf(s.key) === -1);
      if(!gone.length) return Promise.resolve(true);
      return autos.warningFor(gone.map((s) => ({stage:s.key}))).then((warn) => (warn
        ? this.app.controllers.tasks.columns.confirm(gone.length === 1 ? 'Quitar una columna' : 'Quitar columnas',
          gone.length === 1 ? 'El proyecto se guardará sin la columna «' + gone[0].label + '».' : 'El proyecto se guardará sin ' + gone.length + ' de sus columnas.',
          'Guardar', warn)
        : true));
    }

    remove(id){
      const p = this.projects.get(id);
      if(!p) return;
      this.view.setBusy(true, 'Eliminando…');
      this.app.deleteProject(id).then(() => {
        /* Si era el último, el asistente de primer proyecto ya ocupa el diálogo. */
        if(!this.firstRun) this.view.closeDialog();
        Promise.resolve().then(() => this.checkFirstRun());
        toast.success('Proyecto «' + p.nombre + '» eliminado');
      }).catch(() => {
        this.view.setBusy(false);
        this.view.showError('No se pudo eliminar del todo. Vuelve a intentarlo: lo que ya se borró no se recupera.');
      });
    }
  }

  Workhub.controllers.ProjectsController = ProjectsController;
})();
