/* Cifrado por proyecto (modo B, «Cifrado total»). Plan: docs/CIFRADO-PROYECTOS.md, apartados 5 y 6.1.
   PR1: el servicio existe y está probado, pero todavía no lo usa ninguna parte de la app.

   - DEK: 32 bytes de crypto.getRandomValues por proyecto. En el navegador vive como CryptoKey
     AES-GCM NO extraíble; las funciones de datos (seal, open, kcv…) rechazan claves extraíbles.
   - Envoltorios de la DEK (AES-GCM, IV de 12 bytes, AAD «kanlane/wrap/v1|tipo|pid|kid|uid»):
       pw   → KEK = PBKDF2-SHA256(contraseña en NFC, sal 16 B, ≥ 600 000 iteraciones)
       rk   → KEK = HKDF-SHA256(clave de recuperación de 160 bits, sal = bytes del pid, info «kanlane/rk/v1»)
       code → KEK = PBKDF2-SHA256(código de acceso de 100 bits, sal 16 B, 100 000 iteraciones)
     Al desenvolver se usa crypto.subtle.unwrapKey: los bytes de la DEK no llegan a JavaScript.
   - Datos: e = base64url(iv[12] ‖ texto cifrado ‖ etiqueta[16]), IV aleatorio en CADA escritura,
     AAD «kanlane/v1|pid|kid|ruta|id|ev».
   - Errores: Error con name 'ProjectCryptoError' y .code = 'unavailable' | 'bad-format' | 'bad-key' |
     'extractable-key' | 'short-password' | 'bad-password' | 'bad-recovery' | 'bad-code' | 'undecryptable'.
     AES-GCM no distingue «clave errónea», «AAD distinta» y «blob manipulado»: las tres dan
     'undecryptable' (y 'bad-password' / 'bad-recovery' / 'bad-code' al desenvolver).
   Este archivo no guarda claves en ningún sitio (ni localStorage ni IndexedDB): eso es keystore.js. */
