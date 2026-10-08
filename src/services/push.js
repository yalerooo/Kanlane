/* Avisos con Kanlane cerrado (notificaciones push): lo que la app le pide al servidor (ruta
   /__/notify/v1 del Worker, worker/notify.mjs) y la suscripción de este navegador.
   Guía: docs/NOTIFICACIONES.md.

   - state(rootDb) → 'unavailable' (sin cuenta, sin service worker o navegador sin push; en un
     iPhone o iPad solo hay push con Kanlane instalada en la pantalla de inicio), 'denied' (las
     notificaciones están bloqueadas en el navegador), 'on' u 'off'.
   - enable(rootDb) / disable(rootDb): activa o quita los avisos en este navegador.
   - sync(rootDb): al abrir la app, repite la suscripción al servidor (pudo cambiar o perderse).
   - event(rootDb, projectId, {taskId, kind, to, column}): avisa de lo que acaba de pasar en una
     tarea de un equipo. No espera respuesta ni molesta si falla: el cambio ya está guardado.

   Las promesas se rechazan con err.code: 'not-configured' (el servidor no tiene los avisos
   puestos en marcha), 'denied', 'unsupported', 'network', 'auth', 'rate' o 'unavailable'. */
(function(){
  const PATH = '/__/notify/v1';

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  function supported(){
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof PushManager !== 'undefined' && typeof Notification !== 'undefined';
  }

  /* Hace falta la función activada y una cuenta que dé ID token (no hay avisos en modo local ni como invitado). */
  function available(rootDb){
    return !!(Workhub.features && Workhub.features.push) && !!rootDb && typeof rootDb.idToken === 'function' && supported();
  }

  async function call(rootDb, body){
    if(!rootDb || typeof rootDb.idToken !== 'function') throw fail('not-configured');
    let res;
    try{
      const token = await rootDb.idToken();
      res = await fetch(PATH, {
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
    if(res.status === 404 && !code) throw fail('not-configured');
    if(res.status === 401) throw fail('auth');
    if(res.status === 429) throw fail('rate');
    throw fail('unavailable');
  }

  /* El registro del service worker de la app, o null si no llega a estar listo. */
  function registration(){
    return Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 4000))]);
  }

  function current(){
    return registration().then((reg) => (reg ? reg.pushManager.getSubscription() : null));
  }

  function keyBytes(b64){
    const bin = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  function register(rootDb, sub){
    const json = sub.toJSON();
    return call(rootDb, {op:'subscribe', endpoint:json.endpoint, p256dh:json.keys.p256dh, auth:json.keys.auth, lang:Workhub.i18n && Workhub.i18n.lang === 'en' ? 'en' : 'es'});
  }

  async function state(rootDb){
    if(!available(rootDb)) return 'unavailable';
    if(Notification.permission === 'denied') return 'denied';
    if(Notification.permission !== 'granted') return 'off';
    return (await current().catch(() => null)) ? 'on' : 'off';
  }

  async function enable(rootDb){
    if(!available(rootDb)) throw fail('unsupported');
    /* Primero la clave: si el servidor no tiene los avisos, no se llega a pedir permiso. */
    const {key} = await call(rootDb, {op:'key'});
    const permission = await Notification.requestPermission();
    if(permission !== 'granted') throw fail('denied');
    const reg = await registration();
    if(!reg) throw fail('unsupported');
    let sub = await reg.pushManager.getSubscription();
    /* Suscrito con otra clave (el servidor la cambió): hay que empezar de nuevo. */
    if(sub && sub.options && sub.options.applicationServerKey && btoa(String.fromCharCode.apply(null, new Uint8Array(sub.options.applicationServerKey))) !== btoa(String.fromCharCode.apply(null, keyBytes(key)))){
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:keyBytes(key)});
    await register(rootDb, sub);
    return 'on';
  }

  async function disable(rootDb){
    const sub = supported() ? await current().catch(() => null) : null;
    if(!sub) return 'off';
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await call(rootDb, {op:'unsubscribe', endpoint:endpoint}).catch(() => {});
    return 'off';
  }

  function sync(rootDb){
    if(!available(rootDb) || Notification.permission !== 'granted') return Promise.resolve();
    return current().then((sub) => (sub ? register(rootDb, sub) : null)).catch(() => {});
  }

  function event(rootDb, projectId, info){
    const P = Workhub.models.ProjectModel;
    if(!(Workhub.features && Workhub.features.push) || !rootDb || typeof rootDb.idToken !== 'function' || !P.isTeam(projectId)) return Promise.resolve();
    return call(rootDb, Object.assign({op:'event', tid:P.teamId(projectId)}, info)).catch(() => {});
  }

  Workhub.services.push = {available, state, enable, disable, sync, event, call};
})();
