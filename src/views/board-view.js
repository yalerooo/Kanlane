/* Tablero Kanban de tareas: resumen por estado, columnas y tarjetas.
   Cada columna tiene scroll propio y el tablero ocupa el alto de la ventana,
   así una tarea se puede arrastrar a cualquier posición de cualquier columna. */
(function(){
  const {esc, closest, iconSpan, PLUS_ICON} = Workhub.utils.html;
  const clientColors = Workhub.views.clientColors;
  const {fmtDate} = Workhub.utils.dates;
  const {bindDragAndDrop, consumeDragClick} = Workhub.utils.ui;
  const TaskModel = Workhub.models.TaskModel;
  const COL_MIME = 'text/x-workhub-column';
  const isColumnDrag = (ev) => Array.from(ev.dataTransfer.types || []).indexOf(COL_MIME) !== -1;
  const GH_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.38-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.72 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg>';
  const DOTS_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';

  class BoardView {
    constructor(){
      this.board = document.getElementById('board');
      this.stateMsg = document.getElementById('stateMsg');
      this.skeleton = document.getElementById('boardSkeleton');
      this.summary = document.getElementById('summary');
      this.search = document.getElementById('search');
      this.filterCliente = document.getElementById('filterCliente');
      this.filterAssignee = document.getElementById('filterAssignee');
      this.btnNew = document.getElementById('btnNew');
      this.tabs = document.getElementById('boardTabs');
      this.keyboardStatus = document.getElementById('boardKeyboardStatus');

      /* Línea que marca dónde caerá la tarea al soltarla. */
      this.indicator = document.createElement('div');
      this.indicator.className = 'drop-indicator';
      this.dropBeforeId = null;
      /* Claves de las columnas ocultas en este navegador. */
      this.hidden = [];

      window.addEventListener('resize', () => this.fitHeight());

      /* Móvil: el tablero se desliza columna a columna; las pestañas de estado
         llevan a cada una y marcan la que se está viendo. */
      this.tabs.addEventListener('click', (ev) => {
        const tab = closest(ev.target, '[data-goto]');
        if(tab) this.scrollToColumn(tab.getAttribute('data-goto'));
      });
      this.tabs.addEventListener('keydown', (ev) => {
        if(ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        const tabs = Array.from(this.tabs.querySelectorAll('[data-goto]'));
        const i = tabs.indexOf(document.activeElement);
        if(i < 0) return;
        ev.preventDefault();
        const next = tabs[(i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        next.focus();
        this.scrollToColumn(next.getAttribute('data-goto'));
      });
      let raf = 0;
      this.board.addEventListener('scroll', () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => this.syncTabs());
      }, {passive:true});
    }

    scrollToColumn(status){
      const col = this.board.querySelector('.col[data-status="' + status + '"]');
      if(!col) return;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.board.scrollTo({left: col.offsetLeft - this.board.offsetLeft, behavior: reduce ? 'auto' : 'smooth'});
    }

    /* Columna más a la izquierda que se ve entera (o casi). */
    syncTabs(){
      const left = this.board.scrollLeft;
      let active = null;
      let best = Infinity;
      this.board.querySelectorAll('.col').forEach((col) => {
        const d = Math.abs(col.offsetLeft - this.board.offsetLeft - left);
        if(d < best){ best = d; active = col.getAttribute('data-status'); }
      });
      this.tabs.querySelectorAll('[data-goto]').forEach((t) => {
        const on = t.getAttribute('data-goto') === active;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
    }

    bindNew(handler){
      this.btnNew.addEventListener('click', () => handler());
    }

    /* "+" en la cabecera de cada columna: nueva tarea con ese estado. */
    bindQuickAdd(handler){
      this.board.addEventListener('click', (ev) => {
        const btn = closest(ev.target, '[data-add-status]');
        if(btn) handler(btn.getAttribute('data-add-status'));
      });
    }

    bindFilters(handler){
      this.search.addEventListener('input', handler);
      this.filterCliente.addEventListener('change', handler);
      this.filterAssignee.addEventListener('change', handler);
    }

    bindOpen(handler){
      this.board.addEventListener('click', (ev) => {
        const card = closest(ev.target, '.card');
        if(!card || consumeDragClick(card)) return;
        handler(card.getAttribute('data-id'));
      });
      this.board.addEventListener('keydown', (ev) => {
        const card = closest(ev.target, '.card');
        if(card && (ev.key === 'Enter' || ev.key === ' ')){
          ev.preventDefault();
          handler(card.getAttribute('data-id'));
        }
      });
    }

    /* handler(id, status, beforeId) */
    bindMove(handler){
      this.board.addEventListener('keydown', (ev) => {
        if(!ev.altKey || ev.ctrlKey || ev.metaKey || !Workhub.views.team.canEdit()) return;
        if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(ev.key)) return;
        const card = closest(ev.target, '.card');
        if(!card) return;
        const col = closest(card, '.col');
        const cols = Array.from(this.board.querySelectorAll('.col'));
        const cards = Array.from(col.querySelectorAll('.card'));
        const index = cards.indexOf(card);
        const colIndex = cols.indexOf(col);
        const targetCol = ev.key === 'ArrowLeft' ? cols[colIndex - 1] :
          ev.key === 'ArrowRight' ? cols[colIndex + 1] : col;
        if(!targetCol) return;
        let beforeId = null;
        if(ev.key === 'ArrowUp'){
          if(index === 0) return;
          beforeId = cards[index - 1].getAttribute('data-id');
        }else if(ev.key === 'ArrowDown'){
          if(index === cards.length - 1) return;
          beforeId = cards[index + 2] ? cards[index + 2].getAttribute('data-id') : null;
        }
        ev.preventDefault();
        const id = card.getAttribute('data-id');
        const status = targetCol.getAttribute('data-status');
        this.focusCardId = id;
        clearTimeout(this.focusCardTimer);
        this.focusCardTimer = setTimeout(() => { this.focusCardId = null; }, 2000);
        handler(id, status, beforeId);
        this.keyboardStatus.textContent = 'Tarea movida a ' + targetCol.querySelector('.col-label').textContent + '.';
        requestAnimationFrame(() => {
          const moved = Array.from(this.board.querySelectorAll('.card')).find((item) => item.getAttribute('data-id') === id);
          if(moved) moved.focus({preventScroll:true});
        });
      });
      bindDragAndDrop(this.board, {
        itemSelector: '.card',
        targetSelector: '.col',
        accept: (ev) => !isColumnDrag(ev),
        getPayload: (card) => card.getAttribute('data-id'),
        onOver: (ev, colEl) => this._placeIndicator(colEl, ev.clientY),
        onEnd: () => {
          this.indicator.remove();
          this.dropBeforeId = null;
        },
        onDrop: (id, colEl) => {
          const status = colEl.getAttribute('data-status');
          if(id && status) handler(id, status, this.dropBeforeId);
        }
      });
    }

    /* Menú "···" de la cabecera de cada columna: handler(status, botón). */
    bindColumnMenu(handler){
      this.board.addEventListener('click', (ev) => {
        const btn = closest(ev.target, '[data-col-menu]');
        if(btn) handler(btn.getAttribute('data-col-menu'), btn);
      });
    }

    /* "N columnas ocultas · Mostrar" en el resumen. */
    bindShowHidden(handler){
      this.summary.addEventListener('click', (ev) => {
        if(closest(ev.target, '[data-show-hidden]')) handler();
      });
    }

    setHidden(keys){
      this.hidden = keys.slice();
    }

    /* Arrastrar una columna por su cabecera: handler(status, beforeStatus|null). */
    bindColumnMove(handler){
      let dragged = null;
      let target = null;
      let after = false;
      const clear = () => {
        this.board.querySelectorAll('.drop-before, .drop-after, .col-dragging').forEach((c) => c.classList.remove('drop-before', 'drop-after', 'col-dragging'));
        target = null;
      };
      this.board.addEventListener('dragstart', (ev) => {
        const head = closest(ev.target, '.col-head');
        if(!head || closest(ev.target, '.card')) return;
        const col = head.parentNode;
        dragged = col.getAttribute('data-status');
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData(COL_MIME, dragged);
        requestAnimationFrame(() => col.classList.add('col-dragging'));
        Workhub.utils.autoscroll.start();
      });
      this.board.addEventListener('dragover', (ev) => {
        if(!dragged || !isColumnDrag(ev)) return;
        const col = closest(ev.target, '.col');
        if(!col) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        const r = col.getBoundingClientRect();
        after = ev.clientX > r.left + r.width / 2;
        if(target !== col) this.board.querySelectorAll('.drop-before, .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
        target = col;
        col.classList.toggle('drop-before', !after);
        col.classList.toggle('drop-after', after);
      });
      this.board.addEventListener('drop', (ev) => {
        if(!dragged || !isColumnDrag(ev)) return;
        ev.preventDefault();
        const from = dragged;
        let before = null;
        if(target){
          const cols = Array.from(this.board.querySelectorAll('.col'));
          const i = cols.indexOf(target) + (after ? 1 : 0);
          before = cols[i] ? cols[i].getAttribute('data-status') : null;
        }
        clear();
        dragged = null;
        if(before !== from) handler(from, before);
      });
      this.board.addEventListener('dragend', () => {
        if(!dragged) return;
        dragged = null;
        clear();
        Workhub.utils.autoscroll.stop();
      });
    }

    /* Coloca la línea antes de la primera tarjeta cuya mitad queda por debajo del puntero. */
    _placeIndicator(colEl, y){
      const list = colEl.querySelector('.cards');
      const cards = Array.from(list.querySelectorAll('.card:not(.dragging)'));
      const before = cards.find((c) => {
        const r = c.getBoundingClientRect();
        return y < r.top + r.height / 2;
      }) || null;
      this.dropBeforeId = before ? before.getAttribute('data-id') : null;

      let top;
      if(before) top = before.offsetTop - 5;
      else if(cards.length){
        const last = cards[cards.length - 1];
        top = last.offsetTop + last.offsetHeight + 3;
      } else top = 4;
      if(this.indicator.parentNode !== list) list.appendChild(this.indicator);
      this.indicator.style.top = top + 'px';
    }

    filters(){
      return {query:this.search.value, cliente:this.filterCliente.value, assignee:this.filterAssignee.value};
    }

    /* Filtro por miembro (solo en equipos). Sin miembros se vacía y se olvida la elección. */
    setAssigneeOptions(members, meUid){
      const T = Workhub.views.team;
      const current = this.filterAssignee.value;
      const others = members.filter((m) => m.uid !== meUid);
      const opts = members.length
        ? [['', Workhub.t('Todos los miembros')], ['me', Workhub.t('Asignadas a mí')], ['none', Workhub.t('Sin asignar')]]
            .concat(others.map((m) => [m.uid, m.name]))
        : [['', Workhub.t('Todos los miembros')]];
      this.filterAssignee.innerHTML = opts.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('');
      this.filterAssignee.value = opts.some((o) => o[0] === current) ? current : '';
    }

    /* «Mis tareas»: filtra por las asignadas a mí. */
    filterMine(){
      this.filterAssignee.value = 'me';
      this.filterAssignee.dispatchEvent(new Event('change', {bubbles:true}));
    }

    setClientOptions(names){
      Workhub.views.ClientSelect.populateFilter(this.filterCliente, names);
    }

    /* Mensaje en lugar del tablero (no hay almacenamiento, error…). */
    setMessage(msg){
      this.stateMsg.hidden = false;
      this.board.hidden = true;
      this.skeleton.hidden = true;
      this.stateMsg.textContent = msg;
      window.__hideBootSkeleton();
    }

    showError(msg){
      this.setMessage(msg);
    }

    /* Llegaron las tareas: fuera el esqueleto (el de la página y el de las columnas). */
    showLoaded(){
      this.stateMsg.hidden = true;
      this.skeleton.hidden = true;
      this.board.hidden = false;
      window.__hideBootSkeleton();
    }

    /* El tablero llega justo hasta el final de la ventana (sin scroll de página
       sobrante); las columnas hacen scroll por dentro. */
    fitHeight(){
      if(this.board.hidden || !this.board.offsetParent) return;
      const top = this.board.getBoundingClientRect().top + window.scrollY;
      const main = this.board.closest('.main');
      const bottomSpace = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      this.board.style.setProperty('--board-top', Math.round(top + bottomSpace) + 'px');
    }

    /* tasks: las que se ven (respeta búsqueda y filtro); all: todas, para los límites. */
    render(tasks, all){
      all = all || tasks;
      const stages = TaskModel.STATUS.filter((s) => this.hidden.indexOf(s.key) === -1);
      const hiddenCount = TaskModel.STATUS.length - stages.length;
      /* Resumen compacto de lo que se está viendo (respeta búsqueda y filtro). */
      const open = tasks.filter((t) => !TaskModel.isDone(t));
      const overdue = tasks.filter((t) => TaskModel.dueState(t) === 'overdue').length;
      const today = tasks.filter((t) => TaskModel.dueState(t) === 'today').length;
      this.summary.innerHTML =
        '<span class="stat"><b>' + open.length + '</b>' + (open.length === 1 ? 'abierta' : 'abiertas') + '</span>' +
        (today ? '<span class="stat is-warn"><span class="dot" style="background:var(--st-wait)"></span><b>' + today + '</b>para hoy</span>' : '') +
        (overdue ? '<span class="stat is-danger"><span class="dot" style="background:var(--danger)"></span><b>' + overdue + '</b>' + (overdue === 1 ? 'vencida' : 'vencidas') + '</span>' : '') +
        (tasks.length - open.length ? '<span class="stat"><b>' + (tasks.length - open.length) + '</b>' + (tasks.length - open.length === 1 ? 'completada' : 'completadas') + '</span>' : '') +
        (hiddenCount ? '<button type="button" class="stat stat-link" data-show-hidden>' + hiddenCount + (hiddenCount === 1 ? ' columna oculta' : ' columnas ocultas') + ' · Mostrar</button>' : '');

      /* Conserva el scroll de cada columna al volver a pintar. */
      const scrolls = {};
      this.board.querySelectorAll('.col').forEach((c) => {
        scrolls[c.getAttribute('data-status')] = c.querySelector('.cards').scrollTop;
      });

      const n = stages.length;
      this.board.style.setProperty('--cols', n);
      this.board.classList.toggle('is-many', n > 4);
      this.board.innerHTML = stages.map((s) => {
        const items = tasks.filter((t) => TaskModel.stageKey(t) === s.key).sort(TaskModel.byOrder);
        const total = all.filter((t) => TaskModel.stageKey(t) === s.key).length;
        const state = s.limit ? (total > s.limit ? ' is-over' : total === s.limit ? ' is-full' : '') : '';
        const countTxt = s.limit ? total + '/' + s.limit : String(items.length);
        const cardsHtml = items.length
          ? items.map(cardHtml).join('')
          : '<div class="empty-col">Sin tareas<br><span>Suelta aquí una tarjeta</span></div>';
        return '<section class="col' + state + '" data-status="' + esc(s.key) + '" style="--st:' + s.dot + '">' +
          '<header class="col-head" draggable="' + (Workhub.views.team.canEdit() ? 'true' : 'false') + '" title="Arrastra para mover la columna">' +
            '<span class="name"><span class="dot"></span><span class="col-label" translate="no">' + esc(s.label) + '</span><span class="count" title="' + (s.limit ? 'Límite: ' + s.limit + ' tarjetas' : '') + '">' + countTxt + '</span></span>' +
            '<span class="col-tools">' +
              '<button type="button" class="col-add" data-add-status="' + esc(s.key) + '" aria-label="Nueva tarea en ' + esc(s.label) + '" title="Nueva tarea en ' + esc(s.label) + '">' + PLUS_ICON + '</button>' +
              '<button type="button" class="col-add" data-col-menu="' + esc(s.key) + '" aria-haspopup="menu" aria-expanded="false" aria-label="Opciones de ' + esc(s.label) + '" title="Opciones de la columna">' + DOTS_ICON + '</button>' +
            '</span>' +
          '</header>' +
          '<div class="cards">' + cardsHtml + '</div></section>';
      }).join('');

      this.board.querySelectorAll('.col').forEach((c) => {
        c.querySelector('.cards').scrollTop = scrolls[c.getAttribute('data-status')] || 0;
      });
      if(this.focusCardId){
        const focused = Array.from(this.board.querySelectorAll('.card')).find((card) => card.getAttribute('data-id') === this.focusCardId);
        if(focused) focused.focus({preventScroll:true});
      }
      this.tabs.innerHTML = stages.map((s) => {
        const count = tasks.filter((t) => TaskModel.stageKey(t) === s.key).length;
        return '<button type="button" class="board-tab" role="tab" aria-selected="false" data-goto="' + s.key + '" style="--st:' + s.dot + '">' +
          '<span class="dot"></span><span translate="no">' + esc(s.label) + '</span><span class="count">' + count + '</span></button>';
      }).join('');
      this.syncTabs();
      this.fitHeight();
    }
  }

  function cardHtml(t){
    let due = '';
    if(t.dueDate){
      const ds = TaskModel.dueState(t);
      const dueCls = 'due-badge' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : ds === 'done' ? ' is-done' : '');
      const dueTxt = ds === 'overdue' ? 'Vencida · ' + fmtDate(t.dueDate) : (ds === 'today' ? 'Hoy' : fmtDate(t.dueDate));
      due = '<span class="' + dueCls + '">' + iconSpan('calendar') + esc(dueTxt) + '</span>';
    }
    const prog = TaskModel.checklistProgress(t);
    const percent = prog.total ? Math.round(prog.done / prog.total * 100) : 0;
    const check = prog.total ? '<span class="check-progress" role="progressbar" aria-label="Progreso de las subtareas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '"><span class="check-progress-track"><span style="width:' + percent + '%"></span></span><span class="check-progress-value">' + percent + '%</span></span>' : '';
    const repeat = t.repeat ? '<span class="repeat-badge" title="Se repite">' + iconSpan('repeat') + '</span>' : '';
    const links = (Array.isArray(t.linkedContacts) ? t.linkedContacts.length : 0) + (Array.isArray(t.linkedVault) ? t.linkedVault.length : 0);
    const ext = Workhub.views.extensions ? Workhub.views.extensions.badgesHtml(t.id) : '';
    const gh = t.ghItemId ? '<span class="gh-tag" title="GitHub">' + GH_ICON + (t.ghNumber ? '#' + t.ghNumber : '') + '</span>' : '';
    const T = Workhub.views.team;
    const who = T.enabled() ? T.stack(T.assigned(t), 3) : '';
    const meta = [
      gh,
      links ? '<span class="links" title="Vínculos">' + iconSpan('clip') + links + '</span>' : '',
      repeat,
      who ? '<span class="card-assignees">' + who + '</span>' : ''
    ].join('');
    const contact = t.contacto ? '<div class="card-contact">' + iconSpan('user') + '<span translate="no">' + esc(t.contacto) + '</span></div>' : '';
    const bottom = check || due ? '<div class="card-bottom">' + (check ? '<div class="card-progress">' + check + '</div>' : '') + due + '</div>' : '';
    return '<article class="card' + (t._undecryptable ? ' is-undecryptable' : '') + '" draggable="' + (T.canEdit() ? 'true' : 'false') + '" tabindex="0" role="button" aria-describedby="boardKeyboardHelp" data-id="' + esc(t.id) + '">' +
      (t.cliente && Workhub.clientsEnabled !== false ? clientColors.chip(t.cliente) : '') +
      '<h3 translate="no">' + esc(t._undecryptable ? Workhub.t('No se puede descifrar') : t.title) + '</h3>' +
      (t.desc ? '<p translate="no">' + esc(t.desc) + '</p>' : '') +
      (Array.isArray(t.labels) && t.labels.length ? '<div class="card-labels">' + Workhub.views.labels.chips(t.labels, 3) + '</div>' : '') +
      (Array.isArray(t.ghPrs) && t.ghPrs.length ? '<div class="card-prs">' + Workhub.views.labels.prs(t.ghPrs, 4) + '</div>' : '') +
      (meta ? '<div class="meta">' + meta + '</div>' : '') +
      contact +
      bottom +
      (ext ? '<div class="ext-badges">' + ext + '</div>' : '') +
      '</article>';
  }

  Workhub.views.BoardView = BoardView;
})();
