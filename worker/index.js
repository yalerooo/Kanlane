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

   Además atiende /__/kms/v1/kek: la clave de los proyectos «Gestionado por Kanlane», y
   /__/kms/v1/totp: la verificación en dos pasos del gestor de contraseñas.

   Y, sin atender ninguna petición, ejecuta cada 30 minutos las automatizaciones por fecha de los
   proyectos (cron de wrangler.jsonc → `scheduled` → worker/automations.mjs). */

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

/* ---------- Verificación en dos pasos del gestor de contraseñas (docs/SEGURIDAD.md) ----------
   POST /__/kms/v1/totp con el mismo «Authorization» que la ruta anterior. Con el segundo paso
   activado, la clave del cofre va envuelta dos veces: con la contraseña maestra (en el navegador) y
   con una clave que solo sale de aquí tras un código TOTP válido (RFC 6238: SHA-1, 30 s, 6 cifras).
   Así la contraseña maestra y una copia de la base de datos no bastan para abrir el cofre.
     {op:'enroll', secret, code} → {token, share}   secret: los 20 bytes del autenticador, en base64url
     {op:'verify', token, code}  → {token, share}
   No se guarda nada: «token» es el secreto del autenticador cifrado con una clave derivada de
   KMS_MASTER_V1 y atado a la cuenta (AES-GCM, datos asociados «u:{uid}»); lo conserva el navegador
   dentro del envoltorio de la contraseña maestra. «share» = HKDF-SHA256(secreto, sal
   «kanlane-vault-totp-v1», info «share|u:{uid}|{token}»).
   Un código son 6 cifras: lo que impide probarlos todos es TOTP_RATE_LIMIT (por cuenta). Sin ese
   límite configurado la ruta no responde. La clave de recuperación del cofre va envuelta igual, así
   que tampoco abre sin pasar por aquí; lo único que no pasa por aquí son los códigos de respaldo
   (src/models/vault-model.js), que es con lo que se entraría si se perdiera KMS_MASTER_V1. */
const TOTP_PATH = '/__/kms/v1/totp';
const TOTP_SALT = 'kanlane-vault-totp-v1';
const TOTP_STEP = 30;
const TOTP_SECRET_BYTES = 20;
const TOTP_CODE = /^[0-9]{6}$/;
const TOTP_TOKEN = /^[A-Za-z0-9_-]{64}$/;

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

/* Lo que comparten las rutas de /__/kms/: solo POST, solo desde la propia web, con el secreto
   configurado y con un ID token válido. Devuelve {uid, master} o {error: Response}. */
async function kmsCaller(request, env, url) {
  if (request.method !== 'POST') return {error: json(405, {error: 'method'}, {Allow: 'POST'})};
  /* Solo la propia web: una página de otro origen no puede pedir claves. */
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return {error: json(403, {error: 'origin'})};

  if (env.AUTH_RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const {success} = await env.AUTH_RATE_LIMIT.limit({key: ip});
    if (!success) return {error: json(429, {error: 'rate'}, {'Retry-After': '60'})};
  }

  let master;
  try { master = fromB64(env.KMS_MASTER_V1 || ''); } catch (e) { master = new Uint8Array(0); }
  if (master.length < 32) return {error: json(503, {error: 'not-configured'})};

  const auth = /^Bearer ([A-Za-z0-9._-]{1,4096})$/.exec(request.headers.get('Authorization') || '');
  let uid = null;
  try {
    uid = auth ? await verifiedUid(auth[1]) : null;
  } catch (e) {
    return {error: json(503, {error: 'unavailable'})};
  }
  if (!uid) return {error: json(401, {error: 'auth'})};
  return {uid, master};
}

async function jsonBody(request) {
  try {
    const raw = await request.text();
    if (raw.length <= 512) {
      const body = JSON.parse(raw);
      if (body && typeof body === 'object') return body;
    }
  } catch (e) { /* cuerpo no válido */ }
  return null;
}

async function kms(request, env, url) {
  const who = await kmsCaller(request, env, url);
  if (who.error) return who.error;

  const body = await jsonBody(request);
  if (!body || typeof body.pid !== 'string' || typeof body.kid !== 'string' || !KMS_PID.test(body.pid) || !KMS_KID.test(body.kid)) return json(400, {error: 'request'});

  const ikm = await crypto.subtle.importKey('raw', who.master, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt: text.encode(KMS_SALT),
    info: text.encode('u:' + who.uid + '|' + body.pid + '|' + body.kid)}, ikm, 256);
  return json(200, {v: 1, kmsv: KMS_VERSION, kek: toB64url(new Uint8Array(bits))});
}

