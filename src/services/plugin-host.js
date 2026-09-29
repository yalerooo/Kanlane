/* Anfitrión de plugins: cada plugin es una página web que se carga en un
   <iframe sandbox> sin "allow-same-origin". Así corre en un origen opaco: no
   puede leer el DOM de Workhub, su sesión, sus cookies ni su almacenamiento.
   La única vía de comunicación son mensajes (protocolo v1 de
   plugins/sdk/workhub-plugin.js), y cada llamada se comprueba contra los
   permisos que el usuario aprobó al instalarlo.

   Este servicio solo se ocupa del transporte y de los permisos; qué hace cada
   método lo decide quien crea el marco (PluginsController). */
(function(){
  const PROTOCOL = 1;
  const PROBE_TIMEOUT_MS = 10000;
  const WRITE_LIMIT_PER_MIN = 60;
  const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';

  /* Permisos que puede pedir un plugin, con el texto que ve el usuario.
     Las contraseñas del gestor no están: ningún plugin puede leerlas. */
  const PERMISSIONS = {
    'tasks:read': 'Ver tus tareas (título, descripción, cliente, estado y fechas)',
    'tasks:write': 'Crear tareas y modificar las existentes',
    'clients:read': 'Ver la lista de clientes',
    'contacts:read': 'Ver los contactos de tus clientes (nombre, email y teléfono)',
    'calendar:read': 'Ver las reuniones del calendario',
    'calendar:write': 'Crear reuniones en el calendario',
    'storage': 'Guardar sus propios datos en tu cuenta'
  };

  /* Nombre corto e icono de cada permiso (etiquetas de las tarjetas). */
  const PERMISSION_INFO = {
    'tasks:read': {short:'Ver tareas', icon:'list'},
    'tasks:write': {short:'Editar tareas', icon:'check'},
    'clients:read': {short:'Clientes', icon:'briefcase'},
    'contacts:read': {short:'Contactos', icon:'users'},
    'calendar:read': {short:'Calendario', icon:'calendar'},
    'calendar:write': {short:'Crear reuniones', icon:'calendar'},
    'storage': {short:'Guardar datos', icon:'database'}
  };

  /* Permiso que exige cada método (null: ninguno). */
  const METHODS = {
    'app.statuses': null,
    'tasks.list': 'tasks:read',
    'tasks.create': 'tasks:write',
    'tasks.update': 'tasks:write',
    'clients.list': 'clients:read',
    'contacts.list': 'contacts:read',
    'meetings.list': 'calendar:read',
    'meetings.create': 'calendar:write',
    'storage.get': 'storage',
    'storage.set': 'storage',
    'storage.remove': 'storage',
    'storage.keys': 'storage',
    'ui.toast': null,
    'ui.openTask': 'tasks:read'
  };
  const WRITE_METHODS = ['tasks.create', 'tasks.update', 'meetings.create', 'storage.set', 'storage.remove'];

  /* Permiso para recibir cada evento. */
  const EVENTS = {tasks:'tasks:read', clients:'clients:read', contacts:'contacts:read', meetings:'calendar:read', theme:null, project:null};

  /* Los ids que empiezan por "workhub." son de los plugins oficiales. */
  const OFFICIAL_PREFIX = 'workhub.';

  const frames = new Set();
  window.addEventListener('message', (ev) => {
    frames.forEach((f) => {
      if(f.iframe.contentWindow && ev.source === f.iframe.contentWindow) f._onMessage(ev.data);
    });
  });

  function text(v, max){
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  /* Comprueba el manifiesto que envía el plugin. Devuelve {manifest} o {error}. */
  function validateManifest(m, official){
    if(!m || typeof m !== 'object') return {error:'El plugin no envió su descripción (manifiesto).'};
    const id = text(m.id, 64).toLowerCase();
    if(!/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(id)) return {error:'El identificador del plugin no es válido.'};
    if(!official && id.indexOf(OFFICIAL_PREFIX) === 0) return {error:'Los identificadores "workhub.*" están reservados a los plugins oficiales.'};
    const name = text(m.name, 40);
    if(!name) return {error:'El plugin no tiene nombre.'};
    const perms = Array.isArray(m.permissions) ? m.permissions : [];
    const unknown = perms.filter((p) => !Object.prototype.hasOwnProperty.call(PERMISSIONS, p));
    if(unknown.length) return {error:'El plugin pide permisos que Workhub no conoce: ' + unknown.join(', ') + '.'};
    return {manifest:{
      id: id,
      name: name,
      version: text(m.version, 20) || '1.0.0',
      description: text(m.description, 200),
      author: text(m.author, 60),
      homepage: Workhub.utils.urls.safeUrl(text(m.homepage, 300)),
      /* Nombre de un icono del set de Workhub (src/views/plugin-icons.js);
         si no existe se usa el genérico. Nada de emojis ni imágenes. */
      icon: /^[a-z]{2,20}$/.test(text(m.icon, 20)) ? text(m.icon, 20) : 'puzzle',
      /* Tono del color del icono (0–359); si no, uno derivado del id. */
      color: typeof m.color === 'number' && isFinite(m.color) ? Math.round(((m.color % 360) + 360) % 360) : null,
      permissions: perms.filter((p, i) => perms.indexOf(p) === i)
    }};
  }

  /* Dirección del plugin: los oficiales van en la propia app (ruta relativa);
     los de terceros, por https (o http://localhost para desarrollarlos). */
  function resolveUrl(raw){
    const s = String(raw || '').trim();
    if(!s) return null;
    let u;
    try{ u = new URL(s, location.href); }catch(e){ return null; }
    const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    if(u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.href;
    /* Plugins oficiales al abrir Workhub como archivo (modo local). */
    if(u.protocol === 'file:' && location.protocol === 'file:' && !/^[a-z]+:/i.test(s)) return u.href;
    return null;
  }

  class PluginFrame {
    /* opts: {url, container, hidden, official,
              onHello(manifest) → {granted:[...]} | {error},
              api(method, params) → Promise, onClose()} */
    constructor(opts){
      this.opts = opts;
      this.granted = [];
      this.manifest = null;
      this.ready = false;
      this.writes = [];
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', SANDBOX);
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', 'clipboard-write');
      f.setAttribute('loading', 'eager');
      f.className = 'plugin-frame';
      f.title = 'Plugin';
      if(opts.hidden){
        f.setAttribute('aria-hidden', 'true');
        f.tabIndex = -1;
        f.style.cssText = 'position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;left:-9999px;';
      }
      f.src = opts.url;
      this.iframe = f;
      frames.add(this);
      opts.container.appendChild(f);
    }

    destroy(){
      frames.delete(this);
      this.iframe.remove();
    }

    _post(msg){
      msg.wh = PROTOCOL;
      /* El marco tiene origen opaco ("null"): no se puede indicar otro destino.
         El mensaje solo llega a esa ventana. */
      if(this.iframe.contentWindow) this.iframe.contentWindow.postMessage(msg, '*');
    }

    _onMessage(msg){
      if(!msg || msg.wh !== PROTOCOL || typeof msg.type !== 'string') return;
      if(msg.type === 'hello' && !this.ready){
        const res = this.opts.onHello(msg.manifest);
        if(res.error){
          this._post({type:'reject', reason:res.error});
          return;
        }
        this.manifest = res.manifest;
        this.granted = res.granted || [];
        this.ready = true;
        this._post({type:'welcome', granted:this.granted.slice(), context:res.context || {}});
      } else if(msg.type === 'call' && this.ready){
        this._call(msg);
      }
    }

    has(permission){
      return this.granted.indexOf(permission) !== -1;
    }

    _call(msg){
      const reply = (ok, value) => this._post(ok
        ? {type:'result', id:msg.id, ok:true, value:value}
        : {type:'result', id:msg.id, ok:false, error:value});
      const method = String(msg.method || '');
      if(!Object.prototype.hasOwnProperty.call(METHODS, method)){
        reply(false, {code:'unknown-method', message:'Método desconocido: ' + method});
        return;
      }
      const need = METHODS[method];
      if(need && !this.has(need)){
        reply(false, {code:'permission-denied', message:'Falta el permiso "' + need + '".'});
        return;
      }
      if(WRITE_METHODS.indexOf(method) !== -1){
        const now = Date.now();
        this.writes = this.writes.filter((t) => now - t < 60000);
        if(this.writes.length >= WRITE_LIMIT_PER_MIN){
          reply(false, {code:'rate-limited', message:'Demasiadas escrituras seguidas. Espera un momento.'});
          return;
        }
        this.writes.push(now);
      }
      let result;
      try{ result = this.opts.api(method, msg.params && typeof msg.params === 'object' ? msg.params : {}, this); }
      catch(e){ result = Promise.reject(e); }
      Promise.resolve(result).then((value) => reply(true, value === undefined ? null : value), (err) => {
        reply(false, {code:(err && err.code) || 'error', message:(err && err.message) || 'Error'});
      });
    }

    /* Envía un evento si el plugin tiene permiso para recibirlo. */
    emit(name, data){
      if(!this.ready) return;
      const need = EVENTS[name];
      if(need === undefined || (need && !this.has(need))) return;
      this._post({type:'event', name:name, data:data});
    }
  }

  /* Carga el plugin sin mostrarlo, solo para leer su manifiesto (al instalar
     desde un enlace). Devuelve Promise<{manifest}>. */
  function probe(url, container, official){
    return new Promise((resolve, reject) => {
      let frame = null;
      const timer = setTimeout(() => {
        if(frame) frame.destroy();
        reject(new Error('Esa dirección no respondió como un plugin de Workhub. Comprueba el enlace (tiene que ser la página del plugin, que use el SDK).'));
      }, PROBE_TIMEOUT_MS);
      frame = new PluginFrame({
        url: url,
        container: container,
        hidden: true,
        official: official,
        onHello: (raw) => {
          clearTimeout(timer);
          const v = validateManifest(raw, official);
          setTimeout(() => frame.destroy(), 0);
          if(v.error) reject(new Error(v.error));
          else resolve({manifest:v.manifest});
          return {error:'probe'};
        },
        api: () => Promise.reject(new Error('probe'))
      });
    });
  }

  Workhub.services.pluginHost = {
    PERMISSIONS, PERMISSION_INFO, EVENTS, OFFICIAL_PREFIX,
    PluginFrame, probe, validateManifest, resolveUrl
  };
})();
