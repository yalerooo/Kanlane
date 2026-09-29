/* Diálogo de tarea: formulario, notas con imágenes y contactos/contraseñas vinculados. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const {fmtDateTime} = Workhub.utils.dates;
  const {copyWithFeedback, showMessage} = Workhub.utils.ui;
  const platform = Workhub.services.platform;
  const VaultModel = Workhub.models.VaultModel;

  const $ = (id) => document.getElementById(id);

  class TaskDialogView {
    constructor(){
      this.dlg = $('dlg');
      this.form = $('form');
      this.title = $('dlgTitle');
      this.fields = {
        id: $('taskId'),
        title: $('fTitle'),
        desc: $('fDesc'),
        estado: $('fEstado'),
        contacto: $('fContacto'),
        fecha: $('fFecha')
      };
      this.cliente = new Workhub.views.ClientSelect('f');
      this.btnCancel = $('btnCancel');
      this.btnDelete = $('btnDelete');

      this.notesSection = $('taskNotesSection');
      this.notesList = $('taskNotesList');
      this.noteText = $('noteText');
      this.noteImageInput = $('noteImageInput');
      this.btnAttachImage = $('btnAttachImage');
      this.noteImagePreviewWrap = $('noteImagePreviewWrap');
      this.noteImagePreview = $('noteImagePreview');
      this.btnRemoveNoteImage = $('btnRemoveNoteImage');
      this.btnAddNote = $('btnAddNote');
      this.noteError = $('noteError');
      this.pendingImage = null;

      this.linksSection = $('taskLinksSection');
      this.linksSection2 = $('taskLinksSection2');
      this.linkedContactsList = $('linkedContactsList');
      this.linkContactPicker = $('linkContactPicker');
      this.linkedVaultList = $('linkedVaultList');
      this.linkVaultPicker = $('linkVaultPicker');

      this.lightbox = $('lightbox');
      this.lightboxImg = $('lightboxImg');

      this._bindLocalUi();
    }

    /* Interacciones que no tocan datos: imagen adjunta y visor de imágenes. */
    _bindLocalUi(){
      this.btnAttachImage.addEventListener('click', () => this.noteImageInput.click());
      this.noteImageInput.addEventListener('change', () => {
        const file = this.noteImageInput.files && this.noteImageInput.files[0];
        if(!file) return;
        this.pendingImage = file;
        const reader = new FileReader();
        reader.onload = () => {
          this.noteImagePreview.src = reader.result;
          this.noteImagePreviewWrap.hidden = false;
        };
        reader.readAsDataURL(file);
      });
      this.btnRemoveNoteImage.addEventListener('click', () => this._clearNoteImage());

      this.notesList.addEventListener('click', (ev) => {
        const img = closest(ev.target, 'img[data-asset-id]');
        if(img) this.openLightbox(img.currentSrc || img.src);
      });
      this.lightbox.addEventListener('click', () => {
        this.lightbox.hidden = true;
        this.lightboxImg.src = '';
      });
    }

    openLightbox(url){
      this.lightboxImg.src = url;
      this.lightbox.hidden = false;
    }

    /* ---------- Eventos hacia el controlador ---------- */

    bindSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        handler(this.fields.id.value, this.values());
      });
    }

    bindCancel(handler){ this.btnCancel.addEventListener('click', handler); }

    bindDelete(handler){
      this.btnDelete.addEventListener('click', () => handler(this.fields.id.value));
    }

    bindAddNote(handler){
      this.btnAddNote.addEventListener('click', () => {
        this.noteError.hidden = true;
        const text = this.noteText.value.trim();
        if(!text && !this.pendingImage){
          showMessage(this.noteError, 'Escribe algo o adjunta una imagen.');
          return;
        }
        handler(text, this.pendingImage);
      });
    }

    bindDeleteNote(handler){
      this.notesList.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-action="delnote"]');
        if(btn) handler(btn.getAttribute('data-id'));
      });
    }

    bindLinkPickers(onLinkContact, onLinkVault){
      this.linkContactPicker.addEventListener('change', () => {
        const id = this.linkContactPicker.value;
        this.linkContactPicker.value = '';
        if(id) onLinkContact(id);
      });
      this.linkVaultPicker.addEventListener('change', () => {
        const id = this.linkVaultPicker.value;
        this.linkVaultPicker.value = '';
        if(id) onLinkVault(id);
      });
    }

    /* handler(action, id, button) */
    bindLinkedActions(handler){
      const delegate = (ev) => {
        const btn = closest(ev.target, 'button[data-action]');
        if(btn) handler(btn.getAttribute('data-action'), btn.getAttribute('data-id'), btn);
      };
      this.linkedContactsList.addEventListener('click', delegate);
      this.linkedVaultList.addEventListener('click', delegate);
    }

    /* ---------- Estado del formulario ---------- */

    values(){
      return {
        title: this.fields.title.value.trim(),
        desc: this.fields.desc.value.trim(),
        cliente: this.cliente.value() || '',
        status: this.fields.estado.value,
        contacto: this.fields.contacto.value.trim(),
        dueDate: this.fields.fecha.value || ''
      };
    }

    openNew(clientNames, defaultCliente, status){
      this.form.reset();
      this.resetNoteForm();
      this.fields.id.value = '';
      this.title.textContent = 'Nueva tarea';
      this.fields.estado.value = status || Workhub.models.TaskModel.STATUS[0].key;
      this.cliente.reset(clientNames, defaultCliente);
      this.notesSection.hidden = true;
      this.linksSection.hidden = true;
      this.linksSection2.hidden = true;
      this.btnDelete.hidden = true;
      this.dlg.showModal();
    }

    openEdit(t, clientNames){
      this.resetNoteForm();
      this.fields.id.value = t.id;
      this.title.textContent = 'Editar tarea';
      this.fields.title.value = t.title || '';
      this.fields.desc.value = t.desc || '';
      this.fields.estado.value = Workhub.models.TaskModel.stageKey(t);
      this.fields.contacto.value = t.contacto || '';
      this.fields.fecha.value = t.dueDate || '';
      this.cliente.reset(clientNames, t.cliente || '');
      this.btnDelete.hidden = false;
      this.notesSection.hidden = false;
      this.notesList.innerHTML = 'Cargando notas…';
      this.linksSection.hidden = false;
      this.linksSection2.hidden = false;
      this.dlg.showModal();
    }

    setDueDate(date){ this.fields.fecha.value = date; }

    setCliente(clientNames, value){ this.cliente.populate(clientNames, value); }

    close(){ this.dlg.close(); }

    /* ---------- Notas ---------- */

    _clearNoteImage(){
      this.pendingImage = null;
      this.noteImageInput.value = '';
      this.noteImagePreviewWrap.hidden = true;
      this.noteImagePreview.src = '';
    }

    resetNoteForm(){
      this.noteText.value = '';
      this.noteError.hidden = true;
      this._clearNoteImage();
    }

    setAddingNote(busy){
      this.btnAddNote.disabled = busy;
      this.btnAddNote.textContent = busy ? 'Añadiendo…' : 'Añadir nota';
    }

    showNoteError(msg){ showMessage(this.noteError, msg); }

    renderNotes(docs){
      this.notesList.innerHTML = docs.length
        ? docs.map(noteHtml).join('')
        : '<p class="line" style="opacity:.65">Sin notas todavía.</p>';
      platform.hydrateAssetImages(this.notesList);
    }

    showNotesError(){
      this.notesList.innerHTML = '<p class="line" style="opacity:.65">No se pudieron cargar las notas.</p>';
    }

    /* ---------- Vínculos ---------- */

    renderLinkedContacts(linkedIds, contacts){
      if(!linkedIds.length){
        this.linkedContactsList.innerHTML = '<p class="linked-empty">Sin contactos vinculados.</p>';
      } else {
        this.linkedContactsList.innerHTML = linkedIds.map((id) => {
          const c = contacts.find((x) => x.id === id);
          if(!c) return '';
          return '<div class="linked-row" data-id="' + esc(id) + '">' +
            '<div class="linked-main"><div class="linked-title" translate="no">' + esc(c.nombre || 'Sin nombre') + '</div>' +
            '<div class="linked-meta">' + esc(c.email || c.cliente || '') + '</div></div>' +
            '<div class="linked-actions">' +
            '<button type="button" class="icon-btn" data-action="open-contact" data-id="' + esc(id) + '">Abrir</button>' +
            '<button type="button" class="icon-btn" data-action="unlink-contact" data-id="' + esc(id) + '">Quitar</button>' +
            '</div></div>';
        }).join('');
      }
      const available = contacts.filter((c) => linkedIds.indexOf(c.id) === -1)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      this.linkContactPicker.innerHTML = '<option value="">+ Vincular contacto existente…</option>' +
        available.map((c) => {
          const label = (c.nombre || 'Sin nombre') + ' — ' + (c.cliente || 'Sin cliente');
          return '<option value="' + esc(c.id) + '">' + esc(label) + '</option>';
        }).join('');
    }

    renderLinkedVault(linkedIds, vault){
      if(!linkedIds.length){
        this.linkedVaultList.innerHTML = '<p class="linked-empty">Sin contraseñas vinculadas.</p>';
      } else {
        this.linkedVaultList.innerHTML = linkedIds.map((id) => {
          const v = vault.find(id);
          if(!v) return '';
          const actionBtn = vault.unlocked
            ? '<button type="button" class="icon-btn" data-action="toggle-linked-vault" data-id="' + esc(id) + '">' + (vault.isVisible(id) ? 'Ocultar' : 'Mostrar') + '</button>'
            : '<button type="button" class="icon-btn" data-action="goto-vault" data-id="' + esc(id) + '">Desbloquear</button>';
          const copyBtn = vault.unlocked
            ? '<button type="button" class="icon-btn" data-action="copy-linked-vault" data-id="' + esc(id) + '">Copiar</button>'
            : '';
          return '<div class="linked-row" data-id="' + esc(id) + '">' +
            '<div class="linked-main"><div class="linked-title" translate="no">' + esc(VaultModel.titleFor(v)) + '</div>' +
            '<div class="linked-meta">' + esc(VaultModel.typeLabel(v.tipo)) + ' · ' + esc(v.cliente || '') + '</div></div>' +
            '<div class="linked-actions">' +
            '<span class="linked-pass">' + esc(vault.passwordText(id)) + '</span>' +
            actionBtn + copyBtn +
            '<button type="button" class="icon-btn" data-action="unlink-vault" data-id="' + esc(id) + '">Quitar</button>' +
            '</div></div>';
        }).join('');
      }
      const available = vault.items.filter((v) => linkedIds.indexOf(v.id) === -1)
        .sort((a, b) => (a.cliente || '').localeCompare(b.cliente || ''));
      this.linkVaultPicker.innerHTML = '<option value="">+ Vincular contraseña existente…</option>' +
        available.map((v) => {
          const label = VaultModel.titleFor(v) + ' — ' + VaultModel.typeLabel(v.tipo) + ' — ' + (v.cliente || 'Sin cliente');
          return '<option value="' + esc(v.id) + '">' + esc(label) + '</option>';
        }).join('');
    }

    copy(btn, text){ return copyWithFeedback(btn, text); }
  }

  function noteHtml(d){
    const n = d.data() || {};
    const img = n.imageAssetId
      ? '<img src="' + esc(platform.assetSrc(n.imageAssetId)) + '" data-asset-id="' + esc(n.imageAssetId) + '" alt="">'
      : '';
    return '<div class="note-item" data-id="' + esc(d.id) + '">' +
      '<button type="button" class="note-del" data-action="delnote" data-id="' + esc(d.id) + '">Eliminar</button>' +
      '<div class="note-date">' + esc(fmtDateTime(n.createdAt)) + '</div>' +
      (n.text ? '<div class="note-text" translate="no">' + esc(n.text) + '</div>' : '') +
      img +
      '</div>';
  }

  Workhub.views.TaskDialogView = TaskDialogView;
})();
