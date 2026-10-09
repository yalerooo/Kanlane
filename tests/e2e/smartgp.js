/* Smart GP: horas por subtarea. En modo local, con el plugin oficial instalado: al completar una
   subtarea pide sus horas, quedan apuntadas a esa subtarea y se pueden registrar también desde
   la ficha; la opción del panel apaga la pregunta. Uso: node tests/e2e/smartgp.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = 58671;
const url = 'http://localhost:' + port + '/app/';
const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

async function ready(){
  for(let i = 0; i < 80; i++){
    try{ if((await fetch(url)).ok) return; }catch(e){}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El servidor local no inició');
}

(async () => {
  await ready();
  const browser = await chromium.launch({headless:true, ...(chrome ? {executablePath:chrome} : {})});
  try{
    const context = await browser.newContext({viewport:{width:1280,height:900}, locale:'es-ES'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('#dlgProject').waitFor({state:'visible'});
    await page.locator('#pNombre').fill('Horas');
    await page.locator('#pTypes [data-type="desarrollo"]').click();
    await page.locator('#btnSaveProject').click();
    await page.locator('#dlgProject').waitFor({state:'hidden', timeout:10000});
    await page.evaluate(() => { const b = document.querySelector('.consent [data-act="reject"]'); if(b) b.click(); });

    /* Una tarea con dos subtareas y el plugin instalado, ya conectado en segundo plano. */
    await page.evaluate(() => Workhub.app.models.tasks.save('', {title:'Lanzar la web', desc:'', cliente:'', contacto:'', dueDate:'', repeat:'', labels:[],
      status:Workhub.models.TaskModel.STATUS[0].key, checklist:[{id:'c1', text:'Maquetar', done:false}, {id:'c2', text:'Publicar', done:false}]}));
    await page.locator('.card').filter({hasText:'Lanzar la web'}).waitFor();
    await page.evaluate(async () => {
      const pc = Workhub.app.controllers.plugins;
      await pc.installOfficial(Workhub.services.officialPlugins.findIndex((p) => p.manifest.id === 'workhub.smartgp'));
      await pc.confirmDialog();
    });
    await page.waitForFunction(() => { const e = Workhub.app.controllers.plugins.bg.get('workhub.smartgp'); return !!e && e.frame.ready; }, null, {timeout:20000});
    assert.deepEqual(await page.evaluate(() => Workhub.pluginClean.cleanTask(Workhub.app.models.tasks.items[0]).checklist),
      [{id:'c1', text:'Maquetar', done:false, mine:true}, {id:'c2', text:'Publicar', done:false, mine:true}], 'el plugin recibe las subtareas');
    /* En un equipo, la que completó otra persona no es «mía» (no se le preguntan las horas). */
    assert.deepEqual(await page.evaluate(() => {
      const T = Workhub.views.team;
      T.set({team:true, role:'owner'}, [{uid:'yo', name:'Yo'}, {uid:'ana', name:'Ana'}], 'yo');
      const out = Workhub.pluginClean.cleanTask({id:'x', checklist:[{id:'a', text:'A', done:true, doneBy:'ana'}, {id:'b', text:'B', done:true, doneBy:'yo'}, {id:'c', text:'C', done:true}]}).checklist.map((c) => c.mine);
      T.set(null, [], '');
      return out;
    }), [false, true, true]);
    /* Que el plugin tenga ya la lista con las subtareas sin hacer. */
    await page.waitForTimeout(1500);
    await page.evaluate(() => Workhub.app.navigate('tasks'));

    /* Completar una subtarea desde la ficha: pide sus horas, con esa subtarea elegida. */
    await page.locator('.card').filter({hasText:'Lanzar la web'}).click();
    await page.locator('#dlgTaskView').waitFor({state:'visible'});
    await page.locator('#tvChecklist li[data-cid="c1"] input').check();
    const form = page.locator('#dlgPluginForm');
    await form.waitFor({state:'visible', timeout:15000});
    assert.equal(await page.locator('#pfSub').innerText(), 'Lanzar la web');
    assert.equal(await page.locator('#pfIntro').innerText(), 'Has completado esta subtarea. ¿Cuánto le has dedicado?');
    assert.equal(await page.evaluate(() => document.getElementById('pf_sub').value), 'c1');
    assert.deepEqual(await page.evaluate(() => Array.from(document.getElementById('pf_sub').options).map((o) => o.textContent)), ['La tarea entera', 'Maquetar', 'Publicar']);
    await page.locator('#pf_hours').fill('1.5');
    await page.locator('#pfNewName_project').fill('Web');
    await page.locator('#pfSubmit').click();
    await form.waitFor({state:'hidden'});

    /* «Registrar horas» de la ficha: la tarea entera por defecto, y avisa de lo que ya lleva. */
    await page.locator('#dlgTaskView').getByRole('button', {name:'Registrar horas'}).click();
    await form.waitFor({state:'visible', timeout:15000});
    assert.equal(await page.evaluate(() => document.getElementById('pf_sub').value), '_');
    assert.equal(await page.locator('#pfIntro').innerText(), 'Has terminado esta tarea. Ya lleva 1,5 h registradas: añade solo las que falten.');
    await page.locator('#pfCancel').click();
    await form.waitFor({state:'hidden'});
    await page.keyboard.press('Escape');
    await page.locator('#dlgTaskView').waitFor({state:'hidden'});
    /* La tarjeta lleva el total de la tarea, con las horas de su subtarea. */
    await page.locator('.card').filter({hasText:'Lanzar la web'}).getByText('1,5 h').waitFor();

    /* Panel: el registro lleva el nombre de la subtarea, y la opción apaga la pregunta. */
    await page.evaluate(async () => { Workhub.app.navigate('plugins'); await Workhub.app.controllers.plugins.open('workhub.smartgp'); });
    await page.waitForFunction(() => { const x = Workhub.app.controllers.plugins.active; if(x && x.frame.iframe) x.frame.iframe.id = 'sgPanel'; return !!(x && x.frame.ready); }, null, {timeout:20000});
    const panel = page.frameLocator('#sgPanel');
    await panel.locator('.sg-entry').filter({hasText:'Lanzar la web · Maquetar'}).waitFor({timeout:20000});
    assert.equal(await panel.locator('.sg-entry .hrs').first().innerText(), '1,5 h');
    const opt = panel.locator('.sg-opt input');
    assert.equal(await opt.isChecked(), true, 'preguntar al completar una subtarea viene activado');
    await opt.uncheck();
    await page.waitForTimeout(1200);
    await page.evaluate(() => Workhub.app.navigate('tasks'));
    await page.locator('.card').filter({hasText:'Lanzar la web'}).click();
    await page.locator('#dlgTaskView').waitFor({state:'visible'});
    await page.locator('#tvChecklist li[data-cid="c2"] input').check();
    await page.waitForTimeout(2500);
    assert.equal(await form.isVisible(), false, 'con la opción apagada no pregunta');

    assert.deepEqual(errors, [], 'sin excepciones JavaScript');
    console.log('OK   Smart GP: horas por subtarea, desde la ficha y con la pregunta al completarla');
  }finally{
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { server.kill(); });
