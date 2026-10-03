/* Proyectos con cifrado total (docs/CIFRADO-PROYECTOS.md): crearlos, desbloquearlos con la
   contraseña o con la clave de recuperación, cambiar la contraseña, crear otra clave de recuperación
   y olvidar la clave en este navegador. Las claves las envuelve project-crypto.js, la del navegador
   la guarda keystore.js y los modelos reciben el cifrador desde AppController.connectProject().
   También los «Gestionado por Kanlane» (apartado 12): sin contraseña; la clave que envuelve la del
   proyecto la entrega el Worker de Kanlane a la cuenta con la sesión iniciada. */
(function(){
  const P = Workhub.models.ProjectModel;
  const PC = Workhub.services.projectCrypto;
  const keystore = Workhub.services.keystore;
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;

  const MSG = {
    badPassword: 'Contraseña incorrecta.',
    badRecovery: 'La clave de recuperación no es correcta.',
    read: 'No se pudo leer la clave del proyecto. Comprueba la conexión e inténtalo de nuevo.',
    noWrap: 'Tu cuenta no tiene acceso a la clave de este proyecto. Pide al propietario un código de acceso nuevo.',
    mismatch: 'Las contraseñas no coinciden.',
    save: 'No se pudo guardar el cambio. Comprueba la conexión e inténtalo de nuevo.',
    kmsNetwork: 'No se pudo contactar con el servidor de claves de Kanlane. Comprueba la conexión e inténtalo de nuevo.',
    kmsAuth: 'El servidor de claves de Kanlane no ha aceptado tu sesión. Cierra sesión, vuelve a entrar e inténtalo de nuevo.',
    kmsRate: 'Demasiadas peticiones al servidor de claves de Kanlane. Espera un minuto e inténtalo de nuevo.',
    kmsUnavailable: 'El servidor de claves de Kanlane no está disponible ahora. Inténtalo de nuevo en unos minutos.',
    kmsKey: 'La clave que ha dado el servidor de Kanlane no abre este proyecto.',
    managedNoWrap: 'No se ha encontrado la clave de este proyecto en tu cuenta.',
    rotated: 'La clave de este proyecto ha cambiado. Desbloquéalo de nuevo con tu contraseña de cifrado para recibir la nueva.',
    rotatedOut: 'El propietario ha cambiado la clave de este proyecto y tu cuenta no ha recibido la nueva. Pídele que te quite del equipo y te vuelva a invitar.',
    rotatedRecovery: 'La clave de este proyecto ha cambiado y tu clave de recuperación es anterior al cambio. Entra con tu contraseña de cifrado o pide al propietario que te quite del equipo y te vuelva a invitar.'
  };

  /* Servidor de claves del modo gestionado: el Worker de Kanlane, en el mismo dominio. */
  const KMS_URL = '/__/kms/v1/kek';
  const KEK_BYTES = 32;

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  function slug(name){
    return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proyecto';
  }

  class ProjectCryptoController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      /* Clave de recuperación ya enseñada en el asistente: si la creación falla, se reutiliza. */
      this.recovery = null;
      /* Operación a medias que espera a que se confirme la clave de recuperación nueva. */
      this.pending = null;
      this.editing = '';

      view.bind({
        unlock: (pw, trusted) => this.unlock(pw, trusted),
        recover: (key, pw, pw2, trusted) => this.recover(key, pw, pw2, trusted),
        keyDone: () => this.finishRecover(),
        check: (pw) => this.check(pw, this.currentName()),
        download: (text) => this.download(text, this.downloadName || this.currentName()),
        change: (current, next, again) => this.changePassword(current, next, again),
        newRecovery: (current) => this.newRecovery(current),
        recoveryDone: () => this.finishNewRecovery(),
        retryManaged: () => this.retryManaged(),
        rotate: (current) => this.app.controllers.rotation.submit(current),
        rotateConfirm: () => this.app.controllers.rotation.confirm(),
        rotateClosed: () => this.app.controllers.rotation.closed(),
        convert: (pw, again) => this.app.controllers.convert.submit(pw, again),
        convertConfirm: () => this.app.controllers.convert.confirm(),
        convertClosed: () => this.app.controllers.convert.closed()
      });
      /* Otra pestaña ha guardado u olvidado una clave: se desbloquea o se bloquea sola. */
      if(keystore) keystore.onChange((msg) => this.onKeysChanged(msg));
    }

    get me(){
      return this.app.rootDb && this.app.rootDb.me ? this.app.rootDb.me : null;
    }

    /* ¿Se puede ofrecer el cifrado total? Solo con cuenta, con Web Crypto y con el interruptor encendido. */
    canCreate(){
      return !!(this.me && Workhub.features && Workhub.features.encryptedProjects && PC && PC.isAvailable() && keystore);
    }

    /* ¿Se puede ofrecer «Gestionado por Kanlane»? */
    canCreateManaged(){
      return this.canCreate() && !!Workhub.features.managedEncryption && typeof this.app.rootDb.idToken === 'function';
    }

    project(id){
      return this.app.models.projects.get(id || this.app.projectId);
    }

    currentName(){
      const p = this.project(this.editing || this.app.projectId);
      return p ? p.nombre : '';
    }

    check(pw, nombre){
      return PC.passwordCheck(pw, {email:this.me ? this.me.email : '', projectName:nombre || ''});
    }

    /* Clave envuelta de mi cuenta para un proyecto. */
    wrapRef(projectId){
      return P.scope(this.app.rootDb, projectId).collection('crypto').doc(this.me.uid);
    }

    ctx(enc){
      return {pid:enc.pid, kid:enc.kid, uid:this.me.uid};
    }

    readWrap(projectId, enc){
      return this.wrapRef(projectId).get().then((snap) => snap, () => { throw fail('read'); }).then((snap) => {
        if(!snap.exists) throw fail('no-wrap');
        const doc = snap.data() || {};
        if(doc.kid === enc.kid) return doc;
        /* Un cambio de clave que se preparó y no llegó a empezar: vuelve a valer la clave anterior. */
        if(doc.old && doc.old.kid === enc.kid) return this.restoreOld(projectId, doc);
        /* La clave envuelta es de otra versión de la clave del proyecto (PR10: se cambió la clave). */
        const err = fail(doc.kid ? 'rotated' : 'no-wrap');
        err.doc = doc;
        throw err;
      });
    }

    /* Deshace en mi clave envuelta un cambio de clave que no llegó a empezar. */
    restoreOld(projectId, doc){
      const old = doc.old;
      const back = Object.assign({}, doc, {kid:old.kid, kdf:old.kdf, pw:old.pw, rk:old.rk, updatedAt:Date.now()});
      if(old.priv) back.priv = old.priv;
      delete back.old;
      return this.wrapRef(projectId).set(back).then(() => back, () => { throw fail('read'); });
    }

    /* Clave anterior del proyecto, que mi clave envuelta conserva mientras dura un cambio de clave
       (doc.old). kind: 'pw' (con la contraseña) o 'rk' (con la clave de recuperación).
       Devuelve la clave extraíble, o null si no hay o no se abre. */
    openOld(enc, doc, secret, kind){
      const old = doc && doc.old;
      if(!old || !old.kid) return Promise.resolve(null);
      const ctx = {pid:enc.pid, kid:old.kid, uid:this.me.uid};
      return Promise.resolve().then(() => (kind === 'rk'
        ? PC.unwrapRecovery({rk:old.rk}, secret, ctx, true)
        : PC.unwrapPassword({kdf:old.kdf, pw:old.pw}, secret, ctx, true))).catch(() => null);
    }

    /* La clave anterior, en su casilla de este navegador (para leer lo que aún no se ha recifrado). */
    keepPrev(id, enc, kid, key, trusted){
      const rot = enc.rot;
      if(!rot || rot.kid !== kid) return Promise.resolve(null);
      return PC.importDek(key).then((locked) => PC.checkKcv(locked, enc.pid, rot.kid, rot.kcv).then((ok) => {
        if(!ok) return null;
        return keystore.put({uid:this.me.uid, pid:P.keySlot(enc.pid, kid), projectId:id, kid:kid, key:locked, trusted:!!trusted});
      })).catch(() => null);
    }

    /* Las versiones locales de las copias selladas con la clave anterior pasan a la vigente. */
    resealHistory(id, enc, key, oldKid, oldDek){
      const history = Workhub.services.backupHistory;
      const backup = this.app.controllers.backup;
      if(!history || !backup || id !== this.app.projectId || !oldDek) return Promise.resolve();
      return PC.importDek(oldDek).then((old) => {
        const cipher = new Workhub.models.ProjectCipher({pid:enc.pid, kid:enc.kid, key:key, prev:[{kid:oldKid, key:old}]});
        return history.sealPlain(backup.scope(), cipher);
      }).catch(() => null);
    }

    message(err){
      const code = err && err.code;
      if(code === 'bad-password') return MSG.badPassword;
      if(code === 'bad-recovery') return MSG.badRecovery;
      if(code === 'no-wrap') return MSG.noWrap;
      if(code === 'rotated') return MSG.rotated;
      if(code === 'rotated-out' || code === 'bad-rekey') return MSG.rotatedOut;
      if(code === 'read') return MSG.read;
      if(code === 'bad-format' || code === 'unavailable') return MSG.read;
      if(code === 'kms-network') return MSG.kmsNetwork;
      if(code === 'kms-auth') return MSG.kmsAuth;
      if(code === 'kms-rate') return MSG.kmsRate;
      if(code === 'kms-unavailable') return MSG.kmsUnavailable;
      if(code === 'bad-kms') return MSG.kmsKey;
      return MSG.save;
    }

    /* Clave del servidor de Kanlane para un proyecto gestionado: {kek:Uint8Array(32), kmsv}.
       El servidor la deriva para esta cuenta (la del ID token), este proyecto (pid) y esta clave (kid). */
    async managedKek(ids){
      let res;
      try{
        const token = await this.app.rootDb.idToken();
        res = await fetch(KMS_URL, {
          method:'POST', cache:'no-store', credentials:'omit',
          headers:{'Content-Type':'application/json', Authorization:'Bearer ' + token},
          body:JSON.stringify({pid:ids.pid, kid:ids.kid})
        });
      }catch(err){
        throw fail('kms-network');
      }
      if(res.status === 401 || res.status === 403) throw fail('kms-auth');
      if(res.status === 429) throw fail('kms-rate');
      if(!res.ok) throw fail('kms-unavailable');
      try{
        const data = await res.json();
        if(!Number.isInteger(data.kmsv) || data.kmsv < 1) throw fail('kms-unavailable');
        return {kek:PC.fromB64url(data.kek, KEK_BYTES), kmsv:data.kmsv};
      }catch(err){
        throw fail('kms-unavailable');
      }
    }

    /* ---------- asistente «Nuevo proyecto» ---------- */

    prepare(){
      if(!this.recovery) this.recovery = PC.newRecoveryKey();
      return this.recovery.text;
    }

    resetWizard(){
      this.recovery = null;
    }

    /* Crea el proyecto cifrado y devuelve su id. d: {id?, nombre, color, config, password, trusted},
       o {id?, nombre, color, config, managed:true} para «Gestionado por Kanlane» (sin contraseña ni
       clave de recuperación: la clave del proyecto se envuelve con la que da el servidor).
       Orden (6.6 del plan): clave envuelta → clave en este navegador → documento del proyecto.
       Si falla el último paso se deshacen los dos primeros. El error lleva en .phase el paso que falló. */
    async create(d){
      let phase = 'preparar el cifrado';
      try{
        return await this._create(d, (p) => { phase = p; });
      }catch(err){
        const out = err && typeof err === 'object' ? err : new Error(String(err));
        out.phase = phase;
        console.error('No se pudo crear el proyecto cifrado (' + phase + '):', out);
        throw out;
      }
    }

    /* Texto para la persona: qué paso falló y por qué. */
    createError(err){
      const t = Workhub.t;
      const code = err && err.code;
      let why = code ? ' (' + code + ')' : '';
      if(code && String(code).indexOf('kms-') === 0) why = ' ' + t(this.message(err));
      else if(code === 'permission-denied') why = ' ' + t('El servidor ha rechazado la operación (permission-denied): comprueba que están publicadas las reglas de firestore.rules del cifrado y que tu correo está verificado.');
      else if(code === 'unavailable' || code === 'deadline-exceeded') why = ' ' + t('Parece un problema de conexión; inténtalo de nuevo.');
      else if(code === 'resource-exhausted') why = ' ' + t('Se ha superado la cuota de Firestore por hoy.');
      return t('No se pudo crear el proyecto.') + (err && err.phase ? ' ' + t('Falló al {phase}.', {phase:t(err.phase)}) : '') + why;
    }

    async _create(d, step){
      const uid = this.me.uid;
      const projects = this.app.models.projects;
      const id = d.id || projects.col.doc().id;
      const raw = PC.newDekBytes();
      const pid = PC.newPid(), kid = PC.newKid();
      const ctx = {pid:pid, kid:kid, uid:uid};
      const managed = d.managed === true;
      try{
        const key = await PC.importDek(raw);
        const check = await PC.kcv(key, pid, kid);
        let wrap;
        if(managed){
          step('pedir la clave al servidor de Kanlane');
          const server = await this.managedKek(ctx);
          wrap = await PC.wrapManaged(raw, server.kek, ctx, server.kmsv);
        }else{
          const recovery = this.recovery || PC.newRecoveryKey();
          const parts = await Promise.all([PC.wrapPassword(raw, d.password, ctx), PC.wrapRecovery(raw, recovery.bytes, ctx)]);
          wrap = {kdf:parts[0].kdf, pw:parts[0].pw, rk:parts[1].rk};
        }
        const now = Date.now();
        const ref = this.wrapRef(id);
        step('guardar la clave del proyecto');
        await ref.set(Object.assign({v:PC.VERSION, kid:kid}, wrap, {createdAt:now, updatedAt:now}));
        step('guardar la clave en este navegador');
        /* Gestionado: la clave se vuelve a pedir al servidor al entrar, así que no se queda al cerrar sesión. */
        await keystore.put({uid:uid, pid:pid, projectId:id, kid:kid, key:key, trusted:!managed && !!d.trusted});
        step('guardar el proyecto');
        const data = Object.assign({nombre:d.nombre, createdAt:id === P.MAIN_ID ? 0 : now}, d.config || {},
          {enc:{v:PC.VERSION, mode:managed ? 'managed' : 'pw', pid:pid, kid:kid, kcv:check, createdAt:now}});
        if(typeof d.color === 'number') data.color = d.color;
        try{
          await projects.set(id, data);
        }catch(err){
          keystore.forget(uid, pid).catch(() => {});
          ref.delete().catch(() => {});
          throw err;
        }
        if(!managed) this.recovery = null;
        return id;
      }finally{
        raw.fill(0);
      }
    }

    /* Archivo .txt con la clave de recuperación (8.1 del plan). */
    download(keyText, nombre){
      const t = Workhub.t;
      const en = Workhub.i18n && Workhub.i18n.lang === 'en';
      const when = new Date().toLocaleString(Workhub.i18n ? Workhub.i18n.locale : 'es-ES');
      const lines = [
        t('Kanlane · Clave de recuperación de un proyecto con cifrado total'),
        '',
        t('Proyecto: {nombre}', {nombre:nombre || ''}),
        t('Cuenta: {correo}', {correo:this.me ? this.me.email : ''}),
        t('Creada: {fecha}', {fecha:when}),
        '',
        t('Clave de recuperación:'),
        keyText,
        '',
        t('Sirve para abrir este proyecto si olvidas su contraseña de cifrado.'),
        t('Kanlane no tiene una copia y no puede recuperarla.'),
        t('Guárdala fuera de Kanlane y no la compartas.'),
        ''
      ];
      const file = (en ? 'kanlane-recovery-key-' : 'kanlane-clave-recuperacion-') + slug(nombre) + '.txt';
      return platform.download(file, lines.join('\r\n'));
    }

    /* ---------- pantalla de desbloqueo ---------- */

    /* Lo llama AppController cuando el proyecto abierto está cifrado y su clave no está aquí.
       Con cifrado total se pide la contraseña; uno gestionado se abre solo con la clave del servidor. */
    onLocked(){
      this.pending = null;
      this.editing = '';
      this.downloadName = '';
      const p = this.project();
      if(!P.isManaged(p)){
        this.view.show(this.currentName());
        /* La clave guardada aquí es de antes de un cambio de clave: se dice por qué se pide la contraseña. */
        if(P.isEncrypted(p) && this.me){
          keystore.get(this.me.uid, p.enc.pid).then((rec) => {
            if(rec && rec.kid !== p.enc.kid && p.id === this.app.projectId && !this.app.cipher && !this.pending) this.view.showRotated(p.nombre);
          }).catch(() => {});
        }
        return;
      }
      /* La clave se acaba de guardar y aun así no vale: se enseña el error en vez de pedirla sin parar. */
      const done = this.managedDone;
      if(done && done.pid === p.enc.pid && Date.now() - done.at < 10000){
        this.view.showManaged(p.nombre, false, MSG.kmsKey);
        return;
      }
      this.openManaged();
    }

    isManaged(){
      return P.isManaged(this.project());
    }

    /* Pide la clave al servidor de Kanlane, abre con ella la del proyecto y la guarda en este navegador. */
    openManaged(){
      const id = this.app.projectId;
      const p = this.project(id);
      if(!P.isManaged(p)) return Promise.resolve();
      const enc = p.enc;
      this.view.showManaged(p.nombre, true);
      if(this.managedBusy === enc.pid) return Promise.resolve();
      this.managedBusy = enc.pid;
      return this.readWrap(id, enc)
        .then((doc) => this.managedKek(enc).then((server) => PC.unwrapManaged(doc, server.kek, this.ctx(enc), false)))
        .then((key) => this.keep(id, enc, key, false))
        .then(() => {
          this.managedBusy = '';
          this.managedDone = {pid:enc.pid, at:Date.now()};
          if(id === this.app.projectId) this.app.connectProject();
        }, (err) => {
          this.managedBusy = '';
          console.error('No se pudo abrir el proyecto gestionado:', err);
          if(id !== this.app.projectId) return;
          this.view.showManaged(p.nombre, false, err && err.code === 'no-wrap' ? MSG.managedNoWrap : this.message(err));
        });
    }

    retryManaged(){
      this.managedDone = null;
      return this.openManaged();
    }

    isUnlocked(){
      return !!this.app.cipher;
    }

    focusLock(){
      this.view.focus();
    }

    unlock(password, trusted){
      const id = this.app.projectId;
      const p = this.project(id);
      if(!P.isEncrypted(p)) return Promise.resolve();
      const enc = p.enc;
      this.view.setBusy(true, 'unlock');
      let doc;
      return this.readWrap(id, enc)
        .then((d) => { doc = d; return PC.unwrapPassword(doc, password, this.ctx(enc), false); })
        .then((key) => this.keep(id, enc, key, trusted))
        .then(() => this.afterUnlock(id, enc, doc, password, trusted))
        .then(() => {
          this.view.setBusy(false);
          if(id === this.app.projectId) this.app.connectProject();
        }, (err) => {
          /* El propietario cambió la clave: la nueva me espera envuelta con mi clave pública. */
          if(err && err.code === 'rotated' && err.doc){
            return this.rekey(id, p, err.doc, password, trusted).catch((e) => {
              this.view.setBusy(false);
              this.view.showError(this.message(e && e.code === 'rotated' ? fail('rotated-out') : e));
            });
          }
          this.view.setBusy(false);
          this.view.showError(this.message(err));
        });
    }

    /* Tras abrir con la contraseña: durante un cambio de clave se guarda también la anterior; si ya
       terminó, sobra la copia que mi clave envuelta conservaba. */
    afterUnlock(id, enc, doc, password, trusted){
      if(!doc.old) return Promise.resolve();
      if(P.isRotating({enc:enc}) && doc.old.kid === enc.rot.kid){
        return this.openOld(enc, doc, password, 'pw').then((old) => (old ? this.keepPrev(id, enc, doc.old.kid, old, trusted) : null));
      }
      const clean = Object.assign({}, doc);
      delete clean.old;
      return this.wrapRef(id).set(clean).catch(() => null);
    }

    /* Miembro de un equipo tras un cambio de clave (PR10): su clave privada, que va envuelta con su
       contraseña, abre la clave nueva que le dejó el propietario en rekey/{uid}. Como la clave de
       recuperación que tenía envolvía la clave anterior, se le da una nueva antes de guardar nada. */
    async rekey(id, p, doc, password, trusted){
      const enc = p.enc;
      const uid = this.me.uid;
      /* En un proyecto personal no hay quien entregue otra clave: la envuelta no es la del proyecto. */
      if(!P.isTeam(id)) throw fail('no-wrap');
      if(!doc.priv) throw fail('rotated-out');
      let snap;
      try{ snap = await P.scope(this.app.rootDb, id).collection('rekey').doc(uid).get(); }
      catch(e){ throw fail('read'); }
      const wrap = snap.exists ? snap.data() || {} : null;
      if(!wrap || wrap.kid !== enc.kid) throw fail('rotated-out');
      const oldCtx = {pid:enc.pid, kid:doc.kid, uid:uid};
      const priv = await PC.unwrapPrivate(doc, password, oldCtx);
      const dek = await PC.unwrapFromOwner(wrap, priv, this.ctx(enc), true);
      const key = await PC.importDek(dek);
      if(!(await PC.checkKcv(key, enc.pid, enc.kid, enc.kcv))) throw fail('rotated-out');
      const oldDek = await PC.unwrapPassword(doc, password, oldCtx, true).catch(() => null);
      if(id !== this.app.projectId) return;
      const rk = PC.newRecoveryKey();
      this.pending = {id:id, enc:enc, doc:doc, dek:dek, password:password, recovery:rk, trusted:trusted,
        priv:priv, oldDek:oldDek, oldKid:doc.kid};
      this.downloadName = p.nombre;
      this.view.setBusy(false);
      this.view.showKey(rk.text, 'El propietario ha cambiado la clave de este proyecto. Tu clave de recuperación anterior ya no sirve: guarda esta nueva.');
    }

    /* Comprueba que la clave es la del proyecto y la guarda en este navegador. */
    keep(id, enc, key, trusted){
      return PC.checkKcv(key, enc.pid, enc.kid, enc.kcv).then((ok) => {
        if(!ok) throw fail('no-wrap');
        return keystore.put({uid:this.me.uid, pid:enc.pid, projectId:id, kid:enc.kid, key:key, trusted:!!trusted});
      });
    }

    /* «He olvidado la contraseña»: con la clave de recuperación se elige una contraseña nueva. La
       clave de recuperación nueva se enseña antes de guardar nada; la anterior deja de valer al confirmar. */
    recover(keyText, password, again, trusted){
      const id = this.app.projectId;
      const p = this.project(id);
      if(!P.isEncrypted(p)) return Promise.resolve();
      const enc = p.enc;
      const bytes = PC.parseRecoveryKey(keyText);
      if(!bytes){ this.view.showRecoverError(MSG.badRecovery); return Promise.resolve(); }
      const res = this.check(password, p.nombre);
      if(!res.ok){ this.view.showRecoverError(res.message); return Promise.resolve(); }
      if(password !== again){ this.view.showRecoverError(MSG.mismatch); return Promise.resolve(); }
      this.view.setBusy(true, 'recover');
      let doc;
      return this.readWrap(id, enc)
        .then((d) => { doc = d; return PC.unwrapRecovery(doc, bytes, this.ctx(enc), true); })
        .then((dek) => this.openOld(enc, doc, bytes, 'rk').then((oldDek) => {
          const rk = PC.newRecoveryKey();
          this.pending = {id:id, enc:enc, doc:doc, dek:dek, password:password, recovery:rk, trusted:trusted,
            oldDek:oldDek, oldKid:doc.old ? doc.old.kid : ''};
          this.downloadName = p.nombre;
          this.view.setBusy(false);
          this.view.showKey(rk.text);
        }), (err) => {
          this.view.setBusy(false);
          this.view.showRecoverError(err && err.code === 'rotated' ? MSG.rotatedRecovery : this.message(err));
        });
    }

    /* Guarda mi clave envuelta con la contraseña y la clave de recuperación nuevas. Lo usan «He
       olvidado la contraseña» y la entrada de un miembro tras un cambio de clave (s.priv: conserva su
       par de claves; s.oldDek: la clave anterior, que se guarda mientras dure el cambio). */
    finishRecover(){
      const s = this.pending;
      if(!s) return Promise.resolve();
      const ctx = this.ctx(s.enc);
      const rotating = P.isRotating({enc:s.enc}) && !!s.oldDek && s.enc.rot.kid === s.oldKid;
      const oldCtx = {pid:s.enc.pid, kid:s.oldKid, uid:ctx.uid};
      let newPub = null;
      let key;
      this.view.setBusy(true, 'recover');
      /* El par de claves de un miembro de equipo iba envuelto con la contraseña olvidada: se crea otro. */
      return (s.priv ? Promise.resolve({pub:s.doc.pub, priv:s.priv}) : (s.doc.priv || s.doc.pub ? PC.newKeyPair() : Promise.resolve(null)))
        .then((pair) => Promise.all([
          PC.wrapPassword(s.dek, s.password, ctx, pair ? pair.priv : undefined),
          PC.wrapRecovery(s.dek, s.recovery.bytes, ctx),
          rotating ? PC.wrapPassword(s.oldDek, s.password, oldCtx) : null,
          rotating ? PC.wrapRecovery(s.oldDek, s.recovery.bytes, oldCtx) : null
        ]).then((w) => {
          const doc = Object.assign({}, s.doc, {kid:s.enc.kid, kdf:w[0].kdf, pw:w[0].pw, rk:w[1].rk, updatedAt:Date.now()},
            pair ? {pub:pair.pub, priv:w[0].priv} : {});
          delete doc.old;
          if(rotating) doc.old = {kid:s.oldKid, kdf:w[2].kdf, pw:w[2].pw, rk:w[3].rk};
          if(pair && !s.priv) newPub = pair.pub;
          return this.wrapRef(s.id).set(doc);
        }))
        .then(() => PC.importDek(s.dek))
        .then((k) => { key = k; return this.keep(s.id, s.enc, key, s.trusted); })
        .then(() => (rotating ? this.keepPrev(s.id, s.enc, s.oldKid, s.oldDek, s.trusted) : null))
        .then(() => this.resealHistory(s.id, s.enc, key, s.oldKid, s.oldDek))
        .then(() => {
          /* Par de claves nuevo: se publica la clave pública para futuros cambios de clave. */
          const rotation = this.app.controllers.rotation;
          if(newPub && rotation) rotation.publishPub(s.id, newPub);
          this.pending = null;
          this.view.setBusy(false);
          if(s.id === this.app.projectId) this.app.connectProject();
        }, (err) => {
          this.view.setBusy(false);
          this.view.showKeyError(this.message(err));
        });
    }

    /* ---------- ajustes de privacidad del proyecto («Editar proyecto») ---------- */

    /* kind: 'password' | 'recovery' | 'forget' | 'rotate'. */
    action(kind, projectId){
      const p = this.project(projectId);
      if(!P.isEncrypted(p) || P.isManaged(p)) return;
      if(kind === 'forget'){ this.forgetKey(p.id); return; }
      if(kind === 'rotate'){ this.app.controllers.rotation.start(p.id); return; }
      this.editing = p.id;
      this.downloadName = p.nombre;
      if(kind === 'password') this.view.openPassword();
      else this.view.openRecovery();
    }

    changePassword(current, next, again){
      const p = this.project(this.editing);
      if(!P.isEncrypted(p)) return Promise.resolve();
      const res = this.check(next, p.nombre);
      if(!res.ok){ this.view.showDialogError(res.message); return Promise.resolve(); }
      if(next !== again){ this.view.showDialogError(MSG.mismatch); return Promise.resolve(); }
      const ctx = this.ctx(p.enc);
      let doc;
      this.view.setDialogBusy(true);
      return this.readWrap(p.id, p.enc)
        .then((d) => { doc = d; return PC.unwrapPassword(doc, current, ctx, true); })
        /* La clave privada del miembro (equipos) va envuelta con la contraseña: se envuelve con la nueva. */
        .then((dek) => (doc.priv ? PC.unwrapPrivate(doc, current, ctx) : Promise.resolve(null))
          .then((priv) => PC.wrapPassword(dek, next, ctx, priv || undefined)))
        /* Cambio de clave a medias: la clave anterior también pasa a la contraseña nueva. */
        .then((w) => this.openOld(p.enc, doc, current, 'pw')
          .then((oldDek) => (oldDek ? PC.wrapPassword(oldDek, next, {pid:p.enc.pid, kid:doc.old.kid, uid:ctx.uid}) : null))
          .then((o) => {
            const out = Object.assign({}, doc, {kdf:w.kdf, pw:w.pw, updatedAt:Date.now()}, w.priv ? {priv:w.priv} : {});
            delete out.old;
            if(o) out.old = Object.assign({}, doc.old, {kdf:o.kdf, pw:o.pw});
            /* La clave privada de antes del cambio iba con la contraseña anterior: ya no hace falta. */
            if(out.old) delete out.old.priv;
            return this.wrapRef(p.id).set(out);
          }))
        .then(() => {
          this.view.closeDialog();
          toast.success('Contraseña de cifrado cambiada', {important:true});
        }, (err) => {
          this.view.setDialogBusy(false);
          this.view.showDialogError(this.message(err));
        });
    }

    newRecovery(current){
      const p = this.project(this.editing);
      if(!P.isEncrypted(p)) return Promise.resolve();
      let doc;
      this.view.setDialogBusy(true);
      return this.readWrap(p.id, p.enc)
        .then((d) => { doc = d; return PC.unwrapPassword(doc, current, this.ctx(p.enc), true); })
        .then((dek) => this.openOld(p.enc, doc, current, 'pw').then((oldDek) => {
          const rk = PC.newRecoveryKey();
          this.pending = {id:p.id, enc:p.enc, doc:doc, dek:dek, recovery:rk, oldDek:oldDek};
          this.view.showDialogKey(rk.text);
          this.view.setDialogBusy(false);
        }), (err) => {
          this.view.setDialogBusy(false);
          this.view.showDialogError(this.message(err));
        });
    }

    finishNewRecovery(){
      const s = this.pending;
      if(!s) return Promise.resolve();
      this.view.setDialogBusy(true);
      /* Cambio de clave a medias: la clave anterior también se envuelve con la clave de recuperación nueva. */
      const old = s.oldDek && s.doc.old
        ? PC.wrapRecovery(s.oldDek, s.recovery.bytes, {pid:s.enc.pid, kid:s.doc.old.kid, uid:this.me.uid})
        : Promise.resolve(null);
      return Promise.all([PC.wrapRecovery(s.dek, s.recovery.bytes, this.ctx(s.enc)), old])
        .then((w) => {
          const out = Object.assign({}, s.doc, {rk:w[0].rk, updatedAt:Date.now()});
          delete out.old;
          if(w[1]) out.old = Object.assign({}, s.doc.old, {rk:w[1].rk});
          return this.wrapRef(s.id).set(out);
        })
        .then(() => {
          this.pending = null;
          this.view.closeDialog();
          toast.success('Clave de recuperación nueva creada. La anterior ya no sirve.', {important:true});
        }, (err) => {
          this.view.setDialogBusy(false);
          this.view.showDialogError(this.message(err));
        });
    }

    /* «Olvidar la clave en este navegador» y «Bloquear este proyecto». */
    forgetKey(projectId){
      const p = this.project(projectId);
      if(!P.isEncrypted(p) || !this.me) return Promise.resolve();
      const prev = P.isRotating(p) ? keystore.forget(this.me.uid, P.keySlot(p.enc.pid, p.enc.rot.kid)) : Promise.resolve();
      return prev.then(() => keystore.forget(this.me.uid, p.enc.pid)).then(() => {
        if(p.id === this.app.projectId) this.app.connectProject();
      });
    }

    lock(){
      return this.forgetKey(this.app.projectId);
    }

    onKeysChanged(msg){
      if(!this.me) return;
      const p = this.project();
      if(!P.isEncrypted(p)) return;
      if(msg && msg.pid && msg.pid !== p.enc.pid) return;
      /* Desbloqueado y otra pestaña guarda la clave: no hay nada que cambiar. */
      if(this.app.cipher && msg && msg.type !== 'forget') return;
      this.app.connectProject();
    }
  }

  Workhub.controllers.ProjectCryptoController = ProjectCryptoController;
})();
