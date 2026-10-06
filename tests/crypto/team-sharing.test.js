/* Cifrado por proyecto, PR7 del plan (docs/CIFRADO-PROYECTOS.md, apartado 10): compartir un proyecto
   con cifrado total. Par de claves por miembro, transacciones en equipos cifrados, convertir un
   proyecto cifrado en equipo, invitar con un código de acceso y aceptar con ese código.
   Web Crypto real de Node y el Firestore en memoria de las pruebas (sin reglas: eso es tests/rules
   y tests/e2e/crypto-team.js).
   Uso: node tests/crypto/team-sharing.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fakeDb} = require('./fake-firestore.js');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/* Almacén de claves del navegador: aquí solo se apunta lo que se guarda y se olvida. */
const keys = new Map();
const keystore = {
  put:(rec) => { keys.set(rec.uid + ':' + rec.pid, rec); return Promise.resolve('disk'); },
  get:(uid, pid) => Promise.resolve(keys.get(uid + ':' + pid) || null),
  forget:(uid, pid) => { keys.delete(uid + ':' + pid); return Promise.resolve(); },
  forgetProject:(id, uid) => { [...keys.values()].filter((r) => r.projectId === id && r.uid === uid).forEach((r) => keys.delete(r.uid + ':' + r.pid)); return Promise.resolve(1); },
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
['src/core/emitter.js', 'src/utils/dates.js', 'src/utils/pool.js', 'src/services/crypto.js',
  'src/services/project-crypto.js', 'src/models/enc-schema.js', 'src/models/project-cipher.js',
  'src/models/collection-model.js', 'src/models/project-templates.js', 'src/models/task-model.js',
  'src/models/project-model.js', 'src/models/team-vault.js', 'src/models/team-model.js',
  'src/controllers/project-crypto-controller.js', 'src/controllers/team-crypto-controller.js'
].forEach((rel) => new Function('Workhub', 'window', 'crypto', read(rel))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto));

const PC = Workhub.services.projectCrypto;
const b64 = Workhub.services.crypto;
const {CollectionModel, TaskModel, ProjectModel, TeamModel, ProjectCipher} = Workhub.models;
const {ProjectCryptoController, TeamCryptoController} = Workhub.controllers;
const pcErr = (c) => (err) => { assert.equal(err && err.name, 'ProjectCryptoError', String(err && err.message)); assert.equal(err.code, c); return true; };
const coded = (c) => (err) => { assert.equal(err && err.code, c, String(err && err.message)); return true; };

const PASSWORD = 'una contraseña de cifrado larga';
const GUEST_PASSWORD = 'otra frase distinta del invitado';

async function settle(...models){
  for(let i = 0; i < 6; i++){
    await tick(2);
    await Promise.all(models.map((m) => m && m._queue));
  }
}

/* Base de datos de una cuenta sobre un almacén común (los equipos y las invitaciones son de todos),
   con la misma forma que la de firebase-backend. */
function accountDb(store, me){
  const base = 'users/' + me.uid + '/';
  const db = {
    me:me,
    collection:(p) => store.collection(base + p),
    doc:(p) => store.doc(base + p),
    team:(tid) => ({collection:(n) => store.collection('teams/' + tid + '/' + n), doc:(p) => store.doc('teams/' + tid + '/' + p)})
  };
  /* update() de un equipo: arrayUnion, arrayRemove, delete y rutas con punto, como Firestore. */
  const teamDoc = (tid) => {
    const ref = store.collection('teams').doc(tid);
    const update = (patch) => {
      const cur = store.raw('teams', tid);
      if(!cur) return Promise.reject(new Error('not-found'));
      const next = JSON.parse(JSON.stringify(cur));
      Object.keys(patch).forEach((k) => {
        const v = patch[k];
        const parts = k.split('.');
        let at = next;
        for(let i = 0; i < parts.length - 1; i++){ at = at[parts[i]] = at[parts[i]] || {}; }
        const last = parts[parts.length - 1];
        if(v && v.__delete) delete at[last];
        else if(v && v.__union) at[last] = (at[last] || []).concat(v.__union.filter((x) => (at[last] || []).indexOf(x) === -1));
        else if(v && v.__remove) at[last] = (at[last] || []).filter((x) => v.__remove.indexOf(x) === -1);
        else at[last] = v;
      });
      return ref.set(next);
    };
    return Object.assign({}, ref, {update:update});
  };
  let ids = 0;
  db.teams = {
    query:() => store.collection('teams'),
    doc:teamDoc,
    newId:() => 'team' + (++ids) + me.uid,
    invitesForMe:() => store.collection('invites').where('email', '==', me.email),
    invitesFrom:(tid) => store.collection('invites').where('teamId', '==', tid),
    invite:(id) => store.collection('invites').doc(id),
    inviteKey:(id) => store.collection('invites/' + id + '/key').doc('wrap'),
    cryptoDoc:(tid, who) => store.collection('teams/' + tid + '/crypto').doc(who),
    serverTimestamp:() => Date.now(),
    FieldValue:{delete:() => ({__delete:true}), arrayUnion:(...x) => ({__union:x}), arrayRemove:(...x) => ({__remove:x})},
    batch:() => {
      const ops = [];
      const b = {
        set:(ref, data) => { ops.push(() => ref.set(data)); return b; },
        update:(ref, data) => { ops.push(() => ref.update(data)); return b; },
        delete:(ref) => { ops.push(() => ref.delete()); return b; },
        commit:() => ops.reduce((p, op) => p.then(op), Promise.resolve())
      };
      return b;
    }
  };
  /* Las consultas de invitaciones de esta prueba devuelven documentos con ref, como Firestore. */
  const from = db.teams.invitesFrom;
  db.teams.invitesFrom = (tid) => {
    const q = from(tid);
    return Object.assign({}, q, {get:() => q.get().then((snap) => ({docs:snap.docs.map((d) => Object.assign({}, d, {ref:store.collection('invites').doc(d.id)}))}))});
  };
  return db;
}

