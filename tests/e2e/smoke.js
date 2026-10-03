/* Recorridos de navegador en modo local, con una base IndexedDB nueva por test. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58637;
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
    await require('./landing-check')(browser, 'http://localhost:' + port);
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

    /* ---- Rediseño «cristal limpio»: filtros rápidos, lista, ficha, tema y navegación ---- */
    await page.locator('#tabTasks').click();
    const ymdOf = (offset) => page.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); return Workhub.utils.dates.ymd(d); }, offset);
    const todayKey = await ymdOf(0);
    await page.evaluate(async (today) => {
      const tasks = Workhub.app.models.tasks;
      await tasks.add({title:'Vence hoy', status:'todo', dueDate:today, order:1, createdAt:Date.now(), updatedAt:Date.now()});
      await tasks.add({title:'Vence dentro de un mes', status:'todo', dueDate:'2099-01-01', order:2, createdAt:Date.now(), updatedAt:Date.now()});
    }, todayKey);
    await page.locator('.card').filter({hasText:'Vence dentro de un mes'}).waitFor();
    assert.equal(await page.locator('.card').count(), 2);
    await page.locator('#quickFilters [data-quick="week"]').click();
    assert.equal(await page.locator('#quickFilters [data-quick="week"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('.card h3').allTextContents(), ['Vence hoy'], '«Vencen esta semana» deja solo lo que vence entre el lunes y el domingo');
    await page.locator('#quickFilters [data-quick="all"]').click();
    assert.equal(await page.locator('.card').count(), 2, '«Todas» quita el filtro');
    /* Tablero ↔ lista: las mismas tareas, y la lista abre la ficha. */
    await page.locator('#taskMode [data-task-mode="list"]').click();
    assert.equal(await page.locator('#board').isVisible(), false);
    assert.equal(await page.locator('.tl-row').count(), 2);
    await page.locator('.tl-row').filter({hasText:'Vence hoy'}).click();
    await page.locator('#dlgTaskView').waitFor({state:'visible'});
    assert.match(await page.locator('#tvFacts').textContent(), /Vence hoy/);
    /* «Marcar como completada» pasa la tarea a la etapa final. */
    await page.locator('#btnTvDone').click();
    await page.waitForFunction(() => Workhub.models.TaskModel.isDone(Workhub.app.models.tasks.items.find((t) => t.title === 'Vence hoy')));
    await page.locator('#btnTvClose').click();
    await page.locator('#taskMode [data-task-mode="board"]').click();
    assert.equal(await page.locator('#board').isVisible(), true);
    /* Panel de filtros: se abre y se cierra con Escape. */
    await page.locator('#btnTaskFilter').click();
    assert.equal(await page.locator('#taskFilterPanel').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#taskFilterPanel').isVisible(), false);
    /* Cambio rápido de tema desde el pie de la barra (el aviso de cookies, ya respondido, no lo tapa). */
    await page.locator('.consent [data-act="reject"]').click();
    await page.locator('.consent').waitFor({state:'detached'}).catch(() => {});
    const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.locator('#btnThemeToggle').click();
    /* El cambio va dentro de una transición de vista (la luz que se enciende o se apaga): llega un instante después. */
    await page.waitForFunction((before) => document.documentElement.getAttribute('data-theme') !== before, themeBefore);
    const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    assert.ok(themeAfter === 'dark' || themeAfter === 'light');
    assert.notEqual(themeAfter, themeBefore === null ? 'light' : themeBefore);
    /* Ajustes → Apariencia → Navegación: arriba y de vuelta al lateral; se recuerda en el navegador. */
    await page.locator('#tabSettings').click();
    assert.equal(await page.locator('#accentSwatches [aria-checked="true"]').getAttribute('data-accent'), 'grafito', 'el acento por defecto es Grafito');
    await page.locator('#navSegment [data-nav-choice="top"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-nav')), 'top');
    assert.equal(await page.evaluate(() => localStorage.getItem('workhub_nav')), 'top');
    const navBox = await page.locator('.sidebar').boundingBox();
    assert.ok(navBox.width > 900 && navBox.height < 80, 'con la navegación arriba la barra va tumbada');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'navegación arriba sin desbordamiento');
    /* Un plugin con permiso de apariencia puede fijarla por proyecto; al retirarse vuelve la de Ajustes. */
    await page.evaluate(() => Workhub.app.controllers.plugins.setAppearance('prueba', {nav:'side', accent:'#0D8F6F'}));
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-nav')), null);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--hue-a')), '#0D8F6F', 'el velo del fondo sigue al acento del plugin');
    await page.evaluate(() => Workhub.app.controllers.plugins.resetAppearance('prueba'));
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-nav')), 'top');
    await page.locator('#navSegment [data-nav-choice="side"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-nav')), null);
    /* Las herramientas de cada sección viven en la barra de la vista y solo se ven las suyas. */
    await page.locator('#tabCalendar').click();
    assert.equal(await page.locator('#calNewMeeting').isVisible(), true);
    assert.equal(await page.locator('#search').isVisible(), false);
    await page.locator('#tabTasks').click();

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
    console.log('OK   navegador: proyectos, tareas, teclado, copia, cofre, filtros, lista, navegación y móvil');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
