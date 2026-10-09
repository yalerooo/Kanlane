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
   La excepción es /__/auth/action (los enlaces de los correos de verificación y de cambio de
   contraseña): no se reenvía, se manda a la app (ver ACTION_PATH).

   Además atiende /__/kms/v1/kek: la clave de los proyectos «Gestionado por Kanlane», y
   /__/kms/v1/totp: la verificación en dos pasos del gestor de contraseñas.

   Y, sin atender ninguna petición, ejecuta cada 30 minutos las automatizaciones por fecha de los
   proyectos (cron de wrangler.jsonc → `scheduled` → worker/automations.mjs).

   Captura de tareas por correo (docs/CAPTURA-EMAIL.md, worker/capture.mjs):
   - /__/capture/v1: activar, desactivar, regenerar y configurar la dirección de un proyecto, con el
     mismo «Authorization» que /__/kms/. Lo que se pide va en el cuerpo: {op, pid | tid, stage, allow}.
   - `email`: el correo que Cloudflare Email Routing entrega a un dominio de captura. No es una
     ruta: no se puede llamar desde fuera.

   Servidor MCP (docs/MCP.md, worker/mcp.mjs): un asistente lee y mueve las tareas de un proyecto.
   - /__/mcp/v1: el servidor. JSON-RPC por POST con «Authorization: Bearer kl_…» (un token del proyecto).
   - /__/mcp/v1/tokens: crear, ver y revocar esos tokens, con el mismo «Authorization» que /__/kms/.

   Avisos push con Kanlane cerrado (docs/NOTIFICACIONES.md, worker/notify.mjs):
   - /__/notify/v1: activar los avisos en un navegador y avisar de una mención, una asignación o un
     cambio en una tarea seguida, con el mismo «Authorization» que /__/kms/. */

const FIREBASE_HOST = 'workhub-26f50.firebaseapp.com';
const ALLOWED = /^(auth|firebase)(\/|$)/;
const METHODS = ['GET', 'HEAD', 'POST', 'OPTIONS'];

/* ---------- Enlaces de los correos de Firebase ----------
   Los correos de «verifica tu correo» y «cambia tu contraseña» enlazan a /__/auth/action, que
   reenviada a Firebase es una página gris suya. Esos dos casos se mandan a la app (/app/, con
   `mode`, `oobCode` y `lang`), que valida el código y enseña su propia pantalla
   (AuthController.resolveAction). La clave de la API y `continueUrl` no se pasan: no hacen falta.
   Los demás modos (recoverEmail, verifyAndChangeEmail…) la app no los envía y se siguen
   reenviando a Firebase, igual que el resto de /__/auth/* (el acceso con Google y GitHub
   depende de /__/auth/handler). */
const ACTION_PATH = 'auth/action';
const ACTION_MODES = ['verifyEmail', 'resetPassword'];
const ACTION_CODE = /^[A-Za-z0-9_-]{8,512}$/;
const ACTION_LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

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

const CAPTURE_PATH = '/__/capture/v1';
const CAPTURE_BODY_MAX = 4096;

const NOTIFY_PATH = '/__/notify/v1';

const MCP_PATH = '/__/mcp/v1';
const MCP_TOKENS_PATH = '/__/mcp/v1/tokens';
const MCP_BODY_MAX = 65536;
const MCP_BEARER = /^Bearer (kl_[a-z2-7]{32})$/;

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
  const claims = await verifiedClaims(token);
  return claims ? claims.sub : null;
}

