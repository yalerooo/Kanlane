/* «Gestionado por Kanlane» de principio a fin con la interfaz (PR9 del plan, docs/CIFRADO-PROYECTOS.md,
   apartado 12), contra Auth/Firestore emulados y las reglas reales. El servidor de claves es el de
   scripts/dev.js (solo con los emuladores: el mismo cálculo que el Worker, sin verificar la firma del
   token; la verificación se prueba en tests/worker/kms.test.js).
   Comprueba: la tarjeta del asistente, que se crea sin contraseña, lo que llega a Firestore, que se abre
   solo tras recargar, tras cerrar sesión y en otro navegador, el fallo del servidor de claves y
   «Reintentar», que otra cuenta no obtiene la misma clave, la sección de privacidad, compartir y copias.
   Uso: npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub
        --config firebase.test.json "node tests/e2e/crypto-managed.js" */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58641;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

const ACCOUNT_PASS = 'contraseña-prueba-123';
const KMS = '**/__/kms/v1/kek';

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

const dialogFits = (page, id) => page.evaluate((dlgId) => {
  const d = document.getElementById(dlgId);
  const r = d.getBoundingClientRect();
  const inner = d.querySelector('.dlg-inner');
  return r.left >= -1 && r.right <= innerWidth + 1 && inner.scrollWidth <= inner.clientWidth + 1;
}, id);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

