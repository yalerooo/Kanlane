/* Contraseñas compartidas en un equipo contra Auth/Firestore emulados y las reglas reales
   (docs/EQUIPOS.md, «Contraseñas compartidas»). Dos cuentas en dos contextos del navegador:
   la propietaria convierte un proyecto personal con contraseñas guardadas en equipo (pide la
   contraseña maestra, el proyecto se mueve y no queda duplicado), invita con un enlace de acceso de
   un solo uso, y el invitado lo abre, crea su propia contraseña maestra y lee las mismas
   credenciales. Además: contraseña maestra errónea, código erróneo, enlace gastado, dar acceso a
   quien ya es miembro, expulsar y eliminar el equipo.
   Uso: npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub
        --config firebase.test.json "node tests/e2e/team-vault.js" */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58643;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

const MASTER = 'la maestra de ana';
const GUEST_MASTER = 'la maestra de luis';
const SECRETS = ['secreto-uno', 'secreto-dos', 'nota reservada'];
const stamp = Date.now();

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

/* Firestore como administrador (sin reglas). */
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
const gone = (res) => res.status === 404;
const empty = (res) => res.status === 200 && res.text.indexOf('"documents"') === -1;
const count = (res) => (res.text.match(/"name":/g) || []).length;

/* Cuenta nueva verificada; se queda en el diálogo del primer proyecto. */
async function signUp(browser, name, email){
  const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
  if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
  await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
  await page.locator('#authSwitchLink').click();
  await page.locator('#authName').fill(name);
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPass').fill('contraseña-prueba-123');
  await page.locator('#authSubmit').click();
  await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
  await verify(email);
  await page.getByRole('button', {name:'Ya lo he verificado'}).click();
  await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
  const uid = await page.evaluate(() => Workhub.app.rootDb.me.uid);
  return {context, page, errors, uid, email};
}

