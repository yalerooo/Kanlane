/* Gestor de contraseñas: bloqueo/desbloqueo, recuperación y credenciales. */
(function(){
  const cryptoSvc = Workhub.services.crypto;
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;
  const RECOVERY_KEY_BYTES = 32;
  const TeamVault = Workhub.models.TeamVault;
  const P = Workhub.models.ProjectModel;
  const Totp = Workhub.services.vaultTotp;
  const VaultModel = Workhub.models.VaultModel;
  const prefs = Workhub.services.preferences;

  /* Intentos fallidos al abrir el cofre: los cuatro primeros no esperan; a partir del quinto hay
     que esperar 30 s, luego 1 min, 2 min… hasta 15 min. Se guarda por navegador y proyecto, así que
     recargar no lo pone a cero. Frena a quien prueba contraseñas desde la app; no puede frenar a
     quien tenga una copia de los datos y las pruebe por su cuenta (para eso están la longitud
     mínima, PBKDF2 y la verificación en dos pasos). */
  const ATTEMPTS_KEY = 'workhub-vault-attempts';
  const FREE_ATTEMPTS = 4;
  const FIRST_WAIT = 30 * 1000;
  const MAX_WAIT = 15 * 60 * 1000;

  /* Errores de la verificación en dos pasos (services/vault-totp.js y VaultModel). */
  const TOTP_ERRORS = {
    'totp-code': 'El código no es correcto. Comprueba que es el de Kanlane y que la hora del teléfono está bien.',
    'totp-rate': 'Demasiados intentos. Espera un minuto y vuelve a probar.',
    'totp-auth': 'El servidor no ha aceptado tu sesión. Cierra sesión, vuelve a entrar e inténtalo de nuevo.',
    'totp-network': 'No se pudo contactar con el servidor para comprobar el código. Revisa la conexión e inténtalo de nuevo.',
    'totp-unavailable': 'La verificación en dos pasos no está disponible ahora. Inténtalo de nuevo en unos minutos.',
    'bad-pass': 'Contraseña maestra incorrecta.',
    'bad-share': 'El servidor ha dado una clave que no abre estas contraseñas. Prueba con un código de respaldo.',
    'totp-on': 'La verificación en dos pasos ya estaba activada. Bloquea y vuelve a desbloquear.',
    'totp-off': 'La verificación en dos pasos ya estaba desactivada. Bloquea y vuelve a desbloquear.',
    'bad-backup': 'Ese código de respaldo no es correcto o ya se ha usado.',
    'no-account': 'Estas contraseñas tienen verificación en dos pasos y aquí no hay una cuenta con la que comprobar el código de la aplicación. Usa un código de respaldo.'
  };
  const BAD_CODE = 'Escribe el código de 6 cifras de la aplicación o un código de respaldo completo.';
  const errorCode = (err) => err && (err.code || err.message);
  const totpMessage = (err) => TOTP_ERRORS[err && (err.code || err.message)] || TOTP_ERRORS['totp-unavailable'];

  function recoveryFileText(key){
    const when = new Date().toLocaleString(Workhub.i18n.locale);
    if(Workhub.i18n.lang === 'en'){
      return 'RECOVERY KEY - Kanlane\n' +
        'Generated: ' + when + '\n\n' +
        'This key lets you reset the master password of this board\'s password\n' +
        'manager if you forget it. Keep it somewhere safe (do not share it or\n' +
        'upload it anywhere). Anyone who has it, together with access to this\n' +
        'board, could read the saved passwords.\n\n' +
        'Key:\n' + key + '\n\n' +
        'How to use it: on the board, "Passwords" tab -> "Forgot your master\n' +
        'password" -> paste this key and create a new password.\n' +
        'Doing so generates a new recovery key and this one stops working.\n';
    }
    return 'CLAVE DE RECUPERACION - Kanlane\n' +
      'Generada: ' + when + '\n\n' +
      'Esta clave permite restablecer la contrasena maestra del gestor de\n' +
      'contrasenas de este tablero si la olvidas. Guardala en un lugar\n' +
      'seguro (no la compartas ni la subas a ningun sitio). Quien la tenga,\n' +
      'junto con acceso a este tablero, podria leer las contrasenas guardadas.\n\n' +
      'Clave:\n' + key + '\n\n' +
      'Como usarla: en el tablero, pestana "Contrasenas" -> "Has olvidado\n' +
      'tu contrasena maestra" -> pega esta clave y crea una contrasena nueva.\n' +
      'Al hacerlo se genera una nueva clave de recuperacion y esta queda invalidada.\n';
  }

  /* Lo que se descarga: la clave de recuperación (si hay una nueva) y los códigos de respaldo. */
  function savedFileText(key, codes){
    const en = Workhub.i18n.lang === 'en';
    let text = key ? recoveryFileText(key) : '';
    if(codes && codes.length){
      text += (key ? '\n' : (en ? 'BACKUP CODES - Kanlane\n' : 'CODIGOS DE RESPALDO - Kanlane\n') + (en ? 'Generated: ' : 'Generados: ') + new Date().toLocaleString(Workhub.i18n.locale) + '\n\n') +
        (en
          ? 'Two-step verification backup codes. Each one works once, in place of\nthe code from your authenticator app (for example if you lose your phone).\nWith two-step verification on, the recovery key alone is not enough: you\nalso need a code from the app or one of these.\n\n'
          : 'Codigos de respaldo de la verificacion en dos pasos. Cada uno sirve una\nvez, en lugar del codigo de la aplicacion de autenticacion (por ejemplo,\nsi pierdes el telefono). Con la verificacion en dos pasos activada, la\nclave de recuperacion sola no basta: hace falta ademas un codigo de la\naplicacion o uno de estos.\n\n') +
        codes.join('\n') + '\n';
    }
    return text + (en
      ? '\nIf you lose the master password and this file, the saved passwords are\nlost for good: Kanlane does not have them and cannot reset them.\n'
      : '\nSi pierdes la contrasena maestra y este archivo, las contrasenas\nguardadas se pierden para siempre: Kanlane no las tiene ni puede\nrestablecerlas.\n');
  }

  class VaultController {
    constructor(app, view){
      this.app = app;
      this.vault = app.models.vault;
      this.view = view;

      /* Se acaba de generar una clave de recuperación y falta confirmar que se ha guardado. */
      this.awaitingRecoveryConfirm = false;
      /* Tarea a la que volver tras desbloquear (desde "Desbloquear" en una tarea). */
      this.returnTaskId = null;

      this.vault.on('change', () => { if(this.vault.unlocked) this.render(); });
      this.vault.on('error', (err) => {
        if(this.vault.unlocked){
          this.view.showGridMessage('No se pudieron cargar las credenciales (' + (err && err.code || 'error') + ').', true);
        }
      });
      app.models.clients.on('change', () => {
        const names = app.clientNames();
        this.view.setClientOptions(names);
        this.view.cliente.populate(names);
        this.render();
      });

      this.view.bindUnlock((pass, pass2, code) => this.unlock(pass, pass2, code));
      this.view.bindPasswordCheck((pass) => this.checkPassword(pass));
      this.view.bindTotpStep({
        verify: (code) => this.verifyTotp(code),
        back: () => {
          this.vault.pendingTotp = null;
          this.setLockMode(this.vault.metaState);
        }
      });
      /* Clave del autenticador que se está dando de alta (solo mientras el diálogo está abierto). */
      this.totpSecret = null;
      this.view.bindTotp({
        open: () => this.openTotp(),
        submit: (pass, code) => this.submitTotp(pass, code),
        codes: (pass, code) => this.newBackupCodes(pass, code)
      });
      /* Enlace de acceso a las contraseñas de un equipo: en cuanto soy miembro, se abre ese proyecto
         por la sección de contraseñas. */
      this.linkFollowed = false;
      app.models.projects.on('change', () => this.followLink());
      this.view.bindRecover((key, p1, p2, code) => this.recover(key, p1, p2, code));
      this.view.bindRecoveryActions({
        continue: () => {
          this.awaitingRecoveryConfirm = false;
          this.view.clearRecoveryKey();
          this.showContent();
        },
        download: (key, codes) => platform.download(Workhub.i18n.lang === 'en' ? 'vault-recovery-key.txt' : 'vault-clave-recuperacion.txt', savedFileText(key, codes))
      });
      /* La contraseña con la que se ha abierto es de las que hoy no se aceptarían. */
      this.weak = false;
      this.view.bindPass({
        open: () => this.view.openPass(),
        submit: (current, next, next2) => this.changePassword(current, next, next2)
      });
      this.view.bindLock(() => this.lock());

      this.view.bindNew(() => this.openNew());
      this.view.bindFilters(() => this.render());
      this.view.bindGrid({
        open: (id) => this.openDetail(id),
        toggle: (id) => {
          if(!this.vault.find(id)) return;
          this.vault.toggleVisible(id).then(() => this.render()).catch(() => {
            this.view.showGridMessage('No se pudo descifrar esta credencial.');
          });
        },
        copy: (id, btn) => this.copyPassword(id, btn)
      });
      this.view.bindReorder((draggedId, targetId) => {
        this.vault.reorder(this.filtered(), draggedId, targetId);
      });

      this.view.bindDetail({
        toggle: (id) => {
          if(!this.vault.find(id)) return;
          this.vault.toggleVisible(id).then(() => this.view.renderDetailSecret(id, this.vault)).catch(() => {});
        },
        copy: (id, btn) => this.copyPassword(id, btn),
        copyNotes: (id, btn) => this.copyNotes(id, btn),
        edit: (id) => this.openEdit(id)
      });

      this.view.cliente.bindCreate((name) => app.createClient(name));
      this.view.bindSubmit((id, values) => this.save(id, values));
      this.view.bindDelete((id) => this.remove(id));
    }

    /* ---------- Pantallas ---------- */

    onShow(){
      if(this.awaitingRecoveryConfirm){
        this.view.showScreen('recovery');
      } else if(this.vault.unlocked){
        this.view.showScreen('content');
        this.view.setTotpState(Totp.available(this.app.rootDb), this.vault.totp);
        this.view.setWeak(this.weak);
        this.render();
      } else {
        this.view.showScreen('lock');
        if(!cryptoSvc.isAvailable) this.view.showCryptoUnavailable();
        else this.checkLockMode();
      }
    }

    /* Tras importar una copia con contraseñas: la pantalla de bloqueo debe
       pedir la contraseña maestra del archivo, no crear una nueva. */
    onImported(){
      if(!this.vault.unlocked) this.checkLockMode();
    }

    /* Otro proyecto, otro gestor: queda bloqueado y se vuelve a mirar si ya
       tiene contraseña maestra. */
    onProjectChange(){
      this.awaitingRecoveryConfirm = false;
      this.weak = false;
      this.view.clearRecoveryKey();
      this.returnTaskId = null;
      this.view.clearPasswords();
      this.view.showScreen('lock');
      if(this.app.shell.isVisible('vault')) this.onShow();
    }

    checkLockMode(){
      /* En un equipo lo que me falta lo pone otra persona (crear el cofre, darme acceso): se vuelve
         a mirar cada vez. */
      if(this.vault.team && this.vault.metaState !== 'current') this.vault.metaState = null;
      if(this.vault.metaState !== null){
        this.setLockMode(this.vault.metaState);
        return;
      }
      if(!this.vault.isReady()){
        this.view.showLockError('No hay conexión con el almacenamiento.');
        return;
      }
      this.vault.checkMeta().then((state) => this.setLockMode(state)).catch(() => {
        this.view.showLockError('No se pudo comprobar el gestor. Revisa la conexión e inténtalo de nuevo.');
      });
    }

    setLockMode(state){
      this.view.setLockMode(state);
      const link = TeamVault.pendingLink();
      if(state === 'grant' && link && this.vault.team && link.tid === this.vault.team.tid) this.view.setAccessCode(link.code);
    }

    /* Se abrió la app con un enlace de acceso: cuando ese equipo está entre mis proyectos (puede
       que antes haya que aceptar la invitación), se abre por las contraseñas. Solo una vez. */
    followLink(){
      const link = TeamVault.pendingLink();
      if(!link || this.linkFollowed) return;
      const id = P.teamKey(link.tid);
      if(!this.app.models.projects.get(id)) return;
      this.linkFollowed = true;
      if(this.app.projectId !== id) this.app.switchProject(id);
      this.app.navigate('vault');
    }

    showContent(){
      this.view.showScreen('content');
      this.view.setTotpState(Totp.available(this.app.rootDb), this.vault.totp);
      this.view.setWeak(this.weak);
      this.render();
      this.maybeReturnToTask();
    }

    /* mode: 'detail' (ficha) o 'edit' (formulario), según desde dónde se vino. */
    returnToTaskAfterUnlock(taskId, mode){
      this.returnTaskId = taskId;
      this.returnTaskMode = mode || 'edit';
    }

    maybeReturnToTask(){
      if(!this.returnTaskId) return;
      const id = this.returnTaskId;
      this.returnTaskId = null;
      this.app.navigate('tasks');
      if(this.returnTaskMode === 'detail') this.app.controllers.tasks.openDetail(id);
      else this.app.controllers.tasks.openEdit(id);
    }

    /* kind y codes: ver VaultView.presentRecoveryKey. */
    presentRecoveryKey(key, kind, codes){
      this.awaitingRecoveryConfirm = true;
      this.view.presentRecoveryKey(key, kind, codes);
    }

    /* ---------- Límite de intentos ---------- */

    attemptsKey(){
      const me = this.app.rootDb && this.app.rootDb.me;
      return ATTEMPTS_KEY + ':' + (me ? me.uid : 'local') + ':' + (this.app.projectId || '');
    }

    attempts(){
      try{
        const a = JSON.parse(prefs.read(this.attemptsKey(), ''));
        if(a && typeof a.n === 'number' && typeof a.until === 'number') return a;
      }catch(e){ /* sin datos o ilegibles */ }
      return {n:0, until:0};
    }

    /* Un intento fallido más (contraseña, clave de recuperación o código que no son). */
    failedAttempt(){
      const a = this.attempts();
      a.n++;
      if(a.n > FREE_ATTEMPTS) a.until = Date.now() + Math.min(MAX_WAIT, FIRST_WAIT * Math.pow(2, a.n - FREE_ATTEMPTS - 1));
      prefs.write(this.attemptsKey(), JSON.stringify(a));
    }

    clearAttempts(){
      if(this.attempts().n) prefs.write(this.attemptsKey(), JSON.stringify({n:0, until:0}));
    }

    /* Si hay que esperar, el aviso con lo que falta; si no, ''. */
    waitMessage(){
      const a = this.attempts();
      /* Un reloj cambiado no alarga la espera más allá del máximo. */
      const left = Math.min(a.until - Date.now(), MAX_WAIT);
      if(left <= 0) return '';
      const secs = Math.ceil(left / 1000);
      const time = secs < 60 ? secs + ' s' : Math.floor(secs / 60) + ' min' + (secs % 60 ? ' ' + (secs % 60) + ' s' : '');
      return 'Demasiados intentos fallidos. Vuelve a probar en ' + time + '.';
    }

    /* El aviso de un intento fallido: el suyo o, si con él empieza una espera, el de la espera. */
    afterFailure(message){
      this.failedAttempt();
      return this.waitMessage() || message;
    }

    /* Lo escrito en un campo de código: {verify(token)} si son las 6 cifras de la aplicación,
       {backup} si es un código de respaldo, null si no es ninguna de las dos cosas. */
    secondFactor(code){
      const rootDb = this.app.rootDb;
      if(Totp.cleanCode(code).length === 6 && /^[\d\s-]+$/.test(String(code))){
        if(!rootDb || typeof rootDb.idToken !== 'function'){
          return {verify:() => Promise.reject(Object.assign(new Error('no-account'), {code:'no-account'}))};
        }
        return {verify:(token) => Totp.verify(rootDb, token, code)};
      }
      return VaultModel.isBackupCode(code) ? {backup:code} : null;
    }

    /* ---------- Contraseña maestra nueva ---------- */

    /* Resultado de passwordCheck() para una contraseña maestra (lo pinta el medidor). */
    checkPassword(pass){
      const me = this.app.rootDb && this.app.rootDb.me;
      const project = this.app.models.projects.get(this.app.projectId);
      return Workhub.services.projectCrypto.passwordCheck(pass, {email:me ? me.email : '', projectName:project ? project.nombre : ''});
    }

    /* Por qué no vale como contraseña maestra nueva, o '' si vale. Las cortas y las fáciles de
       adivinar («123456789012», «contraseña123») no se aceptan; las que ya existen siguen abriendo.
       Que contenga el correo o el nombre del proyecto solo lo avisa el medidor. */
    passwordProblem(pass){
      const r = this.checkPassword(pass);
      return r.reason === 'short' || r.reason === 'common' ? r.message : '';
    }

    /* ---------- Desbloqueo ---------- */

    unlock(pass, pass2, code){
      if(!pass || !this.vault.isReady()) return;
      const state = this.vault.metaState;
      const done = () => this.view.setUnlocking(false, this.vault.metaState);
      if((state === 'current' || state === 'legacy') && this.waitMessage()){
        this.view.showLockError(this.waitMessage());
        return;
      }
      this.view.setUnlocking(true);

      if(state === 'grant'){
        const clean = TeamVault.parseCode(code);
        if(!clean){ this.view.showLockError('Pega el enlace o el código de acceso que te ha dado el propietario.'); done(); return; }
        if(pass !== pass2){ this.view.showLockError('Las dos contraseñas no coinciden.'); done(); return; }
        if(this.passwordProblem(pass)){ this.view.showLockError(this.passwordProblem(pass)); done(); return; }
        this.vault.redeem(clean, pass).then((key) => {
          TeamVault.clearLink();
          this.presentRecoveryKey(key, 'new');
        }).catch((err) => {
          const c = err && err.code;
          this.view.showLockError(c === 'bad-code' ? 'El código no es correcto.'
            : c === 'no-grant' ? 'No hay ningún acceso pendiente para tu correo, o el enlace ha caducado. Pide otro al propietario.'
            : 'No se pudo entrar en las contraseñas del equipo. Comprueba la conexión e inténtalo de nuevo.');
        }).finally(done);
        return;
      }

      if(state === 'none'){
        if(pass !== pass2){ this.view.showLockError('Las dos contraseñas no coinciden.'); done(); return; }
        if(this.passwordProblem(pass)){ this.view.showLockError(this.passwordProblem(pass)); done(); return; }
        this.vault.create(pass).then((key) => this.presentRecoveryKey(key, 'new')).catch((err) => {
          if(err && err.message === 'vault-exists') this.setLockMode(this.vault.metaState);
          this.view.showLockError('No se pudo crear la contraseña maestra. Comprueba la conexión y vuelve a intentarlo.');
        }).finally(done);
      } else if(state === 'legacy'){
        this.vault.unlockLegacy(pass).then((key) => {
          this.clearAttempts();
          this.weak = !!this.passwordProblem(pass);
          this.presentRecoveryKey(key, 'new');
        }).catch((err) => {
          this.view.showLockError(errorCode(err) === 'bad-pass' ? this.afterFailure('Contraseña maestra incorrecta.')
            : 'No se pudo desbloquear o migrar el gestor. Comprueba la contraseña y la conexión.');
        }).finally(done);
      } else {
        /* Si es de las que hoy no se aceptarían, se avisa dentro (sin bloquear). */
        const weak = !!this.passwordProblem(pass);
        this.vault.unlock(pass).then(() => {
          this.clearAttempts();
          this.weak = weak;
          this.view.clearPasswords();
          this.showContent();
        }).catch((err) => {
          if(err && err.message === 'totp-required'){
            this.pendingWeak = weak;
            this.view.clearPasswords();
            this.view.showTotpStep();
          } else if(err && err.message === 'no-check') this.setLockMode(this.vault.metaState || 'none');
          else this.view.showLockError(this.afterFailure('Contraseña maestra incorrecta.'));
        }).finally(done);
      }
    }

    /* Segundo paso del desbloqueo: el servidor comprueba el código y da la clave que falta. */
    verifyTotp(code){
      const pending = this.vault.pendingTotp;
      if(!pending){ this.setLockMode(this.vault.metaState); return; }
      if(this.waitMessage()){ this.view.showTotpStepError(this.waitMessage()); return; }
      const second = this.secondFactor(code);
      if(!second){ this.view.showTotpStepError(BAD_CODE); return; }
      this.view.setTotpChecking(true);
      (second.backup
        ? this.vault.unlockWithBackup(second.backup)
        : second.verify(pending.token).then((share) => this.vault.unlockWithShare(share)).then(() => null)
      ).then((left) => {
        this.clearAttempts();
        this.weak = !!this.pendingWeak;
        this.view.clearPasswords();
        this.showContent();
        if(left !== null) toast.success('Has usado un código de respaldo. Te quedan ' + left + '.');
      }).catch((err) => {
        const c = errorCode(err);
        this.view.showTotpStepError(c === 'bad-backup' || c === 'totp-code' ? this.afterFailure(totpMessage(err)) : totpMessage(err));
      }).finally(() => this.view.setTotpChecking(false));
    }

    /* ---------- Activar o desactivar la verificación en dos pasos ---------- */

    openTotp(){
      if(!this.vault.unlocked) return;
      if(this.vault.totp){
        this.totpSecret = null;
        this.vault.backupLeft().then((left) => this.view.openTotp(null, left), () => this.view.openTotp(null));
        return;
      }
      const me = this.app.rootDb && this.app.rootDb.me;
      this.totpSecret = Totp.newSecret();
      this.view.openTotp({secret:Totp.formatSecret(this.totpSecret), uri:Totp.uri(this.totpSecret, me ? me.email : '')});
    }

    submitTotp(pass, code){
      if(!this.vault.unlocked || !this.vault.isReady()) return;
      const rootDb = this.app.rootDb;
      const enabling = !this.vault.totp;
      /* Al activarla solo vale el código de la aplicación; para desactivarla, también uno de respaldo. */
      const second = enabling ? null : this.secondFactor(code);
      if(enabling && Totp.cleanCode(code).length !== 6){ this.view.showTotpError('Escribe las 6 cifras del código.'); return; }
      if(!enabling && !second){ this.view.showTotpError(BAD_CODE); return; }
      this.view.setTotpBusy(true);
      /* En los dos casos cambia la clave de recuperación: se enseña la nueva (y los códigos de respaldo). */
      (enabling
        ? this.vault.enableTotp(pass, () => Totp.enroll(rootDb, this.totpSecret, code)).then((out) => this.presentRecoveryKey(out.recoveryKey, 'totp-on', out.codes))
        : this.vault.disableTotp(pass, second).then((key) => this.presentRecoveryKey(key, 'totp-off'))
      ).then(() => {
        this.totpSecret = null;
        this.view.closeTotp();
      }).catch((err) => {
        this.view.showTotpError(totpMessage(err));
      }).finally(() => this.view.setTotpBusy(false));
    }

    /* Códigos de respaldo nuevos (los anteriores dejan de valer). */
    newBackupCodes(pass, code){
      if(!this.vault.unlocked || !this.vault.isReady() || !this.vault.totp) return;
      const second = this.secondFactor(code);
      if(!pass){ this.view.showTotpError('Escribe tu contraseña maestra.'); return; }
      if(!second){ this.view.showTotpError(BAD_CODE); return; }
      this.view.setTotpBusy(true);
      this.vault.newBackupCodes(pass, second).then((codes) => {
        this.view.closeTotp();
        this.presentRecoveryKey('', 'codes', codes);
      }).catch((err) => {
        this.view.showTotpError(totpMessage(err));
      }).finally(() => this.view.setTotpBusy(false));
    }

    /* ---------- Cambiar la contraseña maestra ---------- */

    changePassword(current, next, next2){
      if(!this.vault.unlocked || !this.vault.isReady()) return;
      if(next !== next2){ this.view.showPassError('Las dos contraseñas nuevas no coinciden.'); return; }
      if(this.passwordProblem(next)){ this.view.showPassError(this.passwordProblem(next)); return; }
      if(next === current){ this.view.showPassError('La contraseña nueva tiene que ser distinta de la actual.'); return; }
      if(this.waitMessage()){ this.view.showPassError(this.waitMessage()); return; }
      this.view.setPassBusy(true);
      this.vault.changePassword(current, next).then(() => {
        this.clearAttempts();
        this.weak = false;
        this.view.setWeak(false);
        this.view.closePass();
        toast.success('Contraseña maestra cambiada');
      }).catch((err) => {
        this.view.showPassError(errorCode(err) === 'bad-pass' ? this.afterFailure('La contraseña maestra actual no es correcta.')
          : 'No se pudo cambiar la contraseña. Comprueba la conexión e inténtalo de nuevo.');
      }).finally(() => this.view.setPassBusy(false));
    }

    /* code: el código de la aplicación o de respaldo, si el cofre tiene verificación en dos pasos
       (el formulario lo pide cuando el modelo responde 'totp-required'). */
    recover(keyText, newPass, newPass2, code){
      if(!this.vault.isReady()){ this.view.showRecoverError('No hay conexión con el almacenamiento.'); return; }
      const keyBytes = cryptoSvc.base32Decode(keyText);
      if(keyBytes.length !== RECOVERY_KEY_BYTES){
        this.view.showRecoverError('Clave de recuperación no válida. Revisa que la has copiado completa.');
        return;
      }
      if(newPass !== newPass2){ this.view.showRecoverError('Las dos contraseñas nuevas no coinciden.'); return; }
      if(this.passwordProblem(newPass)){ this.view.showRecoverError(this.passwordProblem(newPass)); return; }

      if(this.waitMessage()){ this.view.showRecoverError(this.waitMessage()); return; }
      const second = code ? this.secondFactor(code) : null;
      if(code && !second){ this.view.showRecoverError(BAD_CODE); return; }

      this.view.setRecovering(true);
      this.vault.recover(keyBytes, newPass, second).then((key) => {
        this.clearAttempts();
        this.weak = false;
        this.presentRecoveryKey(key, 'reset');
      }).catch((err) => {
        const c = errorCode(err);
        if(c === 'totp-required'){
          /* La clave es buena, pero no basta: el segundo paso no se salta. */
          this.view.showRecoverCode();
          this.view.showRecoverError('La clave de recuperación es correcta, pero estas contraseñas tienen verificación en dos pasos: escribe además un código de la aplicación o uno de respaldo.');
        } else if(c === 'no-recovery'){
          this.view.showRecoverError('Este tablero todavía no tiene una clave de recuperación generada.');
        } else if(c === 'bad-key'){
          this.view.showRecoverError(this.afterFailure('La clave de recuperación no es correcta.'));
        } else if(c === 'bad-backup' || c === 'totp-code'){
          this.view.showRecoverError(this.afterFailure(totpMessage(err)));
        } else if(TOTP_ERRORS[c]){
          this.view.showRecoverError(totpMessage(err));
        } else {
          this.view.showRecoverError('No se pudo restablecer la contraseña. Comprueba la conexión e inténtalo de nuevo.');
        }
      }).finally(() => this.view.setRecovering(false));
    }

    lock(){
      this.vault.lock();
      this.awaitingRecoveryConfirm = false;
      this.weak = false;
      this.view.clearRecoveryKey();
      this.view.clearPasswords();
      this.view.showScreen('lock');
      this.setLockMode(this.vault.metaState);
    }

    /* ---------- Credenciales ---------- */

    filtered(){
      const f = this.view.filters();
      return this.vault.filter(f.query, f.tipo, f.cliente);
    }

    render(){
      if(!this.vault.unlocked) return;
      this.view.render(this.filtered(), this.vault.items.length > 0, this.vault);
    }

    copyPassword(id, btn){
      if(!this.vault.find(id)) return;
      this.vault.reveal(id).then((data) => this.view.copy(btn, data.password)).catch(() => {});
    }

    /* Las notas van cifradas con la contraseña: se copian con el mismo cuidado. */
    copyNotes(id, btn){
      if(!this.vault.find(id)) return;
      this.vault.reveal(id).then((data) => this.view.copy(btn, data.notas || '')).catch(() => {});
    }

    openDetail(id){
      const entry = this.vault.find(id);
      if(entry) this.view.openDetail(entry, this.vault);
    }

    openNew(presetCliente){
      this.view.openNew(this.app.clientNames(), presetCliente || this.vault.lastClient());
    }

    openEdit(id){
      const entry = this.vault.find(id);
      if(!entry) return;
      const names = this.app.clientNames();
      this.vault.reveal(id).then((data) => this.view.openEdit(entry, data, names)).catch(() => {
        this.view.openEdit(entry, {password:'', notas:''}, names);
        this.view.showFormError('No se pudo descifrar el valor anterior; revisa lo que guardas antes de guardar.');
      });
    }

    save(id, values){
      if(!this.vault.isReady() || !this.vault.key){
        this.view.showFormError('El vault no está desbloqueado.');
        return;
      }
      if(this.app.clientsEnabled()){
        if(!values.meta.cliente) return;
      } else {
        const prev = id ? this.vault.find(id) : null;
        values.meta.cliente = prev ? (prev.cliente || '') : '';
      }
      if(!VaultModel.validEmail(values.meta.correo)){
        this.view.showFormError('El correo no tiene un formato válido.', 'correo');
        return;
      }
      if(!VaultModel.validWeb(values.meta.web)){
        this.view.showFormError('La web tiene que ser una dirección http(s) o un dominio, por ejemplo https://cliente.com.', 'web');
        return;
      }
      if(!id && !values.secret.password){
        this.view.showFormError('La contraseña es obligatoria.');
        return;
      }
      this.vault.saveEntry(id, values.meta, values.secret).then(() => {
        toast.success(id ? 'Credencial actualizada' : 'Credencial guardada');
        this.view.closeForm();
      }).catch(() => {
        this.view.showFormError('No se pudo cifrar y guardar. Inténtalo de nuevo.');
      });
    }

    remove(id){
      if(!id || !this.vault.isReady()) return;
      const snap = this.vault.snapshot(id);
      this.vault.removeEntry(id).then(() => {
        toast.undoable('Credencial eliminada', () => this.vault.restore(snap), 'Credencial restaurada');
        this.view.closeForm();
      }, () => {
        toast.error('No se pudo eliminar la credencial');
        this.view.closeForm();
      });
    }
  }

  Workhub.controllers.VaultController = VaultController;
})();
