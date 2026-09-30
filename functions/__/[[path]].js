/* Cloudflare Pages Function: /__/auth/* y /__/firebase/* → Firebase.

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

export async function onRequest({request, params}) {
  if (METHODS.indexOf(request.method) === -1) {
    return new Response('Método no permitido', {status: 405});
  }

  const parts = Array.isArray(params.path) ? params.path : [params.path || ''];
  const rest = parts.join('/');
  /* Nada de «..» ni de rutas que no sean de Firebase Auth. */
  if (!ALLOWED.test(rest) || parts.some((p) => p === '..' || p === '.')) {
    return new Response('No encontrado', {status: 404});
  }

  const url = new URL(request.url);
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
