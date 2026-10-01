/* Plantilla de plugin para Kanlane. Cópiala, cambia el manifiesto y publica la
   carpeta en cualquier web con https (GitHub Pages, Cloudflare Pages…). Guía completa:
   https://github.com/yalerooo/Workhub/blob/main/docs/PLUGINS.md

   La misma página se carga de dos formas:
   - wh.isBackground === true: oculta, al abrir Kanlane (porque pide
     "ui:extend"). Aquí se añaden botones y etiquetas a la interfaz.
   - si no: en la sección Plugins, con tu interfaz. */
const MANIFEST = {
  id: 'com.tu-nombre.mi-plugin',          // único; en minúsculas, con puntos o guiones
  name: 'Mi plugin',
  version: '1.0.0',
  description: 'Qué hace tu plugin, en una frase.',
  author: 'Tu nombre',
  homepage: 'https://github.com/tu-nombre/mi-plugin',
  icon: 'puzzle',                         // nombre de un icono de Kanlane (ver docs/PLUGINS.md)
  color: 172,                             // tono del color del icono, de 0 a 359
  permissions: ['tasks:read', 'tasks:write', 'storage', 'ui:extend']   // pide solo lo que uses
};

const $ = (id) => document.getElementById(id);

/* ---------- Segundo plano: botones dentro de Kanlane ---------- */
function background(wh){
  // Botón en la barra de Tareas que abre tu panel.
  wh.ui.addButton({id:'abrir', location:'tasks.toolbar', label:'Mi plugin', icon:'puzzle'});
  // Botón en la ficha de cada tarea: recibe el id de la tarea.
  wh.ui.addButton({id:'duplicar', location:'task.actions', label:'Duplicar', icon:'check', tooltip:'Crear una copia de esta tarea'});

  wh.on('action', async ({id, context}) => {
    if(id === 'abrir') wh.ui.openPanel();
    if(id === 'duplicar'){
      const t = (await wh.tasks.list()).find((x) => x.id === context.taskId);
      if(!t) return;
      await wh.tasks.create({title: t.title + ' (copia)', desc: t.desc, cliente: t.cliente, status: t.status});
      wh.ui.toast('Tarea duplicada');
    }
  });
}

/* ---------- Panel: tu interfaz ---------- */
async function panel(wh){
  $('status').textContent = 'Proyecto: ' + wh.context.project.name;
  $('panel').hidden = false;

  // Leer tareas y reaccionar cuando cambien.
  // Las etapas dependen del tipo de proyecto: la marcada como final (done) es "terminada".
  let doneKeys = (await wh.statuses()).filter((s) => s.done).map((s) => s.key);
  wh.on('project', async () => { doneKeys = (await wh.statuses()).filter((s) => s.done).map((s) => s.key); });
  const showOpen = (tasks) => { $('open').textContent = tasks.filter((t) => doneKeys.indexOf(t.status) === -1).length; };
  showOpen(await wh.tasks.list());
  wh.on('tasks', showOpen);

  // Crear una tarea.
  $('add').onclick = async () => {
    const title = $('title').value.trim();
    if(!title) return;
    await wh.tasks.create({title}); // sin estado: va a la primera etapa del proyecto
    $('title').value = '';
    wh.ui.toast('Tarea creada');
  };

  // Guardar datos propios (en este proyecto).
  const visits = (await wh.storage.get('visits')) || 0;
  await wh.storage.set('visits', visits + 1);
  $('visits').textContent = 'Has abierto este plugin ' + (visits + 1) + ' veces en este proyecto.';
}

WorkhubPlugin.connect(MANIFEST)
  .then((wh) => (wh.isBackground ? background(wh) : panel(wh)))
  .catch((err) => {
    $('status').textContent = err.message === 'not-in-workhub'
      ? 'Abre este plugin desde Kanlane: Plugins → pega el enlace de esta página.'
      : 'No se pudo conectar con Kanlane: ' + err.message;
  });
