/* Tokens del servidor MCP en Ajustes → Integraciones, con Auth y Firestore emulados:
   - crear un token: se enseña una vez, con el comando para Claude Code, y queda en la lista;
   - lo que hace un asistente con ese token se ve en el tablero sin recargar;
   - «usado hace…» tras usarlo, «Ya lo he copiado» lo quita de la pantalla y recargar no lo devuelve;
   - un token de solo lectura no escribe; revocar corta el acceso al momento;
   - en inglés, y sin errores de la página.
   Uso: dentro de «firebase emulators:exec» (ver .github/workflows/checks.yml). */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58662;
const origin = 'http://localhost:' + port;
const url = origin + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const storeUrl = 'http://127.0.0.1:8187/v1/projects/demo-workhub/databases/(default)/documents/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));
const PASSWORD = 'contraseña-prueba-123';
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

/* Una llamada al servidor MCP, como la haría un asistente. */
let calls = 0;
async function rpc(token, method, params){
  const res = await fetch(origin + '/__/mcp/v1', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + token},
    body:JSON.stringify(Object.assign({jsonrpc:'2.0', id:++calls, method:method}, params ? {params:params} : {}))});
  return {status:res.status, body:await res.json()};
}
async function tool(token, name, args){
  const out = await rpc(token, 'tools/call', {name:name, arguments:args || {}});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const res = out.body.result;
  return res.isError ? {error:res.content[0].text} : JSON.parse(res.content[0].text);
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

    /* ---------- cuenta y proyecto ---------- */
    const email = 'ana-mcp-' + Date.now() + '@example.test';
    await page.locator('#authSwitchLink').click();
    await page.locator('#authName').fill('Ana MCP');
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPass').fill(PASSWORD);
    await page.locator('#authSubmit').click();
    await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
    await verify(email);
    await page.getByRole('button', {name:'Ya lo he verificado'}).click();
    await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
    await page.locator('#pNombre').fill('Proyecto con asistente');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#pStep2').waitFor({state:'visible'});
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden'});
    await page.waitForFunction(() => Workhub.app.models.tasks.isReady());
    const stages = await page.evaluate(() => Workhub.models.TaskModel.STATUS.map((s) => ({key:s.key, label:s.label, done:s.done})));

    /* ---------- Ajustes → Integraciones ---------- */
    const openSettings = async () => {
      await page.locator('#tabSettings').click();
      await page.locator('#settingsNav [data-sec="setIntegr"]').click();
      await page.locator('#mcpForm').waitFor({state:'visible', timeout:30000});
    };
    await openSettings();
    await page.locator('#mcpCard h3', {hasText:'Asistentes de IA (MCP)'}).waitFor();
    await page.locator('#mcpBody', {hasText:'Todavía no hay ningún token en este proyecto.'}).waitFor();
    assert.equal(await page.locator('label[for="mcpName"]').textContent(), 'Nombre del token nuevo', 'el campo tiene su etiqueta');

    /* Sin nombre: aviso y el foco vuelve al campo, sin llamar al servidor. */
    await page.locator('#mcpForm button[type="submit"]').click();
    await page.locator('#mcpNote', {hasText:'Ponle un nombre al token.'}).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'mcpName');

    /* ---------- crear ---------- */
    await page.locator('#mcpName').fill('Portátil');
    await page.locator('#mcpName').press('Enter');
    await page.locator('#mcpToken').waitFor({state:'visible', timeout:30000});
    const token = await page.locator('#mcpToken').inputValue();
    assert.match(token, /^kl_[a-z2-7]{32}$/);
    assert.equal(await page.locator('#mcpCommand').inputValue(), 'claude mcp add --transport http kanlane ' + origin + '/__/mcp/v1 --header "Authorization: Bearer ' + token + '"');
    await page.locator('#mcpFreshTitle', {hasText:'Token «Portátil» creado'}).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'mcpToken', 'el foco va al token recién creado');
    assert.equal(await page.locator('#mcpName').inputValue(), '', 'el formulario queda limpio');
    const row = page.locator('.mcp-list li', {hasText:'Portátil'});
    await row.locator('p', {hasText:/^Lectura y escritura · creado el .+ · sin usar todavía$/}).waitFor();
    /* En la base de datos no está el token. */
    const saved = await (await fetch(storeUrl + 'mcp_tokens?pageSize=50', {headers:{Authorization:'Bearer owner'}})).text();
    assert.ok(saved.indexOf('Portátil') !== -1 && saved.indexOf(token) === -1 && saved.indexOf(token.slice(19)) === -1, 'solo su hash');

    /* ---------- un asistente lo usa: se ve en el tablero sin recargar ---------- */
    assert.equal((await rpc(token, 'tools/list')).body.result.tools.length, 5);
    await page.locator('#tabTasks').click();
    const made = await tool(token, 'create_task', {title:'Creada por el asistente'});
    assert.equal(made.task.column_key, stages[0].key);
    const card = page.locator('.card', {hasText:'Creada por el asistente'});
    await card.waitFor({state:'visible', timeout:30000});
    const doing = stages[1];
    assert.equal((await tool(token, 'move_task', {id:made.task.id, column:doing.label})).moved, true);
    await page.waitForFunction((a) => { const t = Workhub.app.models.tasks.find(a.id); return !!t && t.status === a.key; }, {id:made.task.id, key:doing.key}, {timeout:30000});
    await tool(token, 'add_note', {id:made.task.id, text:'Nota del asistente'});
    await card.click();
    await page.getByText('Nota del asistente').first().waitFor({state:'visible', timeout:30000});
    await page.getByText('Movida de «' + stages[0].label + '» a «' + doing.label + '» por MCP (token «Portátil»).').first().waitFor({state:'visible', timeout:30000});
    await page.keyboard.press('Escape');
    assert.deepEqual((await tool(token, 'list_tasks', {column:doing.key})).tasks.map((t) => t.title), ['Creada por el asistente']);

    /* ---------- de vuelta en Ajustes ---------- */
    await openSettings();
    await row.locator('p', {hasText:/usado hace unos segundos$/}).waitFor({timeout:30000});
    assert.equal(await page.locator('#mcpToken').inputValue(), token, 'sigue a la vista hasta que se dice que ya está copiado');
    await page.locator('[data-mcp="done"]').click();
    await page.locator('#mcpToken').waitFor({state:'detached'});
    assert.equal(await page.evaluate((secret) => document.documentElement.innerHTML.indexOf(secret), token), -1, 'ya no está en la página');

    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()), null, {timeout:30000});
    await openSettings();
    await row.waitFor();
    assert.equal(await page.locator('#mcpToken').count(), 0, 'recargar no lo devuelve');

    /* ---------- solo lectura ---------- */
    await page.locator('#mcpName').fill('Solo mirar');
    await page.locator('#mcpReadOnly').check();
    await page.locator('#mcpForm button[type="submit"]').click();
    await page.locator('#mcpFreshTitle', {hasText:'Token «Solo mirar» creado'}).waitFor({timeout:30000});
    await page.locator('.mcp-fresh', {hasText:'quien lo tenga puede leer las tareas de este proyecto.'}).waitFor();
    const readOnly = await page.locator('#mcpToken').inputValue();
    await page.locator('.mcp-list li', {hasText:'Solo mirar'}).locator('p', {hasText:/^Solo lectura · /}).waitFor();
    assert.deepEqual((await rpc(readOnly, 'tools/list')).body.result.tools.map((t) => t.name), ['list_tasks', 'get_task']);
    assert.equal((await tool(readOnly, 'move_task', {id:made.task.id, column:stages[0].key})).error, 'This token is read-only.');
    await page.locator('[data-mcp="done"]').click();

    /* ---------- revocar ---------- */
    await row.getByRole('button', {name:'Revocar el token «Portátil»'}).click();
    await page.locator('#dlgConfirm').waitFor({state:'visible'});
    await page.locator('#confirmText', {hasText:'El token «Portátil» dejará de funcionar al momento'}).waitFor();
    await page.locator('#btnConfirmCancel').click();
    assert.equal((await rpc(token, 'ping')).status, 200, 'cancelar no revoca');
    await row.getByRole('button', {name:'Revocar el token «Portátil»'}).click();
    await page.locator('#btnConfirmOk').click();
    await page.locator('#mcpNote', {hasText:'Token revocado.'}).waitFor({timeout:30000});
    await row.waitFor({state:'detached'});
    assert.equal((await rpc(token, 'ping')).status, 401, 'revocado: ya no entra');
    assert.equal((await rpc(readOnly, 'ping')).status, 200, 'el otro sigue');

    /* ---------- en inglés ---------- */
    const english = await browser.newContext({viewport:{width:375,height:812}, locale:'en-US'});
    const ep = await english.newPage();
    ep.on('pageerror', (error) => errors.push(error.message));
    await ep.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    if(await ep.locator('.consent [data-act="reject"]').isVisible()) await ep.locator('.consent [data-act="reject"]').click();
    await ep.locator('#authPanel').waitFor({state:'visible', timeout:30000});
    await ep.locator('#authEmail').fill(email);
    await ep.locator('#authPass').fill(PASSWORD);
    await ep.locator('#authSubmit').click();
    const loaded = () => ep.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()), null, {timeout:30000});
    await loaded();
    await ep.waitForTimeout(1500);
    await loaded();
    /* El idioma va con la cuenta: se cambia como lo haría la persona en Ajustes (la app se recarga). */
    await Promise.all([
      ep.waitForEvent('load'),
      ep.evaluate(() => Workhub.app.models.settings.setLang('en').then(() => Workhub.i18n.setLang('en')))
    ]);
    await ep.waitForFunction(() => !!(window.Workhub && Workhub.app && Workhub.app.models && Workhub.app.models.tasks.isReady()) && Workhub.i18n.lang === 'en', null, {timeout:30000});
    await ep.evaluate(() => Workhub.app.navigate('settings'));
    await ep.locator('#mcpForm').waitFor({state:'attached', timeout:30000});
    await ep.locator('#mcpCard h3', {hasText:'AI assistants (MCP)'}).waitFor({state:'attached'});
    await ep.locator('.mcp-list li p', {hasText:/^Read-only · created on .+ · used /}).waitFor({state:'attached', timeout:30000});
    await ep.locator('label[for="mcpName"]', {hasText:'Name of the new token'}).waitFor({state:'attached'});
    assert.equal(await ep.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'en móvil no hay desplazamiento horizontal');

    assert.deepEqual(errors, [], 'sin errores de la página');
    console.log('OK   tokens del servidor MCP en Ajustes: crear, usar, ver en vivo, solo lectura, revocar e inglés');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.kill());
