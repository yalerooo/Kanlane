/* Relaciones entre tareas: «relacionada con» y la dependencia «bloqueada por / bloquea a». Cada
   relación se guarda en una sola tarea y se lee desde las dos; no puede haber ciclos; una tarea
   está bloqueada mientras alguna de las que espera siga sin terminar.
   Uso: node tests/tasks/relations.test.js */
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

/* Colección en memoria; apunta lo que se escribe y puede rechazar una escritura. */
function model(seed, opts){
  const o = opts || {};
  const docs = new Map(seed.map((d) => [d.id, Object.assign({}, d)]));
  const writes = [];
  const m = new TaskModel();
  m.col = {doc:(id) => ({update:(patch) => {
    if(o.reject && o.reject(id)) return Promise.reject(new Error('permission-denied'));
    writes.push({id:id, patch:plain(patch)});
    Object.assign(docs.get(id), patch);
    return Promise.resolve();
  }})};
  m.items = Array.from(docs.values()).map((d) => Object.assign({}, d));
  return {m:m, docs:docs, writes:writes};
}
const rel = (m, id) => m.relationsOf(id).map((r) => r.kind + ':' + r.id).join(' ');
const blockers = (m, id) => m.blockersOf(id).map((t) => t.id).join('');

TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'done', label:'Hecho', done:true}]);
const SEED = () => [
  {id:'a', title:'A', status:'todo'}, {id:'b', title:'B', status:'todo'}, {id:'c', title:'C', status:'doing'},
  {id:'d', title:'D', status:'done'}, {id:'e', title:'E', status:'todo'},
  {id:'z', title:'Archivada', status:'todo', archivedAt:5}
];

