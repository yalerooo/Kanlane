/* Urgencia de las tareas, cuándo llegó cada una a su columna y limpieza automática de las columnas
   de terminadas. Lo que más importa: nunca se elimina una tarea que no ha cumplido su tiempo.
   Uso: node tests/tasks/priority-arrival.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}, utils:{}, services:{}, views:{team:{enabled:() => false}}, i18n:{locale:'es-ES'}, t:(text) => text};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Number, Object, Array, isNaN, isFinite, setTimeout});
['core/emitter', 'utils/dates', 'models/collection-model', 'models/project-templates', 'models/task-model'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TaskModel, ProjectTemplates} = Workhub.models;
const ok = (name) => console.log('OK   ' + name);
const DAY = 86400000;

function model(seed){
  const docs = new Map(seed.map((d) => [d.id, Object.assign({}, d)]));
  const writes = [];
  const m = new TaskModel();
  m.col = {doc:(id) => ({
    update:(patch) => { writes.push({id:id, patch:patch}); Object.assign(docs.get(id), patch); return Promise.resolve(); },
    set:(data) => { docs.set(id, Object.assign({id:id}, data)); return Promise.resolve(); }
  })};
  m.items = Array.from(docs.values()).map((d) => Object.assign({}, d));
  return {m:m, docs:docs, writes:writes};
}
const ids = (list) => list.map((t) => t.id).join('');
const STAGES = [{key:'todo', label:'Por hacer'}, {key:'doing', label:'En curso'}, {key:'done', label:'Hecho', done:true, autoDelete:30}];

(async () => {
  TaskModel.setStages(STAGES);

  {
    const {m, writes} = model([
      {id:'a', title:'a', status:'todo', order:1},
      {id:'b', title:'b', status:'todo', order:2, priority:'low'},
      {id:'c', title:'c', status:'todo', order:3, priority:'high'},
      {id:'d', title:'d', status:'todo', order:4, priority:'medium'},
      {id:'e', title:'e', status:'todo', order:5, priority:'rara'}
    ]);
    const before = m.sortColumn('todo', 'priority');
    assert.equal(ids(m.inStatus('todo')), 'cdbae', 'alta, media y baja; sin urgencia (o una que no vale) al final y en su orden');
    assert.equal(ids(before), 'abcde');
    assert.ok(writes.every((w) => Object.keys(w.patch).join() === 'order'), 'ordenar solo escribe el orden');
    assert.equal(TaskModel.priorityOf({priority:'rara'}), null);
    ok('ordenar por urgencia');
  }

  {
    const {m} = model([
      {id:'a', title:'a', status:'done', order:1, statusAt:300},
      {id:'b', title:'b', status:'done', order:2, statusAt:100},
      {id:'c', title:'c', status:'done', order:3, updatedAt:200, createdAt:1},
      {id:'d', title:'d', status:'done', order:4, createdAt:400}
    ]);
    m.sortColumn('done', 'arrived-new');
    assert.equal(ids(m.inStatus('done')), 'dacb', 'recientes primero; sin statusAt, su modificación o su creación');
    m.sortColumn('done', 'arrived-old');
    assert.equal(ids(m.inStatus('done')), 'bcad', 'antiguas primero');
    ok('ordenar por llegada a la columna en los dos sentidos');
  }

  {
    const {m, docs, writes} = model([
      {id:'a', title:'a', status:'todo', order:1, statusAt:5},
      {id:'b', title:'b', status:'todo', order:2, statusAt:5}
    ]);
    const start = Date.now();
    m.move('a', 'done');
    assert.ok(docs.get('a').statusAt >= start, 'al cambiar de columna se apunta la llegada');
    writes.length = 0;
    m.move('b', 'todo', 'a');
    m.move('a', 'done');
    assert.equal(docs.get('b').statusAt, 5, 'reordenar sin cambiar de columna no la toca');
    await m.save('b', {title:'nuevo', status:'todo'});
    assert.equal(docs.get('b').statusAt, 5, 'guardar sin cambiar de columna no la toca');
    await m.save('b', {title:'nuevo', status:'done'});
    assert.ok(docs.get('b').statusAt >= start, 'guardar cambiando de columna, sí');
    assert.equal(TaskModel.copyOf({id:'x', statusAt:9, priority:'high', title:'t'}).statusAt, undefined, 'la copia no hereda la llegada');
    assert.equal(TaskModel.copyOf({id:'x', statusAt:9, priority:'high', title:'t'}).priority, 'high', 'la copia conserva la urgencia');
    ok('statusAt solo cambia al cambiar de columna');
  }

  {
    const now = Date.UTC(2030, 0, 31);
    const {m} = model([
      {id:'caducada', title:'x', status:'done', statusAt:now - 31 * DAY},
      {id:'justa', title:'x', status:'done', statusAt:now - 30 * DAY},
      {id:'reciente', title:'x', status:'done', statusAt:now - 29 * DAY},
      {id:'editada', title:'x', status:'done', statusAt:now - 40 * DAY, updatedAt:now - DAY},
      {id:'antigua', title:'x', status:'done', updatedAt:now - 900 * DAY},
      {id:'abierta', title:'x', status:'todo', statusAt:now - 900 * DAY},
      {id:'archivada', title:'x', status:'done', statusAt:now - 900 * DAY, archivedAt:5},
      {id:'ilegible', title:'', status:'done', statusAt:now - 900 * DAY, _undecryptable:true},
      {id:'huerfana', title:'x', status:'columna-borrada', statusAt:now - 900 * DAY}
    ]);
    const {remove, unstamped} = m.expiredDone(now);
    assert.deepEqual(Array.from(remove), ['caducada', 'justa'], 'solo las que han cumplido su tiempo');
    assert.deepEqual(Array.from(unstamped), ['antigua'], 'sin fecha de llegada no se elimina: empieza a contar');
    ok('qué tareas caducan');

    TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'done', label:'Hecho', done:true}]);
    assert.equal(m.expiredDone(now).remove.length, 0, 'sin la opción no se elimina nada');
    TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'done', label:'Hecho', done:false, autoDelete:30}]);
    assert.equal(m.expiredDone(now).remove.length, 0, 'una columna que no es de terminadas no elimina');
    TaskModel.setStages(STAGES);
  }

  {
    const now = Date.UTC(2030, 0, 31);
    const {m, docs, writes} = model([{id:'antigua', title:'x', status:'done', updatedAt:now - 900 * DAY}]);
    m.stampArrival(['antigua'], now);
    assert.equal(docs.get('antigua').statusAt, now);
    assert.equal(Object.keys(writes[0].patch).join(), 'statusAt', 'no toca updatedAt');
    assert.equal(m.expiredDone(now).remove.length, 0);
    assert.equal(m.expiredDone(now + 30 * DAY).remove.length, 1, 'a los 30 días de empezar a contar, sí');
    ok('las tareas antiguas empiezan a contar al activar la opción');
  }

  {
    const old = Date.now() - 900 * DAY;
    const {m, docs} = model([{id:'a', title:'x', status:'done', statusAt:old}]);
    const snap = m.snapshot('a');
    docs.delete('a');
    m.items = [];
    await m.restore(snap);
    assert.ok(docs.get('a').statusAt > old, 'deshacer no la deja a punto de eliminarse otra vez');
    m.items = [Object.assign({}, docs.get('a'))];
    assert.equal(m.expiredDone(Date.now()).remove.length, 0);
    ok('deshacer la eliminación reinicia su tiempo');
  }

  {
    const old = Date.now() - 900 * DAY;
    const {m, docs} = model([{id:'a', title:'x', status:'done', statusAt:old, archivedAt:5}]);
    await m.unarchive('a');
    assert.ok(docs.get('a').statusAt > old);
    assert.equal(m.expiredDone(Date.now()).remove.length, 0, 'sacarla del archivo tampoco la elimina');
    ok('restaurar del archivo reinicia su tiempo');
  }

  {
    const norm = (s) => ProjectTemplates.normalizeStages ? ProjectTemplates.normalizeStages(s) : ProjectTemplates.cleanStages(s);
    const out = norm([{key:'a', label:'A', autoDelete:7}, {key:'b', label:'B', done:true, autoDelete:'30'}, {key:'c', label:'C', done:true, autoDelete:0}, {key:'d', label:'D', done:true, autoDelete:99999}]);
    assert.equal(out[0].autoDelete, undefined, 'solo en columnas de terminadas');
    assert.equal(out[1].autoDelete, 30);
    assert.equal(out[2].autoDelete, undefined);
    assert.equal(out[3].autoDelete, undefined, 'fuera de rango');
    ok('la opción de la columna se valida');
  }

  console.log('Todo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
