#!/usr/bin/env node
/* Genera la imagen para redes (assets/img/og-image.png, 1200 × 630) con Sumi y el nombre.
   Necesita un navegador: usa el Playwright de tests/e2e con Chrome o Edge instalados
   (CHROME_PATH para otro). No es un paso de publicación: el resultado se guarda en el
   repositorio, como los iconos de scripts/make-icons.js.

     npm ci --prefix tests/e2e     (una vez)
     node scripts/make-og.js */
'use strict';
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const sumi = require('../src/views/sumi.js');

const root = path.join(__dirname, '..');
const {chromium} = require(path.join(root, 'tests/e2e/node_modules/playwright'));
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((candidate) => fs.existsSync(candidate));

const font = (file) => pathToFileURL(path.join(root, 'assets/fonts', file)).href;
const GRAFITO = '#18181B', BLANCO = '#FFFFFF', FONDO = '#0E0E11';

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url("${font('Geist-Variable.woff2')}") format("woff2");font-weight:100 900;}
@font-face{font-family:"Geist Mono";src:url("${font('GeistMono-Variable.woff2')}") format("woff2");font-weight:100 900;}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:${FONDO};color:#EDEDF0;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased;position:relative;overflow:hidden}
.brand{position:absolute;left:72px;top:62px;display:flex;align-items:center;gap:16px;font-size:30px;font-weight:620;letter-spacing:-.025em}
.brand svg{width:56px;height:56px}
h1{position:absolute;left:72px;top:170px;font-size:88px;font-weight:620;line-height:1.08;letter-spacing:-.04em}
p{position:absolute;left:72px;top:482px;font-size:28px;color:#A0A3AD}
.sumi-big{position:absolute;right:64px;top:118px;width:360px;height:360px}
.foot{position:absolute;left:0;right:0;bottom:0;height:68px;border-top:1px solid rgba(255,255,255,.08);padding:20px 72px;font-family:"Geist Mono",monospace;font-size:22px;color:#7C7C87}
</style></head><body>
<div class="brand">${sumi.svg({mini: true, bg: BLANCO, body: GRAFITO, eye: BLANCO})}Kanlane</div>
<h1>Todo el trabajo<br>de tus clientes,<br>en un solo sitio.</h1>
<p>Tareas, calendario, contactos y contraseñas por cliente.</p>
${sumi.svg({body: BLANCO, eye: FONDO, cls: 'sumi-big'})}
<div class="foot">kanlane.com</div>
</body></html>`;

(async () => {
  const browser = await chromium.launch({headless: true, ...(chrome ? {executablePath: chrome} : {})});
  const page = await browser.newPage({viewport: {width: 1200, height: 630}, deviceScaleFactor: 1});
  const tmp = path.join(root, 'assets/img/.og-tmp.html');
  fs.writeFileSync(tmp, html);
  try{
    await page.goto(pathToFileURL(tmp).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path: path.join(root, 'assets/img/og-image.png'), type: 'png'});
  } finally {
    fs.unlinkSync(tmp);
    await browser.close();
  }
  console.log('assets/img/og-image.png');
})().catch((err) => { console.error(err); process.exit(1); });