/* Lo mínimo de la app que usan los controladores de cifrado. */
function fakeApp(db){
  const projects = new ProjectModel();
  projects.connect(db);
  const team = new TeamModel(projects);
  const view = {
    shown:null, error:'', busy:false, closed:false,
    bind(h){ this.handlers = h; },
    open(invite){ this.invite = invite; }, close(){ this.closed = true; },
    setBusy(on){ this.busy = on; }, showKey(text){ this.shown = text; }, showError(msg){ this.error = msg; },
    setDialogBusy(){}, showDialogError(msg){ this.error = msg; }, closeDialog(){}, showKeyError(msg){ this.error = msg; },
    showRecoverError(msg){ this.error = msg; }
  };
  const app = {rootDb:db, projectId:'', cipher:null, models:{projects:projects, team:team}, controllers:{}, connected:0,
    connectProject(){ this.connected++; }};
  app.controllers.crypto = new ProjectCryptoController(app, Object.create(view));
  app.controllers.teamCrypto = new TeamCryptoController(app, view);
  app.view = view;
  return app;
}

/* Proyecto personal con cifrado total, creado como lo hace el asistente. */
async function createEncrypted(app, id, nombre){
  const recovery = app.controllers.crypto.prepare();
  await app.controllers.crypto.create({id:id, nombre:nombre, config:{tipo:'soporte', labels:[{name:'urgente', color:'ff0000'}]}, password:PASSWORD, trusted:true});
  await tick(5);
  const p = app.models.projects.get(id);
  const rec = await keystore.get(app.rootDb.me.uid, p.enc.pid);
  app.projectId = id;
  app.cipher = new ProjectCipher({pid:p.enc.pid, kid:p.enc.kid, key:rec.key});
  return {project:p, recovery:recovery};
}

