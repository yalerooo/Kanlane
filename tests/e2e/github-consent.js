/* Aviso antes de activar la sincronización con GitHub (docs/GITHUB.md): sin aceptarlo no sale
   ninguna petición hacia api.github.com ni se guarda el token; aceptándolo, el enlace sigue
   como antes. Modo local, con GitHub interceptado (nunca se llama al de verdad).
   Uso: node tests/e2e/github-consent.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58641;
const url = 'http://localhost:' + port + '/app/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
const ok = (msg) => console.log('OK   ' + msg);

async function ready(){
  for(let i = 0; i < 80; i++){
    try{ if((await fetch(url)).ok) return; }catch(e){}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El servidor local no inició');
}

const GH_URL = 'https://github.com/users/alguien/projects/1';
const TOKEN = 'ghp_prueba_falsa';

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
    const calls = [];
    /* GitHub rechaza el token: basta para ver que el enlace arranca tras aceptar. */
    await context.route('https://api.github.com/**', (route) => {
      calls.push(route.request().postData() || '');
      route.fulfill({status:401, contentType:'application/json', body:'{"message":"Bad credentials"}'});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pNombre').fill('Con GitHub');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden', timeout:10000});

    const dlg = page.locator('#dlgGhConsent');
    const accept = page.locator('#btnGhConsentOk');
    const state = () => page.evaluate(() => ({
      token: Workhub.services.github.token(),
      linked: Workhub.app.controllers.github.sync.isLinked(),
      stages: JSON.stringify(Workhub.app.controllers.projects.current().config || null)
    }));
    const before = await state();

    /* ---------- Ajustes → GitHub Projects ---------- */
    await page.evaluate(() => Workhub.app.navigate('settings'));
    const token = page.locator('#ghToken');
    const fill = async () => {
      await page.locator('#ghUrl').fill(GH_URL);
      if(!(await token.isVisible())) await page.locator('#ghTokenMore summary').click();
      await token.fill(TOKEN);
    };

    await fill();
    await page.locator('#ghBody [data-gh="connect"]').click();
    await dlg.waitFor({state:'visible'});
    assert.equal(await accept.isDisabled(), true, 'el botón de activar empieza deshabilitado');
    assert.equal(await page.locator('#ghConsentColumns').isVisible(), true, 'avisa de que se reemplazan las columnas');
    assert.match(await dlg.innerText(), /sin cifrar/);
    assert.match(await dlg.innerText(), /aunque desvincules/);
    await accept.click({force:true});
    assert.equal(await dlg.isVisible(), true, 'sin marcar la casilla no se activa');
    await page.locator('#btnGhConsentCancel').click();
    await dlg.waitFor({state:'hidden'});
    await page.waitForTimeout(300);
    assert.equal(calls.length, 0, 'cancelar: ninguna petición a GitHub');
    assert.deepEqual(await state(), before, 'cancelar: ni token, ni enlace, ni columnas cambiadas');
    ok('Ajustes: cancelar el aviso no envía nada ni cambia el proyecto');

    /* Cerrar con Escape es cancelar. */
    await fill();
    await page.locator('#ghBody [data-gh="connect"]').click();
    await dlg.waitFor({state:'visible'});
    assert.equal(await page.locator('#ghConsentCheck').isChecked(), false, 'la casilla no se queda marcada de una vez para otra');
    await page.locator('#ghConsentCheck').check();
    assert.equal(await accept.isEnabled(), true);
    await page.keyboard.press('Escape');
    await dlg.waitFor({state:'hidden'});
    await page.waitForTimeout(300);
    assert.equal(calls.length, 0, 'Escape: ninguna petición a GitHub');
    assert.deepEqual(await state(), before);
    ok('Ajustes: Escape con la casilla marcada tampoco activa');

    /* Aceptar: el enlace arranca (aquí GitHub rechaza el token, como antes del aviso). */
    await fill();
    await page.locator('#ghBody [data-gh="connect"]').click();
    await dlg.waitFor({state:'visible'});
    assert.equal(await accept.isDisabled(), true, 'vuelve a pedir la casilla cada vez');
    await page.locator('#ghConsentCheck').check();
    await accept.click();
    await dlg.waitFor({state:'hidden'});
    await page.locator('#ghBody .lock-error').waitFor({state:'visible', timeout:10000});
    assert.ok(calls.length >= 1, 'aceptar: se llama a GitHub');
    assert.match(calls[0], /projectV2/, 'la primera petición lee el proyecto de GitHub');
    assert.equal((await state()).token, '', 'un token rechazado no se conserva');
    ok('Ajustes: al aceptar, el enlace sigue como antes');

    /* ---------- Nuevo proyecto → Desde GitHub ---------- */
    calls.length = 0;
    await page.evaluate(() => Workhub.app.controllers.projects.openNew());
    await page.locator('#pTypes [data-type="github"]').click();
    await page.locator('#pGhToken').fill(TOKEN);
    await page.locator('#pGhUrl').fill(GH_URL);
    const projects = () => page.evaluate(() => Workhub.app.models.projects.list().length);
    const count = await projects();
    for(let i = 0; i < 3 && !(await dlg.isVisible()); i++){
      await page.locator('#btnSaveProject').click();
      await page.waitForTimeout(300);
    }
    await dlg.waitFor({state:'visible'});
    assert.equal(await page.locator('#ghConsentColumns').isVisible(), false, 'proyecto nuevo: no hay columnas que reemplazar');
    assert.equal(await page.locator('#ghConsentLabelSend').isVisible(), true);
    assert.equal(await accept.isDisabled(), true);
    await page.locator('#btnGhConsentCancel').click();
    await dlg.waitFor({state:'hidden'});
    await page.waitForTimeout(300);
    assert.equal(calls.length, 0, 'cancelar: ninguna petición a GitHub');
    assert.equal(await projects(), count, 'cancelar: no se crea ningún proyecto');
    assert.equal((await state()).token, '');
    assert.equal(await page.locator('#dlgProject').isVisible(), true, 'se vuelve al formulario');
    assert.equal(await page.locator('#pError').isVisible(), false, 'cancelar no es un error');
    assert.equal(await page.locator('#btnSaveProject').isEnabled(), true);
    ok('Desde GitHub: cancelar el aviso no envía nada ni crea el proyecto');

    await page.locator('#btnSaveProject').click();
    await dlg.waitFor({state:'visible'});
    await page.locator('#ghConsentCheck').check();
    await accept.click();
    await dlg.waitFor({state:'hidden'});
    await page.locator('#pError').waitFor({state:'visible', timeout:10000});
    assert.ok(calls.length >= 1, 'aceptar: se llama a GitHub');
    ok('Desde GitHub: al aceptar, la creación sigue como antes');

    assert.deepEqual(errors, [], 'sin excepciones JavaScript en el recorrido');
    await context.close();
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
