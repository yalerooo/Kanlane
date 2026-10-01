/* Alta de cuenta, verificación y cofre con Auth/Firestore emulados. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58638;
const url = 'http://localhost:' + port;
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
    const context = await browser.newContext({viewport:{width:1280,height:850}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#authSwitchLink').click();
    const email = 'test-' + Date.now() + '@example.test';
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
    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: alta, verificación, proyecto y cofre');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
