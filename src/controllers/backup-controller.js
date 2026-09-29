/* Exportar e importar copias de seguridad. */
(function(){
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;
  const NOT_READY = 'El tablero todavía se está cargando, prueba de nuevo en unos segundos.';

  class BackupController {
    constructor(app, view){
      this.app = app;
      this.backup = app.models.backup;
      this.view = view;

      this.view.bindExport(() => this.exportData());
      this.view.bindImport((data) => this.importData(data));
    }

    exportData(){
      if(!this.backup.isReady()){
        this.view.showError(NOT_READY);
        return;
      }
      this.view.setExporting(true);
      this.backup.build().then((result) => {
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
