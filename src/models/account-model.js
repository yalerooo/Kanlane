/* La cuenta de quien ha entrado: su foto de perfil y el borrado de todo lo suyo.

   - Foto: una miniatura JPEG guardada en la cuenta (users/{uid}/settings/profile → {photo}), no en
     Firebase Authentication, que solo admite una dirección web. La ve solo su dueño: en los equipos
     sigue saliendo la del proveedor de acceso (o las iniciales).
   - wipe(): borra todo el contenido de la cuenta antes de eliminar la cuenta en sí (eso lo hace
     services/firebase-backend.js, que es quien la conoce). Se hace desde el navegador, con las
     mismas reglas de siempre (firestore.rules): cada cuenta solo puede borrar lo suyo. */
(function(){
  const P = Workhub.models.ProjectModel;
  const pool = Workhub.utils.pool;
  const PROFILE_PATH = 'settings/profile';
  const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
  /* Lado de la miniatura (se recorta al centro) y tope de lo que ocupa guardada. */
  const PHOTO_SIDE = 160;
  const PHOTO_MAX_CHARS = 120000;
  /* Lo que cuelga directamente de users/{uid}. Los datos de cada proyecto se van con su proyecto
     (ProjectModel.removeProject); esto recoge lo que no es de ninguno y lo que hubiera quedado suelto. */
  const ROOT_COLLECTIONS = ['tasks', 'clients', 'contacts', 'meetings', 'vault', 'vault_meta', 'plugin_data',
    'plugins', 'assets', 'settings', 'projects'];
  const LIMIT = 12;

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  class AccountModel {
    constructor(projects, team){
      this.projects = projects;
      this.team = team;
    }

    get db(){ return this.projects.rootDb; }

    static isPhoto(value){
      return typeof value === 'string' && value.length <= PHOTO_MAX_CHARS && PHOTO_RE.test(value);
    }

    /* ---------- Foto de perfil ---------- */

    /* '' si no hay ninguna propia. */
    readPhoto(){
      return this.db.doc(PROFILE_PATH).get().then((snap) => {
        const photo = snap.exists ? (snap.data() || {}).photo : '';
        return AccountModel.isPhoto(photo) ? photo : '';
      });
    }

    savePhoto(dataUrl){
      if(!AccountModel.isPhoto(dataUrl)) return Promise.reject(fail('bad-photo'));
      return this.db.doc(PROFILE_PATH).set({photo:dataUrl, updatedAt:Date.now()});
    }

    removePhoto(){
      return this.db.doc(PROFILE_PATH).delete();
    }

    /* Recorta la imagen a un cuadrado centrado de PHOTO_SIDE y la devuelve como data: URL JPEG.
       `render(sx, sy, side)` la dibuja (en el navegador, con un canvas); aquí va solo la cuenta. */
    static crop(width, height){
      if(!(width > 0) || !(height > 0)) throw fail('bad-photo');
      const side = Math.min(width, height);
      return {sx:Math.round((width - side) / 2), sy:Math.round((height - side) / 2), side:side, out:PHOTO_SIDE};
    }

    /* ---------- Nombre ---------- */

    /* El nombre visible también va en la ficha de miembro de cada equipo. Solo el propietario
       puede cambiar esa ficha (firestore.rules), así que se actualiza en los equipos propios; en
       los demás sigue el nombre con el que se entró. */
    renameInTeams(name){
      const db = this.db;
      if(!db.teams) return Promise.resolve();
      const mine = this.projects.list().filter((p) => p.team && p.role === 'owner');
      return Promise.all(mine.map((p) => db.teams.doc(p.teamId).update({['members.' + db.me.uid + '.name']: name}).catch(() => null)));
    }

    /* ---------- Eliminar la cuenta ---------- */

    /* Lo que se va a borrar, para decirlo antes: {personal, owned:[{nombre, others}], joined}. */
    summary(){
      const list = this.projects.list();
      const teams = list.filter((p) => p.team);
      return {
        personal: list.length - teams.length,
        owned: teams.filter((p) => p.role === 'owner').map((p) => ({nombre:p.nombre, others:Math.max(0, this.projects.membersOf(p).length - 1)})),
        joined: teams.filter((p) => p.role !== 'owner').length
      };
    }

    /* Borra todo el contenido de la cuenta. onStep(texto) va diciendo por dónde va.
       - Equipos ajenos: se sale de ellos. Equipos propios: se eliminan enteros (no se puede ceder
         la propiedad), con sus invitaciones.
       - Proyectos personales, con sus tareas, notas, imágenes, clientes, contactos, reuniones,
         contraseñas, datos de plugins y claves de cifrado.
       - Copias cifradas de la cuenta, preferencias, foto e invitaciones recibidas.
       Si algo falla se rechaza y la cuenta sigue existiendo: se puede repetir. */
    wipe(onStep){
      const db = this.db;
      const me = db.me.uid;
      const step = (text) => { if(onStep) onStep(text); };
      const each = (items, fn) => items.reduce((chain, item) => chain.then(() => fn(item)), Promise.resolve());
      const list = this.projects.list();
      const teams = list.filter((p) => p.team);
      const clear = (name) => {
        const col = db.collection(name);
        return col.get().then((snap) => pool.run(snap.docs, LIMIT, (d) => col.doc(d.id).delete()));
      };

      /* Primero, las direcciones de captura por correo que haya dejado en sus proyectos y equipos:
         desde aquí ya no crean tareas. Si el servidor no responde, la cuenta no se elimina (se
         puede repetir); si no tiene la captura puesta en marcha, no hay nada que retirar. */
      const capture = Workhub.services.capture;
      const purge = capture && capture.available(db)
        ? capture.call(db, {op:'purge'}).catch((err) => { if(err && err.code === 'not-configured') return null; throw err; })
        : Promise.resolve();

      step('Saliendo de tus equipos…');
      return purge.then(() => each(teams.filter((p) => p.role !== 'owner'), (p) => this.team.leave(p))).then(() => {
        step('Eliminando tus equipos…');
        return each(teams.filter((p) => p.role === 'owner'), (p) => this.projects.removeProject(p.id, db, null));
      }).then(() => {
        /* Invitaciones que me han hecho y aún no he contestado. */
        return Promise.all(this.team.incoming.items.map((inv) => this.team.decline(inv).catch(() => null)));
      }).then(() => {
        step('Eliminando tus proyectos…');
        return db.collection('projects').get();
      }).then((snap) => {
        const ids = snap.docs.map((d) => d.id).filter((id) => id !== P.MAIN_ID);
        /* El principal vive en la raíz: se vacía aunque no tenga documento. */
        return each([P.MAIN_ID].concat(ids), (id) => this.projects.removeProject(id, db, null));
      }).then(() => {
        step('Eliminando copias, preferencias e imágenes…');
        const backups = db.collection('backup_versions');
        return backups.get().then((snap) => each(snap.docs, (d) =>
          backups.doc(d.id).collection('chunks').get()
            .then((chunks) => Promise.all(chunks.docs.map((c) => backups.doc(d.id).collection('chunks').doc(c.id).delete())))
            .then(() => backups.doc(d.id).delete())));
      }).then(() => each(ROOT_COLLECTIONS, clear))
        .then(() => db.doc('crypto/' + me).delete().catch(() => null));
    }
  }

  AccountModel.PHOTO_SIDE = PHOTO_SIDE;
  Workhub.models.AccountModel = AccountModel;
})();
