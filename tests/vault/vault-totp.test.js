/* Contraseña maestra del cofre: qué se acepta al crearla, el generador y la verificación en dos
   pasos (el envoltorio de la clave del cofre), con Web Crypto real de Node.
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

  /* ---------- Verificación en dos pasos ---------- */
  const PASS = 'prueba-segura-123';
  const db = memoryDb();
  const vault = new VaultModel();
  vault.db = db;
  const recoveryKey = await vault.create(PASS);
  assert.equal(vault.totp, false);
  const secret = await cs.encryptJSON(vault.key, {password:'secreto-uno', notas:''});
  const before = Object.assign({}, db.docs['vault_meta/check']);

  const share = nodeCrypto.randomBytes(32), token = 't'.repeat(64);
  let asked = 0;
  await assert.rejects(vault.enableTotp('otra-contraseña-mal', async () => { asked++; return {token, share}; }), /bad-pass/);
  assert.equal(asked, 0, 'con la contraseña mal no se llega a pedir el alta');
  await assert.rejects(vault.enableTotp(PASS, async () => { throw Object.assign(new Error('totp-code'), {code:'totp-code'}); }), /totp-code/);
  assert.deepEqual(db.docs['vault_meta/check'], before, 'si el alta falla, el envoltorio no cambia');

  await vault.enableTotp(PASS, async () => ({token, share}));
  assert.equal(vault.totp, true);
  const meta = db.docs['vault_meta/check'];
  /* Las reglas de los equipos (vault_keys) solo admiten estos campos y 512 caracteres de cipherPassword. */
  assert.deepEqual(Object.keys(meta).sort(), ['cipherPassword', 'cipherRecovery', 'createdAt', 'ivPassword', 'ivRecovery', 'saltPassword', 'updatedAt']);
  assert.ok(meta.cipherPassword.length <= 512, 'cipherPassword cabe: ' + meta.cipherPassword.length);
  assert.equal(meta.cipherRecovery, before.cipherRecovery, 'el envoltorio de recuperación no se toca');
  assert.notEqual(meta.saltPassword, before.saltPassword);
  await assert.rejects(vault.enableTotp(PASS, async () => ({token, share})), /totp-on/);
  ok('activar: mismos campos, la clave del cofre queda envuelta también con la clave del servidor');

  /* Con la contraseña sola ya no se abre. */
  const again = new VaultModel();
  again.db = db;
  await assert.rejects(again.unlock('otra-contraseña-mal'), (err) => err.message !== 'totp-required');
  assert.equal(again.pendingTotp, null, 'con la contraseña mal no se llega al segundo paso');
  await assert.rejects(again.unlock(PASS), /totp-required/);
  assert.equal(again.unlocked, false);
  assert.equal(again.key, null);
  assert.deepEqual(Object.keys(again.pendingTotp).sort(), ['cipher', 'iv', 'token']);
  assert.equal(again.pendingTotp.token, token);
  /* Lo que deja la contraseña no contiene la clave del cofre. */
  const kek = await cs.deriveKey(PASS, cs.b64decode(meta.saltPassword));
  assert.equal('dek' in await cs.decryptJSON(kek, meta.ivPassword, meta.cipherPassword), false);
  await assert.rejects(again.unlockWithShare(nodeCrypto.randomBytes(32)));
  assert.equal(again.unlocked, false);
  await again.unlockWithShare(share);
  assert.equal(again.unlocked, true);
  assert.equal(again.totp, true);
  assert.equal(again.pendingTotp, null);
  assert.equal((await cs.decryptJSON(again.key, secret.iv, secret.cipher)).password, 'secreto-uno', 'es la misma clave del cofre');
  ok('desbloquear: contraseña → «totp-required» → la clave del servidor abre el cofre');

  /* Sin el segundo paso tampoco lo abren los atajos que solo piden la contraseña maestra. */
  await assert.rejects(TeamVault.openWithPassword(meta, PASS), (err) => err.code === 'totp');
  again.lock();
  assert.equal(again.totp, false);
  assert.equal(again.pendingTotp, null);

  /* Desactivar pide la clave del servidor para ese token. */
  await assert.rejects(vault.disableTotp('otra-contraseña-mal', async () => share), /bad-pass/);
  await assert.rejects(vault.disableTotp(PASS, async () => nodeCrypto.randomBytes(32)));
  assert.equal('dek' in await cs.decryptJSON(kek, meta.ivPassword, db.docs['vault_meta/check'].cipherPassword), false, 'sigue activada');
  let got;
  await vault.disableTotp(PASS, async (t) => { got = t; return share; });
  assert.equal(got, token);
  assert.equal(vault.totp, false);
  await assert.rejects(vault.disableTotp(PASS, async () => share), /totp-off/);
  const plain = new VaultModel();
  plain.db = db;
  await plain.unlock(PASS);
  assert.equal(plain.totp, false);
  assert.equal((await cs.decryptJSON(plain.key, secret.iv, secret.cipher)).password, 'secreto-uno');
  ok('desactivar: vuelve a abrirse solo con la contraseña');

  /* La clave de recuperación entra sin código y deja el cofre sin segundo paso. */
  await plain.enableTotp(PASS, async () => ({token, share}));
  const lost = new VaultModel();
  lost.db = db;
  const newKey = await lost.recover(cs.base32Decode(recoveryKey), 'otra-maestra-nueva-456');
  assert.notEqual(newKey, recoveryKey);
  assert.equal(lost.totp, false);
  const after = new VaultModel();
  after.db = db;
  await after.unlock('otra-maestra-nueva-456');
  assert.equal((await cs.decryptJSON(after.key, secret.iv, secret.cipher)).password, 'secreto-uno');
  ok('la clave de recuperación entra sin código y desactiva el segundo paso');
})().catch((error) => { console.error(error); process.exitCode = 1; });
