/* Cifrado total de principio a fin con la interfaz (PR4 y PR5 del plan, docs/CIFRADO-PROYECTOS.md 14.4,
   puntos 1 a 6), contra Auth/Firestore emulados y las reglas reales: asistente de privacidad, contraseña
   débil, clave de recuperación y su .txt, lo que llega a Firestore, recarga, cierre de sesión con y sin
   «dispositivo de confianza», otro navegador, recuperación, cambio de contraseña y bloqueo de GitHub.
   Uso: npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub
        --config firebase.test.json "node tests/e2e/crypto-wizard.js" */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58640;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

const ACCOUNT_PASS = 'contraseña-prueba-123';
const PASS1 = 'una frase larga de cuatro palabras';
const PASS2 = 'otra frase distinta para el proyecto';
const PASS3 = 'tercera frase para cambiar la clave';
const KEY_RE = /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/;

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

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
/* El diálogo abierto cabe en la ventana (sin desbordar a lo ancho). */
const dialogFits = (page, id) => page.evaluate((dlgId) => {
  const d = document.getElementById(dlgId);
  const r = d.getBoundingClientRect();
  const inner = d.querySelector('.dlg-inner');
  return r.left >= -1 && r.right <= innerWidth + 1 && inner.scrollWidth <= inner.clientWidth + 1;
}, id);

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
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let githubCalls = 0;
    await context.route('https://api.github.com/**', (route) => { githubCalls++; route.abort(); });

    /* ---------- cuenta nueva: el primer proyecto pasa por el paso de privacidad ---------- */
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#authSwitchLink').click();
    const email = 'asistente-' + Date.now() + '@example.test';
    await page.locator('#authName').fill('Persona de prueba');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill(ACCOUNT_PASS);
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Proyecto sin cifrar');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    assert.equal((await page.locator('#btnSaveProject').textContent()).trim(), 'Siguiente');
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    assert.equal(await page.locator('#pPrivacy [data-privacy]').count(), 3, 'tres tarjetas de privacidad');
    assert.equal(await page.locator('#pPrivacy [data-privacy="A"]').getAttribute('aria-checked'), 'true', '«Solo contraseñas» por defecto');
    assert.equal(await page.locator('#pPrivacy [data-privacy="C"]').getAttribute('aria-disabled'), 'true', '«Gestionado» desactivado');
    await page.locator('#pPrivacy [data-privacy="C"]').click({force:true});
    assert.equal(await page.locator('#pPrivacy [data-privacy="C"]').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('#btnCancelProject').isVisible(), true, '«Atrás» visible también en el primer proyecto');
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    assert.equal(await page.locator('#projectLock').isVisible(), false, 'sin candado en un proyecto sin cifrar');

    /* ---------- proyecto nuevo con cifrado total ---------- */
    await page.locator('#btnProject').click();
    await page.locator('#projectMenu [data-menu="new"]').click();
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pNombre').fill('Proyecto privado');
    await page.locator('#pTypes [data-type="kanban"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pPrivacy [data-privacy="B"]').click();
    assert.equal((await page.locator('#btnSaveProject').textContent()).trim(), 'Siguiente');
    /* Atrás con cifrado elegido: «Desde GitHub» ya no se puede elegir. */
    await page.locator('#btnCancelProject').click();
    await page.locator('#pStep1').waitFor({state:'visible'});
    assert.equal(await page.locator('#pTypes [data-type="github"]').getAttribute('aria-disabled'), 'true');
    await page.locator('#pTypes [data-type="github"]').click({force:true});
    assert.equal(await page.locator('#pTypes [data-type="kanban"]').getAttribute('aria-checked'), 'true');
    await page.locator('#btnSaveProject').click();
    assert.equal(await page.locator('#pPrivacy [data-privacy="B"]').getAttribute('aria-checked'), 'true', 'la elección se conserva');
    await page.setViewportSize({width:320, height:640});
    assert.equal(await dialogFits(page, 'dlgProject'), true, 'paso de privacidad sin desbordar a 320 px');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep3').waitFor({state:'visible'});

    /* Contraseña: corta bloquea, común avisa, distintas no pasan. */
    await page.locator('#pEncPass').fill('corta');
    await page.locator('#pEncMeter .pw-meter-text').getByText('Demasiado corta: mínimo 12 caracteres.').waitFor();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pError').getByText('Demasiado corta: mínimo 12 caracteres.').waitFor();
    assert.equal(await page.locator('#pStep3').isVisible(), true);
    await page.locator('#pEncPass').fill('passwordpassword');
    await page.locator('#pEncMeter .pw-meter-text').getByText('Débil: es muy común o fácil de adivinar.').waitFor();
    await page.locator('#pEncPass').fill(PASS1);
    await page.locator('#pEncMeter .pw-meter-text').getByText('Buena').waitFor();
    await page.locator('#pEncPass2').fill(PASS1 + 'x');
    await page.locator('#btnSaveProject').click();
    await page.locator('#pError').getByText('Las contraseñas no coinciden.').waitFor();
    await page.locator('#pEncPass2').fill(PASS1);
    assert.equal(await page.locator('#pEncTrusted').isChecked(), false, '«dispositivo de confianza» desmarcado por defecto');
    await page.setViewportSize({width:375, height:812});
    assert.equal(await dialogFits(page, 'dlgProject'), true, 'paso de contraseña sin desbordar a 375 px');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#btnSaveProject').click();

    /* Clave de recuperación: se enseña antes de crear nada y hay que confirmar que se ha guardado. */
    await page.locator('#pStep4').waitFor({state:'visible'});
    const recovery1 = (await page.locator('#pEncKey').textContent()).trim();
    assert.match(recovery1, KEY_RE, 'clave de recuperación de 8 grupos');
    assert.equal(await page.locator('#btnSaveProject').isDisabled(), true, 'no se crea sin confirmar la clave');
    assert.equal(await page.evaluate(() => Workhub.app.models.projects.list().length), 1, 'todavía no existe el proyecto');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#pEncDownload').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'kanlane-clave-recuperacion-proyecto-privado.txt');
    const txt = fs.readFileSync(await download.path(), 'utf8');
    assert.ok(txt.includes(recovery1) && txt.includes('Proyecto: Proyecto privado') && txt.includes('Cuenta: ' + email), 'el .txt lleva la clave, el proyecto y la cuenta');
    assert.ok(txt.includes('Kanlane no tiene una copia y no puede recuperarla.'));
    await page.setViewportSize({width:320, height:640});
    assert.equal(await dialogFits(page, 'dlgProject'), true, 'paso de la clave sin desbordar a 320 px');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#pEncSaved').check();
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden', timeout:30000});
    await page.waitForFunction(() => !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true);
    await page.locator('#projectLock').waitFor({state:'visible'});
    const info = await page.evaluate(() => {
      const app = Workhub.app, p = app.models.projects.get(app.projectId);
      return {id:p.id, uid:app.rootDb.me.uid, pid:p.enc.pid, mode:p.enc.mode, nombre:p.nombre};
    });
    assert.equal(info.nombre, 'Proyecto privado');
    assert.equal(info.mode, 'pw');
    const base = 'users/' + info.uid + '/projects/' + info.id;
    const wrap = await storedWhen(base + '/crypto/' + info.uid, (res) => res.status === 200);
    assert.equal(wrap.status, 200, 'la clave envuelta está en crypto/{uid}');
    assert.ok(wrap.text.includes('600000') && wrap.text.includes('"rk"') && wrap.text.includes('"pw"'));
    assert.ok(!wrap.text.includes(PASS1) && !wrap.text.includes(recovery1.replace(/-/g, '')), 'ni la contraseña ni la clave de recuperación llegan al servidor');

    /* ---------- lo que se escribe va sellado ---------- */
    await page.locator('#btnNew').click();
    await page.locator('#fTitle').fill('Tarea muy reservada');
    await page.locator('#btnSave').click();
    await card(page, 'Tarea muy reservada').waitFor();
    const tasks = await storedWhen(base + '/tasks', (res) => res.text.includes('"ev"'));
    assert.ok(tasks.text.includes('"ev"') && !tasks.text.includes('Tarea muy reservada'), 'la tarea llega sellada a Firestore');

    /* ---------- menú de proyectos e información de privacidad ---------- */
    await page.locator('#btnProject').click();
    await page.locator('#projectMenu .project-enc').getByText('Cifrado').waitFor();
    assert.equal(await page.locator('#projectMenu .project-enc').count(), 1, 'solo el proyecto cifrado lleva la insignia');
    await page.keyboard.press('Escape');

    /* ---------- GitHub: bloqueado en la interfaz y en el motor ---------- */
    await page.locator('#tabSettings').click();
    await page.locator('#ghEncrypted').waitFor({state:'visible'});
    const gh = await page.evaluate(async () => {
      const g = Workhub.app.controllers.github;
      Workhub.services.github.setToken('ghp_prueba_falsa');
      const out = {linked:g.sync.isLinked()};
      await g.sync.sync();
      out.syncError = g.sync.error && g.sync.error.code;
      try{ await g.sync.link({url:'https://github.com/users/alguien/projects/1'}); out.link = 'aceptado'; }catch(e){ out.link = e.code; }
      try{ await Workhub.app.models.projects.patch(Workhub.app.projectId, {github:{number:1}}); out.patch = 'aceptado'; }catch(e){ out.patch = e.message; }
      try{ await Workhub.app.models.tasks.saveSynced(null, {title:'x'}); out.task = 'aceptado'; }catch(e){ out.task = e.code; }
      Workhub.services.github.setToken('');
      g.sync.error = null;
      return out;
    });
    assert.deepEqual(gh, {linked:false, syncError:'encrypted', link:'encrypted', patch:'encrypted-github', task:'encrypted'});
    assert.equal(githubCalls, 0, 'ninguna petición a api.github.com desde un proyecto cifrado');
    await page.locator('#tabTasks').click();

    /* ---------- recargar: no vuelve a pedir la contraseña ---------- */
    await page.reload({waitUntil:'domcontentloaded'});
    await card(page, 'Tarea muy reservada').waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false);

    /* ---------- cerrar sesión sin «confianza»: la clave se borra ---------- */
    await signOut(page);
    assert.equal(await page.evaluate((s) => Workhub.services.keystore.get(s.uid, s.pid), info), null, 'sin clave tras cerrar sesión');
    await signIn(page, email);
    await openProject(page, info.id);
    await page.locator('#projectLockScreen').waitFor({state:'visible', timeout:30000});
    await page.locator('#plDesc').getByText('Escribe la contraseña de cifrado de «Proyecto privado». Solo se usa en tu navegador.').waitFor();
    assert.equal(await page.evaluate(() => Workhub.app.models.tasks.isReady()), false, 'bloqueado: los datos no se conectan');
    await page.locator('#plPass').fill('no es la contraseña del proyecto');
    await page.locator('#plUnlock').click();
    await page.locator('#plError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), true);
    await page.setViewportSize({width:320, height:640});
    assert.equal(await noOverflow(page), true, 'pantalla de desbloqueo sin desbordar a 320 px');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#plPass').fill(PASS1);
    await page.locator('#plTrusted').check();
    await page.locator('#plUnlock').click();
    await card(page, 'Tarea muy reservada').waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false);

    /* ---------- con «confianza»: sobrevive al cierre de sesión ---------- */
    await signOut(page);
    const kept = await page.evaluate((s) => Workhub.services.keystore.get(s.uid, s.pid).then((r) => r && r.trusted), info);
    assert.equal(kept, true, 'la clave de un dispositivo de confianza se conserva');
    await signIn(page, email);
    await openProject(page, info.id);
    await card(page, 'Tarea muy reservada').waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false);

    /* ---------- otra pestaña: bloquear en una bloquea la otra ---------- */
    const twin = await context.newPage();
    twin.on('pageerror', (error) => errors.push(error.message));
    await twin.goto(url, {waitUntil:'domcontentloaded'});
    await twin.locator('#tabData').waitFor({state:'visible', timeout:30000});
    await openProject(twin, info.id);
    await card(twin, 'Tarea muy reservada').waitFor({timeout:30000});
    await page.evaluate(() => Workhub.app.controllers.crypto.lock());
    await page.locator('#projectLockScreen').waitFor({state:'visible'});
    await twin.locator('#projectLockScreen').waitFor({state:'visible', timeout:15000});
    await page.locator('#plPass').fill(PASS1);
    await page.locator('#plUnlock').click();
    await card(page, 'Tarea muy reservada').waitFor({timeout:30000});
    await card(twin, 'Tarea muy reservada').waitFor({timeout:15000});
    await twin.close();

    /* ---------- otro navegador: recuperación con la clave ---------- */
    const other = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
    const second = await other.newPage();
    second.on('pageerror', (error) => errors.push(error.message));
    await second.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await second.locator('.consent [data-act="reject"]').isVisible()) await second.locator('.consent [data-act="reject"]').click();
    await signIn(second, email);
    await openProject(second, info.id);
    await second.locator('#projectLockScreen').waitFor({state:'visible', timeout:30000});
    await second.locator('#plForgot').click();
    await second.locator('#plRecovery').fill('0000-0000-0000-0000-0000-0000-0000-0000');
    await second.locator('#plNew').fill(PASS2);
    await second.locator('#plNew2').fill(PASS2);
    await second.locator('#plRecover').click();
    await second.locator('#plRecoverError').getByText('La clave de recuperación no es correcta.').waitFor({timeout:30000});
    await second.locator('#plRecovery').fill(recovery1.toLowerCase().replace(/-/g, ' '));
    await second.locator('#plRecover').click();
    await second.locator('#plKeyCard').waitFor({state:'visible', timeout:30000});
    const recovery2 = (await second.locator('#plKey').textContent()).trim();
    assert.match(recovery2, KEY_RE);
    assert.notEqual(recovery2, recovery1, 'la clave de recuperación cambia');
    assert.equal(await second.locator('#plKeyContinue').isDisabled(), true);
    await second.locator('#plKeySaved').check();
    await second.locator('#plKeyContinue').click();
    await card(second, 'Tarea muy reservada').waitFor({timeout:30000});

    /* La clave y la contraseña anteriores ya no sirven; la contraseña nueva, sí. */
    await second.evaluate(() => Workhub.app.controllers.crypto.lock());
    await second.locator('#projectLockScreen').waitFor({state:'visible'});
    await second.locator('#plForgot').click();
    await second.locator('#plRecovery').fill(recovery1);
    await second.locator('#plNew').fill(PASS3);
    await second.locator('#plNew2').fill(PASS3);
    await second.locator('#plRecover').click();
    await second.locator('#plRecoverError').getByText('La clave de recuperación no es correcta.').waitFor({timeout:30000});
    await second.locator('#plPass').fill(PASS1);
    await second.locator('#plUnlock').click();
    await second.locator('#plError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    await second.locator('#plPass').fill(PASS2);
    await second.locator('#plUnlock').click();
    await card(second, 'Tarea muy reservada').waitFor({timeout:30000});

    /* ---------- ajustes de privacidad: cambiar la contraseña y crear otra clave ---------- */
    await second.evaluate(() => Workhub.app.controllers.projects.openEdit());
    await second.locator('#pPrivacyText').getByText('Cifrado total.').waitFor();
    await second.locator('[data-privacy-act="password"]').click();
    await second.locator('#dlgEncKey').waitFor({state:'visible'});
    await second.locator('#ekCurrent').fill('no es la actual, seguro');
    await second.locator('#ekNew').fill(PASS3);
    await second.locator('#ekNew2').fill(PASS3);
    await second.locator('#ekSubmit').click();
    await second.locator('#ekError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    await second.locator('#ekCurrent').fill(PASS2);
    await second.locator('#ekSubmit').click();
    await second.locator('#dlgEncKey').waitFor({state:'hidden', timeout:30000});
    await second.locator('[data-privacy-act="recovery"]').click();
    await second.locator('#dlgEncKey').waitFor({state:'visible'});
    await second.locator('#ekCurrent').fill(PASS3);
    await second.locator('#ekSubmit').click();
    await second.locator('#ekKeyPanel').waitFor({state:'visible', timeout:30000});
    const recovery3 = (await second.locator('#ekKey').textContent()).trim();
    assert.match(recovery3, KEY_RE);
    assert.notEqual(recovery3, recovery2);
    assert.equal(await second.locator('#ekSubmit').isDisabled(), true);
    await second.setViewportSize({width:320, height:640});
    assert.equal(await dialogFits(second, 'dlgEncKey'), true, 'diálogo de la clave sin desbordar a 320 px');
    await second.setViewportSize({width:1280, height:850});
    await second.locator('#ekKeySaved').check();
    await second.locator('#ekSubmit').click();
    await second.locator('#dlgEncKey').waitFor({state:'hidden', timeout:30000});
    /* «Olvidar la clave en este navegador» bloquea; se abre con la contraseña nueva. */
    await second.locator('[data-privacy-act="forget"]').click();
    await second.locator('#projectLockScreen').waitFor({state:'visible'});
    await second.locator('#plPass').fill(PASS2);
    await second.locator('#plUnlock').click();
    await second.locator('#plError').getByText('Contraseña incorrecta.').waitFor({timeout:30000});
    await second.locator('#plPass').fill(PASS3);
    await second.locator('#plUnlock').click();
    await card(second, 'Tarea muy reservada').waitFor({timeout:30000});
    await other.close();

    /* ---------- «Desde GitHub» no ofrece cifrado total ---------- */
    await page.evaluate(() => Workhub.app.controllers.projects.openNew());
    await page.locator('#pTypes [data-type="github"]').click();
    await page.locator('#pGhToken').fill('ghp_prueba_falsa');
    await page.locator('#pGhUrl').fill('https://github.com/users/alguien/projects/1');
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    assert.equal(await page.locator('#pPrivacy [data-privacy="B"]').getAttribute('aria-disabled'), 'true');
    await page.locator('#pPrivacy [data-privacy="B"]').getByText('No disponible con «Desde GitHub»: lo que se sincroniza tiene que llegar a GitHub sin cifrar.').waitFor();
    assert.equal((await page.locator('#btnSaveProject').textContent()).trim(), 'Crear proyecto');
    await page.locator('#btnCancelProject').click();
    await page.locator('#btnCancelProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});

    /* ---------- en inglés: los textos nuevos están traducidos ---------- */
    await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded'}),
      page.evaluate(() => Workhub.app.models.settings.setLang('en').then(() => Workhub.i18n.setLang('en')))
    ]);
    await card(page, 'Tarea muy reservada').waitFor({timeout:30000});
    assert.equal(await page.evaluate(() => Workhub.i18n.lang), 'en');
    await page.evaluate(() => Workhub.app.controllers.crypto.lock());
    await page.locator('#projectLockScreen').waitFor({state:'visible'});
    await page.locator('#projectLockScreen').getByText('Encrypted project').waitFor();
    await page.locator('#plDesc').getByText('Enter the encryption password for "Proyecto privado". It\'s only used in your browser.').waitFor();
    await page.locator('#plUnlock').getByText('Unlock').waitFor();

    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: asistente de cifrado total, desbloqueo, recuperación, cierre de sesión y GitHub');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
