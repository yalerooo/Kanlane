/* Backend en la nube con Firebase: inicio de sesión (Firebase Authentication)
   y datos por usuario en Firestore bajo users/{uid}/…

   La app no sabe nada de Firebase: este servicio instala en window.claude la
   misma interfaz que ya usan los modelos (use('db'|'assets'|'downloads')).
   La API "compat" de Firestore tiene la misma forma (collection, doc, where,
   orderBy, onSnapshot, add, set, update, delete), así que la base de datos se
   entrega casi tal cual, solo acotada a la carpeta del usuario. */
(function(){
  const SDK_VERSION = '10.14.1';
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
  const SDK_FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];

  /* Imágenes de notas: se guardan comprimidas en Firestore (máx. ~1 MiB por documento). */
  const IMAGE_MAX_SIDE = 1600;
  const IMAGE_MAX_BYTES = 850 * 1024;

  let fb = null;        /* espacio de nombres firebase */
  let auth = null;
  let firestore = null;
  /* Borrado de la caché local en curso (ver clearLocalCache). */
  let clearing = Promise.resolve();
  /* Acceso pendiente de unir a una cuenta: {credential, email}. Ver rememberPending. */
  let pendingLink = null;

  function config(){
    return window.WORKHUB_FIREBASE || {};
  }

  /* Solo si hay configuración, se sirve por http(s) (el acceso con Google y
     compañía no funciona en file://) y no estamos dentro de claude.ai. */
  function isEnabled(){
    const c = config();
    const insideClaude = window.claude && !window.__usingLocalStorageShim;
    return !!(c.apiKey && c.projectId) && /^https?:$/.test(location.protocol) && !insideClaude;
  }

  /* Dominio donde se completa el inicio de sesión.
     Si la web se sirve desde un dominio de hostingDomains (por ejemplo el de
     Cloudflare, que reenvía /__/auth/* a Firebase con worker/index.js), el acceso
     se completa en ese mismo dominio: así no depende del almacenamiento entre
     sitios, que Chrome, Safari o Firefox bloquean cada vez más. En el resto de
     casos (Firebase Hosting, localhost) se usa authDomain tal cual. */
  function resolveAuthDomain(c, host){
    return (c.hostingDomains || []).indexOf(host) !== -1 ? host : c.authDomain;
  }

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('sdk-load'));
      document.head.appendChild(s);
    });
  }

  /* Carga el SDK (en orden: app, auth, firestore) e inicializa el proyecto. */
  function init(){
    if(fb) return Promise.resolve();
    return SDK_FILES.reduce((p, f) => p.then(() => loadScript(SDK_BASE + f)), Promise.resolve()).then(() => {
      fb = window.firebase;
      const c = config();
      fb.initializeApp({
        apiKey: c.apiKey, authDomain: resolveAuthDomain(c, location.host), projectId: c.projectId,
        storageBucket: c.storageBucket, messagingSenderId: c.messagingSenderId, appId: c.appId
      });
      auth = fb.auth();
      auth.languageCode = 'es';
      firestore = fb.firestore();
      /* Firestore rechaza campos undefined; así se ignoran en vez de fallar. */
      firestore.settings({ignoreUndefinedProperties:true, merge:true});
      if(c.useEmulators && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
        auth.useEmulator('http://127.0.0.1:' + (c.authEmulatorPort || 9099), {disableWarnings:true});
        firestore.useEmulator('127.0.0.1', c.firestoreEmulatorPort || 8080);
      }
    });
  }

  /* Sin sesión no debe quedar nada en el dispositivo: se borra la copia local
     de Firestore (la de la última cuenta que usó este navegador). Solo se puede
     antes de empezar a usar Firestore, por eso se hace al arrancar sin sesión y
     no al cerrar sesión (que recarga la página). Si otra pestaña la tiene
     abierta, falla sin más y se borrará en la próxima carga. */
  function clearLocalCache(){
    clearing = firestore.clearPersistence().catch(() => {});
    return clearing;
  }

  /* Al entrar: caché local (carga instantánea y aguanta cortes de conexión). */
  function startSession(){
    return clearing.then(() => {
      firestore.enablePersistence({synchronizeTabs:true}).catch(() => {});
    });
  }

  /* Las cuentas de correo y contraseña tienen que verificar el correo antes
     de leer o guardar datos (lo exige firestore.rules). Google y GitHub no. */
  function needsVerification(user){
    const providers = (user.providerData || []).map((p) => p.providerId);
    return !user.emailVerified && providers.length > 0 && providers.every((id) => id === 'password');
  }

  function sendVerification(){
    return auth.currentUser ? auth.currentUser.sendEmailVerification() : Promise.resolve();
  }

  /* Tras pulsar el enlace del correo: recarga el usuario y renueva el token
     (el servidor solo ve email_verified en un token nuevo). */
  function refreshVerification(){
    const user = auth.currentUser;
    if(!user) return Promise.resolve(false);
    return user.reload().then(() => {
      if(!auth.currentUser.emailVerified) return false;
      return auth.currentUser.getIdToken(true).then(() => true);
    });
  }

  function onAuthChange(cb){
    return auth.onAuthStateChanged(cb);
  }

  /* Errores de la vuelta de un inicio de sesión por redirección (móvil). */
  function redirectResult(){
    return auth.getRedirectResult();
  }

  function providerFor(key){
    switch(key){
      case 'google': {
        const p = new fb.auth.GoogleAuthProvider();
        p.setCustomParameters({prompt:'select_account'});
        return p;
      }
      case 'github': return new fb.auth.GithubAuthProvider();
      case 'microsoft': {
        const p = new fb.auth.OAuthProvider('microsoft.com');
        p.setCustomParameters({prompt:'select_account'});
        return p;
      }
      case 'apple': {
        const p = new fb.auth.OAuthProvider('apple.com');
        p.addScope('email');
        p.addScope('name');
        return p;
      }
      default: throw new Error('proveedor desconocido: ' + key);
    }
  }

  /* Unir dos formas de entrar a la MISMA cuenta (mismo uid, mismos datos).
     Firebase solo permite una cuenta por correo: si entras con GitHub y ese
     correo ya tiene cuenta de Google, falla con account-exists-with-different-
     credential. En ese caso se guarda la credencial de GitHub (rememberPending)
     y, cuando la persona entre con su método original (y así demuestre que la
     cuenta es suya), se une a ella (finishLink). Después ya puede entrar con
     cualquiera de los dos. Solo se une si el correo coincide. */
  function rememberPending(err){
    if(err && err.code === 'auth/account-exists-with-different-credential' && err.credential && err.email){
      pendingLink = {credential:err.credential, email:String(err.email).toLowerCase()};
    }
  }

  /* Tras un inicio de sesión correcto: si había un acceso pendiente y es la
     cuenta de ese correo, se une. Devuelve el resultado con linked = proveedor unido. */
  function finishLink(res){
    const pending = pendingLink;
    const user = res && res.user;
    if(!pending || !user) return res;
    pendingLink = null;
    if(!user.email || user.email.toLowerCase() !== pending.email) return res;
    return user.linkWithCredential(pending.credential).then(
      () => Object.assign({}, res, {linked:pending.credential.providerId || 'unknown'}),
      () => res
    );
  }

  /* Ventana emergente; si el navegador la bloquea, redirección. */
  function signInWith(key){
    const provider = providerFor(key);
    return auth.signInWithPopup(provider).catch((err) => {
      if(err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')){
        return auth.signInWithRedirect(provider);
      }
      throw err;
    }).then(finishLink, (err) => {
      rememberPending(err);
      throw err;
    });
  }

  /* Token de GitHub para la integración con GitHub Projects, sin que el usuario
     tenga que crearlo ni pegarlo: se abre el inicio de sesión de GitHub pidiendo
     el permiso «project» y se recoge el token de acceso que devuelve.

     Se hace con una segunda instancia de Firebase (con su propia sesión), para no
     tocar la cuenta con la que se ha entrado: no cambia sus métodos de acceso ni
     choca si esa cuenta usa otro proveedor con el mismo correo. La sesión temporal
     se cierra al terminar (y si era una cuenta nueva, se borra). El token no lo
     guarda Firebase; lo guarda la app solo en este navegador. */
  function githubToken(){
    return init().then(() => {
      const c = config();
      const NAME = 'gh-oauth';
      let app2 = fb.apps.find((a) => a.name === NAME);
      if(!app2){
        app2 = fb.initializeApp({apiKey:c.apiKey, authDomain:resolveAuthDomain(c, location.host), projectId:c.projectId, appId:c.appId}, NAME);
        if(c.useEmulators && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
          app2.auth().useEmulator('http://127.0.0.1:' + (c.authEmulatorPort || 9099), {disableWarnings:true});
        }
      }
      const auth2 = app2.auth();
      auth2.languageCode = 'es';
      const provider = new fb.auth.GithubAuthProvider();
      provider.addScope('project');
      return auth2.setPersistence(fb.auth.Auth.Persistence.NONE).catch(() => {}).then(() => auth2.signInWithPopup(provider)).then((res) => {
        const token = res.credential && res.credential.accessToken;
        const isNew = res.additionalUserInfo && res.additionalUserInfo.isNewUser && res.user;
        return Promise.resolve(isNew ? res.user.delete() : auth2.signOut()).catch(() => {}).then(() => {
          if(!token) throw new Error('no-token');
          return token;
        });
      }, (err) => {
        /* El correo de GitHub ya tiene cuenta con otro método: aun así GitHub ha dado su token. */
        if(err && err.code === 'auth/account-exists-with-different-credential' && err.credential && err.credential.accessToken){
          return err.credential.accessToken;
        }
        throw err;
      });
    });
  }

  function signInWithEmail(email, password){
    return auth.signInWithEmailAndPassword(email, password).then(finishLink);
  }

  function signUpWithEmail(email, password, name){
    return auth.createUserWithEmailAndPassword(email, password).then((cred) => {
      const profile = name && cred.user ? cred.user.updateProfile({displayName:name}) : Promise.resolve();
      /* Si el correo de verificación falla (p. ej. demasiados envíos), se puede
         reenviar desde la pantalla de verificación. */
      return profile.then(() => sendVerification().catch(() => {})).then(() => cred);
    });
  }

  function resetPassword(email){
    return auth.sendPasswordResetEmail(email);
  }

  function signOut(){
    return auth.signOut();
  }

  /* ---------- Interfaz que usa la app (window.claude) ---------- */

  /* Base de datos acotada a un documento: db.collection('tasks'),
     db.doc('vault_meta/check'), etc. */
  function scopedDb(root){
    return {
      collection: (path) => {
        const parts = path.split('/').filter(Boolean);
        let ref = root.collection(parts[0]);
        for(let i = 1; i + 1 < parts.length; i += 2) ref = ref.doc(parts[i]).collection(parts[i + 1]);
        return ref;
      },
      doc: (path) => {
        const parts = path.split('/').filter(Boolean);
        let ref = root;
        for(let i = 0; i + 1 < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
        return ref;
      }
    };
  }

  /* Datos de la cuenta que ha entrado (para los miembros de un equipo). */
  function profileOf(user){
    const email = String(user.email || '').toLowerCase();
    const photo = Workhub.utils.urls.safeUrl(user.photoURL);
    return {
      uid: user.uid,
      email: email,
      name: String(user.displayName || (email ? email.split('@')[0] : 'Usuario')).slice(0, 80),
      photo: photo && photo.indexOf('https:') === 0 ? photo : ''
    };
  }

  /* Base de datos acotada a users/{uid}. Además da acceso a los proyectos de
     equipo (teams/{id}), que no cuelgan de ningún usuario: team(tid) es la base
     de datos de uno, y teams tiene sus consultas y las invitaciones. */
  function userDb(user){
    const uid = user.uid;
    const me = profileOf(user);
    const db = scopedDb(firestore.collection('users').doc(uid));
    db.me = me;
    db.team = (tid) => scopedDb(firestore.collection('teams').doc(tid));
    db.teams = {
      /* Equipos de los que soy miembro. */
      query: () => firestore.collection('teams').where('memberIds', 'array-contains', uid),
      doc: (tid) => firestore.collection('teams').doc(tid),
      newId: () => firestore.collection('teams').doc().id,
      /* Invitaciones que ha recibido mi correo. */
      invitesForMe: () => firestore.collection('invites').where('email', '==', me.email),
      /* Las que he enviado yo desde un equipo. */
      invitesFrom: (tid) => firestore.collection('invites').where('teamId', '==', tid).where('invitedByUid', '==', uid),
      invite: (id) => firestore.collection('invites').doc(id),
      FieldValue: fb.firestore.FieldValue,
      batch: () => firestore.batch()
    };
    return db;
  }

  function readAsDataUrl(blob){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  /* Reduce la imagen (lado máximo y calidad JPEG) hasta que quepa en un documento. */
  function compressImage(file){
    return readAsDataUrl(file).then((dataUrl) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let side = IMAGE_MAX_SIDE;
        let quality = 0.85;
        for(let attempt = 0; attempt < 8; attempt++){
          const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL('image/jpeg', quality);
          if(out.length * 0.75 <= IMAGE_MAX_BYTES) return resolve(out);
          if(quality > 0.6) quality -= 0.1;
          else side = Math.round(side * 0.75);
        }
        reject(new Error('image-too-large'));
      };
      img.onerror = () => reject(new Error('image-unreadable'));
      img.src = dataUrl;
    }));
  }

  /* Imágenes de las notas. En un proyecto de equipo (window.__teamId, que fija
     la app al abrirlo) van a teams/{id}/assets para que las vean todos los
     miembros; en el resto, a las del usuario. */
  function userAssets(uid){
    const own = firestore.collection('users').doc(uid).collection('assets');
    const shared = () => window.__teamId ? firestore.collection('teams').doc(window.__teamId).collection('assets') : null;
    const cache = {};
    const read = (col, id) => col.doc(id).get().then((snap) => {
      const data = snap.exists ? snap.data() : null;
      return data && data.data ? data.data : null;
    }).catch(() => null);
    window.__assetUrl = (id) => {
      if(cache[id]) return Promise.resolve(cache[id]);
      const team = shared();
      const first = team ? read(team, id) : Promise.resolve(null);
      return first.then((url) => url || read(own, id)).then((url) => {
        if(url) cache[id] = url;
        return url;
      });
    };
    return {
      upload: (file) => compressImage(file).then((dataUrl) => {
        return (shared() || own).add({data:dataUrl, contentType:'image/jpeg', createdAt:Date.now()}).then((ref) => {
          cache[ref.id] = dataUrl;
          return {id:ref.id, url:dataUrl, contentType:'image/jpeg'};
        });
      }),
      delete: (id) => (shared() || own).doc(id).delete().then(() => { delete cache[id]; return {deleted:true}; })
    };
  }

  const downloads = {
    save: (req) => new Promise((resolve) => {
      const blob = req.data instanceof Blob ? req.data : new Blob([req.data], {type:'text/plain'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = req.filename || 'archivo';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      resolve({status:'saved'});
    })
  };

  /* Sustituye el almacén local por el de este usuario. */
  function install(user){
    const db = userDb(user);
    const assets = userAssets(user.uid);
    window.__workhubBackend = 'firebase';
    window.__usingLocalStorageShim = false;
    window.claude = {
      use: (name) => {
        if(name === 'db') return Promise.resolve(db);
        if(name === 'assets') return Promise.resolve(assets);
        if(name === 'downloads') return Promise.resolve(downloads);
        return Promise.resolve(null);
      }
    };
  }

  Workhub.services.firebase = {
    isEnabled, init, githubToken, resolveAuthDomain, onAuthChange, redirectResult, signInWith, signInWithEmail, signUpWithEmail,
    resetPassword, signOut, install, clearLocalCache, startSession, needsVerification, sendVerification, refreshVerification,
    currentUser: () => auth.currentUser,
    providers: () => (config().providers || ['google']).slice(),
    /* false oculta "Crear una cuenta" (solo entran cuentas ya creadas). */
    allowSignup: () => config().allowSignup !== false
  };
})();
