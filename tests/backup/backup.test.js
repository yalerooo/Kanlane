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

  /* En un proyecto de equipo las reglas no dejan leer vault_meta: la copia no debe pedirlo. */
  const denied = async () => { throw new Error('permission-denied'); };
  const tasks = Object.assign({}, empty, {withNotes:async () => [{title:'Tarea', notes:[]}]});
  const team = new Workhub.models.BackupModel({tasks, contacts:empty, meetings:empty, clients:empty,
    vault:{items:[], getMeta:denied, setMeta:denied, add:denied}});
  Workhub.views = {team:{enabled:() => true}};
  const copy = await team.build('Equipo');
  assert.equal(copy.counts.tasks, 1);
  assert.equal(JSON.parse(copy.json).vault.meta, null);
  const imported = await team.import({tasks:[{title:'Tarea'}], vault:{meta:{saltPassword:'salt'}, entries:[{cliente:'Prueba', iv:'iv', cipher:'c'}]}});
  assert.equal(imported.vaultOutcome, 'team');
  assert.equal(imported.counts.tasks, 1);
  console.log('OK   copia: un proyecto de equipo se exporta e importa sin tocar el cofre');
})().catch((error) => { console.error(error); process.exitCode = 1; });
