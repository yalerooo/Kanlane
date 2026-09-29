/* Plugin oficial "Temporizador": cronómetro por tarea y tiempo acumulado.
   Permisos: tasks:read, storage. Datos guardados (por proyecto):
   - running:  {taskId, startedAt} | null   (sigue contando aunque cierres)
   - totals:   {taskId: milisegundos}
   - sessions: [{taskId, start, end}]       (las 300 últimas) */
(function(){
  var MANIFEST = {
    id: 'workhub.temporizador',
    name: 'Temporizador',
    version: '1.0.0',
    description: 'Mide el tiempo que dedicas a cada tarea con un cronómetro y consulta el total por tarea y por cliente.',
    author: 'Workhub',
    icon: '⏱️',
    permissions: ['tasks:read', 'storage']
  };
  var MAX_SESSIONS = 300;

  var app = document.getElementById('app');
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

  function load(){
    return Promise.all([wh.storage.get('running'), wh.storage.get('totals'), wh.storage.get('sessions')]).then(function(r){
      running = r[0] && r[0].taskId ? r[0] : null;
      totals = r[1] && typeof r[1] === 'object' ? r[1] : {};
      sessions = Array.isArray(r[2]) ? r[2] : [];
      if(running) selected = running.taskId;
    });
  }

  function start(){
    if(!selected || running) return;
    running = {taskId:selected, startedAt:Date.now()};
    wh.storage.set('running', running).catch(fail);
    render();
  }

  function stop(){
    if(!running) return;
    var end = Date.now();
    var ms = end - running.startedAt;
    totals[running.taskId] = (totals[running.taskId] || 0) + ms;
    sessions.push({taskId:running.taskId, start:running.startedAt, end:end});
    if(sessions.length > MAX_SESSIONS) sessions = sessions.slice(-MAX_SESSIONS);
    var t = task(running.taskId);
    running = null;
    Promise.all([wh.storage.set('running', null), wh.storage.set('totals', totals), wh.storage.set('sessions', sessions)])
      .then(function(){ wh.ui.toast('Guardado: ' + human(ms) + (t ? ' en «' + t.title + '»' : '')); })
      .catch(fail);
    render();
  }

  function reset(){
    if(!confirmReset()) return;
    totals = {}; sessions = [];
    Promise.all([wh.storage.set('totals', totals), wh.storage.set('sessions', sessions)]).catch(fail);
    render();
  }
  var resetArmed = false;
  function confirmReset(){
    if(resetArmed) return true;
    resetArmed = true;
    var b = document.getElementById('reset');
    if(b){ b.textContent = '¿Seguro? Pulsa otra vez'; }
    setTimeout(function(){ resetArmed = false; render(); }, 4000);
    return false;
  }

  function fail(err){ wh.ui.toast('No se pudo guardar: ' + err.message, {type:'error'}); }

  function weekTotal(){
    var weekAgo = Date.now() - 7 * 864e5;
    return sessions.reduce(function(n, s){ return s.end >= weekAgo ? n + (s.end - Math.max(s.start, weekAgo)) : n; }, 0);
  }

  function render(){
    var open = tasks.filter(function(t){ return t.status !== 'completada' || t.id === selected; })
      .sort(function(a, b){ return (a.cliente || '').localeCompare(b.cliente || '', 'es') || a.title.localeCompare(b.title, 'es'); });
    var elapsed = running ? Date.now() - running.startedAt : 0;
    var rt = running && task(running.taskId);
    var html = '<h1>Temporizador</h1><p class="wh-muted">' + esc((wh.context.project || {}).name || '') + '</p>' +
      '<div class="timer"><div class="clock' + (running ? ' is-running' : '') + '" id="clock">' + hms(elapsed) + '</div>';
    if(running){
      html += '<div class="running-on">Contando en <b>' + esc(rt ? rt.title : 'una tarea que ya no existe') + '</b>' + (rt && rt.cliente ? ' · ' + esc(rt.cliente) : '') + '</div>' +
        '<button class="wh-btn is-primary" id="toggle">Detener y guardar</button>';
    } else if(!open.length){
      html += '<div class="running-on">No hay tareas abiertas en este proyecto.</div>';
    } else {
      html += '<select class="wh-select" id="task" aria-label="Tarea"><option value="">Elige una tarea…</option>' +
        open.map(function(t){ return '<option value="' + esc(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + esc((t.cliente ? t.cliente + ' — ' : '') + t.title) + '</option>'; }).join('') +
        '</select><button class="wh-btn is-primary" id="toggle"' + (selected ? '' : ' disabled') + '>Empezar</button>';
    }
    html += '</div>';

    var ids = Object.keys(totals).filter(function(id){ return totals[id] > 0; }).sort(function(a, b){ return totals[b] - totals[a]; });
    if(ids.length){
      var byClient = {};
      ids.forEach(function(id){ var t = task(id); var c = (t && t.cliente) || 'Sin cliente'; byClient[c] = (byClient[c] || 0) + totals[id]; });
      var sum = ids.reduce(function(n, id){ return n + totals[id]; }, 0);
      html += '<div class="wh-row" style="justify-content:space-between"><p class="wh-muted">Total: <b>' + human(sum) + '</b> · últimos 7 días: <b>' + human(weekTotal()) + '</b></p>' +
        '<button class="wh-btn is-danger" id="reset">Borrar tiempos</button></div>' +
        '<div class="cols"><div class="section"><h2>Por tarea</h2><div class="table-wrap"><table class="wh-table"><tbody>' +
        ids.map(function(id){ var t = task(id); return '<tr><td>' + esc(t ? t.title : 'Tarea eliminada') + '<div class="wh-muted">' + esc(t ? t.cliente : '') + '</div></td><td class="num">' + human(totals[id]) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div><div class="section"><h2>Por cliente</h2><div class="table-wrap"><table class="wh-table"><tbody>' +
        Object.keys(byClient).sort(function(a, b){ return byClient[b] - byClient[a]; }).map(function(c){ return '<tr><td>' + esc(c) + '</td><td class="num">' + human(byClient[c]) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div></div>';
    } else {
      html += '<div class="wh-empty">Aún no has medido tiempo. Elige una tarea y pulsa Empezar.</div>';
    }
    app.innerHTML = html;

    var sel = document.getElementById('task');
    if(sel) sel.onchange = function(){ selected = sel.value; render(); };
    var toggle = document.getElementById('toggle');
    if(toggle) toggle.onclick = function(){ running ? stop() : start(); };
    var rs = document.getElementById('reset');
    if(rs) rs.onclick = reset;

    clearInterval(tick);
    if(running) tick = setInterval(function(){
      var c = document.getElementById('clock');
      if(c) c.textContent = hms(Date.now() - running.startedAt);
    }, 1000);
  }

  WorkhubPlugin.connect(MANIFEST).then(function(client){
    wh = client;
    return wh.tasks.list();
  }).then(function(list){
    tasks = list;
    return load();
  }).then(function(){
    render();
    wh.on('tasks', function(list){ tasks = list; render(); });
    /* Otro proyecto: sus tiempos son otros. */
    wh.on('project', function(){ clearInterval(tick); selected = ''; wh.tasks.list().then(function(list){ tasks = list; return load(); }).then(render); });
  }).catch(function(err){
    document.getElementById('status').textContent = err.message === 'not-in-workhub'
      ? 'Este plugin se abre desde Workhub (sección Plugins).'
      : 'No se pudo conectar con Workhub: ' + err.message;
  });
})();
