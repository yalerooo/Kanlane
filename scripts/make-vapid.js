#!/usr/bin/env node
/* Genera el par de claves VAPID de los avisos push (worker/notify.mjs, docs/NOTIFICACIONES.md).
   No guarda nada: las imprime para ponerlas como secretos del Worker.

     node scripts/make-vapid.js

   Se hace UNA vez. Si se cambian, todos los navegadores que tenían los avisos activados tienen
   que volver a activarlos (la app lo hace sola la próxima vez que se pulsa «Activar»). */
'use strict';
const path = require('path');
const {pathToFileURL} = require('url');

(async () => {
  const {generateVapidKeys} = await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'webpush.mjs')).href);
  const keys = await generateVapidKeys();
  console.log('Claves VAPID nuevas. Ponlas como secretos del Worker (no las subas al repositorio):\n');
  console.log('  npx wrangler secret put VAPID_PUBLIC     ->  ' + keys.publicKey);
  console.log('  npx wrangler secret put VAPID_PRIVATE    ->  ' + keys.privateKey);
  console.log('  npx wrangler secret put VAPID_SUBJECT    ->  mailto:<un correo de contacto tuyo>\n');
  console.log('La privada no se enseña en ningún otro sitio: si la pierdes, genera otro par.');
})().catch((err) => { console.error(err); process.exit(1); });
