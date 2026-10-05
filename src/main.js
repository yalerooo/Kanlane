/* Punto de entrada. Si Kanlane está publicado con Firebase, primero se pide
   iniciar sesión; si no, arranca directamente (modo local o claude.ai). */
Workhub.i18n.ready.then(function(){
  /* Primero se traduce la página (si el idioma no es español; su diccionario ya ha llegado). */
  Workhub.i18n.observe();
  document.documentElement.classList.remove('i18n-pending');
  const app = new Workhub.controllers.AppController();
  Workhub.app = app;
  const auth = new Workhub.controllers.AuthController(app, new Workhub.views.AuthView());
  app.controllers.auth = auth;
  Workhub.services.platform.whenReady(() => {
    auth.gate().then(() => app.start());
  });
});
