/* Contraseñas compartidas de un equipo (src/models/team-vault.js y VaultModel en un equipo): el cofre
   pasa al equipo al convertir un proyecto personal, cada persona tiene su propia contraseña maestra
   y a quien entra se le da un código de acceso de un solo uso.
   Web Crypto real de Node y el Firestore en memoria de las pruebas (sin reglas: eso es tests/rules).
   Uso: node tests/vault/team-vault.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fakeDb} = require('../crypto/fake-firestore.js');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ok = (msg) => console.log('OK   ' + msg);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const coded = (c) => (err) => { assert.equal(err && err.code, c, String(err && err.message)); return true; };

const session = new Map();
const location = {origin:'https://kanlane.test', pathname:'/app/', search:'', hash:''};
const sessionStorage = {getItem:(k) => (session.has(k) ? session.get(k) : null), setItem:(k, v) => session.set(k, String(v)), removeItem:(k) => session.delete(k)};
const history = {replaceState:() => { location.hash = ''; }};
const Workhub = {
  services:{platform:{mode:() => 'firebase'}, keystore:null},
  models:{}, controllers:{}, features:{},
  utils:{html:{hueFor:() => 0}, urls:{safeUrl:(u) => u || ''}},
  t:(s) => s, i18n:{locale:'es-ES', lang:'es'},
  views:{team:{enabled:() => false, meUid:() => '', name:() => '', assigned:() => []}}
};
const load = (rel) => new Function('Workhub', 'window', 'crypto', 'location', 'sessionStorage', 'history', read(rel))(
  Workhub, {crypto:globalThis.crypto}, globalThis.crypto, location, sessionStorage, history);
['src/core/emitter.js', 'src/utils/dates.js', 'src/utils/pool.js', 'src/services/crypto.js',
  'src/services/project-crypto.js', 'src/models/enc-schema.js', 'src/models/project-cipher.js',
  'src/models/collection-model.js', 'src/models/project-templates.js', 'src/models/task-model.js',
  'src/models/project-model.js', 'src/models/team-vault.js', 'src/models/vault-model.js', 'src/models/team-model.js'
].forEach(load);

const cs = Workhub.services.crypto;
const {ProjectModel, TeamModel, TeamVault, VaultModel} = Workhub.models;

const ANA = {uid:'ana', email:'ana@example.test', name:'Ana', photo:''};
const MARTA = {uid:'marta', email:'marta@example.test', name:'Marta', photo:''};
const ANA_PASS = 'la maestra de ana', MARTA_PASS = 'la maestra de marta';

/* Ids de equipo: únicos aunque una cuenta se conecte dos veces. */
let ids = 0;

