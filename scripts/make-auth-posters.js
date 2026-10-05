/* Genera las imágenes de espera de la pantalla de acceso: una foto pequeña de la propia escena
   en 3D, que se ve desenfocada desde el primer fotograma mientras la de verdad se compila
   (auth.css, .auth-scene::before y ::after; las coloca WORKHUB_AUTH.place, en auth-early.js).
   Por cada tema (light, dark) salen dos archivos en assets/img/:

     auth-poster-<tema>.webp   el paisaje sin el cerezo
     auth-tree-<tema>.webp     el cerezo, recortado

   Van por separado porque en la escena no se mueven igual: el paisaje se ancla al panel de
   cristal de la tarjeta y se escala con el alto de la ventana; el cerezo va pegado al borde
   izquierdo. Con las dos piezas, la foto coincide con la escena en cualquier tamaño de ventana.

   El paisaje cubre más de lo que cabe en una pantalla (la escena nunca enseña más de un alto
   de ventana en vertical), así que se monta con dos fotos, una con el punto de fuga alto y
   otra con él bajo. Las medidas (POSTER, más abajo) están repetidas en auth-early.js.

   Hay que volver a generarlas si cambia el aspecto de la escena (src/views/auth-scene.js):

     node scripts/make-auth-posters.js

   Necesita Playwright (npm ci --prefix tests/e2e) y Chrome o Edge con tarjeta gráfica. */
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const {chromium} = require(path.join(root, 'tests/e2e/node_modules/playwright'));
const port = 58671;
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

/* Todo en «altos de ventana» (H), medido desde el punto de fuga de la escena (el centro del
   panel de cristal). OJO: las mismas cifras están en auth-early.js (POSTER). */
const POSTER = {
  left:1.75, right:1.45, up:0.64, down:0.56,   /* lo que cubre el paisaje a cada lado */
  treeX:0.40,                                  /* el tronco, a esta distancia del borde izquierdo del recorte */
  treeW:1.20                                   /* ancho del recorte del cerezo (de alto, lo mismo que el paisaje) */
};
const H = 900, W = Math.round((POSTER.left + POSTER.right) * H);
const OUT_H = 384, QUALITY = 0.74;

/* Una foto de la escena con el punto de fuga a `up` altos del borde de arriba. */
async function shot(browser, theme, up, tree){
  /* Sin cerezo, su loma se manda al borde izquierdo (lo mínimo que admite la escena). */
  const trunk = tree ? POSTER.treeX * H : 0.05 * H;
  /* Con cerezo, el punto de fuga a un alto de ventana del tronco, que es lo habitual: así su
     loma se une a la colina como en una pantalla normal. */
  const focusX = tree ? (POSTER.treeX + 1) * H : POSTER.left * H;
  const context = await browser.newContext({viewport:{width:W, height:H}, locale:'es-ES'});
  const page = await context.newPage();
  await page.addInitScript((t) => { try{ localStorage.setItem('workhub_theme', t); }catch(e){} }, theme);
  if(!tree) await page.route('**/sakura.webp', (route) => route.abort());
  for(let i = 0; ; i++){
    try{ await page.goto('http://localhost:' + port + '/app/', {waitUntil:'load'}); break; }
    catch(e){ if(i > 40) throw e; await new Promise((r) => setTimeout(r, 150)); }
  }
  await page.evaluate(([fx, fy, tx]) => {
    document.querySelectorAll('.consent').forEach((el) => el.remove());
    /* Quieta: siempre el mismo instante, para que las dos fotos del paisaje casen. */
    document.documentElement.setAttribute('data-motion', 'reduced');
    const screen = document.getElementById('authScreen');
    screen.hidden = false;
    screen.querySelectorAll('.auth-top, .auth-stage, .auth-bottom').forEach((el) => { el.style.display = 'none'; });
    /* Un «panel» de mentira: su centro es el punto de fuga; el borde izquierdo de su «tarjeta»
       decide dónde cae el tronco (tx = borde * 0,36, como en la escena). */
    const card = document.createElement('div');
    card.style.cssText = 'position:absolute;top:0;width:0;height:0;left:' + (tx / 0.36) + 'px';
    const focus = document.createElement('div');
    focus.style.cssText = 'position:absolute;width:0;height:0;left:' + (fx - tx / 0.36) + 'px;top:' + fy + 'px';
    card.appendChild(focus);
    screen.appendChild(card);
    Workhub.views.authScene.start(document.getElementById('authCanvas'), screen, focus);
  }, [focusX, up * H, trunk]);
  await page.waitForFunction(() => { const s = Workhub.views.authScene.state(); return s && !s.software; }, null, {timeout:90000});
  await page.waitForTimeout(tree ? 3500 : 600);
  const data = await page.evaluate(() => {
    const scene = Workhub.views.authScene;
    /* bench() pinta y espera a la tarjeta: en este mismo turno el lienzo aún tiene la imagen. */
    for(let i = 0; i < 40; i++) scene.bench(1);
    return document.getElementById('authCanvas').toDataURL('image/png');
  });
  await context.close();
  return data;
}

(async () => {
  /* Modo local: sin Firebase; la pantalla de acceso se enseña a mano. */
  const server = spawn(process.execPath, [path.join(root, 'scripts/dev.js'), '--sin-recarga', '--puerto', String(port)], {cwd:root, stdio:'ignore'});
  const browser = await chromium.launch({headless:true, args:['--use-angle=d3d11', '--enable-gpu'], ...(chrome ? {executablePath:chrome} : {})});
  try{
    for(const theme of ['light', 'dark']){
      const high = await shot(browser, theme, POSTER.up, false);
      const low = await shot(browser, theme, 1 - POSTER.down, false);
      const treeHigh = await shot(browser, theme, POSTER.up, true);
      const treeLow = await shot(browser, theme, 1 - POSTER.down, true);
      /* El montaje se hace en una página en blanco, con un lienzo 2D. */
      const context = await browser.newContext();
      const page = await context.newPage();
      const out = await page.evaluate(async ([high, low, treeHigh, treeLow, P, outH, q]) => {
        const load = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
        const a = await load(high), b = await load(low), ta = await load(treeHigh), tb = await load(treeLow);
        const k = outH / (P.up + P.down);   /* píxeles de salida por alto de ventana */
        const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; return [c, x]; };
        const [pc, px] = canvas((P.left + P.right) * k, outH);
        px.drawImage(b, 0, (P.up - (1 - P.down)) * k, pc.width, k);
        px.drawImage(a, 0, 0, pc.width, k);
        /* El cerezo: la franja izquierda del mismo montaje, hecho con el árbol puesto. */
        const [tc, tx] = canvas(P.treeW * k, outH);
        const part = P.treeW * ta.height;
        tx.drawImage(tb, 0, 0, part, tb.height, 0, (P.up - (1 - P.down)) * k, tc.width, k);
        tx.drawImage(ta, 0, 0, part, ta.height, 0, 0, tc.width, k);
        return {poster:pc.toDataURL('image/webp', q), tree:tc.toDataURL('image/webp', q)};
      }, [high, low, treeHigh, treeLow, POSTER, OUT_H, QUALITY]);
      await context.close();
      for(const name of ['poster', 'tree']){
        const file = path.join(root, 'assets/img/auth-' + name + '-' + theme + '.webp');
        fs.writeFileSync(file, Buffer.from(out[name].split(',')[1], 'base64'));
        console.log('OK   ' + path.relative(root, file) + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((error) => { console.error(error); process.exit(1); });
