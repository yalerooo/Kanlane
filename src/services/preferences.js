/* Preferencias por navegador (localStorage). Nunca falla: si el almacenamiento
   no está disponible se devuelve el valor por defecto. */
(function(){
  function read(key, fallback){
    try{
      const v = localStorage.getItem(key);
      return v || fallback;
    }catch(e){
      return fallback;
    }
  }

  function write(key, value){
    try{ localStorage.setItem(key, value); }catch(e){}
  }

  Workhub.services.preferences = {read, write};
})();
