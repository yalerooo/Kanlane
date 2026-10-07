/* Repetición de tareas: la mensual y la anual conservan el día original aunque un mes no lo tenga
   (31 oct → 30 nov → 31 dic), y lo mismo en el servidor MCP, que crea la siguiente por su cuenta. */
process.env.TZ = 'UTC';
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

/* Fechas lejanas: nextDue salta las que ya han pasado, y aquí no debe saltar ninguna. */
function model(reject){
  const m = new TaskModel();
  const made = [];
  m.col = {
    add:(data) => (reject && reject(data) ? Promise.reject(new Error('permission-denied')) : (made.push(JSON.parse(JSON.stringify(data))), Promise.resolve({id:'n' + made.length}))),
    doc:() => ({update:() => Promise.resolve()})
  };
  return {m:m, made:made};
}
/* Completa la tarea una y otra vez y devuelve las fechas de las siguientes. */
async function chain(m, made, first, times){
  let t = first;
  const out = [];
  for(let i = 0; i < times; i++){
    await m.spawnNext(t);
    t = Object.assign({id:'x' + i}, made[made.length - 1]);
    out.push(t.dueDate);
  }
  return out;
}

(async () => {
  TaskModel.setStages([{key:'todo', label:'Por hacer'}, {key:'done', label:'Hecho', done:true}]);

  {
    const {m, made} = model();
    assert.deepEqual(await chain(m, made, {id:'a', title:'Informe', dueDate:'2030-10-31', repeat:'monthly'}, 5),
      ['2030-11-30', '2030-12-31', '2031-01-31', '2031-02-28', '2031-03-31']);
    assert.deepEqual(made.map((t) => t.repeatAnchor), ['31@2030-11-30', undefined, undefined, '31@2031-02-28', undefined], 'solo se guarda cuando el mes recorta el día');
    ok('mensual: el día 31 vuelve cuando el mes lo tiene');
  }
  {
    const {m, made} = model();
    assert.deepEqual(await chain(m, made, {id:'a', dueDate:'2030-01-30', repeat:'monthly'}, 3), ['2030-02-28', '2030-03-30', '2030-04-30']);
    const b = model();
    assert.deepEqual(await chain(b.m, b.made, {id:'a', dueDate:'2030-11-30', repeat:'monthly'}, 2), ['2030-12-30', '2031-01-30'], 'un día 30 de verdad sigue siendo 30');
    assert.deepEqual(b.made.map((t) => t.repeatAnchor), [undefined, undefined]);
    const c = model();
    assert.deepEqual(await chain(c.m, c.made, {id:'a', dueDate:'2030-10-15', repeat:'monthly'}, 2), ['2030-11-15', '2030-12-15']);
    ok('mensual: los días que existen en todos los meses no cambian');
  }
  {
    const {m, made} = model();
    assert.deepEqual(await chain(m, made, {id:'a', dueDate:'2032-02-29', repeat:'yearly'}, 4), ['2033-02-28', '2034-02-28', '2035-02-28', '2036-02-29']);
    ok('anual: el 29 de febrero vuelve en el siguiente bisiesto');
  }
  {
    /* Quien cambia la fecha a mano elige un día nuevo: la marca anterior ya no cuenta. */
    assert.equal(TaskModel.repeatDay({dueDate:'2030-11-30', repeatAnchor:'31@2030-11-30'}), 31);
    assert.equal(TaskModel.repeatDay({dueDate:'2030-11-28', repeatAnchor:'31@2030-11-30'}), 0);
    assert.equal(TaskModel.repeatDay({dueDate:'2030-11-30', repeatAnchor:'40@2030-11-30'}), 0);
    assert.equal(TaskModel.repeatDay({dueDate:'2030-11-30', repeatAnchor:'basura'}), 0);
    const {m, made} = model();
    assert.deepEqual(await chain(m, made, {id:'a', dueDate:'2031-02-28', repeat:'monthly', repeatAnchor:'31@2030-11-30'}, 1), ['2031-03-28']);
    ok('una fecha cambiada a mano manda sobre el día guardado');
  }
  {
    const {m, made} = model();
    const weekly = await chain(m, made, {id:'a', dueDate:'2030-10-31', repeat:'weekly'}, 2);
    const b = model();
    const daily = await chain(b.m, b.made, {id:'a', dueDate:'2030-10-31', repeat:'daily'}, 2);
    const c = model();
    const biweekly = await chain(c.m, c.made, {id:'a', dueDate:'2030-10-31', repeat:'biweekly'}, 2);
    assert.deepEqual([weekly, daily, biweekly], [['2030-11-07', '2030-11-14'], ['2030-11-01', '2030-11-02'], ['2030-11-14', '2030-11-28']]);
    assert.ok(made.concat(b.made, c.made).every((t) => !('repeatAnchor' in t)));
    ok('las demás frecuencias no cambian ni guardan el día');
  }
  {
    /* Con unas reglas publicadas que aún no admiten el campo, la siguiente se crea igual, sin él. */
    const {m, made} = model((data) => 'repeatAnchor' in data);
    assert.equal(await m.spawnNext({id:'a', dueDate:'2030-10-31', repeat:'monthly'}), '2030-11-30');
    assert.deepEqual(made.map((t) => [t.dueDate, t.repeatAnchor]), [['2030-11-30', undefined]]);
    ok('si el campo se rechaza, la repetición no se pierde');
  }
  {
    const M = await import(require('node:url').pathToFileURL(path.join(__dirname, '../../worker/mcp.mjs')).href);
    assert.equal(M.nextDue('2030-11-30', 'monthly', '2030-01-01', M.repeatDay({dueDate:'2030-11-30', repeatAnchor:'31@2030-11-30'})), '2030-12-31');
    assert.equal(M.nextDue('2030-11-30', 'monthly', '2030-01-01', M.repeatDay({dueDate:'2030-11-30'})), '2030-12-30');
    assert.equal(M.nextDue('2030-11-30', 'monthly', '2030-01-01'), '2030-12-30');
    assert.equal(M.repeatDay({dueDate:'2030-11-29', repeatAnchor:'31@2030-11-30'}), 0);
    ok('servidor MCP: la misma cuenta');
  }
  console.log('\nTodo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
