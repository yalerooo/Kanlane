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
  await t('el gestor de contraseñas (vault) no se permite en equipos', () => assertFails(alice.collection('teams').doc('t1').collection('vault').doc('v').set({x: 1})));
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

  await env.cleanup();
  console.log('\n' + pass + ' correctas, ' + fail + ' fallidas');
  process.exit(fail ? 1 : 0);
})();
