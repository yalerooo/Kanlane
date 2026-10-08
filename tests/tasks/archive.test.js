/* Archivar tareas y columnas: lo archivado sale de `items` (lo que ve la aplicación) sin perder
   nada, se restaura tal cual y no se confunde con eliminar.
   Uso: node tests/tasks/archive.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}, utils:{}, services:{}, views:{team:{enabled:() => false}}, t:(text) => text};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'models/collection-model', 'models/project-templates', 'models/task-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TaskModel, ProjectTemplates:PT} = Workhub.models;
const ok = (name) => console.log('OK   ' + name);
const plain = (v) => JSON.parse(JSON.stringify(v));

/* Colección en memoria con la forma que usa el modelo: update mezcla, delete borra. */
function model(seed, opts){
  const o = opts || {};
  const docs = new Map(seed.map((d) => [d.id, Object.assign({}, d)]));
  const m = new TaskModel();
  const load = () => { m.items = Array.from(docs.values()).map((d) => Object.assign({}, d)); };
  m.col = {
    doc:(id) => ({
      update:(patch) => {
        if(o.reject && o.reject(id, patch)) return Promise.reject(new Error('permission-denied'));
        Object.assign(docs.get(id), patch);
        load();
        return Promise.resolve();
      },
      set:(data) => { docs.set(id, Object.assign({id:id}, data)); load(); return Promise.resolve(); },
      delete:() => { docs.delete(id); load(); return Promise.resolve(); },
      collection:() => ({get:() => Promise.resolve({docs:[]})})
    })
  };
  load();
  return {m:m, docs:docs};
}
const ids = (list) => list.map((t) => t.id);
const STAGES = [{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'done', label:'Hecho', done:true}];
const SEED = [
  {id:'a', title:'Uno', desc:'Texto', status:'todo', order:1, labels:['web'], checklist:[{id:'c1', text:'Paso', done:true}], dueDate:'2030-01-02', updatedAt:5},
  {id:'b', title:'Dos', status:'doing', order:2, updatedAt:5},
  {id:'c', title:'Tres', status:'doing', order:3, updatedAt:5},
  {id:'d', title:'Cuatro', status:'done', order:4, updatedAt:5}
];

