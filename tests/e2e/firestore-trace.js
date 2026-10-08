/* Traza de las llamadas a Firestore: recorre la app con los emuladores (alta, tareas, recarga,
   ficha, notas, secciones, proyectos, cofre y equipo), apunta cada lectura, escritura y escucha
   con el sitio del código que la hace, y enseña por tramo las que se repiten y las escuchas que
   quedan abiertas. No es una prueba (no falla por el número de llamadas): sirve para buscar
   llamadas duplicadas y para comparar antes y después de un cambio.

     npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub --config firebase.test.json "node tests/e2e/firestore-trace.js"

   Con un nombre de archivo detrás guarda además la traza completa en JSON; con dos archivos
   JSON y sin emuladores, los compara:  node tests/e2e/firestore-trace.js antes.json despues.json */
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const outFile = process.argv[2] || '';
const port = 58720;
const url = 'http://localhost:' + port + '/app/';
const authUrl = 'http://127.0.0.1:9197';
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

/* Se inyecta en la página: envuelve los métodos de Firestore (SDK compat) y avisa a Node de cada llamada. */
function instrument(){
  let seq = Math.floor(performance.timeOrigin % 1e7) * 1000;
  const send = (rec) => { try{ window.__traceOut(JSON.stringify(rec)); }catch(e){} };
  const where = () => {
    const lines = String(new Error().stack || '').split('\n').slice(3);
    const mine = lines.filter((l) => /\/src\//.test(l)).slice(0, 4).map((l) => (l.match(/at ([^\s(]+)?\s*\(?.*\/src\/([^?:)]+)[^:]*:(\d+)/) || []).slice(1).filter(Boolean).join(' '));
    return mine.join(' < ');
  };
  const pathOf = (ref) => {
    try{ if(typeof ref.path === 'string') return ref.path; }catch(e){}
    try{ const q = ref._delegate._query; return q.path.segments.join('/') + (q.collectionGroup ? ' [grupo ' + q.collectionGroup + ']' : '') + (q.filters && q.filters.length ? ' [filtro]' : '') + (q.explicitOrderBy && q.explicitOrderBy.length ? ' [orden]' : ''); }catch(e){}
    return '?';
  };
  const wrap = (proto, name, kind) => {
    if(!proto || !proto[name] || proto[name].__traced) return;
    const original = proto[name];
    const traced = function(){
      const id = ++seq;
      const rec = {id:id, op:kind + '.' + name, path:pathOf(this), at:where()};
      send(rec);
      const res = original.apply(this, arguments);
      if(name === 'onSnapshot' && typeof res === 'function'){
        return function(){ send({id:id, op:'unsubscribe', path:rec.path}); return res.apply(this, arguments); };
      }
      return res;
    };
    traced.__traced = true;
    proto[name] = traced;
  };
  const patch = () => {
    const fs = window.firebase && window.firebase.firestore;
    if(!fs || !fs.DocumentReference) return false;
    ['get', 'set', 'update', 'delete', 'onSnapshot'].forEach((n) => wrap(fs.DocumentReference.prototype, n, 'doc'));
    ['get', 'onSnapshot'].forEach((n) => wrap(fs.Query.prototype, n, 'query'));
    ['get', 'onSnapshot', 'add'].forEach((n) => { if(Object.prototype.hasOwnProperty.call(fs.CollectionReference.prototype, n)) wrap(fs.CollectionReference.prototype, n, 'col'); });
    wrap(fs.CollectionReference.prototype, 'add', 'col');
    if(fs.WriteBatch) wrap(fs.WriteBatch.prototype, 'commit', 'batch');
    if(fs.Firestore) wrap(fs.Firestore.prototype, 'runTransaction', 'db');
    if(fs.Transaction) ['get', 'set', 'update', 'delete'].forEach((n) => {
      const proto = fs.Transaction.prototype, original = proto[n];
      if(!original || original.__traced) return;
      const traced = function(ref){ send({id:++seq, op:'tx.' + n, path:pathOf(ref), at:where()}); return original.apply(this, arguments); };
      traced.__traced = true;
      proto[n] = traced;
    });
    return true;
  };
  if(!patch()){ const timer = setInterval(() => { if(patch()) clearInterval(timer); }, 5); }
}

/* Rutas sin los ids que cambian de una ejecución a otra. */
const norm = (p) => String(p).replace(/users\/[^/]+/, 'users/U').replace(/teams\/[^/\s]+/, 'teams/E').replace(/automation_jobs\/.*/, 'automation_jobs/J').replace(/projects\/[A-Za-z0-9]{15,}/g, 'projects/P').replace(/tasks\/[A-Za-z0-9]{15,}/g, 'tasks/T').replace(/notes\/[A-Za-z0-9]{15,}/g, 'notes/N');

/* Por tramo: cada operación y ruta con cuántas veces se llamó (y desde dónde, si se repite) y las
   escuchas que quedan abiertas a la vez sobre la misma ruta. */
function summary(data){
  const open = {};
  let total = 0;
  data.sections.forEach((s) => {
    const recs = data.log.filter((r) => r.section === s);
    if(/recargar/.test(s)) Object.keys(open).forEach((k) => delete open[k]);
    const calls = recs.filter((r) => r.op !== 'unsubscribe');
    total += calls.length;
    recs.forEach((r) => { if(r.op.endsWith('onSnapshot')) open[r.id] = r; if(r.op === 'unsubscribe') delete open[r.id]; });
    console.log('\n== ' + s + ' — ' + calls.length + ' llamadas');
    const groups = {};
    calls.forEach((r) => { const k = r.op + '  ' + norm(r.path); (groups[k] = groups[k] || []).push(r); });
    Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length).forEach((k) => {
      const g = groups[k];
      console.log((g.length > 1 ? ' ×' + g.length + ' ' : '    ') + k);
      if(g.length > 1){
        const places = {};
        g.forEach((r) => { places[r.at || '(sin pila de la app)'] = (places[r.at || '(sin pila de la app)'] || 0) + 1; });
        Object.keys(places).forEach((p) => console.log('        ' + places[p] + '× ' + p));
      }
    });
    const live = {};
    Object.values(open).forEach((r) => { const k = norm(r.path); (live[k] = live[k] || []).push(r); });
    const dup = Object.keys(live).filter((k) => live[k].length > 1);
    console.log('   escuchas abiertas al acabar: ' + Object.keys(open).length + (dup.length ? '  · REPETIDOS: ' + dup.map((k) => k + ' ×' + live[k].length).join(', ') : ''));
  });
  console.log('\nTotal: ' + total + ' llamadas');
}

