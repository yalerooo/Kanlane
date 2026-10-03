/* Cambio de la clave de un proyecto con cifrado total (docs/CIFRADO-PROYECTOS.md, 13.1; PR10).
   Sirve para que la clave que tuvo alguien a quien se quitó del equipo deje de valer.

   Orden, pensado para que un corte en cualquier punto no pierda nada:
     1. clave nueva (kid nuevo, mismo pid) y clave de recuperación nueva, que se enseña antes de nada;
     2. mi clave envuelta (crypto/{uid}) con la nueva y, en `old`, la anterior;
     3. en un equipo, la clave nueva para cada miembro, envuelta con su clave pública (rekey/{uid});
     4. las dos claves en este navegador;
     5. el documento del proyecto pasa a la clave nueva y apunta la anterior en enc.rot;
     6. se vuelve a cifrar todo (ProjectReseal), documento a documento;
     7. se quita enc.rot y se olvida la clave anterior.
   Si se corta antes del 5 no ha cambiado nada (readWrap deshace el paso 2). Si se corta después, el
   propietario lo termina al volver a abrir el proyecto: los pasos 6 y 7 se pueden repetir.

   Cada miembro publica su clave pública en teams/{tid}/pubkeys/{uid} al abrir el proyecto; quien no
   la tenga publicada cuando se cambia la clave pierde el acceso y hay que volver a invitarle. */
