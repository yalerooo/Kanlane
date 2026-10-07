/* Gestor de contraseñas.
   - Cada credencial guarda sus metadatos en claro y {password, notas} cifrados
     con una clave de datos (DEK) aleatoria.
   - La DEK se guarda envuelta dos veces en 'vault_meta/check': con la contraseña
     maestra (PBKDF2) y con la clave de recuperación.
   - Los tableros antiguos ('legacy') cifraban directamente con la contraseña;
     al desbloquearlos se migran al esquema actual.
   - En un proyecto de equipo (this.team) el cofre es de todos, pero cada persona guarda la DEK
     envuelta con su propia contraseña maestra en 'vault_keys/{uid}' y 'vault_meta/check' solo marca
     que el cofre existe (ver team-vault.js). Quien aún no tiene la DEK la recibe con un código de
     acceso de un solo uso (redeem).
   - Con la verificación en dos pasos, los dos envoltorios (contraseña y clave de recuperación) no
     guardan {dek} sino {totp, iv, cipher}: la DEK cifrada con una clave que el servidor solo
     entrega tras un código válido (services/vault-totp.js), más el token que hay que presentarle.
     Así ni la contraseña ni la clave de recuperación abren el cofre sin el segundo paso. El campo
     «backup» guarda esa clave del servidor cifrada con cada código de respaldo. */
