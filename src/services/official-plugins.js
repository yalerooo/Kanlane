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
      version: '1.1.0',
      description: 'Resumen de tareas por cliente y estado, lo que está vencido y lo completado esta semana. Cópialo como texto o descárgalo en CSV.',
      author: 'Kanlane',
      icon: 'chart',
      color: 238,
      permissions: ['tasks:read', 'ui:extend']
    }
  },
  {
    url: 'plugins/temporizador/index.html',
    manifest: {
      id: 'workhub.temporizador',
      name: 'Temporizador',
      version: '1.1.0',
      description: 'Mide el tiempo que dedicas a cada tarea con un cronómetro y consulta el total por tarea y por cliente.',
      author: 'Kanlane',
      icon: 'timer',
      color: 24,
      permissions: ['tasks:read', 'storage', 'ui:extend']
    }
  },
  {
    url: 'plugins/apariencia/index.html',
    manifest: {
      id: 'workhub.apariencia',
      name: 'Apariencia',
      version: '2.0.0',
      description: 'Temas listos y ajustes finos para cada proyecto: colores, cristal y velo del fondo, navegación, tipografía, esquinas, espaciado y animaciones.',
      author: 'Kanlane',
      icon: 'sparkles',
      color: 328,
      permissions: ['appearance', 'storage']
    }
  },
  {
    url: 'plugins/smartgp/index.html',
    manifest: {
      id: 'workhub.smartgp',
      name: 'Smart GP',
      version: '1.2.0',
      description: 'Al terminar una tarea, anota las horas, los días y el proyecto. Después míralo todo en un calendario por día y proyecto.',
      author: 'Kanlane',
      icon: 'clock',
      color: 172,
      permissions: ['tasks:read', 'storage', 'ui:extend']
    }
  }
];
