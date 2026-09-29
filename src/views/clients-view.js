/* Clientes y contactos: lista de clientes a la izquierda y ficha del cliente
   elegido a la derecha, con sus personas de contacto. En móvil se ve una cosa
   u otra (la ficha tiene botón para volver a la lista). */
(function(){
  const {esc, closest, initials, hueFor} = Workhub.utils.html;
  const clientColors = Workhub.views.clientColors;
  const svg = (w, d) => '<svg viewBox="0 0 24 24" width="' + w + '" height="' + w + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const COLOR_ICON = svg(15, '<path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 3.5-4 3.5h-2.2a1.8 1.8 0 0 0-1.3 3.1A1.8 1.8 0 0 1 12 22Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1.2" fill="currentColor"/>');
  const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const EDIT_ICON = svg(15, '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
  const TRASH_ICON = svg(15, '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>');
  const PLUS_ICON = svg(15, '<path d="M12 5v14M5 12h14"/>');
  const BACK_ICON = svg(16, '<path d="M15 18l-6-6 6-6"/>');
  const MAIL_ICON = svg(13, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>');
  const PHONE_ICON = svg(13, '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>');
  const BOARD_ICON = svg(15, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>');
  const LOCK_ICON = svg(15, '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
  const $ = (id) => document.getElementById(id);

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
       toggleColor(), color(hue|null), addContact(), openContact(id), viewTasks(), viewVault(), back()} */
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
          case 'back': handlers.back(); break;
        }
      });
      this.detail.addEventListener('keydown', (ev) => {
        const t = ev.target;
        if(t && t.hasAttribute && t.hasAttribute('data-edit-input')){
          if(ev.key === 'Enter'){ ev.preventDefault(); handlers.save(t.value); }
          if(ev.key === 'Escape'){ ev.preventDefault(); handlers.cancel(); }
          return;
        }
        const row = closest(t, '.person[data-action="open-contact"]');
        if(row && t === row && ev.key === 'Enter') handlers.openContact(row.getAttribute('data-id'));
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

    setDeleting(btn){
      btn.disabled = true;
      btn.textContent = 'Eliminando…';
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

    /* entries: [{id, nombre, client|null, contacts[], matches, stats:{total, open}, vaultCount}]
       state: {selectedId, query, editing, pendingDelete, colorOpen, colors, hasAny} */
    render(entries, state){
      const q = state.query;
      if(!state.hasAny){
        this.list.hidden = true;
        this.detail.hidden = true;
        this.stateMsg.hidden = false;
        this.stateMsg.textContent = 'Sin clientes todavía. Añade el primero arriba.';
        return;
      }
      if(!entries.length){
        this.list.hidden = true;
        this.detail.hidden = true;
        this.stateMsg.hidden = false;
        this.stateMsg.textContent = 'Ningún cliente ni contacto coincide con «' + this.search.value.trim() + '».';
        return;
      }
      this.stateMsg.hidden = true;
      this.list.hidden = false;
      this.list.innerHTML = entries.map((e) => this._itemHtml(e, e.id === state.selectedId, q)).join('');
      const selected = entries.find((e) => e.id === state.selectedId);
      this.detail.hidden = !selected;
      if(selected) this.detail.innerHTML = this._detailHtml(selected, state);
      if(state.editing){
        const input = this.detail.querySelector('[data-edit-input]');
        if(input && document.activeElement !== input){ input.focus(); input.select(); }
      }
    }

    _itemHtml(e, selected, q){
      const orphan = !e.client;
      const hue = orphan ? 0 : clientColors.hueOf(e.nombre);
      let meta;
      if(q && e.matches && !e.nameMatch) meta = plural(e.matches, 'contacto coincide', 'contactos coinciden');
      else meta = e.contacts.length ? plural(e.contacts.length, 'contacto', 'contactos') : 'Sin contactos';
      if(!orphan && e.stats.open) meta += ' · ' + plural(e.stats.open, 'tarea abierta', 'tareas abiertas');
      return '<button type="button" class="crm-item' + (orphan ? ' is-orphan' : '') + '" role="option" aria-selected="' + selected + '" tabindex="' + (selected ? '0' : '-1') + '" data-client="' + esc(e.id) + '"' + (orphan ? '' : ' style="--h:' + hue + '"') + '>' +
        '<span class="avatar is-square is-sm' + (orphan ? ' is-lock' : '') + '" aria-hidden="true">' + (orphan ? '?' : esc(initials(e.nombre))) + '</span>' +
        '<span class="crm-item-text"><span class="crm-item-name">' + (orphan ? esc(e.nombre) : highlight(e.nombre, q)) + '</span>' +
        '<span class="crm-item-meta">' + esc(meta) + '</span></span>' +
        '</button>';
    }

    _detailHtml(e, state){
      const q = state.query;
      const orphan = !e.client;
      const hue = orphan ? 0 : clientColors.hueOf(e.nombre);
      const back = '<button type="button" class="icon-only crm-back" data-action="back" aria-label="Volver a la lista de clientes">' + BACK_ICON + '</button>';

      let head;
      if(state.editing && !orphan){
        head = '<div class="crm-head">' + back +
          '<div class="client-edit-row">' +
          '<input type="text" class="client-edit-input" data-edit-input="1" value="' + esc(e.nombre) + '" maxlength="60" aria-label="Nombre del cliente">' +
          '<button type="button" class="btn btn-primary" data-action="save-client">Guardar</button>' +
          '<button type="button" class="btn btn-ghost" data-action="cancel-client">Cancelar</button>' +
          '</div></div>';
      } else {
        const meta = orphan
          ? 'Contactos cuyo cliente ya no existe. Edítalos para asignarles uno.'
          : [plural(e.contacts.length, 'contacto', 'contactos'),
             e.stats.total ? plural(e.stats.total, 'tarea', 'tareas') + (e.stats.open ? ' (' + e.stats.open + ' abierta' + (e.stats.open === 1 ? '' : 's') + ')' : '') : 'Sin tareas']
            .join(' · ');
        head = '<div class="crm-head"' + (orphan ? '' : ' style="--h:' + hue + '"') + '>' + back +
          (orphan
            ? '<span class="avatar is-square is-lock" aria-hidden="true">?</span>'
            : '<button type="button" class="avatar is-square avatar-btn" data-action="toggle-color" aria-label="Cambiar color de ' + esc(e.nombre) + '" aria-expanded="' + !!state.colorOpen + '" title="Cambiar color">' + esc(initials(e.nombre)) + '</button>') +
          '<div class="crm-title"><h2>' + esc(e.nombre) + '</h2><p>' + esc(meta) + '</p></div>' +
          (orphan ? '' :
            '<div class="crm-head-actions">' +
            '<button type="button" class="icon-only' + (state.colorOpen ? ' is-active' : '') + '" data-action="toggle-color" aria-label="Color" aria-expanded="' + !!state.colorOpen + '" title="Color">' + COLOR_ICON + '</button>' +
            '<button type="button" class="icon-only" data-action="edit-client" aria-label="Renombrar ' + esc(e.nombre) + '" title="Renombrar">' + EDIT_ICON + '</button>' +
            '<button type="button" class="icon-only is-danger" data-action="delete" aria-label="Eliminar ' + esc(e.nombre) + '" title="Eliminar">' + TRASH_ICON + '</button>' +
            '</div>') +
          '</div>';
      }

      const color = state.colorOpen && !orphan ? colorPickerHtml(e.client, state.colors) : '';
      const confirm = state.pendingDelete && !orphan
        ? '<div class="crm-confirm" role="alert"><p><strong>¿Eliminar «' + esc(e.nombre) + '»?</strong> ' +
          (e.stats.total ? 'Se borrarán también sus ' + plural(e.stats.total, 'tarea', 'tareas') + '. ' : '') +
          'Sus contactos, reuniones y contraseñas se conservan.</p>' +
          '<div class="crm-confirm-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="cancel-delete">Cancelar</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-action="confirm-delete">Eliminar cliente</button></div></div>'
        : '';

      const shortcuts = orphan ? '' :
        '<div class="crm-shortcuts">' +
        '<button type="button" class="crm-shortcut" data-action="view-tasks">' + BOARD_ICON + '<span>Ver tareas</span><em>' + (e.stats.open || '') + '</em></button>' +
        '<button type="button" class="crm-shortcut" data-action="view-vault">' + LOCK_ICON + '<span>Ver contraseñas</span><em>' + (e.vaultCount || '') + '</em></button>' +
        '</div>';

      const people = e.contacts.length
        ? '<div class="people">' + e.contacts.map((c) => personHtml(c, q)).join('') + '</div>'
        : '<div class="people-empty">' + (orphan ? 'No hay contactos sin cliente.' : 'Aún no hay personas de contacto para este cliente.') + '</div>';

      return head + color + confirm + shortcuts +
        '<div class="crm-section">' +
          '<div class="crm-section-head"><h3>Personas de contacto</h3>' +
          (orphan ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-action="add-contact">' + PLUS_ICON + 'Añadir contacto</button>') +
          '</div>' + people +
        '</div>';
    }
  }

  function personHtml(c, q){
    const name = c.nombre || 'Sin nombre';
    const email = c.email
      ? '<a class="person-line" href="mailto:' + esc(encodeURI(c.email)) + '">' + MAIL_ICON + '<span>' + highlight(c.email, q) + '</span></a>' : '';
    const phoneHref = String(c.telefono || '').replace(/[^\d+]/g, '');
    const tel = c.telefono
      ? (phoneHref
        ? '<a class="person-line" href="tel:' + esc(phoneHref) + '">' + PHONE_ICON + '<span>' + highlight(c.telefono, q) + '</span></a>'
        : '<span class="person-line">' + PHONE_ICON + '<span>' + highlight(c.telefono, q) + '</span></span>') : '';
    const notas = c.notas ? '<p class="person-notes">' + highlight(c.notas, q) + '</p>' : '';
    return '<div class="person" data-action="open-contact" data-id="' + esc(c.id) + '" tabindex="0" role="button" aria-label="Editar contacto ' + esc(name) + '">' +
      '<span class="avatar is-sm" style="--h:' + hueFor(name) + '" aria-hidden="true">' + esc(initials(c.nombre)) + '</span>' +
      '<div class="person-main"><strong>' + highlight(name, q) + '</strong>' +
      (email || tel ? '<div class="person-lines">' + email + tel + '</div>' : '') + notas + '</div>' +
      '<span class="person-edit" aria-hidden="true">' + EDIT_ICON + '</span>' +
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
