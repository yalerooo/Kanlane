/* Calendario mensual, agenda del día y diálogos de reunión. */
(function(){
  const {esc, closest, PLUS_ICON} = Workhub.utils.html;
  const {ymd, todayYmd, parseYmd, capitalize, longDay} = Workhub.utils.dates;
  const {safeUrl, platformOf} = Workhub.utils.urls;
  const {copyWithFeedback, showMessage, bindDragAndDrop, consumeDragClick} = Workhub.utils.ui;
  const TaskModel = Workhub.models.TaskModel;
  const MeetingModel = Workhub.models.MeetingModel;
  const $ = (id) => document.getElementById(id);

  const MAX_CHIPS = 3;
  const EMPTY_BUCKET = {tasks:[], meetings:[]};

  class CalendarView {
    constructor(){
      this.grid = $('calGrid');
      this.day = $('calDay');
      this.monthLabel = $('calMonthLabel');
      this.btnPrev = $('calPrev');
      this.btnNext = $('calNext');
      this.btnToday = $('calToday');
      this.btnNewMeeting = $('calNewMeeting');
      this.filterCliente = $('calFilterCliente');
      this.modeBar = $('calMode');
      this.section = this.grid.closest('section');

      /* Formulario de reunión */
      this.dlg = $('dlgMeeting');
      this.form = $('formMeeting');
      this.formTitle = $('dlgMeetingTitle');
      this.formError = $('meetingFormError');
      this.btnDelete = $('btnDeleteMeeting');
      this.btnCancel = $('btnCancelMeeting');
      this.cliente = new Workhub.views.ClientSelect('m');
      this.f = {
        id: $('mId'),
        title: $('mTitle'),
        date: $('mDate'),
        start: $('mStart'),
        end: $('mEnd'),
        link: $('mLink'),
        linkHint: $('mLinkHint'),
        notas: $('mNotas')
      };

      /* Ficha de reunión */
      this.viewDlg = $('dlgMeetingView');
      this.mv = {
        cliente: $('mvCliente'),
        platform: $('mvPlatform'),
        title: $('mvTitle'),
        when: $('mvWhen'),
        linkWrap: $('mvLinkWrap'),
        join: $('mvJoin'),
        copyLink: $('mvCopyLink'),
        url: $('mvUrl'),
        notasWrap: $('mvNotasWrap'),
        notas: $('mvNotas'),
        btnClose: $('btnMvClose'),
        btnEdit: $('btnMvEdit')
      };

      this._bindLocalUi();
    }

    _bindLocalUi(){
      this.f.link.addEventListener('input', () => this._updateLinkHint());
      this.btnCancel.addEventListener('click', () => this.dlg.close());
      this.mv.btnClose.addEventListener('click', () => this.viewDlg.close());
      this.mv.copyLink.addEventListener('click', () => {
        const url = this.mv.url.textContent;
        if(url) copyWithFeedback(this.mv.copyLink, url);
      });
    }

    /* ---------- Eventos hacia el controlador ---------- */

    /* handlers: {prev, next, today, newMeeting, filter} */
    bindToolbar(handlers){
      this.btnPrev.addEventListener('click', handlers.prev);
      this.btnNext.addEventListener('click', handlers.next);
      this.btnToday.addEventListener('click', handlers.today);
      this.btnNewMeeting.addEventListener('click', handlers.newMeeting);
      this.filterCliente.addEventListener('change', handlers.filter);
      this.modeBar.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-cal-mode]');
        if(b && handlers.mode) handlers.mode(b.getAttribute('data-cal-mode'));
      });
    }

    /* Mes, semana o día: marca el botón y ajusta el diseño y las etiquetas de las flechas. */
    setMode(mode){
      this.mode = mode;
      this.modeBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.getAttribute('data-cal-mode') === mode ? 'true' : 'false'));
      this.section.classList.toggle('cal-mode-week', mode === 'week');
      this.section.classList.toggle('cal-mode-day', mode === 'day');
      const unit = {month:['Mes anterior', 'Mes siguiente'], week:['Semana anterior', 'Semana siguiente'], day:['Día anterior', 'Día siguiente']}[mode];
      this.btnPrev.setAttribute('aria-label', unit[0]);
      this.btnNext.setAttribute('aria-label', unit[1]);
    }

    /* handlers: {openItem(kind, id), selectDate(date), newMeetingOn(date), move(kind, id, date)} */
    bindGrid(handlers){
      this.grid.addEventListener('click', (ev) => {
        const chip = closest(ev.target, '.cal-chip');
        if(chip){
          if(!consumeDragClick(chip)) handlers.openItem(chip.getAttribute('data-kind'), chip.getAttribute('data-id'));
          return;
        }
        const cell = closest(ev.target, '.cal-cell');
        if(cell) handlers.selectDate(cell.getAttribute('data-date'), true);
      });
      this.grid.addEventListener('dblclick', (ev) => {
        if(closest(ev.target, '.cal-chip')) return;
        const cell = closest(ev.target, '.cal-cell');
        if(cell) handlers.newMeetingOn(cell.getAttribute('data-date'));
      });
      this.grid.addEventListener('keydown', (ev) => {
        const cell = ev.target;
        if(!cell.classList || !cell.classList.contains('cal-cell')) return;
        if(ev.key === 'Enter' || ev.key === ' '){
          ev.preventDefault();
          handlers.selectDate(cell.getAttribute('data-date'), true);
        }
      });
      bindDragAndDrop(this.grid, {
        itemSelector: '.cal-chip',
        targetSelector: '.cal-cell',
        getPayload: (chip) => chip.getAttribute('data-kind') + ':' + chip.getAttribute('data-id'),
        onDrop: (payload, cell) => {
          const sep = payload.indexOf(':');
          if(sep < 0) return;
          handlers.move(payload.slice(0, sep), payload.slice(sep + 1), cell.getAttribute('data-date'));
        }
      });
    }

    /* handlers: {openItem(kind, id), newMeeting(), newTask()} */
    bindDay(handlers){
      this.day.addEventListener('click', (ev) => {
        if(closest(ev.target, 'a[data-join]')) return;
        const btn = closest(ev.target, 'button[data-action]');
        if(btn){
          const action = btn.getAttribute('data-action');
          if(action === 'new-meeting') handlers.newMeeting();
          if(action === 'new-task') handlers.newTask();
          return;
        }
        const item = closest(ev.target, '.agenda-item');
        if(item) handlers.openItem(item.getAttribute('data-kind'), item.getAttribute('data-id'));
      });
    }

    bindMeetingSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this.formError.hidden = true;
        handler(this.f.id.value, this.meetingValues());
      });
    }

    bindMeetingDelete(handler){
      this.btnDelete.addEventListener('click', () => handler(this.f.id.value));
    }

    bindMeetingEdit(handler){
      this.mv.btnEdit.addEventListener('click', () => {
        const id = this.viewDlg.getAttribute('data-id');
        this.viewDlg.close();
        if(id) handler(id);
      });
    }

    /* ---------- Calendario ---------- */

    isVisible(){
      return !this.grid.closest('section').hidden;
    }

    clientFilter(){ return this.filterCliente.value; }

    setClientOptions(names){
      Workhub.views.ClientSelect.populateFilter(this.filterCliente, names);
    }

    /* buckets: {'AAAA-MM-DD': {tasks, meetings}} */
    render(year, month, selected, buckets, mode){
      mode = mode || 'month';
      const loc = Workhub.i18n.locale;
      const first = new Date(year, month, 1);
      let start, totalCells;
      if(mode === 'month'){
        this.monthLabel.textContent = capitalize(first.toLocaleDateString(loc, {month:'long', year:'numeric'}));
        const offset = (first.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
        start = new Date(year, month, 1 - offset);
      } else {
        /* Semana (lunes a domingo) que contiene el día elegido. */
        const sel = parseYmd(selected);
        start = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - ((sel.getDay() + 6) % 7));
        totalCells = 7;
        if(mode === 'day'){
          this.monthLabel.textContent = longDay(sel, true);
        } else {
          const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
          const short = {day:'numeric', month:'short'};
          this.monthLabel.textContent = start.toLocaleDateString(loc, short) + ' – ' + end.toLocaleDateString(loc, Object.assign({year:'numeric'}, short));
        }
      }
      this.grid.classList.toggle('is-week', mode === 'week');
      const maxChips = mode === 'month' ? MAX_CHIPS : Infinity;
      const today = todayYmd();
      let html = '';
      for(let i = 0; i < totalCells; i++){
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const key = ymd(d);
        const b = buckets[key] || EMPTY_BUCKET;
        const chips = b.meetings.map(meetingChipHtml).concat(b.tasks.map(taskChipHtml));
        const extra = chips.length > maxChips ? '<span class="cal-more">+' + (chips.length - maxChips) + ' más</span>' : '';
        const dots = b.meetings.slice(0, MAX_CHIPS).map(() => '<i class="cal-dot is-meeting"></i>')
          .concat(b.tasks.slice(0, MAX_CHIPS).map((t) => {
            return '<i class="cal-dot' + (TaskModel.dueState(t) === 'overdue' ? ' is-overdue' : '') + '"></i>';
          })).join('');
        const cls = 'cal-cell' +
          (mode === 'month' && d.getMonth() !== month ? ' is-other' : '') +
          (key === today ? ' is-today' : '') +
          (key === selected ? ' is-selected' : '');
        const count = b.meetings.length + b.tasks.length;
        const aria = longDay(d) + (count ? ', ' + count + (count === 1 ? ' elemento' : ' elementos') : '');
        html += '<div class="' + cls + '" data-date="' + key + '" role="button" tabindex="0" aria-label="' + esc(aria) + '">' +
          '<span class="cal-num">' + d.getDate() + '</span>' +
          (mode === 'week' ? '<span class="cal-wd" aria-hidden="true">' + esc(capitalize(d.toLocaleDateString(loc, {weekday:'long'}))) + '</span>' : '') +
          '<div class="cal-items">' + chips.slice(0, maxChips).join('') + extra + '</div>' +
          '<div class="cal-dots">' + dots + '</div>' +
          '</div>';
      }
      this.grid.innerHTML = html;
    }

    markSelected(date){
      this.grid.querySelectorAll('.cal-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
      const cell = this.grid.querySelector('.cal-cell[data-date="' + date + '"]');
      if(cell) cell.classList.add('is-selected');
    }

    renderDay(date, bucket){
      const b = bucket || EMPTY_BUCKET;
      const isToday = date === todayYmd();
      let html = '<span class="cal-day-kicker' + (isToday ? '' : ' is-muted') + '">' + (isToday ? 'Hoy' : 'Día seleccionado') + '</span>' +
        '<h3>' + esc(longDay(parseYmd(date))) + '</h3>' +
        '<div class="cal-day-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="new-meeting">' + PLUS_ICON + 'Reunión</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="new-task">' + PLUS_ICON + 'Tarea con esta fecha</button>' +
        '</div>';
      if(!b.meetings.length && !b.tasks.length){
        html += '<p class="cal-empty">Nada programado este día.</p>';
      }
      if(b.meetings.length){
        html += '<p class="cal-day-label">Reuniones</p>' + b.meetings.map(agendaMeetingHtml).join('');
      }
      if(b.tasks.length){
        html += '<p class="cal-day-label">Tareas que vencen</p>' + b.tasks.map(agendaTaskHtml).join('');
      }
      this.day.innerHTML = html;
    }

    /* En pantallas estrechas la agenda queda debajo: se desplaza hasta ella. */
    scrollToDay(){
      if(!window.matchMedia || !window.matchMedia('(max-width: 900px)').matches) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.day.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block:'start'});
    }

    /* ---------- Diálogos de reunión ---------- */

    _updateLinkHint(){
      const raw = this.f.link.value.trim();
      if(!raw){ this.f.linkHint.textContent = ''; return; }
      const p = platformOf(raw);
      this.f.linkHint.textContent = p ? p + ' detectado' : 'Este enlace no parece válido';
    }

    meetingValues(){
      return {
        title: this.f.title.value.trim(),
        cliente: this.cliente.rawValue(),
        date: this.f.date.value,
        start: this.f.start.value || '',
        end: this.f.end.value || '',
        rawLink: this.f.link.value.trim(),
        notas: this.f.notas.value.trim()
      };
    }

    openNewMeeting(clientNames, defaultCliente, date){
      this.form.reset();
      this.f.id.value = '';
      this.formTitle.textContent = 'Nueva reunión';
      this.formError.hidden = true;
      this.cliente.reset(clientNames, defaultCliente);
      this.f.date.value = date;
      this._updateLinkHint();
      this.btnDelete.hidden = true;
      this.dlg.showModal();
    }

    openEditMeeting(m, clientNames){
      this.form.reset();
      this.f.id.value = m.id;
      this.formTitle.textContent = 'Editar reunión';
      this.formError.hidden = true;
      this.f.title.value = m.title || '';
      this.cliente.reset(clientNames, m.cliente || '');
      this.f.date.value = m.date || '';
      this.f.start.value = m.start || '';
      this.f.end.value = m.end || '';
      this.f.link.value = m.link || '';
      this.f.notas.value = m.notas || '';
      this._updateLinkHint();
      this.btnDelete.hidden = false;
      this.dlg.showModal();
    }

    showMeetingError(msg){ showMessage(this.formError, msg); }

    closeMeeting(){ this.dlg.close(); }

    openMeetingDetail(m){
      const mv = this.mv;
      this.viewDlg.setAttribute('data-id', m.id);
      mv.cliente.textContent = m.cliente || 'Sin cliente';
      mv.platform.textContent = platformOf(m.link) || 'Reunión';
      mv.title.textContent = m.title || 'Reunión';
      const day = m.date ? longDay(parseYmd(m.date), true) : '';
      mv.when.textContent = [day, MeetingModel.timeText(m, ' – ')].filter(Boolean).join(' · ');
      const url = safeUrl(m.link);
      mv.linkWrap.hidden = !url;
      if(url) mv.join.href = url;
      else mv.join.removeAttribute('href');
      mv.url.textContent = url;
      mv.notasWrap.hidden = !m.notas;
      mv.notas.textContent = m.notas || '';
      this.viewDlg.showModal();
    }
  }

  function taskChipHtml(t){
    const s = TaskModel.statusOf(t.status);
    const ds = TaskModel.dueState(t);
    const cls = 'cal-chip is-task' + (ds === 'overdue' ? ' is-overdue' : '') + (ds === 'done' ? ' is-done' : '');
    return '<span class="' + cls + '" draggable="true" data-kind="task" data-id="' + esc(t.id) + '" style="--c:' + s.fg + ';--cb:' + s.bg + '" title="' + esc(t.title) + '">' + esc(t.title) + '</span>';
  }

  function meetingChipHtml(m){
    return '<span class="cal-chip is-meeting" draggable="true" data-kind="meeting" data-id="' + esc(m.id) + '" title="' + esc(MeetingModel.timeText(m) + ' · ' + m.title) + '">' +
      (m.start ? '<b>' + esc(m.start) + '</b> ' : '') + '<span translate="no">' + esc(m.title) + '</span></span>';
  }

  function agendaMeetingHtml(m){
    const url = safeUrl(m.link);
    const meta = [platformOf(m.link), m.cliente].filter(Boolean).join(' · ');
    return '<div class="agenda-item is-meeting" data-kind="meeting" data-id="' + esc(m.id) + '">' +
      '<div class="agenda-time">' + esc(MeetingModel.timeText(m)) + '</div>' +
      '<div class="agenda-main"><div class="agenda-title" translate="no">' + esc(m.title) + '</div>' +
      (meta ? '<div class="agenda-meta">' + esc(meta) + '</div>' : '') + '</div>' +
      (url ? '<a class="btn btn-primary btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" data-join="1">Unirse</a>' : '') +
      '</div>';
  }

  function agendaTaskHtml(t){
    const s = TaskModel.statusOf(t.status);
    const ds = TaskModel.dueState(t);
    const label = ds === 'overdue' ? 'Vencida' : (ds === 'done' ? 'Hecha' : 'Vence');
    const meta = [s.label, t.cliente].filter(Boolean).join(' · ');
    return '<div class="agenda-item is-task' + (ds === 'overdue' ? ' is-overdue' : '') + (ds === 'done' ? ' is-done' : '') + '" data-kind="task" data-id="' + esc(t.id) + '">' +
      '<div class="agenda-time"><span class="dot" style="background:' + (ds === 'overdue' ? 'var(--danger)' : s.dot) + '"></span>' + label + '</div>' +
      '<div class="agenda-main"><div class="agenda-title" translate="no">' + esc(t.title) + '</div>' +
      '<div class="agenda-meta">' + esc(meta) + '</div></div>' +
      '</div>';
  }

  Workhub.views.CalendarView = CalendarView;
})();
