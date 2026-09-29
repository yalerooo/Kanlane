/* Tareas del tablero, sus estados y sus notas (subcolección 'notes'). */
(function(){
  const {todayYmd} = Workhub.utils.dates;

  /* Etapas del proyecto abierto. Es un único array que se rellena en el sitio
     (setStages), así todos los que lo leen ven siempre las etapas actuales. */
  const STATUS = [];

  const stageView = (s) => {
    const c = Workhub.models.ProjectTemplates.colorOf(s.color);
    return {key:s.key, label:s.label, done:!!s.done, limit:s.limit || 0, color:c.key, dot:c.dot, bg:c.bg, fg:c.fg};
  };

  const ORDER_STEP = 1024;

  class TaskModel extends Workhub.models.CollectionModel {
    constructor(){
      super('tasks');
    }

    /* Cambia las etapas del tablero (al abrir otro proyecto o editar el actual). */
    static setStages(stages){
      STATUS.length = 0;
      stages.forEach((s) => STATUS.push(stageView(s)));
    }

    static statusOf(key){
      return STATUS.find((s) => s.key === key) || STATUS[0];
    }

    /* Etapa de la tarea; si su estado ya no existe (etapa eliminada, copia de
       otro tipo de proyecto) cae en la primera para que nunca desaparezca. */
    static stageKey(t){
      return TaskModel.statusOf(t && t.status).key;
    }

    static isDone(t){
      return !!TaskModel.statusOf(t && t.status).done;
    }

    /* '' (sin fecha) | 'done' | 'overdue' | 'today' | 'future' */
    static dueState(t){
      if(!t.dueDate) return '';
      if(TaskModel.isDone(t)) return 'done';
      const today = todayYmd();
      if(t.dueDate < today) return 'overdue';
      if(t.dueDate === today) return 'today';
      return 'future';
    }

    /* Orden manual dentro de su columna (las tareas antiguas usan su fecha de creación). */
    static orderOf(t){
      return t.order != null ? t.order : (t.createdAt || 0);
    }

    static byOrder(a, b){
      return (TaskModel.orderOf(a) - TaskModel.orderOf(b)) ||
        ((a.createdAt || 0) - (b.createdAt || 0)) ||
        String(a.id).localeCompare(String(b.id));
    }

    inStatus(status){
      return this.items.filter((t) => TaskModel.stageKey(t) === status).sort(TaskModel.byOrder);
    }

    filter(query, cliente){
      const q = (query || '').trim().toLowerCase();
      return this.items.filter((t) => {
        if(cliente && (t.cliente || 'Sin cliente') !== cliente) return false;
        if(q){
          const hay = ((t.title || '') + ' ' + (t.desc || '') + ' ' + (t.cliente || '') + ' ' + (t.contacto || '')).toLowerCase();
          if(hay.indexOf(q) === -1) return false;
        }
        return true;
      });
    }

    statsByClient(name){
      const own = this.items.filter((t) => t.cliente === name);
      return {total:own.length, open:own.filter((t) => !TaskModel.isDone(t)).length};
    }

    /* Las tareas nuevas van al final de su columna. */
    save(id, body){
      body.updatedAt = Date.now();
      if(id) return this.update(id, body);
      body.createdAt = Date.now();
      const column = this.inStatus(body.status);
      const last = column[column.length - 1];
      body.order = Math.max(body.createdAt, last ? TaskModel.orderOf(last) + ORDER_STEP : 0);
      return this.add(body);
    }

    /* Mueve la tarea a la columna status, justo antes de beforeId
       (o al final si no se indica). Solo se reescribe el orden de esta tarea:
       se coloca a medio camino entre sus nuevas vecinas. */
    move(id, status, beforeId){
      const t = this.find(id);
      if(!t || !this.isReady()) return;
      const column = this.inStatus(status).filter((x) => x.id !== id);
      let idx = beforeId ? column.findIndex((x) => x.id === beforeId) : -1;
      if(idx === -1) idx = column.length;
      const prev = column[idx - 1];
      const next = column[idx];
      /* Soltada en el mismo sitio: nada que hacer. */
      if(TaskModel.stageKey(t) === status && this.inStatus(status).indexOf(t) === idx) return;

      let order;
      if(prev && next) order = (TaskModel.orderOf(prev) + TaskModel.orderOf(next)) / 2;
      else if(prev) order = TaskModel.orderOf(prev) + ORDER_STEP;
      else if(next) order = TaskModel.orderOf(next) - ORDER_STEP;
      else order = Date.now();

      /* Vecinas con el mismo orden (o casi): no hay hueco, se renumera la columna. */
      if(prev && next && !(order > TaskModel.orderOf(prev) && order < TaskModel.orderOf(next))){
        const list = column.slice();
        list.splice(idx, 0, t);
        const now = Date.now();
        list.forEach((x, i) => {
          const patch = x === t ? {status:status, order:(i + 1) * ORDER_STEP} : {order:(i + 1) * ORDER_STEP};
          Object.assign(x, patch);
          this.update(x.id, Object.assign({updatedAt:now}, patch)).catch(() => {});
        });
        this.emit('change');
        return;
      }

      this.patchLocal(id, {status:status, order:order});
      this.update(id, {status:status, order:order, updatedAt:Date.now()}).catch(() => {});
    }

    reschedule(id, dueDate){
      const t = this.find(id);
      if(!t || t.dueDate === dueDate || !this.isReady()) return;
      this.patchLocal(id, {dueDate:dueDate});
      this.update(id, {dueDate:dueDate, updatedAt:Date.now()}).catch(() => {});
    }

    saveLinks(id, linkedContacts, linkedVault){
      return this.update(id, {linkedContacts:linkedContacts, linkedVault:linkedVault}).catch(() => {});
    }

    notes(taskId){
      return this.doc(taskId).collection('notes');
    }

    /* Escucha las notas de una tarea; devuelve la función para dejar de escuchar. */
    watchNotes(taskId, onNotes, onError){
      return this.notes(taskId).orderBy('createdAt', 'asc').onSnapshot((snap) => onNotes(snap.docs), onError);
    }

    addNote(taskId, text, imageAssetId){
      return this.notes(taskId).add({text:text, imageAssetId:imageAssetId || '', createdAt:Date.now()});
    }

    removeNote(taskId, noteId){
      return this.notes(taskId).doc(noteId).delete();
    }

    /* Copia de todas las tareas con sus notas incrustadas (para exportar). */
    withNotes(){
      return Promise.all(this.items.map((t) => {
        return this.notes(t.id).get().then((snap) => {
          const copy = Object.assign({}, t);
          copy.notes = snap.docs.map((d) => Object.assign({}, d.data() || {}, {id:d.id}));
          return copy;
        });
      }));
    }
  }

  TaskModel.STATUS = STATUS;
  TaskModel.setStages(Workhub.models.ProjectTemplates.stagesOf(Workhub.models.ProjectTemplates.DEFAULT_TYPE));
  Workhub.models.TaskModel = TaskModel;
})();
