/* Lo que un plugin puede crear o cambiar: tareas y reuniones (wh.tasks.create/update,
   wh.meetings.create), y sus notificaciones (wh.ui.notify). Se añade a PluginsController; ver
   plugins-controller.js. */
(function(){
  const {fail, str, YMD, HM} = Workhub.pluginClean;
  const TaskModel = Workhub.models.TaskModel;
  const MeetingModel = Workhub.models.MeetingModel;
  /* Notificaciones por minuto de cada instancia de un plugin. */
  const NOTIFY_LIMIT_PER_MIN = 6;

  Object.assign(Workhub.controllers.PluginsController.prototype, {
    createTask(params){
      const tasks = this.m.tasks;
      if(!tasks.isReady()) throw fail('not-ready', 'Los datos todavía se están cargando.');
      const title = str(params.title, 200);
      if(!title) throw fail('bad-params', 'La tarea necesita un título.');
      const status = TaskModel.STATUS.some((s) => s.key === params.status) ? params.status : TaskModel.STATUS[0].key;
      const dueDate = YMD.test(params.dueDate || '') ? params.dueDate : '';
      return tasks.save(null, {
        title: title,
        desc: str(params.desc, 5000),
        cliente: str(params.cliente, 60),
        status: status,
        contacto: str(params.contacto, 120),
        dueDate: dueDate
      }).then((ref) => ({id:ref.id}));
    },

    updateTask(params){
      const tasks = this.m.tasks;
      const t = tasks.find(params.id);
      if(!t) throw fail('not-found', 'No existe esa tarea.');
      const src = params.patch && typeof params.patch === 'object' ? params.patch : {};
      const patch = {};
      if(typeof src.title === 'string'){
        patch.title = str(src.title, 200);
        if(!patch.title) throw fail('bad-params', 'El título no puede quedar vacío.');
      }
      if(typeof src.desc === 'string') patch.desc = str(src.desc, 5000);
      if(typeof src.cliente === 'string') patch.cliente = str(src.cliente, 60);
      if(typeof src.contacto === 'string') patch.contacto = str(src.contacto, 120);
      if(typeof src.dueDate === 'string'){
        if(src.dueDate && !YMD.test(src.dueDate)) throw fail('bad-params', 'La fecha tiene que ser AAAA-MM-DD.');
        patch.dueDate = src.dueDate;
      }
      if(typeof src.priority === 'string'){
        if(src.priority && !TaskModel.PRIORITIES.some((p) => p.key === src.priority)) throw fail('bad-params', 'Urgencia desconocida.');
        patch.priority = src.priority;
      }
      const status = typeof src.status === 'string' ? src.status : null;
      if(status && !TaskModel.STATUS.some((s) => s.key === status)) throw fail('bad-params', 'Estado desconocido.');
      const work = [];
      if(status && status !== TaskModel.stageKey(t)) work.push(Promise.resolve(tasks.move(t.id, status)));
      if(Object.keys(patch).length) work.push(tasks.save(t.id, patch));
      return Promise.all(work).then(() => true);
    },

    /* Notificación del navegador en nombre de un plugin (permiso "notifications"). Siempre lleva
       delante el nombre del plugin y solo puede sustituir a las suyas. params: {title, body, tag,
       taskId}; taskId abre esa tarea al pulsarla y exige también "tasks:read". */
    notifyUser(who, frame, params){
      const title = str(params.title, 80);
      if(!title) throw fail('bad-params', 'Falta el título.');
      if(typeof Notification === 'undefined') throw fail('unsupported', 'Este navegador no tiene notificaciones.');
      const taskId = str(params.taskId, 200);
      if(taskId && !frame.has('tasks:read')) throw fail('permission-denied', 'Falta el permiso "tasks:read".');
      if(taskId && !this.m.tasks.find(taskId)) throw fail('not-found', 'No existe esa tarea.');
      const now = Date.now();
      frame.notified = (frame.notified || []).filter((t) => now - t < 60000);
      if(frame.notified.length >= NOTIFY_LIMIT_PER_MIN) throw fail('rate-limited', 'Demasiadas notificaciones seguidas. Espera un momento.');
      frame.notified.push(now);
      const projectId = this.app.projectId;
      return this.askNotifications(who).then((permission) => {
        if(permission !== 'granted') throw fail('notifications-denied', 'La persona no ha permitido las notificaciones.');
        const tag = str(params.tag, 60);
        const options = {body:str(params.body, 200), icon:'/assets/img/icon-192.png', badge:'/assets/img/favicon-32.png'};
        if(tag) options.tag = 'plugin:' + who.id + ':' + tag;
        if(taskId) options.data = {project:projectId, task:taskId};
        return this.showNotification(who.name + ': ' + title, options, taskId);
      }).then(() => true);
    },

    /* Permiso del navegador. Si aún no se ha decidido, antes de pedirlo se pregunta dentro de
       Kanlane, una vez por plugin y sesión: el navegador solo lo pide de verdad tras un clic. */
    askNotifications(who){
      if(Notification.permission !== 'default') return Promise.resolve(Notification.permission);
      this.notifyAsked = this.notifyAsked || {};
      const columns = this.app.controllers.tasks.columns;
      if(this.notifyAsked[who.id] || columns.confirmDlg.open) return Promise.resolve('default');
      this.notifyAsked[who.id] = true;
      return columns.confirm(Workhub.t('Notificaciones de «{plugin}»', {plugin:who.name}),
        Workhub.t('Este plugin quiere enviarte notificaciones mientras Kanlane está abierto. Después, el navegador te pedirá confirmarlo.'),
        Workhub.t('Permitir')).then((ok) => (ok ? Notification.requestPermission() : 'default'));
    },

    /* Con service worker, que es lo único que funciona en móvil y el que sabe abrir la tarea. */
    showNotification(title, options, taskId){
      const direct = () => {
        const n = new Notification(title, options);
        n.onclick = () => {
          window.focus();
          n.close();
          if(taskId && this.m.tasks.find(taskId)) this.app.controllers.tasks.openDetail(taskId);
        };
      };
      const sw = navigator.serviceWorker;
      if(!sw) return Promise.resolve(direct());
      return sw.getRegistration().then((reg) => (reg ? reg.showNotification(title, options) : direct()));
    },

    createMeeting(params){
      const meetings = this.m.meetings;
      if(!meetings.isReady()) throw fail('not-ready', 'Los datos todavía se están cargando.');
      const date = YMD.test(params.date || '') ? params.date : '';
      const start = HM.test(params.start || '') ? params.start : '';
      const end = HM.test(params.end || '') ? params.end : '';
      const v = MeetingModel.validate({
        title: str(params.title, 200), date: date, start: start, end: end,
        cliente: str(params.cliente, 60), rawLink: str(params.link, 500), notas: str(params.notas, 2000)
      });
      if(v.error !== undefined) throw fail('bad-params', v.error || 'La reunión necesita título y fecha (AAAA-MM-DD).');
      return meetings.save(null, v.body).then((ref) => ({id:ref.id}));
    }
  });
})();
