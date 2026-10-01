/* Exportar e importar copias de seguridad. */
(function(){
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;
  const history = Workhub.services.backupHistory;
  const NOT_READY = 'El tablero todavía se está cargando, prueba de nuevo en unos segundos.';
  const DAY = 24 * 60 * 60 * 1000;
  const cloud = Workhub.services.cloudBackup;

  class BackupController {
    constructor(app, view){
      this.app = app;
      this.backup = app.models.backup;
      this.view = view;

      this.view.bindExport(() => this.exportData());
      this.view.bindImport((data) => this.importData(data));
      this.view.bindSaveVersion(() => this.saveVersion());
      this.view.bindHistory((action, id) => this.historyAction(action, id));
      this.view.bindCloud({
        enable: () => this.enableCloud(),
        useKey: (key) => this.useCloudKey(key),
        forget: () => this.forgetCloudKey(),
        copy: (key) => navigator.clipboard.writeText(key).then(() => this.view.showStatus('Clave copiada. Guárdala fuera de Kanlane.')).catch(() => this.view.showError('No se pudo copiar la clave. Selecciónala y cópiala manualmente.')),
        save: () => this.saveCloudVersion(),
        action: (action, id) => this.cloudAction(action, id)
      });
      setInterval(() => this.autoSave(), 60 * 60 * 1000);
    }

    scope(){
      if(!this.app.rootDb || !this.app.projectId) return '';
      const account = this.app.rootDb.me && this.app.rootDb.me.uid || 'local';
      return Workhub.services.platform.mode() + ':' + account + ':' + this.app.projectId;
    }

    onShow(){ this.refreshHistory(); this.refreshCloud(); }

    cloudContext(){
      const project = this.app.controllers.projects.current();
      if(Workhub.services.platform.mode() !== 'firebase' || !this.app.rootDb?.me?.uid || !project || project.team) return null;
      return {db:this.app.rootDb, uid:this.app.rootDb.me.uid, projectId:this.app.projectId};
    }

    refreshCloud(){
      const context = this.cloudContext();
      if(!context){
        this.view.cloudHead.hidden = true;
        this.view.cloudSetup.hidden = true;
        this.view.cloudHistory.hidden = true;
        this.view.cloudKeyWrap.hidden = true;
        this.view.cloudForget.hidden = true;
        return;
      }
      cloud.listAny(context.db).then((entries) => {
        if(this.cloudContext()?.projectId === context.projectId){
          this.cloudEntries = entries;
          this.view.showCloud(!!cloud.getKey(context.uid), entries, context.projectId);
        }
      }).catch(() => this.view.showError('No se pudieron consultar las copias cifradas de tu cuenta.'));
    }

    enableCloud(){
      const context = this.cloudContext();
      if(!context) return;
      cloud.listAny(context.db).then((entries) => {
        if(entries.length) throw new Error('existing-backups');
        const key = cloud.createKey(context.uid);
        this.view.revealCloudKey(key);
        this.view.showStatus('Copias cifradas activadas. Guarda la clave de recuperación antes de cerrar esta página.');
        this.refreshCloud();
        this.saveCloudVersion();
      }).catch((error) => this.view.showError(error.message === 'existing-backups' ?
        'Ya hay copias en esta cuenta. Introduce la clave de recuperación original.' : 'No se pudieron activar las copias cifradas en este navegador.'));
    }

    useCloudKey(key){
      const context = this.cloudContext();
      if(!context) return;
      cloud.listAny(context.db).then((entries) => {
        if(entries.length) return cloud.get(context.db, entries[0].id, entries[0].projectId, key);
      }).then(() => {
        cloud.setKey(context.uid, key);
        this.view.clearImportedKey();
        this.view.showStatus('Clave aceptada. Ya puedes recuperar las copias de tu cuenta.');
        this.refreshCloud();
      }).catch(() => this.view.showError('La clave no es válida o no abre las copias de esta cuenta.'));
    }

    forgetCloudKey(){
      const context = this.cloudContext();
      if(!context || !confirm('¿Dejar de guardar copias automáticas en la nube en este navegador? Las versiones ya guardadas seguirán en tu cuenta.')) return;
      cloud.forgetKey(context.uid);
      this.view.cloudKeyWrap.hidden = true;
      this.view.cloudKey.value = '';
      this.view.showStatus('Las copias automáticas en la nube están desactivadas en este navegador.');
      this.refreshCloud();
    }

    saveCloudVersion(silent){
      const context = this.cloudContext();
      if(!context || !this.backup.isReady() || this.savingCloud) return;
      const key = cloud.getKey(context.uid);
      if(!key) return;
      this.savingCloud = true;
      if(!silent) this.view.setCloudBusy(true);
      const project = this.app.controllers.projects.current();
      this.backup.build(project.nombre).then((copy) => {
        if(this.cloudContext()?.projectId !== context.projectId) throw new Error('project-changed');
        return cloud.save(context.db, context.projectId, copy, key);
      }).then(() => {
        if(!silent) this.view.showStatus('Copia cifrada guardada en tu cuenta.');
        if(this.app.shell.isVisible('data')) this.refreshCloud();
      }).catch((error) => {
        if(!silent || this.app.shell.isVisible('data')) this.view.showError(error.message === 'backup-too-large' ?
          'La copia supera el límite de 4,8 MB cifrados. Descarga un archivo de copia para conservarla.' : 'No se pudo guardar la copia cifrada en tu cuenta.');
      }).finally(() => { this.savingCloud = false; this.view.setCloudBusy(false); });
    }

    autoCloudSave(){
      const context = this.cloudContext();
      if(!context || !cloud.getKey(context.uid) || this.savingCloud) return;
      cloud.list(context.db, context.projectId).then((entries) => {
        if(!entries.length || Date.now() - entries[0].createdAt >= DAY) this.saveCloudVersion(true);
      }).catch(() => {});
    }

    cloudAction(action, id){
      const context = this.cloudContext();
      if(!context) return;
      const key = cloud.getKey(context.uid);
      if(action === 'delete'){
        if(!confirm('¿Borrar esta copia cifrada de tu cuenta?')) return;
        cloud.remove(context.db, id).then(() => this.refreshCloud()).catch(() => this.view.showError('No se pudo borrar la copia cifrada.'));
        return;
      }
      const entry = this.cloudEntries?.find((item) => item.id === id);
      if(!entry) return;
      if(action === 'restore' && entry.projectId !== context.projectId &&
          !confirm('Esta copia pertenece a otro proyecto. ¿Importar sus datos en el proyecto abierto?')) return;
      cloud.get(context.db, id, entry.projectId, key).then((data) => {
        if(this.cloudContext()?.projectId !== context.projectId) return;
        if(action === 'restore') this.importData(data);
        if(action === 'download') return platform.download('workhub-backup-' + entry.projectId + '.json', JSON.stringify(data, null, 2));
      }).catch(() => this.view.showError('No se pudo abrir la copia. Comprueba la clave de recuperación.'));
    }

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
      this.autoCloudSave();
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
