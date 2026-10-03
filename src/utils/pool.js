/* Trabajo en tandas con concurrencia limitada.
   Se usa para escribir de una en una en lugar de con lotes (batch): las reglas de los equipos consultan
   el documento del equipo en cada escritura y Firestore limita esas consultas a unas 20 por lote entero. */
(function(){
  /* Ejecuta worker(item) sobre todos los elementos, con como mucho `limit` a la vez.
     Se detiene en el primer error. onDone(n) recibe cuántos van. */
  function run(items, limit, worker, onDone){
    return new Promise((resolve, reject) => {
      let next = 0;
      let active = 0;
      let done = 0;
      let failed = false;
      const pump = () => {
        if(failed) return;
        if(next >= items.length && active === 0){ resolve(); return; }
        while(active < limit && next < items.length){
          const item = items[next++];
          active++;
          worker(item).then(() => {
            active--;
            done++;
            if(onDone) onDone(done);
            pump();
          }, (err) => {
            failed = true;
            reject(err);
          });
        }
      };
      pump();
    });
  }

  Workhub.utils.pool = {run: run};
})();
