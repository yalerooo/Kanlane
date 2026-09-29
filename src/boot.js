/* Arranque: se decide ANTES de pintar nada (se carga en <head>, justo después
   de la configuración). Si Workhub está publicado con Firebase, la app queda
   oculta desde el primer fotograma y solo se ve la pantalla de acceso/carga
   hasta que hay sesión (AuthController quita la clase). También se aplica ya
   el tema guardado, para no ver un parpadeo.
   Va en un archivo aparte, no en línea, para que la política de seguridad
   (CSP de netlify.toml) pueda prohibir cualquier script en línea. */
(function(){
  var root = document.documentElement;
  var c = window.WORKHUB_FIREBASE || {};
  if(c.apiKey && c.projectId && /^https?:$/.test(location.protocol)) root.classList.add('auth-gate');
  try{
    var theme = localStorage.getItem('workhub_theme');
    if(theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  }catch(e){}
})();
