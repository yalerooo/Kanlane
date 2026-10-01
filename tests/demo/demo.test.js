/* La demo del tablero (demo/index.html) reutiliza las vistas reales de la aplicación.
   Esta prueba avisa si se desincroniza: que existan todos sus scripts y hojas de estilo,
   que cada identificador que usan sus scripts esté en el HTML y que los ids del tablero
   sigan siendo los de la aplicación (app/index.html). */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLO ') + msg); if(!cond) failed++; };

const demo = read('demo/index.html');
const app = read('app/index.html');

/* Recursos locales que enlaza la demo */
const refs = [];
demo.replace(/\b(?:src|href)="(\.\.\/[^"]+)"/g, (m, url) => { refs.push(url); return m; });
/* «../app/?registro=1» es un enlace de la página, no un recurso: se comprueba la carpeta. */
const missing = refs.filter((r) => !fs.existsSync(path.join(root, 'demo', r.split('?')[0])));
ok(refs.length > 30 && !missing.length, 'todos los scripts y hojas de estilo de la demo existen (' + refs.length + ')' + (missing.length ? ': faltan ' + missing.join(', ') : ''));

/* Ids que usan sus scripts */
const ids = new Set();
['src/demo/demo.js'].forEach((f) => read(f).replace(/\$\('([A-Za-z0-9_-]+)'\)/g, (m, id) => { ids.add(id); return m; }));
const lost = Array.from(ids).filter((id) => demo.indexOf('id="' + id + '"') === -1);
ok(!lost.length, 'los ids que usa demo.js están en demo/index.html' + (lost.length ? ': faltan ' + lost.join(', ') : ''));

/* Ids que usan las vistas reales del tablero y de la ficha */
const viewIds = new Set();
['src/views/board-view.js', 'src/views/task-detail-view.js'].forEach((f) => {
  read(f).replace(/(?:getElementById|\$)\('([A-Za-z0-9_-]+)'\)/g, (m, id) => { viewIds.add(id); return m; });
});
const lostView = Array.from(viewIds).filter((id) => demo.indexOf('id="' + id + '"') === -1 && app.indexOf('id="' + id + '"') !== -1);
ok(!lostView.length, 'la demo tiene los ids que piden BoardView y TaskDetailView' + (lostView.length ? ': faltan ' + lostView.join(', ') : ''));

/* Los scripts van en un orden que funciona: cada vista después de lo que usa */
const order = [];
demo.replace(/<script src="\.\.\/([^"]+)"/g, (m, s) => { order.push(s); return m; });
const at = (name) => order.findIndex((s) => s.indexOf(name) !== -1);
ok(at('namespace.js') < at('task-model.js') && at('task-model.js') < at('board-view.js') && at('board-view.js') < at('demo/demo.js') && at('demo-stubs.js') < at('task-detail-view.js'), 'orden de los scripts de la demo');

/* La demo no se indexa y no guarda nada */
ok(/<meta name="robots" content="noindex/.test(demo), 'la demo lleva noindex');
const code = read('src/demo/demo.js');
ok(!/localStorage\.setItem|sessionStorage\.setItem|indexedDB/.test(code), 'la demo no guarda datos en el navegador');

if(failed){ console.log('\n' + failed + ' fallo(s)'); process.exit(1); }
