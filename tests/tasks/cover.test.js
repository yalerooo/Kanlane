/* Portada de una tarea: un color o una imagen adjunta en una de sus notas. Qué vale como portada,
   qué pasa a la copia y a la siguiente repetición, y qué ocurre al eliminar la nota de la imagen.
   Uso: node tests/tasks/cover.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}, utils:{}, services:{}, views:{team:{enabled:() => false}}, t:(text) => text};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'models/collection-model', 'models/project-templates', 'models/task-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TaskModel} = Workhub.models;
const ok = (name) => console.log('OK   ' + name);
const plain = (v) => JSON.parse(JSON.stringify(v));

/* Colección en memoria: tareas y, por tarea, sus notas. */
function model(tasks, notes){
  const docs = new Map(tasks.map((d) => [d.id, Object.assign({}, d)]));
  const added = [];
  const m = new TaskModel();
  const load = () => { m.items = Array.from(docs.values()).map((d) => Object.assign({}, d)); };
  m.col = {
    add:(data) => { const id = 'n' + (added.length + 1); added.push(data); docs.set(id, Object.assign({id:id}, data)); load(); return Promise.resolve({id:id}); },
    doc:(id) => ({
      update:(patch) => { Object.assign(docs.get(id), patch); load(); return Promise.resolve(); },
      collection:() => ({doc:(noteId) => ({
        get:() => Promise.resolve({exists:!!notes[noteId], data:() => notes[noteId]}),
        delete:() => { delete notes[noteId]; return Promise.resolve(); }
      })})
    })
  };
  load();
  return {m:m, docs:docs, added:added};
}

TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'done', label:'Hecho', done:true}]);

(async () => {
  const c = (cover) => plain(TaskModel.coverOf({cover:cover}));
  assert.deepEqual(c({color:'blue'}), {color:'blue'});
  assert.deepEqual(c({asset:'abc'}), {asset:'abc'});
  assert.deepEqual(c({asset:'abc', color:'blue'}), {asset:'abc'}, 'con las dos, manda la imagen');
  [undefined, null, {}, 'blue', {color:'fucsia'}, {color:''}, {asset:''}, {asset:5}, {asset:'x'.repeat(201)}].forEach((bad) => assert.equal(c(bad), null, JSON.stringify(bad)));
  assert.equal(TaskModel.coverOf(null), null);
  ok('qué vale como portada');

  /* La copia: el color pasa; la imagen no (es de una nota de la original, y las notas no se copian). */
  assert.deepEqual(plain(TaskModel.copyOf({id:'a', title:'T', cover:{color:'red'}}).cover), {color:'red'});
  assert.ok(!('cover' in TaskModel.copyOf({id:'a', title:'T', cover:{asset:'img'}})));
  assert.ok(!('cover' in TaskModel.copyOf({id:'a', title:'T', cover:{}})), 'una portada quitada tampoco');
  assert.ok(!('cover' in TaskModel.copyOf({id:'a', title:'T'})));
  ok('al duplicar pasa el color y no la imagen');

  /* La siguiente repetición. */
  {
    const {m, added} = model([
      {id:'a', title:'Color', status:'done', dueDate:'2030-01-01', repeat:'weekly', cover:{color:'green'}},
      {id:'b', title:'Imagen', status:'done', dueDate:'2030-01-01', repeat:'weekly', cover:{asset:'img'}}
    ], {});
    await m.spawnNext(m.find('a'));
    await m.spawnNext(m.find('b'));
    assert.deepEqual(plain(added.map((t) => t.cover || null)), [{color:'green'}, null]);
    ok('la siguiente repetición conserva el color');
  }

  /* Eliminar la nota que tiene la imagen de la portada deja la tarea sin portada; otra nota, no. */
  {
    const notes = {
      n1:{text:'una imagen', imageAssetId:'img1'},
      n2:{text:'varias', attachments:[{image:true, parts:['img2']}, {image:true, parts:['img3']}], assetIds:['img2', 'img3']},
      n3:{text:'otra', imageAssetId:'img9'}
    };
    const {m, docs} = model([
      {id:'a', title:'A', status:'todo', cover:{asset:'img1'}},
      {id:'b', title:'B', status:'todo', cover:{asset:'img3'}},
      {id:'c', title:'C', status:'todo', cover:{color:'blue'}}
    ], notes);
    assert.deepEqual(plain(await m.removeNote('a', 'n3')), []);
    assert.deepEqual(plain(docs.get('a').cover), {asset:'img1'}, 'la nota eliminada no era la de la portada');
    await m.removeNote('a', 'n1');
    assert.deepEqual(plain(docs.get('a').cover), {});
    assert.equal(TaskModel.coverOf(m.find('a')), null);
    assert.deepEqual(plain(await m.removeNote('b', 'n2')), ['img2', 'img3'], 'devuelve los archivos que hay que borrar, como antes');
    assert.deepEqual(plain(docs.get('b').cover), {});
    assert.deepEqual(plain(docs.get('c').cover), {color:'blue'});
    ok('eliminar la nota de la imagen quita la portada');
  }
  console.log('Todo correcto.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
