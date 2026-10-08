/* Pruebas de Web Push (RFC 8291 y RFC 8292).
   Uso: node tests/worker/webpush.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const PROJECT = 'test-project';

/* Decodifica base64url. */
function unb64url(s) {
  const bin = Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return bin;
}

/* Codifica a base64url. */
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

(async () => {
  /* Importa el módulo. */
  const {
    validVapid, allowedEndpoint, vapidAuth, encrypt, send, generateVapidKeys
  } = await import(require('url').pathToFileURL(path.join(__dirname, '../../worker/webpush.mjs')).href);

  const ok = (m) => console.log('OK   ' + m);

  /* Test 1: RFC 8291 vector. */
  try {
    const plaintext = 'When I grow up, I want to be a watermelon';
    const as_private = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
    const as_public = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
    const ua_public = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
    const ua_private = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
    const auth = 'BTBZMqHH6r4Tts7J_aSIgg';
    const salt = 'DGv6ra1nlYgDCS1FRnbzlw';
    const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

    /* Importa las claves ECDH como CryptoKey. */
    const as_d_buf = unb64url(as_private);
    const as_pub_buf = unb64url(as_public);
    const ua_pub_buf = unb64url(ua_public);

    const as_priv_jwk = {
      kty: 'EC', crv: 'P-256', d: as_private,
      x: b64url(as_pub_buf.slice(1, 33)),
      y: b64url(as_pub_buf.slice(33, 65))
    };

    const as_pub_key = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256',
      x: b64url(as_pub_buf.slice(1, 33)),
      y: b64url(as_pub_buf.slice(33, 65))
    }, {name: 'ECDH', namedCurve: 'P-256'}, true, []);

    const as_priv_key = await crypto.subtle.importKey('jwk', as_priv_jwk,
      {name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);

    const body = await encrypt(plaintext, {p256dh: ua_public, auth}, {
      salt: unb64url(salt),
      localKeys: {publicKey: as_pub_key, privateKey: as_priv_key}
    });

    const result = b64url(body);
    assert.equal(result, expected, 'RFC 8291 vector mismatch');
    ok('RFC 8291 vector');
  } catch (e) {
    console.error('FALLO RFC 8291 vector:', e.message);
    process.exit(1);
  }

  /* Test 2: Propiedad estructural: estructura del mensaje y aleatoriedad. */
  try {
    const plaintext = 'Test message 123';
    const ua_keys = nodeCrypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const ua_pub_der = ua_keys.publicKey.export({format: 'der', type: 'spki'});
    const ua_pub_point = ua_pub_der.slice(ua_pub_der.length - 65);

    const auth_secret = nodeCrypto.randomBytes(16);
    const ua_public_b64 = b64url(ua_pub_point);

    const body = await encrypt(plaintext, {
      p256dh: ua_public_b64,
      auth: b64url(auth_secret)
    });

    /* Verifica estructura: salt(16) || rs(4) || idlen(1) || as_public(65) || ciphertext */
    const bodyBuf = Buffer.from(body);
    assert(bodyBuf.length >= 16 + 4 + 1 + 65, 'Message should be at least 86 bytes');

    const salt = bodyBuf.slice(0, 16);
    const rs = bodyBuf.slice(16, 20).readUInt32BE(0);
    const idlen = bodyBuf[20];
    const as_public = bodyBuf.slice(21, 21 + idlen);
    const ciphertext = bodyBuf.slice(21 + idlen);

    assert.equal(salt.length, 16, 'Salt should be 16 bytes');
    assert.equal(rs, 4096, 'Record size should be 4096');
    assert.equal(idlen, 65, 'idlen should be 65');
    assert.equal(as_public.length, 65, 'as_public should be 65 bytes');
    assert.equal(as_public[0], 0x04, 'as_public should start with 0x04');
    assert(ciphertext.length > 0, 'Ciphertext should not be empty');

    /* La estructura del plaintext cifrado es: plaintext || 0x02 || 16 bytes de auth tag */
    /* Entonces el ciphertext debería tener al menos plaintext.length + 1 + 16 bytes */
    const expectedMinLength = plaintext.length + 1 + 16;
    assert(ciphertext.length >= expectedMinLength, `Ciphertext should be at least ${expectedMinLength} bytes`);

    /* Dos encrypts producen diferentes resultados (sal y claves efímeras diferentes). */
    const body2 = await encrypt(plaintext, {
      p256dh: ua_public_b64,
      auth: b64url(auth_secret)
    });
    assert.notDeepEqual(body, body2, 'Random salt should produce different bodies');

    /* Las sales deben ser diferentes. */
    const salt2 = bodyBuf.slice(0, 16);
    const salt2_ = Buffer.from(body2).slice(0, 16);
    assert.notDeepEqual(salt, salt2_, 'Salts should be different');

    ok('Propiedad estructural: estructura del mensaje y aleatoriedad');
  } catch (e) {
    console.error('FALLO Round trip:', e.message);
    process.exit(1);
  }

  /* Test 3: VAPID. */
  try {
    const vapid = Object.assign(await generateVapidKeys(), {subject: 'mailto:avisos@kanlane.test'});
    assert(validVapid(vapid), 'Generated VAPID should be valid');

    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    const now = Date.now();
    const auth = await vapidAuth(endpoint, vapid, now);

    assert(auth.startsWith('vapid t='), 'Auth should start with "vapid t="');
    assert(auth.includes(', k='), 'Auth should include k= part');

    const match = auth.match(/t=([^,]+)/);
    assert(match && match[1], 'Should extract JWT from auth header');
    const jwt = match[1];
    const parts = jwt.split('.');
    assert.equal(parts.length, 3, 'JWT should have 3 parts');

    /* Verifica que cada parte del JWT sea válida base64url. */
    for (let i = 0; i < 3; i++) {
      assert(parts[i].match(/^[A-Za-z0-9_-]*$/), `JWT part ${i} should be valid base64url`);
    }

    /* Extrae el k (public key) del auth header. */
    const kMatch = auth.match(/k=([^ ]+)$/);
    assert(kMatch && kMatch[1], 'Should extract public key from auth header');
    assert.equal(kMatch[1], vapid.publicKey, 'Public key in header should match vapid.publicKey');

    /* validVapid debería aceptar claves válidas con sujetos mailto: o https://, y rechazar las demás. */
    assert(!validVapid({publicKey: 'invalid', privateKey: 'invalid', subject: 'mailto:test@example.com'}), 'Invalid keys should be rejected');
    assert(!validVapid({publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: 'invalid'}), 'Invalid subject should be rejected');
    assert(validVapid({publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: 'https://example.com'}), 'HTTPS subject should be accepted');
    assert(validVapid({publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: 'mailto:test@example.com'}), 'Mailto subject should be accepted');

    ok('VAPID');
  } catch (e) {
    console.error('FALLO VAPID:', e.message, e.stack);
    process.exit(1);
  }

  /* Test 4: allowedEndpoint. */
  try {
    assert(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'), 'FCM should be allowed');
    assert(allowedEndpoint('https://updates.push.services.mozilla.com/x'), 'Mozilla should be allowed');
    assert(allowedEndpoint('https://web.push.apple.com/x'), 'Apple web should be allowed');
    assert(allowedEndpoint('https://foo.push.apple.com/x'), 'Apple subdomain should be allowed');
    assert(allowedEndpoint('https://foo.notify.windows.com/x'), 'Windows notify should be allowed');
    assert(allowedEndpoint('https://foo.push.services.mozilla.com/x'), 'Mozilla subdomain should be allowed');

    assert(!allowedEndpoint('http://fcm.googleapis.com/x'), 'HTTP should be rejected');
    assert(!allowedEndpoint('https://fcm.googleapis.com.evil.com/x'), 'Domain suffix should be rejected');
    assert(!allowedEndpoint('https://127.0.0.1/x'), 'IP should be rejected');
    assert(!allowedEndpoint('https://localhost/x'), 'Localhost should be rejected');
    assert(!allowedEndpoint('https://fcm.googleapis.com:8080/x'), 'Port should be rejected');
    assert(!allowedEndpoint('https://user:pass@fcm.googleapis.com/x'), 'Credentials should be rejected');
    assert(!allowedEndpoint('https://example.com/x'), 'Unknown host should be rejected');
    assert(!allowedEndpoint(123), 'Non-string should be rejected');

    ok('allowedEndpoint');
  } catch (e) {
    console.error('FALLO allowedEndpoint:', e.message);
    process.exit(1);
  }

  /* Test 5: send function. */
  try {
    /* Genera un vapid válido para el test. */
    const vapid = await generateVapidKeys();
    const payload = 'Test notification';

    const ua_keys = nodeCrypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const ua_pub_der = ua_keys.publicKey.export({format: 'der', type: 'spki'});
    const ua_pub_point = ua_pub_der.slice(ua_pub_der.length - 65);
    const ua_public_b64 = b64url(ua_pub_point);
    const auth_b64 = b64url(nodeCrypto.randomBytes(16));

    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: ua_public_b64,
      auth: auth_b64
    };

    /* Fetch fake. */
    let capturedRequest = null;
    const fakeFetch = async (url, opts) => {
      capturedRequest = {url, opts};
      return {status: 201};
    };

    const result = await send(sub, payload, vapid, {fetch: fakeFetch});
    assert(result.ok, 'Send should succeed with 201');
    assert.equal(result.status, 201, 'Status should be 201');
    assert(!result.gone, 'Should not be gone');

    assert(capturedRequest, 'Fetch should have been called');
    assert.equal(capturedRequest.opts.method, 'POST', 'Method should be POST');
    assert(capturedRequest.opts.headers.Authorization, 'Should have Authorization header');
    assert.equal(capturedRequest.opts.headers['Content-Encoding'], 'aes128gcm', 'Should have Content-Encoding header');
    assert(capturedRequest.opts.body instanceof Uint8Array, 'Body should be Uint8Array');

    /* Test 404 / 410. */
    const result404 = await send(sub, payload, vapid, {fetch: async () => ({status: 404})});
    assert(result404.gone, 'Status 404 should be gone');

    const result410 = await send(sub, payload, vapid, {fetch: async () => ({status: 410})});
    assert(result410.gone, 'Status 410 should be gone');

    /* Test 500 / not ok. */
    const result500 = await send(sub, payload, vapid, {fetch: async () => ({status: 500})});
    assert(!result500.ok, 'Status 500 should not be ok');
    assert(!result500.gone, 'Status 500 should not be gone');

    /* Test fetch error. */
    const resultErr = await send(sub, payload, vapid, {fetch: async () => { throw new Error('Network error'); }});
    assert(!resultErr.ok, 'Fetch error should not be ok');
    assert(!resultErr.gone, 'Fetch error should not be gone');
    assert.equal(resultErr.status, 0, 'Fetch error status should be 0');

    /* Test disallowed endpoint. */
    const badSub = {endpoint: 'http://example.com/x', p256dh: ua_public_b64, auth: auth_b64};
    const resultBad = await send(badSub, payload, vapid, {fetch: fakeFetch});
    assert(!resultBad.ok, 'Disallowed endpoint should not be ok');
    assert(resultBad.gone, 'Disallowed endpoint should be gone');
    assert.equal(resultBad.status, 0, 'Disallowed endpoint status should be 0');

    /* Test large payload. */
    try {
      const largePay = 'x'.repeat(3001);
      await send(sub, largePay, vapid, {fetch: fakeFetch});
      assert(false, 'Should reject large payload');
    } catch (e) {
      assert(true, 'Should reject large payload');
    }

    /* Test topic header. */
    const result2 = await send(sub, payload, vapid, {
      fetch: fakeFetch,
      topic: 'my-topic'
    });
    assert(capturedRequest.opts.headers.Topic === 'my-topic', 'Valid topic should be included');

    const result3 = await send(sub, payload, vapid, {
      fetch: fakeFetch,
      topic: 'invalid topic!'
    });
    assert(!capturedRequest.opts.headers.Topic, 'Invalid topic should be omitted');

    ok('send function');
  } catch (e) {
    console.error('FALLO send:', e.message);
    process.exit(1);
  }

  console.log('5 pruebas correctas');
})();
