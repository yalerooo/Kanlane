/* «Crear cuenta y llevarme mis datos»: un invitado crea una cuenta y sus proyectos pasan a ella,
   con Auth/Firestore emulados (y las reglas de verdad). */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58655;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
/* PNG de 1 × 1 para la imagen de una nota. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

async function newTask(page, title){
  await page.locator('#btnNew').click();
  await page.locator('#fTitle').fill(title);
  await page.locator('#btnSave').click();
  await page.locator('.card').filter({hasText:title}).waitFor();
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();

    /* Invitado: un proyecto con una tarea (y una nota con imagen) y un segundo proyecto. */
    await page.locator('#authGuestBtn').click();
    await page.locator('#authGuestName').fill('Lola Invitada');
    await page.locator('#authGuestForm button[type="submit"]').click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Trabajo de invitada');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await newTask(page, 'Tarea de invitada');
    await page.evaluate(async (b64) => {
      const app = Workhub.app;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const assetId = await Workhub.services.platform.uploadAsset(new Blob([bytes], {type:'image/png'}));
      const task = app.models.tasks.items[0];
      await app.models.tasks.addNote(task.id, 'Nota con captura', assetId);
      const ref = await app.models.projects.create('Segundo proyecto', 3, {});
      await app.rootDb.collection('projects').doc(ref.id).collection('tasks').add({title:'Tarea del segundo', status:'todo', order:1, createdAt:Date.now(), updatedAt:Date.now()});
    }, PIXEL);

    /* En Ajustes, junto a «Salir del modo invitado». */
    assert.equal(await page.locator('#btnGuestUpgradeSide').isVisible(), true, 'el acceso directo de la barra lateral');
    await page.locator('#tabSettings').click();
    await page.locator('#settingsNav [data-sec="setAccount"]').click();
    await page.locator('#btnGuestUpgrade').click();

    /* Pantalla de acceso, ya en «Crear cuenta», con el aviso y la vuelta atrás. */
    await page.locator('#authMigrate').waitFor({state:'visible', timeout:30000});
    await page.locator('#authTitle', {hasText:'Crea tu cuenta'}).waitFor({state:'visible'});
    await page.waitForFunction(() => document.getElementById('authName').value === 'Lola Invitada');
    await page.locator('#authMigrateCancel').click();
    await page.locator('.card').filter({hasText:'Tarea de invitada'}).waitFor({timeout:30000});
    assert.equal(await page.evaluate(() => localStorage.getItem('workhub_guest_migrate')), null, 'volver atrás no deja nada pendiente');
    assert.equal(await page.locator('#accountMail').textContent(), 'Invitado');

    /* Ahora sí: desde la barra lateral, y se crea la cuenta. */
    await page.locator('#btnGuestUpgradeSide').click();
    await page.locator('#authMigrate').waitFor({state:'visible', timeout:30000});
    const email = 'invitada-' + Date.now() + '@example.test';
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill('contraseña-prueba-123');
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();

    /* Dentro, con sus datos: sin asistente de primer proyecto y con el aviso. */
    await page.locator('.card').filter({hasText:'Tarea de invitada'}).waitFor({timeout:30000});
    await page.locator('.toast').filter({hasText:'Tus datos de invitado ya están en tu cuenta.'}).waitFor();
    assert.equal(await page.locator('#dlgProject').isVisible(), false, 'no pide crear el primer proyecto');
    assert.equal(await page.locator('#accountMail').textContent(), email);
    assert.equal(await page.locator('#btnGuestUpgradeSide').isVisible(), false);
    assert.ok(!/registro/.test(page.url()), '«?registro» sale de la dirección');
    const cloud = await page.evaluate(async () => {
      const app = Workhub.app;
      const projects = app.models.projects.list();
      const second = projects.find((p) => p.nombre === 'Segundo proyecto');
      const tasks = await app.rootDb.collection('projects').doc(second.id).collection('tasks').get();
      const task = app.models.tasks.items[0];
      const notes = await app.models.tasks.notes(task.id).get();
      const note = notes.docs[0].data();
      return {
        mode: Workhub.services.platform.mode(),
        names: projects.map((p) => p.nombre),
        current: app.controllers.projects.current().nombre,
        second: tasks.docs.map((d) => d.data().title),
        note: note.text,
        image: await window.__assetUrl(note.imageAssetId),
        pending: localStorage.getItem('workhub_guest_migrate'),
        guest: localStorage.getItem('workhub_guest'),
        local: (await window.__localStore.db.collection('projects').get()).size + (await window.__localStore.db.collection('tasks').get()).size
      };
    });
    assert.equal(cloud.mode, 'firebase');
    assert.deepEqual(cloud.names, ['Trabajo de invitada', 'Segundo proyecto'], 'los dos proyectos, y ningún «Proyecto principal» vacío');
    assert.equal(cloud.current, 'Trabajo de invitada', 'se abre el que tenía abierto');
    assert.deepEqual(cloud.second, ['Tarea del segundo']);
    assert.equal(cloud.note, 'Nota con captura');
    assert.ok(/^data:image\/jpeg/.test(cloud.image), 'la imagen de la nota está en la cuenta');
    assert.equal(cloud.pending, null);
    assert.equal(cloud.guest, null);
    assert.equal(cloud.local, 0, 'no queda copia en el navegador');

    /* Y siguen ahí al recargar: vienen de la cuenta. */
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.card').filter({hasText:'Tarea de invitada'}).waitFor({timeout:30000});
    assert.equal(await page.locator('.toast').filter({hasText:'Tus datos de invitado'}).count(), 0, 'el aviso no se repite');
    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: un invitado crea su cuenta y se lleva sus datos');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
