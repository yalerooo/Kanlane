/* Smart GP: registra las horas de cada tarea al terminarla y las muestra en un
   calendario por día y proyecto.

   Dos instancias de la misma página:
   - segundo plano (context.mode === 'background'): vigila las tareas; cuando una
     pasa a una etapa final, pide con wh.ui.form las horas, los días y el proyecto.
     También añade «Registrar horas» en la ficha de cada tarea y una etiqueta con
     las horas en las tarjetas.
   - panel (sección Plugins): el calendario, el detalle de cada día y los proyectos.

   Datos (comunes a todos los proyectos de Workhub, wh.storage.user):
     projects   [{id, name, color}]
     log-AAAA-MM [{id, date, hours, project, task, title}]   (uno por día y tarea)
     logged     {idTarea: true}    tareas ya registradas u omitidas
     taskhours  {idTarea: horas}   total por tarea (para la etiqueta de la tarjeta)
     prefs      {hours, project}   lo último que se usó */
(function(){
  'use strict';

  var MANIFEST = {
    id: 'workhub.smartgp',
    name: 'Smart GP',
    version: '1.0.0',
    description: 'Al terminar una tarea, anota las horas, los días y el proyecto. Después míralo todo en un calendario por día y proyecto.',
    author: 'Workhub',
    icon: 'clock',
    color: 172,
    permissions: ['tasks:read', 'storage', 'ui:extend']
  };

  var PALETTE = ['#2F6BFF', '#16A36A', '#E0457B', '#EA6A1F', '#7C5CFF', '#E6A310', '#0E9AA7', '#8B8B94'];
  var GRAY = '#8B8B94';
  var DAY_HOURS = 8;               /* la barra de un día se llena con 8 h */
  var PENDING_DAYS = 45;           /* «terminadas sin horas»: las de los últimos días */

  var tr = WorkhubPlugin.translations({en:{
    'Conectando con Workhub…':'Connecting to Workhub…',
    'Tus horas por día y proyecto':'Your hours by day and project',
    'Registrar horas':'Log hours', 'Proyectos':'Projects', 'Volver':'Back',
    'Tareas terminadas sin horas':'Finished tasks without hours', 'Registrar':'Log', 'Descartar':'Dismiss',
    'Horas del mes':'Hours this month', 'Días trabajados':'Days worked', 'Media por día':'Average per day',
    'Hoy':'Today', 'Mes anterior':'Previous month', 'Mes siguiente':'Next month',
    'Sin proyecto':'No project', 'Sin registros este día.':'Nothing logged this day.',
    'Añadir horas este día':'Add hours this day', 'Editar':'Edit', 'Eliminar':'Delete', '¿Seguro?':'Sure?',
    'Abrir la tarea':'Open task',
    'Horas dedicadas':'Hours spent', 'Proyecto':'Project', 'Descripción':'Description',
    'Ej.: Reunión con el cliente':'E.g. Client meeting',
    'Las horas se reparten a partes iguales entre los días.':'Hours are split evenly across the days.',
    '+ Añadir proyecto…':'+ Add project…', 'Nombre del proyecto':'Project name',
    'Has terminado esta tarea. ¿Cuánto le has dedicado?':'You finished this task. How long did you spend on it?',
    'Añade horas a mano.':'Add hours by hand.', 'Registro manual':'Manual entry', 'Guardar':'Save', 'Omitir':'Skip', 'Cancelar':'Cancel',
    '{h} h registradas en {p}':'{h} h logged in {p}',
    'Editar registro':'Edit entry', 'Registro eliminado':'Entry deleted',
    'Añade proyectos para agrupar tus horas (clientes, líneas de trabajo…).':'Add projects to group your hours (clients, lines of work…).',
    'Aún no hay proyectos. Crea el primero abajo.':'No projects yet. Create the first one below.',
    'Nuevo proyecto':'New project', 'Añadir':'Add', 'Cambiar color':'Change color',
    'Smart GP: registrar horas':'Smart GP: log hours', 'Abrir Smart GP':'Open Smart GP',
    'Apuntar las horas de esta tarea':'Log the hours of this task',
    'h':'h', 'día':'day', 'días':'days', 'registros':'entries',
    'No se pudo conectar con Workhub: {error}':'Could not connect to Workhub: {error}',
    'Este plugin se abre desde Workhub (sección Plugins).':'This plugin opens from Workhub (Plugins section).'
  }});

  var wh = null;
  var now = new Date();
  var st = {
    projects: [], logged: {}, taskHours: {}, prefs: {hours: 1, project: ''},
    tasks: [], doneKeys: [],
    month: {y: now.getFullYear(), m: now.getMonth()}, selected: '', hidden: {},
    view: 'calendar', entries: [], armed: ''
  };
  var queue = Promise.resolve();

  /* ---------- Utilidades ---------- */

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]; });
  }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today(){ return ymd(new Date()); }
  function monthKey(y, m){ return y + '-' + pad(m + 1); }
  function round2(n){ return Math.round(n * 100) / 100; }
  function fmt(h){ return round2(h).toLocaleString(WorkhubPlugin.locale, {maximumFractionDigits: 2}); }
  function newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function project(id){ return st.projects.filter(function(p){ return p.id === id; })[0] || null; }
  function projectName(id){ var p = project(id); return p ? p.name : tr('Sin proyecto'); }
  function projectColor(id){ var p = project(id); return p ? p.color : GRAY; }
  function fail(err){
    var el = document.getElementById('app');
    el.innerHTML = '<p class="wh-muted">' + esc(err && err.message === 'not-in-workhub'
      ? tr('Este plugin se abre desde Workhub (sección Plugins).')
      : tr('No se pudo conectar con Workhub: {error}', {error: err && err.message})) + '</p>';
  }

  /* Reparte las horas entre los días a partes iguales (el último ajusta el resto). */
  function splitHours(total, n){
    var base = Math.floor(total / n * 100) / 100;
    var out = [];
    var sum = 0;
    for(var i = 0; i < n - 1; i++){ out.push(base); sum += base; }
    out.push(round2(total - sum));
    return out;
  }

  /* ---------- Datos ---------- */

  function get(key, dflt){ return wh.storage.user.get(key).then(function(v){ return v == null ? dflt : v; }); }
  function set(key, value){ return wh.storage.user.set(key, value); }
  /* Todas las escrituras de una en una: leen y reescriben el mismo documento. */
  function serial(fn){
    var run = queue.then(fn);
    queue = run.catch(function(){});
    return run;
  }

  function loadBase(){
    return Promise.all([get('projects', []), get('logged', {}), get('taskhours', {}), get('prefs', {hours: 1, project: ''})]).then(function(r){
      st.projects = r[0]; st.logged = r[1]; st.taskHours = r[2]; st.prefs = r[3];
    });
  }
  function loadMonth(){
    return get('log-' + monthKey(st.month.y, st.month.m), []).then(function(a){ st.entries = a; });
  }
  function loadDone(){
    return wh.statuses().then(function(list){
      st.doneKeys = list.filter(function(s){ return s.done; }).map(function(s){ return s.key; });
    });
  }
  function isDone(t){ return st.doneKeys.indexOf(t.status) !== -1; }
  function taskById(id){ return st.tasks.filter(function(t){ return t.id === id; })[0] || null; }

  /* Guarda registros nuevos (repartidos por mes) y actualiza el total de cada tarea. */
  function addEntries(list){
    return serial(function(){
      var byMonth = {};
      list.forEach(function(e){ (byMonth[e.date.slice(0, 7)] = byMonth[e.date.slice(0, 7)] || []).push(e); });
      return Promise.all(Object.keys(byMonth).map(function(k){
        return get('log-' + k, []).then(function(arr){ return set('log-' + k, arr.concat(byMonth[k])); });
      })).then(function(){
        list.forEach(function(e){ if(e.task) st.taskHours[e.task] = round2((st.taskHours[e.task] || 0) + e.hours); });
        return set('taskhours', st.taskHours);
      });
    });
  }

  /* El proyecto elegido en el formulario: uno existente o uno nuevo ({new, color}). */
  function resolveProject(v){
    if(v && typeof v === 'object'){
      return serial(function(){
        var p = {id: newId(), name: v.new, color: v.color || PALETTE[st.projects.length % PALETTE.length]};
        st.projects.push(p);
        return set('projects', st.projects).then(function(){ return p.id; });
      });
    }
    return Promise.resolve(v || '');
  }

  /* ---------- Formularios (los dibuja Workhub) ---------- */

  function hoursField(value){
    return {key: 'hours', type: 'number', label: tr('Horas dedicadas'), unit: 'h', min: 0.25, max: 500, step: 0.25, value: value || 1};
  }
  function projectField(value){
    return {
      key: 'project', type: 'select', label: tr('Proyecto'), value: value || '',
      options: st.projects.map(function(p){ return {value: p.id, label: p.name}; }),
      allowNew: true, newLabel: tr('+ Añadir proyecto…'), newPlaceholder: tr('Nombre del proyecto'), newColor: true
    };
  }

  /* task: la tarea terminada; null para apuntar horas a mano. dates: días por defecto. */
  function logTask(task, dates){
    /* Si el cliente de la tarea se llama igual que un proyecto, ese; si no, el último usado. */
    var byClient = task && task.cliente ? st.projects.filter(function(p){ return p.name.toLowerCase() === task.cliente.toLowerCase(); })[0] : null;
    var fields = [
      hoursField(st.prefs.hours),
      {key: 'days', type: 'dates', label: tr('Días trabajados'), value: dates && dates.length ? dates : [today()], hint: tr('Las horas se reparten a partes iguales entre los días.')},
      projectField(byClient ? byClient.id : st.prefs.project)
    ];
    if(!task) fields.push({key: 'title', type: 'text', label: tr('Descripción'), placeholder: tr('Ej.: Reunión con el cliente'), maxlength: 120});
    return wh.ui.form({
      title: tr('Registrar horas'),
      subtitle: task ? task.title : '',
      intro: task ? tr('Has terminado esta tarea. ¿Cuánto le has dedicado?') : tr('Añade horas a mano.'),
      submit: tr('Guardar'),
      cancel: task ? tr('Omitir') : tr('Cancelar'),
      fields: fields
    }).then(function(v){
      if(!v) return false;
      return resolveProject(v.project).then(function(pid){
        var parts = splitHours(v.hours, v.days.length);
        var entries = v.days.map(function(d, i){
          return {id: newId(), date: d, hours: parts[i], project: pid, task: task ? task.id : '', title: task ? task.title : (v.title || tr('Registro manual'))};
        });
        return addEntries(entries).then(function(){
          if(task) st.logged[task.id] = true;
          st.prefs = {hours: v.hours, project: pid};
          return Promise.all([set('logged', st.logged), set('prefs', st.prefs)]);
        }).then(function(){
          wh.ui.toast(tr('{h} h registradas en {p}', {h: fmt(v.hours), p: projectName(pid)}));
          return true;
        });
      });
    });
  }

  function editEntry(id){
    var e = st.entries.filter(function(x){ return x.id === id; })[0];
    if(!e) return Promise.resolve();
    return wh.ui.form({
      title: tr('Editar registro'), subtitle: e.title, submit: tr('Guardar'), cancel: tr('Cancelar'),
      fields: [hoursField(e.hours), projectField(e.project)]
    }).then(function(v){
      if(!v) return;
      return resolveProject(v.project).then(function(pid){
        return serial(function(){
          var key = 'log-' + e.date.slice(0, 7);
          return get(key, []).then(function(arr){
            arr.forEach(function(x){ if(x.id === id){ x.hours = v.hours; x.project = pid; } });
            if(e.task) st.taskHours[e.task] = Math.max(0, round2((st.taskHours[e.task] || 0) + v.hours - e.hours));
            return Promise.all([set(key, arr), set('taskhours', st.taskHours)]);
          });
        });
      });
    });
  }

  function deleteEntry(id){
    var e = st.entries.filter(function(x){ return x.id === id; })[0];
    if(!e) return Promise.resolve();
    return serial(function(){
      var key = 'log-' + e.date.slice(0, 7);
      return get(key, []).then(function(arr){
        if(e.task) st.taskHours[e.task] = Math.max(0, round2((st.taskHours[e.task] || 0) - e.hours));
        return Promise.all([set(key, arr.filter(function(x){ return x.id !== id; })), set('taskhours', st.taskHours)]);
      });
    }).then(function(){ wh.ui.toast(tr('Registro eliminado')); });
  }

  /* ================= PANEL ================= */

  function visible(){ return st.entries.filter(function(e){ return !st.hidden[e.project || '_']; }); }

  function calendarHtml(){
    var y = st.month.y, m = st.month.m;
    var first = (new Date(y, m, 1).getDay() + 6) % 7;
    var days = new Date(y, m + 1, 0).getDate();
    var byDay = {};
    visible().forEach(function(e){ (byDay[e.date] = byDay[e.date] || []).push(e); });
    var head = '';
    for(var i = 0; i < 7; i++){
      head += '<span>' + esc(new Intl.DateTimeFormat(WorkhubPlugin.locale, {weekday: 'short'}).format(new Date(2024, 0, 1 + i))) + '</span>';
    }
    var cells = '';
    var total = Math.ceil((first + days) / 7) * 7;
    for(var c = 0; c < total; c++){
      var d = c - first + 1;
      if(d < 1 || d > days){ cells += '<span class="sg-cell is-blank" aria-hidden="true"></span>'; continue; }
      var key = y + '-' + pad(m + 1) + '-' + pad(d);
      var list = byDay[key] || [];
      var sum = list.reduce(function(n, e){ return n + e.hours; }, 0);
      var weekend = c % 7 > 4;
      var perProject = {};
      list.forEach(function(e){ perProject[e.project || '_'] = (perProject[e.project || '_'] || 0) + e.hours; });
      var bar = list.length
        ? '<div class="trk" style="width:' + Math.min(100, sum / DAY_HOURS * 100) + '%">' + Object.keys(perProject).map(function(k){
            return '<i style="flex:' + perProject[k] + ';--c:' + esc(projectColor(k === '_' ? '' : k)) + '"></i>';
          }).join('') + '</div>'
        : '<div class="none"></div>';
      cells += '<button type="button" class="sg-cell' + (weekend ? ' is-weekend' : '') + (key === today() ? ' is-today' : '') + (key === st.selected ? ' is-selected' : '') + '" data-act="day" data-date="' + key + '"' +
        ' aria-label="' + esc(new Date(y, m, d).toLocaleDateString(WorkhubPlugin.locale, {weekday: 'long', day: 'numeric', month: 'long'}) + (sum ? ', ' + fmt(sum) + ' h' : '')) + '">' +
        '<span class="n">' + d + '</span>' +
        '<span><span class="h">' + (sum ? fmt(sum) + ' <small>h</small>' : '') + '</span>' + bar + '</span></button>';
    }
    return '<div class="sg-cal"><div class="sg-week" aria-hidden="true">' + head + '</div><div class="sg-grid">' + cells + '</div></div>';
  }

  function legendHtml(){
    var perProject = {};
    st.entries.forEach(function(e){ perProject[e.project || '_'] = (perProject[e.project || '_'] || 0) + e.hours; });
    var ids = st.projects.map(function(p){ return p.id; });
    if(perProject._) ids.push('_');
    if(!ids.length) return '';
    return '<div class="sg-legend">' + ids.map(function(id){
      var off = !!st.hidden[id];
      return '<button type="button" class="sg-chip' + (off ? ' is-off' : '') + '" data-act="filter" data-id="' + esc(id) + '" aria-pressed="' + (!off) + '" style="--c:' + esc(projectColor(id === '_' ? '' : id)) + '">' +
        '<i></i>' + esc(id === '_' ? tr('Sin proyecto') : projectName(id)) + (perProject[id] ? ' <em>' + fmt(perProject[id]) + ' h</em>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function statsHtml(){
    var list = visible();
    var total = list.reduce(function(n, e){ return n + e.hours; }, 0);
    var dayset = {};
    list.forEach(function(e){ dayset[e.date] = true; });
    var worked = Object.keys(dayset).length;
    return '<div class="sg-stats">' +
      '<div class="sg-stat"><b>' + fmt(total) + ' h</b><span>' + tr('Horas del mes') + '</span></div>' +
      '<div class="sg-stat"><b>' + worked + '</b><span>' + tr('Días trabajados') + '</span></div>' +
      '<div class="sg-stat"><b>' + (worked ? fmt(total / worked) : '0') + ' h</b><span>' + tr('Media por día') + '</span></div></div>';
  }

  function pendingHtml(){
    var limit = Date.now() - PENDING_DAYS * 864e5;
    var list = st.tasks.filter(function(t){ return isDone(t) && !st.logged[t.id] && (t.updatedAt || 0) > limit; })
      .sort(function(a, b){ return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, 5);
    if(!list.length) return '';
    return '<section class="sg-pending"><h2>' + tr('Tareas terminadas sin horas') + '</h2>' + list.map(function(t){
      return '<div class="sg-pending-row"><span class="t">' + esc(t.title) + '</span>' +
        '<button type="button" class="sg-link" data-act="pending-log" data-id="' + esc(t.id) + '">' + tr('Registrar') + '</button>' +
        '<button type="button" class="sg-link is-muted" data-act="pending-skip" data-id="' + esc(t.id) + '">' + tr('Descartar') + '</button></div>';
    }).join('') + '</section>';
  }

  function dayHtml(){
    if(!st.selected) return '';
    var parts = st.selected.split('-');
    var date = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var list = visible().filter(function(e){ return e.date === st.selected; });
    var sum = list.reduce(function(n, e){ return n + e.hours; }, 0);
    var rows = list.length ? list.map(function(e){
      var armed = st.armed === e.id;
      return '<div class="sg-entry"><span class="dot" style="--c:' + esc(projectColor(e.project)) + '"></span>' +
        '<div class="who"><b>' + esc(e.title) + '</b><span>' + esc(projectName(e.project)) + '</span></div>' +
        '<span class="hrs">' + fmt(e.hours) + ' h</span><span class="ops">' +
        (e.task && taskById(e.task) ? '<button type="button" class="sg-link" data-act="open-task" data-id="' + esc(e.task) + '">' + tr('Abrir la tarea') + '</button>' : '') +
        '<button type="button" class="sg-link" data-act="edit" data-id="' + esc(e.id) + '">' + tr('Editar') + '</button>' +
        '<button type="button" class="sg-link is-muted" data-act="delete" data-id="' + esc(e.id) + '">' + (armed ? tr('¿Seguro?') : tr('Eliminar')) + '</button></span></div>';
    }).join('') : '<p class="sg-empty">' + tr('Sin registros este día.') + '</p>';
    return '<section class="sg-day"><div class="sg-day-head"><h2>' + esc(date.toLocaleDateString(WorkhubPlugin.locale, {weekday: 'long', day: 'numeric', month: 'long'})) + '</h2>' +
      '<span>' + (sum ? fmt(sum) + ' h' : '') + '</span></div>' + rows +
      '<button type="button" class="wh-btn" data-act="add-day">' + tr('Añadir horas este día') + '</button></section>';
  }

  function calendarView(){
    var title = new Intl.DateTimeFormat(WorkhubPlugin.locale, {month: 'long', year: 'numeric'}).format(new Date(st.month.y, st.month.m, 1));
    var L = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
    var R = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
    return '<header class="sg-head"><div><h1>Smart GP</h1><p class="wh-muted">' + tr('Tus horas por día y proyecto') + '</p></div>' +
      '<div class="sg-actions"><button type="button" class="wh-btn" data-act="projects">' + tr('Proyectos') + '</button>' +
      '<button type="button" class="wh-btn is-primary" data-act="add">' + tr('Registrar horas') + '</button></div></header>' +
      pendingHtml() +
      '<div class="sg-bar"><div class="sg-month"><button type="button" class="sg-icon" data-act="prev" aria-label="' + esc(tr('Mes anterior')) + '">' + L + '</button>' +
      '<h2>' + esc(title) + '</h2><button type="button" class="sg-icon" data-act="next" aria-label="' + esc(tr('Mes siguiente')) + '">' + R + '</button></div>' +
      '<button type="button" class="wh-btn" data-act="today">' + tr('Hoy') + '</button></div>' +
      statsHtml() + legendHtml() + calendarHtml() + dayHtml();
  }

  function projectsView(){
    var hours = {};
    st.entries.forEach(function(e){ hours[e.project] = (hours[e.project] || 0) + e.hours; });
    var rows = st.projects.length ? st.projects.map(function(p){
      return '<div class="sg-proj"><button type="button" class="sg-swatch" data-act="color" data-id="' + esc(p.id) + '" style="--c:' + esc(p.color) + '" title="' + esc(tr('Cambiar color')) + '" aria-label="' + esc(tr('Cambiar color')) + '"></button>' +
        '<input class="wh-input" data-act="rename" data-id="' + esc(p.id) + '" value="' + esc(p.name) + '" maxlength="60" aria-label="' + esc(tr('Nombre del proyecto')) + '">' +
        '<button type="button" class="sg-link is-muted" data-act="proj-del" data-id="' + esc(p.id) + '">' + (st.armed === p.id ? tr('¿Seguro?') : tr('Eliminar')) + '</button></div>';
    }).join('') : '<p class="sg-empty">' + tr('Aún no hay proyectos. Crea el primero abajo.') + '</p>';
    return '<header class="sg-head"><div><h1>' + tr('Proyectos') + '</h1><p class="wh-muted">' + tr('Añade proyectos para agrupar tus horas (clientes, líneas de trabajo…).') + '</p></div>' +
      '<div class="sg-actions"><button type="button" class="wh-btn" data-act="back">' + tr('Volver') + '</button></div></header>' +
      '<div class="sg-box">' + rows + '<div class="sg-newproj"><input class="wh-input" id="newProject" maxlength="60" placeholder="' + esc(tr('Nuevo proyecto')) + '" aria-label="' + esc(tr('Nuevo proyecto')) + '">' +
      '<button type="button" class="wh-btn is-primary" data-act="proj-add">' + tr('Añadir') + '</button></div></div>';
  }

  function render(){
    var app = document.getElementById('app');
    if(!app) return;
    app.innerHTML = st.view === 'projects' ? projectsView() : calendarView();
  }

  function refresh(){
    return Promise.all([loadBase(), loadMonth()]).then(render);
  }

  function goMonth(delta){
    var d = new Date(st.month.y, st.month.m + delta, 1);
    st.month = {y: d.getFullYear(), m: d.getMonth()};
    st.selected = '';
    return loadMonth().then(render);
  }

  function onClick(ev){
    var t = ev.target.closest('[data-act]');
    if(!t || t.tagName === 'INPUT') return;
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');
    var busy = function(p){ return p.then(refresh).catch(function(err){ wh.ui.toast(err.message || 'Error', {type: 'error'}); }); };
    switch(act){
      case 'day': st.selected = t.getAttribute('data-date'); render(); break;
      case 'prev': goMonth(-1); break;
      case 'next': goMonth(1); break;
      case 'today': st.month = {y: new Date().getFullYear(), m: new Date().getMonth()}; st.selected = today(); loadMonth().then(render); break;
      case 'filter': st.hidden[id] = !st.hidden[id]; render(); break;
      case 'add': busy(logTask(null)); break;
      case 'add-day': busy(logTask(null, [st.selected])); break;
      case 'pending-log': busy(logTask(taskById(id))); break;
      case 'pending-skip': st.logged[id] = true; busy(set('logged', st.logged)); break;
      case 'open-task': wh.ui.openTask(id); break;
      case 'edit': busy(editEntry(id)); break;
      case 'delete':
        if(st.armed !== id){ st.armed = id; render(); setTimeout(function(){ if(st.armed === id){ st.armed = ''; render(); } }, 3500); break; }
        st.armed = '';
        busy(deleteEntry(id));
        break;
      case 'projects': st.view = 'projects'; render(); break;
      case 'back': st.view = 'calendar'; render(); break;
      case 'proj-add': {
        var input = document.getElementById('newProject');
        var name = input.value.trim();
        if(!name){ input.focus(); break; }
        busy(serial(function(){
          st.projects.push({id: newId(), name: name, color: PALETTE[st.projects.length % PALETTE.length]});
          return set('projects', st.projects);
        }));
        break;
      }
      case 'color': {
        var p = project(id);
        if(!p) break;
        p.color = PALETTE[(PALETTE.indexOf(p.color) + 1) % PALETTE.length];
        busy(serial(function(){ return set('projects', st.projects); }));
        break;
      }
      case 'proj-del':
        if(st.armed !== id){ st.armed = id; render(); setTimeout(function(){ if(st.armed === id){ st.armed = ''; render(); } }, 3500); break; }
        st.armed = '';
        st.projects = st.projects.filter(function(x){ return x.id !== id; });
        busy(serial(function(){ return set('projects', st.projects); }));
        break;
    }
  }

  function onChange(ev){
    var t = ev.target;
    if(t.getAttribute('data-act') !== 'rename') return;
    var p = project(t.getAttribute('data-id'));
    var name = t.value.trim();
    if(!p || !name){ t.value = p ? p.name : ''; return; }
    p.name = name;
    serial(function(){ return set('projects', st.projects); }).catch(function(){});
  }

  function startPanel(){
    document.getElementById('app').addEventListener('click', onClick);
    document.getElementById('app').addEventListener('change', onChange);
    st.selected = today();
    wh.on('tasks', function(list){ st.tasks = list; if(st.view === 'calendar') render(); });
    wh.on('storage', function(){ refresh(); });
    wh.on('project', function(){ Promise.all([loadDone(), wh.tasks.list()]).then(function(r){ st.tasks = r[1]; render(); }); });
    return loadMonth().then(render);
  }

  /* ================= SEGUNDO PLANO ================= */

  var prevDone = null;      /* idTarea → ¿estaba terminada? Null hasta la primera lista. */
  var asking = Promise.resolve();

  function updateBadges(){
    var badges = {};
    st.tasks.forEach(function(t){
      var h = st.taskHours[t.id];
      if(h > 0) badges[t.id] = {text: fmt(h) + ' h', icon: 'clock', tone: 'neutral'};
    });
    return wh.ui.setTaskBadges(badges).catch(function(){});
  }

  /* Una tarea acaba de pasar a una etapa final: se pregunta (de una en una). */
  function ask(task){
    asking = asking.then(function(){
      if(st.logged[task.id]) return null;
      return logTask(task).then(function(saved){
        /* Omitir no vuelve a preguntar por esta tarea; sigue en «terminadas sin horas» del panel. */
        return saved ? updateBadges() : null;
      });
    }).catch(function(){});
  }

  function onTasks(list){
    st.tasks = list;
    var next = {};
    list.forEach(function(t){ next[t.id] = isDone(t); });
    if(prevDone){
      list.forEach(function(t){
        if(next[t.id] && prevDone[t.id] === false) ask(t);
      });
    }
    prevDone = next;
    updateBadges();
  }

  function startBackground(){
    wh.ui.addButton({id: 'log', location: 'task.actions', label: tr('Registrar horas'), icon: 'clock', tooltip: tr('Apuntar las horas de esta tarea')});
    wh.ui.addButton({id: 'add', location: 'command', label: tr('Smart GP: registrar horas'), icon: 'clock'});
    wh.ui.addButton({id: 'open', location: 'command', label: tr('Abrir Smart GP'), icon: 'calendar'});
    wh.on('action', function(a){
      if(a.id === 'log'){
        var t = taskById(a.context && a.context.taskId);
        if(t) asking = asking.then(function(){ return logTask(t); }).then(updateBadges).catch(function(){});
      } else if(a.id === 'add'){
        asking = asking.then(function(){ return logTask(null); }).then(updateBadges).catch(function(){});
      } else if(a.id === 'open'){
        wh.ui.openPanel();
      }
    });
    wh.on('tasks', onTasks);
    wh.on('storage', function(){ loadBase().then(updateBadges); });
    wh.on('project', function(){
      prevDone = null;
      Promise.all([loadDone(), wh.tasks.list()]).then(function(r){ st.tasks = r[1]; onTasks(r[1]); });
    });
    onTasks(st.tasks);
  }

  /* ================= Arranque ================= */

  WorkhubPlugin.connect(MANIFEST).then(function(client){
    wh = client;
    return Promise.all([loadBase(), loadDone(), wh.tasks.list()]);
  }).then(function(r){
    st.tasks = r[2];
    return wh.isBackground ? startBackground() : startPanel();
  }).catch(fail);
})();