(async () => {
  /* ---------- Columnas ---------- */
  {
    const project = {tipo:'personalizado', clients:false, stages:[STAGES[0], Object.assign({archived:true, limit:3}, STAGES[1]), STAGES[2]]};
    const cfg = PT.resolve(project);
    assert.deepEqual(plain(cfg.stages.map((s) => s.key)), ['todo', 'done']);
    assert.deepEqual(plain(cfg.archived), [{key:'doing', label:'En curso', color:'gray', done:false, limit:3, archived:true}], 'la archivada conserva nombre, color y límite');
    assert.deepEqual(plain(PT.allStages(project).map((s) => s.key)), ['todo', 'doing', 'done'], 'y su sitio entre las demás');
    assert.equal(plain(PT.fieldsFor('personalizado', PT.allStages(project), false).stages)[1].archived, true, 'se guarda con el proyecto');
    ok('columnas: una columna archivada sale del tablero y se conserva entera');

    const noFinal = PT.normalizeStages([STAGES[0], STAGES[1], Object.assign({archived:true}, STAGES[2])]);
    assert.deepEqual(plain(noFinal.map((s) => !!s.done)), [false, true, true], 'la final tiene que estar en el tablero');
    const few = PT.resolve({tipo:'personalizado', stages:[STAGES[0], Object.assign({archived:true}, STAGES[1]), Object.assign({archived:true}, STAGES[2])]});
    assert.deepEqual(plain(few.archived), [], 'con menos de dos columnas a la vista el proyecto usa las de la plantilla');
    assert.deepEqual(plain(PT.resolve({tipo:'kanban'}).archived), []);
    ok('columnas: siempre queda una final a la vista y el mínimo de columnas no cuenta las archivadas');
  }

  /* ---------- Tareas ---------- */
  TaskModel.setStages(STAGES);
  {
    const {m, docs} = model(SEED);
    const before = plain(docs.get('a'));
    let changes = 0;
    m.on('change', () => { changes++; });
    assert.deepEqual(await m.archive(['a', 'zz']), ['a']);
    assert.ok(changes > 0, 'avisa a las vistas');
    assert.deepEqual(ids(m.items), ['b', 'c', 'd'], 'ya no está a la vista');
    assert.equal(m.find('a'), undefined);
    assert.deepEqual(ids(m.inStatus('todo')), []);
    assert.deepEqual(ids(m.archivedItems()), ['a']);
    assert.equal(docs.has('a'), true, 'archivar no borra');
    const {archivedAt, ...rest} = plain(docs.get('a'));
    assert.ok(archivedAt > 0);
    assert.deepEqual(rest, before, 'conserva todos sus datos, también updatedAt');

    assert.deepEqual(plain(await m.unarchive('a')), {archivedAt:0});
    assert.deepEqual(ids(m.inStatus('todo')), ['a'], 'vuelve a su columna y a su sitio');
    assert.deepEqual(plain(Object.assign({}, docs.get('a'), {archivedAt:undefined})), before);
    assert.deepEqual(ids(m.archivedItems()), []);
    ok('tareas: archivar y restaurar conserva los datos');
  }
  {
    const {m, docs} = model(SEED, {reject:(id) => id === 'b'});
    assert.deepEqual(await m.archive(['a', 'b']), ['a'], 'solo las que se guardaron');
    assert.deepEqual(ids(m.items), ['b', 'c', 'd'], 'la que falló vuelve al tablero');
    assert.equal(docs.get('b').archivedAt, undefined);
    ok('tareas: si no se puede guardar, la tarea no desaparece');
  }
  {
    const {m, docs} = model(SEED);
    await m.archive(['b']);
    const snap = m.snapshot('b');
    assert.equal(snap.items.length, 1, 'una archivada también se puede copiar para deshacer');
    await m.remove('b');
    assert.equal(docs.has('b'), false, 'eliminar sí borra');
    await m.restore(snap);
    assert.deepEqual(ids(m.archivedItems()), ['b'], 'al deshacer vuelve al archivo, no al tablero');
    assert.deepEqual(ids(await m.withNotes()).sort(), ['a', 'b', 'c', 'd'], 'la copia de seguridad lleva también las archivadas');
    ok('tareas: eliminar es otra cosa, y la copia incluye lo archivado');
  }

  /* ---------- Columna archivada con sus tareas ---------- */
  {
    const {m, docs} = model(SEED);
    await m.archive(['c']);
    TaskModel.setStages([STAGES[0], STAGES[2]], [STAGES[1]]);
    assert.deepEqual(ids(m.items), ['a', 'd'], 'las tareas de la columna se van con ella');
    assert.deepEqual(ids(m.inArchivedStage('doing')), ['b']);
    assert.deepEqual(ids(m.archivedItems()), ['c'], 'la archivada a mano sigue en su lista');
    assert.equal(docs.get('b').archivedAt, undefined, 'las tareas no se tocan al archivar la columna');

    /* Restaurar una tarea cuya columna está archivada: va a la primera, al final. */
    const patch = plain(await m.unarchive('c'));
    assert.equal(patch.status, 'todo');
    assert.ok(patch.order > 1);
    assert.deepEqual(ids(m.inStatus('todo')), ['a', 'c']);

    TaskModel.setStages(STAGES);
    assert.deepEqual(ids(m.inStatus('doing')), ['b'], 'al restaurar la columna vuelven sus tareas, en su orden');
    assert.deepEqual(ids(m.items), ['a', 'b', 'c', 'd']);
    ok('columnas: archivar y restaurar una columna conserva sus tareas');
  }
  TaskModel.setStages(STAGES);
  console.log('Todo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