/* Los datos de un ID token de Firebase válido ({sub, email, email_verified…}), o null. */
async function verifiedClaims(token) {
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
  return claims;
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

/* Gestión de la dirección de captura de un proyecto. Quién llama sale del token verificado (uid y
   correo comprobado), nunca del cuerpo; qué puede hacer lo decide worker/capture.mjs mirando el proyecto. */
async function capture(request, env, url) {
  if (request.method !== 'POST') return json(405, {error: 'method'}, {Allow: 'POST'});
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json(403, {error: 'origin'});
  if (env.AUTH_RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const {success} = await env.AUTH_RATE_LIMIT.limit({key: ip});
    if (!success) return json(429, {error: 'rate'}, {'Retry-After': '60'});
  }
  const auth = /^Bearer ([A-Za-z0-9._-]{1,4096})$/.exec(request.headers.get('Authorization') || '');
  let claims = null;
  try {
    claims = auth ? await verifiedClaims(auth[1]) : null;
  } catch (e) {
    return json(503, {error: 'unavailable'});
  }
  if (!claims) return json(401, {error: 'auth'});
  let body = null;
  try {
    const raw = await request.text();
    if (raw.length <= CAPTURE_BODY_MAX) body = JSON.parse(raw);
  } catch (e) { body = null; }
  if (!body || typeof body !== 'object') return json(400, {error: 'request'});
  try {
    const m = await import('./capture.mjs');
    const out = await m.manage({uid: claims.sub, email: typeof claims.email === 'string' ? claims.email : '', emailVerified: claims.email_verified === true}, body, env);
    return json(out.status, out.body);
  } catch (e) {
    console.error('captura: ' + (e && e.message));
    return json(503, {error: 'unavailable'});
  }
}

/* Tokens del servidor MCP de un proyecto. Como en la captura: quién llama sale del ID token
   verificado y qué puede hacer lo decide worker/mcp.mjs mirando el proyecto. */
async function mcpTokens(request, env, url) {
  if (request.method !== 'POST') return json(405, {error: 'method'}, {Allow: 'POST'});
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json(403, {error: 'origin'});
  if (env.AUTH_RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const {success} = await env.AUTH_RATE_LIMIT.limit({key: ip});
    if (!success) return json(429, {error: 'rate'}, {'Retry-After': '60'});
  }
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
    if (raw.length <= CAPTURE_BODY_MAX) body = JSON.parse(raw);
  } catch (e) { body = null; }
  if (!body || typeof body !== 'object') return json(400, {error: 'request'});
  try {
    const m = await import('./mcp.mjs');
    const out = await m.manage({uid: uid}, body, env);
    return json(out.status, out.body);
  } catch (e) {
    console.error('mcp: ' + (e && e.message));
    return json(503, {error: 'unavailable'});
  }
}

/* Avisos push. Como en la captura: quién llama sale del ID token verificado; a quién se avisa y
   con qué texto lo decide worker/notify.mjs mirando el equipo y la tarea. */
async function notify(request, env, url) {
  if (request.method !== 'POST') return json(405, {error: 'method'}, {Allow: 'POST'});
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json(403, {error: 'origin'});
  if (env.AUTH_RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const {success} = await env.AUTH_RATE_LIMIT.limit({key: ip});
    if (!success) return json(429, {error: 'rate'}, {'Retry-After': '60'});
  }
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
    if (raw.length <= CAPTURE_BODY_MAX) body = JSON.parse(raw);
  } catch (e) { body = null; }
  if (!body || typeof body !== 'object') return json(400, {error: 'request'});
  try {
    const m = await import('./notify.mjs');
    const out = await m.manage({uid: uid}, body, env);
    return json(out.status, out.body);
  } catch (e) {
    console.error('avisos: ' + (e && e.message));
    return json(503, {error: 'unavailable'});
  }
}

/* El servidor MCP. No es para navegadores: una página de otro origen no entra (y la propia web no
   lo usa). Dos límites: por IP, antes de mirar nada, y por token (MCP_RATE_LIMIT). Un token
   inventado se descarta en worker/mcp.mjs sin leer la base de datos. En los registros no queda ni
   el token ni el contenido. */
