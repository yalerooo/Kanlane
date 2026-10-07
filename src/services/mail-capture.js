/* Captura de tareas por correo: lo que la app le pide al servidor (ruta /__/capture/v1 del
   Worker, worker/capture.mjs). Aquí no hay ningún secreto: la dirección de cada proyecto la
   calcula el servidor y solo se la da a quien puede enviarle correo. Guía: docs/CAPTURA-EMAIL.md.

   call(rootDb, {op, pid | tid, stage, allow}) → Promise con la respuesta, o rechazada con
   err.code: 'not-configured' (el servidor no tiene la captura puesta en marcha), 'network',
   'auth', 'owner', 'project', 'encrypted', 'email', 'stage', 'allow', 'off', 'rate' o 'unavailable'. */
(function(){
  const URL_PATH = '/__/capture/v1';
  const KNOWN = ['owner', 'project', 'encrypted', 'email', 'stage', 'allow', 'off', 'rate', 'auth', 'not-configured'];

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  /* Hace falta la función activada y una cuenta que dé ID token (no hay captura en modo local ni como invitado). */
  function available(rootDb){
    return !!(Workhub.features && Workhub.features.mailCapture) && !!rootDb && typeof rootDb.idToken === 'function';
  }

  async function call(rootDb, body){
    if(!available(rootDb)) throw fail('not-configured');
    let res;
    try{
      const token = await rootDb.idToken();
      res = await fetch(URL_PATH, {
        method:'POST', cache:'no-store', credentials:'omit',
        headers:{'Content-Type':'application/json', Authorization:'Bearer ' + token},
        body:JSON.stringify(body)
      });
    }catch(err){
      throw fail('network');
    }
    let data = null;
    try{ data = await res.json(); }catch(err){ data = null; }
    if(res.ok && data && data.v === 1) return data;
    const code = data && typeof data.error === 'string' ? data.error : '';
    /* Un servidor sin esta ruta (todavía sin desplegar) responde 404 sin cuerpo JSON. */
    if(res.status === 503 && code !== 'unavailable') throw fail('not-configured');
    if(res.status === 404 && code !== 'project') throw fail('not-configured');
    if(res.status === 401) throw fail('auth');
    if(res.status === 429) throw fail('rate');
    throw fail(KNOWN.indexOf(code) !== -1 ? code : 'unavailable');
  }

  /* A qué proyecto se refiere una petición: {tid} para un equipo, {pid} para uno personal. */
  function target(projectId){
    const P = Workhub.models.ProjectModel;
    return P.isTeam(projectId) ? {tid:P.teamId(projectId)} : {pid:projectId || P.MAIN_ID};
  }

  Workhub.services.capture = {available, call, target};
})();
