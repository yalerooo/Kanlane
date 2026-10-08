/* Envío de notificaciones Web Push (RFC 8291 y RFC 8292): VAPID (JWT del servidor) y
   encriptación AES-128-GCM del mensaje. Sin dependencias: solo WebCrypto global,
   fetch, TextEncoder, btoa/atob. */

const b64url = (bytes) => {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unb64url = (s) => {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const text = (s) => new TextEncoder().encode(s);

/* Verifica que las claves VAPID sean válidas. */
export function validVapid(vapid) {
  if (!vapid || typeof vapid !== 'object') return false;
  try {
    const pub = unb64url(vapid.publicKey);
    const priv = unb64url(vapid.privateKey);
    return pub.length === 65 && priv.length === 32 &&
           typeof vapid.subject === 'string' && vapid.subject.length > 0 &&
           (vapid.subject.startsWith('mailto:') || vapid.subject.startsWith('https://'));
  } catch (e) {
    return false;
  }
}

/* Verifica que la URL del endpoint sea segura (https, sin credenciales, en la lista blanca). */
export function allowedEndpoint(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const host = u.hostname.toLowerCase();
    return host === 'fcm.googleapis.com' ||
           host === 'updates.push.services.mozilla.com' ||
           host === 'web.push.apple.com' ||
           host.endsWith('.push.apple.com') ||
           host.endsWith('.notify.windows.com') ||
           host.endsWith('.push.services.mozilla.com');
  } catch (e) {
    return false;
  }
}

/* JWT VAPID (RFC 8292): autorización del servidor. */
export async function vapidAuth(endpoint, vapid, nowMs) {
  const u = new URL(endpoint);
  const aud = u.origin;
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  const sub = vapid.subject;

  /* Header y claims. */
  const header = b64url(text(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const claims = b64url(text(JSON.stringify({aud, exp, sub})));
  const msg = text(header + '.' + claims);

  /* Importa la clave privada como JWK. */
  const privBytes = unb64url(vapid.privateKey);
  const pubBytes = unb64url(vapid.publicKey);
  const d = b64url(privBytes);
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));

  const jwk = {kty: 'EC', crv: 'P-256', d, x, y};
  const key = await crypto.subtle.importKey('jwk', jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, msg);

  /* Firma en formato IEEE P1363 (r||s, 64 bytes). */
  const sigB64 = b64url(sig);

  return 'vapid t=' + header + '.' + claims + '.' + sigB64 + ', k=' + vapid.publicKey;
}

/* Encriptación RFC 8291: AES-128-GCM de un mensaje. */
export async function encrypt(payload, sub, opts) {
  opts = opts || {};

  /* Decodifica las claves del usuario. */
  const p256dh = unb64url(sub.p256dh);
  const auth = unb64url(sub.auth);
  if (p256dh.length !== 65 || auth.length !== 16) throw new Error('Invalid subscription keys');

  /* Salt y claves efímeras. */
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  let localKeys = opts.localKeys;

  if (!localKeys) {
    /* Genera un par ECDH efímero. */
    localKeys = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  }

  /* Exporta la clave pública efímera. */
  const asPubJwk = await crypto.subtle.exportKey('jwk', localKeys.publicKey);
  const asX = unb64url(asPubJwk.x);
  const asY = unb64url(asPubJwk.y);
  const asPublic = new Uint8Array(65);
  asPublic[0] = 0x04;
  asPublic.set(asX, 1);
  asPublic.set(asY, 33);

  /* ECDH con la clave pública del usuario. */
  const uaPublicJwk = {kty: 'EC', crv: 'P-256', x: b64url(p256dh.slice(1, 33)), y: b64url(p256dh.slice(33, 65))};
  const uaPublicKey = await crypto.subtle.importKey('jwk', uaPublicJwk, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const ecdhSecret = await crypto.subtle.deriveBits({name: 'ECDH', public: uaPublicKey}, localKeys.privateKey, 256);

  /* HKDF: PRK = HMAC-SHA-256(auth, ecdh_secret). */
  const authKey = await crypto.subtle.importKey('raw', auth, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const prk = await crypto.subtle.sign('HMAC', authKey, ecdhSecret);

  /* HKDF-Expand: key_info = "WebPush: info" || 0x00 || ua_public || as_public. */
  const keyInfo = new Uint8Array(13 + 1 + 65 + 65);
  keyInfo.set(text('WebPush: info'), 0);
  keyInfo[13] = 0x00;
  keyInfo.set(p256dh, 14);
  keyInfo.set(asPublic, 14 + 65);

  const prkKey = await crypto.subtle.importKey('raw', prk, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const t1Input = new Uint8Array(keyInfo.length + 1);
  t1Input.set(keyInfo, 0);
  t1Input[keyInfo.length] = 0x01;
  const t1 = await crypto.subtle.sign('HMAC', prkKey, t1Input);
  const ikm = t1.slice(0, 32);

  /* HKDF-Extract: PRK = HMAC-SHA-256(salt, IKM). */
  const saltKey = await crypto.subtle.importKey('raw', salt, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const prk2 = await crypto.subtle.sign('HMAC', saltKey, ikm);

  /* HKDF-Expand: CEK y NONCE. */
  const prkKey2 = await crypto.subtle.importKey('raw', prk2, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);

  const cekInfoStr = text('Content-Encoding: aes128gcm');
  const cekInfo = new Uint8Array(cekInfoStr.length + 2);
  cekInfo.set(cekInfoStr, 0);
  cekInfo[cekInfoStr.length] = 0x00;
  cekInfo[cekInfoStr.length + 1] = 0x01;
  const cekBytes = await crypto.subtle.sign('HMAC', prkKey2, cekInfo);
  const cek = cekBytes.slice(0, 16);

  const nonceInfoStr = text('Content-Encoding: nonce');
  const nonceInfo = new Uint8Array(nonceInfoStr.length + 2);
  nonceInfo.set(nonceInfoStr, 0);
  nonceInfo[nonceInfoStr.length] = 0x00;
  nonceInfo[nonceInfoStr.length + 1] = 0x01;
  const nonceBytes = await crypto.subtle.sign('HMAC', prkKey2, nonceInfo);
  const nonce = nonceBytes.slice(0, 12);

  /* Cuerpo: plaintext || 0x02. */
  const plainBytes = typeof payload === 'string' ? text(payload) : payload;
  if (plainBytes.length > 3000) throw new Error('Payload too large');

  const record = new Uint8Array(plainBytes.length + 1);
  record.set(plainBytes, 0);
  record[plainBytes.length] = 0x02;

  /* AES-128-GCM. */
  const cekKey = await crypto.subtle.importKey('raw', cek, {name: 'AES-GCM'}, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, cekKey, record);

  /* Cuerpo: salt || rs (4096 big-endian) || idlen (1) || as_public || ciphertext. */
  const body = new Uint8Array(16 + 4 + 1 + 65 + ciphertext.byteLength);
  let pos = 0;
  body.set(salt, pos); pos += 16;
  body[pos++] = 0x00;
  body[pos++] = 0x00;
  body[pos++] = 0x10;
  body[pos++] = 0x00;
  body[pos++] = 0x41;
  body.set(asPublic, pos); pos += 65;
  body.set(new Uint8Array(ciphertext), pos);

  return body;
}

/* Envía una notificación Web Push. opts: {ttl (segundos), urgency, topic, fetch, now (ms)}.
   → {ok, status, gone}; gone: el servicio dice que esa suscripción ya no existe. */
export async function send(sub, payload, vapid, opts) {
  opts = Object.assign({ttl: 86400, urgency: 'normal', fetch: globalThis.fetch}, opts);
  const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();

  /* Valida el endpoint antes de hacer la petición. */
  if (!allowedEndpoint(sub.endpoint)) return {ok: false, status: 0, gone: true};

  try {
    const body = await encrypt(payload, {p256dh: sub.p256dh, auth: sub.auth});
    const auth = await vapidAuth(sub.endpoint, vapid, nowMs);

    const headers = {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(opts.ttl),
      'Urgency': opts.urgency
    };

    /* Topic: solo si es válido. */
    if (opts.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) {
      headers['Topic'] = opts.topic;
    }

    const res = await opts.fetch(sub.endpoint, {
      method: 'POST',
      headers,
      body
    });

    const status = res.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      gone: status === 404 || status === 410
    };
  } catch (e) {
    return {ok: false, status: 0, gone: false};
  }
}

/* Genera un par de claves VAPID. */
export async function generateVapidKeys() {
  const key = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign']);
  const pubJwk = await crypto.subtle.exportKey('jwk', key.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', key.privateKey);

  const x = unb64url(pubJwk.x);
  const y = unb64url(pubJwk.y);
  const d = unb64url(privJwk.d);

  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(x, 1);
  publicKey.set(y, 33);

  return {publicKey: b64url(publicKey), privateKey: b64url(d)};
}
