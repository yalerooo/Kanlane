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

  /* ---------- El fondo de la pantalla de acceso, antes que nada ----------
     Detrás del acceso va una escena en 3D (src/views/auth-scene.js) que tarda unos segundos en
     estar lista; mientras, se enseña una imagen suya hecha de antemano (assets/img/acceso-*.webp),
     colocada para que el ordenador caiga en el centro del panel de cristal de la tarjeta. Esa
     imagen y esa colocación viven aquí, y no en auth-scene.js, para poder ponerla desde el
     primer fotograma, sin esperar a que carguen los demás scripts ni a que Firebase diga si
     hay sesión: si no, la pantalla se quedaba en negro alrededor de un segundo.
     Medidas de la imagen, en píxeles; fx, fy: dónde cae el ordenador (fy, desde abajo); una
     altura de pantalla son h píxeles; tree: dónde va el tronco del cerezo respecto al
     ordenador, en alturas. Las usa también auth-scene.js (POSTER) y hay que cambiarlas si se
     regeneran las imágenes con otro encuadre. */
  var poster = window.__authPoster = {
    w:1952, h:640, fx:1088, fy:301, tree:-1.12,
    night:'../assets/img/acceso-noche.webp', dusk:'../assets/img/acceso-tarde.webp',
    /* El color del cielo en el borde de arriba de cada imagen: en ventanas donde la imagen no
       llega hasta arriba, la franja que falta se rellena con él. */
    nightTop:'#181b43', duskTop:'#b35762',
    dark:function(){
      var set = root.getAttribute('data-theme');
      return set ? set === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    },
    /* Dónde va el ordenador en pantalla (fx, fy: el centro del panel de cristal, algo a la
       derecha, porque el frontal del ordenador queda a la izquierda de su fondo) y dónde
       empieza la tarjeta (left). Con offsetLeft/offsetTop y no getBoundingClientRect, que
       incluye la animación de entrada de la tarjeta. */
    focus:function(screen, el, w, h){
      var off = function(n){ var x = 0, y = 0; for(; n && n !== screen; n = n.offsetParent){ x += n.offsetLeft; y += n.offsetTop; } return {x:x, y:y}; };
      var fx = w / 2, fy = h * 0.6, left = w * 0.2;
      if(el && el.offsetParent){ var o = off(el); fx = o.x + el.offsetWidth * 0.575; fy = o.y + el.offsetHeight * 0.585; }
      var card = el && el.parentElement;
      if(card && card.offsetParent) left = Math.max(off(card).x, 0);
      return {fx:fx, fy:fy, left:left};
    },
    /* Pone (o recoloca) la imagen como fondo de .auth-scene. Devuelve false si la pantalla de
       acceso aún no está en la página o no se ve. */
    done:'',
    paint:function(){
      var screen = document.getElementById('authScreen'), canvas = document.getElementById('authCanvas');
      if(!screen || !canvas || (screen.hidden && !root.classList.contains('auth-early'))) return false;
      var el = canvas.parentElement;
      var w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
      var at = poster.focus(screen, document.getElementById('authWindow'), w, h), k = h / poster.h;
      var now = [poster.dark() ? poster.night : poster.dusk, Math.round(poster.w * k), Math.round(poster.h * k), Math.round(at.fx - poster.fx * k), Math.round(at.fy - (poster.h - poster.fy) * k)].join();
      if(now === poster.done) return true;
      poster.done = now;
      now = now.split(',');
      el.style.backgroundImage = 'url("' + now[0] + '")';
      el.style.backgroundColor = poster.dark() ? poster.nightTop : poster.duskTop;
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundSize = now[1] + 'px ' + now[2] + 'px';
      el.style.backgroundPosition = now[3] + 'px ' + now[4] + 'px';
      return true;
    }
  };
  /* Si todo apunta a que va a salir la pantalla de acceso (hay Firebase, no consta sesión y no
     se entró como invitado), se enseña ya su fondo: la clase auth-early deja ver la pantalla
     de acceso sin su tarjeta (auth.css), se pide la imagen y se coloca en cuanto la página
     tiene dónde. AuthView quita la clase cuando se sabe qué hay que enseñar. */
  try{
    if(root.classList.contains('auth-gate') && !root.classList.contains('boot-session') && !localStorage.getItem('workhub_guest')){
      root.classList.add('auth-early');
      var img = new Image();
      img.decoding = 'async';
      img.src = poster.dark() ? poster.night : poster.dusk;
      /* Se guarda para que el navegador no la suelte antes de usarla. */
      poster.img = img;
      var tries = 0;
      (function wait(){
        if(!root.classList.contains('auth-early') || poster.paint() || ++tries > 600) return;
        (window.requestAnimationFrame || setTimeout)(wait, 16);
      })();
    }
  }catch(e){}
})();
