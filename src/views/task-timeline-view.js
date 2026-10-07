/* Vista Timeline (cronograma) de las tareas: cada una es una barra entre su fecha de inicio y su
   fecha límite. Solo con fecha límite (o solo con inicio) ocupa un día; sin ninguna fecha va a
   «Sin programar». Son las mismas tareas que el tablero, con su búsqueda y sus filtros.
   El intervalo se cambia arrastrando la barra o sus extremos, con el teclado o desde el editor. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const {ymd, parseYmd, todayYmd, capitalize} = Workhub.utils.dates;
  const TaskModel = Workhub.models.TaskModel;
  const prefs = Workhub.services.preferences;
  const PREF_KEY = 'workhub_timeline';
  const WEEK_DAYS = 14;
  const PREV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
  const NEXT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  const shift = TaskModel.shiftYmd;
  const between = TaskModel.daysBetween;

  /* Fechas reales de la tarea: el inicio solo cuenta si no es posterior a la fecha límite. */
  function datesOf(t){
    const r = TaskModel.rangeOf(t);
    if(!r) return {start:'', due:''};
    const due = t.dueDate ? r.end : '';
    const start = t.startDate ? r.start : '';
    return {start:start, due:due};
  }

  /* El intervalo que resulta de mover la barra n días (kind 'move'), o uno de sus extremos
     ('start' | 'end'). Estirar una barra de un día la convierte en un intervalo. */
  function dragged(t, kind, n){
    const d = datesOf(t);
    const r = TaskModel.rangeOf(t);
    if(kind === 'move' || (kind === 'start' && !d.due)) return {start:d.start ? shift(d.start, n) : '', due:d.due ? shift(d.due, n) : ''};
    if(kind === 'start'){
      const start = shift(r.start, n);
      return {start:start > r.end ? r.end : start, due:d.due};
    }
    const end = shift(r.end, n);
    return {start:d.start || r.start, due:end < r.start ? r.start : end};
  }

  function fmtRange(start, end){
    const loc = Workhub.i18n.locale;
    const f = (s) => parseYmd(s).toLocaleDateString(loc, {day:'numeric', month:'short'});
    return start === end ? f(start) : f(start) + ' – ' + f(end);
  }

  class TaskTimelineView {
    constructor(){
      this.root = document.getElementById('taskTimeline');
      this.status = document.getElementById('timelineStatus');
      let saved = {};
      try{ saved = JSON.parse(prefs.read(PREF_KEY, '{}')) || {}; }catch(e){ saved = {}; }
      this.scale = saved.scale === 'month' ? 'month' : 'week';
      this.group = saved.group === 'assignee' ? 'assignee' : 'status';
      this.anchor = todayYmd();
      this.tasks = [];
      this.all = [];
      this.hidden = [];
      this.handlers = {};
      this.drag = null;
      this.focusId = null;
      if(this.root) this._bind();
    }

    /* handlers: {open(id), range(id, start, due)} */
    bind(handlers){ this.handlers = handlers; }

    setHidden(keys){ this.hidden = keys.slice(); }

    /* ---------- Ventana de fechas ---------- */

    _window(){
      const a = parseYmd(this.anchor);
      if(this.scale === 'month'){
        const first = new Date(a.getFullYear(), a.getMonth(), 1);
        return {start:ymd(first), days:new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()};
      }
      const monday = new Date(a.getFullYear(), a.getMonth(), a.getDate() - ((a.getDay() + 6) % 7));
      return {start:ymd(monday), days:WEEK_DAYS};
    }

    _navigate(dir){
      if(dir === 0) this.anchor = todayYmd();
      else if(this.scale === 'month'){
        const a = parseYmd(this.anchor);
        this.anchor = ymd(new Date(a.getFullYear(), a.getMonth() + dir, 1));
      } else this.anchor = shift(this.anchor, dir * 7);
      this.render(this.tasks, this.all);
    }

    _savePrefs(){
      prefs.write(PREF_KEY, JSON.stringify({scale:this.scale, group:this.group}));
    }

    /* ---------- Eventos ---------- */

    _bind(){
      const root = this.root;
      root.addEventListener('click', (ev) => {
        const nav = closest(ev.target, 'button[data-nav]');
        if(nav){ this._navigate(+nav.getAttribute('data-nav')); this._refocus('button[data-nav="' + nav.getAttribute('data-nav') + '"]'); return; }
        const scale = closest(ev.target, 'button[data-scale]');
        if(scale){ this.scale = scale.getAttribute('data-scale'); this._savePrefs(); this.render(this.tasks, this.all); this._refocus('button[data-scale="' + this.scale + '"]'); return; }
        const group = closest(ev.target, 'button[data-group-by]');
        if(group){ this.group = group.getAttribute('data-group-by'); this._savePrefs(); this.render(this.tasks, this.all); this._refocus('button[data-group-by="' + this.group + '"]'); return; }
        const item = closest(ev.target, '[data-id]');
        if(!item) return;
        /* El clic que cierra un arrastre no abre la tarea. */
        if(this.skipClick){ this.skipClick = false; return; }
        this.handlers.open(item.getAttribute('data-id'));
      });

      root.addEventListener('keydown', (ev) => {
        const bar = closest(ev.target, '.tml-task');
        if(!bar || !ev.altKey || ev.ctrlKey || ev.metaKey || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
        if(!Workhub.views.team.canEdit()) return;
        const t = this.tasks.find((x) => x.id === bar.getAttribute('data-id'));
        if(!t || t._undecryptable) return;
        ev.preventDefault();
        const next = dragged(t, ev.shiftKey ? 'end' : 'move', ev.key === 'ArrowRight' ? 1 : -1);
        this.focusId = t.id;
        this._commit(t, next);
      });

      root.addEventListener('pointerdown', (ev) => {
        if(ev.button !== 0 || !Workhub.views.team.canEdit()) return;
        const bar = closest(ev.target, '.tml-task');
        if(!bar) return;
        const t = this.tasks.find((x) => x.id === bar.getAttribute('data-id'));
        const track = closest(bar, '.tml-track');
        if(!t || t._undecryptable || !track) return;
        const handle = closest(ev.target, '[data-handle]');
        const win = this._window();
        this.drag = {t:t, bar:bar, kind:handle ? handle.getAttribute('data-handle') : 'move', x:ev.clientX,
          dayW:track.getBoundingClientRect().width / win.days, win:win, n:0, moved:false, pointer:ev.pointerId};
        try{ bar.setPointerCapture(ev.pointerId); }catch(e){}
      });
      root.addEventListener('pointermove', (ev) => {
        const d = this.drag;
        if(!d || ev.pointerId !== d.pointer) return;
        const dx = ev.clientX - d.x;
        if(!d.moved && Math.abs(dx) < 4) return;
        if(!d.moved){ d.moved = true; d.bar.classList.add('is-dragging'); }
        const n = Math.round(dx / d.dayW);
        if(n === d.n) return;
        d.n = n;
        const next = dragged(d.t, d.kind, n);
        this._place(d.bar, next.start || next.due, next.due || next.start, d.win);
      });
      const end = (ev) => {
        const d = this.drag;
        if(!d || ev.pointerId !== d.pointer) return;
        this.drag = null;
        try{ d.bar.releasePointerCapture(ev.pointerId); }catch(e){}
        d.bar.classList.remove('is-dragging');
        if(!d.moved) return;
        /* Tras arrastrar llega un clic sobre la barra: no debe abrir la tarea. */
        this.skipClick = true;
        setTimeout(() => { this.skipClick = false; }, 0);
        if(ev.type === 'pointercancel' || d.n === 0){ this.render(this.tasks, this.all); return; }
        this._commit(d.t, dragged(d.t, d.kind, d.n));
      };
      root.addEventListener('pointerup', end);
      root.addEventListener('pointercancel', end);
    }

    _refocus(selector){
      const el = this.root.querySelector(selector);
      if(el) el.focus();
    }

    _commit(t, next){
      const ok = this.handlers.range(t.id, next.start, next.due);
      if(ok === false){ this.render(this.tasks, this.all); return; }
      const title = t.title || '';
      this.status.textContent = Workhub.t('«{title}»: {range}', {title:title, range:fmtRange(next.start || next.due, next.due || next.start)});
    }

    /* Coloca una barra en la rejilla (columnas 1…days) y marca si se sale por algún lado. */
    _place(bar, start, end, win){
      const a = between(win.start, start), b = between(win.start, end);
      const from = Math.max(0, a), to = Math.min(win.days - 1, b);
      bar.hidden = b < 0 || a > win.days - 1;
      bar.style.gridColumn = (from + 1) + ' / ' + (to + 2);
      bar.classList.toggle('is-cut-start', a < 0);
      bar.classList.toggle('is-cut-end', b > win.days - 1);
      bar.classList.toggle('is-day', start === end);
      const dates = bar.querySelector('.tml-dates');
      if(dates) dates.textContent = fmtRange(start, end);
    }

    /* ---------- Pintado ---------- */

    _groups(tasks){
      const T = Workhub.views.team;
      if(this.group === 'assignee' && T.enabled()){
        const groups = T.members().map((m) => ({key:m.uid, label:m.name, html:T.avatar(m, 'is-mini'),
          items:tasks.filter((t) => T.assigned(t).indexOf(m.uid) !== -1)}));
        groups.push({key:'none', label:Workhub.t('Sin asignar'), html:'', translated:true, items:tasks.filter((t) => !T.assigned(t).length)});
        return groups;
      }
      return TaskModel.STATUS.filter((s) => this.hidden.indexOf(s.key) === -1).map((s) => ({key:s.key, label:s.label,
        html:'<span class="dot' + (s.done ? ' is-final' : '') + '" style="--st:' + s.dot + '"></span>',
        items:tasks.filter((t) => TaskModel.stageKey(t) === s.key)}));
    }

    /* Reparte las barras en carriles para que no se pisen. */
    _lanes(items, win){
      const last = shift(win.start, win.days - 1);
      const bars = items.map((t) => ({t:t, r:TaskModel.rangeOf(t)})).filter((b) => b.r && b.r.end >= win.start && b.r.start <= last)
        .sort((a, b) => a.r.start.localeCompare(b.r.start) || a.r.end.localeCompare(b.r.end) || TaskModel.byOrder(a.t, b.t));
      const lanes = [];
      bars.forEach((b) => {
        let lane = lanes.find((l) => l[l.length - 1].r.end < b.r.start);
        if(!lane){ lane = []; lanes.push(lane); }
        lane.push(b);
      });
      return lanes;
    }

    render(tasks, all){
      if(!this.root) return;
      this.tasks = tasks;
      this.all = all || tasks;
      const T = Workhub.views.team;
      const canEdit = T.canEdit();
      if(this.group === 'assignee' && !T.enabled()) this.group = 'status';
      const win = this._window();
      const today = todayYmd();
      const loc = Workhub.i18n.locale;
      const first = parseYmd(win.start), lastDay = parseYmd(shift(win.start, win.days - 1));
      const title = this.scale === 'month'
        ? capitalize(first.toLocaleDateString(loc, {month:'long', year:'numeric'}))
        : fmtRange(win.start, ymd(lastDay)) + ' ' + lastDay.getFullYear();
      const seg = (attr, value, label, on) => '<button type="button" role="radio" ' + attr + '="' + value + '" aria-checked="' + (on ? 'true' : 'false') + '">' + esc(Workhub.t(label)) + '</button>';

      const bar = '<div class="tml-bar">' +
        '<div class="tml-nav">' +
          '<button type="button" class="icon-only" data-nav="-1" aria-label="' + esc(Workhub.t('Anterior')) + '" title="' + esc(Workhub.t('Anterior')) + '">' + PREV + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-nav="0">' + esc(Workhub.t('Hoy')) + '</button>' +
          '<button type="button" class="icon-only" data-nav="1" aria-label="' + esc(Workhub.t('Siguiente')) + '" title="' + esc(Workhub.t('Siguiente')) + '">' + NEXT + '</button>' +
        '</div>' +
        '<h2 class="tml-title" aria-live="polite">' + esc(title) + '</h2>' +
        '<span class="bar-push" aria-hidden="true"></span>' +
        '<div class="segmented" role="radiogroup" aria-label="' + esc(Workhub.t('Escala')) + '">' + seg('data-scale', 'week', 'Semana', this.scale === 'week') + seg('data-scale', 'month', 'Mes', this.scale === 'month') + '</div>' +
        (T.enabled() ? '<div class="segmented" role="radiogroup" aria-label="' + esc(Workhub.t('Agrupar por')) + '">' + seg('data-group-by', 'status', 'Estado', this.group === 'status') + seg('data-group-by', 'assignee', 'Responsable', this.group === 'assignee') + '</div>' : '') +
        '</div>';

      if(!this.all.length || !tasks.length){
        const none = !this.all.length;
        this.root.innerHTML = bar + '<div class="view-empty">' +
          '<b>' + esc(Workhub.t(none ? 'Aún no hay tareas' : 'Ninguna tarea coincide')) + '</b>' +
          '<span>' + esc(Workhub.t(none ? 'Crea una tarea con fecha de inicio y fecha límite y aparecerá aquí como una barra.' : 'Cambia la búsqueda o quita los filtros para verlas.')) + '</span></div>';
        return;
      }

      /* Cabecera y fondo: una columna por día. */
      const days = [];
      for(let i = 0; i < win.days; i++){
        const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
        days.push({date:ymd(d), d:d, weekend:d.getDay() === 0 || d.getDay() === 6});
      }
      const dayClass = (x) => (x.weekend ? ' is-weekend' : '') + (x.date === today ? ' is-today' : '');
      const head = days.map((x) => '<div class="tml-day' + dayClass(x) + '"' + (x.date === today ? ' aria-current="date"' : '') + '>' +
        '<span class="tml-dow">' + esc(x.d.toLocaleDateString(loc, {weekday:this.scale === 'month' ? 'narrow' : 'short'})) + '</span><b>' + x.d.getDate() + '</b></div>').join('');
      const cols = '<div class="tml-cols" aria-hidden="true">' + days.map((x) => '<i class="' + dayClass(x).trim() + '"></i>').join('') + '</div>';

      const taskBar = (b) => {
        const t = b.t, r = b.r;
        const a = between(win.start, r.start), z = between(win.start, r.end);
        const from = Math.max(0, a), to = Math.min(win.days - 1, z);
        const s = TaskModel.statusOf(t.status);
        const name = t._undecryptable ? Workhub.t('No se puede descifrar') : (t.title || Workhub.t('Sin título'));
        const cls = 'tml-task' + (r.start === r.end ? ' is-day' : '') + (a < 0 ? ' is-cut-start' : '') + (z > win.days - 1 ? ' is-cut-end' : '') +
          (TaskModel.isDone(t) ? ' is-done' : '') + (TaskModel.dueState(t) === 'overdue' ? ' is-overdue' : '') + (!t.dueDate ? ' is-open' : '');
        const editable = canEdit && !t._undecryptable;
        return '<div class="' + cls + '" role="button" tabindex="0" data-id="' + esc(t.id) + '" style="grid-column:' + (from + 1) + ' / ' + (to + 2) + ';--st:' + s.dot + '"' +
          ' aria-label="' + esc(name + ', ' + fmtRange(r.start, r.end) + (t.dueDate ? '' : ' (' + Workhub.t('sin fecha límite') + ')')) + '"' + (editable ? ' aria-describedby="timelineHelp"' : '') + ' title="' + esc(name + ' · ' + fmtRange(r.start, r.end)) + '">' +
          (editable ? '<i class="tml-handle is-start" data-handle="start" aria-hidden="true"></i>' : '') +
          '<span class="tml-name" translate="no">' + esc(name) + '</span><span class="tml-dates">' + esc(fmtRange(r.start, r.end)) + '</span>' +
          (editable ? '<i class="tml-handle is-end" data-handle="end" aria-hidden="true"></i>' : '') +
          '</div>';
      };

      let shown = 0;
      const groups = this._groups(tasks).map((g) => {
        const lanes = this._lanes(g.items, win);
        lanes.forEach((l) => { shown += l.length; });
        const scheduled = g.items.filter((t) => TaskModel.rangeOf(t)).length;
        return '<section class="tml-group" data-group="' + esc(g.key) + '">' +
          '<h3 class="tml-label">' + g.html + '<span' + (g.translated ? '' : ' translate="no"') + '>' + esc(g.label) + '</span><span class="count">' + scheduled + '</span></h3>' +
          '<div class="tml-track">' + cols + (lanes.length ? lanes.map((l) => '<div class="tml-lane">' + l.map(taskBar).join('') + '</div>').join('') : '<div class="tml-lane is-empty"></div>') + '</div>' +
          '</section>';
      }).join('');

      const loose = tasks.filter((t) => !TaskModel.rangeOf(t)).sort(TaskModel.byOrder);
      const scheduledAll = tasks.length - loose.length;
      const note = !scheduledAll ? 'Ninguna tarea tiene fechas todavía. Abre una y ponle fecha de inicio o fecha límite.'
        : !shown ? 'No hay tareas en estas fechas. Usa las flechas o «Hoy» para moverte.' : '';
      const unscheduled = '<section class="tml-loose" aria-labelledby="tmlLooseTitle">' +
        '<h3 id="tmlLooseTitle">' + esc(Workhub.t('Sin programar')) + '<span class="count">' + loose.length + '</span></h3>' +
        (loose.length
          ? '<div class="tml-loose-list">' + loose.map((t) => {
              const s = TaskModel.statusOf(t.status);
              return '<button type="button" class="tml-loose-item' + (TaskModel.isDone(t) ? ' is-done' : '') + '" data-id="' + esc(t.id) + '" style="--st:' + s.dot + '"><span class="dot' + (s.done ? ' is-final' : '') + '"></span><span translate="no">' + esc(t._undecryptable ? Workhub.t('No se puede descifrar') : (t.title || Workhub.t('Sin título'))) + '</span></button>';
            }).join('') + '</div>'
          : '<p class="tml-loose-empty">' + esc(Workhub.t('Todas las tareas tienen fecha.')) + '</p>') +
        '</section>';

      /* Se repinta entero con cada cambio: la tarea que tenía el foco lo conserva. */
      const active = document.activeElement;
      const keep = this.focusId || (active && this.root.contains(active) && active.getAttribute('data-id')) || null;
      const scroll = this.root.querySelector('.tml-scroll');
      const left = scroll ? scroll.scrollLeft : 0;
      this.root.innerHTML = bar +
        (note ? '<p class="tml-note">' + esc(Workhub.t(note)) + '</p>' : '') +
        '<div class="tml-scroll"><div class="tml-grid is-' + this.scale + '" style="--days:' + win.days + '">' +
          '<div class="tml-head"><div class="tml-label is-corner"></div><div class="tml-track">' + head + '</div></div>' +
          groups +
        '</div></div>' + unscheduled;
      const again = this.root.querySelector('.tml-scroll');
      if(again) again.scrollLeft = left;
      this.focusId = null;
      if(keep){
        const el = Array.from(this.root.querySelectorAll('[data-id]')).find((b) => b.getAttribute('data-id') === keep);
        if(el) el.focus({preventScroll:true});
      }
    }
  }

  /* Intro y espacio abren la tarea enfocada (las barras son botones sin serlo de verdad). */
  document.addEventListener('keydown', (ev) => {
    if((ev.key !== 'Enter' && ev.key !== ' ') || ev.altKey) return;
    const bar = ev.target && ev.target.classList && ev.target.classList.contains('tml-task') ? ev.target : null;
    if(!bar) return;
    ev.preventDefault();
    bar.click();
  });

  TaskTimelineView.dragged = dragged;
  Workhub.views.TaskTimelineView = TaskTimelineView;
})();
