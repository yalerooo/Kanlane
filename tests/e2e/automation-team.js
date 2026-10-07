/* Automatizaciones en un proyecto de equipo, con Auth y Firestore emulados, las reglas reales y dos
   cuentas (propietaria y editor). Todo ocurre en un equipo creado para la prueba.
   - Permisos: el editor ve las reglas y pulsa botones, pero no puede cambiarlas ni por la interfaz
     ni escribiendo directamente en Firestore con sus credenciales; el servidor tampoco ejecuta una
     copia que no sea de la propietaria.
   - Lo que hace un navegador no lo repite el otro: una ejecución, una línea en la actividad.
   - Borrar una columna o quitar a una persona avisa antes de qué reglas quedarán en pausa.
   - Una regla en pausa se distingue de una activa con palabras (no solo por color) y se recupera
     editándola: lo que ya no existe sigue en su lista, dicho con su nombre.
   - Todo sobrevive a una recarga sin caché y a una sesión nueva, también en móvil y en inglés. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58653;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeHost = '127.0.0.1:8187';
const storeUrl = 'http://' + storeHost + '/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
const PASSWORD = 'contraseña-prueba-123';
const stamp = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready(){
  for(let i = 0; i < 100; i++){
    try{ if((await fetch(url)).ok && (await fetch(authUrl)).status < 500) return; }catch(e){}
    await sleep(100);
  }
  throw new Error('No arrancaron el servidor y el emulador de Authentication');
}

async function verify(email){
  let code;
  for(let i = 0; i < 50; i++){
    const data = await (await fetch(authUrl + '/emulator/v1/projects/demo-workhub/oobCodes')).json();
    code = (data.oobCodes || []).find((item) => item.email === email && item.requestType === 'VERIFY_EMAIL');
    if(code) break;
    await sleep(100);
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
    await sleep(200);
  }
  return res;
}
const times = (text, what) => text.split(what).length - 1;

async function open(browser, opts){
  const context = await browser.newContext(Object.assign({viewport:{width:1280,height:850}, locale:'es-ES'}, opts));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
  if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  return {context, page, errors};
}

/* Cuenta nueva verificada; se queda en el diálogo del primer proyecto. */
async function signUp(browser, name, email){
  const s = await open(browser);
  const page = s.page;
  await page.locator('#authSwitchLink').click();
  await page.locator('#authName').fill(name);
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill(PASSWORD);
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
  await verify(email);
  await page.getByRole('button', {name:/Ya lo he verificado|I have verified it|verified/}).click();
  await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
  s.uid = await page.evaluate(() => Workhub.app.rootDb.me.uid);
  s.email = email;
  return s;
}

/* Sesión nueva de una cuenta que ya existe: otro contexto, sin nada guardado en el navegador. */
async function signIn(browser, email, opts){
  const s = await open(browser, opts);
  await s.page.locator('#authEmail').fill(email);
  await s.page.locator('#authPass').fill(PASSWORD);
  await s.page.locator('#authSubmit').click();
  await s.page.locator('#btnNew').waitFor({state:'visible', timeout:30000});
  /* En otro idioma la app se recarga una vez al entrar: se espera a la que queda. */
  const loaded = () => s.page.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()), null, {timeout:30000});
  await loaded();
  await s.page.waitForTimeout(1500);
  await loaded();
  return s;
}

const closeDialogs = (page) => page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).forEach((d) => d.close()));

/* La lista del diálogo, tal como la lee una persona: nombre, casilla, estado y motivo. */
async function listed(page){
  await page.locator('#btnAutomations').click();
  await page.locator('#autoBody .auto-rule').first().waitFor({timeout:30000});
  return page.evaluate(() => Array.from(document.querySelectorAll('#autoBody .auto-rule')).map((li) => {
    const box = li.querySelector('input[type="checkbox"]');
    const described = (box.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).map((id) => (document.getElementById(id) || {}).textContent || '');
    return {name:li.querySelector('b').textContent, status:li.getAttribute('data-status'), label:li.querySelector('.auto-status').textContent,
      checked:box.checked, disabled:box.disabled, described:described.join(' | '), why:(li.querySelector('.auto-broken') || {}).textContent || '',
      editable:!!li.querySelector('[data-auto="edit"]')};
  }));
}
const byName = (rows, name) => rows.find((r) => r.name === name);

