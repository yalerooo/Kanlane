/* Regresión de interacciones públicas y del progreso en tarjetas estrechas. */
const assert = require('node:assert/strict');

/* Cada página enlaza desde su selector de idioma a su equivalente (es <-> en). */
const PAIRS = {'/': '/en/', '/alternativa-a-trello/': '/en/trello-alternative/', '/alternativa-a-asana/': '/en/asana-alternative/', '/alternativa-a-notion/': '/en/notion-alternative/', '/gestion-de-proyectos/': '/en/project-management/', '/gestor-de-clientes/': '/en/client-manager/', '/crm-para-autonomos/': '/en/freelancer-crm/', '/gestor-de-contrasenas-para-clientes/': '/en/client-password-manager/', '/servidor-mcp/': '/en/mcp-server/'};
/* Páginas de captación que debe enlazar el pie de cada portada: las de SU idioma, y solo esas. */
const GUIDES = {
  '/': ['/alternativa-a-trello/', '/alternativa-a-asana/', '/alternativa-a-notion/', '/gestion-de-proyectos/', '/gestor-de-clientes/', '/crm-para-autonomos/', '/gestor-de-contrasenas-para-clientes/', '/servidor-mcp/'],
  '/en/': ['/en/trello-alternative/', '/en/asana-alternative/', '/en/notion-alternative/', '/en/project-management/', '/en/client-manager/', '/en/freelancer-crm/', '/en/client-password-manager/', '/en/mcp-server/']
};
const PAIR_OF = {};
for(const [es, en] of Object.entries(PAIRS)){ PAIR_OF[es] = en; PAIR_OF[en] = es; }

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
    assert.equal(await page.locator('#appearanceExample').evaluate(el => el.style.getPropertyValue('--preview-accent')), '#4F46E5');
    assert.equal(await page.locator('.plugin-panel:visible').count(), 1);
    /* El calendario de ejemplo cambia entre mes, semana y día. */
    await page.locator('[data-calendar="month"]').click();
    assert.equal(await page.locator('#calendarPreview .mday:not(.empty)').count(), 31, 'el mes enseña los 31 días de octubre');
    assert.equal(await page.locator('[data-calendar="month"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-calendar="day"]').click();
    assert.equal(await page.locator('#calendarPreview .mday:visible').count(), 1, 'el día enseña solo el miércoles 7');
    await page.locator('[data-calendar="week"]').click();
    assert.equal(await page.locator('#calendarPreview .mday:visible').count(), 7);
    for(const width of [1280, 1024, 768, 390, 320]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'portada sin desbordamiento a ' + width);
    }
    assert.equal(await page.locator('.is-waiting').count(), 0, 'con movimiento reducido no se oculta el contenido');

    await page.goto(origin + '/demo/', {waitUntil:'load'});
    await page.locator('.card-progress').first().waitFor();
    /* En la demo la barra lateral va siempre desplegada, también en un marco estrecho. */
    await page.setViewportSize({width:1100,height:900});
    assert.ok((await page.locator('.sidebar').boundingBox()).width > 200, 'la demo enseña la barra lateral desplegada a 1100 px');
    assert.equal(await page.locator('#tabCalendar > span').first().isVisible(), true);
    for(const width of [1024,1280,390]){
      await page.setViewportSize({width,height:900});
      /* Los tres valores usan la misma estructura producida por BoardView: anillo y «hechas/total». */
      for(const percent of [0,50,100]){
        await page.locator('.check-progress').evaluateAll((bars, value) => bars.forEach(bar => {
          bar.querySelector('.check-progress-value').textContent = (value / 25) + '/4';
          bar.querySelector('.check-ring').style.setProperty('--p', String(value));
          bar.setAttribute('aria-valuenow', String(value));
        }), percent);
        const measurements = await page.locator('.card .card-progress').evaluateAll(rows => rows.map(row => {
          const card = row.closest('.card').getBoundingClientRect();
          const bounds = row.getBoundingClientRect();
          const value = row.querySelector('.check-progress-value').getBoundingClientRect();
          const ring = row.querySelector('.check-ring').getBoundingClientRect();
          const contact = row.closest('.card').querySelector('.card-contact')?.getBoundingClientRect();
          const date = row.parentElement.querySelector('.due-badge')?.getBoundingClientRect();
          /* El texto va a la derecha del anillo, dentro de la tarjeta, sin pisar la fecha ni el contacto. */
          return value.left >= ring.right && ring.width >= 12 && bounds.right <= card.right + 1 &&
            (!contact || contact.bottom <= bounds.top) && (!date || date.right <= bounds.left + 1);
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
    /* El pie de la portada enlaza exactamente a las 8 páginas de captación de su idioma (todas existen en el sitemap). */
    const footGuides = (page) => page.$$eval('footer.foot a[href]', links => links.map(a => a.getAttribute('href')).filter(h => /^\/(en\/)?[a-z-]+\/$/.test(h) && h !== '/' && h !== '/en/'));
    assert.deepEqual(await footGuides(basic), GUIDES['/'], 'el pie de / enlaza a las 8 páginas de captación en español');
    /* Fuera del pie, los únicos enlaces a páginas de captación son los del texto «alternativa a Trello»; el resto del sitio solo se alcanza por el selector de idioma (hacia /en/ con hreflang="en"). */
    const outside = await basic.$$eval('a[href]:not(footer.foot a)', links => links.map(a => ({href:a.getAttribute('href'), hreflang:a.getAttribute('hreflang')})).filter(a => /^\/(en\/)?[a-z-]+\/$/.test(a.href) && a.href !== '/'));
    assert.ok(outside.every(a => a.href === '/en/' ? a.hreflang === 'en' : a.href === '/alternativa-a-trello/'), 'la portada solo enlaza fuera del pie a /en/ (selector de idioma) y a la alternativa a Trello');
    assert.ok(outside.some(a => a.href === '/alternativa-a-trello/'), 'la sección «alternativa a Trello» enlaza a su página');
    const internal = await basic.$$eval('a[href]', links => links.map(a => ({href:a.getAttribute('href'), hreflang:a.getAttribute('hreflang')})).filter(a => a.href === '/en/'));
    assert.ok(internal.length >= 1 && internal.every(a => a.hreflang === 'en'), 'los enlaces a /en/ de la portada llevan hreflang="en" (selector de idioma)');
    assert.equal(await basic.locator('header .lang-switch [aria-current="true"]').innerText(), 'ES', 'la portada marca ES como idioma actual');
    assert.equal(await basic.locator('header .lang-switch a.lang-opt').getAttribute('href'), '/en/', 'el selector de la portada lleva a /en/');
    /* El pie de /en/ enlaza a las 8 inglesas, sin enlaces rotos ni cruces de idioma fuera del selector. */
    await basic.goto(origin + '/en/');
    assert.deepEqual(await footGuides(basic), GUIDES['/en/'], 'el pie de /en/ enlaza a las 8 páginas de captación en inglés');
    const outsideEn = await basic.$$eval('a[href]:not(footer.foot a)', links => links.map(a => a.getAttribute('href')).filter(h => /^\/(en\/)?[a-z-]+\/$/.test(h) && h !== '/en/'));
    assert.ok(outsideEn.length >= 1 && outsideEn.every(h => h === '/en/trello-alternative/'), 'la portada inglesa solo enlaza fuera del pie a la Trello alternative');
        for(const href of [...GUIDES['/'], ...GUIDES['/en/']]){
      const r = await basic.goto(origin + href);
      assert.equal(r.status(), 200, 'enlace del pie sin romper: ' + href);
    }
    await basic.goto(origin + '/?portada');
    for(const route of ['alternativa-a-trello', 'gestion-de-proyectos', 'alternativa-a-asana', 'alternativa-a-notion', 'gestor-de-clientes', 'crm-para-autonomos', 'gestor-de-contrasenas-para-clientes', 'servidor-mcp', 'en', 'en/trello-alternative', 'en/asana-alternative', 'en/notion-alternative', 'en/project-management', 'en/client-manager', 'en/freelancer-crm', 'en/client-password-manager', 'en/mcp-server']){
      const response = await basic.goto(origin + '/' + route + '/');
      assert.equal(response.status(), 200, route + ' responde');
      assert.ok(await basic.locator('h1').isVisible(), route + ' se lee sin JavaScript');
      await basic.setViewportSize({width:390,height:844});
      const pairLink = basic.locator('header .lang-switch a.lang-opt');
      assert.ok(await pairLink.isVisible(), route + ' muestra el selector de idioma en móvil');
      assert.equal(await pairLink.getAttribute('href'), PAIR_OF['/' + route + '/'], route + ' enlaza a su equivalente en el otro idioma');
      assert.equal(await basic.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, route + ' no desborda en móvil');
    }
  }finally{ await noScript.close(); }
  console.log('OK   portada: interacciones, móvil, movimiento reducido y tarjetas sin solapamientos');
};