(async () => {
  /* ---------- par de claves por miembro (D9) ---------- */
  {
    const ctx = {pid:PC.newPid(), kid:PC.newKid(), uid:'u1'};
    const pair = await PC.newKeyPair();
    assert.deepEqual(Object.keys(pair.pub).sort(), ['crv', 'kty', 'x', 'y']);
    assert.deepEqual([pair.pub.kty, pair.pub.crv], ['EC', 'P-256']);
    assert.ok(pair.priv instanceof Uint8Array && pair.priv.length > 100 && pair.priv.length < 200);
    const other = await PC.newKeyPair();
    assert.notEqual(pair.pub.x, other.pub.x, 'cada par es distinto');

    const raw = PC.newDekBytes();
    const plain = await PC.wrapPassword(raw, PASSWORD, ctx);
    assert.equal(plain.priv, undefined, 'sin clave privada el envoltorio no cambia');
    const w = await PC.wrapPassword(raw, PASSWORD, ctx, pair.priv);
    assert.ok(w.priv && w.priv.iv.length === 16 && w.priv.ct.length <= 1024, 'la privada envuelta cabe en lo que admiten las reglas');
    assert.ok(w.priv.ct.indexOf(b64.b64encode(pair.priv).slice(0, 24)) === -1);
    const doc = {kdf:w.kdf, pw:w.pw, priv:w.priv};
    assert.deepEqual([...await PC.unwrapPrivate(doc, PASSWORD, ctx)], [...pair.priv]);
    /* La privada se importa como clave ECDH y casa con la pública. */
    const sub = globalThis.crypto.subtle;
    const priv = await sub.importKey('pkcs8', await PC.unwrapPrivate(doc, PASSWORD, ctx), {name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
    const pub = await sub.importKey('jwk', Object.assign({ext:true}, pair.pub), {name:'ECDH', namedCurve:'P-256'}, true, []);
    assert.equal((await sub.deriveBits({name:'ECDH', public:pub}, priv, 256)).byteLength, 32);
    await assert.rejects(PC.unwrapPrivate(doc, 'otra contraseña distinta', ctx), pcErr('bad-password'));
    await assert.rejects(PC.unwrapPrivate(doc, PASSWORD, Object.assign({}, ctx, {uid:'u2'})), pcErr('bad-password'));
    await assert.rejects(PC.unwrapPrivate({kdf:w.kdf, pw:w.pw}, PASSWORD, ctx), pcErr('bad-format'));
    await assert.rejects(PC.wrapPassword(raw, PASSWORD, ctx, new Uint8Array(600)), pcErr('bad-format'));
    /* La clave del proyecto se sigue abriendo igual. */
    assert.ok(await PC.unwrapPassword(doc, PASSWORD, ctx, false));
    ok('par de claves: P-256, privada envuelta con la contraseña, ligada a la cuenta y al proyecto');
  }

  /* ---------- transacciones en equipos cifrados (D10) ---------- */
  {
    const newCipher = async (key, pid, kid) => new ProjectCipher({pid:pid, kid:kid, key:key});
    const key = await PC.importDek(PC.newDekBytes());
    const pid = PC.newPid(), kid = PC.newKid();
    /* Transacción de mentira: lee, deja preparar la escritura y la aplica; de una en una. */
    let chain = Promise.resolve();
    let runs = 0;
    const transaction = (fn) => {
      const run = chain.then(() => {
        runs++;
        const writes = [];
        return fn({get:(ref) => ref.get(), update:(ref, data) => writes.push([ref, data])})
          .then(() => writes.reduce((p, w) => p.then(() => w[0].update(w[1])), Promise.resolve()));
      });
      chain = run.catch(() => {});
      return run;
    };
    const two = async (withTx) => {
      const db = fakeDb();
      const a = new CollectionModel('tasks'), b = new CollectionModel('tasks');
      const ca = await newCipher(key, pid, kid), cb = await newCipher(key, pid, kid);
      if(withTx){ ca.transaction = transaction; cb.transaction = transaction; }
      a.connect(db, ca); b.connect(db, cb);
      await settle(a, b);
      const ref = await a.add({title:'Tarea', desc:'Texto', cliente:'Uno', status:'pendiente', order:1});
      await settle(a, b);
      /* Dos personas cambian a la vez campos secretos distintos de la misma tarea. */
      await Promise.all([a.update(ref.id, {title:'Título de Ana'}), b.update(ref.id, {desc:'Descripción de Luis', status:'proceso'})]);
      await settle(a, b);
      return {a:a, b:b, id:ref.id, db:db};
    };

    const lost = await two(false);
    const l = lost.a.find(lost.id);
    assert.ok(!(l.title === 'Título de Ana' && l.desc === 'Descripción de Luis'), 'sin transacción gana la última escritura');

    runs = 0;
    const kept = await two(true);
    [kept.a, kept.b].forEach((m) => {
      const t = m.find(kept.id);
      assert.deepEqual([t.title, t.desc, t.cliente, t.status], ['Título de Ana', 'Descripción de Luis', 'Uno', 'proceso'], 'con transacción no se pierde ningún cambio');
    });
    assert.equal(runs, 2);
    assert.ok(JSON.stringify(kept.db.raw('tasks', kept.id)).indexOf('Título de Ana') === -1, 'sigue sellado');
    /* Mover no abre una transacción (solo campos en claro). */
    await kept.a.update(kept.id, {status:'espera'});
    assert.equal(runs, 2);
    /* Dos cambios seguidos de la misma persona conservan los dos. */
    await Promise.all([kept.a.update(kept.id, {title:'Otro título'}), kept.a.update(kept.id, {cliente:'Dos'})]);
    await settle(kept.a, kept.b);
    assert.deepEqual([kept.b.find(kept.id).title, kept.b.find(kept.id).cliente, kept.b.find(kept.id).desc], ['Otro título', 'Dos', 'Descripción de Luis']);

    /* Sin conexión la transacción no puede leer: se escribe con lo que hay en memoria. */
    kept.a.cipher.transaction = () => Promise.reject(Object.assign(new Error('offline'), {code:'unavailable'}));
    await kept.a.update(kept.id, {title:'Sin conexión'});
    await settle(kept.a, kept.b);
    assert.equal(kept.b.find(kept.id).title, 'Sin conexión');
    /* Cualquier otro fallo se propaga y la caché vuelve a lo anterior. */
    kept.a.cipher.transaction = () => Promise.reject(Object.assign(new Error('no'), {code:'permission-denied'}));
    await assert.rejects(kept.a.update(kept.id, {title:'Rechazado'}), coded('permission-denied'));
    await settle(kept.a, kept.b);
    assert.equal(kept.a.find(kept.id).title, 'Sin conexión');
    [lost.a, lost.b, kept.a, kept.b].forEach((m) => m.disconnect());
    ok('equipos cifrados: los cambios de campos secretos van en transacción y no se pisan; sin conexión, con la caché');
  }

  /* ---------- crear un proyecto cifrado: el error dice el paso que falló ---------- */
  {
    const store = fakeDb();
    const app = fakeApp(accountDb(store, {uid:'eva', name:'Eva', email:'eva@example.test', photo:''}));
    await tick(5);
    const crypto = app.controllers.crypto;
    const denied = () => Promise.reject(Object.assign(new Error('denied'), {code:'permission-denied'}));
    const realError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    try{
      /* El servidor rechaza la clave envuelta (reglas sin publicar): no queda nada a medias. */
      const realRef = crypto.wrapRef.bind(crypto);
      crypto.wrapRef = (id) => Object.assign({}, realRef(id), {set:denied});
      const e1 = await crypto.create({id:'px', nombre:'X', config:{tipo:'kanban'}, password:PASSWORD}).then(() => null, (e) => e);
      assert.equal(e1.phase, 'guardar la clave del proyecto');
      assert.equal(crypto.createError(e1), 'No se pudo crear el proyecto. Falló al guardar la clave del proyecto. El servidor ha rechazado la operación (permission-denied): comprueba que están publicadas las reglas de firestore.rules del cifrado y que tu correo está verificado.');
      assert.equal(store.raw('users/eva/projects', 'px'), undefined);
      assert.equal(keys.size, 0);
      crypto.wrapRef = realRef;
      /* El servidor rechaza el documento del proyecto: se deshacen la clave envuelta y la del navegador. */
      const realSet = app.models.projects.set.bind(app.models.projects);
      app.models.projects.set = () => Promise.reject(Object.assign(new Error('offline'), {code:'unavailable'}));
      const e2 = await crypto.create({id:'px', nombre:'X', config:{tipo:'kanban'}, password:PASSWORD}).then(() => null, (e) => e);
      app.models.projects.set = realSet;
      await tick(5);
      assert.equal(e2.phase, 'guardar el proyecto');
      assert.equal(crypto.createError(e2), 'No se pudo crear el proyecto. Falló al guardar el proyecto. Parece un problema de conexión; inténtalo de nuevo.');
      assert.equal(store.raw('users/eva/projects/px/crypto', 'eva'), undefined);
      assert.equal(keys.size, 0);
      assert.equal(logged.length, 2, 'el error queda también en la consola');
    }finally{
      console.error = realError;
    }
    ok('crear: si falla, el mensaje dice el paso y el motivo, queda en la consola y no deja nada a medias');
  }

  /* ---------- convertir, invitar y aceptar ---------- */
  {
    const store = fakeDb();
    const ana = fakeApp(accountDb(store, {uid:'ana', name:'Ana', email:'ana@example.test', photo:''}));
    const luis = fakeApp(accountDb(store, {uid:'luis', name:'Luis', email:'luis@example.test', photo:''}));
    await tick(5);
    const {project} = await createEncrypted(ana, 'p1', 'Proyecto Reservado');
    const srcDb = ProjectModel.scope(ana.rootDb, 'p1');
    const src = ana.cipher;

    /* Datos del proyecto personal cifrado. */
    const tasks = new TaskModel(), clients = new CollectionModel('clients');
    tasks.connect(srcDb, src); clients.connect(srcDb, src);
    await settle(tasks, clients);
    const t1 = await tasks.add({title:'Tarea secreta', desc:'Descripción reservada', cliente:'Cliente Reservado', status:'proceso', order:1, createdAt:1, linkedVault:['v1'], linkedContacts:['c1']});
    await clients.add({nombre:'Cliente Reservado', createdAt:1});
    const imageBytes = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4, 5]);
    await ana.rootDb.collection('assets').doc('img1').set(Object.assign({createdAt:5}, await src.sealBytes('assets', 'img1', imageBytes)));
    await ana.rootDb.collection('assets').doc('img2').set({createdAt:6, contentType:'image/jpeg', data:'data:image/jpeg;base64,' + b64.b64encode(imageBytes)});
    await tasks.addNote(t1.id, 'Nota confidencial', 'img1');
    await tasks.addNote(t1.id, 'Otra nota', 'img2');
    await srcDb.collection('plugin_data').doc('install:workhub.informe').set({_kind:'plugin-install', pluginId:'workhub.informe', url:'x', granted:[], installedAt:1});
    await srcDb.collection('plugin_data').doc('workhub.informe').set(Object.assign({updatedAt:1}, await src.sealSecret('plugin_data', 'workhub.informe', {values:{dato:'valor privado'}})));
    /* Un documento que no se puede descifrar (sellado con otra clave). */
    const stranger = new ProjectCipher({pid:PC.newPid(), kid:project.enc.kid, key:await PC.importDek(PC.newDekBytes())});
    await srcDb.collection('contacts').doc('roto').set(await stranger.seal('contacts', 'roto', {nombre:'Ilegible', createdAt:1}));
    await settle(tasks, clients);

    /* Sin el material de claves no se convierte un proyecto cifrado. */
    await assert.rejects(ana.models.team.convert(project, null), coded('needs-secret'));
    await assert.rejects(ana.controllers.teamCrypto.prepareConvert(project, 'no es la contraseña'), pcErr('bad-password'));

    const prepared = await ana.controllers.teamCrypto.prepareConvert(project, PASSWORD);
    assert.match(prepared.recovery, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    const s = prepared.secret;
    assert.notEqual(s.enc.pid, project.enc.pid, 'el equipo tiene su propio pid');
    assert.notEqual(s.enc.kid, project.enc.kid);
    assert.equal(prepared.key.extractable, false);
    assert.ok(s.crypto.pub && s.crypto.priv && s.crypto.pw && s.crypto.rk && s.crypto.kid === s.enc.kid);
    await ana.controllers.teamCrypto.keepConverted(prepared);
    assert.ok(await keystore.get('ana', s.enc.pid), 'la clave del equipo está en el navegador antes de crearlo');

    const steps = [];
    const made = await ana.models.team.convert(project, (text) => steps.push(text), s);
    await tick(5);
    const tid = made.teamId;
    assert.equal(made.id, 't:' + tid);
    assert.equal(made.skipped, 1, 'lo ilegible no se copia y se cuenta');
    const teamRaw = store.raw('teams', tid);
    assert.deepEqual(teamRaw.enc, s.enc);
    assert.equal(teamRaw.github, undefined);
    assert.deepEqual([teamRaw.ownerUid, teamRaw.memberIds, teamRaw.tipo], ['ana', ['ana'], 'soporte']);
    assert.deepEqual(store.raw('teams/' + tid + '/crypto', 'ana'), s.crypto);
    const base = 'teams/' + tid + '/';
    const allRaw = JSON.stringify(['tasks', 'clients', 'contacts', 'assets', 'plugin_data', 'tasks/' + t1.id + '/notes'].map((c) => [...store.rawAll(base + c).values()]));
    ['Tarea secreta', 'Descripción reservada', 'Cliente Reservado', 'Nota confidencial', 'valor privado', b64.b64encode(imageBytes)].forEach((w) =>
      assert.ok(allRaw.indexOf(w) === -1, 'equipo: «' + w + '» no está en claro'));
    const rawTask = store.raw(base + 'tasks', t1.id);
    assert.equal(rawTask.kid, s.enc.kid);
    assert.equal(rawTask.linkedVault, undefined, 'las contraseñas vinculadas no viajan');
    assert.deepEqual(rawTask.linkedContacts, ['c1']);
    await assert.rejects(src.open('tasks', t1.id, rawTask), coded('undecryptable'), 'la clave del original no abre lo del equipo');
    assert.equal((await s.dst.open('tasks', t1.id, rawTask)).plain.title, 'Tarea secreta');
    const rawNotes = [...store.rawAll(base + 'tasks/' + t1.id + '/notes').entries()];
    assert.equal(rawNotes.length, 2);
    for(const [nid, raw] of rawNotes){
      assert.ok((await s.dst.open('tasks/' + t1.id + '/notes', nid, raw)).plain.text.indexOf('ota') !== -1);
    }
    for(const id of ['img1', 'img2']){
      const raw = store.raw(base + 'assets', id);
      assert.ok(raw.e && raw.ev === 1 && raw.data === undefined, 'la imagen del equipo va sellada');
      assert.deepEqual([...await s.dst.openBytes('assets', id, raw)], [...imageBytes]);
    }
    assert.equal(store.raw(base + 'plugin_data', 'install:workhub.informe')._kind, 'plugin-install', 'la marca de instalación sigue en claro');
    assert.deepEqual((await s.dst.open('plugin_data', 'workhub.informe', store.raw(base + 'plugin_data', 'workhub.informe'))).plain, {values:{dato:'valor privado'}});
    assert.equal(store.raw(base + 'contacts', 'roto'), undefined);
    assert.ok(store.raw('users/ana/projects/p1/tasks', t1.id), 'el original no cambia');
    assert.ok(steps[steps.length - 1].indexOf('Copiando') === 0);
    ok('convertir: el equipo tiene su propia clave y todo se vuelve a cifrar con ella (tareas, notas, imágenes, plugins)');

    /* Un fallo a medias deshace el equipo y su clave envuelta. */
    {
      const again = await ana.controllers.teamCrypto.prepareConvert(project, PASSWORD);
      const realSeal = again.secret.dst.seal.bind(again.secret.dst);
      let n = 0;
      again.secret.dst.seal = (p, id, data) => (++n === 2 ? Promise.reject(Object.assign(new Error('boom'), {code:'unavailable'})) : realSeal(p, id, data));
      await ana.controllers.teamCrypto.keepConverted(again);
      await assert.rejects(ana.models.team.convert(project, null, again.secret), (err) => err.phase === 'copiar los datos al equipo');
      await ana.controllers.teamCrypto.dropConverted(again);
      await tick(5);
      assert.equal(store.raw('teams', again.secret.tid), undefined);
      assert.equal(store.raw('teams/' + again.secret.tid + '/crypto', 'ana'), undefined);
      assert.equal(await keystore.get('ana', again.secret.enc.pid), null);
      ok('convertir: si falla a medias no queda ni el equipo ni su clave');
    }

    /* ----- invitar ----- */
    const team = ana.models.projects.get('t:' + tid);
    assert.ok(ProjectModel.isEncrypted(team));
    ana.models.team.watchSent(tid);
    await tick(5);
    await assert.rejects(ana.models.team.invite(team, 'luis@example.test', 'editor'), coded('needs-secret'));
    assert.equal(store.raw('invites', tid + '_luis@example.test'), undefined, 'un equipo cifrado nunca invita sin la clave envuelta');
    await assert.rejects(ana.controllers.teamCrypto.prepareInvite(team, 'no es la contraseña'), pcErr('bad-password'));
    const made1 = await ana.controllers.teamCrypto.prepareInvite(team, PASSWORD);
    assert.match(made1.code, /^([0-9A-Z]{4}-){4}[0-9A-Z]{4}$/, 'código de 20 caracteres en 5 grupos');
    await ana.models.team.invite(team, 'Luis@Example.test', 'viewer', made1.secret);
    await tick(5);
    const invId = tid + '_luis@example.test';
    const invRaw = store.raw('invites', invId);
    assert.deepEqual(invRaw.enc, {pid:s.enc.pid, kid:s.enc.kid, kcv:s.enc.kcv});
    assert.ok(invRaw.expiresAt > Date.now() + 23 * 3600e3 && invRaw.expiresAt <= Date.now() + 24 * 3600e3);
    const wrapRaw = store.raw('invites/' + invId + '/key', 'wrap');
    assert.deepEqual(Object.keys(wrapRaw).sort(), ['createdAt', 'ct', 'iter', 'iv', 'kcv', 'kid', 'salt'], 'solo los campos que admiten las reglas');
    assert.ok(JSON.stringify([invRaw, wrapRaw]).indexOf(made1.code.replace(/-/g, '')) === -1 && JSON.stringify([invRaw, wrapRaw]).indexOf(made1.code) === -1, 'el código no se guarda');
    /* Invitar otra vez al mismo correo cambia el código: el anterior deja de valer. */
    const made2 = await ana.controllers.teamCrypto.prepareInvite(team, PASSWORD);
    assert.notEqual(made2.code, made1.code);
    await ana.models.team.invite(team, 'luis@example.test', 'editor', made2.secret);
    await tick(5);
    ok('invitar: código de acceso nuevo cada vez y la clave del equipo envuelta con él');

    /* ----- aceptar ----- */
    luis.models.team.connect();
    await tick(5);
    const invite = luis.models.team.incoming.items[0];
    assert.equal(invite.id, invId);
    await assert.rejects(luis.models.team.accept(invite), coded('needs-secret'));
    let joined = 0;
    luis.controllers.teamCrypto.openJoin(invite, () => joined++);
    const tc = luis.controllers.teamCrypto, view = luis.view;
    await tc.openCode('nada', GUEST_PASSWORD, GUEST_PASSWORD);
    assert.equal(view.error, 'El código no es correcto.');
    await tc.openCode(made1.code, GUEST_PASSWORD, GUEST_PASSWORD);
    assert.equal(view.error, 'El código no es correcto.', 'el código de la invitación anterior ya no sirve');
    view.error = '';
    await tc.openCode(made2.code, 'corta', 'corta');
    assert.ok(view.error.indexOf('12') !== -1, 'la contraseña propia también tiene mínimo');
    await tc.openCode(made2.code, GUEST_PASSWORD, GUEST_PASSWORD + 'x');
    assert.equal(view.error, 'Las contraseñas no coinciden.');
    assert.equal(view.shown, null);
    /* La clave que abre el código tiene que ser la del proyecto de la invitación (kcv). */
    const otherKcv = await PC.kcv(await PC.importDek(PC.newDekBytes()), s.enc.pid, s.enc.kid);
    luis.controllers.teamCrypto.openJoin(Object.assign({}, invite, {enc:Object.assign({}, invite.enc, {kcv:otherKcv})}), () => joined++);
    view.error = '';
    await tc.openCode(made2.code, GUEST_PASSWORD, GUEST_PASSWORD);
    assert.equal(view.error, 'El código no es correcto.');
    assert.equal(view.shown, null);
    luis.controllers.teamCrypto.openJoin(invite, () => joined++);
    await tc.openCode(made2.code.toLowerCase().replace(/-/g, ' '), GUEST_PASSWORD, GUEST_PASSWORD);
    assert.match(view.shown, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/, 'se enseña la clave de recuperación propia antes de guardar nada');
    assert.notEqual(view.shown, prepared.recovery);
    assert.equal(store.raw('teams', tid).memberIds.length, 1, 'todavía no ha entrado');
    assert.equal(await keystore.get('luis', s.enc.pid), null);
    const guestRecovery = view.shown;
    await tc.finishJoin();
    await tick(5);
    assert.equal(joined, 1);
    assert.equal(view.closed, true);
    const after = store.raw('teams', tid);
    assert.deepEqual(after.memberIds, ['ana', 'luis']);
    assert.equal(after.members.luis.role, 'editor');
    assert.equal(store.raw('invites', invId), undefined, 'la invitación se borra');
    assert.equal(store.raw('invites/' + invId + '/key', 'wrap'), undefined, 'el código es de un solo uso');
    const guestDoc = store.raw('teams/' + tid + '/crypto', 'luis');
    assert.ok(guestDoc.pub && guestDoc.priv && guestDoc.kid === s.enc.kid);
    assert.notDeepEqual(guestDoc.pw, s.crypto.pw);
    const rec = await keystore.get('luis', s.enc.pid);
    assert.equal(rec.projectId, 't:' + tid);
    assert.equal(rec.key.extractable, false, 'en el navegador del invitado la clave no es extraíble');
    /* Con su clave lee lo que cifró la propietaria; y la abre con su contraseña y su clave de recuperación. */
    const guest = new ProjectCipher({pid:s.enc.pid, kid:s.enc.kid, key:rec.key});
    assert.equal((await guest.open('tasks', t1.id, store.raw(base + 'tasks', t1.id))).plain.title, 'Tarea secreta');
    const gctx = {pid:s.enc.pid, kid:s.enc.kid, uid:'luis'};
    assert.ok(await PC.checkKcv(await PC.unwrapPassword(guestDoc, GUEST_PASSWORD, gctx, false), s.enc.pid, s.enc.kid, s.enc.kcv));
    assert.ok(await PC.checkKcv(await PC.unwrapRecovery(guestDoc, guestRecovery, gctx, false), s.enc.pid, s.enc.kid, s.enc.kcv));
    await assert.rejects(PC.unwrapPassword(guestDoc, PASSWORD, gctx, false), pcErr('bad-password'), 'la contraseña de la propietaria no abre la del invitado');
    await assert.rejects(PC.unwrapPassword(s.crypto, GUEST_PASSWORD, {pid:s.enc.pid, kid:s.enc.kid, uid:'ana'}, false), pcErr('bad-password'));
    ok('aceptar: código, contraseña y clave de recuperación propias; un solo lote y un solo uso');

    /* Cambiar la contraseña conserva el par de claves; recuperar el acceso crea otro. */
    {
      await tick(5);
      const crypto = luis.controllers.crypto;
      crypto.editing = 't:' + tid;
      const privBefore = await PC.unwrapPrivate(guestDoc, GUEST_PASSWORD, gctx);
      await crypto.changePassword(GUEST_PASSWORD, 'una tercera frase bien larga', 'una tercera frase bien larga');
      const changed = store.raw('teams/' + tid + '/crypto', 'luis');
      assert.deepEqual(changed.pub, guestDoc.pub);
      assert.deepEqual([...await PC.unwrapPrivate(changed, 'una tercera frase bien larga', gctx)], [...privBefore], 'la privada sigue siendo la misma, envuelta con la contraseña nueva');
      await assert.rejects(PC.unwrapPrivate(changed, GUEST_PASSWORD, gctx), pcErr('bad-password'));

      luis.projectId = 't:' + tid;
      await crypto.recover(guestRecovery, 'la cuarta frase tras olvidarla', 'la cuarta frase tras olvidarla', false);
      await crypto.finishRecover();
      const recovered = store.raw('teams/' + tid + '/crypto', 'luis');
      assert.notDeepEqual(recovered.pub, guestDoc.pub, 'sin la contraseña antigua la privada no se recupera: par nuevo');
      assert.ok(await PC.unwrapPrivate(recovered, 'la cuarta frase tras olvidarla', gctx));
      assert.ok(await PC.unwrapPassword(recovered, 'la cuarta frase tras olvidarla', gctx, false));
      ok('contraseña del miembro: al cambiarla conserva su par de claves; al recuperar el acceso se crea otro');
    }

    /* ----- caducidad ----- */
    {
      const made3 = await ana.controllers.teamCrypto.prepareInvite(team, PASSWORD);
      await ana.models.team.invite(team, 'marta@example.test', 'viewer', made3.secret);
      await tick(5);
      const mid = tid + '_marta@example.test';
      const marta = fakeApp(accountDb(store, {uid:'marta', name:'Marta', email:'marta@example.test', photo:''}));
      marta.models.team.connect();
      await tick(5);
      const inv = Object.assign({}, marta.models.team.incoming.items[0], {expiresAt:Date.now() - 1000});
      assert.equal(TeamModel.isExpired(inv), true);
      assert.equal(TeamModel.isExpired(marta.models.team.incoming.items[0]), false);
      assert.equal(TeamModel.isExpired({id:'x', expiresAt:1}), false, 'una invitación sin cifrado no caduca');
      /* Pasadas 24 h las reglas no dejan leer la clave envuelta. */
      marta.models.team.readInviteKey = () => Promise.reject(Object.assign(new Error('denied'), {code:'permission-denied'}));
      marta.controllers.teamCrypto.openJoin(inv, () => {});
      await marta.controllers.teamCrypto.openCode(made3.code, GUEST_PASSWORD, GUEST_PASSWORD);
      assert.equal(marta.view.error, 'El código ha caducado. Pide a Ana que te invite de nuevo.');
      assert.equal(marta.view.shown, null);
      /* La propietaria retira las caducadas: primero la clave envuelta, después la invitación. */
      await store.collection('invites').doc(mid).update({expiresAt:Date.now() - 1000});
      await tick(5);
      const before = store.log.writes.length;
      await ana.models.team.cleanExpired();
      const dels = store.log.writes.slice(before).filter((w) => w.op === 'delete').map((w) => w.path);
      /* Con la invitación se va también el acceso a las contraseñas que tuviera preparado. */
      assert.deepEqual(dels.filter((p) => !/\/vault_grants$/.test(p)), ['invites/' + mid + '/key', 'invites'], 'primero la clave envuelta');
      assert.equal(dels[dels.length - 1], 'invites', 'la invitación, lo último');
      assert.equal(store.raw('invites', mid), undefined);
      assert.equal(store.raw('invites/' + mid + '/key', 'wrap'), undefined);
      ok('caducidad: el código caducado lo dice con el nombre de quien invitó y la propietaria retira la invitación');
    }

    /* ----- expulsar y salir ----- */
    {
      await tick(5);
      const teamNow = ana.models.projects.get('t:' + tid);
      await ana.models.team.removeMember(teamNow, 'luis');
      await tick(5);
      assert.deepEqual(store.raw('teams', tid).memberIds, ['ana']);
      assert.equal(store.raw('teams', tid).members.luis, undefined);
      assert.equal(store.raw('teams/' + tid + '/crypto', 'luis'), undefined, 'al expulsar se borra su clave envuelta');
      assert.ok(store.raw('teams/' + tid + '/crypto', 'ana'));

      /* Vuelve a entrar y sale por su cuenta: se olvida la clave de su navegador. */
      const made4 = await ana.controllers.teamCrypto.prepareInvite(ana.models.projects.get('t:' + tid), PASSWORD);
      await ana.models.team.invite(ana.models.projects.get('t:' + tid), 'luis@example.test', 'viewer', made4.secret);
      await tick(5);
      luis.view.shown = null;
      luis.controllers.teamCrypto.openJoin(luis.models.team.incoming.items[0], () => {});
      await luis.controllers.teamCrypto.openCode(made4.code, GUEST_PASSWORD, GUEST_PASSWORD);
      await luis.controllers.teamCrypto.finishJoin();
      await tick(5);
      assert.ok(await keystore.get('luis', s.enc.pid));
      await luis.models.team.leave(luis.models.projects.get('t:' + tid));
      await tick(5);
      assert.deepEqual(store.raw('teams', tid).memberIds, ['ana']);
      assert.equal(store.raw('teams/' + tid + '/crypto', 'luis'), undefined);
      assert.equal(await keystore.get('luis', s.enc.pid), null);
      ok('expulsar y salir: se borra la clave envuelta del miembro y, al salir, la de su navegador');
    }

    /* ----- un equipo sin cifrar sigue igual ----- */
    {
      await ana.models.projects.createTeam('Equipo normal', null, {tipo:'kanban'}, 'plain1');
      await tick(5);
      const plainTeam = ana.models.projects.get('t:plain1');
      await ana.models.team.invite(plainTeam, 'luis@example.test', 'editor');
      await tick(5);
      const inv = store.raw('invites', 'plain1_luis@example.test');
      assert.equal(inv.enc, undefined);
      assert.equal(inv.expiresAt, undefined);
      assert.equal(store.raw('invites/plain1_luis@example.test/key', 'wrap'), undefined);
      await luis.models.team.accept(luis.models.team.incoming.items.find((i) => i.teamId === 'plain1'));
      await tick(5);
      assert.deepEqual(store.raw('teams', 'plain1').memberIds, ['ana', 'luis']);
      assert.equal(store.raw('teams/plain1/crypto', 'luis'), undefined);
      assert.equal(await ana.controllers.teamCrypto.prepareInvite(plainTeam, PASSWORD), null);
      ok('equipos sin cifrar: invitar y aceptar funcionan como siempre, sin código');
    }

    /* Eliminar el equipo cifrado se lleva las invitaciones con su clave envuelta. */
    {
      const teamNow = ana.models.projects.get('t:' + tid);
      const made5 = await ana.controllers.teamCrypto.prepareInvite(teamNow, PASSWORD);
      await ana.models.team.invite(teamNow, 'nuria@example.test', 'viewer', made5.secret);
      await tick(5);
      await ana.models.projects.removeProject('t:' + tid, ana.rootDb, null);
      await tick(5);
      assert.equal(store.raw('teams', tid), undefined);
      assert.equal(store.raw('invites', tid + '_nuria@example.test'), undefined);
      assert.equal(store.raw('invites/' + tid + '_nuria@example.test/key', 'wrap'), undefined);
      assert.equal(store.raw('teams/' + tid + '/crypto', 'ana'), undefined);
      ok('eliminar un equipo cifrado borra sus invitaciones, las claves envueltas con código y las de los miembros');
    }
    tasks.disconnect(); clients.disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
