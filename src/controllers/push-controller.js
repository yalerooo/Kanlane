/* Ajustes → «Avisos con Kanlane cerrado»: activar o quitar en este navegador las notificaciones
   push de menciones, asignaciones y tareas seguidas (src/services/push.js, docs/NOTIFICACIONES.md).
   El apartado solo se enseña con cuenta y en un navegador que admita push. */
(function(){
  const toast = Workhub.views.toast;
  const push = Workhub.services.push;
  const $ = (id) => document.getElementById(id);

  const STATES = {
    on: 'Activados en este navegador.',
    off: 'Desactivados en este navegador.',
    denied: 'Las notificaciones están bloqueadas en este navegador. Puedes permitirlas en los ajustes del sitio.'
  };
  const ERRORS = {
    'not-configured': 'Los avisos con Kanlane cerrado todavía no están disponibles en este servidor.',
    denied: 'No se han permitido las notificaciones en este navegador.',
    network: 'No hay conexión. Inténtalo de nuevo.',
    rate: 'Demasiados intentos. Espera un momento.'
  };

  class PushController {
    constructor(app){
      this.app = app;
      this.card = $('pushCard');
      this.text = $('pushState');
      this.btn = $('btnPush');
      this.state = 'unavailable';
      this.btn.addEventListener('click', () => this.toggle());
    }

    /* Al iniciar sesión: se enseña el apartado y, si ya estaban activados, se repite la
       suscripción al servidor (pudo cambiar o perderse). */
    start(){
      push.sync(this.app.rootDb);
      return this.refresh();
    }

    refresh(){
      return push.state(this.app.rootDb).then((state) => {
        this.state = state;
        this.card.hidden = state === 'unavailable';
        this.text.textContent = STATES[state] || '';
        this.btn.hidden = state === 'denied';
        this.btn.textContent = state === 'on' ? 'Desactivar' : 'Activar';
      });
    }

    toggle(){
      if(this.busy) return;
      this.busy = true;
      this.btn.disabled = true;
      const on = this.state !== 'on';
      (on ? push.enable(this.app.rootDb) : push.disable(this.app.rootDb)).then(
        () => { if(on) toast.success('Avisos activados en este navegador', {important:true}); },
        (err) => toast.error(ERRORS[err && err.code] || 'No se pudieron activar los avisos. Inténtalo de nuevo.')
      ).then(() => {
        this.busy = false;
        this.btn.disabled = false;
        return this.refresh();
      });
    }
  }

  Workhub.controllers.PushController = PushController;
})();
