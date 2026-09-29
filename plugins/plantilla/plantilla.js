/* Plantilla de plugin para Workhub. Cópiala, cambia el manifiesto y publica la
   carpeta en cualquier web con https (GitHub Pages, Netlify…). Guía completa:
   https://github.com/yalerooo/Workhub/blob/main/docs/PLUGINS.md */
const MANIFEST = {
  id: 'com.tu-nombre.mi-plugin',          // único; en minúsculas, con puntos o guiones
  name: 'Mi plugin',
  version: '1.0.0',
  description: 'Qué hace tu plugin, en una frase.',
  author: 'Tu nombre',
  homepage: 'https://github.com/tu-nombre/mi-plugin',
  icon: '🧩',                              // un emoji
  permissions: ['tasks:read', 'tasks:write', 'storage']   // pide solo lo que uses
};

const $ = (id) => document.getElementById(id);

WorkhubPlugin.connect(MANIFEST).then(async (wh) => {
  $('status').textContent = 'Proyecto: ' + wh.context.project.name;
  $('panel').hidden = false;

  // Leer tareas y reaccionar cuando cambien.
  const showOpen = (tasks) => { $('open').textContent = tasks.filter((t) => t.status !== 'completada').length; };
  showOpen(await wh.tasks.list());
  wh.on('tasks', showOpen);

  // Crear una tarea.
  $('add').onclick = async () => {
    const title = $('title').value.trim();
    if(!title) return;
    await wh.tasks.create({title, status: 'pendiente'});
    $('title').value = '';
    wh.ui.toast('Tarea creada');
  };

  // Guardar datos propios (en este proyecto).
  const visits = (await wh.storage.get('visits')) || 0;
  await wh.storage.set('visits', visits + 1);
  $('visits').textContent = 'Has abierto este plugin ' + (visits + 1) + ' veces en este proyecto.';
}).catch((err) => {
  $('status').textContent = err.message === 'not-in-workhub'
    ? 'Abre este plugin desde Workhub: Plugins → pega el enlace de esta página.'
    : 'No se pudo conectar con Workhub: ' + err.message;
});
