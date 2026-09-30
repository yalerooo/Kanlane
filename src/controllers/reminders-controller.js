/* Recordatorios: avisa de las tareas que vencen y de las reuniones próximas
   mientras Workhub está abierto (aviso dentro de la app y, si el usuario lo
   permite, notificación del navegador cuando la pestaña está en segundo plano).
   Solo mira el proyecto abierto. Cada aviso se da una sola vez: lo ya avisado
   se recuerda en este navegador (workhub_reminded). */
(function(){
  const prefs = Workhub.services.preferences;
  const toast = Workhub.views.toast;
  const TaskModel = Workhub.models.TaskModel;
  const {ymd, parseYmd, todayYmd} = Workhub.utils.dates;

  const PREFS_KEY = 'workhub_reminders';
  const SEEN_KEY = 'workhub_reminded';
  const TICK_MS = 60000;
  const KEEP_MS = 10 * 86400000;
  const SUMMARY_FROM = 4;   /* desde cuántos avisos nuevos se agrupan en uno solo */
  const DEFAULTS = {on:true, taskLead:0, meetLead:10};

  function readJson(key, fallback){
    try{ return JSON.parse(prefs.read(key, '')) || fallback; }catch(e){ return fallback; }
  }

  class RemindersController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.prefs = Object.assign({}, DEFAULTS, readJson(PREFS_KEY, {}));
      this.seen = readJson(SEEN_KEY, {});

      this.view.bind({
        toggle: (on) => { this.prefs.on = on; this.savePrefs(); if(on) this.check(); },
        taskLead: (d) => { this.prefs.taskLead = d; this.savePrefs(); this.check(); },
        meetLead: (m) => { this.prefs.meetLead = m; this.savePrefs(); this.check(); },
        notify: () => this.askPermission()
      });
      this.view.render(this.prefs, this.permission());

      /* Primera pasada cuando ya hay datos; después, cada minuto y al volver a la pestaña. */
      this.timer = null;
      let first = true;
      const onData = () => {
        if(first && app.models.tasks.isReady() && app.models.meetings.isReady()){ first = false; setTimeout(() => this.check(), 1500); }
      };
      app.models.tasks.on('change', onData);
      app.models.meetings.on('change', onData);
      this.timer = setInterval(() => this.check(), TICK_MS);
      document.addEventListener('visibilitychange', () => { if(!document.hidden) this.check(); });
    }

    savePrefs(){
      prefs.write(PREFS_KEY, JSON.stringify(this.prefs));
      this.view.render(this.prefs, this.permission());
    }

    permission(){
      return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    }

    askPermission(){
      if(typeof Notification === 'undefined') return;
      Notification.requestPermission().then(() => this.view.render(this.prefs, this.permission())).catch(() => {});
    }

    /* Avisos que tocan ahora: [{key, text, run}] (los que ya se dieron no salen). */
    due(){
      const m = this.app.models;
      const project = this.app.projectId;
      const today = todayYmd();
      const list = [];
      const t = Workhub.t;

      m.tasks.items.forEach((task) => {
        if(!task.dueDate || TaskModel.isDone(task)) return;
        const title = task.title || t('Sin título');
        const open = () => { this.app.navigate('tasks'); this.app.controllers.tasks.openDetail(task.id); };
        if(task.dueDate < today){
          list.push({key:'t:' + task.id + ':overdue:' + today, kind:'overdue', text:t('«{title}» está vencida', {title}), run:open});
        } else if(task.dueDate === today){
          list.push({key:'t:' + task.id + ':today:' + today, kind:'today', text:t('«{title}» vence hoy', {title}), run:open});
        } else {
          const days = Math.round((parseYmd(task.dueDate) - parseYmd(today)) / 86400000);
          if(days >= 1 && days <= this.prefs.taskLead){
            list.push({key:'t:' + task.id + ':soon:' + task.dueDate, kind:'soon',
              text:days === 1 ? t('«{title}» vence mañana', {title}) : t('«{title}» vence en {n} días', {title, n:days}), run:open});
          }
        }
      });

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      m.meetings.items.forEach((mt) => {
        if(mt.date !== today || !/^\d{2}:\d{2}$/.test(mt.start || '')) return;
        const min = (+mt.start.slice(0, 2)) * 60 + (+mt.start.slice(3, 5)) - nowMin;
        if(min < 0 || min > this.prefs.meetLead) return;
        const title = mt.title || t('Reunión');
        list.push({key:'m:' + mt.id + ':' + mt.date + ':' + mt.start, kind:'meeting',
          text:min === 0 ? t('«{title}» empieza ahora', {title}) : t('«{title}» empieza en {n} min', {title, n:min}),
          run:() => { this.app.navigate('calendar'); this.app.controllers.calendar.selectDate(mt.date); this.app.controllers.calendar.openMeetingDetail(mt.id); }});
      });

      return list.filter((r) => !this.seen[project + '|' + r.key]);
    }

    check(){
      if(!this.prefs.on) return;
      const m = this.app.models;
      if(!m.tasks.isReady() || !m.meetings.isReady()) return;
      const fresh = this.due();
      if(!fresh.length) return;
      const project = this.app.projectId;
      const now = Date.now();
      fresh.forEach((r) => { this.seen[project + '|' + r.key] = now; });
      Object.keys(this.seen).forEach((k) => { if(now - this.seen[k] > KEEP_MS) delete this.seen[k]; });
      prefs.write(SEEN_KEY, JSON.stringify(this.seen));

      /* Muchos a la vez (p. ej. al abrir tras un fin de semana): un solo resumen. */
      if(fresh.length >= SUMMARY_FROM){
        const overdue = fresh.filter((r) => r.kind === 'overdue').length;
        const rest = fresh.length - overdue;
        const parts = [];
        if(overdue) parts.push(Workhub.t(overdue === 1 ? '1 vencida' : '{n} vencidas', {n:overdue}));
        if(rest) parts.push(Workhub.t(rest === 1 ? '1 por vencer o próxima' : '{n} por vencer o próximas', {n:rest}));
        this.deliver(Workhub.t('Tienes {n} recordatorios: {detalle}', {n:fresh.length, detalle:parts.join(', ')}), () => { this.app.navigate('tasks'); });
        return;
      }
      fresh.forEach((r) => this.deliver(r.text, r.run));
    }

    deliver(text, run){
      toast.success(text, {duration:9000, action:{label:Workhub.t('Ver'), run}});
      if(this.permission() === 'granted' && document.hidden){
        try{
          const n = new Notification('Workhub', {body:text, tag:'workhub-' + text});
          n.onclick = () => { window.focus(); run(); n.close(); };
        }catch(e){}
      }
    }
  }

  Workhub.controllers.RemindersController = RemindersController;
})();
