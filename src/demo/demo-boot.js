/* Demo del tablero (/demo/), se carga en <head> antes de pintar nada.
   - La demo va siempre en español, como la portada que la enseña.
   - Aplica el tema guardado en la aplicación (si lo hay), igual que la portada. */
(function(){
  var root = document.documentElement;
  var theme = null;
  try{ theme = localStorage.getItem('workhub_theme'); }catch(e){}
  if(theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  /* La demo se enseña dentro de un marco más estrecho que una pantalla: la barra lateral va
     siempre desplegada (como se ve la aplicación en un escritorio), no en modo de iconos. */
  root.setAttribute('data-sidebar', 'full');
  try{
    Object.defineProperty(navigator, 'languages', {configurable: true, get: function(){ return ['es-ES']; }});
    Object.defineProperty(navigator, 'language', {configurable: true, get: function(){ return 'es-ES'; }});
  }catch(e){}
  /* i18n.js lee el idioma guardado de la aplicación: en la demo no cuenta. */
  /* Las vistas del tablero avisan al arranque de la aplicación; aquí no hay arranque. */
  window.__hideBootSkeleton = function(){};
  var read = Storage.prototype.getItem;
  Storage.prototype.getItem = function(key){ return key === 'workhub_lang' ? 'es' : read.call(this, key); };
})();
