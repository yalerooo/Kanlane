/* Clientes y contactos: lista de clientes a la izquierda y ficha del cliente
   elegido a la derecha. La ficha: cabecera con sus acciones, una franja de cifras y, debajo,
   sus tareas abiertas y próximas reuniones junto a sus personas de contacto. En móvil se ve
   una cosa u otra (la ficha tiene botón para volver a la lista). */
(function(){
  const {esc, closest, initials, hueFor, iconSpan} = Workhub.utils.html;
  const {fmtDate, parseYmd, todayYmd} = Workhub.utils.dates;
  const TaskModel = Workhub.models.TaskModel;
  const clientColors = Workhub.views.clientColors;
  const svg = (w, d) => '<svg viewBox="0 0 24 24" width="' + w + '" height="' + w + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const COLOR_ICON = svg(15, '<path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3.5-4 3.5h-2.2a1.8 1.8 0 0 0-1.3 3.1A1.8 1.8 0 0 1 12 22Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1.2" fill="currentColor"/>');
  const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const EDIT_ICON = svg(15, '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
  const TRASH_ICON = svg(15, '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>');
  const PLUS_ICON = svg(15, '<path d="M12 5v14M5 12h14"/>');
  const BACK_ICON = svg(16, '<path d="M15 18l-6-6 6-6"/>');
  const MAIL_ICON = svg(14, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>');
  const PHONE_ICON = svg(14, '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>');
  const BOARD_ICON = svg(15, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>');
  const USERS_ICON = svg(22, '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>');
  const ARROW_ICON = svg(14, '<path d="M7 17L17 7M8 7h9v9"/>');
  const LOCK_ICON = svg(15, '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
  const CHECK_ICON = svg(15, '<path d="M20 6L9 17l-5-5"/>');
  const CAL_ICON = svg(15, '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>');
  const CHEVRON_ICON = svg(15, '<path d="M9 6l6 6-6 6"/>');
  const $ = (id) => document.getElementById(id);
  const t = (text, params) => Workhub.t(text, params);

  /* Texto escapado con las coincidencias de la búsqueda resaltadas. */
  function highlight(text, q){
    const s = String(text || '');
    if(!q) return esc(s);
    const lower = s.toLowerCase();
    let out = '';
    let i = 0;
    for(;;){
      const at = lower.indexOf(q, i);
      if(at === -1) break;
      out += esc(s.slice(i, at)) + '<mark>' + esc(s.slice(at, at + q.length)) + '</mark>';
      i = at + q.length;
    }
    return out + esc(s.slice(i));
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const isLate = (task) => TaskModel.dueState(task) === 'overdue';

  /* Filtros de la lista: qué clientes se enseñan. */
  const FILTERS = [
    {id:'all', label:'Todos', test:() => true},
    {id:'open', label:'Con tareas', test:(e) => !!e.client && e.stats.open > 0},
    {id:'late', label:'Vencidas', test:(e) => (e.openTasks || []).some(isLate)}
  ];

  class ClientsView {
    constructor(){
      this.root = $('crm');
      this.list = $('clientsList');
      this.detail = $('clientDetail');
      this.stateMsg = $('stateMsgClients');
      this.search = $('searchClients');
      this.formNew = $('formNewClient');
      this.newName = $('newClientName');
      this.btnNewContact = $('btnNewContact');
      this.filters = $('crmFilters');
      this.meta = $('clientsMeta');
      /* Qué cliente se pintó la última vez: al cambiar, la ficha entra con suavidad. */
      this.shownId = null;
    }

    /* ---------- Eventos ---------- */

    bindCreate(handler){
      this.formNew.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = this.newName.value.trim();
        if(!name) return;
        /* Se vacía ya, no al terminar de guardar: así no se pierde lo que
           se empiece a escribir mientras tanto. */
        this.newName.value = '';
        handler(name);
      });
    }

    bindSearch(handler){
      this.search.addEventListener('input', () => handler(this.query()));
    }

    bindNewContact(handler){
      this.btnNewContact.addEventListener('click', () => handler());
    }

    /* handler('all' | 'open' | 'late') */
    bindFilter(handler){
      this.filters.addEventListener('click', (ev) => {
        const btn = closest(ev.target, '[data-filter]');
        if(btn) handler(btn.getAttribute('data-filter'));
      });
    }

    /* Clic o teclado (flechas, Enter) en la lista de clientes. */
    bindSelect(handler){
      this.list.addEventListener('click', (ev) => {
        const item = closest(ev.target, '[data-client]');
        if(item) handler(item.getAttribute('data-client'), true);
      });
      this.list.addEventListener('keydown', (ev) => {
        const items = Array.from(this.list.querySelectorAll('[data-client]'));
        const i = items.indexOf(closest(ev.target, '[data-client]'));
        if(i === -1) return;
        if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
          ev.preventDefault();
          const next = items[Math.max(0, Math.min(items.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
          next.focus();
          handler(next.getAttribute('data-client'), false);
        }
      });
    }

    /* handlers: {edit(), cancel(), save(name), remove(), confirmRemove(), cancelRemove(),
       toggleColor(), color(hue|null), addContact(), openContact(id), viewTasks(), viewVault(),
       newTask(), newMeeting(), openTask(id), openMeeting(id), back()} */
    bindActions(handlers){
      this.detail.addEventListener('click', (ev) => {
        if(closest(ev.target, 'a[href]')) return;
        const btn = closest(ev.target, '[data-action]');
        if(!btn) return;
        switch(btn.getAttribute('data-action')){
          case 'edit-client': handlers.edit(); break;
          case 'cancel-client': handlers.cancel(); break;
          case 'save-client': handlers.save(this._editValue()); break;
          case 'delete': handlers.remove(); break;
          case 'confirm-delete': handlers.confirmRemove(btn); break;
          case 'cancel-delete': handlers.cancelRemove(); break;
          case 'toggle-color': handlers.toggleColor(); break;
          case 'set-color': {
            const hue = btn.getAttribute('data-hue');
            handlers.color(hue === '' ? null : +hue);
            break;
          }
          case 'add-contact': handlers.addContact(); break;
          case 'open-contact': handlers.openContact(btn.getAttribute('data-id')); break;
          case 'view-tasks': handlers.viewTasks(); break;
          case 'view-vault': handlers.viewVault(); break;
          case 'new-task': handlers.newTask(); break;
          case 'new-meeting': handlers.newMeeting(); break;
          case 'open-task': handlers.openTask(btn.getAttribute('data-id')); break;
          case 'open-meeting': handlers.openMeeting(btn.getAttribute('data-id')); break;
          case 'focus-new': this.newName.focus(); break;
          case 'back': handlers.back(); break;
        }
      });
      this.detail.addEventListener('keydown', (ev) => {
        const el = ev.target;
        if(el && el.hasAttribute && el.hasAttribute('data-edit-input')){
          if(ev.key === 'Enter'){ ev.preventDefault(); handlers.save(el.value); }
          if(ev.key === 'Escape'){ ev.preventDefault(); handlers.cancel(); }
          return;
        }
        /* Filas que se abren con Enter o espacio: contacto, tarea y reunión. */
        const row = closest(el, '[role="button"][data-action]');
        if(row && el === row && (ev.key === 'Enter' || ev.key === ' ')){
          ev.preventDefault();
          row.click();
        }
      });
    }

    query(){
      return this.search.value.trim().toLowerCase();
    }

    _editValue(){
      const input = this.detail.querySelector('[data-edit-input]');
      return input ? input.value : '';
    }

    restoreNewName(name){
      if(!this.newName.value) this.newName.value = name;
    }

    showError(msg){
      Workhub.views.toast.error(msg);
    }

    /* Avance de un cambio largo, sin repintar la ficha. */
    setBusyText(text){
      const btn = this.root.querySelector('[data-busy]');
      if(btn) btn.textContent = text;
    }

    /* En móvil: muestra la ficha (true) o la lista (false). */
    showDetailPane(show){
      this.root.classList.toggle('is-detail', !!show);
    }

    focusSelected(){
      const el = this.list.querySelector('[aria-selected="true"]');
      if(el) el.focus();
    }

    /* ---------- Pintado ---------- */

    /* Los clientes que pasan el filtro elegido (el controlador elige entre ellos). */
    visible(all, filter){
      const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
      return all.filter(active.test);
    }

    /* all: [{id, nombre, client|null, contacts[], matches, stats:{total, open}, vaultCount, openTasks[], meetings[]}]
       (los que encajan con la búsqueda).
       state: {selectedId, query, filter, editing, pendingDelete, colorOpen, colors, hasAny} */
    render(all, state){
      const q = state.query;
      const active = FILTERS.find((f) => f.id === state.filter) || FILTERS[0];
      const entries = all.filter(active.test);
      /* En la barra de la vista: cuántos clientes y contactos se están viendo. */
      if(this.meta){
        const nc = all.filter((e) => e.client).length;
        const np = all.reduce((n, e) => n + e.contacts.length, 0);
        /* Cada cifra en su propio nodo, para que se traduzca por separado. */
        this.meta.innerHTML = state.hasAny ? '<span>' + plural(nc, 'cliente', 'clientes') + '</span> · <span>' + plural(np, 'contacto', 'contactos') + '</span>' : '';
      }
      this.filters.hidden = !state.hasAny || !all.length;
      this.filters.innerHTML = FILTERS.map((f) => {
        const n = all.filter(f.test).length;
        return '<button type="button" class="crm-filter" role="radio" aria-checked="' + (f.id === active.id) + '" data-filter="' + f.id + '"' + (n || f.id === active.id ? '' : ' disabled') + '>' +
          '<span>' + esc(t(f.label)) + '</span><em>' + n + '</em></button>';
      }).join('');

      if(!state.hasAny){
        this.list.hidden = true;
        this.stateMsg.hidden = true;
        this.detail.hidden = false;
        this.detail.innerHTML = emptyHtml();
        this.shownId = null;
        return;
      }
      if(!entries.length){
        this.list.hidden = true;
        this.detail.hidden = true;
        this.stateMsg.hidden = false;
        this.stateMsg.textContent = all.length
          ? t(active.id === 'late' ? 'Ningún cliente con tareas vencidas.' : 'Ningún cliente con tareas abiertas.')
          : 'Ningún cliente ni contacto coincide con «' + this.search.value.trim() + '».';
        return;
      }
      this.stateMsg.hidden = true;
      this.list.hidden = false;
      this.list.innerHTML = entries.map((e) => this._itemHtml(e, e.id === state.selectedId, q)).join('');
      const selected = entries.find((e) => e.id === state.selectedId);
      this.detail.hidden = !selected;
      if(selected){
        this.detail.innerHTML = this._detailHtml(selected, state);
        Workhub.views.extensions.fillSlots(this.detail);
        /* Al pasar a otro cliente, su ficha entra con suavidad (no en cada repintado). */
        if(this.shownId !== selected.id){
          this.detail.classList.remove('is-in');
          void this.detail.offsetWidth;
          this.detail.classList.add('is-in');
        }
        this.shownId = selected.id;
      }
      if(state.editing){
        const input = this.detail.querySelector('[data-edit-input]');
        if(input && document.activeElement !== input){ input.focus(); input.select(); }
      }
    }

    _itemHtml(e, selected, q){
      const orphan = !e.client;
      const hue = orphan ? 0 : clientColors.hueOf(e.nombre);
      let meta;
      if(q && e.matches && !e.nameMatch) meta = esc(plural(e.matches, 'contacto coincide', 'contactos coinciden'));
      else meta = '<span>' + (e.contacts.length ? plural(e.contacts.length, 'contacto', 'contactos') : 'Sin contactos') + '</span>' +
        (e.vaultCount ? ' · <span>' + plural(e.vaultCount, 'contraseña', 'contraseñas') + '</span>' : '');
      const late = !orphan && (e.openTasks || []).some(isLate);
      const badge = !orphan && e.stats.open
        ? '<span class="crm-badge' + (late ? ' is-late' : '') + '" title="' + esc(t(plural(e.stats.open, 'tarea abierta', 'tareas abiertas'))) + '">' + e.stats.open + '</span>'
        : '';
      return '<button type="button" class="crm-item' + (orphan ? ' is-orphan' : '') + '" role="option" aria-selected="' + selected + '" tabindex="' + (selected ? '0' : '-1') + '" data-client="' + esc(e.id) + '"' + (orphan ? '' : ' style="--h:' + hue + '"') + '>' +
        '<span class="avatar is-square' + (orphan ? ' is-lock' : '') + '" aria-hidden="true">' + (orphan ? '?' : esc(initials(e.nombre))) + '</span>' +
        '<span class="crm-item-text"><span class="crm-item-name" translate="no">' + (orphan ? esc(e.nombre) : highlight(e.nombre, q)) + '</span>' +
        '<span class="crm-item-meta">' + meta + '</span></span>' + badge +
        '<span class="crm-item-go" aria-hidden="true">' + CHEVRON_ICON + '</span>' +
        '</button>';
    }

    _detailHtml(e, state){
      const q = state.query;
      const orphan = !e.client;
      const hue = orphan ? 0 : clientColors.hueOf(e.nombre);
      const team = document.body.classList.contains('team-project');
      const back = '<button type="button" class="crm-back" data-action="back" aria-label="Volver a la lista de clientes">' + BACK_ICON + '<span>Clientes</span></button>';

      let head;
      if(state.editing && !orphan){
        head = back + '<div class="crm-head is-editing">' +
          '<div class="client-edit-row">' +
          '<input type="text" class="client-edit-input" data-edit-input="1" value="' + esc(e.nombre) + '" maxlength="60" aria-label="Nombre del cliente">' +
          (state.busy
            ? '<button type="button" class="btn btn-primary" data-busy disabled>' + esc(state.busy) + '</button>'
            : '<button type="button" class="btn btn-primary" data-action="save-client">Guardar</button>' +
              '<button type="button" class="btn btn-ghost" data-action="cancel-client">Cancelar</button>') +
          '</div></div>';
      } else {
        const meta = orphan
          ? 'Contactos cuyo cliente ya no existe. Edítalos para asignarles uno.'
          : [sinceText(e.client), e.stats.total ? plural(e.stats.total, 'tarea', 'tareas') + ' en total' : 'Sin tareas todavía'].filter(Boolean).map((x) => '<span>' + esc(x) + '</span>').join('');
        head = back + '<div class="crm-head' + (orphan ? ' is-orphan' : '') + '"' + (orphan ? '' : ' style="--h:' + hue + '"') + '>' +
          (orphan
            ? '<span class="avatar is-square is-lock" aria-hidden="true">?</span>'
            : '<button type="button" class="avatar is-square avatar-btn" data-action="toggle-color" aria-label="Cambiar color de ' + esc(e.nombre) + '" aria-expanded="' + !!state.colorOpen + '" title="Cambiar color">' + esc(initials(e.nombre)) + '</button>') +
          '<div class="crm-title"><h2 translate="no">' + esc(e.nombre) + '</h2><p>' + (orphan ? esc(meta) : meta) + '</p></div>' +
          (orphan ? '' :
            '<div class="crm-head-actions">' +
            '<button type="button" class="btn btn-primary" data-action="new-task">' + PLUS_ICON + 'Nueva tarea</button>' +
            '<button type="button" class="btn btn-ghost" data-action="new-meeting">' + CAL_ICON + 'Reunión</button>' +
            '<span class="crm-head-tools">' +
            '<button type="button" class="icon-only' + (state.colorOpen ? ' is-active' : '') + '" data-action="toggle-color" aria-label="Color" aria-expanded="' + !!state.colorOpen + '" title="Color">' + COLOR_ICON + '</button>' +
            '<button type="button" class="icon-only" data-action="edit-client" aria-label="Renombrar ' + esc(e.nombre) + '" title="Renombrar">' + EDIT_ICON + '</button>' +
            '<button type="button" class="icon-only is-danger" data-action="delete" aria-label="Eliminar ' + esc(e.nombre) + '" title="Eliminar">' + TRASH_ICON + '</button>' +
            '</span></div>') +
          '</div>';
      }

      const color = state.colorOpen && !orphan ? colorPickerHtml(e.client, state.colors) : '';
      const confirm = state.pendingDelete && !orphan
        ? '<div class="crm-confirm" role="alert"><p><strong>¿Eliminar «' + esc(e.nombre) + '»?</strong> ' +
          (e.stats.total ? 'Se borrarán también sus ' + plural(e.stats.total, 'tarea', 'tareas') + '. ' : '') +
          'Sus contactos, reuniones y contraseñas se conservan.</p>' +
          '<div class="crm-confirm-actions">' + (state.busy
            ? '<button type="button" class="btn btn-danger btn-sm" data-busy disabled>' + esc(state.busy) + '</button>'
            : '<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-delete">Cancelar</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-action="confirm-delete">Eliminar cliente</button>') + '</div></div>'
        : '';

      /* Las tareas, por urgencia: vencidas, de hoy, con fecha (la más cercana primero) y sin fecha. */
      const rank = (task) => { const s = TaskModel.dueState(task); return s === 'overdue' ? 0 : (s === 'today' ? 1 : (task.dueDate ? 2 : 3)); };
      const open = orphan ? [] : (e.openTasks || []).slice().sort((a, b) => rank(a) - rank(b) || String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
      const overdue = open.filter(isLate).length;
      const total = e.stats.total || 0, done = Math.max(0, total - (e.stats.open || 0));
      const meetings = orphan ? [] : (e.meetings || []);

      /* Franja de cifras: solo las que salen de datos que la app ya tiene. Las que llevan a su
         sección son botones. */
      const cell = (icon, label, valueHtml, subHtml, action, title) => {
        const inner = '<span class="crm-metric-ic" aria-hidden="true">' + icon + '</span>' +
          '<span class="crm-metric-text"><small>' + esc(t(label)) + '</small><b>' + valueHtml + '</b>' + (subHtml || '') + '</span>' +
          (action ? '<span class="crm-metric-go" aria-hidden="true">' + ARROW_ICON + '</span>' : '');
        return action
          ? '<button type="button" class="crm-metric is-link" data-action="' + action + '" title="' + esc(t(title)) + '">' + inner + '</button>'
          : '<div class="crm-metric">' + inner + '</div>';
      };
      const progress = total
        ? '<span class="crm-progress" role="img" aria-label="' + esc(t('{n} de {total} completadas', {n:done, total:total})) + '"><i style="width:' + Math.round(done / total * 100) + '%"></i></span>'
        : '';
      const next = meetings[0];
      const metrics = orphan ? '' :
        '<div class="crm-metrics' + (team ? ' is-three' : '') + '">' +
        cell(BOARD_ICON, 'Tareas abiertas', String(e.stats.open || 0), overdue ? '<em class="is-late">' + esc(t(plural(overdue, 'vencida', 'vencidas'))) + '</em>' : '<em>' + esc(t(e.stats.open ? 'Al día' : 'Nada pendiente')) + '</em>', 'view-tasks', 'Ver tareas') +
        cell(CHECK_ICON, 'Completadas', done + (total ? '<span>' + esc(t('de {total}', {total:total})) + '</span>' : ''), progress || '<em>' + esc(t('Sin tareas todavía')) + '</em>') +
        cell(CAL_ICON, 'Próxima reunión', '<span class="is-text">' + esc(meetingText(next)) + '</span>', next ? '<em translate="no">' + esc(next.title || '') + '</em>' : '<em>' + esc(t('Nada en la agenda')) + '</em>') +
        (team ? '' : cell(LOCK_ICON, 'Contraseñas', String(e.vaultCount || 0), '<em>' + esc(t(e.vaultCount ? 'Guardadas en el cofre' : 'Ninguna guardada')) + '</em>', 'view-vault', 'Ver contraseñas')) +
        '</div>' +
        '<div class="crm-shortcuts"><div class="ext-slot" data-ext-slot="client.actions" data-ext-context="' + esc(JSON.stringify({clientId:e.id, cliente:e.nombre})) + '" hidden></div></div>';

      const sectionHead = (title, count, actions) =>
        '<div class="crm-section-head"><h3>' + esc(t(title)) + (count ? '<span class="crm-count">' + count + '</span>' : '') + '</h3>' +
        (actions ? '<div class="crm-section-actions">' + actions + '</div>' : '') + '</div>';
      const emptyBox = (text, action, label, icon) =>
        '<div class="crm-none"><p>' + esc(t(text)) + '</p>' +
        (action ? '<button type="button" class="btn btn-ghost btn-sm" data-action="' + action + '">' + icon + esc(t(label)) + '</button>' : '') + '</div>';

      const tasksHtml = orphan ? '' :
        '<section class="crm-section">' +
          sectionHead('Tareas abiertas', open.length, open.length ? '<button type="button" class="crm-link" data-action="view-tasks">' + esc(t('Ver en el tablero')) + ARROW_ICON + '</button>' : '') +
          (open.length
            ? '<div class="crm-rows">' + open.map(taskRowHtml).join('') + '</div>'
            : emptyBox('Sin tareas abiertas.', 'new-task', 'Nueva tarea', PLUS_ICON)) +
        '</section>';

      const meetingsHtml = orphan ? '' :
        '<section class="crm-section">' +
          sectionHead('Próximas reuniones', meetings.length, '') +
          (meetings.length
            ? '<div class="crm-rows">' + meetings.map(meetingRowHtml).join('') + '</div>'
            : emptyBox('Sin reuniones previstas.', 'new-meeting', 'Nueva reunión', PLUS_ICON)) +
        '</section>';

      const people = e.contacts.length
        ? '<div class="people">' + e.contacts.map((c) => personHtml(c, q)).join('') + '</div>'
        : emptyBox(orphan ? 'No hay contactos sin cliente.' : 'Aún no hay personas de contacto para este cliente.', orphan ? '' : 'add-contact', 'Añadir contacto', PLUS_ICON);
      const peopleHtml =
        '<section class="crm-section">' +
          sectionHead('Personas de contacto', e.contacts.length,
            orphan || !e.contacts.length ? '' : '<button type="button" class="icon-only crm-add" data-action="add-contact" aria-label="' + esc(t('Añadir contacto')) + '" title="' + esc(t('Añadir contacto')) + '">' + PLUS_ICON + '</button>') +
          people +
        '</section>';

      const body = orphan
        ? '<div class="crm-body is-single">' + peopleHtml + '</div>'
        : '<div class="crm-body"><div class="crm-main">' + tasksHtml + meetingsHtml + '</div><aside class="crm-side">' + peopleHtml + '</aside></div>';
      return head + color + confirm + metrics + body;
    }
  }

  /* Sin ningún cliente todavía: qué es esta sección y por dónde se empieza. */
  function emptyHtml(){
    return '<div class="crm-empty">' +
      '<span class="crm-empty-ic" aria-hidden="true">' + USERS_ICON + '</span>' +
      '<h2>' + esc(t('Aún no hay clientes')) + '</h2>' +
      '<p>' + esc(t('Añade el primero para llevar en un mismo sitio sus tareas, sus personas de contacto, sus reuniones y sus contraseñas.')) + '</p>' +
      '<button type="button" class="btn btn-primary" data-action="focus-new">' + PLUS_ICON + esc(t('Añadir un cliente')) + '</button>' +
      '</div>';
  }

  /* «Cliente desde marzo de 2025», si se sabe cuándo se creó. */
  function sinceText(client){
    const ts = client && client.createdAt;
    if(!(ts > 100000)) return '';
    return t('Cliente desde {fecha}', {fecha:new Date(ts).toLocaleDateString(Workhub.i18n.locale, {month:'long', year:'numeric'})});
  }

  /* «Hoy, 10:00», «6 oct, 16:30» o «Sin reuniones». */
  function meetingText(m){
    if(!m) return t('Sin reuniones');
    const day = m.date === todayYmd() ? t('Hoy') : fmtDate(m.date);
    return day + (m.start ? ', ' + m.start : '');
  }

  /* Tarea abierta del cliente: anillo de su etapa, título, etapa y fecha. Abre la ficha. */
  function taskRowHtml(task){
    const st = TaskModel.statusOf(task.status);
    const ds = TaskModel.dueState(task);
    const due = task.dueDate
      ? '<span class="due-badge' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : '') + '">' + iconSpan('calendar') + esc(ds === 'today' ? t('Hoy') : fmtDate(task.dueDate)) + '</span>'
      : '';
    return '<div class="crm-row" data-action="open-task" data-id="' + esc(task.id) + '" role="button" tabindex="0">' +
      '<span class="agenda-ring" style="--st:' + st.dot + '" title="' + esc(st.label) + '"></span>' +
      '<span class="crm-row-title" translate="no">' + esc(task._undecryptable ? t('No se puede descifrar') : task.title) + '</span>' +
      '<span class="crm-row-stage">' + esc(st.label) + '</span>' + due + '</div>';
  }

  /* Reunión próxima: el día en un bloque, el título y la hora. Abre la reunión. */
  function meetingRowHtml(m){
    const d = parseYmd(m.date);
    const today = m.date === todayYmd();
    const month = d ? d.toLocaleDateString(Workhub.i18n.locale, {month:'short'}).replace('.', '') : '';
    const when = m.start ? (m.end ? m.start + '–' + m.end : m.start) : t('Sin hora');
    return '<div class="crm-row is-meeting" data-action="open-meeting" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
      '<span class="crm-day' + (today ? ' is-today' : '') + '" aria-hidden="true"><b>' + (d ? d.getDate() : '') + '</b><small>' + esc(month) + '</small></span>' +
      '<span class="crm-row-title" translate="no">' + esc(m.title || '') + '</span>' +
      '<span class="crm-row-stage">' + esc(today ? t('Hoy') : fmtDate(m.date)) + ' · ' + esc(when) + '</span></div>';
  }

  /* Persona de contacto: a quién llamar o escribir, de un vistazo. La tarjeta abre su edición;
     el correo y el teléfono son enlaces. */
  function personHtml(c, q){
    const name = c.nombre || 'Sin nombre';
    const email = c.email
      ? '<a class="person-line" href="mailto:' + esc(encodeURI(c.email)) + '">' + MAIL_ICON + '<span>' + highlight(c.email, q) + '</span></a>' : '';
    const phoneHref = String(c.telefono || '').replace(/[^\d+]/g, '');
    const tel = c.telefono
      ? (phoneHref
        ? '<a class="person-line" href="tel:' + esc(phoneHref) + '">' + PHONE_ICON + '<span>' + highlight(c.telefono, q) + '</span></a>'
        : '<span class="person-line">' + PHONE_ICON + '<span>' + highlight(c.telefono, q) + '</span></span>') : '';
    const notas = c.notas ? '<small title="' + esc(c.notas) + '">' + highlight(String(c.notas).split('\n')[0], q) + '</small>' : '';
    return '<div class="person" data-action="open-contact" data-id="' + esc(c.id) + '" tabindex="0" role="button" aria-label="Editar contacto ' + esc(name) + '">' +
      '<span class="avatar" style="--h:' + hueFor(name) + '" aria-hidden="true">' + esc(initials(c.nombre)) + '</span>' +
      '<div class="person-main" translate="no"><strong>' + highlight(name, q) + '</strong>' + notas + '</div>' +
      '<span class="person-edit" aria-hidden="true">' + EDIT_ICON + '</span>' +
      (email || tel ? '<div class="person-lines">' + email + tel + '</div>' : '') +
      '</div>';
  }

  /* Muestras de color: "Auto" (derivado del nombre) y la paleta fija. */
  function colorPickerHtml(c, colors){
    const custom = typeof c.color === 'number';
    const auto = Workhub.utils.html.hueFor(c.nombre);
    const swatch = (hue, label, selected, extraCls) =>
      '<button type="button" class="color-swatch' + (extraCls || '') + (selected ? ' is-selected' : '') + '" role="radio" aria-checked="' + selected + '" data-action="set-color" data-hue="' + (hue === null ? '' : hue) + '" style="--h:' + (hue === null ? auto : hue) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + (selected ? CHECK_SMALL : '') + '</button>';
    return '<div class="color-picker crm-colors" role="radiogroup" aria-label="Color de ' + esc(c.nombre) + '">' +
      swatch(null, 'Automático', !custom, ' is-auto') +
      '<span class="color-sep" aria-hidden="true"></span>' +
      colors.map((col) => swatch(col.hue, col.name, custom && c.color === col.hue)).join('') +
      '</div>';
  }

  Workhub.views.ClientsView = ClientsView;
})();