/* Diferencias entre dos trazas guardadas, tramo a tramo. */
function compare(a, b){
  const key = (r) => r.op + '  ' + norm(r.path);
  const calls = (d, s) => d.log.filter((r) => r.section === s && r.op !== 'unsubscribe');
  let ta = 0, tb = 0;
  a.sections.forEach((s) => {
    const x = calls(a, s), y = calls(b, s), ca = {}, cb = {};
    ta += x.length; tb += y.length;
    x.forEach((r) => { ca[key(r)] = (ca[key(r)] || 0) + 1; });
    y.forEach((r) => { cb[key(r)] = (cb[key(r)] || 0) + 1; });
    console.log((x.length === y.length ? '  = ' : '  * ') + s.slice(0, 66).padEnd(66) + String(x.length).padStart(4) + ' -> ' + y.length);
    Object.keys(Object.assign({}, ca, cb)).filter((k) => (ca[k] || 0) !== (cb[k] || 0)).forEach((k) => console.log('      ' + k + ': ' + (ca[k] || 0) + ' -> ' + (cb[k] || 0)));
  });
  console.log('Total: ' + ta + ' -> ' + tb);
}

const log = [];
let section = 'arranque';
const sections = [];

async function verify(email){
  for(let i = 0; i < 60; i++){
    const data = await (await fetch(authUrl + '/emulator/v1/projects/demo-workhub/oobCodes')).json();
    const code = (data.oobCodes || []).find((item) => item.email === email && item.requestType === 'VERIFY_EMAIL');
    if(code){
      await fetch(authUrl + '/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({oobCode:code.oobCode})});
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('sin correo de verificación');
}

if(process.argv[3]){
  compare(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
  return;
}

const {chromium} = require('playwright');
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--emulador', '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});

(async () => {
  for(let i = 0; i < 100; i++){ try{ if((await fetch(url)).ok && (await fetch(authUrl)).status < 500) break; }catch(e){} await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:850}, locale:'es-ES'});
    await context.exposeFunction('__traceOut', (json) => { const rec = JSON.parse(json); rec.section = section; log.push(rec); });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const quiet = (ms) => page.waitForTimeout(ms || 1500);
    const step = async (name, fn) => { section = name; sections.push(name); await fn(); await quiet(); };

    await step('1. alta de cuenta y primer proyecto', async () => {
      await page.goto(url, {waitUntil:'domcontentloaded'});
      if(await page.locator('.consent [data-act="reject"]').isVisible().catch(() => false)) await page.locator('.consent [data-act="reject"]').click();
      await page.locator('#authPanel').waitFor({state:'visible', timeout:30000});
      await page.locator('#authSwitchLink').click();
      const email = 'traza-' + Date.now() + '@example.test';
      await page.locator('#authName').fill('Traza');
      await page.locator('#authEmail').fill(email);
      await page.locator('#authPass').fill('contraseña-prueba-123');
      await page.locator('#authSubmit').click();
      await page.locator('.auth-loading.is-verify').waitFor({state:'visible'});
      await verify(email);
      await page.getByRole('button', {name:'Ya lo he verificado'}).click();
      await page.locator('#dlgProject').waitFor({state:'visible', timeout:30000});
      await page.locator('#pNombre').fill('Proyecto A');
      await page.locator('#pTypes [data-type="desarrollo"]').click();
      await page.locator('#btnSaveProject').click();
      await page.locator('#pStep2').waitFor({state:'visible'});
      await page.locator('#btnSaveProject').click();
      await page.locator('#dlgProject').waitFor({state:'hidden'});
    });

    await step('2. crear tres tareas', async () => {
      for(const title of ['Uno', 'Dos', 'Tres']){
        await page.locator('#btnNew').click();
        await page.locator('#fTitle').fill(title);
        await page.locator('#btnSave').click();
        await page.locator('#dlg').waitFor({state:'hidden'});
        await page.locator('.card').filter({hasText:title}).waitFor();
      }
    });

    await step('3. recargar con la sesión iniciada', async () => {
      await page.reload();
      await page.locator('.card').nth(2).waitFor({timeout:30000});
      await quiet(2500);
    });

    await step('4. abrir y cerrar la ficha de una tarea', async () => {
      await page.locator('.card').filter({hasText:'Uno'}).click();
      await page.locator('#dlgTaskView').waitFor({state:'visible'});
      await quiet(800);
      await page.keyboard.press('Escape');
      await page.locator('#dlgTaskView').waitFor({state:'hidden'});
    });

    await step('5. editar una tarea y guardar', async () => {
      await page.evaluate(() => Workhub.app.controllers.tasks.openEdit(Workhub.app.models.tasks.items.find((t) => t.title === 'Uno').id));
      await page.locator('#dlg').waitFor({state:'visible'});
      await page.locator('#fDesc').fill('Descripción nueva');
      await page.locator('#btnSave').click();
      await page.locator('#dlg').waitFor({state:'hidden'});
    });

    await step('6. añadir una nota desde la ficha', async () => {
      await page.locator('.card').filter({hasText:'Dos'}).click();
      await page.locator('#dlgTaskView').waitFor({state:'visible'});
      await page.locator('#tvCommentText').fill('Una nota');
      await page.locator('#tvCommentSend').click();
      await page.locator('#tvNotes').getByText('Una nota').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('#dlgTaskView').waitFor({state:'hidden'});
    });

    await step('7. mover una tarea de columna', async () => {
      await page.evaluate(() => Workhub.app.controllers.tasks.moveWithActivity(Workhub.app.models.tasks.items.find((t) => t.title === 'Tres').id, 'doing'));
    });

    await step('8. pasar por las secciones (calendario, contraseñas, plugins, copia, ajustes) y volver', async () => {
      for(const tab of ['#tabCalendar', '#tabVault', '#tabPlugins', '#tabData', '#tabSettings', '#tabTasks']){
        await page.locator(tab).click();
        await quiet(700);
      }
    });

    await step('9. crear un segundo proyecto', async () => {
      await page.locator('#btnProject').click();
      await page.locator('[data-menu="new"]').click();
      await page.locator('#dlgProject').waitFor({state:'visible'});
      await page.locator('#pNombre').fill('Proyecto B');
      await page.locator('#pTypes [data-type="desarrollo"]').click();
      await page.locator('#btnSaveProject').click();
      await page.locator('#pStep2').waitFor({state:'visible'});
      await page.locator('#btnSaveProject').click();
      await page.locator('#dlgProject').waitFor({state:'hidden'});
      await page.locator('#projectName').getByText('Proyecto B').waitFor();
    });

    await step('10. volver al primer proyecto', async () => {
      const id = await page.evaluate(() => Workhub.app.controllers.projects.projects.list().find((p) => p.nombre === 'Proyecto A').id);
      await page.evaluate((i) => Workhub.app.switchProject(i), id);
      await page.locator('.card').nth(2).waitFor({timeout:15000});
    });

    await step('11. no hacer nada durante 5 segundos', async () => { await quiet(5000); });

    await step('12. cofre: crear la contraseña maestra, bloquear y desbloquear', async () => {
      await page.locator('#tabVault').click();
      await page.locator('#masterPass2Wrap').waitFor({state:'visible'});
      await page.locator('#masterPass').fill('maestra-prueba-123');
      await page.locator('#masterPass2').fill('maestra-prueba-123');
      await page.locator('#btnUnlock').click();
      await page.locator('#recoveryReveal').waitFor({state:'visible'});
      await page.locator('#recoveryCheck').fill((await page.locator('#recoveryKeyBox').textContent()).trim().split('-')[+(await page.locator('#recoveryCheckN').textContent()) - 1]);
      await page.locator('#recoveryConfirmChk').check();
      await page.locator('#btnRecoveryContinue').click();
      await page.locator('#vaultContent').waitFor({state:'visible'});
      await page.locator('#btnLock').click();
      await page.locator('#masterPass').fill('maestra-prueba-123');
      await page.locator('#btnUnlock').click();
      await page.locator('#vaultContent').waitFor({state:'visible'});
      await page.locator('#tabTasks').click();
    });

    await step('13. convertir el proyecto en equipo', async () => {
      await page.evaluate(() => Workhub.app.controllers.team.open());
      await page.locator('#dlgShare').waitFor({state:'visible'});
      await page.locator('#shConvert').click();
      await page.waitForFunction(() => String(Workhub.app.projectId).indexOf('t:') === 0 && Workhub.app.models.tasks.isReady(), null, {timeout:60000});
      await page.locator('.card').nth(2).waitFor({timeout:15000});
      await page.keyboard.press('Escape');
      await quiet(2500);
    });

    await step('14. recargar dentro del proyecto de equipo', async () => {
      await page.reload();
      await page.locator('.card').nth(2).waitFor({timeout:30000});
      await quiet(2500);
    });

    await step('15. equipo: abrir la ficha y comentar', async () => {
      await page.locator('.card').filter({hasText:'Dos'}).click();
      await page.locator('#dlgTaskView').waitFor({state:'visible'});
      await page.locator('#tvCommentText').fill('Un comentario');
      await page.locator('#tvCommentSend').click();
      await page.locator('#tvNotes').getByText('Un comentario').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('#dlgTaskView').waitFor({state:'hidden'});
    });

    await step('16. equipo: mover una tarea y editar otra', async () => {
      await page.evaluate(() => Workhub.app.controllers.tasks.moveWithActivity(Workhub.app.models.tasks.items.find((t) => t.title === 'Uno').id, 'doing'));
      await quiet(600);
      await page.evaluate(() => Workhub.app.controllers.tasks.openEdit(Workhub.app.models.tasks.items.find((t) => t.title === 'Tres').id));
      await page.locator('#dlg').waitFor({state:'visible'});
      await page.locator('#fDesc').fill('Editada en el equipo');
      await page.locator('#btnSave').click();
      await page.locator('#dlg').waitFor({state:'hidden'});
    });

    await step('17. equipo: ir al otro proyecto y volver', async () => {
      const ids = await page.evaluate(() => { const c = Workhub.app.controllers.projects.projects; return {b:c.list().find((p) => p.nombre === 'Proyecto B').id, a:Workhub.app.projectId}; });
      await page.evaluate((i) => Workhub.app.switchProject(i), ids.b);
      await page.locator('#projectName').getByText('Proyecto B').waitFor();
      await quiet(1200);
      await page.evaluate((i) => Workhub.app.switchProject(i), ids.a);
      await page.locator('.card').nth(2).waitFor({timeout:15000});
    });

    await step('18. no hacer nada durante 5 segundos (equipo)', async () => { await quiet(5000); });

    const data = {sections:sections, log:log, errors:errors};
    if(outFile) fs.writeFileSync(outFile, JSON.stringify(data, null, 1));
    summary(data);
    if(errors.length) console.log('Errores JavaScript durante el recorrido: ' + JSON.stringify(errors));
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((error) => { console.error(error); server.kill(); process.exitCode = 1; });
