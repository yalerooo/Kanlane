/* Automatizaciones, fase 2, con Auth y Firestore emulados y las reglas reales:
   - una regla por fecha la ejecuta el servidor (worker/automations.mjs, por la API REST) con el
     navegador CERRADO, deja su línea en la actividad y no se repite: ni en la vuelta siguiente
     del cron, ni al volver a abrir la app, ni al recargarla sin caché;
   - cada vuelta del cron deja constancia en automation_state/cursor;
   - si la tarea cambia entre que el servidor la lee y escribe, no se escribe nada (lo impone
     Firestore con la condición de la escritura) y la vuelta siguiente lo hace bien;
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
  for(let i = 0; i < 300; i++){
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
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return {uid:app.rootDb.me.uid, pid:app.projectId, task:ref.id, due:Workhub.utils.dates.ymd(d), stage:stage, tomorrow:Workhub.utils.dates.ymd(t)};
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

    /* Con todo cerrado llega (por otra vía: aquí, como administrador) una tarea que vence mañana.
       Para ella la regla ya toca HOY, con el reloj de verdad: es la que después demuestra que la
       app, al abrirse, no repite lo que hizo el servidor. */
    const soon = 'vence-manana';
    const tomorrowTask = {title:'Vence mañana', desc:'', status:made.stage, dueDate:made.tomorrow, labels:[], checklist:[], order:Date.now(), createdAt:Date.now(), updatedAt:Date.now()};
    const created = await fetch(storeUrl + base + '/tasks?documentId=' + soon, {method:'POST', headers:{Authorization:'Bearer owner', 'Content-Type':'application/json'}, body:JSON.stringify({fields:cron.encodeFields(tomorrowTask)})});
    assert.equal(created.status, 200, 'tarea de mañana creada');

    /* El cron de hoy: la de dentro de 5 días no toca; la de mañana, sí. */
    const today = await cron.run(env, {now:() => Date.now()});
    assert.equal(today.configured, true);
    assert.ok(today.jobs >= 1, 'el servidor encuentra el trabajo');
    assert.deepEqual(today.results.find((r) => r.id === 'u~' + made.uid + '~' + made.pid), {id:'u~' + made.uid + '~' + made.pid, status:'ok', ran:1, warns:[]});
    assert.ok((await stored(base + '/tasks/' + made.task)).text.indexOf('Preparar la entrega') === -1, 'la que vence dentro de 5 días sigue igual');
    assert.equal(((await stored(base + '/tasks/' + soon)).text.match(/Preparar la entrega/g) || []).length, 1, 'la de mañana ya tiene su subtarea');
    assert.equal(((await stored(base + '/tasks/' + soon + '/notes')).text.match(/Automatización «Entrega cerca»/g) || []).length, 1);
    /* Otra vuelta el mismo día: nada. */
    assert.equal((await cron.run(env, {now:() => Date.now()})).results.find((r) => r.id === 'u~' + made.uid + '~' + made.pid).status, 'idle');
    /* Aunque no haya hecho nada, la vuelta queda apuntada: es lo que se mira para saber si el cron corre. */
    const cursor0 = cron.decodeFields(JSON.parse((await stored('automation_state/cursor')).text).fields);
    assert.ok(cursor0.runs >= 2 && cursor0.ran === 0 && cursor0.jobs >= 1 && Math.abs(cursor0.updatedAt - Date.now()) < 60000, JSON.stringify(cursor0));

    /* Cuatro días después (falta 1 para la fecha), con la app cerrada: el servidor ejecuta la regla. */
    const later = Date.now() + 4 * DAY;
    /* Antes, una vuelta en la que alguien cambia la tarea justo después de que el servidor la lea:
       la escritura va condicionada a la versión leída, así que Firestore la rechaza entera. */
    const deps = {fetch:(u, init) => fetch(u, init), now:() => later};
    const real = cron.restStore(env, deps);
    const racing = Object.assign({}, real, {tasksDue:async (rootPath, maxDate) => {
      const found = await real.tasksDue(rootPath, maxDate);
      const touch = await fetch(storeUrl + base + '/tasks/' + made.task + '?updateMask.fieldPaths=desc', {method:'PATCH',
        headers:{Authorization:'Bearer owner', 'Content-Type':'application/json'}, body:JSON.stringify({fields:{desc:{stringValue:'cambiada mientras tanto'}}})});
      assert.equal(touch.status, 200);
      return found;
    }});
    const raced = await cron.run(env, Object.assign({store:racing}, deps));
    assert.equal(raced.results.find((r) => r.id === 'u~' + made.uid + '~' + made.pid).status, 'conflict', JSON.stringify(raced.results));
    const untouched = await stored(base + '/tasks/' + made.task);
    assert.ok(untouched.text.indexOf('Preparar la entrega') === -1 && untouched.text.indexOf('cambiada mientras tanto') !== -1, 'no se escribió nada y el cambio ajeno sigue ahí');
    assert.ok((await stored(base + '/plugin_data/kanlane.automations.state')).text.indexOf(made.task) === -1, 'ni la marca');
    assert.ok((await stored(base + '/tasks/' + made.task + '/notes')).text.indexOf('Entrega cerca') === -1, 'ni la línea de actividad');

    const run = await cron.run(env, {now:() => later});
    const mine = run.results.find((r) => r.id === 'u~' + made.uid + '~' + made.pid);
    assert.deepEqual(mine, {id:'u~' + made.uid + '~' + made.pid, status:'ok', ran:1, warns:[]});
    const task = await stored(base + '/tasks/' + made.task);
    assert.ok(task.text.indexOf('Preparar la entrega') !== -1, 'la subtarea está en la tarea: ' + task.text.slice(0, 300));
    assert.ok(task.text.indexOf('Entregar el informe') !== -1, 'el resto de la tarea sigue ahí');
    assert.ok(task.text.indexOf('cambiada mientras tanto') !== -1, 'también lo que cambió otro justo antes');
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
    /* La app abierta mira las reglas por fecha a los pocos segundos: no repite lo que hizo el
       servidor. Para «Vence mañana» la regla toca hoy también en el navegador, así que lo único
       que la frena es la marca que dejó el servidor. Tampoco tras recargar sin caché. */
    await p2.locator('#btnTvClose').click();
    await p2.evaluate(() => Workhub.app.controllers.automations.checkDue());
    await p2.waitForTimeout(4500);
    const cdp = await back.context.newCDPSession(p2);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', {cacheDisabled:true});
    await cdp.send('Network.setBypassServiceWorker', {bypass:true});
    await p2.reload({waitUntil:'domcontentloaded'});
    await p2.locator('.card').filter({hasText:'Entregar el informe'}).waitFor({timeout:30000});
    await p2.waitForTimeout(4500);
    assert.equal(((await stored(base + '/tasks/' + made.task + '/notes')).text.match(/Automatización «Entrega cerca»/g) || []).length, 1, 'una sola línea tras abrir y recargar la app');
    assert.equal(((await stored(base + '/tasks/' + made.task)).text.match(/Preparar la entrega/g) || []).length, 1, 'y una sola subtarea');
    assert.equal(((await stored(base + '/tasks/' + soon + '/notes')).text.match(/Automatización «Entrega cerca»/g) || []).length, 1, 'la de mañana: una sola línea');
    assert.equal(((await stored(base + '/tasks/' + soon)).text.match(/Preparar la entrega/g) || []).length, 1, 'y una sola subtarea');
    /* Si alguien quita esa subtarea a mano, la app no la vuelve a poner: la regla ya se ejecutó para esa fecha. */
    await p2.evaluate(async (id) => {
      const app = Workhub.app;
      await app.models.tasks.update(id, {checklist:[], updatedAt:Date.now()});
      await app.controllers.automations.load(true);
      app.controllers.automations.checkDue();
    }, soon);
    await p2.waitForTimeout(4500);
    assert.equal(((await stored(base + '/tasks/' + soon)).text.match(/Preparar la entrega/g) || []).length, 0, 'no se repite al abrir la app');
    assert.equal(((await stored(base + '/tasks/' + soon + '/notes')).text.match(/Automatización «Entrega cerca»/g) || []).length, 1);
    const kept = await stored(base + '/plugin_data/kanlane.automations.state');
    assert.ok(kept.text.indexOf(made.task) !== -1 && kept.text.indexOf(made.due) !== -1 && kept.text.indexOf(soon) !== -1, 'las marcas del servidor siguen en su sitio');
    await p2.locator('.card').filter({hasText:'Entregar el informe'}).click();
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
    await broken.locator('.auto-broken').filter({hasText:'No se ejecuta: la columna «' + second + '» ya no existe.'}).waitFor();
    assert.equal(await broken.locator('.auto-status').textContent(), 'En pausa');
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
