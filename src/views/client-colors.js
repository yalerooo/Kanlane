/* Color de cada cliente para las vistas (etiquetas, avatares, desplegables).
   El controlador principal conecta el resolver con el modelo de clientes;
   hasta entonces se usa el tono derivado del nombre. */
(function(){
  let resolver = (name) => Workhub.utils.html.hueFor(name);

  Workhub.views.clientColors = {
    hueOf(name){ return resolver(name); },
    setResolver(fn){ resolver = fn; },

    /* Etiqueta de cliente con su color. */
    chip(name){
      const {esc} = Workhub.utils.html;
      return '<span class="client-chip" style="--h:' + resolver(name) + '">' + esc(name) + '</span>';
    }
  };
})();