(async () => {
  await ready();
  const cron = await import(pathToFileURL(path.join(root, 'worker/automations.mjs')).href);
  const env = {FIRESTORE_EMULATOR_HOST:storeHost, FIREBASE_PROJECT:'demo-workhub'};
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    /* ---------- la propietaria crea el proyecto y lo convierte en equipo ---------- */
    const ownerEmail = 'ana-auto-' + stamp + '@example.test';
    const editorEmail = 'luis-auto-' + stamp + '@example.test';
    let owner = await signUp(browser, 'Ana Propietaria', ownerEmail);
    let page = owner.page;
    await page.locator('#pNombre').fill('Equipo con reglas');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.waitForFunction(() => Workhub.app.models.tasks.isReady());
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#dlgShare').waitFor({state:'visible'});
    await page.locator('#shConvert').click();
    await page.waitForFunction(() => String(Workhub.app.projectId).indexOf('t:') === 0 && Workhub.app.models.tasks.isReady(), null, {timeout:60000});
    const tid = await page.evaluate(() => Workhub.models.ProjectModel.teamId(Workhub.app.projectId));
    const base = 'teams/' + tid;

    /* Invita al editor. */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shEmail').waitFor({state:'visible', timeout:15000});
    await page.locator('#shEmail').fill(editorEmail);
    await page.locator('#shRole').selectOption('editor');
    await page.locator('#shInviteBtn').click();
    assert.equal((await storedWhen('invites/' + tid + '_' + editorEmail, (res) => res.status === 200)).status, 200, 'la invitación está guardada');
    await closeDialogs(page);

    const editor = await signUp(browser, 'Luis Editor', editorEmail);
    const ep = editor.page;
    await ep.locator('#pInvites [data-invite="accept"]').click({timeout:30000});
    await ep.waitForFunction((key) => Workhub.app.projectId === key && Workhub.app.models.tasks.isReady(), 't:' + tid, {timeout:30000});
    await page.waitForFunction((uid) => Workhub.views.team.members().some((m) => m.uid === uid), editor.uid, {timeout:30000});

    /* ---------- la propietaria deja tres reglas y una tarea ---------- */
    const made = await page.evaluate(async () => {
      const app = Workhub.app, c = app.controllers.automations, S = Workhub.models.TaskModel.STATUS;
      await c.load(true);
      const until = async (n) => { for(let i = 0; i < 100 && c.rules.length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
      c.saveRule({id:'', name:'Enviar a revisión', trigger:{type:'button'}, cond:{}, actions:[{type:'move', stage:S[1].key}]});
      await until(1);
      c.saveRule({id:'', name:'Preparar', trigger:{type:'moved', stage:S[1].key}, cond:{}, actions:[{type:'subtask', text:'Revisar'}]});
      await until(2);
      c.saveRule({id:'', name:'Entrega cerca', trigger:{type:'due', days:1}, cond:{}, actions:[{type:'subtask', text:'Preparar la entrega'}]});
      await until(3);
      const ref = await app.models.tasks.save(null, {title:'Tarea del equipo', desc:'', status:S[0].key, cliente:'', contacto:'', dueDate:'', labels:[], checklist:[]});
      return {task:ref.id, first:S[0].key, second:S[1].key, secondLabel:S[1].label, third:S[2].key, thirdLabel:S[2].label, rules:c.rules.length};
    });
    assert.equal(made.rules, 3, 'las tres reglas se guardan');
    const rulesDoc = base + '/plugin_data/kanlane.automations';
    const hasAll = (res) => ['Enviar a revisión', 'Preparar', 'Entrega cerca'].every((n) => res.text.indexOf(n) !== -1);
    assert.ok(hasAll(await storedWhen(rulesDoc, hasAll)), 'están en el equipo');
    const jobPath = 'automation_jobs/t~' + tid;
    const job = await storedWhen(jobPath, (res) => res.status === 200);
    assert.equal(job.status, 200, 'la propietaria deja la copia de la regla por fecha para el servidor');
    assert.ok(job.text.indexOf(owner.uid) !== -1 && job.text.indexOf('Enviar a revisión') === -1, 'a su nombre y sin los botones');

    /* ---------- el editor: ve, ejecuta, pero no cambia ---------- */
    await ep.locator('.card').filter({hasText:'Tarea del equipo'}).waitFor({timeout:30000});
    let rows = await listed(ep);
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Entrega cerca', 'Enviar a revisión', 'Preparar']);
    assert.ok(rows.every((r) => r.disabled && !r.editable && r.status === 'active' && r.label === 'Activa'), 'casillas bloqueadas y sin botones de editar: ' + JSON.stringify(rows));
    assert.equal(await ep.locator('#btnAutoNew').isVisible(), false, 'sin «Nueva automatización»');
    await ep.locator('#autoBody .auto-note').filter({hasText:'Solo quien es propietario del equipo puede crear o cambiar las automatizaciones.'}).waitFor();
    assert.equal(await ep.locator('#autoBody [data-auto="use"]').count(), 0, 'ni ejemplos para activar');
    await ep.locator('#btnAutoClose').click();

    /* Por la interfaz, saltándose los botones: el controlador no hace nada. */
    const viaController = await ep.evaluate(async () => {
      const c = Workhub.app.controllers.automations;
      const before = JSON.stringify(c.rules);
      c.saveRule({id:'', name:'Colada', trigger:{type:'completed'}, cond:{}, actions:[{type:'subtask', text:'x'}]});
      c.toggle(c.rules[0].id, false);
      c.remove(c.rules[1].id);
      c.edit(c.rules[0].id);
      await new Promise((r) => setTimeout(r, 800));
      return {same:JSON.stringify(c.rules) === before, canManage:c.canManage(), canRun:c.canRun(), form:!!document.getElementById('autoForm')};
    });
    assert.deepEqual(viaController, {same:true, canManage:false, canRun:true, form:false});

    /* Escritura directa en Firestore con las credenciales del editor: lo rechazan las reglas. */
    const direct = await ep.evaluate(async (tid) => {
      const app = Workhub.app, c = app.controllers.automations, me = app.rootDb.me.uid;
      const outcome = (p) => p.then(() => 'escrito', (e) => (e && e.code) || 'rechazado');
      const rules = c.bucket('kanlane.automations');
      const state = c.bucket('kanlane.automations.state');
      const job = app.rootDb.jobs.doc('t~' + tid);
      const forged = {v:1, kind:'t', tid:tid, tz:'UTC', rules:[{id:'x'}], ctx:{stages:[], labels:[], members:[], team:true}, updatedAt:Date.now()};
      return {
        rules: await outcome(rules.write({rules:'[]'})),
        jobMine: await outcome(job.set(Object.assign({uid:me}, forged))),
        jobAsOwner: await outcome(job.set(Object.assign({uid:'otra'}, forged))),
        jobDelete: await outcome(job.delete()),
        jobRead: await outcome(job.get()),
        marks: await outcome(state.write({fired:'{}'})),
        readRules: await outcome(rules.read())
      };
    }, tid);
    assert.deepEqual(direct, {rules:'permission-denied', jobMine:'permission-denied', jobAsOwner:'permission-denied', jobDelete:'permission-denied',
      jobRead:'permission-denied', marks:'escrito', readRules:'escrito'}, 'el editor solo lee las reglas y apunta marcas');
    assert.ok(hasAll(await stored(rulesDoc)), 'las reglas siguen como las dejó la propietaria');
    assert.ok((await stored(jobPath)).text.indexOf(owner.uid) !== -1, 'y la copia del servidor también');

    /* El editor pulsa el botón: se ejecuta una vez, encadena y queda apuntado. */
    await ep.locator('.card').filter({hasText:'Tarea del equipo'}).click();
    await ep.locator('#tvAutoButtons button').filter({hasText:'Enviar a revisión'}).click();
    await ep.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Botón «Enviar a revisión»: movió la tarea a «' + made.secondLabel + '»'}).waitFor({timeout:30000});
    await ep.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Automatización «Preparar»: añadió la subtarea «Revisar»'}).waitFor({timeout:30000});
    await ep.locator('#btnTvClose').click();
    /* El navegador de la propietaria recibe el cambio y NO vuelve a ejecutar nada. */
    await page.locator('.card').filter({hasText:'Tarea del equipo'}).waitFor();
    await page.waitForFunction((id) => { const t = Workhub.app.models.tasks.find(id); return t && (t.checklist || []).length === 1; }, made.task, {timeout:30000});
    await sleep(4500);
    const notesPath = base + '/tasks/' + made.task + '/notes';
    let notes = (await stored(notesPath)).text;
    assert.equal(times(notes, 'Botón «Enviar a revisión»'), 1, 'una sola línea del botón');
    assert.equal(times(notes, 'Automatización «Preparar»'), 1, 'una sola línea de la regla encadenada');
    assert.equal(times((await stored(base + '/tasks/' + made.task)).text, '"Revisar"'), 1, 'una sola subtarea');

    /* ---------- el servidor no ejecuta una copia que no sea de la propietaria ---------- */
    const forgedJob = {v:1, kind:'t', uid:editor.uid, tid:tid, tz:'UTC', updatedAt:Date.now(),
      rules:[{id:'colada', name:'Colada', on:true, trigger:{type:'due', days:365}, cond:{}, actions:[{type:'subtask', text:'Colada por el servidor'}]}],
      ctx:{stages:[{key:made.first, label:'A'}, {key:made.second, label:'B'}], labels:[], members:[], team:true}};
    const put = await fetch(storeUrl + jobPath, {method:'PATCH', headers:{Authorization:'Bearer owner', 'Content-Type':'application/json'}, body:JSON.stringify({fields:cron.encodeFields(forgedJob)})});
    assert.equal(put.status, 200, 'la copia falsa se coloca como administrador (las reglas no la dejarían)');
    const ranForged = await cron.run(env, {now:() => Date.now()});
    assert.equal(ranForged.results.find((r) => r.id === 't~' + tid).status, 'not-owner');
    assert.equal((await stored(jobPath)).status, 404, 'el servidor borra la copia');
    assert.equal(times((await stored(base + '/tasks/' + made.task)).text, 'Colada por el servidor'), 0, 'y no toca las tareas');
    /* La propietaria vuelve a dejar la suya al cargar las reglas. */
    await page.evaluate(() => Workhub.app.controllers.automations.load(true));
    assert.ok((await storedWhen(jobPath, (res) => res.status === 200 && res.text.indexOf('Entrega cerca') !== -1)).text.indexOf(owner.uid) !== -1);

    /* ---------- borrar una columna: avisa de las reglas que quedarán en pausa ---------- */
    await page.locator('[data-col-menu="' + made.second + '"]').click();
    await page.locator('[role="menuitem"][data-act="remove"]').click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    const warn = page.locator('#confirmWarn');
    await warn.waitFor({state:'visible'});
    const warnText = await warn.textContent();
    assert.match(warnText, /^2 automatizaciones dejarán de poder ejecutarse y quedarán en pausa hasta que alguien con permiso las edite: /);
    assert.ok(warnText.indexOf('«Enviar a revisión»') !== -1 && warnText.indexOf('«Preparar»') !== -1 && warnText.indexOf('Entrega cerca') === -1, warnText);
    /* Cancelar no cambia nada. */
    await page.locator('#btnConfirmCancel').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    assert.equal(await page.evaluate((key) => Workhub.models.TaskModel.STATUS.some((s) => s.key === key), made.second), true);
    /* Una columna que ninguna regla usa no lleva aviso. */
    await page.locator('[data-col-menu="' + made.third + '"]').click();
    await page.locator('[role="menuitem"][data-act="remove"]').click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    assert.equal(await warn.isVisible(), false, 'sin aviso si no hay reglas afectadas');
    await page.locator('#btnConfirmCancel').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    /* Lo mismo al guardar «Editar proyecto» sin esa columna: confirma antes, con el mismo aviso. */
    const stagesBefore = await page.evaluate(() => Workhub.models.TaskModel.STATUS.map((s) => s.key));
    await page.evaluate((key) => {
      const app = Workhub.app, PT = Workhub.models.ProjectTemplates, p = app.models.projects.get(app.projectId), cfg = app.models.projects.configOf(p);
      app.controllers.projects.save(p.id, p.nombre, typeof p.color === 'number' ? p.color : null, PT.fieldsFor(PT.CUSTOM_TYPE, cfg.stages.filter((s) => s.key !== key), cfg.clients));
    }, made.second);
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    assert.equal(await page.locator('#confirmTitle').textContent(), 'Quitar una columna');
    assert.equal(await page.locator('#confirmText').textContent(), 'El proyecto se guardará sin la columna «' + made.secondLabel + '».');
    assert.equal(await warn.textContent(), warnText, 'el mismo aviso que desde el tablero');
    await page.locator('#btnConfirmCancel').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    await sleep(800);
    assert.deepEqual(await page.evaluate(() => Workhub.models.TaskModel.STATUS.map((s) => s.key)), stagesBefore, 'al cancelar, el proyecto no se guarda');
    /* Y guardar sin quitar ninguna columna no pregunta nada. */
    await page.evaluate(() => {
      const app = Workhub.app, PT = Workhub.models.ProjectTemplates, p = app.models.projects.get(app.projectId), cfg = app.models.projects.configOf(p);
      app.controllers.projects.save(p.id, p.nombre, typeof p.color === 'number' ? p.color : null, PT.fieldsFor(PT.CUSTOM_TYPE, cfg.stages, cfg.clients));
    });
    await sleep(1200);
    assert.equal(await page.locator('#dlgConfirm').isVisible(), false);

    /* Ahora sí. */
    await page.locator('[data-col-menu="' + made.second + '"]').click();
    await page.locator('[role="menuitem"][data-act="remove"]').click();
    await warn.waitFor({state:'visible'});
    await page.locator('#btnConfirmOk').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    await page.waitForFunction((key) => !Workhub.models.TaskModel.STATUS.some((s) => s.key === key), made.second, {timeout:30000});

    /* ---------- en pausa: se lee con palabras y la casilla sigue marcada ---------- */
    const expectPaused = (list, who) => {
      const button = byName(list, 'Enviar a revisión'), chained = byName(list, 'Preparar'), due = byName(list, 'Entrega cerca');
      assert.deepEqual([button.status, button.label, button.checked], ['paused', 'En pausa', true], who + ': ' + JSON.stringify(button));
      assert.deepEqual([chained.status, chained.label, chained.checked], ['paused', 'En pausa', true], who);
      assert.deepEqual([due.status, due.label, due.checked, due.why], ['active', 'Activa', true, ''], who);
      assert.ok(button.why.indexOf('No se ejecuta: la columna «' + made.secondLabel + '» ya no existe.') === 0, who + ': ' + button.why);
      assert.ok(button.described.indexOf('En pausa') !== -1 && button.described.indexOf('la columna «' + made.secondLabel + '» ya no existe') !== -1, 'la casilla lleva el estado y el motivo como descripción: ' + button.described);
      assert.equal(due.described, 'Activa');
    };
    rows = await listed(page);
    expectPaused(rows, 'propietaria');
    assert.ok(byName(rows, 'Preparar').why.indexOf('Edítala para arreglarlo.') !== -1);
    await page.locator('#autoBody .auto-note').filter({hasText:'Una automatización marcada puede estar en pausa'}).waitFor();
    /* El estado no depende solo del color: hay texto visible en cada fila. */
    assert.equal(await page.locator('#autoBody .auto-rule .auto-status:visible').count(), 3);
    /* Desactivarla a propósito es otro estado; volver a marcarla la deja en pausa, no activa. */
    const pausedBox = page.locator('#autoBody .auto-rule:has(b:text-is("Preparar"))').locator('input[type="checkbox"]');
    await pausedBox.focus();
    await page.keyboard.press('Space');
    await page.locator('#autoBody .auto-rule[data-status="off"]:has(b:text-is("Preparar"))').waitFor();
    let off = byName(await page.evaluate(() => Array.from(document.querySelectorAll('#autoBody .auto-rule')).map((li) => ({name:li.querySelector('b').textContent,
      label:li.querySelector('.auto-status').textContent, why:(li.querySelector('.auto-broken') || {}).textContent || ''}))), 'Preparar');
    assert.equal(off.label, 'Desactivada');
    assert.ok(off.why.indexOf('Aunque la actives no se ejecutará: la columna «' + made.secondLabel + '» ya no existe.') === 0, off.why);
    await page.locator('#autoBody .auto-rule:has(b:text-is("Preparar"))').locator('input[type="checkbox"]').focus();
    await page.keyboard.press('Space');
    await page.locator('#autoBody .auto-rule[data-status="paused"]:has(b:text-is("Preparar"))').waitFor();
    /* Móvil: el diálogo cabe. */
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'automatizaciones sin desbordamiento en móvil');
    assert.equal(await page.evaluate(() => { const d = document.getElementById('dlgAutomations'); return d.scrollWidth > d.clientWidth + 1; }), false, 'ni dentro del diálogo');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#btnAutoClose').click();
    /* El botón deja de salir en la ficha, para las dos cuentas. */
    await page.locator('.card').filter({hasText:'Tarea del equipo'}).click();
    await page.locator('#tvChecklist').getByText('Revisar', {exact:true}).waitFor();
    assert.equal(await page.locator('#tvAutoButtons button').count(), 0);
    await page.locator('#btnTvClose').click();
    await ep.waitForFunction((key) => !Workhub.models.TaskModel.STATUS.some((s) => s.key === key), made.second, {timeout:30000});
    expectPaused(await listed(ep), 'editor');
    assert.equal(await ep.locator('#autoBody .auto-broken').filter({hasText:'Edítala para arreglarlo.'}).count(), 0, 'al editor no se le pide que la edite: no puede');
    await ep.locator('#btnAutoClose').click();

    /* ---------- recarga sin caché y sesión nueva ---------- */
    const cdp = await owner.context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', {cacheDisabled:true});
    await cdp.send('Network.setBypassServiceWorker', {bypass:true});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#btnNew').waitFor({state:'visible', timeout:30000});
    await page.waitForFunction(() => Workhub.app.models.tasks.isReady(), null, {timeout:30000});
    expectPaused(await listed(page), 'propietaria tras recargar sin caché');
    await page.locator('#btnAutoClose').click();
    assert.deepEqual(owner.errors, [], 'sin excepciones JavaScript (propietaria)');
    await owner.context.close();
    owner = Object.assign(await signIn(browser, ownerEmail), {uid:owner.uid});
    page = owner.page;
    expectPaused(await listed(page), 'propietaria en una sesión nueva');

    /* ---------- recuperar una regla en pausa editándola ---------- */
    await page.locator('#autoBody .auto-rule:has(b:text-is("Preparar"))').locator('[data-auto="edit"]').click();
    await page.locator('#autoForm').waitFor();
    const lost = await page.evaluate(() => { const s = document.getElementById('autoStage'); return {value:s.value, text:s.options[s.selectedIndex].textContent}; });
    assert.deepEqual(lost, {value:made.second, text:made.secondLabel + ' (ya no existe)'}, 'la columna borrada sigue elegida, con su nombre');
    /* Guardar sin elegir otra no la arregla a escondidas. */
    await page.locator('#autoForm button[type="submit"]').click();
    await page.locator('#autoError').filter({hasText:'No se puede guardar: la columna «' + made.secondLabel + '» ya no existe.'}).waitFor();
    await page.evaluate((key) => { const s = document.getElementById('autoStage'); s.value = key; s.dispatchEvent(new Event('change', {bubbles:true})); }, made.third);
    await page.locator('#autoForm button[type="submit"]').click();
    await page.locator('#autoBody .auto-rule[data-status="active"]:has(b:text-is("Preparar"))').waitFor({timeout:30000});
    const fixed = byName(await page.evaluate(() => Array.from(document.querySelectorAll('#autoBody .auto-rule')).map((li) => ({name:li.querySelector('b').textContent, text:li.textContent}))), 'Preparar');
    assert.ok(fixed.text.indexOf('se mueve a «' + made.thirdLabel + '»') !== -1, 'la regla apunta a la columna nueva: ' + fixed.text);
    const savedRules = await storedWhen(rulesDoc, (res) => res.text.indexOf(made.thirdLabel) !== -1);
    assert.ok(savedRules.text.indexOf(made.thirdLabel) !== -1, 'y guarda su nombre con ella');

    /* Renombrar una columna: la regla sigue activa y dice el nombre nuevo; el guardado se pone al día. */
    await page.locator('#btnAutoClose').click();
    await page.evaluate((key) => Workhub.app.controllers.projects.updateStages((stages) => { stages.find((s) => s.key === key).label = 'Validación'; }), made.third);
    await page.evaluate(() => Workhub.app.controllers.automations.load(true));
    rows = await listed(page);
    assert.equal(byName(rows, 'Preparar').status, 'active');
    assert.ok((await page.locator('#autoBody .auto-rule:has(b:text-is("Preparar"))').textContent()).indexOf('se mueve a «Validación»') !== -1);
    assert.ok((await storedWhen(rulesDoc, (res) => res.text.indexOf('Validación') !== -1)).text.indexOf('Validación') !== -1, 'el nombre guardado se renueva al cargar');
    await page.locator('#btnAutoClose').click();

    /* ---------- quitar a una persona: avisa de la regla que la usa ---------- */
    await page.evaluate(async (uid) => {
      const c = Workhub.app.controllers.automations;
      const n = c.rules.length;
      c.saveRule({id:'', name:'Dar a Luis', trigger:{type:'completed'}, cond:{}, actions:[{type:'assign', uid:uid}]});
      for(let i = 0; i < 100 && c.rules.length === n; i++) await new Promise((r) => setTimeout(r, 100));
    }, editor.uid);
    assert.ok((await storedWhen(rulesDoc, (res) => res.text.indexOf('Dar a Luis') !== -1)).text.indexOf('Luis Editor') !== -1, 'la regla guarda el nombre de la persona');
    /* El editor conserva una referencia directa a los documentos, para probarla después de salir. */
    await ep.evaluate(() => {
      const c = Workhub.app.controllers.automations;
      window.__auto = {rules:c.bucket('kanlane.automations'), state:c.bucket('kanlane.automations.state')};
    });
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#dlgShare [data-act="remove"][data-uid="' + editor.uid + '"]').click({timeout:15000});
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    await page.locator('#confirmWarn').waitFor({state:'visible'});
    assert.equal(await page.locator('#confirmWarn').textContent(), 'La automatización «Dar a Luis» dejará de poder ejecutarse: quedará en pausa hasta que alguien con permiso la edite.');
    await page.locator('#btnConfirmOk').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    assert.ok((await storedWhen(base, (res) => res.text.indexOf(editor.uid) === -1)).text.indexOf(editor.uid) === -1, 'el editor ya no está en el equipo');
    await closeDialogs(page);
    await page.waitForFunction((uid) => !Workhub.views.team.members().some((m) => m.uid === uid), editor.uid, {timeout:30000});
    rows = await listed(page);
    const gave = byName(rows, 'Dar a Luis');
    assert.deepEqual([gave.status, gave.label, gave.checked], ['paused', 'En pausa', true]);
    assert.ok(gave.why.indexOf('No se ejecuta: Luis Editor ya no está en el proyecto.') === 0, gave.why);
    /* Al editarla, la persona que ya no está sigue en la lista, con su nombre. */
    await page.locator('#autoBody .auto-rule:has(b:text-is("Dar a Luis"))').locator('[data-auto="edit"]').click();
    await page.locator('#autoForm').waitFor();
    assert.equal(await page.evaluate(() => { const s = document.querySelector('#autoBody .auto-a-val'); return s.options[s.selectedIndex].textContent; }), 'Luis Editor (ya no existe)');
    await page.locator('#autoForm [data-auto="cancel"]').click();
    await page.locator('#btnAutoClose').click();
    /* Quien ha salido ya no lee las reglas ni apunta marcas, ni con la referencia que guardó. */
    const after = await ep.evaluate(async () => {
      const outcome = (p) => p.then(() => 'hecho', (e) => (e && e.code) || 'rechazado');
      return {read:await outcome(window.__auto.rules.read()), marks:await outcome(window.__auto.state.write({fired:'{}'})), write:await outcome(window.__auto.rules.write({rules:'[]'}))};
    });
    assert.deepEqual(after, {read:'permission-denied', marks:'permission-denied', write:'permission-denied'});
    await editor.context.close();

    /* ---------- nada se ha repetido en todo el recorrido ---------- */
    await sleep(4000);
    notes = (await stored(notesPath)).text;
    assert.equal(times(notes, 'Botón «Enviar a revisión»'), 1, 'la línea del botón sigue siendo una');
    assert.equal(times(notes, 'Automatización «Preparar»'), 1, 'y la de la regla encadenada');
    assert.deepEqual(owner.errors, [], 'sin excepciones JavaScript (propietaria, sesión nueva)');
    assert.deepEqual(editor.errors, [], 'sin excepciones JavaScript (editor)');
    await owner.context.close();

    /* ---------- en inglés y en móvil ---------- */
    const en = await signIn(browser, ownerEmail, {locale:'en-US', viewport:{width:375, height:812}});
    /* El idioma va con la cuenta: se cambia como lo haría la persona en Ajustes (la app se recarga). */
    await Promise.all([
      en.page.waitForEvent('load'),
      en.page.evaluate(() => Workhub.app.models.settings.setLang('en').then(() => Workhub.i18n.setLang('en')))
    ]);
    await en.page.locator('#btnNew').waitFor({state:'visible', timeout:30000});
    await en.page.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()) && Workhub.i18n.lang === 'en', null, {timeout:30000});
    await en.page.evaluate(() => Workhub.app.controllers.automations.open());
    await en.page.locator('#autoBody .auto-rule').first().waitFor({timeout:30000});
    const english = await en.page.evaluate(() => Array.from(document.querySelectorAll('#autoBody .auto-rule')).map((li) => ({name:li.querySelector('b').textContent,
      label:li.querySelector('.auto-status').textContent, why:(li.querySelector('.auto-broken') || {}).textContent || ''})));
    assert.equal(byName(english, 'Dar a Luis').label, 'Paused');
    assert.ok(byName(english, 'Dar a Luis').why.indexOf('Not running: Luis Editor is no longer in the project.') === 0, byName(english, 'Dar a Luis').why);
    assert.ok(byName(english, 'Dar a Luis').why.indexOf('Edit it to fix this.') !== -1);
    assert.equal(byName(english, 'Entrega cerca').label, 'Active');
    assert.equal(byName(english, 'Enviar a revisión').label, 'Paused');
    assert.ok(/the column “.+” no longer exists/.test(byName(english, 'Enviar a revisión').why), byName(english, 'Enviar a revisión').why);
    assert.equal(await en.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'sin desbordamiento en móvil, en inglés');
    assert.equal(await en.page.evaluate(() => /[áéíóúñ¿¡]/i.test(Array.from(document.querySelectorAll('#autoBody .auto-status, #autoBody .auto-broken, #autoBody .auto-note')).map((n) => n.textContent).join(' '))), false, 'ningún texto de estado se queda en español');
    assert.deepEqual(en.errors, [], 'sin excepciones JavaScript (inglés)');
    await en.context.close();

    console.log('OK   Firebase emulado: automatizaciones de un equipo con propietaria y editor, avisos de borrado, pausa, recuperación y persistencia');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
