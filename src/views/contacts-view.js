/* Personas de contacto: el diálogo para ver una (a quién escribir o llamar, sus datos y sus
   notas) y el de añadirla o editarla. La lista se ve en el perfil de cada cliente
   (clients-view.js). */
(function(){
  const $ = (id) => document.getElementById(id);

  class ContactsView {
    constructor(){
      this.dlg = $('dlgContact');
      this.form = $('formContact');
      this.title = $('dlgContactTitle');
      this.fields = {
        id: $('cId'),
        nombre: $('cNombre'),
        email: $('cEmail'),
        telefono: $('cTelefono'),
        notas: $('cNotas')
      };
      this.cliente = new Workhub.views.ClientSelect('c');
      this.btnCancel = $('btnCancelContact');
      this.btnDelete = $('btnDeleteContact');

      this.btnCancel.addEventListener('click', () => this.close());

      /* Ver un contacto. */
      this.viewDlg = $('dlgContactView');
      this.cv = {
        cliente: $('cvCliente'), avatar: $('cvAvatar'), name: $('cvName'),
        actions: $('cvActions'), mail: $('cvMail'), call: $('cvCall'),
        data: $('cvData'), emailRow: $('cvEmailRow'), email: $('cvEmail'), phoneRow: $('cvPhoneRow'), phone: $('cvPhone'),
        none: $('cvNoData'), notasWrap: $('cvNotasWrap'), notas: $('cvNotas')
      };
      const copy = Workhub.utils.ui.copyWithFeedback;
      $('cvCopyEmail').addEventListener('click', (ev) => copy(ev.currentTarget, this.cv.email.textContent));
      $('cvCopyPhone').addEventListener('click', (ev) => copy(ev.currentTarget, this.cv.phone.textContent));
      $('btnCvClose').addEventListener('click', () => this.closeDetail());
    }

    /* handler(id): «Editar» desde la ficha del contacto. */
    bindDetailEdit(handler){
      $('btnCvEdit').addEventListener('click', () => handler(this.viewDlg.getAttribute('data-id')));
    }

    /* hue: el color del cliente (null si el contacto no tiene cliente). */
    openDetail(c, hue){
      const {initials, hueFor} = Workhub.utils.html;
      const cv = this.cv;
      const name = c.nombre || Workhub.t('Sin nombre');
      this.viewDlg.setAttribute('data-id', c.id);
      cv.cliente.textContent = c.cliente || Workhub.t('Sin cliente');
      cv.cliente.classList.toggle('is-none', hue === null);
      if(hue !== null) cv.cliente.style.setProperty('--h', hue);
      cv.avatar.style.setProperty('--h', hueFor(name));
      cv.avatar.textContent = initials(c.nombre);
      cv.name.textContent = name;
      const phoneHref = String(c.telefono || '').replace(/[^\d+]/g, '');
      cv.mail.hidden = !c.email;
      if(c.email) cv.mail.href = 'mailto:' + encodeURI(c.email);
      else cv.mail.removeAttribute('href');
      cv.call.hidden = !phoneHref;
      if(phoneHref) cv.call.href = 'tel:' + phoneHref;
      else cv.call.removeAttribute('href');
      /* Si no hay correo, «Llamar» pasa a ser la acción principal. */
      cv.call.classList.toggle('btn-primary', !c.email);
      cv.call.classList.toggle('btn-ghost', !!c.email);
      cv.actions.hidden = !c.email && !phoneHref;
      cv.emailRow.hidden = !c.email;
      cv.email.textContent = c.email || '';
      cv.phoneRow.hidden = !c.telefono;
      cv.phone.textContent = c.telefono || '';
      cv.data.hidden = !c.email && !c.telefono;
      cv.none.hidden = !!(c.email || c.telefono);
      cv.notasWrap.hidden = !c.notas;
      cv.notas.textContent = c.notas || '';
      if(!this.viewDlg.open) this.viewDlg.showModal();
    }

    closeDetail(){
      if(this.viewDlg.open) this.viewDlg.close();
    }

    bindSubmit(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        handler(this.fields.id.value, this.values());
      });
    }

    bindDelete(handler){
      this.btnDelete.addEventListener('click', () => handler(this.fields.id.value));
    }

    values(){
      return {
        cliente: this.cliente.value(),
        nombre: this.fields.nombre.value.trim(),
        email: this.fields.email.value.trim(),
        telefono: this.fields.telefono.value.trim(),
        notas: this.fields.notas.value.trim()
      };
    }

    openNew(clientNames, defaultCliente){
      this.form.reset();
      this.fields.id.value = '';
      this.title.textContent = 'Nuevo contacto';
      this.cliente.reset(clientNames, defaultCliente);
      this.btnDelete.hidden = true;
      this.dlg.showModal();
    }

    openEdit(c, clientNames){
      this.fields.id.value = c.id;
      this.title.textContent = 'Editar contacto';
      this.cliente.reset(clientNames, c.cliente || '');
      this.fields.nombre.value = c.nombre || '';
      this.fields.email.value = c.email || '';
      this.fields.telefono.value = c.telefono || '';
      this.fields.notas.value = c.notas || '';
      this.btnDelete.hidden = false;
      this.dlg.showModal();
    }

    close(){ this.dlg.close(); }
  }

  Workhub.views.ContactsView = ContactsView;
})();
