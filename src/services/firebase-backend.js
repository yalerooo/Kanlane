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
     Netlify, que reenvía /__/auth/* a Firebase según netlify.toml), el acceso
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
        auth.useEmulator('http://127.0.0.1:9099', {disableWarnings:true});
        firestore.useEmulator('127.0.0.1', 8080);
      } else {
        /* Caché local: carga instantánea y funciona sin conexión un rato. */
        firestore.enablePersistence({synchronizeTabs:true}).catch(() => {});
      }
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

  /* Ventana emergente; si el navegador la bloquea, redirección. */
  function signInWith(key){
    const provider = providerFor(key);
    return auth.signInWithPopup(provider).catch((err) => {
      if(err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')){
        return auth.signInWithRedirect(provider);
      }
      throw err;
    });
  }

  function signInWithEmail(email, password){
    return auth.signInWithEmailAndPassword(email, password);
  }

  function signUpWithEmail(email, password, name){
    return auth.createUserWithEmailAndPassword(email, password).then((cred) => {
      if(name && cred.user) return cred.user.updateProfile({displayName:name}).then(() => cred);
      return cred;
    });
  }

  function resetPassword(email){
    return auth.sendPasswordResetEmail(email);
  }

  function signOut(){
    return auth.signOut();
  }

  /* ---------- Interfaz que usa la app (window.claude) ---------- */

  /* Base de datos acotada a users/{uid}: db.collection('tasks'),
     db.doc('vault_meta/check'), etc. */
  function userDb(uid){
    const root = firestore.collection('users').doc(uid);
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

  function userAssets(uid){
    const col = firestore.collection('users').doc(uid).collection('assets');
    const cache = {};
    window.__assetUrl = (id) => {
      if(cache[id]) return Promise.resolve(cache[id]);
      return col.doc(id).get().then((snap) => {
        const data = snap.exists ? snap.data() : null;
        if(data && data.data) cache[id] = data.data;
        return cache[id] || null;
      });
    };
    return {
      upload: (file) => compressImage(file).then((dataUrl) => {
        return col.add({data:dataUrl, contentType:'image/jpeg', createdAt:Date.now()}).then((ref) => {
          cache[ref.id] = dataUrl;
          return {id:ref.id, url:dataUrl, contentType:'image/jpeg'};
        });
      }),
      delete: (id) => col.doc(id).delete().then(() => { delete cache[id]; return {deleted:true}; })
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
    const db = userDb(user.uid);
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
    isEnabled, init, resolveAuthDomain, onAuthChange, redirectResult, signInWith, signInWithEmail, signUpWithEmail,
    resetPassword, signOut, install,
    providers: () => (config().providers || ['google']).slice()
  };
})();
