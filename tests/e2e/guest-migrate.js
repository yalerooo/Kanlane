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

async function enterGuest(page, name){
  await page.locator('#authGuestBtn').click();
  await page.locator('#authGuestName').fill(name);
  await page.locator('#authGuestForm button[type="submit"]').click();
}

async function firstProject(page, name){
  await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
  await page.locator('#pNombre').fill(name);
  await page.locator('#pTypes [data-type="desarrollo"]').click();
  await page.locator('#btnSaveProject').click();
  await page.locator('#dlgProject').waitFor({state:'hidden'});
}

/* Dos invitados seguidos en el mismo navegador: el segundo empieza de cero, su cuenta recibe solo
   lo suyo, y el primero sigue teniendo sus datos, también los de antes de haber una base por
   invitado (la de siempre). */
async function isolated(browser){
  const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.evaluate(() => { const b = document.querySelector('.consent [data-act="reject"]'); if(b) b.click(); });

  /* Un invitado de antes de este cambio: sin id, con sus datos en la base de siempre, y que salió
     sin quedar apuntado en ninguna lista. */
  await page.evaluate(() => { localStorage.setItem('workhub_guest', JSON.stringify({name:'Ana'})); });
  await page.reload({waitUntil:'domcontentloaded'});
  await firstProject(page, 'Futbolge');
  await newTask(page, 'Preparar equipación nueva');
  await page.evaluate(() => { localStorage.removeItem('workhub_guest'); localStorage.removeItem('workhub_project'); localStorage.removeItem('workhub_guests'); });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});

  /* Otra persona entra como invitada: se le ofrece seguir con lo que había, pero con su nombre
     estrena un espacio vacío (asistente de primer proyecto, sin «Futbolge»). */
  await page.locator('#authGuestBtn').click();
  await page.locator('#authGuestPrev [data-guest]').waitFor({state:'visible'});
  assert.equal(await page.locator('#authGuestPrev [data-guest]').textContent(), 'Continuar con los datos de invitado de este navegador');
  await page.locator('#authGuestName').fill('Berto');
  await page.locator('#authGuestForm button[type="submit"]').click();
  await firstProject(page, 'Mejoras Kanlane');
  await newTask(page, 'Tarea de Berto');
  assert.deepEqual(await page.evaluate(() => Workhub.app.models.projects.list().map((p) => p.nombre)), ['Mejoras Kanlane'], 'no hereda el proyecto del invitado anterior');
  assert.equal(await page.locator('.card').count(), 1);

  /* Berto sale y vuelve: sus datos siguen, con «Continuar como Berto». */
  await page.locator('#btnSignOut').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.locator('#authGuestBtn').click();
  await page.locator('#authGuestPrev [data-guest]').filter({hasText:'Continuar como Berto'}).click();
  await page.locator('.card').filter({hasText:'Tarea de Berto'}).waitFor({timeout:30000});

  /* Crea su cuenta: recibe solo lo suyo. */
  await page.locator('#btnGuestUpgradeSide').click();
  await page.locator('#authMigrate').waitFor({state:'visible', timeout:30000});
  const email = 'berto-' + Date.now() + '@example.test';
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill('contraseña-prueba-123');
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
  await verify(email);
  await page.getByRole('button', {name:'Ya lo he verificado'}).click();
  await page.locator('.card').filter({hasText:'Tarea de Berto'}).waitFor({timeout:30000});
  await page.locator('.toast').filter({hasText:'Tus datos de invitado ya están en tu cuenta.'}).waitFor();
  const cloud = await page.evaluate(async () => {
    const app = Workhub.app;
    const all = [];
    for(const p of app.models.projects.list()){
      const snap = await Workhub.models.ProjectModel.scope(app.rootDb, p.id).collection('tasks').get();
      snap.docs.forEach((d) => all.push(d.data().title));
    }
    return {mode:Workhub.services.platform.mode(), names:app.models.projects.list().map((p) => p.nombre), tasks:all};
  });
  assert.equal(cloud.mode, 'firebase');
  assert.deepEqual(cloud.names, ['Mejoras Kanlane'], 'la cuenta no recibe el proyecto de otro invitado');
  assert.deepEqual(cloud.tasks, ['Tarea de Berto'], 'ni sus tareas');

  /* Y lo de Ana sigue en el navegador, sin tocar; Berto ya no se ofrece (sus datos están en su cuenta). */
  await page.locator('#btnSignOut').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.locator('#authGuestBtn').click();
  await page.locator('#authGuestPrev [data-guest]').first().waitFor({state:'visible'});
  assert.equal(await page.locator('#authGuestPrev [data-guest]').count(), 1);
  await page.locator('#authGuestPrev [data-guest]').click();
  await page.locator('.card').filter({hasText:'Preparar equipación nueva'}).waitFor({timeout:30000});
  assert.deepEqual(await page.evaluate(() => Workhub.app.models.projects.list().map((p) => p.nombre)), ['Futbolge']);

  /* Ana pide llevarse sus datos, pero entra con una cuenta que ya existía (la de Berto): no se
     copia nada, se avisa, y sus datos siguen en el navegador. */
  await page.locator('#btnGuestUpgradeSide').click();
  await page.locator('#authMigrate').waitFor({state:'visible', timeout:30000});
  assert.equal(await page.locator('#authResume').isVisible(), false, 'con el aviso de la copia no se repite la vuelta atrás');
  await page.locator('#authTitle', {hasText:'Crea tu cuenta'}).waitFor({state:'visible'});
  await page.locator('#authSwitchLink').click();
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill('contraseña-prueba-123');
  await page.locator('#authSubmit').click();
  await page.locator('.card').filter({hasText:'Tarea de Berto'}).waitFor({timeout:30000});
  await page.locator('.toast').filter({hasText:'Esta cuenta ya existía'}).waitFor();
  assert.deepEqual(await page.evaluate(() => Workhub.app.models.projects.list().map((p) => p.nombre)), ['Mejoras Kanlane'], 'una cuenta que ya existía no recibe los datos del invitado');
  assert.ok(await page.evaluate(() => localStorage.getItem('workhub_guest_migrate')), 'lo pendiente sigue apuntado');

  /* Sale y crea una cuenta nueva: ahora sí. */
  await page.locator('#btnSignOut').click();
  await page.locator('#authMigrate').waitFor({state:'visible', timeout:30000});
  await page.locator('#authPass').waitFor({state:'visible'});
  if(await page.locator('#authTitle').textContent() !== 'Crea tu cuenta') await page.locator('#authSwitchLink').click();
  const emailAna = 'ana-' + Date.now() + '@example.test';
  await page.locator('#authEmail').fill(emailAna);
  await page.locator('#authPass').fill('contraseña-prueba-123');
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
  await verify(emailAna);
  await page.getByRole('button', {name:'Ya lo he verificado'}).click();
  await page.locator('.card').filter({hasText:'Preparar equipación nueva'}).waitFor({timeout:30000});
  await page.locator('.toast').filter({hasText:'Tus datos de invitado ya están en tu cuenta.'}).waitFor();
  assert.deepEqual(await page.evaluate(() => Workhub.app.models.projects.list().map((p) => p.nombre)), ['Futbolge']);
  assert.deepEqual(errors, [], 'sin excepciones JavaScript');
  await context.close();
}

