/* Los enlaces de los correos (verificar la dirección, cambiar la contraseña) abren Kanlane, no la
   página de Firebase: el Worker los trae a /app/?mode=…&oobCode=… (tests/worker/domains.test.js)
   y aquí se prueba lo que hace la app con ellos, con Auth/Firestore emulados. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58677;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
const PASS = 'contraseña-prueba-123';
const NEW_PASS = 'otra-contraseña-456';

async function ready(){
  for(let i = 0; i < 300; i++){
    try{ if((await fetch(url)).ok && (await fetch(authUrl)).status < 500) return; }catch(e){}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('No arrancaron el servidor y el emulador de Authentication');
}

/* El enlace del último correo de ese tipo que el emulador «envió» a esa dirección, ya como lo
   deja el Worker: en la app. */
async function link(email, type){
  let code;
  for(let i = 0; i < 50 && !code; i++){
    const data = await (await fetch(authUrl + '/emulator/v1/projects/demo-workhub/oobCodes')).json();
    code = (data.oobCodes || []).filter((item) => item.email === email && item.requestType === type).pop();
    if(!code) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(code, 'el emulador recibió el correo (' + type + ')');
  return url + '?mode=' + (type === 'VERIFY_EMAIL' ? 'verifyEmail' : 'resetPassword') + '&oobCode=' + encodeURIComponent(code.oobCode) + '&lang=es';
}

async function open(context, to){
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(to, {waitUntil:'domcontentloaded', timeout:15000});
  return page;
}

async function signUp(page, email){
  if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.locator('#authSwitchLink').click();
  await page.locator('#authName').fill('Persona de prueba');
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill(PASS);
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
}

const errors = [];

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  const options = {viewport:{width:1280,height:850}, locale:'es-ES'};
  try{
    /* ---------- Verificar, en el mismo navegador donde se creó la cuenta ---------- */
    const email = 'enlace-' + Date.now() + '@example.test';
    const context = await browser.newContext(options);
    const first = await open(context, url);
    await signUp(first, email);
    const verifyLink = await link(email, 'VERIFY_EMAIL');
    const second = await open(context, verifyLink);
    /* Entra directo en la app (cuenta nueva: se ofrece el primer proyecto), con su aviso y sin
       el código en la barra de direcciones. */
    await second.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await second.getByText('Correo verificado.').first().waitFor({state:'visible'});
    assert.equal(second.url(), url, 'el código no se queda en la dirección');
    /* La pestaña que se quedó en «Verifica tu correo» entra sola, sin pulsar nada. */
    await first.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    console.log('OK   el enlace de verificación entra en la app, y la pestaña que esperaba también');

    /* El mismo enlace otra vez, en otro navegador: ya no vale, y se dice en el acceso. */
    const other = await browser.newContext(options);
    let page = await open(other, verifyLink);
    await page.locator('#authMsg').getByText('Ese enlace de verificación ha caducado o ya se ha usado.').waitFor({state:'visible', timeout:30000});
    assert.equal(await page.locator('#authPass').isVisible(), true, 'queda el formulario de entrar');
    await other.close();
    console.log('OK   un enlace de verificación ya usado se avisa en el acceso');

    /* ---------- Verificar, abriendo el correo en otro dispositivo ---------- */
    const email2 = 'enlace2-' + Date.now() + '@example.test';
    const origin = await browser.newContext(options);
    await signUp(await open(origin, url), email2);
    const device = await browser.newContext(options);
    page = await open(device, await link(email2, 'VERIFY_EMAIL'));
    await page.locator('#authMsg').getByText('Correo verificado. Inicia sesión para entrar.').waitFor({state:'visible', timeout:30000});
    assert.equal(await page.locator('#authEmail').inputValue(), email2, 'con el correo ya puesto');
    await page.locator('#authPass').fill(PASS);
    await page.locator('#authSubmit').click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await device.close();
    await origin.close();
    console.log('OK   en otro dispositivo queda el acceso con el correo puesto y el aviso de verificado');

    /* ---------- Cambiar la contraseña ---------- */
    const reset = await browser.newContext(options);
    page = await open(reset, url);
    if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#authForgot').click();
    await page.locator('#authEmail').fill(email2);
    await page.locator('#authSubmit').click();
    await page.locator('#authSent').waitFor({state:'visible'});
    const resetLink = await link(email2, 'PASSWORD_RESET');
    await page.goto(resetLink, {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('#authTitle', {hasText:'Elige una contraseña nueva'}).waitFor({state:'visible', timeout:30000});
    assert.equal(page.url(), url, 'el código no se queda en la dirección');
    assert.match(await page.locator('#authSub').textContent(), new RegExp(email2.replace(/[.+]/g, '\\$&')));
    assert.equal(await page.locator('#authEmail').isVisible(), false, 'solo se pide la contraseña');
    assert.equal(await page.locator('#authAlt').isVisible(), false, 'sin otros accesos');
    /* Una corta no pasa, y el medidor acompaña. */
    await page.locator('#authPass').fill('corta');
    assert.equal(await page.locator('#authMeter').getAttribute('data-level'), 'short');
    await page.locator('#authSubmit').click();
    await page.locator('#authPassErr').waitFor({state:'visible'});
    await page.locator('#authPass').fill(NEW_PASS);
    await page.locator('#authSubmit').click();
    /* Guardada: entra en la app con la contraseña nueva. */
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.getByText('Contraseña cambiada').first().waitFor({state:'visible'});
    await reset.close();
    console.log('OK   el enlace de cambio de contraseña pide la nueva y entra con ella');

    /* El enlace ya usado lleva a pedir otro; la contraseña antigua ya no entra y la nueva sí. */
    const later = await browser.newContext(options);
    page = await open(later, resetLink);
    await page.locator('#authMsg').getByText('Ese enlace para cambiar la contraseña ha caducado o ya se ha usado. Pide otro.').waitFor({state:'visible', timeout:30000});
    await page.locator('#authTitle', {hasText:'Recupera tu contraseña'}).waitFor({state:'visible'});
    await page.locator('#authSwitchLink').click();
    await page.locator('#authEmail').fill(email2);
    await page.locator('#authPass').fill(PASS);
    await page.locator('#authSubmit').click();
    await page.locator('#authPassErr').waitFor({state:'visible'});
    await page.locator('#authPass').fill(NEW_PASS);
    await page.locator('#authSubmit').click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await later.close();
    console.log('OK   un enlace de cambio de contraseña ya usado lleva a pedir otro');

    /* Volver atrás desde la contraseña nueva deja el acceso de siempre. */
    const back = await browser.newContext(options);
    page = await open(back, url);
    if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
    await page.locator('#authForgot').click();
    await page.locator('#authEmail').fill(email2);
    await page.locator('#authSubmit').click();
    await page.locator('#authSent').waitFor({state:'visible'});
    await page.goto(await link(email2, 'PASSWORD_RESET'), {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('#authTitle', {hasText:'Elige una contraseña nueva'}).waitFor({state:'visible', timeout:30000});
    await page.locator('#authSwitchLink').click();
    await page.locator('#authTitle', {hasText:'Inicia sesión'}).waitFor({state:'visible'});
    assert.equal(await page.locator('#authEmail').inputValue(), email2);
    await page.locator('#authPass').fill(NEW_PASS);
    await page.locator('#authSubmit').click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await back.close();
    console.log('OK   se puede dejar la contraseña nueva y entrar como siempre');

    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
