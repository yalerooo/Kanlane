/* Portada pública: se ejecuta en <head>, antes de pintar nada.
   - Aplica el tema elegido en la aplicación (si lo hay) para que no haya parpadeo.
   - Si esta persona ya usa Kanlane en este navegador (sesión, invitado o aplicación
     instalada), la lleva directa a la aplicación. Quien llega por primera vez, y los
     buscadores, ven la portada. Con «?portada» se puede ver aunque se tenga sesión. */
(function(){
  var root = document.documentElement;
  var theme = null, inApp = false, guest = false;
  try{ theme = localStorage.getItem('workhub_theme'); }catch(e){}
  if(theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  /* Movimiento al bajar (assets/css/landing.css): solo si el navegador puede y la persona no ha
     pedido menos movimiento. Se decide aquí, antes de pintar, para que nada aparezca y se esconda. */
  try{
    if('IntersectionObserver' in window && window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('js-motion');
  }catch(e){}
  try{ inApp = localStorage.getItem('workhub_session') === '1'; }catch(e){}
  try{ guest = !!localStorage.getItem('workhub_guest'); }catch(e){}
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var forced = /[?&]portada(=|&|$)/.test(location.search);
  if((inApp || guest || standalone) && !forced && /^https?:$/.test(location.protocol)){
    /* La aplicación está junto a src/, no junto a la página: así también funciona desde /en/. */
    var self = document.currentScript && document.currentScript.src;
    location.replace(self ? new URL('../../app/', self).href : 'app/');
  }
})();
