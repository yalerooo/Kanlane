/* Regressions for vault detection and interruption-safe legacy migration. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const crypto = {
  randomBytes: () => new Uint8Array([1, 2, 3]),
  b64encode: () => 'encoded',
  b64decode: () => new Uint8Array([1, 2, 3]),
  deriveKey: async () => 'old-key',
  importAesKeyRaw: async () => 'new-key',
  decryptJSON: async (key, iv, cipher) => {
    if(cipher === 'check') return {check:'OK'};
    if(cipher === 'old-cipher') return {password:'secret', notas:''};
    if(cipher === 'new-cipher') return {password:'secret', notas:''};
    throw new Error('bad cipher');
  },
  encryptJSON: async () => ({iv:'new-iv', cipher:'new-cipher'}),
  formatRecoveryKey: () => 'recovery'
};
const Workhub = {
  services:{crypto, platform:{mode:() => 'firebase'}},
  models:{CollectionModel:class { constructor(){ this.items = []; } find(id){ return this.items.find((item) => item.id === id); } }}
};
const source = fs.readFileSync(path.join(__dirname, '../../src/models/vault-model.js'), 'utf8');
vm.runInNewContext(source, {Workhub, Date, Promise, Uint8Array});
const VaultModel = Workhub.models.VaultModel;

(async () => {
  const broken = new VaultModel();
  let writes = 0;
  broken.db = {doc:() => ({get:async () => { throw new Error('offline'); }, set:async () => { writes++; }})};
  await assert.rejects(broken.checkMeta(), /offline/);
  assert.equal(broken.metaState, null);
  await assert.rejects(broken.create('password'), /offline/);
  assert.equal(writes, 0, 'no se reemplazan metadatos cuando falla la lectura');

  async function migration(failSecond){
    const vault = new VaultModel();
    const entries = [{id:'a', iv:'old-iv', cipher:'old-cipher'}, {id:'b', iv:'old-iv', cipher:'old-cipher'}];
    vault.items = entries;
    let metaWrites = 0;
    vault.getMeta = async () => ({exists:true, data:() => ({salt:'salt', iv:'old-iv', cipher:'check'})});
    vault.col = {get:async () => ({docs:entries.map((entry) => ({id:entry.id, data:() => entry}))})};
    vault.update = async (id, patch) => {
      if(failSecond && id === 'b') throw new Error('write failed');
      Object.assign(entries.find((entry) => entry.id === id), patch);
    };
    vault._writeWrappedDek = async () => { metaWrites++; return 'recovery'; };
    if(failSecond){
      await assert.rejects(vault.unlockLegacy('password'), /write failed/);
      assert.equal(metaWrites, 0);
      assert.equal(entries[0].cipher, 'old-cipher');
      assert.equal(entries[1].cipher, 'old-cipher');
    }else{
      assert.equal(await vault.unlockLegacy('password'), 'recovery');
      assert.equal(metaWrites, 1);
      assert.equal((await vault.decrypt(entries[0])).password, 'secret');
    }
  }
  await migration(true);
  await migration(false);
  console.log('OK   cofre: errores de lectura y migración interrumpida');
})().catch((err) => { console.error(err); process.exitCode = 1; });
