/* Personas de contacto de cada cliente. */
Workhub.models.ContactModel = class ContactModel extends Workhub.models.CollectionModel {
  constructor(){
    super('contacts');
  }

  search(query){
    const q = (query || '').trim().toLowerCase();
    return this.items.filter((c) => {
      if(!q) return true;
      const hay = ((c.cliente || '') + ' ' + (c.nombre || '') + ' ' + (c.email || '') + ' ' + (c.telefono || '') + ' ' + (c.notas || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    }).sort((a, b) => {
      const byClient = (a.cliente || '').localeCompare(b.cliente || '');
      if(byClient !== 0) return byClient;
      return (a.nombre || '').localeCompare(b.nombre || '');
    });
  }

  lastClient(){
    return this.items.length ? this.items[this.items.length - 1].cliente : '';
  }

  save(id, body){
    body.updatedAt = Date.now();
    if(id) return this.update(id, body);
    body.createdAt = Date.now();
    return this.add(body);
  }
};
