/* Cifrado por proyecto, PR10 del plan (docs/CIFRADO-PROYECTOS.md, 13.1): cambiar la clave de un
   proyecto con cifrado total. Entrega de la clave nueva con la clave pública de cada miembro, lectura
   con dos claves mientras dura el cambio, recifrado reanudable y lo que pasa si se corta a medias.
   Web Crypto real de Node y el Firestore en memoria de las pruebas (sin reglas: eso es tests/rules).
   Uso: node tests/crypto/key-rotation.test.js */
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

/* Almacén de claves del navegador: una casilla por cuenta y pid (la clave anterior va en «pid.kid»). */
const keys = new Map();
const keystore = {
  put:(rec) => { keys.set(rec.uid + ':' + rec.pid, Object.assign({}, rec)); return Promise.resolve('disk'); },
  get:(uid, pid) => Promise.resolve(keys.get(uid + ':' + pid) || null),
  forget:(uid, pid) => { keys.delete(uid + ':' + pid); return Promise.resolve(1); },
  forgetProject:(id, uid) => { [...keys.values()].filter((r) => r.projectId === id && r.uid === uid).forEach((r) => keys.delete(r.uid + ':' + r.pid)); return Promise.resolve(1); },
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
  'src/controllers/project-crypto-controller.js', 'src/controllers/team-crypto-controller.js',
  'src/controllers/key-rotation-controller.js', 'src/controllers/app-controller.js'
].forEach((rel) => new Function('Workhub', 'window', 'crypto', 'console', read(rel))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto, quiet));

const PC = Workhub.services.projectCrypto;
const b64 = Workhub.services.crypto;
const {ProjectModel, TeamModel, ProjectCipher, ProjectReseal} = Workhub.models;
const {ProjectCryptoController, TeamCryptoController, KeyRotationController, AppController} = Workhub.controllers;
const pcErr = (c) => (err) => { assert.equal(err && err.name, 'ProjectCryptoError', String(err && err.message)); assert.equal(err.code, c); return true; };
const coded = (c) => (err) => { assert.equal(err && err.code, c, String(err && err.message)); return true; };

const PASSWORD = 'una contraseña de cifrado larga';
const MEMBER_PASSWORD = 'otra frase distinta del miembro';
const JPEG = 'data:image/jpeg;base64,';

/* Base de datos de una cuenta sobre un almacén común, con la forma de la de firebase-backend. */
function accountDb(store, me){
  const base = 'users/' + me.uid + '/';
  const db = {
    me:me,
    collection:(p) => store.collection(base + p),
    doc:(p) => store.doc(base + p),
    team:(tid) => ({collection:(n) => store.collection('teams/' + tid + '/' + n), doc:(p) => store.doc('teams/' + tid + '/' + p)})
  };
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
        else if(v && v.__remove) at[last] = (at[last] || []).filter((x) => v.__remove.indexOf(x) === -1);
        else at[last] = v;
      });
      return ref.set(next);
    };
    return Object.assign({}, ref, {update:update});
  };
  db.teams = {
    query:() => store.collection('teams'),
    doc:teamDoc,
    newId:() => 'team-' + me.uid,
    invitesForMe:() => store.collection('invites').where('email', '==', me.email),
    invitesFrom:(tid) => store.collection('invites').where('teamId', '==', tid),
    cryptoDoc:(tid, who) => store.collection('teams/' + tid + '/crypto').doc(who),
    FieldValue:{delete:() => ({__delete:true}), arrayRemove:(...x) => ({__remove:x})}
  };
  return db;
}

/* Lo mínimo de la app: los modelos de proyectos, los controladores de cifrado y una «conexión» que
   busca la clave en el almacén como AppController.projectKey. */
function fakeApp(db){
  const projects = new ProjectModel();
  projects.connect(db);
  const view = {
    shown:null, note:'', error:'', mode:'', progress:[], members:null, closedDialog:0,
    bind(h){ this.handlers = h; },
    show(){}, showRotated(){ this.rotated = true; }, showManaged(){},
    setBusy(){}, showError(msg){ this.error = msg; },
    showKey(text, note){ this.shown = text; this.note = note || ''; }, showKeyError(msg){ this.error = msg; },
    showRecoverError(msg){ this.error = msg; },
    setDialogBusy(){}, showDialogError(msg){ this.error = msg; }, closeDialog(){ this.closedDialog++; },
    showDialogKey(text, mode){ this.shown = text; this.mode = mode || 'recovery-key'; },
    openRotate(members, team){ this.members = members; this.team = team; this.mode = 'rotate'; },
    setRunProgress(text){ this.progress.push(text); },
    open(){}, close(){}
  };
  const app = {rootDb:db, projectId:'', cipher:null, models:{projects:projects, team:new TeamModel(projects)}, controllers:{}, view:view,
    projectKey:AppController.prototype.projectKey,
    connectProject(){
      const p = projects.get(this.projectId);
      this.cipher = null;
      return (this.connecting = this.projectKey(p.enc).then((c) => { this.cipher = c; if(c) this.controllers.rotation.onOpen(); return c; }));
    }};
  app.controllers.crypto = new ProjectCryptoController(app, view);
  app.controllers.teamCrypto = new TeamCryptoController(app, Object.assign(Object.create(view), {bind(){}}));
  app.controllers.rotation = new KeyRotationController(app, view);
  return app;
}

async function open(app, id){
  app.projectId = id;
  await app.connectProject();
  await tick(5);
  return app.cipher;
}

/* Cambia la clave por el camino del diálogo: contraseña → clave de recuperación → confirmar. */
async function rotate(app, id, password){
  app.controllers.rotation.start(id);
  await tick(10);
  await app.controllers.rotation.submit(password);
  const recovery = app.view.shown;
  await app.controllers.rotation.confirm();
  await tick(10);
  return recovery;
}

