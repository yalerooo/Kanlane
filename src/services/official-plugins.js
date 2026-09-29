/* Plugins oficiales: viven en este mismo repositorio (carpeta plugins/) y se
   publican junto a la app. Su manifiesto se repite aquí para poder mostrarlos
   en el catálogo sin cargarlos; al abrirlos, el plugin envía el suyo y tienen
   que coincidir el id y los permisos. */
Workhub.services.officialPlugins = [
  {
    url: 'plugins/informe/index.html',
    manifest: {
      id: 'workhub.informe',
      name: 'Informe de trabajo',
      version: '1.0.0',
      description: 'Resumen de tareas por cliente y estado, lo que está vencido y lo completado esta semana. Cópialo como texto o descárgalo en CSV.',
      author: 'Workhub',
      icon: '📊',
      permissions: ['tasks:read']
    }
  },
  {
    url: 'plugins/temporizador/index.html',
    manifest: {
      id: 'workhub.temporizador',
      name: 'Temporizador',
      version: '1.0.0',
      description: 'Mide el tiempo que dedicas a cada tarea con un cronómetro y consulta el total por tarea y por cliente.',
      author: 'Workhub',
      icon: '⏱️',
      permissions: ['tasks:read', 'storage']
    }
  }
];
