/* Convertir un proyecto «Solo contraseñas» en uno con cifrado total (docs/CIFRADO-PROYECTOS.md, 13.2; PR11).
   Solo proyectos personales, sin enlace con GitHub y con cuenta. No se puede deshacer.

   Orden, pensado para que un corte en cualquier punto no pierda nada:
     1. contraseña de cifrado y clave de recuperación, que se enseña antes de escribir nada;
     2. la clave del proyecto envuelta (crypto/{uid}) y en este navegador;
     3. el documento del proyecto pasa a llevar enc, marcado como en conversión (enc.conv);
     4. se sella todo lo que estaba en claro (ProjectReseal), documento a documento;
     5. se quita enc.conv.
   Si se corta antes del 3 el proyecto sigue como estaba. Si se corta después, ya es un proyecto
   cifrado en el que aún quedan documentos en claro (la app los lee igual): se termina al volver a
   abrirlo, con los pasos 4 y 5, que se pueden repetir.

   Convertir protege lo que hay y lo que venga; no borra lo que ya salió: copias de seguridad
   anteriores, archivos exportados, lo que se sincronizó con GitHub. */
(function(){
  const P = Workhub.models.ProjectModel;
  const PC = Workhub.services.projectCrypto;
  const keystore = Workhub.services.keystore;
  const toast = Workhub.views.toast;

  const MSG = {
    mismatch: 'Las contraseñas no coinciden.',
    open: 'Abre este proyecto para convertirlo a cifrado total.',
    github: 'Este proyecto está enlazado con GitHub, y lo que se sincroniza llega a GitHub sin cifrar. Desvincúlalo antes de convertirlo a cifrado total.',
    vault: 'El cofre de este proyecto tiene el formato antiguo. Abre la sección Contraseñas y desbloquéalo para actualizarlo antes de convertir el proyecto.',
    read: 'No se pudo comprobar el proyecto. Comprueba la conexión e inténtalo de nuevo.'
  };

  function reason(err){
    const code = err && err.code;
    if(code === 'permission-denied') return ' ' + Workhub.t('El servidor ha rechazado la operación (permission-denied): comprueba que están publicadas las reglas de firestore.rules del cifrado y que tu correo está verificado.');
    if(code === 'unavailable' || code === 'deadline-exceeded') return ' ' + Workhub.t('Parece un problema de conexión; inténtalo de nuevo.');
    return code ? ' (' + code + ')' : '';
  }

  class ProjectConvertController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      /* Diálogo en curso: {id, password, recovery}. */
      this.state = null;
      /* id del proyecto que se está convirtiendo o terminando de convertir aquí. */
      this.running = '';
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

    /* Se ofrece en los proyectos personales sin cifrar, con cuenta y con el cifrado total disponible. */
    canConvert(p){
      return !!(p && !p.team && !P.isEncrypted(p) && this.crypto && this.crypto.canCreate());
    }

    /* Lo llama AppController al abrir un proyecto cifrado: termina una conversión que se cortó. */
    onOpen(){
      const id = this.app.projectId;
      const p = this.project(id);
      if(!this.me || !P.isConverting(p) || p.team || this.running || this.gaveUp[id]) return;
      if(this.app.cipher && this.app.cipher.kid === p.enc.kid) this.resume(id);
    }

    /* ---------- diálogo ---------- */

    start(projectId){
      const p = this.project(projectId);
      if(!this.canConvert(p) || this.running) return;
      if(this.app.projectId !== p.id){ toast.error(MSG.open); return; }
      if(p.github){ toast.error(MSG.github); return; }
      const s = this.state = {id:p.id};
      /* Un cofre del formato antiguo no se podría actualizar dentro de un proyecto cifrado. */
      P.scope(this.app.rootDb, p.id).doc('vault_meta/check').get().then((snap) => {
        if(this.state !== s) return;
        if(snap.exists && !(snap.data() || {}).saltPassword){
          this.state = null;
          toast.error(MSG.vault);
          return;
        }
        this.crypto.editing = p.id;
        this.crypto.downloadName = p.nombre;
        this.view.openConvert();
      }, () => {
        if(this.state === s) this.state = null;
        toast.error(MSG.read);
      });
    }

    closed(){
      if(!this.running) this.state = null;
    }

    /* Paso 1: la contraseña de cifrado. Después se enseña la clave de recuperación. */
    submit(password, again){
      const s = this.state;
      const p = s && this.project(s.id);
      if(!p || !this.canConvert(p)) return;
      const res = this.crypto.check(password, p.nombre);
      if(!res.ok){ this.view.showDialogError(res.message); return; }
      if(password !== again){ this.view.showDialogError(MSG.mismatch); return; }
      s.password = password;
      s.recovery = PC.newRecoveryKey();
      this.view.showDialogKey(s.recovery.text, 'convert-key');
    }

    /* Paso 2 (clave de recuperación confirmada): el proyecto pasa a cifrado y se sella todo. */
    confirm(){
      const s = this.state;
      const p = s && this.project(s.id);
      if(!p || !s.recovery || this.running) return Promise.resolve();
      const t = Workhub.t;
      let begun = null;
      this.view.setRunProgress(t('Preparando el cifrado…'));
      return this.begin(s).then((b) => {
        begun = b;
        return this.sweep(s.id, b.cipher, (n, total) => this.view.setRunProgress(t('Cifrando… {n} de {total}', {n:n, total:total})), b.enc);
      }).then((res) => {
        this.running = '';
        this.state = null;
        this.view.closeDialog();
        toast.success(t('«{nombre}» ya tiene cifrado total', {nombre:p.nombre}), {important:true});
        this.reportSkipped(res);
      }, (err) => {
        this.running = '';
        console.error('No se pudo completar la conversión a cifrado total:', err);
        if(begun){
          this.state = null;
          this.view.closeDialog();
          toast.error(t('El proyecto ya tiene cifrado total, pero no se ha terminado de cifrar todo lo que había. Se reanudará al volver a abrirlo con conexión.'));
          return;
        }
        this.view.setRunProgress('');
        this.view.showDialogError(t('No se pudo convertir el proyecto.') + reason(err));
      });
    }

    reportSkipped(res){
      if(res && res.skipped) toast.error(Workhub.t('{n} elementos no se han podido cifrar y siguen como estaban. Ábrelos y guárdalos de nuevo.', {n:res.skipped}));
    }

    /* ---------- pasos 2 y 3 ---------- */

    async begin(s){
      const p = this.project(s.id);
      const uid = this.me.uid;
      if(P.isEncrypted(p) || p.team || p.github) throw new Error('not-convertible');
      const pid = PC.newPid(), kid = PC.newKid();
      const ctx = {pid:pid, kid:kid, uid:uid};
      const raw = PC.newDekBytes();
      const ref = this.crypto.wrapRef(s.id);
      this.running = s.id;
      try{
        const key = await PC.importDek(raw);
        const kcv = await PC.kcv(key, pid, kid);
        const w = await Promise.all([PC.wrapPassword(raw, s.password, ctx), PC.wrapRecovery(raw, s.recovery.bytes, ctx)]);
        const now = Date.now();
        await ref.set({v:PC.VERSION, kid:kid, kdf:w[0].kdf, pw:w[0].pw, rk:w[1].rk, createdAt:now, updatedAt:now});
        await keystore.put({uid:uid, pid:pid, projectId:s.id, kid:kid, key:key, trusted:false});
        const enc = {v:PC.VERSION, mode:'pw', pid:pid, kid:kid, kcv:kcv, createdAt:now, conv:now};
        try{
          await this.app.models.projects.patch(s.id, {enc:enc});
        }catch(err){
          /* El proyecto sigue como estaba: se retira la clave que se había preparado. */
          await keystore.forget(uid, pid).catch(() => null);
          await ref.delete().catch(() => null);
          throw err;
        }
        return {enc:enc, cipher:new Workhub.models.ProjectCipher({pid:pid, kid:kid, key:key})};
      }catch(err){
        this.running = '';
        throw err;
      }finally{
        raw.fill(0);
      }
    }

    /* ---------- pasos 4 y 5 (se pueden repetir) ---------- */

    /* enc: el campo del proyecto en conversión (por defecto, el de la lista de proyectos). */
    async sweep(id, cipher, onProgress, enc){
      const app = this.app;
      enc = enc || (this.project(id) || {}).enc;
      if(!enc || !enc.conv || enc.kid !== cipher.kid) throw new Error('not-converting');
      const teams = app.rootDb.teams;
      const reseal = new Workhub.models.ProjectReseal({
        rootDb:app.rootDb, projectId:id, cipher:cipher,
        transaction:teams && teams.runTransaction ? (fn) => teams.runTransaction(fn) : null
      });
      const res = await reseal.run(onProgress);

      /* Las versiones locales de las copias, que estaban en claro, se sellan también. */
      const history = Workhub.services.backupHistory;
      if(history && id === app.projectId && app.controllers.backup){
        await history.sealPlain(app.controllers.backup.scope(), cipher).catch(() => null);
      }

      const done = {v:enc.v, mode:enc.mode, pid:enc.pid, kid:enc.kid, kcv:enc.kcv};
      if(enc.createdAt != null) done.createdAt = enc.createdAt;
      await app.models.projects.update(id, {enc:done});
      return res;
    }

    resume(id){
      const p = this.project(id);
      if(!P.isConverting(p) || this.running) return Promise.resolve();
      this.running = id;
      return this.sweep(id, this.app.cipher).then((res) => {
        this.running = '';
        toast.success(Workhub.t('«{nombre}» ya tiene cifrado total', {nombre:p.nombre}), {important:true});
        this.reportSkipped(res);
      }, (err) => {
        this.running = '';
        this.gaveUp[id] = true;
        console.error('No se pudo terminar la conversión a cifrado total:', err);
        toast.error(Workhub.t('La conversión de «{nombre}» a cifrado total sigue a medias: se reanudará al volver a abrir el proyecto con conexión.', {nombre:p.nombre}));
      });
    }
  }

  Workhub.controllers.ProjectConvertController = ProjectConvertController;
})();