async function open(context){
  const page = await context.newPage();
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
  if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  return page;
}
async function signUp(page, email){
  await page.locator('#authSwitchLink').click();
  await page.locator('#authName').fill('Persona de prueba');
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill(ACCOUNT_PASS);
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
  await verify(email);
  await page.getByRole('button', {name:'Ya lo he verificado'}).click();
  await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
}
async function signIn(page, email){
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill(ACCOUNT_PASS);
  await page.locator('#authSubmit').click();
  await page.locator('#tabData').waitFor({state:'visible', timeout:30000});
}
async function signOut(page){
  await page.evaluate(() => Workhub.app.controllers.auth.signOut());
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
}
async function openProject(page, id){
  await page.waitForFunction((pid) => !!Workhub.app && !!Workhub.app.models.projects.get(pid), id);
  await page.evaluate((pid) => Workhub.app.switchProject(pid), id);
}
const card = (page, text) => page.locator('.card').filter({hasText:text});

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES', acceptDownloads:true});
    const errors = [];
    let kmsCalls = 0;
    await context.route(KMS, (route) => { kmsCalls++; route.continue(); });
    const page = await open(context);
    page.on('pageerror', (error) => errors.push(error.message));

    /* ---------- cuenta nueva: primer proyecto sin cifrar ---------- */
    const email = 'gestionado-' + Date.now() + '@example.test';
    await signUp(page, email);
    await page.locator('#pNombre').fill('Proyecto normal');
    await page.locator('#pTypes [data-type="kanban"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    assert.equal(kmsCalls, 0, 'un proyecto sin cifrar no llama al servidor de claves');

    /* ---------- con el interruptor apagado la tarjeta sigue en «Próximamente» ---------- */
    await page.evaluate(() => { Workhub.features.managedEncryption = false; });
    await page.locator('#btnProject').click();
    await page.locator('#projectMenu [data-menu="new"]').click();
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pNombre').fill('Proyecto gestionado');
    await page.locator('#pTypes [data-type="kanban"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    assert.equal(await page.locator('#pPrivacy [data-privacy="C"]').getAttribute('aria-disabled'), 'true', 'apagado: tarjeta desactivada');
    await page.locator('#pPrivacy [data-privacy="C"]').getByText('Próximamente').waitFor();
    await page.locator('#pPrivacy [data-privacy="C"]').click({force:true});
    assert.equal(await page.locator('#pPrivacy [data-privacy="C"]').getAttribute('aria-checked'), 'false');
    await page.locator('#btnCancelProject').click();
    await page.locator('#btnCancelProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.evaluate(() => { Workhub.features.managedEncryption = true; });

    /* ---------- proyecto nuevo gestionado por Kanlane: sin contraseña ni clave de recuperación ---------- */
    await page.locator('#btnProject').click();
    await page.locator('#projectMenu [data-menu="new"]').click();
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pNombre').fill('Proyecto gestionado');
    await page.locator('#pTypes [data-type="kanban"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    const cardC = page.locator('#pPrivacy [data-privacy="C"]');
    assert.equal(await cardC.getAttribute('aria-disabled'), null, 'la tarjeta «Gestionado por Kanlane» se puede elegir');
    assert.equal(await cardC.getByText('Próximamente').count(), 0);
    await cardC.getByText('Kanlane podría técnicamente descifrar el proyecto', {exact:false}).waitFor();
    await cardC.click();
    assert.equal(await cardC.getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#pPrivacy [data-privacy="A"]').getAttribute('aria-checked'), 'false');
    assert.equal((await page.locator('#btnSaveProject').textContent()).trim(), 'Crear proyecto', 'sin paso de contraseña');
    await page.setViewportSize({width:320, height:640});
    assert.equal(await dialogFits(page, 'dlgProject'), true, 'paso de privacidad sin desbordar a 320 px');
    await page.setViewportSize({width:1280, height:850});
    /* Atrás y adelante: la elección se conserva y «Desde GitHub» queda desactivado. */
    await page.locator('#btnCancelProject').click();
    await page.locator('#pStep1').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    assert.equal(await cardC.getAttribute('aria-checked'), 'true', 'la elección se conserva');

    /* El servidor de claves falla: no se crea nada y el error dice el paso. */
    await context.unroute(KMS);
    await context.route(KMS, (route) => route.fulfill({status:503, contentType:'application/json', body:'{"error":"not-configured"}'}));
    await page.locator('#btnSaveProject').click();
    await page.locator('#pError').getByText('Falló al pedir la clave al servidor de Kanlane.', {exact:false}).waitFor({timeout:30000});
    await page.locator('#pError').getByText('El servidor de claves de Kanlane no está disponible ahora.', {exact:false}).waitFor();
    assert.equal(await page.evaluate(() => Workhub.app.models.projects.list().length), 1, 'no se ha creado el proyecto');
    assert.equal((await page.locator('#btnSaveProject').textContent()).trim(), 'Crear proyecto', 'el botón vuelve a su texto');
    assert.equal(await page.locator('#btnSaveProject').isDisabled(), false);
    await context.unroute(KMS);
    await context.route(KMS, (route) => { kmsCalls++; route.continue(); });

    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden', timeout:30000});
    await page.waitForFunction(() => !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true);
    await page.locator('#projectLock').waitFor({state:'visible'});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false);
    assert.equal(kmsCalls, 1, 'una llamada al servidor de claves al crear');
    const info = await page.evaluate(() => {
      const app = Workhub.app, p = app.models.projects.get(app.projectId);
      return {id:p.id, uid:app.rootDb.me.uid, pid:p.enc.pid, kid:p.enc.kid, mode:p.enc.mode, nombre:p.nombre};
    });
    assert.equal(info.nombre, 'Proyecto gestionado');
    assert.equal(info.mode, 'managed');

    /* ---------- lo que llega a Firestore ---------- */
    const base = 'users/' + info.uid + '/projects/' + info.id;
    const wrap = await storedWhen(base + '/crypto/' + info.uid, (res) => res.status === 200);
    assert.equal(wrap.status, 200, 'la clave envuelta está en crypto/{uid}');
    assert.ok(wrap.text.includes('"kms"') && wrap.text.includes('"kmsv"'), 'envuelta con la clave del servidor');
    assert.ok(!wrap.text.includes('"pw"') && !wrap.text.includes('"rk"') && !wrap.text.includes('"kdf"'), 'sin contraseña ni clave de recuperación');
    assert.ok(!wrap.text.includes('"kek"'), 'la clave del servidor no se guarda');
    const projectDoc = await stored('users/' + info.uid + '/projects/' + info.id);
    assert.ok(projectDoc.text.includes('"managed"'), 'el proyecto lleva enc.mode managed');

    await page.locator('#btnNew').click();
    await page.locator('#fTitle').fill('Tarea gestionada reservada');
    await page.locator('#btnSave').click();
    await card(page, 'Tarea gestionada reservada').waitFor();
    const tasks = await storedWhen(base + '/tasks', (res) => res.text.includes('"ev"'));
    assert.ok(tasks.text.includes('"ev"') && !tasks.text.includes('Tarea gestionada reservada'), 'la tarea llega sellada a Firestore');

    /* ---------- insignia, privacidad al editar, compartir, copias y comandos ---------- */
    await page.locator('#btnProject').click();
    assert.equal(await page.locator('#projectMenu .project-enc').count(), 1, 'solo el proyecto gestionado lleva la insignia');
    assert.equal(await page.locator('#projectMenu .project-enc').getAttribute('title'), 'Gestionado por Kanlane: el contenido se guarda cifrado y Kanlane custodia la clave');
    await page.locator('#projectMenu [data-menu="edit"][data-id="' + info.id + '"]').click();
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pPrivacyText').getByText('Gestionado por Kanlane.', {exact:false}).waitFor();
    assert.equal(await page.locator('#pPrivacyActions').isVisible(), false, 'sin contraseña que cambiar ni clave que olvidar');
    await page.locator('#btnCancelProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});

    await page.locator('#btnProject').click();
    await page.locator('#projectMenu [data-menu="share"]').click();
    await page.locator('#dlgShare').waitFor({state:'visible'});
    await page.locator('#shManagedNote').waitFor({state:'visible'});
    assert.equal(await page.locator('#shConvert').isVisible(), false, 'un proyecto gestionado no se convierte en equipo');
    assert.equal(await page.locator('#shConvertPassWrap').isVisible(), false);
    assert.equal(await page.locator('#shEncNote').isVisible(), false);
    await page.keyboard.press('Escape');
    await page.locator('#dlgShare').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => {
      const team = Workhub.app.controllers.team;
      team.convert('');
      return Object.keys(Workhub.app.models.projects.list().filter((p) => p.team)).length;
    }), 0, 'el controlador tampoco lo convierte');

    assert.deepEqual(await page.evaluate(() => {
      const c = Workhub.app.controllers;
      return {seals:c.backup.sealsCopies(), managed:c.crypto.isManaged()};
    }), {seals:false, managed:true}, 'la copia de un proyecto gestionado se descarga sin cifrar');
    await page.locator('#tabData').click();
    assert.equal(await page.locator('#btnExportPlain').isVisible(), false, 'sin «Exportar sin cifrar»: solo hay una exportación');
    await page.locator('#tabTasks').click();

    /* ---------- recargar: se abre solo, con la clave guardada en el navegador ---------- */
    const before = kmsCalls;
    await page.reload({waitUntil:'domcontentloaded'});
    await card(page, 'Tarea gestionada reservada').waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false);
    assert.equal(kmsCalls, before, 'al recargar no se vuelve a pedir la clave');

    /* ---------- cerrar sesión: la clave se borra; al entrar se vuelve a pedir y se abre sin preguntar ---------- */
    await signOut(page);
    assert.equal(await page.evaluate((s) => Workhub.services.keystore.get(s.uid, s.pid), info), null, 'sin clave tras cerrar sesión');
    await signIn(page, email);
    await openProject(page, info.id);
    await card(page, 'Tarea gestionada reservada').waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false, 'no se pide ninguna contraseña');
    assert.equal(kmsCalls, before + 1, 'una sola llamada al servidor de claves al volver a entrar');
    assert.deepEqual(await page.evaluate((s) => Workhub.services.keystore.get(s.uid, s.pid).then((rec) => ({extractable:rec.key.extractable, trusted:!!rec.trusted})), info),
      {extractable:false, trusted:false}, 'la clave guardada no es extraíble ni sobrevive al cierre de sesión');

    /* ---------- otro navegador: el servidor de claves falla y después responde ---------- */
    const other = await browser.newContext({viewport:{width:375,height:812}, locale:'es-ES'});
    let fail = true, otherCalls = 0;
    await other.route(KMS, (route) => {
      otherCalls++;
      if(fail) route.fulfill({status:503, contentType:'application/json', body:'{"error":"unavailable"}'});
      else route.continue();
    });
    const page2 = await open(other);
    page2.on('pageerror', (error) => errors.push(error.message));
    await signIn(page2, email);
    await openProject(page2, info.id);
    await page2.locator('#projectLockScreen').waitFor({state:'visible', timeout:30000});
    await page2.locator('#plManagedError').getByText('El servidor de claves de Kanlane no está disponible ahora. Inténtalo de nuevo en unos minutos.').waitFor({timeout:30000});
    await page2.locator('#plDesc').getByText('No se ha podido abrir «Proyecto gestionado».').waitFor();
    assert.equal(await page2.locator('#plUnlockForm').isVisible(), false, 'sin campo de contraseña');
    assert.equal(await page2.locator('#plForgotWrap').isVisible(), false, 'sin «He olvidado la contraseña»');
    assert.equal(await page2.evaluate(() => Workhub.app.models.tasks.isReady()), false, 'sin clave: los datos no se conectan');
    assert.equal(await noOverflow(page2), true, 'pantalla de bloqueo sin desbordar a 375 px');
    const failed = otherCalls;
    assert.ok(failed >= 1 && failed <= 2, 'no se insiste sin parar contra el servidor de claves: ' + failed);
    await page2.waitForTimeout(1500);
    assert.equal(otherCalls, failed, 'tras el fallo no hay más llamadas hasta pulsar «Reintentar»');
    fail = false;
    await page2.locator('#plManagedRetry').click();
    await page2.locator('#projectLockScreen').waitFor({state:'hidden', timeout:30000});
    await card(page2, 'Tarea gestionada reservada').waitFor({timeout:30000});

    /* Un proyecto con cifrado total sigue pidiendo su contraseña: la pantalla vuelve a su forma. */
    await page2.evaluate(() => Workhub.app.controllers.crypto.view.show('Otro'));
    assert.equal(await page2.evaluate(() => !document.getElementById('plUnlockForm').hidden && document.getElementById('plManaged').hidden), true);
    await other.close();

    /* ---------- la clave depende de la cuenta: otra cuenta no abre el envoltorio ---------- */
    const keys = await page.evaluate(async (s) => {
      const c = Workhub.app.controllers.crypto;
      const mine = await c.managedKek({pid:s.pid, kid:s.kid});
      const token = await Workhub.app.rootDb.idToken();
      const noAuth = await fetch('/__/kms/v1/kek', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pid:s.pid, kid:s.kid})});
      const badBody = await fetch('/__/kms/v1/kek', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + token}, body:JSON.stringify({pid:'corto', kid:s.kid})});
      return {length:mine.kek.length, kmsv:mine.kmsv, noAuth:noAuth.status, badBody:badBody.status};
    }, info);
    assert.deepEqual(keys, {length:32, kmsv:1, noAuth:401, badBody:400});

    const third = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
    const page3 = await open(third);
    const email3 = 'gestionado-otra-' + Date.now() + '@example.test';
    await signUp(page3, email3);
    await page3.locator('#pNombre').fill('De otra cuenta');
    await page3.locator('#pTypes [data-type="kanban"]').click();
    await page3.locator('#btnSaveProject').click();
    await page3.locator('#pStep2').waitFor({state:'visible'});
    /* Primer proyecto de la cuenta, gestionado: es el principal. */
    await page3.locator('#pPrivacy [data-privacy="C"]').click();
    await page3.locator('#btnSaveProject').click();
    await page3.locator('#dlgProject').waitFor({state:'hidden', timeout:30000});
    await page3.waitForFunction(() => !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true, null, {timeout:30000});
    const cross = await page3.evaluate(async (s) => {
      const app = Workhub.app, PC = Workhub.services.projectCrypto;
      const p = app.models.projects.get(app.projectId);
      const out = {id:p.id, mode:p.enc.mode, uid:app.rootDb.me.uid};
      /* Con el pid y el kid del proyecto de la primera cuenta, el servidor da otra clave. */
      const theirs = await app.controllers.crypto.managedKek({pid:s.pid, kid:s.kid});
      try{
        await PC.unwrapManaged({kms:s.kms}, theirs.kek, {pid:s.pid, kid:s.kid, uid:s.uid}, false);
        out.opened = true;
      }catch(e){ out.opened = e.code; }
      return out;
    }, Object.assign({kms:await page.evaluate((s) => Workhub.app.controllers.crypto.wrapRef(s.id).get().then((snap) => snap.data().kms), info)}, info));
    assert.equal(cross.id, 'main', 'el primer proyecto de la cuenta puede ser gestionado');
    assert.equal(cross.mode, 'managed');
    assert.equal(cross.opened, 'bad-kms', 'la clave de otra cuenta no abre el envoltorio');
    const mainWrap = await storedWhen('users/' + cross.uid + '/crypto/' + cross.uid, (res) => res.status === 200);
    assert.ok(mainWrap.text.includes('"kms"'), 'el envoltorio del principal está en users/{uid}/crypto/{uid}');
    await third.close();

    /* ---------- en inglés ---------- */
    await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded'}),
      page.evaluate(() => Workhub.app.models.settings.setLang('en').then(() => Workhub.i18n.setLang('en')))
    ]);
    await card(page, 'Tarea gestionada reservada').waitFor({timeout:30000});
    await page.locator('#btnProject').click();
    await page.locator('#projectMenu [data-menu="new"]').click();
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pNombre').fill('Another');
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#pPrivacy [data-privacy="C"]').getByText('Managed by Kanlane').waitFor();
    await page.locator('#pPrivacy [data-privacy="C"]').getByText('No extra password').waitFor();
    assert.equal(await page.locator('#pPrivacy [data-privacy="C"]').getByText('Coming soon').count(), 0);

    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: proyecto gestionado por Kanlane (crear, abrir sin contraseña, fallo del servidor de claves, otra cuenta)');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
