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
      this.board.bindSelect({remove: (ids) => this.removeMany(ids)});
      this.board.bindQuickAdd((status) => this.openNew(status));
      this.board.bindMove((id, status, beforeId) => this.moveWithActivity(id, status, beforeId));
      this.columns = new Workhub.views.ColumnView();
      this.bindColumns();

      /* Tabla y cronograma: otras dos vistas de las mismas tareas. */
      this.table = new Workhub.views.TaskTableView();
      this.table.bind({
        open: (id) => this.openDetail(id),
        create: () => this.openNew(),
        title: (id, title) => this.patchTask(id, {title:title}),
        status: (id, status) => this.moveWithActivity(id, status),
        labels: (id, labels) => this.patchTask(id, {labels:labels}),
        assignees: (id, uids) => this.patchTask(id, {assignees:uids}),
        due: (id, date) => this.setDue(id, date)
      });
      this.timeline = new Workhub.views.TaskTimelineView();
      this.timeline.bind({
        open: (id) => this.openDetail(id),
        range: (id, start, due) => this.setRange(id, start, due)
      });
      this.fields = new Workhub.views.FieldsDialogView();
      document.getElementById('btnFields').addEventListener('click', () => this.openFields());
      this.fields.bindSave((list) => this.app.controllers.projects.saveCustomFields(list).then((ok) => {
        if(ok) toast.success('Campos guardados');
        return ok;
      }));
      this.fields.bindRemove((field) => this.removeField(field));

      this.dialog.cliente.bindCreate((name) => app.createClient(name));
      this.dialog.bindCreateLabel((name, color) => app.controllers.projects.addLabel(name, color));
      this.dialog.setLabelCatalog(Workhub.views.labels.catalog());
      this.dialog.bindSubmit((id, values) => this.save(id, values));
      this.dialog.bindCancel(() => this.requestClose());
      /* Si el formulario se cierra por otra vía (cambio de proyecto), la pregunta pendiente se retira. */
      this.dialog.dlg.addEventListener('close', () => { if(this.discarding && this.columns.confirmDlg.open) this.columns.confirmDlg.close(); });
      this.dialog.bindDelete((id) => this.remove(id));
      this.dialog.bindAddNote((text, files) => this.addNote(text, files));
      this.dialog.bindDeleteNote((noteId) => {
        /* Con la nota se van sus archivos adjuntos. */
        if(this.currentId) this.tasks.removeNote(this.currentId, noteId).then((ids) => platform.deleteAssets(ids)).catch(() => {});
      });
      /* Casillas de una nota: marcar una reescribe su «- [ ]» en el texto de la nota. */
      const toggleNoteTask = (taskId, noteId, n, checked) => {
        if(!taskId || !Workhub.views.team.canEdit()) return;
        this.tasks.toggleNoteTask(taskId, noteId, n, checked).catch(() => toast.error('No se pudo guardar el cambio.'));
      };
      this.dialog.bindNoteTasks((noteId, n, checked) => toggleNoteTask(this.currentId, noteId, n, checked));
      this.detail.bindNoteTasks(toggleNoteTask);
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
        this.moveWithActivity(id, status);
        toast.success('Movida a «' + Workhub.t(Workhub.models.TaskModel.statusOf(status).label) + '»');
      });
      this.detail.bindDone((id, status) => {
        this.moveWithActivity(id, status);
        toast.success('Movida a «' + Workhub.t(Workhub.models.TaskModel.statusOf(status).label) + '»');
      });
      this.detail.bindChecklist((id, itemId, done) => {
        this.tasks.toggleCheck(id, itemId, done).then(() => this.logActivity(id, done ? 'completó una subtarea' : 'reabrió una subtarea'));
      });
      this.detail.bindComment((id, text, files) => this.postComment(id, text, files));
      this.detail.bindAutoButton((id, ruleId) => { const autos = this.app.controllers.automations; if(autos) autos.press(ruleId, id); });
      /* Casillas de la descripción: marcar una reescribe su «- [ ]» en el texto. */
      this.detail.bindDescTasks((id, n, checked) => {
        const t = this.tasks.find(id);
        if(!t || !Workhub.views.team.canEdit()) return;
        const desc = Workhub.utils.markdown.toggleTask(t.desc || '', n, checked);
        if(desc === (t.desc || '')) return;
        this.tasks.patchLocal(id, {desc:desc});
        this.tasks.update(id, {desc:desc, updatedAt:Date.now()}).catch(() => toast.error('No se pudo guardar el cambio.'));
      });
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
      let list = this.tasks.filter(f.query, f.cliente, f.assignee);
      if(f.week) list = this.board.dueThisWeek(list);
      this.board.render(list, this.tasks.items);
      if(this.board.mode === 'table') this.table.render(list, this.tasks.items);
      else if(this.board.mode === 'timeline'){
        this.timeline.setHidden(this.hiddenColumns());
        this.timeline.render(list, this.tasks.items);
      }
    }

    /* ---------- Tabla y cronograma ---------- */

    /* Cambio hecho en una celda de la tabla: se ve al momento y se guarda. */
    patchTask(id, patch){
      const t = this.tasks.find(id);
      if(!t || t._undecryptable || !this.tasks.isReady() || !Workhub.views.team.canEdit()) return false;
      this.tasks.patchLocal(id, patch);
      this.tasks.save(id, Object.assign({}, patch)).then(() => this.logActivity(id, 'editó la tarea'), () => toast.error('No se pudo guardar la tarea'));
      return true;
    }

    /* Fecha límite desde la tabla ('' la quita, y con ella la hora). A una tarea que se repite no
       se le quita: la repetición parte de esa fecha, y perderla sin decir nada sería peor. */
    setDue(id, date){
      const t = this.tasks.find(id);
      if(!t || (date && !Workhub.models.CustomFields.validDate(date))) return false;
      if(date && t.startDate && t.startDate > date){
        toast.error('La fecha límite no puede ser anterior a la fecha de inicio.');
        return false;
      }
      if(!date && t.repeat){
        toast.error('Esta tarea se repite y necesita una fecha límite. Para quitarla, elige antes «No se repite».');
        return false;
      }
      const patch = {dueDate:date};
      if(!date && t.dueTime) patch.dueTime = '';
      return this.patchTask(id, patch);
    }

    /* Intervalo de la tarea desde el cronograma (arrastre o teclado). */
    setRange(id, start, due){
      const t = this.tasks.find(id);
      if(!t || t._undecryptable || !Workhub.views.team.canEdit()) return false;
      if(start && due && start > due){
        toast.error('La fecha de inicio no puede ser posterior a la fecha límite.');
        return false;
      }
      if(!this.tasks.setRange(id, start, due)) return false;
      this.logActivity(id, 'cambió las fechas de la tarea');
      return true;
    }

    /* ---------- Campos personalizados ---------- */

    openFields(){
      if(!Workhub.views.team.canEdit() || !this.tasks.isReady()) return;
      this.fields.open(this.app.controllers.projects.customFields());
    }

    /* Avisa, quita el campo del proyecto y borra su valor de las tareas. → promesa con true si se borró. */
    removeField(field){
      const CF = Workhub.models.CustomFields;
      const pc = this.app.controllers.projects;
      const n = CF.usedBy(this.tasks.items, field.id).length;
      const text = n === 0 ? Workhub.t('Se eliminará el campo «{name}». No se puede deshacer.', {name:field.name})
        : n === 1 ? Workhub.t('Se eliminará el campo «{name}» y el valor que tiene en 1 tarea. No se puede deshacer.', {name:field.name})
        : Workhub.t('Se eliminará el campo «{name}» y el valor que tiene en {n} tareas. No se puede deshacer.', {name:field.name, n:n});
      return this.columns.confirm('Eliminar campo', text, 'Eliminar campo').then((ok) => {
        if(!ok) return false;
        return pc.saveCustomFields(pc.customFields().filter((f) => f.id !== field.id)).then((saved) => {
          if(!saved){ toast.error('No se pudo eliminar el campo'); return false; }
          const now = Date.now();
          const used = CF.usedBy(this.tasks.items, field.id).filter((t) => !t._undecryptable);
          return Promise.all(used.map((t) => this.tasks.update(t.id, {custom:CF.without(t.custom, field.id), updatedAt:now}).catch(() => null))).then(() => {
            toast.success('Campo eliminado');
            return true;
          });
        });
      });
    }

    logActivity(id, text){
      if(!Workhub.views.team.enabled()) return;
      this.tasks.addActivity(id, text).catch(() => toast.error('El cambio se guardó, pero no se pudo registrar la actividad.'));
    }

    moveWithActivity(id, status, beforeId){
      const before = this.tasks.find(id);
      const oldStatus = before && before.status;
      this.tasks.move(id, status, beforeId);
      if(before && oldStatus !== status && Workhub.models.TaskModel.statusOf(status).done){
        document.dispatchEvent(new CustomEvent('sumi:done'));
        /* Era la última que quedaba: Sumi lo celebra una vez. */
        const TaskModel = Workhub.models.TaskModel;
        const wasOpen = !TaskModel.statusOf(oldStatus).done;
        if(wasOpen && this.tasks.items.length > 1 && this.tasks.items.every((t) => t.id === id || TaskModel.isDone(t))){
          toast.success(Workhub.t('Todo completado. No queda nada pendiente.'), {important:true, mood:'fiesta', duration:5000});
        }
      }
      if(before) this.logActivity(id, oldStatus === status ? 'ordenó la tarea' : 'movió la tarea a «' + Workhub.models.TaskModel.statusOf(status).raw + '»');
    }

    /* Sube los adjuntos y guarda la nota; si la nota no llega a guardarse, lo subido se borra.
       Se rechaza con el mensaje para la persona ('' si lo que falló fue guardar la nota). */
    saveNote(taskId, text, files){
      const A = Workhub.views.attachments;
      return A.upload(files || []).then((list) => this.tasks.addNote(taskId, text, list).catch(() => {
        return platform.deleteAssets(list.reduce((ids, a) => ids.concat(a.parts), [])).then(() => { throw ''; });
      }), (err) => { throw A.uploadError(err); });
    }

    /* files: archivos adjuntos (opcional); se suben antes de guardar la nota. */
    postComment(id, text, files){
      if(!Workhub.views.team.canEdit()) return;
      this.detail.setCommentBusy(true);
      this.saveNote(id, text, files).then(() => this.detail.commentSaved(), (msg) => this.detail.commentFailed(msg))
        .then(() => this.detail.setCommentBusy(false));
    }

    /* Cambió el equipo del proyecto abierto (miembros, mi rol): filtro, tarjetas y ficha. */
    applyTeam(){
      const T = Workhub.views.team;
      this.board.setAssigneeOptions(T.members(), T.meUid());
      /* Los campos del proyecto los define quien puede editarlo. */
      document.getElementById('btnFields').hidden = !T.canEdit();
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
        () => { this.logActivity(id, next.indexOf(me) === -1 ? 'se quitó la asignación' : 'se asignó la tarea'); toast.success(next.indexOf(me) === -1 ? 'Ya no la tienes asignada' : 'Te la has asignado'); },
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
      const autos = this.app.controllers && this.app.controllers.automations;
      (autos ? autos.warningFor({stage:status}) : Promise.resolve('')).then((warn) => this.columns.confirm('Eliminar columna', text, 'Eliminar columna', warn)).then((ok) => {
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
      const autos = this.app.controllers && this.app.controllers.automations;
      return {contacts:this.contacts.items, vault:this.vault, buttons:autos ? autos.buttons() : []};
    }

    openDetail(id){
      const t = this.tasks.find(id);
      if(!t) return;
      if(t._undecryptable){ toast.error('Esta tarea no se puede descifrar con la clave de este proyecto.'); return; }
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
      this.dialog.markClean();
    }

    /* Nueva tarea con fecha (y cliente) ya elegidos, desde el calendario. */
    openNewOn(date, cliente){
      this.openNew();
      this.dialog.setDueDate(date);
      if(cliente) this.dialog.setCliente(this.app.clientNames(), cliente);
      this.dialog.markClean();
    }

    openEdit(id, fromDetail){
      const t = this.tasks.find(id);
      if(!t) return;
      if(t._undecryptable){ toast.error('Esta tarea no se puede descifrar con la clave de este proyecto.'); return; }
      this.releaseTask();
      this.backToDetailId = fromDetail ? id : null;
      this.linkedContacts = Array.isArray(t.linkedContacts) ? t.linkedContacts.slice() : [];
      this.linkedVault = Array.isArray(t.linkedVault) ? t.linkedVault.slice() : [];
      this.renderLinks();
      this.dialog.openEdit(t, this.app.clientNames());
      this.dialog.markClean();

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

    /* Cancelar, la × o Escape: si hay cambios sin guardar, pregunta antes de perderlos. */
    requestClose(){
      if(!this.dialog.isDirty()){ this.closeDialog(true); return; }
      if(this.discarding) return;
      this.discarding = true;
      this.columns.confirm('Descartar cambios', 'Hay cambios sin guardar en esta tarea. Si cierras ahora, se pierden.', 'Descartar').then((ok) => {
        this.discarding = false;
        if(ok && this.dialog.isOpen()) this.closeDialog(true);
      });
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
      this.tasks.save(id, values).then((ref) => {
        this.logActivity(id || ref.id, id ? 'editó la tarea' : 'creó la tarea');
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

    /* Elimina de una vez las tareas marcadas en el tablero o en la lista. Pide confirmación y, como
       al eliminar una, se puede deshacer desde el aviso. */
    removeMany(ids){
      if(!this.tasks.isReady() || !Workhub.views.team.canEdit()) return;
      const list = (Array.isArray(ids) ? ids : []).filter((id) => this.tasks.find(id));
      if(!list.length) return;
      const n = list.length;
      this.columns.confirm(n === 1 ? 'Eliminar tarea' : 'Eliminar tareas',
        (n === 1 ? 'Se eliminará la tarea seleccionada.' : 'Se eliminarán las ' + n + ' tareas seleccionadas.') + ' Podrás deshacerlo desde el aviso que sale después.',
        n === 1 ? 'Eliminar' : 'Eliminar ' + n).then((ok) => {
        if(!ok) return;
        /* Las que sigan existiendo al confirmar (otra persona pudo borrar alguna mientras tanto). */
        const alive = list.filter((id) => this.tasks.find(id));
        if(!alive.length){ this.board.setSelecting(false); return; }
        const snap = this.tasks.snapshot(alive);
        Promise.all(alive.map((id) => this.tasks.remove(id))).then(() => {
          this.board.setSelecting(false);
          toast.undoable(alive.length === 1 ? 'Tarea eliminada' : alive.length + ' tareas eliminadas', () => this.tasks.restore(snap), alive.length === 1 ? 'Tarea restaurada' : 'Tareas restauradas');
        }, () => toast.error('No se pudieron eliminar todas las tareas'));
      });
    }

    addNote(text, files){
      if(!this.currentId) return;
      this.dialog.setAddingNote(true);
      this.saveNote(this.currentId, text, files).then(() => this.dialog.resetNoteForm(),
        (msg) => this.dialog.showNoteError(msg || 'No se pudo añadir la nota.'))
        .then(() => this.dialog.setAddingNote(false));
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
