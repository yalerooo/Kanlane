/* Calendario: navegación por meses, agenda del día y reuniones. */
(function(){
  const {todayYmd, parseYmd} = Workhub.utils.dates;
  const MeetingModel = Workhub.models.MeetingModel;

  class CalendarController {
    constructor(app, view){
      this.app = app;
      this.tasks = app.models.tasks;
      this.meetings = app.models.meetings;
      this.view = view;

      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth();
      this.selected = todayYmd();

      this.tasks.on('change', () => this.render());
      this.meetings.on('change', () => this.render());
      app.models.clients.on('change', () => {
        const names = app.clientNames();
        this.view.setClientOptions(names);
        this.view.cliente.populate(names);
        this.render();
      });

      this.view.bindToolbar({
        prev: () => this.shiftMonth(-1),
        next: () => this.shiftMonth(1),
        today: () => { this.selectDate(todayYmd()); this.render(); },
        newMeeting: () => this.openNewMeeting(this.selected),
        filter: () => this.render()
      });
      this.view.bindGrid({
        openItem: (kind, id) => this.openItem(kind, id),
        selectDate: (date, scroll) => this.selectDate(date, scroll),
        newMeetingOn: (date) => this.openNewMeeting(date),
        move: (kind, id, date) => this.moveItem(kind, id, date)
      });
      this.view.bindDay({
        openItem: (kind, id) => this.openItem(kind, id),
        newMeeting: () => this.openNewMeeting(this.selected),
        newTask: () => this.app.controllers.tasks.openNewOn(this.selected, this.view.clientFilter())
      });

      this.view.cliente.bindCreate((name) => app.createClient(name));
      this.view.bindMeetingSubmit((id, values) => this.saveMeeting(id, values));
      this.view.bindMeetingDelete((id) => this.removeMeeting(id));
      this.view.bindMeetingEdit((id) => this.openEditMeeting(id));
    }

    /* Agrupa tareas (por fecha límite) y reuniones por día, según el filtro. */
    buckets(){
      const filter = this.view.clientFilter();
      const map = {};
      const bucket = (k) => map[k] || (map[k] = {tasks:[], meetings:[]});
      this.tasks.items.forEach((t) => {
        if(!t.dueDate || (filter && t.cliente !== filter)) return;
        bucket(t.dueDate).tasks.push(t);
      });
      this.meetings.items.forEach((m) => {
        if(!m.date || (filter && m.cliente !== filter)) return;
        bucket(m.date).meetings.push(m);
      });
      Object.keys(map).forEach((k) => {
        map[k].meetings.sort(MeetingModel.byStart);
        map[k].tasks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      });
      return map;
    }

    render(){
      if(!this.view.isVisible()) return;
      const map = this.buckets();
      this.view.render(this.year, this.month, this.selected, map);
      this.view.renderDay(this.selected, map[this.selected]);
    }

    shiftMonth(delta){
      this.month += delta;
      if(this.month < 0){ this.month = 11; this.year--; }
      if(this.month > 11){ this.month = 0; this.year++; }
      this.render();
    }

    selectDate(date, scroll){
      this.selected = date;
      const d = parseYmd(date);
      if(d.getFullYear() !== this.year || d.getMonth() !== this.month){
        this.year = d.getFullYear();
        this.month = d.getMonth();
        this.render();
      } else {
        this.view.markSelected(date);
        this.view.renderDay(date, this.buckets()[date]);
      }
      if(scroll) this.view.scrollToDay();
    }

    openItem(kind, id){
      if(kind === 'task') this.app.controllers.tasks.openEdit(id);
      else this.openMeetingDetail(id);
    }

    moveItem(kind, id, date){
      if(!date) return;
      if(kind === 'task') this.tasks.reschedule(id, date);
      else if(kind === 'meeting') this.meetings.reschedule(id, date);
    }

    /* ---------- Reuniones ---------- */

    openNewMeeting(date){
      this.view.openNewMeeting(this.app.clientNames(), this.view.clientFilter() || '', date || this.selected || todayYmd());
    }

    openEditMeeting(id){
      const m = this.meetings.find(id);
      if(m) this.view.openEditMeeting(m, this.app.clientNames());
    }

    openMeetingDetail(id){
      const m = this.meetings.find(id);
      if(m) this.view.openMeetingDetail(m);
    }

    saveMeeting(id, values){
      if(!this.meetings.isReady()){ this.view.closeMeeting(); return; }
      const result = MeetingModel.validate(values);
      if(!result.body){
        if(result.error) this.view.showMeetingError(result.error);
        return;
      }
      this.meetings.save(id, result.body).then(() => {
        this.view.closeMeeting();
        this.selectDate(result.body.date);
      }).catch(() => this.view.showMeetingError('No se pudo guardar la reunión. Inténtalo de nuevo.'));
    }

    removeMeeting(id){
      if(!id || !this.meetings.isReady()) return;
      this.meetings.remove(id).then(() => this.view.closeMeeting(), () => this.view.closeMeeting());
    }
  }

  Workhub.controllers.CalendarController = CalendarController;
})();
