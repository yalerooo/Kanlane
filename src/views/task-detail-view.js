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
  const md = Workhub.utils.markdown;
  const attachments = Workhub.views.attachments;
  const $ = (id) => document.getElementById(id);

  const FACT_ICONS = {
    location: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    votes: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z"/><path d="M7 10l4-8a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H7"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
    due: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    contact: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    created: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    updated: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    assignees: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    gh: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.38-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.72 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg>'
  };
  const TICK_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';
  const BOLT_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';
  const LOCK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const BLOCK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';

  class TaskDetailView {
    constructor(){
      this.dlg = $('dlgTaskView');
      this.top = $('tvTop');
      this.title = $('tvTitle');
      this.facts = $('tvFacts');
      this.checkWrap = $('tvChecklistWrap');
      this.checkCount = $('tvChecklistCount');
      this.checkProgress = $('tvChecklistProgress');
      this.checkProgressFill = $('tvChecklistProgressFill');
      this.checks = $('tvChecklist');
      this.descWrap = $('tvDescWrap');
      this.desc = $('tvDesc');
      this.notes = $('tvNotes');
      this.notesCount = $('tvNotesCount');
      this.notesTitle = $('tvNotesTitle');
      this.commentForm = $('tvCommentForm');
      this.commentText = $('tvCommentText');
      this.commentSend = $('tvCommentSend');
      this.commentError = $('tvCommentError');
      /* Archivos adjuntos a la nota que se está escribiendo (se suben al enviar). */
      this.picker = new attachments.Picker({
        input:$('tvCommentImage'), button:$('tvCommentAttach'), list:$('tvCommentFiles'),
        drop:this.commentForm, paste:this.commentText, onError:(msg) => this.commentFailed(msg)
      });
      this.linksWrap = $('tvLinksWrap');
      this.links = $('tvLinks');
      this.labelsWrap = $('tvLabelsWrap');
      this.labels = $('tvLabels');
      this.prsWrap = $('tvPrsWrap');
      this.prs = $('tvPrs');
      this.ghWrap = $('tvGhWrap');
      this.timeline = $('tvTimeline');
      this.ghShown = null;
      this.estado = $('tvEstado');
      this.btnClose = $('btnTvClose');
      this.btnEdit = $('btnTvEdit');
      this.btnArchive = $('btnTvArchive');
      this.btnDuplicate = $('btnTvDuplicate');
      this.btnFollow = $('btnTvFollow');
      this.followText = $('tvFollowText');
      this.btnDone = $('btnTvDone');
      this.stamp = $('tvStamp');
      this.taskId = null;
      this.descShown = null;
      /* Botones de las automatizaciones (un clic ejecuta sus acciones en esta tarea). */
      this.autoWrap = $('tvAutoWrap');
      this.autoButtons = $('tvAutoButtons');

      attachments.bind(this.notes);
    }

    /* ---------- Eventos hacia el controlador ---------- */

    bindClose(handler){
      this.btnClose.addEventListener('click', handler);
      /* Escape cierra el diálogo de golpe: se pasa por el mismo cierre animado que la X. */
      this.dlg.addEventListener('cancel', (ev) => {
        ev.preventDefault();
        this.btnClose.click();
      });
      /* Cerrada por otra vía (cambio de proyecto): no dejar la salida a medias. */
      this.dlg.addEventListener('close', () => this._endClosing());
      /* Un clic en el velo (fuera del panel) cierra la ficha. Tiene que empezar y acabar fuera:
         soltar el ratón fuera tras seleccionar texto dentro no cuenta. */
      const outside = (ev) => {
        if(ev.target !== this.dlg) return false;
        const r = this.dlg.getBoundingClientRect();
        return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
      };
      let downOutside = false;
      this.dlg.addEventListener('pointerdown', (ev) => { downOutside = outside(ev); });
      this.dlg.addEventListener('click', (ev) => {
        const close = downOutside && outside(ev);
        downOutside = false;
        if(close) this.btnClose.click();
      });
    }
    bindComment(handler){
      this.commentForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const value = this.commentText.value.trim();
        const files = this.picker.files.slice();
        /* Vale una nota solo con adjuntos. */
        if((value || files.length) && this.taskId && !this.commentSend.disabled) handler(this.taskId, value, files);
      });
      /* Intro envía; Mayús + Intro, salto de línea. El campo crece con el texto. */
      this.commentText.addEventListener('keydown', (ev) => {
        if(ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
        ev.preventDefault();
        if(this.commentForm.requestSubmit) this.commentForm.requestSubmit();
        else this.commentSend.click();
      });
      this.commentText.addEventListener('input', () => this.fitComment());
      /* «@» en un comentario de equipo: lista de miembros para mencionar (antes que Intro = enviar). */
      if(Workhub.views.mentions){
        const T = Workhub.views.team;
        Workhub.views.mentions.attach(this.commentText, this.commentForm, () => (T.enabled() ? T.members().filter((m) => m.uid !== T.meUid()) : []));
      }
    }
    clearCommentImage(){ this.picker.clear(); }
    fitComment(){
      this.commentText.style.height = 'auto';
      this.commentText.style.height = Math.min(140, this.commentText.scrollHeight) + 'px';
    }
    /* En un equipo es un comentario para los demás; a solas, una nota. */
    commentLabels(){
      return Workhub.views.team.enabled()
        ? {send:Workhub.t('Publicar'), busy:Workhub.t('Publicando…'), hint:Workhub.t('Comparte una actualización con el equipo…'), error:Workhub.t('No se pudo publicar el comentario.')}
        : {send:Workhub.t('Añadir'), busy:Workhub.t('Guardando…'), hint:Workhub.t('Escribe una nota…'), error:Workhub.t('No se pudo guardar la nota.')};
    }
    setCommentBusy(busy){ const l = this.commentLabels(); this.commentSend.disabled = busy; this.commentSend.textContent = busy ? l.busy : l.send; }
    commentSaved(){ this.commentText.value = ''; this.clearCommentImage(); this.fitComment(); this.commentError.hidden = true; }
    /* msg: el motivo, si se sabe (p. ej. la imagen no se pudo subir). */
    commentFailed(msg){ this.commentError.textContent = msg ? Workhub.t(msg) : this.commentLabels().error; this.commentError.hidden = false; }

    /* «Asignarme» / «Quitar mi asignación» en la ficha. */
    bindAssignMe(handler){
      this.facts.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-action="assign-me"]');
        if(b && this.taskId) handler(this.taskId);
      });
    }

    /* «Votar» / «Quitar mi voto» en la ficha. */
    bindVote(handler){
      this.facts.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-action="vote"]');
        if(b && this.taskId) handler(this.taskId);
      });
    }

    /* Botones de automatización de la ficha. handler(taskId, idRegla). */
    bindAutoButton(handler){
      this.autoButtons.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-auto-rule]');
        if(btn && this.taskId) handler(this.taskId, btn.getAttribute('data-auto-rule'));
      });
    }

    /* Casillas de la descripción (- [ ] en Markdown). handler(taskId, n, checked): n es su número en el texto. */
    bindDescTasks(handler){
      this.desc.addEventListener('change', (ev) => {
        const box = closest(ev.target, 'input[data-md-task]');
        if(box && this.taskId) handler(this.taskId, +box.getAttribute('data-md-task'), box.checked);
      });
    }

    /* Casillas del texto de una nota. handler(taskId, noteId, n, checked). */
    bindNoteTasks(handler){
      this.notes.addEventListener('change', (ev) => {
        const box = closest(ev.target, 'input[data-md-task]');
        const note = box && closest(box, '[data-note-id]');
        if(note && this.taskId) handler(this.taskId, note.getAttribute('data-note-id'), +box.getAttribute('data-md-task'), box.checked);
      });
    }

    /* handler(taskId, itemId, done) */
    bindChecklist(handler){
      this.checks.addEventListener('change', (ev) => {
        const row = ev.target.closest('[data-cid]');
        if(row && this.taskId) handler(this.taskId, row.getAttribute('data-cid'), ev.target.checked);
      });
    }

    /* Asignar una subtarea desde su avatar (solo en equipos). handler(taskId, itemId, uid): '' la deja sin asignar. */
    bindCheckAssign(handler){
      this.checks.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-act="check-assign"]');
        const row = btn && closest(btn, '[data-cid]');
        if(!row || !this.taskId) return;
        const taskId = this.taskId;
        Workhub.views.team.pick(btn, btn.getAttribute('data-uid'), (uid) => handler(taskId, row.getAttribute('data-cid'), uid));
      });
    }

    bindEdit(handler){ this.btnEdit.addEventListener('click', () => handler(this.taskId)); }

    /* «Seguir»: avisos de lo que pase en esta tarea (solo en equipos). */
    bindFollow(handler){ this.btnFollow.addEventListener('click', () => { if(this.taskId) handler(this.taskId); }); }

    /* «Archivar tarea»: sale del tablero y se puede restaurar desde Archivados. */
    bindArchive(handler){ this.btnArchive.addEventListener('click', () => { if(this.taskId) handler(this.taskId); }); }

    /* «Duplicar tarea»: crea una copia independiente justo debajo. */
    bindDuplicate(handler){ this.btnDuplicate.addEventListener('click', () => { if(this.taskId) handler(this.taskId); }); }

    /* «Marcar como completada»: pasa la tarea a la primera etapa final (como elegirla en Estado). */
    bindDone(handler){
      this.btnDone.addEventListener('click', () => {
        const done = TaskModel.STATUS.find((x) => x.done);
        if(this.taskId && done) handler(this.taskId, done.key);
      });
    }

    bindStatus(handler){
      this.estado.addEventListener('change', () => {
        if(this.taskId) handler(this.taskId, this.estado.value);
      });
    }

    /* handler(action, id, button): open-contact, toggle-linked-vault, copy-linked-vault, goto-vault */
    bindLinkActions(handler){
      const delegate = (ev) => {
        const btn = closest(ev.target, 'button[data-action]');
        if(btn) handler(btn.getAttribute('data-action'), btn.getAttribute('data-id'), btn);
      };
      this.links.addEventListener('click', delegate);
      /* El aviso de bloqueo enlaza a las tareas que la bloquean. */
      $('tvBlocked').addEventListener('click', delegate);
    }

    /* ---------- Estado ---------- */

    /* Mientras se está cerrando (animación de salida) ya no cuenta como abierta. */
    isOpen(){ return this.dlg.open && !this.closing; }

    open(t, ctx){
      this.ghShown = null;
      this.clearCommentImage();
      this.render(t, ctx);
      this.notes.innerHTML = '<p class="tv-empty">Cargando notas…</p>';
      this.notesCount.textContent = '';
      /* Si se reabre a mitad de la salida, la salida se deshace y el panel se queda. */
      this._endClosing();
      if(!this.dlg.open) this.dlg.showModal();
      /* Que el foco inicial no abra el desplegable de estado. */
      this.btnEdit.focus({preventScroll:true});
    }

    /* Cierra con la animación de salida: el panel se va por la derecha (en móvil, hacia abajo)
       y el velo se apaga; el diálogo se cierra de verdad al terminar. Sin animaciones
       (movimiento reducido), se cierra al momento. */
    close(){
      if(!this.dlg.open || this.closing) return;
      const still = document.documentElement.getAttribute('data-motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(still){ this.dlg.close(); return; }
      this.closing = true;
      this.dlg.classList.add('is-closing');
      const finish = (ev) => {
        if(ev && (ev.target !== this.dlg || String(ev.animationName).indexOf('tv-out') !== 0)) return;
        const wasClosing = this.closing;
        this._endClosing();
        if(wasClosing && this.dlg.open) this.dlg.close();
      };
      this._closeDone = finish;
      this.dlg.addEventListener('animationend', finish);
      /* Por si la animación no llega a terminar (pestaña en segundo plano). */
      this._closeTimer = setTimeout(() => finish(), 400);
    }

    _endClosing(){
      if(this._closeDone) this.dlg.removeEventListener('animationend', this._closeDone);
      clearTimeout(this._closeTimer);
      this._closeDone = null;
      this.closing = false;
      this.dlg.classList.remove('is-closing');
    }

    /* Actividad y pull requests que llegan de GitHub. data null + err → no se pudo cargar. */
    renderGithub(taskId, data, err){
      if(this.taskId !== taskId) return;
      if(!data){
        this.timeline.innerHTML = '<li class="gh-empty">' + esc(Workhub.t('No se pudo cargar la actividad de GitHub.')) + '</li>';
        return;
      }
      const L = Workhub.views.labels;
      this.prsWrap.hidden = !data.prs.length;
      this.prs.innerHTML = L.prs(data.prs, 0, true);
      const items = data.events.map(eventHtml).filter(Boolean);
      this.timeline.innerHTML = items.length ? items.join('') : '<li class="gh-empty">' + esc(Workhub.t('Sin actividad todavía.')) + '</li>';
    }

    /* ctx: {contacts, vault} */
    render(t, ctx){
      /* Botones que añaden los plugins a la ficha (reciben el id de la tarea). */
      const slot = document.getElementById('tvExtSlot');
      slot.setAttribute('data-ext-context', JSON.stringify({taskId:t.id}));
      Workhub.views.extensions.fillSlots(slot.parentNode);
      this.taskId = t.id;
      const team = Workhub.views.team;
      /* Añadir una nota (o un comentario, en un equipo) desde la propia ficha. */
      this.commentForm.hidden = !team.canEdit();
      const following = team.enabled() && Array.isArray(t.followers) && t.followers.indexOf(team.meUid()) !== -1;
      this.btnFollow.setAttribute('aria-pressed', following ? 'true' : 'false');
      this.followText.textContent = Workhub.t(following ? 'Siguiendo' : 'Seguir');
      const say = this.commentLabels();
      this.commentText.placeholder = say.hint;
      if(!this.commentSend.disabled) this.commentSend.textContent = say.send;
      this.notesTitle.firstChild.textContent = Workhub.t(team.enabled() ? 'Actividad y comentarios' : 'Notas') + ' ';
      const s = TaskModel.statusOf(t.status);
      this.dlg.style.setProperty('--st', s.dot);
      /* Cabecera: el cliente y, a su lado, las etiquetas (se pintan más abajo). El estado va en la franja de propiedades. */
      const labelNames = Array.isArray(t.labels) ? t.labels : [];
      const crumb = [];
      if(Workhub.clientsEnabled !== false){
        crumb.push(t.cliente
          ? '<span class="tv-crumb-client" translate="no"><i class="client-dot" style="--h:' + clientColors.hueOf(t.cliente) + '"></i><b>' + esc(t.cliente) + '</b></span>'
          : '<span class="tv-muted">Sin cliente</span>');
      }
      if(!crumb.length && !labelNames.length) crumb.push('<span class="status-pill" style="--st:' + s.dot + '"><span class="dot"></span><span translate="no">' + esc(s.label) + '</span></span>');
      this.top.innerHTML = crumb.join('');
      /* Ya terminada o sin etapa final: el botón no tiene nada que hacer. */
      const isDone = TaskModel.isDone(t);
      this.btnDone.hidden = !TaskModel.STATUS.some((x) => x.done);
      this.btnDone.classList.toggle('is-done', isDone);
      this.btnDone.disabled = isDone;
      this.btnDone.title = Workhub.t(isDone ? 'Completada' : 'Marcar como completada');
      this.dlg.classList.toggle('is-done', isDone);
      this.title.textContent = t.title || 'Sin título';
      /* Portada: franja de color o la imagen, encima del título. */
      const cover = t._undecryptable ? null : TaskModel.coverOf(t);
      const coverEl = $('tvCover');
      coverEl.hidden = !cover;
      coverEl.className = 'tv-cover' + (cover && cover.asset ? ' is-image' : '');
      coverEl.style.setProperty('--cv', cover && cover.color ? Workhub.models.ProjectTemplates.colorOf(cover.color).dot : '');
      const coverSrc = cover && cover.asset ? platform.assetUrlNow(cover.asset) : '';
      coverEl.innerHTML = cover && cover.asset ? '<img' + (coverSrc ? ' src="' + esc(coverSrc) + '"' : '') + ' data-asset-id="' + esc(cover.asset) + '" alt="">' : '';
      platform.hydrateAssetImages(coverEl);
      /* La fecha límite siempre; el resto solo si tiene valor (las tareas
         importadas de copias antiguas no traen fechas reales de creación). */
      const known = (ts) => ts > 100000;
      this.facts.innerHTML = [
        t.startDate ? fact('due', 'Fecha de inicio', '<span>' + esc(longDay(parseYmd(t.startDate), true)) + '</span>') : '',
        fact('due', 'Fecha límite', dueHtml(t)),
        assigneesFact(t),
        t.contacto ? fact('contact', 'Contacto', '<span translate="no">' + esc(t.contacto) + '</span>') : '',
        locationFact(t),
        votesFact(t, ctx),
        fact('repeat', 'Se repite', t.repeat ? esc(Workhub.t((TaskModel.REPEATS.find((r) => r.key === t.repeat) || {}).label || '')) : '<span class="tv-muted">' + esc(Workhub.t('No se repite')) + '</span>'),
        ghFact(t)
      ].join('') + (Workhub.views.fields ? Workhub.views.fields.filled(t).map((f) =>
        '<div class="tv-prop tv-fact"><span class="tv-prop-label tv-fact-label" translate="no">' + esc(f.name) + '</span><div class="tv-prop-value tv-fact-value"><span translate="no">' + esc(f.text) + '</span></div></div>').join('') : '');
      /* Al pie de la columna: cuándo se creó y cuándo se tocó por última vez. */
      this.stamp.innerHTML = [
        known(t.createdAt) ? esc(Workhub.t('Creada')) + ' · ' + esc(fmtDateTime(t.createdAt)) : '',
        known(t.updatedAt) ? esc(Workhub.t('Última modificación')) + ' · ' + esc(fmtDateTime(t.updatedAt)) : ''
      ].filter(Boolean).join('<br>');
      this.stamp.hidden = !this.stamp.innerHTML;

      this.descWrap.hidden = !t.desc;
      /* Solo se repinta si cambia: así no se pierde lo que se tenga seleccionado. */
      const descKey = t.id + '|' + team.canEdit() + '|' + (t.desc || '');
      if(this.descShown !== descKey){
        this.descShown = descKey;
        this.desc.innerHTML = md.render(t.desc || '', {tasks:team.canEdit() ? 'interactive' : 'static'});
      }

      const buttons = (ctx && ctx.buttons) || [];
      this.autoWrap.hidden = !buttons.length;
      this.autoButtons.innerHTML = buttons.map((b) =>
        '<button type="button" class="btn btn-ghost btn-sm" data-auto-rule="' + esc(b.id) + '" translate="no">' + BOLT_ICON + esc(b.name) + '</button>').join('');

      const items = Array.isArray(t.checklist) ? t.checklist : [];
      const prog = TaskModel.checklistProgress(t);
      this.checkWrap.hidden = !items.length;
      const percent = prog.total ? Math.round(prog.done / prog.total * 100) : 0;
      this.checkCount.textContent = items.length ? Workhub.t('{n} de {total}', {n:prog.done, total:prog.total}) : '';
      this.checkProgress.setAttribute('aria-valuenow', percent);
      this.checkProgressFill.style.width = percent + '%';
      this.checks.innerHTML = items.map((c) =>
        '<li data-cid="' + esc(c.id) + '"><label><input type="checkbox"' + (c.done ? ' checked' : '') + '>' +
        '<span translate="no"' + (c.done ? ' class="is-done"' : '') + '>' + esc(c.text) + '</span></label>' + team.checkWho(c) + '</li>').join('');

      /* Etiquetas y pull requests (los datos completos de GitHub llegan después: renderGithub). */
      const L = Workhub.views.labels;
      const labels = Array.isArray(t.labels) ? t.labels : [];
      this.labelsWrap.hidden = !labels.length;
      this.labels.innerHTML = L.chips(labels);
      if(this.ghShown !== t.id){
        const prs = Array.isArray(t.ghPrs) ? t.ghPrs : [];
        this.prsWrap.hidden = !prs.length;
        this.prs.innerHTML = L.prs(prs, 0, true);
      }
      const linked = !!t.ghItemId && (t.ghType === 'Issue' || t.ghType === 'PullRequest');
      this.ghWrap.hidden = !linked;
      if(linked && this.ghShown !== t.id){
        this.ghShown = t.id;
        this.timeline.innerHTML = '<li class="gh-empty">Cargando actividad…</li>';
      }

      const stage = TaskModel.stageKey(t);
      if(this.estado.value !== stage) this.estado.value = stage;
      this.renderLinks(t, ctx);
    }

    renderLinks(t, ctx){
      const contactIds = Array.isArray(t.linkedContacts) ? t.linkedContacts : [];
      const vaultIds = Array.isArray(t.linkedVault) ? t.linkedVault : [];
      const contacts = contactIds.map((id) => ctx.contacts.find((c) => c.id === id)).filter(Boolean);
      const entries = vaultIds.map((id) => ctx.vault.find(id)).filter(Boolean);
      /* Otras tareas: primero las que la bloquean. Y, arriba, el aviso si alguna sigue sin terminar. */
      const relations = ctx.tasks ? ctx.tasks.relationsOf(t.id) : [];
      const blockers = ctx.tasks ? ctx.tasks.blockersOf(t.id) : [];
      const blocked = $('tvBlocked');
      blocked.hidden = !blockers.length;
      blocked.innerHTML = blockers.length ? BLOCK_ICON + '<span>' + esc(Workhub.t(blockers.length === 1 ? 'Bloqueada: no puede avanzar hasta que termine' : 'Bloqueada: no puede avanzar hasta que terminen')) + ' ' +
        blockers.map((b) => '<button type="button" class="tv-blocked-task" data-action="open-task" data-id="' + esc(b.id) + '" translate="no">' + esc(b.title || Workhub.t('Sin título')) + '</button>').join(', ') + '</span>' : '';
      this.linksWrap.hidden = !contacts.length && !entries.length && !relations.length;
      this.links.innerHTML = relations.map(taskRowHtml).join('') + contacts.map(contactRowHtml).join('') + entries.map((v) => vaultRowHtml(v, ctx.vault)).join('');
    }

    renderNotes(docs){
      this.notesCount.textContent = docs.length ? docs.length : '';
      this.notes.innerHTML = docs.length
        ? docs.map(noteHtml).join('')
        : '<p class="tv-empty">Sin notas todavía.</p>';
      platform.hydrateAssetImages(this.notes);
      /* Menciones de los comentarios («@Nombre»), solo en equipos. */
      const T = Workhub.views.team;
      if(Workhub.views.mentions && T.enabled()) this.notes.querySelectorAll('.tv-note-text').forEach((el) => Workhub.views.mentions.mark(el, T.members(), T.meUid()));
    }

    showNotesError(){
      this.notes.innerHTML = '<p class="tv-empty">No se pudieron cargar las notas.</p>';
    }

    copy(btn, text){ return copyWithFeedback(btn, text); }
  }

  /* Quién tiene asignada la tarea (solo en equipos), con acceso rápido para asignármela. */
  function assigneesFact(t){
    const T = Workhub.views.team;
    if(!T.enabled()) return '';
    const who = T.assigned(t);
    const mine = who.indexOf(T.meUid()) !== -1;
    const list = who.length
      ? who.map((uid) => '<span class="tv-assignee">' + T.avatar(T.member(uid), 'is-mini') + '<span translate="no">' + esc(T.name(uid)) + '</span></span>').join('')
      : '<span class="tv-muted">' + esc(Workhub.t('Sin asignar')) + '</span>';
    const btn = T.canEdit()
      ? '<button type="button" class="btn btn-ghost btn-sm tv-assign-me" data-action="assign-me">' + esc(Workhub.t(mine ? 'Quitar mi asignación' : 'Asignármela')) + '</button>'
      : '';
    return fact('assignees', 'Asignada a', '<span class="tv-assignees">' + list + btn + '</span>');
  }

  /* Enlace al elemento de GitHub (solo direcciones de github.com). */
  function ghFact(t){
    if(!t.ghItemId) return '';
    const link = /^https:\/\/github\.com\//.test(t.ghUrl || '')
      ? '<a href="' + esc(t.ghUrl) + '" target="_blank" rel="noopener noreferrer" translate="no">' + esc((t.ghRepo ? t.ghRepo + ' ' : '') + '#' + t.ghNumber) + '</a>'
      : esc(Workhub.t('Borrador del proyecto'));
    return fact('gh', 'GitHub', link);
  }

  /* "hace 3 d" a partir de una fecha ISO. */
  function ago(iso){
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if(!isFinite(s)) return '';
    if(s < 45) return Workhub.t('hace unos segundos');
    const m = Math.round(s / 60);
    if(m < 60) return Workhub.t('hace {n} min', {n:m});
    const h = Math.round(m / 60);
    if(h < 24) return Workhub.t('hace {n} h', {n:h});
    const d = Math.round(h / 24);
    if(d < 60) return Workhub.t('hace {n} d', {n:d});
    return Workhub.t('hace {n} meses', {n:Math.round(d / 30)});
  }

  const who = (u) => '<b translate="no">' + esc((u && u.login) || 'ghost') + '</b>';

  function prLink(p){
    if(!p || !p.number) return '';
    const text = '#' + p.number + (p.title ? ' ' + p.title : '');
    return /^https:\/\/github\.com\//.test(p.url || '')
      ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer" translate="no">' + esc(text) + '</a>'
      : '<span translate="no">' + esc(text) + '</span>';
  }

  /* Un evento de la línea de tiempo de GitHub, como en la propia web. */
  function eventHtml(e){
    const t = Workhub.t;
    const L = Workhub.views.labels;
    const actor = who(e.actor || e.author);
    let text = '';
    let extra = '';
    switch(e.__typename){
      case 'AssignedEvent':
        text = e.assignee && e.actor && e.assignee.login === e.actor.login
          ? t('{actor} se autoasignó esto', {actor:actor})
          : t('{actor} asignó a {who}', {actor:actor, who:who(e.assignee)});
        break;
      case 'UnassignedEvent':
        text = t('{actor} quitó la asignación de {who}', {actor:actor, who:who(e.assignee)});
        break;
      case 'LabeledEvent':
        text = t('{actor} añadió la etiqueta {label}', {actor:actor, label:e.label ? L.chip(e.label.name, e.label.color) : ''});
        break;
      case 'UnlabeledEvent':
        text = t('{actor} quitó la etiqueta {label}', {actor:actor, label:e.label ? L.chip(e.label.name, e.label.color) : ''});
        break;
      case 'AddedToProjectV2Event':
        text = t('{actor} añadió esto a {project}', {actor:actor, project:'<b translate="no">' + esc(e.project && e.project.title) + '</b>'});
        break;
      case 'ProjectV2ItemStatusChangedEvent':
        text = t('{actor} movió esto de {from} a {to} en {project}', {
          actor:actor,
          from:'<b translate="no">' + esc(e.previousStatus) + '</b>',
          to:'<b translate="no">' + esc(e.status) + '</b>',
          project:'<b translate="no">' + esc(e.project && e.project.title) + '</b>'
        });
        break;
      case 'ConnectedEvent':
        if(!e.subject || !e.subject.number) return '';
        text = t('{actor} vinculó la pull request {pr}', {actor:actor, pr:prLink(e.subject)});
        break;
      case 'CrossReferencedEvent':
        if(!e.source || !e.source.number) return '';
        text = e.willCloseTarget
          ? t('{actor} vinculó una pull request que cerrará esta incidencia {pr}', {actor:actor, pr:prLink(e.source)})
          : t('{actor} mencionó esto en {pr}', {actor:actor, pr:prLink(e.source)});
        break;
      case 'ClosedEvent':
        text = e.closer && e.closer.number
          ? t('{actor} cerró esto con {pr}', {actor:actor, pr:prLink(e.closer)})
          : t('{actor} cerró esto', {actor:actor});
        break;
      case 'ReopenedEvent':
        text = t('{actor} reabrió esto', {actor:actor});
        break;
      case 'IssueComment':
        text = t('{actor} comentó', {actor:actor});
        extra = '<div class="gh-comment" translate="no">' + esc(String(e.body || '').slice(0, 400)) + '</div>';
        break;
      default:
        return '';
    }
    return '<li class="gh-event"><span class="gh-dot" aria-hidden="true"></span><div class="gh-event-body">' +
      '<div class="gh-event-text">' + text + '</div>' + extra +
      '<div class="gh-event-time">' + esc(ago(e.createdAt)) + '</div></div></li>';
  }

  /* Propiedad de la franja derecha: icono y etiqueta encima, y el valor debajo. */
  /* Ubicación: el texto tal cual; si es un enlace (p. ej. a un mapa), se puede abrir. */
  function locationFact(t){
    const place = typeof t.location === 'string' ? t.location.trim() : '';
    if(!place) return '';
    const url = /^https?:\/\//i.test(place) ? Workhub.utils.urls.safeUrl(place) : '';
    return fact('location', 'Ubicación', url
      ? '<a class="tv-location" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" translate="no">' + esc(place) + '</a>'
      : '<span class="tv-location" translate="no">' + esc(place) + '</span>');
  }

  /* Votos: cuántos, de quién (en un equipo) y el botón para votar o quitar mi voto.
     ctx.voter: con qué id voto yo (sin él, p. ej. en la demo, no se enseñan). */
  function votesFact(t, ctx){
    const voter = ctx && ctx.voter;
    if(!voter) return '';
    const team = Workhub.views.team;
    const votes = TaskModel.votesOf(t);
    const mine = votes.indexOf(voter) !== -1;
    const names = team.enabled() ? votes.map((uid) => team.name(uid)).filter(Boolean) : [];
    const count = votes.length === 1 ? Workhub.t('1 voto') : Workhub.t('{n} votos', {n:votes.length});
    const btn = team.canEdit()
      ? '<button type="button" class="btn btn-ghost btn-sm tv-assign-me tv-vote" data-action="vote" aria-pressed="' + mine + '">' + esc(Workhub.t(mine ? 'Quitar mi voto' : 'Votar')) + '</button>'
      : '';
    return fact('votes', 'Votos', '<span class="tv-vote-box"><span class="tv-votes' + (votes.length ? '' : ' tv-muted') + '"' + (names.length ? ' title="' + esc(names.join(', ')) + '"' : '') + '>' +
      esc(votes.length ? count : Workhub.t('Sin votos')) + (names.length ? ' <small translate="no">· ' + esc(names.join(', ')) + '</small>' : '') + '</span>' + btn + '</span>');
  }

  function fact(icon, label, valueHtml){
    return '<div class="tv-prop tv-fact"><span class="tv-prop-label tv-fact-label">' + (FACT_ICONS[icon] || '') + esc(label) + '</span>' +
      '<div class="tv-prop-value tv-fact-value">' + valueHtml + '</div></div>';
  }

  function dueHtml(t){
    if(!t.dueDate) return '<span class="tv-muted">Sin fecha</span>';
    const ds = TaskModel.dueState(t);
    const days = daysFromToday(t.dueDate);
    let rel;
    if(ds === 'done') rel = 'Completada';
    else if(days === 0) rel = ds === 'overdue' ? 'Venció hoy' : 'Vence hoy';
    else if(days === 1) rel = 'Mañana';
    else if(days > 1) rel = 'Faltan ' + days + ' días';
    else if(days === -1) rel = 'Venció ayer';
    else rel = 'Venció hace ' + (-days) + ' días';
    const cls = 'due-badge' + (ds === 'overdue' ? ' is-overdue' : ds === 'today' ? ' is-today' : ds === 'done' ? ' is-done' : '');
    return '<span class="' + cls + '">' + iconSpan(ds === 'done' ? 'check' : 'calendar') + esc(rel) + '</span><small>' + esc(longDay(parseYmd(t.dueDate), true) + (t.dueTime ? ' · ' + t.dueTime : '')) + '</small>';
  }

  function noteHtml(d){
    const n = d.data() || {};
    const text = n._undecryptable ? Workhub.t('No se puede descifrar') : (n.text ? (n.kind === 'activity' ? Workhub.t(n.text) : n.text) : '');
    const actor = n.actorName ? '<span class="tv-note-author" translate="no">' + esc(n.actorName) + '</span>' : '';
    const files = attachments.html(n);
    const when = '<time class="tv-note-date">' + esc(fmtDateTime(n.createdAt)) + '</time>';
    /* Un cambio (actividad del equipo) va en una línea; un comentario o una nota, en burbuja. */
    if(n.kind === 'activity'){
      return '<article class="tv-note is-activity"><span class="tv-tick" aria-hidden="true">' + TICK_ICON + '</span>' +
        '<div class="tv-note-body">' + actor + ' <span class="tv-note-text' + (n._undecryptable ? ' is-undecryptable' : '') + '" translate="no">' + esc(text) + '</span> ' + when + '</div></article>';
    }
    const mark = n.actorName
      ? '<span class="avatar is-mini tv-note-avatar" style="--h:' + hueFor(n.actorUid || n.actorName) + '" aria-hidden="true" translate="no">' + esc(initials(n.actorName)) + '</span>'
      : '';
    return '<article class="tv-note' + (mark ? ' has-author' : '') + '" data-note-id="' + esc(d.id) + '">' + mark +
      '<div class="tv-note-body"><div class="tv-note-meta">' + actor + when + '</div>' +
      (text || files ? '<div class="tv-bubble">' + (text ? '<div class="tv-note-text' + (n._undecryptable ? ' is-undecryptable">' + esc(text) : ' md" translate="no">' + md.render(text, {tasks:Workhub.views.team.canEdit() ? 'interactive' : 'static'})) + '</div>' : '') + files + '</div>' : '') +
      '</div></article>';
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

  /* Otra tarea relacionada con esta: {id, kind, task} (TaskModel.relationsOf). */
  function taskRowHtml(r){
    const s = TaskModel.statusOf(r.task.status);
    const label = {related:'Relacionada con', blockedBy:'Bloqueada por', blocks:'Bloquea a'}[r.kind];
    return '<div class="tv-link">' +
      '<span class="agenda-ring' + (s.done ? ' is-final' : '') + '" style="--st:' + s.dot + '" aria-hidden="true"></span>' +
      '<div class="tv-link-main"><div class="tv-link-title" translate="no">' + esc(r.task.title || Workhub.t('Sin título')) + '</div>' +
      '<div class="tv-link-meta">' + esc(Workhub.t(label)) + ' · <span translate="no">' + esc(s.label) + '</span></div></div>' +
      '<div class="tv-link-actions"><button type="button" class="icon-btn" data-action="open-task" data-id="' + esc(r.id) + '">' + esc(Workhub.t('Abrir')) + '</button></div>' +
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
