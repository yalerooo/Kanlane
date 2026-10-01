/* Demo del tablero: lo mínimo de la plataforma que usan las vistas reales
   (la demo no guarda nada ni usa imágenes de notas). Va antes que las vistas. */
(function(){
  Workhub.services = Workhub.services || {};
  Workhub.services.platform = {
    hydrateAssetImages: function(){},
    assetSrc: function(){ return ''; },
    mode: function(){ return 'local'; }
  };
  Workhub.models = Workhub.models || {};
  /* La ficha consulta VaultModel solo si la tarea tiene contraseñas vinculadas. */
  Workhub.models.VaultModel = Workhub.models.VaultModel || {titleFor: function(v){ return v && v.label || ''; }, typeLabel: function(){ return ''; }};
})();
