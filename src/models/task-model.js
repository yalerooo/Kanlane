/* Tareas del tablero, sus estados y sus notas (subcolección 'notes'). */
(function(){
  const {todayYmd, pad2} = Workhub.utils.dates;

  /* Etapas del proyecto abierto. Es un único array que se rellena en el sitio
     (setStages), así todos los que lo leen ven siempre las etapas actuales. */
  const STATUS = [];

  const stageView = (s) => {
    const c = Workhub.models.ProjectTemplates.colorOf(s.color);
    /* label: el nombre para enseñar (ver ProjectTemplates.stageText); raw: el guardado. */
    return {key:s.key, label:Workhub.models.ProjectTemplates.stageText(s), raw:s.label, done:!!s.done, limit:s.limit || 0, color:c.key, dot:c.dot, bg:c.bg, fg:c.fg};
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
  /* La hora de ahora, 'HH:MM', para comparar con dueTime. */
  function nowHm(){
    const d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* Días de una fecha AAAA-MM-DD a otra, y una fecha desplazada n días. */
  function daysBetween(a, b){
    const {parseYmd} = Workhub.utils.dates;
    return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  }
  function shiftYmd(date, n){
    const {parseYmd, ymd} = Workhub.utils.dates;
    const d = parseYmd(date);
    return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }

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
      /* Con hora, pasada esa hora de hoy ya está vencida. */
      if(t.dueDate === today) return t.dueTime && t.dueTime < nowHm() ? 'overdue' : 'today';
      return 'future';
    }

    /* Intervalo de la tarea para el cronograma: {start, end} en AAAA-MM-DD, o null si no tiene
       ninguna fecha. Solo fecha límite (o solo inicio): un día. Un inicio posterior a la fecha
       límite (datos antiguos o de fuera) se trata como ese mismo día. */
    static rangeOf(t){
      const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
      const start = ok(t && t.startDate) ? t.startDate : '';
      const end = ok(t && t.dueDate) ? t.dueDate : '';
      if(!start && !end) return null;
      if(!end) return {start:start, end:start};
      return {start:start && start <= end ? start : end, end:end};
    }

    /* Día del mes del que parte la repetición mensual o anual de una tarea. Una tarea del día 31
       cae el 30 en noviembre: la siguiente guarda en repeatAnchor («31@2026-11-30») el día original
       y la fecha para la que se calculó, y así diciembre vuelve al 31. Si alguien cambia la fecha
       a mano, la marca deja de coincidir y manda el día de la fecha nueva. */
    static repeatDay(t){
      const m = /^(\d{1,2})@(\d{4}-\d{2}-\d{2})$/.exec((t && t.repeatAnchor) || '');
      return m && m[2] === t.dueDate && +m[1] >= 1 && +m[1] <= 31 ? +m[1] : 0;
    }

    /* Próxima fecha límite de una tarea que se repite: la siguiente que no esté ya en el pasado.
       day (opcional): el día del mes original, si la fecha actual quedó recortada (repeatDay). */
    static nextDue(dueDate, repeat, day){
      if(!dueDate || REPEAT_KEYS.indexOf(repeat) === -1) return '';
      const {parseYmd, ymd} = Workhub.utils.dates;
      const first = parseYmd(dueDate);
      if(isNaN(first)) return '';
      day = day || first.getDate();
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
      const from = before ? TaskModel.stageKey(before) : '';
      return this.update(id, body).then((res) => {
        const now = Object.assign({}, before, body, {id:id});
        if(!wasDone && TaskModel.isDone(now)) this.spawnNext(now);
        if(before && body.status && TaskModel.stageKey(now) !== from) this.emit('auto', {type:'moved', id:id, from:from, to:TaskModel.stageKey(now)});
        return res;
      });
    }

    /* Al terminar una tarea que se repite, crea la siguiente (sin subtareas marcadas). Una sola vez por tarea. */
    spawnNext(t){
      const day = TaskModel.repeatDay(t) || +String(t.dueDate || '').slice(8);
      const next = TaskModel.nextDue(t.dueDate, t.repeat, day);
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
      if(t.dueTime) copy.dueTime = t.dueTime;
      /* La siguiente dura lo mismo y conserva los campos personalizados. */
      if(t.startDate && t.startDate <= t.dueDate) copy.startDate = shiftYmd(t.startDate, daysBetween(t.dueDate, next));
      if(t.custom && typeof t.custom === 'object') copy.custom = Object.assign({}, t.custom);
      if(Array.isArray(t.assignees)) copy.assignees = t.assignees.slice();
      /* El mes no tiene ese día: la siguiente recuerda cuál era (ver repeatDay). */
      if((t.repeat === 'monthly' || t.repeat === 'yearly') && day !== +next.slice(8)) copy.repeatAnchor = day + '@' + next;
      /* Si las reglas publicadas aún no admiten repeatAnchor, la tarea se crea sin él, como antes. */
      const create = () => this._create(copy);
      const made = copy.repeatAnchor ? create().catch(() => { delete copy.repeatAnchor; return create(); }) : create();
      return Promise.all([made, this.update(t.id, {repeatSpawned:true})]).then(() => {
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
      /* 'auto': cambios hechos por una persona (crear, mover) que pueden disparar una automatización.
         Lo que llega de otro dispositivo, de GitHub o de una importación no pasa por aquí. */
      return this.add(body).then((ref) => {
        if(ref && ref.id) this.emit('auto', {type:'created', id:ref.id, to:TaskModel.stageKey(body)});
        return ref;
      });
    }

    /* Escritura que viene de la sincronización con GitHub: la tarea queda
       como sincronizada (updatedAt y ghSyncedAt iguales, así no cuenta como cambio local). */
    saveSynced(id, body){
      /* Un proyecto con cifrado total no se sincroniza con GitHub (no hay campos gh*). */
      if(this.cipher) return Promise.reject(Workhub.models.ProjectCipher.error('encrypted'));
      body.updatedAt = body.ghSyncedAt = Date.now();
      if(id) return this.update(id, body);
      return this._create(body);
    }

    /* Marca la tarea como sincronizada sin tocar updatedAt. at: cuándo empezó a enviarse. */
    markSynced(id, at, patch){
      if(this.cipher) return Promise.reject(Workhub.models.ProjectCipher.error('encrypted'));
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
      const from = TaskModel.stageKey(t);
      const moved = () => { if(from !== status) this.emit('auto', {type:'moved', id:id, from:from, to:status}); };
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
        moved();
        return;
      }

      this.patchLocal(id, {status:status, order:order});
      this.update(id, {status:status, order:order, updatedAt:Date.now()}).catch(() => {});
      if(!wasDone && TaskModel.isDone(t)) this.spawnNext(t);
      moved();
    }

    reschedule(id, dueDate){
      const t = this.find(id);
      if(!t || t.dueDate === dueDate || !this.isReady()) return;
      const patch = {dueDate:dueDate};
      /* El inicio nunca queda después de la fecha límite: si lo haría, se mueve con ella. */
      if(t.startDate && dueDate && t.startDate > dueDate) patch.startDate = t.dueDate && t.startDate <= t.dueDate ? shiftYmd(t.startDate, daysBetween(t.dueDate, dueDate)) : dueDate;
      this.patchLocal(id, patch);
      this.update(id, Object.assign({updatedAt:Date.now()}, patch)).catch(() => {});
    }

    /* Cambia el intervalo de la tarea (cronograma). '' = sin esa fecha. Devuelve false si el
       intervalo no vale (inicio posterior a la fecha límite, o ninguna fecha) o no cambia nada. */
    setRange(id, startDate, dueDate){
      const t = this.find(id);
      startDate = startDate || '';
      dueDate = dueDate || '';
      if(!t || !this.isReady() || (!startDate && !dueDate) || (startDate && dueDate && startDate > dueDate)) return false;
      if((t.startDate || '') === startDate && (t.dueDate || '') === dueDate) return false;
      const patch = {dueDate:dueDate};
      /* Las tareas sin inicio no llevan el campo. */
      if(startDate || t.startDate) patch.startDate = startDate;
      this.patchLocal(id, patch);
      this.update(id, Object.assign({updatedAt:Date.now()}, patch)).catch(() => {});
      return true;
    }

    saveLinks(id, linkedContacts, linkedVault){
      return this.update(id, {linkedContacts:linkedContacts, linkedVault:linkedVault}).catch(() => {});
    }

    notes(taskId){
      return this.doc(taskId).collection('notes');
    }

    /* Ruta lógica de las notas de una tarea: va en la AAD del cifrado (proyectos con cifrado total). */
    notesPath(taskId){
      return 'tasks/' + taskId + '/notes';
    }

    /* Nota tal como la ven las vistas: {id, data()}, igual que un documento de la base de datos.
       cache (opcional) evita descifrar otra vez una nota que no ha cambiado. */
    _openNote(taskId, d, cache){
      const cipher = this.cipher;
      const raw = d.data() || {};
      const asDoc = (data) => ({id:d.id, data:() => data});
      if(!cipher.isSealed(raw)) return Promise.resolve(asDoc(Object.assign({}, raw, {_plainInEncrypted:true})));
      const iv = cipher.ivOf(raw.e);
      const clear = cipher.clearOf('notes', raw);
      const hit = cache && cache[d.id];
      if(hit && hit.iv === iv) return Promise.resolve(asDoc(Object.assign({}, clear, hit.plain)));
      return cipher.open(this.notesPath(taskId), d.id, raw).then((r) => {
        if(cache) cache[d.id] = {iv:iv, plain:r.plain};
        return asDoc(Object.assign({}, clear, r.plain));
      }, () => asDoc(Object.assign({}, clear, {text:'', _undecryptable:true})));
    }

    /* Escucha las notas de una tarea; devuelve la función para dejar de escuchar. */
    watchNotes(taskId, onNotes, onError){
      const query = this.notes(taskId).orderBy('createdAt', 'asc');
      if(!this.cipher) return query.onSnapshot((snap) => onNotes(snap.docs), onError);
      /* Descifrar es asíncrono: las instantáneas se entregan en orden y, si llega otra, la vieja se salta. */
      const cache = {};
      let alive = true, seq = 0, queue = Promise.resolve();
      const stop = query.onSnapshot((snap) => {
        const mine = ++seq;
        queue = queue.then(() => {
          if(!alive || mine !== seq) return null;
          return Promise.all(snap.docs.map((d) => this._openNote(taskId, d, cache))).then((docs) => {
            if(alive) onNotes(docs);
          });
        }).catch((err) => { if(alive && onError) onError(err); });
      }, onError);
      return () => {
        alive = false;
        if(typeof stop === 'function') stop();
      };
    }

    /* Guarda una nota ya montada (también la usa la importación de copias). En un proyecto cifrado
       se sella antes de escribir: el id va en la AAD, así que se genera primero. */
    addNoteRaw(taskId, data){
      const notes = this.notes(taskId);
      if(!this.cipher) return notes.add(data);
      const ref = notes.doc();
      return this.cipher.seal(this.notesPath(taskId), ref.id, data).then((doc) => ref.set(doc)).then(() => ref);
    }

    /* Adjuntos de una nota tal como se guardó: [{name, type, size, image, parts:[ids]}]. Una nota
       con una sola imagen lleva solo imageAssetId (como siempre); con más cosas, `attachments` y,
       en claro, `assetIds` (todos los documentos de `assets` que enlaza, para poder borrarlos,
       copiarlos o volver a cifrarlos sin abrir la nota). */
    static attachmentsOf(n){
      const out = [];
      if(n && n.imageAssetId) out.push({name:'', type:'image/jpeg', size:0, image:true, parts:[n.imageAssetId]});
      (Array.isArray(n && n.attachments) ? n.attachments : []).forEach((a) => {
        const parts = Array.isArray(a && a.parts) ? a.parts.filter((id) => typeof id === 'string' && id) : [];
        if(!parts.length) return;
        out.push({name:String(a.name || ''), type:String(a.type || ''), size:+a.size || 0, image:!!a.image, parts:parts});
      });
      return out;
    }

    /* attachments: los adjuntos ya subidos (o, como antes, el id de una imagen). */
    addNote(taskId, text, attachments){
      const team = Workhub.views.team;
      const actorUid = team.enabled() ? team.meUid() : '';
      const list = typeof attachments === 'string' ? (attachments ? [{image:true, parts:[attachments]}] : [])
        : TaskModel.attachmentsOf({attachments:attachments});
      const single = list.length === 1 && list[0].image && list[0].parts.length === 1;
      const data = {text:text, imageAssetId:single ? list[0].parts[0] : '', createdAt:Date.now(),
        kind:actorUid ? 'comment' : 'note', actorUid:actorUid, actorName:actorUid ? team.name(actorUid) : ''};
      if(list.length && !single){
        data.attachments = list.map((a) => ({name:a.name.slice(0, 200), type:a.type.slice(0, 120), size:a.size, image:a.image, parts:a.parts}));
        data.assetIds = list.reduce((ids, a) => ids.concat(a.parts), []);
      }
      return this.addNoteRaw(taskId, data);
    }

    addActivity(taskId, text){
      const team = Workhub.views.team;
      if(!team.enabled() || !team.meUid()) return Promise.resolve();
      return this.addNoteRaw(taskId, {kind:'activity', text:text, actorUid:team.meUid(),
        actorName:team.name(team.meUid()), createdAt:Date.now()});
    }

    /* Marca o desmarca la casilla número n (- [ ] en Markdown) del texto de una nota. En un proyecto
       cifrado la nota se abre, se cambia y se vuelve a sellar entera. */
    toggleNoteTask(taskId, noteId, n, checked){
      const ref = this.notes(taskId).doc(noteId);
      const toggle = (text) => Workhub.utils.markdown.toggleTask(text || '', n, checked);
      return ref.get().then((snap) => {
        const raw = (snap && snap.exists !== false && snap.data && snap.data()) || null;
        if(!raw) return null;
        const cipher = this.cipher;
        if(!cipher || !cipher.isSealed(raw)){
          const text = toggle(raw.text);
          return text === (raw.text || '') ? null : ref.update({text:text});
        }
        const path = this.notesPath(taskId);
        return cipher.open(path, noteId, raw).then((r) => {
          const text = toggle(r.plain.text);
          if(text === (r.plain.text || '')) return null;
          return cipher.seal(path, noteId, Object.assign({}, cipher.clearOf('notes', raw), r.plain, {text:text})).then((doc) => ref.set(doc));
        });
      });
    }

    /* Elimina la nota y devuelve los documentos de `assets` que enlazaba con `assetIds`, para
       que se borren también. La imagen de una nota antigua (imageAssetId) se deja: una copia
       importada puede enlazar la misma. */
    removeNote(taskId, noteId){
      const ref = this.notes(taskId).doc(noteId);
      return ref.get().then((snap) => {
        const data = (snap && snap.exists !== false && snap.data && snap.data()) || {};
        return Array.isArray(data.assetIds) ? data.assetIds.filter((id) => typeof id === 'string' && id) : [];
      }, () => []).then((ids) => ref.delete().then(() => ids));
    }

    /* Copia de todas las tareas con sus notas incrustadas (para exportar). */
    withNotes(){
      return Promise.all(this.items.map((t) => {
        return this.notes(t.id).get().then((snap) => {
          const copy = Object.assign({}, t);
          if(this.cipher){
            return Promise.all(snap.docs.map((d) => this._openNote(t.id, d))).then((docs) => {
              copy.notes = docs.map((d) => Object.assign({}, d.data(), {id:d.id}));
              return copy;
            });
          }
          copy.notes = snap.docs.map((d) => Object.assign({}, d.data() || {}, {id:d.id}));
          return copy;
        });
      }));
    }
  }

  TaskModel.STATUS = STATUS;
  TaskModel.REPEATS = REPEATS;
  TaskModel.daysBetween = daysBetween;
  TaskModel.shiftYmd = shiftYmd;
  TaskModel.setStages(Workhub.models.ProjectTemplates.stagesOf(Workhub.models.ProjectTemplates.DEFAULT_TYPE));
  Workhub.models.TaskModel = TaskModel;
})();
