/* Contactos: rejilla de tarjetas y diálogo de edición. */
(function(){
  const {esc, iconSpan, closest} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  class ContactsView {
    constructor(){
      this.grid = $('contactsGrid');
      this.stateMsg = $('stateMsgContacts');
      this.search = $('searchContacts');
      this.btnNew = $('btnNewContact');

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

    bindNew(handler){ this.btnNew.addEventListener('click', () => handler()); }

    bindSearch(handler){ this.search.addEventListener('input', handler); }

    bindOpen(handler){
      this.grid.addEventListener('click', (ev) => {
        const card = closest(ev.target, '.contact-card');
        if(card) handler(card.getAttribute('data-id'));
      });
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

    query(){ return this.search.value; }

    values(){
      return {
        cliente: this.cliente.value(),
        nombre: this.fields.nombre.value.trim(),
        email: this.fields.email.value.trim(),
        telefono: this.fields.telefono.value.trim(),
        notas: this.fields.notas.value.trim()
      };
    }

    render(contacts, hasAny){
      if(!contacts.length){
        this.grid.hidden = true;
        this.stateMsg.hidden = false;
        this.stateMsg.textContent = hasAny ? 'Sin resultados para esa búsqueda.' : 'Aún no hay contactos guardados. Añade el primero.';
        return;
      }
      this.stateMsg.hidden = true;
      this.grid.hidden = false;
      this.grid.innerHTML = contacts.map(cardHtml).join('');
    }

    showError(msg){
      this.stateMsg.hidden = false;
      this.grid.hidden = true;
      this.stateMsg.textContent = msg;
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

  function cardHtml(c){
    const email = c.email ? '<p class="line">' + iconSpan('mail') + esc(c.email) + '</p>' : '';
    const tel = c.telefono ? '<p class="line">' + iconSpan('phone') + esc(c.telefono) + '</p>' : '';
    const notas = c.notas ? '<div class="notes">' + esc(c.notas) + '</div>' : '';
    return '<div class="contact-card" data-id="' + esc(c.id) + '">' +
      (c.cliente ? '<div class="cat">' + esc(c.cliente) + '</div>' : '') +
      '<h3>' + esc(c.nombre || 'Sin nombre') + '</h3>' +
      email + tel + notas +
      '</div>';
  }

  Workhub.views.ContactsView = ContactsView;
})();
