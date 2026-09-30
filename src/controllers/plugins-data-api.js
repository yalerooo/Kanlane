/* Lo que un plugin puede crear o cambiar: tareas y reuniones (wh.tasks.create/update,
   wh.meetings.create). Se añade a PluginsController; ver plugins-controller.js. */
(function(){
  const {fail, str, YMD, HM} = Workhub.pluginClean;
  const TaskModel = Workhub.models.TaskModel;
  const MeetingModel = Workhub.models.MeetingModel;

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
      const status = typeof src.status === 'string' ? src.status : null;
      if(status && !TaskModel.STATUS.some((s) => s.key === status)) throw fail('bad-params', 'Estado desconocido.');
      const work = [];
      if(status && status !== TaskModel.stageKey(t)) work.push(Promise.resolve(tasks.move(t.id, status)));
      if(Object.keys(patch).length) work.push(tasks.save(t.id, patch));
      return Promise.all(work).then(() => true);
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
