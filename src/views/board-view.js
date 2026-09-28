/* Tablero Kanban de tareas: resumen por estado, columnas y tarjetas. */
(function(){
  const {esc, closest} = Workhub.utils.html;
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
    }

    bindNew(handler){
      this.btnNew.addEventListener('click', handler);
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
    }

    bindMove(handler){
      bindDragAndDrop(this.board, {
        itemSelector: '.card',
        targetSelector: '.col',
        getPayload: (card) => card.getAttribute('data-id'),
        onDrop: (id, colEl) => {
          const status = colEl.getAttribute('data-status');
          if(id && status) handler(id, status);
        }
      });
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

    render(tasks){
      const overdueCount = tasks.filter((t) => TaskModel.dueState(t) === 'overdue').length;
      this.summary.innerHTML = TaskModel.STATUS.map((s) => {
        const n = tasks.filter((t) => t.status === s.key).length;
        return '<span class="pill" style="background:' + s.bg + ';color:' + s.fg + '">' + s.label + ' · ' + n + '</span>';
      }).join('') + (overdueCount ? '<span class="pill" style="background:var(--danger-bg);color:var(--danger)">Vencidas · ' + overdueCount + '</span>' : '');

      this.board.innerHTML = TaskModel.STATUS.map((s) => {
        const items = tasks.filter((t) => t.status === s.key)
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const cardsHtml = items.length
          ? items.map(cardHtml).join('')
          : '<div class="empty-col">Sin tareas — suelta aquí una tarjeta</div>';
        return '<div class="col" data-status="' + s.key + '">' +
          '<div class="col-head"><span class="name"><span class="dot" style="background:' + s.dot + '"></span>' + s.label + '</span>' +
          '<span class="count">' + items.length + '</span></div>' +
          '<div class="cards">' + cardsHtml + '</div></div>';
      }).join('');
    }
  }

  function cardHtml(t){
    let due = '';
    if(t.dueDate){
      const ds = TaskModel.dueState(t);
      const dueCls = ds === 'overdue' ? 'due-badge is-overdue' : (ds === 'today' ? 'due-badge is-today' : 'due-badge');
      const dueTxt = ds === 'overdue' ? 'Vencida · ' + fmtDate(t.dueDate) : (ds === 'today' ? 'Vence hoy' : 'Vence ' + fmtDate(t.dueDate));
      due = '<span class="' + dueCls + '">' + esc(dueTxt) + '</span>';
    }
    const contact = t.contacto ? '<span class="contact">' + esc(t.contacto) + '</span>' : '<span></span>';
    return '<div class="card" draggable="true" data-id="' + esc(t.id) + '">' +
      (t.cliente ? '<div class="cat">' + esc(t.cliente) + '</div>' : '') +
      '<h3>' + esc(t.title) + '</h3>' +
      (t.desc ? '<p>' + esc(t.desc) + '</p>' : '') +
      '<div class="meta">' + contact + due + '</div>' +
      '</div>';
  }

  Workhub.views.BoardView = BoardView;
})();
