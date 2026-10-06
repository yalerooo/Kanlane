/* Gestor de contraseñas: bloqueo/desbloqueo, recuperación y credenciales. */
(function(){
  const cryptoSvc = Workhub.services.crypto;
  const platform = Workhub.services.platform;
  const toast = Workhub.views.toast;
  const MIN_PASSWORD_LENGTH = 8;
  const RECOVERY_KEY_BYTES = 32;
  const TeamVault = Workhub.models.TeamVault;
  const P = Workhub.models.ProjectModel;

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
      /* Enlace de acceso a las contraseñas de un equipo: en cuanto soy miembro, se abre ese proyecto
         por la sección de contraseñas. */
      this.linkFollowed = false;
      app.models.projects.on('change', () => this.followLink());
      this.view.bindRecover((key, p1, p2) => this.recover(key, p1, p2));
      this.view.bindRecoveryActions({
        continue: () => {
          this.awaitingRecoveryConfirm = false;
          this.showContent();
        },
        download: (key) => platform.download(Workhub.i18n.lang === 'en' ? 'vault-recovery-key.txt' : 'vault-clave-recuperacion.txt', recoveryFileText(key))
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

    presentRecoveryKey(key, isReset){
      this.awaitingRecoveryConfirm = true;
      this.view.presentRecoveryKey(key, isReset);
    }

    /* ---------- Desbloqueo ---------- */

    unlock(pass, pass2, code){
      if(!pass || !this.vault.isReady()) return;
      const state = this.vault.metaState;
      const done = () => this.view.setUnlocking(false, this.vault.metaState);
      this.view.setUnlocking(true);

      if(state === 'grant'){
        const clean = TeamVault.parseCode(code);
        if(!clean){ this.view.showLockError('Pega el enlace o el código de acceso que te ha dado el propietario.'); done(); return; }
        if(pass !== pass2){ this.view.showLockError('Las dos contraseñas no coinciden.'); done(); return; }
        if(pass.length < MIN_PASSWORD_LENGTH){ this.view.showLockError('Usa al menos 8 caracteres.'); done(); return; }
        this.vault.redeem(clean, pass).then((key) => {
          TeamVault.clearLink();
          this.presentRecoveryKey(key, false);
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
        if(pass.length < MIN_PASSWORD_LENGTH){ this.view.showLockError('Usa al menos 8 caracteres.'); done(); return; }
        this.vault.create(pass).then((key) => this.presentRecoveryKey(key, false)).catch((err) => {
          if(err && err.message === 'vault-exists') this.setLockMode(this.vault.metaState);
          this.view.showLockError('No se pudo crear la contraseña maestra. Comprueba la conexión y vuelve a intentarlo.');
        }).finally(done);
      } else if(state === 'legacy'){
        this.vault.unlockLegacy(pass).then((key) => this.presentRecoveryKey(key, false)).catch(() => {
          this.view.showLockError('No se pudo desbloquear o migrar el gestor. Comprueba la contraseña y la conexión.');
        }).finally(done);
      } else {
        this.vault.unlock(pass).then(() => {
          this.view.clearPasswords();
          this.showContent();
        }).catch((err) => {
          if(err && err.message === 'no-check') this.setLockMode(this.vault.metaState || 'none');
          else this.view.showLockError('Contraseña maestra incorrecta.');
        }).finally(done);
      }
    }

    recover(keyText, newPass, newPass2){
      if(!this.vault.isReady()){ this.view.showRecoverError('No hay conexión con el almacenamiento.'); return; }
      const keyBytes = cryptoSvc.base32Decode(keyText);
      if(keyBytes.length !== RECOVERY_KEY_BYTES){
        this.view.showRecoverError('Clave de recuperación no válida. Revisa que la has copiado completa.');
        return;
      }
      if(newPass !== newPass2){ this.view.showRecoverError('Las dos contraseñas nuevas no coinciden.'); return; }
      if(newPass.length < MIN_PASSWORD_LENGTH){ this.view.showRecoverError('Usa al menos 8 caracteres.'); return; }

      this.view.setRecovering(true);
      this.vault.recover(keyBytes, newPass).then((key) => this.presentRecoveryKey(key, true)).catch((err) => {
        this.view.showRecoverError(err && err.message === 'no-recovery'
          ? 'Este tablero todavía no tiene una clave de recuperación generada.'
          : 'La clave de recuperación no es correcta.');
      }).finally(() => this.view.setRecovering(false));
    }

    lock(){
      this.vault.lock();
      this.awaitingRecoveryConfirm = false;
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
