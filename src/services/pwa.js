/* Aplicación instalable (PWA): registra el service worker (sw.js), avisa cuando
   hay una versión nueva o se pierde la conexión, y gestiona el botón
   «Instalar Kanlane» de Ajustes (Chrome/Edge/Android usan el aviso del
   navegador; en iPhone/iPad solo se puede añadir a la pantalla de inicio
   desde Compartir). El service worker solo se registra en https: en local
   (http://localhost) no, para no guardar copias mientras se desarrolla. */
(function(){
  const t = (text) => Workhub.t(text);
  const toast = () => Workhub.views.toast;
  let deferred = null;

  const standalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* Botón y ayuda de Ajustes. */
  function renderInstall(){
    const row = document.getElementById('installRow');
    if(!row) return;
    const btn = document.getElementById('btnInstallApp');
    const hint = document.getElementById('installHint');
    const canPrompt = !!deferred;
    const ios = isIos() && !standalone();
    row.hidden = standalone() || !(canPrompt || ios);
    btn.hidden = !canPrompt;
    hint.hidden = canPrompt || !ios;
  }

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferred = ev;
    renderInstall();
  });
  window.addEventListener('appinstalled', () => { deferred = null; renderInstall(); });

  function install(){
    if(!deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(() => { deferred = null; renderInstall(); });
  }

  /* Conexión: un aviso al perderla y otro al recuperarla (no al arrancar con conexión). */
  function watchConnection(){
    let wasOffline = !navigator.onLine;
    if(wasOffline) setTimeout(() => toast().error(t('Sin conexión: verás los últimos datos guardados.')), 2500);
    window.addEventListener('offline', () => {
      wasOffline = true;
      toast().error(t('Sin conexión: verás los últimos datos guardados y los cambios se enviarán al volver.'), {duration: 6000});
    });
    window.addEventListener('online', () => {
      if(wasOffline) toast().success(t('De nuevo en línea'), {important:true});
      wasOffline = false;
    });
  }

  function register(){
    if(!('serviceWorker' in navigator)) return;
    /* Solo en https (o en local con ?sw=1, para probarlo con dist/). */
    if(location.protocol !== 'https:' && location.search.indexOf('sw=1') === -1) return;
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    /* Una versión nueva toma el control sola; se ofrece recargar para verla. */
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(!hadController || reloading) return;
      toast().success(t('Hay una versión nueva de Kanlane'), {duration: 15000, action: {label: t('Recargar'), run: () => { reloading = true; location.reload(); }}});
    });
    navigator.serviceWorker.register(Workhub.utils.urls.rootUrl('sw.js')).then((reg) => {
      /* Comprueba si hay versión nueva al volver a la pestaña. */
      document.addEventListener('visibilitychange', () => { if(!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  /* La barra de estado del móvil / de la ventana instalada toma el color de fondo de la app
     (claro u oscuro, según el tema elegido), no el azul de acento. */
  function syncThemeColor(){
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if(!bg) return;
    let meta = document.querySelector('meta[name="theme-color"][data-live]');
    if(!meta){
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.setAttribute('data-live', '1');
      document.head.appendChild(meta);
    }
    meta.content = bg;
  }

  function watchThemeColor(){
    syncThemeColor();
    new MutationObserver(syncThemeColor).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    if(window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
  }

  function start(){
    watchThemeColor();
    const btn = document.getElementById('btnInstallApp');
    if(btn) btn.addEventListener('click', install);
    renderInstall();
    watchConnection();
    register();
  }

  Workhub.pwa = {install, canInstall: () => !!deferred, isStandalone: standalone};
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
