/* Importador de Trello: convierte el JSON que exporta un tablero (menú del tablero → Imprimir,
   exportar y compartir → Exportar como JSON) en la semilla de un proyecto nuevo (ver project-seed.js).
   No toca la base de datos ni la página: solo traduce un formato al otro.

   Qué se importa hoy:
   - tablero → proyecto (nombre); listas abiertas → etapas, en su orden (con su límite de tarjetas);
   - tarjetas abiertas → tareas, en su orden: título, descripción, fecha y hora límite, etiquetas;
   - checklists → subtareas (si la tarjeta tiene varias, cada subtarea lleva delante el nombre de la suya);
   - etiquetas del tablero → catálogo de etiquetas del proyecto (las que no tienen nombre, el de su color);
   - comentarios → notas de la tarea (con el nombre de quien lo escribió delante).

   Lo que Trello tiene y Kanlane todavía no está ya leído más abajo, comentado y marcado con
   «PENDIENTE»: al añadir el campo (TaskModel, validData('tasks') de firestore.rules y EncSchema)
   basta con descomentar su bloque aquí y en ProjectSeed.task(). */
(function(){
  const MAX_STAGES = 500;     /* ProjectTemplates.MAX_STAGES y listWithin(stages) de las reglas */
  const MAX_CATALOG = 1000;   /* listWithin(labels) del documento del proyecto */
  const ORDER_STEP = 1024;    /* el mismo salto que TaskModel */

  /* Colores de las etiquetas de Trello → hexadecimal sin # (como los guarda Kanlane). */
  const LABEL_HEX = {
    green:'4bce97', green_dark:'1f845a', green_light:'baf3db',
    yellow:'f5cd47', yellow_dark:'946f00', yellow_light:'f8e6a0',
    orange:'fea362', orange_dark:'c25100', orange_light:'fedec8',
    red:'f87168', red_dark:'c9372c', red_light:'ffd5d2',
    purple:'9f8fef', purple_dark:'6e5dc6', purple_light:'dfd8fd',
    blue:'579dff', blue_dark:'0c66e4', blue_light:'cce0ff',
    sky:'6cc3e0', sky_dark:'227d9b', sky_light:'c6edfb',
    lime:'94c748', lime_dark:'5b7f24', lime_light:'d3f1a7',
    pink:'e774bb', pink_dark:'ae4787', pink_light:'fdd0ec',
    black:'8590a2', black_dark:'626f86', black_light:'dcdfe4'
  };
  const NO_COLOR = '6e7681';

  /* Color de una lista de Trello → color de etapa de Kanlane. */
  const LIST_COLOR = {green:'green', lime:'green', yellow:'orange', orange:'orange', red:'red', magenta:'red', pink:'red',
    purple:'violet', blue:'blue', teal:'blue', sky:'blue', gray:'gray', black:'gray'};
  /* Las listas sin color se reparten estos; la etapa final va en verde. */
  const STAGE_CYCLE = ['gray', 'blue', 'orange', 'violet', 'red'];
  /* Nombre de lista que suena a «terminado»: esa etapa cuenta sus tareas como hechas. */
  const DONE_NAME = /(^|[^a-záéíóúñ])(done|hecho|hechas?|terminad[oa]s?|completad[oa]s?|finalizad[oa]s?|cerrad[oa]s?|closed|completed?|finished|listo|win|won|ganad[oa]s?|lost|perdid[oa]s?|cancell?ed|cancelad[oa]s?)([^a-záéíóúñ]|$)/i;

  /* Terminado sin éxito: esa etapa final va en rojo. */
  const LOST_NAME = /(^|[^a-záéíóúñ])(lost|perdid[oa]s?|cancell?ed|cancelad[oa]s?)([^a-záéíóúñ]|$)/i;

  const list = (x) => (Array.isArray(x) ? x : []);
  const text = (x) => (typeof x === 'string' ? x : '');
  const byPos = (a, b) => ((+a.pos || 0) - (+b.pos || 0));
  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  /* Los ids de Trello empiezan por la fecha de creación (segundos, en hexadecimal). */
  function idTime(id){
    if(!/^[0-9a-f]{24}$/i.test(text(id))) return 0;
    const ms = parseInt(id.slice(0, 8), 16) * 1000;
    return ms > Date.UTC(2011, 0, 1) && ms < Date.now() + 864e5 ? ms : 0;
  }

  function time(iso){
    const ms = iso ? new Date(iso).getTime() : NaN;
    return isNaN(ms) ? 0 : ms;
  }

  /* Fecha ISO de Trello → {date:'AAAA-MM-DD', time:'HH:MM'} en la hora de este dispositivo. */
  function localParts(iso){
    const ms = time(iso);
    if(!ms) return null;
    const d = new Date(ms);
    return {date:d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), time:pad2(d.getHours()) + ':' + pad2(d.getMinutes())};
  }

  /* Nombre para una etiqueta sin nombre: el de su color. */
  function colorName(color){
    const parts = text(color).split('_');
    const base = {
      green:Workhub.t('Verde'), yellow:Workhub.t('Amarillo'), orange:Workhub.t('Naranja'), red:Workhub.t('Rojo'),
      purple:Workhub.t('Morado'), blue:Workhub.t('Azul'), sky:Workhub.t('Celeste'), lime:Workhub.t('Lima'),
      pink:Workhub.t('Rosa'), black:Workhub.t('Negro')
    }[parts[0]] || Workhub.t('Sin color');
    if(parts[1] === 'dark') return Workhub.t('{color} oscuro', {color:base});
    if(parts[1] === 'light') return Workhub.t('{color} claro', {color:base});
    return base;
  }

  /* Color de una portada de Trello → el color de Kanlane que más se le parece. */
  const COVER_COLOR = {green:'green', lime:'green', yellow:'orange', orange:'orange', red:'red', pink:'red',
    purple:'violet', blue:'blue', sky:'blue', black:'gray'};

  /* Catálogo de etiquetas: [{name, color}] y, por id de Trello, el nombre con el que queda. */
  function readLabels(board, used){
    const catalog = [];
    const nameOf = {};
    const taken = {};
    let dropped = 0;
    /* Primero las que se usan: si no caben todas, se quedan fuera las que no tiene ninguna tarjeta. */
    const all = list(board.labels).filter((l) => l && l.id).sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0));
    all.forEach((l) => {
      const hex = LABEL_HEX[l.color] || NO_COLOR;
      let name = text(l.name).trim().slice(0, 50) || colorName(l.color);
      const same = taken[name.toLowerCase()];
      /* Dos etiquetas con el mismo nombre y distinto color: en Kanlane el nombre es la etiqueta. */
      if(same && same !== hex) name = (name + ' (' + colorName(l.color) + ')').slice(0, 60);
      if(taken[name.toLowerCase()]){ nameOf[l.id] = name; return; }
      if(catalog.length >= MAX_CATALOG){ dropped++; return; }
      taken[name.toLowerCase()] = hex;
      nameOf[l.id] = name;
      catalog.push({name:name, color:hex});
    });
    return {catalog:catalog, nameOf:nameOf, dropped:dropped};
  }

  /* Listas abiertas → etapas. Kanlane admite las mismas que Trello (500); si un archivo trajera más, las que sobran se juntan en la última
     (sus tarjetas llevan el nombre de su lista como etiqueta, para no perder de dónde venían). */
  function readLists(board){
    const open = list(board.lists).filter((l) => l && l.id && !l.closed).sort(byPos);
    const kept = open.slice(0, MAX_STAGES);
    const merged = open.slice(MAX_STAGES);
    /* Puede haber más de una etapa final («Ganado» y «Perdido»); si ninguna lo parece, la última. */
    const finals = kept.map((l) => DONE_NAME.test(text(l.name)));
    if(finals.indexOf(true) === -1) finals[kept.length - 1] = true;
    let cycle = 0;
    const stageOf = {};
    const stages = kept.map((l, i) => {
      const done = finals[i];
      const stage = {
        key:'t' + (i + 1),
        label:text(l.name).trim().slice(0, 40) || Workhub.t('Lista {n}', {n:i + 1}),
        color:LIST_COLOR[l.color] || (done ? (LOST_NAME.test(text(l.name)) ? 'red' : 'green') : STAGE_CYCLE[cycle++ % STAGE_CYCLE.length]),
        done:done
      };
      /* Límite de tarjetas de la lista (Trello: softLimit). */
      const limit = Math.floor(+l.softLimit);
      if(limit >= 1 && limit <= 999) stage.limit = limit;
      stageOf[l.id] = stage.key;
      return stage;
    });
    const mergedName = {};
    merged.forEach((l) => {
      stageOf[l.id] = stages[stages.length - 1].key;
      mergedName[l.id] = text(l.name).trim().slice(0, 50);
    });
    return {stages:stages, stageOf:stageOf, mergedName:mergedName, merged:merged.length,
      archived:list(board.lists).filter((l) => l && l.closed).length};
  }

  /* Comentarios por tarjeta. Trello exporta como mucho las últimas 1000 acciones del tablero. */
  function readComments(board){
    const by = {};
    list(board.actions).forEach((a) => {
      if(!a || (a.type !== 'commentCard' && a.type !== 'copyCommentCard') || !a.data) return;
      const cardId = a.data.card && a.data.card.id;
      const body = text(a.data.text).trim();
      if(!cardId || !body) return;
      const who = a.memberCreator ? text(a.memberCreator.fullName) || text(a.memberCreator.username) : '';
      (by[cardId] = by[cardId] || []).push({
        text:(who ? who + ': ' : '') + body,
        createdAt:time(a.date) || idTime(a.id) || Date.now()
        /* PENDIENTE (autoría real de las notas): hoy una nota importada no tiene autor de Kanlane.
        , author:{name:who, username:a.memberCreator && a.memberCreator.username, trelloId:a.idMemberCreator} */
      });
    });
    Object.keys(by).forEach((id) => by[id].sort((a, b) => a.createdAt - b.createdAt));
    return by;
  }

  /* Checklists de una tarjeta → subtareas, en el orden de Trello. */
  function readChecklist(card, checklists){
    const own = checklists.filter((c) => c.idCard === card.id).sort(byPos);
    const many = own.length > 1;
    const out = [];
    own.forEach((c) => {
      const title = text(c.name).trim();
      list(c.checkItems).slice().sort(byPos).forEach((it) => {
        const name = text(it && it.name).trim();
        if(!name) return;
        out.push({
          id:text(it.id) || ('c' + out.length),
          text:(many && title ? title + ' · ' : '') + name,
          done:it.state === 'complete'
          /* PENDIENTE (fecha y responsable por subtarea, y varias checklists con nombre por tarea):
          , due:localParts(it.due), idMember:it.idMember, group:title */
        });
      });
    });
    return out;
  }

  /* Acepta el texto del archivo o el objeto ya leído. Devuelve la semilla del proyecto. */
  function parse(input){
    let board = input;
    if(typeof input === 'string'){
      try{ board = JSON.parse(input); }catch(err){ throw fail('bad-json'); }
    }
    if(!board || typeof board !== 'object' || !Array.isArray(board.lists) || !Array.isArray(board.cards)) throw fail('not-trello');

    const lists = readLists(board);
    if(lists.stages.length < 2) throw fail('few-lists');

    const cards = board.cards.filter((c) => c && c.id);
    const open = cards.filter((c) => !c.closed && lists.stageOf[c.idList]);
    const used = {};
    open.forEach((c) => list(c.idLabels).forEach((id) => { used[id] = (used[id] || 0) + 1; }));
    const labels = readLabels(board, used);
    const comments = readComments(board);
    const checklists = list(board.checklists).filter((c) => c && c.idCard);
    /* PENDIENTE (asignar a personas): los miembros de Trello no son cuentas de Kanlane. Cuando se
       puedan emparejar (por correo o invitándolos al equipo), usar este mapa para rellenar assignees.
    const members = {};
    list(board.members).forEach((m) => { members[m.id] = {name:m.fullName, username:m.username, avatar:m.avatarUrl}; }); */
    /* PENDIENTE (campos personalizados): definiciones del tablero; los valores van en card.customFieldItems.
    const customFields = {};
    list(board.customFields).forEach((f) => { customFields[f.id] = {name:f.name, type:f.type, options:f.options}; }); */

    const counts = {lists:lists.stages.length, cards:0, labels:labels.catalog.length, checkItems:0, comments:0};
    const position = {};
    /* Portadas de imagen (un adjunto, una foto subida o de Unsplash): el archivo de Trello no trae
       las imágenes, así que esas tarjetas llegan sin portada y se avisa de cuántas son. */
    let imageCovers = 0;
    const tasks = open.slice().sort(byPos).map((c) => {
      const due = localParts(c.due);
      const names = [];
      list(c.idLabels).forEach((id) => { if(labels.nameOf[id] && names.indexOf(labels.nameOf[id]) === -1) names.push(labels.nameOf[id]); });
      if(lists.mergedName[c.idList] && names.indexOf(lists.mergedName[c.idList]) === -1) names.push(lists.mergedName[c.idList]);
      const status = lists.stageOf[c.idList];
      position[status] = (position[status] || 0) + 1;
      const checklist = readChecklist(c, checklists);
      const notes = comments[c.id] || [];
      counts.cards++;
      counts.checkItems += checklist.length;
      counts.comments += notes.length;
      const created = idTime(c.id) || time(c.dateLastActivity) || Date.now();
      const tc = c.cover && typeof c.cover === 'object' ? c.cover : {};
      const coverColor = COVER_COLOR[text(tc.color)];
      if(!coverColor && (tc.idAttachment || tc.idUploadedBackground || (Array.isArray(tc.scaled) && tc.scaled.length))) imageCovers++;
      return Object.assign(coverColor ? {cover:{color:coverColor}} : {}, {
        title:text(c.name).trim() || Workhub.t('(sin título)'),
        desc:text(c.desc),
        status:status,
        dueDate:due ? due.date : '',
        dueTime:due ? due.time : '',
        labels:names,
        checklist:checklist,
        notes:notes,
        order:position[status] * ORDER_STEP,
        createdAt:created,
        updatedAt:time(c.dateLastActivity) || created

        /* ---------- PENDIENTE: campos que Kanlane todavía no tiene ---------- */
        /* Fecha de inicio (CSV «Start Date»):
        , startDate:localParts(c.start) ? localParts(c.start).date : '' */
        /* Vencimiento marcado como completado (CSV «Due Complete») y cuándo se completó:
        , dueComplete:!!c.dueComplete, completedAt:time(c.dateCompleted) */
        /* Aviso antes del vencimiento, en minutos; -1 o null es sin aviso (CSV «Due Reminder»):
        , dueReminder:typeof c.dueReminder === 'number' && c.dueReminder >= 0 ? c.dueReminder : null */
        /* Personas asignadas (CSV «Members»): ver el mapa `members` de arriba.
        , members:list(c.idMembers).map((id) => members[id]).filter(Boolean) */
        /* Adjuntos (CSV «Attachment Count» y «Attachment Links»). Los archivos subidos a Trello piden
           iniciar sesión para bajarlos; los que son enlaces se pueden guardar tal cual.
        , attachments:list(c.attachments).map((a) => ({name:a.name, url:a.url, mimeType:a.mimeType, bytes:a.bytes, isUpload:!!a.isUpload, createdAt:time(a.date)})) */
        /* Ubicación:
        , location:c.coordinates ? {name:c.locationName, address:c.address, lat:c.coordinates.latitude, lng:c.coordinates.longitude} : null */
        /* Votos (CSV «Vote Count»):
        , votes:list(c.idMembersVoted).length */
        /* Valores de los campos personalizados: ver el mapa `customFields` de arriba.
        , customFields:list(c.customFieldItems).map((v) => ({field:customFields[v.idCustomField], value:v.value, idValue:v.idValue})) */
        /* Enlace a la tarjeta original (CSV «Card URL») y su número corto:
        , trelloUrl:c.shortUrl, trelloNumber:c.idShort */
        /* Tarjeta plantilla, separador o tarjeta espejo:
        , isTemplate:!!c.isTemplate, cardRole:c.cardRole, mirrorOf:c.mirrorSourceId */
      });
    });

    const archivedCards = cards.length - open.length;
    /* PENDIENTE (archivo): cuando Kanlane pueda archivar tareas, importar también las tarjetas y las
       listas cerradas (c.closed, l.closed) en vez de saltárselas; hoy solo se cuentan para avisar. */

    return {
      source:'trello',
      nombre:text(board.name).trim().slice(0, 160),
      clients:false,
      stages:lists.stages,
      labels:labels.catalog,
      tasks:tasks,
      counts:counts,
      skipped:{archivedCards:archivedCards, archivedLists:lists.archived, mergedLists:lists.merged, labels:labels.dropped, imageCovers:imageCovers},
      /* Nombre de la etapa que recibe las listas que no caben. */
      mergedInto:lists.merged ? lists.stages[lists.stages.length - 1].label : ''

      /* PENDIENTE (descripción y fondo del proyecto):
      , desc:text(board.desc)
      , background:board.prefs ? {color:board.prefs.backgroundColor, image:board.prefs.backgroundImage, top:board.prefs.backgroundTopColor} : null
      , trelloUrl:board.shortUrl */
    };
  }

  /* Resumen de lo que se va a importar, para enseñarlo antes de crear el proyecto. */
  function summary(seed){
    const c = seed.counts;
    const s = seed.skipped;
    const parts = [Workhub.t('Se importarán → listas: {lists} · tarjetas: {cards} · etiquetas: {labels} · subtareas: {checks} · comentarios: {comments}.',
      {lists:c.lists, cards:c.cards, labels:c.labels, checks:c.checkItems, comments:c.comments})];
    if(s.mergedLists) parts.push(Workhub.t('Kanlane admite {max} etapas: las listas que sobran ({n}) se juntan en «{stage}» y sus tarjetas llevan el nombre de su lista como etiqueta.', {max:MAX_STAGES, n:s.mergedLists, stage:seed.mergedInto}));
    if(s.archivedCards) parts.push(Workhub.t('Tarjetas archivadas que no se importan: {n}.', {n:s.archivedCards}));
    if(s.labels) parts.push(Workhub.t('Etiquetas sin usar que no caben (el máximo es {max}): {n}.', {max:MAX_CATALOG, n:s.labels}));
    if(s.imageCovers) parts.push(Workhub.t('Portadas de imagen que no se importan (el archivo de Trello no trae las imágenes): {n}. Las de color sí.', {n:s.imageCovers}));
    return parts.join(' ');
  }

  Workhub.models.TrelloImport = {parse:parse, summary:summary, LABEL_HEX:LABEL_HEX};
})();
