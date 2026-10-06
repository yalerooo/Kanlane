/* Proyecto con cifrado total contra Auth/Firestore emulados y las reglas reales (PR3b del plan,
   docs/CIFRADO-PROYECTOS.md 14.4). Aquí no se usa el asistente (lo prueba crypto-wizard.js):
   el proyecto se siembra desde la página con el servicio de cifrado: documento con `enc`, clave envuelta
   en crypto/{uid} y la clave en el almacén del navegador. Comprueba que la app lo abre, que lo que llega
   a Firestore va sellado, que sin la clave no se conecta nada y que un proyecto sin cifrar sigue igual.
   PR6: renombrar un cliente, aviso de privacidad de los plugins, exportar e importar la copia cifrada,
   versiones locales selladas y Ctrl K con el proyecto bloqueado.
   Uso: npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub
        --config firebase.test.json "node tests/e2e/crypto-smoke.js" */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58639;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

const SECRETS = ['Tarea secreta', 'Descripción reservada', 'Nota confidencial', 'Cliente Reservado', 'valor privado del plugin', 'Título cambiado', 'Cliente Renombrado'];
const PASSWORD = 'una contraseña de cifrado larga';

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

/* Lo que hay de verdad en Firestore, leído como administrador (sin reglas). */
async function stored(docPath){
  const response = await fetch(storeUrl + docPath, {headers:{Authorization:'Bearer owner'}});
  return {status:response.status, text:await response.text()};
}
/* La interfaz pinta una escritura antes de que llegue al servidor (Firestore la aplica primero en local):
   lo guardado se consulta hasta que cumple la condición, con un tope de 15 s. */
