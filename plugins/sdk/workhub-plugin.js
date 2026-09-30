/* SDK de plugins de Workhub (protocolo v1).
   Inclúyelo en la página de tu plugin:
     <script src="https://workhub.yalero.net/plugins/sdk/workhub-plugin.js"></script>
   y conéctate con:
     const wh = await WorkhubPlugin.connect({id:'com.tu-nombre.mi-plugin', name:'Mi plugin', ...});

   El plugin corre en un marco aislado (sandbox) y solo puede hablar con
   Workhub mediante mensajes. Cada llamada exige el permiso correspondiente,
   que el usuario aprueba al instalarlo. Guía completa: docs/PLUGINS.md. */
(function(global){
  'use strict';

  var PROTOCOL = 1;
  var CONNECT_TIMEOUT_MS = 8000;
  var LOCALES = {es:'es-ES', en:'en-US'};

  /* Idioma de Workhub ('es', 'en'…). Hasta conectar, el del navegador. */
  var lang = /^es\b/i.test(global.navigator.language || 'es') ? 'es' : 'en';

  /* Traducciones del plugin: const t = WorkhubPlugin.translations({en:{'Hola':'Hello'}});
     t('Hola') devuelve el texto en el idioma de Workhub (o el original si
     no hay traducción). Admite datos: t('Hola, {name}', {name:'Ana'}). */
  function translations(dicts){
    dicts = dicts || {};
    return function(text, params){
      var d = dicts[lang] || {};
      var out = Object.prototype.hasOwnProperty.call(d, text) ? d[text] : text;
      if(params) out = String(out).replace(/\{(\w+)\}/g, function(_, k){ return params[k] != null ? params[k] : ''; });
      return out;
    };
  }

  function send(msg){
    msg.wh = PROTOCOL;
    /* El marco no conoce el origen de Workhub (puede estar en cualquier
       dominio); solo la ventana que lo contiene recibe el mensaje. */
    global.parent.postMessage(msg, '*');
  }

  /* Aplica los colores y el tema de Workhub a la página del plugin. */
  function applyTheme(theme){
    if(!theme) return;
    var root = document.documentElement;
    var vars = theme.vars || {};
    Object.keys(vars).forEach(function(name){
      if(/^--[a-z0-9-]+$/.test(name)) root.style.setProperty(name, String(vars[name]));
    });
    root.setAttribute('data-theme', theme.scheme === 'dark' ? 'dark' : 'light');
    root.style.colorScheme = theme.scheme === 'dark' ? 'dark' : 'light';
  }

  function connect(manifest){
    if(global.parent === global){
      return Promise.reject(new Error('not-in-workhub'));
    }
    return new Promise(function(resolve, reject){
      var pending = {};
      var listeners = {};
      var nextId = 1;
      var client = null;
      var timer = setTimeout(function(){ reject(new Error('timeout')); }, CONNECT_TIMEOUT_MS);

      function call(method, params){
        return new Promise(function(res, rej){
          var id = nextId++;
          pending[id] = {resolve:res, reject:rej};
          send({type:'call', id:id, method:method, params:params || {}});
        });
      }

      function emit(name, data){
        (listeners[name] || []).slice().forEach(function(fn){
          try{ fn(data); }catch(e){ setTimeout(function(){ throw e; }); }
        });
      }

      global.addEventListener('message', function(ev){
        if(ev.source !== global.parent) return;
        var msg = ev.data;
        if(!msg || msg.wh !== PROTOCOL) return;
        if(msg.type === 'welcome' && !client){
          clearTimeout(timer);
          applyTheme(msg.context && msg.context.theme);
          if(msg.context && LOCALES[msg.context.locale]) lang = msg.context.locale;
          document.documentElement.lang = lang;
          client = {
            manifest: manifest,
            context: msg.context || {},
            permissions: msg.granted || [],
            /* 'es' | 'en' y su formato de fechas ('es-ES' | 'en-US'). */
            lang: lang,
            locale: LOCALES[lang],
            has: function(p){ return this.permissions.indexOf(p) !== -1; },
            on: function(name, fn){
              (listeners[name] = listeners[name] || []).push(fn);
              return function(){ listeners[name] = (listeners[name] || []).filter(function(f){ return f !== fn; }); };
            },
            call: call,
            statuses: function(){ return call('app.statuses'); },
            tasks: {
              list: function(){ return call('tasks.list'); },
              create: function(data){ return call('tasks.create', data); },
              update: function(id, patch){ return call('tasks.update', {id:id, patch:patch}); }
            },
            clients: {list: function(){ return call('clients.list'); }},
            contacts: {list: function(){ return call('contacts.list'); }},
            meetings: {
              list: function(){ return call('meetings.list'); },
              create: function(data){ return call('meetings.create', data); }
            },
            /* Datos propios del plugin en el proyecto abierto. */
            storage: {
              get: function(key){ return call('storage.get', {key:key}); },
              set: function(key, value){ return call('storage.set', {key:key, value:value}); },
              remove: function(key){ return call('storage.remove', {key:key}); },
              keys: function(){ return call('storage.keys'); },
              /* Comunes a todos los proyectos del usuario. */
              user: {
                get: function(key){ return call('storage.get', {key:key, scope:'user'}); },
                set: function(key, value){ return call('storage.set', {key:key, value:value, scope:'user'}); },
                remove: function(key){ return call('storage.remove', {key:key, scope:'user'}); },
                keys: function(){ return call('storage.keys', {scope:'user'}); }
              }
            },
            /* 'panel': abierto en la sección Plugins. 'background': cargado oculto
               al abrir Workhub (plugins con permiso ui:extend o appearance). */
            mode: (msg.context && msg.context.mode) || 'panel',
            isBackground: ((msg.context && msg.context.mode) || 'panel') === 'background',
            ui: {
              toast: function(message, opts){ return call('ui.toast', {message:message, type:(opts && opts.type) || 'success'}); },
              openTask: function(id){ return call('ui.openTask', {id:id}); },
              openPanel: function(){ return call('ui.openPanel'); },
              /* Solo en segundo plano (permiso ui:extend). def: {id, location,
                 label, icon, tooltip, variant}. Si ya existe, se actualiza. */
              addButton: function(def){ return call('ui.addButton', def); },
              removeButton: function(id){ return call('ui.removeButton', {id:id}); },
              /* {idDeTarea: {text, tone, icon}}: sustituye todas las etiquetas. */
              setTaskBadges: function(badges){ return call('ui.setTaskBadges', {badges:badges}); },
              /* Solo en segundo plano (permiso appearance). */
              setAppearance: function(values){ return call('ui.setAppearance', values || {}); },
              resetAppearance: function(){ return call('ui.setAppearance', {}); }
            }
          };
          resolve(client);
        } else if(msg.type === 'reject' && !client){
          clearTimeout(timer);
          reject(new Error(msg.reason || 'rejected'));
        } else if(msg.type === 'result' && pending[msg.id]){
          var p = pending[msg.id];
          delete pending[msg.id];
          if(msg.ok) p.resolve(msg.value);
          else{
            var err = new Error((msg.error && msg.error.message) || 'error');
            err.code = msg.error && msg.error.code;
            p.reject(err);
          }
        } else if(msg.type === 'event' && client){
          if(msg.name === 'theme') applyTheme(msg.data);
          if(msg.name === 'project') client.context.project = msg.data;
          emit(msg.name, msg.data);
        }
      });

      send({type:'hello', manifest:manifest});
    });
  }

  global.WorkhubPlugin = {
    connect:connect, version:PROTOCOL, translations:translations,
    get lang(){ return lang; },
    get locale(){ return LOCALES[lang]; }
  };
})(window);
