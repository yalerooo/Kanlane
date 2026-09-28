/* Tablero de tareas y diálogo de tarea (notas y vínculos incluidos). */
(function(){
  const platform = Workhub.services.platform;

  class TasksController {
    constructor(app, board, dialog){
      this.app = app;
      this.tasks = app.models.tasks;
      this.contacts = app.models.contacts;
      this.vault = app.models.vault;
      this.board = board;
      this.dialog = dialog;

      /* Tarea abierta en el diálogo */
      this.currentId = null;
      this.linkedContacts = [];
      this.linkedVault = [];
      this.stopNotes = null;

      this.tasks.on('change', () => {
        this.board.showLoaded();
        this.render();
      });
      this.tasks.on('error', (err) => {
        this.board.showError('No se pudieron cargar las tareas (' + (err && err.code || 'error') + ').');
      });
      app.models.clients.on('change', () => {
        const names = app.clientNames();
        this.board.setClientOptions(names);
        this.dialog.setCliente(names);
        this.render();
      });

      this.board.bindNew(() => this.openNew());
      this.board.bindFilters(() => this.render());
      this.board.bindOpen((id) => this.openEdit(id));
      this.board.bindMove((id, status) => this.tasks.move(id, status));

      this.dialog.cliente.bindCreate((name) => app.createClient(name));
      this.dialog.bindSubmit((id, values) => this.save(id, values));
      this.dialog.bindCancel(() => this.closeDialog());
      this.dialog.bindDelete((id) => this.remove(id));
      this.dialog.bindAddNote((text, image) => this.addNote(text, image));
      this.dialog.bindDeleteNote((noteId) => {
        if(this.currentId) this.tasks.removeNote(this.currentId, noteId).catch(() => {});
      });
      this.dialog.bindLinkPickers(
        (id) => this.link('contacts', id),
        (id) => this.link('vault', id)
      );
      this.dialog.bindLinkedActions((action, id, btn) => this.onLinkedAction(action, id, btn));
    }

    render(){
      const f = this.board.filters();
      this.board.render(this.tasks.filter(f.query, f.cliente));
    }

    /* ---------- Diálogo ---------- */

    openNew(){
      this.releaseTask();
      const items = this.tasks.items;
      const deflt = items.length && items[0].cliente ? items[0].cliente : '';
      this.dialog.openNew(this.app.clientNames(), deflt);
    }

    /* Nueva tarea con fecha (y cliente) ya elegidos, desde el calendario. */
    openNewOn(date, cliente){
      this.openNew();
      this.dialog.setDueDate(date);
      if(cliente) this.dialog.setCliente(this.app.clientNames(), cliente);
    }

    openEdit(id){
      const t = this.tasks.find(id);
      if(!t) return;
      this.releaseTask();
      this.linkedContacts = Array.isArray(t.linkedContacts) ? t.linkedContacts.slice() : [];
      this.linkedVault = Array.isArray(t.linkedVault) ? t.linkedVault.slice() : [];
      this.renderLinks();
      this.dialog.openEdit(t, this.app.clientNames());

      try{
        this.currentId = t.id;
        this.stopNotes = this.tasks.watchNotes(t.id,
          (docs) => this.dialog.renderNotes(docs),
          () => this.dialog.showNotesError());
      }catch(e){
        this.dialog.showNotesError();
      }
    }

    /* Deja de escuchar las notas de la tarea abierta y olvida sus vínculos. */
    releaseTask(){
      if(this.stopNotes){ this.stopNotes(); this.stopNotes = null; }
      this.currentId = null;
      this.linkedContacts = [];
      this.linkedVault = [];
    }

    closeDialog(){
      this.releaseTask();
      this.dialog.close();
    }

    save(id, values){
      if(!this.tasks.isReady()){ this.closeDialog(); return; }
      if(!values.cliente || !values.title) return;
      this.tasks.save(id, values).then(() => this.closeDialog(), () => this.closeDialog());
    }

    remove(id){
      if(!id || !this.tasks.isReady()) return;
      this.tasks.remove(id).then(() => this.closeDialog(), () => this.closeDialog());
    }

    addNote(text, image){
      if(!this.currentId) return;
      const taskId = this.currentId;
      this.dialog.setAddingNote(true);
      const upload = image ? platform.uploadAsset(image) : Promise.resolve('');
      upload.then((assetId) => this.tasks.addNote(taskId, text, assetId)).then(() => {
        this.dialog.resetNoteForm();
      }).catch(() => {
        this.dialog.showNoteError('No se pudo añadir la nota.');
      }).finally(() => {
        this.dialog.setAddingNote(false);
      });
    }

    /* ---------- Vínculos con contactos y contraseñas ---------- */

    renderLinks(){
      this.dialog.renderLinkedContacts(this.linkedContacts, this.contacts.items);
      this.dialog.renderLinkedVault(this.linkedVault, this.vault);
    }

    persistLinks(){
      if(!this.currentId || !this.tasks.isReady()) return;
      this.tasks.saveLinks(this.currentId, this.linkedContacts, this.linkedVault);
    }

    link(kind, id){
      if(!this.currentId) return;
      if(kind === 'contacts') this.linkedContacts = this.linkedContacts.concat([id]);
      else this.linkedVault = this.linkedVault.concat([id]);
      this.renderLinks();
      this.persistLinks();
    }

    onLinkedAction(action, id, btn){
      switch(action){
        case 'unlink-contact':
          this.linkedContacts = this.linkedContacts.filter((x) => x !== id);
          this.renderLinks();
          this.persistLinks();
          break;
        case 'unlink-vault':
          this.linkedVault = this.linkedVault.filter((x) => x !== id);
          this.renderLinks();
          this.persistLinks();
          break;
        case 'open-contact':
          this.closeDialog();
          this.app.navigate('contacts');
          this.app.controllers.contacts.openEdit(id);
          break;
        case 'toggle-linked-vault':
          if(!this.vault.find(id)) return;
          this.vault.toggleVisible(id).then(() => this.renderLinks()).catch(() => {});
          break;
        case 'copy-linked-vault':
          if(!this.vault.find(id)) return;
          this.vault.reveal(id).then((data) => this.dialog.copy(btn, data.password)).catch(() => {});
          break;
        case 'goto-vault': {
          /* Tras desbloquear, el gestor de contraseñas vuelve a abrir esta tarea. */
          const returnTo = this.currentId;
          this.closeDialog();
          this.app.controllers.vault.returnToTaskAfterUnlock(returnTo);
          this.app.navigate('vault');
          break;
        }
      }
    }
  }

  Workhub.controllers.TasksController = TasksController;
})();
