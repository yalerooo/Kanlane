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
  if(c.apiKey && c.projectId && /^https?:$/.test(location.protocol)){
    root.classList.add('auth-gate');
    /* ¿Ya entró antes en este navegador? Se sabe al instante (Firebase tarda en responder):
       si sí, desde el primer fotograma se ve el esqueleto de la página principal; si no,
       negro hasta que aparezca el acceso. La marca la pone AuthController al entrar. */
    try{ if(localStorage.getItem('workhub_session') === '1') root.classList.add('boot-session'); }catch(e){}
    /* Por si la carga se atasca, el esqueleto no se queda para siempre. */
    setTimeout(function(){ window.__hideBootSkeleton(); }, 15000);
  }
  window.__hideBootSkeleton = function(){ root.classList.remove('boot-session', 'skel-on'); };
  /* Idioma distinto del español: la página se oculta hasta que se traduce
     (src/i18n/i18n.js), para no ver los textos en español un instante. */
  try{
    var lang = localStorage.getItem('workhub_lang');
    if(!lang) lang = /^es\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || 'es') ? 'es' : 'en';
    if(lang !== 'es') root.classList.add('i18n-pending');
  }catch(e){}
  try{
    var theme = localStorage.getItem('workhub_theme');
    if(theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    /* Navegación arriba (Ajustes → Apariencia): también antes de pintar. */
    if(localStorage.getItem('workhub_nav') === 'top') root.setAttribute('data-nav', 'top');
  }catch(e){}
})();
