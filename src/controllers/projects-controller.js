/* Proyectos: cambiar de proyecto, crearlos, editarlos y eliminarlos. */
(function(){
  const toast = Workhub.views.toast;
  const ProjectModel = Workhub.models.ProjectModel;

  class ProjectsController {
    constructor(app, view){
      this.app = app;
      this.projects = app.models.projects;
      this.view = view;

      this.projects.on('change', () => this.onProjectsChange());

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

    /* Mientras llega la lista (o justo tras crear uno) se usa la copia que
       guarda este navegador, para no enseñar un nombre equivocado. */
    current(){
      const id = this.app.projectId;
      const found = this.projects.loaded || id === ProjectModel.MAIN_ID ? this.projects.get(id) : null;
      if(found) return found;
      const cached = this.app.cachedProject();
      if(cached && cached.id === id) return cached;
      return this.projects.get(ProjectModel.MAIN_ID);
    }

    render(){
      const p = this.current();
      this.view.renderCurrent(p, this.projects.hueOf(p));
      this.app.applyProjectConfig(this.projects.configOf(p));
      this.applyLabels(p);
      document.title = this.projects.list().length > 1 ? p.nombre + ' · Workhub' : 'Workhub';
    }

    /* Si el proyecto abierto ya no existe (borrado desde otro dispositivo, o el
       recordado en este navegador es de otra cuenta), se vuelve al principal. */
    onProjectsChange(){
      const id = this.app.projectId;
      if(this.projects.loaded && !this.projects.exists(id) && id !== this.justCreated){
        this.app.switchProject(ProjectModel.MAIN_ID, false);
        return;
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
      if(p) this.view.openEdit(p, p.id !== ProjectModel.MAIN_ID, this.projects.configOf(p));
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
      if(!p || id === ProjectModel.MAIN_ID) return;
      this.view.setBusy(true, 'Eliminando…');
      this.app.deleteProject(id).then(() => {
        this.view.closeDialog();
        toast.success('Proyecto «' + p.nombre + '» eliminado');
      }).catch(() => {
        this.view.setBusy(false);
        this.view.showError('No se pudo eliminar del todo. Vuelve a intentarlo: lo que ya se borró no se recupera.');
      });
    }
  }

  Workhub.controllers.ProjectsController = ProjectsController;
})();
