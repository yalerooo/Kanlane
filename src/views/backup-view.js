/* Copia de seguridad: botones de exportar/importar y mensajes de resultado. */
(function(){
  const $ = (id) => document.getElementById(id);

  class BackupView {
    constructor(){
      this.btnExport = $('btnExportData');
      this.importInput = $('importFileInput');
      this.error = $('dataError');
      this.status = $('dataStatus');
      this.exportLabel = this.btnExport.textContent;
    }

    bindExport(handler){ this.btnExport.addEventListener('click', handler); }

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
