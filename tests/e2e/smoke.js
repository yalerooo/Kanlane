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
    /* Marcar la casilla no basta: hay que escribir el grupo de la clave que se pide. */
    await page.locator('#recoveryConfirmChk').check();
    assert.equal(await page.locator('#btnRecoveryContinue').isDisabled(), true, 'sin escribir el grupo de la clave no se sigue');
    await page.locator('#recoveryCheck').fill('ZZZZ');
    assert.equal(await page.locator('#btnRecoveryContinue').isDisabled(), true, 'un grupo que no es no vale');
    await page.locator('#recoveryCheck').fill((await page.locator('#recoveryKeyBox').textContent()).trim().split('-')[+(await page.locator('#recoveryCheckN').textContent()) - 1].toLowerCase());
    await page.locator('#btnRecoveryContinue').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});
    await page.locator('#btnLock').click();
    await page.locator('#masterPass2Wrap').waitFor({state:'hidden'});
    /* Cinco contraseñas mal: la quinta abre una espera, y durante ella ni la buena entra. */
    for(let i = 0; i < 5; i++){
      await page.locator('#masterPass').fill('no-es-la-maestra-' + i);
      await page.locator('#btnUnlock').click();
      await page.locator('#lockError', {hasText:i < 4 ? 'incorrecta' : 'Demasiados intentos fallidos'}).waitFor();
      await page.locator('#btnUnlock:not([disabled])').waitFor();
    }
    await page.locator('#masterPass').fill('prueba-segura-123');
    await page.locator('#btnUnlock').click();
    await page.locator('#lockError', {hasText:'Demasiados intentos fallidos'}).waitFor();
    assert.equal(await page.locator('#vaultContent').isVisible(), false, 'durante la espera no se abre');
    /* Pasada la espera (aquí, borrándola) entra, y sin aviso de contraseña débil. */
    await page.evaluate(() => Workhub.app.controllers.vault.clearAttempts());
    await page.locator('#btnUnlock').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});
    assert.equal(await page.locator('#vaultWeakNote').isVisible(), false);

    /* Cambiar la contraseña maestra: aplica las reglas nuevas y la anterior deja de valer. */
    await page.locator('#btnVaultPass').click();
    await page.locator('#dlgVaultPass').waitFor({state:'visible'});
    await page.locator('#vpCurrent').fill('prueba-segura-123');
    await page.locator('#vpNew').fill('12345678');
    await page.locator('#vpNew2').fill('87654321');
    await page.locator('#vpSubmit').click();
    await page.locator('#vpError', {hasText:'no coinciden'}).waitFor();
    /* El generador rellena los dos campos y quita el aviso de «no coinciden». */
    await page.locator('#dlgVaultPass [data-act="gen"]').click();
    assert.equal(await page.locator('#vpError').isVisible(), false, 'tras generar no queda el aviso anterior');
    assert.equal(await page.locator('#vpNew').inputValue(), await page.locator('#vpNew2').inputValue());
    await page.locator('#vpNew').fill('12345678');
    await page.locator('#vpNew2').fill('12345678');
    await page.locator('#vpSubmit').click();
    await page.locator('#vpError', {hasText:'mínimo 12'}).waitFor();
    await page.locator('#vpNew').fill('otra-maestra-456');
    await page.locator('#vpNew2').fill('otra-maestra-456');
    await page.locator('#vpSubmit').click();
    await page.locator('#dlgVaultPass').waitFor({state:'hidden'});
    await page.locator('#btnLock').click();
    await page.locator('#masterPass').fill('prueba-segura-123');
    await page.locator('#btnUnlock').click();
    await page.locator('#lockError', {hasText:'incorrecta'}).waitFor();
    await page.locator('#btnUnlock:not([disabled])').waitFor();
    await page.locator('#masterPass').fill('otra-maestra-456');
    await page.locator('#btnUnlock').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});

    /* Un cofre antiguo con una contraseña de las que ya no se aceptan: entra, pero con aviso. */
    await page.evaluate(() => Workhub.app.models.vault.changePassword('otra-maestra-456', '12345678'));
    await page.locator('#btnLock').click();
    await page.locator('#masterPass').fill('12345678');
    await page.locator('#btnUnlock').click();
    await page.locator('#vaultContent').waitFor({state:'visible'});
    await page.locator('#vaultWeakNote').waitFor({state:'visible'});
    await page.locator('#btnVaultWeak').click();
    await page.locator('#vpCurrent').fill('12345678');
    await page.locator('#vpNew').fill('prueba-segura-123');
    await page.locator('#vpNew2').fill('prueba-segura-123');
    await page.locator('#vpSubmit').click();
    await page.locator('#dlgVaultPass').waitFor({state:'hidden'});
    await page.locator('#vaultWeakNote').waitFor({state:'hidden'});

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
    assert.equal(await page.locator('#btnTvDone').isDisabled(), true, 'ya completada, el círculo queda relleno y sin acción');
    /* Un clic fuera del panel cierra la ficha. */
    await page.mouse.click(20, 400);
    await page.locator('#dlgTaskView').waitFor({state:'hidden'});
    await page.locator('#taskMode [data-task-mode="board"]').click();
    assert.equal(await page.locator('#board').isVisible(), true);

    /* ---- Seleccionar varias tareas y eliminarlas de una vez ---- */
    const before = await page.locator('.card').count();
    await page.evaluate(async () => {
      const tasks = Workhub.app.models.tasks;
      for(const [i, name] of ['Borrar A', 'Borrar B', 'Borrar C', 'Borrar D'].entries()){
        await tasks.add({title:name, status:'todo', order:1000 + i, createdAt:Date.now(), updatedAt:Date.now()});
      }
    });
    const cardOf = (name) => page.locator('.card').filter({hasText:name});
    await cardOf('Borrar D').waitFor();
    const selectedNames = () => page.locator('.card.is-selected h3').allTextContents();
    const countText = () => page.locator('#taskSelectCount').textContent();
    assert.equal(await page.locator('#btnTaskSelect').isVisible(), true);
    assert.equal(await page.locator('#taskSelectBar').isVisible(), false, 'la barra no sale hasta que se selecciona');
    /* Ctrl + clic marca la tarea sin abrirla, y entra en el modo selección. */
    await cardOf('Borrar A').click({modifiers:['Control']});
    assert.equal(await page.locator('#dlgTaskView').isVisible(), false, 'no abre la ficha');
    assert.equal(await page.locator('#taskSelectBar').isVisible(), true);
    assert.equal(await countText(), '1 tarea seleccionada');
    assert.equal(await cardOf('Borrar A').getAttribute('aria-pressed'), 'true');
    assert.equal(await cardOf('Borrar B').getAttribute('aria-pressed'), 'false', 'las demás dicen que no están marcadas');
    assert.equal(await page.locator('#btnTaskSelect').getAttribute('aria-pressed'), 'true');
    /* Mayús + clic marca el tramo. */
    await cardOf('Borrar C').click({modifiers:['Shift']});
    assert.deepEqual(await selectedNames(), ['Borrar A', 'Borrar B', 'Borrar C']);
    assert.equal(await countText(), '3 tareas seleccionadas');
    assert.equal(await page.locator('#btnSelectDelete').textContent(), 'Eliminar 3');
    /* En el modo selección, un clic normal marca o desmarca; con el teclado, Intro o espacio. */
    await cardOf('Borrar B').click();
    assert.deepEqual(await selectedNames(), ['Borrar A', 'Borrar C']);
    await cardOf('Borrar D').focus();
    await page.keyboard.press('Space');
    assert.deepEqual(await selectedNames(), ['Borrar A', 'Borrar C', 'Borrar D']);
    assert.equal(await page.locator('#dlgTaskView').isVisible(), false);
    /* La selección sobrevive a repintar el tablero y se ve igual en la lista. */
    await page.evaluate(() => Workhub.app.controllers.tasks.render());
    assert.deepEqual(await selectedNames(), ['Borrar A', 'Borrar C', 'Borrar D']);
    await page.locator('#taskMode [data-task-mode="list"]').click();
    assert.deepEqual(await page.locator('.tl-row.is-selected .tl-title').allTextContents(), ['Borrar A', 'Borrar C', 'Borrar D']);
    await page.locator('.tl-row').filter({hasText:'Borrar D'}).click();
    assert.equal(await countText(), '2 tareas seleccionadas', 'en la lista también se marca con un clic');
    await page.locator('#taskMode [data-task-mode="board"]').click();
    /* Lo que un filtro esconde deja de estar seleccionado: no se borra nada que no se vea. */
    await page.locator('#search').fill('Borrar A');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
    assert.equal(await countText(), '1 tarea seleccionada');
    await page.locator('#search').fill('');
    await page.waitForFunction((n) => document.querySelectorAll('.card').length === n, before + 4);
    assert.deepEqual(await selectedNames(), ['Borrar A']);
    /* «Seleccionar todas» marca lo que se ve; otra vez, lo quita todo. */
    await page.locator('#btnSelectAll').click();
    assert.equal(await page.locator('.card.is-selected').count(), before + 4);
    assert.equal(await page.locator('#btnSelectAll').textContent(), 'Quitar la selección');
    await page.locator('#btnSelectAll').click();
    assert.equal(await countText(), 'Ninguna tarea seleccionada');
    assert.equal(await page.locator('#btnSelectDelete').isDisabled(), true, 'sin nada marcado no se puede eliminar');
    /* Eliminar: pide confirmación; cancelar no borra ni desmarca. */
    await cardOf('Borrar A').click();
    await cardOf('Borrar B').click();
    await page.locator('#btnSelectDelete').click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    assert.equal(await page.locator('#confirmTitle').textContent(), 'Eliminar tareas');
    assert.equal(await page.locator('#confirmText').textContent(), 'Se eliminarán las 2 tareas seleccionadas. Podrás deshacerlo desde el aviso que sale después.');
    await page.locator('#btnConfirmCancel').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    assert.deepEqual(await selectedNames(), ['Borrar A', 'Borrar B']);
    await page.locator('#btnSelectDelete').click();
    await page.locator('#btnConfirmOk').click();
    await page.waitForFunction((n) => document.querySelectorAll('.card').length === n, before + 2);
    assert.deepEqual((await page.locator('.card h3').allTextContents()).filter((t) => t.indexOf('Borrar') === 0), ['Borrar C', 'Borrar D'], 'solo se van las marcadas');
    assert.equal(await page.locator('#taskSelectBar').isVisible(), false, 'al terminar se sale del modo selección');
    assert.equal(await page.locator('.card[aria-pressed]').count(), 0);
    /* Se puede deshacer, como al eliminar una. */
    const undo = page.locator('.toast').filter({hasText:'2 tareas eliminadas'});
    await undo.waitFor();
    await undo.locator('.toast-action').click();
    await page.waitForFunction((n) => document.querySelectorAll('.card').length === n, before + 4);
    await page.locator('.toast').filter({hasText:'Tareas restauradas'}).waitFor();
    /* Con el botón de la barra, y Escape para salir sin tocar nada. */
    await page.locator('#btnTaskSelect').click();
    assert.equal(await page.locator('#taskSelectBar').isVisible(), true);
    await cardOf('Borrar C').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#taskSelectBar').isVisible(), false);
    assert.equal(await page.locator('.card.is-selected').count(), 0);
    /* Fuera del modo, un clic vuelve a abrir la ficha. */
    await cardOf('Borrar C').click();
    await page.locator('#dlgTaskView').waitFor({state:'visible'});
    await page.locator('#btnTvClose').click();
    await page.locator('#dlgTaskView').waitFor({state:'hidden'});
    /* En móvil cabe, y se limpia lo de esta prueba eliminándolo todo de una vez. */
    const wide = page.viewportSize();
    await page.setViewportSize({width:375, height:812});
    await page.locator('#btnTaskSelect').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'la barra de selección no desborda en móvil');
    await page.setViewportSize(wide);
    await page.evaluate(() => {
      const board = Workhub.app.controllers.tasks.board;
      board.selected = new Set(Workhub.app.models.tasks.items.filter((t) => t.title.indexOf('Borrar') === 0).map((t) => t.id));
      board._paintSelection();
    });
    assert.equal(await countText(), '4 tareas seleccionadas');
    await page.locator('#btnSelectDelete').click();
    await page.locator('#btnConfirmOk').click();
    await page.waitForFunction((n) => document.querySelectorAll('.card').length === n, before);
    await page.locator('.toast').filter({hasText:'4 tareas eliminadas'}).locator('.toast-close').click();

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
    /* Cristal, velo y animaciones: valores validados que acaban en atributos de <html>. */
    await page.evaluate(() => Workhub.app.controllers.plugins.setAppearance('prueba', {glass:'strong', wash:'none', veil:['#9b4dff', '#0EA5A4'], motion:'reduced'}));
    assert.deepEqual(await page.evaluate(() => ['data-glass', 'data-wash', 'data-motion'].map((a) => document.documentElement.getAttribute(a))), ['strong', 'none', 'reduced']);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--hue-b')), '#0EA5A4', 'el velo usa los colores propios');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wash').trim()), '0');
    assert.equal(await page.evaluate(() => { try{ Workhub.app.controllers.plugins.setAppearance('prueba', {veil:['rojo', '#000000']}); return 'ok'; }catch(e){ return e.code || 'error'; } }), 'bad-params', 'el velo solo admite colores #RRGGBB');
    await page.evaluate(() => Workhub.app.controllers.plugins.resetAppearance('prueba'));
    assert.deepEqual(await page.evaluate(() => ['data-glass', 'data-wash', 'data-motion'].map((a) => document.documentElement.getAttribute(a))), [null, null, null], 'al retirarse el plugin no queda nada puesto');
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

    /* En inglés: columnas, copias y fechas en el idioma de la app, y nada en español a la vista. */
    const english = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES', timezoneId:'Europe/Madrid'});
    await english.addInitScript(() => localStorage.setItem('workhub_lang', 'en'));
    const en = await english.newPage();
    await en.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    await en.locator('#dlgProject').waitFor({state:'visible'});
    await en.locator('#pNombre').fill('English board');
    await en.locator('#pTypes [data-type="kanban"]').click();
    await en.locator('#btnSaveProject').click();
    await en.locator('#dlgProject').waitFor({state:'hidden', timeout:10000});
    assert.deepEqual(await en.locator('.col-label').allInnerTexts(), ['Backlog', 'In progress', 'In review', 'Done']);
    await en.locator('#tabData').click();
    assert.deepEqual(await en.locator('#viewData .backup-tile h3').allInnerTexts(), ['Export', 'Import']);
    await en.locator('#btnSaveBackupVersion').click();
    await en.locator('.backup-version').first().waitFor();
    assert.match(await en.locator('.backup-version-info strong').first().innerText(), /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M$/, 'fecha de la copia en inglés aunque el navegador esté en español');
    assert.deepEqual(await en.locator('.backup-version-actions button').allInnerTexts(), ['Download', 'Import', 'Delete']);
    assert.deepEqual(await en.evaluate(() => Workhub.i18n.missing().filter((text) => /[áéíóúñ¿¡]/i.test(text))), [], 'sin textos en español sin traducir');
    await english.close();
    console.log('OK   navegador: proyectos, tareas, teclado, copia, cofre, filtros, lista, navegación y móvil');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
