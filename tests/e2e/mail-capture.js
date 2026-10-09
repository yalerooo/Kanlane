/* Captura de tareas por correo, de extremo a extremo, con Auth y Firestore emulados y las reglas
   reales. Todo ocurre en cuentas y proyectos creados para la prueba.

   Qué es real aquí: la pantalla, la ruta de gestión (el mismo worker/capture.mjs, servido por
   scripts/dev.js), la escritura en Firestore por su API REST y la lectura desde la app.
   Qué no: la entrega. Los correos no pasan por Cloudflare Email Routing; la prueba llama al
   mismo `receive` que llama el Worker, con mensajes montados y firmados con una clave DKIM de
   prueba cuyo registro DNS se sirve desde aquí. La entrega real se comprueba aparte
   (docs/CAPTURA-EMAIL.md, «Comprobación en producción»). */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {buildMail, dkimSign, dkimKey, message} = require('../worker/mail-fixtures.js');

const root = path.resolve(__dirname, '../..');
const port = 58654;
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
/* El mismo entorno que scripts/dev.js da a la ruta de gestión. */
const ENV = {FIRESTORE_EMULATOR_HOST:storeHost, FIREBASE_PROJECT:'demo-workhub', CAPTURE_SECRET:Buffer.alloc(32, 9).toString('base64'),
  CAPTURE_DOMAINS:'in.kanlane.test,respaldo.kanlane.test', CAPTURE_PLAN:'paid'};
const keys = {'ejemplo.test':dkimKey(), 'otra.test':dkimKey()};

async function ready(){
  for(let i = 0; i < 300; i++){
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
  const response = await fetch(storeUrl + docPath + (docPath.indexOf('?') === -1 ? '?pageSize=300' : ''), {headers:{Authorization:'Bearer owner'}});
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
  await page.getByRole('button', {name:'Ya lo he verificado'}).click();
  await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
  s.uid = await page.evaluate(() => Workhub.app.rootDb.me.uid);
  s.email = email;
  return s;
}

async function signIn(browser, email, opts){
  const s = await open(browser, opts);
  await s.page.locator('#authEmail').fill(email);
  await s.page.locator('#authPass').fill(PASSWORD);
  await s.page.locator('#authSubmit').click();
  await s.page.locator('#btnNew').waitFor({state:'visible', timeout:30000});
  const loaded = () => s.page.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()), null, {timeout:30000});
  await loaded();
  await s.page.waitForTimeout(1500);
  await loaded();
  return s;
}

const closeDialogs = (page) => page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).forEach((d) => d.close()));
const card = (page, title) => page.locator('.card').filter({hasText:title});

/* Abre el diálogo de automatizaciones y espera a que el apartado de correo tenga respuesta del servidor. */
async function openCapture(page){
  await closeDialogs(page);
  await page.locator('#btnAutomations').click();
  await page.locator('#autoBody .cap').waitFor({timeout:30000});
  await page.waitForFunction(() => { const c = document.querySelector('#autoBody .cap'); return c && c.textContent.indexOf('Cargando') === -1 && c.textContent.indexOf('Loading') === -1; }, null, {timeout:30000});
}
const address = (page) => page.locator('#capAddress').inputValue();

