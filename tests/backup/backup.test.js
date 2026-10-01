/* La copia de un cofre migrado conserva el cifrado nuevo y sus metadatos. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const saved = [];
let metadata;
const empty = {items:[], add:async () => ({collection:() => ({add:async () => {}})})};
const vault = {
  items:[], metaState:'none',
  getMeta:async () => ({exists:false}),
  setMeta:async (value) => { metadata = value; },
  add:async (entry) => { saved.push(entry); }
};
const Workhub = {utils:{urls:{safeUrl:(url) => url || ''}}, models:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/models/backup-model.js'), 'utf8'), {Workhub, Date, Promise, JSON, String});
const backup = new Workhub.models.BackupModel({tasks:empty, contacts:empty, meetings:empty, clients:empty, vault});

(async () => {
  const result = await backup.import({vault:{meta:{saltPassword:'salt'}, entries:[{
    cliente:'Prueba', iv:'legacy-iv', cipher:'legacy-cipher', ivV2:'new-iv', cipherV2:'new-cipher'
  }]}});
  assert.equal(result.vaultOutcome, 'imported');
  assert.equal(metadata.saltPassword, 'salt');
  assert.equal(saved[0].ivV2, 'new-iv');
  assert.equal(saved[0].cipherV2, 'new-cipher');
  console.log('OK   copia: conserva las credenciales migradas');
})().catch((error) => { console.error(error); process.exitCode = 1; });
