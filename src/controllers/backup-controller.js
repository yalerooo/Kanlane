/* Exportar e importar copias de seguridad. */
(function(){
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;
  const history = Workhub.services.backupHistory;
  const NOT_READY = 'El tablero todavía se está cargando, prueba de nuevo en unos segundos.';
  const DAY = 24 * 60 * 60 * 1000;

  class BackupController {
    constructor(app, view){
      this.app = app;
      this.backup = app.models.backup;
      this.view = view;

      this.view.bindExport(() => this.exportData());
      this.view.bindImport((data) => this.importData(data));
      this.view.bindSaveVersion(() => this.saveVersion());
      this.view.bindHistory((action, id) => this.historyAction(action, id));
      setInterval(() => this.autoSave(), 60 * 60 * 1000);
    }

    scope(){
      if(!this.app.rootDb || !this.app.projectId) return '';
      const account = this.app.rootDb.me && this.app.rootDb.me.uid || 'local';
      return Workhub.services.platform.mode() + ':' + account + ':' + this.app.projectId;
    }

    onShow(){ this.refreshHistory(); }

    refreshHistory(){
      const scope = this.scope();
      if(!scope) return;
      history.list(scope).then((entries) => {
        if(this.scope() === scope) this.view.renderHistory(entries);
      }).catch(() => this.view.showError('No se pueden leer las versiones guardadas en este navegador.'));
    }

    scheduleAuto(){
      clearTimeout(this.autoTimer);
      this.autoTimer = setTimeout(() => this.autoSave(), 20000);
    }

    autoSave(){
      if(document.hidden || !this.backup.isReady()) return;
      if(this.app.controllers.projects.firstRun ||
          !this.app.models.projects.list().some((project) => project.id === this.app.projectId)) return;
      const scope = this.scope();
      if(!scope || this.savingVersion) return;
      this.savingVersion = true;
      history.list(scope).then((entries) => {
        if(entries.length && Date.now() - entries[0].createdAt < DAY) return;
        const project = this.app.controllers.projects.current();
        if(!project) return;
        return this.backup.build(project.nombre).then((copy) => {
          if(this.scope() !== scope) return;
          return history.save(scope, copy).then(() => {
            if(this.app.shell.isVisible('data')) this.refreshHistory();
          });
        });
      }).catch(() => {}).finally(() => { this.savingVersion = false; });
    }

    saveVersion(){
      if(!this.backup.isReady()){ this.view.showError(NOT_READY); return; }
      const scope = this.scope();
      const project = this.app.controllers.projects.current();
      if(!scope || !project || this.savingVersion) return;
      this.savingVersion = true;
      this.view.setSavingVersion(true);
      this.backup.build(project.nombre).then((copy) => {
        if(this.scope() !== scope) throw new Error('project-changed');
        return history.save(scope, copy);
      }).then(() => {
        this.view.showStatus('Versión guardada en este navegador.');
        this.refreshHistory();
      }).catch(() => this.view.showError('No se pudo guardar la versión en este navegador.'))
        .finally(() => { this.savingVersion = false; this.view.setSavingVersion(false); });
    }

    historyAction(action, id){
      const scope = this.scope();
      history.get(id).then((entry) => {
        if(!entry || entry.scope !== scope || this.scope() !== scope) throw new Error('missing-version');
        if(action === 'download') return platform.download(entry.filename, entry.json);
        if(action === 'restore'){
          this.importData(JSON.parse(entry.json));
          return;
        }
        if(action === 'delete') return history.remove(id).then(() => this.refreshHistory());
      }).catch(() => this.view.showError('No se pudo abrir esta versión.'));
    }

    exportData(){
      if(!this.backup.isReady()){
        this.view.showError(NOT_READY);
        return;
      }
      this.view.setExporting(true);
      this.backup.build(this.app.controllers.projects.current().nombre).then((result) => {
        return platform.download(result.filename, result.json).then(() => {
          const c = result.counts;
          toast.success('Copia de seguridad descargada');
          this.view.showStatus('Copia descargada: ' + c.tasks + ' tareas, ' + c.meetings + ' reuniones, ' + c.contacts + ' contactos, ' + c.vault + ' contraseñas, ' + c.clients + ' clientes.');
        });
      }).catch(() => {
        this.view.showError('No se pudo generar o descargar la copia de seguridad.');
      }).finally(() => {
        this.view.setExporting(false);
      });
    }

    importData(data){
      if(!data || typeof data !== 'object'){
        this.view.showError('El archivo no tiene el formato esperado.');
        return;
      }
      if(!this.backup.isReady()){
        this.view.showError(NOT_READY);
        return;
      }
      this.backup.import(data).then((result) => {
        const c = result.counts;
        let msg = 'Importado: ' + c.clients + ' clientes, ' + c.tasks + ' tareas (' + c.notes + ' notas), ' + c.meetings + ' reuniones, ' + c.contacts + ' contactos, ' + c.vault + ' contraseñas.';
        if(result.vaultOutcome === 'skipped'){
          msg += ' Las contraseñas del archivo no se importaron porque este tablero ya tiene una contraseña maestra propia.';
        }
        this.view.showStatus(msg);
        toast.success('Copia importada');
        if(result.vaultOutcome === 'imported') this.app.controllers.vault.onImported();
        this.view.resetImport();
      }).catch(() => {
        this.view.showError('Hubo un problema importando el archivo — puede que solo se haya importado una parte.');
      });
    }
  }

  Workhub.controllers.BackupController = BackupController;
})();
