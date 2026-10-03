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

  /* related: modelos que guardan el nombre del cliente (tareas, reuniones,
     contactos, contraseñas); todos pasan a usar el nombre nuevo. */
  rename(id, newName, related, onProgress){
    const client = this.find(id);
    if(!client) return Promise.resolve();
    const oldName = client.nombre;
    if(this.cipher) return this._renameSealed(id, oldName, newName, related || [], onProgress);
    return this.update(id, {nombre:newName}).then(() => Promise.all((related || []).map((model) =>
      model.isReady() ? model.updateWhere('cliente', oldName, {cliente:newName}) : null)));
  }

  /* Proyecto con cifrado total: el servidor no ve el nombre del cliente, así que cada documento se
     vuelve a cifrar de uno en uno. Primero lo relacionado y al final el cliente: si algo falla, el
     cliente conserva su nombre y repetir el cambio termina lo que quedó. onProgress(hechos, total). */
  _renameSealed(id, oldName, newName, related, onProgress){
    const models = related.filter((model) => model.isReady());
    const total = models.reduce((n, model) => n + model.items.filter((x) => !x._undecryptable && x.cliente === oldName).length, 0);
    let before = 0;
    let pending = 0;
    let chain = Promise.resolve();
    models.forEach((model) => {
      chain = chain.then(() => {
        let mine = 0;
        return model.updateWhere('cliente', oldName, {cliente:newName}, (done) => {
          mine = done;
          if(onProgress) onProgress(before + done, total);
        }).catch((err) => {
          if(!Workhub.models.ProjectCipher.isError(err, 'partial')) throw err;
          pending += err.pending;
        }).then(() => { before += mine; });
      });
    });
    return chain.then(() => {
      if(pending) throw Workhub.models.ProjectCipher.error('partial', {pending:pending, total:total});
      return this.update(id, {nombre:newName});
    });
  }

  /* Elimina el cliente y todas sus tareas (reuniones, contactos y contraseñas se conservan).
     Si no se pudieron borrar todas las tareas (proyecto cifrado), el cliente se conserva. */
  removeWithTasks(id, tasks, onProgress){
    const client = this.find(id);
    if(!client) return Promise.resolve();
    return tasks.removeWhere('cliente', client.nombre, onProgress).then(() => this.remove(id));
  }
};
