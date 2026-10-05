/* El acceso, desde el primer fotograma. Este script va en la página justo detrás del
   formulario de acceso y antes que todos los demás: si boot.js ha visto que en este navegador
   no hay sesión ni invitado (window.__authFirst), enseña ya el formulario, que viene escrito en
   la página, sin esperar a los scripts de la app ni a Firebase.

   Hasta que la app está lista (AuthView.showSignIn) el formulario se puede rellenar con
   normalidad; lo que se pulse se apunta y se repite en cuanto hay quien lo atienda.

   También guarda lo que comparten este script y AuthView: los botones de los proveedores y los
   textos de cada modo. No depende de nada (ni de Workhub, que aún no existe). */
(function(){
  var $ = function(id){ return document.getElementById(id); };

  var PROVIDERS = {
    google: {label:'Continuar con Google', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6H1.4a12 12 0 0 0 0 10.9l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>'},
    github: {label:'Continuar con GitHub', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"/></svg>'},
    microsoft: {label:'Continuar con Microsoft', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M1 1h10.5v10.5H1z"/><path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z"/><path fill="#00A4EF" d="M1 12.5h10.5V23H1z"/><path fill="#FFB900" d="M12.5 12.5H23V23H12.5z"/></svg>'},
    apple: {label:'Continuar con Apple', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.5a10 10 0 0 0 1.4-2.8 4.4 4.4 0 0 1-2.1-4.1zM13.9 5.1a4.4 4.4 0 0 0 1-3.2 4.5 4.5 0 0 0-2.9 1.5 4.2 4.2 0 0 0-1.1 3.1c1.1.1 2.2-.5 3-1.4z"/></svg>'}
  };

  var TEXT = {
    signin: {title:'Inicia sesión', sub:'Accede a tu espacio de trabajo.', submit:'Iniciar sesión', switchText:'¿No tienes cuenta?', switchLink:'Crear una'},
    signup: {title:'Crea tu cuenta', sub:'Empieza a organizar el trabajo de tus clientes.', submit:'Crear cuenta', switchText:'¿Ya tienes cuenta?', switchLink:'Iniciar sesión'},
    reset: {title:'Recupera tu contraseña', sub:'Te enviaremos un enlace para crear una nueva.', submit:'Enviar enlace', switchText:'¿La recuerdas?', switchLink:'Volver a iniciar sesión'}
  };

  var SPIN = '<span class="auth-spin" aria-hidden="true"></span>';

  /* Los botones de los proveedores. t: traductor (los textos de ayuda); sin él, en español. */
  function providersHtml(list, t){
    return list.map(function(p){
      var full = (t ? t(PROVIDERS[p].label) : PROVIDERS[p].label).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return '<button type="button" class="auth-provider" data-provider="' + p + '" title="' + full + '" aria-label="' + full + '">' +
        PROVIDERS[p].icon + SPIN + '<span translate="no">' + PROVIDERS[p].label.replace('Continuar con ', '') + '</span></button>';
    }).join('');
  }

  var api = window.WORKHUB_AUTH = {
    PROVIDERS: PROVIDERS, TEXT: TEXT, SPIN: SPIN, providersHtml: providersHtml,
    /* Lo que se ha pintado aquí, para que AuthView no lo repita: null o {providers, mode}. */
    shown: null,
    /* La app ya atiende el formulario: se repite lo pulsado mientras tanto. */
    take: function(){}
  };

  var screen = $('authScreen'), panel = $('authPanel');
  if(!screen || !panel) return;

  if(!window.__authFirst) return;

  var c = window.WORKHUB_FIREBASE || {};
  var list = (c.providers || ['google']).slice();
  var social = list.filter(function(p){ return PROVIDERS[p]; });
  var hasPassword = list.indexOf('password') !== -1;
  var allowSignup = c.allowSignup !== false;
  /* La portada enlaza a /app/?registro para abrir directamente «Crear cuenta». */
  var mode = /[?&]registro(=|&|$)/.test(location.search) && hasPassword && allowSignup ? 'signup' : 'signin';

  /* Lo mismo que dejan AuthView.showSignIn y setMode, en lo que se ve. */
  $('authProviders').innerHTML = providersHtml(social);
  $('authProviders').hidden = !social.length;
  $('authDivider').hidden = !social.length || !hasPassword;
  $('authEmailForm').hidden = !hasPassword;
  $('authSwitch').hidden = !hasPassword || !allowSignup;
  if(mode === 'signup'){
    var t = TEXT.signup;
    $('authTitle').textContent = t.title;
    $('authSub').textContent = t.sub;
    $('authSubmitLabel').textContent = t.submit;
    $('authSwitchText').textContent = t.switchText;
    $('authSwitchLink').textContent = t.switchLink;
    $('authNameField').hidden = false;
    $('authForgot').hidden = true;
    $('authEmail').autocomplete = 'email';
    $('authPass').autocomplete = 'new-password';
  }

  /* Lo pulsado antes de que la app esté lista, en orden. */
  var queue = [];
  function onSubmit(ev){
    ev.preventDefault();
    if(ev.target.id === 'authEmailForm') $('authSubmit').classList.add('is-busy');
    queue.push({form:ev.target});
  }
  function onClick(ev){
    var el = ev.target.closest && ev.target.closest('button, a[href="#"]');
    /* El botón de enviar sigue su curso: llega como «submit». */
    if(!el || el.type === 'submit') return;
    ev.preventDefault();
    if(el.hasAttribute('data-provider')) el.classList.add('is-busy');
    queue.push({el:el});
  }
  screen.addEventListener('submit', onSubmit, true);
  screen.addEventListener('click', onClick, true);

  api.shown = {providers: social.join(','), mode: mode};
  api.take = function(replay){
    api.take = function(){};
    api.shown = null;
    screen.removeEventListener('submit', onSubmit, true);
    screen.removeEventListener('click', onClick, true);
    screen.querySelectorAll('.is-busy').forEach(function(el){ el.classList.remove('is-busy'); });
    var todo = queue.splice(0).slice(-8);
    if(!replay || !todo.length) return;
    /* Cambiar de modo vacía la contraseña; si se escribió después de pulsar, se conserva. */
    var pass = $('authPass'), typed = pass.value;
    todo.forEach(function(q){
      if(q.el){ if(q.el.isConnected) q.el.click(); if(typed && !pass.value) pass.value = typed; }
      else if(!q.form.hidden && q.form.requestSubmit) q.form.requestSubmit();
    });
  };

  function show(){
    if(!api.shown) return;
    screen.hidden = false;
    panel.hidden = false;
    document.body.classList.add('is-authing');
    /* El cursor, en el primer campo (no en pantallas táctiles: abriría el teclado). */
    if(hasPassword && window.matchMedia('(hover: hover) and (pointer: fine)').matches){
      try{ $(mode === 'signup' ? 'authName' : 'authEmail').focus({preventScroll:true}); }catch(e){}
    }
  }

  /* En otro idioma, la página está oculta hasta que se traduce (html.i18n-pending): el acceso
     se enseña en cuanto ha cargado el diccionario, que va entre los primeros scripts. */
  if(!document.documentElement.classList.contains('i18n-pending')){ show(); return; }
  document.addEventListener('load', function translated(ev){
    var i18n = window.Workhub && window.Workhub.i18n;
    if(!api.shown){ document.removeEventListener('load', translated, true); return; }
    if(!i18n || !ev.target || ev.target.tagName !== 'SCRIPT' || i18n.t('Inicia sesión') === 'Inicia sesión') return;
    document.removeEventListener('load', translated, true);
    i18n.translateTree(screen);
    show();
    document.documentElement.classList.add('auth-early');
  }, true);
})();
