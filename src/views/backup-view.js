/* Copia de seguridad: botones de exportar/importar y mensajes de resultado. */
(function(){
  const $ = (id) => document.getElementById(id);

  /* Icono de cada versión guardada (un reloj: es una copia de un momento). */
  function versionIcon(){
    const ic = document.createElement('span');
    ic.className = 'backup-version-ic';
    ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
    return ic;
  }

  class BackupView {
    constructor(){
      this.btnExport = $('btnExportData');
      this.importInput = $('importFileInput');
      this.error = $('dataError');
      this.status = $('dataStatus');
      this.history = $('backupHistory');
      this.btnSaveVersion = $('btnSaveBackupVersion');
      this.cloudHead = $('cloudBackupHead');
      this.cloudSetup = $('cloudBackupSetup');
      this.cloudKeyWrap = $('cloudBackupKeyWrap');
      this.cloudHistory = $('cloudBackupHistory');
      this.cloudSave = $('btnSaveCloudBackup');
      this.cloudEnable = $('btnEnableCloudBackup');
      this.cloudImportKey = $('cloudBackupImportKey');
      this.cloudUseKey = $('btnUseCloudBackupKey');
      this.cloudKey = $('cloudBackupKey');
      this.cloudForget = $('btnForgetCloudBackupKey');
      this.btnExportPlain = $('btnExportPlain');
      this.exportEncHelp = $('exportEncHelp');
      this.keyDlg = $('dlgBackupKey');
      this.keySecret = $('bkSecret');
      this.keyNote = $('bkPlainNote');
      this.keyError = $('bkError');
      this.keySubmit = $('bkSubmit');
      this.encrypted = false;
    }

    bindExport(handler){ this.btnExport.addEventListener('click', () => handler()); }
    bindExportPlain(handler){ this.btnExportPlain.addEventListener('click', () => handler()); }

    /* Proyecto con cifrado total: la copia sale cifrada y «Exportar sin cifrar» queda aparte. */
    setEncrypted(on){
      this.encrypted = !!on;
      this.btnExportPlain.hidden = !on;
      this.exportEncHelp.hidden = !on;
      if(!this.btnExport.disabled) this.btnExport.textContent = this.exportText();
    }

    exportText(){
      return this.encrypted ? 'Exportar copia cifrada' : 'Exportar copia de seguridad';
    }

    /* Archivo de copia cifrado: pide la contraseña de cifrado o la clave de recuperación.
       handler(texto) al enviar. */
    bindSecret(handler){
      $('bkForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.keyError.hidden = true;
        handler(this.keySecret.value);
      });
      $('bkCancel').addEventListener('click', () => this.closeSecret());
      this.keyDlg.addEventListener('close', () => {
        this.keySecret.value = '';
        this.keyError.hidden = true;
        this.setSecretBusy(false);
        this.resetImport();
      });
    }

    /* plainTarget: el proyecto abierto no tiene cifrado total. */
    askSecret(plainTarget){
      this.keyNote.hidden = !plainTarget;
      this.keySecret.value = '';
      this.keyError.hidden = true;
      this.setSecretBusy(false);
      this.keyDlg.showModal();
      this.keySecret.focus();
    }

    setSecretBusy(busy){
      this.keySubmit.disabled = busy;
      this.keySubmit.textContent = busy ? 'Comprobando…' : 'Importar';
    }

    showSecretError(msg){
      this.keyError.textContent = msg;
      this.keyError.hidden = false;
    }

    closeSecret(){
      if(this.keyDlg.open) this.keyDlg.close();
    }
    bindSaveVersion(handler){ this.btnSaveVersion.addEventListener('click', handler); }
    bindHistory(handler){
      this.history.addEventListener('click', (ev) => {
        const button = ev.target.closest('button[data-backup-action]');
        if(button) handler(button.getAttribute('data-backup-action'), button.getAttribute('data-id'));
      });
    }

    bindCloud(handlers){
      this.cloudEnable.addEventListener('click', handlers.enable);
      this.cloudUseKey.addEventListener('click', () => handlers.useKey(this.cloudImportKey.value.trim()));
      this.cloudSave.addEventListener('click', handlers.save);
      this.cloudForget.addEventListener('click', handlers.forget);
      $('btnCopyCloudBackupKey').addEventListener('click', () => handlers.copy(this.cloudKey.value));
      $('btnHideCloudBackupKey').addEventListener('click', () => { this.cloudKeyWrap.hidden = true; });
      this.cloudHistory.addEventListener('click', (ev) => {
        const button = ev.target.closest('button[data-cloud-action]');
        if(button) handlers.action(button.dataset.cloudAction, button.dataset.id);
      });
    }

    showCloud(hasKey, entries, currentProjectId){
      this.cloudHead.hidden = false;
      this.cloudSetup.hidden = !!hasKey;
      this.cloudSave.hidden = !hasKey;
      this.cloudForget.hidden = !hasKey;
      this.cloudHistory.hidden = !hasKey;
      this.cloudEnable.hidden = entries.length > 0;
      this.cloudHistory.replaceChildren();
      if(!hasKey) return;
      if(!entries.length){
        const empty = document.createElement('p');
        empty.className = 'backup-empty';
        empty.textContent = 'Todavía no hay copias cifradas en tu cuenta.';
        this.cloudHistory.appendChild(empty);
      }
      entries.sort((a, b) => b.createdAt - a.createdAt).forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'backup-version';
        const info = document.createElement('div');
        info.className = 'backup-version-info';
        const title = document.createElement('strong');
        title.textContent = new Date(entry.createdAt).toLocaleString() +
          (entry.projectId === currentProjectId ? '' : ' · Otro proyecto');
        const detail = document.createElement('span');
        const c = entry.counts || {};
        detail.textContent = (c.tasks || 0) + ' tareas · ' + (c.contacts || 0) + ' contactos · ' + (c.vault || 0) + ' credenciales cifradas';
        info.append(title, detail);
        const actions = document.createElement('div');
        actions.className = 'backup-version-actions';
        [['download','Descargar'], ['restore','Importar'], ['delete','Borrar']].forEach(([action, label]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = action === 'delete' ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm';
          button.dataset.cloudAction = action;
          button.dataset.id = entry.id;
          button.textContent = label;
          actions.appendChild(button);
        });
        row.append(versionIcon(), info, actions);
        this.cloudHistory.appendChild(row);
      });
    }

    revealCloudKey(key){ this.cloudKey.value = key; this.cloudKeyWrap.hidden = false; }
    clearImportedKey(){ this.cloudImportKey.value = ''; }
    setCloudBusy(busy){ this.cloudSave.disabled = busy; this.cloudSave.textContent = busy ? 'Guardando…' : 'Guardar en la nube'; }

    renderHistory(entries){
      this.history.replaceChildren();
      if(!entries.length){
        const empty = document.createElement('p');
        empty.className = 'backup-empty';
        empty.textContent = 'Todavía no hay versiones guardadas en este navegador.';
        this.history.appendChild(empty);
        return;
      }
      entries.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'backup-version';
        const info = document.createElement('div');
        info.className = 'backup-version-info';
        const title = document.createElement('strong');
        title.textContent = new Date(entry.createdAt).toLocaleString();
        const detail = document.createElement('span');
        const c = entry.counts || {};
        detail.textContent = (c.tasks || 0) + ' tareas · ' + (c.contacts || 0) + ' contactos · ' + (c.vault || 0) + ' credenciales cifradas';
        info.append(title, detail);
        const actions = document.createElement('div');
        actions.className = 'backup-version-actions';
        [['download','Descargar'], ['restore','Importar'], ['delete','Borrar']].forEach(([action, label]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = action === 'delete' ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm';
          button.dataset.backupAction = action;
          button.dataset.id = entry.id;
          button.textContent = label;
          actions.appendChild(button);
        });
        row.append(versionIcon(), info, actions);
        this.history.appendChild(row);
      });
    }

    setSavingVersion(busy){ this.btnSaveVersion.disabled = busy; this.btnSaveVersion.textContent = busy ? 'Guardando…' : 'Guardar versión'; }

    /* handler(parsedJson); los errores de lectura se muestran aquí mismo. */
    bindImport(handler){
      this.importInput.addEventListener('change', () => {
        const file = this.importInput.files && this.importInput.files[0];
        if(!file) return;
        this.error.hidden = true;
        this.status.hidden = true;
        const reader = new FileReader();
        reader.onload = () => {
          let parsed;
          try{
            parsed = JSON.parse(reader.result);
          }catch(e){
            this.showError('El archivo no es un JSON válido.');
            return;
          }
          handler(parsed);
        };
        reader.onerror = () => this.showError('No se pudo leer el archivo.');
        reader.readAsText(file);
      });
    }

    setExporting(busy){
      this.btnExport.disabled = busy;
      this.btnExportPlain.disabled = busy;
      this.btnExport.textContent = busy ? 'Preparando…' : this.exportText();
    }

    /* Permite volver a elegir el mismo archivo. */
    resetImport(){ this.importInput.value = ''; }

    showError(msg){
      this.status.hidden = true;
      this.error.textContent = msg;
      this.error.hidden = false;
      this.resetImport();
    }

    showStatus(msg){
      this.error.hidden = true;
      this.status.textContent = msg;
      this.status.hidden = false;
    }
  }

  Workhub.views.BackupView = BackupView;
})();
