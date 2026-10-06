/* Recifrado de un proyecto entero con la clave vigente (docs/CIFRADO-PROYECTOS.md, apartado 13):
   - al cambiar la clave (PR10), lo sellado con la anterior se abre y se vuelve a sellar con la nueva;
   - lo que esté en claro dentro de un proyecto cifrado se sella.
   Recorre tareas (con sus notas), clientes, contactos, reuniones, datos de plugins, el cofre (solo en
   proyectos personales) y las imágenes. Va documento a documento, sin lotes (límite de las reglas en
   equipos), y se puede repetir las veces que haga falta: lo que ya está con la clave vigente se salta,
   así que una pasada cortada se reanuda sin más.

   Lo que no se puede abrir con ninguna de las claves del cifrador se deja como está y se cuenta en
   .skipped: ya era ilegible antes. */
(function(){
  const PM = Workhub.models.ProjectModel;
  const Cipher = Workhub.models.ProjectCipher;
  const COLLECTIONS = ['clients', 'contacts', 'meetings', 'plugin_data', 'vault', 'tasks'];
  const CONCURRENCY = 12;
  const JPEG_PREFIX = 'data:image/jpeg;base64,';

  class ProjectReseal {
    /* o: {rootDb, projectId, cipher, transaction}. cipher lleva la clave vigente y, en prev, las
       anteriores. transaction(fn) es opcional: con ella cada documento se lee y se escribe en una
       transacción, para no pisar un cambio que otra persona haga a la vez. */
    constructor(o){
      this.rootDb = o.rootDb;
      this.projectId = o.projectId;
      this.cipher = o.cipher;
      this.transaction = o.transaction || null;
      this.team = PM.isTeam(o.projectId);
      this.db = PM.scope(o.rootDb, o.projectId);
    }

    /* ¿Hay que tocar este documento? */
    needs(raw, kind){
      if(!raw) return false;
      /* Las marcas de instalación de plugins van en claro también en un proyecto cifrado. */
      if(kind === 'doc' && raw._kind) return false;
      return !this.cipher.isSealed(raw) || raw.kid !== this.cipher.kid;
    }

    /* Todo lo que hay en el proyecto: [{ref, path, id, kind, raw}]. */
    list(){
      const db = this.db;
      const jobs = [];
      const assetIds = {};
      return Promise.all(COLLECTIONS.map((name) => db.collection(name).get().then((snap) => {
        const more = [];
        snap.docs.forEach((d) => {
          jobs.push({ref:db.collection(name).doc(d.id), path:name, id:d.id, kind:'doc', raw:d.data() || {}});
          if(name !== 'tasks') return;
          const path = 'tasks/' + d.id + '/notes';
          more.push(db.collection(path).get().then((notes) => notes.docs.forEach((n) => {
            const raw = n.data() || {};
            if(raw.imageAssetId) assetIds[raw.imageAssetId] = true;
            jobs.push({ref:db.collection(path).doc(n.id), path:path, id:n.id, kind:'doc', raw:raw});
          })));
        });
        return Promise.all(more);
      }))).then(() => {
        /* Imágenes: las de un equipo están todas en su colección; las de un proyecto personal son de
           la cuenta, así que solo se tocan las que enlazan sus notas. */
        if(this.team){
          return db.collection('assets').get().then((snap) => snap.docs.forEach((d) => {
            jobs.push({ref:db.collection('assets').doc(d.id), path:'assets', id:d.id, kind:'asset', raw:d.data() || {}});
          }));
        }
        const assets = this.rootDb.collection('assets');
        return Promise.all(Object.keys(assetIds).map((id) => assets.doc(id).get().then((snap) => {
          if(snap.exists) jobs.push({ref:assets.doc(id), path:'assets', id:id, kind:'asset', raw:snap.data() || {}});
        })));
      }).then(() => jobs);
    }

    /* Documento tal como está guardado → {op, data} con lo que hay que escribir. */
    recode(job, raw){
      const cipher = this.cipher;
      const sealed = cipher.isSealed(raw);
      if(job.kind === 'asset'){
        const bytes = sealed ? cipher.openBytes('assets', job.id, raw) : Promise.resolve().then(() => {
          if(typeof raw.data !== 'string' || raw.data.indexOf(JPEG_PREFIX) !== 0) throw Cipher.error('undecryptable');
          return Workhub.services.crypto.b64decode(raw.data.slice(JPEG_PREFIX.length));
        });
        return bytes.then((b) => cipher.sealBytes('assets', job.id, b)).then((s) => (sealed
          ? {op:'update', data:s}
          : {op:'set', data:Object.assign({createdAt:raw.createdAt || Date.now()}, s)}));
      }
      if(sealed){
        return cipher.open(job.path, job.id, raw).then((r) => cipher.sealSecret(job.path, job.id, r.plain))
          .then((s) => ({op:'update', data:s}));
      }
      const data = Object.assign({}, raw);
      /* Restos de un enlace con GitHub que ya no existe: un proyecto cifrado no los admite. */
      if(job.path === 'tasks') Object.keys(data).forEach((k) => { if(/^gh[A-Z]/.test(k)) delete data[k]; });
      return cipher.seal(job.path, job.id, data).then((doc) => ({op:'set', data:doc}));
    }

    /* → 'changed' | 'same' | 'skipped'. */
    one(job){
      const apply = (raw, write) => {
        if(!this.needs(raw, job.kind)) return Promise.resolve('same');
        return this.recode(job, raw).then((w) => { write(w); return 'changed'; });
      };
      const run = this.transaction
        ? this.transaction((tx) => tx.get(job.ref).then((snap) => apply(snap.exists ? snap.data() || {} : null, (w) => tx[w.op](job.ref, w.data))))
        : job.ref.get().then((snap) => {
          let pending = null;
          return apply(snap.exists ? snap.data() || {} : null, (w) => { pending = w; })
            .then((res) => (pending ? job.ref[pending.op](pending.data).then(() => res) : res));
        });
      return run.catch((err) => {
        /* No se abre con ninguna clave o no cabe sellado: se deja como está. */
        if(Cipher.isError(err, 'undecryptable') || Cipher.isError(err, 'too-large')) return 'skipped';
        throw err;
      });
    }

    /* Una pasada. onProgress(hechos, total). Devuelve {total, changed, skipped}: total son los
       documentos que había que tocar. Si falla la red se rechaza y lo hecho, hecho está. */
    pass(onProgress){
      return this.list().then((all) => {
        const jobs = all.filter((j) => this.needs(j.raw, j.kind));
        const out = {total:jobs.length, changed:0, skipped:0};
        if(onProgress) onProgress(0, jobs.length);
        return Workhub.utils.pool.run(jobs, CONCURRENCY, (job) => this.one(job).then((res) => {
          if(res === 'changed') out.changed++;
          else if(res === 'skipped') out.skipped++;
        }), (n) => { if(onProgress) onProgress(n, jobs.length); }).then(() => out);
      });
    }

    /* Pasadas hasta que no quede nada por cambiar (otra pestaña pudo escribir a la vez con la clave
       anterior). Devuelve {changed, skipped}: skipped es lo que sigue sin poder leerse. */
    run(onProgress){
      const total = {changed:0, skipped:0};
      const again = (left) => this.pass(onProgress).then((res) => {
        total.changed += res.changed;
        total.skipped = res.skipped;
        if(res.changed && left > 1) return again(left - 1);
        return total;
      });
      return again(4);
    }
  }

  Workhub.models.ProjectReseal = ProjectReseal;
})();
