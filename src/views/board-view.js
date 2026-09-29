/* Tablero Kanban de tareas: resumen por estado, columnas y tarjetas.
   Cada columna tiene scroll propio y el tablero ocupa el alto de la ventana,
   así una tarea se puede arrastrar a cualquier posición de cualquier columna. */
(function(){
  const {esc, closest, iconSpan, PLUS_ICON} = Workhub.utils.html;
  const clientColors = Workhub.views.clientColors;
  const {fmtDate} = Workhub.utils.dates;
  const {bindDragAndDrop, consumeDragClick} = Workhub.utils.ui;
  const TaskModel = Workhub.models.TaskModel;

  class BoardView {
    constructor(){
      this.board = document.getElementById('board');
      this.stateMsg = document.getElementById('stateMsg');
      this.summary = document.getElementById('summary');
      this.search = document.getElementById('search');
      this.filterCliente = document.getElementById('filterCliente');
      this.btnNew = document.getElementById('btnNew');
      this.tabs = document.getElementById('boardTabs');

      /* Línea que marca dónde caerá la tarea al soltarla. */
      this.indicator = document.createElement('div');
      this.indicator.className = 'drop-indicator';
      this.dropBeforeId = null;

      window.addEventListener('resize', () => this.fitHeight());

      /* Móvil: el tablero se desliza columna a columna; las pestañas de estado
         llevan a cada una y marcan la que se está viendo. */
      this.tabs.addEventListener('click', (ev) => {
        const tab = closest(ev.target, '[data-goto]');
        if(tab) this.scrollToColumn(tab.getAttribute('data-goto'));
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
      bindDragAndDrop(this.board, {
        itemSelector: '.card',
        targetSelector: '.col',
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
      return {query:this.search.value, cliente:this.filterCliente.value};
    }

    setClientOptions(names){
      Workhub.views.ClientSelect.populateFilter(this.filterCliente, names);
    }

    setMessage(msg){
      this.stateMsg.textContent = msg;
    }

    showError(msg){
      this.stateMsg.hidden = false;
      this.board.hidden = true;
      this.stateMsg.textContent = msg;
    }

    showLoaded(){
      this.stateMsg.hidden = true;
      this.board.hidden = false;
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

    render(tasks){
      /* Resumen compacto de lo que se está viendo (respeta búsqueda y filtro). */
      const open = tasks.filter((t) => !TaskModel.isDone(t));
      const overdue = tasks.filter((t) => TaskModel.dueState(t) === 'overdue').length;
      const today = tasks.filter((t) => TaskModel.dueState(t) === 'today').length;
      this.summary.innerHTML =
        '<span class="stat"><b>' + open.length + '</b>' + (open.length === 1 ? 'abierta' : 'abiertas') + '</span>' +
        (today ? '<span class="stat is-warn"><span class="dot" style="background:var(--st-wait)"></span><b>' + today + '</b>para hoy</span>' : '') +
        (overdue ? '<span class="stat is-danger"><span class="dot" style="background:var(--danger)"></span><b>' + overdue + '</b>' + (overdue === 1 ? 'vencida' : 'vencidas') + '</span>' : '') +
        (tasks.length - open.length ? '<span class="stat"><b>' + (tasks.length - open.length) + '</b>' + (tasks.length - open.length === 1 ? 'completada' : 'completadas') + '</span>' : '');

      /* Conserva el scroll de cada columna al volver a pintar. */
      const scrolls = {};
      this.board.querySelectorAll('.col').forEach((c) => {
        scrolls[c.getAttribute('data-status')] = c.querySelector('.cards').scrollTop;
      });

      const n = TaskModel.STATUS.length;
      this.board.style.setProperty('--cols', n);
      this.board.classList.toggle('is-many', n > 4);
      this.board.innerHTML = TaskModel.STATUS.map((s) => {
        const items = tasks.filter((t) => TaskModel.stageKey(t) === s.key).sort(TaskModel.byOrder);
        const cardsHtml = items.length
          ? items.map(cardHtml).join('')
          : '<div class="empty-col">Sin tareas<br><span>Suelta aquí una tarjeta</span></div>';
        return '<section class="col" data-status="' + s.key + '" style="--st:' + s.dot + '">' +
          '<header class="col-head">' +
            '<span class="name"><span class="dot"></span><span class="col-label" translate="no">' + esc(s.label) + '</span><span class="count">' + items.length + '</span></span>' +
            '<button type="button" class="col-add" data-add-status="' + s.key + '" aria-label="Nueva tarea en ' + esc(s.label) + '" title="Nueva tarea en ' + esc(s.label) + '">' + PLUS_ICON + '</button>' +
          '</header>' +
          '<div class="cards">' + cardsHtml + '</div></section>';
      }).join('');

      this.board.querySelectorAll('.col').forEach((c) => {
        c.querySelector('.cards').scrollTop = scrolls[c.getAttribute('data-status')] || 0;
      });
      this.tabs.innerHTML = TaskModel.STATUS.map((s) => {
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
    const links = (Array.isArray(t.linkedContacts) ? t.linkedContacts.length : 0) + (Array.isArray(t.linkedVault) ? t.linkedVault.length : 0);
    const ext = Workhub.views.extensions ? Workhub.views.extensions.badgesHtml(t.id) : '';
    const meta = [
      t.contacto ? '<span class="contact">' + iconSpan('user') + '<span translate="no">' + esc(t.contacto) + '</span></span>' : '',
      links ? '<span class="links" title="Vínculos">' + iconSpan('clip') + links + '</span>' : '',
      due
    ].join('');
    return '<article class="card" draggable="true" tabindex="0" data-id="' + esc(t.id) + '">' +
      (t.cliente && Workhub.clientsEnabled !== false ? clientColors.chip(t.cliente) : '') +
      '<h3 translate="no">' + esc(t.title) + '</h3>' +
      (t.desc ? '<p translate="no">' + esc(t.desc) + '</p>' : '') +
      (meta ? '<div class="meta">' + meta + '</div>' : '') +
      (ext ? '<div class="ext-badges">' + ext + '</div>' : '') +
      '</article>';
  }

  Workhub.views.BoardView = BoardView;
})();
