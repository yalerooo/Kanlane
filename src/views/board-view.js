/* Tablero Kanban de tareas: resumen por estado, columnas y tarjetas.
   Cada columna tiene scroll propio y el tablero ocupa el alto de la ventana,
   así una tarea se puede arrastrar a cualquier posición de cualquier columna. */
(function(){
  const {esc, closest, iconSpan, PLUS_ICON} = Workhub.utils.html;
  const clientColors = Workhub.views.clientColors;
  const {fmtDate, ymd} = Workhub.utils.dates;
  const prefs = Workhub.services.preferences;
  /* Tablero, lista, tabla o cronograma: se recuerda en este navegador. La tabla y el cronograma
     los pintan TaskTableView y TaskTimelineView (el controlador decide cuál toca). */
  const MODE_KEY = 'workhub_task_mode';
  const MODES = ['board', 'list', 'table', 'timeline'];
  /* Clientes que se ofrecen como filtro rápido (los que más tareas abiertas tienen). */
  const QUICK_CLIENTS = 5;
  /* Opción «Sin etiqueta» del filtro por etiqueta (un valor que no puede ser el nombre de una). */
  const NO_LABEL = '::none';

  /* Lunes y domingo de la semana en curso, como AAAA-MM-DD. */
  function weekRange(){
    const d = new Date();
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return [ymd(mon), ymd(sun)];
  }
  const {bindDragAndDrop, consumeDragClick} = Workhub.utils.ui;
  const TaskModel = Workhub.models.TaskModel;
  const COL_MIME = 'text/x-workhub-column';
  const isColumnDrag = (ev) => Array.from(ev.dataTransfer.types || []).indexOf(COL_MIME) !== -1;
  const GH_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.38-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.72 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg>';
  const DOTS_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';

  class BoardView {
    constructor(){
      this.board = document.getElementById('board');
      /* Una portada cuya imagen no carga no deja un hueco roto en la tarjeta. */
      this.board.addEventListener('error', (ev) => {
        if(ev.target.classList && ev.target.classList.contains('card-cover')) ev.target.removeAttribute('src');
      }, true);
      this.stateMsg = document.getElementById('stateMsg');
      this.skeleton = document.getElementById('boardSkeleton');
      this.summary = document.getElementById('summary');
      this.search = document.getElementById('search');
      this.filterCliente = document.getElementById('filterCliente');
      this.filterAssignee = document.getElementById('filterAssignee');
      this.filterLabel = document.getElementById('filterLabel');
      this.filterLabelField = document.getElementById('filterLabelField');
      this.filterDue = document.getElementById('filterDue');
      this.filterDone = document.getElementById('filterDone');
      this.btnNew = document.getElementById('btnNew');
      this.tabs = document.getElementById('boardTabs');
      this.keyboardStatus = document.getElementById('boardKeyboardStatus');
      this.wrap = document.getElementById('boardWrap');
      this.list = document.getElementById('taskList');
      this.quick = document.getElementById('quickFilters');
      this.modeSeg = document.getElementById('taskMode');
      this.filterBtn = document.getElementById('btnTaskFilter');
      this.filterPanel = document.getElementById('taskFilterPanel');
      this.filterDot = document.getElementById('taskFilterDot');
      this.filterClear = document.getElementById('btnTaskFilterClear');
      /* Filtro rápido «Vencen esta semana». */
      this.week = false;
      this.mode = prefs.read(MODE_KEY, 'board');
      /* Solo las vistas que esta página ofrece (la demo no trae tabla ni cronograma). */
      if(MODES.indexOf(this.mode) === -1 || !this.modeSeg || !this.modeSeg.querySelector('[data-task-mode="' + this.mode + '"]')) this.mode = 'board';
      this._applyMode();
      this._bindFilterPanel();

      /* Selección de varias tareas (para eliminarlas de una vez): los ids marcados y si el
         tablero está en «modo selección», en el que pulsar una tarea la marca en vez de abrirla. */
      this.selected = new Set();
      this.selecting = false;
      this.anchorId = null;
      this.visibleIds = [];
      this.selectBtn = document.getElementById('btnTaskSelect');
      this.selectBar = document.getElementById('taskSelectBar');
      this.selectCount = document.getElementById('taskSelectCount');
      this.selectDelete = document.getElementById('btnSelectDelete');
      this.selectArchive = document.getElementById('btnSelectArchive');

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
      this.filterLabel.addEventListener('change', handler);
      this.filterDue.addEventListener('change', handler);
      this.filterDone.addEventListener('change', handler);
      const pick = (el, value) => {
        el.value = el.value === value ? '' : value;
        el.dispatchEvent(new Event('change', {bubbles:true}));
      };
      /* Filtros rápidos: cada uno actúa sobre el filtrado real del tablero. */
      if(this.quick) this.quick.addEventListener('click', (ev) => {
        const b = closest(ev.target, '[data-quick]');
        if(!b) return;
        const kind = b.getAttribute('data-quick');
        if(kind === 'all') this.clearFilters();
        else if(kind === 'week'){ this.week = !this.week; handler(); }
        else if(kind === 'mine') pick(this.filterAssignee, 'me');
        else if(kind === 'unassigned') pick(this.filterAssignee, 'none');
        else if(kind === 'client') pick(this.filterCliente, b.getAttribute('data-client'));
      });
      if(this.filterClear) this.filterClear.addEventListener('click', () => { this.clearFilters(); this._toggleFilterPanel(false); });
      /* Tablero o lista. */
      if(this.modeSeg) this.modeSeg.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-task-mode]');
        if(!b) return;
        this.mode = MODES.indexOf(b.getAttribute('data-task-mode')) === -1 ? 'board' : b.getAttribute('data-task-mode');
        prefs.write(MODE_KEY, this.mode);
        /* La selección múltiple es del tablero y de la lista. */
        if(this.mode !== 'board' && this.mode !== 'list') this.setSelecting(false);
        this._applyMode();
        handler();
      });
      this._refilter = handler;
    }

    /* Quita cliente, miembro, etiqueta, fecha, completadas y «esta semana» (la búsqueda escrita se deja). */
    clearFilters(){
      this.week = false;
      let fired = false;
      [this.filterCliente, this.filterAssignee, this.filterLabel, this.filterDue, this.filterDone].forEach((el) => {
        if(!el.value) return;
        el.value = '';
        el.dispatchEvent(new Event('change', {bubbles:true}));
        fired = true;
      });
      if(!fired && this._refilter) this._refilter();
    }

    /* Al cambiar de proyecto. */
    resetQuick(){
      this.week = false;
      /* Las etiquetas son de cada proyecto; la fecha se quita con ellas para empezar sin filtros. */
      this.filterLabel.value = '';
      this.filterDue.value = '';
      this.filterDone.value = '';
      this.setSelecting(false);
    }

    /* ---------- Selección de varias tareas ---------- */

    /* handlers: {remove(ids), archive(ids)}. Se entra en el modo con el botón de la barra o con Ctrl/Cmd + clic
       en una tarea; Mayús + clic marca todas las que hay entre la anterior y esa. */
    bindSelect(handlers){
      if(!this.selectBtn || !this.selectBar) return;
      this.selectReady = true;
      this.selectBtn.addEventListener('click', () => this.setSelecting(!this.selecting));
      document.getElementById('btnSelectCancel').addEventListener('click', () => { this.setSelecting(false); this.selectBtn.focus(); });
      document.getElementById('btnSelectAll').addEventListener('click', () => {
        const all = this.visibleIds.length && this.visibleIds.every((id) => this.selected.has(id));
        this.selected = new Set(all ? [] : this.visibleIds);
        this._paintSelection();
      });
      this.selectDelete.addEventListener('click', () => { if(this.selected.size) handlers.remove(Array.from(this.selected)); });
      if(this.selectArchive) this.selectArchive.addEventListener('click', () => { if(this.selected.size && handlers.archive) handlers.archive(Array.from(this.selected)); });
      document.addEventListener('keydown', (ev) => {
        if(ev.key !== 'Escape' || !this.selecting || document.querySelector('dialog[open], .dd.is-open')) return;
        this.setSelecting(false);
      });
    }

    canSelect(){
      return !!this.selectReady && Workhub.views.team.canEdit() && (this.mode === 'board' || this.mode === 'list');
    }

    setSelecting(on){
      on = !!on && this.canSelect();
      if(!on) this.selected = new Set();
      if(on === this.selecting && !this.selected.size){ this._paintSelection(); return; }
      this.selecting = on;
      this.anchorId = null;
      this._paintSelection();
      this.fitHeight();
    }

    /* Un clic (o Intro) sobre una tarea: ¿es para marcarla? true si se ha tratado como selección. */
    _selectClick(id, ev){
      if(!this.canSelect()) return false;
      const modifier = ev && (ev.ctrlKey || ev.metaKey || (ev.shiftKey && this.selecting));
      if(!this.selecting && !modifier) return false;
      const wasOff = !this.selecting;
      this.selecting = true;
      if(ev && ev.shiftKey && this.anchorId && this.visibleIds.indexOf(this.anchorId) !== -1){
        /* El tramo, en el orden en que se ven. */
        const order = this._domOrder();
        const a = order.indexOf(this.anchorId), b = order.indexOf(id);
        if(a !== -1 && b !== -1) order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => this.selected.add(x));
      }else{
        if(this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.anchorId = id;
      }
      this._paintSelection();
      if(wasOff) this.fitHeight();
      return true;
    }

    /* Los ids de las tareas en el orden de la vista que se está viendo (tablero o lista). */
    _domOrder(){
      const root = this.mode === 'list' && this.list ? this.list : this.board;
      return Array.from(root.querySelectorAll('.card, .tl-row')).map((el) => el.getAttribute('data-id'));
    }

    /* Marca en pantalla lo seleccionado y pone al día la barra. Lo que ya no se ve (se borró, o un
       filtro lo esconde) deja de estar seleccionado: nunca se elimina algo que no está a la vista. */
    _paintSelection(){
      if(!this.selectReady) return;
      const visible = new Set(this.visibleIds);
      Array.from(this.selected).forEach((id) => { if(!visible.has(id)) this.selected.delete(id); });
      if(!this.canSelect()){ this.selecting = false; this.selected = new Set(); }
      const paint = (el) => {
        const on = this.selected.has(el.getAttribute('data-id'));
        el.classList.toggle('is-selected', on);
        if(this.selecting) el.setAttribute('aria-pressed', on ? 'true' : 'false');
        else el.removeAttribute('aria-pressed');
      };
      this.board.querySelectorAll('.card').forEach(paint);
      if(this.list) this.list.querySelectorAll('.tl-row').forEach(paint);
      if(this.wrap) this.wrap.classList.toggle('is-selecting', this.selecting);
      const n = this.selected.size;
      this.selectBar.hidden = !this.selecting;
      this.selectBtn.hidden = !this.canSelect();
      this.selectBtn.setAttribute('aria-pressed', this.selecting ? 'true' : 'false');
      this.selectCount.textContent = n === 0 ? 'Ninguna tarea seleccionada' : n === 1 ? '1 tarea seleccionada' : n + ' tareas seleccionadas';
      this.selectDelete.disabled = !n;
      this.selectDelete.textContent = n > 1 ? 'Eliminar ' + n : 'Eliminar';
      if(this.selectArchive){
        this.selectArchive.disabled = !n;
        this.selectArchive.textContent = n > 1 ? 'Archivar ' + n : 'Archivar';
      }
      const all = this.visibleIds.length > 0 && this.visibleIds.every((id) => this.selected.has(id));
      const allBtn = document.getElementById('btnSelectAll');
      allBtn.textContent = all ? 'Quitar la selección' : 'Seleccionar todas';
      allBtn.disabled = !this.visibleIds.length;
    }

    _applyMode(){
      const list = this.mode === 'list';
      if(this.wrap){
        this.wrap.classList.toggle('is-list', list);
        this.wrap.setAttribute('data-mode', this.mode);
      }
      if(this.modeSeg) this.modeSeg.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-task-mode') === this.mode ? 'true' : 'false');
      });
    }

    /* Panel con los desplegables de cliente y miembro, bajo el botón de filtrar. */
    _toggleFilterPanel(open){
      if(!this.filterPanel) return;
      this.filterPanel.hidden = !open;
      this.filterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    _bindFilterPanel(){
      if(!this.filterBtn || !this.filterPanel) return;
      this.filterBtn.addEventListener('click', () => this._toggleFilterPanel(this.filterPanel.hidden));
      document.addEventListener('click', (ev) => {
        if(this.filterPanel.hidden) return;
        /* El menú de un desplegable vive fuera del panel (capa superior). */
        if(closest(ev.target, '.bar-filter') || closest(ev.target, '.dd-menu')) return;
        this._toggleFilterPanel(false);
      });
      document.addEventListener('keydown', (ev) => {
        if(ev.key !== 'Escape' || this.filterPanel.hidden || document.querySelector('.dd.is-open')) return;
        this._toggleFilterPanel(false);
        this.filterBtn.focus();
      });
    }

    /* «Vencen esta semana»: sin terminar y con fecha entre el lunes y el domingo de esta semana. */
    dueThisWeek(tasks){
      const r = weekRange();
      return tasks.filter((t) => t.dueDate && !TaskModel.isDone(t) && t.dueDate >= r[0] && t.dueDate <= r[1]);
    }

    renderQuick(all){
      if(!this.quick) return;
      const T = Workhub.views.team;
      const cliente = this.filterCliente.value, assignee = this.filterAssignee.value;
      this._syncLabelOptions(all);
      const more = this.filterLabel.value || this.filterDue.value || this.filterDone.value;
      const chip = (kind, label, on, extra) => '<button type="button" class="chip" data-quick="' + kind + '"' + (extra || '') + ' aria-pressed="' + (on ? 'true' : 'false') + '">' + label + '</button>';
      let html = chip('all', esc(Workhub.t('Todas')), !cliente && !assignee && !more && !this.week);
      if(T.enabled()) html += chip('mine', esc(Workhub.t('Asignadas a mí')), assignee === 'me') + chip('unassigned', esc(Workhub.t('Sin asignar')), assignee === 'none');
      html += chip('week', esc(Workhub.t('Vencen esta semana')), this.week);
      if(Workhub.clientsEnabled !== false){
        const open = {};
        all.forEach((t) => { if(t.cliente && !TaskModel.isDone(t)) open[t.cliente] = (open[t.cliente] || 0) + 1; });
        let names = Object.keys(open).sort((a, b) => open[b] - open[a] || a.localeCompare(b)).slice(0, QUICK_CLIENTS);
        if(cliente && cliente !== 'Sin cliente' && names.indexOf(cliente) === -1) names = [cliente].concat(names).slice(0, QUICK_CLIENTS);
        html += names.map((n) => chip('client', '<i class="client-dot" style="--h:' + clientColors.hueOf(n) + '"></i><span translate="no">' + esc(n) + '</span>', cliente === n, ' data-client="' + esc(n) + '"')).join('');
      }
      this.quick.innerHTML = html;
      if(this.filterDot) this.filterDot.hidden = !cliente && !assignee && !more;
    }

    /* Opciones del filtro por etiqueta: las del catálogo del proyecto y las que lleve alguna tarea
       (una copia importada puede traer etiquetas que no están en el catálogo). Solo se repinta si
       cambian; sin etiquetas, el campo no se enseña. */
    _syncLabelOptions(all){
      const seen = {};
      const names = [];
      const add = (name) => {
        const key = String(name || '').toLowerCase();
        if(!key || seen[key]) return;
        seen[key] = true;
        names.push(String(name));
      };
      Workhub.views.labels.catalog().forEach((l) => add(l.name));
      all.forEach((t) => { if(Array.isArray(t.labels)) t.labels.forEach(add); });
      const sig = names.join('\n');
      if(sig !== this._labelSig){
        this._labelSig = sig;
        const current = this.filterLabel.value.toLowerCase();
        this.filterLabel.innerHTML = '<option value="">' + esc(Workhub.t('Todas las etiquetas')) + '</option>' +
          '<option value="' + NO_LABEL + '">' + esc(Workhub.t('Sin etiqueta')) + '</option>' +
          names.map((n) => '<option value="' + esc(n) + '" translate="no">' + esc(n) + '</option>').join('');
        /* Si la etiqueta elegida ya no existe, el filtro se quita (se ve en el tablero al momento). */
        const keep = current === NO_LABEL ? NO_LABEL : names.find((n) => n.toLowerCase() === current);
        this.filterLabel.value = keep || '';
        if(current && !keep && this._refilter) setTimeout(() => this._refilter(), 0);
      }
      if(this.filterLabelField) this.filterLabelField.hidden = !names.length;
    }

    bindOpen(handler){
      if(this.list){
        this.list.addEventListener('click', (ev) => {
          const row = closest(ev.target, '.tl-row');
          if(row && !this._selectClick(row.getAttribute('data-id'), ev)) handler(row.getAttribute('data-id'));
        });
        this.list.addEventListener('keydown', (ev) => {
          const row = closest(ev.target, '.tl-row');
          if(row && (ev.key === 'Enter' || ev.key === ' ')){
            ev.preventDefault();
            if(!this._selectClick(row.getAttribute('data-id'), ev)) handler(row.getAttribute('data-id'));
          }
        });
      }
      this.board.addEventListener('click', (ev) => {
        const card = closest(ev.target, '.card');
        if(!card || consumeDragClick(card)) return;
        if(!this._selectClick(card.getAttribute('data-id'), ev)) handler(card.getAttribute('data-id'));
      });
      this.board.addEventListener('keydown', (ev) => {
        const card = closest(ev.target, '.card');
        /* Alt + flecha mueve la tarea (bindMove): aquí solo Intro y espacio. */
        if(card && !ev.altKey && (ev.key === 'Enter' || ev.key === ' ')){
          ev.preventDefault();
          this.focusCardId = card.getAttribute('data-id');
          if(!this._selectClick(card.getAttribute('data-id'), ev)) handler(card.getAttribute('data-id'));
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
        ghost: true,
        accept: (ev) => !isColumnDrag(ev),
        getPayload: (card) => card.getAttribute('data-id'),
        onOver: (ev, colEl) => this._placeIndicator(colEl, ev.clientY),
        onEnd: () => {
          this.indicator.remove();
          this.dropBeforeId = null;
        },
        onDrop: (id, colEl, ev) => {
          const status = colEl.getAttribute('data-status');
          /* Dónde se soltó: la tarjeta se asienta desde ahí (ver _animateMoves). */
          if(id && ev) this.dropPoint = {id:id, x:ev.clientX, y:ev.clientY, ghost:Workhub.utils.ui.dragGhostRect(), at:Date.now()};
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
      return {query:this.search.value, cliente:this.filterCliente.value, assignee:this.filterAssignee.value, week:this.week,
        label:this.filterLabel.value === NO_LABEL ? '' : this.filterLabel.value, noLabel:this.filterLabel.value === NO_LABEL,
        due:this.filterDue.value, done:this.filterDone.value};
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
      /* Hueco inferior: el relleno exterior de la estructura (o el de .main en móvil). */
      const app = this.board.closest('.app'), main = this.board.closest('.main');
      const pad = (el) => (el ? parseFloat(getComputedStyle(el).paddingBottom) || 0 : 0);
      const bottomSpace = pad(app) + pad(main);
      this.board.style.setProperty('--board-top', Math.round(top + bottomSpace) + 'px');
    }

    /* tasks: las que se ven (respeta búsqueda y filtro); all: todas, para los límites. */
    /* Dónde está cada tarjeta antes de repintar (el tablero se repinta entero). Nada si el
       tablero no se ve o si se pidieron animaciones reducidas. */
    _cardRects(){
      const root = document.documentElement;
      if(!this.board.offsetParent || !this.board.animate) return null;
      if(root.getAttribute('data-motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
      const rects = new Map();
      this.board.querySelectorAll('.card').forEach((card) => {
        const r = card.getBoundingClientRect();
        rects.set(card.getAttribute('data-id'), {left:r.left, top:r.top, col:closest(card, '.col').getAttribute('data-status')});
      });
      return rects.size ? rects : null;
    }

    /* Movimiento de las tarjetas tras repintar:
       - las que solo suben o bajan en su columna se deslizan desde donde estaban;
       - la que cambia de columna llega con un pequeño recorrido desde ese lado (las columnas
         recortan lo que sobresale, así que no cruza el tablero entera);
       - la que se acaba de soltar con el ratón se asienta desde el punto donde se soltó. */
    _animateMoves(before){
      /* El punto de suelta se gasta cuando la tarjeta cambia de sitio de verdad: puede haber
         un repintado intermedio antes de que el modelo refleje el movimiento. */
      if(this.dropPoint && Date.now() - this.dropPoint.at > 1500) this.dropPoint = null;
      const drop = this.dropPoint;
      if(!before) return;
      const clamp = (v, max) => Math.max(-max, Math.min(max, v));
      const moves = [];
      this.board.querySelectorAll('.card').forEach((card) => {
        const id = card.getAttribute('data-id');
        const old = before.get(id);
        if(!old) return;
        const now = card.getBoundingClientRect();
        if(drop && drop.id === id){
          if(Math.abs(old.left - now.left) < 1 && Math.abs(old.top - now.top) < 1) return;
          this.dropPoint = null;
          /* Desde donde estaba la copia que se llevaba bajo el cursor (o, sin ella, desde el cursor). */
          const fromX = drop.ghost ? drop.ghost.left - now.left : drop.x - (now.left + now.width / 2);
          const fromY = drop.ghost ? drop.ghost.top - now.top : drop.y - (now.top + now.height / 2);
          moves.push([card, [
            {transform:'translate(' + clamp(fromX, 80) + 'px,' + clamp(fromY, 160) + 'px) scale(1.03)', boxShadow:'var(--shadow-drag)'},
            {transform:'none'}
          ], 280]);
          return;
        }
        const dx = old.left - now.left, dy = old.top - now.top;
        /* Por columna y no por distancia: si se repinta a mitad de una animación, la tarjeta
           sigue desde donde se ve en ese momento en vez de volver a «llegar». */
        if(old.col !== closest(card, '.col').getAttribute('data-status')){
          moves.push([card, [{transform:'translate(' + clamp(dx, 36) + 'px,' + clamp(dy, 24) + 'px) scale(.97)', opacity:.25}, {transform:'none', opacity:1}], 300]);
        }else if(Math.abs(dy) > 2 || Math.abs(dx) > 2){
          moves.push([card, [{transform:'translate(' + clamp(dx, 60) + 'px,' + clamp(dy, 400) + 'px)'}, {transform:'none'}], 260]);
        }
      });
      /* Un cambio en bloque (filtro, importación, otro proyecto) no se anima. */
      if(!moves.length || moves.length > 40) return;
      moves.forEach(([card, frames, duration]) => card.animate(frames, {duration:duration, easing:'cubic-bezier(.2, .7, .2, 1)'}));
    }

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
        (today ? '<span class="stat is-warn"><b>' + today + '</b>para hoy</span>' : '') +
        (overdue ? '<span class="stat is-danger"><b>' + overdue + '</b>' + (overdue === 1 ? 'vencida' : 'vencidas') + '</span>' : '') +
        (tasks.length - open.length ? '<span class="stat"><b>' + (tasks.length - open.length) + '</b>' + (tasks.length - open.length === 1 ? 'completada' : 'completadas') + '</span>' : '') +
        (hiddenCount ? '<button type="button" class="stat stat-link" data-show-hidden>' + hiddenCount + (hiddenCount === 1 ? ' columna oculta' : ' columnas ocultas') + ' · Mostrar</button>' : '');

      /* Conserva el scroll de cada columna al volver a pintar. */
      const scrolls = {};
      this.board.querySelectorAll('.col').forEach((c) => {
        scrolls[c.getAttribute('data-status')] = c.querySelector('.cards').scrollTop;
      });

      this.renderQuick(all);
      this.renderList(tasks, stages);
      const canEdit = Workhub.views.team.canEdit();
      const n = stages.length;
      this.board.style.setProperty('--cols', n);
      this.board.classList.toggle('is-many', n > 4);
      const before = this._cardRects();
      this.board.innerHTML = stages.map((s, si) => {
        const items = tasks.filter((t) => TaskModel.stageKey(t) === s.key).sort(TaskModel.byOrder);
        const total = all.filter((t) => TaskModel.stageKey(t) === s.key).length;
        const state = s.limit ? (total > s.limit ? ' is-over' : total === s.limit ? ' is-full' : '') : '';
        const countTxt = s.limit ? total + '/' + s.limit : String(items.length);
        const cardsHtml = items.length
          ? items.map(cardHtml).join('')
          : (!all.length && si === 0
            ? '<div class="empty-col is-board-empty">' + Workhub.views.sumi.svg({mood:'dormido', size:64, cls:'is-sleep'}) + '<b>' + esc(Workhub.t('Nada pendiente')) + '</b><span>' + esc(Workhub.t('Crea una tarea para empezar.')) + '</span></div>'
            : '<div class="empty-col">Sin tareas<br><span>Suelta aquí una tarjeta</span></div>');
        return '<section class="col' + state + (s.done ? ' is-final' : '') + '" data-status="' + esc(s.key) + '" style="--st:' + s.dot + '">' +
          '<header class="col-head" draggable="' + (Workhub.views.team.canEdit() ? 'true' : 'false') + '" title="Arrastra para mover la columna">' +
            '<span class="name"><span class="dot"></span><span class="col-label" translate="no">' + esc(s.label) + '</span><span class="count" title="' + (s.limit ? 'Límite: ' + s.limit + ' tarjetas' : '') + '">' + countTxt + '</span></span>' +
            '<span class="col-tools">' +
              '<button type="button" class="col-add" data-add-status="' + esc(s.key) + '" aria-label="Nueva tarea en ' + esc(s.label) + '" title="Nueva tarea en ' + esc(s.label) + '">' + PLUS_ICON + '</button>' +
              '<button type="button" class="col-add" data-col-menu="' + esc(s.key) + '" aria-haspopup="menu" aria-expanded="false" aria-label="Opciones de ' + esc(s.label) + '" title="Opciones de la columna">' + DOTS_ICON + '</button>' +
            '</span>' +
          '</header>' +
          '<div class="cards">' + cardsHtml + '</div>' +
          (si === 0 && canEdit ? '<button type="button" class="col-new" data-add-status="' + esc(s.key) + '">' + PLUS_ICON + Workhub.t('Añadir tarea') + '</button>' : '') +
          '</section>';
      }).join('');

      /* Portadas de imagen: las que aún no tienen su URL la reciben ahora. */
      Workhub.services.platform.hydrateAssetImages(this.board);
      this.board.querySelectorAll('.col').forEach((c) => {
        c.querySelector('.cards').scrollTop = scrolls[c.getAttribute('data-status')] || 0;
      });
      if(this.focusCardId){
        const focused = Array.from(this.board.querySelectorAll('.card')).find((card) => card.getAttribute('data-id') === this.focusCardId);
        if(focused) focused.focus({preventScroll:true});
      }
      this._animateMoves(before);
      this.tabs.innerHTML = stages.map((s) => {
        const count = tasks.filter((t) => TaskModel.stageKey(t) === s.key).length;
        return '<button type="button" class="board-tab' + (s.done ? ' is-final' : '') + '" role="tab" aria-selected="false" data-goto="' + s.key + '" style="--st:' + s.dot + '">' +
          '<span class="dot"></span><span translate="no">' + esc(s.label) + '</span><span class="count">' + count + '</span></button>';
      }).join('');
      this.syncTabs();
      this.visibleIds = tasks.map((t) => t.id);
      this._paintSelection();
      this.fitHeight();
    }
  }

  /* ---- Piezas comunes de la tarjeta y de la fila de la lista ---- */

  /* Fecha límite; con fecha de inicio, el intervalo («05 oct – 12 oct»). Solo inicio: «Desde 05 oct». */
  function dueHtml(t){
    const r = TaskModel.rangeOf(t);
    if(!t.dueDate){
      return r ? '<span class="due-badge" title="' + esc(Workhub.t('Fecha de inicio')) + '">' + iconSpan('calendar') + esc(Workhub.t('Desde {fecha}', {fecha:fmtDate(r.start)})) + '</span>' : '';
    }
    const ds = TaskModel.dueState(t);
    const cls = 'due-badge' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : ds === 'done' ? ' is-done' : '');
    const ranged = r && r.end === t.dueDate && r.start < r.end;
    const end = ds === 'today' ? Workhub.t('Hoy') : fmtDate(t.dueDate);
    const txt = ranged ? fmtDate(r.start) + ' – ' + end : end;
    const title = ds === 'overdue' ? ' title="' + esc(Workhub.t('Vencida')) + '"' : '';
    return '<span class="' + cls + '"' + title + '>' + iconSpan(ds === 'done' ? 'check' : 'calendar') + esc(txt) + (t.dueTime ? '<span class="due-time" translate="no">' + esc(t.dueTime) + '</span>' : '') + '</span>';
  }

  /* Progreso de las subtareas: anillo y «hechas/total». */
  function progressHtml(t){
    const prog = TaskModel.checklistProgress(t);
    if(!prog.total) return '';
    const percent = Math.round(prog.done / prog.total * 100);
    return '<span class="card-progress"><span class="check-progress" role="progressbar" aria-label="Progreso de las subtareas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '">' +
      '<i class="check-ring" style="--p:' + percent + '"></i><span class="check-progress-value">' + prog.done + '/' + prog.total + '</span></span></span>';
  }

  function clientHtml(t){
    if(!t.cliente || Workhub.clientsEnabled === false) return '';
    return '<span class="card-client" translate="no"><i class="client-dot" style="--h:' + clientColors.hueOf(t.cliente) + '"></i><span>' + esc(t.cliente) + '</span></span>';
  }

  /* Etiquetas en texto neutro: las dos primeras y «+N». */
  function tagsHtml(t){
    const list = Array.isArray(t.labels) ? t.labels : [];
    if(!list.length) return '';
    return '<span class="card-tag" translate="no" title="' + esc(list.join(', ')) + '">' + esc(list.slice(0, 2).join(' · ')) + (list.length > 2 ? ' +' + (list.length - 2) : '') + '</span>';
  }

  /* Portada de la tarjeta: una franja de color o una imagen, arriba y de lado a lado. La imagen
     no ocupa sitio hasta que tiene su URL (y si ya no existe, no se ve nada). */
  function coverHtml(t){
    const c = TaskModel.coverOf(t);
    if(!c) return '';
    if(c.color) return '<div class="card-cover" style="--cv:' + Workhub.models.ProjectTemplates.colorOf(c.color).dot + '"></div>';
    const src = Workhub.services.platform.assetUrlNow(c.asset);
    return '<img class="card-cover is-image"' + (src ? ' src="' + esc(src) + '"' : '') + ' data-asset-id="' + esc(c.asset) + '" alt="" draggable="false">';
  }

  function cardHtml(t){
    const T = Workhub.views.team;
    const links = (Array.isArray(t.linkedContacts) ? t.linkedContacts.length : 0) + (Array.isArray(t.linkedVault) ? t.linkedVault.length : 0);
    const ext = Workhub.views.extensions ? Workhub.views.extensions.badgesHtml(t.id) : '';
    const who = T.enabled() ? T.stack(T.assigned(t), 3) : '';
    const top = clientHtml(t) + tagsHtml(t);
    const foot = [
      dueHtml(t),
      progressHtml(t),
      links ? '<span class="links" title="Vínculos">' + iconSpan('clip') + links + '</span>' : '',
      t.repeat ? '<span class="repeat-badge" title="Se repite">' + iconSpan('repeat') + '</span>' : '',
      t.ghItemId ? '<span class="gh-tag" title="GitHub">' + GH_ICON + (t.ghNumber ? '#' + t.ghNumber : '') + '</span>' : '',
      who ? '<span class="card-assignees">' + who + '</span>' : ''
    ].join('');
    const custom = Workhub.views.fields ? Workhub.views.fields.cardHtml(t) : '';
    const contact = t.contacto ? '<div class="card-contact">' + iconSpan('user') + '<span translate="no">' + esc(t.contacto) + '</span></div>' : '';
    return '<article class="card' + (t._undecryptable ? ' is-undecryptable' : '') + (TaskModel.isDone(t) ? ' is-done' : '') + '" draggable="' + (T.canEdit() ? 'true' : 'false') + '" tabindex="0" role="button" aria-describedby="boardKeyboardHelp" data-id="' + esc(t.id) + '">' +
      (t._undecryptable ? '' : coverHtml(t)) +
      (top ? '<div class="card-top">' + top + '</div>' : '') +
      '<h3 translate="no">' + esc(t._undecryptable ? Workhub.t('No se puede descifrar') : t.title) + '</h3>' +
      (t.desc ? '<p translate="no">' + esc(Workhub.utils.markdown.plain(t.desc)) + '</p>' : '') +
      (Array.isArray(t.ghPrs) && t.ghPrs.length ? '<div class="card-prs">' + Workhub.views.labels.prs(t.ghPrs, 4) + '</div>' : '') +
      contact +
      (custom ? '<div class="card-fields">' + custom + '</div>' : '') +
      (foot ? '<div class="card-foot">' + foot + '</div>' : '') +
      (ext ? '<div class="ext-badges">' + ext + '</div>' : '') +
      '</article>';
  }

  /* Fila de la vista de lista: lo mismo que la tarjeta, en una línea. */
  function rowHtml(t){
    const T = Workhub.views.team;
    const who = T.enabled() ? T.stack(T.assigned(t), 3) : '';
    return '<div class="tl-row' + (TaskModel.isDone(t) ? ' is-done' : '') + (t._undecryptable ? ' is-undecryptable' : '') + '" role="button" tabindex="0" data-id="' + esc(t.id) + '">' +
      '<span class="tl-title" translate="no">' + esc(t._undecryptable ? Workhub.t('No se puede descifrar') : t.title) + '</span>' +
      /* Cada dato en su columna (vacía si no lo hay), para que las filas queden alineadas. */
      (clientHtml(t) || '<span class="card-client"></span>') +
      (tagsHtml(t) || '<span class="card-tag"></span>') +
      '<span class="tl-extra">' + progressHtml(t) + (t.repeat ? '<span class="repeat-badge" title="Se repite">' + iconSpan('repeat') + '</span>' : '') + '</span>' +
      (who ? '<span class="card-assignees">' + who + '</span>' : '') +
      '<span class="tl-due">' + dueHtml(t) + '</span>' +
      '</div>';
  }

  /* Las mismas tareas que el tablero, agrupadas por etapa, una por fila. Para moverlas
     entre etapas se usa el tablero o el desplegable de estado de la ficha. */
  BoardView.prototype.renderList = function(tasks, stages){
    if(!this.list) return;
    this.list.innerHTML = stages.map((s) => {
      const items = tasks.filter((t) => TaskModel.stageKey(t) === s.key).sort(TaskModel.byOrder);
      return '<section class="tl-group' + (s.done ? ' is-final' : '') + '" data-status="' + esc(s.key) + '" style="--st:' + s.dot + '">' +
        '<h2 class="tl-head"><span class="dot"></span><span translate="no">' + esc(s.label) + '</span><span class="count">' + items.length + '</span></h2>' +
        (items.length ? '<div class="tl-rows">' + items.map(rowHtml).join('') + '</div>' : '<p class="tl-empty">' + esc(Workhub.t('Sin tareas')) + '</p>') +
        '</section>';
    }).join('');
  };

  Workhub.views.BoardView = BoardView;
})();
