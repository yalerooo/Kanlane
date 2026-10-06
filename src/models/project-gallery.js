/* Plantillas de proyecto: tableros ya montados (etapas, etiquetas y unas tareas de ejemplo) para
   no empezar con el tablero vacío. Cada una da una semilla (ver project-seed.js), igual que el
   importador de Trello; el proyecto que se crea es de tipo «personalizado».
   Los textos se escriben en el idioma de la app en el momento de crear el proyecto: desde entonces
   son contenido del usuario y no se vuelven a traducir. */
(function(){
  const ORDER_STEP = 1024;

  /* etapa: [nombre, color, ¿final?] · etiqueta: [nombre, color] · tarea: [nº de etapa, título, etiquetas, subtareas, descripción] */
  function templates(){
    return [
      {
        key:'lanzamiento',
        name:Workhub.t('Lanzamiento de producto'),
        desc:Workhub.t('Del plan al día de salida: preparación, lanzamiento y seguimiento.'),
        clients:false,
        stages:[[Workhub.t('Ideas'), 'gray'], [Workhub.t('Preparación'), 'blue'], [Workhub.t('Listo para lanzar'), 'orange'], [Workhub.t('Lanzado'), 'green', true]],
        labels:[[Workhub.t('Marketing'), '1d76db'], [Workhub.t('Producto'), '5319e7'], [Workhub.t('Soporte'), '0e8a16'], [Workhub.t('Urgente'), 'd73a4a']],
        tasks:[
          [1, Workhub.t('Definir el mensaje y a quién va dirigido'), [Workhub.t('Marketing')], [Workhub.t('Qué problema resuelve'), Workhub.t('Para quién es'), Workhub.t('Por qué ahora')]],
          [1, Workhub.t('Preparar la página de lanzamiento'), [Workhub.t('Marketing'), Workhub.t('Producto')], [Workhub.t('Textos'), Workhub.t('Capturas'), Workhub.t('Precios')]],
          [1, Workhub.t('Lista de comprobación antes de salir'), [Workhub.t('Producto')], [Workhub.t('Probar el alta de un usuario nuevo'), Workhub.t('Probar el pago'), Workhub.t('Revisar los correos automáticos')]],
          [0, Workhub.t('Escribir el anuncio para la lista de correo'), [Workhub.t('Marketing')], []],
          [0, Workhub.t('Preparar las respuestas a las preguntas frecuentes'), [Workhub.t('Soporte')], []],
          [0, Workhub.t('Recoger las primeras opiniones tras el lanzamiento'), [Workhub.t('Producto')], []]
        ]
      },
      {
        key:'contenidos',
        name:Workhub.t('Calendario de contenidos'),
        desc:Workhub.t('Artículos, vídeos y redes: de la idea a la publicación.'),
        clients:false,
        stages:[[Workhub.t('Ideas'), 'gray'], [Workhub.t('Escribiendo'), 'blue'], [Workhub.t('En revisión'), 'violet'], [Workhub.t('Programado'), 'orange'], [Workhub.t('Publicado'), 'green', true]],
        labels:[[Workhub.t('Blog'), '1d76db'], [Workhub.t('Redes'), 'e99695'], [Workhub.t('Vídeo'), '5319e7'], [Workhub.t('Boletín'), 'fbca04']],
        tasks:[
          [0, Workhub.t('Lista de temas para el próximo mes'), [Workhub.t('Blog')], []],
          [0, Workhub.t('Entrevista a un cliente'), [Workhub.t('Vídeo')], [Workhub.t('Elegir al cliente'), Workhub.t('Preparar las preguntas'), Workhub.t('Grabar'), Workhub.t('Editar')]],
          [1, Workhub.t('Artículo: cómo empezar'), [Workhub.t('Blog')], [Workhub.t('Esquema'), Workhub.t('Borrador'), Workhub.t('Imágenes'), Workhub.t('Revisión')]],
          [2, Workhub.t('Boletín del mes'), [Workhub.t('Boletín')], []],
          [3, Workhub.t('Publicaciones de la semana en redes'), [Workhub.t('Redes')], []]
        ]
      },
      {
        key:'ventas',
        name:Workhub.t('Embudo de ventas'),
        desc:Workhub.t('Un CRM sencillo: cada oportunidad avanza del primer contacto al cierre.'),
        clients:true,
        stages:[[Workhub.t('Contacto nuevo'), 'gray'], [Workhub.t('Reunión'), 'blue'], [Workhub.t('Propuesta enviada'), 'orange'], [Workhub.t('Negociación'), 'violet'], [Workhub.t('Ganado'), 'green', true], [Workhub.t('Perdido'), 'red', true]],
        labels:[[Workhub.t('Caliente'), 'd73a4a'], [Workhub.t('Templado'), 'fbca04'], [Workhub.t('Frío'), 'bfd4f2'], [Workhub.t('Recomendado'), '0e8a16']],
        tasks:[
          [0, Workhub.t('Ejemplo: empresa que pidió información por la web'), [Workhub.t('Templado')], [Workhub.t('Responder en 24 horas'), Workhub.t('Proponer una llamada')],
            Workhub.t('Crea una tarea por oportunidad y asígnale su cliente. Arrástrala de columna según avance.')],
          [1, Workhub.t('Ejemplo: reunión de descubrimiento'), [Workhub.t('Caliente')], [Workhub.t('Entender qué necesita'), Workhub.t('Presupuesto y plazos'), Workhub.t('Quién decide')]],
          [2, Workhub.t('Ejemplo: propuesta pendiente de respuesta'), [Workhub.t('Caliente')], [Workhub.t('Enviar la propuesta'), Workhub.t('Hacer seguimiento a la semana')]],
          [3, Workhub.t('Ejemplo: ajustar el alcance y el precio'), [Workhub.t('Recomendado')], []]
        ]
      },
      {
        key:'alta-cliente',
        name:Workhub.t('Alta de cliente'),
        desc:Workhub.t('Los pasos que repites con cada cliente nuevo, para no olvidar ninguno.'),
        clients:true,
        stages:[[Workhub.t('Por empezar'), 'gray'], [Workhub.t('En curso'), 'blue'], [Workhub.t('Esperando al cliente'), 'orange'], [Workhub.t('Hecho'), 'green', true]],
        labels:[[Workhub.t('Contrato'), '5319e7'], [Workhub.t('Accesos'), '1d76db'], [Workhub.t('Facturación'), '0e8a16'], [Workhub.t('Reunión'), 'fbca04']],
        tasks:[
          [0, Workhub.t('Firmar el contrato'), [Workhub.t('Contrato')], [Workhub.t('Enviar el contrato'), Workhub.t('Recibirlo firmado'), Workhub.t('Guardar una copia')]],
          [0, Workhub.t('Pedir los accesos'), [Workhub.t('Accesos')], [Workhub.t('Web y alojamiento'), Workhub.t('Correo'), Workhub.t('Redes sociales')],
            Workhub.t('Guarda las credenciales en la sección Contraseñas y vincúlalas a esta tarea.')],
          [0, Workhub.t('Reunión de arranque'), [Workhub.t('Reunión')], [Workhub.t('Objetivos'), Workhub.t('Plazos'), Workhub.t('Persona de contacto')]],
          [0, Workhub.t('Datos de facturación'), [Workhub.t('Facturación')], []],
          [0, Workhub.t('Enviar el plan de trabajo del primer mes'), [], []]
        ]
      },
      {
        key:'sprint',
        name:Workhub.t('Sprint de desarrollo'),
        desc:Workhub.t('Backlog, sprint, revisión y hecho, con etiquetas para errores y mejoras.'),
        clients:false,
        stages:[[Workhub.t('Backlog'), 'gray'], [Workhub.t('Este sprint'), 'blue', false, 8], [Workhub.t('En curso'), 'orange', false, 3], [Workhub.t('En revisión'), 'violet'], [Workhub.t('Hecho'), 'green', true]],
        labels:[[Workhub.t('Error'), 'd73a4a'], [Workhub.t('Mejora'), '1d76db'], [Workhub.t('Deuda técnica'), '6e7681'], [Workhub.t('Diseño'), '5319e7']],
        tasks:[
          [0, Workhub.t('Ejemplo: historia de usuario'), [Workhub.t('Mejora')], [Workhub.t('Criterios de aceptación'), Workhub.t('Pruebas'), Workhub.t('Documentación')],
            Workhub.t('Como [tipo de usuario] quiero [objetivo] para [beneficio].')],
          [0, Workhub.t('Ejemplo: error que hay que reproducir'), [Workhub.t('Error')], [Workhub.t('Pasos para reproducirlo'), Workhub.t('Qué debería pasar'), Workhub.t('Qué pasa en realidad')]],
          [1, Workhub.t('Planificar el sprint'), [], [Workhub.t('Elegir el objetivo'), Workhub.t('Estimar las tareas'), Workhub.t('Repartir el trabajo')]],
          [1, Workhub.t('Retrospectiva'), [], [Workhub.t('Qué ha ido bien'), Workhub.t('Qué mejorar'), Workhub.t('Acciones para el próximo sprint')]]
        ]
      }
    ];
  }

  function toSeed(t){
    const stages = t.stages.map((s, i) => {
      const stage = {key:'g' + (i + 1), label:s[0], color:s[1], done:!!s[2]};
      if(s[3]) stage.limit = s[3];
      return stage;
    });
    const position = {};
    const now = Date.now();
    return {
      source:'template',
      nombre:t.name,
      clients:t.clients,
      stages:stages,
      labels:t.labels.map((l) => ({name:l[0], color:l[1]})),
      tasks:t.tasks.map((x, n) => {
        const status = stages[x[0]].key;
        position[status] = (position[status] || 0) + 1;
        return {
          title:x[1], desc:x[4] || '', status:status, dueDate:'', dueTime:'',
          labels:x[2].slice(),
          checklist:x[3].map((text, i) => ({id:'c' + (i + 1), text:text, done:false})),
          notes:[],
          order:position[status] * ORDER_STEP,
          /* Milisegundos distintos: el orden de creación también desempata. */
          createdAt:now + n, updatedAt:now + n
        };
      })
    };
  }

  Workhub.models.ProjectGallery = {
    /* Para el selector: [{key, name, desc, clients, stages:[{label, color}], tasks:nº}] */
    list(){
      return templates().map((t) => ({key:t.key, name:t.name, desc:t.desc, clients:t.clients,
        stages:t.stages.map((s) => ({label:s[0], color:s[1]})), tasks:t.tasks.length}));
    },

    /* Semilla de una plantilla (null si no existe). */
    seed(key){
      const t = templates().find((x) => x.key === key);
      return t ? toSeed(t) : null;
    }
  };
})();
