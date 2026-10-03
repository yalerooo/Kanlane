/* Cifrado por proyecto, PR11 del plan (docs/CIFRADO-PROYECTOS.md, 13.2): convertir un proyecto «Solo
   contraseñas» en uno con cifrado total. Qué se puede convertir, que nada se escribe hasta confirmar
   la clave de recuperación, que todo lo que estaba en claro queda sellado, y lo que pasa si falla o
   se corta a medias. Web Crypto real de Node y el Firestore en memoria de las pruebas (sin reglas:
   eso es tests/rules y tests/e2e/crypto-convert.js).
   Uso: node tests/crypto/project-convert.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fakeDb} = require('./fake-firestore.js');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
/* Espera a que una operación en segundo plano avise con un mensaje (como mucho 5 s). */
async function toasted(){
  for(let i = 0; i < 500 && !toasts.length; i++) await tick(10);
  await tick(10);
}

const keys = new Map();
const keystore = {
  put:(rec) => { keys.set(rec.uid + ':' + rec.pid, Object.assign({}, rec)); return Promise.resolve('disk'); },
  get:(uid, pid) => Promise.resolve(keys.get(uid + ':' + pid) || null),
  forget:(uid, pid) => { keys.delete(uid + ':' + pid); return Promise.resolve(1); },
  forgetProject:() => Promise.resolve(1),
  forgetUser:(uid) => { [...keys.keys()].filter((k) => k.indexOf(uid + ':') === 0).forEach((k) => keys.delete(k)); return Promise.resolve(1); },
  onChange:() => {}
};
const toasts = [];
const Workhub = {
  services:{platform:{mode:() => 'firebase', download:() => Promise.resolve()}, keystore:keystore},
  models:{}, controllers:{}, features:{encryptedProjects:true},
  utils:{html:{hueFor:() => 0}, urls:{safeUrl:(u) => u || ''}},
  t:(s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m)),
  i18n:{locale:'es-ES', lang:'es'},
  views:{
    team:{enabled:() => false, meUid:() => '', name:() => '', assigned:() => []},
    toast:{success:(m) => toasts.push(m), error:(m) => toasts.push('ERROR ' + m)}
  }
};
const quiet = {error:() => {}, log:() => {}, warn:() => {}};
['src/core/emitter.js', 'src/utils/dates.js', 'src/utils/pool.js', 'src/services/crypto.js',
  'src/services/project-crypto.js', 'src/models/enc-schema.js', 'src/models/project-cipher.js',
  'src/models/collection-model.js', 'src/models/project-templates.js', 'src/models/task-model.js',
  'src/models/project-model.js', 'src/models/team-model.js', 'src/models/project-reseal.js',
  'src/controllers/project-crypto-controller.js', 'src/controllers/key-rotation-controller.js',
  'src/controllers/project-convert-controller.js', 'src/controllers/app-controller.js'
].forEach((rel) => new Function('Workhub', 'window', 'crypto', 'console', read(rel))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto, quiet));

const PC = Workhub.services.projectCrypto;
const b64 = Workhub.services.crypto;
const {ProjectModel, TeamModel, ProjectCipher, ProjectReseal, CollectionModel} = Workhub.models;
const {ProjectCryptoController, KeyRotationController, ProjectConvertController, AppController} = Workhub.controllers;
const coded = (c) => (err) => { assert.equal(err && err.code, c, String(err && err.message)); return true; };

const PASSWORD = 'una contraseña de cifrado larga';
const JPEG = 'data:image/jpeg;base64,';
const imageBytes = new Uint8Array(300).map((v, i) => (i * 11) % 256);

function accountDb(store, me){
  const base = 'users/' + me.uid + '/';
  return {me:me, collection:(p) => store.collection(base + p), doc:(p) => store.doc(base + p)};
}

