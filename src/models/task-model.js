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

  /* Cada cuánto se repite una tarea. */
  const REPEATS = [
    {key:'', label:'No se repite'},
    {key:'daily', label:'Cada día'},
    {key:'weekly', label:'Cada semana'},
    {key:'biweekly', label:'Cada 2 semanas'},
    {key:'monthly', label:'Cada mes'},
    {key:'yearly', label:'Cada año'}
  ];
  const REPEAT_KEYS = REPEATS.map((r) => r.key).filter(Boolean);

  /* Suma un periodo a una fecha; en meses y años conserva el día (recortado al último del mes). */
  function addPeriod(date, repeat, day){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if(repeat === 'daily') d.setDate(d.getDate() + 1);
    else if(repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if(repeat === 'biweekly') d.setDate(d.getDate() + 14);
    else {
      const months = repeat === 'yearly' ? 12 : 1;
      const y = d.getFullYear(), m = d.getMonth() + months;
      const last = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(day, last));
    }
    return d;
  }

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

    /* Próxima fecha límite de una tarea que se repite: la siguiente que no esté ya en el pasado. */
    static nextDue(dueDate, repeat){
      if(!dueDate || REPEAT_KEYS.indexOf(repeat) === -1) return '';
      const {parseYmd, ymd} = Workhub.utils.dates;
      const first = parseYmd(dueDate);
      if(isNaN(first)) return '';
      const day = first.getDate();
      const today = todayYmd();
      let d = first, guard = 0;
      do { d = addPeriod(d, repeat, day); } while(ymd(d) < today && ++guard < 800);
      return ymd(d);
    }

    /* {done, total} de las subtareas (total 0 si no tiene). */
    static checklistProgress(t){
      const list = Array.isArray(t && t.checklist) ? t.checklist : [];
      return {done:list.filter((c) => c && c.done).length, total:list.length};
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

    /* assignee (solo en equipos): '' todas, 'me' las mías, 'none' sin asignar o el uid de un miembro. */
    filter(query, cliente, assignee){
      const q = (query || '').trim().toLowerCase();
      const T = Workhub.views.team;
      return this.items.filter((t) => {
        if(cliente && (t.cliente || 'Sin cliente') !== cliente) return false;
        if(assignee && T.enabled()){
          const who = T.assigned(t);
          if(assignee === 'none'){ if(who.length) return false; }
          else if(who.indexOf(assignee === 'me' ? T.meUid() : assignee) === -1) return false;
        }
        if(q){
          const names = T.enabled() ? T.assigned(t).map((u) => T.name(u)).join(' ') : '';
          const hay = ((t.title || '') + ' ' + (t.desc || '') + ' ' + (t.cliente || '') + ' ' + (t.contacto || '') + ' ' + names + ' ' + (Array.isArray(t.labels) ? t.labels.join(' ') : '')).toLowerCase();
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
      if(!id) return this._create(body);
      const before = this.find(id);
      const wasDone = before ? TaskModel.isDone(before) : false;
      return this.update(id, body).then((res) => {
        const now = Object.assign({}, before, body, {id:id});
        if(!wasDone && TaskModel.isDone(now)) this.spawnNext(now);
        return res;
      });
    }

    /* Al terminar una tarea que se repite, crea la siguiente (sin subtareas marcadas). Una sola vez por tarea. */
    spawnNext(t){
      const next = TaskModel.nextDue(t.dueDate, t.repeat);
      if(!next || t.repeatSpawned || !STATUS.length || !this.isReady()) return Promise.resolve(null);
      const copy = {
        title:t.title || '', desc:t.desc || '', cliente:t.cliente || '', contacto:t.contacto || '',
        status:STATUS[0].key, dueDate:next, repeat:t.repeat,
        labels:Array.isArray(t.labels) ? t.labels.slice() : [],
        linkedContacts:Array.isArray(t.linkedContacts) ? t.linkedContacts.slice() : [],
        linkedVault:Array.isArray(t.linkedVault) ? t.linkedVault.slice() : [],
        checklist:(Array.isArray(t.checklist) ? t.checklist : []).map((c) => ({id:c.id, text:c.text, done:false})),
        updatedAt:Date.now()
      };
      if(Array.isArray(t.assignees)) copy.assignees = t.assignees.slice();
      return Promise.all([this._create(copy), this.update(t.id, {repeatSpawned:true})]).then(() => {
        this.emit('recurred', {date:next, title:t.title});
        return next;
      });
    }

    /* Marca o desmarca una subtarea. */
    toggleCheck(id, itemId, done){
      const t = this.find(id);
      if(!t || !Array.isArray(t.checklist)) return Promise.resolve();
      const checklist = t.checklist.map((c) => c.id === itemId ? Object.assign({}, c, {done:!!done}) : c);
      this.patchLocal(id, {checklist:checklist});
      return this.update(id, {checklist:checklist, updatedAt:Date.now()}).catch(() => {});
    }

    _create(body){
      body.createdAt = Date.now();
      const column = this.inStatus(body.status);
      const last = column[column.length - 1];
      body.order = Math.max(body.createdAt, last ? TaskModel.orderOf(last) + ORDER_STEP : 0);
      return this.add(body);
    }

    /* Escritura que viene de la sincronización con GitHub: la tarea queda
       como sincronizada (updatedAt y ghSyncedAt iguales, así no cuenta como cambio local). */
    saveSynced(id, body){
      body.updatedAt = body.ghSyncedAt = Date.now();
      if(id) return this.update(id, body);
      return this._create(body);
    }

    /* Marca la tarea como sincronizada sin tocar updatedAt. at: cuándo empezó a enviarse. */
    markSynced(id, at, patch){
      return this.update(id, Object.assign({ghSyncedAt:at}, patch || {}));
    }

    /* Avisa de lo que se borra (la integración con GitHub no debe volver a importarlo). */
    remove(id){
      const t = this.find(id);
      if(t) this.emit('removed', t);
      return super.remove(id);
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

      const wasDone = TaskModel.isDone(t);
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
        if(!wasDone && TaskModel.isDone(t)) this.spawnNext(t);
        return;
      }

      this.patchLocal(id, {status:status, order:order});
      this.update(id, {status:status, order:order, updatedAt:Date.now()}).catch(() => {});
      if(!wasDone && TaskModel.isDone(t)) this.spawnNext(t);
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
  TaskModel.REPEATS = REPEATS;
  TaskModel.setStages(Workhub.models.ProjectTemplates.stagesOf(Workhub.models.ProjectTemplates.DEFAULT_TYPE));
  Workhub.models.TaskModel = TaskModel;
})();