/* Código TOTP de un secreto para un contador (RFC 4226, 6 cifras). */
async function totpCode(secret, counter) {
  const key = await crypto.subtle.importKey('raw', secret, {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, counter);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const at = mac[19] & 15;
  const num = ((mac[at] & 127) << 24) | (mac[at + 1] << 16) | (mac[at + 2] << 8) | mac[at + 3];
  return String(num % 1000000).padStart(6, '0');
}

/* Vale el código de ahora y los de 30 s antes y después (relojes algo desajustados). */
async function totpMatches(secret, code) {
  const now = Math.floor(Date.now() / 1000 / TOTP_STEP);
  let ok = false;
  for (let d = -1; d <= 1; d++) {
    if (await totpCode(secret, now + d) === code) ok = true;
  }
  return ok;
}

async function totp(request, env, url) {
  const who = await kmsCaller(request, env, url);
  if (who.error) return who.error;
  /* Sin límite por cuenta, seis cifras se adivinan probando: mejor no responder. */
  if (!env.TOTP_RATE_LIMIT) return json(503, {error: 'not-configured'});

  const body = await jsonBody(request);
  const enroll = !!body && body.op === 'enroll';
  if (!body || (!enroll && body.op !== 'verify') || typeof body.code !== 'string' || !TOTP_CODE.test(body.code)) return json(400, {error: 'request'});
  if (enroll ? typeof body.secret !== 'string' || body.secret.length > 64 : typeof body.token !== 'string' || !TOTP_TOKEN.test(body.token)) return json(400, {error: 'request'});

  const {success} = await env.TOTP_RATE_LIMIT.limit({key: 'totp:' + who.uid});
  if (!success) return json(429, {error: 'rate'}, {'Retry-After': '60'});

  const ikm = await crypto.subtle.importKey('raw', who.master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const tokenKey = await crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: text.encode(TOTP_SALT), info: text.encode('token')},
    ikm, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  const bound = text.encode('u:' + who.uid);

  let secret, token;
  if (enroll) {
    try { secret = fromB64(body.secret); } catch (e) { secret = new Uint8Array(0); }
    if (secret.length !== TOTP_SECRET_BYTES) return json(400, {error: 'request'});
  } else {
    /* Un token de otra cuenta, o manipulado, no se abre. */
    try {
      const raw = fromB64(body.token);
      secret = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: bound}, tokenKey, raw.slice(12)));
    } catch (e) {
      return json(400, {error: 'token'});
    }
    token = body.token;
  }
  if (!await totpMatches(secret, body.code)) return json(403, {error: 'code'});

  if (enroll) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: bound}, tokenKey, secret));
    const raw = new Uint8Array(12 + sealed.length);
    raw.set(iv);
    raw.set(sealed, 12);
    token = toB64url(raw);
  }
  const share = await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt: text.encode(TOTP_SALT),
    info: text.encode('share|u:' + who.uid + '|' + token)}, ikm, 256);
  return json(200, {v: 1, token, share: toB64url(new Uint8Array(share))});
}

export default {
  /* Cron: automatizaciones por fecha con Kanlane cerrado. Se carga aparte (solo cuando toca) y,
     sin el secreto FIREBASE_SERVICE_ACCOUNT, no hace nada. */
  async scheduled(event, env, ctx) {
    const job = import('./automations.mjs').then((m) => m.run(env)).then((out) => {
      /* Una línea por vuelta, haya hecho algo o no: sin identificadores de proyecto ni contenido. */
      if (!out.configured) { console.log('automatizaciones: sin configurar (falta el secreto FIREBASE_SERVICE_ACCOUNT)'); return; }
      const bad = out.results.filter((r) => r.status === 'error' || r.status === 'conflict').length;
      console.log('automatizaciones: ' + out.ran + ' ejecuciones en ' + out.jobs + ' proyectos' + (bad ? ', ' + bad + ' pendientes de reintento' : ''));
    }, (err) => console.error('automatizaciones: ' + (err && err.message)));
    ctx.waitUntil(job);
    return job;
  },

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
    if (url.pathname === TOTP_PATH) return totp(request, env, url);

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