/* Firestore no contesta mientras se copian los datos: la pantalla de la copia no se queda para
   siempre. Pasado un rato se entra en la app con la copia en marcha y, cuando vuelve la conexión,
   termina sola y sin duplicados. */
async function slow(browser){
  const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.evaluate(() => { const b = document.querySelector('.consent [data-act="reject"]'); if(b) b.click(); });
  await enterGuest(page, 'Carla');
  await firstProject(page, 'Con mala conexión');
  await newTask(page, 'Tarea que tarda en llegar');
  await page.locator('#btnGuestUpgradeSide').click();
  await page.locator('#authMigrate').waitFor({state:'visible', timeout:30000});
  const email = 'carla-' + Date.now() + '@example.test';
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill('contraseña-prueba-123');
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
  await verify(email);
  const cut = (route) => route.abort();
  await context.route('**://127.0.0.1:8187/**', cut);
  await page.getByRole('button', {name:'Ya lo he verificado'}).click();
  await page.locator('.auth-verify-title', {hasText:'Llevando tus datos a tu cuenta'}).waitFor({state:'visible', timeout:30000});
  /* Sin servidor, la pantalla cede el paso a la app, que avisa de que la copia sigue. */
  await page.locator('.toast').filter({hasText:'se están terminando de copiar'}).waitFor({timeout:40000});
  assert.equal(await page.locator('#authScreen').isVisible(), false, 'la pantalla de la copia no se queda bloqueada');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#dlgProject').isVisible(), false, 'no pide crear el primer proyecto mientras llegan los datos');
  assert.ok(await page.evaluate(() => localStorage.getItem('workhub_guest_migrate')), 'lo pendiente sigue apuntado hasta que termine');
  /* Vuelve la conexión: la copia termina por detrás. */
  await context.unroute('**://127.0.0.1:8187/**', cut);
  await page.locator('.toast').filter({hasText:'Tus datos de invitado ya están en tu cuenta.'}).waitFor({timeout:90000});
  await page.locator('.card').filter({hasText:'Tarea que tarda en llegar'}).waitFor({timeout:30000});
  const after = await page.evaluate(async () => ({
    names: Workhub.app.models.projects.list().map((p) => p.nombre),
    cards: document.querySelectorAll('.card').length,
    pending: localStorage.getItem('workhub_guest_migrate'),
    local: (await window.__localStore.db.collection('projects').get()).size
  }));
  assert.deepEqual(after.names, ['Con mala conexión'], 'un solo proyecto: sin duplicados');
  assert.equal(after.cards, 1);
  assert.equal(after.pending, null);
  assert.equal(after.local, 0);
  assert.deepEqual(errors, [], 'sin excepciones JavaScript');
  await context.close();
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

    /* Recargar no saca del modo invitado. */
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.card').filter({hasText:'Tarea de invitada'}).waitFor({timeout:30000});
    assert.equal(await page.locator('#accountMail').textContent(), 'Invitado');
    /* Y si la sesión de invitado se pierde, el acceso ofrece volver a sus datos en la primera pantalla. */
    await page.evaluate(() => { localStorage.removeItem('workhub_guest'); });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#authResume').waitFor({state:'visible', timeout:30000});
    await page.locator('#authResume [data-guest]').filter({hasText:'Continuar como Lola Invitada'}).click();
    await page.locator('.card').filter({hasText:'Tarea de invitada'}).waitFor({timeout:30000});
    assert.equal(await page.evaluate(() => Workhub.app.models.projects.list().length), 2, 'con sus dos proyectos');

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
    await isolated(browser);
    console.log('OK   Firebase emulado: dos invitados seguidos no comparten datos, y solo una cuenta nueva los recibe');
    await slow(browser);
    console.log('OK   Firebase emulado: con el servidor sin contestar, la copia no bloquea la entrada y termina después');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
