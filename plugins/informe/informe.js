/* Plugin oficial "Informe de trabajo": resumen de tareas por cliente y estado.
   Permisos: tasks:read, clients:read. */
(function(){
  var MANIFEST = {
    id: 'workhub.informe',
    name: 'Informe de trabajo',
    version: '1.0.0',
    description: 'Resumen de tareas por cliente y estado, lo que está vencido y lo completado esta semana. Cópialo como texto o descárgalo en CSV.',
    author: 'Workhub',
    icon: '📊',
    permissions: ['tasks:read']
  };
  var STATUS_COLORS = {pendiente:'var(--st-pend)', proceso:'var(--st-proc)', espera:'var(--st-wait)', completada:'var(--st-done)'};

  var app = document.getElementById('app');
  var wh = null, tasks = [], statuses = [];

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function ymd(d){
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmt(date){
    if(!date) return '';
    var p = date.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('es-ES', {day:'numeric', month:'short'});
  }

  function stats(){
    var today = ymd(new Date());
    var weekAgo = Date.now() - 7 * 864e5;
    var open = tasks.filter(function(t){ return t.status !== 'completada'; });
    var overdue = open.filter(function(t){ return t.dueDate && t.dueDate < today; })
      .sort(function(a, b){ return a.dueDate.localeCompare(b.dueDate); });
    var dueToday = open.filter(function(t){ return t.dueDate === today; });
    var doneWeek = tasks.filter(function(t){ return t.status === 'completada' && (t.updatedAt || 0) >= weekAgo; });
    var byClient = {};
    tasks.forEach(function(t){
      var c = t.cliente || 'Sin cliente';
      var row = byClient[c] = byClient[c] || {cliente:c, total:0};
      row[t.status] = (row[t.status] || 0) + 1;
      row.total++;
    });
    var rows = Object.keys(byClient).map(function(k){ return byClient[k]; })
      .sort(function(a, b){ return b.total - a.total || a.cliente.localeCompare(b.cliente, 'es'); });
    return {open:open, overdue:overdue, dueToday:dueToday, doneWeek:doneWeek, rows:rows};
  }

  function render(){
    var s = stats();
    var project = (wh.context.project || {}).name || '';
    var html = '<div class="head"><div><h1>Informe de trabajo</h1><p class="wh-muted">' + esc(project) + ' · ' +
      new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'}) + '</p></div>' +
      '<div class="wh-row"><button class="wh-btn" id="copy">Copiar resumen</button><button class="wh-btn is-primary" id="csv">Descargar CSV</button></div></div>';
    html += '<div class="kpis">' +
      kpi(s.open.length, 'tareas abiertas') +
      kpi(s.overdue.length, 'vencidas', s.overdue.length > 0) +
      kpi(s.dueToday.length, 'para hoy') +
      kpi(s.doneWeek.length, 'completadas en 7 días') + '</div>';

    if(!tasks.length){
      html += '<div class="wh-empty">Todavía no hay tareas en este proyecto.</div>';
      app.innerHTML = html;
      bind();
      return;
    }
    html += '<div class="section"><h2>Por cliente</h2><div class="table-wrap"><table class="wh-table"><thead><tr><th>Cliente</th>' +
      statuses.map(function(st){ return '<th class="num">' + esc(st.label) + '</th>'; }).join('') +
      '<th class="num">Total</th><th>Reparto</th></tr></thead><tbody>' +
      s.rows.map(function(r){
        return '<tr><td>' + esc(r.cliente) + '</td>' +
          statuses.map(function(st){ return '<td class="num">' + (r[st.key] || '·') + '</td>'; }).join('') +
          '<td class="num"><b>' + r.total + '</b></td><td><div class="bar">' +
          statuses.map(function(st){ return r[st.key] ? '<i style="width:' + (100 * r[st.key] / r.total) + '%;background:' + STATUS_COLORS[st.key] + '"></i>' : ''; }).join('') +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    if(s.overdue.length || s.dueToday.length){
      html += '<div class="section"><h2>Requieren atención</h2><div class="list">' +
        s.overdue.concat(s.dueToday).map(function(t){
          var late = t.dueDate < ymd(new Date());
          return '<button class="item" data-open="' + esc(t.id) + '"><span class="wh-dot" style="background:' + STATUS_COLORS[t.status] + '"></span>' +
            '<span class="t">' + esc(t.title) + '</span><span class="wh-muted">' + esc(t.cliente) + '</span>' +
            '<span class="d' + (late ? ' is-late' : '') + '">' + (late ? 'Vencida · ' + fmt(t.dueDate) : 'Hoy') + '</span></button>';
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
    var lines = ['Informe de trabajo — ' + ((wh.context.project || {}).name || '') + ' — ' + ymd(new Date()), '',
      '• Abiertas: ' + s.open.length, '• Vencidas: ' + s.overdue.length, '• Para hoy: ' + s.dueToday.length,
      '• Completadas en 7 días: ' + s.doneWeek.length, '', 'Por cliente:'];
    s.rows.forEach(function(r){
      lines.push('- ' + r.cliente + ': ' + statuses.map(function(st){ return (r[st.key] || 0) + ' ' + st.label.toLowerCase(); }).join(', '));
    });
    if(s.overdue.length){
      lines.push('', 'Vencidas:');
      s.overdue.forEach(function(t){ lines.push('- ' + t.title + ' (' + (t.cliente || 'Sin cliente') + ', ' + t.dueDate + ')'); });
    }
    return lines.join('\n');
  }

  function csv(){
    var label = {};
    statuses.forEach(function(st){ label[st.key] = st.label; });
    var cell = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var rows = [['Título', 'Cliente', 'Estado', 'Fecha límite', 'Contacto', 'Descripción']].concat(tasks.map(function(t){
      return [t.title, t.cliente, label[t.status] || t.status, t.dueDate, t.contacto, t.desc];
    }));
    return '﻿' + rows.map(function(r){ return r.map(cell).join(';'); }).join('\r\n');
  }

  function bind(){
    var copy = document.getElementById('copy');
    if(copy) copy.onclick = function(){
      navigator.clipboard.writeText(summaryText()).then(function(){ wh.ui.toast('Resumen copiado'); }, function(){ wh.ui.toast('No se pudo copiar', {type:'error'}); });
    };
    var dl = document.getElementById('csv');
    if(dl) dl.onclick = function(){
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv()], {type:'text/csv;charset=utf-8'}));
      a.download = 'informe-' + ymd(new Date()) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function(b){
      b.onclick = function(){ wh.ui.openTask(b.getAttribute('data-open')); };
    });
  }

  WorkhubPlugin.connect(MANIFEST).then(function(client){
    wh = client;
    return Promise.all([wh.statuses(), wh.tasks.list()]);
  }).then(function(res){
    statuses = res[0];
    tasks = res[1];
    render();
    wh.on('tasks', function(list){ tasks = list; render(); });
  }).catch(function(err){
    document.getElementById('status').textContent = err.message === 'not-in-workhub'
      ? 'Este plugin se abre desde Workhub (sección Plugins).'
      : 'No se pudo conectar con Workhub: ' + err.message;
  });
})();
