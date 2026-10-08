/* Service worker de Kanlane: hace que la web abra sin conexión con los últimos
   datos y que se pueda instalar como aplicación.

   - Los archivos de la app (la lista FILES) se guardan todos juntos al instalar
     una versión (scripts/build-public.js rellena BUILD y FILES al publicar).
     Así cada versión es coherente: nunca se mezclan scripts nuevos con viejos.
   - Se registra con alcance /app/, el mismo del manifiesto (src/services/pwa.js):
     solo controla la aplicación; la portada y el resto de páginas van sin él.
   - La página (navegación) se pide primero a la red y, si no hay conexión, se
     usa la guardada. Por eso una versión nueva llega en la siguiente visita.
   - Fuentes y el SDK de Firebase se guardan la primera vez que se usan.
   - Nunca se toca lo que no es de la app: el inicio de sesión (/__/), Firestore,
     la API de GitHub, etc. van siempre directos a la red. Los datos de
     Firestore los guarda Firebase en este navegador (enablePersistence). */
'use strict';

const BUILD = 'dev';
const FILES = [];

const SHELL = 'workhub-shell-' + BUILD;
const RUNTIME = 'workhub-runtime';
const RUNTIME_HOSTS = ['www.gstatic.com'];
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => Promise.all(FILES.map((f) => cache.add(new Request(f, {cache: 'reload'})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('workhub-shell-') === 0 && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Red primero (con un tiempo máximo) y, si falla, lo guardado. */
function networkFirst(request, fallbackKey){
  return new Promise((resolve) => {
    let done = false;
    const fromCache = () => caches.open(SHELL).then((c) => c.match(fallbackKey)).then((r) => r || Response.error());
    const timer = setTimeout(() => { if(!done){ done = true; fromCache().then(resolve); } }, NETWORK_WAIT_MS);
    fetch(request).then((res) => {
      clearTimeout(timer);
      if(done) return;
      done = true;
      if(res.ok){
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(fallbackKey, copy)).catch(() => {});
      }
      resolve(res);
    }).catch(() => {
      clearTimeout(timer);
      if(!done){ done = true; fromCache().then(resolve); }
    });
  });
}

/* Lo guardado al momento y, por detrás, se actualiza. */
function staleWhileRevalidate(request){
  return caches.open(RUNTIME).then((cache) => cache.match(request).then((hit) => {
    const fresh = fetch(request).then((res) => {
      if(res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
      return res;
    }).catch(() => hit || Response.error());
    return hit || fresh;
  }));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);

  if(url.origin === self.location.origin){
    if(url.pathname.indexOf('/__/') === 0) return;   /* inicio de sesión de Firebase */
    if(request.mode === 'navigate'){
      /* Cada página se guarda con su propia clave. Antes todas se guardaban como
         /index.html y abrir otra (la política de privacidad, por ejemplo) pisaba la
         copia de la app que se usa sin conexión. */
      const isHome = url.pathname === '/' || url.pathname === '/index.html';
      const key = isHome ? '/index.html' : (url.pathname.slice(-1) === '/' ? url.pathname + 'index.html' : url.pathname);
      event.respondWith(networkFirst(request, key));
      return;
    }
    event.respondWith(
      caches.open(SHELL).then((c) => c.match(request, {ignoreSearch: true})).then((hit) => hit || fetch(request))
    );
    return;
  }

  const isSdk = url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0;
  if(isSdk) event.respondWith(staleWhileRevalidate(request));
});

/* Avisos con Kanlane cerrado (worker/notify.mjs): el servidor manda {title, body, tag, project,
   task} y aquí solo se enseña. Al pulsar la notificación se abre esa tarea: en la pestaña de
   Kanlane que ya haya, o en una nueva. */
const LINK_PROJECT = /^t:[A-Za-z0-9_-]{1,128}$/;
const LINK_TASK = /^[A-Za-z0-9_-]{1,128}$/;

self.addEventListener('push', (event) => {
  let data = {};
  try{ data = (event.data && event.data.json()) || {}; }catch(e){ data = {}; }
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const link = LINK_PROJECT.test(data.project) && LINK_TASK.test(data.task) ? {project: data.project, task: data.task} : null;
  event.waitUntil(self.registration.showNotification(str(data.title, 120) || 'Kanlane', {
    body: str(data.body, 300),
    tag: str(data.tag, 140) || undefined,
    icon: '/assets/img/icon-192.png',
    badge: '/assets/img/favicon-32.png',
    data: link
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data;
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.indexOf('/app/') === 0);
    if(open){
      if(link) open.postMessage({type: 'kanlane-open-task', project: link.project, task: link.task});
      return open.focus();
    }
    return self.clients.openWindow('/app/' + (link ? '#tarea=' + encodeURIComponent(link.project + '/' + link.task) : ''));
  }));
});
