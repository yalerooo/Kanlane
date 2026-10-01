/* Copia de seguridad: botones de exportar/importar y mensajes de resultado. */
(function(){
  const $ = (id) => document.getElementById(id);

  class BackupView {
    constructor(){
      this.btnExport = $('btnExportData');
      this.importInput = $('importFileInput');
      this.error = $('dataError');
      this.status = $('dataStatus');
      this.history = $('backupHistory');
      this.btnSaveVersion = $('btnSaveBackupVersion');
      this.exportLabel = this.btnExport.textContent;
    }

    bindExport(handler){ this.btnExport.addEventListener('click', handler); }
    bindSaveVersion(handler){ this.btnSaveVersion.addEventListener('click', handler); }
    bindHistory(handler){
      this.history.addEventListener('click', (ev) => {
        const button = ev.target.closest('button[data-backup-action]');
        if(button) handler(button.getAttribute('data-backup-action'), button.getAttribute('data-id'));
      });
    }

    renderHistory(entries){
      this.history.replaceChildren();
      if(!entries.length){
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'Todavía no hay versiones guardadas en este navegador.';
        this.history.appendChild(empty);
        return;
      }
      entries.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'backup-version';
        const info = document.createElement('div');
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
          button.className = 'btn btn-ghost btn-sm';
          button.dataset.backupAction = action;
          button.dataset.id = entry.id;
          button.textContent = label;
          actions.appendChild(button);
        });
        row.append(info, actions);
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
      this.btnExport.textContent = busy ? 'Preparando…' : this.exportLabel;
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
