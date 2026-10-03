/* Pruebas de src/services/project-crypto.js con Web Crypto real de Node (sin navegador).
   Plan: docs/CIFRADO-PROYECTOS.md, 14.1. Uso: node tests/crypto/project-crypto.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SOURCES = ['src/services/crypto.js', 'src/services/project-crypto.js'];

/* Carga crypto.js y project-crypto.js con el objeto crypto indicado (el real o uno determinista). */
function load(cryptoImpl){
  const Workhub = {services:{}};
  const window = {crypto:cryptoImpl};
  SOURCES.forEach((rel) => new Function('Workhub', 'window', 'crypto', read(rel))(Workhub, window, cryptoImpl));
  return Workhub.services.projectCrypto;
}

/* Generador determinista SOLO para fijar vectores: se inyecta como crypto.getRandomValues en una
   carga aparte del archivo. El servicio no tiene ninguna API para elegir sal o IV. */
function deterministicCrypto(seed){
  let n = seed >>> 0;
  return {
    subtle:globalThis.crypto.subtle,
    getRandomValues(arr){
      for(let i = 0; i < arr.length; i++){ n = (Math.imul(n, 1103515245) + 12345) >>> 0; arr[i] = n >>> 24; }
      return arr;
    }
  };
}

const PC = load(globalThis.crypto);
const ok = (msg) => console.log('OK   ' + msg);
const code = (c) => (err) => { assert.equal(err && err.name, 'ProjectCryptoError', 'error tipado: ' + (err && err.message)); assert.equal(err.code, c); return true; };
const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function newProject(){
  const pid = PC.newPid();
  const kid = PC.newKid();
  const raw = PC.newDekBytes();
  const key = await PC.importDek(raw);
  return {pid, kid, raw, key, ctx:{pid, kid, uid:'uid-ana'}};
}

/* Vector fijo (semilla 20261003). Si cambia, se ha roto la compatibilidad con lo ya cifrado. */
const VECTOR = {
  pid: 'XEvXd2NoDqiZf79IEDbxpg',
  kid: '8L9gd-FreXQ',
  dek: 'P7alI0yl7elI28FIHaxv2AUnmmJj2rgxqbhlfgp7FYU',
  recovery: 'A9HQ-FD11-325F-MSSR-80EX-FBS8-PYRZ-EYSD',
  wrap: {
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iter: 600000,
      salt: 'I-KQvBV0h4YeEK0mCOX5Nw'
    },
    pw: {
      iv: 'DGKW57QsWGkUyaPw',
      ct: 'lmSl9WaxQ0QM2uknV0ho3kvN9yoFQsvGqWLcPlvqHKuCjPZYIbQxbCboWhISwKo4'
    }
  },
  rk: {
    iv: 'wgoKgq7jt8jjPHCz',
    ct: '9bguA1mnap6FsNBUcpN2nF1eQ459cnTAnssIwTBzvBQCQuRsad7J-3is0Q5si8iy'
  },
  code: {
    salt: 'uN2xkf-VOfRCORKAEwHYfA',
    iter: 100000,
    iv: 'BY7Wysd2OZiPMnTy',
    ct: 'LPLSw-3eA8CbctxsuJ1tg6CRX120qmCrLpHv_Iyr1z9zyW59Qy2UYty5oK7Ukyvu'
  },
  e: 'sNeW_x7VG5k7yo-QT6B1YddGEeeT5FWTbed2dI8mhbg0qFdJ05ckO3sn-1IXDIEIEL8O3qkGWzFP',
  kcv: 'IwwNsVd7XYGDzUEm2BMLuud8s_xDbYkYgLAdjeY09GntjfzbqT7e'
};

