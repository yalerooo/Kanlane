/* Compartir un proyecto con cifrado total (docs/CIFRADO-PROYECTOS.md, apartado 10): la parte de
   claves de convertir en equipo, invitar con un código de acceso y aceptar con ese código.
   TeamController y ProjectsController llevan la interfaz de compartir; TeamModel escribe en Firestore.

   - Convertir: el equipo tiene una clave, un pid y un kid nuevos, envueltos con la misma contraseña
     del proyecto y con una clave de recuperación nueva.
   - Invitar: la clave guardada en el navegador no es extraíble, así que se abre otra vez con la
     contraseña del propietario para envolverla con el código (D13).
   - Aceptar: el invitado abre la clave con el código, la envuelve con su propia contraseña y su
     propia clave de recuperación y la guarda en su navegador antes de escribir nada.
   Cada miembro publica además un par de claves (D9) para futuras rotaciones (PR10). */
(function(){
  const P = Workhub.models.ProjectModel;
  const PC = Workhub.services.projectCrypto;
  const keystore = Workhub.services.keystore;
  const toast = Workhub.views.toast;

  const MSG = {
    badCode: 'El código no es correcto.',
    mismatch: 'Las contraseñas no coinciden.',
    read: 'No se pudo leer la invitación. Comprueba la conexión e inténtalo de nuevo.',
    join: 'No se pudo entrar en el equipo. Puede que la invitación ya no exista.'
  };

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  class TeamCryptoController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      /* Aceptación en curso: {invite, done, opened?, password?, recovery?}. */
      this.joining = null;

      view.bind({
        check: (pw) => this.check(pw),
        open: (code, pw, pw2) => this.openCode(code, pw, pw2),
        finish: () => this.finishJoin(),
        download: (text) => this.app.controllers.crypto.download(text, this.joining ? this.joining.invite.teamName : ''),
        closed: () => this.dropJoin()
      });
    }

    get me(){
      return this.app.rootDb && this.app.rootDb.me ? this.app.rootDb.me : null;
    }

    get team(){
      return this.app.models.team;
    }

    check(pw){
      return PC.passwordCheck(pw, {email:this.me ? this.me.email : '', projectName:this.joining ? this.joining.invite.teamName : ''});
    }

    /* Mi clave envuelta para un proyecto: contraseña, clave de recuperación y par de claves propio. */
    async wrapDoc(dek, password, recoveryBytes, ctx){
      const pair = await PC.newKeyPair();
      try{
        const parts = await Promise.all([PC.wrapPassword(dek, password, ctx, pair.priv), PC.wrapRecovery(dek, recoveryBytes, ctx)]);
        const now = Date.now();
        return {v:PC.VERSION, kid:ctx.kid, kdf:parts[0].kdf, pw:parts[0].pw, rk:parts[1].rk, pub:pair.pub, priv:parts[0].priv, createdAt:now, updatedAt:now};
      }finally{
        pair.priv.fill(0);
      }
    }

    /* ---------- convertir un proyecto cifrado en equipo (10.2) ---------- */

    /* Comprueba la contraseña del proyecto y prepara la clave del equipo. Devuelve
       {secret, recovery, key}: secret es lo que pide TeamModel.convert, recovery el texto de la clave
       de recuperación nueva (hay que enseñarla antes de crear nada) y key la clave del equipo. */
    async prepareConvert(project, password){
      const app = this.app;
      const uid = this.me.uid;
      if(!P.isEncrypted(project) || !app.cipher || app.projectId !== project.id) throw fail('locked');
      const crypto = app.controllers.crypto;
      /* Solo para comprobar que la contraseña es la del proyecto. */
      const doc = await crypto.readWrap(project.id, project.enc);
      await PC.unwrapPassword(doc, password, crypto.ctx(project.enc), false);

      const raw = PC.newDekBytes();
      const pid = PC.newPid(), kid = PC.newKid();
      const recovery = PC.newRecoveryKey();
      try{
        const key = await PC.importDek(raw);
        const wrap = await this.wrapDoc(raw, password, recovery.bytes, {pid:pid, kid:kid, uid:uid});
        const kcv = await PC.kcv(key, pid, kid);
        return {
          recovery: recovery.text,
          key: key,
          secret: {
            tid: app.rootDb.teams.newId(),
            enc: {v:PC.VERSION, mode:'pw', pid:pid, kid:kid, kcv:kcv, createdAt:Date.now()},
            crypto: wrap,
            src: app.cipher,
            dst: new Workhub.models.ProjectCipher({pid:pid, kid:kid, key:key})
          }
        };
      }finally{
        raw.fill(0);
      }
    }

    /* La clave del equipo, en este navegador antes de crear el equipo: así se abre sin pedir nada. */
    keepConverted(prepared){
      const s = prepared.secret;
      return keystore.put({uid:this.me.uid, pid:s.enc.pid, projectId:P.teamKey(s.tid), kid:s.enc.kid, key:prepared.key, trusted:false});
    }

    dropConverted(prepared){
      return keystore.forget(this.me.uid, prepared.secret.enc.pid).catch(() => null);
    }

    /* ---------- invitar (10.3) ---------- */

    /* Código de acceso nuevo y la clave del equipo envuelta con él.
       Devuelve {code, secret:{enc, wrap}}; el código solo se enseña una vez y no se guarda. */
    async prepareInvite(project, password){
      if(!P.isEncrypted(project)) return null;
      const crypto = this.app.controllers.crypto;
      const enc = project.enc;
      const ctx = crypto.ctx(enc);
      const doc = await crypto.readWrap(project.id, enc);
      const dek = await PC.unwrapPassword(doc, password, ctx, true);
      const code = PC.newAccessCode();
      /* La AAD del envoltorio lleva el uid de quien invita: el invitado lo lee de la invitación. */
      const wrap = await PC.wrapCode(dek, code.text, ctx);
      return {code:code.text, secret:{enc:{pid:enc.pid, kid:enc.kid, kcv:enc.kcv}, wrap:wrap}};
    }

    /* ---------- aceptar (10.4) ---------- */

    /* done(): lo llama al entrar en el equipo (ProjectsController abre el proyecto cuando llega). */
    openJoin(invite, done){
      this.joining = {invite:invite, done:done};
      this.view.open(invite);
    }

    dropJoin(){
      this.joining = null;
    }

    expiredText(invite){
      return Workhub.t('El código ha caducado. Pide a {nombre} que te invite de nuevo.', {nombre:invite.invitedByName || ''});
    }

    /* Paso 1: el código abre la clave del proyecto. Después se enseña la clave de recuperación propia. */
    openCode(code, password, again){
      const j = this.joining;
      if(!j) return Promise.resolve();
      const invite = j.invite;
      const enc = invite.enc || {};
      if(!PC.parseAccessCode(code)){ this.view.showError(MSG.badCode); return Promise.resolve(); }
      const res = this.check(password);
      if(!res.ok){ this.view.showError(res.message); return Promise.resolve(); }
      if(password !== again){ this.view.showError(MSG.mismatch); return Promise.resolve(); }
      this.view.setBusy(true);
      return this.team.readInviteKey(invite).then((wrap) => {
        return PC.unwrapCode(wrap, code, {pid:enc.pid, kid:enc.kid, uid:invite.invitedByUid}, true);
      }).then((dek) => {
        /* La clave abierta tiene que ser la del proyecto y la versión vigente. */
        return PC.importDek(dek).then((key) => PC.checkKcv(key, enc.pid, enc.kid, enc.kcv).then((ok) => {
          if(!ok) throw fail('bad-code');
          return {dek:dek, key:key};
        }));
      }).then((opened) => {
        if(this.joining !== j) return;
        j.opened = opened;
        j.password = password;
        j.recovery = PC.newRecoveryKey();
        this.view.showKey(j.recovery.text);
      }, (err) => {
        if(this.joining !== j) return;
        this.view.setBusy(false);
        this.view.showError(this.joinMessage(err, invite));
      });
    }

    joinMessage(err, invite){
      const code = err && err.code;
      if(code === 'bad-code' || PC.isError(err, 'bad-code') || PC.isError(err, 'bad-format')) return MSG.badCode;
      /* Pasadas 24 h las reglas no dejan leer la clave envuelta. */
      if(Workhub.models.TeamModel.isExpired(invite) || code === 'no-key') return this.expiredText(invite);
      if(code === 'permission-denied') return this.expiredText(invite);
      return MSG.read;
    }

    /* Paso 2 (clave de recuperación confirmada): la clave va a este navegador y, en un solo lote, se
       entra en el equipo, se guarda mi clave envuelta y se borran la invitación y su código. */
    finishJoin(){
      const j = this.joining;
      if(!j || !j.opened) return Promise.resolve();
      const invite = j.invite, enc = invite.enc;
      const uid = this.me.uid;
      this.view.setBusy(true);
      return this.wrapDoc(j.opened.dek, j.password, j.recovery.bytes, {pid:enc.pid, kid:enc.kid, uid:uid}).then((doc) => {
        return keystore.put({uid:uid, pid:enc.pid, projectId:P.teamKey(invite.teamId), kid:enc.kid, key:j.opened.key, trusted:false})
          .then(() => this.team.accept(invite, {crypto:doc}))
          .catch((err) => keystore.forget(uid, enc.pid).catch(() => null).then(() => { throw err; }));
      }).then(() => {
        const done = j.done;
        this.joining = null;
        this.view.close();
        toast.success(Workhub.t('Ya formas parte de «{equipo}»', {equipo:invite.teamName || ''}), {important:true});
        if(done) done();
      }, (err) => {
        if(this.joining !== j) return;
        this.view.setBusy(false);
        this.view.showError(err && err.code === 'permission-denied' && Workhub.models.TeamModel.isExpired(invite) ? this.expiredText(invite) : MSG.join);
      });
    }
  }

  Workhub.controllers.TeamCryptoController = TeamCryptoController;
})();
