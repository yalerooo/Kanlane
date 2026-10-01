/* Recorridos de navegador en modo local, con una base IndexedDB nueva por test. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58637;
const url = 'http://localhost:' + port;
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

async function newProject(page, name){
  await page.locator('#pNombre').fill(name);
  await page.locator('#pTypes [data-type="desarrollo"]').click();
  await page.locator('#btnSaveProject').click();
  try{ await page.locator('#dlgProject').waitFor({state:'hidden', timeout:10000}); }
  catch(error){
    console.error('Proyecto:', await page.locator('#pError').textContent(), 'tipo:', await page.locator('#pTypes [aria-checked="true"]').getAttribute('data-type'));
    throw error;
  }
  await page.locator('#projectName').getByText(name).waitFor();
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES', acceptDownloads:true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await newProject(page, 'Proyecto de prueba');

    await page.locator('#btnNew').click();
    await page.locator('#fTitle').fill('Primera tarea');
    await page.locator('#btnSave').click();
    await page.locator('.card').filter({hasText:'Primera tarea'}).waitFor();
    const card = page.locator('.card').filter({hasText:'Primera tarea'});
    await card.focus();
    await card.press('Alt+ArrowRight');
    await page.waitForFunction(() => document.querySelector('.card')?.closest('.col')?.getAttribute('data-status') === 'doing');
    assert.equal(await page.locator('#boardKeyboardStatus').textContent(), 'Tarea movida a En curso.');
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('card'));
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-id')), await card.getAttribute('data-id'), 'el foco sigue la tarjeta movida');

    await page.locator('#tabData').click();
    await page.locator('#btnSaveBackupVersion').click();
    await page.locator('.backup-version').first().waitFor();
    await page.locator('.backup-version [data-backup-action="restore"]').first().click();
    await page.locator('#dataStatus').getByText(/Importado:/).waitFor();
    await page.locator('#tabTasks').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length >= 2);
    /* La UI de equipo usa el almacén local; los permisos reales se prueban
       aparte contra el emulador de Firestore. */
    await page.evaluate(() => {
      Workhub.views.team.set({team:true, role:'owner'}, [{uid:'test', name:'Persona de prueba'}], 'test');
      Workhub.app.controllers.tasks.applyTeam();
    });
    const teamCardId = await page.locator('.card').first().getAttribute('data-id');
    await page.locator('.card[data-id="' + teamCardId + '"]').focus();
    await page.locator('.card[data-id="' + teamCardId + '"]').press('Alt+ArrowRight');
    await page.locator('.card[data-id="' + teamCardId + '"]').press('Enter');
    await page.locator('#tvCommentForm').waitFor({state:'visible'});
    await page.locator('#tvCommentText').fill('Comentario de equipo');
    await page.locator('#tvCommentSend').click();
    await page.locator('#tvNotes').getByText('Comentario de equipo').waitFor();
    assert.match(await page.locator('#tvNotes').textContent(), /Persona de prueba/);
    assert.ok(await page.locator('#tvNotes .is-activity').count() > 0, 'la actividad de equipo aparece en la tarea');
    await page.locator('#btnTvClose').click();
    await page.evaluate(() => {
      Workhub.views.team.set(null, [], '');
      Workhub.app.controllers.tasks.applyTeam();
    });

    await page.locator('#tabVault').click();
    await page.locator('#masterPass2Wrap').waitFor({state:'visible'});
    await page.locator('#masterPass').fill('prueba-segura-123');
    await page.locator('#masterPass2').fill('prueba-segura-123');
    await page.locator('#btnUnlock').click();
    await page.locator('#recoveryReveal').waitFor({state:'visible'});
    await page.locator('#recoveryConfirmChk').check();
    await page.locator('#btnRecoveryContinue').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});
    await page.locator('#btnLock').click();
    await page.locator('#masterPass2Wrap').waitFor({state:'hidden'});
    await page.locator('#masterPass').fill('prueba-segura-123');
    await page.locator('#btnUnlock').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});

    await page.locator('#btnProject').click();
    await page.locator('[data-menu="new"]').click();
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await newProject(page, 'Otro proyecto');
    await page.locator('#tabTasks').click();
    assert.equal(await page.locator('.card').count(), 0, 'los proyectos separan sus tareas');
    await page.locator('#tabVault').click();
    await page.locator('#masterPass2Wrap').waitFor({state:'visible'});
    await page.locator('#tabData').click();
    await page.locator('#backupHistory').getByText('Todavía no hay versiones').waitFor();
    await page.evaluate(() => Workhub.app.controllers.backup.autoSave());
    await page.locator('.backup-version').waitFor();

    assert.deepEqual(errors, [], 'sin excepciones JavaScript en el recorrido');
    await context.close();

    const mobile = await browser.newContext({viewport:{width:390,height:844}, locale:'es-ES', isMobile:true, hasTouch:true});
    const small = await mobile.newPage();
    await small.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    await small.locator('#dlgProject').waitFor({state:'visible'});
    await newProject(small, 'Móvil');
    await small.locator('#boardTabs [data-goto]').first().focus();
    await small.locator('#boardTabs [data-goto]').first().press('ArrowRight');
    assert.equal(await small.evaluate(() => document.activeElement?.getAttribute('data-goto')), 'doing');
    await small.locator('#tabPlugins').click();
    await small.locator('#pluginsOfficial').waitFor({state:'visible'});
    const overflows = await small.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflows, false, 'plugins sin desbordamiento horizontal en móvil');
    await small.setViewportSize({width:320,height:640});
    assert.equal(await small.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'plugins sin desbordamiento a 320 px');
    await mobile.close();
    console.log('OK   navegador: proyectos, tareas, teclado, copia, cofre y móvil');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