async function closeShare(page){
  await page.evaluate(() => { const d = document.getElementById('dlgShare'); if(d.open) d.close(); });
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    /* ---------- la propietaria: proyecto personal con contraseñas guardadas ---------- */
    const owner = await signUp(browser, 'Ana Propietaria', 'ana-' + stamp + '@example.test');
    const page = owner.page;
    await page.locator('#pNombre').fill('Proyecto con claves');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.waitForFunction(() => Workhub.app.models.vault.isReady() && Workhub.app.models.tasks.isReady());

    const seed = await page.evaluate(async (master) => {
      const app = Workhub.app, m = app.models;
      await m.vault.checkMeta();
      const recovery = await m.vault.create(master);
      await m.vault.saveEntry(null, {tipo:'correo', cliente:'', label:'Correo de Acme', correo:'hola@acme.test'}, {password:'secreto-uno', notas:'nota reservada'});
      await m.vault.saveEntry(null, {tipo:'servidor', cliente:'', label:'Servidor de Acme', ip:'10.0.0.7'}, {password:'secreto-dos', notas:''});
      for(let i = 0; i < 50 && m.vault.items.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
      const first = m.vault.items.find((v) => v.label === 'Correo de Acme').id;
      const ref = await m.tasks.add({title:'Tarea con contraseña', status:Workhub.models.TaskModel.STATUS[0].key, linkedVault:[first], order:1, createdAt:Date.now(), updatedAt:Date.now()});
      m.vault.lock();
      return {projectId:app.projectId, entry:first, task:ref.id, recovery:recovery};
    }, MASTER);
    await page.locator('.card').filter({hasText:'Tarea con contraseña'}).waitFor();
    const personalBase = 'users/' + owner.uid + (seed.projectId === 'main' ? '' : '/projects/' + seed.projectId);
    assert.equal(count(await stored(personalBase + '/vault')), 2, 'las dos credenciales están en el proyecto personal');

    /* ---------- convertir: pide la contraseña maestra y el proyecto se mueve ---------- */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#dlgShare').waitFor({state:'visible'});
    await page.locator('#shVaultPassWrap').waitFor({state:'visible', timeout:15000});
    assert.equal(await page.locator('#shVaultNote').isVisible(), true, 'explica que las contraseñas pasan al equipo');
    await page.locator('#shConvert').click();
    await page.locator('#shError').getByText('Escribe la contraseña maestra de las contraseñas de este proyecto.').waitFor({timeout:15000});
    await page.locator('#shVaultPass').fill('una que no es');
    await page.locator('#shConvert').click();
    await page.locator('#shError').getByText('Contraseña maestra incorrecta.').waitFor({timeout:30000});
    assert.equal(await page.evaluate(() => Workhub.app.models.projects.list().filter((p) => p.team).length), 0, 'con la contraseña mala no se crea nada');
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'compartir sin desbordamiento en móvil');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#shVaultPass').fill(MASTER);
    await page.locator('#shConvert').click();
    await page.waitForFunction(() => String(Workhub.app.projectId).indexOf('t:') === 0 && Workhub.app.models.tasks.isReady(), null, {timeout:60000});
    const tid = await page.evaluate(() => Workhub.models.ProjectModel.teamId(Workhub.app.projectId));
    const base = 'teams/' + tid;

    /* No queda duplicado: solo existe el proyecto de equipo. */
    await page.waitForFunction(() => { const l = Workhub.app.models.projects.list(); return l.length === 1 && l[0].team === true; }, null, {timeout:30000});
    assert.deepEqual(await page.evaluate(() => Workhub.app.models.projects.list().map((p) => p.nombre)), ['Proyecto con claves']);
    assert.ok(empty(await storedWhen(personalBase + '/vault', empty)), 'las credenciales ya no están en el proyecto personal');
    assert.ok(empty(await storedWhen(personalBase + '/tasks', empty)), 'ni sus tareas');
    assert.ok(gone(await storedWhen(personalBase + '/vault_meta/check', gone)), 'ni su contraseña maestra');
    if(seed.projectId !== 'main') assert.ok(gone(await storedWhen('users/' + owner.uid + '/projects/' + seed.projectId, gone)), 'el proyecto personal se ha eliminado');

    /* El cofre está en el equipo, cifrado. */
    const vaultDocs = await storedWhen(base + '/vault', (res) => count(res) === 2);
    assert.equal(count(vaultDocs), 2, 'las credenciales están en el equipo');
    SECRETS.forEach((s) => assert.ok(vaultDocs.text.indexOf(s) === -1, '«' + s + '» no está en claro'));
    assert.equal((await stored(base + '/vault_meta/check')).status, 200, 'marca del cofre del equipo');
    const ownerKey = await stored(base + '/vault_keys/' + owner.uid);
    assert.equal(ownerKey.status, 200, 'clave envuelta de la propietaria');
    assert.ok((await stored(base + '/tasks/' + seed.task)).text.indexOf(seed.entry) !== -1, 'la tarea conserva su contraseña vinculada');
    await closeShare(page);

    /* La propietaria entra con su contraseña maestra de siempre. */
    assert.equal(await page.locator('#tabVault').isVisible(), true, 'un equipo tiene sección de contraseñas');
    await page.locator('#tabVault').click();
    await page.locator('#lockTitle').getByText('Desbloquear contraseñas').waitFor({timeout:15000});
    await page.locator('#masterPass').fill(MASTER);
    await page.locator('#btnUnlock').click();
    await page.locator('#vaultContent').waitFor({state:'visible', timeout:30000});
    await page.locator('#vaultGrid').getByText('Correo de Acme').first().waitFor();
    assert.equal(await page.evaluate((id) => Workhub.app.models.vault.reveal(id).then((d) => d.password), seed.entry), 'secreto-uno');

    /* ---------- invitar: contraseña maestra y enlace de un solo uso ---------- */
    const guestEmail = 'luis-' + stamp + '@example.test';
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shMasterPassWrap').waitFor({state:'visible', timeout:15000});
    await page.locator('#shEmail').fill(guestEmail);
    await page.locator('#shRole').selectOption('editor');
    await page.locator('#shMasterPass').fill('una que no es');
    await page.locator('#shInviteBtn').click();
    await page.locator('#shError').getByText('Contraseña maestra incorrecta.').waitFor({timeout:30000});
    assert.equal((await stored('invites/' + tid + '_' + guestEmail)).status, 404, 'con la contraseña maestra mala no se invita');
    await page.locator('#shMasterPass').fill(MASTER);
    await page.locator('#shInviteBtn').click();
    await page.locator('#shCodePanel').waitFor({state:'visible', timeout:30000});
    assert.equal(await page.locator('#shLinkWrap').isVisible(), true);
    assert.equal(await page.locator('#shCodeWrap').isVisible(), false, 'sin cifrado total no hay código de proyecto');
    await page.locator('#shTitle').getByText('Enlace de acceso para ' + guestEmail).waitFor();
    const link = (await page.locator('#shLink').textContent()).trim();
    assert.ok(link.indexOf(url + '#cofre=' + tid + '.') === 0, 'el enlace lleva el equipo y el código tras la almohadilla: ' + link);
    const code = link.split('.').pop();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{20}$/);
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'enlace sin desbordamiento en móvil');
    await page.setViewportSize({width:1280, height:850});
    const grantPath = base + '/vault_grants/' + guestEmail;
    const grantDoc = await storedWhen(grantPath, (res) => res.status === 200);
    assert.equal(grantDoc.status, 200, 'el acceso está guardado para ese correo');
    assert.ok(grantDoc.text.indexOf(code) === -1, 'el código no se guarda en Firestore');
    assert.equal((await stored('invites/' + tid + '_' + guestEmail)).status, 200);
    await page.locator('#shCodeDone').click();
    assert.equal(await page.locator('#shLink').textContent(), '', 'el enlace no se vuelve a mostrar');
    await closeShare(page);

    /* ---------- el invitado: acepta, abre el enlace y crea su contraseña maestra ---------- */
    const guest = await signUp(browser, 'Luis Invitado', guestEmail);
    const gp = guest.page;
    await gp.locator('#pInvites [data-invite="accept"]').click({timeout:30000});
    await gp.waitForFunction((key) => Workhub.app.projectId === key && Workhub.app.models.tasks.isReady(), 't:' + tid, {timeout:30000});
    await gp.locator('.card').filter({hasText:'Tarea con contraseña'}).waitFor();
    /* Sin el enlace: el cofre existe y le pide el código. */
    await gp.locator('#tabVault').click();
    await gp.locator('#lockTitle').getByText('Entra en las contraseñas del equipo').waitFor({timeout:15000});
    assert.equal(await gp.locator('#vaultCodeWrap').isVisible(), true);
    assert.equal(await gp.locator('#vaultCode').inputValue(), '');
    /* Abre el enlace que le han dado: va directo a las contraseñas con el código puesto. */
    await gp.goto('about:blank');
    await gp.goto(link, {waitUntil:'domcontentloaded'});
    await gp.locator('#vaultCodeWrap').waitFor({state:'visible', timeout:30000});
    await gp.waitForFunction((c) => document.getElementById('vaultCode').value === c, code, {timeout:15000});
    assert.equal(await gp.evaluate(() => location.hash), '', 'el código se quita de la barra de direcciones');
    assert.equal(await gp.locator('#masterPass2Wrap').isVisible(), true, 'pide la contraseña maestra dos veces');
    const wrong = code.slice(0, -1) + (code.slice(-1) === '0' ? '1' : '0');
    await gp.locator('#vaultCode').fill(wrong);
    await gp.locator('#masterPass').fill(GUEST_MASTER);
    await gp.locator('#masterPass2').fill(GUEST_MASTER);
    await gp.locator('#btnUnlock').click();
    await gp.locator('#lockError').getByText('El código no es correcto.').waitFor({timeout:30000});
    assert.equal((await stored(grantPath)).status, 200, 'un código malo no gasta el acceso');
    await gp.locator('#vaultCode').fill(link);
    await gp.locator('#masterPass2').fill('otra distinta');
    await gp.locator('#btnUnlock').click();
    await gp.locator('#lockError').getByText('Las dos contraseñas no coinciden.').waitFor();
    await gp.locator('#masterPass2').fill(GUEST_MASTER);
    await gp.locator('#btnUnlock').click();
    await gp.locator('#recoveryReveal').waitFor({state:'visible', timeout:30000});
    const guestRecovery = (await gp.locator('#recoveryKeyBox').textContent()).trim();
    assert.ok(guestRecovery.length > 30 && guestRecovery !== seed.recovery, 'el invitado tiene su propia clave de recuperación');
    await gp.locator('#recoveryConfirmChk').check();
    await gp.locator('#btnRecoveryContinue').click();
    await gp.locator('#vaultContent').waitFor({state:'visible'});
    await gp.locator('#vaultGrid').getByText('Servidor de Acme').first().waitFor();
    assert.equal(await gp.evaluate((id) => Workhub.app.models.vault.reveal(id).then((d) => d.password + '|' + d.notas), seed.entry), 'secreto-uno|nota reservada');
    assert.ok(gone(await storedWhen(grantPath, gone)), 'el acceso se borra al usarlo');
    const guestKey = await stored(base + '/vault_keys/' + guest.uid);
    assert.equal(guestKey.status, 200, 'clave envuelta del invitado');

    /* El enlace ya no sirve: ni para él ni para nadie. */
    const reuse = await gp.evaluate((c) => Workhub.app.models.vault.redeem(c, 'otra contraseña').then(() => 'ok', (err) => err.code), code);
    assert.equal(reuse, 'no-grant', 'el enlace solo sirve una vez');
    assert.equal((await stored(base + '/vault_keys/' + guest.uid)).text, guestKey.text, 'y no toca su clave');

    /* Cada uno con su contraseña maestra: la del invitado abre su copia, la de la propietaria no. */
    await gp.locator('#btnLock').click();
    await gp.locator('#lockTitle').getByText('Desbloquear contraseñas').waitFor();
    await gp.locator('#masterPass').fill(MASTER);
    await gp.locator('#btnUnlock').click();
    await gp.locator('#lockError').getByText('Contraseña maestra incorrecta.').waitFor({timeout:30000});
    await gp.locator('#masterPass').fill(GUEST_MASTER);
    await gp.locator('#btnUnlock').click();
    await gp.locator('#vaultContent').waitFor({state:'visible', timeout:30000});

    /* Lo que guarda uno lo lee el otro. */
    await gp.evaluate(() => Workhub.app.models.vault.saveEntry(null, {tipo:'correo', cliente:'', label:'Guardada por Luis', correo:'luis@acme.test'}, {password:'secreto-de-luis', notas:''}));
    await page.locator('#vaultGrid').getByText('Guardada por Luis').first().waitFor({timeout:30000});
    assert.equal(await page.evaluate(() => { const v = Workhub.app.models.vault; return v.reveal(v.items.find((x) => x.label === 'Guardada por Luis').id).then((d) => d.password); }), 'secreto-de-luis');
    assert.ok((await stored(base + '/vault')).text.indexOf('secreto-de-luis') === -1, 'lo del invitado tampoco va en claro');

    /* ---------- dar acceso a quien ya es miembro ---------- */
    await page.evaluate(() => Workhub.app.controllers.team.open());
    await page.locator('#shMembers [data-act="grant"]').waitFor({state:'visible', timeout:15000});
    assert.equal(await page.locator('#shMembers [data-act="grant"]').count(), 1, 'solo para los demás miembros');
    await page.locator('#shMembers [data-act="grant"]').click();
    await page.locator('#shError').getByText('Escribe tu contraseña maestra para dar acceso a las contraseñas.').waitFor();
    await page.locator('#shMasterPass').fill(MASTER);
    await page.locator('#shMembers [data-act="grant"]').click();
    await page.locator('#shCodePanel').waitFor({state:'visible', timeout:30000});
    const link2 = (await page.locator('#shLink').textContent()).trim();
    assert.ok(link2.indexOf('#cofre=' + tid + '.') !== -1 && link2 !== link, 'un enlace nuevo');
    assert.equal((await storedWhen(grantPath, (res) => res.status === 200)).status, 200);
    await page.locator('#shCodeDone').click();

    /* ---------- expulsar: se borran su clave y su acceso pendiente ---------- */
    await page.locator('#shMembers [data-act="remove"]').click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    await page.locator('#confirmText').getByText('Si tenía acceso a las contraseñas, pudo copiarlas').waitFor();
    await page.locator('#btnConfirmOk').click();
    assert.ok(gone(await storedWhen(base + '/vault_keys/' + guest.uid, gone)), 'al expulsar se borra su clave del cofre');
    assert.ok(gone(await storedWhen(grantPath, gone)), 'y su acceso pendiente');
    assert.equal((await stored(base + '/vault_keys/' + owner.uid)).status, 200);
    await gp.waitForFunction((key) => !Workhub.app.models.projects.exists(key), 't:' + tid, {timeout:30000});
    await closeShare(page);

    /* ---------- eliminar el equipo: se va el cofre entero ---------- */
    await page.evaluate((key) => Workhub.app.deleteProject(key), 't:' + tid);
    assert.ok(gone(await storedWhen(base, gone)));
    assert.ok(gone(await storedWhen(base + '/vault_meta/check', gone)), 'la marca del cofre');
    assert.ok(gone(await storedWhen(base + '/vault_keys/' + owner.uid, gone)), 'la clave de la propietaria');
    assert.ok(empty(await storedWhen(base + '/vault', empty)), 'y las credenciales');

    assert.deepEqual(owner.errors, [], 'sin excepciones JavaScript (propietaria)');
    assert.deepEqual(guest.errors, [], 'sin excepciones JavaScript (invitado)');
    await guest.context.close();
    await owner.context.close();
    console.log('OK   Firebase emulado: contraseñas compartidas en un equipo (mover el proyecto, enlace de un solo uso, contraseña maestra propia, expulsar)');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
