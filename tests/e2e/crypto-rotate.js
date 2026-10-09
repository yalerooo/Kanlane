/* Cambiar la clave de un proyecto con cifrado total contra Auth/Firestore emulados y las reglas reales
   (PR10 del plan, docs/CIFRADO-PROYECTOS.md 13.1). Primero un proyecto personal desde «Editar
   proyecto»; después un equipo con tres cuentas en tres contextos del navegador: la propietaria quita
   a una persona, cambia la clave desde el aviso de «Compartir» y el miembro que queda recibe la clave
   nueva con su contraseña y estrena clave de recuperación. Además: en Firestore todo queda sellado
   con la clave nueva y las reglas rechazan lo que se selle con la anterior.
   Uso: npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub
        --config firebase.test.json "node tests/e2e/crypto-rotate.js" */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58647;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

const PASSWORD = 'una contraseña de cifrado larga';
const GUEST_PASSWORD = 'la frase propia del invitado';
const SECRETS = ['Tarea secreta', 'Descripción reservada', 'Nota confidencial', 'Tarea del miembro'];
const KEY_RE = /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/;
const stamp = Date.now();

async function ready(){
  for(let i = 0; i < 300; i++){
    try{ if((await fetch(url)).ok && (await fetch(authUrl)).status < 500) return; }catch(e){}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('No arrancaron el servidor y el emulador de Authentication');
}

async function verify(email){
  let code;
  for(let i = 0; i < 50; i++){
    const response = await fetch(authUrl + '/emulator/v1/projects/demo-workhub/oobCodes');
    const data = await response.json();
    code = (data.oobCodes || []).find((item) => item.email === email && item.requestType === 'VERIFY_EMAIL');
    if(code) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(code, 'el emulador recibió el correo de verificación');
  const response = await fetch(authUrl + '/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({oobCode:code.oobCode})
  });
  assert.equal(response.status, 200, 'la cuenta se verifica');
}

/* Firestore como administrador (sin reglas). */
async function stored(docPath){
  const response = await fetch(storeUrl + docPath, {headers:{Authorization:'Bearer owner'}});
  return {status:response.status, text:await response.text()};
}
async function storedWhen(docPath, done){
  let res;
  for(let i = 0; i < 75; i++){
    res = await stored(docPath);
    if(done(res)) return res;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return res;
}
/* Todo lo de una colección está sellado con esta clave y nada con la anterior. */
function assertKid(res, kid, oldKid, what){
  assert.equal(res.status, 200, what + ': se puede leer');
  SECRETS.forEach((s) => assert.ok(res.text.indexOf(s) === -1, what + ': «' + s + '» no está en claro'));
  assert.ok(res.text.indexOf('"' + kid + '"') !== -1, what + ': sellado con la clave nueva');
  assert.ok(res.text.indexOf('"' + oldKid + '"') === -1, what + ': nada queda con la clave anterior');
}
const encOf = (page) => page.evaluate(() => Workhub.app.models.projects.get(Workhub.app.projectId).enc);

/* Cuenta nueva verificada; se queda en el diálogo del primer proyecto. */
async function signUp(browser, name, email){
  const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
  if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.locator('#authSwitchLink').click();
  await page.locator('#authName').fill(name);
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill('contraseña-prueba-123');
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
  await verify(email);
  await page.getByRole('button', {name:'Ya lo he verificado'}).click();
  await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
  const uid = await page.evaluate(() => Workhub.app.rootDb.me.uid);
  return {context, page, errors, uid, email};
}

/* La propietaria invita y devuelve el código de acceso. */
async function invite(page, email, role){
  await page.evaluate(() => Workhub.app.controllers.team.open());
  await page.locator('#shInviteForm').waitFor({state:'visible'});
  /* Diagnóstico: desde dónde se vacía el formulario mientras se rellena. */
  await page.evaluate(() => {
    const v = Workhub.app.controllers.team.view;
    if(!v.__resets){
      const original = v._resetSecrets.bind(v);
      v._resetSecrets = function(){ v.__resets.push(String(new Error().stack).split('\n').slice(2, 6).join(' | ')); return original(); };
    }
    v.__resets = [];
  });
  await page.locator('#shEmail').fill(email);
  await page.locator('#shRole').selectOption(role);
  await page.locator('#shInvitePass').fill(PASSWORD);
  await page.locator('#shInviteBtn').click();
  await page.locator('#shCodePanel').waitFor({state:'visible', timeout:30000}).catch(async (error) => {
    /* Qué había en pantalla, para no tener que adivinarlo desde el registro de la CI. */
    console.error('Sin código de acceso:', JSON.stringify(await page.evaluate(() => {
      const p = Workhub.app.controllers.team.current();
      return {proyecto: p && {id: p.id, team: p.team, role: p.role, cifrado: Workhub.models.ProjectModel.isEncrypted(p)},
        dialogo: document.getElementById('dlgShare').innerText.replace(/\s+/g, ' ').slice(0, 700),
        avisos: Array.from(document.querySelectorAll('.toast')).map((t) => t.innerText), ocupado: document.getElementById('shInviteBtn').disabled,
        clave: document.getElementById('shInvitePass').value.length, vaciados: Workhub.app.controllers.team.view.__resets};
    })));
    throw error;
  });
  const code = (await page.locator('#shCode').textContent()).trim();
  await page.locator('#shCodeDone').click();
  await page.locator('#btnShareClose').click();
  return code;
}

/* El invitado acepta con el código y su contraseña, y entra en el equipo. */
async function join(guest, code){
  const page = guest.page;
  await page.locator('#pInvites [data-invite="accept"]').click({timeout:30000});
  await page.locator('#dlgJoin').waitFor({state:'visible'});
  await page.locator('#jnCode').fill(code);
  await page.locator('#jnPass').fill(GUEST_PASSWORD);
  await page.locator('#jnPass2').fill(GUEST_PASSWORD);
  await page.locator('#jnSubmit').click();
  await page.locator('#jnKeyPanel').waitFor({state:'visible', timeout:30000});
  const recovery = (await page.locator('#jnKey').textContent()).trim();
  await page.locator('#jnKeySaved').check();
  await page.locator('#jnSubmit').click();
  await page.locator('#dlgJoin').waitFor({state:'hidden', timeout:30000});
  await page.locator('.card').filter({hasText:'Tarea secreta'}).waitFor({timeout:30000});
  return recovery;
}

/* Diálogo «Cambiar la clave del proyecto», ya abierto: contraseña, clave de recuperación y a esperar. */
async function changeKey(page){
  await page.locator('#dlgEncKey').waitFor({state:'visible', timeout:30000});
  await page.locator('#ekTitle').getByText('Cambiar la clave del proyecto').waitFor();
  await page.locator('#ekCurrent').fill('una contraseña que no es');
  await page.locator('#ekSubmit').click();
  await page.locator('#ekError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
  await page.locator('#ekCurrent').fill(PASSWORD);
  await page.locator('#ekSubmit').click();
  await page.locator('#ekKeyPanel').waitFor({state:'visible', timeout:30000});
  const recovery = (await page.locator('#ekKey').textContent()).trim();
  assert.match(recovery, KEY_RE);
  assert.equal(await page.locator('#ekSubmit').isDisabled(), true, 'sin confirmar la clave de recuperación no se cambia nada');
  await page.setViewportSize({width:375, height:812});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'cambiar la clave sin desbordamiento en móvil');
  await page.setViewportSize({width:1280, height:850});
  await page.locator('#ekKeySaved').check();
  await page.locator('#ekSubmit').getByText('Cambiar la clave').click();
  await page.locator('#dlgEncKey').waitFor({state:'hidden', timeout:60000});
  return recovery;
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    /* ---------- la propietaria: proyecto personal con cifrado total ---------- */
    const owner = await signUp(browser, 'Ana Propietaria', 'ana-' + stamp + '@example.test');
    const page = owner.page;
    await page.locator('#pNombre').fill('Proyecto sin cifrar');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});

    const seed = await page.evaluate(async (password) => {
      const app = Workhub.app, PC = Workhub.services.projectCrypto;
      const uid = app.rootDb.me.uid;
      const raw = PC.newDekBytes(), pid = PC.newPid(), kid = PC.newKid();
      const ctx = {pid:pid, kid:kid, uid:uid};
      const key = await PC.importDek(raw);
      const kcv = await PC.kcv(key, pid, kid);
      const pw = await PC.wrapPassword(raw, password, ctx);
      const rk = await PC.wrapRecovery(raw, PC.newRecoveryKey().bytes, ctx);
      raw.fill(0);
      const ref = app.rootDb.collection('projects').doc();
      const now = Date.now();
      await ref.collection('crypto').doc(uid).set({v:1, kid:kid, kdf:pw.kdf, pw:pw.pw, rk:rk.rk, createdAt:now, updatedAt:now});
      await ref.set({nombre:'Proyecto reservado', createdAt:now, tipo:'kanban', enc:{v:1, mode:'pw', pid:pid, kid:kid, kcv:kcv, createdAt:now}});
      await Workhub.services.keystore.put({uid:uid, pid:pid, projectId:ref.id, kid:kid, key:key, trusted:false});
      return {id:ref.id, pid:pid, kid:kid};
    }, PASSWORD);
    await page.waitForFunction((id) => !!Workhub.app.models.projects.get(id), seed.id);
    await page.evaluate((id) => Workhub.app.switchProject(id), seed.id);
    await page.waitForFunction(() => !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true);
    const taskId = await page.evaluate(async () => {
      const m = Workhub.app.models;
      const ref = await m.tasks.add({title:'Tarea secreta', desc:'Descripción reservada', status:Workhub.models.TaskModel.STATUS[0].key, order:1, createdAt:Date.now(), updatedAt:Date.now()});
      const canvas = document.createElement('canvas');
      canvas.width = 40; canvas.height = 30;
      canvas.getContext('2d').fillRect(0, 0, 40, 30);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const assetId = await Workhub.services.platform.uploadAsset(new File([blob], 'nota.png', {type:'image/png'}));
      await m.tasks.addNote(ref.id, 'Nota confidencial', assetId);
      return ref.id;
    });
    await page.locator('.card').filter({hasText:'Tarea secreta'}).waitFor();

    /* ---------- proyecto personal: «Cambiar la clave del proyecto» desde «Editar proyecto» ---------- */
    const personal = 'users/' + owner.uid + '/projects/' + seed.id;
    await page.evaluate(() => Workhub.app.controllers.projects.openEdit());
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pRotate').waitFor({state:'visible'});
    await page.locator('#pRotate').click();
    assert.equal(await page.locator('#ekMembers').isVisible(), false, 'en un proyecto personal no hay lista de miembros');
    const personalRecovery = await changeKey(page);
    await page.locator('.toast').filter({hasText:'Clave de «Proyecto reservado» cambiada'}).waitFor({timeout:30000});
    await page.evaluate(() => { const d = document.getElementById('dlgProject'); if(d.open) d.close(); });
    const enc2 = await encOf(page);
    assert.equal(enc2.pid, seed.pid, 'el proyecto es el mismo');
    assert.notEqual(enc2.kid, seed.kid, 'la clave ha cambiado');
    assert.equal(enc2.rot, undefined, 'el cambio ha terminado');
    assertKid(await stored(personal + '/tasks'), enc2.kid, seed.kid, 'tareas');
    assertKid(await stored(personal + '/tasks/' + taskId + '/notes'), enc2.kid, seed.kid, 'notas');
    assertKid(await stored('users/' + owner.uid + '/assets'), enc2.kid, seed.kid, 'imágenes');
    const wrap2 = await stored(personal + '/crypto/' + owner.uid);
    assert.ok(wrap2.text.indexOf('"' + enc2.kid + '"') !== -1 && wrap2.text.indexOf('"old"') === -1, 'mi clave envuelta es de la clave nueva y ya no guarda la anterior');
    /* Se sigue leyendo, también tras recargar y tras bloquear y desbloquear con la misma contraseña. */
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.card').filter({hasText:'Tarea secreta'}).waitFor({timeout:30000});
    await page.locator('.card').filter({hasText:'Tarea secreta'}).click();
    await page.locator('.tv-note-text').filter({hasText:'Nota confidencial'}).waitFor();
    await page.waitForFunction(() => { const img = document.querySelector('.tv-note img'); return !!img && img.naturalWidth === 40; });
    await page.keyboard.press('Escape');
    /* La ficha se cierra con una animación y, mientras dura, sigue siendo un diálogo modal: el resto
       de la página no admite el foco y lo que se escribiera en la pantalla de bloqueo se perdería. */
    await page.locator('#dlgTaskView').waitFor({state:'hidden'});
    await page.evaluate(() => Workhub.app.controllers.crypto.lock());
    await page.locator('#projectLockScreen').waitFor({state:'visible'});
    await page.locator('#plPass').fill(PASSWORD);
    await page.locator('#plUnlock').click();
    await page.locator('.card').filter({hasText:'Tarea secreta'}).waitFor({timeout:30000});
    /* Las reglas no dejan volver a la clave anterior ni cambiarla sin apuntar la vigente. */
    const back = await page.evaluate(async (old) => {
      const app = Workhub.app, p = app.models.projects.get(app.projectId);
      const tryEnc = async (enc) => { try{ await app.models.projects.update(p.id, {enc:enc}); return 'aceptado'; }catch(e){ return e.code; } };
      return [await tryEnc(Object.assign({}, p.enc, {kid:old})), await tryEnc(Object.assign({}, p.enc, {kid:'AAAAAAAAAAA'}))];
    }, seed.kid);
    assert.deepEqual(back, ['permission-denied', 'permission-denied'], 'la clave solo cambia por el camino del cambio de clave');

    /* ---------- equipo: convertir, invitar a dos personas y que entren ---------- */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#dlgShare').waitFor({state:'visible'});
    await page.locator('#shConvertPass').fill(PASSWORD);
    await page.locator('#shConvert').click();
    await page.locator('#shKeyPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#shKeySaved').check();
    await page.locator('#shConvert').getByText('Crear el equipo').click();
    await page.waitForFunction(() => String(Workhub.app.projectId).indexOf('t:') === 0 && !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true, null, {timeout:60000});
    await page.locator('.card').filter({hasText:'Tarea secreta'}).waitFor();
    const tid = await page.evaluate(() => Workhub.models.ProjectModel.teamId(Workhub.app.projectId));
    const base = 'teams/' + tid;
    const team1 = await encOf(page);
    assert.equal((await storedWhen(base + '/pubkeys/' + owner.uid, (res) => res.status === 200)).status, 200, 'la propietaria publica su clave pública al abrir el equipo');
    await page.evaluate(() => { const d = document.getElementById('dlgShare'); if(d.open) d.close(); });

    const luisEmail = 'luis-' + stamp + '@example.test', martaEmail = 'marta-' + stamp + '@example.test';
    const luisCode = await invite(page, luisEmail, 'editor');
    const martaCode = await invite(page, martaEmail, 'viewer');
    const luis = await signUp(browser, 'Luis Editor', luisEmail);
    const luisRecovery = await join(luis, luisCode);
    const marta = await signUp(browser, 'Marta Lectora', martaEmail);
    await join(marta, martaCode);
    const lp = luis.page;
    const luisPub = await storedWhen(base + '/pubkeys/' + luis.uid, (res) => res.status === 200);
    assert.equal(luisPub.status, 200, 'cada miembro publica su clave pública');
    assert.ok(luisPub.text.indexOf('"d"') === -1 && luisPub.text.indexOf('priv') === -1, 'solo la parte pública');
    assert.equal((await storedWhen(base + '/pubkeys/' + marta.uid, (res) => res.status === 200)).status, 200);

    /* ---------- quitar a Marta: aviso para cambiar la clave ---------- */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shMembers .member-fp').first().waitFor({timeout:30000});
    assert.equal(await page.locator('#shMembers .member-fp').count(), 3, 'se ve la huella de la clave pública de cada miembro');
    assert.equal(await page.locator('#shRotateHint').isVisible(), false);
    const martaRow = page.locator('#shMembers .member-row').filter({hasText:'Marta Lectora'});
    await martaRow.locator('[data-act="remove"]').click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    await page.locator('#confirmText').getByText('Después conviene cambiar la clave del proyecto').waitFor();
    await page.locator('#btnConfirmOk').click();
    await page.locator('#shRotateHint').waitFor({state:'visible', timeout:30000});
    assert.equal((await storedWhen(base + '/crypto/' + marta.uid, (res) => res.status === 404)).status, 404, 'se borra su clave envuelta');
    assert.equal((await storedWhen(base + '/pubkeys/' + marta.uid, (res) => res.status === 404)).status, 404, 'y su clave pública');
    await marta.page.waitForFunction((key) => !Workhub.app.models.projects.exists(key), 't:' + tid, {timeout:30000});
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'aviso sin desbordamiento en móvil');
    await page.setViewportSize({width:1280, height:850});

    /* ---------- cambiar la clave del equipo desde el aviso ---------- */
    await page.locator('#shRotate').click();
    await page.locator('#dlgEncKey').waitFor({state:'visible', timeout:30000});
    assert.equal(await page.locator('#dlgShare').isVisible(), false, 'el diálogo de compartir se cierra');
    await page.locator('#ekMembers li').filter({hasText:'Luis Editor'}).getByText('Recibirá la clave nueva al escribir su contraseña').waitFor();
    assert.equal(await page.locator('#ekMembers li').count(), 1, 'Marta ya no está en la lista');
    const teamRecovery = await changeKey(page);
    assert.notEqual(teamRecovery, personalRecovery);
    await page.locator('.toast').filter({hasText:'Clave de «Proyecto reservado» cambiada'}).first().waitFor({timeout:30000});
    await page.waitForFunction(() => !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true, null, {timeout:30000});
    const team2 = await encOf(page);
    assert.deepEqual([team2.pid, team2.rot], [team1.pid, undefined]);
    assert.notEqual(team2.kid, team1.kid);
    assertKid(await stored(base + '/tasks'), team2.kid, team1.kid, 'tareas del equipo');
    assertKid(await stored(base + '/tasks/' + taskId + '/notes'), team2.kid, team1.kid, 'notas del equipo');
    assertKid(await stored(base + '/assets'), team2.kid, team1.kid, 'imágenes del equipo');
    const rekey = await stored(base + '/rekey/' + luis.uid);
    assert.ok(rekey.status === 200 && rekey.text.indexOf('"' + team2.kid + '"') !== -1 && rekey.text.indexOf('"epk"') !== -1, 'la clave nueva espera a Luis, envuelta con su clave pública');
    assert.equal((await stored(base + '/rekey/' + marta.uid)).status, 404, 'a quien se ha quitado no se le entrega nada');
    assert.equal((await stored(base + '/rekey/' + owner.uid)).status, 404);
    await page.locator('.card').filter({hasText:'Tarea secreta'}).waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false, 'la propietaria sigue dentro sin que se le pida nada');

    /* ---------- Luis: se le pide su contraseña, recibe la clave nueva y una clave de recuperación nueva ---------- */
    await lp.locator('#projectLockScreen').waitFor({state:'visible', timeout:30000});
    await lp.locator('#plDesc').getByText('La clave de «Proyecto reservado» ha cambiado.').waitFor({timeout:30000});
    /* La propietaria no lee la clave que dejó para Luis, ni Luis la de otro. */
    const readOther = await page.evaluate(async (uid) => {
      const app = Workhub.app;
      try{ await Workhub.models.ProjectModel.scope(app.rootDb, app.projectId).collection('rekey').doc(uid).get(); return 'leído'; }catch(e){ return e.code; }
    }, luis.uid);
    assert.equal(readOther, 'permission-denied', 'la clave entregada solo la lee su destinatario');
    await lp.locator('#plPass').fill('no es su contraseña');
    await lp.locator('#plUnlock').click();
    await lp.locator('#plError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    await lp.locator('#plPass').fill(GUEST_PASSWORD);
    await lp.locator('#plUnlock').click();
    await lp.locator('#plKeyCard').waitFor({state:'visible', timeout:30000});
    await lp.locator('#plKeyNote').getByText('El propietario ha cambiado la clave de este proyecto.').waitFor();
    const luisRecovery2 = (await lp.locator('#plKey').textContent()).trim();
    assert.match(luisRecovery2, KEY_RE);
    assert.notEqual(luisRecovery2, luisRecovery, 'clave de recuperación nueva para el miembro');
    assert.ok((await stored(base + '/crypto/' + luis.uid)).text.indexOf('"' + team1.kid + '"') !== -1, 'hasta confirmarla no se guarda nada');
    await lp.setViewportSize({width:320, height:640});
    assert.equal(await lp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'clave nueva del miembro sin desbordamiento en móvil');
    await lp.setViewportSize({width:1280, height:850});
    await lp.locator('#plKeySaved').check();
    await lp.locator('#plKeyContinue').click();
    await lp.locator('.card').filter({hasText:'Tarea secreta'}).waitFor({timeout:30000});
    const luisWrap = await storedWhen(base + '/crypto/' + luis.uid, (res) => res.text.indexOf('"' + team2.kid + '"') !== -1);
    assert.ok(luisWrap.text.indexOf('"' + team2.kid + '"') !== -1 && luisWrap.text.indexOf('"' + team1.kid + '"') === -1, 'la clave envuelta de Luis pasa a la clave nueva');
    assert.ok(luisWrap.text.indexOf('"pub"') !== -1 && luisWrap.text.indexOf('"priv"') !== -1, 'conserva su par de claves');
    await lp.locator('.card').filter({hasText:'Tarea secreta'}).click();
    await lp.locator('.tv-note-text').filter({hasText:'Nota confidencial'}).waitFor();
    await lp.waitForFunction(() => { const img = document.querySelector('.tv-note img'); return !!img && img.naturalWidth === 40; });
    await lp.keyboard.press('Escape');

    /* Luis escribe con la clave nueva y la propietaria lo ve; lo sellado con la anterior se rechaza. */
    await lp.evaluate(() => Workhub.app.models.tasks.add({title:'Tarea del miembro', status:Workhub.models.TaskModel.STATUS[0].key, order:2, createdAt:Date.now(), updatedAt:Date.now()}));
    await page.locator('.card').filter({hasText:'Tarea del miembro'}).waitFor({timeout:30000});
    assertKid(await stored(base + '/tasks'), team2.kid, team1.kid, 'tareas tras escribir el miembro');
    const stale = await lp.evaluate(async (oldKid) => {
      const app = Workhub.app;
      const col = Workhub.models.ProjectModel.scope(app.rootDb, app.projectId).collection('tasks');
      try{ await col.doc().set({status:'x', createdAt:1, e:'A'.repeat(60), ev:1, kid:oldKid}); return 'aceptado'; }catch(e){ return e.code; }
    }, team1.kid);
    assert.equal(stale, 'permission-denied', 'las reglas rechazan lo que se selle con la clave anterior');
    /* Un editor no puede cambiar la clave del equipo. */
    assert.equal(await lp.evaluate(() => Workhub.app.controllers.rotation.canRotate(Workhub.app.models.projects.get(Workhub.app.projectId))), false);
    const editorRotate = await lp.evaluate(async () => {
      const app = Workhub.app, p = app.models.projects.get(app.projectId);
      try{ await app.models.projects.update(p.id, {enc:Object.assign({}, p.enc, {kid:'BBBBBBBBBBB', rot:{kid:p.enc.kid, kcv:p.enc.kcv, at:1}})}); return 'aceptado'; }catch(e){ return e.code; }
    });
    assert.equal(editorRotate, 'permission-denied');

    assert.deepEqual(owner.errors, [], 'sin excepciones JavaScript (propietaria)');
    assert.deepEqual(luis.errors, [], 'sin excepciones JavaScript (miembro)');
    assert.deepEqual(marta.errors, [], 'sin excepciones JavaScript (persona quitada)');
    await marta.context.close();
    await luis.context.close();
    await owner.context.close();
    console.log('OK   Firebase emulado: cambio de clave (proyecto personal, equipo, entrega al miembro con su clave pública, reglas)');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