(function(){
  const cryptoSvc = Workhub.services.crypto;
  const META_PATH = 'vault_meta/check';
  const TeamVault = () => Workhub.models.TeamVault;
  const BACKUP_CODES = 10;
  const BACKUP_BYTES = 10;

  const TYPE_LABELS = {correo:'Correo / Web', usuario:'Usuario / Web', servidor:'Servidor', rdp:'RDP', vpn:'VPN'};

  class VaultModel extends Workhub.models.CollectionModel {
    constructor(){
      super('vault');
      this.key = null;
      this.unlocked = false;
      /* null (sin comprobar) | 'none' | 'legacy' | 'current'. En un equipo, además: 'grant' (el cofre
         existe y me falta mi clave: hace falta un código de acceso) y 'absent' (no hay cofre y solo
         el propietario puede crearlo). */
      this.metaState = null;
      /* Proyecto de equipo abierto: {tid, uid, email, owner, teams} (lo fija AppController). */
      this.team = null;
      /* Verificación en dos pasos: si este cofre la tiene (se sabe al abrirlo) y, entre la
         contraseña y el código, lo que falta por abrir: {token, iv, cipher}. */
      this.totp = false;
      this.pendingTotp = null;
      /* Contraseñas ya descifradas y cuáles se están mostrando. */
      this.revealed = {};
      this.visible = {};
    }

    static typeLabel(tipo){
      return TYPE_LABELS[tipo] || tipo;
    }

    static titleFor(v){
      const tipo = v.tipo || 'correo';
      const fallback = tipo === 'correo' ? v.correo : (tipo === 'servidor' || tipo === 'rdp') ? v.ip : v.usuario;
      return v.label || fallback || 'Sin título';
    }

    static orderOf(v){
      return v.order != null ? v.order : (v.createdAt || 0);
    }

    /* La web de una credencial: vacía, una dirección http(s) o un dominio o host (con puerto y ruta
       opcionales). Cualquier otro esquema (javascript:, data:, file:…) o un texto suelto no valen:
       hoy solo se muestra como texto, pero así no hay nada que ejecutar si algún día fuese un enlace. */
    static validWeb(text){
      const s = String(text == null ? '' : text).trim();
      if(!s) return true;
      if(/\s/.test(s)) return false;
      const full = /^https?:\/\//i.test(s);
      if(!full && (s.indexOf('://') !== -1 || !/^[\p{L}\p{N}[]/u.test(s))) return false;
      let url;
      try{ url = new URL(full ? s : 'http://' + s); }catch(e){ return false; }
      if(!url.hostname) return false;
      if(full) return true;
      /* Sin esquema tiene que parecer un dominio, una IP o localhost. */
      return !url.username && !url.password && (url.hostname === 'localhost' || url.hostname.indexOf('.') !== -1 || url.hostname[0] === '[');
    }

    /* El correo de una credencial es opcional; si se escribe, con forma de correo. */
    static validEmail(text){
      const s = String(text == null ? '' : text).trim();
      return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    }

    /* ---------- Metadatos y claves ---------- */

    /* Dónde está mi envoltorio de la DEK. */
    metaPath(){
      return this.team ? TeamVault().keyPath(this.team.uid) : META_PATH;
    }

    getMeta(requireServer){
      const ref = this.db.doc(this.metaPath());
      return requireServer && Workhub.services.platform.mode() === 'firebase'
        ? ref.get({source:'server'}) : ref.get();
    }

    setMeta(data){
      return this.db.doc(this.metaPath()).set(data);
    }

    /* Sin mi envoltorio: en un equipo depende de si el cofre ya existe y de si puedo crearlo. */
    _stateWithoutKey(){
      if(!this.team) return Promise.resolve('none');
      return this.db.doc(META_PATH).get().then((snap) => (snap.exists ? 'grant' : (this.team.owner ? 'none' : 'absent')));
    }

    checkMeta(){
      if(this.metaState !== null) return Promise.resolve(this.metaState);
      return this.getMeta().then((snap) => {
        if(!snap.exists && Workhub.services.platform.mode() === 'firebase') return this.getMeta(true);
        return snap;
      }).then((snap) => {
        if(snap.exists) return (snap.data() || {}).saltPassword ? 'current' : 'legacy';
        return this._stateWithoutKey();
      }).then((state) => {
        this.metaState = state;
        return state;
      });
    }

    /* Envuelve la DEK con la contraseña y con una clave de recuperación nueva.
       Devuelve {meta, recoveryKey}: el documento a guardar y la clave de recuperación formateada. */
    static wrapDek(password, dekB64, createdAt){
      return VaultModel.wrapInner(password, {dek:dekB64}, createdAt);
    }

    /* Lo mismo para lo que vaya dentro de los dos envoltorios: {dek}, o {totp, iv, cipher} con la
       verificación en dos pasos (así tampoco la clave de recuperación abre el cofre sin ella). */
    static wrapInner(password, inner, createdAt){
      const saltPassword = cryptoSvc.randomBytes(16);
      const recoveryBytes = cryptoSvc.randomBytes(32);
      return Promise.all([cryptoSvc.deriveKey(password, saltPassword), cryptoSvc.importAesKeyRaw(recoveryBytes)]).then((keys) => {
        return Promise.all([
          cryptoSvc.encryptJSON(keys[0], inner),
          cryptoSvc.encryptJSON(keys[1], inner)
        ]);
      }).then((wraps) => ({
        meta: {
          saltPassword: cryptoSvc.b64encode(saltPassword),
          ivPassword: wraps[0].iv, cipherPassword: wraps[0].cipher,
          ivRecovery: wraps[1].iv, cipherRecovery: wraps[1].cipher,
          createdAt: createdAt || Date.now(), updatedAt: Date.now()
        },
        recoveryKey: cryptoSvc.formatRecoveryKey(recoveryBytes)
      }));
    }

    /* Envuelve la DEK, guarda los metadatos y devuelve la clave de recuperación formateada. */
    _writeWrappedDek(password, dekB64, createdAt){
      return VaultModel.wrapDek(password, dekB64, createdAt).then((w) => this.setMeta(w.meta).then(() => w.recoveryKey));
    }

    /* ---------- Códigos de respaldo de la verificación en dos pasos ----------
       Diez códigos de un solo uso (80 bits cada uno, con el formato de la clave de recuperación).
       Cada uno cifra la clave que da el servidor tras un código TOTP, así que sustituyen al
       teléfono pero no a la contraseña maestra. Van en el campo «backup» del documento, fuera de
       los envoltorios: usar uno es borrar su entrada, y eso no pide la contraseña. */

    /* → {codes:[…], field}: los códigos para enseñar y lo que se guarda. */
    static makeBackup(share){
      const secrets = [];
      for(let i = 0; i < BACKUP_CODES; i++) secrets.push(cryptoSvc.randomBytes(BACKUP_BYTES));
      return Promise.all(secrets.map((bytes) => {
        return cryptoSvc.codeKey(bytes).then((key) => cryptoSvc.encryptJSON(key, {s:cryptoSvc.b64encode(share)})).then((enc) => enc.iv + ':' + enc.cipher);
      })).then((entries) => ({codes:secrets.map((bytes) => cryptoSvc.formatRecoveryKey(bytes)), field:entries.join('.')}));
    }

    static backupEntries(field){
      return typeof field === 'string' ? field.split('.').filter(Boolean) : [];
    }

    /* ¿Tiene forma de código de respaldo? (No dice si es bueno.) */
    static isBackupCode(text){
      return cryptoSvc.base32Decode(text).length === BACKUP_BYTES;
    }

    /* Abre con un código la clave del servidor: {share (bytes), rest (el campo sin ese código)}.
       Rechaza con 'bad-backup' si no es de los que quedan. */
    static openBackup(field, code){
      const fail = () => { const err = new Error('bad-backup'); err.code = 'bad-backup'; return err; };
      const bytes = cryptoSvc.base32Decode(code);
      const entries = VaultModel.backupEntries(field);
      if(bytes.length !== BACKUP_BYTES || !entries.length) return Promise.reject(fail());
      return cryptoSvc.codeKey(bytes).then((key) => Promise.all(entries.map((entry) => {
        const parts = entry.split(':');
        return cryptoSvc.decryptJSON(key, parts[0], parts[1]).then((obj) => obj, () => null);
      }))).then((opened) => {
        const at = opened.findIndex((obj) => obj && obj.s);
        if(at === -1) throw fail();
        return {share:cryptoSvc.b64decode(opened[at].s), rest:entries.filter((e, i) => i !== at).join('.')};
      });
    }

    /* La clave del servidor para un envoltorio con segundo paso. second: {verify(token) → bytes}
       (un código de la aplicación, que comprueba el servidor) o {backup:'código de respaldo'}.
       Devuelve {share, rest}; rest solo viene si se ha gastado un código de respaldo. */
    _shareFor(data, locked, second){
      if(second && second.backup) return VaultModel.openBackup(data.backup, second.backup);
      if(second && second.verify) return Promise.resolve(second.verify(locked.totp)).then((share) => ({share:share}));
      const err = new Error('totp-required');
      err.code = 'totp-required';
      return Promise.reject(err);
    }

    /* La DEK (base64) de un envoltorio con segundo paso, con la clave del servidor. */
    _dekWithShare(locked, share){
      return cryptoSvc.importAesKeyRaw(share).then((key) => cryptoSvc.decryptJSON(key, locked.iv, locked.cipher)).then((obj) => obj, () => null).then((obj) => {
        if(!obj || !obj.dek) throw new Error('bad-share');
        return obj.dek;
      });
    }

    /* Cuántos códigos de respaldo quedan. */
    backupLeft(){
      return this.getMeta().then((snap) => (snap.exists ? VaultModel.backupEntries(snap.data().backup).length : 0));
    }

    /* totp: si los envoltorios que se acaban de escribir llevan segundo paso. */
    _setUnlocked(key, totp){
      this.key = key;
      this.metaState = 'current';
      this.unlocked = true;
      this.totp = !!totp;
      this.pendingTotp = null;
      this.revealed = {};
      this.visible = {};
    }

    /* Cofre nuevo de un equipo: la marca del cofre y mi envoltorio se escriben a la vez, para que
       no pueda quedar un cofre del que nadie tiene la clave. */
    _createShared(password){
      const dek = cryptoSvc.randomBytes(32);
      const t = this.team;
      let recoveryKey;
      return this.db.doc(META_PATH).get().then((snap) => {
        if(snap.exists){
          this.metaState = 'grant';
          throw new Error('vault-exists');
        }
        return Promise.all([TeamVault().newCheck(dek, t.uid), VaultModel.wrapDek(password, cryptoSvc.b64encode(dek))]);
      }).then((made) => {
        recoveryKey = made[1].recoveryKey;
        const batch = t.teams.batch();
        batch.set(this.db.doc(META_PATH), made[0]);
        batch.set(this.db.doc(this.metaPath()), made[1].meta);
        return batch.commit();
      }).then(() => cryptoSvc.importAesKeyRaw(dek)).then((key) => {
        this._setUnlocked(key);
        return recoveryKey;
      });
    }

    /* Equipo: entro en el cofre con el código de acceso que me han dado y creo mi contraseña
       maestra. El acceso se borra: no sirve dos veces. Devuelve mi clave de recuperación.
       Errores (.code): 'bad-code', 'no-grant' (no hay acceso para mi correo o ha caducado). */
    redeem(code, password){
      const t = this.team;
      const PC = Workhub.services.projectCrypto;
      const fail = (c) => { const err = new Error(c); err.code = c; return err; };
      if(!t) return Promise.reject(fail('no-team'));
      const grantRef = this.db.doc(TeamVault().grantPath(t.email));
      let dek;
      return Promise.all([this.db.doc(META_PATH).get(), grantRef.get().catch(() => null)]).then((snaps) => {
        if(!snaps[0].exists || !snaps[1] || !snaps[1].exists) throw fail('no-grant');
        const check = snaps[0].data(), grant = snaps[1].data();
        return PC.unwrapCode(grant, code, {pid:check.pid, kid:check.kid, uid:grant.by}, true)
          .then((key) => crypto.subtle.exportKey('raw', key), () => { throw fail('bad-code'); })
          .then((raw) => {
            dek = new Uint8Array(raw);
            return TeamVault().matches(check, dek);
          }).then((ok) => { if(!ok) throw fail('bad-code'); });
      }).then(() => this._writeWrappedDek(password, cryptoSvc.b64encode(dek))).then((recoveryKey) => {
        return grantRef.delete().catch(() => null).then(() => cryptoSvc.importAesKeyRaw(dek)).then((key) => {
          this._setUnlocked(key);
          return recoveryKey;
        });
      });
    }

    /* Primera vez: crea la contraseña maestra. Devuelve la clave de recuperación. */
    create(password){
      if(this.team) return this._createShared(password);
      const dek = cryptoSvc.randomBytes(32);
      let recoveryKey;
      return this.getMeta(true).then((snap) => {
        if(snap.exists) {
          this.metaState = (snap.data() || {}).saltPassword ? 'current' : 'legacy';
          throw new Error('vault-exists');
        }
        return this._writeWrappedDek(password, cryptoSvc.b64encode(dek));
      }).then((rk) => {
        recoveryKey = rk;
        return cryptoSvc.importAesKeyRaw(dek);
      }).then((key) => {
        this._setUnlocked(key);
        return recoveryKey;
      });
    }

    /* Con verificación en dos pasos rechaza con 'totp-required' y deja en pendingTotp lo que falta:
       se termina con unlockWithShare(). */
    unlock(password){
      this.pendingTotp = null;
      return this.getMeta().then((snap) => {
        if(!snap.exists){
          return this._stateWithoutKey().then((state) => {
            this.metaState = state;
            throw new Error('no-check');
          });
        }
        const data = snap.data();
        return cryptoSvc.deriveKey(password, cryptoSvc.b64decode(data.saltPassword)).then((kek) => {
          return cryptoSvc.decryptJSON(kek, data.ivPassword, data.cipherPassword);
        }).then((obj) => {
          if(obj && obj.totp && obj.cipher){
            this.pendingTotp = {token:obj.totp, iv:obj.iv, cipher:obj.cipher};
            throw new Error('totp-required');
          }
          if(!obj || !obj.dek) throw new Error('bad-pass');
          return cryptoSvc.importAesKeyRaw(cryptoSvc.b64decode(obj.dek));
        });
      }).then((key) => {
        this.key = key;
        this.unlocked = true;
        this.totp = false;
      });
    }

    /* Segundo paso: la clave que ha dado el servidor (bytes) abre lo que dejó unlock(). */
    unlockWithShare(share){
      const pending = this.pendingTotp;
      if(!pending) return Promise.reject(new Error('no-pending'));
      return cryptoSvc.importAesKeyRaw(share).then((key) => cryptoSvc.decryptJSON(key, pending.iv, pending.cipher)).then((obj) => {
        if(!obj || !obj.dek) throw new Error('bad-share');
        return cryptoSvc.importAesKeyRaw(cryptoSvc.b64decode(obj.dek));
      }).then((key) => {
        this.key = key;
        this.unlocked = true;
        this.totp = true;
        this.pendingTotp = null;
      });
    }

    /* Segundo paso con un código de respaldo en vez del teléfono. El código se gasta: su entrada
       se borra del documento. Devuelve cuántos quedan. Rechaza con 'bad-backup'. */
    unlockWithBackup(code){
      if(!this.pendingTotp) return Promise.reject(new Error('no-pending'));
      let data, rest;
      return this.getMeta().then((snap) => {
        data = snap.exists ? snap.data() : {};
        return VaultModel.openBackup(data.backup, code);
      }).then((opened) => {
        rest = opened.rest;
        return this.unlockWithShare(opened.share);
      }).then(() => {
        /* Sin esperar a que se guarde: sin conexión esa escritura tarda y el cofre ya está abierto. */
        Promise.resolve(this.setMeta(Object.assign({}, data, {backup:rest, updatedAt:Date.now()}))).catch(() => {});
        return VaultModel.backupEntries(rest).length;
      });
    }

    /* Cambia la contraseña maestra. Lo de dentro del envoltorio no cambia: con verificación en dos
       pasos sigue haciendo falta el código, y la clave de recuperación sigue siendo la misma.
       Errores: 'bad-pass'. */
    changePassword(current, next){
      return this._openPasswordWrap(current).then((o) => this._rewrapPassword(next, o.data, o.obj));
    }

    /* Lo que hay dentro del envoltorio de la contraseña: {data, obj}. 'bad-pass' si no es esa. */
    _openPasswordWrap(password){
      return this.getMeta(true).then((snap) => {
        if(!snap.exists || !(snap.data() || {}).saltPassword) throw new Error('no-check');
        const data = snap.data();
        return cryptoSvc.deriveKey(password, cryptoSvc.b64decode(data.saltPassword))
          .then((kek) => cryptoSvc.decryptJSON(kek, data.ivPassword, data.cipherPassword))
          .then((obj) => obj, () => null)
          .then((obj) => {
            if(!obj || (!obj.dek && !obj.totp)) throw new Error('bad-pass');
            return {data:data, obj:obj};
          });
      });
    }

    /* Vuelve a escribir solo el envoltorio de la contraseña; el de recuperación no se toca. */
    _rewrapPassword(password, data, inner){
      const saltPassword = cryptoSvc.randomBytes(16);
      return cryptoSvc.deriveKey(password, saltPassword).then((kek) => cryptoSvc.encryptJSON(kek, inner)).then((wrap) => {
        return this.setMeta(Object.assign({}, data, {
          saltPassword: cryptoSvc.b64encode(saltPassword),
          ivPassword: wrap.iv, cipherPassword: wrap.cipher,
          updatedAt: Date.now()
        }));
      });
    }

    /* Activa la verificación en dos pasos. enroll() → Promise<{token, share}>: el alta en el
       servidor, que solo se pide si la contraseña es la buena.
       Se escriben de nuevo los dos envoltorios, así que la clave de recuperación cambia (la
       anterior abría el cofre sin segundo paso). Devuelve {recoveryKey, codes}: la clave nueva y
       los códigos de respaldo.
       Errores: 'bad-pass', 'totp-on' (ya estaba activada) y los de enroll(). */
    enableTotp(password, enroll){
      let opened, out;
      return this._openPasswordWrap(password).then((o) => {
        if(!o.obj.dek) throw new Error('totp-on');
        opened = o;
        return enroll();
      }).then((made) => {
        return cryptoSvc.importAesKeyRaw(made.share)
          .then((key) => cryptoSvc.encryptJSON(key, {dek:opened.obj.dek}))
          .then((enc) => Promise.all([
            VaultModel.wrapInner(password, {totp:made.token, iv:enc.iv, cipher:enc.cipher}, opened.data.createdAt),
            VaultModel.makeBackup(made.share)
          ]));
      }).then((made) => {
        out = {recoveryKey:made[0].recoveryKey, codes:made[1].codes};
        return this.setMeta(Object.assign(made[0].meta, {backup:made[1].field}));
      }).then(() => {
        this.totp = true;
        return out;
      });
    }

    /* La desactiva. second: un código de la aplicación o uno de respaldo (ver _shareFor).
       También cambia la clave de recuperación, que vuelve a abrir el cofre ella sola; devuelve la
       nueva. Errores: 'bad-pass', 'totp-off' (no estaba activada), 'bad-backup' y los de verify(). */
    disableTotp(password, second){
      let opened, recoveryKey;
      return this._openPasswordWrap(password).then((o) => {
        if(!o.obj.totp) throw new Error('totp-off');
        opened = o;
        return this._shareFor(o.data, o.obj, second);
      }).then((got) => this._dekWithShare(opened.obj, got.share))
        .then((dek) => VaultModel.wrapDek(password, dek, opened.data.createdAt))
        .then((w) => {
          recoveryKey = w.recoveryKey;
          return this.setMeta(w.meta);
        }).then(() => {
          this.totp = false;
          return recoveryKey;
        });
    }

    /* Códigos de respaldo nuevos: los anteriores dejan de valer. Devuelve los códigos.
       Errores: los de disableTotp(). */
    newBackupCodes(password, second){
      let opened, share, codes;
      return this._openPasswordWrap(password).then((o) => {
        if(!o.obj.totp) throw new Error('totp-off');
        opened = o;
        return this._shareFor(o.data, o.obj, second);
      }).then((got) => {
        share = got.share;
        /* Que la clave sea la buena antes de cifrar con ella códigos que no servirían. */
        return this._dekWithShare(opened.obj, share);
      }).then(() => VaultModel.makeBackup(share)).then((made) => {
        codes = made.codes;
        return this.setMeta(Object.assign({}, opened.data, {backup:made.field, updatedAt:Date.now()}));
      }).then(() => codes);
    }

    /* La migración conserva iv/cipher antiguos. Solo después de guardar todas
       las copias v2 sustituye los metadatos. Así cualquier fallo deja el
       tablero antiguo recuperable con su contraseña. */
    unlockLegacy(password){
      /* En un proyecto con cifrado total no puede haber cofres del formato antiguo. */
      if(this.cipher) return Promise.reject(new Error('legacy-in-encrypted'));
      let meta, oldKey, newDekBytes, newKey;
      return this.getMeta().then((snap) => {
        meta = snap.data() || {};
        return cryptoSvc.deriveKey(password, cryptoSvc.b64decode(meta.salt));
      }).then((key) => {
        oldKey = key;
        return cryptoSvc.decryptJSON(oldKey, meta.iv, meta.cipher);
      }).then((obj) => {
        if(!obj || obj.check !== 'OK') throw new Error('bad-pass');
        return this.col.get();
      }).then((vsnap) => {
        newDekBytes = cryptoSvc.randomBytes(32);
        return cryptoSvc.importAesKeyRaw(newDekBytes).then((key) => {
          newKey = key;
          return Promise.all(vsnap.docs.map((d) => {
            const edata = d.data() || {};
            return cryptoSvc.decryptJSON(oldKey, edata.iv, edata.cipher).then((plain) => {
              return cryptoSvc.encryptJSON(newKey, {password:plain.password || '', notas:plain.notas || ''});
            }).then((enc) => {
              const patch = {ivV2:enc.iv, cipherV2:enc.cipher, updatedAt:Date.now()};
              return this.update(d.id, patch).then(() => {
                const item = this.find(d.id);
                if(item) Object.assign(item, patch);
              });
            });
          }));
        });
      }).then(() => {
        return this._writeWrappedDek(password, cryptoSvc.b64encode(newDekBytes), meta.createdAt);
      }).then((recoveryKey) => {
        this._setUnlocked(newKey);
        return recoveryKey;
      });
    }

    /* Restablece la contraseña maestra con la clave de recuperación.
       Devuelve la clave de recuperación nueva (la anterior queda invalidada).
       Con verificación en dos pasos la clave de recuperación no basta: hace falta además second
       (un código de la aplicación o uno de respaldo, ver _shareFor), y el segundo paso sigue
       activado después. Sin second rechaza con 'totp-required' (.code) y no cambia nada.
       Errores: 'no-recovery', 'bad-key', 'totp-required', 'bad-backup', 'bad-share' y los de verify(). */
    recover(recoveryKeyBytes, newPassword, second){
      let data, locked = null, dekB64, backup, recoveryKey;
      return cryptoSvc.importAesKeyRaw(recoveryKeyBytes).then((kekRecovery) => {
        return this.getMeta().then((snap) => {
          if(!snap.exists || !snap.data().ivRecovery) throw new Error('no-recovery');
          data = snap.data();
          return cryptoSvc.decryptJSON(kekRecovery, data.ivRecovery, data.cipherRecovery).then((obj) => obj, () => null);
        });
      }).then((obj) => {
        if(!obj || (!obj.dek && !obj.totp)) throw new Error('bad-key');
        if(obj.dek){ dekB64 = obj.dek; return; }
        locked = {totp:obj.totp, iv:obj.iv, cipher:obj.cipher};
        return this._shareFor(data, locked, second).then((got) => {
          backup = got.rest !== undefined ? got.rest : (data.backup || '');
          return this._dekWithShare(locked, got.share);
        }).then((dek) => { dekB64 = dek; });
      }).then(() => VaultModel.wrapInner(newPassword, locked || {dek:dekB64}, data.createdAt)).then((w) => {
        recoveryKey = w.recoveryKey;
        return this.setMeta(locked ? Object.assign(w.meta, {backup:backup}) : w.meta);
      }).then(() => cryptoSvc.importAesKeyRaw(cryptoSvc.b64decode(dekB64))).then((key) => {
        this._setUnlocked(key, !!locked);
        return recoveryKey;
      });
    }

    /* Cada proyecto tiene su propio gestor: al cambiar, se bloquea y se vuelve
       a comprobar si tiene contraseña maestra. */
    connect(db, cipher){
      this.lock();
      this.metaState = null;
      super.connect(db, cipher);
    }

    lock(){
      this.key = null;
      this.unlocked = false;
      this.totp = false;
      this.pendingTotp = null;
      this.revealed = {};
      this.visible = {};
    }

    /* ---------- Credenciales ---------- */

    decrypt(entry){
      const upgraded = this.metaState === 'current' && entry.ivV2 && entry.cipherV2;
      return cryptoSvc.decryptJSON(this.key, upgraded ? entry.ivV2 : entry.iv, upgraded ? entry.cipherV2 : entry.cipher);
    }

    /* Descifra (con caché) los datos secretos de una credencial. */
    reveal(id){
      if(this.revealed[id]) return Promise.resolve(this.revealed[id]);
      const entry = this.find(id);
      if(!entry) return Promise.reject(new Error('not-found'));
      return this.decrypt(entry).then((data) => {
        this.revealed[id] = data;
        return data;
      });
    }

    /* Alterna mostrar/ocultar la contraseña; la primera vez la descifra. */
    toggleVisible(id){
      if(this.revealed[id]){
        this.visible[id] = !this.visible[id];
        return Promise.resolve();
      }
      return this.reveal(id).then(() => { this.visible[id] = true; });
    }

    isVisible(id){
      return !!this.visible[id];
    }

    /* Texto que se muestra en lugar de la contraseña cuando está oculta. */
    passwordText(id){
      const data = this.revealed[id];
      return this.visible[id] && data ? data.password : '••••••••';
    }

    forget(id){
      delete this.revealed[id];
      delete this.visible[id];
    }

    filter(query, tipo, cliente){
      const q = (query || '').trim().toLowerCase();
      return this.items.filter((v) => {
        if(tipo && v.tipo !== tipo) return false;
        if(cliente && (v.cliente || 'Sin cliente') !== cliente) return false;
        if(q){
          const hay = ((v.cliente || '') + ' ' + (v.label || '') + ' ' + (v.correo || '') + ' ' + (v.web || '') + ' ' + (v.ip || '') + ' ' + (v.usuario || '')).toLowerCase();
          if(hay.indexOf(q) === -1) return false;
        }
        return true;
      }).sort((a, b) => VaultModel.orderOf(a) - VaultModel.orderOf(b));
    }

    lastClient(){
      return this.items.length ? this.items[this.items.length - 1].cliente : '';
    }

    /* Mueve draggedId a la posición de targetId dentro de la lista visible. */
    reorder(list, draggedId, targetId){
      if(!this.isReady() || draggedId === targetId) return;
      const fromIdx = list.findIndex((v) => v.id === draggedId);
      const toIdx = list.findIndex((v) => v.id === targetId);
      if(fromIdx === -1 || toIdx === -1) return;
      list = list.slice();
      const moved = list.splice(fromIdx, 1)[0];
      list.splice(toIdx, 0, moved);
      const updates = list.map((v, i) => ({id:v.id, order:(i + 1) * 10}));
      updates.forEach((u) => {
        const e = this.find(u.id);
        if(e) e.order = u.order;
      });
      this.emit('change');
      Promise.all(updates.map((u) => this.update(u.id, {order:u.order}))).catch(() => {});
    }

    /* Cifra los datos secretos y guarda la credencial (nueva o existente). */
    saveEntry(id, meta, secret){
      const existing = id ? this.find(id) : null;
      meta.order = existing ? VaultModel.orderOf(existing) : Date.now();
      meta.createdAt = existing ? existing.createdAt : Date.now();
      meta.updatedAt = Date.now();
      return cryptoSvc.encryptJSON(this.key, secret).then((enc) => {
        meta.iv = enc.iv;
        meta.cipher = enc.cipher;
        return id ? this.set(id, meta) : this.add(meta);
      }).then(() => {
        if(id) this.forget(id);
      });
    }

    removeEntry(id){
      return this.remove(id).then(() => this.forget(id));
    }
  }

  VaultModel.TYPE_LABELS = TYPE_LABELS;
  Workhub.models.VaultModel = VaultModel;
})();
