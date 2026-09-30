/* Ajustes de recordatorios: activarlos, con cuánta antelación avisar y las
   notificaciones del navegador. */
(function(){
  const {closest} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  class RemindersView {
    constructor(){
      this.segment = $('remindSegment');
      this.taskLead = $('remindTaskLead');
      this.meetLead = $('remindMeetLead');
      this.btnNotify = $('btnRemindNotify');
      this.notifyState = $('remindNotifyState');
      this.options = $('remindOptions');
    }

    /* handlers: {toggle(on), taskLead(days), meetLead(minutes), notify()} */
    bind(handlers){
      this.segment.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-remind]');
        if(b) handlers.toggle(b.getAttribute('data-remind') === 'on');
      });
      this.taskLead.addEventListener('change', () => handlers.taskLead(+this.taskLead.value));
      this.meetLead.addEventListener('change', () => handlers.meetLead(+this.meetLead.value));
      this.btnNotify.addEventListener('click', handlers.notify);
    }

    /* permission: 'granted' | 'denied' | 'default' | 'unsupported' */
    render(prefs, permission){
      this.segment.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', (b.getAttribute('data-remind') === 'on') === prefs.on ? 'true' : 'false');
      });
      this.taskLead.value = String(prefs.taskLead);
      this.meetLead.value = String(prefs.meetLead);
      this.options.hidden = !prefs.on;
      const states = {
        granted: 'Notificaciones del navegador activadas.',
        denied: 'Las notificaciones están bloqueadas en este navegador. Puedes permitirlas en los ajustes del sitio.',
        unsupported: 'Este navegador no admite notificaciones.',
        default: ''
      };
      this.notifyState.textContent = states[permission] || '';
      this.btnNotify.hidden = permission !== 'default';
    }
  }

  Workhub.views.RemindersView = RemindersView;
})();