(async () => {
  /* ---------- la clave nueva, envuelta con la clave pública del miembro ---------- */
  {
    const pid = PC.newPid(), kid = PC.newKid();
    const ctx = {pid:pid, kid:kid, uid:'luis'};
    const pair = await PC.newKeyPair();
    const raw = PC.newDekBytes();
    const key = await PC.importDek(raw);
    const kcv = await PC.kcv(key, pid, kid);
    const w = await PC.wrapForMember(raw, pair.pub, ctx);
    assert.deepEqual(Object.keys(w).sort(), ['ct', 'epk', 'iv']);
    assert.deepEqual(Object.keys(w.epk).sort(), ['crv', 'kty', 'x', 'y'], 'la clave efímera no lleva la parte privada');
    assert.ok(JSON.stringify(w).indexOf(PC.b64url(raw)) === -1 && w.ct.length <= 256);
    const got = await PC.unwrapFromOwner(w, pair.priv, ctx, false);
    assert.equal(got.extractable, false);
    assert.ok(await PC.checkKcv(got, pid, kid, kcv), 'el miembro obtiene la misma clave');
    const w2 = await PC.wrapForMember(raw, pair.pub, ctx);
    assert.notEqual(w2.epk.x, w.epk.x, 'par efímero nuevo en cada entrega');
    const other = await PC.newKeyPair();
    await assert.rejects(PC.unwrapFromOwner(w, other.priv, ctx), pcErr('bad-rekey'));
    await assert.rejects(PC.unwrapFromOwner(w, pair.priv, Object.assign({}, ctx, {uid:'marta'})), pcErr('bad-rekey'));
    await assert.rejects(PC.unwrapFromOwner(w, pair.priv, Object.assign({}, ctx, {kid:PC.newKid()})), pcErr('bad-rekey'));
    await assert.rejects(PC.unwrapFromOwner(w, pair.priv, Object.assign({}, ctx, {pid:PC.newPid()})), pcErr('bad-rekey'));
    await assert.rejects(PC.unwrapFromOwner(Object.assign({}, w, {ct:w.ct.slice(0, -2) + 'AA'}), pair.priv, ctx), pcErr('bad-rekey'));
    await assert.rejects(PC.wrapForMember(raw, {kty:'EC', crv:'P-384', x:pair.pub.x, y:pair.pub.y}, ctx), pcErr('bad-format'));
    await assert.rejects(PC.wrapForMember(raw, {kty:'EC', crv:'P-256', x:'corta', y:pair.pub.y}, ctx), pcErr('bad-format'));
    await assert.rejects(PC.wrapForMember(raw, null, ctx), pcErr('bad-format'));
    await assert.rejects(PC.unwrapFromOwner(w, new Uint8Array(0), ctx), pcErr('bad-format'));

    const fp = await PC.fingerprint(pair.pub);
    assert.match(fp, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.equal(await PC.fingerprint({kty:'EC', crv:'P-256', x:pair.pub.x, y:pair.pub.y}), fp, 'la huella no depende del orden ni de campos de más');
    assert.notEqual(await PC.fingerprint(other.pub), fp);
    await assert.rejects(PC.fingerprint({kty:'EC'}), pcErr('bad-format'));
    ok('entrega de la clave: ECDH P-256 efímero, ligada al proyecto, a la clave y al miembro; huella de 60 bits');
  }

  /* ---------- un cifrador con la clave anterior lee lo viejo y escribe con la nueva ---------- */
  {
    const pid = PC.newPid(), kid1 = PC.newKid(), kid2 = PC.newKid();
    const key1 = await PC.importDek(PC.newDekBytes()), key2 = await PC.importDek(PC.newDekBytes());
    const old = new ProjectCipher({pid:pid, kid:kid1, key:key1});
    const both = new ProjectCipher({pid:pid, kid:kid2, key:key2, prev:[{kid:kid1, key:key1}]});
    const onlyNew = new ProjectCipher({pid:pid, kid:kid2, key:key2});
    const raw = await old.seal('tasks', 't1', {title:'Secreta', status:'todo'});
    assert.equal((await both.open('tasks', 't1', raw)).plain.title, 'Secreta');
    await assert.rejects(onlyNew.open('tasks', 't1', raw), coded('undecryptable'));
    assert.deepEqual([both.canOpen(kid1), both.canOpen(kid2), onlyNew.canOpen(kid1), both.canOpen('otra')], [true, true, false, false]);
    const again = await both.seal('tasks', 't1', {title:'Secreta', status:'todo'});
    assert.equal(again.kid, kid2, 'siempre se escribe con la clave vigente');
    await assert.rejects(old.open('tasks', 't1', again), coded('undecryptable'), 'la clave anterior no abre lo nuevo');
    /* La anterior no sirve para otro documento ni con el kid cambiado a mano. */
    await assert.rejects(both.open('tasks', 't2', raw), coded('undecryptable'));
    await assert.rejects(both.open('tasks', 't1', Object.assign({}, raw, {kid:kid2})), coded('undecryptable'));
    const img = await old.sealBytes('assets', 'i1', new Uint8Array([1, 2, 3]));
    assert.deepEqual([...await both.openBytes('assets', 'i1', img)], [1, 2, 3]);
    const blob = await old.sealBlob('backup-history', 'v1', '{"a":1}');
    assert.equal(await both.openBlob('backup-history', 'v1', blob, kid1), '{"a":1}');
    await assert.rejects(both.openBlob('backup-history', 'v1', blob), coded('undecryptable'));
    await assert.rejects(onlyNew.openBlob('backup-history', 'v1', blob, kid1), coded('undecryptable'));
    ok('cifrador con clave anterior: lee con las dos, escribe con la vigente');
  }

  /* ---------- proyecto personal: cambiar la clave de principio a fin ---------- */
  const store = fakeDb();
  const ana = fakeApp(accountDb(store, {uid:'ana', name:'Ana', email:'ana@example.test', photo:''}));
  let recovery1;
  const imageBytes = new Uint8Array(300).map((v, i) => (i * 7) % 256);
  {
    recovery1 = ana.controllers.crypto.prepare();
    await ana.controllers.crypto.create({id:'p1', nombre:'Reservado', config:{tipo:'soporte'}, password:PASSWORD, trusted:false});
    await tick(5);
    const cipher = await open(ana, 'p1');
    assert.ok(cipher);
    const scope = ProjectModel.scope(ana.rootDb, 'p1');
    const put = async (p, id, data) => scope.collection(p).doc(id).set(await cipher.seal(p, id, data));
    await put('tasks', 't1', {title:'Tarea secreta', desc:'Descripción reservada', status:'pendiente', order:1});
    await put('tasks', 't2', {title:'Otra tarea', status:'proceso', order:2});
    await put('tasks/t1/notes', 'n1', {text:'Nota confidencial', createdAt:1, imageAssetId:'img1'});
    await put('clients', 'c1', {nombre:'Cliente Reservado', color:3});
    await put('contacts', 'k1', {nombre:'Contacto', email:'c@example.test'});
    await put('meetings', 'm1', {title:'Reunión', date:'2026-10-05'});
    await put('vault', 'v1', {label:'Servidor', usuario:'root', iv:'iv', cipher:'cifrado-del-cofre', order:1});
    await put('plugin_data', 'workhub.informe', {values:{dato:'valor privado'}, updatedAt:1});
    await scope.collection('plugin_data').doc('install:workhub.informe').set({_kind:'plugin-install', pluginId:'workhub.informe', url:'x', installedAt:1});
    await ana.rootDb.collection('assets').doc('img1').set(Object.assign({createdAt:1}, await cipher.sealBytes('assets', 'img1', imageBytes)));
    /* Un documento en claro que dejó un cliente antiguo y uno que ya no se podía leer. */
    await scope.collection('clients').doc('c2').set({nombre:'En claro', color:1, createdAt:2});
    const foreign = new ProjectCipher({pid:cipher.pid, kid:cipher.kid, key:await PC.importDek(PC.newDekBytes())});
    await scope.collection('contacts').doc('roto').set(await foreign.seal('contacts', 'roto', {nombre:'Ilegible'}));
    /* Una imagen de otro proyecto de la misma cuenta: no se toca. */
    await ana.rootDb.collection('assets').doc('ajena').set({data:JPEG + 'AAAA', contentType:'image/jpeg', createdAt:1});

    const before = ana.models.projects.get('p1').enc;
    const wrapBefore = store.raw('users/ana/projects/p1/crypto', 'ana');
    assert.equal(ana.controllers.rotation.canRotate(ana.models.projects.get('p1')), true);

    ana.controllers.rotation.start('p1');
    await tick(10);
    assert.deepEqual([ana.view.mode, ana.view.members, ana.view.team], ['rotate', [], false]);
    await ana.controllers.rotation.submit('no es la contraseña');
    assert.equal(ana.view.error, 'Contraseña incorrecta.');
    assert.deepEqual(store.raw('users/ana/projects/p1/crypto', 'ana'), wrapBefore, 'con la contraseña mal no se toca nada');
    await ana.controllers.rotation.submit(PASSWORD);
    assert.equal(ana.view.mode, 'rotate-key');
    const recovery2 = ana.view.shown;
    assert.match(recovery2, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    assert.notEqual(recovery2, recovery1);
    assert.deepEqual(store.raw('users/ana/projects/p1/crypto', 'ana'), wrapBefore, 'hasta confirmar la clave de recuperación no se escribe nada');
    assert.deepEqual(ana.models.projects.get('p1').enc, before);

    await ana.controllers.rotation.confirm();
    await tick(10);
    assert.equal(ana.view.closedDialog, 1);
    assert.ok(ana.view.progress.some((t) => /Cifrando de nuevo… \d+ de \d+/.test(t)), 'se enseña el avance');
    assert.ok(toasts.some((t) => t.indexOf('Clave de «Reservado» cambiada') === 0));
    assert.ok(toasts.some((t) => t.indexOf('ERROR 1 elementos no se han podido descifrar') === 0), 'lo ilegible se cuenta');

    const enc = ana.models.projects.get('p1').enc;
    assert.equal(enc.pid, before.pid, 'el proyecto es el mismo');
    assert.notEqual(enc.kid, before.kid);
    assert.notEqual(enc.kcv, before.kcv);
    assert.deepEqual(Object.keys(enc).sort(), ['createdAt', 'kcv', 'kid', 'mode', 'pid', 'v'], 'al terminar no queda rot');
    assert.equal(enc.createdAt, before.createdAt);

    const wrap = store.raw('users/ana/projects/p1/crypto', 'ana');
    assert.equal(wrap.kid, enc.kid);
    assert.equal(wrap.old, undefined, 'al terminar mi clave envuelta ya no guarda la anterior');
    const rec = await keystore.get('ana', enc.pid);
    assert.deepEqual([rec.kid, rec.key.extractable, rec.trusted], [enc.kid, false, false]);
    assert.equal(await keystore.get('ana', ProjectModel.keySlot(enc.pid, before.kid)), null, 'la clave anterior se olvida');

    /* Todo está sellado con la clave nueva y solo ella lo abre. */
    const fresh = new ProjectCipher({pid:enc.pid, kid:enc.kid, key:rec.key});
    const base = 'users/ana/projects/p1/';
    const expect = [['tasks', 't1', 'title', 'Tarea secreta'], ['tasks', 't2', 'title', 'Otra tarea'], ['tasks/t1/notes', 'n1', 'text', 'Nota confidencial'],
      ['clients', 'c1', 'nombre', 'Cliente Reservado'], ['clients', 'c2', 'nombre', 'En claro'], ['contacts', 'k1', 'nombre', 'Contacto'],
      ['meetings', 'm1', 'title', 'Reunión'], ['vault', 'v1', 'label', 'Servidor']];
    for(const [p, id, field, value] of expect){
      const raw = store.raw(base + p, id);
      assert.equal(raw.kid, enc.kid, p + '/' + id + ' lleva la clave nueva');
      assert.equal((await fresh.open(p, id, raw)).plain[field], value);
      await assert.rejects(cipher.open(p, id, raw), coded('undecryptable'), 'la clave anterior ya no abre ' + p + '/' + id);
    }
    assert.deepEqual([store.raw(base + 'tasks', 't1').status, store.raw(base + 'tasks', 't1').order], ['pendiente', 1], 'los campos en claro no cambian');
    assert.equal(store.raw(base + 'tasks/t1/notes', 'n1').imageAssetId, 'img1');
    assert.deepEqual([store.raw(base + 'vault', 'v1').cipher, store.raw(base + 'clients', 'c2').color], ['cifrado-del-cofre', 1]);
    assert.equal(store.raw(base + 'clients', 'c2').nombre, undefined, 'lo que estaba en claro queda sellado');
    assert.deepEqual((await fresh.open('plugin_data', 'workhub.informe', store.raw(base + 'plugin_data', 'workhub.informe'))).plain.values, {dato:'valor privado'});
    assert.equal(store.raw(base + 'plugin_data', 'install:workhub.informe')._kind, 'plugin-install', 'la marca de instalación sigue en claro');
    assert.deepEqual([...await fresh.openBytes('assets', 'img1', store.raw('users/ana/assets', 'img1'))], [...imageBytes]);
    assert.equal(store.raw('users/ana/assets', 'ajena').data, JPEG + 'AAAA', 'las imágenes de otros proyectos no se tocan');
    assert.equal(store.raw(base + 'contacts', 'roto').kid, before.kid, 'lo que no se podía leer se deja como estaba');

    /* La contraseña sigue valiendo; la clave de recuperación anterior, no. */
    const ctx = {pid:enc.pid, kid:enc.kid, uid:'ana'};
    assert.ok(await PC.checkKcv(await PC.unwrapPassword(wrap, PASSWORD, ctx, false), enc.pid, enc.kid, enc.kcv));
    assert.ok(await PC.checkKcv(await PC.unwrapRecovery(wrap, recovery2, ctx, false), enc.pid, enc.kid, enc.kcv));
    await assert.rejects(PC.unwrapRecovery(wrap, recovery1, ctx, false), pcErr('bad-recovery'));
    /* Y lo antiguo que alguien se hubiera copiado no abre lo nuevo. */
    await assert.rejects(PC.unwrapPassword(wrapBefore, PASSWORD, ctx, false), pcErr('bad-password'));
    recovery1 = recovery2;
    ok('proyecto personal: clave nueva, todo recifrado, clave de recuperación nueva y la anterior olvidada');

    /* Repetir el recifrado no cambia nada. */
    const again = await new ProjectReseal({rootDb:ana.rootDb, projectId:'p1', cipher:fresh}).run();
    assert.deepEqual(again, {changed:0, skipped:1});
    ok('recifrado: una segunda pasada no toca nada');
  }

  /* ---------- si falla antes de cambiar el proyecto, no ha cambiado nada ---------- */
  {
    await open(ana, 'p1');
    const before = ana.models.projects.get('p1').enc;
    const wrapBefore = store.raw('users/ana/projects/p1/crypto', 'ana');
    const realUpdate = ana.models.projects.update;
    ana.models.projects.update = () => Promise.reject(Object.assign(new Error('boom'), {code:'permission-denied'}));
    ana.view.error = '';
    await rotate(ana, 'p1', PASSWORD);
    ana.models.projects.update = realUpdate;
    assert.ok(ana.view.error.indexOf('No se pudo cambiar la clave.') === 0 && ana.view.error.indexOf('permission-denied') !== -1, ana.view.error);
    assert.deepEqual(ana.models.projects.get('p1').enc, before);
    assert.deepEqual(store.raw('users/ana/projects/p1/crypto', 'ana'), wrapBefore, 'mi clave envuelta vuelve a ser la de antes');
    assert.equal((await keystore.get('ana', before.pid)).kid, before.kid, 'la clave de este navegador vuelve a ser la vigente');
    assert.equal([...keys.keys()].filter((k) => k.indexOf('ana:' + before.pid + '.') === 0).length, 0);
    assert.equal(ana.controllers.rotation.running, '');
    assert.ok(await open(ana, 'p1'), 'el proyecto se sigue abriendo');
    ok('fallo antes de empezar: ni el proyecto, ni mi clave envuelta, ni el navegador cambian');

    /* Se cerró la pestaña justo después de guardar mi clave envuelta nueva (el proyecto sigue con la
       anterior): al leerla se deshace sola. */
    ana.controllers.rotation.start('p1');
    await tick(10);
    await ana.controllers.rotation.submit(PASSWORD);
    const s = ana.controllers.rotation.state;
    const half = Object.assign({}, wrapBefore, {kid:PC.newKid(), old:{kid:before.kid, kdf:wrapBefore.kdf, pw:wrapBefore.pw,
      rk:(await PC.wrapRecovery(s.oldDek, s.recovery.bytes, {pid:before.pid, kid:before.kid, uid:'ana'})).rk}});
    await ana.controllers.crypto.wrapRef('p1').set(half);
    ana.controllers.rotation.closed();
    const doc = await ana.controllers.crypto.readWrap('p1', before);
    assert.deepEqual([doc.kid, doc.old], [before.kid, undefined]);
    assert.deepEqual(store.raw('users/ana/projects/p1/crypto', 'ana').kid, before.kid);
    assert.ok(await PC.unwrapPassword(doc, PASSWORD, {pid:before.pid, kid:before.kid, uid:'ana'}, false));
    /* La clave de recuperación que se enseñó (y se confirmó) antes del corte es la que vale. */
    assert.ok(await PC.unwrapRecovery(doc, s.recovery.text, {pid:before.pid, kid:before.kid, uid:'ana'}, false));
    recovery1 = s.recovery.text;
    ok('corte tras guardar mi clave envuelta: se deshace al leerla y el proyecto se abre como antes');
  }

  /* ---------- corte a medias del recifrado: se reanuda ---------- */
  {
    await open(ana, 'p1');
    const before = ana.models.projects.get('p1').enc;
    const oldCipher = ana.cipher;
    /* La red falla al recifrar una de las tareas. */
    const realOne = ProjectReseal.prototype.one;
    ProjectReseal.prototype.one = function(job){
      return job.id === 't2' ? Promise.reject(Object.assign(new Error('sin red'), {code:'unavailable'})) : realOne.call(this, job);
    };
    toasts.length = 0;
    const recovery = await rotate(ana, 'p1', PASSWORD);
    ProjectReseal.prototype.one = realOne;
    assert.ok(toasts.some((t) => t.indexOf('ERROR La clave ya ha cambiado') === 0), toasts.join(' | '));
    const mid = ana.models.projects.get('p1').enc;
    assert.notEqual(mid.kid, before.kid);
    assert.deepEqual([mid.rot.kid, mid.rot.kcv], [before.kid, before.kcv], 'el proyecto apunta la clave anterior');
    assert.equal(ProjectModel.isRotating({enc:mid}), true);
    const base = 'users/ana/projects/p1/';
    const kids = [];
    ['tasks', 'tasks/t1/notes', 'clients', 'contacts', 'meetings', 'vault', 'plugin_data'].forEach((c) => store.rawAll(base + c).forEach((d) => kids.push(d.kid)));
    kids.push(store.raw('users/ana/assets', 'img1').kid);
    assert.ok(kids.indexOf(before.kid) !== -1 && kids.indexOf(mid.kid) !== -1, 'conviven documentos con la clave anterior y con la nueva');
    const wrapMid = store.raw(base + 'crypto', 'ana');
    assert.deepEqual([wrapMid.kid, wrapMid.old.kid], [mid.kid, before.kid], 'mi clave envuelta guarda las dos');
    assert.equal(AppController.encSig(mid), [mid.pid, mid.kid, before.kid].join('|'));
    assert.notEqual(AppController.encSig(mid), AppController.encSig(before));

    /* Mientras tanto se lee todo: lo nuevo con la clave vigente y lo viejo con la anterior. */
    ana.controllers.rotation.gaveUp = {[mid.pid]:true};   /* que no se reanude solo todavía */
    const both = await open(ana, 'p1');
    assert.ok(both && both.kid === mid.kid && both.canOpen(before.kid));
    for(const id of ['t1', 't2']){
      assert.ok((await both.open('tasks', id, store.raw(base + 'tasks', id))).plain.title);
    }
    /* Lo que se escriba ahora va con la clave nueva. */
    const scope = ProjectModel.scope(ana.rootDb, 'p1');
    await scope.collection('tasks').doc('t3').set(await both.seal('tasks', 't3', {title:'Durante el cambio', status:'pendiente'}));
    assert.equal(store.raw(base + 'tasks', 't3').kid, mid.kid);

    /* Cierra sesión (se pierden las claves del navegador) y vuelve a entrar con la contraseña: mi
       clave envuelta devuelve las dos y el cambio se termina solo. */
    await keystore.forgetUser('ana');
    assert.equal(await open(ana, 'p1'), null, 'sin claves, bloqueado');
    ana.controllers.rotation.gaveUp = {};
    toasts.length = 0;
    await ana.controllers.crypto.unlock(PASSWORD, false);
    await ana.connecting;
    await toasted();
    assert.ok(toasts.some((t) => t.indexOf('Cambio de clave de «Reservado» terminado') === 0), toasts.join(' | '));
    const end = ana.models.projects.get('p1').enc;
    assert.deepEqual([end.kid, end.rot], [mid.kid, undefined]);
    const rec = await keystore.get('ana', end.pid);
    const fresh = new ProjectCipher({pid:end.pid, kid:end.kid, key:rec.key});
    for(const [p, id] of [['tasks', 't1'], ['tasks', 't2'], ['tasks', 't3'], ['clients', 'c1'], ['clients', 'c2'], ['contacts', 'k1'], ['meetings', 'm1'], ['vault', 'v1'], ['tasks/t1/notes', 'n1']]){
      const raw = store.raw(base + p, id);
      assert.equal(raw.kid, end.kid, p + '/' + id);
      assert.ok((await fresh.open(p, id, raw)).plain);
      await assert.rejects(oldCipher.open(p, id, raw), coded('undecryptable'));
    }
    assert.deepEqual([...await fresh.openBytes('assets', 'img1', store.raw('users/ana/assets', 'img1'))], [...imageBytes]);
    assert.equal(store.raw(base + 'crypto', 'ana').old, undefined);
    assert.equal(await keystore.get('ana', ProjectModel.keySlot(end.pid, before.kid)), null);
    assert.ok(await PC.unwrapRecovery(store.raw(base + 'crypto', 'ana'), recovery, {pid:end.pid, kid:end.kid, uid:'ana'}, false));
    recovery1 = recovery;
    ok('corte a medias: se lee con las dos claves y al volver a entrar con la contraseña se termina solo');
  }

  /* ---------- a medias: cambiar la contraseña y recuperar el acceso conservan la clave anterior ---------- */
  {
    await open(ana, 'p1');
    const before = ana.models.projects.get('p1').enc;
    const realOne = ProjectReseal.prototype.one;
    ProjectReseal.prototype.one = () => Promise.reject(Object.assign(new Error('sin red'), {code:'unavailable'}));
    const recovery = await rotate(ana, 'p1', PASSWORD);
    ProjectReseal.prototype.one = realOne;
    const mid = ana.models.projects.get('p1').enc;
    assert.equal(mid.rot.kid, before.kid);
    ana.controllers.rotation.gaveUp = {[mid.pid]:true};
    const oldCtx = {pid:mid.pid, kid:before.kid, uid:'ana'};
    const base = 'users/ana/projects/p1/';

    /* Cambiar la contraseña. */
    const NEW_PASSWORD = 'contraseña nueva bastante larga';
    ana.controllers.crypto.editing = 'p1';
    await ana.controllers.crypto.changePassword(PASSWORD, NEW_PASSWORD, NEW_PASSWORD);
    let wrap = store.raw(base + 'crypto', 'ana');
    assert.ok(await PC.unwrapPassword(wrap, NEW_PASSWORD, {pid:mid.pid, kid:mid.kid, uid:'ana'}, false));
    assert.ok(await PC.checkKcv(await PC.unwrapPassword({kdf:wrap.old.kdf, pw:wrap.old.pw}, NEW_PASSWORD, oldCtx, false), mid.pid, before.kid, before.kcv),
      'la clave anterior también pasa a la contraseña nueva');
    await assert.rejects(PC.unwrapPassword({kdf:wrap.old.kdf, pw:wrap.old.pw}, PASSWORD, oldCtx, false), pcErr('bad-password'));

    /* Clave de recuperación nueva. */
    await ana.controllers.crypto.newRecovery(NEW_PASSWORD);
    const recovery3 = ana.view.shown;
    await ana.controllers.crypto.finishNewRecovery();
    wrap = store.raw(base + 'crypto', 'ana');
    assert.ok(await PC.checkKcv(await PC.unwrapRecovery({rk:wrap.old.rk}, recovery3, oldCtx, false), mid.pid, before.kid, before.kcv));
    await assert.rejects(PC.unwrapRecovery({rk:wrap.old.rk}, recovery, oldCtx, false), pcErr('bad-recovery'));

    /* He olvidado la contraseña: con la clave de recuperación vuelven las dos claves. */
    await keystore.forgetUser('ana');
    await open(ana, 'p1');
    const LAST_PASSWORD = 'la tercera contraseña del proyecto';
    await ana.controllers.crypto.recover(recovery3, LAST_PASSWORD, LAST_PASSWORD, false);
    const recovery4 = ana.view.shown;
    assert.notEqual(recovery4, recovery3);
    ana.controllers.rotation.gaveUp = {};
    toasts.length = 0;
    await ana.controllers.crypto.finishRecover();
    await ana.connecting;
    await toasted();
    assert.ok(toasts.some((t) => t.indexOf('Cambio de clave de «Reservado» terminado') === 0), toasts.join(' | '));
    const end = ana.models.projects.get('p1').enc;
    assert.equal(end.rot, undefined);
    wrap = store.raw(base + 'crypto', 'ana');
    assert.equal(wrap.old, undefined);
    assert.ok(await PC.unwrapPassword(wrap, LAST_PASSWORD, {pid:end.pid, kid:end.kid, uid:'ana'}, false));
    assert.equal(store.raw(base + 'tasks', 't1').kid, end.kid);
    ok('a medias: cambiar la contraseña, crear otra clave de recuperación y recuperar el acceso conservan la clave anterior');
  }

  /* ---------- equipo: el propietario cambia la clave y cada miembro recibe la nueva ---------- */
  {
    const luis = fakeApp(accountDb(store, {uid:'luis', name:'Luis', email:'luis@example.test', photo:''}));
    const marta = fakeApp(accountDb(store, {uid:'marta', name:'Marta', email:'marta@example.test', photo:''}));
    const nora = fakeApp(accountDb(store, {uid:'nora', name:'Nora', email:'nora@example.test', photo:''}));
    const tid = 'eq1', id = 't:eq1';
    const pid = PC.newPid(), kid = PC.newKid();
    const raw = PC.newDekBytes();
    const key = await PC.importDek(raw);
    const enc = {v:1, mode:'pw', pid:pid, kid:kid, kcv:await PC.kcv(key, pid, kid), createdAt:5};
    const member = (uid, name, role) => ({role:role, name:name, email:uid + '@example.test', photo:''});
    await store.collection('teams').doc(tid).set({nombre:'Equipo reservado', createdAt:5, ownerUid:'ana', tipo:'soporte', enc:enc,
      memberIds:['ana', 'luis', 'marta', 'nora'],
      members:{ana:member('ana', 'Ana', 'owner'), luis:member('luis', 'Luis', 'editor'), marta:member('marta', 'Marta', 'viewer'), nora:member('nora', 'Nora', 'editor')}});
    const recoveries = {};
    for(const [app, pw] of [[ana, PASSWORD], [luis, MEMBER_PASSWORD], [marta, MEMBER_PASSWORD], [nora, MEMBER_PASSWORD]]){
      const uid = app.rootDb.me.uid;
      const rk = PC.newRecoveryKey();
      recoveries[uid] = rk.text;
      await store.collection('teams/' + tid + '/crypto').doc(uid).set(await app.controllers.teamCrypto.wrapDoc(raw, pw, rk.bytes, {pid:pid, kid:kid, uid:uid}));
      await keystore.put({uid:uid, pid:pid, projectId:id, kid:kid, key:key, trusted:false});
    }
    await tick(10);
    const cipher1 = new ProjectCipher({pid:pid, kid:kid, key:key});
    const base = 'teams/' + tid + '/';
    const put = async (p, docId, data) => store.collection(base + p).doc(docId).set(await cipher1.seal(p, docId, data));
    await put('tasks', 'a', {title:'Del equipo', status:'pendiente', assignees:['luis']});
    await put('tasks/a/notes', 'n', {text:'Nota del equipo', createdAt:1, imageAssetId:'foto'});
    await put('clients', 'c', {nombre:'Cliente del equipo'});
    await store.collection(base + 'assets').doc('foto').set(Object.assign({createdAt:1}, await cipher1.sealBytes('assets', 'foto', imageBytes)));

    /* Al abrir el proyecto cada miembro publica su clave pública (Nora no lo ha abierto todavía). */
    for(const app of [ana, luis, marta]){
      assert.ok(await open(app, id));
      await tick(10);
      const uid = app.rootDb.me.uid;
      assert.deepEqual(store.raw(base + 'pubkeys', uid).pub, store.raw(base + 'crypto', uid).pub, uid + ' publica su clave pública');
      assert.deepEqual(Object.keys(store.raw(base + 'pubkeys', uid)).sort(), ['pub', 'updatedAt', 'v']);
    }
    assert.equal(store.raw(base + 'pubkeys', 'nora'), undefined);
    const writes = store.log.writes.length;
    ana.controllers.rotation.published = {};
    await ana.controllers.rotation.ensurePub(id);
    assert.equal(store.log.writes.length, writes, 'si ya está publicada no se vuelve a escribir');

    /* Solo el propietario cambia la clave. */
    assert.equal(luis.controllers.rotation.canRotate(luis.models.projects.get(id)), false);
    assert.equal(ana.controllers.rotation.canRotate(ana.models.projects.get(id)), true);

    /* Ana quita a Marta y cambia la clave. */
    await ana.models.team.removeMember(ana.models.projects.get(id), 'marta');
    await tick(10);
    assert.deepEqual(['crypto', 'pubkeys', 'rekey'].map((c) => store.raw(base + c, 'marta')), [undefined, undefined, undefined], 'al quitarla se borran su clave envuelta y su clave pública');

    ana.controllers.rotation.start(id);
    await tick(10);
    const listed = ana.view.members;
    assert.deepEqual(listed.map((m) => [m.uid, !!m.pub]), [['luis', true], ['nora', false]], 'Nora no puede recibir la clave nueva; Marta ya no está');
    assert.equal(listed[0].fp, await PC.fingerprint(store.raw(base + 'crypto', 'luis').pub));
    assert.equal(ana.view.team, true);
    await ana.controllers.rotation.submit(PASSWORD);
    await ana.controllers.rotation.confirm();
    await tick(10);

    const next = store.raw('teams', tid).enc;
    assert.deepEqual([next.pid, next.rot, next.kid !== kid], [pid, undefined, true]);
    const rekey = store.raw(base + 'rekey', 'luis');
    assert.deepEqual(Object.keys(rekey).sort(), ['createdAt', 'ct', 'epk', 'from', 'iv', 'kid', 'v'], 'solo los campos que admiten las reglas');
    assert.deepEqual([rekey.kid, rekey.from, rekey.v], [next.kid, 'ana', 1]);
    assert.equal(store.raw(base + 'rekey', 'nora'), undefined);
    assert.equal(store.raw(base + 'rekey', 'marta'), undefined);
    assert.equal(store.raw(base + 'rekey', 'ana'), undefined);
    for(const [p, docId] of [['tasks', 'a'], ['tasks/a/notes', 'n'], ['clients', 'c'], ['assets', 'foto']]){
      assert.equal(store.raw(base + p, docId).kid, next.kid, p + ' con la clave nueva');
    }
    /* La clave que Marta pudo copiarse ya no abre nada. */
    await assert.rejects(cipher1.open('tasks', 'a', store.raw(base + 'tasks', 'a')), coded('undecryptable'));
    await assert.rejects(cipher1.openBytes('assets', 'foto', store.raw(base + 'assets', 'foto')), coded('undecryptable'));
    /* El propietario conserva su par de claves, envuelto para la clave nueva. */
    const anaWrap = store.raw(base + 'crypto', 'ana');
    assert.deepEqual(anaWrap.pub, store.raw(base + 'pubkeys', 'ana').pub);
    assert.ok(await PC.unwrapPrivate(anaWrap, PASSWORD, {pid:pid, kid:next.kid, uid:'ana'}));
    ok('equipo: clave nueva, todo recifrado y la clave entregada solo a quien sigue y tiene clave pública');

    /* Luis: su navegador tiene la clave anterior, así que se le pide la contraseña. */
    await tick(10);
    assert.equal(await open(luis, id), null);
    luis.view.rotated = false;
    luis.controllers.crypto.onLocked();
    await tick(10);
    assert.equal(luis.view.rotated, true, 'se le dice que la clave ha cambiado');
    luis.view.error = '';
    await luis.controllers.crypto.unlock('no es su contraseña', false);
    assert.equal(luis.view.error, 'Contraseña incorrecta.');
    assert.equal(store.raw(base + 'crypto', 'luis').kid, kid, 'con la contraseña mal no cambia nada');
    await luis.controllers.crypto.unlock(MEMBER_PASSWORD, false);
    const luisRecovery = luis.view.shown;
    assert.match(luisRecovery, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    assert.notEqual(luisRecovery, recoveries.luis);
    assert.ok(luis.view.note.indexOf('ha cambiado la clave') !== -1);
    assert.equal(store.raw(base + 'crypto', 'luis').kid, kid, 'hasta confirmar la clave de recuperación no se guarda nada');
    const pubBefore = store.raw(base + 'crypto', 'luis').pub;
    await luis.controllers.crypto.finishRecover();
    await luis.connecting;
    await tick(10);
    const luisWrap = store.raw(base + 'crypto', 'luis');
    const luisCtx = {pid:pid, kid:next.kid, uid:'luis'};
    assert.equal(luisWrap.kid, next.kid);
    assert.equal(luisWrap.old, undefined, 'el cambio ya había terminado: no guarda la anterior');
    assert.deepEqual(luisWrap.pub, pubBefore, 'conserva su par de claves');
    assert.ok(await PC.unwrapPrivate(luisWrap, MEMBER_PASSWORD, luisCtx));
    assert.ok(await PC.checkKcv(await PC.unwrapPassword(luisWrap, MEMBER_PASSWORD, luisCtx, false), pid, next.kid, next.kcv));
    assert.ok(await PC.checkKcv(await PC.unwrapRecovery(luisWrap, luisRecovery, luisCtx, false), pid, next.kid, next.kcv));
    await assert.rejects(PC.unwrapRecovery(luisWrap, recoveries.luis, luisCtx, false), pcErr('bad-recovery'));
    assert.ok(luis.cipher && luis.cipher.kid === next.kid, 'el proyecto se abre con la clave nueva');
    assert.equal((await luis.cipher.open('tasks', 'a', store.raw(base + 'tasks', 'a'))).plain.title, 'Del equipo');
    ok('miembro: con su contraseña recibe la clave nueva, conserva su par y estrena clave de recuperación');

    /* Nora no tenía clave pública publicada: no hay clave para ella. */
    assert.equal(await open(nora, id), null);
    nora.view.error = '';
    await nora.controllers.crypto.unlock(MEMBER_PASSWORD, false);
    assert.ok(nora.view.error.indexOf('tu cuenta no ha recibido la nueva') !== -1, nora.view.error);
    assert.equal(store.raw(base + 'crypto', 'nora').kid, kid);
    /* Y con su clave de recuperación (anterior al cambio) tampoco. */
    nora.view.error = '';
    await nora.controllers.crypto.recover(recoveries.nora, MEMBER_PASSWORD, MEMBER_PASSWORD, false);
    assert.ok(nora.view.error.indexOf('es anterior al cambio') !== -1, nora.view.error);
    ok('miembro sin clave pública publicada: no recibe la clave y se le dice qué hacer');

    /* Una clave dejada para Luis no le sirve a nadie más, ni a él para otra clave. */
    const luisPriv = await PC.unwrapPrivate(luisWrap, MEMBER_PASSWORD, luisCtx);
    const noraPriv = await PC.unwrapPrivate(store.raw(base + 'crypto', 'nora'), MEMBER_PASSWORD, {pid:pid, kid:kid, uid:'nora'});
    await assert.rejects(PC.unwrapFromOwner(rekey, noraPriv, {pid:pid, kid:next.kid, uid:'nora'}), pcErr('bad-rekey'));
    await assert.rejects(PC.unwrapFromOwner(rekey, noraPriv, luisCtx), pcErr('bad-rekey'));
    assert.ok(await PC.unwrapFromOwner(rekey, luisPriv, luisCtx));
    ok('la clave entregada a un miembro solo la abre ese miembro');

    /* Miembro que entra a mitad del cambio: guarda la clave anterior hasta que termine. */
    {
      const realOne = ProjectReseal.prototype.one;
      ProjectReseal.prototype.one = () => Promise.reject(Object.assign(new Error('sin red'), {code:'unavailable'}));
      await open(ana, id);
      await rotate(ana, id, PASSWORD);
      ProjectReseal.prototype.one = realOne;
      const mid = store.raw('teams', tid).enc;
      assert.equal(mid.rot.kid, next.kid);
      ana.controllers.rotation.gaveUp = {[pid]:true};
      await tick(10);
      assert.equal(await open(luis, id), null);
      await luis.controllers.crypto.unlock(MEMBER_PASSWORD, true);
      await luis.controllers.crypto.finishRecover();
      await luis.connecting;
      await tick(10);
      const w = store.raw(base + 'crypto', 'luis');
      assert.deepEqual([w.kid, w.old.kid], [mid.kid, next.kid], 'su clave envuelta guarda también la anterior');
      assert.ok(luis.cipher && luis.cipher.kid === mid.kid && luis.cipher.canOpen(next.kid), 'lee con las dos');
      assert.equal((await luis.cipher.open('tasks', 'a', store.raw(base + 'tasks', 'a'))).plain.title, 'Del equipo');
      const slot = await keystore.get('luis', ProjectModel.keySlot(pid, next.kid));
      assert.deepEqual([slot.kid, slot.trusted, slot.key.extractable], [next.kid, true, false]);
      /* Un miembro no termina el cambio de clave: eso es cosa del propietario. */
      assert.equal(store.raw('teams', tid).enc.rot.kid, next.kid);
      /* El propietario lo termina al volver a abrir. */
      ana.controllers.rotation.gaveUp = {};
      toasts.length = 0;
      await open(ana, id);
      await toasted();
      assert.ok(toasts.some((t) => t.indexOf('Cambio de clave de «Equipo reservado» terminado') === 0), toasts.join(' | '));
      assert.equal(store.raw('teams', tid).enc.rot, undefined);
      assert.equal(store.raw(base + 'tasks', 'a').kid, mid.kid);
      /* Luis, la próxima vez que entre con su contraseña, suelta la clave anterior. */
      await keystore.forgetUser('luis');
      await open(luis, id);
      await luis.controllers.crypto.unlock(MEMBER_PASSWORD, false);
      await luis.connecting;
      await tick(10);
      assert.equal(store.raw(base + 'crypto', 'luis').old, undefined);
      assert.ok(luis.cipher && luis.cipher.kid === mid.kid);
      ok('miembro a mitad del cambio: guarda la clave anterior, lee con las dos y la suelta al terminar');
    }

    /* Eliminar el equipo se lleva también las claves públicas y las claves entregadas. */
    await ana.models.projects.removeProject(id, ana.rootDb, null);
    assert.equal(store.rawAll(base + 'pubkeys').size + store.rawAll(base + 'rekey').size + store.rawAll(base + 'crypto').size, 0);
    ok('eliminar el equipo borra claves públicas, claves entregadas y claves envueltas');
  }

  /* ---------- quién puede cambiar la clave ---------- */
  {
    const r = ana.controllers.rotation;
    const encOf = (mode) => ({v:1, mode:mode, pid:PC.newPid(), kid:PC.newKid(), kcv:'x'});
    assert.equal(r.canRotate({id:'x', nombre:'A'}), false, 'sin cifrado no hay clave');
    assert.equal(r.canRotate({id:'x', enc:encOf('managed')}), false, 'los gestionados por Kanlane no tienen contraseña');
    assert.equal(r.canRotate({id:'x', enc:encOf('pw')}), true);
    assert.equal(r.canRotate({id:'t:x', team:true, role:'editor', enc:encOf('pw')}), false);
    assert.equal(r.canRotate({id:'t:x', team:true, role:'owner', enc:encOf('pw')}), true);
    ok('cambiar la clave: solo cifrado total, y en un equipo solo el propietario');
  }

  console.log('\nTodo correcto.');
})().catch((err) => { console.error(err); process.exit(1); });
