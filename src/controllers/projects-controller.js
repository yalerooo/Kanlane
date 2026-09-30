/* Proyectos: cambiar de proyecto, crearlos, editarlos y eliminarlos. */
(function(){
  const toast = Workhub.views.toast;
  const ProjectModel = Workhub.models.ProjectModel;

  class ProjectsController {
    constructor(app, view){
      this.app = app;
      this.projects = app.models.projects;
      this.view = view;

      this.projects.on('change', () => {
        this.onProjectsChange();
        /* Un instante después: ProjectModel marca "loaded" en su propio listener, que va detrás de este. */
        Promise.resolve().then(() => this.checkFirstRun());
      });

      this.view.bindMenuSource(() => ({
        projects: this.projects.list(),
        currentId: this.app.projectId,
        hueOf: (p) => this.projects.hueOf(p)
      }));
      this.view.bindMenu({
        pick: (id) => this.app.switchProject(id, true),
        edit: (id) => this.openEdit(id),
        create: () => this.openNew()
      });
      this.view.bindSubmit((id, nombre, color, config) => this.save(id, nombre, color, config));
      this.view.bindDelete((id) => this.remove(id));
      /* «Desde GitHub»: crea el proyecto con las columnas y los elementos de un GitHub Project. */
      this.view.bindGithubSubmit((v) => {
        if(!this.projects.isReady()) return;
        this.view.setBusy(true);
        this.app.controllers.github.createFromGithub(v).then(() => {
          this.view.closeDialog();
        }).catch((err) => {
          this.view.setBusy(false);
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
      /* Se eliminó el último proyecto: hay que crear uno nuevo. */
      if(!this.projects.list().length){ this.startFirstRun(); return; }
      if(this.firstRunChecked) return;
      this.firstRunChecked = true;
      if(this.projects.items.length) return;
      const db = this.app.rootDb;
      const empty = ['tasks', 'clients', 'contacts', 'meetings', 'vault'].map((name) =>
        db.collection(name).get().then((snap) => !snap.docs.length));
      Promise.all(empty).then((flags) => {
        if(!flags.every(Boolean) || this.projects.items.length) return;
        this.startFirstRun();
      }).catch(() => { this.firstRunChecked = false; });
    }

    startFirstRun(){
      if(this.firstRun) return;
      this.firstRun = true;
      document.body.classList.add('is-onboarding');
      this.view.openOnboarding();
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

    render(){
      const p = this.current();
      this.view.renderCurrent(p, this.projects.hueOf(p));
      this.app.applyProjectConfig(this.projects.configOf(p));
      this.applyLabels(p);
      document.title = this.projects.list().length > 1 ? p.nombre + ' · Workhub' : 'Workhub';
    }

    /* Si el proyecto abierto ya no existe (borrado desde otro dispositivo, o el
       recordado en este navegador es de otra cuenta), se pasa a otro. Si no
       queda ninguno, checkFirstRun pide crear uno. */
    onProjectsChange(){
      const id = this.app.projectId;
      if(this.projects.loaded && !this.projects.exists(id) && id !== this.justCreated){
        const next = this.projects.list()[0];
        if(next){
          this.app.switchProject(next.id, false);
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

    /* Etiqueta nueva desde el formulario de tarea. */
    addLabel(name, color){
      const p = this.current();
      if(!p || !this.projects.isReady()) return Promise.resolve(false);
      const list = this.labels();
      if(list.some((l) => l.name.toLowerCase() === name.toLowerCase())) return Promise.resolve(true);
      return this.projects.patch(p.id, {labels:list.concat({name:name, color:color}).slice(0, 200)}).then(() => true, () => false);
    }

    /* Cambia las etapas del proyecto abierto desde el tablero (renombrar, color,
       límite, orden…). fn recibe una copia editable y puede devolver false para
       cancelar. Un proyecto de un tipo predefinido pasa a ser personalizado. */
    updateStages(fn){
      const PT = Workhub.models.ProjectTemplates;
      const p = this.current();
      if(!p || !this.projects.isReady()) return Promise.resolve(false);
      const cfg = this.projects.configOf(p);
      const stages = cfg.stages.map((s) => Object.assign({}, s));
      if(fn(stages) === false) return Promise.resolve(false);
      const clean = PT.normalizeStages(stages);
      if(clean.length < PT.MIN_STAGES) return Promise.resolve(false);
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
      this.view.openNew();
    }

    openEdit(id){
      const p = this.projects.get(id || this.app.projectId);
      if(p) this.view.openEdit(p, true, this.projects.configOf(p));
    }

    /* Crea un proyecto y lo abre. Devuelve la referencia del documento nuevo. */
    createAndOpen(nombre, color, config){
      return this.projects.create(nombre, color, config).then((ref) => {
        this.justCreated = ref.id;
        this.app.rememberProject(Object.assign({id:ref.id, nombre:nombre, color:color}, config));
        this.app.switchProject(ref.id, false);
        return ref;
      });
    }

    save(id, nombre, color, config){
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
        }).catch(() => {
          this.firstRunSaving = false;
          this.view.setBusy(false);
          this.view.showError('No se pudo crear el proyecto. Inténtalo de nuevo.');
        });
        return;
      }
      if(!id){
        this.createAndOpen(nombre, color, config).then(() => {
          this.view.closeDialog();
          toast.success('Proyecto «' + nombre + '» creado');
        }).catch(() => {
          this.view.setBusy(false);
          this.view.showError('No se pudo crear el proyecto. Inténtalo de nuevo.');
        });
        return;
      }
      this.projects.save(id, nombre, color, config).then(() => {
        this.view.closeDialog();
        this.render();
        toast.success('Proyecto guardado');
      }).catch(() => {
        this.view.setBusy(false);
        this.view.showError('No se pudo guardar el proyecto. Inténtalo de nuevo.');
      });
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