(function(){
  const P = Workhub.models.ProjectModel;
  const PC = Workhub.services.projectCrypto;
  const keystore = Workhub.services.keystore;
  const toast = Workhub.views.toast;

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  function reason(err){
    const code = err && err.code;
    if(code === 'permission-denied') return ' ' + Workhub.t('El servidor ha rechazado la operación (permission-denied): comprueba que están publicadas las reglas de firestore.rules del cifrado y que tu correo está verificado.');
    if(code === 'unavailable' || code === 'deadline-exceeded') return ' ' + Workhub.t('Parece un problema de conexión; inténtalo de nuevo.');
    return code ? ' (' + code + ')' : '';
  }

  class KeyRotationController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      /* Diálogo en curso: {id, members, doc, oldDek, priv, password, recovery}. */
      this.state = null;
      /* pid del proyecto cuya clave se está cambiando o terminando de cambiar aquí. */
      this.running = '';
      this.published = {};
      this.gaveUp = {};
    }

    get me(){
      return this.app.rootDb && this.app.rootDb.me ? this.app.rootDb.me : null;
    }

    get crypto(){
      return this.app.controllers.crypto;
    }

    project(id){
      return this.app.models.projects.get(id || this.app.projectId);
    }

    scope(id){
      return P.scope(this.app.rootDb, id);
    }

    /* Cambia la clave quien puede repartirla: el dueño de un proyecto personal o el propietario del equipo. */
    canRotate(p){
      return !!this.me && P.isEncrypted(p) && !P.isManaged(p) && (!p.team || p.role === 'owner');
    }

    /* ---------- clave pública de cada miembro ---------- */

    publishPub(projectId, pub){
      if(!P.isTeam(projectId) || !pub || !this.me) return Promise.resolve();
      return this.scope(projectId).collection('pubkeys').doc(this.me.uid)
        .set({v:1, pub:{kty:pub.kty, crv:pub.crv, x:pub.x, y:pub.y}, updatedAt:Date.now()}).catch(() => null);
    }

    /* Una vez por sesión y proyecto: si mi clave pública no está publicada (o cambió), se publica. */
    ensurePub(projectId){
      if(!P.isTeam(projectId) || this.published[projectId]) return Promise.resolve();
      this.published[projectId] = true;
      const ref = this.scope(projectId).collection('pubkeys').doc(this.me.uid);
      return Promise.all([ref.get(), this.crypto.wrapRef(projectId).get()]).then((snaps) => {
        const mine = snaps[1].exists ? (snaps[1].data() || {}).pub : null;
        if(!mine) return null;
        const cur = snaps[0].exists ? (snaps[0].data() || {}).pub : null;
        if(cur && cur.x === mine.x && cur.y === mine.y) return null;
        return this.publishPub(projectId, mine);
      }).catch(() => { delete this.published[projectId]; });
    }

    /* Claves públicas publicadas en un equipo: {uid: {pub, fp}} (fp es la huella para compararla). */
    pubkeys(projectId){
      if(!P.isTeam(projectId)) return Promise.resolve({});
      return this.scope(projectId).collection('pubkeys').get().then((snap) => {
        const out = {};
        return Promise.all(snap.docs.map((d) => {
          const pub = (d.data() || {}).pub;
          return PC.fingerprint(pub).then((fp) => { out[d.id] = {pub:pub, fp:fp}; }, () => null);
        })).then(() => out);
      });
    }

    /* Los demás miembros: [{uid, name, pub, fp}]; sin pub no pueden recibir la clave nueva. */
    members(p){
      if(!p.team) return Promise.resolve([]);
      const others = this.app.models.projects.membersOf(p).filter((m) => m.uid !== this.me.uid);
      return this.pubkeys(p.id).then((keys) => others.map((m) => {
        const k = keys[m.uid];
        return {uid:m.uid, name:m.name || m.email || '', pub:k ? k.pub : null, fp:k ? k.fp : ''};
      }));
    }

    /* Lo llama AppController al abrir un proyecto cifrado. */
    onOpen(){
      const id = this.app.projectId;
      const p = this.project(id);
      if(!this.me || !P.isEncrypted(p) || P.isManaged(p)) return;
      this.ensurePub(id);
      if(!P.isRotating(p) || !this.canRotate(p) || this.running || this.gaveUp[p.enc.pid]) return;
      const cipher = this.app.cipher;
      if(cipher && cipher.kid === p.enc.kid && cipher.canOpen(p.enc.rot.kid)){ this.resume(id); return; }
      /* Sin la clave anterior aquí no se puede terminar: al desbloquear con la contraseña se cargan las dos. */
      this.gaveUp[p.enc.pid] = true;
      toast.error(Workhub.t('El cambio de clave de «{nombre}» quedó a medias. Bloquea el proyecto y desbloquéalo con tu contraseña de cifrado para terminarlo.', {nombre:p.nombre}));
    }

    /* ---------- diálogo ---------- */

    start(projectId){
      const p = this.project(projectId);
      if(!this.canRotate(p)) return;
      /* Antes hay que terminar de cifrar lo que estaba en claro. */
      if(P.isConverting(p)){
        toast.error('Este proyecto todavía se está convirtiendo a cifrado total. Ábrelo con conexión para que termine.');
        return;
      }
      if(this.app.projectId !== p.id || !this.app.cipher){
        toast.error('Abre y desbloquea este proyecto para cambiar su clave.');
        return;
      }
      if(P.isRotating(p) || this.running){
        toast.error('Ya hay un cambio de clave en curso en este proyecto.');
        return;
      }
      this.state = {id:p.id};
      this.crypto.editing = p.id;
      this.crypto.downloadName = p.nombre;
      const s = this.state;
      this.members(p).then((list) => {
        if(this.state !== s) return;
        s.members = list;
        this.view.openRotate(list, !!p.team);
      }, () => {
        if(this.state === s) this.state = null;
        toast.error('No se pudo leer la lista de miembros. Comprueba la conexión e inténtalo de nuevo.');
      });
    }

    closed(){
      if(!this.running) this.state = null;
    }

    /* Paso 1: la contraseña abre la clave vigente (extraíble, para guardarla como anterior). */
    submit(password){
      const s = this.state;
      const p = s && this.project(s.id);
      if(!p || !this.canRotate(p)) return Promise.resolve();
      const ctx = this.crypto.ctx(p.enc);
      this.view.setDialogBusy(true);
      return this.crypto.readWrap(p.id, p.enc).then((doc) => {
        return PC.unwrapPassword(doc, password, ctx, true).then((dek) => {
          return (doc.priv ? PC.unwrapPrivate(doc, password, ctx) : Promise.resolve(null)).then((priv) => {
            if(this.state !== s) return;
            Object.assign(s, {doc:doc, oldDek:dek, priv:priv, password:password, recovery:PC.newRecoveryKey()});
            this.view.showDialogKey(s.recovery.text, 'rotate-key');
            this.view.setDialogBusy(false);
          });
        });
      }).catch((err) => {
        if(this.state !== s) return;
        this.view.setDialogBusy(false);
        this.view.showDialogError(this.crypto.message(err));
      });
    }

    /* Paso 2 (clave de recuperación confirmada): cambia la clave y vuelve a cifrar el proyecto. */
    confirm(){
      const s = this.state;
      const p = s && this.project(s.id);
      if(!p || !s.recovery || this.running) return Promise.resolve();
      const t = Workhub.t;
      let begun = null;
      this.view.setRunProgress(t('Preparando el cambio de clave…'));
      return this.begin(s).then((b) => {
        begun = b;
        return this.sweep(s.id, b.cipher, (n, total) => this.view.setRunProgress(t('Cifrando de nuevo… {n} de {total}', {n:n, total:total})), b.enc);
      }).then((res) => {
        this.running = '';
        this.state = null;
        this.view.closeDialog();
        toast.success(t('Clave de «{nombre}» cambiada', {nombre:p.nombre}), {important:true});
        this.reportSkipped(res);
      }, (err) => {
        this.running = '';
        console.error('No se pudo completar el cambio de clave:', err);
        if(begun){
          /* La clave ya es la nueva; lo que falta por cifrar de nuevo se termina al volver a abrir. */
          this.state = null;
          this.view.closeDialog();
          toast.error(t('La clave ya ha cambiado, pero no se ha terminado de cifrar todo de nuevo. Se reanudará al volver a abrir el proyecto con conexión.'));
          return;
        }
        this.view.setRunProgress('');
        this.view.showDialogError(t('No se pudo cambiar la clave.') + reason(err));
      });
    }

    reportSkipped(res){
      if(res && res.skipped) toast.error(Workhub.t('{n} elementos no se han podido descifrar con la clave anterior y siguen como estaban.', {n:res.skipped}));
    }

    /* ---------- pasos 1 a 5 ---------- */

    async begin(s){
      const p = this.project(s.id);
      const enc = p.enc;
      const uid = this.me.uid;
      if(P.isRotating(p)) throw fail('busy');
      const pid = enc.pid, kid = PC.newKid();
      const ctx = {pid:pid, kid:kid, uid:uid};
      const raw = PC.newDekBytes();
      this.running = pid;
      try{
        const key = await PC.importDek(raw);
        const kcv = await PC.kcv(key, pid, kid);
        const now = Date.now();
        const w = await Promise.all([
          PC.wrapPassword(raw, s.password, ctx, s.priv || undefined),
          PC.wrapRecovery(raw, s.recovery.bytes, ctx),
          /* La anterior, también con la clave de recuperación nueva (la vieja deja de valer). */
          PC.wrapRecovery(s.oldDek, s.recovery.bytes, {pid:pid, kid:enc.kid, uid:uid})
        ]);
        const doc = Object.assign({}, s.doc, {kid:kid, kdf:w[0].kdf, pw:w[0].pw, rk:w[1].rk, updatedAt:now}, w[0].priv ? {priv:w[0].priv} : {});
        doc.old = Object.assign({kid:enc.kid, kdf:s.doc.kdf, pw:s.doc.pw, rk:w[2].rk}, s.doc.priv ? {priv:s.doc.priv} : {});
        const rekeys = await Promise.all((s.members || []).filter((m) => m.pub).map((m) =>
          PC.wrapForMember(raw, m.pub, {pid:pid, kid:kid, uid:m.uid}).then((wr) => ({uid:m.uid, data:Object.assign({v:1, kid:kid, from:uid, createdAt:now}, wr)}))));

        await this.crypto.wrapRef(s.id).set(doc);
        const scope = this.scope(s.id);
        await Workhub.utils.pool.run(rekeys, 6, (r) => scope.collection('rekey').doc(r.uid).set(r.data));

        const rec = await keystore.get(uid, pid);
        const trusted = !!(rec && rec.trusted);
        const oldKey = await PC.importDek(s.oldDek);
        await keystore.put({uid:uid, pid:P.keySlot(pid, enc.kid), projectId:s.id, kid:enc.kid, key:oldKey, trusted:trusted});
        await keystore.put({uid:uid, pid:pid, projectId:s.id, kid:kid, key:key, trusted:trusted});

        const next = {v:enc.v, mode:enc.mode, pid:pid, kid:kid, kcv:kcv, rot:{kid:enc.kid, kcv:enc.kcv, at:now}};
        if(enc.createdAt != null) next.createdAt = enc.createdAt;
        try{
          await this.app.models.projects.update(s.id, {enc:next});
        }catch(err){
          /* No ha cambiado nada: la clave anterior vuelve a su sitio en este navegador y en mi cuenta. */
          await keystore.put({uid:uid, pid:pid, projectId:s.id, kid:enc.kid, key:oldKey, trusted:trusted}).catch(() => null);
          await keystore.forget(uid, P.keySlot(pid, enc.kid)).catch(() => null);
          await this.crypto.wrapRef(s.id).set(s.doc).catch(() => null);
          throw err;
        }
        return {enc:next, cipher:new Workhub.models.ProjectCipher({pid:pid, kid:kid, key:key, prev:[{kid:enc.kid, key:oldKey}]})};
      }catch(err){
        this.running = '';
        throw err;
      }finally{
        raw.fill(0);
      }
    }

    /* ---------- pasos 6 y 7 (se pueden repetir) ---------- */

    /* enc: el campo del proyecto con el cambio en curso (por defecto, el de la lista de proyectos). */
    async sweep(id, cipher, onProgress, enc){
      const app = this.app;
      const uid = this.me.uid;
      enc = enc || (this.project(id) || {}).enc;
      if(!P.isRotating({enc:enc}) || enc.kid !== cipher.kid || !cipher.canOpen(enc.rot.kid)) throw fail('no-old-key');
      const rotKid = enc.rot.kid;
      const teams = app.rootDb.teams;
      const reseal = new Workhub.models.ProjectReseal({
        rootDb:app.rootDb, projectId:id, cipher:cipher,
        transaction:teams && teams.runTransaction ? (fn) => teams.runTransaction(fn) : null
      });
      const res = await reseal.run(onProgress);

      /* Las versiones locales de las copias, mientras la clave anterior sigue aquí. */
      const history = Workhub.services.backupHistory;
      if(history && id === app.projectId && app.controllers.backup){
        await history.sealPlain(app.controllers.backup.scope(), cipher).catch(() => null);
      }

      const done = {v:enc.v, mode:enc.mode, pid:enc.pid, kid:enc.kid, kcv:enc.kcv};
      if(enc.createdAt != null) done.createdAt = enc.createdAt;
      await app.models.projects.update(id, {enc:done});

      /* Ya no hace falta la clave anterior: ni en mi clave envuelta ni en este navegador. */
      const ref = this.crypto.wrapRef(id);
      await ref.get().then((snap) => {
        const doc = snap.exists ? snap.data() || {} : null;
        if(!doc || !doc.old) return null;
        delete doc.old;
        return ref.set(doc);
      }).catch(() => null);
      await keystore.forget(uid, P.keySlot(enc.pid, rotKid)).catch(() => null);
      return res;
    }

    /* Termina un cambio de clave que se cortó (lo llama onOpen con las dos claves ya en este navegador). */
    resume(id){
      const p = this.project(id);
      if(!P.isRotating(p) || this.running) return Promise.resolve();
      const pid = p.enc.pid;
      this.running = pid;
      return this.sweep(id, this.app.cipher).then((res) => {
        this.running = '';
        toast.success(Workhub.t('Cambio de clave de «{nombre}» terminado', {nombre:p.nombre}), {important:true});
        this.reportSkipped(res);
      }, (err) => {
        this.running = '';
        this.gaveUp[pid] = true;
        console.error('No se pudo terminar el cambio de clave:', err);
        toast.error(Workhub.t('El cambio de clave de «{nombre}» sigue a medias: se reanudará al volver a abrir el proyecto con conexión.', {nombre:p.nombre}));
      });
    }
  }

  Workhub.controllers.KeyRotationController = KeyRotationController;
})();
