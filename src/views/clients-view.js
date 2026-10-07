/* Clientes y contactos.
   - Portada: una rejilla de tarjetas, una por cliente, con lo que hay que saber de un vistazo
     (tareas abiertas y vencidas, avance, próxima reunión y sus personas).
   - Perfil: al abrir un cliente ocupa toda la página, con «‹ Clientes» para volver. Cabecera
     con sus acciones y cuatro pestañas: Resumen, Tareas, Contactos y Reuniones.
   - Diálogo de cliente: crear uno nuevo o editar su nombre y su color (y eliminarlo).
   Las personas de contacto se ven en su propio diálogo (contacts-view.js). */
(function(){
  const {esc, closest, initials, hueFor, iconSpan} = Workhub.utils.html;
  const {fmtDate, parseYmd, todayYmd} = Workhub.utils.dates;
  const TaskModel = Workhub.models.TaskModel;
  const clientColors = Workhub.views.clientColors;
  const svg = (w, d) => '<svg viewBox="0 0 24 24" width="' + w + '" height="' + w + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const EDIT_ICON = svg(15, '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
  const PLUS_ICON = svg(15, '<path d="M12 5v14M5 12h14"/>');
  const BACK_ICON = svg(16, '<path d="M15 18l-6-6 6-6"/>');
  const MAIL_ICON = svg(14, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>');
  const PHONE_ICON = svg(14, '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>');
  const BOARD_ICON = svg(15, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>');
  const USER_ICON = svg(15, '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>');
  const ARROW_ICON = svg(14, '<path d="M7 17L17 7M8 7h9v9"/>');
  const LOCK_ICON = svg(15, '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
  const CHECK_ICON = svg(15, '<path d="M20 6L9 17l-5-5"/>');
  const CAL_ICON = svg(15, '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>');
  const CAL_SMALL = svg(13, '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>');
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
  const lateCount = (e) => (e.openTasks || []).filter(isLate).length;

  /* Filtros de la portada: qué clientes se enseñan. */
  const FILTERS = [
    {id:'all', label:'Todos', test:() => true},
    {id:'open', label:'Con tareas abiertas', test:(e) => !!e.client && e.stats.open > 0},
    {id:'late', label:'Con tareas vencidas', test:(e) => lateCount(e) > 0}
  ];
  const TABS = [
    {id:'overview', label:'Resumen'},
    {id:'tasks', label:'Tareas'},
    {id:'contacts', label:'Contactos'},
    {id:'meetings', label:'Reuniones'}
  ];

  class ClientsView {
    constructor(){
      this.root = $('crm');
      this.home = $('clientsHome');
      this.list = $('clientsList');
      this.detail = $('clientDetail');
      this.stateMsg = $('stateMsgClients');
      this.search = $('searchClients');
      this.btnNewContact = $('btnNewContact');
      this.btnNewClient = $('btnNewClient');
      this.filters = $('crmFilters');
      this.summary = $('crmSummary');
      this.meta = $('clientsMeta');
      /* Diálogo de cliente (nuevo o editar). */
      this.dlg = $('dlgClient');
      this.form = $('formClient');
      this.dlgTitle = $('dlgClientTitle');
      this.fName = $('clName');
      this.fColors = $('clColors');
      this.fPreview = $('clPreview');
      this.btnSave = $('btnSaveClient');
      this.btnDelete = $('btnDeleteClient');
      this.confirmBox = $('clConfirm');
      this.confirmText = $('clConfirmText');
      this.dlgMode = 'new';
      this.dlgHue = null;
      /* Qué se pintó la última vez: al cambiar de cliente o de pestaña, entra con suavidad. */
      this.shown = '';

      $('btnCancelClient').addEventListener('click', () => this.closeDialog());
      this.fName.addEventListener('input', () => this._paintPreview());
      this.fColors.addEventListener('click', (ev) => {
        const btn = closest(ev.target, '[data-hue]');
        if(!btn) return;
        const hue = btn.getAttribute('data-hue');
        this.dlgHue = hue === '' ? null : +hue;
        this._paintColors();
        this._paintPreview();
      });
    }

    /* ---------- Eventos ---------- */

    bindSearch(handler){
      this.search.addEventListener('input', () => handler(this.query()));
    }

    bindNewContact(handler){
      this.btnNewContact.addEventListener('click', () => handler());
    }

    bindNewClient(handler){
      this.btnNewClient.addEventListener('click', () => handler());
    }

    /* handler('all' | 'open' | 'late') */
    bindFilter(handler){
      this.filters.addEventListener('click', (ev) => {
        const btn = closest(ev.target, '[data-filter]');
        if(btn) handler(btn.getAttribute('data-filter'));
      });
    }

    /* Abrir un cliente desde su tarjeta, o «Nuevo cliente» desde la tarjeta de añadir. */
    bindOpen(handler, onNew){
      this.home.addEventListener('click', (ev) => {
        if(closest(ev.target, '[data-action="new-client"]')){ onNew(); return; }
        const card = closest(ev.target, '[data-client]');
        if(card) handler(card.getAttribute('data-client'));
      });
    }

    /* Diálogo de cliente. handlers: {save(nombre, hue|null), remove()} */
    bindDialog(handlers){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = this.fName.value.trim();
        if(!name){ this.fName.focus(); return; }
        handlers.save(name, this.dlgHue);
      });
      this.btnDelete.addEventListener('click', () => { this.confirmBox.hidden = false; this.btnDelete.hidden = true; $('btnConfirmDeleteClient').focus(); });
      $('btnKeepClient').addEventListener('click', () => { this.confirmBox.hidden = true; this.btnDelete.hidden = false; });
      $('btnConfirmDeleteClient').addEventListener('click', () => handlers.remove());
    }

    /* handlers: {back(), tab(id), edit(), addContact(), openContact(id), viewTasks(), viewVault(),
       newTask(), newMeeting(), openTask(id), openMeeting(id)} */
    bindActions(handlers){
      this.detail.addEventListener('click', (ev) => {
        if(closest(ev.target, 'a[href]')) return;
        const btn = closest(ev.target, '[data-action]');
        if(!btn) return;
        switch(btn.getAttribute('data-action')){
          case 'back': handlers.back(); break;
          case 'tab': handlers.tab(btn.getAttribute('data-tab')); break;
          case 'edit-client': handlers.edit(); break;
          case 'add-contact': handlers.addContact(); break;
          case 'open-contact': handlers.openContact(btn.getAttribute('data-id')); break;
          case 'view-tasks': handlers.viewTasks(); break;
          case 'view-vault': handlers.viewVault(); break;
          case 'new-task': handlers.newTask(); break;
          case 'new-meeting': handlers.newMeeting(); break;
          case 'open-task': handlers.openTask(btn.getAttribute('data-id')); break;
          case 'open-meeting': handlers.openMeeting(btn.getAttribute('data-id')); break;
        }
      });
      this.detail.addEventListener('keydown', (ev) => {
        /* Filas y tarjetas que se abren con Enter o espacio: contacto, tarea y reunión. */
        const row = closest(ev.target, '[role="button"][data-action]');
        if(row && ev.target === row && (ev.key === 'Enter' || ev.key === ' ')){
          ev.preventDefault();
          row.click();
        }
      });
    }

    query(){
      return this.search.value.trim().toLowerCase();
    }

    showError(msg){
      Workhub.views.toast.error(msg);
    }

    /* ---------- Diálogo de cliente ---------- */

    /* o: {mode:'new'|'edit', name, hue (color elegido o null si es el automático), colors, tasks} */
    openDialog(o){
      this.dlgMode = o.mode;
      this.dlgColors = o.colors || [];
      this.dlgHue = typeof o.hue === 'number' ? o.hue : null;
      this.dlgTitle.textContent = t(o.mode === 'edit' ? 'Editar cliente' : 'Nuevo cliente');
      this.fName.value = o.name || '';
      this.btnSave.textContent = t(o.mode === 'edit' ? 'Guardar' : 'Crear cliente');
      this.btnDelete.hidden = o.mode !== 'edit';
      this.confirmBox.hidden = true;
      this.confirmText.textContent = o.mode === 'edit'
        ? t('¿Eliminar «{nombre}»?', {nombre:o.name}) + ' ' + (o.tasks ? t('Se borrarán también sus {n} tareas.', {n:o.tasks}) + ' ' : '') + t('Sus contactos, reuniones y contraseñas se conservan.')
        : '';
      this.setDialogBusy('');
      this._paintColors();
      this._paintPreview();
      if(!this.dlg.open) this.dlg.showModal();
      this.fName.focus();
      this.fName.select();
    }

    closeDialog(){
      if(this.dlg.open) this.dlg.close();
    }

    /* Mientras se guarda o se elimina: el botón dice qué pasa y nada se puede pulsar. */
    setDialogBusy(text){
      const busy = !!text;
      this.dlg.classList.toggle('is-busy', busy);
      [this.btnSave, this.btnDelete, $('btnCancelClient'), $('btnKeepClient'), $('btnConfirmDeleteClient'), this.fName].forEach((el) => { el.disabled = busy; });
      if(busy){
        const target = this.confirmBox.hidden ? this.btnSave : $('btnConfirmDeleteClient');
        target.textContent = text;
      } else {
        this.btnSave.textContent = t(this.dlgMode === 'edit' ? 'Guardar' : 'Crear cliente');
        $('btnConfirmDeleteClient').textContent = t('Eliminar cliente');
      }
    }

    _paintColors(){
      const auto = hueFor(this.fName.value.trim() || 'A');
      const swatch = (hue, label, selected, extra) =>
        '<button type="button" class="color-swatch' + (extra || '') + (selected ? ' is-selected' : '') + '" role="radio" aria-checked="' + selected + '" data-hue="' + (hue === null ? '' : hue) + '" style="--h:' + (hue === null ? auto : hue) + '" title="' + esc(t(label)) + '" aria-label="' + esc(t(label)) + '">' + (selected ? CHECK_SMALL : '') + '</button>';
      this.fColors.innerHTML = swatch(null, 'Automático', this.dlgHue === null, ' is-auto') +
        '<span class="color-sep" aria-hidden="true"></span>' +
        this.dlgColors.map((c) => swatch(c.hue, c.name, this.dlgHue === c.hue)).join('');
    }

    /* Cómo se verá el cliente: sus iniciales sobre su color. */
    _paintPreview(){
      const name = this.fName.value.trim();
      this.fPreview.style.setProperty('--h', this.dlgHue === null ? hueFor(name || 'A') : this.dlgHue);
      this.fPreview.textContent = name ? initials(name) : '?';
      const auto = this.fColors.querySelector('.is-auto');
      if(auto) auto.style.setProperty('--h', hueFor(name || 'A'));
    }

    /* ---------- Pintado ---------- */

    /* Los clientes que pasan el filtro elegido. */
    visible(all, filter){
      const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
      return all.filter(active.test);
    }

    /* all: los clientes que encajan con la búsqueda. Cada uno: {id, nombre, client|null,
       contacts[], matches, nameMatch, stats:{total, open}, vaultCount, openTasks[], meetings[], past[]}.
       state: {query, filter, hasAny, open: el cliente abierto (o null), tab} */
    render(all, state){
      const q = state.query;
      if(this.meta){
        const nc = all.filter((e) => e.client).length;
        const np = all.reduce((n, e) => n + e.contacts.length, 0);
        /* Cada cifra en su propio nodo, para que se traduzca por separado. */
        this.meta.innerHTML = state.hasAny ? '<span>' + plural(nc, 'cliente', 'clientes') + '</span> · <span>' + plural(np, 'contacto', 'contactos') + '</span>' : '';
      }
      const open = state.open;
      this.root.classList.toggle('is-profile', !!open);
      this.home.hidden = !!open;
      this.detail.hidden = !open;
      this.filters.parentNode.hidden = !!open || !state.hasAny;

      if(open){
        /* El color del cliente, para todo el perfil (los iconos de las cifras lo usan). */
        this.detail.style.setProperty('--h', open.client ? clientColors.hueOf(open.nombre) : 220);
        this.detail.innerHTML = this._profileHtml(open, state);
        Workhub.views.extensions.fillSlots(this.detail);
        const key = open.id + '/' + state.tab;
        if(this.shown !== key){
          const first = this.shown.split('/')[0] !== open.id;
          this.detail.classList.remove('is-in', 'is-tab');
          void this.detail.offsetWidth;
          this.detail.classList.add(first ? 'is-in' : 'is-tab');
          if(first) window.scrollTo(0, 0);
        }
        this.shown = key;
        return;
      }
      this.shown = '';

      const active = FILTERS.find((f) => f.id === state.filter) || FILTERS[0];
      const entries = all.filter(active.test);
      this.filters.innerHTML = FILTERS.map((f) => {
        const n = all.filter(f.test).length;
        return '<button type="button" class="chip" data-filter="' + f.id + '" aria-pressed="' + (f.id === active.id) + '"' + (n || f.id === active.id ? '' : ' disabled') + '>' +
          esc(t(f.label)) + '<em>' + n + '</em></button>';
      }).join('');
      /* A la derecha, lo que pide atención: tareas abiertas y vencidas de todos los clientes. */
      const openTasks = all.reduce((n, e) => n + (e.client ? e.stats.open : 0), 0);
      const late = all.reduce((n, e) => n + lateCount(e), 0);
      this.summary.innerHTML = '<span class="stat"><b>' + openTasks + '</b> ' + esc(t(openTasks === 1 ? 'abierta' : 'abiertas')) + '</span>' +
        (late ? '<span class="stat is-danger"><b>' + late + '</b> ' + esc(t(late === 1 ? 'vencida' : 'vencidas')) + '</span>' : '');

      if(!state.hasAny){
        this.stateMsg.hidden = true;
        this.list.hidden = false;
        this.list.innerHTML = emptyHtml();
        return;
      }
      if(!entries.length){
        this.list.hidden = true;
        this.stateMsg.hidden = false;
        this.stateMsg.textContent = all.length
          ? t(active.id === 'late' ? 'Ningún cliente con tareas vencidas.' : 'Ningún cliente con tareas abiertas.')
          : 'Ningún cliente ni contacto coincide con «' + this.search.value.trim() + '».';
        return;
      }
      this.stateMsg.hidden = true;
      this.list.hidden = false;
      this.list.innerHTML = entries.map((e) => cardHtml(e, q)).join('') +
        (q || active.id !== 'all' ? '' : '<button type="button" class="cl-card is-add" data-action="new-client">' + PLUS_ICON + '<span>' + esc(t('Nuevo cliente')) + '</span></button>');
    }

    _profileHtml(e, state){
      const q = state.query;
      const orphan = !e.client;
      const hue = orphan ? 0 : clientColors.hueOf(e.nombre);
      const tab = orphan ? 'contacts' : (TABS.some((x) => x.id === state.tab) ? state.tab : 'overview');

      /* Las tareas, por urgencia: vencidas, de hoy, con fecha (la más cercana primero) y sin fecha. */
      const rank = (task) => { const s = TaskModel.dueState(task); return s === 'overdue' ? 0 : (s === 'today' ? 1 : (task.dueDate ? 2 : 3)); };
      const open = orphan ? [] : (e.openTasks || []).slice().sort((a, b) => rank(a) - rank(b) || String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
      const overdue = open.filter(isLate).length;
      const total = e.stats.total || 0, done = Math.max(0, total - (e.stats.open || 0));
      const meetings = orphan ? [] : (e.meetings || []);
      const past = orphan ? [] : (e.past || []);

      const counts = {tasks:open.length, contacts:e.contacts.length, meetings:meetings.length};
      const tabs = orphan ? '' :
        '<nav class="cl-tabs" role="tablist" aria-label="' + esc(t('Secciones del cliente')) + '">' +
        TABS.map((x) => '<button type="button" role="tab" class="cl-tab" data-action="tab" data-tab="' + x.id + '" aria-selected="' + (x.id === tab) + '">' +
          esc(t(x.label)) + (counts[x.id] ? '<em>' + counts[x.id] + '</em>' : '') + '</button>').join('') +
        '</nav>';

      const meta = orphan
        ? '<p class="cl-hero-note">' + esc(t('Contactos cuyo cliente ya no existe. Edítalos para asignarles uno.')) + '</p>'
        : '<p class="cl-hero-meta">' + [sinceText(e.client), e.stats.total ? t(plural(e.stats.total, 'tarea', 'tareas')) + ' ' + t('en total') : t('Sin tareas todavía')].filter(Boolean).map((x) => '<span>' + esc(x) + '</span>').join('') + '</p>';

      const hero =
        '<div class="cl-top"><button type="button" class="cl-back" data-action="back">' + BACK_ICON + '<span>' + esc(t('Clientes')) + '</span></button></div>' +
        '<header class="cl-hero' + (orphan ? ' is-orphan' : '') + '"' + (orphan ? '' : ' style="--h:' + hue + '"') + '>' +
          '<div class="cl-hero-main">' +
            '<span class="avatar is-square' + (orphan ? ' is-lock' : '') + '" aria-hidden="true">' + (orphan ? '?' : esc(initials(e.nombre))) + '</span>' +
            '<div class="cl-hero-text"><h2 translate="no">' + esc(e.nombre) + '</h2>' + meta + '</div>' +
            (orphan ? '' :
              '<div class="cl-hero-actions">' +
                '<button type="button" class="btn btn-primary" data-action="new-task">' + PLUS_ICON + esc(t('Nueva tarea')) + '</button>' +
                '<button type="button" class="btn btn-ghost" data-action="new-meeting">' + CAL_ICON + esc(t('Reunión')) + '</button>' +
                '<button type="button" class="btn btn-ghost" data-action="add-contact">' + USER_ICON + esc(t('Contacto')) + '</button>' +
                '<button type="button" class="btn btn-ghost cl-edit" data-action="edit-client" aria-label="' + esc(t('Editar cliente')) + '" title="' + esc(t('Editar cliente')) + '">' + EDIT_ICON + '<span>' + esc(t('Editar')) + '</span></button>' +
              '</div>') +
          '</div>' + tabs +
        '</header>';

      const sectionHead = (title, count, actions) =>
        '<div class="cl-section-head"><h3>' + esc(t(title)) + (count ? '<em>' + count + '</em>' : '') + '</h3>' +
        (actions ? '<div class="cl-section-actions">' + actions + '</div>' : '') + '</div>';
      const none = (text, action, label) =>
        '<div class="cl-none"><p>' + esc(t(text)) + '</p>' +
        (action ? '<button type="button" class="btn btn-ghost btn-sm" data-action="' + action + '">' + PLUS_ICON + esc(t(label)) + '</button>' : '') + '</div>';
      const link = (action, label, attrs) => '<button type="button" class="cl-link" data-action="' + action + '"' + (attrs || '') + '>' + esc(t(label)) + ARROW_ICON + '</button>';
      /* text: ya traducido. */
      const more = (tabId, text) => '<button type="button" class="cl-link" data-action="tab" data-tab="' + tabId + '">' + esc(text) + '</button>';

      let panel;
      if(tab === 'overview'){
        /* Cifras: solo las que salen de datos que la app ya tiene. Las que llevan a algún sitio son botones. */
        const cell = (icon, label, valueHtml, subHtml, attrs) =>
          '<' + (attrs ? 'button type="button"' + attrs : 'div') + ' class="cl-metric' + (attrs ? ' is-link' : '') + '">' +
          '<span class="cl-metric-ic" aria-hidden="true">' + icon + '</span>' +
          '<span class="cl-metric-text"><small>' + esc(t(label)) + '</small><b>' + valueHtml + '</b>' + (subHtml || '') + '</span>' +
          '</' + (attrs ? 'button' : 'div') + '>';
        const progress = total
          ? '<span class="cl-progress" role="img" aria-label="' + esc(t('{n} de {total} completadas', {n:done, total:total})) + '"><i style="width:' + Math.round(done / total * 100) + '%"></i></span>'
          : '';
        const next = meetings[0];
        const metrics =
          '<div class="cl-metrics">' +
          cell(BOARD_ICON, 'Tareas abiertas', String(e.stats.open || 0), overdue ? '<em class="is-late">' + esc(t(plural(overdue, 'vencida', 'vencidas'))) + '</em>' : '<em>' + esc(t(e.stats.open ? 'Al día' : 'Nada pendiente')) + '</em>', ' data-action="tab" data-tab="tasks"') +
          cell(CHECK_ICON, 'Completadas', done + (total ? '<span>' + esc(t('de {total}', {total:total})) + '</span>' : ''), progress || '<em>' + esc(t('Sin tareas todavía')) + '</em>') +
          cell(CAL_ICON, 'Próxima reunión', '<span class="is-text">' + esc(meetingText(next)) + '</span>', next ? '<em translate="no">' + esc(next.title || '') + '</em>' : '<em>' + esc(t('Nada en la agenda')) + '</em>', ' data-action="tab" data-tab="meetings"') +
          cell(LOCK_ICON, 'Contraseñas', String(e.vaultCount || 0), '<em>' + esc(t(e.vaultCount ? 'Guardadas en el cofre' : 'Ninguna guardada')) + '</em>', ' data-action="view-vault" title="' + esc(t('Ver contraseñas')) + '"') +
          '</div>' +
          '<div class="crm-shortcuts"><div class="ext-slot" data-ext-slot="client.actions" data-ext-context="' + esc(JSON.stringify({clientId:e.id, cliente:e.nombre})) + '" hidden></div></div>';
        const top = open.slice(0, 5);
        panel = metrics +
          '<div class="cl-cols">' +
            '<div class="cl-col">' +
              '<section class="cl-section">' + sectionHead('Lo más urgente', 0, open.length > top.length ? more('tasks', t('Ver las {n}', {n:open.length})) : '') +
                (top.length ? '<div class="cl-rows">' + top.map(taskRowHtml).join('') + '</div>' : none('Sin tareas abiertas.', 'new-task', 'Nueva tarea')) +
              '</section>' +
              '<section class="cl-section">' + sectionHead('Próximas reuniones', 0, meetings.length > 3 ? more('meetings', t('Ver todas')) : '') +
                (meetings.length ? '<div class="cl-rows">' + meetings.slice(0, 3).map((m) => meetingRowHtml(m)).join('') + '</div>' : none('Sin reuniones previstas.', 'new-meeting', 'Nueva reunión')) +
              '</section>' +
            '</div>' +
            '<div class="cl-col">' +
              '<section class="cl-section">' + sectionHead('Personas de contacto', 0, e.contacts.length > 4 ? more('contacts', t('Ver todas')) : '') +
                (e.contacts.length ? '<div class="cl-rows">' + e.contacts.slice(0, 4).map((c) => personRowHtml(c, q)).join('') + '</div>' : none('Aún no hay personas de contacto.', 'add-contact', 'Añadir contacto')) +
              '</section>' +
            '</div>' +
          '</div>';
      } else if(tab === 'tasks'){
        /* Por etapas, en el orden del tablero. */
        const groups = [];
        open.forEach((task) => {
          const st = TaskModel.statusOf(task.status);
          let g = groups.find((x) => x.id === task.status);
          if(!g){ g = {id:task.status, st:st, items:[]}; groups.push(g); }
          g.items.push(task);
        });
        const order = (TaskModel.STATUSES || []).map((s) => s.id);
        groups.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        panel =
          '<section class="cl-section">' + sectionHead('Tareas abiertas', open.length, link('view-tasks', 'Ver en el tablero')) +
          (groups.length
            ? groups.map((g) =>
                '<div class="cl-group"><h4><span class="agenda-ring" style="--st:' + g.st.dot + '"></span>' + esc(g.st.label) + '<em>' + g.items.length + '</em></h4>' +
                '<div class="cl-rows">' + g.items.map(taskRowHtml).join('') + '</div></div>').join('')
            : none('Sin tareas abiertas.', 'new-task', 'Nueva tarea')) +
          (done ? '<p class="cl-foot-note">' + CHECK_ICON + '<span>' + esc(t(plural(done, 'tarea completada', 'tareas completadas'))) + '</span>' + link('view-tasks', 'Verlas en el tablero') + '</p>' : '') +
          '</section>';
      } else if(tab === 'contacts'){
        panel =
          '<section class="cl-section">' + sectionHead('Personas de contacto', e.contacts.length, '') +
          (e.contacts.length || !orphan
            ? '<div class="cl-people">' + e.contacts.map((c) => personCardHtml(c, q)).join('') +
              (orphan ? '' : '<button type="button" class="cl-person is-add" data-action="add-contact">' + PLUS_ICON + '<span>' + esc(t('Añadir contacto')) + '</span></button>') + '</div>'
            : none('No hay contactos sin cliente.')) +
          '</section>';
      } else {
        panel =
          '<section class="cl-section">' + sectionHead('Próximas reuniones', meetings.length, '') +
          (meetings.length ? '<div class="cl-rows">' + meetings.map((m) => meetingRowHtml(m)).join('') + '</div>' : none('Sin reuniones previstas.', 'new-meeting', 'Nueva reunión')) +
          '</section>' +
          (past.length
            ? '<section class="cl-section">' + sectionHead('Anteriores', past.length, '') +
              '<div class="cl-rows is-past">' + past.map((m) => meetingRowHtml(m, true)).join('') + '</div></section>'
            : '');
      }
      return hero + '<div class="cl-panel" role="tabpanel">' + panel + '</div>';
    }
  }

  /* Tarjeta de un cliente en la portada. */
  function cardHtml(e, q){
    const orphan = !e.client;
    const hue = orphan ? 0 : clientColors.hueOf(e.nombre);
    const late = orphan ? 0 : lateCount(e);
    const total = e.stats.total || 0, done = Math.max(0, total - (e.stats.open || 0));
    const next = (e.meetings || [])[0];
    let sub;
    if(q && e.matches && !e.nameMatch) sub = esc(t(plural(e.matches, 'contacto coincide', 'contactos coinciden')));
    else sub = esc(t(e.contacts.length ? plural(e.contacts.length, 'contacto', 'contactos') : 'Sin contactos')) +
      (e.vaultCount ? ' · ' + esc(t(plural(e.vaultCount, 'contraseña', 'contraseñas'))) : '');
    const stack = e.contacts.slice(0, 3).map((c) => '<span class="avatar" style="--h:' + hueFor(c.nombre || '') + '" title="' + esc(c.nombre || '') + '">' + esc(initials(c.nombre)) + '</span>').join('') +
      (e.contacts.length > 3 ? '<span class="avatar is-more">+' + (e.contacts.length - 3) + '</span>' : '');
    const work = orphan
      ? '<p class="cl-card-work is-muted">' + esc(t('Contactos cuyo cliente ya no existe.')) + '</p>'
      : '<p class="cl-card-work' + (e.stats.open ? '' : ' is-muted') + '">' +
          (e.stats.open
            ? '<b>' + e.stats.open + '</b><span>' + esc(t(e.stats.open === 1 ? 'tarea abierta' : 'tareas abiertas')) + '</span>' +
              (late ? '<span class="pill is-late">' + esc(t(plural(late, 'vencida', 'vencidas'))) + '</span>' : '')
            : '<span>' + esc(t(total ? 'Todo al día' : 'Sin tareas todavía')) + '</span>') +
        '</p>' +
        '<span class="cl-progress" aria-hidden="true"><i style="width:' + (total ? Math.round(done / total * 100) : 0) + '%"></i></span>';
    return '<button type="button" class="cl-card' + (orphan ? ' is-orphan' : '') + '" role="listitem" data-client="' + esc(e.id) + '"' + (orphan ? '' : ' style="--h:' + hue + '"') + '>' +
      '<span class="cl-card-head">' +
        '<span class="avatar is-square' + (orphan ? ' is-lock' : '') + '" aria-hidden="true">' + (orphan ? '?' : esc(initials(e.nombre))) + '</span>' +
        '<span class="cl-card-title"><strong translate="no">' + (orphan ? esc(t(e.nombre)) : highlight(e.nombre, q)) + '</strong><small>' + sub + '</small></span>' +
      '</span>' +
      '<span class="cl-card-body">' + work + '</span>' +
      '<span class="cl-card-foot">' +
        '<span class="cl-card-next' + (next ? '' : ' is-muted') + '">' + CAL_SMALL + '<span>' + esc(orphan ? '—' : meetingText(next)) + '</span></span>' +
        '<span class="cl-stack" aria-hidden="true">' + stack + '</span>' +
      '</span>' +
      '</button>';
  }

  /* Sin ningún cliente todavía: qué es esta sección y por dónde se empieza. */
  function emptyHtml(){
    return '<div class="cl-empty">' +
      Workhub.views.sumi.svg({mood:'dormido', size:84}) +
      '<h2>' + esc(t('Aún no hay clientes')) + '</h2>' +
      '<p>' + esc(t('Añade el primero para llevar en un mismo sitio sus tareas, sus personas de contacto, sus reuniones y sus contraseñas.')) + '</p>' +
      '<button type="button" class="btn btn-primary" data-action="new-client">' + PLUS_ICON + esc(t('Nuevo cliente')) + '</button>' +
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
      ? '<span class="due-badge' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : '') + '">' + iconSpan('calendar') + esc(ds === 'today' ? t('Hoy') : fmtDate(task.dueDate)) + (task.dueTime ? '<span class="due-time" translate="no">' + esc(task.dueTime) + '</span>' : '') + '</span>'
      : '';
    return '<div class="cl-row" data-action="open-task" data-id="' + esc(task.id) + '" role="button" tabindex="0">' +
      '<span class="agenda-ring" style="--st:' + st.dot + '" title="' + esc(st.label) + '"></span>' +
      '<span class="cl-row-title" translate="no">' + esc(task._undecryptable ? t('No se puede descifrar') : task.title) + '</span>' +
      '<span class="cl-row-note">' + esc(st.label) + '</span>' + due + '</div>';
  }

  /* Reunión: el día en un bloque, el título y la hora. Abre la reunión. */
  function meetingRowHtml(m, isPast){
    const d = parseYmd(m.date);
    const today = m.date === todayYmd();
    const month = d ? d.toLocaleDateString(Workhub.i18n.locale, {month:'short'}).replace('.', '') : '';
    const when = m.start ? (m.end ? m.start + '–' + m.end : m.start) : t('Sin hora');
    return '<div class="cl-row is-meeting" data-action="open-meeting" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
      '<span class="cl-day' + (today && !isPast ? ' is-today' : '') + '" aria-hidden="true"><b>' + (d ? d.getDate() : '') + '</b><small>' + esc(month) + '</small></span>' +
      '<span class="cl-row-title" translate="no">' + esc(m.title || '') + '</span>' +
      '<span class="cl-row-note">' + esc(today && !isPast ? t('Hoy') : fmtDate(m.date)) + ' · ' + esc(when) + '</span></div>';
  }

  /* Persona de contacto, en una fila (resumen): quién es y cómo escribirle o llamarle. */
  function personRowHtml(c, q){
    const name = c.nombre || t('Sin nombre');
    const phoneHref = String(c.telefono || '').replace(/[^\d+]/g, '');
    const role = c.notas ? String(c.notas).split('\n')[0] : (c.email || c.telefono || '');
    return '<div class="cl-row is-person" data-action="open-contact" data-id="' + esc(c.id) + '" role="button" tabindex="0">' +
      '<span class="avatar" style="--h:' + hueFor(name) + '" aria-hidden="true">' + esc(initials(c.nombre)) + '</span>' +
      '<span class="cl-row-two" translate="no"><strong>' + highlight(name, q) + '</strong>' + (role ? '<small>' + highlight(role, q) + '</small>' : '') + '</span>' +
      (c.email ? '<a class="icon-only cl-quick" href="mailto:' + esc(encodeURI(c.email)) + '" title="' + esc(t('Escribir a {x}', {x:c.email})) + '" aria-label="' + esc(t('Escribir a {x}', {x:c.email})) + '">' + MAIL_ICON + '</a>' : '') +
      (phoneHref ? '<a class="icon-only cl-quick" href="tel:' + esc(phoneHref) + '" title="' + esc(t('Llamar al {x}', {x:c.telefono})) + '" aria-label="' + esc(t('Llamar al {x}', {x:c.telefono})) + '">' + PHONE_ICON + '</a>' : '') +
      '</div>';
  }

  /* Persona de contacto, en tarjeta (pestaña Contactos). */
  function personCardHtml(c, q){
    const name = c.nombre || t('Sin nombre');
    const phoneHref = String(c.telefono || '').replace(/[^\d+]/g, '');
    const email = c.email ? '<a class="cl-person-line" href="mailto:' + esc(encodeURI(c.email)) + '">' + MAIL_ICON + '<span>' + highlight(c.email, q) + '</span></a>' : '';
    const tel = c.telefono
      ? (phoneHref
        ? '<a class="cl-person-line" href="tel:' + esc(phoneHref) + '">' + PHONE_ICON + '<span>' + highlight(c.telefono, q) + '</span></a>'
        : '<span class="cl-person-line">' + PHONE_ICON + '<span>' + highlight(c.telefono, q) + '</span></span>') : '';
    const notas = c.notas ? '<small title="' + esc(c.notas) + '">' + highlight(String(c.notas).split('\n')[0], q) + '</small>' : '';
    return '<div class="cl-person" data-action="open-contact" data-id="' + esc(c.id) + '" tabindex="0" role="button" aria-label="' + esc(t('Ver contacto {x}', {x:name})) + '">' +
      '<span class="avatar" style="--h:' + hueFor(name) + '" aria-hidden="true">' + esc(initials(c.nombre)) + '</span>' +
      '<div class="cl-person-main" translate="no"><strong>' + highlight(name, q) + '</strong>' + notas + '</div>' +
      (email || tel ? '<div class="cl-person-lines">' + email + tel + '</div>' : '<div class="cl-person-lines is-empty">' + esc(t('Sin correo ni teléfono')) + '</div>') +
      '</div>';
  }

  Workhub.views.ClientsView = ClientsView;
})();
