/* Convertir un proyecto «Solo contraseñas» en uno con cifrado total contra Auth/Firestore emulados y
   las reglas reales (PR11 del plan, docs/CIFRADO-PROYECTOS.md 13.2). Una cuenta nueva crea su primer
   proyecto sin cifrar (el principal, con los datos en la raíz), le mete una tarea con nota e imagen
   y un cliente, y lo convierte desde «Editar proyecto → Privacidad». Se comprueba que en Firestore no
   queda nada en claro, que se sigue leyendo (también tras recargar y tras bloquear y desbloquear con
   la contraseña), que las reglas ya no admiten nada en claro y que el segundo proyecto, también en
   claro, sigue como estaba hasta que se convierte.
   Uso: npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub
        --config firebase.test.json "node tests/e2e/crypto-convert.js" */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58653;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

const PASSWORD = 'una contraseña de cifrado larga';
const SECRETS = ['Tarea que estaba en claro', 'Descripción reservada', 'Nota confidencial', 'Cliente Reservado', 'Tarea del segundo proyecto'];
const KEY_RE = /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/;
const stamp = Date.now();

async function ready(){
  for(let i = 0; i < 100; i++){
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
function assertSealed(res, what){
  assert.equal(res.status, 200, what + ': se puede leer');
  SECRETS.forEach((s) => assert.ok(res.text.indexOf(s) === -1, what + ': «' + s + '» no está en claro'));
  assert.ok(res.text.indexOf('"ev"') !== -1 && res.text.indexOf('"kid"') !== -1, what + ': documentos sellados');
}
function assertPlain(res, secret, what){
  assert.equal(res.status, 200, what + ': se puede leer');
  assert.ok(res.text.indexOf(secret) !== -1 && res.text.indexOf('"ev"') === -1, what + ': sigue en claro');
}

/* Diálogo «Convertir a cifrado total», ya abierto: contraseña, clave de recuperación y a esperar. */
async function convert(page){
  await page.locator('#dlgEncKey').waitFor({state:'visible', timeout:30000});
  await page.locator('#ekTitle').getByText('Convertir a cifrado total').waitFor();
  assert.equal(await page.locator('#ekCurrentWrap').isVisible(), false, 'no hay contraseña actual que pedir');
  await page.locator('#ekWarn').getByText('no borra lo que ya salió').waitFor();
  await page.locator('#ekNew').fill('corta');
  await page.locator('#ekNew2').fill('corta');
  await page.locator('#ekSubmit').click();
  await page.locator('#ekError').getByText('Demasiado corta: mínimo 12 caracteres.').waitFor();
  await page.locator('#ekNew').fill(PASSWORD);
  await page.locator('#ekNew2').fill(PASSWORD + 'x');
  await page.locator('#ekSubmit').click();
  await page.locator('#ekError').getByText('Las contraseñas no coinciden.').waitFor();
  await page.setViewportSize({width:320, height:640});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'convertir sin desbordamiento en móvil');
  await page.setViewportSize({width:1280, height:850});
  await page.locator('#ekNew2').fill(PASSWORD);
  await page.locator('#ekSubmit').click();
  await page.locator('#ekKeyPanel').waitFor({state:'visible', timeout:30000});
  const recovery = (await page.locator('#ekKey').textContent()).trim();
  assert.match(recovery, KEY_RE);
  assert.equal(await page.locator('#ekSubmit').isDisabled(), true, 'sin confirmar la clave de recuperación no se convierte nada');
  return recovery;
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const email = 'ana-' + stamp + '@example.test';
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#authSwitchLink').click();
    await page.locator('#authName').fill('Ana Conversión');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill('contraseña-prueba-123');
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    const uid = await page.evaluate(() => Workhub.app.rootDb.me.uid);
    const me = 'users/' + uid;

    /* ---------- primer proyecto (el principal), «Solo contraseñas», con datos en claro ---------- */
    await page.locator('#pNombre').fill('Proyecto de siempre');
    await page.locator('#pTypes [data-type="soporte"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#pStep2').getByText('Más adelante solo se podrá pasar de «Solo contraseñas» a «Cifrado total».').waitFor();
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.waitForFunction(() => Workhub.app.models.tasks.isReady());
    const taskId = await page.evaluate(async () => {
      const m = Workhub.app.models;
      await m.clients.create('Cliente Reservado');
      const ref = await m.tasks.add({title:'Tarea que estaba en claro', desc:'Descripción reservada', cliente:'Cliente Reservado', status:Workhub.models.TaskModel.STATUS[0].key, order:1, createdAt:Date.now(), updatedAt:Date.now()});
      const canvas = document.createElement('canvas');
      canvas.width = 40; canvas.height = 30;
      canvas.getContext('2d').fillRect(0, 0, 40, 30);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const assetId = await Workhub.services.platform.uploadAsset(new File([blob], 'nota.png', {type:'image/png'}));
      await m.tasks.addNote(ref.id, 'Nota confidencial', assetId);
      return ref.id;
    });
    await page.locator('.card').filter({hasText:'Tarea que estaba en claro'}).waitFor();
    assertPlain(await stored(me + '/tasks'), 'Tarea que estaba en claro', 'tareas antes de convertir');
    assertPlain(await stored(me + '/assets'), 'data:image/jpeg', 'imagen antes de convertir');

    /* Un segundo proyecto, también en claro. */
    const second = await page.evaluate(async () => {
      const app = Workhub.app;
      const ref = await app.controllers.projects.createAndOpen('Segundo proyecto', null, {tipo:'kanban'});
      return ref.id;
    });
    await page.waitForFunction((id) => Workhub.app.projectId === id && Workhub.app.models.tasks.isReady(), second);
    await page.evaluate(() => Workhub.app.models.tasks.add({title:'Tarea del segundo proyecto', status:Workhub.models.TaskModel.STATUS[0].key, order:1, createdAt:Date.now(), updatedAt:Date.now()}));
    await page.locator('.card').filter({hasText:'Tarea del segundo proyecto'}).waitFor();
    await page.evaluate(() => Workhub.app.switchProject('main'));
    await page.locator('.card').filter({hasText:'Tarea que estaba en claro'}).waitFor();

    /* ---------- «Editar proyecto → Privacidad → Convertir a cifrado total» ---------- */
    await page.evaluate(() => Workhub.app.controllers.projects.openEdit());
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pPrivacyText').getByText('Solo contraseñas.').waitFor();
    await page.locator('#pConvert').waitFor({state:'visible'});
    assert.equal(await page.locator('#pRotate').isVisible(), false, 'sin cifrado no hay clave que cambiar');
    assert.equal(await page.locator('#pPrivacyActions [data-privacy-act="password"]').isVisible(), false);
    await page.locator('#pConvert').click();
    const recovery = await convert(page);
    assert.ok((await stored(me + '/projects/main')).text.indexOf('"enc"') === -1, 'hasta confirmar la clave no cambia nada');
    assert.equal((await stored(me + '/crypto/' + uid)).status, 404);
    await page.locator('#ekKeySaved').check();
    await page.locator('#ekSubmit').getByText('Convertir el proyecto').click();
    await page.locator('#dlgEncKey').waitFor({state:'hidden', timeout:60000});
    await page.locator('.toast').filter({hasText:'«Proyecto de siempre» ya tiene cifrado total'}).waitFor({timeout:30000});
    await page.evaluate(() => { const d = document.getElementById('dlgProject'); if(d.open) d.close(); });

    /* ---------- en Firestore no queda nada en claro ---------- */
    const proj = await stored(me + '/projects/main');
    assert.ok(proj.text.indexOf('"enc"') !== -1 && proj.text.indexOf('"conv"') === -1, 'el proyecto tiene cifrado y la conversión ha terminado');
    assert.ok(proj.text.indexOf('Proyecto de siempre') !== -1, 'el nombre del proyecto sigue en claro (se dice en el aviso)');
    assertSealed(await stored(me + '/tasks'), 'tareas');
    assertSealed(await stored(me + '/tasks/' + taskId + '/notes'), 'notas');
    assertSealed(await stored(me + '/clients'), 'clientes');
    const assets = await stored(me + '/assets');
    assertSealed(assets, 'imágenes');
    assert.ok(assets.text.indexOf('data:image') === -1, 'la imagen ya no lleva la data: URL en claro');
    const wrap = await stored(me + '/crypto/' + uid);
    assert.ok(wrap.status === 200 && wrap.text.indexOf('"pw"') !== -1 && wrap.text.indexOf('"rk"') !== -1, 'la clave envuelta con la contraseña y con la clave de recuperación');
    assert.ok([proj.text, wrap.text].every((t) => t.indexOf(PASSWORD) === -1 && t.indexOf(recovery) === -1 && t.indexOf(recovery.replace(/-/g, '')) === -1), 'ni la contraseña ni la clave de recuperación llegan a Firestore');
    /* El segundo proyecto sigue como estaba. */
    assertPlain(await stored(me + '/projects/' + second + '/tasks'), 'Tarea del segundo proyecto', 'tareas del segundo proyecto');

    /* ---------- se sigue leyendo: ahora, tras recargar y tras bloquear y desbloquear ---------- */
    await page.locator('.card').filter({hasText:'Tarea que estaba en claro'}).waitFor({timeout:30000});
    assert.equal(await page.evaluate(() => !!Workhub.app.cipher), true, 'el proyecto está abierto con su cifrador');
    await page.locator('.card').filter({hasText:'Tarea que estaba en claro'}).click();
    await page.locator('.tv-note-text').filter({hasText:'Nota confidencial'}).waitFor();
    await page.waitForFunction(() => { const img = document.querySelector('.tv-note img'); return !!img && img.naturalWidth === 40; });
    await page.keyboard.press('Escape');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.card').filter({hasText:'Tarea que estaba en claro'}).waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false, 'tras recargar no se pide la contraseña');
    await page.evaluate(() => Workhub.app.controllers.crypto.lock());
    await page.locator('#projectLockScreen').waitFor({state:'visible'});
    await page.locator('#plPass').fill('no es la contraseña');
    await page.locator('#plUnlock').click();
    await page.locator('#plError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    await page.locator('#plPass').fill(PASSWORD);
    await page.locator('#plUnlock').click();
    await page.locator('.card').filter({hasText:'Tarea que estaba en claro'}).waitFor({timeout:30000});

    /* ---------- lo nuevo va sellado y las reglas no admiten nada en claro ---------- */
    await page.evaluate(() => Workhub.app.models.tasks.add({title:'Tarea que estaba en claro, la segunda', status:Workhub.models.TaskModel.STATUS[0].key, order:2, createdAt:Date.now(), updatedAt:Date.now()}));
    await page.locator('.card').filter({hasText:'la segunda'}).waitFor({timeout:30000});
    assertSealed(await stored(me + '/tasks'), 'tareas tras añadir otra');
    const plain = await page.evaluate(async () => {
      const db = Workhub.app.rootDb;
      const attempt = async (fn) => { try{ await fn(); return 'aceptado'; }catch(e){ return e.code; } };
      return [
        await attempt(() => db.collection('tasks').doc().set({title:'en claro', status:'x', createdAt:1})),
        await attempt(() => db.collection('clients').doc().set({nombre:'en claro', createdAt:1})),
        await attempt(() => db.collection('projects').doc('main').update({enc:null})),
        await attempt(() => db.collection('projects').doc('main').update({github:{login:'x', number:1}}))
      ];
    });
    assert.deepEqual(plain, ['permission-denied', 'permission-denied', 'permission-denied', 'permission-denied'], 'ni datos en claro, ni quitar el cifrado, ni enlazar con GitHub');

    /* ---------- «Editar proyecto» ya lo trata como cifrado total ---------- */
    await page.evaluate(() => Workhub.app.controllers.projects.openEdit());
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pPrivacyText').getByText('Cifrado total.').waitFor();
    assert.equal(await page.locator('#pConvert').isVisible(), false, 'ya no se ofrece convertir');
    assert.equal(await page.locator('#pRotate').isVisible(), true, 'y sí cambiar la clave');
    assert.equal(await page.locator('#pPrivacyActions [data-privacy-act="password"]').isVisible(), true);
    await page.evaluate(() => { const d = document.getElementById('dlgProject'); if(d.open) d.close(); });

    /* ---------- el segundo proyecto (no es el principal) también se convierte ---------- */
    await page.evaluate((id) => Workhub.app.switchProject(id), second);
    await page.locator('.card').filter({hasText:'Tarea del segundo proyecto'}).waitFor({timeout:30000});
    await page.evaluate(() => Workhub.app.controllers.projects.openEdit());
    await page.locator('#pConvert').waitFor({state:'visible'});
    await page.locator('#pConvert').click();
    const recovery2 = await convert(page);
    assert.notEqual(recovery2, recovery, 'cada proyecto tiene su clave de recuperación');
    await page.locator('#ekKeySaved').check();
    await page.locator('#ekSubmit').click();
    await page.locator('#dlgEncKey').waitFor({state:'hidden', timeout:60000});
    await page.evaluate(() => { const d = document.getElementById('dlgProject'); if(d.open) d.close(); });
    assertSealed(await stored(me + '/projects/' + second + '/tasks'), 'tareas del segundo proyecto');
    assert.equal((await stored(me + '/projects/' + second + '/crypto/' + uid)).status, 200);
    await page.locator('.card').filter({hasText:'Tarea del segundo proyecto'}).waitFor({timeout:30000});

    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: convertir a cifrado total (proyecto principal y otro proyecto, reglas, recarga y desbloqueo)');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
