/* Automatizaciones, fase 2, con Auth y Firestore emulados y las reglas reales:
   - una regla por fecha la ejecuta el servidor (worker/automations.mjs, por la API REST) con el
     navegador CERRADO, deja su línea en la actividad y no se repite;
   - un botón de tarea ejecuta sus acciones con un clic;
   - al borrar una columna que usa una regla, el aviso dice el nombre de la columna. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58652;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeHost = '127.0.0.1:8187';
const storeUrl = 'http://' + storeHost + '/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
const DAY = 86400000;
const PASSWORD = 'contraseña-prueba-123';

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
    const data = await (await fetch(authUrl + '/emulator/v1/projects/demo-workhub/oobCodes')).json();
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

/* Lo que hay de verdad en Firestore, leído como administrador (sin reglas). */
async function stored(docPath){
  const response = await fetch(storeUrl + docPath, {headers:{Authorization:'Bearer owner'}});
  return {status:response.status, text:await response.text()};
}
async function storedWhen(docPath, done){
  let res;
  for(let i = 0; i < 75; i++){
    res = await stored(docPath);
    if(done(res)) return res;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return res;
}

async function signIn(browser, email){
  const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
  if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill(PASSWORD);
  await page.locator('#authSubmit').click();
  return {context, page, errors};
}

(async () => {
  await ready();
  const cron = await import(pathToFileURL(path.join(root, 'worker/automations.mjs')).href);
  const env = {FIRESTORE_EMULATOR_HOST:storeHost, FIREBASE_PROJECT:'demo-workhub'};
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    /* ---------- alta y proyecto ---------- */
    const email = 'cron-' + Date.now() + '@example.test';
    const first = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
    const page = await first.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#authSwitchLink').click();
    await page.locator('#authName').fill('Ana Cron');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill(PASSWORD);
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Proyecto con cron');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.locator('#btnNew').waitFor({state:'visible'});

    /* ---------- una regla por fecha, creada con el formulario ---------- */
    await page.locator('#btnAutomations').click();
    await page.locator('#btnAutoNew').click();
    await page.locator('#autoName').fill('Entrega cerca');
    await page.evaluate(() => {
      const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', {bubbles:true})); };
      set(document.getElementById('autoTrigger'), 'due');
    });
    await page.locator('#autoDays').fill('1');
    await page.locator('#autoBody .auto-a-val').fill('Preparar la entrega');
    await page.locator('#autoForm button[type="submit"]').click();
    await page.locator('#autoBody .auto-rule').filter({hasText:'Entrega cerca'}).waitFor();
    await page.locator('#autoBody .auto-note').filter({hasText:'Las automatizaciones por fecha se ejecutan aunque nadie tenga Kanlane abierto'}).waitFor();
    await page.locator('#btnAutoClose').click();

    /* Una tarea que vence dentro de 5 días: hoy la regla (1 día antes) todavía no le toca. */
    const made = await page.evaluate(async () => {
      const app = Workhub.app, tasks = app.models.tasks;
      const d = new Date();
      d.setDate(d.getDate() + 5);
      const stage = Workhub.models.TaskModel.STATUS[0].key;
      const ref = await tasks.save(null, {title:'Entregar el informe', desc:'', status:stage, cliente:'', contacto:'', dueDate:Workhub.utils.dates.ymd(d), labels:[], checklist:[]});
      return {uid:app.rootDb.me.uid, pid:app.projectId, task:ref.id, due:Workhub.utils.dates.ymd(d)};
    });
    const base = 'users/' + made.uid + (made.pid === 'main' ? '' : '/projects/' + made.pid);
    const jobPath = 'automation_jobs/u~' + made.uid + '~' + made.pid;
    const job = await storedWhen(jobPath, (res) => res.status === 200);
    assert.equal(job.status, 200, 'la app deja la copia de las reglas por fecha para el servidor');
    assert.ok(job.text.indexOf('Entrega cerca') !== -1 && job.text.indexOf('Preparar la entrega') !== -1);
    await storedWhen(base + '/tasks/' + made.task, (res) => res.status === 200);
    /* Con la app abierta y hoy, nada: no está en el plazo. */
    await page.waitForTimeout(4500);
    assert.ok((await stored(base + '/tasks/' + made.task)).text.indexOf('Preparar la entrega') === -1);
    assert.deepEqual(errors, [], 'sin excepciones JavaScript');

    /* ---------- se cierra el navegador ---------- */
    await first.close();

    /* El cron de hoy: nada que hacer. */
    const today = await cron.run(env, {now:() => Date.now()});
    assert.equal(today.configured, true);
    assert.ok(today.jobs >= 1, 'el servidor encuentra el trabajo');
    assert.equal(today.results.find((r) => r.id === 'u~' + made.uid + '~' + made.pid).status, 'idle');

    /* Cuatro días después (falta 1 para la fecha), con la app cerrada: el servidor ejecuta la regla. */
    const later = Date.now() + 4 * DAY;
    const run = await cron.run(env, {now:() => later});
    const mine = run.results.find((r) => r.id === 'u~' + made.uid + '~' + made.pid);
    assert.deepEqual(mine, {id:'u~' + made.uid + '~' + made.pid, status:'ok', ran:1, warns:[]});
    const task = await stored(base + '/tasks/' + made.task);
    assert.ok(task.text.indexOf('Preparar la entrega') !== -1, 'la subtarea está en la tarea: ' + task.text.slice(0, 300));
    assert.ok(task.text.indexOf('Entregar el informe') !== -1, 'el resto de la tarea sigue ahí');
    const notes = await stored(base + '/tasks/' + made.task + '/notes');
    assert.ok(notes.text.indexOf('Automatización «Entrega cerca»: añadió la subtarea «Preparar la entrega»') !== -1, 'queda la línea en la actividad');
    const state = await stored(base + '/plugin_data/kanlane.automations.state');
    assert.ok(state.text.indexOf(made.task) !== -1 && state.text.indexOf(made.due) !== -1, 'y la marca de que ya se ejecutó');
    /* La vuelta siguiente no la repite. */
    const again = await cron.run(env, {now:() => later + 1800000});
    assert.equal(again.results.find((r) => r.id === mine.id).status, 'idle');
    assert.equal(((await stored(base + '/tasks/' + made.task + '/notes')).text.match(/Automatización «Entrega cerca»/g) || []).length, 1);

    /* ---------- vuelve a abrirse la app ---------- */
    const back = await signIn(browser, email);
    const p2 = back.page;
    await p2.locator('.card').filter({hasText:'Entregar el informe'}).click({timeout:30000});
    await p2.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Automatización «Entrega cerca»: añadió la subtarea «Preparar la entrega»'}).waitFor();
    await p2.locator('#tvChecklist').getByText('Preparar la entrega').waitFor();

    /* ---------- botón de tarea ---------- */
    const second = await p2.evaluate(() => Workhub.models.TaskModel.STATUS[1].label);
    await p2.locator('#btnTvClose').click();
    await p2.locator('#btnAutomations').click();
    await p2.locator('#btnAutoNew').click();
    await p2.evaluate(() => {
      const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', {bubbles:true})); };
      set(document.getElementById('autoTrigger'), 'button');
    });
    /* Sin texto no se guarda: es lo que se lee en la tarea. */
    await p2.locator('#autoBody .auto-a-val').fill('Revisar');
    await p2.locator('#autoForm button[type="submit"]').click();
    await p2.locator('#autoError').filter({hasText:'Ponle un nombre al botón'}).waitFor();
    await p2.locator('#autoName').fill('Enviar a revisión');
    await p2.locator('#autoBody [data-auto="add-action"]').click();
    await p2.evaluate(() => {
      const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', {bubbles:true})); };
      const types = document.querySelectorAll('#autoBody .auto-a-type');
      set(types[1], 'move');
    });
    await p2.evaluate(() => {
      const vals = document.querySelectorAll('#autoBody .auto-a-val');
      vals[1].value = Workhub.models.TaskModel.STATUS[1].key;
      vals[1].dispatchEvent(new Event('change', {bubbles:true}));
    });
    await p2.locator('#autoForm button[type="submit"]').click();
    await p2.locator('#autoBody .auto-rule').filter({hasText:'Enviar a revisión'}).locator('.auto-tag').waitFor();
    await p2.locator('#btnAutoClose').click();
    await p2.locator('.card').filter({hasText:'Entregar el informe'}).click();
    await p2.locator('#tvAutoButtons button').filter({hasText:'Enviar a revisión'}).click();
    await p2.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Botón «Enviar a revisión»: añadió la subtarea «Revisar», movió la tarea a «' + second + '»'}).waitFor();
    await p2.locator('#tvChecklist').getByText('Revisar', {exact:true}).waitFor();
    /* Otro clic no repite nada: ya está hecho. */
    await p2.locator('#tvAutoButtons button').filter({hasText:'Enviar a revisión'}).click();
    await p2.waitForTimeout(1500);
    assert.equal(await p2.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Botón «Enviar a revisión»'}).count(), 1);
    await p2.locator('#btnTvClose').click();

    /* ---------- se borra la columna que usa el botón ---------- */
    await p2.evaluate(() => Workhub.app.controllers.projects.updateStages((stages) => { stages.splice(1, 1); }));
    await p2.locator('#btnAutomations').click();
    const broken = p2.locator('#autoBody .auto-rule.is-broken').filter({hasText:'Enviar a revisión'});
    await broken.locator('.auto-broken').filter({hasText:'En pausa: la columna «' + second + '» ya no existe.'}).waitFor();
    assert.ok((await broken.textContent()).indexOf('moverla a «' + second + '»') !== -1, 'la frase de la regla también dice el nombre');
    await p2.locator('#btnAutoClose').click();
    /* Y el botón deja de salir en la ficha. */
    await p2.locator('.card').filter({hasText:'Entregar el informe'}).click();
    await p2.locator('#tvChecklist').getByText('Preparar la entrega').waitFor();
    assert.equal(await p2.locator('#tvAutoButtons button').count(), 0);
    assert.deepEqual(back.errors, [], 'sin excepciones JavaScript');
    await back.context.close();

    console.log('OK   Firebase emulado: regla por fecha en el servidor con la app cerrada, botón de tarea y columna borrada');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
