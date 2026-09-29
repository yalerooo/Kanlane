/* Diálogo para añadir o editar una persona de contacto. La lista de contactos
   se ve en la ficha de cada cliente (clients-view.js). */
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
