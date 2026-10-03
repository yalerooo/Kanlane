/* Proyectos con cifrado total (docs/CIFRADO-PROYECTOS.md): crearlos, desbloquearlos con la
   contraseña o con la clave de recuperación, cambiar la contraseña, crear otra clave de recuperación
   y olvidar la clave en este navegador. Las claves las envuelve project-crypto.js, la del navegador
   la guarda keystore.js y los modelos reciben el cifrador desde AppController.connectProject(). */
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
    save: 'No se pudo guardar el cambio. Comprueba la conexión e inténtalo de nuevo.'
  };

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
        recoveryDone: () => this.finishNewRecovery()
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
      return this.wrapRef(projectId).get().then((snap) => {
        if(!snap.exists) throw fail('no-wrap');
        const doc = snap.data() || {};
        /* La clave envuelta es de otra versión de la clave del proyecto. */
        if(doc.kid !== enc.kid) throw fail('no-wrap');
        return doc;
      }, () => { throw fail('read'); });
    }

    message(err){
      const code = err && err.code;
      if(code === 'bad-password') return MSG.badPassword;
      if(code === 'bad-recovery') return MSG.badRecovery;
      if(code === 'no-wrap') return MSG.noWrap;
      if(code === 'read') return MSG.read;
      if(code === 'bad-format' || code === 'unavailable') return MSG.read;
      return MSG.save;
    }

    /* ---------- asistente «Nuevo proyecto» ---------- */

    prepare(){
      if(!this.recovery) this.recovery = PC.newRecoveryKey();
      return this.recovery.text;
    }

    resetWizard(){
      this.recovery = null;
    }

    /* Crea el proyecto cifrado y devuelve su id. d: {id?, nombre, color, config, password, trusted}.
       Orden (6.6 del plan): clave envuelta → clave en este navegador → documento del proyecto.
       Si falla el último paso se deshacen los dos primeros. */
    async create(d){
      const uid = this.me.uid;
      const projects = this.app.models.projects;
      const id = d.id || projects.col.doc().id;
      const raw = PC.newDekBytes();
      const pid = PC.newPid(), kid = PC.newKid();
      const ctx = {pid:pid, kid:kid, uid:uid};
      const recovery = this.recovery || PC.newRecoveryKey();
      try{
        const key = await PC.importDek(raw);
        const parts = await Promise.all([
          PC.wrapPassword(raw, d.password, ctx),
          PC.wrapRecovery(raw, recovery.bytes, ctx),
          PC.kcv(key, pid, kid)
        ]);
        const now = Date.now();
        const ref = this.wrapRef(id);
        await ref.set({v:PC.VERSION, kid:kid, kdf:parts[0].kdf, pw:parts[0].pw, rk:parts[1].rk, createdAt:now, updatedAt:now});
        await keystore.put({uid:uid, pid:pid, projectId:id, kid:kid, key:key, trusted:!!d.trusted});
        const data = Object.assign({nombre:d.nombre, createdAt:id === P.MAIN_ID ? 0 : now}, d.config || {},
          {enc:{v:PC.VERSION, mode:'pw', pid:pid, kid:kid, kcv:parts[2], createdAt:now}});
        if(typeof d.color === 'number') data.color = d.color;
        try{
          await projects.set(id, data);
        }catch(err){
          keystore.forget(uid, pid).catch(() => {});
          ref.delete().catch(() => {});
          throw err;
        }
        this.recovery = null;
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

    /* Lo llama AppController cuando el proyecto abierto está cifrado y su clave no está aquí. */
    onLocked(){
      this.pending = null;
      this.editing = '';
      this.downloadName = '';
      this.view.show(this.currentName());
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
      return this.readWrap(id, enc)
        .then((doc) => PC.unwrapPassword(doc, password, this.ctx(enc), false))
        .then((key) => this.keep(id, enc, key, trusted))
        .then(() => {
          this.view.setBusy(false);
          if(id === this.app.projectId) this.app.connectProject();
        }, (err) => {
          this.view.setBusy(false);
          this.view.showError(this.message(err));
        });
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
        .then((dek) => {
          const rk = PC.newRecoveryKey();
          this.pending = {id:id, enc:enc, doc:doc, dek:dek, password:password, recovery:rk, trusted:trusted};
          this.downloadName = p.nombre;
          this.view.setBusy(false);
          this.view.showKey(rk.text);
        }, (err) => {
          this.view.setBusy(false);
          this.view.showRecoverError(this.message(err));
        });
    }

    finishRecover(){
      const s = this.pending;
      if(!s) return Promise.resolve();
      const ctx = this.ctx(s.enc);
      this.view.setBusy(true, 'recover');
      /* El par de claves de un miembro de equipo iba envuelto con la contraseña olvidada: se crea otro. */
      return (s.doc.priv || s.doc.pub ? PC.newKeyPair() : Promise.resolve(null))
        .then((pair) => Promise.all([PC.wrapPassword(s.dek, s.password, ctx, pair ? pair.priv : undefined), PC.wrapRecovery(s.dek, s.recovery.bytes, ctx)])
          .then((w) => this.wrapRef(s.id).set(Object.assign({}, s.doc, {kdf:w[0].kdf, pw:w[0].pw, rk:w[1].rk, updatedAt:Date.now()},
            pair ? {pub:pair.pub, priv:w[0].priv} : {}))))
        .then(() => PC.importDek(s.dek))
        .then((key) => this.keep(s.id, s.enc, key, s.trusted))
        .then(() => {
          this.pending = null;
          this.view.setBusy(false);
          if(s.id === this.app.projectId) this.app.connectProject();
        }, (err) => {
          this.view.setBusy(false);
          this.view.showKeyError(this.message(err));
        });
    }

    /* ---------- ajustes de privacidad del proyecto («Editar proyecto») ---------- */

    /* kind: 'password' | 'recovery' | 'forget'. */
    action(kind, projectId){
      const p = this.project(projectId);
      if(!P.isEncrypted(p)) return;
      if(kind === 'forget'){ this.forgetKey(p.id); return; }
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
        .then((w) => this.wrapRef(p.id).set(Object.assign({}, doc, {kdf:w.kdf, pw:w.pw, updatedAt:Date.now()}, w.priv ? {priv:w.priv} : {})))
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
        .then((dek) => {
          const rk = PC.newRecoveryKey();
          this.pending = {id:p.id, enc:p.enc, doc:doc, dek:dek, recovery:rk};
          this.view.showDialogKey(rk.text);
          this.view.setDialogBusy(false);
        }, (err) => {
          this.view.setDialogBusy(false);
          this.view.showDialogError(this.message(err));
        });
    }

    finishNewRecovery(){
      const s = this.pending;
      if(!s) return Promise.resolve();
      this.view.setDialogBusy(true);
      return PC.wrapRecovery(s.dek, s.recovery.bytes, this.ctx(s.enc))
        .then((w) => this.wrapRef(s.id).set(Object.assign({}, s.doc, {rk:w.rk, updatedAt:Date.now()})))
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
      return keystore.forget(this.me.uid, p.enc.pid).then(() => {
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
