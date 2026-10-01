/* Smart GP: registra las horas de cada tarea al terminarla y las muestra en un
   calendario por día y proyecto.

   Dos instancias de la misma página:
   - segundo plano (context.mode === 'background'): vigila las tareas; cuando una
     pasa a una etapa final, pide con wh.ui.form las horas, los días y el proyecto.
     También añade «Registrar horas» en la ficha de cada tarea y una etiqueta con
     las horas en las tarjetas.
   - panel (sección Plugins): el calendario, el detalle de cada día y los proyectos.

   Datos del proyecto abierto de Workhub (wh.storage):
     projects   [{id, name, color}]
     log-AAAA-MM [{id, date, hours, project, task, title}]   (uno por día y tarea)
     logged     {idTarea: true}    tareas ya registradas u omitidas
     taskhours  {idTarea: horas}   total por tarea (para la etiqueta de la tarjeta)
     prefs      {project}          el último proyecto usado (las horas siempre empiezan en 0) */
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
    'Color del proyecto':'Project color',
    'Smart GP: registrar horas':'Smart GP: log hours', 'Abrir Smart GP':'Open Smart GP',
    'Apuntar las horas de esta tarea':'Log the hours of this task',
    'h':'h', 'día':'day', 'días':'days', 'registros':'entries',
    'No se pudo conectar con Workhub: {error}':'Could not connect to Workhub: {error}',
    'Este plugin se abre desde Workhub (sección Plugins).':'This plugin opens from Workhub (Plugins section).',
    'Jornada':'Schedule',
    'Máximo de horas por día de la semana, según el mes. Si un día se pasa del máximo, no se podrán añadir más horas.':'Maximum hours per weekday, by month. If a day goes over its maximum, no more hours can be added.',
    'Periodo':'Period', 'Añadir periodo':'Add period', 'Sin meses':'No months', 'Quitar periodo':'Remove period',
    'Aún no hay periodos. Sin ellos no hay límite de horas.':'No periods yet. Without them there is no hour limit.',
    'Meses':'Months', 'Horas máximas por día':'Maximum hours per day',
    'Vacío = sin límite · 0 = ese día no admite horas':'Empty = no limit · 0 = that day accepts no hours',
    'sin límite':'no limit', 'Ese mes ya está en otro periodo':'That month is already in another period',
    'Límite de este mes:':'This month\'s limit:', 'Sin límite este mes.':'No limit this month.', 'Cambiar':'Change',
    'El {d} no admite horas (tu jornada lo tiene a 0 h).':'{d} accepts no hours (your schedule has it at 0 h).',
    'El {d} admite como máximo {l} h y ya tiene {u} h: te quedan {f} h.':'{d} allows at most {l} h and already has {u} h: {f} h left.',
    'Ese día: {u} de {l} h (te quedan {f} h).':'That day: {u} of {l} h ({f} h left).',
    'Ese día no admite horas.':'That day accepts no hours.',
    'máx.':'max.',
    'lun':'Mon', 'mar':'Tue', 'mié':'Wed', 'jue':'Thu', 'vie':'Fri', 'sáb':'Sat', 'dom':'Sun'
  }});

  var wh = null;
  var now = new Date();
  var st = {
    projects: [], logged: {}, taskHours: {}, prefs: {project: ''}, schedule: [],
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
  function projectColor(id){ var p = project(id); return p && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : GRAY; }
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

  /* ---------- Jornada: máximo de horas por día de la semana ---------- */
  /* Cada periodo: {id, months:[1..12], hours:[lun, mar, mié, jue, vie, sáb, dom]}.
     Un valor vacío (null) = sin límite; 0 = ese día no admite horas. Un mes que no
     está en ningún periodo no tiene límite. */

  function weekdayIndex(date){
    var p = date.split('-');
    return (new Date(+p[0], +p[1] - 1, +p[2]).getDay() + 6) % 7;
  }
  function ruleFor(date){
    var m = +date.slice(5, 7);
    return st.schedule.filter(function(r){ return r.months.indexOf(m) !== -1; })[0] || null;
  }
  /* Máximo de horas de ese día (Infinity si no hay límite). */
  function limitFor(date){
    var r = ruleFor(date);
    if(!r) return Infinity;
    var v = r.hours[weekdayIndex(date)];
    return v == null || v === '' ? Infinity : +v;
  }
  function dateLabel(date){
    var p = date.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(WorkhubPlugin.locale, {weekday: 'short', day: 'numeric', month: 'short'});
  }
  /* Horas ya registradas en esos días (sin contar el registro ignoreId, si se edita). */
  function usedOn(dates, ignoreId){
    var months = {};
    dates.forEach(function(d){ months[d.slice(0, 7)] = true; });
    return Promise.all(Object.keys(months).map(function(k){ return get('log-' + k, []); })).then(function(lists){
      var map = {};
      lists.forEach(function(l){
        l.forEach(function(e){ if(e.id !== ignoreId) map[e.date] = round2((map[e.date] || 0) + e.hours); });
      });
      return map;
    });
  }
  /* perDay: [{date, hours}] → los días que se pasarían del máximo. */
  function violations(perDay, used){
    var out = [];
    perDay.forEach(function(x){
      var limit = limitFor(x.date);
      if(limit === Infinity) return;
      var u = used[x.date] || 0;
      if(u + x.hours > limit + 0.001) out.push({date: x.date, limit: limit, used: u, free: Math.max(0, round2(limit - u))});
    });
    return out;
  }
  function violationText(v){
    return v.limit === 0
      ? tr('El {d} no admite horas (tu jornada lo tiene a 0 h).', {d: dateLabel(v.date)})
      : tr('El {d} admite como máximo {l} h y ya tiene {u} h: te quedan {f} h.', {d: dateLabel(v.date), l: fmt(v.limit), u: fmt(v.used), f: fmt(v.free)});
  }
  /* Pista para un solo día: cuánto queda. */
  function limitHint(date, used){
    var limit = limitFor(date);
    if(limit === Infinity) return '';
    if(limit === 0) return tr('Ese día no admite horas.');
    return tr('Ese día: {u} de {l} h (te quedan {f} h).', {u: fmt(used[date] || 0), l: fmt(limit), f: fmt(Math.max(0, limit - (used[date] || 0)))});
  }
  /* «lun–jue 8 h · vie 7 h» (los días seguidos con el mismo máximo se agrupan). */
  function describeRule(r){
    var names = [];
    for(var i = 0; i < 7; i++) names.push(tr(new Intl.DateTimeFormat('es-ES', {weekday: 'short'}).format(new Date(2024, 0, 1 + i)).replace('.', '')));
    var parts = [];
    var i2 = 0;
    while(i2 < 7){
      var v = r.hours[i2];
      if(v == null || v === ''){ i2++; continue; }
      var j = i2;
      while(j + 1 < 7 && r.hours[j + 1] === v) j++;
      parts.push((j > i2 ? names[i2] + '–' + names[j] : names[i2]) + ' ' + fmt(v) + ' h');
      i2 = j + 1;
    }
    return parts.length ? parts.join(' · ') : tr('sin límite');
  }
  function monthsLabel(r){
    if(!r.months.length) return tr('Sin meses');
    var names = r.months.slice().sort(function(a, b){ return a - b; }).map(function(m){
      return new Intl.DateTimeFormat(WorkhubPlugin.locale, {month: 'long'}).format(new Date(2024, m - 1, 1));
    });
    return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' ' + (WorkhubPlugin.lang === 'en' ? 'and' : 'y') + ' ' + names[names.length - 1];
  }

  /* ---------- Datos ---------- */

  function get(key, dflt){ return wh.storage.get(key).then(function(v){ return v == null ? dflt : v; }); }
  function set(key, value){ return wh.storage.set(key, value); }
  /* Todas las escrituras de una en una: leen y reescriben el mismo documento. */
  function serial(fn){
    var run = queue.then(fn);
    queue = run.catch(function(){});
    return run;
  }

  function loadBase(){
    return Promise.all([get('projects', []), get('logged', {}), get('taskhours', {}), get('prefs', {project: ''}), get('schedule', [])]).then(function(r){
      st.projects = r[0]; st.logged = r[1]; st.taskHours = r[2]; st.prefs = r[3]; st.schedule = r[4];
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
    return {key: 'hours', type: 'number', label: tr('Horas dedicadas'), unit: 'h', min: 0.25, max: 500, step: 0.25, value: value != null ? value : 0};
  }
  /* value: id de un proyecto, o {new, color} si se había escrito uno nuevo y se vuelve a abrir. */
  function projectField(value){
    var isNew = value && typeof value === 'object';
    return {
      key: 'project', type: 'select', label: tr('Proyecto'), value: isNew ? '__new__' : (value || ''),
      newName: isNew ? value.new : '', newColorValue: isNew ? value.color : '',
      options: st.projects.map(function(p){ return {value: p.id, label: p.name}; }),
      allowNew: true, newLabel: tr('+ Añadir proyecto…'), newPlaceholder: tr('Nombre del proyecto'), newColor: true
    };
  }

  /* task: la tarea terminada; null para apuntar horas a mano. dates: días por defecto. */
  function logTask(task, dates, state, notice){
    state = state || {};
    /* Si el cliente de la tarea se llama igual que un proyecto, ese; si no, el último usado. */
    var byClient = task && task.cliente ? st.projects.filter(function(p){ return p.name.toLowerCase() === task.cliente.toLowerCase(); })[0] : null;
    var days = state.days || (dates && dates.length ? dates : [today()]);
    return usedOn(days).then(function(used){
      var hoursField_ = hoursField(state.hours != null ? state.hours : 0);   /* siempre empieza en 0: cada tarea tiene sus horas */
      if(days.length === 1) hoursField_.hint = limitHint(days[0], used);
      var fields = [
        hoursField_,
        {key: 'days', type: 'dates', label: tr('Días trabajados'), value: days, hint: tr('Las horas se reparten a partes iguales entre los días.')},
        projectField(state.project !== undefined ? state.project : (byClient ? byClient.id : st.prefs.project))
      ];
      if(!task) fields.push({key: 'title', type: 'text', label: tr('Descripción'), value: state.title || '', placeholder: tr('Ej.: Reunión con el cliente'), maxlength: 120});
      return wh.ui.form({
        title: tr('Registrar horas'),
        subtitle: task ? task.title : '',
        intro: task ? tr('Has terminado esta tarea. ¿Cuánto le has dedicado?') : tr('Añade horas a mano.'),
        notice: notice || '',
        submit: tr('Guardar'),
        cancel: task ? tr('Omitir') : tr('Cancelar'),
        fields: fields
      });
    }).then(function(v){
      if(!v) return false;
      var parts = splitHours(v.hours, v.days.length);
      var perDay = v.days.map(function(d, i){ return {date: d, hours: parts[i]}; });
      return usedOn(v.days).then(function(used){
        /* Si algún día se pasa del máximo de la jornada, no se guarda: se avisa y se vuelve a abrir. */
        var bad = violations(perDay, used);
        if(bad.length) return logTask(task, dates, {hours: v.hours, days: v.days, project: v.project, title: v.title}, bad.map(violationText).join(' '));
        return resolveProject(v.project).then(function(pid){
          var entries = perDay.map(function(x){
            return {id: newId(), date: x.date, hours: x.hours, project: pid, task: task ? task.id : '', title: task ? task.title : (v.title || tr('Registro manual'))};
          });
          return addEntries(entries).then(function(){
            if(task) st.logged[task.id] = true;
            st.prefs = {project: pid};
            return Promise.all([set('logged', st.logged), set('prefs', st.prefs)]);
          }).then(function(){
            wh.ui.toast(tr('{h} h registradas en {p}', {h: fmt(v.hours), p: projectName(pid)}));
            return true;
          });
        });
      });
    });
  }

  function editEntry(id, state, notice){
    var e = st.entries.filter(function(x){ return x.id === id; })[0];
    if(!e) return Promise.resolve();
    state = state || {};
    return usedOn([e.date], id).then(function(used){
      var hf = hoursField(state.hours != null ? state.hours : e.hours);
      hf.hint = limitHint(e.date, used);
      return wh.ui.form({
        title: tr('Editar registro'), subtitle: e.title, notice: notice || '', submit: tr('Guardar'), cancel: tr('Cancelar'),
        fields: [hf, projectField(state.project !== undefined ? state.project : e.project)]
      }).then(function(v){
        if(!v) return;
        var bad = violations([{date: e.date, hours: v.hours}], used);
        if(bad.length) return editEntry(id, {hours: v.hours, project: v.project}, bad.map(violationText).join(' '));
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
    /* Horas de cada día de todos los proyectos (aunque haya un filtro): el máximo se comprueba con ellas. */
    var allByDay = {};
    st.entries.forEach(function(e){ allByDay[e.date] = (allByDay[e.date] || 0) + e.hours; });
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
      /* Máximo de la jornada para ese día: la barra se llena al llegar a él. */
      var limit = limitFor(key);
      var limited = limit !== Infinity;
      var over = limited && (allByDay[key] || 0) > limit + 0.001;
      var scale = limited && limit > 0 ? limit : DAY_HOURS;
      var perProject = {};
      list.forEach(function(e){ perProject[e.project || '_'] = (perProject[e.project || '_'] || 0) + e.hours; });
      var bar = list.length
        ? '<div class="trk" style="width:' + Math.min(100, sum / scale * 100) + '%">' + Object.keys(perProject).map(function(k){
            return '<i style="flex:' + perProject[k] + ';--c:' + esc(projectColor(k === '_' ? '' : k)) + '"></i>';
          }).join('') + '</div>'
        : '<div class="none"></div>';
      cells += '<button type="button" class="sg-cell' + (weekend ? ' is-weekend' : '') + (limit === 0 ? ' is-off' : '') + (over ? ' is-over' : '') + (key === today() ? ' is-today' : '') + (key === st.selected ? ' is-selected' : '') + '" data-act="day" data-date="' + key + '"' +
        ' aria-label="' + esc(new Date(y, m, d).toLocaleDateString(WorkhubPlugin.locale, {weekday: 'long', day: 'numeric', month: 'long'}) + (sum ? ', ' + fmt(sum) + ' h' : '') + (limited ? ', ' + tr('máx.') + ' ' + fmt(limit) + ' h' : '')) + '">' +
        '<span class="n">' + d + '</span>' +
        '<span><span class="h">' + (sum ? fmt(sum) + ' <small>' + (limited && limit > 0 ? '/ ' + fmt(limit) + ' ' : '') + 'h</small>' : '') + '</span>' + bar + '</span></button>';
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
      '<div class="sg-actions"><button type="button" class="wh-btn" data-act="schedule">' + tr('Jornada') + '</button>' +
      '<button type="button" class="wh-btn" data-act="projects">' + tr('Proyectos') + '</button>' +
      '<button type="button" class="wh-btn is-primary" data-act="add">' + tr('Registrar horas') + '</button></div></header>' +
      pendingHtml() +
      '<div class="sg-bar"><div class="sg-month"><button type="button" class="sg-icon" data-act="prev" aria-label="' + esc(tr('Mes anterior')) + '">' + L + '</button>' +
      '<h2>' + esc(title) + '</h2><button type="button" class="sg-icon" data-act="next" aria-label="' + esc(tr('Mes siguiente')) + '">' + R + '</button></div>' +
      '<button type="button" class="wh-btn" data-act="today">' + tr('Hoy') + '</button></div>' +
      limitLine() + statsHtml() + legendHtml() + calendarHtml() + dayHtml();
  }

  /* El máximo de horas que rige este mes (o que no hay). */
  function limitLine(){
    var r = ruleFor(monthKey(st.month.y, st.month.m) + '-01');
    return '<p class="sg-limit">' + (r ? esc(tr('Límite de este mes:')) + ' <b>' + esc(describeRule(r)) + '</b>' : esc(tr('Sin límite este mes.'))) +
      ' <button type="button" class="sg-link" data-act="schedule">' + tr('Cambiar') + '</button></p>';
  }

  function scheduleView(){
    var owner = {};
    st.schedule.forEach(function(r){ r.months.forEach(function(m){ owner[m] = r.id; }); });
    var days = [];
    for(var i = 0; i < 7; i++) days.push(new Intl.DateTimeFormat(WorkhubPlugin.locale, {weekday: 'short'}).format(new Date(2024, 0, 1 + i)).replace('.', ''));
    var rules = st.schedule.length ? st.schedule.map(function(r, idx){
      var chips = '';
      for(var m = 1; m <= 12; m++){
        var on = r.months.indexOf(m) !== -1;
        var other = owner[m] && owner[m] !== r.id;
        chips += '<button type="button" class="sg-mchip' + (on ? ' is-on' : '') + '" data-act="month" data-rule="' + esc(r.id) + '" data-m="' + m + '" aria-pressed="' + on + '"' +
          (other ? ' disabled title="' + esc(tr('Ese mes ya está en otro periodo')) + '"' : '') + '>' +
          esc(new Intl.DateTimeFormat(WorkhubPlugin.locale, {month: 'short'}).format(new Date(2024, m - 1, 1)).replace('.', '')) + '</button>';
      }
      var inputs = days.map(function(name, d){
        var v = r.hours[d];
        return '<label class="sg-dayin"><span>' + esc(name) + '</span><input class="wh-input" type="number" min="0" max="24" step="0.25" inputmode="decimal" placeholder="—" ' +
          'data-act="rule-hours" data-rule="' + esc(r.id) + '" data-d="' + d + '" value="' + (v == null ? '' : esc(v)) + '" aria-label="' + esc(name) + '"></label>';
      }).join('');
      return '<div class="sg-rule"><div class="sg-rule-head"><b>' + esc(tr('Periodo')) + ' ' + (idx + 1) + ' · <span class="sg-months-label">' + esc(monthsLabel(r)) + '</span></b>' +
        '<button type="button" class="sg-link is-muted" data-act="rule-del" data-rule="' + esc(r.id) + '">' + (st.armed === r.id ? tr('¿Seguro?') : tr('Quitar periodo')) + '</button></div>' +
        '<p class="sg-sub">' + tr('Meses') + '</p><div class="sg-months">' + chips + '</div>' +
        '<p class="sg-sub">' + tr('Horas máximas por día') + '</p><div class="sg-dayins">' + inputs + '</div></div>';
    }).join('') : '<p class="sg-empty">' + tr('Aún no hay periodos. Sin ellos no hay límite de horas.') + '</p>';
    return '<header class="sg-head"><div><h1>' + tr('Jornada') + '</h1><p class="wh-muted">' +
      tr('Máximo de horas por día de la semana, según el mes. Si un día se pasa del máximo, no se podrán añadir más horas.') + '</p></div>' +
      '<div class="sg-actions"><button type="button" class="wh-btn" data-act="back">' + tr('Volver') + '</button></div></header>' +
      '<div class="sg-box">' + rules + '<p class="sg-hint">' + tr('Vacío = sin límite · 0 = ese día no admite horas') + '</p>' +
      '<button type="button" class="wh-btn is-primary" data-act="rule-add">' + tr('Añadir periodo') + '</button></div>';
  }

  function saveSchedule(){
    return serial(function(){ return set('schedule', st.schedule); });
  }

  function projectsView(){
    var hours = {};
    st.entries.forEach(function(e){ hours[e.project] = (hours[e.project] || 0) + e.hours; });
    var rows = st.projects.length ? st.projects.map(function(p){
      return '<div class="sg-proj"><input class="sg-swatch" type="color" data-act="color" data-id="' + esc(p.id) + '" value="' + projectColor(p.id) + '" title="' + esc(tr('Cambiar color')) + '" aria-label="' + esc(tr('Cambiar color')) + '">' +
        '<input class="wh-input" data-act="rename" data-id="' + esc(p.id) + '" value="' + esc(p.name) + '" maxlength="160" aria-label="' + esc(tr('Nombre del proyecto')) + '">' +
        '<button type="button" class="sg-link is-muted" data-act="proj-del" data-id="' + esc(p.id) + '">' + (st.armed === p.id ? tr('¿Seguro?') : tr('Eliminar')) + '</button></div>';
    }).join('') : '<p class="sg-empty">' + tr('Aún no hay proyectos. Crea el primero abajo.') + '</p>';
    return '<header class="sg-head"><div><h1>' + tr('Proyectos') + '</h1><p class="wh-muted">' + tr('Añade proyectos para agrupar tus horas (clientes, líneas de trabajo…).') + '</p></div>' +
      '<div class="sg-actions"><button type="button" class="wh-btn" data-act="back">' + tr('Volver') + '</button></div></header>' +
      '<div class="sg-box">' + rows + '<div class="sg-newproj"><input class="wh-input" id="newProject" maxlength="160" placeholder="' + esc(tr('Nuevo proyecto')) + '" aria-label="' + esc(tr('Nuevo proyecto')) + '">' +
      '<input class="sg-swatch" id="newProjectColor" type="color" value="' + PALETTE[st.projects.length % PALETTE.length] + '" title="' + esc(tr('Color del proyecto')) + '" aria-label="' + esc(tr('Color del proyecto')) + '">' +
      '<button type="button" class="wh-btn is-primary" data-act="proj-add">' + tr('Añadir') + '</button></div></div>';
  }

  function render(){
    var app = document.getElementById('app');
    if(!app) return;
    app.innerHTML = st.view === 'projects' ? projectsView() : st.view === 'schedule' ? scheduleView() : calendarView();
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
      case 'schedule': st.view = 'schedule'; render(); break;
      case 'back': st.view = 'calendar'; render(); break;
      case 'rule-add': {
        /* Nuevo periodo con los meses que aún no tienen jornada y lunes a viernes a 8 h. */
        var taken = {};
        st.schedule.forEach(function(r){ r.months.forEach(function(m){ taken[m] = true; }); });
        var free = [];
        for(var mm = 1; mm <= 12; mm++) if(!taken[mm]) free.push(mm);
        st.schedule.push({id: newId(), months: free, hours: [8, 8, 8, 8, 8, null, null]});
        render();
        saveSchedule();
        break;
      }
      case 'rule-del':
        var rid = t.getAttribute('data-rule');
        if(st.armed !== rid){ st.armed = rid; render(); setTimeout(function(){ if(st.armed === rid){ st.armed = ''; render(); } }, 3500); break; }
        st.armed = '';
        st.schedule = st.schedule.filter(function(r){ return r.id !== rid; });
        render();
        saveSchedule();
        break;
      case 'month': {
        var rule = st.schedule.filter(function(r){ return r.id === t.getAttribute('data-rule'); })[0];
        var mo = +t.getAttribute('data-m');
        if(!rule || t.disabled) break;
        var at = rule.months.indexOf(mo);
        if(at === -1) rule.months.push(mo); else rule.months.splice(at, 1);
        render();
        saveSchedule();
        break;
      }
      case 'proj-add': {
        var input = document.getElementById('newProject');
        var name = input.value.trim();
        if(!name){ input.focus(); break; }
        var color = document.getElementById('newProjectColor').value;
        busy(serial(function(){
          st.projects.push({id: newId(), name: name, color: color});
          return set('projects', st.projects);
        }));
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
    if(t.getAttribute('data-act') === 'color'){
      var colored = project(t.getAttribute('data-id'));
      if(colored && /^#[0-9a-fA-F]{6}$/.test(t.value)){
        colored.color = t.value;
        serial(function(){ return set('projects', st.projects); }).then(refresh).catch(function(err){ wh.ui.toast(err.message || 'Error', {type:'error'}); });
      }
      return;
    }
    if(t.getAttribute('data-act') === 'rule-hours'){
      var rule = st.schedule.filter(function(r){ return r.id === t.getAttribute('data-rule'); })[0];
      if(!rule) return;
      var raw = t.value.trim().replace(',', '.');
      var n = raw === '' ? null : Math.max(0, Math.min(24, parseFloat(raw)));
      rule.hours[+t.getAttribute('data-d')] = n == null || isNaN(n) ? null : round2(n);
      t.value = rule.hours[+t.getAttribute('data-d')] == null ? '' : rule.hours[+t.getAttribute('data-d')];
      saveSchedule();
      return;
    }
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