(async () => {
  /* ---------- constantes e identificadores ---------- */
  assert.equal(PC.KDF_ITERATIONS, 600000);
  assert.equal(PC.MIN_KDF_ITERATIONS, 600000);
  assert.equal(PC.CODE_ITERATIONS, 100000);
  assert.equal(PC.EV, 1);
  assert.equal(PC.VERSION, 1);
  assert.equal(PC.MIN_PASSWORD_LENGTH, 12);
  assert.ok(PC.isAvailable());
  assert.ok(Object.isFrozen(PC), 'la API no se puede modificar desde fuera');
  const deks = new Set();
  for(let i = 0; i < 200; i++){
    const raw = PC.newDekBytes();
    assert.ok(raw instanceof Uint8Array && raw.length === 32);
    deks.add(Buffer.from(raw).toString('hex'));
  }
  assert.equal(deks.size, 200, 'una DEK distinta en cada llamada');
  assert.match(PC.newPid(), /^[A-Za-z0-9_-]{22}$/);
  assert.match(PC.newKid(), /^[A-Za-z0-9_-]{11}$/);
  ok('DEK de 256 bits distinta en cada llamada; pid de 22 y kid de 11 caracteres');

  /* ---------- AAD ---------- */
  const p = await newProject();
  const parts = {pid:p.pid, kid:p.kid, path:'tasks', id:'t1', ev:1};
  assert.equal(new TextDecoder().decode(PC.aad(parts)), 'kanlane/v1|' + p.pid + '|' + p.kid + '|tasks|t1|1');
  assert.equal(new TextDecoder().decode(PC.aad({...parts, path:'tasks/t1/notes', id:'n|1'})), 'kanlane/v1|' + p.pid + '|' + p.kid + '|tasks/t1/notes|n|1|1');
  assert.throws(() => PC.aad({...parts, path:'tas|ks'}), code('bad-format'));
  assert.throws(() => PC.aad({...parts, pid:'corto'}), code('bad-format'));
  assert.throws(() => PC.aad({...parts, ev:2}), code('bad-format'));
  assert.throws(() => PC.aad({...parts, id:''}), code('bad-format'));
  ok('AAD con el formato exacto kanlane/v1|pid|kid|ruta|id|ev');

  /* ---------- seal / open ---------- */
  const samples = [
    {title:'Reunión con el cliente: año, niño, acentos ¿qué? ¡sí!', desc:'Línea 1\nLínea 2'},
    {title:'Emojis \u{1F600}\u{1F680} y símbolos ✓ ★', labels:['urgente', 'diseño']},
    {desc:'x'.repeat(20000)},
    {a:{b:{c:[1, 2, {d:'profundo', e:null, f:true}]}}, n:3.5},
    'texto suelto', 0, null, []
  ];
  for(const obj of samples){
    const e = await PC.seal(p.key, parts, obj);
    assert.match(e, /^[A-Za-z0-9_-]+$/, 'base64url sin relleno');
    assert.deepEqual(await PC.open(p.key, parts, e), obj);
    assert.deepEqual(await PC.open(p.key, PC.aad(parts), e), obj, 'acepta también los bytes de aad()');
  }
  await assert.rejects(PC.seal(p.key, parts, undefined), code('bad-format'));
  ok('seal/open ida y vuelta: español, emojis, 20 000 caracteres y objetos anidados');

  const e1 = await PC.seal(p.key, parts, {title:'secreto'});
  const other = await newProject();
  for(const change of [{pid:other.pid}, {kid:other.kid}, {path:'clients'}, {path:'tasks/t1/notes'}, {id:'t2'}]){
    await assert.rejects(PC.open(p.key, {...parts, ...change}, e1), code('undecryptable'), 'AAD cambiada: ' + JSON.stringify(change));
  }
  await assert.rejects(PC.open(p.key, {...parts, ev:2}, e1), code('bad-format'), 'ev desconocido');
  await assert.rejects(PC.open(other.key, parts, e1), code('undecryptable'), 'otra DEK');
  const blob = Buffer.from(e1, 'base64url');
  for(const pos of [0, 12, blob.length - 20, blob.length - 1]){
    const bad = Buffer.from(blob);
    bad[pos] ^= 1;
    await assert.rejects(PC.open(p.key, parts, b64u(bad)), code('undecryptable'), 'un bit cambiado en la posición ' + pos);
  }
  await assert.rejects(PC.open(p.key, parts, b64u(blob.subarray(0, 27))), code('bad-format'), 'blob demasiado corto');
  await assert.rejects(PC.open(p.key, parts, 'no es base64url!'), code('bad-format'));
  await assert.rejects(PC.open(p.key, parts, 12), code('bad-format'));
  ok('AAD manipulada (pid, kid, ruta, id), otra DEK o un bit cambiado → undecryptable; ev o formato desconocido → bad-format');

  /* Bytes (imágenes) */
  const jpeg = nodeCrypto.randomBytes(5000);
  const imgParts = {...parts, path:'assets', id:'img1'};
  const eImg = await PC.sealBytes(p.key, imgParts, new Uint8Array(jpeg));
  assert.deepEqual(Buffer.from(await PC.openBytes(p.key, imgParts, eImg)), jpeg);
  await assert.rejects(PC.openBytes(p.key, {...imgParts, id:'img2'}, eImg), code('undecryptable'));
  await assert.rejects(PC.sealBytes(p.key, imgParts, 'texto'), code('bad-format'));
  assert.equal(eImg.length, Math.ceil((jpeg.length + 28) * 4 / 3), 'IV y etiqueta añaden 28 bytes');
  ok('sealBytes/openBytes: ida y vuelta de 5 000 bytes y AAD comprobada');

  /* ---------- IV único ---------- */
  const ivs = new Set();
  const blobs = new Set();
  for(let i = 0; i < 10000; i++){
    const e = await PC.seal(p.key, parts, {title:'igual'});
    const iv = PC.ivOf(e);
    assert.equal(iv, b64u(Buffer.from(e, 'base64url').subarray(0, 12)), 'ivOf = 12 primeros bytes');
    ivs.add(iv);
    blobs.add(e);
  }
  assert.equal(ivs.size, 10000, '10 000 IV distintos');
  assert.equal(blobs.size, 10000, '10 000 blobs distintos');
  assert.equal(PC.ivOf('corto'), null);
  ok('IV aleatorio en cada escritura: 10 000 cifrados del mismo objeto, 10 000 IV y blobs distintos');

  /* ---------- kcv ---------- */
  const check = await PC.kcv(p.key, p.pid, p.kid);
  assert.equal(await PC.checkKcv(p.key, p.pid, p.kid, check), true);
  assert.equal(await PC.checkKcv(other.key, p.pid, p.kid, check), false, 'otra DEK');
  assert.equal(await PC.checkKcv(p.key, p.pid, PC.newKid(), check), false, 'otro kid');
  assert.equal(await PC.checkKcv(p.key, other.pid, p.kid, check), false, 'otro pid');
  assert.equal(await PC.checkKcv(p.key, p.pid, p.kid, 'basura'), false);
  assert.notEqual(await PC.kcv(p.key, p.pid, p.kid), check, 'cada kcv lleva su IV');
  ok('kcv: correcto con la DEK buena; falso con otra DEK, otro kid u otro pid');

  /* ---------- nada acepta una DEK extraíble ---------- */
  const loose = await PC.importDek(p.raw, true);
  assert.equal(loose.extractable, true);
  for(const [name, fn] of Object.entries({
    seal:() => PC.seal(loose, parts, {}),
    open:() => PC.open(loose, parts, e1),
    sealBytes:() => PC.sealBytes(loose, parts, new Uint8Array(1)),
    openBytes:() => PC.openBytes(loose, parts, eImg),
    kcv:() => PC.kcv(loose, p.pid, p.kid),
    checkKcv:() => PC.checkKcv(loose, p.pid, p.kid, check)
  })){
    await assert.rejects(fn(), code('extractable-key'), name + ' rechaza una DEK extraíble');
  }
  await assert.rejects(PC.seal('no es una clave', parts, {}), code('bad-key'));
  const hmac = await globalThis.crypto.subtle.generateKey({name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  await assert.rejects(PC.seal(hmac, parts, {}), code('bad-key'));
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', p.key), 'importDek por defecto no es extraíble');
  const locked = await PC.importDek(loose);
  assert.equal(locked.extractable, false, 'importDek(clave extraíble) devuelve una copia no extraíble');
  assert.deepEqual(await PC.open(locked, parts, e1), {title:'secreto'});
  await assert.rejects(PC.importDek(new Uint8Array(16)), code('bad-key'));
  await assert.rejects(PC.importDek(p.key), code('bad-key'), 'una clave no extraíble no se puede copiar');
  ok('ninguna función de datos acepta una DEK extraíble; importDek devuelve claves no extraíbles');

  /* ---------- contraseña ---------- */
  const PASS = 'caballo correcto batería grapa';
  const wrapped = await PC.wrapPassword(p.raw, PASS, p.ctx);
  assert.deepEqual(Object.keys(wrapped).sort(), ['kdf', 'pw']);
  assert.deepEqual({...wrapped.kdf, salt:undefined}, {name:'PBKDF2', hash:'SHA-256', iter:600000, salt:undefined});
  assert.equal(Buffer.from(wrapped.kdf.salt, 'base64url').length, 16, 'sal de 16 bytes');
  assert.equal(Buffer.from(wrapped.pw.iv, 'base64url').length, 12);
  assert.equal(Buffer.from(wrapped.pw.ct, 'base64url').length, 48);
  let t0 = Date.now();
  const unlocked = await PC.unwrapPassword(wrapped, PASS, p.ctx);
  const pbkdf2Ms = Date.now() - t0;
  assert.equal(unlocked.extractable, false);
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', unlocked), 'unwrapPassword devuelve una clave no extraíble');
  assert.deepEqual(await PC.open(unlocked, parts, e1), {title:'secreto'});
  assert.equal(await PC.checkKcv(unlocked, p.pid, p.kid, check), true);
  await assert.rejects(PC.unwrapPassword(wrapped, PASS + ' ', p.ctx), code('bad-password'));
  await assert.rejects(PC.unwrapPassword(wrapped, '', p.ctx), code('bad-password'), 'contraseña vacía');
  await assert.rejects(PC.unwrapPassword(wrapped, PASS, {...p.ctx, uid:'uid-otra'}), code('bad-password'), 'envoltorio de otra persona');
  await assert.rejects(PC.unwrapPassword(wrapped, PASS, {...p.ctx, pid:other.pid}), code('bad-password'), 'envoltorio de otro proyecto');
  await assert.rejects(PC.unwrapPassword(wrapped, PASS, {...p.ctx, kid:other.kid}), code('bad-password'), 'envoltorio de otra clave');
  await assert.rejects(PC.unwrapPassword({...wrapped, kdf:{...wrapped.kdf, iter:600001}}, PASS, p.ctx), code('bad-password'), 'iter se respeta');
  await assert.rejects(PC.unwrapPassword({...wrapped, kdf:{...wrapped.kdf, iter:1000}}, PASS, p.ctx), code('bad-format'), 'iter por debajo del mínimo');
  await assert.rejects(PC.unwrapPassword({...wrapped, kdf:{...wrapped.kdf, iter:1e9}}, PASS, p.ctx), code('bad-format'), 'iter absurdo');
  await assert.rejects(PC.unwrapPassword({...wrapped, kdf:{...wrapped.kdf, name:'Argon2id'}}, PASS, p.ctx), code('bad-format'), 'KDF desconocida');
  await assert.rejects(PC.unwrapPassword({kdf:wrapped.kdf}, PASS, p.ctx), code('bad-format'));
  const loosePw = await PC.unwrapPassword(wrapped, PASS, p.ctx, true);
  assert.equal(loosePw.extractable, true, 'extractable:true solo para reenvolver');
  ok('contraseña: abre con la buena; otra contraseña, uid, pid o kid → bad-password; iter respetado y acotado (PBKDF2 600 000: ' + pbkdf2Ms + ' ms)');

  await assert.rejects(PC.wrapPassword(p.raw, 'onceCaract1', p.ctx), code('short-password'), '11 caracteres');
  await assert.rejects(PC.wrapPassword(p.raw, '\u{1F600}'.repeat(11), p.ctx), code('short-password'), 'cuenta caracteres, no unidades UTF-16');
  await assert.rejects(PC.wrapPassword(p.raw, PASS, {pid:p.pid, kid:p.kid}), code('bad-format'), 'sin uid');
  await assert.rejects(PC.wrapPassword(new Uint8Array(31), PASS, p.ctx), code('bad-key'));
  await assert.rejects(PC.wrapPassword(p.key, PASS, p.ctx), code('bad-key'), 'una clave no extraíble no se puede envolver');
  /* NFC: la misma contraseña con la tilde descompuesta (macOS) abre igual. */
  const nfd = 'contraseña de prueba'.normalize('NFD');
  const wNfd = await PC.wrapPassword(p.raw, nfd, p.ctx);
  assert.ok(await PC.unwrapPassword(wNfd, 'contraseña de prueba'.normalize('NFC'), p.ctx));
  ok('wrapPassword rechaza contraseñas de menos de 12 caracteres y normaliza a NFC');

  /* ---------- clave de recuperación ---------- */
  const rec = PC.newRecoveryKey();
  assert.equal(rec.bytes.length, 20, '160 bits');
  assert.match(rec.text, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/, '8 grupos de 4 sin I, L, O, U');
  assert.deepEqual(PC.parseRecoveryKey(rec.text), rec.bytes);
  assert.deepEqual(PC.parseRecoveryKey('  ' + rec.text.toLowerCase().replace(/-/g, ' ') + ' '), rec.bytes, 'minúsculas y espacios');
  const withLetters = rec.text.replace(/0/g, 'O').replace(/1/g, 'l');
  assert.deepEqual(PC.parseRecoveryKey(withLetters), rec.bytes, 'O por 0 y l por 1');
  assert.deepEqual(PC.parseRecoveryKey(rec.text.replace(/1/g, 'I')), rec.bytes, 'I por 1');
  assert.equal(PC.parseRecoveryKey(rec.text.slice(0, -1)), null, 'falta un carácter');
  assert.equal(PC.parseRecoveryKey(rec.text + 'A'), null, 'sobra un carácter');
  assert.equal(PC.parseRecoveryKey('U' + rec.text.slice(1)), null, 'U no está en el alfabeto');
  assert.equal(PC.parseRecoveryKey(''), null);
  assert.equal(PC.parseRecoveryKey(null), null);
  const rkWrap = await PC.wrapRecovery(p.raw, rec.bytes, p.ctx);
  assert.deepEqual(Object.keys(rkWrap), ['rk']);
  const doc = {v:1, kid:p.kid, ...wrapped, ...rkWrap};
  const byRk = await PC.unwrapRecovery(doc, rec.text, p.ctx);
  assert.equal(byRk.extractable, false);
  assert.deepEqual(await PC.open(byRk, parts, e1), {title:'secreto'});
  assert.ok(await PC.unwrapRecovery(doc, rec.bytes, p.ctx), 'acepta también los bytes');
  const wrongRec = PC.newRecoveryKey();
  await assert.rejects(PC.unwrapRecovery(doc, wrongRec.text, p.ctx), code('bad-recovery'));
  await assert.rejects(PC.unwrapRecovery(doc, 'no es una clave', p.ctx), code('bad-recovery'));
  await assert.rejects(PC.unwrapRecovery(doc, rec.text, {...p.ctx, uid:'uid-otra'}), code('bad-recovery'));
  await assert.rejects(PC.unwrapRecovery(doc, rec.text, {...p.ctx, pid:other.pid}), code('bad-recovery'));
  await assert.rejects(PC.unwrapRecovery({...doc, rk:doc.pw}, rec.text, p.ctx), code('bad-recovery'), 'un envoltorio de contraseña no abre como recuperación');
  ok('recuperación: 8 grupos de 4; tolera minúsculas, espacios y O/I/L; clave errónea → bad-recovery');

  /* Cambiar la contraseña: se abre con la vieja (extraíble solo para reenvolver) y se envuelve con la nueva. */
  const NEW_PASS = 'otra frase distinta y larga';
  const forRewrap = await PC.unwrapPassword(doc, PASS, p.ctx, true);
  const doc2 = {...doc, ...(await PC.wrapPassword(forRewrap, NEW_PASS, p.ctx))};
  await assert.rejects(PC.unwrapPassword(doc2, PASS, p.ctx), code('bad-password'), 'la contraseña vieja ya no abre');
  assert.deepEqual(await PC.open(await PC.unwrapPassword(doc2, NEW_PASS, p.ctx), parts, e1), {title:'secreto'});
  assert.deepEqual(await PC.open(await PC.unwrapRecovery(doc2, rec.text, p.ctx), parts, e1), {title:'secreto'}, 'la clave de recuperación sigue valiendo');
  /* Recuperar el acceso: clave de recuperación → contraseña nueva y clave de recuperación nueva. */
  const viaRk = await PC.unwrapRecovery(doc2, rec.text, p.ctx, true);
  const rec2 = PC.newRecoveryKey();
  const doc3 = {...doc2, ...(await PC.wrapPassword(viaRk, 'tercera contraseña bastante larga', p.ctx)), ...(await PC.wrapRecovery(viaRk, rec2.bytes, p.ctx))};
  await assert.rejects(PC.unwrapRecovery(doc3, rec.text, p.ctx), code('bad-recovery'), 'la clave de recuperación vieja deja de valer');
  assert.deepEqual(await PC.open(await PC.unwrapRecovery(doc3, rec2.text, p.ctx), parts, e1), {title:'secreto'});
  assert.deepEqual(await PC.open(await PC.unwrapPassword(doc3, 'tercera contraseña bastante larga', p.ctx), parts, e1), {title:'secreto'});
  ok('cambio de contraseña y recuperación: la clave de recuperación abre tras cambiar la contraseña; la vieja deja de valer al renovarla');

  /* ---------- código de acceso ---------- */
  const codes = new Set();
  for(let i = 0; i < 500; i++){
    const c = PC.newAccessCode().text;
    assert.match(c, /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/, '20 caracteres en 5 grupos');
    codes.add(c);
  }
  assert.equal(codes.size, 500);
  const access = PC.newAccessCode().text;
  const cw = await PC.wrapCode(p.raw, access, p.ctx);
  assert.equal(cw.iter, 100000);
  assert.deepEqual(Object.keys(cw).sort(), ['ct', 'iter', 'iv', 'salt']);
  const byCode = await PC.unwrapCode(cw, access.toLowerCase().replace(/-/g, ''), p.ctx);
  assert.equal(byCode.extractable, false);
  assert.equal(await PC.checkKcv(byCode, p.pid, p.kid, check), true);
  const flat = access.replace(/-/g, '');
  const changed = flat.slice(0, 7) + (flat[7] === 'A' ? 'B' : 'A') + flat.slice(8);
  await assert.rejects(PC.unwrapCode(cw, changed, p.ctx), code('bad-code'), 'un carácter cambiado');
  await assert.rejects(PC.unwrapCode(cw, access.slice(0, -1), p.ctx), code('bad-code'), 'código incompleto');
  await assert.rejects(PC.unwrapCode(cw, access, {...p.ctx, uid:'otra'}), code('bad-code'));
  await assert.rejects(PC.unwrapCode({...cw, iter:10}, access, p.ctx), code('bad-format'));
  await assert.rejects(PC.wrapCode(p.raw, 'ABCD', p.ctx), code('bad-format'));
  assert.equal(PC.parseAccessCode(access), flat);
  ok('código de acceso: 20 caracteres (100 bits); un carácter cambiado → bad-code');

  /* ---------- medidor de contraseña ---------- */
  const pc = (pw, info) => PC.passwordCheck(pw, info || {email:'ana.garcia@example.com', projectName:'Clínica Dental'});
  assert.deepEqual(pc('onceCaract1'), {ok:false, level:'short', reason:'short', message:'Demasiado corta: mínimo 12 caracteres.'});
  assert.equal(pc('').ok, false);
  for(const weak of ['password1234', 'contraseña123', 'Qwerty123456', 'aaaaaaaaaaaa', '123456789012', 'abcdefghijkl', 'iloveyou2026', 'P@ssw0rd2026!', 'holaholahola', 'barcelona1234']){
    const r = pc(weak);
    assert.equal(r.ok, true, 'avisa pero no bloquea: ' + weak);
    assert.equal(r.level, 'weak', weak + ' es débil');
    assert.equal(r.message, 'Débil: es muy común o fácil de adivinar.', weak);
  }
  for(const personal of ['ana.garcia@example.com!', 'anagarcia-2026-xyz', 'mi clinica dental segura', 'Garcia#Tejado#Rojo']){
    const r = pc(personal);
    assert.equal(r.reason, 'personal', personal);
    assert.equal(r.message, 'Débil: contiene tu correo o el nombre del proyecto.');
    assert.equal(r.ok, true);
  }
  assert.equal(pc('tomate azul').level, 'short');
  assert.equal(pc('solominusculas').level, 'weak', 'menos de 3 tipos y menos de 16 caracteres');
  assert.deepEqual(pc('Tr3s-Gatos!vk'), {ok:true, level:'fair', reason:null, message:'Aceptable'});
  assert.deepEqual(pc('el tejado verde de la casa vieja'), {ok:true, level:'good', reason:null, message:'Buena'});
  assert.equal(pc('caballo correcto batería grapa').level, 'good');
  assert.equal(PC.passwordCheck('frase larga sin datos personales', undefined).level, 'good', 'sin correo ni proyecto');
  const t1 = Date.now();
  for(let i = 0; i < 200; i++) PC.passwordCheck('una frase cualquiera ' + i, {email:'x@y.com', projectName:'Proyecto'});
  assert.ok(Date.now() - t1 < 2000, 'rápido para comprobar en cada pulsación');
  ok('passwordCheck: 11 caracteres bloquea; lista común, secuencias y datos personales avisan; frase larga «Buena»');

  /* ---------- textos del medidor traducidos ---------- */
  const en = read('src/i18n/en.js');
  for(const msg of ['Demasiado corta: mínimo 12 caracteres.', 'Débil: es muy común o fácil de adivinar.', 'Débil: contiene tu correo o el nombre del proyecto.', 'Aceptable', 'Buena']){
    assert.ok(en.includes("'" + msg + "'"), 'en.js traduce «' + msg + '»');
  }
  ok('los textos del medidor tienen traducción al inglés');

  /* ---------- vector fijo ---------- */
  const D = load(deterministicCrypto(20261003));
  const vpid = D.newPid(), vkid = D.newKid(), vraw = D.newDekBytes();
  const vkey = await D.importDek(vraw);
  const vctx = {pid:vpid, kid:vkid, uid:'uid-vector'};
  const vrec = D.newRecoveryKey();
  const vector = {
    pid:vpid, kid:vkid, dek:b64u(vraw), recovery:vrec.text,
    wrap:await D.wrapPassword(vraw, 'contraseña de vector fija', vctx),
    rk:(await D.wrapRecovery(vraw, vrec.bytes, vctx)).rk,
    code:await D.wrapCode(vraw, 'ABCD-EFGH-JKMN-PQRS-TVWX', vctx),
    e:await D.seal(vkey, {pid:vpid, kid:vkid, path:'tasks', id:'t1', ev:1}, {title:'Hola, mundo', n:1}),
    kcv:await D.kcv(vkey, vpid, vkid)
  };
  if(!VECTOR){
    console.log('VECTOR = ' + JSON.stringify(vector));
    throw new Error('Falta fijar VECTOR en la prueba');
  }
  assert.deepEqual(vector, VECTOR, 'el formato no ha cambiado');
  /* El vector se abre con el servicio normal (aleatorio)… */
  const vdoc = {...VECTOR.wrap, rk:VECTOR.rk};
  const vk = await PC.unwrapPassword(vdoc, 'contraseña de vector fija', vctx);
  assert.deepEqual(await PC.open(vk, {pid:vpid, kid:vkid, path:'tasks', id:'t1', ev:1}, VECTOR.e), {title:'Hola, mundo', n:1});
  assert.equal(await PC.checkKcv(await PC.unwrapRecovery(vdoc, VECTOR.recovery, vctx), vpid, vkid, VECTOR.kcv), true);
  assert.equal(await PC.checkKcv(await PC.unwrapCode(VECTOR.code, 'abcd efgh jkmn pqrs tvwx', vctx), vpid, vkid, VECTOR.kcv), true);
  /* …y con node:crypto, sin el servicio: documenta el formato byte a byte. */
  const dekBuf = Buffer.from(VECTOR.dek, 'base64url');
  const gcmOpen = (keyBuf, blobBuf, aadStr) => {
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, blobBuf.subarray(0, 12));
    d.setAAD(Buffer.from(aadStr, 'utf8'));
    d.setAuthTag(blobBuf.subarray(blobBuf.length - 16));
    return Buffer.concat([d.update(blobBuf.subarray(12, blobBuf.length - 16)), d.final()]);
  };
  assert.equal(gcmOpen(dekBuf, Buffer.from(VECTOR.e, 'base64url'), 'kanlane/v1|' + vpid + '|' + vkid + '|tasks|t1|1').toString('utf8'), '{"title":"Hola, mundo","n":1}');
  assert.equal(gcmOpen(dekBuf, Buffer.from(VECTOR.kcv, 'base64url'), 'kcv|' + vpid + '|' + vkid).toString('utf8'), 'kanlane-kcv');
  const kekPw = nodeCrypto.pbkdf2Sync(Buffer.from('contraseña de vector fija'.normalize('NFC'), 'utf8'), Buffer.from(VECTOR.wrap.kdf.salt, 'base64url'), 600000, 32, 'sha256');
  const pwBlob = Buffer.concat([Buffer.from(VECTOR.wrap.pw.iv, 'base64url'), Buffer.from(VECTOR.wrap.pw.ct, 'base64url')]);
  assert.deepEqual(gcmOpen(kekPw, pwBlob, 'kanlane/wrap/v1|pw|' + vpid + '|' + vkid + '|uid-vector'), dekBuf);
  const kekRk = Buffer.from(nodeCrypto.hkdfSync('sha256', Buffer.from(PC.parseRecoveryKey(VECTOR.recovery)), Buffer.from(vpid, 'base64url'), Buffer.from('kanlane/rk/v1'), 32));
  const rkBlob = Buffer.concat([Buffer.from(VECTOR.rk.iv, 'base64url'), Buffer.from(VECTOR.rk.ct, 'base64url')]);
  assert.deepEqual(gcmOpen(kekRk, rkBlob, 'kanlane/wrap/v1|rk|' + vpid + '|' + vkid + '|uid-vector'), dekBuf);
  const kekCode = nodeCrypto.pbkdf2Sync(Buffer.from('ABCDEFGHJKMNPQRSTVWX'), Buffer.from(VECTOR.code.salt, 'base64url'), 100000, 32, 'sha256');
  const codeBlob = Buffer.concat([Buffer.from(VECTOR.code.iv, 'base64url'), Buffer.from(VECTOR.code.ct, 'base64url')]);
  assert.deepEqual(gcmOpen(kekCode, codeBlob, 'kanlane/wrap/v1|code|' + vpid + '|' + vkid + '|uid-vector'), dekBuf);
  ok('vector fijo estable y verificado con node:crypto (blob, kcv, envoltorios pw, rk y code)');

  /* ---------- código fuente ---------- */
  for(const rel of ['src/services/project-crypto.js', 'src/services/keystore.js']){
    const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/Math\.random/.test(src), rel + ' no usa Math.random');
    assert.ok(!/localStorage|sessionStorage/.test(src), rel + ' no usa localStorage');
    assert.ok(!/document\.|window\./.test(src), rel + ' no depende del DOM');
  }
  const html = read('app/index.html');
  const order = ['crypto.js', 'project-crypto.js', 'keystore.js'].map((f) => html.indexOf('<script src="../src/services/' + f + '"></script>'));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'app/index.html carga crypto.js → project-crypto.js → keystore.js');
  assert.ok(html.indexOf('src/core/namespace.js') < order[0]);
  assert.ok(read('scripts/check-js.js').includes("'tests/crypto'"), 'check-js revisa tests/crypto');
  ok('sin Math.random, sin localStorage ni DOM; scripts cargados en orden en app/index.html');
})().catch((err) => { console.error(err); process.exitCode = 1; });
