/* Regresión de interacciones públicas y del progreso en tarjetas estrechas. */
const assert = require('node:assert/strict');

module.exports = async function checkLanding(browser, origin){
  const context = await browser.newContext({viewport:{width:1280,height:900}, locale:'es-ES', reducedMotion:'reduce'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try{
    await page.goto(origin + '/?portada', {waitUntil:'load'});
    const tasks = page.locator('[data-day-task]');
    for(let i = 0; i < 3; i++) await tasks.nth(i).check();
    assert.equal(await page.locator('#dayPending').textContent(), '0');
    assert.equal(await page.locator('#dayCount').textContent(), '3 / 3');
    await tasks.nth(0).uncheck();
    assert.equal(await page.locator('#dayPending').textContent(), '1');
    await page.locator('[data-client="coast"]').click();
    assert.equal(await page.locator('#clientName').textContent(), 'Taller Costa');
    assert.equal(await page.locator('#clientPerson').textContent(), 'Lucas Costa');
    await page.locator('[data-role="viewer"]').click();
    assert.deepEqual(await page.locator('#roleRights span').allTextContents(), ['Sí','No','No']);
    await page.locator('[data-plugin="appearance"]').click();
    await page.locator('[data-accent="purple"]').click();
    assert.equal(await page.locator('#appearanceExample').evaluate(el => el.style.getPropertyValue('--preview-accent')), '#7C5CFF');
    assert.equal(await page.locator('.plugin-panel:visible').count(), 1);
    for(const width of [1280, 1024, 768, 390, 320]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'portada sin desbordamiento a ' + width);
    }
    assert.equal(await page.locator('.is-waiting').count(), 0, 'con movimiento reducido no se oculta el contenido');

    await page.goto(origin + '/demo/', {waitUntil:'load'});
    await page.locator('.card-progress').first().waitFor();
    for(const width of [1024,1280,390]){
      await page.setViewportSize({width,height:900});
      /* Los tres valores usan la misma estructura producida por BoardView. */
      for(const percent of [0,50,100]){
        await page.locator('.check-progress').evaluateAll((bars, value) => bars.forEach(bar => {
          bar.querySelector('.check-progress-value').textContent = value + '%';
          bar.querySelector('.check-progress-track > span').style.width = value + '%';
          bar.setAttribute('aria-valuenow', String(value));
        }), percent);
        const measurements = await page.locator('.card-progress').evaluateAll(rows => rows.map(row => {
          const bounds = row.getBoundingClientRect();
          const value = row.querySelector('.check-progress-value').getBoundingClientRect();
          const track = row.querySelector('.check-progress-track').getBoundingClientRect();
          const contact = row.parentElement.querySelector('.card-contact')?.getBoundingClientRect();
          const date = row.parentElement.querySelector('.due-badge')?.getBoundingClientRect();
          return value.left >= track.right && value.right <= bounds.right + 1 && track.width > 20 && (!contact || contact.bottom <= row.getBoundingClientRect().top) && (!date || value.right <= date.left);
        }));
        assert.ok(measurements.length > 0 && measurements.every(Boolean), 'progreso ' + percent + '% separado y contenido a ' + width);
      }
    }
    assert.deepEqual(errors, [], 'portada y demo sin errores JavaScript');
  }finally{ await context.close(); }

  const noScript = await browser.newContext({javaScriptEnabled:false});
  try{
    const basic = await noScript.newPage();
    await basic.goto(origin + '/?portada');
    assert.ok(await basic.locator('#h-hero').isVisible());
    assert.ok(await basic.locator('#h-clientes').isVisible());
    assert.equal(await basic.locator('a[href="alternativa-a-trello/"], a[href="gestion-de-proyectos/"], a[href="alternativa-a-asana/"], a[href="alternativa-a-notion/"], a[href="gestor-de-clientes/"], a[href="crm-para-autonomos/"]').count(), 0, 'las páginas de captación no aparecen en la portada');
    for(const route of ['alternativa-a-trello', 'gestion-de-proyectos', 'alternativa-a-asana', 'alternativa-a-notion', 'gestor-de-clientes', 'crm-para-autonomos']){
      const response = await basic.goto(origin + '/' + route + '/');
      assert.equal(response.status(), 200, route + ' responde');
      assert.ok(await basic.locator('h1').isVisible(), route + ' se lee sin JavaScript');
      await basic.setViewportSize({width:390,height:844});
      assert.equal(await basic.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, route + ' no desborda en móvil');
    }
  }finally{ await noScript.close(); }
  console.log('OK   portada: interacciones, móvil, movimiento reducido y tarjetas sin solapamientos');
};
