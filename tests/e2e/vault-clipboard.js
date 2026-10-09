/* Contraseñas y portapapeles: una contraseña copiada se borra sola del portapapeles al minuto; los
   demás datos de la credencial (web, usuario…) se copian desde la ficha y no se borran; y si
   entretanto se copia otra cosa, no se toca. En modo local. Uso: node tests/e2e/vault-clipboard.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58673;
const url = 'http://localhost:' + port + '/app/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

async function ready(){
  for(let i = 0; i < 80; i++){
    try{ if((await fetch(url)).ok) return; }catch(e){}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El servidor local no inició');
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:900}, locale:'es-ES', permissions:['clipboard-read', 'clipboard-write']});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    /* El reloj de la página se adelanta a mano: el minuto no se espera de verdad. */
    await page.clock.install();
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pNombre').fill('Claves');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden', timeout:10000});
    await page.evaluate(() => { const b = document.querySelector('.consent [data-act="reject"]'); if(b) b.click(); });

    /* Cofre nuevo y una credencial con web, usuario, contraseña y notas. */
    await page.locator('#tabVault').click();
    await page.locator('#masterPass2Wrap').waitFor({state:'visible'});
    await page.locator('#masterPass').fill('prueba-segura-123');
    await page.locator('#masterPass2').fill('prueba-segura-123');
    await page.locator('#btnUnlock').click();
    await page.locator('#recoveryReveal').waitFor({state:'visible'});
    await page.locator('#recoveryConfirmChk').check();
    await page.locator('#recoveryCheck').fill((await page.locator('#recoveryKeyBox').textContent()).trim().split('-')[+(await page.locator('#recoveryCheckN').textContent()) - 1].toLowerCase());
    await page.locator('#btnRecoveryContinue').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});
    await page.evaluate(() => Workhub.app.controllers.vault.save('', {
      meta:{tipo:'usuario', cliente:'', label:'Panel', correo:'', web:'https://ejemplo.test/acceso', ip:'', usuario:'admin', puerto:'', dominio:''},
      secret:{password:'s3creta-de-prueba', notas:'Pregunta: perro'}
    }));
    const row = page.locator('.vault-card').filter({hasText:'Panel'});
    await row.waitFor();
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    const minute = () => page.clock.fastForward(61000);

    /* Copiar la contraseña desde la tabla: está en el portapapeles y, al minuto, ya no. */
    await row.locator('[data-action="copy"]').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === 's3creta-de-prueba'));
    await page.locator('.toast').filter({hasText:'Se borrará del portapapeles en 1 minuto'}).waitFor();
    await page.clock.fastForward(30000);
    assert.equal(await clip(), 's3creta-de-prueba', 'a los 30 segundos sigue ahí');
    await page.clock.fastForward(31000);
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === ''));
    await page.locator('.toast').filter({hasText:'Contraseña borrada del portapapeles'}).waitFor();

    /* Ficha: cada dato tiene su botón de copiar, y esos no se borran. */
    await row.locator('.v-name').click();
    const view = page.locator('#dlgVaultView');
    await view.waitFor({state:'visible'});
    assert.deepEqual(await view.locator('#vvFields .view-copy').evaluateAll((list) => list.map((b) => b.getAttribute('aria-label'))), ['Copiar usuario', 'Copiar web']);
    await view.locator('#vvFields .view-copy[data-copy="https://ejemplo.test/acceso"]').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === 'https://ejemplo.test/acceso'));
    await minute();
    await page.waitForTimeout(300);
    assert.equal(await clip(), 'https://ejemplo.test/acceso', 'el enlace no es un secreto: se queda');

    /* Contraseña y, antes del minuto, otro dato desde Kanlane: lo que hay ya no es la contraseña. */
    await view.locator('#btnVvCopy').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === 's3creta-de-prueba'));
    await view.locator('#vvFields .view-copy[data-copy="admin"]').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === 'admin'));
    await minute();
    await page.waitForTimeout(300);
    assert.equal(await clip(), 'admin', 'copiar otra cosa cancela el borrado');

    /* Contraseña y, antes del minuto, algo copiado fuera de Kanlane: tampoco se toca. */
    await view.locator('#btnVvCopy').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === 's3creta-de-prueba'));
    await page.evaluate(() => navigator.clipboard.writeText('copiado en otra aplicación'));
    await minute();
    await page.waitForTimeout(300);
    assert.equal(await clip(), 'copiado en otra aplicación');

    /* Las notas van cifradas con la contraseña: también se borran solas. */
    await view.locator('#btnVvToggle').click();
    await view.locator('#btnVvCopyNotas').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === 'Pregunta: perro'));
    await minute();
    await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t === ''));

    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    console.log('OK   contraseñas: lo copiado se borra del portapapeles al minuto y los demás datos se copian desde la ficha');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
