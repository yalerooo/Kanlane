/* Regenera demo/index.html a partir de app/index.html.

   La demo de la portada es el tablero de la aplicación con sus mismas vistas, así que su
   HTML es una instantánea de cuatro trozos del de la app: la barra lateral, la barra de la
   vista (solo las herramientas de Tareas), la sección Tareas y la ficha de tarea. Cuando
   cambie ese HTML:

     node scripts/make-demo.js

   y después `node tests/demo/demo.test.js`. No es un paso de publicación: el resultado se
   guarda en el repositorio, como los iconos de scripts/make-icons.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8').replace(/\r\n/g, '\n');

function cut(open, close){
  const a = app.indexOf(open);
  const b = app.indexOf(close, a);
  if(a === -1 || b === -1) throw new Error('No se encuentra en app/index.html: ' + open);
  return app.slice(a, b + close.length);
}
function swap(text, from, to){
  if(text.indexOf(from) === -1) throw new Error('No se encuentra: ' + from.slice(0, 70));
  return text.replace(from, () => to);
}

/* Barra lateral: proyecto de ejemplo, sin menú de proyectos ni cuenta. */
let side = cut('  <aside class="sidebar glass">', '</aside>');
side = swap(side, '<span class="project-mark" id="projectMark" aria-hidden="true">PP</span>', '<span class="project-mark" id="projectMark" aria-hidden="true" style="--h:222">EM</span>');
side = swap(side, 'translate="no">Proyecto principal</span>', 'translate="no">Estudio Marta</span>');
side = swap(side, 'id="projectSub">Proyecto</span>', 'id="projectSub">Soporte y tickets</span>');
side = side.replace(/\n {4}<div class="dd-menu project-menu"[^\n]*\n/, '\n');
side = side.slice(0, side.indexOf('    <div class="sidebar-foot">')) +
  '    <div class="sidebar-foot">\n' +
  '      <div class="foot-row">\n' +
  '        <div class="storage-status" id="storageStatus" data-mode="local"><span class="status-dot"></span><span id="storageLabel">Demostración</span></div>\n' +
  '      </div>\n' +
  '    </div>\n' +
  '  </aside>';

/* Barra de la vista: solo el título y las herramientas de Tareas. */
let head = cut('  <header class="page-head top glass">', '</header>');
head = head.slice(0, head.indexOf('    <div class="bar-tools" data-bar="calendar"')) + '  </header>';

const tasks = cut('  <section id="viewTasks">', '</section>');
const detail = cut('<dialog id="dlgTaskView"', '</dialog>');

const CSS = ['fonts', 'tokens', 'base', 'layout', 'components/skeleton', 'components/buttons', 'components/forms',
  'components/dropdown', 'components/toolbar', 'components/cards', 'components/dialogs', 'components/overlays',
  'components/projects', 'components/extensions', 'views/board', 'views/task-detail', 'views/calendar', 'views/vault',
  'views/clients', 'views/github', 'components/plugin-form', 'views/team', 'views/plugins', 'views/settings',
  'responsive', 'components/appearance'];
const JS = ['core/namespace', 'i18n/i18n', 'core/emitter', 'utils/html', 'utils/dates', 'utils/urls', 'utils/autoscroll',
  'utils/ui', 'demo/demo-stubs', 'models/collection-model', 'models/project-templates', 'models/task-model',
  'views/client-colors', 'views/labels', 'views/team-ui', 'views/plugin-icons', 'views/extensions', 'views/dropdown',
  'views/client-select', 'views/board-view', 'views/task-detail-view', 'views/toast-view', 'demo/demo'];

const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demo de Kanlane</title>
  <meta name="robots" content="noindex, follow">
  <link rel="icon" type="image/svg+xml" href="../assets/img/favicon.svg">
  <link rel="preload" as="font" type="font/woff2" href="../assets/fonts/Geist-Variable.woff2" crossorigin>
${CSS.map((c) => '  <link rel="stylesheet" href="../assets/css/' + c + '.css">').join('\n')}
  <script src="../src/demo/demo-boot.js"></script>
</head>
<body class="is-demo">

<!-- Generado por scripts/make-demo.js a partir de app/index.html: no editar a mano. -->
<div class="app">
${side}

  <main class="main">
  <div class="main-inner">
${head}

${tasks}
  </div>
  </main>
</div>

${detail}

<!-- Lo que la demo no permite: se ofrece crear la cuenta -->
<dialog id="dlgDemo" aria-labelledby="demoTitle">
  <div class="dlg-inner">
    <h2 id="demoTitle">Esto está en la aplicación completa</h2>
    <p class="confirm-text" id="demoText">Crea una cuenta gratis para crear y editar tareas, y para usar el calendario, los clientes y las contraseñas.</p>
    <div class="dlg-actions">
      <div class="right">
        <button type="button" class="btn btn-ghost" id="btnDemoClose">Seguir probando</button>
        <a class="btn btn-primary" id="btnDemoSignup" href="../app/?registro=1" target="_top">Crear cuenta</a>
      </div>
    </div>
  </div>
</dialog>

<div id="toasts" class="toasts" aria-live="polite" aria-atomic="false"></div>
<div id="lightbox" class="lightbox" hidden><img id="lightboxImg" alt=""></div>

${JS.map((s) => '<script src="../src/' + s + '.js"></script>').join('\n')}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'demo/index.html'), html);
console.log('demo/index.html regenerado (' + html.split('\n').length + ' líneas).');
