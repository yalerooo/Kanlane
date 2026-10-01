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
      this.tasks.on('recurred', (r) => toast.success(Workhub.t('Próxima repetición creada para el {fecha}', {fecha:Workhub.utils.dates.fmtDate(r.date)}), {important:true}));
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
      this.columns = new Workhub.views.ColumnView();
      this.bindColumns();

      this.dialog.cliente.bindCreate((name) => app.createClient(name));
      this.dialog.bindCreateLabel((name, color) => app.controllers.projects.addLabel(name, color));
      this.dialog.setLabelCatalog(Workhub.views.labels.catalog());
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
      this.detail.bindChecklist((id, itemId, done) => this.tasks.toggleCheck(id, itemId, done));
      this.detail.bindLinkActions((action, id, btn) => this.onDetailLinkAction(action, id, btn));
      this.detail.bindAssignMe((id) => this.toggleMine(id));
      /* Cerrada con Escape: deja de escuchar sus notas (salvo que ya se haya reabierto). */
      this.detail.dlg.addEventListener('close', () => {
        if(!this.detail.isOpen()) this.releaseDetail();
      });
    }

    render(){
      const f = this.board.filters();
      this.board.setHidden(this.hiddenColumns());
      this.board.render(this.tasks.filter(f.query, f.cliente, f.assignee), this.tasks.items);
    }

    /* Cambió el equipo del proyecto abierto (miembros, mi rol): filtro, tarjetas y ficha. */
    applyTeam(){
      const T = Workhub.views.team;
      this.board.setAssigneeOptions(T.members(), T.meUid());
      this.render();
      this.refreshDetail();
    }

    /* «Mis tareas»: filtra el tablero por las asignadas a mí. */
    showMine(){
      this.board.filterMine();
    }

    /* Me asigno o me quito una tarea. */
    toggleMine(id){
      const T = Workhub.views.team;
      const t = this.tasks.find(id);
      if(!t || !T.enabled() || !T.canEdit()) return;
      const me = T.meUid();
      const now = T.assigned(t);
      const next = now.indexOf(me) === -1 ? now.concat(me) : now.filter((u) => u !== me);
      this.tasks.save(id, {assignees:next}).then(
        () => toast.success(next.indexOf(me) === -1 ? 'Ya no la tienes asignada' : 'Te la has asignado'),
        () => toast.error('No se pudo cambiar la asignación')
      );
    }

    /* ---------- Columnas del tablero ---------- */

    hiddenKey(){
      return 'workhub_hidden_' + this.app.projectId;
    }

    /* Columnas ocultas de este proyecto en este navegador. */
    hiddenColumns(){
      let list = [];
      try{ list = JSON.parse(Workhub.services.preferences.read(this.hiddenKey(), '[]')); }catch(e){ list = []; }
      const keys = Workhub.models.TaskModel.STATUS.map((s) => s.key);
      list = Array.isArray(list) ? list.filter((k) => keys.indexOf(k) !== -1) : [];
      /* Nunca todas: siempre queda alguna a la vista. */
      return list.length >= keys.length ? [] : list;
    }

    setHiddenColumns(list){
      Workhub.services.preferences.write(this.hiddenKey(), JSON.stringify(list));
      this.render();
    }

    stagesApi(){
      return this.app.controllers.projects;
    }

    bindColumns(){
      const TaskModel = Workhub.models.TaskModel;
      const PT = Workhub.models.ProjectTemplates;
      const col = this.columns;
      this.board.bindColumnMenu((status, btn) => {
        const stages = TaskModel.STATUS;
        col.openMenu(btn, status, {
          index: stages.findIndex((s) => s.key === status),
          count: stages.length,
          visible: stages.length - this.hiddenColumns().length,
          tasks: this.tasks.items.filter((t) => TaskModel.stageKey(t) === status).length,
          canRemove: stages.length > PT.MIN_STAGES
        });
      });
      col.bindMenu({
        edit: (status, field) => {
          const s = TaskModel.STATUS.find((x) => x.key === status);
          if(s) col.openEdit(s, field);
        },
        hide: (status) => this.setHiddenColumns(this.hiddenColumns().concat(status)),
        move: (status, dir) => this.moveColumn(status, dir),
        remove: (status) => this.removeColumn(status),
        removeAll: (status) => this.removeAllTasks(status)
      });
      col.bindSubmit((status, v) => {
        this.stagesApi().updateStages((stages) => {
          const s = stages.find((x) => x.key === status);
          if(!s) return false;
          s.label = v.label;
          s.color = v.color;
          s.limit = v.limit;
          s.done = v.done;
          if(!stages.some((x) => x.done)){
            col.showError('Tiene que haber al menos una columna cuyas tarjetas cuenten como terminadas.');
            return false;
          }
        }).then((ok) => { if(ok) col.closeEdit(); });
      });
      this.board.bindShowHidden(() => this.setHiddenColumns([]));
      this.board.bindColumnMove((status, before) => this.reorderColumn(status, before));
    }

    moveColumn(status, dir){
      this.stagesApi().updateStages((stages) => {
        const i = stages.findIndex((s) => s.key === status);
        const j = i + dir;
        if(i < 0 || j < 0 || j >= stages.length) return false;
        stages.splice(j, 0, stages.splice(i, 1)[0]);
      });
    }

    /* Suelta una columna justo antes de otra (o al final si before es null). */
    reorderColumn(status, before){
      this.stagesApi().updateStages((stages) => {
        const i = stages.findIndex((s) => s.key === status);
        if(i < 0) return false;
        const moved = stages.splice(i, 1)[0];
        let j = before ? stages.findIndex((s) => s.key === before) : -1;
        if(j < 0) j = stages.length;
        stages.splice(j, 0, moved);
      });
    }

    removeColumn(status){
      const TaskModel = Workhub.models.TaskModel;
      const s = TaskModel.STATUS.find((x) => x.key === status);
      if(!s) return;
      const n = this.tasks.items.filter((t) => TaskModel.stageKey(t) === status).length;
      const text = n
        ? 'Se eliminará la columna «' + s.label + '». Sus ' + n + (n === 1 ? ' tarjeta pasará' : ' tarjetas pasarán') + ' a la primera columna; no se borra ninguna.'
        : 'Se eliminará la columna «' + s.label + '».';
      this.columns.confirm('Eliminar columna', text, 'Eliminar columna').then((ok) => {
        if(!ok) return;
        /* Antes de quitarla, sus tarjetas se pasan a la primera columna que quede. */
        const target = TaskModel.STATUS.filter((x) => x.key !== status)[0];
        if(target){
          this.tasks.items.filter((t) => TaskModel.stageKey(t) === status).forEach((t) => this.tasks.move(t.id, target.key));
        }
        this.stagesApi().updateStages((stages) => {
          const i = stages.findIndex((x) => x.key === status);
          if(i < 0) return false;
          const removed = stages.splice(i, 1)[0];
          if(removed.done && !stages.some((x) => x.done)) stages[stages.length - 1].done = true;
        });
      });
    }

    removeAllTasks(status){
      const TaskModel = Workhub.models.TaskModel;
      const s = TaskModel.STATUS.find((x) => x.key === status);
      const list = this.tasks.items.filter((t) => TaskModel.stageKey(t) === status);
      if(!s || !list.length) return;
      this.columns.confirm('Eliminar todas las tarjetas',
        'Se eliminarán ' + list.length + (list.length === 1 ? ' tarjeta' : ' tarjetas') + ' de «' + s.label + '». No se puede deshacer.',
        'Eliminar todas').then((ok) => {
        if(!ok) return;
        const snap = this.tasks.snapshot(list.map((t) => t.id));
        Promise.all(list.map((t) => this.tasks.remove(t.id))).then(
          () => toast.undoable(list.length === 1 ? 'Tarjeta eliminada' : list.length + ' tarjetas eliminadas', () => this.tasks.restore(snap), list.length === 1 ? 'Tarjeta restaurada' : 'Tarjetas restauradas'),
          () => toast.error('No se pudieron eliminar todas las tarjetas'));
      });
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
      this.loadGithubDetails(t);
      try{
        this.stopDetailNotes = this.tasks.watchNotes(id,
          (docs) => this.detail.renderNotes(docs),
          () => this.detail.showNotesError());
      }catch(e){
        this.detail.showNotesError();
      }
    }

    /* Mantiene la ficha al día si cambian la tarea, sus vínculos o los clientes. */
    /* Actividad y pull requests de la incidencia enlazada con GitHub (si la hay). */
    loadGithubDetails(t){
      const gh = this.app.controllers.github;
      if(!gh || !gh.canLoadDetails(t)) return;
      const id = t.id;
      const same = () => this.detail.isOpen() && this.detailId === id;
      gh.loadDetails(t).then((d) => { if(same()) this.detail.renderGithub(id, d); })
        .catch((err) => { if(same()) this.detail.renderGithub(id, null, err); });
    }

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
      if(values.assignees === undefined) delete values.assignees;
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
      const snap = this.tasks.snapshot(id);
      this.tasks.remove(id).then(() => {
        toast.undoable('Tarea eliminada', () => this.tasks.restore(snap), 'Tarea restaurada');
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
