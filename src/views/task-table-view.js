/* Vista Tabla de las tareas: una fila por tarea (título, estado, etiquetas, responsable y fecha
   límite) que se edita en la propia celda. Son las mismas tareas que el tablero y la lista, con
   la misma búsqueda y los mismos filtros; aquí además se ordenan por cualquier columna. */
(function(){
  const {esc, closest, PLUS_ICON} = Workhub.utils.html;
  const TaskModel = Workhub.models.TaskModel;
  const OPEN_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>';

  const COLUMNS = [
    {key:'title', label:'Título'},
    {key:'status', label:'Estado'},
    {key:'labels', label:'Etiquetas'},
    {key:'assignee', label:'Responsable', team:true},
    {key:'due', label:'Fecha límite'}
  ];

  const labelsOf = (t) => (Array.isArray(t.labels) ? t.labels : []);

  class TaskTableView {
    constructor(){
      this.root = document.getElementById('taskTable');
      this.status = document.getElementById('tableStatus');
      /* Sin columna elegida: por etapa y, dentro, en el orden del tablero. */
      this.sort = {key:'', dir:1};
      this.tasks = [];
      this.handlers = {};
      /* Menú de etiquetas o de responsables abierto: {id, kind}. */
      this.pop = null;
      this.popEl = document.createElement('div');
      this.popEl.className = 'tt-pop';
      this.popEl.hidden = true;
      this.body = document.createElement('div');
      this.body.className = 'tt-body';
      if(!this.root) return;
      this.root.appendChild(this.body);
      this.root.appendChild(this.popEl);
      this._bind();
    }

    /* handlers: {open(id), create(), title(id, text), status(id, key), labels(id, list),
       assignees(id, uids), due(id, date) → false si la fecha no vale} */
    bind(handlers){ this.handlers = handlers; }

    _bind(){
      const root = this.root;
      root.addEventListener('click', (ev) => {
        const sort = closest(ev.target, 'button[data-sort]');
        if(sort){
          const key = sort.getAttribute('data-sort');
          /* Ascendente, descendente y de vuelta al orden del tablero. */
          if(this.sort.key !== key) this.sort = {key:key, dir:1};
          else if(this.sort.dir === 1) this.sort = {key:key, dir:-1};
          else this.sort = {key:'', dir:1};
          this.render(this.tasks, this.all);
          const again = root.querySelector('button[data-sort="' + key + '"]');
          if(again) again.focus();
          return;
        }
        if(closest(ev.target, '[data-table-add]')){ this.handlers.create(); return; }
        const open = closest(ev.target, 'button[data-open]');
        if(open){ this.handlers.open(open.getAttribute('data-open')); return; }
        const pop = closest(ev.target, 'button[data-pop]');
        if(pop){
          const row = closest(pop, 'tr[data-id]');
          const same = this.pop && this.pop.id === row.getAttribute('data-id') && this.pop.kind === pop.getAttribute('data-pop');
          if(same) this._closePop();
          else this._openPop(row.getAttribute('data-id'), pop.getAttribute('data-pop'));
        }
      });
      /* Título: se guarda al salir del campo o con Intro; Escape lo deja como estaba. */
      root.addEventListener('keydown', (ev) => {
        const input = ev.target;
        if(input.classList && input.classList.contains('tt-title')){
          if(ev.key === 'Enter'){ ev.preventDefault(); input.blur(); }
          else if(ev.key === 'Escape'){ ev.stopPropagation(); ev.preventDefault(); input.value = input.defaultValue; input.blur(); }
        }
        if(ev.key === 'Escape' && this.pop){
          ev.preventDefault();
          ev.stopPropagation();
          this._closePop(true);
        }
      });
      root.addEventListener('change', (ev) => {
        const el = ev.target;
        if(this.popEl.contains(el)){ this._popChange(); return; }
        const row = closest(el, 'tr[data-id]');
        if(!row) return;
        const id = row.getAttribute('data-id');
        if(el.classList.contains('tt-title')){
          const text = el.value.trim();
          /* Una tarea no se queda sin título. */
          if(!text){ el.value = el.defaultValue; return; }
          if(text !== el.defaultValue) this.handlers.title(id, text);
        } else if(el.classList.contains('tt-status')){
          this.handlers.status(id, el.value);
        } else if(el.classList.contains('tt-due')){
          if(this.handlers.due(id, el.value) === false) el.value = el.defaultValue;
        }
      });
      document.addEventListener('pointerdown', (ev) => {
        if(!this.pop || this.popEl.contains(ev.target) || closest(ev.target, 'button[data-pop]')) return;
        this._closePop();
      }, true);
      window.addEventListener('resize', () => this._closePop());
      this.body.addEventListener('scroll', () => this._closePop(), true);
    }

    /* ---------- Menú de etiquetas y de responsables ---------- */

    _openPop(id, kind){
      const t = this.tasks.find((x) => x.id === id);
      if(!t) return;
      this.pop = {id:id, kind:kind};
      const T = Workhub.views.team;
      let items;
      if(kind === 'labels'){
        const catalog = Workhub.views.labels.catalog().map((l) => l.name);
        const mine = labelsOf(t);
        const names = catalog.concat(mine.filter((n) => !catalog.some((c) => c.toLowerCase() === n.toLowerCase())));
        items = names.map((n) => ({value:n, on:mine.some((m) => m.toLowerCase() === n.toLowerCase()), html:Workhub.views.labels.chip(n)}));
      } else {
        const mine = T.assigned(t);
        items = T.members().map((m) => ({value:m.uid, on:mine.indexOf(m.uid) !== -1,
          html:T.avatar(m, 'is-mini') + '<span translate="no">' + esc(m.name) + (m.uid === T.meUid() ? ' (' + esc(Workhub.t('yo')) + ')' : '') + '</span>'}));
      }
      this.popEl.setAttribute('role', 'group');
      this.popEl.setAttribute('aria-label', Workhub.t(kind === 'labels' ? 'Etiquetas' : 'Responsable'));
      this.popEl.innerHTML = items.length
        ? items.map((it) => '<label class="tt-pop-item"><input type="checkbox" value="' + esc(it.value) + '"' + (it.on ? ' checked' : '') + '>' + it.html + '</label>').join('')
        : '<p class="tt-pop-empty">' + esc(Workhub.t(kind === 'labels' ? 'Este proyecto no tiene etiquetas. Créalas desde el formulario de una tarea.' : 'No hay miembros.')) + '</p>';
      this.popEl.hidden = false;
      const btn = this._popButton();
      if(btn){
        btn.setAttribute('aria-expanded', 'true');
        const r = btn.getBoundingClientRect();
        const w = Math.min(260, window.innerWidth - 16);
        this.popEl.style.width = w + 'px';
        this.popEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
        const below = window.innerHeight - r.bottom - 12;
        const h = Math.min(this.popEl.scrollHeight, 280);
        this.popEl.style.maxHeight = '280px';
        this.popEl.style.top = (below >= h || r.top < h ? r.bottom + 4 : r.top - h - 4) + 'px';
      }
      const first = this.popEl.querySelector('input');
      if(first) first.focus();
    }

    _popButton(){
      if(!this.pop) return null;
      const row = Array.from(this.body.querySelectorAll('tr[data-id]')).find((r) => r.getAttribute('data-id') === this.pop.id);
      return row ? row.querySelector('button[data-pop="' + this.pop.kind + '"]') : null;
    }

    _closePop(focus){
      if(!this.pop) return;
      const btn = this._popButton();
      this.pop = null;
      this.popEl.hidden = true;
      this.popEl.innerHTML = '';
      if(btn){
        btn.setAttribute('aria-expanded', 'false');
        if(focus) btn.focus();
      }
    }

    _popChange(){
      if(!this.pop) return;
      const picked = Array.from(this.popEl.querySelectorAll('input:checked')).map((i) => i.value);
      if(this.pop.kind === 'labels') this.handlers.labels(this.pop.id, picked);
      else this.handlers.assignees(this.pop.id, picked);
    }

    /* ---------- Orden ---------- */

    _sorted(tasks){
      const T = Workhub.views.team;
      const stageIndex = {};
      TaskModel.STATUS.forEach((s, i) => { stageIndex[s.key] = i; });
      const byBoard = (a, b) => (stageIndex[TaskModel.stageKey(a)] - stageIndex[TaskModel.stageKey(b)]) || TaskModel.byOrder(a, b);
      const text = (a, b) => String(a).localeCompare(String(b), Workhub.i18n.locale, {sensitivity:'base', numeric:true});
      const key = this.sort.key, dir = this.sort.dir;
      const value = (t) => {
        if(key === 'title') return t.title || '';
        if(key === 'labels') return labelsOf(t).join(' ');
        if(key === 'assignee') return T.assigned(t).map((u) => T.name(u)).join(' ');
        return t.dueDate ? t.dueDate + ' ' + (t.dueTime || '') : '';
      };
      const list = tasks.slice();
      if(!key) return list.sort(byBoard);
      if(key === 'status') return list.sort((a, b) => dir * byBoard(a, b));
      return list.sort((a, b) => {
        const va = value(a), vb = value(b);
        /* Lo vacío siempre al final, en los dos sentidos. */
        if(!va || !vb) return (va ? -1 : vb ? 1 : 0) || byBoard(a, b);
        return dir * text(va, vb) || byBoard(a, b);
      });
    }

    /* ---------- Pintado ---------- */

    /* tasks: las que se ven (búsqueda y filtros ya aplicados); all: todas las del proyecto. */
    render(tasks, all){
      if(!this.root) return;
      this.tasks = tasks;
      this.all = all || tasks;
      const T = Workhub.views.team;
      const canEdit = T.canEdit();
      const cols = COLUMNS.filter((c) => !c.team || T.enabled());
      const focus = this._focusKey();

      if(!tasks.length){
        this._closePop();
        const none = !this.all.length;
        this.body.innerHTML = '<div class="view-empty">' +
          '<b>' + esc(Workhub.t(none ? 'Aún no hay tareas' : 'Ninguna tarea coincide')) + '</b>' +
          '<span>' + esc(Workhub.t(none ? 'Crea la primera y aparecerá aquí, en el tablero y en la lista.' : 'Cambia la búsqueda o quita los filtros para verlas.')) + '</span>' +
          (canEdit && none ? '<button type="button" class="btn btn-primary btn-sm" data-table-add>' + PLUS_ICON + esc(Workhub.t('Añadir tarea')) + '</button>' : '') + '</div>';
        this.status.textContent = '';
        return;
      }

      const head = cols.map((c) => {
        const on = this.sort.key === c.key;
        const aria = on ? (this.sort.dir === 1 ? 'ascending' : 'descending') : 'none';
        return '<th scope="col" class="tt-col-' + c.key + '" aria-sort="' + aria + '"><button type="button" class="tt-sort" data-sort="' + c.key + '">' +
          '<span>' + esc(Workhub.t(c.label)) + '</span><i class="tt-arrow" aria-hidden="true">' + (on ? (this.sort.dir === 1 ? '↑' : '↓') : '') + '</i></button></th>';
      }).join('') + '<th scope="col" class="tt-col-open"><span class="sr-only">' + esc(Workhub.t('Abrir')) + '</span></th>';

      const stageOptions = (current) => TaskModel.STATUS.map((s) => '<option value="' + esc(s.key) + '"' + (s.key === current ? ' selected' : '') + ' translate="no">' + esc(s.label) + '</option>').join('');

      const rows = this._sorted(tasks).map((t) => {
        const locked = !canEdit || t._undecryptable;
        const s = TaskModel.statusOf(t.status);
        const title = t._undecryptable ? Workhub.t('No se puede descifrar') : (t.title || '');
        const ds = TaskModel.dueState(t);
        const labels = labelsOf(t);
        const who = T.enabled() ? T.assigned(t) : [];
        const chips = labels.length ? Workhub.views.labels.chips(labels, 3) : '<span class="tt-none">' + esc(Workhub.t('Sin etiquetas')) + '</span>';
        const people = who.length ? T.stack(who, 3) + '<span class="tt-who" translate="no">' + esc(who.length === 1 ? T.name(who[0]) : '') + '</span>' : '<span class="tt-none">' + esc(Workhub.t('Sin asignar')) + '</span>';
        const cell = {
          title: locked
            ? '<span class="tt-text" translate="no">' + esc(title) + '</span>'
            : '<input type="text" class="tt-title" maxlength="500" value="' + esc(title) + '" aria-label="' + esc(Workhub.t('Título')) + '" translate="no" autocomplete="off">',
          status: '<span class="tt-status-wrap" style="--st:' + s.dot + '"><span class="dot' + (s.done ? ' is-final' : '') + '"></span>' + (locked
            ? '<span translate="no">' + esc(s.label) + '</span>'
            : '<select class="tt-status dd-plain" aria-label="' + esc(Workhub.t('Estado')) + '">' + stageOptions(s.key) + '</select>') + '</span>',
          labels: locked ? '<span class="tt-chips">' + chips + '</span>'
            : '<button type="button" class="tt-cell-btn tt-chips" data-pop="labels" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(Workhub.t('Etiquetas')) + (labels.length ? ': ' + esc(labels.join(', ')) : '') + '">' + chips + '</button>',
          assignee: locked ? '<span class="tt-people">' + people + '</span>'
            : '<button type="button" class="tt-cell-btn tt-people" data-pop="assignees" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(Workhub.t('Responsable')) + '">' + people + '</button>',
          due: locked
            ? (t.dueDate ? '<span class="tt-date-text' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : '') + '">' + esc(Workhub.utils.dates.fmtDate(t.dueDate)) + (t.dueTime ? ' · ' + esc(t.dueTime) : '') + '</span>' : '<span class="tt-none">' + esc(Workhub.t('Sin fecha')) + '</span>')
            : '<input type="date" class="tt-due' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : '') + (t.dueDate ? '' : ' is-empty') + '" value="' + esc(t.dueDate || '') + '" aria-label="' + esc(Workhub.t('Fecha límite')) + '"' + (ds === 'overdue' ? ' title="' + esc(Workhub.t('Vencida')) + '"' : '') + '>'
        };
        return '<tr data-id="' + esc(t.id) + '" class="' + (TaskModel.isDone(t) ? 'is-done' : '') + (t._undecryptable ? ' is-undecryptable' : '') + '">' +
          cols.map((c) => '<td class="tt-col-' + c.key + '" data-col="' + c.key + '">' + cell[c.key] + '</td>').join('') +
          '<td class="tt-col-open"><button type="button" class="icon-only tt-open" data-open="' + esc(t.id) + '" aria-label="' + esc(Workhub.t('Abrir la tarea')) + ': ' + esc(title) + '" title="' + esc(Workhub.t('Abrir la tarea')) + '">' + OPEN_ICON + '</button></td>' +
          '</tr>';
      }).join('');

      this.body.innerHTML = '<div class="tt-scroll"><table class="tt"><caption class="sr-only">' + esc(Workhub.t('Tareas en tabla')) + '</caption>' +
        '<thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (canEdit ? '<button type="button" class="col-new tt-add" data-table-add>' + PLUS_ICON + esc(Workhub.t('Añadir tarea')) + '</button>' : '');
      /* Los valores de partida, para saber qué ha cambiado y poder volver atrás. */
      this.body.querySelectorAll('input.tt-title, input.tt-due').forEach((i) => { i.defaultValue = i.value; });
      this.status.textContent = Workhub.t(tasks.length === 1 ? '1 tarea' : '{n} tareas', {n:tasks.length});
      this._restoreFocus(focus);
      /* El menú abierto sigue a su tarea; si ya no está a la vista, se cierra. */
      if(this.pop){
        const btn = this._popButton();
        if(btn) btn.setAttribute('aria-expanded', 'true');
        else this._closePop();
      }
    }

    /* La tabla se repinta entera con cada cambio: el foco (y lo que se estaba escribiendo) vuelve a su celda. */
    _focusKey(){
      const el = document.activeElement;
      if(!el || !this.body.contains(el)) return null;
      const row = closest(el, 'tr[data-id]');
      const td = closest(el, 'td');
      if(!row || !td) return null;
      const typing = el.classList.contains('tt-title') && el.value !== el.defaultValue;
      return {id:row.getAttribute('data-id'), col:td.className, typed:typing ? el.value : null,
        from:typing ? el.selectionStart : null, to:typing ? el.selectionEnd : null};
    }

    _restoreFocus(key){
      if(!key) return;
      const row = Array.from(this.body.querySelectorAll('tr[data-id]')).find((r) => r.getAttribute('data-id') === key.id);
      const td = row && Array.from(row.children).find((c) => c.className === key.col);
      const el = td && td.querySelector('input, select, button');
      if(!el) return;
      if(key.typed !== null && el.classList.contains('tt-title')){
        el.value = key.typed;
        try{ el.setSelectionRange(key.from, key.to); }catch(e){}
      }
      el.focus({preventScroll:true});
    }
  }

  Workhub.views.TaskTableView = TaskTableView;
})();
