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
const sandbox = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array});
['custom-fields', 'backup-model'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/models/' + f + '.js'), 'utf8'), sandbox));
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

  /* En un proyecto de equipo la copia lleva mi clave del cofre compartido, pero un archivo no se
     importa sobre él: ni se lee ni se escribe nada del cofre. */
  const denied = async () => { throw new Error('permission-denied'); };
  const tasks = Object.assign({}, empty, {withNotes:async () => [{title:'Tarea', notes:[]}]});
  const team = new Workhub.models.BackupModel({tasks, contacts:empty, meetings:empty, clients:empty,
    vault:{items:[{id:'v1'}], getMeta:async () => ({exists:true, data:() => ({saltPassword:'mine'})}), setMeta:denied, add:denied}});
  Workhub.views = {team:{enabled:() => true}};
  const copy = await team.build('Equipo');
  assert.equal(copy.counts.tasks, 1);
  assert.equal(copy.counts.vault, 1);
  assert.equal(JSON.parse(copy.json).vault.meta.saltPassword, 'mine');
  team.models.vault.getMeta = denied;
  const imported = await team.import({tasks:[{title:'Tarea'}], vault:{meta:{saltPassword:'salt'}, entries:[{cliente:'Prueba', iv:'iv', cipher:'c'}]}});
  assert.equal(imported.vaultOutcome, 'team');
  assert.equal(imported.counts.tasks, 1);
  console.log('OK   copia: un proyecto de equipo se exporta e importa sin tocar el cofre');
})().catch((error) => { console.error(error); process.exitCode = 1; });
