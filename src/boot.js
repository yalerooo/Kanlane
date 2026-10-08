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
  /* Estación del año, para el paisaje de la pantalla de acceso (auth-scene.js): cerezo en flor
     en primavera, árbol verde en verano, hojas rojas en otoño y nieve en invierno. Sale de la
     fecha del equipo (estaciones por meses completos: marzo-mayo, junio-agosto…) y del
     hemisferio, que el navegador no dice: se deduce de la zona horaria. Para probar otra:
     /app/?estacion=invierno (primavera, verano, otono, invierno). */
  try{
    var SEASONS = ['spring', 'summer', 'autumn', 'winter'];
    var asked = (location.search.match(/[?&]estacion=([a-z]+)/) || [])[1];
    var season = {primavera:0, verano:1, otono:2, invierno:3}[asked];
    if(season === undefined){
      season = Math.floor((new Date().getMonth() + 10) % 12 / 3);
      var zone = '';
      try{ zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){}
      /* Zonas horarias al sur del ecuador: allí las estaciones van al revés. */
      var south = /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea|Port_Moresby|Tahiti|Easter|Rarotonga|Efate|Guadalcanal|Norfolk|Pago_Pago|Niue|Fakaofo|Wallis|Funafuti|Gambier|Marquesas|Pitcairn|Galapagos)$|^America\/(Argentina\/.+|Buenos_Aires|Cordoba|Mendoza|Catamarca|Jujuy|Rosario|Sao_Paulo|Bahia|Fortaleza|Recife|Maceio|Araguaina|Belem|Manaus|Cuiaba|Campo_Grande|Porto_Velho|Rio_Branco|Santarem|Noronha|Santiago|Punta_Arenas|Coyhaique|Montevideo|Asuncion|La_Paz|Lima)$|^Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Blantyre|Luanda|Dar_es_Salaam|Lubumbashi)$|^Indian\/(Antananarivo|Mauritius|Reunion|Mayotte|Comoro)$|^Atlantic\/(Stanley|St_Helena|South_Georgia)$/.test(zone);
      if(south) season = (season + 2) % 4;
    }
    root.setAttribute('data-season', SEASONS[season]);
    /* El acceso sale sin paisaje (html.scene-off: el agua con Sumi, auth.css) salvo que se haya
       pedido el paisaje con el botón de la pantalla de acceso (WORKHUB_AUTH.setScene, en
       auth-early.js), que lo apunta aquí como 'on'. Al principio era al revés: el paisaje salía
       siempre y se podía quitar; el dueño lo cambió, y quien lo tenía quitado ('off') sigue igual. */
    var sceneOff = true;
    try{ sceneOff = localStorage.getItem('workhub_scene') !== 'on'; }catch(e){}
    if(sceneOff) root.classList.add('scene-off');
    /* Las fotos de espera del paisaje de esa estación (assets/css/seasons/, las genera
       scripts/make-auth-posters.js). Solo donde puede salir el acceso con paisaje: no en modo
       local, ni en móviles y tabletas (la misma condición que auth.css y auth-early.js), ni con
       el paisaje quitado (si se vuelve a poner, las pide auth-early.js con esta función). */
    var photos = null;
    window.__scenePhotos = function(){
      if(photos || !root.classList.contains('auth-gate') || window.matchMedia('(max-width: 860px), (hover: none) and (pointer: coarse)').matches) return;
      photos = document.createElement('link');
      photos.rel = 'stylesheet'; photos.href = '../assets/css/seasons/' + SEASONS[season] + '.css';
      document.head.appendChild(photos);
      /* Y, si lo que se va a ver es el acceso (sin sesión ni invitado), la escena se empieza a
         bajar ya: quien la pide es auth-early.js (loadScene) al enseñar el formulario, bastante
         más tarde, y en la primera visita esa espera se sumaba a la de compilarla. Misma
         dirección que allí, para que sea la misma descarga. */
      if(window.__authFirst){
        var scene = document.createElement('link');
        scene.rel = 'preload'; scene.as = 'script'; scene.href = '../src/views/auth-scene.js';
        document.head.appendChild(scene);
      }
    };
    if(!sceneOff) window.__scenePhotos();
  }catch(e){}
  try{
    var theme = localStorage.getItem('workhub_theme');
    if(theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    /* Navegación arriba (Ajustes → Apariencia): también antes de pintar. */
    if(localStorage.getItem('workhub_nav') === 'top') root.setAttribute('data-nav', 'top');
  }catch(e){}
})();
