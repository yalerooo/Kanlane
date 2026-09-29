/* Tablero de tareas, ficha de solo lectura de una tarea y diálogo de edición
   (notas y vínculos incluidos). Clic en una tarea → ficha; "Editar tarea" →
   formulario, y al guardar o cancelar se vuelve a la ficha. */
(function(){
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;

  class TasksController {
    constructor(app, board, dialog, detail){
      this.app = app;
      this.tasks = app.models.tasks;
      this.contacts = app.models.contacts;
      this.vault = app.models.vault;
      this.board = board;
      this.dialog = dialog;
      this.detail = detail;

      /* Tarea abierta en la ficha */
      this.detailId = null;
      this.stopDetailNotes = null;
      /* Tarea a cuya ficha se vuelve al cerrar el formulario de edición */
      this.backToDetailId = null;

      /* Tarea abierta en el diálogo */
      this.currentId = null;
      this.linkedContacts = [];
      this.linkedVault = [];
      this.stopNotes = null;

      this.tasks.on('change', () => {
        this.board.showLoaded();
        this.render();
        this.refreshDetail();
      });
      this.contacts.on('change', () => this.refreshDetail());
      this.vault.on('change', () => this.refreshDetail());
      this.tasks.on('error', (err) => {
        this.board.showError('No se pudieron cargar las tareas (' + (err && err.code || 'error') + ').');
      });
      app.models.clients.on('change', () => {
        const names = app.clientNames();
        this.board.setClientOptions(names);
        this.dialog.setCliente(names);
        this.render();
        this.refreshDetail();
      });

      this.board.bindNew(() => this.openNew());
      this.board.bindFilters(() => this.render());
      this.board.bindOpen((id) => this.openDetail(id));
      this.board.bindQuickAdd((status) => this.openNew(status));
      this.board.bindMove((id, status, beforeId) => this.tasks.move(id, status, beforeId));

      this.dialog.cliente.bindCreate((name) => app.createClient(name));
      this.dialog.bindSubmit((id, values) => this.save(id, values));
      this.dialog.bindCancel(() => this.closeDialog(true));
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

      this.detail.bindClose(() => this.closeDetail());
      this.detail.bindEdit((id) => {
        this.closeDetail();
        this.openEdit(id, true);
      });
      this.detail.bindStatus((id, status) => {
        this.tasks.move(id, status);
        toast.success('Movida a «' + Workhub.t(Workhub.models.TaskModel.statusOf(status).label) + '»');
      });
      this.detail.bindLinkActions((action, id, btn) => this.onDetailLinkAction(action, id, btn));
      /* Cerrada con Escape: deja de escuchar sus notas (salvo que ya se haya reabierto). */
      this.detail.dlg.addEventListener('close', () => {
        if(!this.detail.isOpen()) this.releaseDetail();
      });
    }

    render(){
      const f = this.board.filters();
      this.board.render(this.tasks.filter(f.query, f.cliente));
    }

    /* ---------- Ficha de la tarea ---------- */

    detailContext(){
      return {contacts:this.contacts.items, vault:this.vault};
    }

    openDetail(id){
      const t = this.tasks.find(id);
      if(!t) return;
      this.releaseDetail();
      this.detailId = id;
      this.detail.open(t, this.detailContext());
      try{
        this.stopDetailNotes = this.tasks.watchNotes(id,
          (docs) => this.detail.renderNotes(docs),
          () => this.detail.showNotesError());
      }catch(e){
        this.detail.showNotesError();
      }
    }

    /* Mantiene la ficha al día si cambian la tarea, sus vínculos o los clientes. */
    refreshDetail(){
      if(!this.detailId || !this.detail.isOpen()) return;
      const t = this.tasks.find(this.detailId);
      if(!t){ this.closeDetail(); return; }
      this.detail.render(t, this.detailContext());
    }

    releaseDetail(){
      if(this.stopDetailNotes){ this.stopDetailNotes(); this.stopDetailNotes = null; }
      this.detailId = null;
    }

    closeDetail(){
      this.releaseDetail();
      this.detail.close();
    }

    onDetailLinkAction(action, id, btn){
      switch(action){
        case 'open-contact':
          this.closeDetail();
          this.app.controllers.clients.showContact(id);
          break;
        case 'toggle-linked-vault':
          if(!this.vault.find(id)) return;
          this.vault.toggleVisible(id).then(() => this.refreshDetail()).catch(() => {});
          break;
        case 'copy-linked-vault':
          if(!this.vault.find(id)) return;
          this.vault.reveal(id).then((data) => this.detail.copy(btn, data.password)).catch(() => {});
          break;
        case 'goto-vault': {
          const returnTo = this.detailId;
          this.closeDetail();
          this.app.controllers.vault.returnToTaskAfterUnlock(returnTo, 'detail');
          this.app.navigate('vault');
          break;
        }
      }
    }

    /* ---------- Diálogo ---------- */

    openNew(status){
      this.releaseTask();
      const items = this.tasks.items;
      const deflt = items.length && items[0].cliente ? items[0].cliente : '';
      this.dialog.openNew(this.app.clientNames(), deflt, status);
    }

    /* Nueva tarea con fecha (y cliente) ya elegidos, desde el calendario. */
    openNewOn(date, cliente){
      this.openNew();
      this.dialog.setDueDate(date);
      if(cliente) this.dialog.setCliente(this.app.clientNames(), cliente);
    }

    openEdit(id, fromDetail){
      const t = this.tasks.find(id);
      if(!t) return;
      this.releaseTask();
      this.backToDetailId = fromDetail ? id : null;
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

    /* back: volver a la ficha si el formulario se abrió desde ella. */
    closeDialog(back){
      const returnTo = back ? this.backToDetailId : null;
      this.backToDetailId = null;
      this.releaseTask();
      this.dialog.close();
      if(returnTo) this.openDetail(returnTo);
    }

    save(id, values){
      if(!this.tasks.isReady()){ this.closeDialog(); return; }
      if(this.app.clientsEnabled()){
        if(!values.cliente || !values.title) return;
      } else {
        /* Sin clientes: no se asigna ninguno (una tarea que ya lo tenía lo conserva). */
        if(!values.title) return;
        const prev = id ? this.tasks.find(id) : null;
        values.cliente = prev ? (prev.cliente || '') : '';
      }
      this.tasks.save(id, values).then(() => {
        toast.success(id ? 'Cambios guardados' : 'Tarea creada');
        this.closeDialog(true);
      }, () => {
        toast.error('No se pudo guardar la tarea');
        this.closeDialog();
      });
    }

    remove(id){
      if(!id || !this.tasks.isReady()) return;
      this.tasks.remove(id).then(() => {
        toast.success('Tarea eliminada');
        this.closeDialog();
      }, () => {
        toast.error('No se pudo eliminar la tarea');
        this.closeDialog();
      });
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
          this.app.controllers.clients.showContact(id);
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
          this.app.controllers.vault.returnToTaskAfterUnlock(returnTo, 'edit');
          this.app.navigate('vault');
          break;
        }
      }
    }
  }

  Workhub.controllers.TasksController = TasksController;
})();
