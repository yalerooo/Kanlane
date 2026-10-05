/* Arranque: se decide ANTES de pintar nada (se carga en <head>, justo después
   de la configuración). Si Kanlane está publicado con Firebase, la app queda
   oculta desde el primer fotograma y solo se ve la pantalla de acceso/carga
   hasta que hay sesión (AuthController quita la clase). También se aplica ya
   el tema guardado, para no ver un parpadeo.
   Va en un archivo aparte, no en línea, para que la política de seguridad
   (CSP de scripts/build-public.js) pueda prohibir cualquier script en línea. */
(function(){
  var root = document.documentElement;
  var c = window.WORKHUB_FIREBASE || {};
  /* SDK de Firebase: la lista que usa src/services/firebase-backend.js, aquí para poder
     adelantar su descarga. */
  var SDK = window.WORKHUB_SDK = {
    base: 'https://www.gstatic.com/firebasejs/10.14.1/',
    files: ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'],
    appCheck: 'firebase-app-check-compat.js'
  };
  if(c.apiKey && c.projectId && /^https?:$/.test(location.protocol)){
    root.classList.add('auth-gate');
    /* ¿Ya entró antes en este navegador? Se sabe al instante (Firebase tarda en responder):
       si sí, desde el primer fotograma se ve el esqueleto de la página principal; si no,
       negro hasta que aparezca el acceso. La marca la pone AuthController al entrar. */
    var session = false, guest = false;
    try{
      session = localStorage.getItem('workhub_session') === '1';
      guest = !!String((JSON.parse(localStorage.getItem('workhub_guest') || 'null') || {}).name || '').trim();
    }catch(e){}
    if(session) root.classList.add('boot-session');
    /* Ni sesión ni invitado: casi seguro hay que iniciar sesión. El formulario ya viene escrito
       en la página, así que se enseña en el primer fotograma, sin esperar al resto de scripts ni
       a Firebase (lo hace src/views/auth-early.js, que va justo detrás del formulario). Dentro
       de claude.ai (window.claude) no hay acceso. */
    else if(!guest && !window.claude) window.__authFirst = true;
    /* El SDK de Firebase se empieza a bajar ya, a la vez que los scripts de la app, en lugar de
       después de todos ellos. Un invitado no contacta con nada. */
    if(!guest && !window.claude){
      var hint = function(rel, href){
        var l = document.createElement('link');
        l.rel = rel; l.href = href;
        if(rel === 'preload') l.as = 'script';
        document.head.appendChild(l);
      };
      hint('preconnect', 'https://www.gstatic.com');
      SDK.files.concat(c.appCheckSiteKey && !c.useEmulators ? [SDK.appCheck] : []).forEach(function(f){ hint('preload', SDK.base + f); });
    }
    /* Por si la carga se atasca, el esqueleto no se queda para siempre. */
    setTimeout(function(){ window.__hideBootSkeleton(); }, 15000);
  }
  window.__hideBootSkeleton = function(){ root.classList.remove('boot-session', 'skel-on'); };
  /* Idioma distinto del español: la página se oculta hasta que se traduce
     (src/i18n/i18n.js), para no ver los textos en español un instante. */
  try{
    var lang = localStorage.getItem('workhub_lang');
    if(lang !== 'es' && lang !== 'en') lang = /^es\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || 'es') ? 'es' : 'en';
    if(lang !== 'es'){
      root.classList.add('i18n-pending');
      /* Su diccionario solo se baja en ese caso (lo pide i18n.js); aquí se adelanta la descarga. */
      var dict = document.createElement('link');
      dict.rel = 'preload'; dict.as = 'script'; dict.href = '../src/i18n/' + lang + '.js';
      document.head.appendChild(dict);
    }
  }catch(e){}
  try{
    var theme = localStorage.getItem('workhub_theme');
    if(theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    /* Navegación arriba (Ajustes → Apariencia): también antes de pintar. */
    if(localStorage.getItem('workhub_nav') === 'top') root.setAttribute('data-nav', 'top');
  }catch(e){}
})();
