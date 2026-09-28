/* Tareas del tablero, sus estados y sus notas (subcolección 'notes'). */
(function(){
  const {todayYmd} = Workhub.utils.dates;

  const STATUS = [
    {key:'pendiente', label:'Pendiente', dot:'var(--st-pend)', bg:'var(--st-pend-bg)', fg:'var(--st-pend)'},
    {key:'proceso', label:'En proceso', dot:'var(--st-proc)', bg:'var(--st-proc-bg)', fg:'var(--st-proc)'},
    {key:'espera', label:'Esperando al cliente', dot:'var(--st-wait)', bg:'var(--st-wait-bg)', fg:'var(--st-wait)'},
    {key:'completada', label:'Completada', dot:'var(--st-done)', bg:'var(--st-done-bg)', fg:'var(--st-done)'}
  ];

  class TaskModel extends Workhub.models.CollectionModel {
    constructor(){
      super('tasks');
    }

    static statusOf(key){
      return STATUS.find((s) => s.key === key) || STATUS[0];
    }

    /* '' (sin fecha) | 'done' | 'overdue' | 'today' | 'future' */
    static dueState(t){
      if(!t.dueDate) return '';
      if(t.status === 'completada') return 'done';
      const today = todayYmd();
      if(t.dueDate < today) return 'overdue';
      if(t.dueDate === today) return 'today';
      return 'future';
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

    countByClient(name){
      return this.items.filter((t) => t.cliente === name).length;
    }

    save(id, body){
      body.updatedAt = Date.now();
      if(id) return this.update(id, body);
      body.createdAt = Date.now();
      return this.add(body);
    }

    move(id, status){
      const t = this.find(id);
      if(!t || t.status === status || !this.isReady()) return;
      this.patchLocal(id, {status:status});
      this.update(id, {status:status, updatedAt:Date.now()}).catch(() => {});
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
  Workhub.models.TaskModel = TaskModel;
})();
