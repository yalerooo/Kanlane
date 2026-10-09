/* Compartir un proyecto con cifrado total contra Auth/Firestore emulados y las reglas reales (PR7 del
   plan, docs/CIFRADO-PROYECTOS.md 10 y 14.4 punto 7). Dos cuentas en dos contextos del navegador:
   la propietaria convierte un proyecto cifrado en equipo e invita con un código de acceso; el
   invitado acepta con el código y su propia contraseña, lee lo cifrado, no puede escribir como lector,
   ve los cambios que la propietaria hace en transacción y pierde el acceso al ser expulsado. Además:
   código erróneo, código caducado (clave envuelta con fecha antigua) y que en Firestore no hay nada
   en claro. El emulador no aplica el límite de 20 accesos por lote: eso se prueba a mano en producción.
   Uso: npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub
        --config firebase.test.json "node tests/e2e/crypto-team.js" */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58641;
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
const SECRETS = ['Tarea secreta', 'Descripción reservada', 'Nota confidencial', 'Título desde la propietaria'];
const CODE_RE = /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/;
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
const hasSeal = (res) => res.status === 200 && res.text.indexOf('"ev"') !== -1;
function assertSealed(res, what){
  assert.equal(res.status, 200, what + ': se puede leer');
  SECRETS.forEach((s) => assert.ok(res.text.indexOf(s) === -1, what + ': «' + s + '» no está en claro'));
  assert.ok(res.text.indexOf('"ev"') !== -1 && res.text.indexOf('"kid"') !== -1, what + ': documentos sellados');
}

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

