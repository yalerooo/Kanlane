/* Contraseñas compartidas de un proyecto de equipo (docs/EQUIPOS.md, «Contraseñas compartidas»).

   Las credenciales (teams/{id}/vault) se cifran en el navegador con una clave del cofre (DEK) que es
   la misma para todo el equipo, pero el servidor nunca la ve y cada persona la guarda envuelta con SU
   contraseña maestra y SU clave de recuperación:

   - vault_meta/check    marca de que el cofre existe: {pid, kid} para los envoltorios y una
                         comprobación cifrada con la DEK. Se crea una vez y no cambia.
   - vault_keys/{uid}    la DEK envuelta por cada miembro (solo la lee él). Mismo formato que el
                         vault_meta/check de un proyecto personal.
   - vault_grants/{correo}  la DEK envuelta con un código de acceso de un solo uso, para una persona
                         concreta: es lo que lleva el enlace que da el propietario. Caduca a las 24 h
                         (lo aplican las reglas) y se borra al usarlo.

   VaultModel lleva el cofre del proyecto abierto; aquí está lo que se hace desde «Compartir»
   (dar acceso, mover el cofre al convertir un proyecto) y el enlace de acceso. */
(function(){
  const cs = Workhub.services.crypto;
  const CHECK = 'vault_meta/check';
  const KEY_FIELDS = ['saltPassword', 'ivPassword', 'cipherPassword', 'ivRecovery', 'cipherRecovery', 'createdAt', 'updatedAt'];
  const LINK_KEY = 'workhub_vault_link';
  const LINK_RE = /[#&]cofre=([A-Za-z0-9_-]{1,64})\.([0-9A-Za-z-]{20,40})/;

  const PC = () => Workhub.services.projectCrypto;

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  const keyPath = (uid) => 'vault_keys/' + uid;
  const grantPath = (email) => 'vault_grants/' + String(email || '').trim().toLowerCase();

  /* Marca del cofre de un equipo, para una DEK (bytes). */
  function newCheck(dek, uid){
    return cs.importAesKeyRaw(dek).then((key) => cs.encryptJSON(key, {check:'OK'})).then((enc) => ({
      v:1, pid:PC().newPid(), kid:PC().newKid(), iv:enc.iv, cipher:enc.cipher, createdBy:uid, createdAt:Date.now()
    }));
  }

  /* ¿Esa DEK (bytes) es la del cofre de la marca? */
  function matches(check, dek){
    return cs.importAesKeyRaw(dek).then((key) => cs.decryptJSON(key, check.iv, check.cipher))
      .then((obj) => !!obj && obj.check === 'OK', () => false);
  }

  /* DEK (bytes) de un envoltorio, con la contraseña maestra. Errores: 'no-vault', 'legacy', 'bad-pass'
     y 'totp' (el cofre pide además un código: aquí no se puede abrir). */
  function openWithPassword(meta, password){
    if(!meta) return Promise.reject(fail('no-vault'));
    if(!meta.saltPassword) return Promise.reject(fail('legacy'));
    return cs.deriveKey(password, cs.b64decode(meta.saltPassword))
      .then((kek) => cs.decryptJSON(kek, meta.ivPassword, meta.cipherPassword))
      .then((obj) => obj, () => null)
      .then((obj) => {
        if(obj && obj.totp) throw fail('totp');
        if(!obj || !obj.dek) throw fail('bad-pass');
        return cs.b64decode(obj.dek);
      });
  }

  /* ¿El equipo tiene cofre? */
  function exists(rootDb, tid){
    return rootDb.team(tid).doc(CHECK).get().then((snap) => snap.exists);
  }

  /* Abre mi copia de la clave del cofre de un equipo con mi contraseña maestra.
     Devuelve {dek, check}. Errores: 'no-vault' (el equipo no tiene cofre), 'no-access' (yo no tengo
     clave), 'bad-pass'. */
  function unlock(rootDb, tid, password){
    const team = rootDb.team(tid);
    return Promise.all([team.doc(CHECK).get(), team.doc(keyPath(rootDb.me.uid)).get()]).then((snaps) => {
      if(!snaps[0].exists) throw fail('no-vault');
      if(!snaps[1].exists) throw fail('no-access');
      return openWithPassword(snaps[1].data(), password).then((dek) => ({dek:dek, check:snaps[0].data()}));
    });
  }

  /* Deja para ese correo la clave del cofre envuelta con un código nuevo y devuelve el código.
     opened: lo que devuelve unlock(). Un acceso anterior al mismo correo deja de servir. */
  function grant(rootDb, tid, email, opened){
    const code = PC().newAccessCode();
    const me = rootDb.me.uid;
    const ref = rootDb.team(tid).doc(grantPath(email));
    return PC().wrapCode(opened.dek, code.text, {pid:opened.check.pid, kid:opened.check.kid, uid:me}).then((wrap) => {
      /* No se puede sobrescribir (las reglas no dejan actualizar): primero se quita el anterior. */
      return ref.delete().catch(() => null).then(() => ref.set(Object.assign({}, wrap, {by:me, createdAt:rootDb.teams.serverTimestamp()})));
    }).then(() => code.text);
  }

  function revoke(rootDb, tid, email){
    if(!email) return Promise.resolve();
    return rootDb.team(tid).doc(grantPath(email)).delete().catch(() => null);
  }

  /* Quien sale del equipo se queda sin su clave envuelta y sin acceso pendiente. Lo que ya vio no
     se le puede quitar. */
  function forgetMember(rootDb, tid, uid, email){
    return Promise.all([
      rootDb.team(tid).doc(keyPath(uid)).delete().catch(() => null),
      revoke(rootDb, tid, email)
    ]);
  }

  /* Convertir un proyecto personal en equipo: lo que hace falta para llevarse su cofre.
     src: base de datos del proyecto personal. Devuelve null si no hay credenciales que mover, o
     {check, key}: la marca del cofre del equipo y mi clave envuelta (la misma contraseña maestra y la
     misma clave de recuperación que tenía en el proyecto personal).
     Errores: 'needs-vault-pass', 'legacy', 'bad-pass'. */
  function prepareMove(src, uid, password){
    return Promise.all([src.doc(CHECK).get(), src.collection('vault').get()]).then((snaps) => {
      const meta = snaps[0].exists ? snaps[0].data() : null;
      if(!meta || !snaps[1].docs.length) return null;
      if(!meta.saltPassword) throw fail('legacy');
      if(!password) throw fail('needs-vault-pass');
      return openWithPassword(meta, password).then((dek) => newCheck(dek, uid)).then((check) => {
        const key = {};
        KEY_FIELDS.forEach((k) => { if(meta[k] !== undefined) key[k] = meta[k]; });
        return {check:check, key:key};
      });
    });
  }

  /* ---------- enlace de acceso ---------- */

  /* El código va detrás de la almohadilla: el navegador no lo envía a ningún servidor. */
  function linkFor(tid, code){
    return location.origin + location.pathname + '#cofre=' + tid + '.' + String(code).replace(/-/g, '');
  }

  /* Código de lo que se pegue: el enlace entero o el código suelto. Normalizado o null. */
  function parseCode(text){
    const m = LINK_RE.exec(String(text || ''));
    return PC().parseAccessCode(m ? m[2] : text);
  }

  /* Al abrir la app con un enlace de acceso: se aparta el código (solo dura lo que la pestaña) y se
     quita de la barra de direcciones. */
  function captureLink(){
    try{
      const m = LINK_RE.exec(location.hash || '');
      if(!m) return;
      sessionStorage.setItem(LINK_KEY, JSON.stringify({tid:m[1], code:m[2]}));
      history.replaceState(null, '', location.pathname + location.search);
    }catch(e){}
  }

  /* {tid, code} del enlace con el que se abrió la app, o null. */
  function pendingLink(){
    try{
      const link = JSON.parse(sessionStorage.getItem(LINK_KEY) || 'null');
      return link && link.tid && link.code ? link : null;
    }catch(e){ return null; }
  }

  function clearLink(){
    try{ sessionStorage.removeItem(LINK_KEY); }catch(e){}
  }

  if(typeof location !== 'undefined') captureLink();

  Workhub.models.TeamVault = {
    CHECK, keyPath, grantPath, newCheck, matches, openWithPassword,
    exists, unlock, grant, revoke, forgetMember, prepareMove,
    linkFor, parseCode, pendingLink, clearLink
  };
})();
