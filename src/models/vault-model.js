/* Gestor de contraseñas.
   - Cada credencial guarda sus metadatos en claro y {password, notas} cifrados
     con una clave de datos (DEK) aleatoria.
   - La DEK se guarda envuelta dos veces en 'vault_meta/check': con la contraseña
     maestra (PBKDF2) y con la clave de recuperación.
   - Los tableros antiguos ('legacy') cifraban directamente con la contraseña;
     al desbloquearlos se migran al esquema actual. */
(function(){
  const cryptoSvc = Workhub.services.crypto;
  const META_PATH = 'vault_meta/check';

  const TYPE_LABELS = {correo:'Correo / Web', usuario:'Usuario / Web', servidor:'Servidor', rdp:'RDP', vpn:'VPN'};

  class VaultModel extends Workhub.models.CollectionModel {
    constructor(){
      super('vault');
      this.key = null;
      this.unlocked = false;
      /* null (sin comprobar) | 'none' | 'legacy' | 'current' */
      this.metaState = null;
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

    /* ---------- Metadatos y claves ---------- */

    getMeta(requireServer){
      const ref = this.db.doc(META_PATH);
      return requireServer && Workhub.services.platform.mode() === 'firebase'
        ? ref.get({source:'server'}) : ref.get();
    }

    setMeta(data){
      return this.db.doc(META_PATH).set(data);
    }

    checkMeta(){
      if(this.metaState !== null) return Promise.resolve(this.metaState);
      return this.getMeta().then((snap) => {
        if(!snap.exists && Workhub.services.platform.mode() === 'firebase') return this.getMeta(true);
        return snap;
      }).then((snap) => {
        if(!snap.exists) this.metaState = 'none';
        else this.metaState = (snap.data() || {}).saltPassword ? 'current' : 'legacy';
        return this.metaState;
      });
    }

    /* Envuelve la DEK con la contraseña y con una clave de recuperación nueva,
       guarda los metadatos y devuelve la clave de recuperación formateada. */
    _writeWrappedDek(password, dekB64, createdAt){
      const saltPassword = cryptoSvc.randomBytes(16);
      const recoveryBytes = cryptoSvc.randomBytes(32);
      return Promise.all([cryptoSvc.deriveKey(password, saltPassword), cryptoSvc.importAesKeyRaw(recoveryBytes)]).then((keys) => {
        return Promise.all([
          cryptoSvc.encryptJSON(keys[0], {dek:dekB64}),
          cryptoSvc.encryptJSON(keys[1], {dek:dekB64})
        ]);
      }).then((wraps) => {
        return this.setMeta({
          saltPassword: cryptoSvc.b64encode(saltPassword),
          ivPassword: wraps[0].iv, cipherPassword: wraps[0].cipher,
          ivRecovery: wraps[1].iv, cipherRecovery: wraps[1].cipher,
          createdAt: createdAt || Date.now(), updatedAt: Date.now()
        });
      }).then(() => cryptoSvc.formatRecoveryKey(recoveryBytes));
    }

    _setUnlocked(key){
      this.key = key;
      this.metaState = 'current';
      this.unlocked = true;
      this.revealed = {};
      this.visible = {};
    }

    /* Primera vez: crea la contraseña maestra. Devuelve la clave de recuperación. */
    create(password){
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

    unlock(password){
      return this.getMeta().then((snap) => {
        if(!snap.exists){
          this.metaState = 'none';
          throw new Error('no-check');
        }
        const data = snap.data();
        return cryptoSvc.deriveKey(password, cryptoSvc.b64decode(data.saltPassword)).then((kek) => {
          return cryptoSvc.decryptJSON(kek, data.ivPassword, data.cipherPassword);
        }).then((obj) => {
          if(!obj || !obj.dek) throw new Error('bad-pass');
          return cryptoSvc.importAesKeyRaw(cryptoSvc.b64decode(obj.dek));
        });
      }).then((key) => {
        this.key = key;
        this.unlocked = true;
      });
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
       Devuelve la clave de recuperación nueva (la anterior queda invalidada). */
    recover(recoveryKeyBytes, newPassword){
      let dekB64;
      return cryptoSvc.importAesKeyRaw(recoveryKeyBytes).then((kekRecovery) => {
        return this.getMeta().then((snap) => {
          if(!snap.exists || !snap.data().ivRecovery) throw new Error('no-recovery');
          const data = snap.data();
          return cryptoSvc.decryptJSON(kekRecovery, data.ivRecovery, data.cipherRecovery).then((obj) => {
            if(!obj || !obj.dek) throw new Error('bad-key');
            dekB64 = obj.dek;
            return this._writeWrappedDek(newPassword, dekB64, data.createdAt);
          });
        });
      }).then((recoveryKey) => {
        return cryptoSvc.importAesKeyRaw(cryptoSvc.b64decode(dekB64)).then((key) => {
          this._setUnlocked(key);
          return recoveryKey;
        });
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