/* Base de datos de una cuenta sobre un almacén común, con la forma de la de firebase-backend. */
function accountDb(store, me){
  const base = 'users/' + me.uid + '/';
  const db = {
    me:me,
    collection:(p) => store.collection(base + p),
    doc:(p) => store.doc(base + p),
    team:(tid) => ({collection:(n) => store.collection('teams/' + tid + '/' + n), doc:(p) => store.doc('teams/' + tid + '/' + p)})
  };
  db.teams = {
    query:() => store.collection('teams'),
    doc:(tid) => {
      const ref = store.collection('teams').doc(tid);
      /* update() con arrayUnion, arrayRemove, delete y rutas con punto, como Firestore. */
      const update = (patch) => {
        const next = JSON.parse(JSON.stringify(store.raw('teams', tid)));
        Object.keys(patch).forEach((k) => {
          const v = patch[k], parts = k.split('.');
          let at = next;
          for(let i = 0; i < parts.length - 1; i++){ at = at[parts[i]] = at[parts[i]] || {}; }
          const last = parts[parts.length - 1];
          if(v && v.__delete) delete at[last];
          else if(v && v.__union) at[last] = (at[last] || []).concat(v.__union);
          else if(v && v.__remove) at[last] = (at[last] || []).filter((x) => v.__remove.indexOf(x) === -1);
          else at[last] = v;
        });
        return ref.set(next);
      };
      return Object.assign({}, ref, {update:update});
    },
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
  return db;
}

/* El cofre del proyecto abierto, como lo conecta AppController. */
function openVault(db, me, tid, owner){
  const vault = new VaultModel();
  vault.team = tid ? {tid:tid, uid:me.uid, email:me.email, owner:!!owner, teams:db.teams} : null;
  vault.connect(tid ? db.team(tid) : db);
  return vault;
}

(async () => {
  const store = fakeDb();
  const anaDb = accountDb(store, ANA), martaDb = accountDb(store, MARTA);
  const projects = new ProjectModel();
  projects.connect(anaDb);
  const team = new TeamModel(projects);
  await tick(5);

  /* ---------- proyecto personal con contraseñas ---------- */
  const personal = openVault(anaDb, ANA, '');
  assert.equal(await personal.checkMeta(), 'none');
  const anaRecovery = await personal.create(ANA_PASS);
  await personal.saveEntry(null, {tipo:'correo', cliente:'Acme', label:'Correo', correo:'a@acme.test'}, {password:'secreto-1', notas:''});
  await personal.saveEntry(null, {tipo:'servidor', cliente:'Acme', label:'Servidor', ip:'10.0.0.1'}, {password:'secreto-2', notas:'ojo'});
  await tick(5);
  assert.equal(personal.items.length, 2);
  const linked = personal.items[0].id;
  await anaDb.collection('tasks').doc('t1').set({title:'Tarea', status:'pendiente', linkedVault:[linked], createdAt:1});
  await anaDb.collection('clients').doc('c1').set({nombre:'Acme', createdAt:1});
  const project = {id:'main', nombre:'Proyecto', tipo:'soporte'};

  /* ---------- mover el cofre: hace falta la contraseña maestra ---------- */
  await assert.rejects(TeamVault.prepareMove(anaDb, ANA.uid, ''), coded('needs-vault-pass'));
  await assert.rejects(TeamVault.prepareMove(anaDb, ANA.uid, 'otra cosa'), coded('bad-pass'));
  const move = await TeamVault.prepareMove(anaDb, ANA.uid, ANA_PASS);
  assert.deepEqual(Object.keys(move.check).sort(), ['cipher', 'createdAt', 'createdBy', 'iv', 'kid', 'pid', 'v']);
  assert.deepEqual(move.key, store.raw('users/ana/vault_meta', 'check'), 'mi clave en el equipo es la que ya tenía');
  ok('mover el cofre: sin la contraseña maestra (o con una mala) no se prepara nada');

  /* Sin credenciales no hay nada que mover, ni se pide nada. */
  const emptyDb = accountDb(fakeDb(), ANA);
  assert.equal(await TeamVault.prepareMove(emptyDb, ANA.uid, ''), null);
  await emptyDb.doc('vault_meta/check').set({saltPassword:'x'});
  assert.equal(await TeamVault.prepareMove(emptyDb, ANA.uid, ''), null, 'un cofre vacío no se lleva');
  /* Un cofre del formato antiguo hay que actualizarlo antes. */
  await emptyDb.doc('vault_meta/check').set({salt:'x', iv:'y', cipher:'z'});
  await emptyDb.collection('vault').doc('v').set({cliente:'X', iv:'i', cipher:'c'});
  await assert.rejects(TeamVault.prepareMove(emptyDb, ANA.uid, ANA_PASS), coded('legacy'));
  ok('mover el cofre: nada que mover si no hay credenciales, y el formato antiguo se rechaza');

  /* ---------- convertir: el cofre pasa al equipo ---------- */
  const made = await team.convert(project, null, null, move);
  const tid = made.teamId;
  assert.equal(made.skipped, 0);
  assert.equal(store.rawAll('teams/' + tid + '/vault').size, 2);
  assert.deepEqual(store.raw('teams/' + tid + '/vault', linked), store.raw('users/ana/vault', linked), 'las credenciales viajan tal cual, cifradas');
  assert.deepEqual(store.raw('teams/' + tid + '/vault_meta', 'check'), move.check);
  assert.deepEqual(store.raw('teams/' + tid + '/vault_keys', 'ana'), move.key);
  assert.deepEqual(store.raw('teams/' + tid + '/tasks', 't1').linkedVault, [linked], 'las tareas conservan sus contraseñas vinculadas');
  /* Sin cofre, como antes: ni credenciales ni vínculos. */
  const bare = await team.convert(project, null, null, null);
  assert.equal(store.rawAll('teams/' + bare.teamId + '/vault').size, 0);
  assert.equal(store.raw('teams/' + bare.teamId + '/vault_meta', 'check'), undefined);
  assert.equal(store.raw('teams/' + bare.teamId + '/tasks', 't1').linkedVault, undefined);
  ok('convertir: las credenciales, la marca del cofre y mi clave pasan al equipo, y las tareas conservan sus vínculos');

  /* La propietaria entra en el cofre del equipo con su contraseña maestra de siempre. */
  const ana = openVault(anaDb, ANA, tid, true);
  assert.equal(await ana.checkMeta(), 'current');
  await ana.unlock(ANA_PASS);
  await tick(5);
  assert.equal((await ana.reveal(linked)).password, 'secreto-1');
  /* Y su clave de recuperación de siempre también sirve. */
  const again = openVault(anaDb, ANA, tid, true);
  const anaRecovery2 = await again.recover(cs.base32Decode(anaRecovery), ANA_PASS);
  assert.notEqual(anaRecovery2, anaRecovery);
  await tick(5);
  assert.equal((await again.reveal(linked)).password, 'secreto-1');
  ok('la propietaria abre el cofre del equipo con su contraseña maestra y su clave de recuperación de siempre');

  /* ---------- dar acceso a otra persona ---------- */
  await anaDb.teams.doc(tid).update({memberIds:anaDb.teams.FieldValue.arrayUnion(MARTA.uid), ['members.' + MARTA.uid]:{role:'editor', name:'Marta', email:MARTA.email, photo:''}});
  const marta = openVault(martaDb, MARTA, tid, false);
  assert.equal(await marta.checkMeta(), 'grant', 'el cofre existe y a Marta le falta su clave');
  await assert.rejects(marta.redeem('0000-0000-0000-0000-0000', MARTA_PASS), coded('no-grant'));

  assert.equal(await TeamVault.exists(anaDb, tid), true);
  await assert.rejects(TeamVault.unlock(anaDb, tid, 'mala'), coded('bad-pass'));
  await assert.rejects(TeamVault.unlock(martaDb, tid, MARTA_PASS), coded('no-access'));
  await assert.rejects(TeamVault.unlock(anaDb, bare.teamId, ANA_PASS), coded('no-vault'));
  const opened = await TeamVault.unlock(anaDb, tid, ANA_PASS);
  const code = await TeamVault.grant(anaDb, tid, 'Marta@Example.test', opened);
  assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
  const grant = store.raw('teams/' + tid + '/vault_grants', MARTA.email);
  assert.deepEqual(Object.keys(grant).sort(), ['by', 'createdAt', 'ct', 'iter', 'iv', 'salt']);
  assert.equal(grant.by, ANA.uid);
  assert.ok(JSON.stringify(grant).indexOf(cs.b64encode(opened.dek)) === -1, 'la clave del cofre no va en claro');

  /* El enlace lleva el código detrás de la almohadilla y se entiende al pegarlo. */
  const link = TeamVault.linkFor(tid, code);
  assert.equal(link, 'https://kanlane.test/app/#cofre=' + tid + '.' + code.replace(/-/g, ''));
  assert.equal(TeamVault.parseCode(link), code.replace(/-/g, ''));
  assert.equal(TeamVault.parseCode(' ' + code.toLowerCase() + ' '), code.replace(/-/g, ''));
  assert.equal(TeamVault.parseCode('no es un código'), null);

  /* Un código malo no abre nada y no gasta el acceso. */
  await assert.rejects(marta.redeem('0000-0000-0000-0000-0000', MARTA_PASS), coded('bad-code'));
  assert.ok(store.raw('teams/' + tid + '/vault_grants', MARTA.email));
  assert.equal(store.raw('teams/' + tid + '/vault_keys', 'marta'), undefined);

  const martaRecovery = await marta.redeem(TeamVault.parseCode(link), MARTA_PASS);
  await tick(5);
  assert.equal(marta.unlocked, true);
  assert.equal(marta.metaState, 'current');
  assert.equal((await marta.reveal(linked)).password, 'secreto-1');
  assert.equal(store.raw('teams/' + tid + '/vault_grants', MARTA.email), undefined, 'el acceso se borra al usarlo');
  const martaKey = store.raw('teams/' + tid + '/vault_keys', 'marta');
  assert.notEqual(martaKey.cipherPassword, store.raw('teams/' + tid + '/vault_keys', 'ana').cipherPassword);
  /* El mismo enlace ya no sirve. */
  const second = openVault(martaDb, MARTA, tid, false);
  await assert.rejects(second.redeem(TeamVault.parseCode(link), 'otra contraseña'), coded('no-grant'));
  assert.deepEqual(store.raw('teams/' + tid + '/vault_keys', 'marta'), martaKey);
  ok('dar acceso: el código abre el cofre solo una vez y Marta crea su propia contraseña maestra');

  /* Cada una con la suya: la de Ana no abre la copia de Marta. */
  const relock = openVault(martaDb, MARTA, tid, false);
  assert.equal(await relock.checkMeta(), 'current');
  await assert.rejects(relock.unlock(ANA_PASS));
  await relock.unlock(MARTA_PASS);
  await tick(5);
  assert.equal((await relock.reveal(linked)).password, 'secreto-1');
  /* Lo que guarda Marta lo lee Ana: es el mismo cofre. */
  await relock.saveEntry(null, {tipo:'correo', cliente:'Acme', label:'De Marta'}, {password:'secreto-3', notas:''});
  await tick(5);
  const fromMarta = ana.items.find((v) => v.label === 'De Marta');
  assert.equal((await ana.reveal(fromMarta.id)).password, 'secreto-3');
  /* Y Marta recupera el acceso con su propia clave de recuperación. */
  const lost = openVault(martaDb, MARTA, tid, false);
  await lost.recover(cs.base32Decode(martaRecovery), 'nueva de marta');
  await tick(5);
  assert.equal((await lost.reveal(linked)).password, 'secreto-1');
  ok('cada persona tiene su contraseña maestra y su clave de recuperación, y todas abren el mismo cofre');

  /* Dar acceso otra vez al mismo correo anula el anterior. */
  const c1 = await TeamVault.grant(anaDb, tid, MARTA.email, opened);
  const c2 = await TeamVault.grant(anaDb, tid, MARTA.email, opened);
  const third = openVault(martaDb, MARTA, tid, false);
  await store.doc('teams/' + tid + '/vault_keys/marta').delete();
  await assert.rejects(third.redeem(c1, MARTA_PASS), coded('bad-code'));
  await third.redeem(c2, MARTA_PASS);
  ok('un acceso nuevo para el mismo correo anula el anterior');

  /* ---------- quitar a alguien ---------- */
  await TeamVault.grant(anaDb, tid, MARTA.email, opened);
  projects.items = [];
  await team.removeMember({id:'t:' + tid, team:true, teamId:tid, members:store.raw('teams', tid).members}, MARTA.uid);
  assert.equal(store.raw('teams/' + tid + '/vault_keys', 'marta'), undefined);
  assert.equal(store.raw('teams/' + tid + '/vault_grants', MARTA.email), undefined);
  assert.ok(store.raw('teams/' + tid + '/vault_keys', 'ana'));
  assert.deepEqual(store.raw('teams', tid).memberIds, [ANA.uid]);
  ok('quitar a alguien borra su clave del cofre y su acceso pendiente');

  /* ---------- equipo sin cofre: solo lo crea la propietaria ---------- */
  const tid2 = bare.teamId;
  const guest = openVault(martaDb, MARTA, tid2, false);
  assert.equal(await guest.checkMeta(), 'absent');
  const owner = openVault(anaDb, ANA, tid2, true);
  assert.equal(await owner.checkMeta(), 'none');
  await owner.create(ANA_PASS);
  assert.ok(store.raw('teams/' + tid2 + '/vault_meta', 'check'));
  assert.ok(store.raw('teams/' + tid2 + '/vault_keys', 'ana'));
  assert.equal(owner.unlocked, true);
  guest.metaState = null;
  assert.equal(await guest.checkMeta(), 'grant');
  /* Un cofre que ya existe no se pisa. */
  const dup = openVault(anaDb, ANA, tid2, true);
  const before = store.raw('teams/' + tid2 + '/vault_meta', 'check');
  await assert.rejects(dup._createShared('otra'), /vault-exists/);
  assert.deepEqual(store.raw('teams/' + tid2 + '/vault_meta', 'check'), before);
  ok('equipo sin cofre: lo crea la propietaria y a los demás les pide un código de acceso');

  /* ---------- reglas antiguas publicadas: la conversión falla y no deja un equipo a medias ---------- */
  {
    const denied = () => Promise.reject(Object.assign(new Error('denied'), {code:'permission-denied'}));
    const oldDb = accountDb(store, ANA);
    const teamOf = oldDb.team;
    /* Como con las reglas de antes: nada del cofre se puede leer ni escribir en un equipo. */
    oldDb.team = (tid) => {
      const t = teamOf(tid);
      const locked = (p) => /^vault/.test(p);
      return {
        collection:(n) => (locked(n) ? {get:denied, doc:() => ({set:denied, delete:denied, get:denied})} : t.collection(n)),
        doc:(p) => (locked(p) ? {set:denied, delete:denied, get:denied} : t.doc(p))
      };
    };
    const oldProjects = new ProjectModel();
    oldProjects.connect(oldDb);
    const oldTeam = new TeamModel(oldProjects);
    await tick(5);
    const teamsBefore = store.rawAll('teams').size;
    await assert.rejects(oldTeam.convert(project, null, null, move), (err) => err.code === 'permission-denied' && err.phase === 'guardar la clave de las contraseñas');
    assert.equal(store.rawAll('teams').size, teamsBefore, 'el equipo que se llegó a crear se deshace');
    assert.ok(store.raw('users/ana/vault', linked), 'y el proyecto personal sigue entero');
    /* Un equipo que quedó huérfano antes de este arreglo también se puede eliminar. */
    const orphan = await oldProjects.createTeam('Huérfano', null, {});
    await oldProjects.removeProject(orphan.id, oldDb, null);
    assert.equal(store.raw('teams', orphan.teamId), undefined);
    ok('con las reglas antiguas publicadas la conversión se deshace entera y un equipo se puede eliminar');
  }

  /* ---------- enlace con el que se abre la app ---------- */
  assert.equal(TeamVault.pendingLink(), null);
  sessionStorage.setItem('workhub_vault_link', JSON.stringify({tid:tid, code:'ABCD'}));
  assert.deepEqual(TeamVault.pendingLink(), {tid:tid, code:'ABCD'});
  TeamVault.clearLink();
  assert.equal(TeamVault.pendingLink(), null);
  ok('el enlace de acceso se guarda solo en la pestaña y se olvida al usarlo');

  console.log('\nTodo correcto.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