(async () => {
  await ready();
  const capture = await import(pathToFileURL(path.join(root, 'worker/capture.mjs')).href);
  const deps = {resolveTxt:async (name) => { const d = name.replace('sel._domainkey.', ''); return keys[d] ? [keys[d].txt] : []; }, log:() => {}};
  /* «Envía» un correo: lo monta, lo firma con la clave del dominio de su From y se lo da a receive. */
  async function send(to, o, opts){
    const x = opts || {};
    let raw = buildMail(Object.assign({to:to}, o));
    const domain = x.signAs || o.from.split('@')[1].replace('>', '');
    if(x.sign !== false) raw = dkimSign(raw, {domain:domain, key:keys[domain].key, time:Math.floor(Date.now() / 1000)});
    const msg = message(raw, to);
    const out = await capture.receive(msg, ENV, deps);
    return Object.assign({rejected:msg.rejected}, out);
  }

  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    /* ---------- cuenta y proyecto personal ---------- */
    const ownerEmail = 'ana-' + stamp + '@ejemplo.test';
    let owner = await signUp(browser, 'Ana Correo', ownerEmail);
    let page = owner.page;
    await page.locator('#pNombre').fill('Proyecto con correo');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.waitForFunction(() => Workhub.app.models.tasks.isReady());
    const info = await page.evaluate(() => ({pid:Workhub.app.projectId, stages:Workhub.models.TaskModel.STATUS.map((s) => ({key:s.key, label:s.label}))}));
    const base = 'users/' + owner.uid + (info.pid === 'main' ? '' : '/projects/' + info.pid);

    /* ---------- activar desde la pantalla, con el teclado ---------- */
    await openCapture(page);
    await page.locator('#autoBody .cap').getByText('Activa una dirección de correo para este proyecto').waitFor();
    assert.equal(await page.locator('#capAddress').count(), 0, 'desactivada: no hay dirección');
    await page.locator('#autoBody [data-auto="cap-enable"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('#capAddress').waitFor({timeout:30000});
    const first = await address(page);
    assert.match(first, /^[a-z2-7]{32}@in\.kanlane\.test$/);
    await page.locator('#capNote').getByText('Dirección de correo activada.').waitFor();
    assert.ok((await page.locator('#autoBody .cap-alt').textContent()).indexOf(first.replace('in.kanlane.test', 'respaldo.kanlane.test')) !== -1, 'enseña la dirección de respaldo');
    assert.ok((await page.locator('#autoBody .cap').textContent()).indexOf('Tú envías desde: ' + ownerEmail) !== -1, 'dice desde qué correo hay que enviar');
    await page.locator('#autoBody .cap').getByText('Trátala como una contraseña').waitFor();
    await page.locator('#autoBody .cap').getByText('El correo pasa sin cifrar por Cloudflare y por el servidor de Kanlane').waitFor();
    assert.equal(await page.locator('#capAddress').getAttribute('aria-describedby'), 'capSecret');
    assert.equal(await page.locator('label[for="capAddress"]').count(), 1, 'cada campo tiene su etiqueta');
    assert.equal(await page.locator('label[for="capStage"]').count() + await page.locator('label[for="capAllow"]').count(), 2);
    /* Móvil: cabe. */
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'sin desbordamiento en móvil');
    assert.equal(await page.evaluate(() => { const d = document.getElementById('dlgAutomations'); return d.scrollWidth > d.clientWidth + 1; }), false, 'ni dentro del diálogo');
    await page.setViewportSize({width:1280, height:850});
    /* La dirección no está guardada en ningún documento, ni en los que el cliente no puede leer. */
    const local = first.split('@')[0];
    const serverDocs = (await stored('mail_capture')).text + (await stored('mail_capture_cfg')).text;
    assert.ok(serverDocs.indexOf(owner.uid) !== -1, 'hay configuración de captura para esta cuenta');
    assert.ok(serverDocs.indexOf(local) === -1 && serverDocs.indexOf(local.slice(16)) === -1, 'sin la dirección ni su mitad secreta');
    assert.ok(((await stored(base + '/plugin_data')).text + (await stored('users/' + owner.uid + '/settings')).text).indexOf(local) === -1, 'tampoco en los datos del proyecto');
    /* Y el cliente no puede leer esas colecciones aunque lo intente con su sesión. */
    const direct = await page.evaluate(async () => {
      const fs = firebase.firestore();
      const outcome = (p) => p.then(() => 'leído', (e) => (e && e.code) || 'rechazado');
      return {cfg:await outcome(fs.collection('mail_capture_cfg').doc('u~' + Workhub.app.rootDb.me.uid + '~' + Workhub.app.projectId).get()),
        all:await outcome(fs.collection('mail_capture').get()), seen:await outcome(fs.collection('mail_seen').get())};
    });
    assert.deepEqual(direct, {cfg:'permission-denied', all:'permission-denied', seen:'permission-denied'});
    await page.locator('#btnAutoClose').click();

    /* ---------- un correo válido crea una tarea, con la app abierta ---------- */
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), nodeCrypto.randomBytes(900000)]);
    const good = await send(first, {from:'Ana <' + ownerEmail + '>', subject:'=?utf-8?B?' + Buffer.from('Revisar el presupuesto de otoño').toString('base64') + '?=', messageId:'uno-' + stamp + '@ejemplo.test',
      text:'Hola:\r\n\r\nHay que enviarlo el viernes.\r\n[Pulsa aquí](https://malo.test) <script>alert(1)</script>',
      attachments:[{name:'presupuesto.pdf', type:'application/pdf', data:pdf}, {name:'instalar.exe', data:'MZ\x90\x00'}]});
    assert.deepEqual([good.result, good.rejected, good.files, good.refused], ['created', null, 1, 1], JSON.stringify(good));
    await card(page, 'Revisar el presupuesto de otoño').waitFor({timeout:30000});
    assert.equal(await page.evaluate((id) => Workhub.models.TaskModel.stageKey(Workhub.app.models.tasks.find(id)), good.taskId), info.stages[0].key, 'en la primera columna');
    await card(page, 'Revisar el presupuesto de otoño').click();
    await page.locator('#tvTitle').getByText('Revisar el presupuesto de otoño').waitFor();
    const desc = await page.locator('#tvDesc').textContent();
    assert.ok(desc.indexOf('Hay que enviarlo el viernes.') !== -1, desc);
    assert.ok(desc.indexOf('<script>alert(1)</script>') !== -1, 'el HTML del correo se ve como texto');
    assert.equal(await page.locator('#tvDesc script').count() + await page.locator('#tvDesc img').count(), 0, 'nada activo ni imágenes en la descripción');
    assert.equal(await page.locator('#tvDesc a[href*="malo.test"]').filter({hasText:'Pulsa aquí'}).count(), 0, 'ningún enlace con el texto disfrazado');
    await page.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Creada desde un correo de ' + ownerEmail + '.'}).waitFor();
    await page.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Adjuntos del correo que no se guardaron: instalar.exe (tipo no permitido).'}).waitFor();
    await page.locator('#tvNotes .att-file-name').getByText('presupuesto.pdf').waitFor();
    assert.equal(await page.locator('#tvNotes .att-file').count(), 1, 'solo el adjunto admitido');
    /* El adjunto se descarga entero desde la app, con sus bytes exactos. */
    const got = await page.evaluate(async () => {
      const el = document.querySelector('#tvNotes .att-file');
      const blob = await Workhub.services.platform.fileBlob({parts:el.getAttribute('data-att-parts').split(','), type:el.getAttribute('data-att-type')});
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return {size:bytes.length, hash:Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')};
    });
    assert.deepEqual(got, {size:pdf.length, hash:nodeCrypto.createHash('sha256').update(pdf).digest('hex')});
    /* La app puede seguir editando la tarea (lleva solo campos que las reglas admiten). */
    assert.equal(await page.evaluate((id) => Workhub.app.models.tasks.update(id, {dueDate:'2027-01-15', updatedAt:Date.now()}).then(() => 'ok', (e) => e.code), good.taskId), 'ok');
    await page.locator('#btnTvClose').click();

    /* ---------- duplicados y remitentes sin permiso ---------- */
    const again = await send(first, {from:'Ana <' + ownerEmail + '>', subject:'Fwd: Revisar el presupuesto', messageId:'uno-' + stamp + '@ejemplo.test', text:'reintento'});
    assert.deepEqual([again.result, again.code], ['dropped', 'duplicate']);
    const stranger = await send(first, {from:'Eva <eva@otra.test>', subject:'De una extraña con firma válida', text:'x'});
    assert.deepEqual([stranger.result, stranger.code], ['rejected', 'sender-member']);
    const spoof = await send(first, {from:'Ana <' + ownerEmail + '>', subject:'Suplantando a la dueña', text:'x'}, {signAs:'otra.test'});
    assert.deepEqual([spoof.result, spoof.code], ['rejected', 'sender-none']);
    const unsigned = await send(first, {from:'Ana <' + ownerEmail + '>', subject:'Sin firma', text:'x'}, {sign:false});
    assert.equal(unsigned.result, 'rejected');
    assert.equal(stranger.rejected, spoof.rejected);
    assert.ok(!/Proyecto|presupuesto/i.test(stranger.rejected), 'el rechazo no dice nada del proyecto');
    await sleep(1500);
    assert.equal(await page.locator('.card').count(), 1, 'una sola tarjeta');
    assert.equal(times((await stored(base + '/tasks')).text, '"title"'), 1, 'y una sola tarea en Firestore');

    /* ---------- recarga sin caché y sesión nueva ---------- */
    const cdp = await owner.context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', {cacheDisabled:true});
    await cdp.send('Network.setBypassServiceWorker', {bypass:true});
    await page.reload({waitUntil:'domcontentloaded'});
    await card(page, 'Revisar el presupuesto de otoño').waitFor({timeout:30000});
    await openCapture(page);
    assert.equal(await address(page), first, 'tras recargar, la misma dirección');
    await page.locator('#btnAutoClose').click();
    assert.deepEqual(owner.errors, [], 'sin excepciones JavaScript');
    await owner.context.close();
    owner = Object.assign(await signIn(browser, ownerEmail), {uid:owner.uid});
    page = owner.page;
    await card(page, 'Revisar el presupuesto de otoño').click({timeout:30000});
    await page.locator('#tvNotes .att-file-name').getByText('presupuesto.pdf').waitFor();
    await page.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Creada desde un correo de ' + ownerEmail + '.'}).waitFor();
    await page.locator('#btnTvClose').click();

    /* ---------- columna configurada; después se borra ---------- */
    await openCapture(page);
    await page.evaluate((key) => { const s = document.getElementById('capStage'); s.value = key; s.dispatchEvent(new Event('change', {bubbles:true})); }, info.stages[1].key);
    await page.locator('#capAllow').fill('no es un correo');
    await page.locator('#autoBody [data-auto="cap-save"]').click();
    await page.locator('#capNote.lock-error').getByText('Revisa la lista de remitentes').waitFor({timeout:30000});
    await page.locator('#capAllow').fill('');
    await page.evaluate((key) => { const s = document.getElementById('capStage'); s.value = key; s.dispatchEvent(new Event('change', {bubbles:true})); }, info.stages[1].key);
    await page.locator('#autoBody [data-auto="cap-save"]').click();
    await page.locator('#capNote').getByText('Cambios guardados.').waitFor({timeout:30000});
    assert.equal(await page.locator('#capStage').inputValue(), info.stages[1].key);
    await page.locator('#btnAutoClose').click();
    const second = await send(first, {from:ownerEmail, subject:'A la segunda columna', text:'x'});
    assert.equal(second.result, 'created');
    await card(page, 'A la segunda columna').waitFor({timeout:30000});
    assert.equal(await page.evaluate((id) => Workhub.models.TaskModel.stageKey(Workhub.app.models.tasks.find(id)), second.taskId), info.stages[1].key);
    /* Se borra esa columna (sus tarjetas pasan a la primera). */
    await page.locator('[data-col-menu="' + info.stages[1].key + '"]').click();
    await page.locator('[role="menuitem"][data-act="remove"]').click();
    await page.locator('#btnConfirmOk').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    await page.waitForFunction((key) => !Workhub.models.TaskModel.STATUS.some((s) => s.key === key), info.stages[1].key, {timeout:30000});
    assert.ok((await storedWhen(base.indexOf('/projects/') === -1 ? 'users/' + owner.uid + '/projects/main' : base, (res) => res.status === 200 && res.text.indexOf('personalizado') !== -1 && res.text.indexOf('"' + info.stages[1].key + '"') === -1)).status === 200, 'el proyecto guardado ya no tiene esa columna');
    const orphan = await send(first, {from:ownerEmail, subject:'Con la columna borrada', text:'x'});
    assert.equal(orphan.result, 'created');
    await card(page, 'Con la columna borrada').click({timeout:30000});
    await page.locator('#tvNotes .tv-note.is-activity').filter({hasText:'La columna elegida para el correo ya no existe: se creó en «'}).waitFor();
    assert.equal(await page.evaluate((id) => Workhub.models.TaskModel.stageKey(Workhub.app.models.tasks.find(id)), orphan.taskId), info.stages[0].key);
    await page.locator('#btnTvClose').click();
    await openCapture(page);
    await page.locator('#autoBody .cap .auto-broken').getByText('La columna elegida ya no existe: mientras no elijas otra, las tareas se crean en la primera.').waitFor();

    /* ---------- regenerar y desactivar ---------- */
    await page.locator('#autoBody [data-auto="cap-regen"]').click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    await page.locator('#confirmText').getByText('la actual dejará de funcionar al momento').waitFor();
    await page.locator('#btnConfirmCancel').click();
    await page.locator('#dlgConfirm').waitFor({state:'hidden'});
    assert.equal(await address(page), first, 'cancelar no cambia nada');
    await page.locator('#autoBody [data-auto="cap-regen"]').click();
    await page.locator('#btnConfirmOk').click();
    await page.locator('#capNote').getByText('Dirección nueva creada. La anterior ya no funciona.').waitFor({timeout:30000});
    const renewed = await address(page);
    assert.notEqual(renewed, first);
    const toOld = await send(first, {from:ownerEmail, subject:'A la dirección anterior', text:'x'});
    assert.deepEqual([toOld.result, toOld.rejected], ['rejected', 'This address does not accept mail.']);
    assert.equal((await send(renewed.replace('in.kanlane.test', 'respaldo.kanlane.test'), {from:ownerEmail, subject:'A la nueva, por el respaldo', text:'x'})).result, 'created');
    await page.locator('#autoBody [data-auto="cap-off"]').click();
    await page.locator('#btnConfirmOk').click();
    await page.locator('#autoBody [data-auto="cap-enable"]').waitFor({timeout:30000});
    assert.equal(await page.locator('#capAddress').count(), 0);
    const toOff = await send(renewed, {from:ownerEmail, subject:'A la desactivada', text:'x'});
    assert.deepEqual([toOff.result, toOff.rejected], ['rejected', 'This address does not accept mail.']);
    assert.equal(times((await stored('mail_capture')).text, owner.uid), 0, 'no queda nada de la dirección en el servidor');
    await page.locator('#btnAutoClose').click();
    await card(page, 'A la nueva, por el respaldo').waitFor({timeout:30000});
    assert.equal(await card(page, 'A la dirección anterior').count() + await card(page, 'A la desactivada').count(), 0);

    /* ---------- equipo: el editor envía y ve la dirección, pero no la gestiona ---------- */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#dlgShare').waitFor({state:'visible'});
    await page.locator('#shConvert').click();
    await page.waitForFunction(() => String(Workhub.app.projectId).indexOf('t:') === 0 && Workhub.app.models.tasks.isReady(), null, {timeout:60000});
    const tid = await page.evaluate(() => Workhub.models.ProjectModel.teamId(Workhub.app.projectId));
    const editorEmail = 'luis-' + stamp + '@ejemplo.test';
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shEmail').waitFor({state:'visible', timeout:15000});
    await page.locator('#shEmail').fill(editorEmail);
    await page.locator('#shRole').selectOption('editor');
    await page.locator('#shInviteBtn').click();
    assert.equal((await storedWhen('invites/' + tid + '_' + editorEmail, (res) => res.status === 200)).status, 200);
    await closeDialogs(page);
    const editor = await signUp(browser, 'Luis Editor', editorEmail);
    const ep = editor.page;
    await ep.locator('#pInvites [data-invite="accept"]').click({timeout:30000});
    await ep.waitForFunction((key) => Workhub.app.projectId === key && Workhub.app.models.tasks.isReady(), 't:' + tid, {timeout:30000});
    await page.waitForFunction((uid) => Workhub.views.team.members().some((m) => m.uid === uid), editor.uid, {timeout:30000});

    /* El editor, con la captura apagada: no puede encenderla, ni por la pantalla ni llamando al servidor. */
    await openCapture(ep);
    await ep.locator('#autoBody .cap').getByText('Solo quien es propietario del equipo puede activarla.').waitFor();
    assert.equal(await ep.locator('#autoBody [data-auto="cap-enable"]').count(), 0);
    const forced = await ep.evaluate(async () => {
      const cap = Workhub.services.capture, target = cap.target(Workhub.app.projectId);
      const outcome = (p) => p.then(() => 'hecho', (e) => e.code);
      return {enable:await outcome(cap.call(Workhub.app.rootDb, Object.assign({op:'enable'}, target))), regenerate:await outcome(cap.call(Workhub.app.rootDb, Object.assign({op:'regenerate'}, target))),
        configure:await outcome(cap.call(Workhub.app.rootDb, Object.assign({op:'configure', allow:[]}, target))), disable:await outcome(cap.call(Workhub.app.rootDb, Object.assign({op:'disable'}, target)))};
    });
    assert.deepEqual(forced, {enable:'owner', regenerate:'owner', configure:'owner', disable:'owner'});
    await ep.locator('#btnAutoClose').click();
    /* La propietaria la enciende. */
    await openCapture(page);
    await page.locator('#autoBody [data-auto="cap-enable"]').click();
    await page.locator('#capAddress').waitFor({timeout:30000});
    const teamAddress = await address(page);
    assert.ok(teamAddress !== first && teamAddress !== renewed, 'el equipo tiene su propia dirección');
    await page.locator('#btnAutoClose').click();
    await openCapture(ep);
    assert.equal(await address(ep), teamAddress, 'el editor ve la dirección: puede enviar');
    assert.equal(await ep.locator('#autoBody [data-auto="cap-regen"], #autoBody [data-auto="cap-off"], #autoBody [data-auto="cap-save"], #capStage, #capAllow').count(), 0, 'pero no la gestiona');
    await ep.locator('#autoBody .cap').getByText('Solo quien es propietario del equipo puede cambiarla o desactivarla.').waitFor();
    await ep.locator('#btnAutoClose').click();
    const fromEditor = await send(teamAddress, {from:'Luis <' + editorEmail + '>', subject:'Del editor del equipo', text:'cuerpo', attachments:[{name:'notas.txt', type:'text/plain', data:'apuntes'}]});
    assert.deepEqual([fromEditor.result, fromEditor.files], ['created', 1]);
    await card(page, 'Del editor del equipo').click({timeout:30000});
    await page.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Creada desde un correo de ' + editorEmail + '.'}).waitFor();
    await page.locator('#tvNotes .att-file-name').getByText('notas.txt').waitFor();
    await page.locator('#tvNotes .tv-note-author').getByText('Luis Editor').first().waitFor();
    await page.locator('#btnTvClose').click();
    await card(ep, 'Del editor del equipo').waitFor({timeout:30000});
    /* La dirección personal de antes de convertir ya no vale para el equipo, y la del equipo no acepta a quien no es miembro. */
    assert.equal((await send(teamAddress, {from:'eva@otra.test', subject:'De fuera al equipo', text:'x'})).code, 'sender-member');
    /* Se quita al editor: su correo deja de crear tareas al momento. */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#dlgShare [data-act="remove"][data-uid="' + editor.uid + '"]').click({timeout:15000});
    await page.locator('#btnConfirmOk').click();
    assert.ok((await storedWhen('teams/' + tid, (res) => res.text.indexOf(editor.uid) === -1)).text.indexOf(editor.uid) === -1);
    await closeDialogs(page);
    const revoked = await send(teamAddress, {from:editorEmail, subject:'Ya no soy del equipo', text:'x'});
    assert.deepEqual([revoked.result, revoked.code], ['rejected', 'sender-member']);
    assert.equal(await ep.evaluate((id) => Workhub.services.capture.call(Workhub.app.rootDb, {op:'status', tid:id}).then((d) => d.address || 'sin dirección', (e) => e.code), tid), 'project', 'y ya no puede pedir la dirección');
    assert.equal((await send(teamAddress, {from:ownerEmail, subject:'La propietaria sigue pudiendo', text:'x'})).result, 'created');
    assert.deepEqual(editor.errors, [], 'sin excepciones JavaScript (editor)');
    await editor.context.close();
    await card(page, 'La propietaria sigue pudiendo').waitFor({timeout:30000});
    assert.equal(await card(page, 'Ya no soy del equipo').count() + await card(page, 'De fuera al equipo').count(), 0);

    /* ---------- en inglés ---------- */
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => Workhub.app.models.settings.setLang('en').then(() => Workhub.i18n.setLang('en')))
    ]);
    await page.locator('#btnNew').waitFor({state:'visible', timeout:30000});
    await page.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()) && Workhub.i18n.lang === 'en', null, {timeout:30000});
    await openCapture(page);
    const english = await page.locator('#autoBody .cap').textContent();
    ['Tasks by email', 'Address of this project', 'Treat it like a password', 'Allowed senders (optional)', 'Regenerate the address', 'Column where tasks are created'].forEach((piece) => assert.ok(english.indexOf(piece) !== -1, piece));
    assert.equal(/[áéíóúñ¿¡]/i.test(english.replace(ownerEmail, '').replace(/«[^»]*»/g, '')), false, 'el apartado no deja textos en español: ' + english);
    await page.locator('#btnAutoClose').click();
    await card(page, 'Del editor del equipo').click();
    await page.locator('#tvNotes .tv-note.is-activity').filter({hasText:'Created from an email from ' + editorEmail + '.'}).waitFor();
    await page.locator('#btnTvClose').click();
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => Workhub.app.models.settings.setLang('es').then(() => Workhub.i18n.setLang('es')))
    ]);
    await page.locator('#btnNew').waitFor({state:'visible', timeout:30000});
    await page.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()), null, {timeout:30000});

    /* ---------- se elimina el proyecto: la dirección muere con él ---------- */
    const pid = await page.evaluate(() => Workhub.app.projectId);
    await page.evaluate((id) => Workhub.app.models.projects.removeProject(id, Workhub.app.rootDb, null), pid);
    assert.equal((await storedWhen('teams/' + tid, (res) => res.status === 404)).status, 404, 'el equipo ya no existe');
    const afterDelete = await storedWhen('mail_capture_cfg/t~' + tid, (res) => res.status === 404);
    assert.equal(afterDelete.status, 404, 'la app retira la dirección al eliminar el proyecto');
    const dead = await send(teamAddress, {from:ownerEmail, subject:'A un proyecto eliminado', text:'x'});
    assert.deepEqual([dead.result, dead.rejected], ['rejected', 'This address does not accept mail.']);
    assert.equal((await stored('teams/' + tid + '/tasks')).text.indexOf('A un proyecto eliminado'), -1);
    assert.deepEqual(owner.errors, [], 'sin excepciones JavaScript (sesión nueva)');
    await owner.context.close();

    /* ---------- la limpieza del cron, contra Firestore de verdad (emulado) ---------- */
    const marks = times((await stored('mail_seen')).text, '"expireAt"');
    assert.ok(marks >= 4, 'hay marcas de los correos recibidos: ' + marks);
    assert.deepEqual(await capture.sweep(ENV, {now:() => Date.now()}), {configured:true, seen:0, rate:0}, 'hoy no hay nada caducado');
    assert.equal(times((await stored('mail_seen')).text, '"expireAt"'), marks);
    const later = () => Date.now() + 31 * 86400000;
    const swept = await capture.sweep(ENV, {now:later});
    assert.ok(swept.seen >= 4 && swept.rate >= 1, JSON.stringify(swept));
    let left = await capture.sweep(ENV, {now:later});
    for(let i = 0; i < 10 && (left.seen || left.rate); i++) left = await capture.sweep(ENV, {now:later});
    assert.equal(times((await stored('mail_seen')).text, '"expireAt"') + times((await stored('mail_rate')).text, '"day"'), 0, 'pasados 31 días no queda ninguna marca ni contador');

    console.log('OK   Firebase emulado: captura por correo (activar, tarea con adjunto, duplicados, remitentes, columna, regenerar, equipo, inglés, eliminar)');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
