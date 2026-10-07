/* Servidor MCP: lo que la app le pide al servidor para gestionar los tokens de un proyecto (ruta
   /__/mcp/v1/tokens del Worker, worker/mcp.mjs). Aquí no hay ningún secreto: el token lo crea el
   servidor y solo lo devuelve una vez, al crearlo. Guía: docs/MCP.md.

   call(rootDb, {op, pid | tid, name, readOnly, id}) → Promise con la respuesta, o rechazada con
   err.code: 'not-configured' (el servidor no tiene el MCP puesto en marcha), 'network', 'auth',
   'owner', 'project', 'encrypted', 'name', 'limit', 'token', 'rate' o 'unavailable'. */
(function(){
  const TOKENS_PATH = '/__/mcp/v1/tokens';
  const SERVER_PATH = '/__/mcp/v1';
  const KNOWN = ['owner', 'project', 'encrypted', 'name', 'limit', 'token', 'rate', 'auth', 'not-configured'];

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  /* Hace falta la función activada y una cuenta que dé ID token (no hay MCP en modo local ni como invitado). */
  function available(rootDb){
    return !!(Workhub.features && Workhub.features.mcp) && !!rootDb && typeof rootDb.idToken === 'function';
  }

  async function call(rootDb, body){
    if(!available(rootDb)) throw fail('not-configured');
    let res;
    try{
      const token = await rootDb.idToken();
      res = await fetch(TOKENS_PATH, {
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
    if(res.status === 404 && code !== 'project' && code !== 'token') throw fail('not-configured');
    if(res.status === 401) throw fail('auth');
    if(res.status === 429) throw fail('rate');
    throw fail(KNOWN.indexOf(code) !== -1 ? code : 'unavailable');
  }

  /* A qué proyecto se refiere una petición: {tid} para un equipo, {pid} para uno personal. */
  function target(projectId){
    const P = Workhub.models.ProjectModel;
    return P.isTeam(projectId) ? {tid:P.teamId(projectId)} : {pid:projectId || P.MAIN_ID};
  }

  /* La dirección del servidor MCP que se le da al asistente. */
  function endpoint(){
    return location.origin + SERVER_PATH;
  }

  Workhub.services.mcp = {available, call, target, endpoint};
})();
