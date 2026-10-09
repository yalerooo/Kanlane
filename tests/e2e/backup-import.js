/* Importar una copia de seguridad, con Auth y Firestore emulados: la tarea importada conserva sus
   subtareas (con lo que estaba hecho) y los adjuntos de sus notas, que se copian a archivos nuevos.
   - el archivo exportado lleva las subtareas y la referencia a los adjuntos;
   - la copia tiene las mismas subtareas, y sus adjuntos son otros documentos con el mismo contenido;
   - borrar las notas de la tarea original (y sus archivos) no deja a la copia sin los suyos;
   - si un adjunto ya no existe al importar, la nota entra sin él y el aviso lo dice.
   Uso: dentro de «firebase emulators:exec» (ver .github/workflows/checks.yml). */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58664;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
const PASSWORD = 'contraseña-prueba-123';
const TITLE = 'Con subtareas y adjuntos';
const TEXT = 'Contenido del adjunto: áéíóú ñ.';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

(async () => {
  await ready();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanlane-copia-'));
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES', acceptDownloads:true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await page.locator('.consent [data-act="reject"]').isVisible()) await page.locator('.consent [data-act="reject"]').click();
    await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});

    /* ---------- cuenta y proyecto ---------- */
    const email = 'ana-copia-' + Date.now() + '@example.test';
    await page.locator('#authSwitchLink').click();
    await page.locator('#authName').fill('Ana Copia');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill(PASSWORD);
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Proyecto con copia');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.waitForFunction(() => Workhub.app.models.tasks.isReady());

    /* ---------- una tarea con subtareas, un archivo y dos fotos ---------- */
    const made = await page.evaluate(async (a) => {
      const app = Workhub.app, P = Workhub.services.platform, S = Workhub.models.TaskModel.STATUS;
      const ref = await app.models.tasks.save(null, {title:a.title, desc:'Con **Markdown**', status:S[0].key, cliente:'', contacto:'', dueDate:'', labels:['copia'],
        checklist:[{id:'c1', text:'Hecha', done:true}, {id:'c2', text:'Pendiente', done:false}]});
      const txt = new File([a.text], 'informe.txt', {type:'text/plain'});
      const parts = await P.uploadFile(txt);
      await app.models.tasks.addNote(ref.id, 'Con archivo', [{name:'informe.txt', type:'text/plain', size:txt.size, image:false, parts:parts}]);
      const photo = (color) => new Promise((resolve) => {
        const c = document.createElement('canvas');
        c.width = c.height = 48;
        const x = c.getContext('2d');
        x.fillStyle = color;
        x.fillRect(0, 0, 48, 48);
        c.toBlob((b) => resolve(new File([b], 'foto.png', {type:'image/png'})), 'image/png');
      });
      const i1 = await P.uploadAsset(await photo('#cc0000')), i2 = await P.uploadAsset(await photo('#0000cc'));
      await app.models.tasks.addNote(ref.id, 'Con dos fotos', [{name:'roja.png', type:'image/jpeg', size:1, image:true, parts:[i1]}, {name:'azul.png', type:'image/jpeg', size:1, image:true, parts:[i2]}]);
      return {id:ref.id, parts:parts, images:[i1, i2]};
    }, {title:TITLE, text:TEXT});
    assert.ok(made.parts.length >= 1 && made.images.every(Boolean), 'los adjuntos se han subido');

    /* ---------- exportar ---------- */
    await page.locator('#tabData').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExportData').click()]);
    const file = path.join(dir, 'copia.json');
    await download.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const exported = json.tasks.find((t) => t.title === TITLE);
    assert.deepEqual(exported.checklist.map((c) => [c.text, c.done]), [['Hecha', true], ['Pendiente', false]], 'el archivo lleva las subtareas');
    assert.deepEqual(exported.notes.find((n) => n.text === 'Con archivo').attachments[0].parts, made.parts, 'y la referencia al adjunto');

    /* ---------- importar la misma copia ---------- */
    await page.locator('#importFileInput').setInputFiles(file);
    await page.locator('#dataStatus', {hasText:/^Importado: 0 clientes, 1 tareas \(2 notas\), 0 reuniones, 0 contactos, 0 contraseñas\.$/}).waitFor({timeout:60000});

    /* Lo que tiene la tarea importada, leído de la base de datos. */
    const read = (originalId) => page.evaluate(async (a) => {
      const app = Workhub.app, P = Workhub.services.platform;
      const copies = app.models.tasks.items.filter((t) => t.title === a.title && t.id !== a.id);
      const out = {copies:copies.length, checklist:[], notes:[]};
      if(copies.length !== 1) return out;
      out.id = copies[0].id;
      out.checklist = (copies[0].checklist || []).map((c) => [c.text, c.done]);
      out.desc = copies[0].desc;
      out.labels = copies[0].labels;
      const snap = await app.models.tasks.notes(copies[0].id).get();
      for(const d of snap.docs){
        const n = d.data();
        const files = [];
        for(const att of (n.attachments || [])){
          let content = null;
          try{
            const blob = await P.fileBlob(att);
            content = att.image ? 'imagen de ' + blob.size + ' bytes' : await blob.text();
          }catch(e){ content = 'ERROR ' + e.message; }
          files.push({name:att.name, image:!!att.image, parts:att.parts, content:content});
        }
        out.notes.push({text:n.text, files:files, assetIds:n.assetIds || []});
      }
      out.notes.sort((x, y) => (x.text < y.text ? -1 : 1));
      return out;
    }, {title:TITLE, id:originalId});

    await page.waitForFunction((a) => Workhub.app.models.tasks.items.filter((t) => t.title === a).length === 2, TITLE, {timeout:30000});
    let copy = await read(made.id);
    assert.equal(copy.copies, 1, 'importar añade una copia');
    assert.deepEqual(copy.checklist, [['Hecha', true], ['Pendiente', false]], 'la copia conserva las subtareas y lo que estaba hecho');
    assert.deepEqual([copy.desc, copy.labels], ['Con **Markdown**', ['copia']]);
    assert.deepEqual(copy.notes.map((n) => n.text), ['Con archivo', 'Con dos fotos']);
    const fileNote = copy.notes[0], photoNote = copy.notes[1];
    assert.deepEqual(fileNote.files.map((f) => [f.name, f.content]), [['informe.txt', TEXT]], 'el archivo de la nota llega entero');
    assert.ok(fileNote.files[0].parts.every((id) => made.parts.indexOf(id) === -1), 'y es otro documento, no el de la nota original');
    assert.deepEqual(fileNote.assetIds, fileNote.files[0].parts);
    assert.deepEqual(photoNote.files.map((f) => [f.name, f.image, /^imagen de [1-9]\d* bytes$/.test(f.content)]), [['roja.png', true, true], ['azul.png', true, true]], 'las dos fotos también: ' + JSON.stringify(photoNote.files));
    assert.ok(photoNote.files.every((f) => made.images.indexOf(f.parts[0]) === -1), 'copiadas, no enlazadas');

    /* ---------- borrar las notas de la original no deja a la copia sin archivos ---------- */
    await page.evaluate(async (id) => {
      const app = Workhub.app, P = Workhub.services.platform;
      const snap = await app.models.tasks.notes(id).get();
      for(const d of snap.docs) await P.deleteAssets(await app.models.tasks.removeNote(id, d.id));
    }, made.id);
    const gone = await page.evaluate(async (parts) => { try{ await Workhub.services.platform.fileBlob({parts:parts, type:'text/plain'}); return false; }catch(e){ return true; } }, made.parts);
    assert.equal(gone, true, 'el archivo de la original ya no existe');
    copy = await read(made.id);
    assert.equal(copy.notes[0].files[0].content, TEXT, 'el de la copia sigue ahí');
    assert.ok(copy.notes[1].files.every((f) => /^imagen de [1-9]\d* bytes$/.test(f.content)), 'y sus fotos');

    /* En la ficha de la copia se ve el adjunto. */
    await page.locator('#tabTasks').click();
    await page.evaluate((id) => { const el = document.querySelector('[data-id="' + id + '"]'); if(el) el.click(); }, copy.id);
    const shown = await page.getByText('informe.txt').first().waitFor({state:'visible', timeout:15000}).then(() => true, () => false);
    assert.equal(shown, true, 'la ficha de la tarea importada enseña el archivo');
    await page.keyboard.press('Escape');

    /* ---------- el mismo archivo otra vez: los adjuntos de la original ya no existen ---------- */
    await page.locator('#tabData').click();
    await page.locator('#importFileInput').setInputFiles(file);
    await page.locator('#dataStatus', {hasText:'No se pudieron copiar 3 archivos adjuntos: ya no están disponibles o no se pudieron subir.'}).waitFor({timeout:60000});
    const third = await page.evaluate(async (a) => {
      const app = Workhub.app;
      const tasks = app.models.tasks.items.filter((t) => t.title === a.title && a.known.indexOf(t.id) === -1);
      if(tasks.length !== 1) return {tasks:tasks.length};
      const snap = await app.models.tasks.notes(tasks[0].id).get();
      return {tasks:1, checklist:(tasks[0].checklist || []).length, notes:snap.docs.map((d) => [d.data().text, (d.data().attachments || []).length]).sort()};
    }, {title:TITLE, known:[made.id, copy.id]});
    assert.deepEqual(third, {tasks:1, checklist:2, notes:[['Con archivo', 0], ['Con dos fotos', 0]]}, 'las notas entran con su texto, sin los archivos que ya no están');

    assert.deepEqual(errors, [], 'sin errores de la página');
    console.log('OK   importar una copia: subtareas, adjuntos copiados, independientes de la original y aviso de los que faltan');
  }finally{
    await browser.close();
    fs.rmSync(dir, {recursive:true, force:true});
  }
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.kill());
