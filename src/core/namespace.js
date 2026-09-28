/* Espacio de nombres global de la aplicación.
   Se usan scripts clásicos (no módulos ES) para que index.html siga funcionando
   abierto directamente desde el disco (file://), donde los módulos no cargan. */
window.Workhub = {
  utils: {},
  services: {},
  models: {},
  views: {},
  controllers: {}
};
