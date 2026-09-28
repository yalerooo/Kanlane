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

      /* Línea que marca dónde caerá la tarea al soltarla. */
      this.indicator = document.createElement('div');
      this.indicator.className = 'drop-indicator';
      this.dropBeforeId = null;

      window.addEventListener('resize', () => this.fitHeight());
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
      const overdueCount = tasks.filter((t) => TaskModel.dueState(t) === 'overdue').length;
      this.summary.innerHTML = TaskModel.STATUS.map((s) => {
        const n = tasks.filter((t) => t.status === s.key).length;
        return '<span class="stat" style="--st:' + s.fg + ';--st-bg:' + s.bg + '"><span class="dot" style="background:' + s.dot + '"></span>' + s.label + '<b>' + n + '</b></span>';
      }).join('') + (overdueCount ? '<span class="stat is-danger"><span class="dot" style="background:var(--danger)"></span>Vencidas<b>' + overdueCount + '</b></span>' : '');

      /* Conserva el scroll de cada columna al volver a pintar. */
      const scrolls = {};
      this.board.querySelectorAll('.col').forEach((c) => {
        scrolls[c.getAttribute('data-status')] = c.querySelector('.cards').scrollTop;
      });

      this.board.innerHTML = TaskModel.STATUS.map((s) => {
        const items = tasks.filter((t) => t.status === s.key).sort(TaskModel.byOrder);
        const cardsHtml = items.length
          ? items.map(cardHtml).join('')
          : '<div class="empty-col">Sin tareas<br><span>Suelta aquí una tarjeta</span></div>';
        return '<section class="col" data-status="' + s.key + '" style="--st:' + s.dot + '">' +
          '<header class="col-head">' +
            '<span class="name"><span class="dot"></span>' + s.label + '<span class="count">' + items.length + '</span></span>' +
            '<button type="button" class="col-add" data-add-status="' + s.key + '" aria-label="Nueva tarea en ' + esc(s.label) + '" title="Nueva tarea en ' + esc(s.label) + '">' + PLUS_ICON + '</button>' +
          '</header>' +
          '<div class="cards">' + cardsHtml + '</div></section>';
      }).join('');

      this.board.querySelectorAll('.col').forEach((c) => {
        c.querySelector('.cards').scrollTop = scrolls[c.getAttribute('data-status')] || 0;
      });
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
    const meta = [
      t.contacto ? '<span class="contact">' + iconSpan('user') + '<span>' + esc(t.contacto) + '</span></span>' : '',
      links ? '<span class="links" title="Vínculos">' + iconSpan('clip') + links + '</span>' : '',
      due
    ].join('');
    return '<article class="card" draggable="true" tabindex="0" data-id="' + esc(t.id) + '">' +
      (t.cliente ? clientColors.chip(t.cliente) : '') +
      '<h3>' + esc(t.title) + '</h3>' +
      (t.desc ? '<p>' + esc(t.desc) + '</p>' : '') +
      (meta ? '<div class="meta">' + meta + '</div>' : '') +
      '</article>';
  }

  Workhub.views.BoardView = BoardView;
})();
