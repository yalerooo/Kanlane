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

   Solo se reenvían las rutas de Firebase indicadas; no es un proxy abierto.

   Además atiende /__/kms/v1/kek: la clave de los proyectos «Gestionado por Kanlane». */

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

/* ---------- Modo gestionado (docs/CIFRADO-PROYECTOS.md, apartado 12) ----------
   POST /__/kms/v1/kek con «Authorization: Bearer <ID token de Firebase>» y el cuerpo {pid, kid}
   devuelve la clave que envuelve la clave de datos de un proyecto «Gestionado por Kanlane»:
     KEK = HKDF-SHA256(secreto KMS_MASTER_V1, sal «kanlane-kms-v1», info «u:{uid}|{pid}|{kid}»)
   El uid sale del token verificado, nunca de la petición: cada cuenta solo obtiene sus claves.
   La clave de datos (aleatoria, envuelta en Firestore) no pasa por aquí, pero con el secreto y el
   envoltorio se puede abrir: por eso este modo no protege frente a Kanlane. Perder el secreto es
   perder todos los proyectos gestionados. */
const KMS_PATH = '/__/kms/v1/kek';
const KMS_VERSION = 1;
const KMS_SALT = 'kanlane-kms-v1';
const FIREBASE_PROJECT = 'workhub-26f50';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const KMS_PID = /^[A-Za-z0-9_-]{22}$/;
const KMS_KID = /^[A-Za-z0-9_-]{11}$/;
const CLOCK_SKEW = 300;

const text = new TextEncoder();
let jwks = {keys: null, until: 0};

function json(status, body, extra) {
  return new Response(JSON.stringify(body), {status, headers: Object.assign({
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  }, extra || {})});
}

function fromB64(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Claves públicas con las que Google firma los ID token; se guardan lo que diga su Cache-Control. */
async function signingKeys(force) {
  const now = Date.now();
  if (!force && jwks.keys && now < jwks.until) return jwks.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks');
  const data = await res.json();
  const age = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '');
  jwks = {keys: Array.isArray(data.keys) ? data.keys : [], until: now + Math.min(age ? +age[1] : 3600, 86400) * 1000};
  return jwks.keys;
}

/* Devuelve el uid de un ID token de Firebase válido, o null. */
async function verifiedUid(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  let header, claims, signature;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(fromB64(parts[1])));
    signature = fromB64(parts[2]);
  } catch (e) {
    return null;
  }
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !claims) return null;

  let jwk = (await signingKeys(false)).find((k) => k.kid === header.kid);
  /* Google rota las claves: si no está, se vuelven a pedir una vez. */
  if (!jwk) jwk = (await signingKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', {kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true},
    {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, text.encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT || claims.aud !== FIREBASE_PROJECT) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_SKEW) return null;
  if (typeof claims.auth_time !== 'number' || claims.auth_time > now + CLOCK_SKEW) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) return null;
  /* Como las reglas de Firestore: con correo y contraseña, el correo tiene que estar verificado. */
  const provider = claims.firebase && claims.firebase.sign_in_provider;
  if (provider === 'password' && claims.email_verified !== true) return null;
  return claims.sub;
}

async function kms(request, env, url) {
  if (request.method !== 'POST') return json(405, {error: 'method'}, {Allow: 'POST'});
  /* Solo la propia web: una página de otro origen no puede pedir claves. */
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json(403, {error: 'origin'});

  if (env.AUTH_RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const {success} = await env.AUTH_RATE_LIMIT.limit({key: ip});
    if (!success) return json(429, {error: 'rate'}, {'Retry-After': '60'});
  }

  let master;
  try { master = fromB64(env.KMS_MASTER_V1 || ''); } catch (e) { master = new Uint8Array(0); }
  if (master.length < 32) return json(503, {error: 'not-configured'});

  const auth = /^Bearer ([A-Za-z0-9._-]{1,4096})$/.exec(request.headers.get('Authorization') || '');
  let uid = null;
  try {
    uid = auth ? await verifiedUid(auth[1]) : null;
  } catch (e) {
    return json(503, {error: 'unavailable'});
  }
  if (!uid) return json(401, {error: 'auth'});

  let body = null;
  try {
    const raw = await request.text();
    if (raw.length <= 512) body = JSON.parse(raw);
  } catch (e) { /* cuerpo no válido */ }
  if (!body || typeof body !== 'object' || typeof body.pid !== 'string' || typeof body.kid !== 'string' || !KMS_PID.test(body.pid) || !KMS_KID.test(body.kid)) return json(400, {error: 'request'});

  const ikm = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt: text.encode(KMS_SALT),
    info: text.encode('u:' + uid + '|' + body.pid + '|' + body.kid)}, ikm, 256);
  return json(200, {v: 1, kmsv: KMS_VERSION, kek: toB64url(new Uint8Array(bits))});
}

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

    /* Modo gestionado: la clave que envuelve la del proyecto (ver más abajo). */
    if (url.pathname === KMS_PATH) return kms(request, env, url);

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
