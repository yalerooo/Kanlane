/* Punto de entrada. */
(function(){
  const app = new Workhub.controllers.AppController();
  Workhub.app = app;
  Workhub.services.platform.whenReady(() => app.start());
})();