function fakeApp(db){
  const projects = new ProjectModel();
  projects.connect(db);
  const view = {
    shown:null, error:'', mode:'', progress:[], closedDialog:0,
    bind(){}, show(){}, showRotated(){}, showManaged(){}, setBusy(){}, showError(msg){ this.error = msg; },
    showKey(text){ this.shown = text; }, showKeyError(msg){ this.error = msg; }, showRecoverError(msg){ this.error = msg; },
    setDialogBusy(){}, showDialogError(msg){ this.error = msg; }, closeDialog(){ this.closedDialog++; },
    showDialogKey(text, mode){ this.shown = text; this.mode = mode || 'recovery-key'; },
    openConvert(){ this.mode = 'convert'; },
    setRunProgress(text){ this.progress.push(text); }
  };
  const app = {rootDb:db, projectId:'', cipher:null, models:{projects:projects, team:new TeamModel(projects)}, controllers:{}, view:view,
    projectKey:AppController.prototype.projectKey,
    connectProject(){
      const p = projects.get(this.projectId);
      this.cipher = null;
      if(!ProjectModel.isEncrypted(p)) return (this.connecting = Promise.resolve(null));
      return (this.connecting = this.projectKey(p.enc).then((c) => {
        this.cipher = c;
        if(c){ this.controllers.rotation.onOpen(); this.controllers.convert.onOpen(); }
        return c;
      }));
    }};
  app.controllers.crypto = new ProjectCryptoController(app, view);
  app.controllers.rotation = new KeyRotationController(app, view);
  app.controllers.convert = new ProjectConvertController(app, view);
  return app;
}

async function open(app, id){
  app.projectId = id;
  await app.connectProject();
  await tick(5);
  return app.cipher;
}

/* Datos en claro de un proyecto, como los guarda la app sin cifrado. base: ruta de sus colecciones. */
async function seed(store, base, assets, tag){
  const put = (p, id, data) => store.collection(base + p).doc(id).set(data);
  await put('tasks', 't1', {title:'Tarea ' + tag, desc:'Descripción reservada', cliente:'Cliente ' + tag, status:'pendiente', order:1, dueDate:'2026-10-09',
    labels:['urgente'], checklist:[{id:'a', text:'Paso secreto', done:false}], createdAt:1, updatedAt:2,
    ghItemId:'PVTI_x', ghUrl:'https://github.com/x/y/issues/1', ghSyncedAt:5});
  await put('tasks', 't2', {title:'Otra tarea ' + tag, status:'proceso', order:2, createdAt:3, updatedAt:3});
  await put('tasks/t1/notes', 'n1', {text:'Nota confidencial ' + tag, createdAt:4, imageAssetId:'img-' + tag});
  await put('tasks/t1/notes', 'n2', {text:'Otra nota', createdAt:5});
  await put('clients', 'c1', {nombre:'Cliente ' + tag, color:3, createdAt:1});
  await put('contacts', 'k1', {cliente:'Cliente ' + tag, nombre:'Persona de contacto', email:'persona@example.test', telefono:'600', notas:'Notas del contacto', createdAt:1, updatedAt:1});
  await put('meetings', 'm1', {title:'Reunión reservada', cliente:'Cliente ' + tag, date:'2026-10-05', start:'10:00', end:'11:00', notas:'Orden del día', createdAt:1, updatedAt:1});
  await put('vault', 'v1', {tipo:'web', cliente:'Cliente ' + tag, label:'Servidor de producción', usuario:'root', web:'https://interno.example.test',
    iv:'iv-del-cofre', cipher:'cifrado-del-cofre', ivV2:'iv2', cipherV2:'cifrado2', order:1, createdAt:1, updatedAt:1});
  await put('vault_meta', 'check', {saltPassword:'sal', ivPassword:'iv', cipherPassword:'c'});
  await put('plugin_data', 'workhub.informe', {values:{dato:'valor privado'}, updatedAt:1});
  await put('plugin_data', 'install:workhub.informe', {_kind:'plugin-install', pluginId:'workhub.informe', url:'x', installedAt:1});
  await store.collection(assets).doc('img-' + tag).set({data:JPEG + b64.b64encode(imageBytes), contentType:'image/jpeg', createdAt:4});
}
const SECRETS = ['Tarea', 'Descripción reservada', 'Paso secreto', 'urgente', 'Nota confidencial', 'Otra nota', 'Cliente', 'Persona de contacto',
  'persona@example.test', 'Notas del contacto', 'Reunión reservada', 'Orden del día', '10:00', 'Servidor de producción', 'root', 'interno.example.test',
  'valor privado', 'PVTI_x', 'github.com'];
const DATA = ['tasks', 'tasks/t1/notes', 'clients', 'contacts', 'meetings', 'vault'];
function dump(store, base, assets, tag){
  const out = DATA.map((c) => [...store.rawAll(base + c).values()]);
  out.push(store.raw(base + 'plugin_data', 'workhub.informe'), store.raw(assets, 'img-' + tag));
  return JSON.stringify(out);
}

