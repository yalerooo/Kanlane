const fs = require('fs');
const path = require('path');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); pass++; console.log('  ok   ' + name); }
  catch(e){ fail++; console.log('  FAIL ' + name + ' -> ' + (e && e.message || e).toString().split('\n')[0]); }
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-workhub',
    firestore: {rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8187}
  });
  const tok = (email) => ({email: email, email_verified: true, firebase: {sign_in_provider: 'google.com'}});
  const alice = env.authenticatedContext('alice', tok('alice@x.com')).firestore();
  const bob = env.authenticatedContext('bob', tok('bob@x.com')).firestore();
  const carol = env.authenticatedContext('carol', tok('carol@x.com')).firestore();
  const dave = env.authenticatedContext('dave', tok('dave@x.com')).firestore();
  const unverified = env.authenticatedContext('eve', {email: 'eve@x.com', email_verified: false, firebase: {sign_in_provider: 'password'}}).firestore();
  const FV = alice.constructor && require('firebase/compat/app').default.firestore.FieldValue;

  const me = (name, email, role) => ({role: role, name: name, email: email, photo: ''});
  const team = (owner) => ({nombre: 'Equipo', createdAt: 1, ownerUid: owner, memberIds: [owner], members: {[owner]: me(owner, owner + '@x.com', 'owner')}, tipo: 'desarrollo'});
  const invite = (tid, email, role, by) => ({teamId: tid, teamName: 'Equipo', email: email, role: role, invitedByUid: by, invitedByName: by, createdAt: 1});

  console.log('Crear y leer');
  await t('alice crea un equipo', () => assertSucceeds(alice.collection('teams').doc('t1').set(team('alice'))));
  await t('alice no puede crear un equipo a nombre de bob', () => assertFails(alice.collection('teams').doc('t2').set(team('bob'))));
  await t('alice no puede crearse un equipo con miembros ajenos', () => assertFails(alice.collection('teams').doc('t3').set(Object.assign(team('alice'), {memberIds: ['alice', 'bob']}))));
  await t('bob (no miembro) no lee el equipo', () => assertFails(bob.collection('teams').doc('t1').get()));
  await t('alice lee su equipo', () => assertSucceeds(alice.collection('teams').doc('t1').get()));
  await t('consulta de mis equipos', () => assertSucceeds(alice.collection('teams').where('memberIds', 'array-contains', 'alice').get()));
  await t('bob no puede consultar los equipos de alice', () => assertFails(bob.collection('teams').where('memberIds', 'array-contains', 'alice').get()));
  await t('cuenta de correo sin verificar no puede crear', () => assertFails(unverified.collection('teams').doc('t9').set(team('eve'))));

  console.log('Datos del equipo');
  await t('alice escribe una tarea', () => assertSucceeds(alice.collection('teams').doc('t1').collection('tasks').doc('a').set({title: 'x'})));
  await t('alice escribe una nota', () => assertSucceeds(alice.collection('teams').doc('t1').collection('tasks').doc('a').collection('notes').doc('n').set({text: 'x'})));
  await t('bob no lee las tareas', () => assertFails(bob.collection('teams').doc('t1').collection('tasks').doc('a').get()));
  await t('bob no escribe tareas', () => assertFails(bob.collection('teams').doc('t1').collection('tasks').doc('b').set({title: 'y'})));
  await t('una credencial con campos inventados no se permite', () => assertFails(alice.collection('teams').doc('t1').collection('vault').doc('v').set({x: 1})));
  await t('colección inventada no se permite', () => assertFails(alice.collection('teams').doc('t1').collection('basura').doc('v').set({x: 1})));

  console.log('Invitaciones');
  await t('alice invita a bob como editor', () => assertSucceeds(alice.collection('invites').doc('t1_bob@x.com').set(invite('t1', 'bob@x.com', 'editor', 'alice'))));
  await t('alice invita a carol como lector', () => assertSucceeds(alice.collection('invites').doc('t1_carol@x.com').set(invite('t1', 'carol@x.com', 'viewer', 'alice'))));
  await t('no se puede invitar como propietario', () => assertFails(alice.collection('invites').doc('t1_dave@x.com').set(invite('t1', 'dave@x.com', 'owner', 'alice'))));
  await t('el id debe ser equipo_correo', () => assertFails(alice.collection('invites').doc('cualquiera').set(invite('t1', 'dave@x.com', 'editor', 'alice'))));
  await t('el correo debe estar en minúsculas', () => assertFails(alice.collection('invites').doc('t1_Dave@x.com').set(invite('t1', 'Dave@x.com', 'editor', 'alice'))));
  await t('bob (no propietario) no invita a nadie', () => assertFails(bob.collection('invites').doc('t1_dave@x.com').set(invite('t1', 'dave@x.com', 'editor', 'bob'))));
  await t('bob ve sus invitaciones', () => assertSucceeds(bob.collection('invites').where('email', '==', 'bob@x.com').get()));
  await t('carol no ve las invitaciones de bob', () => assertFails(carol.collection('invites').where('email', '==', 'bob@x.com').get()));
  await t('carol no lee la invitación de bob', () => assertFails(carol.collection('invites').doc('t1_bob@x.com').get()));
  await t('alice ve las que ha enviado', () => assertSucceeds(alice.collection('invites').where('teamId', '==', 't1').where('invitedByUid', '==', 'alice').get()));

  console.log('Entrar en el equipo');
  const teamRef = (db) => db.collection('teams').doc('t1');
  const FVc = require('firebase/compat/app').default.firestore.FieldValue;
  await t('dave (sin invitación) no puede entrar', () => assertFails(teamRef(dave).update({memberIds: FVc.arrayUnion('dave'), ['members.dave']: me('dave', 'dave@x.com', 'viewer')})));
  await t('carol no puede entrar con un rol mayor que el invitado', () => assertFails(teamRef(carol).update({memberIds: FVc.arrayUnion('carol'), ['members.carol']: me('carol', 'carol@x.com', 'editor')})));
  await t('carol no puede entrar como propietaria', () => assertFails(teamRef(carol).update({memberIds: FVc.arrayUnion('carol'), ['members.carol']: me('carol', 'carol@x.com', 'owner')})));
  await t('bob no puede entrar cambiando también la configuración', () => assertFails(teamRef(bob).update({nombre: 'Hackeado', memberIds: FVc.arrayUnion('bob'), ['members.bob']: me('bob', 'bob@x.com', 'editor')})));
  await t('bob no puede meter también a dave', () => assertFails(teamRef(bob).update({memberIds: FVc.arrayUnion('bob', 'dave'), ['members.bob']: me('bob', 'bob@x.com', 'editor')})));
  await t('bob acepta su invitación (editor) y la borra', async () => {
    const b = bob.batch();
    b.update(teamRef(bob), {memberIds: FVc.arrayUnion('bob'), ['members.bob']: me('bob', 'bob@x.com', 'editor')});
    b.delete(bob.collection('invites').doc('t1_bob@x.com'));
    await assertSucceeds(b.commit());
  });
  await t('carol acepta su invitación (lector)', async () => {
    const b = carol.batch();
    b.update(teamRef(carol), {memberIds: FVc.arrayUnion('carol'), ['members.carol']: me('carol', 'carol@x.com', 'viewer')});
    b.delete(carol.collection('invites').doc('t1_carol@x.com'));
    await assertSucceeds(b.commit());
  });

  console.log('Roles');
  await t('bob (editor) lee tareas', () => assertSucceeds(bob.collection('teams').doc('t1').collection('tasks').doc('a').get()));
  await t('bob (editor) escribe tareas', () => assertSucceeds(bob.collection('teams').doc('t1').collection('tasks').doc('b').set({title: 'y', assignees: ['bob']})));
  await t('bob (editor) escribe notas', () => assertSucceeds(bob.collection('teams').doc('t1').collection('tasks').doc('b').collection('notes').doc('n').set({text: 'y'})));
  await t('carol (lector) lee tareas', () => assertSucceeds(carol.collection('teams').doc('t1').collection('tasks').doc('b').get()));
  await t('carol (lector) no escribe tareas', () => assertFails(carol.collection('teams').doc('t1').collection('tasks').doc('c').set({title: 'z'})));
  await t('carol (lector) no borra tareas', () => assertFails(carol.collection('teams').doc('t1').collection('tasks').doc('b').delete()));
  await t('bob (editor) cambia la configuración', () => assertSucceeds(teamRef(bob).update({nombre: 'Equipo 2', labels: [{name: 'a', color: 'fff'}]})));
  await t('carol (lector) no cambia la configuración', () => assertFails(teamRef(carol).update({nombre: 'Nada'})));
  await t('bob (editor) no cambia roles', () => assertFails(teamRef(bob).update({['members.bob.role']: 'owner'})));
  await t('bob (editor) no expulsa a carol', () => assertFails(teamRef(bob).update({memberIds: FVc.arrayRemove('carol'), ['members.carol']: FVc.delete()})));
  await t('bob (editor) no invita', () => assertFails(bob.collection('invites').doc('t1_dave@x.com').set(invite('t1', 'dave@x.com', 'editor', 'bob'))));
  await t('bob (editor) no borra el equipo', () => assertFails(teamRef(bob).delete()));
  console.log('Contraseñas compartidas');
  {
    const Timestamp = require('firebase/compat/app').default.firestore.Timestamp;
    const vkey = (extra) => Object.assign({saltPassword: 'c2FsdA==', ivPassword: 'aXY=', cipherPassword: 'Y2lwaGVy', ivRecovery: 'aXY=', cipherRecovery: 'Y2lwaGVy', createdAt: 1, updatedAt: 1}, extra || {});
    const vcheck = (by) => ({v: 1, pid: 'p'.repeat(22), kid: 'k'.repeat(11), iv: 'aXY=', cipher: 'Y2lwaGVy', createdBy: by, createdAt: 1});
    const ventry = (extra) => Object.assign({tipo: 'correo', cliente: 'Acme', label: 'Correo', iv: 'aXY=', cipher: 'Y2lwaGVy', order: 1, createdAt: 1, updatedAt: 1}, extra || {});
    const vgrant = (by, extra) => Object.assign({salt: 'c2FsdA', iter: 100000, iv: 'aXY', ct: 'Y3Q', by: by, createdAt: FVc.serverTimestamp()}, extra || {});
    const col = (db, name) => teamRef(db).collection(name);

    await t('bob (editor) no crea el cofre del equipo', () => assertFails(col(bob, 'vault_meta').doc('check').set(vcheck('bob'))));
    await t('alice no crea el cofre a nombre de otro', () => assertFails(col(alice, 'vault_meta').doc('check').set(vcheck('bob'))));
    await t('alice no crea otra marca que no sea check', () => assertFails(col(alice, 'vault_meta').doc('otra').set(vcheck('alice'))));
    await t('alice crea el cofre: la marca y su clave envuelta, a la vez', async () => {
      const b = alice.batch();
      b.set(col(alice, 'vault_meta').doc('check'), vcheck('alice'));
      b.set(col(alice, 'vault_keys').doc('alice'), vkey());
      await assertSucceeds(b.commit());
    });
    await t('la marca del cofre no se cambia', () => assertFails(col(alice, 'vault_meta').doc('check').set(Object.assign(vcheck('alice'), {cipher: 'b3Rybw=='}))));
    await t('bob y carol (miembros) leen la marca', async () => {
      await assertSucceeds(col(bob, 'vault_meta').doc('check').get());
      await assertSucceeds(col(carol, 'vault_meta').doc('check').get());
    });
    await t('dave (no miembro) no lee la marca', () => assertFails(col(dave, 'vault_meta').doc('check').get()));

    await t('bob guarda su clave envuelta', () => assertSucceeds(col(bob, 'vault_keys').doc('bob').set(vkey())));
    await t('bob cambia su contraseña maestra', () => assertSucceeds(col(bob, 'vault_keys').doc('bob').set(vkey({cipherPassword: 'bnVldmE=', updatedAt: 2}))));
    await t('alice no escribe la clave de bob', () => assertFails(col(alice, 'vault_keys').doc('bob').set(vkey())));
    await t('alice no lee la clave de bob', () => assertFails(col(alice, 'vault_keys').doc('bob').get()));
    await t('bob no lee la clave de alice', () => assertFails(col(bob, 'vault_keys').doc('alice').get()));
    await t('nadie lista las claves de los demás', () => assertFails(col(alice, 'vault_keys').get()));
    await t('dave (no miembro) no guarda una clave', () => assertFails(col(dave, 'vault_keys').doc('dave').set(vkey())));
    await t('una clave con campos de más se rechaza', () => assertFails(col(bob, 'vault_keys').doc('bob').set(vkey({dek: 'en claro'}))));

    await t('bob (editor) guarda una credencial', () => assertSucceeds(col(bob, 'vault').doc('v1').set(ventry())));
    await t('carol (lector) lee las credenciales', () => assertSucceeds(col(carol, 'vault').doc('v1').get()));
    await t('carol (lector) no guarda credenciales', () => assertFails(col(carol, 'vault').doc('v2').set(ventry())));
    await t('carol (lector) no borra credenciales', () => assertFails(col(carol, 'vault').doc('v1').delete()));
    await t('dave (no miembro) no lee las credenciales', () => assertFails(col(dave, 'vault').doc('v1').get()));
    await t('una credencial con la contraseña en claro se rechaza', () => assertFails(col(bob, 'vault').doc('v3').set(ventry({password: 'hunter2'}))));

    await t('bob (editor) no da acceso a nadie', () => assertFails(col(bob, 'vault_grants').doc('carol@x.com').set(vgrant('bob'))));
    await t('alice da acceso a carol', () => assertSucceeds(col(alice, 'vault_grants').doc('carol@x.com').set(vgrant('alice'))));
    await t('un acceso no se sobrescribe', () => assertFails(col(alice, 'vault_grants').doc('carol@x.com').set(vgrant('alice', {ct: 'b3Rybw'}))));
    await t('el correo del acceso va en minúsculas', () => assertFails(col(alice, 'vault_grants').doc('Carol@x.com').set(vgrant('alice'))));
    await t('un acceso con una hora del cliente (para alargar la caducidad) se rechaza', () => assertFails(col(alice, 'vault_grants').doc('dave@x.com').set(vgrant('alice', {createdAt: Timestamp.fromMillis(Date.now() + 3600 * 1000)}))));
    await t('un acceso a nombre de otro se rechaza', () => assertFails(col(alice, 'vault_grants').doc('dave@x.com').set(vgrant('bob'))));
    await t('un acceso con la clave en claro se rechaza', () => assertFails(col(alice, 'vault_grants').doc('dave@x.com').set(vgrant('alice', {dek: 'en claro'}))));
    await t('carol lee su acceso', () => assertSucceeds(col(carol, 'vault_grants').doc('carol@x.com').get()));
    await t('bob no lee el acceso de carol', () => assertFails(col(bob, 'vault_grants').doc('carol@x.com').get()));
    await t('alice (propietaria) ve los accesos pendientes', () => assertSucceeds(col(alice, 'vault_grants').get()));
    await t('bob no borra el acceso de carol', () => assertFails(col(bob, 'vault_grants').doc('carol@x.com').delete()));
    await t('carol guarda su clave y gasta el acceso', async () => {
      await assertSucceeds(col(carol, 'vault_keys').doc('carol').set(vkey()));
      await assertSucceeds(col(carol, 'vault_grants').doc('carol@x.com').delete());
    });
    await t('un acceso gastado ya no se lee', () => assertFails(col(carol, 'vault_grants').doc('carol@x.com').get()));
    await t('un acceso de hace 25 horas ha caducado', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().collection('teams').doc('t1').collection('vault_grants').doc('carol@x.com').set(vgrant('alice', {createdAt: Timestamp.fromMillis(Date.now() - 25 * 3600 * 1000)}));
      });
      await assertFails(col(carol, 'vault_grants').doc('carol@x.com').get());
    });
    await t('uno de hace 23 horas todavía sirve', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().collection('teams').doc('t1').collection('vault_grants').doc('carol@x.com').set(vgrant('alice', {createdAt: Timestamp.fromMillis(Date.now() - 23 * 3600 * 1000)}));
      });
      await assertSucceeds(col(carol, 'vault_grants').doc('carol@x.com').get());
    });
    await t('alice retira un acceso y borra la clave de otro miembro', async () => {
      await assertSucceeds(col(alice, 'vault_grants').doc('carol@x.com').delete());
      await assertSucceeds(col(alice, 'vault_keys').doc('carol').delete());
    });
    await t('bob no borra la clave de alice', () => assertFails(col(bob, 'vault_keys').doc('alice').delete()));
    await t('bob (editor) no borra el cofre', () => assertFails(col(bob, 'vault_meta').doc('check').delete()));
  }

  await t('alice cambia el rol de carol a editor', () => assertSucceeds(teamRef(alice).update({['members.carol.role']: 'editor'})));
  await t('alice ya no puede cambiar de propietario', () => assertFails(teamRef(alice).update({ownerUid: 'bob'})));
  await t('alice no puede quitarse a sí misma de los miembros', () => assertFails(teamRef(alice).update({memberIds: FVc.arrayRemove('alice'), ['members.alice']: FVc.delete()})));

  console.log('Salir y borrar');
  await t('carol sale del equipo', () => assertSucceeds(teamRef(carol).update({memberIds: FVc.arrayRemove('carol'), ['members.carol']: FVc.delete()})));
  await t('carol ya no lee el equipo', () => assertFails(teamRef(carol).get()));
  await t('carol ya no lee las tareas', () => assertFails(carol.collection('teams').doc('t1').collection('tasks').doc('a').get()));
  await t('bob no puede sacar a alice diciendo que sale él', () => assertFails(teamRef(bob).update({memberIds: FVc.arrayRemove('alice'), ['members.alice']: FVc.delete()})));
  await t('alice expulsa a bob', () => assertSucceeds(teamRef(alice).update({memberIds: FVc.arrayRemove('bob'), ['members.bob']: FVc.delete()})));
  await t('bob expulsado ya no escribe', () => assertFails(bob.collection('teams').doc('t1').collection('tasks').doc('z').set({title: 'q'})));
  await t('alice revoca una invitación', async () => {
    await assertSucceeds(alice.collection('invites').doc('t1_dave@x.com').set(invite('t1', 'dave@x.com', 'viewer', 'alice')));
    await assertSucceeds(alice.collection('invites').doc('t1_dave@x.com').delete());
  });
  await t('dave rechaza una invitación', async () => {
    await assertSucceeds(alice.collection('invites').doc('t1_dave@x.com').set(invite('t1', 'dave@x.com', 'viewer', 'alice')));
    await assertSucceeds(dave.collection('invites').doc('t1_dave@x.com').delete());
  });
  await t('un equipo no lo borra quien no es propietario', () => assertFails(teamRef(dave).delete()));
  await t('alice borra sus datos y el equipo', async () => {
    await assertSucceeds(alice.collection('teams').doc('t1').collection('tasks').doc('a').collection('notes').doc('n').delete());
    await assertSucceeds(teamRef(alice).delete());
  });

  console.log('Lo de siempre sigue igual');
  await t('alice sigue escribiendo en su cuenta', () => assertSucceeds(alice.collection('users').doc('alice').collection('tasks').doc('q').set({title: 'a'})));
  await t('bob no lee la cuenta de alice', () => assertFails(bob.collection('users').doc('alice').collection('tasks').doc('q').get()));
  await t('bob no escribe en la cuenta de alice', () => assertFails(bob.collection('users').doc('alice').collection('tasks').doc('q').set({title: 'x'})));

  console.log('Límites y copias cifradas');
  const own = alice.collection('users').doc('alice');
  const other = bob.collection('users').doc('alice');
  await t('una tarea admite hora en la fecha límite', () => assertSucceeds(own.collection('tasks').doc('timed').set({title:'a', dueDate:'2026-10-09', dueTime:'16:30'})));
  await t('una hora que no es HH:MM se rechaza', () => assertFails(own.collection('tasks').doc('timed2').set({title:'a', dueDate:'2026-10-09', dueTime:'16:30:00'})));
  await t('una tarea demasiado grande se rechaza', () => assertFails(own.collection('tasks').doc('oversize').set({title:'a'.repeat(501)})));
  await t('una tarea con campos ajenos se rechaza', () => assertFails(own.collection('tasks').doc('unknown').set({title:'x', permisoInventado:true})));
  await t('una nota demasiado grande se rechaza', () => assertFails(own.collection('tasks').doc('q').collection('notes').doc('oversize').set({text:'a'.repeat(20001)})));
  await t('una tarea normal sigue permitida', () => assertSucceeds(own.collection('tasks').doc('normal').set({title:'Tarea normal', checklist:[{text:'Paso',done:false}]})));
  /* El cliente (firebase-backend.js, IMAGE_MAX_CHARS) admite data: URL de hasta 880 000 caracteres. */
  const image = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n - 23);
  await t('una imagen al límite del cliente se acepta', () => assertSucceeds(own.collection('assets').doc('img-max').set({data:image(880000), contentType:'image/jpeg', createdAt:Date.now()})));
  await t('una imagen por encima del límite de las reglas se rechaza', () => assertFails(own.collection('assets').doc('img-big').set({data:image(900001), contentType:'image/jpeg', createdAt:Date.now()})));
  const backup = {projectId:'main', createdAt:Date.now(), iv:'abc', chunkCount:1, complete:false,
    counts:{tasks:1, meetings:0, contacts:0, vault:0, clients:0}};
  await t('alice crea una versión cifrada', () => assertSucceeds(own.collection('backup_versions').doc('v1').set(backup)));
  await t('bob no lee la copia de alice', () => assertFails(other.collection('backup_versions').doc('v1').get()));
  await t('bob no escribe fragmentos en la copia de alice', () => assertFails(other.collection('backup_versions').doc('v1').collection('chunks').doc('0').set({index:0,data:'abc'})));
  await t('alice escribe un fragmento válido', () => assertSucceeds(own.collection('backup_versions').doc('v1').collection('chunks').doc('0').set({index:0,data:'abc'})));
  await t('fragmento excesivo se rechaza', () => assertFails(own.collection('backup_versions').doc('v1').collection('chunks').doc('1').set({index:1,data:'a'.repeat(300001)})));
  await t('alice cierra la versión', () => assertSucceeds(own.collection('backup_versions').doc('v1').update({complete:true})));
  await t('la copia cerrada es inmutable', () => assertFails(own.collection('backup_versions').doc('v1').collection('chunks').doc('1').set({index:1,data:'abc'})));


  /* ---------- Cifrado por proyecto (docs/CIFRADO-PROYECTOS.md, apartado 7) ---------- */
  const SV = () => FVc.serverTimestamp();
  const zed = env.authenticatedContext('zed', tok('zed@x.com')).firestore();
  const erin = env.authenticatedContext('erin', tok('erin@x.com')).firestore();
  const zu = zed.collection('users').doc('zed');
  const sealed = (extra) => Object.assign({e: 'A'.repeat(60), ev: 1, kid: 'kid-12345'}, extra || {});
  const ENC = (over) => Object.assign({v: 1, mode: 'pw', pid: 'p'.repeat(22), kid: 'kid-12345', kcv: 'k'.repeat(52), createdAt: 1}, over || {});
  const proj = (over) => Object.assign({nombre: 'Proyecto', createdAt: 1}, over || {});
  const cryptoDoc = (over) => Object.assign({v: 1, kid: 'kid-12345',
    kdf: {name: 'PBKDF2', hash: 'SHA-256', iter: 600000, salt: 's'.repeat(22)},
    pw: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}, rk: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}, createdAt: 1, updatedAt: 1}, over || {});
  const wrapDoc = (over) => Object.assign({salt: 's'.repeat(22), iter: 100000, iv: 'i'.repeat(16), ct: 'c'.repeat(64), kid: 'kid-12345', createdAt: SV()}, over || {});

  console.log('Cifrado: documento del proyecto (enc)');
  await t('zed crea un proyecto cifrado', () => assertSucceeds(zu.collection('projects').doc('pb').set(proj({enc: ENC()}))));
  await t('un proyecto sin enc se crea como siempre', () => assertSucceeds(zu.collection('projects').doc('pa').set(proj())));
  await t('zed crea un proyecto gestionado por Kanlane', () => assertSucceeds(zu.collection('projects').doc('pm').set(proj({enc: ENC({mode: 'managed'})}))));
  await t('un modo de cifrado desconocido se rechaza', () => assertFails(zu.collection('projects').doc('pz').set(proj({enc: ENC({mode: 'otro'})}))));
  await t('un proyecto gestionado no pasa a cifrado total', () => assertFails(zu.collection('projects').doc('pm').set(proj({enc: ENC()}))));
  await t('un proyecto gestionado no enlaza github', () => assertFails(zu.collection('projects').doc('pm').update({github: {login: 'x', number: 1}})));
  await t('tarea en claro en un proyecto gestionado se rechaza', () => assertFails(zu.collection('projects').doc('pm').collection('tasks').doc('c1').set({title: 'en claro'})));
  await t('tarea sellada en un proyecto gestionado', () => assertSucceeds(zu.collection('projects').doc('pm').collection('tasks').doc('s1').set(sealed({status: 'todo', order: 1, assignees: []}))));
  await t('enc con una versión desconocida se rechaza', () => assertFails(zu.collection('projects').doc('pv').set(proj({enc: ENC({v: 2})}))));
  await t('enc con un campo de más se rechaza', () => assertFails(zu.collection('projects').doc('px').set(proj({enc: ENC({extra: 1})}))));
  await t('enc sin kcv se rechaza', () => { const e = ENC(); delete e.kcv; return assertFails(zu.collection('projects').doc('pk').set(proj({enc: e}))); });
  await t('enc y github no conviven al crear', () => assertFails(zu.collection('projects').doc('pg').set(proj({enc: ENC(), github: {login: 'x', number: 1}}))));
  await t('quitar enc de un proyecto cifrado se rechaza', () => assertFails(zu.collection('projects').doc('pb').set(proj())));
  await t('cambiar el kid de enc se rechaza', () => assertFails(zu.collection('projects').doc('pb').set(proj({enc: ENC({kid: 'otro-kid-1'})}))));
  await t('añadir enc a un proyecto existente sin marcarlo como en conversión se rechaza', () => assertFails(zu.collection('projects').doc('pa').set(proj({enc: ENC()}))));
  await t('añadir github a un proyecto cifrado se rechaza', () => assertFails(zu.collection('projects').doc('pb').update({github: {login: 'x', number: 1}})));
  await t('renombrar un proyecto cifrado sin tocar enc se permite', () => assertSucceeds(zu.collection('projects').doc('pb').update({nombre: 'Renombrado'})));
  await t('un proyecto sin enc puede enlazar github como siempre', () => assertSucceeds(zu.collection('projects').doc('pa').update({github: {login: 'x', number: 1}})));
  await t('el principal puede nacer cifrado', () => assertSucceeds(zu.collection('projects').doc('main').set(proj({enc: ENC()}))));
  await t('el principal cifrado se marca como borrado', () => assertSucceeds(zu.collection('projects').doc('main').set({nombre: 'Principal', deleted: true})));
  await t('el principal borrado se recrea cifrado', () => assertSucceeds(zu.collection('projects').doc('main').set(proj({enc: ENC({kid: 'kid-nuevo1'})}))));

  console.log('Cifrado: documentos sellados en un proyecto personal');
  const pb = zu.collection('projects').doc('pb');
  const pa = zu.collection('projects').doc('pa');
  await t('tarea sellada en un proyecto cifrado', () => assertSucceeds(pb.collection('tasks').doc('s1').set(sealed({status: 'todo', order: 1, assignees: []}))));
  await t('tarea sellada con title se rechaza', () => assertFails(pb.collection('tasks').doc('s2').set(sealed({title: 'visible'}))));
  await t('tarea sellada con campos de github se rechaza', () => assertFails(pb.collection('tasks').doc('s3').set(sealed({ghItemId: 'x'}))));
  await t('bloque cifrado de más de 200 000 caracteres se rechaza', () => assertFails(pb.collection('tasks').doc('s4').set(sealed({e: 'A'.repeat(200001)}))));
  await t('bloque cifrado de 200 000 caracteres se acepta', () => assertSucceeds(pb.collection('tasks').doc('s5').set(sealed({e: 'A'.repeat(200000)}))));
  await t('ev 2 se rechaza', () => assertFails(pb.collection('tasks').doc('s6').set(sealed({ev: 2}))));
  await t('ev que no es entero se rechaza', () => assertFails(pb.collection('tasks').doc('s7').set(sealed({ev: 'uno'}))));
  await t('ev 0 no cuenta como sellado y se rechaza', () => assertFails(pb.collection('tasks').doc('s8').set(sealed({ev: 0}))));
  await t('sin kid se rechaza', () => { const d = sealed(); delete d.kid; return assertFails(pb.collection('tasks').doc('s9').set(d)); });
  await t('mover una tarea sellada (status y order) se permite', () => assertSucceeds(pb.collection('tasks').doc('s1').update({status: 'done', order: 3, updatedAt: 2})));
  await t('escribir title sobre una tarea sellada se rechaza', () => assertFails(pb.collection('tasks').doc('s1').update({title: 'texto en claro'})));
  await t('reescribir una tarea sellada en claro se rechaza', () => assertFails(pb.collection('tasks').doc('s1').set({title: 'texto en claro'})));
  await t('rebajar ev de una tarea sellada se rechaza', () => assertFails(pb.collection('tasks').doc('s1').set(sealed({ev: 0}))));
  await t('crear una tarea en claro en un proyecto cifrado se rechaza', () => assertFails(pb.collection('tasks').doc('c1').set({title: 'en claro'})));
  await t('crear una tarea en claro en un proyecto sin cifrar se permite', () => assertSucceeds(pa.collection('tasks').doc('c1').set({title: 'en claro'})));
  await t('nota sellada en un proyecto cifrado', () => assertSucceeds(pb.collection('tasks').doc('s1').collection('notes').doc('n1').set(sealed({createdAt: 1, kind: 'comment', actorUid: 'zed'}))));
  await t('nota en claro en un proyecto cifrado se rechaza', () => assertFails(pb.collection('tasks').doc('s1').collection('notes').doc('n2').set({text: 'en claro'})));
  await t('nota en claro en un proyecto sin cifrar se permite', () => assertSucceeds(pa.collection('tasks').doc('c1').collection('notes').doc('n1').set({text: 'en claro'})));
  await t('clientes, contactos y reuniones sellados', async () => {
    await assertSucceeds(pb.collection('clients').doc('k1').set(sealed({color: 3, createdAt: 1})));
    await assertSucceeds(pb.collection('contacts').doc('k1').set(sealed({createdAt: 1, updatedAt: 1})));
    await assertSucceeds(pb.collection('meetings').doc('k1').set(sealed({date: '2026-10-03', createdAt: 1})));
  });
  await t('cliente en claro en un proyecto cifrado se rechaza', () => assertFails(pb.collection('clients').doc('k2').set({nombre: 'Acme'})));
  await t('contacto en claro en un proyecto cifrado se rechaza', () => assertFails(pb.collection('contacts').doc('k2').set({nombre: 'Ana', email: 'a@x.com'})));
  await t('credencial sellada con la contraseña en cipherV2', () => assertSucceeds(pb.collection('vault').doc('v1').set(sealed({order: 1, ivV2: 'iv', cipherV2: 'cipher'}))));
  await t('credencial en claro en un proyecto cifrado se rechaza', () => assertFails(pb.collection('vault').doc('v2').set({tipo: 'correo', cliente: 'Acme', correo: 'a@x.com', ivV2: 'iv', cipherV2: 'c'})));
  await t('vault_meta (la clave del cofre, ya envuelta) sigue en claro', () => assertSucceeds(pb.collection('vault_meta').doc('check').set({v: 2, salt: 's', check: 'c'})));
  await t('datos de plugin sellados', () => assertSucceeds(pb.collection('plugin_data').doc('smartgp').set(sealed({updatedAt: 1}))));
  await t('datos de plugin en claro en un proyecto cifrado se rechazan', () => assertFails(pb.collection('plugin_data').doc('smartgp2').set({values: {a: 1}, updatedAt: 1})));
  const mark = (over) => Object.assign({_kind: 'plugin-install', pluginId: 'smartgp', url: 'https://x', manifest: {id: 'smartgp'}, granted: [], official: true, installedAt: 1, updatedAt: 1}, over || {});
  await t('la marca de instalación de un plugin va en claro', () => assertSucceeds(pb.collection('plugin_data').doc('install:smartgp').set(mark())));
  await t('una marca de instalación con campos de más se rechaza', () => assertFails(pb.collection('plugin_data').doc('install:otro').set(mark({secreto: 'texto'}))));
  await t('una marca de instalación con _kind distinto se rechaza', () => assertFails(pb.collection('plugin_data').doc('install:raro').set(mark({_kind: 'otra-cosa'}))));

  console.log('Cifrado: proyecto principal cifrado');
  await t('tarea en claro en el principal cifrado se rechaza', () => assertFails(zu.collection('tasks').doc('m1').set({title: 'en claro'})));
  await t('tarea sellada en el principal cifrado', () => assertSucceeds(zu.collection('tasks').doc('m1').set(sealed({status: 'todo', order: 1}))));
  await t('nota en claro en el principal cifrado se rechaza', () => assertFails(zu.collection('tasks').doc('m1').collection('notes').doc('n1').set({text: 'en claro'})));
  await t('nota sellada en el principal cifrado', () => assertSucceeds(zu.collection('tasks').doc('m1').collection('notes').doc('n1').set(sealed({createdAt: 1}))));
  await t('imagen sellada en la cuenta', () => assertSucceeds(zu.collection('assets').doc('a1').set({createdAt: 1, e: 'A'.repeat(880000), ev: 1, kid: 'kid-12345'})));
  await t('imagen sellada con contentType se rechaza', () => assertFails(zu.collection('assets').doc('a2').set({createdAt: 1, e: 'A'.repeat(100), ev: 1, kid: 'kid-12345', contentType: 'image/jpeg'})));
  await t('el principal sin cifrar sigue aceptando tareas en claro', () => assertSucceeds(alice.collection('users').doc('alice').collection('tasks').doc('claro-2').set({title: 'a'})));

  console.log('Cifrado: envoltorio de la clave (crypto)');
  await t('zed guarda su envoltorio del principal', () => assertSucceeds(zu.collection('crypto').doc('zed').set(cryptoDoc())));
  await t('zed guarda su envoltorio de un proyecto', () => assertSucceeds(pb.collection('crypto').doc('zed').set(cryptoDoc())));
  await t('zed lee su envoltorio', () => assertSucceeds(pb.collection('crypto').doc('zed').get()));
  await t('bob no lee el envoltorio de zed', () => assertFails(bob.collection('users').doc('zed').collection('crypto').doc('zed').get()));
  await t('bob no escribe en el envoltorio de zed', () => assertFails(bob.collection('users').doc('zed').collection('crypto').doc('zed').set(cryptoDoc())));
  await t('zed no escribe el envoltorio de otro uid', () => assertFails(zu.collection('crypto').doc('bob').set(cryptoDoc())));
  await t('menos de 600 000 iteraciones se rechaza', () => assertFails(zu.collection('crypto').doc('zed').set(cryptoDoc({kdf: {name: 'PBKDF2', hash: 'SHA-256', iter: 300000, salt: 's'.repeat(22)}}))));
  await t('otro algoritmo de derivación se rechaza', () => assertFails(zu.collection('crypto').doc('zed').set(cryptoDoc({kdf: {name: 'scrypt', hash: 'SHA-256', iter: 600000, salt: 's'.repeat(22)}}))));
  await t('un envoltorio con campos de más se rechaza', () => assertFails(zu.collection('crypto').doc('zed').set(cryptoDoc({extra: 'x'}))));
  await t('un envoltorio sin clave de recuperación se rechaza', () => { const d = cryptoDoc(); delete d.rk; return assertFails(zu.collection('crypto').doc('zed').set(d)); });
  /* Modo gestionado: la clave del proyecto envuelta con la clave que da el Worker. */
  const kmsDoc = (over) => Object.assign({v: 1, kid: 'kid-12345', kms: {iv: 'i'.repeat(16), ct: 'c'.repeat(64), kmsv: 1}, createdAt: 1, updatedAt: 1}, over || {});
  const pm = zu.collection('projects').doc('pm');
  await t('zed guarda el envoltorio gestionado de un proyecto', () => assertSucceeds(pm.collection('crypto').doc('zed').set(kmsDoc())));
  await t('zed lee su envoltorio gestionado', () => assertSucceeds(pm.collection('crypto').doc('zed').get()));
  await t('bob no lee el envoltorio gestionado de zed', () => assertFails(bob.collection('users').doc('zed').collection('projects').doc('pm').collection('crypto').doc('zed').get()));
  await t('bob no escribe el envoltorio gestionado de zed', () => assertFails(bob.collection('users').doc('zed').collection('projects').doc('pm').collection('crypto').doc('zed').set(kmsDoc())));
  await t('un envoltorio gestionado del principal se acepta', () => assertSucceeds(zu.collection('crypto').doc('zed').set(kmsDoc())));
  await t('el principal vuelve a su envoltorio con contraseña', () => assertSucceeds(zu.collection('crypto').doc('zed').set(cryptoDoc())));
  await t('un envoltorio gestionado con contraseña a la vez se rechaza', () => assertFails(pm.collection('crypto').doc('zed').set(Object.assign(cryptoDoc(), {kms: {iv: 'i'.repeat(16), ct: 'c'.repeat(64), kmsv: 1}}))));
  await t('un envoltorio gestionado sin versión del secreto se rechaza', () => assertFails(pm.collection('crypto').doc('zed').set(kmsDoc({kms: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}}))));
  await t('un envoltorio gestionado con versión 0 se rechaza', () => assertFails(pm.collection('crypto').doc('zed').set(kmsDoc({kms: {iv: 'i'.repeat(16), ct: 'c'.repeat(64), kmsv: 0}}))));
  await t('un envoltorio gestionado con campos de más en kms se rechaza', () => assertFails(pm.collection('crypto').doc('zed').set(kmsDoc({kms: {iv: 'i'.repeat(16), ct: 'c'.repeat(64), kmsv: 1, kek: 'x'}}))));
  await t('un envoltorio gestionado con campos de más se rechaza', () => assertFails(pm.collection('crypto').doc('zed').set(kmsDoc({extra: 'x'}))));
  await t('un envoltorio gestionado demasiado grande se rechaza', () => assertFails(pm.collection('crypto').doc('zed').set(kmsDoc({kms: {iv: 'i'.repeat(16), ct: 'c'.repeat(257), kmsv: 1}}))));
  await t('kms que no es un mapa se rechaza', () => assertFails(pm.collection('crypto').doc('zed').set(kmsDoc({kms: 'texto'}))));
  await t('un envoltorio con la clave pública y la privada envuelta (D9) se acepta', () => assertSucceeds(zu.collection('crypto').doc('zed').set(cryptoDoc({
    pub: {kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43)}, priv: {iv: 'i'.repeat(16), ct: 'c'.repeat(200)}}))));
  await t('zed borra su envoltorio', () => assertSucceeds(pb.collection('crypto').doc('zed').delete()));

  console.log('Cifrado: proyectos de equipo');
  const tb = alice.collection('teams').doc('tb');
  await t('alice crea un equipo cifrado', () => assertSucceeds(tb.set(Object.assign(team('alice'), {enc: ENC()}))));
  await t('un equipo con enc y github no se crea', () => assertFails(alice.collection('teams').doc('tg').set(Object.assign(team('alice'), {enc: ENC(), github: {login: 'x', number: 1}}))));
  await t('un equipo no puede ser gestionado por Kanlane', () => assertFails(alice.collection('teams').doc('tm').set(Object.assign(team('alice'), {enc: ENC({mode: 'managed'})}))));
  await t('un equipo con enc inválido no se crea', () => assertFails(alice.collection('teams').doc('tf').set(Object.assign(team('alice'), {enc: ENC({v: 2})}))));
  await t('un equipo sin cifrar sigue aceptando tareas en claro', async () => {
    await assertSucceeds(alice.collection('teams').doc('tc').set(team('alice')));
    await assertSucceeds(alice.collection('teams').doc('tc').collection('tasks').doc('x').set({title: 'en claro'}));
  });
  await t('alice invita a bob (editor) y a carol (lector) al equipo cifrado', async () => {
    await assertSucceeds(alice.collection('invites').doc('tb_bob@x.com').set(invite('tb', 'bob@x.com', 'editor', 'alice')));
    await assertSucceeds(alice.collection('invites').doc('tb_carol@x.com').set(invite('tb', 'carol@x.com', 'viewer', 'alice')));
  });
  await t('bob y carol entran', async () => {
    const b1 = bob.batch();
    b1.update(bob.collection('teams').doc('tb'), {memberIds: FVc.arrayUnion('bob'), ['members.bob']: me('bob', 'bob@x.com', 'editor')});
    b1.delete(bob.collection('invites').doc('tb_bob@x.com'));
    await assertSucceeds(b1.commit());
    const b2 = carol.batch();
    b2.update(carol.collection('teams').doc('tb'), {memberIds: FVc.arrayUnion('carol'), ['members.carol']: me('carol', 'carol@x.com', 'viewer')});
    b2.delete(carol.collection('invites').doc('tb_carol@x.com'));
    await assertSucceeds(b2.commit());
  });
  await t('un editor no cambia enc', () => assertFails(bob.collection('teams').doc('tb').update({enc: ENC({kid: 'zzzzzzzz'})})));
  await t('el propietario no quita enc', () => assertFails(tb.update({enc: FVc.delete()})));
  await t('el propietario no cambia enc', () => assertFails(tb.update({enc: ENC({kid: 'zzzzzzzz'})})));
  await t('el propietario no puede añadir github a un equipo cifrado', () => assertFails(tb.update({github: {login: 'x', number: 1}})));
  await t('el propietario sigue pudiendo renombrar el equipo cifrado', () => assertSucceeds(tb.update({nombre: 'Equipo cifrado'})));
  await t('tarea en claro en un equipo cifrado se rechaza', () => assertFails(bob.collection('teams').doc('tb').collection('tasks').doc('x1').set({title: 'en claro'})));
  await t('tarea sellada en un equipo cifrado', () => assertSucceeds(bob.collection('teams').doc('tb').collection('tasks').doc('x1').set(sealed({status: 'todo', assignees: ['bob']}))));
  await t('nota en claro en un equipo cifrado se rechaza', () => assertFails(bob.collection('teams').doc('tb').collection('tasks').doc('x1').collection('notes').doc('n1').set({text: 'en claro'})));
  await t('nota sellada en un equipo cifrado', () => assertSucceeds(bob.collection('teams').doc('tb').collection('tasks').doc('x1').collection('notes').doc('n1').set(sealed({createdAt: 1}))));
  await t('imagen en claro en un equipo cifrado se rechaza', () => assertFails(bob.collection('teams').doc('tb').collection('assets').doc('i1').set({data: 'data:image/jpeg;base64,AAAA', contentType: 'image/jpeg', createdAt: 1})));
  await t('imagen sellada en un equipo cifrado', () => assertSucceeds(bob.collection('teams').doc('tb').collection('assets').doc('i1').set({createdAt: 1, e: 'A'.repeat(1000), ev: 1, kid: 'kid-12345'})));
  await t('un lector no escribe tareas selladas', () => assertFails(carol.collection('teams').doc('tb').collection('tasks').doc('x2').set(sealed())));
  await t('un miembro (lector) guarda su envoltorio', () => assertSucceeds(carol.collection('teams').doc('tb').collection('crypto').doc('carol').set(cryptoDoc())));
  await t('en un equipo no se guarda un envoltorio gestionado', () => assertFails(carol.collection('teams').doc('tb').collection('crypto').doc('carol').set({v: 1, kid: 'kid-12345', kms: {iv: 'i'.repeat(16), ct: 'c'.repeat(64), kmsv: 1}, createdAt: 1, updatedAt: 1})));
  await t('un miembro no guarda el envoltorio de otro', () => assertFails(carol.collection('teams').doc('tb').collection('crypto').doc('bob').set(cryptoDoc())));
  await t('un miembro lee su envoltorio', () => assertSucceeds(carol.collection('teams').doc('tb').collection('crypto').doc('carol').get()));
  await t('un miembro no lee el envoltorio de otro', () => assertFails(bob.collection('teams').doc('tb').collection('crypto').doc('carol').get()));
  await t('quien no es miembro no lee ningún envoltorio', () => assertFails(dave.collection('teams').doc('tb').collection('crypto').doc('carol').get()));
  await t('quien no es miembro no escribe un envoltorio', () => assertFails(dave.collection('teams').doc('tb').collection('crypto').doc('dave').set(cryptoDoc())));
  await t('un editor no borra el envoltorio de otro', () => assertFails(bob.collection('teams').doc('tb').collection('crypto').doc('carol').delete()));
  await t('el propietario borra el envoltorio de un miembro', () => assertSucceeds(tb.collection('crypto').doc('carol').delete()));

  console.log('Cifrado: invitaciones con código de acceso');
  const invDave = alice.collection('invites').doc('tb_dave@x.com');
  await t('alice crea la invitación y la clave envuelta en un lote', async () => {
    const b = alice.batch();
    b.set(invDave, invite('tb', 'dave@x.com', 'editor', 'alice'));
    b.set(invDave.collection('key').doc('wrap'), wrapDoc());
    await assertSucceeds(b.commit());
  });
  await t('una clave envuelta con una hora del cliente (para alargar la caducidad) se rechaza', async () => {
    const ref = alice.collection('invites').doc('tb_frank@x.com');
    const b = alice.batch();
    b.set(ref, invite('tb', 'frank@x.com', 'editor', 'alice'));
    b.set(ref.collection('key').doc('wrap'), wrapDoc({createdAt: new Date(Date.now() + 3600 * 1000)}));
    await assertFails(b.commit());
  });
  await t('menos de 100 000 iteraciones del código se rechaza', async () => {
    const ref = alice.collection('invites').doc('tb_frank@x.com');
    const b = alice.batch();
    b.set(ref, invite('tb', 'frank@x.com', 'editor', 'alice'));
    b.set(ref.collection('key').doc('wrap'), wrapDoc({iter: 1000}));
    await assertFails(b.commit());
  });
  await t('la clave envuelta solo la crea el propietario del equipo', async () => {
    await assertSucceeds(alice.collection('invites').doc('tb_gina@x.com').set(invite('tb', 'gina@x.com', 'viewer', 'alice')));
    await assertFails(bob.collection('invites').doc('tb_gina@x.com').collection('key').doc('wrap').set(wrapDoc()));
  });
  await t('la clave envuelta solo se llama wrap', async () => {
    const b = alice.batch();
    b.set(alice.collection('invites').doc('tb_gina@x.com').collection('key').doc('otra'), wrapDoc());
    await assertFails(b.commit());
  });
  await t('el destinatario lee la clave envuelta', () => assertSucceeds(dave.collection('invites').doc('tb_dave@x.com').collection('key').doc('wrap').get()));
  await t('otra cuenta no la lee', () => assertFails(carol.collection('invites').doc('tb_dave@x.com').collection('key').doc('wrap').get()));
  await t('quien invitó no la lee', () => assertFails(invDave.collection('key').doc('wrap').get()));
  await t('nadie modifica la clave envuelta', () => assertFails(invDave.collection('key').doc('wrap').update({ct: 'otra'.repeat(10)})));
  await t('dave no guarda su envoltorio antes de entrar', () => assertFails(dave.collection('teams').doc('tb').collection('crypto').doc('dave').set(cryptoDoc())));
  await t('pasadas 24 horas el destinatario ya no lee la clave', async () => {
    const Timestamp = require('firebase/compat/app').default.firestore.Timestamp;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('invites').doc('tb_erin@x.com').set(invite('tb', 'erin@x.com', 'editor', 'alice'));
      await db.collection('invites').doc('tb_erin@x.com').collection('key').doc('wrap').set(wrapDoc({createdAt: Timestamp.fromMillis(Date.now() - 25 * 3600 * 1000)}));
    });
    await assertFails(erin.collection('invites').doc('tb_erin@x.com').collection('key').doc('wrap').get());
  });
  await t('antes de 24 horas sí la lee', async () => {
    const Timestamp = require('firebase/compat/app').default.firestore.Timestamp;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('invites').doc('tb_erin@x.com').collection('key').doc('wrap').set(wrapDoc({createdAt: Timestamp.fromMillis(Date.now() - 23 * 3600 * 1000)}));
    });
    await assertSucceeds(erin.collection('invites').doc('tb_erin@x.com').collection('key').doc('wrap').get());
  });
  await t('el propietario borra primero la clave caducada y después la invitación', async () => {
    const ref = alice.collection('invites').doc('tb_erin@x.com');
    await assertSucceeds(ref.collection('key').doc('wrap').delete());
    await assertSucceeds(ref.delete());
  });
  await t('dave acepta: entra, guarda su envoltorio y borra invitación y clave en un lote', async () => {
    const b = dave.batch();
    b.update(dave.collection('teams').doc('tb'), {memberIds: FVc.arrayUnion('dave'), ['members.dave']: me('dave', 'dave@x.com', 'editor')});
    b.set(dave.collection('teams').doc('tb').collection('crypto').doc('dave'), cryptoDoc());
    b.delete(dave.collection('invites').doc('tb_dave@x.com').collection('key').doc('wrap'));
    b.delete(dave.collection('invites').doc('tb_dave@x.com'));
    await assertSucceeds(b.commit());
  });
  await t('dave ya lee los datos sellados del equipo', () => assertSucceeds(dave.collection('teams').doc('tb').collection('tasks').doc('x1').get()));
  await t('dave rechaza una invitación borrando la clave y la invitación', async () => {
    const ref = alice.collection('invites').doc('tb_gina@x.com');
    await assertSucceeds(ref.collection('key').doc('wrap').set(wrapDoc()));
    const ctx = env.authenticatedContext('gina', tok('gina@x.com')).firestore();
    await assertSucceeds(ctx.collection('invites').doc('tb_gina@x.com').collection('key').doc('wrap').delete());
    await assertSucceeds(ctx.collection('invites').doc('tb_gina@x.com').delete());
  });

  /* ---------- Cambio de clave (PR10 del plan, apartado 13.1) ---------- */
  console.log('Cifrado: cambio de clave de un proyecto personal');
  const KCV2 = 'n'.repeat(52);
  const ROT = (over) => ENC(Object.assign({kid: 'kid-nuevo2', kcv: KCV2, rot: {kid: 'kid-12345', kcv: 'k'.repeat(52), at: 1}}, over || {}));
  const pbDoc = zu.collection('projects').doc('pb');
  await t('un proyecto no nace con un cambio de clave a medias', () => assertFails(zu.collection('projects').doc('pr').set(proj({enc: ROT()}))));
  await t('empezar un cambio de clave sin apuntar la anterior se rechaza', () => assertFails(pbDoc.update({enc: ENC({kid: 'kid-nuevo2', kcv: KCV2})})));
  await t('apuntar como anterior una clave que no es la vigente se rechaza', () => assertFails(pbDoc.update({enc: ROT({rot: {kid: 'otro-kid-9', kcv: 'k'.repeat(52), at: 1}})})));
  await t('apuntar la anterior con otro kcv se rechaza', () => assertFails(pbDoc.update({enc: ROT({rot: {kid: 'kid-12345', kcv: 'x'.repeat(52), at: 1}})})));
  await t('cambiar el pid al cambiar la clave se rechaza', () => assertFails(pbDoc.update({enc: ROT({pid: 'q'.repeat(22)})})));
  await t('pasar a gestionado al cambiar la clave se rechaza', () => assertFails(pbDoc.update({enc: ROT({mode: 'managed'})})));
  await t('rot con un campo de más se rechaza', () => assertFails(pbDoc.update({enc: ROT({rot: {kid: 'kid-12345', kcv: 'k'.repeat(52), at: 1, extra: 1}})})));
  await t('rot con la misma clave que la vigente se rechaza', () => assertFails(pbDoc.update({enc: ENC({rot: {kid: 'kid-12345', kcv: 'k'.repeat(52), at: 1}})})));
  await t('un proyecto gestionado no cambia de clave', () => assertFails(zu.collection('projects').doc('pm').update({enc: ROT({mode: 'managed'})})));
  await t('zed empieza el cambio de clave', () => assertSucceeds(pbDoc.update({enc: ROT()})));
  await t('con un cambio a medias no se empieza otro', () => assertFails(pbDoc.update({enc: ROT({kid: 'kid-nuevo3', rot: {kid: 'kid-nuevo2', kcv: KCV2, at: 2}})})));
  await t('con un cambio a medias no se vuelve a la clave anterior', () => assertFails(pbDoc.update({enc: ENC()})));
  await t('terminar el cambio con otra clave se rechaza', () => assertFails(pbDoc.update({enc: ENC({kid: 'kid-nuevo3', kcv: KCV2})})));
  await t('durante el cambio se sigue pudiendo renombrar', () => assertSucceeds(pbDoc.update({nombre: 'Con clave nueva'})));
  await t('zed termina el cambio de clave', () => assertSucceeds(pbDoc.update({enc: ENC({kid: 'kid-nuevo2', kcv: KCV2})})));
  await t('el envoltorio guarda la clave anterior mientras dura el cambio', () => assertSucceeds(zu.collection('projects').doc('pb').collection('crypto').doc('zed').set(cryptoDoc({
    kid: 'kid-nuevo2', old: {kid: 'kid-12345', kdf: {name: 'PBKDF2', hash: 'SHA-256', iter: 600000, salt: 's'.repeat(22)},
      pw: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}, rk: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}, priv: {iv: 'i'.repeat(16), ct: 'c'.repeat(200)}}}))));
  await t('la clave anterior con un campo de más se rechaza', () => assertFails(zu.collection('projects').doc('pb').collection('crypto').doc('zed').set(cryptoDoc({
    old: {kid: 'kid-12345', kdf: {name: 'PBKDF2'}, pw: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}, rk: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}, dek: 'en claro'}}))));
  await t('la clave anterior sin su envoltorio se rechaza', () => assertFails(zu.collection('projects').doc('pb').collection('crypto').doc('zed').set(cryptoDoc({
    old: {kid: 'kid-12345', kdf: {name: 'PBKDF2'}, rk: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}}}))));

  console.log('Cifrado: claves públicas y cambio de clave en un equipo');
  const PUB = (over) => Object.assign({kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43)}, over || {});
  const pubDoc = (over) => Object.assign({v: 1, pub: PUB(), updatedAt: 1}, over || {});
  const rekeyDoc = (over) => Object.assign({v: 1, kid: 'kid-nuevo2', from: 'alice', epk: PUB(), iv: 'i'.repeat(16), ct: 'c'.repeat(64), createdAt: 1}, over || {});
  const tbOf = (db) => db.collection('teams').doc('tb');
  await t('un equipo no nace con un cambio de clave a medias', () => assertFails(alice.collection('teams').doc('tr').set(Object.assign(team('alice'), {enc: ROT()}))));
  await t('un miembro publica su clave pública', () => assertSucceeds(tbOf(bob).collection('pubkeys').doc('bob').set(pubDoc())));
  await t('un lector también publica la suya', () => assertSucceeds(tbOf(carol).collection('pubkeys').doc('carol').set(pubDoc())));
  await t('nadie publica la clave pública de otro', () => assertFails(tbOf(bob).collection('pubkeys').doc('carol').set(pubDoc())));
  await t('el propietario tampoco publica la de otro', () => assertFails(tb.collection('pubkeys').doc('bob').set(pubDoc())));
  await t('una clave pública de otra curva se rechaza', () => assertFails(tbOf(bob).collection('pubkeys').doc('bob').set(pubDoc({pub: PUB({crv: 'P-384'})}))));
  await t('una clave pública con la privada dentro se rechaza', () => assertFails(tbOf(bob).collection('pubkeys').doc('bob').set(pubDoc({pub: Object.assign(PUB(), {d: 'secreto'})}))));
  await t('una clave pública con campos de más se rechaza', () => assertFails(tbOf(bob).collection('pubkeys').doc('bob').set(pubDoc({extra: 1}))));
  await t('los miembros leen las claves públicas del equipo', () => assertSucceeds(tbOf(dave).collection('pubkeys').get()));
  await t('quien no es miembro no lee las claves públicas', () => assertFails(tbOf(erin).collection('pubkeys').doc('bob').get()));
  await t('quien no es miembro no publica una clave pública', () => assertFails(tbOf(erin).collection('pubkeys').doc('erin').set(pubDoc())));

  await t('el propietario deja la clave nueva a un miembro', () => assertSucceeds(tb.collection('rekey').doc('bob').set(rekeyDoc())));
  await t('un editor no deja claves a otros', () => assertFails(tbOf(bob).collection('rekey').doc('carol').set(rekeyDoc({from: 'bob'}))));
  await t('un editor no sustituye la clave que le dejó el propietario', () => assertFails(tbOf(bob).collection('rekey').doc('bob').set(rekeyDoc({from: 'bob'}))));
  await t('no se deja una clave a quien no es miembro', () => assertFails(tb.collection('rekey').doc('erin').set(rekeyDoc())));
  await t('no se deja una clave a nombre de otro', () => assertFails(tb.collection('rekey').doc('carol').set(rekeyDoc({from: 'bob'}))));
  await t('una clave entregada con campos de más se rechaza', () => assertFails(tb.collection('rekey').doc('carol').set(rekeyDoc({dek: 'en claro'}))));
  await t('una clave entregada sin la clave efímera se rechaza', () => { const d = rekeyDoc(); delete d.epk; return assertFails(tb.collection('rekey').doc('carol').set(d)); });
  await t('una clave entregada con una clave efímera que no es P-256 se rechaza', () => assertFails(tb.collection('rekey').doc('carol').set(rekeyDoc({epk: PUB({crv: 'P-384'})}))));
  await t('una clave entregada con la parte privada de la efímera se rechaza', () => assertFails(tb.collection('rekey').doc('carol').set(rekeyDoc({epk: Object.assign(PUB(), {d: 'secreto'})}))));
  await t('el miembro lee la clave que le han dejado', () => assertSucceeds(tbOf(bob).collection('rekey').doc('bob').get()));
  await t('otro miembro no la lee', () => assertFails(tbOf(carol).collection('rekey').doc('bob').get()));
  await t('quien no es miembro no la lee', () => assertFails(tbOf(erin).collection('rekey').doc('bob').get()));

  await t('un editor no cambia la clave del equipo', () => assertFails(tbOf(bob).update({enc: ROT()})));
  await t('el propietario no cambia la clave sin apuntar la anterior', () => assertFails(tb.update({enc: ENC({kid: 'kid-nuevo2', kcv: KCV2})})));
  await t('el propietario empieza el cambio de clave', () => assertSucceeds(tb.update({enc: ROT()})));
  await t('una tarea nueva sellada con la clave anterior se rechaza', () => assertFails(tbOf(bob).collection('tasks').doc('x3').set(sealed({status: 'todo'}))));
  await t('una tarea nueva sellada con la clave vigente', () => assertSucceeds(tbOf(bob).collection('tasks').doc('x3').set(sealed({status: 'todo', kid: 'kid-nuevo2'}))));
  await t('mover una tarea sellada con la clave anterior se permite', () => assertSucceeds(tbOf(bob).collection('tasks').doc('x1').update({status: 'done'})));
  await t('cambiar el contenido con la clave anterior se rechaza', () => assertFails(tbOf(bob).collection('tasks').doc('x1').update({e: 'B'.repeat(60)})));
  await t('una nota nueva con la clave anterior se rechaza', () => assertFails(tbOf(bob).collection('tasks').doc('x1').collection('notes').doc('n2').set(sealed({createdAt: 2}))));
  await t('una imagen nueva con la clave anterior se rechaza', () => assertFails(tbOf(bob).collection('assets').doc('i2').set({createdAt: 1, e: 'A'.repeat(1000), ev: 1, kid: 'kid-12345'})));
  await t('volver a sellar una tarea con la clave vigente', () => assertSucceeds(tb.collection('tasks').doc('x1').update({e: 'B'.repeat(60), ev: 1, kid: 'kid-nuevo2'})));
  await t('volver a sellar una nota con la clave vigente', () => assertSucceeds(tb.collection('tasks').doc('x1').collection('notes').doc('n1').update({e: 'B'.repeat(60), ev: 1, kid: 'kid-nuevo2'})));
  await t('un miembro guarda su envoltorio con la clave nueva y la anterior', () => assertSucceeds(tbOf(bob).collection('crypto').doc('bob').set(cryptoDoc({
    kid: 'kid-nuevo2', old: {kid: 'kid-12345', kdf: {name: 'PBKDF2', hash: 'SHA-256', iter: 600000, salt: 's'.repeat(22)},
      pw: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}, rk: {iv: 'i'.repeat(16), ct: 'c'.repeat(64)}}}))));
  await t('un editor no termina el cambio de clave', () => assertFails(tbOf(bob).update({enc: ENC({kid: 'kid-nuevo2', kcv: KCV2})})));
  await t('el propietario termina el cambio de clave', () => assertSucceeds(tb.update({enc: ENC({kid: 'kid-nuevo2', kcv: KCV2})})));
  await t('tras el cambio, lo sellado con la clave anterior sigue rechazado', () => assertFails(tbOf(bob).collection('tasks').doc('x4').set(sealed({status: 'todo'}))));
  await t('el miembro borra la clave que recibió', () => assertSucceeds(tbOf(bob).collection('rekey').doc('bob').delete()));
  await t('un editor no borra la clave pública de otro', () => assertFails(tbOf(bob).collection('pubkeys').doc('carol').delete()));
  await t('el propietario borra la clave pública de quien quita', () => assertSucceeds(tb.collection('pubkeys').doc('carol').delete()));

  /* ---------- Convertir un proyecto en claro en uno cifrado (PR11 del plan, apartado 13.2) ---------- */
  console.log('Cifrado: convertir un proyecto que estaba en claro');
  const CONV = (over) => ENC(Object.assign({conv: 5}, over || {}));
  const pcDoc = zu.collection('projects').doc('pc');
  const pc = pcDoc;
  await t('zed tiene un proyecto en claro con datos', async () => {
    await assertSucceeds(pcDoc.set(proj()));
    await assertSucceeds(pc.collection('tasks').doc('a').set({title: 'en claro'}));
    await assertSucceeds(pc.collection('tasks').doc('a').collection('notes').doc('n').set({text: 'en claro'}));
    await assertSucceeds(pc.collection('clients').doc('c').set({nombre: 'Cliente'}));
  });
  await t('convertir un proyecto enlazado con GitHub se rechaza', async () => {
    await assertSucceeds(zu.collection('projects').doc('pgh').set(proj({github: {login: 'x', number: 1}})));
    await assertFails(zu.collection('projects').doc('pgh').update({enc: CONV()}));
  });
  await t('convertir a gestionado por Kanlane se rechaza', () => assertFails(pcDoc.update({enc: CONV({mode: 'managed'})})));
  await t('conv que no es un número se rechaza', () => assertFails(pcDoc.update({enc: CONV({conv: 'sí'})})));
  await t('convertir con un cambio de clave a medias a la vez se rechaza', () => assertFails(pcDoc.update({enc: CONV({rot: {kid: 'otro-kid-9', kcv: 'k'.repeat(52), at: 1}})})));
  await t('otra cuenta no convierte el proyecto de zed', () => assertFails(bob.collection('users').doc('zed').collection('projects').doc('pc').update({enc: CONV()})));
  await t('zed empieza la conversión', () => assertSucceeds(pcDoc.update({enc: CONV()})));
  await t('durante la conversión lo nuevo tiene que ir sellado', () => assertFails(pc.collection('tasks').doc('b').set({title: 'en claro'})));
  await t('durante la conversión se crean tareas selladas', () => assertSucceeds(pc.collection('tasks').doc('b').set(sealed({status: 'todo'}))));
  await t('durante la conversión una nota nueva en claro se rechaza', () => assertFails(pc.collection('tasks').doc('a').collection('notes').doc('n2').set({text: 'en claro'})));
  await t('lo que estaba en claro se sella', async () => {
    await assertSucceeds(pc.collection('tasks').doc('a').set(sealed({status: 'todo'})));
    await assertSucceeds(pc.collection('tasks').doc('a').collection('notes').doc('n').set(sealed({createdAt: 1})));
    await assertSucceeds(pc.collection('clients').doc('c').set(sealed({color: 1})));
  });
  await t('lo sellado no vuelve a quedar en claro', () => assertFails(pc.collection('tasks').doc('a').set({title: 'en claro otra vez'})));
  await t('durante la conversión no se cambia la clave', () => assertFails(pcDoc.update({enc: CONV({kid: 'kid-nuevo2', kcv: KCV2, rot: {kid: 'kid-12345', kcv: 'k'.repeat(52), at: 1}})})));
  await t('durante la conversión no se cambia la clave quitando la marca', () => assertFails(pcDoc.update({enc: ENC({kid: 'kid-nuevo2', kcv: KCV2, rot: {kid: 'kid-12345', kcv: 'k'.repeat(52), at: 1}})})));
  await t('durante la conversión no se quita el cifrado', () => assertFails(pcDoc.set(proj())));
  await t('durante la conversión no se enlaza con GitHub', () => assertFails(pcDoc.update({github: {login: 'x', number: 1}})));
  await t('terminar la conversión con otra clave se rechaza', () => assertFails(pcDoc.update({enc: ENC({kid: 'kid-nuevo2'})})));
  await t('terminar la conversión con otro proyecto (pid) se rechaza', () => assertFails(pcDoc.update({enc: ENC({pid: 'q'.repeat(22)})})));
  await t('zed termina la conversión', () => assertSucceeds(pcDoc.update({enc: ENC()})));
  await t('un proyecto ya cifrado no vuelve a marcarse como en conversión', () => assertFails(pcDoc.update({enc: CONV()})));
  await t('un cambio de clave no marca el proyecto como en conversión', () => assertFails(pcDoc.update({enc: CONV({kid: 'kid-nuevo2', kcv: KCV2, rot: {kid: 'kid-12345', kcv: 'k'.repeat(52), at: 1}})})));
  await t('tras la conversión sigue sin admitirse nada en claro', () => assertFails(pc.collection('tasks').doc('d').set({title: 'en claro'})));
  await t('el principal que aún no tenía documento se convierte', async () => {
    const amy = env.authenticatedContext('amy', tok('amy@x.com')).firestore().collection('users').doc('amy');
    await assertSucceeds(amy.collection('tasks').doc('a').set({title: 'en claro'}));
    await assertSucceeds(amy.collection('projects').doc('main').set(proj({enc: CONV()})));
    await assertFails(amy.collection('tasks').doc('b').set({title: 'en claro'}));
    await assertSucceeds(amy.collection('tasks').doc('a').set(sealed({status: 'todo'})));
    await assertSucceeds(amy.collection('projects').doc('main').update({enc: ENC()}));
  });
  await t('un equipo no nace marcado como en conversión', () => assertFails(alice.collection('teams').doc('tv').set(Object.assign(team('alice'), {enc: CONV()}))));
  await t('a un equipo sin cifrar no se le añade cifrado', () => assertFails(alice.collection('teams').doc('tc').update({enc: CONV()})));

  await env.cleanup();
  console.log('\n' + pass + ' correctas, ' + fail + ' fallidas');
  process.exit(fail ? 1 : 0);
})();
