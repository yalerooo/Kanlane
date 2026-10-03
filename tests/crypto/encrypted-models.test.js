/* Cifrado por proyecto en ProjectModel, VaultModel y el almacenamiento de los plugins (PR3b del plan,
   docs/CIFRADO-PROYECTOS.md 6.4), con Web Crypto real y el Firestore en memoria de las pruebas.
   Uso: node tests/crypto/encrypted-models.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fakeDb} = require('./fake-firestore.js');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const forgotten = [];
const Workhub = {
  services:{
    platform:{mode:() => 'firebase'},
    keystore:{forgetProject:(id, uid) => { forgotten.push(id + '|' + uid); return Promise.resolve(1); }}
  },
  models:{}, utils:{html:{hueFor:() => 0}}, t:(s) => s, i18n:{locale:'es-ES'},
  views:{team:{enabled:() => false, meUid:() => '', name:() => '', assigned:() => []}}
};
['src/core/emitter.js', 'src/utils/pool.js', 'src/services/crypto.js', 'src/services/project-crypto.js',
  'src/models/enc-schema.js', 'src/models/project-cipher.js', 'src/models/collection-model.js',
  'src/models/project-templates.js', 'src/models/vault-model.js', 'src/models/project-model.js', 'src/models/plugin-model.js'
].forEach((rel) => new Function('Workhub', 'window', 'crypto', read(rel))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto));

const PC = Workhub.services.projectCrypto;
const cryptoSvc = Workhub.services.crypto;
const {ProjectModel, VaultModel, PluginModel, ProjectCipher, EncSchema} = Workhub.models;

async function newCipher(){
  return new ProjectCipher({pid:PC.newPid(), kid:PC.newKid(), key:await PC.importDek(PC.newDekBytes())});
}
async function settle(model){
  for(let i = 0; i < 6; i++){
    await tick(2);
    if(model && model._queue) await model._queue;
  }
}

/* Base de datos del usuario como la de firebase-backend: con `me`, `team(tid)` y `teams`. */
function accountDb(uid){
  const db = fakeDb();
  db.me = {uid:uid, name:'Ana', email:'ana@example.test', photo:''};
  db.team = (tid) => ({
    collection:(name) => db.collection('teams/' + tid + '/' + name),
    doc:(p) => db.doc('teams/' + tid + '/' + p)
  });
  db.teams = {
    query:() => db.collection('teams'),
    doc:(tid) => db.collection('teams').doc(tid),
    newId:() => 'nuevo',
    FieldValue:{delete:() => ({__delete:true})},
    invitesFrom:() => ({get:() => Promise.resolve({docs:[]})})
  };
  return db;
}

