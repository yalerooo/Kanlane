/* Plugin oficial "Temporizador": cronómetro por tarea y tiempo acumulado.
   Permisos: tasks:read, storage, ui:extend.

   - En segundo plano (se carga oculto al abrir Workhub):
       · botón "Iniciar cronómetro" en la ficha de cada tarea;
       · mientras cuenta, botón "Detener" en la barra de Tareas y en la paleta;
       · etiqueta con el tiempo acumulado en cada tarjeta del tablero.
   - En el panel (sección Plugins): cronómetro grande y totales.

   Datos guardados (por proyecto):
   - running:  {taskId, startedAt} | null   (sigue contando aunque cierres)
   - totals:   {taskId: milisegundos}
   - sessions: [{taskId, start, end}]       (las 300 últimas) */
(function(){
  var MANIFEST = {
    id: 'workhub.temporizador',
    name: 'Temporizador',
    version: '1.1.0',
    description: 'Mide el tiempo que dedicas a cada tarea con un cronómetro y consulta el total por tarea y por cliente.',
    author: 'Workhub',
    icon: 'timer',
    color: 24,
    permissions: ['tasks:read', 'storage', 'ui:extend']
  };
  var MAX_SESSIONS = 300;
  var tr = WorkhubPlugin.translations({en:{
    'No se pudo guardar: {error}':'Could not save: {error}',
    'En marcha · {time}':'Running · {time}', 'Detener · {time}':'Stop · {time}',
    'Detener el cronómetro':'Stop the timer', 'Detener el cronómetro de «{task}»':'Stop the timer for “{task}”',
    'Detener cronómetro':'Stop timer', 'Iniciar cronómetro':'Start timer', 'Medir el tiempo de esta tarea':'Track time on this task',
    'Abrir temporizador':'Open timer', 'Ya está contando en «{task}»':'Already tracking “{task}”',
    'Guardados {time} en «{task}». ':'Saved {time} on “{task}”. ', 'Contando en «{task}»':'Tracking “{task}”',
    'Guardado: {time}':'Saved: {time}', 'Guardado: {time} en «{task}»':'Saved: {time} on “{task}”',
    '¿Seguro? Pulsa otra vez':'Sure? Click again', 'Temporizador':'Timer',
    'También puedes iniciarlo desde la ficha de cualquier tarea.':'You can also start it from any task’s details.',
    'Contando en':'Tracking', 'una tarea que ya no existe':'a task that no longer exists', 'Detener y guardar':'Stop and save',
    'No hay tareas abiertas en este proyecto.':'There are no open tasks in this project.',
    'Tarea':'Task', 'Elige una tarea…':'Choose a task…', 'Empezar':'Start', 'Sin cliente':'No client',
    'Total':'Total', 'últimos 7 días':'last 7 days', 'Borrar tiempos':'Clear times', 'Por tarea':'By task', 'Por cliente':'By client',
    'Tarea eliminada':'Deleted task', 'Aún no has medido tiempo. Elige una tarea y pulsa Empezar.':'You haven’t tracked any time yet. Choose a task and click Start.',
    'Conectando con Workhub…':'Connecting to Workhub…',
    'Este plugin se abre desde Workhub (sección Plugins).':'This plugin opens from Workhub (Plugins section).',
    'No se pudo conectar con Workhub: {error}':'Could not connect to Workhub: {error}'
  }});

  var app = document.getElementById('app');
  document.getElementById('status').textContent = tr('Conectando con Workhub…');
  var wh = null, tasks = [], running = null, totals = {}, sessions = [], tick = null, selected = '';

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function hms(ms){
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function human(ms){
    var min = Math.round(ms / 60000);
    if(min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
  }
  function task(id){ return tasks.find(function(t){ return t.id === id; }); }
  function fail(err){ wh.ui.toast(tr('No se pudo guardar: {error}', {error:err.message}), {type:'error'}); }

  /* ---------- Datos (compartidos por panel y segundo plano) ---------- */

  function load(){
    return Promise.all([wh.storage.get('running'), wh.storage.get('totals'), wh.storage.get('sessions')]).then(function(r){
      running = r[0] && r[0].taskId ? r[0] : null;
      totals = r[1] && typeof r[1] === 'object' ? r[1] : {};
      sessions = Array.isArray(r[2]) ? r[2] : [];
    });
  }

  function start(taskId){
    running = {taskId:taskId, startedAt:Date.now()};
    return wh.storage.set('running', running);
  }

  /* Guarda lo contado y para. Devuelve los milisegundos guardados. */
  function stop(){
    if(!running) return Promise.resolve(0);
    var end = Date.now();
    var ms = end - running.startedAt;
    totals[running.taskId] = (totals[running.taskId] || 0) + ms;
    sessions.push({taskId:running.taskId, start:running.startedAt, end:end});
    if(sessions.length > MAX_SESSIONS) sessions = sessions.slice(-MAX_SESSIONS);
    running = null;
    return Promise.all([wh.storage.set('running', null), wh.storage.set('totals', totals), wh.storage.set('sessions', sessions)])
      .then(function(){ return ms; });
  }

  /* ---------- Segundo plano: botones y etiquetas en Workhub ---------- */

  function refreshUi(){
    var badges = {};
    Object.keys(totals).forEach(function(id){
      if(totals[id] > 60000) badges[id] = {text:human(totals[id]), icon:'clock', tone:'neutral'};
    });
    if(running){
      var elapsed = Date.now() - running.startedAt + (totals[running.taskId] || 0);
      badges[running.taskId] = {text:tr('En marcha · {time}', {time:human(elapsed)}), icon:'timer', tone:'accent'};
      var t = task(running.taskId);
      var label = tr('Detener · {time}', {time:human(Date.now() - running.startedAt)});
      wh.ui.addButton({id:'stop', location:'tasks.toolbar', label:label, icon:'timer', variant:'primary', tooltip:t ? tr('Detener el cronómetro de «{task}»', {task:t.title}) : tr('Detener el cronómetro')});
      wh.ui.addButton({id:'stop-cmd', location:'command', label:tr('Detener cronómetro'), icon:'timer'});
    } else {
      wh.ui.removeButton('stop');
      wh.ui.removeButton('stop-cmd');
    }
    wh.ui.setTaskBadges(badges);
  }

  function background(){
    wh.ui.addButton({id:'start', location:'task.actions', label:tr('Iniciar cronómetro'), icon:'timer', tooltip:tr('Medir el tiempo de esta tarea')});
    wh.ui.addButton({id:'open-cmd', location:'command', label:tr('Abrir temporizador'), icon:'timer'});

    wh.on('action', function(ev){
      if(ev.id === 'start'){
        var t = task(ev.context.taskId);
        if(!t) return;
        if(running && running.taskId === t.id){ wh.ui.toast(tr('Ya está contando en «{task}»', {task:t.title})); return; }
        var prev = running && task(running.taskId);
        stop().then(function(ms){
          return start(t.id).then(function(){
            wh.ui.toast((prev ? tr('Guardados {time} en «{task}». ', {time:human(ms), task:prev.title}) : '') + tr('Contando en «{task}»', {task:t.title}));
            refreshUi();
          });
        }).catch(fail);
      } else if(ev.id === 'stop' || ev.id === 'stop-cmd'){
        var rt = running && task(running.taskId);
        stop().then(function(ms){
          wh.ui.toast(rt ? tr('Guardado: {time} en «{task}»', {time:human(ms), task:rt.title}) : tr('Guardado: {time}', {time:human(ms)}));
          refreshUi();
        }).catch(fail);
      } else if(ev.id === 'open-cmd'){
        wh.ui.openPanel();
      }
    });
    /* El panel cambió algo: releer. Otro proyecto: sus tiempos son otros. */
    wh.on('storage', function(){ load().then(refreshUi); });
    wh.on('project', function(){ wh.tasks.list().then(function(list){ tasks = list; return load(); }).then(refreshUi); });
    wh.on('tasks', function(list){ tasks = list; refreshUi(); });
    /* Actualiza el tiempo que se ve en el botón y la etiqueta. */
    setInterval(function(){ if(running) refreshUi(); }, 30000);
    refreshUi();
  }

  /* ---------- Panel ---------- */

  var resetArmed = false;
  function reset(){
    if(!resetArmed){
      resetArmed = true;
      var b = document.getElementById('reset');
      if(b) b.textContent = tr('¿Seguro? Pulsa otra vez');
      setTimeout(function(){ resetArmed = false; render(); }, 4000);
      return;
    }
    resetArmed = false;
    totals = {}; sessions = [];
    Promise.all([wh.storage.set('totals', totals), wh.storage.set('sessions', sessions)]).catch(fail);
    render();
  }

  /* Etapas finales del proyecto (las que cuentan como terminadas). */
  var doneKeys = [];
  function isDone(t){ return doneKeys.indexOf(t.status) !== -1; }
  function loadDoneKeys(){
    return wh.statuses().then(function(list){
      doneKeys = list.filter(function(s){ return s.done; }).map(function(s){ return s.key; });
    });
  }

  function weekTotal(){
    var weekAgo = Date.now() - 7 * 864e5;
    return sessions.reduce(function(n, s){ return s.end >= weekAgo ? n + (s.end - Math.max(s.start, weekAgo)) : n; }, 0);
  }

  function render(){
    if(running) selected = running.taskId;
    var open = tasks.filter(function(t){ return !isDone(t) || t.id === selected; })
      .sort(function(a, b){ return (a.cliente || '').localeCompare(b.cliente || '', WorkhubPlugin.lang) || a.title.localeCompare(b.title, WorkhubPlugin.lang); });
    var elapsed = running ? Date.now() - running.startedAt : 0;
    var rt = running && task(running.taskId);
    var html = '<h1>' + tr('Temporizador') + '</h1><p class="wh-muted">' + esc((wh.context.project || {}).name || '') +
      ' · ' + tr('También puedes iniciarlo desde la ficha de cualquier tarea.') + '</p>' +
      '<div class="timer"><div class="clock' + (running ? ' is-running' : '') + '" id="clock">' + hms(elapsed) + '</div>';
    if(running){
      html += '<div class="running-on">' + tr('Contando en') + ' <b>' + esc(rt ? rt.title : tr('una tarea que ya no existe')) + '</b>' + (rt && rt.cliente ? ' · ' + esc(rt.cliente) : '') + '</div>' +
        '<button class="wh-btn is-primary" id="toggle">' + tr('Detener y guardar') + '</button>';
    } else if(!open.length){
      html += '<div class="running-on">' + tr('No hay tareas abiertas en este proyecto.') + '</div>';
    } else {
      html += '<select class="wh-select" id="task" aria-label="' + tr('Tarea') + '"><option value="">' + tr('Elige una tarea…') + '</option>' +
        open.map(function(t){ return '<option value="' + esc(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + esc((t.cliente ? t.cliente + ' — ' : '') + t.title) + '</option>'; }).join('') +
        '</select><button class="wh-btn is-primary" id="toggle"' + (selected ? '' : ' disabled') + '>' + tr('Empezar') + '</button>';
    }
    html += '</div>';

    var ids = Object.keys(totals).filter(function(id){ return totals[id] > 0; }).sort(function(a, b){ return totals[b] - totals[a]; });
    if(ids.length){
      var byClient = {};
      ids.forEach(function(id){ var t = task(id); var c = (t && t.cliente) || tr('Sin cliente'); byClient[c] = (byClient[c] || 0) + totals[id]; });
      var sum = ids.reduce(function(n, id){ return n + totals[id]; }, 0);
      html += '<div class="wh-row" style="justify-content:space-between"><p class="wh-muted">' + tr('Total') + ': <b>' + human(sum) + '</b> · ' + tr('últimos 7 días') + ': <b>' + human(weekTotal()) + '</b></p>' +
        '<button class="wh-btn is-danger" id="reset">' + tr('Borrar tiempos') + '</button></div>' +
        '<div class="cols"><div class="section"><h2>' + tr('Por tarea') + '</h2><div class="table-wrap"><table class="wh-table"><tbody>' +
        ids.map(function(id){ var t = task(id); return '<tr><td>' + esc(t ? t.title : tr('Tarea eliminada')) + '<div class="wh-muted">' + esc(t ? t.cliente : '') + '</div></td><td class="num">' + human(totals[id]) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div><div class="section"><h2>' + tr('Por cliente') + '</h2><div class="table-wrap"><table class="wh-table"><tbody>' +
        Object.keys(byClient).sort(function(a, b){ return byClient[b] - byClient[a]; }).map(function(c){ return '<tr><td>' + esc(c) + '</td><td class="num">' + human(byClient[c]) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div></div>';
    } else {
      html += '<div class="wh-empty">' + tr('Aún no has medido tiempo. Elige una tarea y pulsa Empezar.') + '</div>';
    }
    app.innerHTML = html;

    var sel = document.getElementById('task');
    if(sel) sel.onchange = function(){ selected = sel.value; render(); };
    var toggle = document.getElementById('toggle');
    if(toggle) toggle.onclick = function(){
      if(running){
        var t = task(running.taskId);
        stop().then(function(ms){ wh.ui.toast(t ? tr('Guardado: {time} en «{task}»', {time:human(ms), task:t.title}) : tr('Guardado: {time}', {time:human(ms)})); }).catch(fail);
      } else if(selected){
        start(selected).catch(fail);
      }
      render();
    };
    var rs = document.getElementById('reset');
    if(rs) rs.onclick = reset;

    clearInterval(tick);
    if(running) tick = setInterval(function(){
      var c = document.getElementById('clock');
      if(c) c.textContent = hms(Date.now() - running.startedAt);
    }, 1000);
  }

  function panel(){
    render();
    wh.on('tasks', function(list){ tasks = list; render(); });
    /* Se inició o paró desde una tarea: releer. */
    wh.on('storage', function(){ load().then(render); });
    wh.on('project', function(){ clearInterval(tick); selected = ''; loadDoneKeys().then(function(){ return wh.tasks.list(); }).then(function(list){ tasks = list; return load(); }).then(render); });
  }

  WorkhubPlugin.connect(MANIFEST).then(function(client){
    wh = client;
    return loadDoneKeys().then(function(){ return wh.tasks.list(); });
  }).then(function(list){
    tasks = list;
    return load();
  }).then(function(){
    if(wh.isBackground) background();
    else panel();
  }).catch(function(err){
    document.getElementById('status').textContent = err.message === 'not-in-workhub'
      ? tr('Este plugin se abre desde Workhub (sección Plugins).')
      : tr('No se pudo conectar con Workhub: {error}', {error:err.message});
  });
})();
