/* Plugin oficial "Informe de trabajo": resumen de tareas por cliente y estado.
   Permisos: tasks:read, clients:read. */
(function(){
  var MANIFEST = {
    id: 'workhub.informe',
    name: 'Informe de trabajo',
    version: '1.1.0',
    description: 'Resumen de tareas por cliente y estado, lo que está vencido y lo completado esta semana. Cópialo como texto o descárgalo en CSV.',
    author: 'Workhub',
    icon: 'chart',
    color: 238,
    permissions: ['tasks:read', 'ui:extend']
  };
  /* Colores de las etapas del proyecto (el nombre del color lo da Workhub). */
  var COLOR_VARS = {gray:'var(--st-pend)', blue:'var(--st-proc)', orange:'var(--st-wait)', green:'var(--st-done)', red:'var(--danger)', violet:'var(--meet)'};
  function colorOf(key){
    var st = statuses.filter(function(s){ return s.key === key; })[0];
    return COLOR_VARS[st && st.color] || COLOR_VARS.gray;
  }
  /* Una tarea está terminada si su etapa es una de las marcadas como final. */
  function isDone(t){
    return statuses.some(function(s){ return s.key === t.status && s.done; });
  }

  var tr = WorkhubPlugin.translations({en:{
    'Informe de trabajo':'Work report', 'Copiar resumen':'Copy summary', 'Descargar CSV':'Download CSV',
    'tareas abiertas':'open tasks', 'vencidas':'overdue', 'para hoy':'due today', 'completadas en 7 días':'done in 7 days',
    'Todavía no hay tareas en este proyecto.':'There are no tasks in this project yet.',
    'Por cliente':'By client', 'Cliente':'Client', 'Total':'Total', 'Reparto':'Breakdown',
    'Requieren atención':'Need attention', 'Vencida · {date}':'Overdue · {date}', 'Hoy':'Today', 'Sin cliente':'No client',
    'Abiertas':'Open', 'Vencidas':'Overdue', 'Para hoy':'Due today', 'Completadas en 7 días':'Done in 7 days', 'Por cliente:':'By client:', 'Vencidas:':'Overdue:',
    'Título':'Title', 'Estado':'Status', 'Fecha límite':'Due date', 'Contacto':'Contact', 'Descripción':'Description',
    'Resumen copiado':'Summary copied', 'No se pudo copiar':'Could not copy', 'informe':'report',
    'Informe':'Report', 'Ver el informe de trabajo':'View the work report', 'Ver informe de trabajo':'View work report',
    'Conectando con Workhub…':'Connecting to Workhub…',
    'Este plugin se abre desde Workhub (sección Plugins).':'This plugin opens from Workhub (Plugins section).',
    'No se pudo conectar con Workhub: {error}':'Could not connect to Workhub: {error}'
  }});

  var app = document.getElementById('app');
  var wh = null, tasks = [], statuses = [];
  document.getElementById('status').textContent = tr('Conectando con Workhub…');

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function ymd(d){
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmt(date){
    if(!date) return '';
    var p = date.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(WorkhubPlugin.locale, {day:'numeric', month:'short'});
  }

  function stats(){
    var today = ymd(new Date());
    var weekAgo = Date.now() - 7 * 864e5;
    var open = tasks.filter(function(t){ return !isDone(t); });
    var overdue = open.filter(function(t){ return t.dueDate && t.dueDate < today; })
      .sort(function(a, b){ return a.dueDate.localeCompare(b.dueDate); });
    var dueToday = open.filter(function(t){ return t.dueDate === today; });
    var doneWeek = tasks.filter(function(t){ return isDone(t) && (t.updatedAt || 0) >= weekAgo; });
    var byClient = {};
    tasks.forEach(function(t){
      var c = t.cliente || tr('Sin cliente');
      var row = byClient[c] = byClient[c] || {cliente:c, total:0};
      row[t.status] = (row[t.status] || 0) + 1;
      row.total++;
    });
    var rows = Object.keys(byClient).map(function(k){ return byClient[k]; })
      .sort(function(a, b){ return b.total - a.total || a.cliente.localeCompare(b.cliente, WorkhubPlugin.lang); });
    return {open:open, overdue:overdue, dueToday:dueToday, doneWeek:doneWeek, rows:rows};
  }

  function render(){
    var s = stats();
    var project = (wh.context.project || {}).name || '';
    var html = '<div class="head"><div><h1>' + tr('Informe de trabajo') + '</h1><p class="wh-muted">' + esc(project) + ' · ' +
      new Date().toLocaleDateString(WorkhubPlugin.locale, {weekday:'long', day:'numeric', month:'long'}) + '</p></div>' +
      '<div class="wh-row"><button class="wh-btn" id="copy">' + tr('Copiar resumen') + '</button><button class="wh-btn is-primary" id="csv">' + tr('Descargar CSV') + '</button></div></div>';
    html += '<div class="kpis">' +
      kpi(s.open.length, tr('tareas abiertas')) +
      kpi(s.overdue.length, tr('vencidas'), s.overdue.length > 0) +
      kpi(s.dueToday.length, tr('para hoy')) +
      kpi(s.doneWeek.length, tr('completadas en 7 días')) + '</div>';

    if(!tasks.length){
      html += '<div class="wh-empty">' + tr('Todavía no hay tareas en este proyecto.') + '</div>';
      app.innerHTML = html;
      bind();
      return;
    }
    html += '<div class="section"><h2>' + tr('Por cliente') + '</h2><div class="table-wrap"><table class="wh-table"><thead><tr><th>' + tr('Cliente') + '</th>' +
      statuses.map(function(st){ return '<th class="num">' + esc(st.label) + '</th>'; }).join('') +
      '<th class="num">' + tr('Total') + '</th><th>' + tr('Reparto') + '</th></tr></thead><tbody>' +
      s.rows.map(function(r){
        return '<tr><td>' + esc(r.cliente) + '</td>' +
          statuses.map(function(st){ return '<td class="num">' + (r[st.key] || '·') + '</td>'; }).join('') +
          '<td class="num"><b>' + r.total + '</b></td><td><div class="bar">' +
          statuses.map(function(st){ return r[st.key] ? '<i style="width:' + (100 * r[st.key] / r.total) + '%;background:' + colorOf(st.key) + '"></i>' : ''; }).join('') +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    if(s.overdue.length || s.dueToday.length){
      html += '<div class="section"><h2>' + tr('Requieren atención') + '</h2><div class="list">' +
        s.overdue.concat(s.dueToday).map(function(t){
          var late = t.dueDate < ymd(new Date());
          return '<button class="item" data-open="' + esc(t.id) + '"><span class="wh-dot" style="background:' + colorOf(t.status) + '"></span>' +
            '<span class="t">' + esc(t.title) + '</span><span class="wh-muted">' + esc(t.cliente) + '</span>' +
            '<span class="d' + (late ? ' is-late' : '') + '">' + (late ? tr('Vencida · {date}', {date:fmt(t.dueDate)}) : tr('Hoy')) + '</span></button>';
        }).join('') + '</div></div>';
    }
    app.innerHTML = html;
    bind();
  }

  function kpi(n, label, danger){
    return '<div class="kpi' + (danger ? ' is-danger' : '') + '"><b>' + n + '</b><span>' + label + '</span></div>';
  }

  function summaryText(){
    var s = stats();
    var lines = [tr('Informe de trabajo') + ' — ' + ((wh.context.project || {}).name || '') + ' — ' + ymd(new Date()), '',
      '• ' + tr('Abiertas') + ': ' + s.open.length, '• ' + tr('Vencidas') + ': ' + s.overdue.length, '• ' + tr('Para hoy') + ': ' + s.dueToday.length,
      '• ' + tr('Completadas en 7 días') + ': ' + s.doneWeek.length, '', tr('Por cliente:')];
    s.rows.forEach(function(r){
      lines.push('- ' + r.cliente + ': ' + statuses.map(function(st){ return (r[st.key] || 0) + ' ' + st.label.toLowerCase(); }).join(', '));
    });
    if(s.overdue.length){
      lines.push('', tr('Vencidas:'));
      s.overdue.forEach(function(task){ lines.push('- ' + task.title + ' (' + (task.cliente || tr('Sin cliente')) + ', ' + task.dueDate + ')'); });
    }
    return lines.join('\n');
  }

  function csv(){
    var label = {};
    statuses.forEach(function(st){ label[st.key] = st.label; });
    var cell = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var rows = [[tr('Título'), tr('Cliente'), tr('Estado'), tr('Fecha límite'), tr('Contacto'), tr('Descripción')]].concat(tasks.map(function(t){
      return [t.title, t.cliente, label[t.status] || t.status, t.dueDate, t.contacto, t.desc];
    }));
    return '﻿' + rows.map(function(r){ return r.map(cell).join(';'); }).join('\r\n');
  }

  function bind(){
    var copy = document.getElementById('copy');
    if(copy) copy.onclick = function(){
      navigator.clipboard.writeText(summaryText()).then(function(){ wh.ui.toast(tr('Resumen copiado')); }, function(){ wh.ui.toast(tr('No se pudo copiar'), {type:'error'}); });
    };
    var dl = document.getElementById('csv');
    if(dl) dl.onclick = function(){
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv()], {type:'text/csv;charset=utf-8'}));
      a.download = tr('informe') + '-' + ymd(new Date()) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function(b){
      b.onclick = function(){ wh.ui.openTask(b.getAttribute('data-open')); };
    });
  }

  function background(){
    wh.ui.addButton({id:'open', location:'tasks.toolbar', label:tr('Informe'), icon:'chart', tooltip:tr('Ver el informe de trabajo')});
    wh.ui.addButton({id:'open-cmd', location:'command', label:tr('Ver informe de trabajo'), icon:'chart'});
    wh.on('action', function(){ wh.ui.openPanel(); });
  }

  WorkhubPlugin.connect(MANIFEST).then(function(client){
    wh = client;
    if(wh.isBackground){ background(); throw 'background'; }
    return Promise.all([wh.statuses(), wh.tasks.list()]);
  }).then(function(res){
    statuses = res[0];
    tasks = res[1];
    render();
    wh.on('tasks', function(list){ tasks = list; render(); });
    wh.on('project', function(){
      Promise.all([wh.statuses(), wh.tasks.list()]).then(function(r){ statuses = r[0]; tasks = r[1]; render(); });
    });
  }).catch(function(err){
    if(err === 'background') return;
    document.getElementById('status').textContent = err.message === 'not-in-workhub'
      ? tr('Este plugin se abre desde Workhub (sección Plugins).')
      : tr('No se pudo conectar con Workhub: {error}', {error:err.message});
  });
})();
