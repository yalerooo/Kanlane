/* Clientes. Las tareas y reuniones guardan el nombre del cliente, así que
   renombrar o eliminar un cliente se propaga a esas colecciones. */
Workhub.models.ClientModel = class ClientModel extends Workhub.models.CollectionModel {
  constructor(){
    super('clients');
  }

  /* Colores elegibles para un cliente (tono HSL). Sin color elegido, el tono
     sale del nombre, así que cada cliente tiene siempre uno estable. */
  static get COLORS(){
    return [
      {hue:0, name:'Rojo'}, {hue:24, name:'Naranja'}, {hue:42, name:'Ámbar'},
      {hue:88, name:'Lima'}, {hue:145, name:'Verde'}, {hue:172, name:'Turquesa'},
      {hue:196, name:'Cian'}, {hue:214, name:'Azul'}, {hue:238, name:'Índigo'},
      {hue:262, name:'Violeta'}, {hue:288, name:'Morado'}, {hue:328, name:'Rosa'}
    ];
  }

  /* Tono del cliente con ese nombre: el elegido o, si no hay, uno derivado del nombre. */
  hueOf(name){
    const client = this.items.find((c) => c.nombre === name);
    if(client && typeof client.color === 'number') return client.color;
    return Workhub.utils.html.hueFor(name);
  }

  /* hue: número de COLORS, o null para volver al color automático. */
  setColor(id, hue){
    return this.update(id, {color: typeof hue === 'number' ? hue : null});
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
