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
vm.runInNewContext(source, {Workhub, Date, Promise, Uint8Array, URL, String});
const VaultModel = Workhub.models.VaultModel;

/* Web y correo de una credencial: direcciones http(s), dominios y correos; nada que se pueda ejecutar. */
['', '  ', 'https://cliente.com', 'http://cliente.com/panel?x=1', 'HTTPS://Cliente.com', 'cliente.com', 'panel.cliente.com/login',
  'cliente.com:8443', '192.168.1.10', '192.168.1.10:8080/admin', 'localhost:3000', 'http://nas', 'ñandú.es', '[::1]:8080']
  .forEach((web) => assert.equal(VaultModel.validWeb(web), true, 'vale: ' + web));
['javascript:alert(document.domain)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'file:///c:/secreto.txt', 'ftp://cliente.com',
  'mailto:ana@cliente.com', 'tel:600100200', 'texto cualquiera', 'panel', 'https://', '//cliente.com', 'ana@cliente.com', 'javascript://cliente.com/%0aalert(1)']
  .forEach((web) => assert.equal(VaultModel.validWeb(web), false, 'no vale: ' + web));
['', 'ana@cliente.com', ' ana.lopez+web@sub.cliente.es '].forEach((mail) => assert.equal(VaultModel.validEmail(mail), true, 'vale: ' + mail));
['ana', 'ana@', '@cliente.com', 'ana@cliente', 'ana lopez@cliente.com', 'javascript:alert(1)'].forEach((mail) => assert.equal(VaultModel.validEmail(mail), false, 'no vale: ' + mail));
console.log('OK   credenciales: la web admite http(s) o un dominio y el correo, solo correos');

(async () => {
  const broken = new VaultModel();
  let writes = 0;
  broken.db = {doc:() => ({get:async () => { throw new Error('offline'); }, set:async () => { writes++; }})};
  await assert.rejects(broken.checkMeta(), /offline/);
  assert.equal(broken.metaState, null);
  await assert.rejects(broken.create('password'), /offline/);
  assert.equal(writes, 0, 'no se reemplazan metadatos cuando falla la lectura');

  /* Sin cofre todavía: si el servidor ya ha dicho que no existe, no se le pregunta otra vez; una
     respuesta de la caché (o de la que no se sabe el origen) sí se confirma con el servidor. */
  const stateWith = async (metadata, exists) => {
    const vault = new VaultModel();
    const reads = [];
    vault.db = {doc:() => ({get:async (opts) => {
      reads.push(opts && opts.source ? opts.source : 'default');
      return {exists:!!exists, data:() => ({saltPassword:'salt'}), metadata:reads.length === 1 ? metadata : {fromCache:false}};
    }})};
    return [await vault.checkMeta(), reads.join('+')];
  };
  assert.deepEqual(await stateWith({fromCache:false}, false), ['none', 'default'], 'respuesta del servidor: una sola lectura');
  assert.deepEqual(await stateWith({fromCache:true}, false), ['none', 'default+server'], 'respuesta de la caché: se confirma');
  assert.deepEqual(await stateWith(undefined, false), ['none', 'default+server'], 'origen desconocido: se confirma');
  assert.deepEqual(await stateWith({fromCache:true}, true), ['current', 'default'], 'si el cofre existe, basta con lo que haya');
  console.log('OK   cofre: el estado sin cofre se lee del servidor una sola vez');

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