(async () => {
  const enc = {v:1, mode:'pw', pid:PC.newPid(), kid:PC.newKid(), kcv:'abc'};

  /* ---------- ProjectModel ---------- */
  {
    assert.equal(ProjectModel.isEncrypted({enc:enc}), true);
    assert.equal(ProjectModel.isEncrypted({nombre:'x'}), false);
    assert.equal(ProjectModel.isEncrypted({enc:true}), false, 'la marca recordada en el navegador no es el campo enc');
    assert.equal(ProjectModel.isEncrypted(null), false);

    const db = accountDb('u1');
    db.put('projects', 'p1', {nombre:'Cifrado', createdAt:5, tipo:'soporte', enc:enc});
    db.put('projects', 'p2', {nombre:'Normal', createdAt:6});
    db.put('teams', 't1', {nombre:'Equipo', createdAt:7, ownerUid:'u1', memberIds:['u1', 'u2'],
      members:{u1:{role:'owner', name:'Ana'}, u2:{role:'editor', name:'Luis'}}, tipo:'soporte', enc:enc});
    const projects = new ProjectModel();
    projects.connect(db);
    await tick(5);
    assert.equal(projects.loaded, true);

    /* Proyecto personal: guardar nombre, color o tipo conserva enc. */
    await projects.save('p1', 'Cifrado, renombrado', 120, {tipo:'kanban'});
    assert.deepEqual(db.raw('projects', 'p1').enc, enc);
    assert.equal(db.raw('projects', 'p1').nombre, 'Cifrado, renombrado');
    await tick(5);
    await projects.patch('p1', {labels:[{name:'a', color:'ff0000'}]});
    assert.deepEqual(db.raw('projects', 'p1').enc, enc);
    ok('ProjectModel: save y patch de un proyecto personal conservan enc');

    /* Equipo: set() manda solo diferencias y nunca borra enc. */
    const before = db.log.writes.length;
    await projects.save('t:t1', 'Equipo renombrado', 200, {tipo:'kanban'});
    const upd = db.log.writes.slice(before);
    assert.equal(upd.length, 1);
    assert.ok(!('enc' in upd[0].data), 'enc no viaja en la actualización');
    assert.deepEqual(db.raw('teams', 't1').enc, enc);
    await tick(5);
    await projects.set('t:t1', {nombre:'Sin enc en los datos', tipo:'kanban', color:200});
    assert.deepEqual(db.raw('teams', 't1').enc, enc, 'un set sin enc no lo borra');
    assert.deepEqual(db.raw('teams', 't1').memberIds, ['u1', 'u2']);
    ok('ProjectModel: guardar la configuración de un equipo no borra enc');

    /* GitHub y cifrado total no conviven. */
    await assert.rejects(projects.patch('p1', {github:{number:1}}), /encrypted-github/);
    await assert.rejects(projects.patch('t:t1', {github:{number:1}}), /encrypted-github/);
    await assert.rejects(projects.save('p1', 'x', 1, {github:{number:1}}), /encrypted-github/);
    await projects.patch('p1', {github:null});
    assert.equal(db.raw('projects', 'p1').github, undefined);
    await projects.patch('p2', {github:{number:1}});
    assert.deepEqual(db.raw('projects', 'p2').github, {number:1});
    ok('ProjectModel: un proyecto cifrado no acepta el enlace con GitHub');

    /* Eliminar: se borran las claves envueltas y la clave de este navegador. */
    db.put('projects/p1/crypto', 'u1', {v:1});
    db.put('projects/p1/tasks', 'a', {e:'x', ev:1, kid:enc.kid});
    await tick(5);
    await projects.removeProject('p1', db, null);
    assert.equal(db.raw('projects/p1/crypto', 'u1'), undefined);
    assert.equal(db.raw('projects/p1/tasks', 'a'), undefined);
    assert.equal(db.raw('projects', 'p1'), undefined);
    assert.deepEqual(forgotten, ['p1|u1']);
    db.put('teams/t1/crypto', 'u1', {v:1});
    db.put('teams/t1/crypto', 'u2', {v:1});
    await tick(5);
    await projects.removeProject('t:t1', db, null);
    assert.equal(db.rawAll('teams/t1/crypto').size, 0, 'el propietario borra las claves de todos los miembros');
    assert.deepEqual(forgotten, ['p1|u1', 't:t1|u1']);
    /* Un proyecto sin cifrar no toca nada de esto. */
    db.put('projects/p2/crypto', 'u1', {v:1});
    await projects.removeProject('p2', db, null);
    assert.equal(forgotten.length, 2);
    assert.ok(db.raw('projects/p2/crypto', 'u1'), 'no se busca crypto en un proyecto sin cifrar');
    projects.disconnect();
    ok('ProjectModel: eliminar un proyecto cifrado borra sus claves envueltas y la del navegador');
  }

  /* ---------- VaultModel ---------- */
  {
    const cipher = await newCipher();
    const db = fakeDb();
    const vault = new VaultModel();
    vault.connect(db, cipher);
    await settle(vault);
    assert.equal(vault.cipher, cipher);
    vault._setUnlocked(await cryptoSvc.importAesKeyRaw(cryptoSvc.randomBytes(32)));

    await vault.saveEntry(null, {tipo:'correo', cliente:'Finba', label:'Correo de soporte', correo:'soporte@finba.example', web:'https://finba.example'},
      {password:'s3creta-del-cofre', notas:'no compartir'});
    await settle(vault);
    assert.equal(vault.items.length, 1);
    const id = vault.items[0].id;
    const stored = db.raw('vault', id);
    Object.keys(stored).forEach((k) => assert.ok(EncSchema.sealedFields('vault').indexOf(k) !== -1, 'campo permitido: ' + k));
    ['iv', 'cipher', 'e', 'ev', 'kid', 'order', 'createdAt', 'updatedAt'].forEach((k) => assert.ok(k in stored, 'tiene ' + k));
    const flat = JSON.stringify(stored);
    ['Finba', 'soporte', 's3creta', 'compartir', 'correo'].forEach((w) => assert.ok(flat.indexOf(w) === -1, 'no aparece en claro: ' + w));
    assert.equal(vault.items[0].label, 'Correo de soporte');
    assert.equal(vault.items[0].cliente, 'Finba');
    assert.deepEqual(await vault.reveal(id), {password:'s3creta-del-cofre', notas:'no compartir'});
    ok('cofre: los metadatos van en el blob y el secreto sigue con la clave del cofre (doble cifrado)');

    /* Editar sustituye el documento (set) y sigue sellado. */
    await vault.saveEntry(id, {tipo:'correo', cliente:'Finba', label:'Correo nuevo', correo:'x@finba.example', web:''}, {password:'otra', notas:''});
    await settle(vault);
    assert.equal(db.raw('vault', id).label, undefined);
    assert.equal(vault.find(id).label, 'Correo nuevo');
    assert.deepEqual(await vault.reveal(id), {password:'otra', notas:''});
    /* Reordenar solo toca `order`. */
    await vault.saveEntry(null, {tipo:'vpn', cliente:'UNIA', label:'VPN', usuario:'ana'}, {password:'p', notas:''});
    await settle(vault);
    const e1 = db.raw('vault', id).e;
    const list = vault.filter('', '', '');
    vault.reorder(list, list[1].id, list[0].id);
    await settle(vault);
    assert.equal(db.raw('vault', id).e, e1, 'reordenar no reescribe el blob');
    assert.equal(vault.filter('', '', '')[0].id, list[1].id);
    assert.equal(vault.filter('vpn', '', '').length, 1, 'la búsqueda usa el contenido descifrado');
    await assert.rejects(vault.unlockLegacy('x'), /legacy-in-encrypted/);
    vault.disconnect();
    ok('cofre: editar, reordenar y buscar en un proyecto cifrado; sin migración de cofres antiguos');
  }

  /* ---------- almacenamiento de los plugins ---------- */
  {
    const cipher = await newCipher();
    const db = fakeDb();
    const bucket = PluginModel.projectBucket(db, 'workhub.smartgp', cipher);
    assert.equal(bucket.maxBytes, 600 * 1024);
    await PluginModel.storageSet(bucket, 'prefs', {proyecto:'Mondragón', horas:[1, 2, 3]});
    await PluginModel.storageSet(bucket, 'otra', 'texto');
    const stored = db.raw('plugin_data', 'workhub.smartgp');
    assert.deepEqual(Object.keys(stored).sort(), ['e', 'ev', 'kid', 'updatedAt']);
    assert.ok(JSON.stringify(stored).indexOf('Mondrag') === -1);
    assert.deepEqual(await PluginModel.storageGet(bucket, 'prefs'), {proyecto:'Mondragón', horas:[1, 2, 3]});
    assert.deepEqual(await PluginModel.storageKeys(bucket), ['otra', 'prefs']);
    await PluginModel.storageRemove(bucket, 'otra');
    assert.deepEqual(await PluginModel.storageKeys(bucket), ['prefs']);
    /* El blob de otro plugin no se abre: el id va en la AAD. */
    db.put('plugin_data', 'workhub.informe', stored);
    await assert.rejects(PluginModel.storageGet(PluginModel.projectBucket(db, 'workhub.informe', cipher), 'prefs'));
    /* Cuota de 600 KB en cifrado (800 KB sin cifrar). */
    const big = 'x'.repeat(99 * 1024);
    for(let i = 0; i < 6; i++) await PluginModel.storageSet(bucket, 'k' + i, big);
    await assert.rejects(PluginModel.storageSet(bucket, 'k6', big), (err) => err.code === 'quota' && /600 KB/.test(err.message));
    assert.ok(db.raw('plugin_data', 'workhub.smartgp').e.length <= EncSchema.maxE('plugin_data'), 'cabe en el tope de las reglas');
    /* Un cajón en claro que ya existiera se lee y, al escribir, queda cifrado. */
    db.put('plugin_data', 'viejo', {values:{a:'1'}, updatedAt:1});
    const old = PluginModel.projectBucket(db, 'viejo', cipher);
    assert.equal(await PluginModel.storageGet(old, 'a'), 1);
    await PluginModel.storageSet(old, 'b', 2);
    assert.equal(db.raw('plugin_data', 'viejo').values, undefined);
    assert.equal(await PluginModel.storageGet(old, 'a'), 1);

    /* Sin cifrador, como siempre. */
    const plain = PluginModel.projectBucket(db, 'claro');
    await PluginModel.storageSet(plain, 'a', {b:1});
    assert.deepEqual(Object.keys(db.raw('plugin_data', 'claro')).sort(), ['updatedAt', 'values']);
    assert.equal(plain.maxBytes, undefined);
    for(let i = 0; i < 8; i++) await PluginModel.storageSet(plain, 'k' + i, big);
    await assert.rejects(PluginModel.storageSet(plain, 'k8', 'y'.repeat(99 * 1024)), (err) => err.code === 'quota' && /800 KB/.test(err.message));
    ok('plugins: wh.storage del proyecto va cifrado, con cuota de 600 KB; sin cifrador no cambia');
  }

  console.log('\nTodo correcto.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
