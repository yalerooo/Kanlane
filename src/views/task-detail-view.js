/* Ficha de solo lectura de una tarea: se abre al hacer clic en ella y muestra
   toda su información (estado, cliente, fechas, descripción, notas y vínculos).
   Desde aquí se puede cambiar el estado o pasar a editarla. */
(function(){
  const {esc, closest, iconSpan, initials, hueFor} = Workhub.utils.html;
  const {parseYmd, longDay, fmtDateTime, daysFromToday} = Workhub.utils.dates;
  const {copyWithFeedback} = Workhub.utils.ui;
  const platform = Workhub.services.platform;
  const clientColors = Workhub.views.clientColors;
  const TaskModel = Workhub.models.TaskModel;
  const VaultModel = Workhub.models.VaultModel;
  const $ = (id) => document.getElementById(id);

  const FACT_ICONS = {
    due: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    contact: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    created: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    updated: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
  const LOCK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  class TaskDetailView {
    constructor(){
      this.dlg = $('dlgTaskView');
      this.top = $('tvTop');
      this.title = $('tvTitle');
      this.facts = $('tvFacts');
      this.descWrap = $('tvDescWrap');
      this.desc = $('tvDesc');
      this.notes = $('tvNotes');
      this.notesCount = $('tvNotesCount');
      this.linksWrap = $('tvLinksWrap');
      this.links = $('tvLinks');
      this.estado = $('tvEstado');
      this.btnClose = $('btnTvClose');
      this.btnEdit = $('btnTvEdit');
      this.lightbox = $('lightbox');
      this.lightboxImg = $('lightboxImg');
      this.taskId = null;

      this.notes.addEventListener('click', (ev) => {
        const img = closest(ev.target, 'img[data-asset-id]');
        if(!img) return;
        this.lightboxImg.src = img.currentSrc || img.src;
        this.lightbox.hidden = false;
      });
    }

    /* ---------- Eventos hacia el controlador ---------- */

    bindClose(handler){ this.btnClose.addEventListener('click', handler); }

    bindEdit(handler){ this.btnEdit.addEventListener('click', () => handler(this.taskId)); }

    bindStatus(handler){
      this.estado.addEventListener('change', () => {
        if(this.taskId) handler(this.taskId, this.estado.value);
      });
    }

    /* handler(action, id, button): open-contact, toggle-linked-vault, copy-linked-vault, goto-vault */
    bindLinkActions(handler){
      this.links.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-action]');
        if(btn) handler(btn.getAttribute('data-action'), btn.getAttribute('data-id'), btn);
      });
    }

    /* ---------- Estado ---------- */

    isOpen(){ return this.dlg.open; }

    open(t, ctx){
      this.render(t, ctx);
      this.notes.innerHTML = '<p class="tv-empty">Cargando notas…</p>';
      this.notesCount.textContent = '';
      if(!this.dlg.open) this.dlg.showModal();
      /* Que el foco inicial no abra el desplegable de estado. */
      this.btnEdit.focus({preventScroll:true});
    }

    close(){ if(this.dlg.open) this.dlg.close(); }

    /* ctx: {contacts, vault} */
    render(t, ctx){
      /* Botones que añaden los plugins a la ficha (reciben el id de la tarea). */
      const slot = document.getElementById('tvExtSlot');
      slot.setAttribute('data-ext-context', JSON.stringify({taskId:t.id}));
      Workhub.views.extensions.fillSlots(slot.parentNode);
      this.taskId = t.id;
      const s = TaskModel.statusOf(t.status);
      this.dlg.style.setProperty('--st', s.dot);
      this.top.innerHTML =
        (t.cliente ? clientColors.chip(t.cliente) : '<span class="tv-muted">Sin cliente</span>') +
        '<span class="status-pill" style="--st:' + s.fg + ';--st-bg:' + s.bg + '"><span class="dot" style="background:' + s.dot + '"></span>' + esc(s.label) + '</span>';
      this.title.textContent = t.title || 'Sin título';
      /* La fecha límite siempre; el resto solo si tiene valor (las tareas
         importadas de copias antiguas no traen fechas reales de creación). */
      const known = (ts) => ts > 100000;
      this.facts.innerHTML = [
        fact('due', 'Fecha límite', dueHtml(t)),
        t.contacto ? fact('contact', 'Contacto', esc(t.contacto)) : '',
        known(t.createdAt) ? fact('created', 'Creada', esc(fmtDateTime(t.createdAt))) : '',
        known(t.updatedAt) ? fact('updated', 'Última modificación', esc(fmtDateTime(t.updatedAt))) : ''
      ].join('');

      this.descWrap.hidden = !t.desc;
      this.desc.textContent = t.desc || '';

      if(this.estado.value !== (t.status || 'pendiente')) this.estado.value = t.status || 'pendiente';
      this.renderLinks(t, ctx);
    }

    renderLinks(t, ctx){
      const contactIds = Array.isArray(t.linkedContacts) ? t.linkedContacts : [];
      const vaultIds = Array.isArray(t.linkedVault) ? t.linkedVault : [];
      const contacts = contactIds.map((id) => ctx.contacts.find((c) => c.id === id)).filter(Boolean);
      const entries = vaultIds.map((id) => ctx.vault.find(id)).filter(Boolean);
      this.linksWrap.hidden = !contacts.length && !entries.length;
      this.links.innerHTML = contacts.map(contactRowHtml).join('') + entries.map((v) => vaultRowHtml(v, ctx.vault)).join('');
    }

    renderNotes(docs){
      this.notesCount.textContent = docs.length ? docs.length : '';
      this.notes.innerHTML = docs.length
        ? docs.map(noteHtml).join('')
        : '<p class="tv-empty">Sin notas todavía. Puedes añadirlas desde <strong>Editar tarea</strong>.</p>';
      platform.hydrateAssetImages(this.notes);
    }

    showNotesError(){
      this.notes.innerHTML = '<p class="tv-empty">No se pudieron cargar las notas.</p>';
    }

    copy(btn, text){ return copyWithFeedback(btn, text); }
  }

  function fact(icon, label, valueHtml){
    return '<div class="tv-fact"><div class="tv-fact-body">' +
      '<span class="tv-fact-label"><span aria-hidden="true" class="tv-fact-ic">' + FACT_ICONS[icon] + '</span>' + esc(label) + '</span>' +
      '<span class="tv-fact-value">' + valueHtml + '</span></div></div>';
  }

  function dueHtml(t){
    if(!t.dueDate) return '<span class="tv-muted">Sin fecha</span>';
    const ds = TaskModel.dueState(t);
    const days = daysFromToday(t.dueDate);
    let rel;
    if(ds === 'done') rel = 'Completada';
    else if(days === 0) rel = 'Vence hoy';
    else if(days === 1) rel = 'Mañana';
    else if(days > 1) rel = 'Faltan ' + days + ' días';
    else if(days === -1) rel = 'Venció ayer';
    else rel = 'Venció hace ' + (-days) + ' días';
    const cls = 'due-badge' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : ds === 'done' ? ' is-done' : '');
    return esc(longDay(parseYmd(t.dueDate), true)) + ' <span class="' + cls + '">' + esc(rel) + '</span>';
  }

  function noteHtml(d){
    const n = d.data() || {};
    const img = n.imageAssetId
      ? '<img src="' + esc(platform.assetSrc(n.imageAssetId)) + '" data-asset-id="' + esc(n.imageAssetId) + '" alt="Imagen de la nota">'
      : '';
    return '<article class="tv-note">' +
      '<div class="tv-note-date">' + esc(fmtDateTime(n.createdAt)) + '</div>' +
      (n.text ? '<div class="tv-note-text" translate="no">' + esc(n.text) + '</div>' : '') +
      img +
      '</article>';
  }

  function contactRowHtml(c){
    const name = c.nombre || 'Sin nombre';
    const meta = [c.email, c.telefono].filter(Boolean).join(' · ') || c.cliente || '';
    return '<div class="tv-link">' +
      '<span class="avatar is-sm" style="--h:' + hueFor(name) + '" aria-hidden="true">' + esc(initials(c.nombre)) + '</span>' +
      '<div class="tv-link-main"><div class="tv-link-title" translate="no">' + esc(name) + '</div><div class="tv-link-meta">' + esc(meta) + '</div></div>' +
      '<div class="tv-link-actions"><button type="button" class="icon-btn" data-action="open-contact" data-id="' + esc(c.id) + '">Abrir</button></div>' +
      '</div>';
  }

  function vaultRowHtml(v, vault){
    const actions = vault.unlocked
      ? '<span class="linked-pass">' + esc(vault.passwordText(v.id)) + '</span>' +
        '<button type="button" class="icon-btn" data-action="toggle-linked-vault" data-id="' + esc(v.id) + '">' + (vault.isVisible(v.id) ? 'Ocultar' : 'Mostrar') + '</button>' +
        '<button type="button" class="icon-btn" data-action="copy-linked-vault" data-id="' + esc(v.id) + '">Copiar</button>'
      : '<button type="button" class="icon-btn" data-action="goto-vault" data-id="' + esc(v.id) + '">Desbloquear</button>';
    return '<div class="tv-link">' +
      '<span class="avatar is-sm is-lock" aria-hidden="true">' + LOCK_ICON + '</span>' +
      '<div class="tv-link-main"><div class="tv-link-title" translate="no">' + esc(VaultModel.titleFor(v)) + '</div>' +
      '<div class="tv-link-meta">' + esc(VaultModel.typeLabel(v.tipo)) + (v.cliente ? ' · ' + esc(v.cliente) : '') + '</div></div>' +
      '<div class="tv-link-actions">' + actions + '</div>' +
      '</div>';
  }

  Workhub.views.TaskDetailView = TaskDetailView;
})();
