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

    openNew(){
      if(!this.projects.isReady()) return;
      this.view.openNew();
    }

    openEdit(id){
      const p = this.projects.get(id || this.app.projectId);
      if(p) this.view.openEdit(p, p.id !== ProjectModel.MAIN_ID, this.projects.configOf(p));
    }

    save(id, nombre, color, config){
      if(!this.projects.isReady()) return;
      this.view.setBusy(true);
      if(!id){
        this.projects.create(nombre, color, config).then((ref) => {
          this.justCreated = ref.id;
          this.app.rememberProject(Object.assign({id:ref.id, nombre:nombre, color:color}, config));
          this.view.closeDialog();
          this.app.switchProject(ref.id, false);
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
