/* Alta de cuenta, verificación y cofre con Auth/Firestore emulados. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58638;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

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
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    /* El idioma cambia en vivo, sin recargar la página, y al volver queda como estaba. Después
       de eso la app se recarga una vez al entrar (lo comprueba el resto de la prueba). */
    await page.evaluate(() => { window.__samePage = true; });
    await page.locator('#authLang [data-lang-choice="en"]').click();
    await page.locator('#authTitle', {hasText:'Sign in'}).waitFor({state:'visible'});
    assert.equal(await page.locator('#authEmail').getAttribute('placeholder'), 'Email');
    await page.locator('#authLang [data-lang-choice="es"]').click();
    await page.locator('#authTitle', {hasText:'Inicia sesión'}).waitFor({state:'visible'});
    assert.equal(await page.locator('#authEmail').getAttribute('placeholder'), 'Correo electrónico');
    assert.equal(await page.evaluate(() => window.__samePage), true, 'cambiar de idioma no recarga la página');
    /* Un correo mal escrito se avisa en su campo, sin llegar al servidor. */
    await page.locator('#authEmail').fill('no-es-un-correo');
    await page.locator('#authSubmit').click();
    await page.locator('#authEmailErr').waitFor({state:'visible'});
    assert.equal(await page.locator('#authEmail').getAttribute('aria-invalid'), 'true');
    /* Pedir el enlace de la contraseña lleva al paso «Revisa tu correo», aunque no haya cuenta. */
    await page.locator('#authForgot').click();
    await page.locator('#authEmail').fill('nadie-' + Date.now() + '@example.test');
    await page.locator('#authSubmit').click();
    await page.locator('#authSent').waitFor({state:'visible'});
    assert.equal(await page.locator('#authEmailForm').isVisible(), false);
    assert.equal(await page.locator('#authSentResend').isDisabled(), true, 'reenviar descansa unos segundos');
    await page.locator('#authSentBack').click();
    await page.locator('#authPass').waitFor({state:'visible'});
    await page.locator('#authSwitchLink').click();
    /* Al crear la cuenta, el medidor acompaña a la contraseña. */
    await page.locator('#authPass').fill('corta');
    assert.equal(await page.locator('#authMeter').getAttribute('data-level'), 'short');
    const email ='test-' + Date.now() + '@example.test';
    await page.locator('#authName').fill('Persona de prueba');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill('contraseña-prueba-123');
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Proyecto en Firebase');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    /* Paso de privacidad del asistente: «Solo contraseñas» viene elegido. */
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});

    await page.locator('#tabVault').click();
    await page.locator('#masterPass2Wrap').waitFor({state:'visible'});
    await page.locator('#masterPass').fill('maestra-prueba-123');
    await page.locator('#masterPass2').fill('maestra-prueba-123');
    await page.locator('#btnUnlock').click();
    await page.locator('#recoveryReveal').waitFor({state:'visible'});
    await page.locator('#recoveryConfirmChk').check();
    await page.locator('#btnRecoveryContinue').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});
    await page.locator('#btnLock').click();
    await page.locator('#masterPass').fill('maestra-prueba-123');
    await page.locator('#btnUnlock').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});
    await page.locator('#tabTasks').click();
    await page.locator('#btnNew').click();
    await page.locator('#fTitle').fill('Tarea guardada en la nube');
    await page.locator('#btnSave').click();
    await page.locator('.card').filter({hasText:'Tarea guardada en la nube'}).waitFor();
    await page.locator('#tabData').click();
    await page.locator('#cloudBackupHead').waitFor({state:'visible'});
    await page.locator('#btnEnableCloudBackup').click();
    await page.locator('#cloudBackupKeyWrap').waitFor({state:'visible'});
    const recoveryKey = await page.locator('#cloudBackupKey').inputValue();
    assert.equal(recoveryKey.length, 43, 'clave de recuperación de 256 bits');
    await page.locator('#cloudBackupHistory .backup-version').waitFor({state:'visible', timeout:30000});
    const storedChunk = await page.evaluate(async () => {
      const id = document.querySelector('#cloudBackupHistory .backup-version button').dataset.id;
      const snap = await Workhub.app.rootDb.collection('backup_versions/' + id + '/chunks').doc('0').get();
      return snap.data().data;
    });
    assert.ok(!storedChunk.includes('Tarea guardada en la nube'), 'Firestore solo recibe contenido cifrado');
    await page.evaluate(async () => {
      const app = Workhub.app;
      const copy = await app.models.backup.build('Proyecto eliminado');
      await Workhub.services.cloudBackup.save(app.rootDb, 'proyecto-eliminado', copy,
        Workhub.services.cloudBackup.getKey(app.rootDb.me.uid));
    });

    /* Otra sesión y otro almacenamiento local: la copia se recupera solo con
       la clave guardada por la persona usuaria. */
    const secondContext = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES', acceptDownloads:true});
    const second = await secondContext.newPage();
    await second.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await second.locator('.consent [data-act="reject"]').isVisible()) await second.locator('.consent [data-act="reject"]').click();
    await second.locator('#authEmail').fill(email);
    await second.locator('#authPass').fill('contraseña-prueba-123');
    await second.locator('#authSubmit').click();
    await second.locator('#tabData').waitFor({state:'visible', timeout:30000});
    await second.locator('#tabData').click();
    await second.locator('#cloudBackupSetup').waitFor({state:'visible'});
    await second.locator('#cloudBackupImportKey').fill('A'.repeat(43));
    await second.locator('#btnUseCloudBackupKey').click();
    await second.locator('#dataError').getByText('La clave no es válida o no abre las copias de esta cuenta.').waitFor();
    await second.locator('#cloudBackupImportKey').fill(recoveryKey);
    await second.locator('#btnUseCloudBackupKey').click();
    await second.locator('#cloudBackupHistory .backup-version').first().waitFor({state:'visible'});
    await second.locator('#cloudBackupHistory .backup-version').filter({hasText:'Otro proyecto'}).waitFor();
    const downloadPromise = second.waitForEvent('download');
    await second.locator('#cloudBackupHistory .backup-version').filter({hasText:'Otro proyecto'})
      .locator('[data-cloud-action="download"]').click();
    const download = await downloadPromise;
    const saved = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(saved.tasks[0].title, 'Tarea guardada en la nube');
    await second.setViewportSize({width:390,height:844});
    assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
      'copias cifradas sin desbordamiento horizontal en móvil');
    await secondContext.close();
    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: alta, verificación, proyecto y cofre');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
