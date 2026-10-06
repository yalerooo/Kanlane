/* Contraseña maestra del cofre: qué se acepta al crearla, el generador, cambiarla, y la
   verificación en dos pasos con sus códigos de respaldo (los envoltorios de la clave del cofre),
   con Web Crypto real de Node.
   Uso: node tests/vault/vault-totp.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);

const Workhub = {
  services:{platform:{mode:() => 'firebase'}},
  models:{CollectionModel:class { constructor(){ this.items = []; } connect(db){ this.db = db; } find(id){ return this.items.find((i) => i.id === id); } }}
};
['src/services/crypto.js', 'src/services/project-crypto.js', 'src/models/team-vault.js', 'src/models/vault-model.js'].forEach((rel) => {
  new Function('Workhub', 'window', 'crypto', read(rel))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto);
});
const cs = Workhub.services.crypto;
const PC = Workhub.services.projectCrypto;
const VaultModel = Workhub.models.VaultModel;
const TeamVault = Workhub.models.TeamVault;

/* Documentos en memoria, con la forma que usa el modelo. */
function memoryDb(){
  const docs = {};
  return {
    docs,
    doc:(p) => ({
      get:async () => ({exists:p in docs, data:() => docs[p]}),
      set:async (data) => { docs[p] = JSON.parse(JSON.stringify(data)); }
    })
  };
}
const META = 'vault_meta/check';
const open = (db) => { const v = new VaultModel(); v.db = db; return v; };
const rejectsWith = (code) => (err) => { assert.equal(err && (err.code || err.message), code); return true; };
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  /* ---------- Qué contraseñas maestras se aceptan ---------- */
  /* La misma regla que VaultController.passwordProblem. */
  const check = (pw) => PC.passwordCheck(pw, {email:'ana@example.com', projectName:'Clientes'});
  const problem = (pw) => ['short', 'common'].indexOf(check(pw).reason) !== -1;
  ['12345678', '123456789012', 'contraseña123', 'aaaaaaaaaaaaaaaa', 'qwertyuiopasdf'].forEach((pw) => assert.equal(problem(pw), true, pw + ' no vale'));
  ['prueba-segura-123', 'maestra-prueba-123', 'la maestra de ana', 'la maestra de luis', 'tres tristes tigres comen trigo'].forEach((pw) => assert.equal(problem(pw), false, pw + ' vale'));
  /* Con el correo o el nombre del proyecto dentro, el medidor avisa pero no se bloquea. */
  assert.equal(check('mis-clientes-seguros-2026').reason, 'personal');
  assert.equal(problem('mis-clientes-seguros-2026'), false);
  ok('«12345678» y las fáciles de adivinar ya no valen de contraseña maestra');

  /* ---------- Generador ---------- */
  const seen = new Set();
  for(let i = 0; i < 300; i++){
    const pw = cs.generatePassword();
    assert.match(pw, /^[a-km-np-zA-HJ-NP-Z2-9]{5}(-[a-km-np-zA-HJ-NP-Z2-9]{5}){3}$/, pw);
    assert.equal(PC.passwordCheck(pw, {}).level, 'good', pw);
    seen.add(pw);
  }
  assert.equal(seen.size, 300, 'no se repiten');
  const counts = {};
  for(let i = 0; i < 4000; i++) cs.generatePassword().replace(/-/g, '').split('').forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
  const freq = Object.values(counts);
  assert.equal(freq.length, 56, 'salen los 56 caracteres');
  assert.ok(Math.max(...freq) / Math.min(...freq) < 1.25, 'ninguno sale mucho más que otro');
  ok('el generador da contraseñas de 20 caracteres sin sesgo y sin caracteres confusos');

  /* ---------- Cambiar la contraseña maestra (cofre antiguo con una débil) ---------- */
  const OLD = '12345678', PASS = 'prueba-segura-123';
  const db = memoryDb();
  const vault = open(db);
  let recoveryKey = await vault.create(OLD);
  const secret = await cs.encryptJSON(vault.key, {password:'secreto-uno', notas:''});
  const reads = async (v) => (await cs.decryptJSON(v.key, secret.iv, secret.cipher)).password === 'secreto-uno';
  let v = open(db);
  await v.unlock(OLD);
  assert.ok(await reads(v), 'una contraseña antigua y corta sigue abriendo');
  await assert.rejects(vault.changePassword('no-es-la-actual', PASS), /bad-pass/);
  const beforeChange = Object.assign({}, db.docs[META]);
  await vault.changePassword(OLD, PASS);
  assert.equal(db.docs[META].cipherRecovery, beforeChange.cipherRecovery, 'la clave de recuperación no cambia');
  await assert.rejects(open(db).unlock(OLD));
  v = open(db);
  await v.unlock(PASS);
  assert.ok(await reads(v));
  ok('cambiar la contraseña: la anterior deja de abrir y la clave de recuperación sigue igual');

  /* ---------- Activar la verificación en dos pasos ---------- */
  const share = nodeCrypto.randomBytes(32), token = 't'.repeat(64);
  const verify = async (t) => { assert.equal(t, token); return share; };
  const badCode = async () => { throw Object.assign(new Error('totp-code'), {code:'totp-code'}); };
  const before = Object.assign({}, db.docs[META]);
  let asked = 0;
  await assert.rejects(vault.enableTotp('otra-contraseña-mal', async () => { asked++; return {token, share}; }), /bad-pass/);
  assert.equal(asked, 0, 'con la contraseña mal no se llega a pedir el alta');
  await assert.rejects(vault.enableTotp(PASS, badCode), /totp-code/);
  assert.deepEqual(db.docs[META], before, 'si el alta falla, no cambia nada');

  const on = await vault.enableTotp(PASS, async () => ({token, share}));
  assert.equal(vault.totp, true);
  assert.equal(on.codes.length, 10);
  on.codes.forEach((c) => assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/, c));
  assert.equal(new Set(on.codes).size, 10);
  assert.notEqual(on.recoveryKey, recoveryKey, 'la clave de recuperación cambia');
  const meta = db.docs[META];
  /* Lo que admiten las reglas de los equipos (vault_keys): estos campos, 512 caracteres por
     envoltorio y 2048 de códigos de respaldo. */
  assert.deepEqual(Object.keys(meta).sort(), ['backup', 'cipherPassword', 'cipherRecovery', 'createdAt', 'ivPassword', 'ivRecovery', 'saltPassword', 'updatedAt']);
  assert.ok(meta.cipherPassword.length <= 512 && meta.cipherRecovery.length <= 512, 'los envoltorios caben');
  assert.ok(typeof meta.backup === 'string' && meta.backup.length <= 2048, 'los códigos caben: ' + meta.backup.length);
  on.codes.forEach((c) => assert.equal(meta.backup.indexOf(c.replace(/-/g, '')), -1, 'los códigos no van en claro'));
  assert.equal(await vault.backupLeft(), 10);
  await assert.rejects(vault.enableTotp(PASS, async () => ({token, share})), /totp-on/);
  ok('activar: diez códigos de respaldo y clave de recuperación nueva, en los mismos campos');

  /* ---------- Desbloquear ---------- */
  let again = open(db);
  await assert.rejects(again.unlock('otra-contraseña-mal'), (err) => err.message !== 'totp-required');
  assert.equal(again.pendingTotp, null, 'con la contraseña mal no se llega al segundo paso');
  await assert.rejects(again.unlock(PASS), /totp-required/);
  assert.equal(again.unlocked, false);
  assert.equal(again.key, null);
  /* Lo que deja la contraseña no contiene la clave del cofre. */
  const kek = await cs.deriveKey(PASS, cs.b64decode(meta.saltPassword));
  assert.equal('dek' in await cs.decryptJSON(kek, meta.ivPassword, meta.cipherPassword), false);
  await assert.rejects(again.unlockWithShare(nodeCrypto.randomBytes(32)));
  assert.equal(again.unlocked, false);
  await again.unlockWithShare(share);
  assert.equal(again.unlocked && again.totp, true);
  assert.ok(await reads(again), 'es la misma clave del cofre');
  await assert.rejects(TeamVault.openWithPassword(meta, PASS), rejectsWith('totp'));
  ok('desbloquear: contraseña → «totp-required» → la clave del servidor abre el cofre');

  /* ---------- Códigos de respaldo: de un solo uso, y no sustituyen a la contraseña ---------- */
  again = open(db);
  await assert.rejects(again.unlockWithBackup(on.codes[0]), /no-pending/, 'sin la contraseña no hay segundo paso');
  await assert.rejects(again.unlock(PASS), /totp-required/);
  await assert.rejects(again.unlockWithBackup('AAAA-AAAA-AAAA-AAAA'), rejectsWith('bad-backup'));
  await assert.rejects(again.unlockWithBackup('123456'), rejectsWith('bad-backup'));
  assert.equal(again.unlocked, false);
  /* Se aceptan en minúsculas, sin guiones y con O por 0. */
  const typed = on.codes[0].toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
  assert.equal(await again.unlockWithBackup(typed), 9, 'quedan nueve');
  assert.ok(again.unlocked && again.totp && await reads(again));
  await tick();
  assert.equal(await vault.backupLeft(), 9);
  again = open(db);
  await assert.rejects(again.unlock(PASS), /totp-required/);
  await assert.rejects(again.unlockWithBackup(on.codes[0]), rejectsWith('bad-backup'));
  assert.equal(again.unlocked, false, 'un código usado no vale otra vez');
  assert.equal(VaultModel.isBackupCode(on.codes[1]), true);
  assert.equal(VaultModel.isBackupCode('123456'), false);
  ok('un código de respaldo sustituye al teléfono una sola vez');

  /* ---------- La clave de recuperación ya no se salta el segundo paso ---------- */
  const NEWPASS = 'otra-maestra-nueva-456';
  const lockedMeta = JSON.stringify(db.docs[META]);
  let lost = open(db);
  await assert.rejects(lost.recover(cs.base32Decode(recoveryKey), NEWPASS, {verify}), /bad-key/, 'la clave anterior a activar ya no vale');
  await assert.rejects(lost.recover(cs.base32Decode(on.recoveryKey), NEWPASS), rejectsWith('totp-required'));
  await assert.rejects(lost.recover(cs.base32Decode(on.recoveryKey), NEWPASS, {verify:badCode}), rejectsWith('totp-code'));
  await assert.rejects(lost.recover(cs.base32Decode(on.recoveryKey), NEWPASS, {backup:on.codes[0]}), rejectsWith('bad-backup'));
  await assert.rejects(lost.recover(cs.base32Decode(on.recoveryKey), NEWPASS, {verify:async () => nodeCrypto.randomBytes(32)}), /bad-share/);
  assert.equal(lost.unlocked, false);
  assert.equal(JSON.stringify(db.docs[META]), lockedMeta, 'sin segundo factor la recuperación no cambia nada');
  /* La clave de recuperación sola no contiene la clave del cofre. */
  const rk = await cs.importAesKeyRaw(cs.base32Decode(on.recoveryKey));
  assert.equal('dek' in await cs.decryptJSON(rk, meta.ivRecovery, meta.cipherRecovery), false);

  /* Con un código de respaldo (teléfono perdido): entra, gasta el código y el segundo paso sigue. */
  const rk2 = await lost.recover(cs.base32Decode(on.recoveryKey), NEWPASS, {backup:on.codes[1]});
  assert.equal(lost.unlocked && lost.totp, true, 'sigue activada');
  assert.ok(await reads(lost));
  assert.notEqual(rk2, on.recoveryKey);
  assert.equal(await lost.backupLeft(), 8, 'el código usado se gasta');
  await assert.rejects(open(db).unlock(PASS), (err) => err.message !== 'totp-required', 'la contraseña anterior ya no vale');
  again = open(db);
  await assert.rejects(again.unlock(NEWPASS), /totp-required/, 'la nueva sigue pidiendo el código');
  await again.unlockWithShare(share);
  assert.ok(await reads(again));
  /* Y con un código de la aplicación. */
  lost = open(db);
  const rk3 = await lost.recover(cs.base32Decode(rk2), PASS, {verify});
  assert.equal(lost.totp, true);
  assert.equal(await lost.backupLeft(), 8, 'los códigos de respaldo se conservan');
  recoveryKey = rk3;
  ok('restablecer con la clave de recuperación pide el segundo factor y no lo desactiva');

  /* ---------- Códigos de respaldo nuevos ---------- */
  await assert.rejects(vault.newBackupCodes('otra-contraseña-mal', {verify}), /bad-pass/);
  await assert.rejects(vault.newBackupCodes(PASS, {verify:async () => nodeCrypto.randomBytes(32)}), /bad-share/);
  await assert.rejects(vault.newBackupCodes(PASS, null), rejectsWith('totp-required'));
  const fresh = await vault.newBackupCodes(PASS, {verify});
  assert.equal(fresh.length, 10);
  assert.equal(await vault.backupLeft(), 10);
  again = open(db);
  await assert.rejects(again.unlock(PASS), /totp-required/);
  await assert.rejects(again.unlockWithBackup(on.codes[5]), rejectsWith('bad-backup'));
  assert.equal(again.unlocked, false, 'los anteriores dejan de valer');
  assert.equal(await again.unlockWithBackup(fresh[3]), 9);
  ok('pedir códigos nuevos invalida los anteriores');

  /* ---------- Desactivar ---------- */
  await tick();
  await assert.rejects(vault.disableTotp('otra-contraseña-mal', {verify}), /bad-pass/);
  await assert.rejects(vault.disableTotp(PASS, {verify:async () => nodeCrypto.randomBytes(32)}), /bad-share/);
  await assert.rejects(vault.disableTotp(PASS, {backup:fresh[3]}), rejectsWith('bad-backup'));
  /* También con un código de respaldo: quien ha perdido el teléfono tiene que poder quitarla. */
  const rk4 = await vault.disableTotp(PASS, {backup:fresh[0]});
  assert.equal(vault.totp, false);
  assert.equal('backup' in db.docs[META], false, 'no quedan códigos de respaldo');
  await assert.rejects(vault.disableTotp(PASS, {verify}), /totp-off/);
  const plain = open(db);
  await plain.unlock(PASS);
  assert.equal(plain.totp, false);
  assert.ok(await reads(plain));
  /* La clave de recuperación de antes ya no vale; la nueva vuelve a bastar ella sola. */
  await assert.rejects(open(db).recover(cs.base32Decode(recoveryKey), NEWPASS, {verify}), /bad-key/);
  lost = open(db);
  await lost.recover(cs.base32Decode(rk4), NEWPASS);
  assert.equal(lost.totp, false);
  assert.ok(await reads(lost));
  ok('desactivar: vuelve a abrirse solo con la contraseña y la clave de recuperación nueva basta');
})().catch((error) => { console.error(error); process.exitCode = 1; });
