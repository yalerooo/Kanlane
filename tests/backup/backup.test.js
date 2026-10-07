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

  /* Importar conserva las subtareas (con lo que estaba hecho) y copia los adjuntos de las notas a
     archivos nuevos: la copia no comparte ninguno con la nota original. */
  Workhub.views = {team:{enabled:() => false}};
  const made = {tasks:[], notes:[]};
  const uploads = [];
  const store = Object.assign({}, empty, {
    add:async (task) => { made.tasks.push(task); return {id:'t' + made.tasks.length}; },
    addNoteRaw:async (taskId, note) => { made.notes.push(Object.assign({taskId}, note)); }
  });
  const plain = new Workhub.models.BackupModel({tasks:store, contacts:empty, meetings:empty, clients:empty, vault});
  plain.files = {
    read:async (att) => { if(att.parts[0] === 'borrado') throw new Error('file-missing'); return {from:att.parts.join('+'), type:att.type}; },
    image:async (blob) => { uploads.push(['image', blob.from]); return 'img-' + uploads.length; },
    file:async (blob) => { if(blob.from === 'no-cabe') throw new Error('quota'); uploads.push(['file', blob.from]); return ['f' + uploads.length + 'a', 'f' + uploads.length + 'b']; }
  };
  const file = {
    tasks:[{title:'Con subtareas', checklist:[{id:'a', text:'Hecha', done:true}, {id:'a', text:'Repite id'}, {text:'  Sin id  ', done:'sí'}, {id:'v', text:'   '}, null, 'texto'],
      notes:[
        {text:'Con archivo', kind:'comment', attachments:[{name:'informe.txt', type:'text/plain', size:12, image:false, parts:['p1', 'p2']}], assetIds:['p1', 'p2']},
        {text:'Con dos fotos y uno que ya no está', attachments:[{name:'', type:'image/jpeg', size:0, image:true, parts:['i1']}, {name:'x.pdf', type:'application/pdf', size:5, parts:['borrado']},
          {name:'grande.zip', type:'application/zip', size:9, parts:['no-cabe']}, {name:'sin partes', parts:[]}], assetIds:['i1', 'borrado', 'no-cabe']},
        {text:'Imagen suelta de las de antes', imageAssetId:'vieja'},
        {text:'Sin adjuntos'}
      ]},
      {title:'Sin subtareas'}]
  };
  const out = await plain.import(file);
  assert.deepEqual(JSON.parse(JSON.stringify(made.tasks[0].checklist.map((c) => [c.text, c.done]))), [['Hecha', true], ['Repite id', false], ['Sin id', false]]);
  assert.equal(new Set(made.tasks[0].checklist.map((c) => c.id)).size, 3, 'cada subtarea con su id, sin repetir');
  assert.equal(made.tasks[0].checklist[0].id, 'a', 'el id del archivo se conserva');
  assert.deepEqual(JSON.parse(JSON.stringify(made.tasks[1].checklist)), []);
  const byText = (text) => JSON.parse(JSON.stringify(made.notes.find((n) => n.text === text)));
  assert.deepEqual([byText('Con archivo').attachments, byText('Con archivo').assetIds],
    [[{name:'informe.txt', type:'text/plain', size:12, image:false, parts:['f1a', 'f1b']}], ['f1a', 'f1b']], 'el archivo se copia entero a trozos nuevos');
  assert.deepEqual([byText('Con dos fotos y uno que ya no está').attachments, byText('Con dos fotos y uno que ya no está').assetIds],
    [[{name:'', type:'image/jpeg', size:0, image:true, parts:['img-2']}], ['img-2']], 'la imagen se copia; lo que no está o no se puede subir se queda fuera');
  assert.deepEqual([byText('Imagen suelta de las de antes').imageAssetId, byText('Imagen suelta de las de antes').attachments, byText('Sin adjuntos').assetIds], ['vieja', undefined, undefined]);
  assert.deepEqual(JSON.parse(JSON.stringify(uploads)), [['file', 'p1+p2'], ['image', 'i1']]);
  assert.deepEqual([out.counts.tasks, out.counts.notes, out.counts.files, out.counts.filesSkipped], [2, 4, 2, 2]);
  /* Sin forma de copiar (no debería pasar en la app): la nota entra sin adjuntos y se cuenta. */
  made.notes.length = 0;
  plain.files = null;
  const bare = await plain.import({tasks:[{title:'T', notes:[{text:'Con archivo', attachments:[{name:'a.txt', parts:['p1']}]}]}]});
  assert.deepEqual([made.notes[0].attachments, bare.counts.files, bare.counts.filesSkipped], [undefined, 0, 1]);
  console.log('OK   copia: importar conserva las subtareas y copia los adjuntos de las notas');
})().catch((error) => { console.error(error); process.exitCode = 1; });
