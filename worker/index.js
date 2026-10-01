/* Cloudflare Worker de Kanlane (Workers con recursos estáticos).

   La web (dist/) se sirve como recursos estáticos, sin pasar por este código.
   Este Worker solo atiende lo que NO es un fichero de la web, y en concreto
   reenvía /__/auth/* y /__/firebase/* a Firebase.

   Firebase completa el inicio de sesión (Google, GitHub…) en unas páginas
   suyas: https://<proyecto>.firebaseapp.com/__/auth/… Si la web está en otro
   dominio, Safari, Firefox y Chrome bloquean cada vez más el almacenamiento
   entre sitios y el acceso falla. Aquí se reenvían esas rutas SIN cambiar la
   dirección, y la app usa su propio dominio como authDomain (hostingDomains
   en src/config/firebase-config.js). Es lo que antes hacía netlify.toml.

   Solo se reenvían las rutas de Firebase indicadas; no es un proxy abierto. */

const FIREBASE_HOST = 'workhub-26f50.firebaseapp.com';
const ALLOWED = /^(auth|firebase)(\/|$)/;
const METHODS = ['GET', 'HEAD', 'POST', 'OPTIONS'];

/* ---------- Dominios ----------
   La misma web se sirve en varios dominios (todos apuntan a este Worker):
   - canónico (REDIRECT_TARGET, https://kanlane.com): el que ve la gente y indexa Google.
   - espejo (kanlane.yalero.net): sirve la misma web como respaldo, pero con noindex.
   - antiguos (workhub.yalero.net, www.kanlane.com): redirigen al canónico.
   Para cambiar el destino (p. ej. volver al espejo si el canónico da problemas) basta con
   cambiar la variable REDIRECT_TARGET en wrangler.jsonc y desplegar. Las redirecciones son
   temporales (302) hasta que LEGACY_STATUS se pone a 301. */
const DEFAULT_TARGET = 'https://kanlane.com';
const LEGACY_HOSTS = ['workhub.yalero.net', 'www.kanlane.com'];
const MIRROR_HOSTS = ['kanlane.yalero.net'];

/* Service worker que se desinstala solo: lo reciben los navegadores que tenían la app instalada
   en un dominio antiguo, para que dejen de servir la copia guardada y sigan la redirección. */
const SELF_REMOVING_SW = [
  "self.addEventListener('install', () => self.skipWaiting());",
  "self.addEventListener('activate', (e) => e.waitUntil(",
  "  caches.keys().then((k) => Promise.all(k.map((n) => caches.delete(n))))",
  "    .then(() => self.registration.unregister())",
  "    .then(() => self.clients.matchAll({type: 'window'}))",
  "    .then((cs) => cs.forEach((c) => c.navigate(c.url)))",
  '));'
].join('\n');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const canonical = new URL(env.REDIRECT_TARGET || DEFAULT_TARGET);

    /* Dominios antiguos: todo va al canónico, salvo el acceso de Firebase (/__/) para no
       romper un inicio de sesión que ya estuviera en marcha. */
    if (LEGACY_HOSTS.indexOf(host) !== -1 && host !== canonical.hostname && !url.pathname.startsWith('/__/')) {
      if (url.pathname === '/sw.js') {
        return new Response(SELF_REMOVING_SW, {headers: {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store'}});
      }
      const status = String(env.LEGACY_STATUS) === '301' ? 301 : 302;
      return Response.redirect(canonical.origin + url.pathname + url.search, status);
    }

    /* Todo lo que no sea de Firebase Auth se lo damos a los recursos estáticos
       (que responderán con su propio 404 si el fichero no existe). */
    if (!url.pathname.startsWith('/__/')) {
      const res = await env.ASSETS.fetch(request);
      if (MIRROR_HOSTS.indexOf(host) !== -1 && host !== canonical.hostname) {
        /* El espejo no se indexa: Google se queda solo con el dominio canónico. */
        const copy = new Response(res.body, res);
        copy.headers.set('X-Robots-Tag', 'noindex, nofollow');
        return copy;
      }
      return res;
    }

    if (METHODS.indexOf(request.method) === -1) {
      return new Response('Método no permitido', {status: 405});
    }

    const rest = url.pathname.slice('/__/'.length);
    /* Nada de «..» ni de rutas que no sean de Firebase Auth. */
    if (!ALLOWED.test(rest) || rest.split('/').some((p) => p === '..' || p === '.')) {
      return new Response('No encontrado', {status: 404});
    }

    /* Protección adicional del proxy OAuth. Un umbral alto evita penalizar
       redes compartidas; la protección de la API directa corresponde a Firebase. */
    if (env.AUTH_RATE_LIMIT) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const {success} = await env.AUTH_RATE_LIMIT.limit({key: ip});
      if (!success) return new Response('Demasiadas peticiones', {
        status: 429, headers: {'Retry-After': '60', 'Cache-Control': 'no-store'}
      });
    }

    const target = 'https://' + FIREBASE_HOST + '/__/' + rest + url.search;

    /* Sin cookies de este dominio hacia Google. */
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.delete('host');

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual'
    });

    const res = new Response(upstream.body, upstream);
    /* Si Firebase redirige a su dominio, se vuelve al nuestro. */
    const location = res.headers.get('location');
    if (location) {
      res.headers.set('location', location.split('https://' + FIREBASE_HOST).join(url.origin));
    }
    return res;
  }
};