async function mcp(request, env, url) {
  const error = (status, code, message, extra) => json(status, {jsonrpc: '2.0', id: null, error: {code: code, message: message}}, extra);
  if (request.method !== 'POST') return error(405, -32600, 'Use POST.', {Allow: 'POST'});
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return error(403, -32600, 'Origin not allowed.');
  if (env.AUTH_RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const {success} = await env.AUTH_RATE_LIMIT.limit({key: ip});
    if (!success) return error(429, -32002, 'Too many requests.', {'Retry-After': '60'});
  }
  const auth = MCP_BEARER.exec(request.headers.get('Authorization') || '');
  if (!auth) return error(401, -32001, 'Invalid or revoked token.', {'WWW-Authenticate': 'Bearer'});
  if (env.MCP_RATE_LIMIT) {
    /* Por el identificador del token (su primera mitad), que no es secreto. */
    const {success} = await env.MCP_RATE_LIMIT.limit({key: 'mcp:' + auth[1].slice(3, 19)});
    if (!success) return error(429, -32002, 'Too many requests.', {'Retry-After': '60'});
  }
  let message = null;
  try {
    const raw = await request.text();
    if (raw.length > MCP_BODY_MAX) return error(413, -32600, 'Request too large.');
    message = JSON.parse(raw);
  } catch (e) {
    return error(400, -32700, 'Parse error.');
  }
  try {
    const m = await import('./mcp.mjs');
    const out = await m.rpc(auth[1], message, env);
    if (out.body === null) return new Response(null, {status: out.status, headers: {'Cache-Control': 'no-store'}});
    return json(out.status, out.body, out.status === 401 ? {'WWW-Authenticate': 'Bearer'} : undefined);
  } catch (e) {
    console.error('mcp: ' + (e && e.message));
    return error(503, -32000, 'Temporarily unavailable.');
  }
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
    }, (err) => console.error('automatizaciones: ' + (err && err.message)))
      /* Después, la limpieza de la captura por correo: marcas y contadores caducados. Va detrás
         (no a la vez) para no competir por las subpeticiones de la vuelta. */
      .then(() => import('./capture.mjs')).then((m) => m.sweep(env)).then((out) => {
        if (out.configured && (out.seen || out.rate)) console.log('captura: limpieza, ' + out.seen + ' marcas y ' + out.rate + ' contadores caducados');
      }, (err) => console.error('captura: limpieza, ' + (err && err.message)))
      /* Y los contadores del servidor MCP de días pasados. */
      .then(() => import('./mcp.mjs')).then((m) => m.sweep(env)).then((out) => {
        if (out.configured && out.rate) console.log('mcp: limpieza, ' + out.rate + ' contadores caducados');
      }, (err) => console.error('mcp: limpieza, ' + (err && err.message)))
      /* Y los de los avisos push. */
      .then(() => import('./notify.mjs')).then((m) => m.sweep(env)).then((out) => {
        if (out.configured && out.rate) console.log('avisos: limpieza, ' + out.rate + ' contadores caducados');
      }, (err) => console.error('avisos: limpieza, ' + (err && err.message)));
    ctx.waitUntil(job);
    return job;
  },

  /* Correo entrante (Cloudflare Email Routing → este Worker). Lo que no se puede atender se
     rechaza con setReject dentro de receive; un fallo inesperado se lanza y el servidor que envía
     lo reintenta. En los registros no queda ni la dirección ni el contenido. */
  async email(message, env, ctx) {
    const m = await import('./capture.mjs');
    try {
      await m.receive(message, env);
    } catch (err) {
      console.error('captura: ' + (err && err.message));
      throw err;
    }
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
    if (url.pathname === CAPTURE_PATH) return capture(request, env, url);
    if (url.pathname === NOTIFY_PATH) return notify(request, env, url);
    if (url.pathname === MCP_TOKENS_PATH) return mcpTokens(request, env, url);
    if (url.pathname === MCP_PATH) return mcp(request, env, url);

    if (METHODS.indexOf(request.method) === -1) {
      return new Response('Método no permitido', {status: 405});
    }

    const rest = url.pathname.slice('/__/'.length);
    /* Nada de «..» ni de rutas que no sean de Firebase Auth. */
    if (!ALLOWED.test(rest) || rest.split('/').some((p) => p === '..' || p === '.')) {
      return new Response('No encontrado', {status: 404});
    }

    /* Enlace de un correo de verificación o de cambio de contraseña: lo atiende la app. */
    if (rest === ACTION_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      const mode = url.searchParams.get('mode') || '';
      const code = url.searchParams.get('oobCode') || '';
      if (ACTION_MODES.indexOf(mode) !== -1 && ACTION_CODE.test(code)) {
        /* En un dominio antiguo, directo al canónico (allí /app/ redirige de todos modos). */
        const legacy = LEGACY_HOSTS.indexOf(host) !== -1 && host !== canonical.hostname;
        const to = new URL('/app/', legacy ? canonical.origin : url.origin);
        to.searchParams.set('mode', mode);
        to.searchParams.set('oobCode', code);
        const lang = url.searchParams.get('lang') || '';
        if (ACTION_LANG.test(lang)) to.searchParams.set('lang', lang);
        return new Response(null, {status: 302, headers: {
          Location: to.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'
        }});
      }
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
