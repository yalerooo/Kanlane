/* Gestión de la cuenta desde Ajustes, con Auth/Firestore emulados y las reglas de verdad: cambiar
   el nombre y la foto, cambiar la contraseña y eliminar la cuenta con todo su contenido. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58661;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
/* PNG de 1 × 1 para la foto. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const OLD_PASS = 'contraseña-prueba-123';
const NEW_PASS = 'otra-contraseña-456';

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

/* Documentos de una colección, leídos como administrador (sin reglas): lo que queda de verdad. */
async function stored(collectionPath){
  const response = await fetch(storeUrl + collectionPath + '?pageSize=50', {headers:{Authorization:'Bearer owner'}});
  const data = await response.json();
  return (data.documents || []).map((d) => d.name.split('/documents/')[1]);
}

async function signIn(page, email, password){
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill(password);
  await page.locator('#authSubmit').click();
}

async function openAccount(page){
  await page.locator('#tabSettings').click();
  await page.locator('#settingsNav [data-sec="setAccount"]').click();
  await page.locator('#accountCard').waitFor({state:'visible'});
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
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.evaluate(() => { const b = document.querySelector('.consent [data-act="reject"]'); if(b) b.click(); });

    /* Alta, con un proyecto, una tarea con nota, otro proyecto y un equipo propio. */
    await page.locator('#authSwitchLink').click();
    const email = 'cuenta-' + Date.now() + '@example.test';
    await page.locator('#authName').fill('Nombre de alta');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill(OLD_PASS);
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Proyecto de la cuenta');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.locator('#btnNew').click();
    await page.locator('#fTitle').fill('Tarea que se borrará');
    await page.locator('#btnSave').click();
    await page.locator('.card').filter({hasText:'Tarea que se borrará'}).waitFor();
    const made = await page.evaluate(async () => {
      const app = Workhub.app;
      const task = app.models.tasks.items[0];
      await app.models.tasks.addNote(task.id, 'Una nota', '');
      const second = await app.models.projects.create('Segundo', 3, {});
      await app.rootDb.collection('projects').doc(second.id).collection('tasks').add({title:'Del segundo', status:'todo', order:1, createdAt:Date.now(), updatedAt:Date.now()});
      const team = await app.models.projects.createTeam('Equipo propio', 4, {});
      await app.rootDb.team(team.teamId).collection('tasks').add({title:'Del equipo', status:'todo', order:1, createdAt:Date.now(), updatedAt:Date.now()});
      return {uid:app.rootDb.me.uid, task:task.id, second:second.id, team:team.teamId};
    });
    const base = 'users/' + made.uid + '/';
    assert.equal((await stored(base + 'tasks')).length, 1, 'la tarea está guardada antes de empezar');
    assert.equal((await stored('teams')).some((name) => name === 'teams/' + made.team), true);

    /* ---------- Nombre ---------- */
    await openAccount(page);
    assert.equal(await page.locator('#accountNameInput').inputValue(), 'Nombre de alta');
    await page.locator('#accountNameInput').fill('Nombre Cambiado');
    await page.locator('#btnAccountName').click();
    await page.locator('#accountProfileMsg', {hasText:'Nombre guardado.'}).waitFor();
    assert.equal(await page.locator('#accountName').textContent(), 'Nombre Cambiado', 'la barra lateral lleva el nombre nuevo');
    assert.equal(await page.evaluate(() => Workhub.app.rootDb.me.name), 'Nombre Cambiado');
    const teamDoc = await (await fetch(storeUrl + 'teams/' + made.team, {headers:{Authorization:'Bearer owner'}})).json();
    assert.equal(teamDoc.fields.members.mapValue.fields[made.uid].mapValue.fields.name.stringValue, 'Nombre Cambiado', 'y su ficha en el equipo propio');

    /* ---------- Foto ---------- */
    assert.equal(await page.locator('#btnAccountPhotoRemove').isVisible(), false);
    await page.locator('#accountPhotoFile').setInputFiles({name:'foto.png', mimeType:'image/png', buffer:PIXEL});
    await page.locator('#accountProfileMsg', {hasText:'Foto guardada.'}).waitFor();
    assert.match(await page.locator('#accountPhoto img').getAttribute('src'), /^data:image\/jpeg;base64,/);
    assert.match(await page.locator('#accountAvatar img').getAttribute('src'), /^data:image\/jpeg;base64,/, 'también en la barra lateral');
    await page.locator('#accountPhotoFile').setInputFiles({name:'notas.txt', mimeType:'text/plain', buffer:Buffer.from('hola')});
    await page.locator('#accountProfileMsg.is-error', {hasText:'no es una imagen'}).waitFor();
    /* Sigue ahí al recargar: viene de la cuenta. */
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#accountAvatar img').waitFor({state:'visible', timeout:30000});
    assert.equal(await page.locator('#accountName').textContent(), 'Nombre Cambiado');
    await openAccount(page);
    await page.locator('#btnAccountPhotoRemove').click();
    await page.locator('#accountProfileMsg', {hasText:'Foto quitada.'}).waitFor();
    assert.equal(await page.locator('#accountPhoto img').count(), 0);
    assert.equal(await page.locator('#accountPhoto').textContent(), 'NC', 'sin foto, las iniciales');

    /* ---------- Contraseña ---------- */
    await page.locator('#btnAccountPassword').click();
    await page.locator('#dlgAccountPassword').waitFor({state:'visible'});
    await page.locator('#apCurrent').fill(OLD_PASS);
    await page.locator('#apNew').fill('corta');
    await page.locator('#apRepeat').fill('corta');
    await page.locator('#apSubmit').click();
    await page.locator('#apError', {hasText:'al menos 8 caracteres'}).waitFor();
    await page.locator('#apNew').fill(NEW_PASS);
    await page.locator('#apRepeat').fill(NEW_PASS + 'x');
    await page.locator('#apSubmit').click();
    await page.locator('#apError', {hasText:'no coinciden'}).waitFor();
    await page.locator('#apCurrent').fill('no-es-la-actual');
    await page.locator('#apRepeat').fill(NEW_PASS);
    await page.locator('#apSubmit').click();
    await page.locator('#apError', {hasText:'La contraseña actual no es correcta.'}).waitFor();
    await page.locator('#apCurrent').fill(OLD_PASS);
    await page.locator('#apSubmit').click();
    await page.locator('#dlgAccountPassword').waitFor({state:'hidden'});
    await page.locator('.toast').filter({hasText:'Contraseña cambiada'}).waitFor();
    /* Se entra con la nueva y ya no con la anterior. */
    await page.locator('#btnSignOut').click();
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#authPass').waitFor({state:'visible'});
    await signIn(page, email, OLD_PASS);
    await page.locator('#authPassErr').waitFor({state:'visible'});
    await signIn(page, email, NEW_PASS);
    await page.locator('.card').filter({hasText:'Tarea que se borrará'}).waitFor({state:'attached', timeout:30000});

    /* ---------- Eliminar la cuenta ---------- */
    await openAccount(page);
    await page.locator('#btnAccountDelete').click();
    await page.locator('#dlgAccountDelete').waitFor({state:'visible'});
    const summary = await page.locator('#adSummary').textContent();
    assert.ok(summary.includes(email) && summary.includes('Equipo propio') && summary.includes('(2)'), 'dice lo que se va a borrar: ' + summary);
    assert.equal(await page.locator('#adSubmit').isDisabled(), true, 'sin la palabra de confirmación no se puede');
    await page.locator('#adWord').fill('eliminar');
    assert.equal(await page.locator('#adSubmit').isDisabled(), false);
    /* Con la contraseña equivocada no se borra nada. */
    await page.locator('#adPass').fill('no-es-la-mía');
    await page.locator('#adSubmit').click();
    await page.locator('#adError', {hasText:'La contraseña no es correcta.'}).waitFor();
    assert.equal((await stored(base + 'tasks')).length, 1, 'con la contraseña equivocada no se borra nada');
    await page.locator('#adPass').fill(NEW_PASS);
    await page.locator('#adSubmit').click();
    /* Sin sesión: el acceso lo confirma y no ofrece el asistente de primer proyecto por el camino. */
    await page.locator('#authMsg', {hasText:'Tu cuenta y todo tu contenido se han eliminado.'}).waitFor({timeout:60000});
    const left = {};
    for(const col of ['tasks', 'tasks/' + made.task + '/notes', 'projects', 'projects/' + made.second + '/tasks', 'settings', 'clients', 'plugin_data', 'assets', 'backup_versions']){
      left[col] = await stored(base + col);
    }
    assert.deepEqual(Object.values(left).flat(), [], 'no queda nada de la cuenta en la base de datos');
    assert.equal((await stored('teams')).some((name) => name === 'teams/' + made.team), false, 'ni su equipo');
    assert.deepEqual(await stored('teams/' + made.team + '/tasks'), [], 'ni las tareas del equipo');
    /* La cuenta ya no existe. */
    await signIn(page, email, NEW_PASS);
    await page.locator('#authPassErr').waitFor({state:'visible'});
    const users = await (await fetch(authUrl + '/identitytoolkit.googleapis.com/v1/projects/demo-workhub/accounts:query', {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer owner'}, body:JSON.stringify({})
    })).json();
    assert.equal((users.userInfo || []).some((u) => u.email === email), false, 'la cuenta se ha eliminado de Authentication');
    assert.equal(await page.evaluate(() => localStorage.getItem('workhub_session')), null);
    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: nombre, foto, contraseña y eliminación de la cuenta');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
