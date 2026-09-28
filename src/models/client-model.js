/* Clientes. Las tareas y reuniones guardan el nombre del cliente, así que
   renombrar o eliminar un cliente se propaga a esas colecciones. */
Workhub.models.ClientModel = class ClientModel extends Workhub.models.CollectionModel {
  constructor(){
    super('clients');
  }

  names(){
    return this.items.map((c) => c.nombre).filter(Boolean).sort();
  }

  sortedByName(){
    return this.items.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }

  create(name){
    return this.add({nombre:name, createdAt:Date.now()});
  }

  rename(id, newName, tasks, meetings){
    const client = this.find(id);
    if(!client) return Promise.resolve();
    const oldName = client.nombre;
    return this.update(id, {nombre:newName})
      .then(() => tasks.isReady() && tasks.updateWhere('cliente', oldName, {cliente:newName}))
      .then(() => meetings.isReady() && meetings.updateWhere('cliente', oldName, {cliente:newName}));
  }

  /* Elimina el cliente y todas sus tareas (reuniones, contactos y contraseñas se conservan). */
  removeWithTasks(id, tasks){
    const client = this.find(id);
    if(!client) return Promise.resolve();
    return tasks.removeWhere('cliente', client.nombre).then(() => this.remove(id));
  }
};
