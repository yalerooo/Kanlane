/* Tipos de proyecto: qué etapas tiene el tablero y si el proyecto trabaja con
   clientes. Los tipos predefinidos son fijos; "personalizado" guarda sus
   propias etapas en el documento del proyecto (campos stages y clients).
   Un proyecto sin campo tipo (los que ya existían) es de tipo 'soporte', con
   las mismas claves de estado de siempre, así que no hace falta migrar nada. */
(function(){
  const DEFAULT_TYPE = 'soporte';
  const CUSTOM_TYPE = 'personalizado';
  const MIN_STAGES = 2;
  /* El mismo tope que listWithin(data, 'stages', …) de firestore.rules y que guest-migration.js. */
  const MAX_STAGES = 500;   /* las listas abiertas que admite un tablero de Trello */

  /* Colores de etapa: nombre → variables del tema (ya tienen versión oscura). */
  const COLORS = [
    {key:'gray', name:'Gris', dot:'var(--dot-pend)', bg:'var(--st-pend-bg)', fg:'var(--st-pend)'},
    {key:'blue', name:'Azul', dot:'var(--dot-proc)', bg:'var(--st-proc-bg)', fg:'var(--st-proc)'},
    {key:'orange', name:'Naranja', dot:'var(--dot-wait)', bg:'var(--st-wait-bg)', fg:'var(--st-wait)'},
    {key:'green', name:'Verde', dot:'var(--dot-done)', bg:'var(--st-done-bg)', fg:'var(--st-done)'},
    {key:'red', name:'Rojo', dot:'var(--dot-red)', bg:'var(--danger-bg)', fg:'var(--danger)'},
    {key:'violet', name:'Violeta', dot:'var(--dot-violet)', bg:'var(--meet-bg)', fg:'var(--meet)'}
  ];

  const stage = (key, label, color, done) => ({key:key, label:label, color:color, done:!!done});

  const TEMPLATES = [
    {
      key:'soporte',
      name:'Soporte y tickets',
      desc:'Trabajo por cliente con esperas: tickets, incidencias, peticiones.',
      clients:true,
      stages:[
        stage('pendiente', 'Pendiente', 'gray'),
        stage('proceso', 'En proceso', 'blue'),
        stage('espera', 'Esperando al cliente', 'orange'),
        stage('completada', 'Completada', 'green', true)
      ]
    },
    {
      key:'desarrollo',
      name:'Desarrollo',
      desc:'Como un tablero de GitHub: tres columnas y sin clientes.',
      clients:false,
      stages:[
        stage('todo', 'Por hacer', 'gray'),
        stage('doing', 'En curso', 'blue'),
        stage('done', 'Hecho', 'green', true)
      ]
    },
    {
      key:'kanban',
      name:'Kanban con revisión',
      desc:'Backlog, en curso, en revisión y hecho. Sin clientes.',
      clients:false,
      stages:[
        stage('backlog', 'Backlog', 'gray'),
        stage('doing', 'En curso', 'blue'),
        stage('review', 'En revisión', 'violet'),
        stage('done', 'Hecho', 'green', true)
      ]
    },
    {
      key:CUSTOM_TYPE,
      name:'Personalizado',
      desc:'Tú eliges las etapas, sus colores y si hay clientes.',
      clients:false,
      stages:[
        stage('todo', 'Por hacer', 'gray'),
        stage('doing', 'En curso', 'blue'),
        stage('done', 'Hecho', 'green', true)
      ]
    }
  ];

  /* Nombre que cada plantilla da a sus etapas, por clave. */
  const DEFAULT_LABELS = {};
  TEMPLATES.forEach((t) => t.stages.forEach((s) => { DEFAULT_LABELS[s.key] = s.label; }));
  const tr = (text) => (Workhub.t ? Workhub.t(text) : text);

  const copyStages = (list) => list.map((s) => ({key:s.key, label:s.label, color:s.color, done:!!s.done}));

  const ProjectTemplates = {
    DEFAULT_TYPE: DEFAULT_TYPE,
    CUSTOM_TYPE: CUSTOM_TYPE,
    MIN_STAGES: MIN_STAGES,
    MAX_STAGES: MAX_STAGES,
    COLORS: COLORS,
    TEMPLATES: TEMPLATES,

    colorOf(key){
      return COLORS.find((c) => c.key === key) || COLORS[0];
    },

    template(key){
      return TEMPLATES.find((t) => t.key === key) || TEMPLATES[0];
    },

    /* Etapas de una plantilla (copia editable). */
    stagesOf(key){
      return copyStages(ProjectTemplates.template(key).stages);
    },

    /* Nombre de una etapa para enseñarlo: las de las plantillas salen en el idioma de la app
       mientras conserven su nombre; las que ha escrito el usuario, tal cual. */
    stageText(s){
      return s && DEFAULT_LABELS[s.key] === s.label ? tr(s.label) : String((s && s.label) || '');
    },

    /* Limpia lo que escribe el usuario: etiquetas recortadas, claves únicas,
       color válido y al menos una etapa que cuente como terminada. */
    normalizeStages(list){
      const seen = {};
      const out = [];
      (Array.isArray(list) ? list : []).slice(0, MAX_STAGES).forEach((s, i) => {
        let label = String((s && s.label) || '').trim().slice(0, 40);
        if(!label) return;
        let key = String((s && s.key) || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || ('e' + Date.now().toString(36) + i);
        while(seen[key]) key += 'x';
        seen[key] = true;
        /* El nombre de plantilla escrito en otro idioma se guarda en español, para que cada
           persona del equipo lo siga viendo en el suyo. */
        if(DEFAULT_LABELS[key] && label === tr(DEFAULT_LABELS[key])) label = DEFAULT_LABELS[key];
        const color = COLORS.some((c) => c.key === s.color) ? s.color : 'gray';
        const stage = {key:key, label:label, color:color, done:!!s.done};
        /* Límite de tarjetas de la columna: entero de 1 a 999; sin él, sin límite. */
        const limit = Math.floor(+s.limit);
        if(limit >= 1 && limit <= 999) stage.limit = limit;
        out.push(stage);
      });
      if(out.length && !out.some((s) => s.done)) out[out.length - 1].done = true;
      return out;
    },

    /* Configuración efectiva de un proyecto: {tipo, stages, clients}. */
    resolve(project){
      const tipo = project && project.tipo ? project.tipo : DEFAULT_TYPE;
      if(tipo === CUSTOM_TYPE){
        const stages = ProjectTemplates.normalizeStages(project.stages);
        if(stages.length >= MIN_STAGES){
          return {tipo:tipo, stages:stages, clients:!!project.clients};
        }
      }
      const t = ProjectTemplates.template(tipo === CUSTOM_TYPE ? CUSTOM_TYPE : tipo);
      return {tipo:t.key, stages:copyStages(t.stages), clients:t.clients};
    },

    /* Campos que se guardan en el documento del proyecto. */
    fieldsFor(tipo, stages, clients){
      if(tipo !== CUSTOM_TYPE) return {tipo:tipo};
      return {tipo:tipo, stages:ProjectTemplates.normalizeStages(stages), clients:!!clients};
    }
  };

  Workhub.models.ProjectTemplates = ProjectTemplates;
})();