async function storedWhen(docPath, done){
  let res;
  for(let i = 0; i < 75; i++){
    res = await stored(docPath);
    if(done(res)) return res;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return res;
}
const hasSeal = (res) => res.status === 200 && res.text.indexOf('"ev"') !== -1;
function assertSealed(res, what){
  assert.equal(res.status, 200, what + ': se puede leer');
  SECRETS.forEach((s) => assert.ok(res.text.indexOf(s) === -1, what + ': «' + s + '» no está en claro'));
  assert.ok(res.text.indexOf('"ev"') !== -1 && res.text.indexOf('"kid"') !== -1 && res.text.indexOf('"e"') !== -1, what + ': documentos sellados (e, ev, kid)');
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
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await page.locator('#authSwitchLink').click();
    const email = 'cifrado-' + Date.now() + '@example.test';
    await page.locator('#authName').fill('Persona de prueba');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill('contraseña-prueba-123');
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Proyecto sin cifrar');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    /* Paso de privacidad del asistente: «Solo contraseñas» viene elegido. */
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});

    /* ---------- sembrar un proyecto con cifrado total ---------- */
    const seed = await page.evaluate(async () => {
      const app = Workhub.app, PC = Workhub.services.projectCrypto;
      const uid = app.rootDb.me.uid;
      const raw = PC.newDekBytes(), pid = PC.newPid(), kid = PC.newKid();
      const ctx = {pid:pid, kid:kid, uid:uid};
      const key = await PC.importDek(raw);
      const kcv = await PC.kcv(key, pid, kid);
      const pw = await PC.wrapPassword(raw, 'una contraseña de cifrado larga', ctx);
      const rk = await PC.wrapRecovery(raw, PC.newRecoveryKey().bytes, ctx);
      raw.fill(0);
      const ref = app.rootDb.collection('projects').doc();
      const now = Date.now();
      /* Mismo orden que tendrá el PR4: primero la clave envuelta, después el proyecto. */
      await ref.collection('crypto').doc(uid).set({v:1, kid:kid, kdf:pw.kdf, pw:pw.pw, rk:rk.rk, createdAt:now, updatedAt:now});
      await ref.set({nombre:'Proyecto cifrado de prueba', createdAt:now, tipo:'kanban', enc:{v:1, mode:'pw', pid:pid, kid:kid, kcv:kcv, createdAt:now}});
      const where = await Workhub.services.keystore.put({uid:uid, pid:pid, projectId:ref.id, kid:kid, key:key, trusted:true});
      return {id:ref.id, uid:uid, pid:pid, where:where};
    });
    assert.equal(seed.where, 'disk', 'la clave queda en IndexedDB');
    const base = 'users/' + seed.uid + '/projects/' + seed.id;

    await page.waitForFunction((id) => !!Workhub.app.models.projects.get(id), seed.id);
    await page.evaluate((id) => Workhub.app.switchProject(id), seed.id);
    await page.waitForFunction(() => !!Workhub.app.cipher && Workhub.app.models.tasks.loaded === true);
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false);

    /* ---------- escribir con la interfaz y con los modelos ---------- */
    await page.locator('#btnNew').click();
    await page.locator('#fTitle').fill('Tarea secreta del proyecto');
    await page.locator('#btnSave').click();
    await page.locator('.card').filter({hasText:'Tarea secreta del proyecto'}).waitFor();
    const taskId = await page.evaluate(async () => {
      const app = Workhub.app, m = app.models;
      const t = m.tasks.items.find((x) => x.title === 'Tarea secreta del proyecto');
      await m.tasks.update(t.id, {desc:'Descripción reservada', checklist:[{id:'a', text:'Paso', done:false}]});
      await app.createClient('Cliente Reservado');
      /* Imagen de una nota: se comprime y se cifra en el navegador. */
      const canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = 60;
      const g = canvas.getContext('2d');
      g.fillStyle = '#2F6BFF'; g.fillRect(0, 0, 80, 60);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const assetId = await Workhub.services.platform.uploadAsset(new File([blob], 'nota.png', {type:'image/png'}));
      await m.tasks.addNote(t.id, 'Nota confidencial', assetId);
      /* Archivo adjunto de dos trozos: cifrado trozo a trozo y legible de vuelta. */
      const secretBytes = new Uint8Array(700000);
      for(let i = 0; i < secretBytes.length; i++) secretBytes[i] = (i * 17 + 3) % 253;
      const files = await Workhub.views.attachments.upload([new File([secretBytes], 'contrato reservado.pdf', {type:'application/pdf'})]);
      if(files.length !== 1 || files[0].parts.length !== 2) throw new Error('trozos: ' + JSON.stringify(files));
      window.__fileNote = (await m.tasks.addNote(t.id, 'Nota con archivo', files)).id;
      const round = new Uint8Array(await (await Workhub.services.platform.fileBlob(files[0])).arrayBuffer());
      if(round.length !== secretBytes.length || round.some((b, i) => b !== secretBytes[i])) throw new Error('el archivo cifrado no vuelve igual');
      window.__filePart = files[0].parts[1];
      const PluginModel = Workhub.models.PluginModel;
      await PluginModel.storageSet(app.controllers.plugins.bucket('workhub.prueba'), 'dato', 'valor privado del plugin');
      window.__assetId = assetId;
      return t.id;
    });
    await page.locator('.card').filter({hasText:'Descripción reservada'}).waitFor();

    assertSealed(await storedWhen(base + '/tasks', hasSeal), 'tareas');
    assertSealed(await storedWhen(base + '/tasks/' + taskId + '/notes', hasSeal), 'notas');
    assertSealed(await storedWhen(base + '/clients', hasSeal), 'clientes');
    assertSealed(await storedWhen(base + '/plugin_data', hasSeal), 'datos de plugins');
    const assetId = await page.evaluate(() => window.__assetId);
    assert.ok(assetId, 'la imagen se subió');
    const asset = await storedWhen('users/' + seed.uid + '/assets/' + assetId, hasSeal);
    /* El trozo del archivo adjunto también está sellado, sin `data` ni tipo en claro. */
    const filePart = await storedWhen('users/' + seed.uid + '/assets/' + await page.evaluate(() => window.__filePart), hasSeal);
    assertSealed(filePart, 'archivo adjunto');
    assert.ok(filePart.text.indexOf('"data"') === -1 && filePart.text.indexOf('contentType') === -1, 'el trozo no lleva su contenido en claro');
    const fileNotes = await stored(base + '/tasks/' + taskId + '/notes');
    assert.ok(fileNotes.text.indexOf('contrato reservado') === -1 && fileNotes.text.indexOf('application/pdf') === -1, 'el nombre y el tipo del archivo van cifrados');
    assert.ok(fileNotes.text.indexOf('assetIds') !== -1, 'los ids de los trozos van en claro');
    /* Al eliminar la nota se van sus trozos (los ids en claro bastan, sin descifrarla). */
    assert.equal(await page.evaluate(async (id) => {
      const ids = await Workhub.app.models.tasks.removeNote(id, window.__fileNote);
      await Workhub.services.platform.deleteAssets(ids);
      return ids.length + ':' + !!(await window.__assetBytes(window.__filePart));
    }, taskId), '2:false', 'los trozos se borran con la nota');
    assertSealed(asset, 'imagen');
    assert.ok(asset.text.indexOf('"data"') === -1 && asset.text.indexOf('contentType') === -1, 'la imagen no lleva la data: URL en claro');

    /* ---------- leer: ficha con la nota y su imagen descifradas ---------- */
    await page.locator('.card').filter({hasText:'Tarea secreta del proyecto'}).click();
    await page.locator('.tv-note-text').filter({hasText:'Nota confidencial'}).waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector('.tv-note img');
      return !!img && img.src.indexOf('data:image/jpeg;base64,') === 0 && img.naturalWidth === 80;
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(async () => {
      const app = Workhub.app;
      return Workhub.models.PluginModel.storageGet(app.controllers.plugins.bucket('workhub.prueba'), 'dato');
    }), 'valor privado del plugin');

    /* Mover no reescribe el blob; cambiar el título sí, con otro IV. */
    const moved = await page.evaluate(async (id) => {
      const m = Workhub.app.models.tasks;
      const ref = m.doc(id);
      const e0 = (await ref.get()).data().e;
      m.move(id, Workhub.models.TaskModel.STATUS[1].key);
      await new Promise((r) => setTimeout(r, 300));
      const d1 = (await ref.get()).data();
      await m.update(id, {title:'Título cambiado en cifrado'});
      const d2 = (await ref.get()).data();
      return {same:d1.e === e0, status:d1.status, changed:d2.e !== e0, iv:d2.e.slice(0, 16) !== e0.slice(0, 16)};
    }, taskId);
    assert.deepEqual(moved, {same:true, status:moved.status, changed:true, iv:true});
    await page.locator('.card').filter({hasText:'Título cambiado en cifrado'}).waitFor();
    assertSealed(await storedWhen(base + '/tasks', hasSeal), 'tareas tras editar');

    /* Las reglas publicadas no dejan escribir en claro dentro del proyecto cifrado. */
    const denied = await page.evaluate(async (id) => {
      const col = Workhub.app.rootDb.collection('projects').doc(id).collection('tasks');
      try{ await col.add({title:'en claro', status:'pendiente', createdAt:Date.now()}); return 'aceptado'; }
      catch(e){ return e.code; }
    }, seed.id);
    assert.equal(denied, 'permission-denied', 'crear en claro en un proyecto cifrado se rechaza');

    /* ---------- PR6: renombrar un cliente (el servidor no ve el nombre: se filtra en memoria) ---------- */
    const renamed = await page.evaluate(async (id) => {
      const app = Workhub.app, m = app.models, c = app.controllers.clients;
      await m.tasks.update(id, {cliente:'Cliente Reservado'});
      /* Como al guardar el diálogo de editar con otro nombre y el mismo color. */
      const client = m.clients.items.find((x) => x.nombre === 'Cliente Reservado');
      c.editingId = client.id;
      c.saveEdit('Cliente Renombrado', typeof client.color === 'number' ? client.color : null);
      const busy = c.busy && document.getElementById('btnSaveClient').textContent;
      for(let i = 0; i < 100 && c.busy; i++) await new Promise((r) => setTimeout(r, 50));
      return {busy:busy, after:c.busy, client:m.clients.items.map((x) => x.nombre), task:m.tasks.find(id).cliente};
    }, taskId);
    assert.deepEqual(renamed, {busy:'Guardando…', after:false, client:['Cliente Renombrado'], task:'Cliente Renombrado'});
    assertSealed(await storedWhen(base + '/clients', hasSeal), 'clientes tras renombrar');
    assertSealed(await storedWhen(base + '/tasks', hasSeal), 'tareas tras renombrar el cliente');

    /* ---------- PR6: aviso de privacidad en la ficha de un plugin ---------- */
    await page.evaluate(() => { Workhub.app.navigate('plugins'); Workhub.app.controllers.plugins.installOfficial(0); });
    await page.locator('#dlgPlugin #pluginEncNote').getByText('Este proyecto tiene cifrado total. El plugin recibirá sin cifrar los datos a los que le des permiso').waitFor();
    await page.locator('#btnPluginCancel').click();

    /* ---------- PR6: exportar cifrado por defecto, sin cifrar con confirmación ---------- */
    await page.evaluate(() => Workhub.app.navigate('data'));
    await page.locator('#btnExportData').getByText('Exportar copia cifrada').waitFor();
    assert.equal(await page.locator('#btnExportPlain').isVisible(), true);
    assert.equal(await page.locator('#exportEncHelp').isVisible(), true);
    let downloading = page.waitForEvent('download');
    await page.locator('#btnExportData').click();
    let download = await downloading;
    assert.match(download.suggestedFilename(), /^kanlane-copia-cifrada-proyecto-cifrado-de-prueba-\d{4}-\d{2}-\d{2}\.json$/);
    const sealedFile = fs.readFileSync(await download.path(), 'utf8');
    SECRETS.forEach((s) => assert.ok(sealedFile.indexOf(s) === -1, 'archivo cifrado: «' + s + '» no está en claro'));
    const sealedJson = JSON.parse(sealedFile);
    assert.equal(sealedJson.format, 'kanlane-encrypted-backup');
    assert.deepEqual([sealedJson.pid, sealedJson.uid], [seed.pid, seed.uid]);
    assert.ok(sealedJson.kdf && sealedJson.pw && sealedJson.rk && sealedJson.data.length > 100);
    await page.locator('#dataStatus').getByText(/^Copia cifrada descargada: 1 tareas/).waitFor();

    let confirmText = '';
    page.once('dialog', (dialog) => { confirmText = dialog.message(); dialog.accept(); });
    downloading = page.waitForEvent('download');
    await page.locator('#btnExportPlain').click();
    download = await downloading;
    assert.equal(confirmText, 'El archivo tendrá todo el proyecto sin cifrar. Guárdalo en un lugar seguro y bórralo cuando no lo necesites.');
    assert.match(download.suggestedFilename(), /^workhub-backup-/);
    const plainFile = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(plainFile.tasks[0].title, 'Título cambiado en cifrado');
    assert.equal(plainFile.tasks[0].notes[0].text, 'Nota confidencial');

    /* ---------- PR6: las versiones locales se guardan selladas ---------- */
    await page.locator('#btnSaveBackupVersion').click();
    await page.locator('#backupHistory .backup-version').first().waitFor();
    const versions = await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('workhub-backup-history', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const all = req.result.transaction('versions', 'readonly').objectStore('versions').getAll();
        all.onsuccess = () => resolve(all.result.filter((v) => v.scope.endsWith(':' + Workhub.app.projectId)));
        all.onerror = () => reject(all.error);
      };
    }));
    assert.ok(versions.length >= 1);
    versions.forEach((v) => {
      assert.ok(typeof v.e === 'string' && v.json === undefined, 'versión local sellada');
      SECRETS.forEach((s) => assert.ok(JSON.stringify(v).indexOf(s) === -1, 'versión local: «' + s + '» no está en claro'));
    });
    /* La versión sellada se puede importar en el mismo proyecto: añade las tareas, selladas. */
    await page.locator('#backupHistory [data-backup-action="restore"]').first().click();
    await page.locator('#dataStatus').getByText(/^Importado: 0 clientes, 1 tareas \(1 notas\)/).waitFor();
    await page.waitForFunction(() => Workhub.app.models.tasks.items.length === 2);
    assertSealed(await storedWhen(base + '/tasks', hasSeal), 'tareas tras importar una versión');
    /* El archivo cifrado del mismo proyecto se importa sin pedir nada. */
    await page.locator('#importFileInput').setInputFiles({name:'copia-cifrada.json', mimeType:'application/json', buffer:Buffer.from(sealedFile)});
    await page.waitForFunction(() => Workhub.app.models.tasks.items.length === 3);
    assert.equal(await page.locator('#dlgBackupKey').isVisible(), false, 'con la clave del mismo proyecto no se pide la contraseña');
    assertSealed(await storedWhen(base + '/tasks', hasSeal), 'tareas tras importar el archivo cifrado');
    await page.evaluate(() => Workhub.app.navigate('tasks'));

    /* ---------- recargar: la clave sigue en el navegador ---------- */
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.card').filter({hasText:'Título cambiado en cifrado'}).first().waitFor({timeout:30000});
    assert.equal(await page.locator('#projectLockScreen').isVisible(), false);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('workhub_project')).enc), true, 'el proyecto recordado lleva enc');

    /* ---------- sin la clave: no se conecta nada ---------- */
    await page.evaluate((s) => Workhub.services.keystore.forget(s.uid, s.pid), seed);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#projectLockScreen').waitFor({state:'visible', timeout:30000});
    await page.locator('#plDesc').getByText('Escribe la contraseña de cifrado de «Proyecto cifrado de prueba». Solo se usa en tu navegador.').waitFor();
    const locked = await page.evaluate(() => {
      const m = Workhub.app.models;
      return {ready:m.tasks.isReady(), items:m.tasks.items.length, cipher:!!Workhub.app.cipher,
        tasksVisible:!!document.querySelector('#viewTasks').offsetParent, cards:document.querySelectorAll('.card').length};
    });
    assert.deepEqual(locked, {ready:false, items:0, cipher:false, tasksVisible:false, cards:0});
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'aviso sin desbordamiento en móvil');
    await page.setViewportSize({width:1280, height:850});
    /* PR6: con el proyecto bloqueado, Ctrl K solo ofrece lo que no toca sus datos. */
    await page.keyboard.press('n');
    assert.equal(await page.locator('#dlg').isVisible(), false, 'N no abre una tarea nueva con el proyecto bloqueado');
    await page.keyboard.press('Control+k');
    await page.locator('#dlgCommand').waitFor({state:'visible'});
    const lockedTitles = await page.locator('#cmdList .cmdk-title').allTextContents();
    assert.ok(lockedTitles.includes('Desbloquear proyecto'), 'Ctrl K ofrece desbloquear');
    ['Nueva tarea', 'Nuevo cliente', 'Exportar copia de seguridad', 'Bloquear este proyecto'].forEach((title) =>
      assert.ok(!lockedTitles.includes(title), 'Ctrl K no ofrece «' + title + '» con el proyecto bloqueado'));
    await page.locator('#cmdInput').fill('exportar');
    assert.equal(await page.locator('#cmdList .cmdk-item').count(), 0, 'buscar una acción de datos no da resultados');
    await page.locator('#cmdInput').fill('tema');
    assert.ok(await page.locator('#cmdList .cmdk-item').count() >= 3, 'las acciones globales siguen');
    await page.keyboard.press('Escape');
    /* La contraseña con la que se sembró abre el proyecto (la clave envuelta es la que crea la app). */
    await page.locator('#plPass').fill(PASSWORD);
    await page.locator('#plUnlock').click();
    await page.locator('.card').filter({hasText:'Título cambiado en cifrado'}).first().waitFor({timeout:30000});
    await page.keyboard.press('Control+k');
    await page.locator('#dlgCommand').waitFor({state:'visible'});
    await page.locator('#cmdInput').fill('proyecto');
    const openTitles = await page.locator('#cmdList .cmdk-title').allTextContents();
    assert.ok(openTitles.includes('Bloquear este proyecto') && !openTitles.includes('Desbloquear proyecto'), 'desbloqueado, Ctrl K ofrece bloquear');
    await page.keyboard.press('Escape');

    /* ---------- un proyecto sin cifrar sigue igual ---------- */
    await page.evaluate(() => Workhub.app.switchProject('main'));
    await page.locator('#projectLockScreen').waitFor({state:'hidden'});
    await page.locator('#btnNew').click();
    await page.locator('#fTitle').fill('Tarea en claro del principal');
    await page.locator('#btnSave').click();
    await page.locator('.card').filter({hasText:'Tarea en claro del principal'}).waitFor();
    const plain = await storedWhen('users/' + seed.uid + '/tasks', (res) => res.text.indexOf('Tarea en claro del principal') !== -1);
    assert.ok(plain.text.indexOf('Tarea en claro del principal') !== -1, 'el proyecto sin cifrar guarda como siempre');
    assert.ok(plain.text.indexOf('"ev"') === -1);

    /* ---------- PR6: en un proyecto sin cifrar no hay avisos y la copia cifrada pide su contraseña ---------- */
    await page.evaluate(() => { Workhub.app.navigate('plugins'); Workhub.app.controllers.plugins.installOfficial(0); });
    await page.locator('#dlgPlugin').waitFor({state:'visible'});
    assert.equal(await page.locator('#pluginEncNote').count(), 0, 'sin cifrado no hay aviso de privacidad en los plugins');
    await page.locator('#btnPluginCancel').click();
    await page.evaluate(() => Workhub.app.navigate('data'));
    await page.locator('#btnExportData').getByText('Exportar copia de seguridad').waitFor();
    assert.equal(await page.locator('#btnExportPlain').isVisible(), false);
    assert.equal(await page.locator('#exportEncHelp').isVisible(), false);
    await page.locator('#importFileInput').setInputFiles({name:'copia-cifrada.json', mimeType:'application/json', buffer:Buffer.from(sealedFile)});
    await page.locator('#dlgBackupKey').waitFor({state:'visible'});
    assert.equal(await page.locator('#bkPlainNote').isVisible(), true, 'avisa de que el destino no tiene cifrado total');
    await page.locator('#bkSecret').fill('una contraseña que no es');
    await page.locator('#bkSubmit').click();
    await page.locator('#bkError').getByText('La contraseña o la clave de recuperación no son correctas.').waitFor({timeout:30000});
    assert.equal(await page.evaluate(() => Workhub.app.models.tasks.items.length), 1, 'con la contraseña errónea no se importa nada');
    await page.setViewportSize({width:375, height:812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'diálogo de la copia cifrada sin desbordamiento en móvil');
    await page.setViewportSize({width:1280, height:850});
    await page.locator('#bkSecret').fill(PASSWORD);
    await page.locator('#bkSubmit').click();
    await page.locator('#dlgBackupKey').waitFor({state:'hidden', timeout:30000});
    await page.locator('#dataStatus').getByText(/^Importado: 1 clientes, 1 tareas \(1 notas\)/).waitFor();
    const imported = await storedWhen('users/' + seed.uid + '/tasks', (res) => res.text.indexOf('Título cambiado en cifrado') !== -1);
    assert.ok(imported.text.indexOf('Título cambiado en cifrado') !== -1, 'la copia cifrada se importa en el proyecto sin cifrar');

    /* ---------- eliminar el proyecto cifrado ---------- */
    await page.evaluate((id) => Workhub.app.deleteProject(id), seed.id);
    assert.equal((await storedWhen(base + '/crypto/' + seed.uid, (res) => res.status === 404)).status, 404, 'la clave envuelta se borra con el proyecto');
    assert.equal((await storedWhen(base, (res) => res.status === 404)).status, 404);

    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    await context.close();
    console.log('OK   Firebase emulado: proyecto con cifrado total (sellado en Firestore, clientes, plugins, copias, Ctrl K, recarga, sin clave, eliminar)');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
