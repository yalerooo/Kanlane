/* Demo del tablero (/demo/): es el tablero de la aplicación con sus mismas vistas
   (BoardView, TaskDetailView…) y el mismo modelo de tareas (TaskModel), pero con
   datos de ejemplo en memoria. No guarda nada: al recargar vuelve a empezar.

   Se puede: arrastrar tarjetas entre columnas y reordenarlas, abrir una tarea
   (ficha de solo lectura), cambiar su estado, marcar subtareas y buscar o filtrar.
   Todo lo que crea o edita (nueva tarea, editar, columnas, otras secciones…) no
   está disponible: abre un aviso que ofrece crear la cuenta. */
(function(){
  const {todayYmd, ymd} = Workhub.utils.dates;
  const TaskModel = Workhub.models.TaskModel;
  const PT = Workhub.models.ProjectTemplates;
  const toast = Workhub.views.toast;
  const $ = (id) => document.getElementById(id);

  /* ---------- Datos de ejemplo (clientes y personas inventados) ---------- */

  const CLIENTS = {'Estudio Norte':210, 'Taller Costa':24, 'Casa Aldea':150, 'Interno':270};
  Workhub.views.clientColors.setResolver((name) => (name in CLIENTS ? CLIENTS[name] : Workhub.utils.html.hueFor(name)));

  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };
  const stamp = (daysAgo) => Date.now() - daysAgo * 86400000;
  const checks = (...items) => items.map((text, i) => ({id:'c' + i, text:text[0], done:!!text[1]}));

  const SEED = [
    {id:'t1', title:'Maquetar la nueva portada', cliente:'Estudio Norte', status:'pendiente', dueDate:day(-3), contacto:'Marta Ruiz',
      desc:'Pasar el diseño aprobado a HTML y comprobar que se ve bien en el móvil antes de enseñárselo a Marta.',
      checklist:checks(['Cabecera y menú'], ['Sección de servicios'], ['Versión para móvil']), order:1, createdAt:stamp(9), updatedAt:stamp(1)},
    {id:'t2', title:'Preparar presupuesto de mayo', cliente:'Taller Costa', status:'pendiente', dueDate:day(5),
      desc:'Incluye el mantenimiento mensual y las horas de la tienda en línea.',
      checklist:checks(['Revisar horas del mes'], ['Calcular el total'], ['Enviar el PDF']), order:2, createdAt:stamp(6), updatedAt:stamp(2)},
    {id:'t3', title:'Revisar textos de la web', cliente:'Casa Aldea', status:'pendiente', dueDate:day(12), order:3, createdAt:stamp(4), updatedAt:stamp(4)},
    {id:'t4', title:'Integrar el formulario de contacto', cliente:'Estudio Norte', status:'proceso', dueDate:day(0), contacto:'Marta Ruiz',
      desc:'Conectar el formulario con el correo de administración y añadir el aviso de privacidad.',
      checklist:checks(['Diseñar el formulario', true], ['Validar los campos', true], ['Enviar al correo'], ['Probar en producción']), order:1, createdAt:stamp(8), updatedAt:stamp(0)},
    {id:'t5', title:'Ordenar facturas del trimestre', cliente:'Interno', status:'proceso', dueDate:day(8), order:2, createdAt:stamp(5), updatedAt:stamp(3)},
    {id:'t6', title:'Aprobar el logotipo definitivo', cliente:'Taller Costa', status:'espera', dueDate:day(10), contacto:'Lucas Costa',
      desc:'Pendiente de que Lucas confirme la versión en negativo. Se le enviaron las tres propuestas el lunes.', order:1, createdAt:stamp(7), updatedAt:stamp(2)},
    {id:'t7', title:'Entregar fotografías', cliente:'Casa Aldea', status:'completada', dueDate:day(-5), order:1, createdAt:stamp(14), updatedAt:stamp(5)},
    {id:'t8', title:'Reunión de arranque', cliente:'Estudio Norte', status:'completada', dueDate:day(-9), order:2, createdAt:stamp(16), updatedAt:stamp(9)}
  ];

  const NOTES = {
    t1: [{text:'Marta prefiere el menú a la izquierda. Lo dejo así en el prototipo.', createdAt:stamp(2)}],
    t4: [{text:'El correo de administración ya recibe las pruebas.', createdAt:stamp(1)}, {text:'Falta añadir el texto del aviso de privacidad.', createdAt:stamp(0.5)}]
  };

  /* ---------- Base de datos en memoria (la misma forma que usa el modelo) ---------- */

  function memoryDb(seed){
    const docs = new Map(seed.map((d) => [d.id, Object.assign({}, d)]));
    const subs = [];
    let counter = 100;
    const snapshot = () => ({docs:Array.from(docs.values()).map((d) => {
      const data = Object.assign({}, d);
      return {id:d.id, data:() => data};
    })});
    const emit = () => subs.slice().forEach((fn) => fn(snapshot()));
    const col = {
      onSnapshot(fn){ subs.push(fn); setTimeout(() => fn(snapshot()), 0); return () => { subs.splice(subs.indexOf(fn), 1); }; },
      doc(id){
        return {
          update(patch){ if(docs.has(id)){ Object.assign(docs.get(id), patch); emit(); } return Promise.resolve(); },
          set(data){ docs.set(id, Object.assign({}, data, {id:id})); emit(); return Promise.resolve(); },
          delete(){ docs.delete(id); emit(); return Promise.resolve(); }
        };
      },
      add(data){ const id = 'n' + (counter++); docs.set(id, Object.assign({}, data, {id:id})); emit(); return Promise.resolve({id:id}); }
    };
    return {collection: () => col};
  }

  /* ---------- Aviso de lo que no está en la demo ---------- */

  const dlg = $('dlgDemo');
  const MESSAGES = {
    new: ['Crear tareas está en tu cuenta', 'Crea una cuenta gratis para añadir tus propias tareas, con clientes, fechas, subtareas y notas.'],
    edit: ['Editar tareas está en tu cuenta', 'Crea una cuenta gratis para editar tareas, añadir notas y adjuntar imágenes.'],
    column: ['Las columnas se personalizan en tu cuenta', 'Crea una cuenta gratis para elegir las etapas del tablero, ponerles límites y cambiar su color.'],
    section: ['Esta sección está en la aplicación', 'Crea una cuenta gratis para usar el calendario, los clientes, las contraseñas cifradas y los plugins.'],
    project: ['Los proyectos están en tu cuenta', 'Crea una cuenta gratis para tener varios proyectos, cada uno con su propio tablero, e invitar a otras personas.'],
    search: ['La búsqueda global está en tu cuenta', 'Crea una cuenta gratis para buscar con Ctrl K entre tareas, notas, clientes y contactos. Aquí puedes filtrar el tablero con el buscador de arriba.']
  };

  function lock(kind){
    const m = MESSAGES[kind] || MESSAGES.new;
    $('demoTitle').textContent = m[0];
    $('demoText').textContent = m[1];
    const detail = $('dlgTaskView');
    if(detail.open) detail.close();
    if(!dlg.open) dlg.showModal();
    $('btnDemoSignup').focus({preventScroll:true});
  }
  $('btnDemoClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (ev) => { if(ev.target === dlg) dlg.close(); });

  /* ---------- Tablero ---------- */

  TaskModel.setStages(PT.stagesOf('soporte'));
  const tasks = new TaskModel();
  const board = new Workhub.views.BoardView();
  const detail = new Workhub.views.TaskDetailView();
  let openId = null;

  const names = Object.keys(CLIENTS).sort();
  board.setClientOptions(names);
  Workhub.views.Dropdown.enhanceAll(document);

  function render(){
    const f = board.filters();
    let list = tasks.filter(f.query, f.cliente, f.assignee);
    if(f.week) list = board.dueThisWeek(list);
    board.render(list, tasks.items);
  }

  function refreshDetail(){
    if(!openId || !$('dlgTaskView').open) return;
    const t = tasks.find(openId);
    if(t) detail.render(t, {contacts:[], vault:null});
  }

  function openTask(id){
    const t = tasks.find(id);
    if(!t) return;
    openId = id;
    detail.open(t, {contacts:[], vault:null});
    const notes = (NOTES[id] || []).map((n, i) => ({id:id + 'n' + i, data:() => n}));
    detail.renderNotes(notes);
  }

  tasks.on('change', () => { board.showLoaded(); render(); refreshDetail(); });

  board.bindFilters(render);
  board.bindOpen(openTask);
  board.bindMove((id, status, beforeId) => tasks.move(id, status, beforeId));
  board.bindNew(() => lock('new'));
  board.bindQuickAdd(() => lock('new'));
  board.bindColumnMenu(() => lock('column'));
  board.bindColumnMove(() => {});

  detail.bindClose(() => $('dlgTaskView').close());
  detail.bindEdit(() => lock('edit'));
  detail.bindArchive(() => lock('edit'));
  detail.bindStatus((id, status) => { tasks.move(id, status); });
  detail.bindDone((id, status) => { tasks.move(id, status); });
  detail.bindChecklist((id, itemId, done) => tasks.toggleCheck(id, itemId, done));
  detail.bindLinkActions(() => {});
  detail.bindAssignMe(() => {});
  detail.bindComment(() => lock('edit'));
  $('dlgTaskView').addEventListener('close', () => { openId = null; });

  /* El resto de la barra lateral: se ve igual, pero lleva al aviso. */
  document.querySelectorAll('.tab[data-view]').forEach((tab) => {
    if(tab.getAttribute('data-view') === 'tasks') return;
    tab.addEventListener('click', () => lock('section'));
  });
  $('btnProject').addEventListener('click', () => lock('project'));
  $('btnCommand').addEventListener('click', () => lock('search'));
  $('btnAutomations').addEventListener('click', () => lock('section'));
  $('btnArchive').addEventListener('click', () => lock('section'));
  document.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || '');
    if((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')){ ev.preventDefault(); lock('search'); }
    else if(!typing && !document.querySelector('dialog[open]') && (ev.key === 'n' || ev.key === 'N')){ ev.preventDefault(); lock('new'); }
  });

  /* Contadores de la barra lateral, como en la aplicación (AppController.updateCounts). */
  function counts(){
    const open = tasks.items.filter((t) => !TaskModel.isDone(t));
    const set = (id, n, alert) => {
      const el = $(id);
      if(!el) return;
      el.textContent = n ? String(n) : '';
      el.classList.toggle('is-alert', !!alert);
    };
    set('countTasks', open.length, open.some((t) => TaskModel.dueState(t) === 'overdue'));
    set('countCalendar', open.filter((t) => t.dueDate === todayYmd()).length);
    set('countClients', Object.keys(CLIENTS).length);
  }
  tasks.on('change', counts);

  tasks.connect(memoryDb(SEED));
  window.addEventListener('load', () => board.fitHeight());
})();