(function(){
  'use strict';
  const base = Workhub.services.crypto;

  const VERSION = 1;                      /* enc.v y crypto/{uid}.v */
  const EV = 1;                           /* versión del esquema de los blobs que se escriben */
  const SUPPORTED_EV = Object.freeze([1]);
  const KDF_ITERATIONS = 600000;          /* D15; las reglas exigen este mínimo */
  const MIN_KDF_ITERATIONS = 600000;
  const MAX_KDF_ITERATIONS = 10000000;    /* tope al desenvolver: un documento manipulado no congela la pestaña */
  const CODE_ITERATIONS = 100000;
  const MIN_PASSWORD_LENGTH = 12;         /* D16 */
  const DEK_BYTES = 32, IV_BYTES = 12, TAG_BYTES = 16, SALT_BYTES = 16, PID_BYTES = 16, KID_BYTES = 8;
  const RECOVERY_BYTES = 20, CODE_CHARS = 20;
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   /* el de crypto.js: sin I, L, O, U */
  const AAD_PREFIX = 'kanlane/v1', WRAP_PREFIX = 'kanlane/wrap/v1', RK_INFO = 'kanlane/rk/v1';
  const KCV_TEXT = 'kanlane-kcv';
  const PID_RE = /^[A-Za-z0-9_-]{22}$/;
  const KID_RE = /^[A-Za-z0-9_-]{11}$/;
  const RECOVERY_RE = /^[0-9A-HJKMNP-TV-Z]{32}$/;
  const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{20}$/;
  const MAX_FIELD = 1500;
  const MAX_PRIVATE_BYTES = 512;          /* PKCS#8 de P-256 ocupa 138; las reglas admiten 1 024 caracteres */

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', {fatal:true});

  /* ---------- utilidades ---------- */

  function fail(code, cause){
    const err = new Error('project-crypto: ' + code);
    err.name = 'ProjectCryptoError';
    err.code = code;
    if(cause) err.cause = cause;
    return err;
  }
  function isError(err, code){
    return !!err && err.name === 'ProjectCryptoError' && (code == null || err.code === code);
  }

  function subtle(){
    const s = typeof crypto !== 'undefined' && crypto && crypto.subtle;
    if(!s) throw fail('unavailable');
    return s;
  }
  function isAvailable(){
    try{ return !!subtle() && typeof crypto.getRandomValues === 'function'; }catch(e){ return false; }
  }
  function randomBytes(n){
    if(typeof crypto === 'undefined' || !crypto || typeof crypto.getRandomValues !== 'function') throw fail('unavailable');
    return crypto.getRandomValues(new Uint8Array(n));
  }

  function b64url(bytes){
    return base.b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str, length){
    if(typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) throw fail('bad-format');
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while(s.length % 4) s += '=';
    let out;
    try{ out = base.b64decode(s); }catch(e){ throw fail('bad-format', e); }
    if(length != null && out.length !== length) throw fail('bad-format');
    return out;
  }

  function validField(s){
    return typeof s === 'string' && s.length > 0 && s.length <= MAX_FIELD;
  }
  function checkCtx(ctx){
    if(!ctx || !PID_RE.test(ctx.pid) || !KID_RE.test(ctx.kid) || !validField(ctx.uid)) throw fail('bad-format');
  }

  /* ---------- identificadores y DEK ---------- */

  function newDekBytes(){ return randomBytes(DEK_BYTES); }
  function newPid(){ return b64url(randomBytes(PID_BYTES)); }
  function newKid(){ return b64url(randomBytes(KID_BYTES)); }

  function isKey(key){
    return !!key && typeof key === 'object' && key.type === 'secret' && !!key.algorithm && Array.isArray(key.usages);
  }
  function isAesKey(key){
    return isKey(key) && key.algorithm.name === 'AES-GCM' && key.algorithm.length === 256;
  }
  /* Clave para cifrar datos: AES-GCM 256 y NO extraíble. */
  function assertDataKey(key){
    if(!isAesKey(key)) throw fail('bad-key');
    if(key.extractable !== false) throw fail('extractable-key');
  }

  /* Bytes en claro de la DEK para (re)envolverla: un Uint8Array(32) o una CryptoKey extraíble
     (la que devuelve unwrap…(…, true) al cambiar la contraseña o aceptar un código).
     own = true si la copia es nuestra y hay que borrarla al terminar. */
  async function dekBytes(dek){
    if(dek instanceof Uint8Array){
      if(dek.length !== DEK_BYTES) throw fail('bad-key');
      return {bytes:dek, own:false};
    }
    if(isAesKey(dek) && dek.extractable === true){
      return {bytes:new Uint8Array(await subtle().exportKey('raw', dek)), own:true};
    }
    throw fail('bad-key');
  }

  /* importDek(raw, extractable) → CryptoKey AES-GCM 256 (usos encrypt/decrypt), no extraíble por defecto.
     extractable = true solo para volver a envolverla; las funciones de datos la rechazan.
     También acepta una CryptoKey extraíble y devuelve una copia (no extraíble salvo que se pida). */
  async function importDek(raw, extractable){
    const src = await dekBytes(raw);
    try{
      return await subtle().importKey('raw', src.bytes, {name:'AES-GCM', length:256}, extractable === true, ['encrypt', 'decrypt']);
    }finally{
      if(src.own) src.bytes.fill(0);
    }
  }

  /* ---------- AES-GCM ---------- */

  async function gcmSeal(key, plain, aadBytes){
    const iv = randomBytes(IV_BYTES);
    const ct = new Uint8Array(await subtle().encrypt({name:'AES-GCM', iv:iv, additionalData:aadBytes, tagLength:128}, key, plain));
    const out = new Uint8Array(IV_BYTES + ct.length);
    out.set(iv, 0);
    out.set(ct, IV_BYTES);
    return out;
  }
  async function gcmOpen(key, blob, aadBytes){
    try{
      return new Uint8Array(await subtle().decrypt({name:'AES-GCM', iv:blob.subarray(0, IV_BYTES), additionalData:aadBytes, tagLength:128}, key, blob.subarray(IV_BYTES)));
    }catch(e){
      throw fail('undecryptable', e);
    }
  }
  function parseBlob(e){
    const blob = fromB64url(e);
    if(blob.length < IV_BYTES + TAG_BYTES) throw fail('bad-format');
    return blob;
  }

  /* ---------- AAD ---------- */

  /* aad({pid, kid, path, id, ev}) → bytes UTF-8 de «kanlane/v1|pid|kid|ruta|id|ev».
     pid y kid tienen longitud y alfabeto fijos, la ruta no admite «|» y ev va al final:
     así la cadena no es ambigua aunque el id contenga «|». Un ev no admitido es 'bad-format'. */
  function aad(parts){
    const p = parts || {};
    if(!PID_RE.test(p.pid) || !KID_RE.test(p.kid)) throw fail('bad-format');
    if(!validField(p.path) || p.path.indexOf('|') !== -1) throw fail('bad-format');
    if(!validField(p.id)) throw fail('bad-format');
    if(!Number.isInteger(p.ev) || SUPPORTED_EV.indexOf(p.ev) === -1) throw fail('bad-format');
    return enc.encode([AAD_PREFIX, p.pid, p.kid, p.path, p.id, p.ev].join('|'));
  }
  function toAad(value){
    return value instanceof Uint8Array ? value : aad(value);
  }

  /* ---------- datos ---------- */

  /* seal(key, aad, obj) → e. aad es el resultado de aad() o el objeto {pid, kid, path, id, ev}. */
  async function seal(key, aadValue, obj){
    assertDataKey(key);
    const aadBytes = toAad(aadValue);
    const json = JSON.stringify(obj);
    if(typeof json !== 'string') throw fail('bad-format');
    return b64url(await gcmSeal(key, enc.encode(json), aadBytes));
  }
  async function open(key, aadValue, e){
    assertDataKey(key);
    const aadBytes = toAad(aadValue);
    const plain = await gcmOpen(key, parseBlob(e), aadBytes);
    try{ return JSON.parse(dec.decode(plain)); }
    catch(err){ throw fail('bad-format', err); }
  }
  async function sealBytes(key, aadValue, bytes){
    assertDataKey(key);
    if(!(bytes instanceof Uint8Array)) throw fail('bad-format');
    return b64url(await gcmSeal(key, bytes, toAad(aadValue)));
  }
  async function openBytes(key, aadValue, e){
    assertDataKey(key);
    const aadBytes = toAad(aadValue);
    return gcmOpen(key, parseBlob(e), aadBytes);
  }
  /* Firma de caché: los 16 primeros caracteres de e son el IV (12 bytes) en base64url. */
  function ivOf(e){
    return typeof e === 'string' && /^[A-Za-z0-9_-]{16}/.test(e) ? e.slice(0, 16) : null;
  }

  /* ---------- kcv ---------- */

  function kcvAad(pid, kid){
    if(!PID_RE.test(pid) || !KID_RE.test(kid)) throw fail('bad-format');
    return enc.encode('kcv|' + pid + '|' + kid);
  }
  /* kcv(key, pid, kid) → base64url(iv ‖ AES-GCM(«kanlane-kcv», AAD «kcv|pid|kid»)). */
  async function kcv(key, pid, kid){
    assertDataKey(key);
    return b64url(await gcmSeal(key, enc.encode(KCV_TEXT), kcvAad(pid, kid)));
  }
  /* true solo si la clave es la del proyecto y la versión (kid) indicada. */
  async function checkKcv(key, pid, kid, value){
    assertDataKey(key);
    try{
      const plain = await gcmOpen(key, parseBlob(value), kcvAad(pid, kid));
      return dec.decode(plain) === KCV_TEXT;
    }catch(e){
      return false;
    }
  }

  /* ---------- envoltorios ---------- */

  function wrapAad(type, ctx){
    return enc.encode([WRAP_PREFIX, type, ctx.pid, ctx.kid, ctx.uid].join('|'));
  }
  async function wrapWith(kek, dek, type, ctx){
    const src = await dekBytes(dek);
    try{
      const blob = await gcmSeal(kek, src.bytes, wrapAad(type, ctx));
      return {iv:b64url(blob.subarray(0, IV_BYTES)), ct:b64url(blob.subarray(IV_BYTES))};
    }finally{
      if(src.own) src.bytes.fill(0);
    }
  }
  async function unwrapWith(kek, wrap, type, ctx, extractable, code){
    const iv = fromB64url(wrap && wrap.iv, IV_BYTES);
    const ct = fromB64url(wrap && wrap.ct, DEK_BYTES + TAG_BYTES);
    try{
      return await subtle().unwrapKey('raw', ct, kek,
        {name:'AES-GCM', iv:iv, additionalData:wrapAad(type, ctx), tagLength:128},
        {name:'AES-GCM', length:256}, extractable === true, ['encrypt', 'decrypt']);
    }catch(e){
      throw fail(code, e);
    }
  }

  /* NFC: la misma contraseña con tildes escrita en otro sistema (macOS usa NFD) da la misma clave. */
  function normalizePassword(password){
    return String(password == null ? '' : password).normalize('NFC');
  }
  async function pbkdf2Kek(secret, salt, iterations, usages){
    const s = subtle();
    const baseKey = await s.importKey('raw', enc.encode(secret), {name:'PBKDF2'}, false, ['deriveKey']);
    return s.deriveKey({name:'PBKDF2', hash:'SHA-256', salt:salt, iterations:iterations},
      baseKey, {name:'AES-GCM', length:256}, false, usages || ['encrypt', 'unwrapKey']);
  }

  /* wrapPassword(dek, contraseña, {pid, kid, uid}, priv) → {kdf, pw} (y priv si se pasa).
     dek: Uint8Array(32) o CryptoKey extraíble. priv (opcional): la clave privada del miembro (PKCS#8,
     ver newKeyPair), que se envuelve con la misma clave derivada de la contraseña.
     Rechaza contraseñas de menos de 12 caracteres ('short-password'). */
  async function wrapPassword(dek, password, ctx, priv){
    checkCtx(ctx);
    const pw = normalizePassword(password);
    if(Array.from(pw).length < MIN_PASSWORD_LENGTH) throw fail('short-password');
    if(priv != null && !(priv instanceof Uint8Array && priv.length > 0 && priv.length <= MAX_PRIVATE_BYTES)) throw fail('bad-format');
    const salt = randomBytes(SALT_BYTES);
    const kek = await pbkdf2Kek(pw, salt, KDF_ITERATIONS);
    const out = {
      kdf:{name:'PBKDF2', hash:'SHA-256', iter:KDF_ITERATIONS, salt:b64url(salt)},
      pw:await wrapWith(kek, dek, 'pw', ctx)
    };
    if(priv != null){
      const blob = await gcmSeal(kek, priv, wrapAad('priv', ctx));
      out.priv = {iv:b64url(blob.subarray(0, IV_BYTES)), ct:b64url(blob.subarray(IV_BYTES))};
    }
    return out;
  }
  /* unwrapPassword(doc, contraseña, ctx, extractable) → CryptoKey. doc es crypto/{uid} (o {kdf, pw}).
     Respeta doc.kdf.iter (entre 600 000 y 10 000 000; fuera de ahí, 'bad-format'). */
  async function unwrapPassword(doc, password, ctx, extractable){
    checkCtx(ctx);
    const kdf = doc && doc.kdf;
    if(!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iter) ||
       kdf.iter < MIN_KDF_ITERATIONS || kdf.iter > MAX_KDF_ITERATIONS || !doc.pw) throw fail('bad-format');
    const salt = fromB64url(kdf.salt, SALT_BYTES);
    fromB64url(doc.pw.iv, IV_BYTES);
    fromB64url(doc.pw.ct, DEK_BYTES + TAG_BYTES);
    const pw = normalizePassword(password);
    if(!pw) throw fail('bad-password');   /* algunos navegadores no admiten PBKDF2 con clave vacía */
    const kek = await pbkdf2Kek(pw, salt, kdf.iter);
    return unwrapWith(kek, doc.pw, 'pw', ctx, extractable, 'bad-password');
  }

  /* Par de claves de un miembro de un equipo cifrado (D9): ECDH P-256. La pública se publica en su
     crypto/{uid} y la privada se guarda envuelta con su contraseña, para que una rotación de la clave
     del proyecto (PR10) pueda entregarle la clave nueva sin un código de acceso.
     newKeyPair() → {pub:{kty, crv, x, y}, priv:Uint8Array (PKCS#8)}. */
  async function newKeyPair(){
    const s = subtle();
    const pair = await s.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveKey']);
    const jwk = await s.exportKey('jwk', pair.publicKey);
    return {pub:{kty:jwk.kty, crv:jwk.crv, x:jwk.x, y:jwk.y}, priv:new Uint8Array(await s.exportKey('pkcs8', pair.privateKey))};
  }
  /* unwrapPrivate(doc, contraseña, ctx) → Uint8Array (PKCS#8) de doc.priv ('bad-password' si no abre). */
  async function unwrapPrivate(doc, password, ctx){
    checkCtx(ctx);
    const kdf = doc && doc.kdf;
    if(!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iter) ||
       kdf.iter < MIN_KDF_ITERATIONS || kdf.iter > MAX_KDF_ITERATIONS || !doc.priv) throw fail('bad-format');
    const salt = fromB64url(kdf.salt, SALT_BYTES);
    const iv = fromB64url(doc.priv.iv, IV_BYTES);
    const ct = fromB64url(doc.priv.ct);
    if(ct.length <= TAG_BYTES || ct.length > MAX_PRIVATE_BYTES + TAG_BYTES) throw fail('bad-format');
    const pw = normalizePassword(password);
    if(!pw) throw fail('bad-password');
    const kek = await pbkdf2Kek(pw, salt, kdf.iter, ['decrypt']);
    try{
      return new Uint8Array(await subtle().decrypt({name:'AES-GCM', iv:iv, additionalData:wrapAad('priv', ctx), tagLength:128}, kek, ct));
    }catch(e){
      throw fail('bad-password', e);
    }
  }

  /* Clave de recuperación: 160 bits en base32 legible, 8 grupos de 4 (XXXX-XXXX-…). */
  function newRecoveryKey(){
    const bytes = randomBytes(RECOVERY_BYTES);
    return {bytes:bytes, text:base.formatRecoveryKey(bytes)};
  }
  function cleanBase32(text){
    return String(text == null ? '' : text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  }
  /* Tolera minúsculas, espacios, guiones y O/I/L en lugar de 0/1/1. null si no es una clave válida. */
  function parseRecoveryKey(text){
    const clean = cleanBase32(text);
    if(!RECOVERY_RE.test(clean)) return null;
    const bytes = base.base32Decode(clean);
    return bytes.length === RECOVERY_BYTES ? bytes : null;
  }
  async function recoveryKek(bytes, pid){
    const s = subtle();
    const ikm = await s.importKey('raw', bytes, {name:'HKDF'}, false, ['deriveKey']);
    return s.deriveKey({name:'HKDF', hash:'SHA-256', salt:fromB64url(pid, PID_BYTES), info:enc.encode(RK_INFO)},
      ikm, {name:'AES-GCM', length:256}, false, ['encrypt', 'unwrapKey']);
  }
  function recoveryBytes(value){
    if(value instanceof Uint8Array) return value.length === RECOVERY_BYTES ? value : null;
    if(typeof value === 'string') return parseRecoveryKey(value);
    return null;
  }
  /* wrapRecovery(dek, clave, ctx) → {rk}. La clave puede ser los bytes o el texto. */
  async function wrapRecovery(dek, recovery, ctx){
    checkCtx(ctx);
    const bytes = recoveryBytes(recovery);
    if(!bytes) throw fail('bad-format');
    return {rk:await wrapWith(await recoveryKek(bytes, ctx.pid), dek, 'rk', ctx)};
  }
  /* unwrapRecovery(doc, clave, ctx, extractable) → CryptoKey ('bad-recovery' si no abre). */
  async function unwrapRecovery(doc, recovery, ctx, extractable){
    checkCtx(ctx);
    if(!doc || !doc.rk) throw fail('bad-format');
    fromB64url(doc.rk.iv, IV_BYTES);
    fromB64url(doc.rk.ct, DEK_BYTES + TAG_BYTES);
    const bytes = recoveryBytes(recovery);
    if(!bytes) throw fail('bad-recovery');
    return unwrapWith(await recoveryKek(bytes, ctx.pid), doc.rk, 'rk', ctx, extractable, 'bad-recovery');
  }

  /* Modo gestionado (apartado 12 del plan): la clave que envuelve la DEK la da el Worker de Kanlane
     (32 bytes, derivados de su secreto para esta cuenta, este proyecto y esta clave). Los bytes
     recibidos se borran al importarlos. */
  async function managedKek(kek){
    if(!(kek instanceof Uint8Array) || kek.length !== DEK_BYTES) throw fail('bad-format');
    try{
      return await subtle().importKey('raw', kek, {name:'AES-GCM', length:256}, false, ['encrypt', 'unwrapKey']);
    }finally{
      kek.fill(0);
    }
  }
  /* wrapManaged(dek, kek, ctx, kmsv) → {kms:{iv, ct, kmsv}}. kmsv es la versión del secreto del Worker. */
  async function wrapManaged(dek, kek, ctx, kmsv){
    checkCtx(ctx);
    if(!Number.isInteger(kmsv) || kmsv < 1) throw fail('bad-format');
    const w = await wrapWith(await managedKek(kek), dek, 'kms', ctx);
    return {kms:{iv:w.iv, ct:w.ct, kmsv:kmsv}};
  }
  /* unwrapManaged(doc, kek, ctx, extractable) → CryptoKey ('bad-kms' si no abre). */
  async function unwrapManaged(doc, kek, ctx, extractable){
    checkCtx(ctx);
    if(!doc || !doc.kms) throw fail('bad-format');
    fromB64url(doc.kms.iv, IV_BYTES);
    fromB64url(doc.kms.ct, DEK_BYTES + TAG_BYTES);
    return unwrapWith(await managedKek(kek), doc.kms, 'kms', ctx, extractable, 'bad-kms');
  }

  /* Código de acceso de las invitaciones (D1): 20 símbolos base32 = 100 bits, 5 grupos de 4.
     256 es múltiplo de 32, así que «byte & 31» da símbolos uniformes. */
  function newAccessCode(){
    const bytes = randomBytes(CODE_CHARS);
    let out = '';
    for(let i = 0; i < CODE_CHARS; i++){ out += ALPHABET[bytes[i] & 31]; }
    bytes.fill(0);
    return {text:out.match(/.{4}/g).join('-')};
  }
  /* Código normalizado (20 símbolos sin guiones) o null. */
  function parseAccessCode(text){
    const clean = cleanBase32(text);
    return CODE_RE.test(clean) ? clean : null;
  }
  /* wrapCode(dek, código, ctx) → {salt, iter, iv, ct}. */
  async function wrapCode(dek, code, ctx){
    checkCtx(ctx);
    const clean = parseAccessCode(code);
    if(!clean) throw fail('bad-format');
    const salt = randomBytes(SALT_BYTES);
    const wrapped = await wrapWith(await pbkdf2Kek(clean, salt, CODE_ITERATIONS), dek, 'code', ctx);
    return {salt:b64url(salt), iter:CODE_ITERATIONS, iv:wrapped.iv, ct:wrapped.ct};
  }
  /* unwrapCode(wrap, código, ctx, extractable) → CryptoKey ('bad-code' si no abre). */
  async function unwrapCode(wrap, code, ctx, extractable){
    checkCtx(ctx);
    if(!wrap || !Number.isInteger(wrap.iter) || wrap.iter < CODE_ITERATIONS || wrap.iter > MAX_KDF_ITERATIONS) throw fail('bad-format');
    const salt = fromB64url(wrap.salt, SALT_BYTES);
    fromB64url(wrap.iv, IV_BYTES);
    fromB64url(wrap.ct, DEK_BYTES + TAG_BYTES);
    const clean = parseAccessCode(code);
    if(!clean) throw fail('bad-code');
    return unwrapWith(await pbkdf2Kek(clean, salt, wrap.iter), wrap, 'code', ctx, extractable, 'bad-code');
  }

  /* ---------- comprobación de la contraseña (D16) ---------- */

  /* Lista corta de contraseñas y palabras muy usadas (minúsculas y sin tildes). No es exhaustiva:
     solo atrapa lo más obvio sin depender de ninguna biblioteca. */
  const COMMON = ('password passw0rd p4ssword contrasena contrasenya clave secreto secreta ' +
    'qwerty qwertz azerty asdfgh zxcvbn 123456 1234567 12345678 123456789 1234567890 0123456789 ' +
    '111111 000000 121212 123123 654321 696969 112233 abc123 a1b2c3 1q2w3e 1qaz2wsx qazwsx ' +
    'admin administrador administrator root toor user usuario guest invitado login acceso entrar ' +
    'welcome bienvenido bienvenida hello hola letmein iloveyou teamo tequiero tekiero ' +
    'monkey dragon master shadow sunshine princess princesa football futbol baseball soccer ' +
    'superman batman spiderman starwars pokemon naruto goku minecraft fortnite roblox ' +
    'michael jennifer charlie jordan thomas daniel andrea carlos javier alejandro maria ' +
    'jose manuel antonio francisco david laura marta lucia sofia paula carmen pedro pablo ' +
    'trustno1 whatever freedom mustang secret computer internet google facebook instagram ' +
    'samsung iphone apple microsoft windows linux ubuntu summer winter spring autumn ' +
    'verano invierno primavera otono enero febrero marzo abril mayo junio julio agosto ' +
    'septiembre octubre noviembre diciembre lunes martes miercoles jueves viernes sabado domingo ' +
    'barcelona barca realmadrid madrid atletico sevilla betis valencia bilbao athletic ' +
    'espana spain mexico argentina colombia chile peru venezuela ' +
    'amor amorcito mivida corazon carino familia hijos mama papa abuela abuelo ' +
    'dios jesus cristo angel angela estrella mariposa chocolate tesoro gatito perrito ' +
    'cerveza playa luna fuego agua tierra cielo ' +
    'kanlane workhub cifrado proyecto proyectos seguridad seguro privado privada ' +
    'changeme cambiame default temporal temp test prueba pruebas demo ejemplo ' +
    'loveyou lovely love killer hunter ranger buster hockey tigger ginger ' +
    'pepper cheese banana orange purple yellow silver golden diamond').split(/\s+/)
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length);

  const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const LEET = {'0':'o', '1':'i', '3':'e', '4':'a', '5':'s', '7':'t', '8':'b', '@':'a', '$':'s', '!':'i', '+':'t'};

  function fold(s){
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function squash(s){ return fold(s).replace(/[^a-z0-9]/g, ''); }

  /* Quita repeticiones («aaa», «abab») y secuencias de 4 o más («1234», «qwer», «dcba»). */
  function stripPatterns(s){
    let out = s.replace(/(.)\1{2,}/g, '').replace(/(.{2,4})\1+/g, '$1');
    SEQUENCES.forEach((seq) => {
      [seq, seq.split('').reverse().join('')].forEach((src) => {
        for(let len = src.length; len >= 4; len--){
          for(let i = 0; i + len <= src.length; i++){
            const piece = src.slice(i, i + len);
            if(out.indexOf(piece) !== -1) out = out.split(piece).join('');
          }
        }
      });
    });
    return out;
  }
  function deleet(s){ return s.replace(/[0134578@$!+]/g, (c) => LEET[c]); }

  /* Caracteres «que aportan» tras quitar repeticiones, secuencias, separadores y palabras comunes. */
  function effectiveLength(pw){
    let rest = deleet(stripPatterns(fold(pw)));
    COMMON.forEach((w) => { if(rest.indexOf(w) !== -1) rest = rest.split(w).join(''); });
    rest = stripPatterns(rest.replace(/[^a-z0-9ñ]/g, ''));
    return Array.from(rest).length;
  }
  function personalTokens(info){
    const out = [];
    const email = info && typeof info.email === 'string' ? info.email.trim() : '';
    if(email){
      out.push(squash(email));
      const local = email.split('@')[0];
      out.push(squash(local));
      local.split(/[._+-]+/).forEach((part) => out.push(squash(part)));
    }
    const name = info && typeof info.projectName === 'string' ? info.projectName : '';
    if(name){
      out.push(squash(name));
      name.split(/\s+/).forEach((part) => out.push(squash(part)));
    }
    return out.filter((t) => t.length >= 4);
  }
  function charClasses(pw){
    let n = 0;
    if(/[a-zà-ÿ]/.test(pw)) n++;
    if(/[A-ZÀ-Þ]/.test(pw)) n++;
    if(/[0-9]/.test(pw)) n++;
    if(/[^A-Za-z0-9À-ÿ]/.test(pw)) n++;
    return n;
  }

  /* Textos del medidor (apartado 8.1 del plan; traducciones en src/i18n/en.js). */
  const MESSAGES = {
    short:'Demasiado corta: mínimo 12 caracteres.',
    common:'Débil: es muy común o fácil de adivinar.',
    personal:'Débil: contiene tu correo o el nombre del proyecto.',
    fair:'Aceptable',
    good:'Buena'
  };

  /* passwordCheck(contraseña, {email, projectName}) → {ok, level, reason, message}.
     Solo bloquea (ok:false) si tiene menos de 12 caracteres; lo demás son avisos.
     level: 'short' | 'weak' | 'fair' | 'good'. reason: 'short' | 'common' | 'personal' | null. */
  function passwordCheck(password, info){
    const pw = normalizePassword(password);
    const len = Array.from(pw).length;
    const result = (ok, level, reason, key) => ({ok:ok, level:level, reason:reason, message:MESSAGES[key]});
    if(len < MIN_PASSWORD_LENGTH) return result(false, 'short', 'short', 'short');
    const flat = squash(pw);
    if(personalTokens(info).some((t) => flat.indexOf(t) !== -1)) return result(true, 'weak', 'personal', 'personal');
    if(effectiveLength(pw) < 8 || new Set(Array.from(fold(pw))).size < 5) return result(true, 'weak', 'common', 'common');
    if(charClasses(pw) < 3 && len < 16) return result(true, 'weak', 'common', 'common');
    return len >= 16 ? result(true, 'good', null, 'good') : result(true, 'fair', null, 'fair');
  }

  Workhub.services.projectCrypto = Object.freeze({
    VERSION, EV, SUPPORTED_EV, KDF_ITERATIONS, MIN_KDF_ITERATIONS, MAX_KDF_ITERATIONS, CODE_ITERATIONS, MIN_PASSWORD_LENGTH,
    isAvailable, isError,
    newDekBytes, newPid, newKid, importDek,
    kcv, checkKcv,
    wrapPassword, unwrapPassword,
    newKeyPair, unwrapPrivate,
    newRecoveryKey, parseRecoveryKey, wrapRecovery, unwrapRecovery,
    wrapManaged, unwrapManaged,
    newAccessCode, parseAccessCode, wrapCode, unwrapCode,
    aad, seal, open, ivOf, sealBytes, openBytes,
    passwordCheck,
    b64url, fromB64url
  });
})();
