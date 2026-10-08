/* Importador de Trello y plantillas de proyecto: el JSON de un tablero se convierte en la semilla
   de un proyecto (etapas, etiquetas, tareas, subtareas y notas), y la semilla se escribe dentro de
   los límites de las reglas.
   Con la ruta de un JSON exportado de Trello como argumento, enseña además qué saldría de él:
     node tests/trello/trello-import.test.js ruta/al/tablero.json */
process.env.TZ = 'UTC';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Workhub = {models:{}, utils:{}, t:(text, params) => (params ? text.replace(/\{(\w+)\}/g, (_, k) => params[k]) : text)};
const ctx = vm.createContext({Workhub, Date, Promise, JSON, String, Math, Array, Object, parseInt, isNaN, setTimeout});
['utils/pool', 'models/project-templates', 'models/project-seed', 'models/project-gallery', 'models/trello-import'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', f + '.js'), 'utf8'), ctx);
});
const {TrelloImport, ProjectSeed, ProjectGallery, ProjectTemplates} = Workhub.models;
/* Lo que sale del otro contexto (vm) se copia para compararlo. */
const plain = (x) => JSON.parse(JSON.stringify(x));

/* Ids como los de Trello: los 8 primeros caracteres son la fecha de creación. */
const id = (n, at) => Math.floor(Date.parse(at || '2024-03-01T10:00:00Z') / 1000).toString(16) + ('0000000000000000' + n).slice(-16);

/* Las dos tarjetas con checklists y comentarios tienen su propia fecha de creación. */
const CARD1 = id(30, '2024-03-01T09:30:00Z');
const CARD2 = id(31, '2024-03-02T08:00:00Z');

function board(){
  return {
    name:'Tablero de prueba',
    desc:'Descripción del tablero',
    lists:[
      {id:id(2), name:'Doing', pos:200, closed:false, softLimit:3},
      {id:id(1), name:'To do', pos:100, closed:false},
      {id:id(3), name:'Done ✅', pos:300, closed:false},
      {id:id(4), name:'Lista archivada', pos:400, closed:true}
    ],
    labels:[
      {id:id(10), name:'', color:'orange'},
      {id:id(11), name:'Urgente', color:'red'},
      {id:id(12), name:'Urgente', color:'blue_dark'},
      {id:id(13), name:'Sin usar', color:null}
    ],
    members:[{id:id(20), fullName:'Ana Pérez', username:'ana'}],
    cards:[
      {id:CARD2, name:'Segunda', pos:20, idList:id(1), closed:false, desc:'', idLabels:[], due:null,
        cover:{idAttachment:id(70), color:null, size:'normal', brightness:'dark', scaled:[{url:'https://example.com/a.jpg'}]}},
      {id:CARD1, name:'Primera', pos:10, idList:id(1), closed:false, desc:'**Hola**', idLabels:[id(10), id(11), id(12)],
        due:'2024-04-15T17:27:00.000Z', start:'2024-04-01T06:00:00.000Z', dueReminder:1440, idMembers:[id(20)], dateLastActivity:'2024-03-05T12:00:00.000Z',
        attachments:[{name:'doc', url:'https://example.com/doc'}], coordinates:{latitude:40.4, longitude:-3.7},
        cover:{idAttachment:null, color:'sky', size:'full', brightness:'light'}},
      {id:id(32), name:'', pos:10, idList:id(2), closed:false, desc:'', idLabels:[], cover:{idAttachment:null, color:null, size:'normal'}},
      {id:id(33), name:'Archivada', pos:30, idList:id(1), closed:true, desc:'', idLabels:[]},
      {id:id(34), name:'En lista archivada', pos:10, idList:id(4), closed:false, desc:'', idLabels:[]}
    ],
    checklists:[
      {id:id(41), idCard:CARD1, name:'Segunda lista', pos:2, checkItems:[{id:id(52), name:'B1', pos:1, state:'incomplete'}]},
      {id:id(40), idCard:CARD1, name:'Primera lista', pos:1, checkItems:[
        {id:id(51), name:'A2', pos:2, state:'complete'}, {id:id(50), name:'A1', pos:1, state:'incomplete'}]},
      {id:id(42), idCard:CARD2, name:'Única', pos:1, checkItems:[{id:id(53), name:'Solo', pos:1, state:'complete'}]}
    ],
    actions:[
      {id:id(61), type:'commentCard', date:'2024-03-04T10:00:00.000Z', data:{text:'Segundo comentario', card:{id:CARD1}}, memberCreator:{fullName:'Ana Pérez'}},
      {id:id(60), type:'commentCard', date:'2024-03-03T10:00:00.000Z', data:{text:'Primer comentario 🙂', card:{id:CARD1}}, memberCreator:{fullName:'Ana Pérez'}},
      {id:id(62), type:'updateCard', date:'2024-03-04T11:00:00.000Z', data:{card:{id:CARD1}}}
    ]
  };
}