(async () => {
  /* Sin relaciones, nada cambia. */
  {
    const {m, writes} = model(SEED());
    assert.equal(rel(m, 'a'), '');
    assert.equal(blockers(m, 'a'), '');
    assert.equal(await m.setRelation('a', 'b', ''), '', 'quitar lo que no hay no falla');
    assert.equal(writes.length, 0, 'ni escribe');
    assert.ok(!('relatedTo' in m.find('a')) && !('blockedBy' in m.find('a')), 'una tarea sin relaciones no lleva los campos');
    ok('las tareas sin relaciones siguen igual');
  }

  /* Relacionada con: se guarda en una y se ve desde las dos. */
  {
    const {m, docs, writes} = model(SEED());
    assert.equal(await m.setRelation('a', 'b', 'related'), '');
    assert.deepEqual(writes, [{id:'a', patch:{relatedTo:['b']}}], 'una sola escritura');
    assert.equal(rel(m, 'a'), 'related:b');
    assert.equal(rel(m, 'b'), 'related:a');
    assert.equal(blockers(m, 'a') + blockers(m, 'b'), '', 'relacionar no bloquea');
    assert.equal(await m.setRelation('b', 'a', 'related'), '', 'pedirla desde la otra no la duplica');
    assert.deepEqual([plain(docs.get('a').relatedTo), plain(docs.get('b').relatedTo)], [[], ['a']]);
    assert.equal(rel(m, 'a'), 'related:b');
    await m.setRelation('a', 'b', '');
    assert.equal(rel(m, 'a') + rel(m, 'b'), '', 'se quita desde cualquiera de las dos');
    ok('relacionada con');
  }

  /* Dependencias y aviso de bloqueo. */
  {
    const {m, docs} = model(SEED());
    assert.equal(await m.setRelation('a', 'b', 'blockedBy'), '');
    assert.equal(await m.setRelation('a', 'c', 'blocks'), '');
    assert.deepEqual([plain(docs.get('a').blockedBy), plain(docs.get('c').blockedBy)], [['b'], ['a']]);
    assert.equal(rel(m, 'a'), 'blockedBy:b blocks:c');
    assert.equal(rel(m, 'b'), 'blocks:a');
    assert.equal(rel(m, 'c'), 'blockedBy:a');
    assert.equal(blockers(m, 'a'), 'b');
    assert.equal(blockers(m, 'c'), 'a');
    assert.equal(blockers(m, 'b'), '');
    /* B se termina: A deja de estar bloqueada; C sigue esperando a A. */
    m.patchLocal('b', {status:'done'});
    assert.equal(blockers(m, 'a'), '');
    assert.equal(blockers(m, 'c'), 'a');
    assert.equal(rel(m, 'a'), 'blockedBy:b blocks:c', 'la relación sigue ahí aunque ya no bloquee');
    /* Una tarea terminada no está bloqueada aunque espere a otra. */
    m.patchLocal('c', {status:'done'});
    assert.equal(blockers(m, 'c'), '');
    ok('bloqueada por / bloquea a, y cuándo está bloqueada');

    /* Entre dos tareas hay una sola relación: la nueva sustituye a la que había. */
    assert.equal(await m.setRelation('a', 'b', 'related'), '');
    assert.equal(rel(m, 'a'), 'blocks:c related:b');
    assert.deepEqual(plain(docs.get('a').blockedBy), []);
    assert.equal(await m.setRelation('b', 'a', 'blockedBy'), '', 'y se puede dar la vuelta');
    assert.equal(rel(m, 'a'), 'blocks:b blocks:c');
    assert.deepEqual(plain(docs.get('a').relatedTo), []);
    ok('cambiar el tipo de una relación');
  }

  /* Ciclos, uno mismo y tareas que no están. */
  {
    const {m, writes} = model(SEED());
    await m.setRelation('a', 'b', 'blockedBy');
    await m.setRelation('b', 'c', 'blockedBy');
    const n = writes.length;
    assert.equal(await m.setRelation('c', 'a', 'blockedBy'), 'cycle', 'a espera a b, b a c: c no puede esperar a a');
    assert.equal(await m.setRelation('a', 'c', 'blocks'), 'cycle', 'lo mismo dicho al revés');
    assert.equal(await m.setRelation('a', 'a', 'related'), 'self');
    assert.equal(await m.setRelation('a', 'no-existe', 'related'), 'missing');
    assert.equal(await m.setRelation('a', 'z', 'blockedBy'), 'missing', 'una archivada no se puede elegir');
    assert.equal(await m.setRelation('a', 'e', 'inventada'), 'missing');
    assert.equal(writes.length, n, 'nada de eso escribe');
    assert.equal(await m.setRelation('c', 'a', 'related'), '', 'relacionarlas sí se puede');
    assert.equal(await m.setRelation('a', 'c', 'blockedBy'), '', 'y una dependencia que no cierra el círculo');
    ok('no se admiten ciclos ni relaciones imposibles');
  }

  /* Una tarea que desaparece (eliminada o archivada) deja de contar y, si vuelve, cuenta otra vez. */
  {
    const {m} = model(SEED());
    await m.setRelation('a', 'b', 'blockedBy');
    await m.setRelation('a', 'e', 'related');
    const b = m.find('b');
    m.items = m.everything().filter((t) => t.id !== 'b');
    assert.equal(rel(m, 'a'), 'related:e');
    assert.equal(blockers(m, 'a'), '');
    m.items = m.everything().concat([b]);
    assert.equal(rel(m, 'a'), 'blockedBy:b related:e');
    assert.equal(blockers(m, 'a'), 'b');
    m.patchLocal('e', {archivedAt:9});
    assert.equal(rel(m, 'a'), 'blockedBy:b', 'archivada: fuera de la lista');
    ok('una tarea eliminada o archivada no bloquea');
  }

  /* Límite, datos raros y fallo al escribir. */
  {
    const many = Array.from({length:50}, (_, i) => 'x' + i);
    const {m} = model(SEED().concat([{id:'f', title:'F', status:'todo', blockedBy:many, relatedTo:['a', 'a', '', 7, null]}]));
    assert.equal(await m.setRelation('f', 'b', 'blockedBy'), 'limit');
    assert.equal(rel(m, 'f'), 'related:a', 'ids repetidos, vacíos o que no son texto se ignoran');
    assert.deepEqual(plain(TaskModel.relationIds('a')), []);
    const {m:m2} = model(SEED(), {reject:(id) => id === 'a'});
    await assert.rejects(m2.setRelation('a', 'b', 'blockedBy'));
    assert.equal(rel(m2, 'a'), '', 'si no se guarda, lo local vuelve a como estaba');
    ok('límite de 50, datos raros y escritura rechazada');
  }

  /* La copia de una tarea no hereda sus relaciones. */
  const copy = TaskModel.copyOf({id:'a', title:'A', relatedTo:['b'], blockedBy:['c']});
  assert.ok(!('relatedTo' in copy) && !('blockedBy' in copy));
  ok('duplicar no copia las relaciones');
  console.log('Todo correcto.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