/* Acepta la invitación del primer arranque hasta el paso de la clave de recuperación. */
async function openInvite(guest, code, password){
  const page = guest.page;
  await page.locator('#pInvites [data-invite="accept"]').click();
  await page.locator('#dlgJoin').waitFor({state:'visible'});
  await page.locator('#jnCode').fill(code);
  await page.locator('#jnPass').fill(password);
  await page.locator('#jnPass2').fill(password);
  await page.locator('#jnSubmit').click();
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    /* ---------- la propietaria: proyecto con cifrado total ---------- */
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
      await Workhub.services.keystore.put({uid:uid, pid:pid, projectId:ref.id, kid:kid, key:key, trusted:true});
      return {id:ref.id, pid:pid};
    }, PASSWORD);
    await page.waitForFunction((id) => !!Workhub.app.models.projects.get(id), seed.id);
    await page.evaluate((id) => Workhub.app.switchProject(id), seed.id);
    await page.waitForFunction(() => !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true);
    const taskId = await page.evaluate(async () => {
      const m = Workhub.app.models;
      const ref = await m.tasks.add({title:'Tarea secreta del equipo', desc:'Descripción reservada', status:Workhub.models.TaskModel.STATUS[0].key, order:1, createdAt:Date.now(), updatedAt:Date.now()});
      const canvas = document.createElement('canvas');
      canvas.width = 40; canvas.height = 30;
      canvas.getContext('2d').fillRect(0, 0, 40, 30);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const assetId = await Workhub.services.platform.uploadAsset(new File([blob], 'nota.png', {type:'image/png'}));
      await m.tasks.addNote(ref.id, 'Nota confidencial', assetId);
      return ref.id;
    });
    await page.locator('.card').filter({hasText:'Tarea secreta del equipo'}).waitFor();

    /* ---------- convertir en equipo: contraseña del proyecto y clave de recuperación del equipo ---------- */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#dlgShare').waitFor({state:'visible'});
    assert.equal(await page.locator('#shEncNote').isVisible(), true, 'explica el código de acceso');
    assert.equal(await page.locator('#shConvertPassWrap').isVisible(), true);
    await page.locator('#shConvert').click();
    await page.locator('#shError').getByText('Escribe la contraseña de cifrado del proyecto.').waitFor();
    await page.locator('#shConvertPass').fill('una contraseña que no es');
    await page.locator('#shConvert').click();
    await page.locator('#shError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    assert.equal(await page.locator('#shKeyPanel').isVisible(), false);
    await page.locator('#shConvertPass').fill(PASSWORD);
    await page.locator('#shConvert').click();
    await page.locator('#shKeyPanel').waitFor({state:'visible', timeout:30000});
    const teamRecovery = (await page.locator('#shKey').textContent()).trim();
    assert.match(teamRecovery, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    assert.equal(await page.locator('#shConvert').isDisabled(), true, 'sin confirmar la clave no se crea el equipo');
    assert.equal(await page.evaluate(() => Workhub.app.models.projects.list().filter((p) => p.team).length), 0, 'todavía no se ha creado nada');
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'clave del equipo sin desbordamiento en móvil');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#shKeySaved').check();
    await page.locator('#shConvert').getByText('Crear el equipo').click();
    await page.waitForFunction(() => String(Workhub.app.projectId).indexOf('t:') === 0 && !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true, null, {timeout:60000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false, 'el equipo se abre sin pedir la contraseña');
    await page.locator('.card').filter({hasText:'Tarea secreta del equipo'}).waitFor();
    const tid = await page.evaluate(() => Workhub.models.ProjectModel.teamId(Workhub.app.projectId));
    const base = 'teams/' + tid;
    const teamDoc = await stored(base);
    assert.equal(teamDoc.status, 200);
    assert.ok(teamDoc.text.indexOf('"enc"') !== -1 && teamDoc.text.indexOf(seed.pid) === -1, 'el equipo tiene cifrado y un pid distinto del original');
    assertSealed(await storedWhen(base + '/tasks', hasSeal), 'tareas del equipo');
    assertSealed(await storedWhen(base + '/tasks/' + taskId + '/notes', hasSeal), 'notas del equipo');
    const assets = await storedWhen(base + '/assets', hasSeal);
    assertSealed(assets, 'imágenes del equipo');
    assert.ok(assets.text.indexOf('"data"') === -1, 'la imagen del equipo no lleva la data: URL en claro');
    const ownerWrap = await stored(base + '/crypto/' + owner.uid);
    assert.ok(ownerWrap.status === 200 && ownerWrap.text.indexOf('"pub"') !== -1 && ownerWrap.text.indexOf('"priv"') !== -1, 'clave envuelta de la propietaria con su par de claves');
    /* La nota y su imagen se leen con la clave del equipo. */
    await page.locator('#btnShareClose').click().catch(() => {});
    await page.evaluate(() => { const d = document.getElementById('dlgShare'); if(d.open) d.close(); });
    await page.locator('.card').filter({hasText:'Tarea secreta del equipo'}).click();
    await page.locator('.tv-note-text').filter({hasText:'Nota confidencial'}).waitFor();
    await page.waitForFunction(() => { const img = document.querySelector('.tv-note img'); return !!img && img.naturalWidth === 40; });
    await page.keyboard.press('Escape');

    /* ---------- invitar: contraseña de la propietaria y código de acceso, una sola vez ---------- */
    const guestEmail = 'luis-' + stamp + '@example.test';
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shInviteForm').waitFor({state:'visible'});
    assert.equal(await page.locator('#shInvitePassWrap').isVisible(), true);
    await page.locator('#shEmail').fill(guestEmail);
    await page.locator('#shRole').selectOption('viewer');
    await page.locator('#shInviteBtn').click();
    await page.locator('#shError').getByText('Escribe tu contraseña de cifrado.').waitFor();
    await page.locator('#shInvitePass').fill('una contraseña que no es');
    await page.locator('#shInviteBtn').click();
    await page.locator('#shError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    assert.equal((await stored('invites/' + tid + '_' + guestEmail)).status, 404, 'sin la contraseña no se crea la invitación');
    await page.locator('#shInvitePass').fill(PASSWORD);
    await page.locator('#shInviteBtn').click();
    await page.locator('#shCodePanel').waitFor({state:'visible', timeout:30000});
    const code = (await page.locator('#shCode').textContent()).trim();
    assert.match(code, CODE_RE, 'código de 20 caracteres');
    await page.locator('#shTitle').getByText('Código de acceso para ' + guestEmail).waitFor();
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'código sin desbordamiento en móvil');
    await page.setViewportSize({width:1280, height:850});
    const inviteDoc = await storedWhen('invites/' + tid + '_' + guestEmail, (res) => res.status === 200);
    const wrapDoc = await storedWhen('invites/' + tid + '_' + guestEmail + '/key/wrap', (res) => res.status === 200);
    assert.equal(wrapDoc.status, 200, 'la clave envuelta con el código está en la invitación');
    [inviteDoc.text, wrapDoc.text].forEach((text) => assert.ok(text.indexOf(code) === -1 && text.indexOf(code.replace(/-/g, '')) === -1, 'el código no se guarda en Firestore'));
    await page.locator('#shCodeDone').click();
    await page.locator('#shPending .enc-badge').getByText('Cifrado').waitFor();
    assert.equal(await page.locator('#shCode').textContent(), '', 'el código no se vuelve a mostrar');
    await page.locator('#btnShareClose').click();

    /* ---------- el invitado: código erróneo, código bueno, contraseña y clave propias ---------- */
    const guest = await signUp(browser, 'Luis Invitado', guestEmail);
    const gp = guest.page;
    await gp.locator('#pInvites .enc-badge').getByText('Cifrado').waitFor({timeout:30000});
    const wrong = code.slice(0, -1) + (code.slice(-1) === '0' ? '1' : '0');
    await openInvite(guest, wrong, GUEST_PASSWORD);
    await gp.locator('#jnError').getByText('El código no es correcto.').waitFor({timeout:30000});
    assert.equal(await gp.locator('#jnKeyPanel').isVisible(), false);
    await gp.locator('#jnTitle').getByText('Unirte a «Proyecto reservado»').waitFor();
    await gp.locator('#jnLead').getByText('Escribe el código de acceso que te ha dado Ana Propietaria').waitFor();
    await gp.setViewportSize({width:320, height:640});
    assert.equal(await gp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'unirse sin desbordamiento en móvil');
    await gp.setViewportSize({width:1280, height:850});
    await gp.locator('#jnCode').fill(code.toLowerCase());
    await gp.locator('#jnSubmit').click();
    await gp.locator('#jnKeyPanel').waitFor({state:'visible', timeout:30000});
    const guestRecovery = (await gp.locator('#jnKey').textContent()).trim();
    assert.match(guestRecovery, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    assert.notEqual(guestRecovery, teamRecovery, 'cada persona tiene su propia clave de recuperación');
    assert.equal(await gp.locator('#jnSubmit').isDisabled(), true);
    assert.equal((await stored(base + '/crypto/' + guest.uid)).status, 404, 'hasta confirmar la clave no se guarda nada');
    await gp.locator('#jnKeySaved').check();
    await gp.locator('#jnSubmit').getByText('Unirme al equipo').click();
    await gp.locator('#dlgJoin').waitFor({state:'hidden', timeout:30000});
    await gp.locator('.card').filter({hasText:'Tarea secreta del equipo'}).waitFor({timeout:30000});
    assert.equal(await gp.locator('#projectLockScreen').isVisible(), false, 'el invitado entra sin que se le pida nada más');
    assert.equal((await storedWhen('invites/' + tid + '_' + guestEmail, (res) => res.status === 404)).status, 404, 'la invitación se borra al aceptar');
    assert.equal((await storedWhen('invites/' + tid + '_' + guestEmail + '/key/wrap', (res) => res.status === 404)).status, 404, 'el código es de un solo uso');
    const guestWrap = await stored(base + '/crypto/' + guest.uid);
    assert.ok(guestWrap.status === 200 && guestWrap.text.indexOf('"pub"') !== -1, 'clave envuelta del invitado con su par de claves');
    await gp.locator('.card').filter({hasText:'Tarea secreta del equipo'}).click();
    await gp.locator('.tv-note-text').filter({hasText:'Nota confidencial'}).waitFor();
    await gp.keyboard.press('Escape');

    /* ---------- lector: lee, pero las reglas no le dejan escribir ---------- */
    const denied = await gp.evaluate(async (id) => {
      try{ await Workhub.app.models.tasks.update(id, {title:'Cambio del lector'}); return 'aceptado'; }
      catch(e){ return e.code; }
    }, taskId);
    assert.equal(denied, 'permission-denied', 'un lector no escribe en el equipo cifrado');

    /* ---------- la propietaria cambia un campo secreto: transacción real y el invitado lo ve ---------- */
    const changed = await page.evaluate(async (id) => {
      const app = Workhub.app, m = app.models.tasks;
      let runs = 0;
      const real = app.cipher.transaction;
      app.cipher.transaction = (fn) => { runs++; return real(fn); };
      await m.update(id, {title:'Título desde la propietaria'});
      app.cipher.transaction = real;
      return {runs:runs, isTeamTx:typeof real === 'function'};
    }, taskId);
    assert.deepEqual(changed, {runs:1, isTeamTx:true}, 'en un equipo cifrado el cambio va en transacción');
    await gp.locator('.card').filter({hasText:'Título desde la propietaria'}).waitFor({timeout:30000});
    assertSealed(await storedWhen(base + '/tasks', hasSeal), 'tareas tras el cambio en transacción');

    /* El invitado recarga: la clave sigue en su navegador. Sin ella, su propia contraseña la abre. */
    await gp.reload({waitUntil:'domcontentloaded'});
    await gp.locator('.card').filter({hasText:'Título desde la propietaria'}).waitFor({timeout:30000});
    await gp.evaluate(() => Workhub.app.controllers.crypto.lock());
    await gp.locator('#projectLockScreen').waitFor({state:'visible'});
    await gp.locator('#plPass').fill(PASSWORD);
    await gp.locator('#plUnlock').click();
    await gp.locator('#plError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    await gp.locator('#plPass').fill(GUEST_PASSWORD);
    await gp.locator('#plUnlock').click();
    await gp.locator('.card').filter({hasText:'Título desde la propietaria'}).waitFor({timeout:30000});

    /* ---------- código caducado: la clave envuelta lleva más de 24 h ---------- */
    const lateEmail = 'marta-' + stamp + '@example.test';
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shInviteForm').waitFor({state:'visible'});
    await page.locator('#shEmail').fill(lateEmail);
    await page.locator('#shInvitePass').fill(PASSWORD);
    await page.locator('#shInviteBtn').click();
    await page.locator('#shCodePanel').waitFor({state:'visible', timeout:30000});
    const lateCode = (await page.locator('#shCode').textContent()).trim();
    await page.locator('#shCodeDone').click();
    await page.locator('#btnShareClose').click();
    const latePath = 'invites/' + tid + '_' + lateEmail + '/key/wrap';
    await storedWhen(latePath, (res) => res.status === 200);
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const patched = await fetch(storeUrl + latePath + '?updateMask.fieldPaths=createdAt', {
      method:'PATCH', headers:{Authorization:'Bearer owner', 'Content-Type':'application/json'},
      body:JSON.stringify({fields:{createdAt:{timestampValue:old}}})
    });
    assert.equal(patched.status, 200, 'la fecha de la clave envuelta se retrasa como administrador');
    const late = await signUp(browser, 'Marta Tarde', lateEmail);
    await late.page.locator('#pInvites .enc-badge').waitFor({timeout:30000});
    await openInvite(late, lateCode, GUEST_PASSWORD);
    await late.page.locator('#jnError').getByText('El código ha caducado. Pide a Ana Propietaria que te invite de nuevo.').waitFor({timeout:30000});
    assert.equal(await late.page.locator('#jnKeyPanel').isVisible(), false);
    assert.equal((await stored(base + '/crypto/' + late.uid)).status, 404);
    assert.deepEqual(late.errors, [], 'sin excepciones JavaScript (cuenta con el código caducado)');
    await late.context.close();

    /* ---------- expulsar: aviso propio de los equipos cifrados y se borra su clave envuelta ---------- */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shMembers [data-act="remove"]').waitFor({state:'visible'});
    await page.locator('#shMembers [data-act="remove"]').click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    await page.locator('#confirmText').getByText('Luis Invitado dejará de poder abrir el proyecto, pero lo que ya haya visto o descargado no se le puede quitar.').waitFor();
    await page.locator('#btnConfirmOk').click();
    assert.equal((await storedWhen(base + '/crypto/' + guest.uid, (res) => res.status === 404)).status, 404, 'al expulsar se borra la clave envuelta del miembro');
    assert.equal((await stored(base + '/crypto/' + owner.uid)).status, 200);
    await gp.waitForFunction((key) => !Workhub.app.models.projects.exists(key), 't:' + tid, {timeout:30000});
    await page.locator('#btnShareClose').click();

    /* ---------- eliminar el equipo: se van las invitaciones pendientes y sus claves envueltas ---------- */
    await page.evaluate((key) => Workhub.app.deleteProject(key), 't:' + tid);
    assert.equal((await storedWhen(base, (res) => res.status === 404)).status, 404);
    assert.equal((await storedWhen(latePath, (res) => res.status === 404)).status, 404, 'la clave envuelta de la invitación pendiente se borra con el equipo');
    assert.equal((await storedWhen(base + '/crypto/' + owner.uid, (res) => res.status === 404)).status, 404);

    assert.deepEqual(owner.errors, [], 'sin excepciones JavaScript (propietaria)');
    assert.deepEqual(guest.errors, [], 'sin excepciones JavaScript (invitado)');
    await guest.context.close();
    await owner.context.close();
    console.log('OK   Firebase emulado: equipo con cifrado total (convertir, invitar con código, aceptar, lector, transacción, código caducado, expulsar)');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