(async () => {
  const seed = TrelloImport.parse(JSON.stringify(board()));

  /* Tablero y listas. */
  assert.equal(seed.source, 'trello');
  assert.equal(seed.nombre, 'Tablero de prueba');
  assert.deepEqual(plain(seed.stages), [
    {key:'t1', label:'To do', color:'gray', done:false},
    {key:'t2', label:'Doing', color:'blue', done:false, limit:3},
    {key:'t3', label:'Done ✅', color:'green', done:true}
  ], 'listas abiertas en su orden, con el límite y la etapa final por su nombre');
  console.log('OK   trello: las listas abiertas pasan a ser etapas');

  /* Etiquetas. */
  assert.deepEqual(plain(seed.labels), [
    {name:'Naranja', color:'fea362'},
    {name:'Urgente', color:'f87168'},
    {name:'Urgente (Azul oscuro)', color:'0c66e4'},
    {name:'Sin usar', color:'6e7681'}
  ], 'sin nombre → su color; mismo nombre y otro color → se distinguen');
  console.log('OK   trello: las etiquetas forman el catálogo del proyecto');

  /* Tarjetas. */
  assert.deepEqual(plain(seed.tasks.map((t) => [t.status, t.title, t.order])), [
    ['t1', 'Primera', 1024], ['t2', '(sin título)', 1024], ['t1', 'Segunda', 2048]
  ], 'solo las abiertas de listas abiertas');
  const first = seed.tasks.find((t) => t.title === 'Primera');
  const second = seed.tasks.find((t) => t.title === 'Segunda');
  assert.equal(first.desc, '**Hola**');
  assert.equal(first.dueDate, '2024-04-15');
  assert.equal(first.dueTime, '17:27');
  assert.deepEqual(plain(first.labels), ['Naranja', 'Urgente', 'Urgente (Azul oscuro)']);
  assert.equal(first.createdAt, Date.parse('2024-03-01T09:30:00Z'), 'la fecha de creación sale del id');
  assert.equal(first.updatedAt, Date.parse('2024-03-05T12:00:00Z'));
  assert.equal(second.dueDate, '');
  assert.ok(first.order < second.order, 'el orden de Trello se conserva dentro de la lista');
  console.log('OK   trello: las tarjetas pasan a ser tareas con su fecha, etiquetas y orden');

  /* Checklists y comentarios. */
  assert.deepEqual(plain(first.checklist.map((c) => [c.text, c.done])), [
    ['Primera lista · A1', false], ['Primera lista · A2', true], ['Segunda lista · B1', false]
  ], 'varias checklists: cada subtarea lleva delante el nombre de la suya');
  assert.deepEqual(plain(second.checklist.map((c) => [c.text, c.done])), [['Solo', true]]);
  assert.deepEqual(plain(first.notes.map((n) => n.text)), ['Ana Pérez: Primer comentario 🙂', 'Ana Pérez: Segundo comentario']);
  assert.deepEqual(plain(seed.counts), {lists:3, cards:3, labels:4, checkItems:4, comments:2});
  assert.deepEqual(plain(seed.skipped), {archivedCards:2, archivedLists:1, mergedLists:0, labels:0, imageCovers:1});
  assert.match(TrelloImport.summary(seed), /listas: 3 · tarjetas: 3 · etiquetas: 4 · subtareas: 4 · comentarios: 2/);
  assert.match(TrelloImport.summary(TrelloImport.parse(JSON.stringify(board()))), /archivadas que no se importan: 2/);
  console.log('OK   trello: checklists → subtareas y comentarios → notas');

  /* Lo que Kanlane aún no tiene no se cuela en la tarea (está leído, pero comentado). */
  ['startDate', 'dueReminder', 'members', 'attachments', 'location', 'votes'].forEach((k) => assert.ok(!(k in first), k));

  /* Portadas: la de color pasa al color de Kanlane más parecido; la de imagen no viene en el archivo y se avisa. */
  assert.deepEqual(plain(first.cover), {color:'blue'}, 'celeste → azul');
  assert.ok(!('cover' in second), 'la portada de imagen no se importa');
  assert.ok(!('cover' in seed.tasks.find((t) => t.title === '(sin título)')), 'sin portada');
  assert.match(TrelloImport.summary(seed), /Portadas de imagen que no se importan[^:]*: 1\./);
  console.log('OK   trello: las portadas de color se conservan y las de imagen se avisan');

  /* Más listas de las que admite Kanlane (500, como Trello): las que sobran se juntan en la última etapa. */
  const big = board();
  big.lists = [];
  for(let i = 1; i <= 503; i++) big.lists.push({id:id(100 + i), name:'Lista ' + i, pos:i, closed:false});
  big.cards = [{id:id(200), name:'En la penúltima', pos:1, idList:id(602), closed:false, idLabels:[]}];
  const merged = TrelloImport.parse(big);
  assert.equal(merged.stages.length, 500);
  assert.equal(ProjectTemplates.normalizeStages(merged.stages).length, 500, 'caben todas en el proyecto');
  assert.equal(merged.skipped.mergedLists, 3);
  assert.equal(merged.tasks[0].status, 't500');
  assert.deepEqual(plain(merged.tasks[0].labels), ['Lista 502']);
  assert.ok(merged.stages[499].done && merged.stages.filter((s) => s.done).length === 1);
  const sales = board();
  sales.lists = [{id:id(1), name:'Leads', pos:1}, {id:id(2), name:'Win', pos:2}, {id:id(3), name:'Lost', pos:3}];
  assert.deepEqual(plain(TrelloImport.parse(sales).stages.map((s) => [s.color, s.done])), [['gray', false], ['green', true], ['red', true]], 'ganado y perdido son finales');
  console.log('OK   trello: con más de 500 listas, las que sobran se juntan sin perder tarjetas');

  /* Archivos que no son de Trello. */
  assert.throws(() => TrelloImport.parse('{no es json'), (e) => e.code === 'bad-json');
  assert.throws(() => TrelloImport.parse('{"tasks":[]}'), (e) => e.code === 'not-trello');
  assert.throws(() => TrelloImport.parse({lists:[{id:id(1), name:'Una'}], cards:[]}), (e) => e.code === 'few-lists');
  console.log('OK   trello: se rechaza lo que no es un tablero exportado');

  /* La semilla se guarda como un proyecto personalizado y sus tareas caben en las reglas. */
  const config = ProjectSeed.config(seed);
  assert.equal(config.tipo, ProjectTemplates.CUSTOM_TYPE);
  assert.equal(plain(ProjectTemplates.resolve(config)).stages[1].limit, 3);
  assert.equal(config.labels.length, 4);
  const ALLOWED = ['title', 'desc', 'cliente', 'status', 'contacto', 'dueDate', 'dueTime', 'repeat', 'checklist', 'labels', 'assignees',
    'linkedContacts', 'linkedVault', 'order', 'createdAt', 'updatedAt', 'repeatSpawned', 'cover'];
  const written = [];
  const notes = [];
  const model = {
    add:async (body) => { if(body.title === 'falla') throw new Error('no'); written.push(body); return {id:'d' + written.length}; },
    addNoteRaw:async (taskId, note) => { notes.push([taskId, note]); }
  };
  const long = plain(seed);
  long.tasks.push({title:'x'.repeat(900), desc:'y'.repeat(30000), status:'no-existe', dueDate:'mal', dueTime:'99:99',
    labels:Array.from({length:1200}, (_, i) => 'l' + i), checklist:Array.from({length:250}, (_, i) => ({text:'c' + i})), notes:[{text:'z'.repeat(30000)}]});
  long.tasks.push({title:'falla'});
  const res = await ProjectSeed.write(model, long);
  assert.deepEqual(plain(res), {tasks:4, notes:3, failed:1}, 'un fallo no detiene el resto');
  written.forEach((b) => Object.keys(b).forEach((k) => assert.ok(ALLOWED.includes(k), 'campo no admitido por las reglas: ' + k)));
  assert.deepEqual(plain(written.map((b) => b.cover || null)).filter(Boolean), [{color:'blue'}], 'la portada de color se escribe en la tarea');
  const capped = written.find((b) => b.title[0] === 'x');
  assert.equal(capped.title.length, 500);
  assert.equal(capped.desc.length, 20000);
  assert.equal(capped.status, 't1', 'una etapa que no existe cae en la primera');
  assert.equal(capped.dueDate, '');
  assert.ok(!('dueTime' in capped));
  assert.equal(capped.labels.length, 1000);
  assert.equal(capped.checklist.length, 200);
  assert.ok(notes.every(([, n]) => n.text.length <= 20000 && n.kind === 'note'));
  const stopped = await ProjectSeed.write(model, seed, {alive:() => false});
  assert.deepEqual(plain(stopped), {tasks:0, notes:0, failed:3}, 'si se abre otro proyecto no se escribe en él');
  console.log('OK   semilla: se escribe recortada a los límites y solo con campos admitidos');

  /* Plantillas: todas dan un proyecto válido. */
  const gallery = ProjectGallery.list();
  assert.ok(gallery.length >= 4);
  gallery.forEach((g) => {
    const s = ProjectGallery.seed(g.key);
    const stages = ProjectTemplates.normalizeStages(s.stages);
    assert.equal(stages.length, s.stages.length, g.key + ': etapas válidas');
    assert.ok(stages.length >= ProjectTemplates.MIN_STAGES && stages.length <= ProjectTemplates.MAX_STAGES);
    assert.ok(stages.some((st) => st.done), g.key + ': tiene etapa final');
    const names = s.labels.map((l) => l.name);
    s.tasks.forEach((t) => {
      assert.ok(stages.some((st) => st.key === t.status), g.key + ': etapa de «' + t.title + '»');
      t.labels.forEach((n) => assert.ok(names.includes(n), g.key + ': etiqueta «' + n + '» en el catálogo'));
    });
    s.labels.forEach((l) => assert.match(l.color, /^[0-9a-f]{6}$/));
    assert.equal(ProjectSeed.config(s).clients, g.clients);
  });
  assert.equal(ProjectGallery.seed('no-existe'), null);
  console.log('OK   plantillas: ' + gallery.length + ' plantillas con etapas, etiquetas y tareas coherentes');

  /* Opcional: un tablero real. */
  const file = process.argv[2];
  if(file){
    const real = TrelloImport.parse(fs.readFileSync(file, 'utf8'));
    console.log('\n' + real.nombre + '\n' + TrelloImport.summary(real));
    console.log(real.stages.map((s) => '  ' + s.key + ' ' + s.label + ' [' + s.color + (s.done ? ', final' : '') + ']').join('\n'));
    console.log(real.labels.map((l) => l.name + ' #' + l.color).join(', '));
    real.tasks.forEach((t) => console.log('  ' + t.status + ' · ' + t.title + (t.dueDate ? ' · ' + t.dueDate + ' ' + t.dueTime : '') +
      (t.labels.length ? ' · ' + t.labels.join(', ') : '') + (t.checklist.length ? ' · ' + t.checklist.length + ' subtareas' : '') + (t.notes.length ? ' · ' + t.notes.length + ' notas' : '')));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