(async () => {
  const store = fakeDb();
  const ana = fakeApp(accountDb(store, {uid:'ana', name:'Ana', email:'ana@example.test', photo:''}));
  const convert = ana.controllers.convert;
  const base = 'users/ana/projects/p1/', assets = 'users/ana/assets';
  await store.collection('users/ana/projects').doc('p1').set({nombre:'Proyecto abierto', createdAt:10, tipo:'soporte', labels:[{name:'urgente', color:'ff0000'}]});
  await seed(store, base, assets, 'p1');
  await store.collection(assets).doc('ajena').set({data:JPEG + 'AAAA', contentType:'image/jpeg', createdAt:1});
  await tick(10);

  /* ---------- qué se puede convertir ---------- */
  {
    const encOf = (mode) => ({v:1, mode:mode, pid:PC.newPid(), kid:PC.newKid(), kcv:'x'});
    assert.equal(convert.canConvert(ana.models.projects.get('p1')), true);
    assert.equal(convert.canConvert({id:'x', nombre:'A', enc:encOf('pw')}), false, 'ya tiene cifrado total');
    assert.equal(convert.canConvert({id:'x', nombre:'A', enc:encOf('managed')}), false, 'gestionado por Kanlane');
    assert.equal(convert.canConvert({id:'t:x', team:true, role:'owner', nombre:'A'}), false, 'los equipos no se convierten');
    assert.equal(convert.canConvert(null), false);
    Workhub.features.encryptedProjects = false;
    assert.equal(convert.canConvert(ana.models.projects.get('p1')), false, 'con el interruptor apagado no se ofrece');
    Workhub.features.encryptedProjects = true;

    /* Hay que tenerlo abierto. */
    await open(ana, 'main');
    toasts.length = 0;
    convert.start('p1');
    await tick(5);
    assert.ok(toasts[0].indexOf('ERROR Abre este proyecto') === 0);
    assert.equal(convert.state, null);

    /* Enlazado con GitHub: primero hay que desvincularlo. */
    await open(ana, 'p1');
    await ana.models.projects.patch('p1', {github:{login:'x', number:1}});
    await tick(5);
    toasts.length = 0;
    convert.start('p1');
    await tick(5);
    assert.ok(toasts[0].indexOf('ERROR Este proyecto está enlazado con GitHub') === 0, toasts[0]);
    await ana.models.projects.patch('p1', {github:null});
    await tick(5);

    /* Cofre del formato antiguo: no se podría actualizar dentro de un proyecto cifrado. */
    const meta = store.raw(base + 'vault_meta', 'check');
    await store.collection(base + 'vault_meta').doc('check').set({salt:'s', iv:'i', cipher:'c'});
    toasts.length = 0;
    convert.start('p1');
    await tick(5);
    assert.ok(toasts[0].indexOf('ERROR El cofre de este proyecto tiene el formato antiguo') === 0, toasts[0]);
    assert.equal(convert.state, null);
    await store.collection(base + 'vault_meta').doc('check').set(meta);
    assert.equal(store.raw('users/ana/projects', 'p1').enc, undefined);
    ok('qué se convierte: proyectos personales sin cifrar, abiertos, sin GitHub y con el cofre al día');
  }

  /* ---------- nada se escribe hasta confirmar la clave de recuperación ---------- */
  let recovery;
  {
    const before = dump(store, base, assets, 'p1');
    convert.start('p1');
    await tick(5);
    assert.equal(ana.view.mode, 'convert');
    convert.submit('corta', 'corta');
    assert.equal(ana.view.error, 'Demasiado corta: mínimo 12 caracteres.');
    convert.submit(PASSWORD, PASSWORD + 'x');
    assert.equal(ana.view.error, 'Las contraseñas no coinciden.');
    assert.equal(ana.view.mode, 'convert');
    convert.submit(PASSWORD, PASSWORD);
    assert.equal(ana.view.mode, 'convert-key');
    recovery = ana.view.shown;
    assert.match(recovery, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    assert.equal(dump(store, base, assets, 'p1'), before);
    assert.equal(store.raw('users/ana/projects', 'p1').enc, undefined);
    assert.equal(store.raw(base + 'crypto', 'ana'), undefined);
    assert.equal(keys.size, 0);
    ok('diálogo: contraseña comprobada y clave de recuperación en pantalla sin haber escrito nada');
  }

  /* ---------- si falla al marcar el proyecto, sigue como estaba ---------- */
  {
    const before = dump(store, base, assets, 'p1');
    const realPatch = ana.models.projects.patch;
    ana.models.projects.patch = () => Promise.reject(Object.assign(new Error('boom'), {code:'permission-denied'}));
    ana.view.error = '';
    await convert.confirm();
    ana.models.projects.patch = realPatch;
    assert.ok(ana.view.error.indexOf('No se pudo convertir el proyecto.') === 0 && ana.view.error.indexOf('permission-denied') !== -1, ana.view.error);
    assert.equal(store.raw('users/ana/projects', 'p1').enc, undefined);
    assert.equal(store.raw(base + 'crypto', 'ana'), undefined, 'la clave envuelta que se había preparado se retira');
    assert.equal(keys.size, 0, 'y la del navegador también');
    assert.equal(dump(store, base, assets, 'p1'), before);
    assert.equal(convert.running, '');
    assert.equal(ana.view.progress[ana.view.progress.length - 1], '', 'el diálogo vuelve al paso de la clave para reintentar');
    ok('fallo al empezar: el proyecto, sus datos y el navegador quedan como estaban');
  }

  /* ---------- conversión completa ---------- */
  {
    toasts.length = 0;
    ana.view.progress = [];
    await convert.confirm();
    await tick(10);
    assert.equal(ana.view.closedDialog, 1);
    assert.ok(toasts.some((t) => t === '«Proyecto abierto» ya tiene cifrado total'), toasts.join(' | '));
    assert.ok(ana.view.progress.some((t) => /Cifrando… \d+ de \d+/.test(t)));

    const doc = store.raw('users/ana/projects', 'p1');
    const enc = doc.enc;
    assert.deepEqual(Object.keys(enc).sort(), ['createdAt', 'kcv', 'kid', 'mode', 'pid', 'v'], 'al terminar no queda conv');
    assert.deepEqual([enc.v, enc.mode], [1, 'pw']);
    assert.deepEqual([doc.nombre, doc.tipo, doc.createdAt, doc.github], ['Proyecto abierto', 'soporte', 10, undefined], 'el resto del proyecto no cambia');
    assert.deepEqual(doc.labels, [{name:'urgente', color:'ff0000'}]);

    const wrap = store.raw(base + 'crypto', 'ana');
    assert.deepEqual(Object.keys(wrap).sort(), ['createdAt', 'kdf', 'kid', 'pw', 'rk', 'updatedAt', 'v'], 'solo los campos que admiten las reglas');
    const ctx = {pid:enc.pid, kid:enc.kid, uid:'ana'};
    assert.ok(await PC.checkKcv(await PC.unwrapPassword(wrap, PASSWORD, ctx, false), enc.pid, enc.kid, enc.kcv));
    assert.ok(await PC.checkKcv(await PC.unwrapRecovery(wrap, recovery, ctx, false), enc.pid, enc.kid, enc.kcv));
    const rec = await keystore.get('ana', enc.pid);
    assert.deepEqual([rec.kid, rec.key.extractable, rec.trusted, rec.projectId], [enc.kid, false, false, 'p1']);

    /* Nada de lo que había queda en claro. */
    const all = dump(store, base, assets, 'p1');
    SECRETS.forEach((s) => assert.ok(all.indexOf(s) === -1, '«' + s + '» ya no está en claro'));
    assert.ok(all.indexOf(b64.b64encode(imageBytes)) === -1, 'la imagen ya no está en claro');

    const cipher = new ProjectCipher({pid:enc.pid, kid:enc.kid, key:rec.key});
    const t1 = store.raw(base + 'tasks', 't1');
    assert.deepEqual(Object.keys(t1).sort(), ['createdAt', 'dueDate', 'e', 'ev', 'kid', 'order', 'status', 'updatedAt']);
    assert.deepEqual([t1.status, t1.order, t1.dueDate, t1.kid, t1.ev], ['pendiente', 1, '2026-10-09', enc.kid, 1], 'los campos en claro se conservan');
    const p1 = (await cipher.open('tasks', 't1', t1)).plain;
    assert.deepEqual([p1.title, p1.desc, p1.cliente, p1.labels, p1.checklist[0].text], ['Tarea p1', 'Descripción reservada', 'Cliente p1', ['urgente'], 'Paso secreto']);
    assert.ok(!Object.keys(p1).some((k) => /^gh/.test(k)), 'los restos del enlace con GitHub no pasan');
    const n1 = store.raw(base + 'tasks/t1/notes', 'n1');
    assert.deepEqual([n1.imageAssetId, n1.createdAt], ['img-p1', 4]);
    assert.equal((await cipher.open('tasks/t1/notes', 'n1', n1)).plain.text, 'Nota confidencial p1');
    assert.equal((await cipher.open('tasks/t1/notes', 'n2', store.raw(base + 'tasks/t1/notes', 'n2'))).plain.text, 'Otra nota');
    assert.equal((await cipher.open('clients', 'c1', store.raw(base + 'clients', 'c1'))).plain.nombre, 'Cliente p1');
    assert.equal(store.raw(base + 'clients', 'c1').color, 3);
    assert.equal((await cipher.open('contacts', 'k1', store.raw(base + 'contacts', 'k1'))).plain.email, 'persona@example.test');
    const m1 = store.raw(base + 'meetings', 'm1');
    assert.equal(m1.date, '2026-10-05');
    assert.deepEqual([(await cipher.open('meetings', 'm1', m1)).plain.title, (await cipher.open('meetings', 'm1', m1)).plain.start], ['Reunión reservada', '10:00']);
    const v1 = store.raw(base + 'vault', 'v1');
    assert.deepEqual([v1.iv, v1.cipher, v1.ivV2, v1.cipherV2, v1.label], ['iv-del-cofre', 'cifrado-del-cofre', 'iv2', 'cifrado2', undefined], 'el cifrado propio del cofre no cambia');
    assert.deepEqual([(await cipher.open('vault', 'v1', v1)).plain.label, (await cipher.open('vault', 'v1', v1)).plain.usuario], ['Servidor de producción', 'root']);
    assert.deepEqual(store.raw(base + 'vault_meta', 'check'), {saltPassword:'sal', ivPassword:'iv', cipherPassword:'c'}, 'la clave del cofre, ya envuelta, no se toca');
    assert.deepEqual((await cipher.open('plugin_data', 'workhub.informe', store.raw(base + 'plugin_data', 'workhub.informe'))).plain.values, {dato:'valor privado'});
    assert.equal(store.raw(base + 'plugin_data', 'install:workhub.informe')._kind, 'plugin-install', 'la marca de instalación sigue en claro');
    const img = store.raw(assets, 'img-p1');
    assert.deepEqual(Object.keys(img).sort(), ['createdAt', 'e', 'ev', 'kid']);
    assert.deepEqual([...await cipher.openBytes('assets', 'img-p1', img)], [...imageBytes]);
    assert.equal(store.raw(assets, 'ajena').data, JPEG + 'AAAA', 'las imágenes de otros proyectos de la cuenta no se tocan');

    /* Los modelos de la app lo leen como cualquier proyecto cifrado. */
    const tasks = new CollectionModel('tasks');
    tasks.connect(ProjectModel.scope(ana.rootDb, 'p1'), cipher);
    for(let i = 0; i < 6; i++){ await tick(2); await tasks._queue; }
    assert.deepEqual(tasks.items.map((t) => [t.title, !!t._plainInEncrypted, !!t._undecryptable]).sort(), [['Otra tarea p1', false, false], ['Tarea p1', false, false]]);
    tasks.disconnect();

    /* Ya no se puede volver a convertir, y sí cambiar la clave. */
    assert.equal(convert.canConvert(ana.models.projects.get('p1')), false);
    assert.equal(ana.controllers.rotation.canRotate(ana.models.projects.get('p1')), true);
    assert.deepEqual(await new ProjectReseal({rootDb:ana.rootDb, projectId:'p1', cipher:cipher}).run(), {changed:0, skipped:0});
    ok('conversión: todo lo que estaba en claro queda sellado, los campos en claro se conservan y se abre con la contraseña o la clave de recuperación');
  }

  /* ---------- corte a medias: sigue legible y se termina al volver a abrir ---------- */
  {
    const base2 = 'users/ana/projects/p2/';
    await store.collection('users/ana/projects').doc('p2').set({nombre:'A medias', createdAt:20, tipo:'kanban'});
    await seed(store, base2, assets, 'p2');
    await tick(10);
    await open(ana, 'p2');
    const realOne = ProjectReseal.prototype.one;
    ProjectReseal.prototype.one = function(job){
      return job.id === 't2' || job.id === 'img-p2' ? Promise.reject(Object.assign(new Error('sin red'), {code:'unavailable'})) : realOne.call(this, job);
    };
    convert.start('p2');
    await tick(5);
    convert.submit(PASSWORD, PASSWORD);
    toasts.length = 0;
    await convert.confirm();
    await tick(10);
    ProjectReseal.prototype.one = realOne;
    assert.ok(toasts.some((t) => t.indexOf('ERROR El proyecto ya tiene cifrado total, pero no se ha terminado') === 0), toasts.join(' | '));
    const mid = store.raw('users/ana/projects', 'p2').enc;
    assert.ok(mid.conv > 0, 'el proyecto queda marcado como en conversión');
    assert.equal(ProjectModel.isConverting({enc:mid}), true);
    assert.equal(store.raw(base2 + 'tasks', 't2').title, 'Otra tarea p2', 'queda algo en claro');
    assert.equal(store.raw(base2 + 'tasks', 't2').e, undefined);
    assert.ok(store.raw(base2 + 'crypto', 'ana'));

    /* Mientras tanto la app lee las dos cosas: lo sellado y lo que sigue en claro. */
    convert.gaveUp = {p2:true};
    const cipher = await open(ana, 'p2');
    assert.ok(cipher && cipher.kid === mid.kid);
    const tasks = new CollectionModel('tasks');
    tasks.connect(ProjectModel.scope(ana.rootDb, 'p2'), cipher);
    for(let i = 0; i < 6; i++){ await tick(2); await tasks._queue; }
    assert.deepEqual(tasks.items.map((t) => [t.title, !!t._plainInEncrypted]).sort(), [['Otra tarea p2', true], ['Tarea p2', false]]);
    tasks.disconnect();
    /* Y no se empieza un cambio de clave hasta que termine. */
    toasts.length = 0;
    ana.controllers.rotation.start('p2');
    assert.ok(toasts[0].indexOf('ERROR Este proyecto todavía se está convirtiendo') === 0, toasts[0]);

    /* Cierra sesión y vuelve a entrar con la contraseña: se termina solo. */
    await keystore.forgetUser('ana');
    assert.equal(await open(ana, 'p2'), null);
    convert.gaveUp = {};
    toasts.length = 0;
    await ana.controllers.crypto.unlock(PASSWORD, false);
    await ana.connecting;
    await toasted();
    assert.ok(toasts.some((t) => t === '«A medias» ya tiene cifrado total'), toasts.join(' | '));
    const end = store.raw('users/ana/projects', 'p2').enc;
    assert.deepEqual([end.conv, end.kid, end.pid], [undefined, mid.kid, mid.pid]);
    const all = dump(store, base2, assets, 'p2');
    SECRETS.forEach((s) => assert.ok(all.indexOf(s) === -1, 'p2: «' + s + '» ya no está en claro'));
    const rec = await keystore.get('ana', end.pid);
    const fresh = new ProjectCipher({pid:end.pid, kid:end.kid, key:rec.key});
    assert.equal((await fresh.open('tasks', 't2', store.raw(base2 + 'tasks', 't2'))).plain.title, 'Otra tarea p2');
    assert.deepEqual([...await fresh.openBytes('assets', 'img-p2', store.raw(assets, 'img-p2'))], [...imageBytes]);
    ok('corte a medias: el proyecto se lee igual y la conversión se termina al volver a entrar');
  }

  /* ---------- el proyecto principal (sus datos están en la raíz y puede no tener documento) ---------- */
  {
    const luis = fakeApp(accountDb(store, {uid:'luis', name:'Luis', email:'luis@example.test', photo:''}));
    await seed(store, 'users/luis/', 'users/luis/assets', 'main');
    await tick(10);
    assert.equal(store.raw('users/luis/projects', 'main'), undefined, 'el principal aún no tiene documento');
    await open(luis, 'main');
    assert.equal(luis.controllers.convert.canConvert(luis.models.projects.get('main')), true);
    luis.controllers.convert.start('main');
    await tick(5);
    luis.controllers.convert.submit(PASSWORD, PASSWORD);
    await luis.controllers.convert.confirm();
    await tick(10);
    const doc = store.raw('users/luis/projects', 'main');
    assert.ok(doc && doc.enc && !doc.enc.conv && doc.nombre, 'el documento del principal se crea con el cifrado');
    assert.equal(doc.deleted, undefined);
    assert.ok(store.raw('users/luis/crypto', 'luis'), 'la clave envuelta del principal va en la raíz');
    const all = dump(store, 'users/luis/', 'users/luis/assets', 'main');
    SECRETS.forEach((s) => assert.ok(all.indexOf(s) === -1, 'principal: «' + s + '» ya no está en claro'));
    assert.ok(await open(luis, 'main'), 'se abre con la clave del navegador');
    assert.equal((await luis.cipher.open('tasks', 't1', store.raw('users/luis/tasks', 't1'))).plain.title, 'Tarea main');
    ok('proyecto principal: se convierte igual, con su clave envuelta en la raíz');
  }

  console.log('\nTodo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
