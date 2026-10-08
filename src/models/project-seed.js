/* Semilla de un proyecto nuevo: lo que trae, además de las etapas, un tablero importado
   (trello-import.js) o una plantilla (project-gallery.js):
   {source, nombre, clients, stages, labels:[{name, color}],
    tasks:[{title, desc, status, dueDate, dueTime, labels, checklist:[{id, text, done}], notes:[{text, createdAt}], cover:{color}, order, createdAt, updatedAt}]}
   Aquí se recorta a los límites de las reglas y se escribe en el proyecto recién creado, con el
   modelo de tareas ya conectado (así un proyecto con cifrado total lo guarda cifrado). */
(function(){
  /* Los de validData('tasks') y validData('notes') de firestore.rules (y EncSchema). */
  const MAX = {title:500, desc:20000, note:20000, check:500, labels:1000, checklist:200, catalog:1000};
  const CONCURRENCY = 8;

  const list = (x) => (Array.isArray(x) ? x : []);
  const cut = (v, max) => String(v == null ? '' : v).slice(0, max);

  const ProjectSeed = {
    /* Campos del documento del proyecto: tipo personalizado con sus etapas y el catálogo de etiquetas. */
    config(seed){
      const PT = Workhub.models.ProjectTemplates;
      const fields = PT.fieldsFor(PT.CUSTOM_TYPE, seed.stages, seed.clients);
      const labels = list(seed.labels).filter((l) => l && l.name).slice(0, MAX.catalog).map((l) => ({name:cut(l.name, 60), color:cut(l.color, 6)}));
      if(labels.length) fields.labels = labels;
      return fields;
    },

    /* Tarea tal como se guarda. fallback: etapa para las que no traen una válida. */
    task(t, stageKeys, fallback){
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || '') ? t.dueDate : '';
      const now = Date.now();
      const body = {
        title:cut(t.title, MAX.title),
        desc:cut(t.desc, MAX.desc),
        cliente:'',
        contacto:'',
        status:stageKeys.indexOf(t.status) !== -1 ? t.status : fallback,
        dueDate:dueDate,
        labels:list(t.labels).filter((n) => typeof n === 'string' && n).slice(0, MAX.labels),
        checklist:list(t.checklist).filter((c) => c && c.text).slice(0, MAX.checklist)
          .map((c, i) => ({id:cut(c.id, 40) || ('c' + i), text:cut(c.text, MAX.check), done:!!c.done})),
        order:typeof t.order === 'number' ? t.order : (t.createdAt || now),
        createdAt:t.createdAt || now,
        updatedAt:t.updatedAt || now
      };
      if(dueDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.dueTime || '')) body.dueTime = t.dueTime;
      if(/^\d{4}-\d{2}-\d{2}$/.test(t.startDate || '') && (!dueDate || t.startDate <= dueDate)) body.startDate = t.startDate;
      if(typeof t.location === 'string' && t.location.trim()) body.location = cut(t.location.trim(), 200);
      /* Portada: solo de color (una semilla no trae imágenes adjuntas). */
      const color = t.cover && typeof t.cover.color === 'string' ? t.cover.color : '';
      if(color && Workhub.models.ProjectTemplates.COLORS.some((c) => c.key === color)) body.cover = {color:color};
      /* PENDIENTE: campos que el importador de Trello ya lee y Kanlane aún no guarda. Al crear cada
         uno (aquí, en validData('tasks') de firestore.rules y en EncSchema), descomentar su línea.
      if(t.dueComplete) body.dueComplete = true;
      if(t.dueReminder != null) body.dueReminder = t.dueReminder;
      if(list(t.attachments).length) body.attachments = t.attachments.slice(0, 50);
      if(list(t.customFields).length) body.customFields = t.customFields;
      if(t.trelloUrl) body.sourceUrl = t.trelloUrl;
      */
      return body;
    },

    /* Escribe las tareas y sus notas. tasks: el TaskModel conectado al proyecto nuevo.
       opts.alive(): false si ya no es ese proyecto el que está abierto (se deja de escribir).
       Un fallo no detiene el resto. Devuelve {tasks, notes, failed}. */
    write(tasks, seed, opts){
      const alive = (opts && opts.alive) || (() => true);
      const keys = list(seed.stages).map((s) => s.key);
      const res = {tasks:0, notes:0, failed:0};
      const one = (t) => {
        if(!alive()){ res.failed++; return Promise.resolve(); }
        return tasks.add(ProjectSeed.task(t, keys, keys[0])).then((ref) => {
          res.tasks++;
          return Promise.all(list(t.notes).filter((n) => n && n.text).map((n) => {
            return tasks.addNoteRaw(ref.id, {text:cut(n.text, MAX.note), imageAssetId:'', createdAt:n.createdAt || Date.now(),
              kind:'note', actorUid:'', actorName:''}).then(() => { res.notes++; }, () => {});
          }));
        }, () => { res.failed++; });
      };
      return Workhub.utils.pool.run(list(seed.tasks), CONCURRENCY, one).then(() => res);
    }
  };

  Workhub.models.ProjectSeed = ProjectSeed;
})();
