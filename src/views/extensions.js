/* Extensiones de la interfaz aportadas por plugins (permiso "ui:extend").
   Un plugin no toca el HTML de Kanlane: declara botones y etiquetas, y
   Kanlane los pinta con sus propios componentes en huecos fijos:

     tasks.toolbar     barra de Tareas                 contexto: {}
     task.actions      ficha de una tarea              contexto: {taskId}
     calendar.toolbar  barra del Calendario            contexto: {date}
     client.actions    ficha de un cliente             contexto: {clientId, cliente}
     command           paleta de comandos (Ctrl K)     contexto: {}

   Además, etiquetas en las tarjetas del tablero (setTaskBadges). Al pulsar un
   botón, el plugin recibe el evento "action" con {id, context}. */
(function(){
  const {esc, hueFor} = Workhub.utils.html;
  const icons = Workhub.views.pluginIcons;

  const LOCATIONS = ['tasks.toolbar', 'task.actions', 'calendar.toolbar', 'client.actions', 'command'];
  const TONES = ['neutral', 'accent', 'success', 'warning', 'danger'];
  const MAX_BUTTONS_PER_PLUGIN = 12;
  const MAX_BADGES_PER_PLUGIN = 2000;
  const ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;

  function fail(code, message){
    const e = new Error(message);
    e.code = code;
    return e;
  }
  const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

  class Extensions extends Workhub.Emitter {
    constructor(){
      super();
      /* clave "plugin:id" → botón */
      this.buttons = new Map();
      /* plugin → {name, hue, map: {taskId: {text, tone, icon}}} */
      this.badges = new Map();
      this.order = 0;
      this.pending = false;
    }

    changed(){
      /* Varias llamadas seguidas → un solo repintado. */
      if(this.pending) return;
      this.pending = true;
      Promise.resolve().then(() => {
        this.pending = false;
        this.emit('change');
      });
    }

    /* plugin: {id, name, hue}; frame: PluginFrame que recibe los clics. */
    addButton(plugin, frame, def){
      def = def && typeof def === 'object' ? def : {};
      const id = String(def.id || '');
      if(!ID_RE.test(id)) throw fail('bad-params', 'El botón necesita un id (letras, números, "_", "-" o ".", hasta 40).');
      if(LOCATIONS.indexOf(def.location) === -1) throw fail('bad-params', 'Ubicación desconocida. Usa: ' + LOCATIONS.join(', ') + '.');
      const label = text(def.label, 32);
      if(!label) throw fail('bad-params', 'El botón necesita un texto (label).');
      const key = plugin.id + ':' + id;
      const own = Array.from(this.buttons.values()).filter((b) => b.pluginId === plugin.id);
      if(!this.buttons.has(key) && own.length >= MAX_BUTTONS_PER_PLUGIN) throw fail('quota', 'Máximo ' + MAX_BUTTONS_PER_PLUGIN + ' botones por plugin.');
      const prev = this.buttons.get(key);
      this.buttons.set(key, {
        key: key,
        id: id,
        pluginId: plugin.id,
        pluginName: plugin.name,
        hue: plugin.hue,
        location: def.location,
        label: label,
        icon: icons.has(def.icon) ? def.icon : '',
        tooltip: text(def.tooltip, 100),
        primary: def.variant === 'primary',
        frame: frame,
        order: prev ? prev.order : ++this.order
      });
      this.changed();
      return true;
    }

    removeButton(pluginId, id){
      if(this.buttons.delete(pluginId + ':' + id)) this.changed();
      return true;
    }

    /* map: {taskId: {text, tone, icon} | null}. Sustituye todas las del plugin. */
    setTaskBadges(plugin, map){
      if(!map || typeof map !== 'object' || Array.isArray(map)) throw fail('bad-params', 'Pasa un objeto {idDeTarea: {text, tone, icon}}.');
      const ids = Object.keys(map);
      if(ids.length > MAX_BADGES_PER_PLUGIN) throw fail('quota', 'Demasiadas etiquetas.');
      const clean = {};
      ids.forEach((taskId) => {
        const b = map[taskId];
        if(!b || typeof b !== 'object') return;
        const t = text(b.text, 24);
        if(!t) return;
        clean[taskId] = {text:t, tone:TONES.indexOf(b.tone) !== -1 ? b.tone : 'neutral', icon:icons.has(b.icon) ? b.icon : ''};
      });
      this.badges.set(plugin.id, {name:plugin.name, map:clean});
      this.changed();
      return true;
    }

    /* Quita todo lo que aportó un plugin (al quitarlo o al cerrarse su marco). */
    clearPlugin(pluginId){
      let touched = this.badges.delete(pluginId);
      Array.from(this.buttons.keys()).forEach((k) => {
        if(this.buttons.get(k).pluginId === pluginId){ this.buttons.delete(k); touched = true; }
      });
      if(touched) this.changed();
    }

    buttonsAt(location){
      return Array.from(this.buttons.values()).filter((b) => b.location === location).sort((a, b) => a.order - b.order);
    }

    badgesFor(taskId){
      const out = [];
      this.badges.forEach((entry) => {
        const b = entry.map[taskId];
        if(b) out.push(Object.assign({pluginName:entry.name}, b));
      });
      return out;
    }

    trigger(key, context){
      const b = this.buttons.get(key);
      if(!b) return;
      b.frame.emit('action', {id:b.id, location:b.location, context:context || {}});
    }

    /* ---------- Pintado ---------- */

    badgesHtml(taskId){
      return this.badgesFor(taskId).map((b) =>
        '<span class="ext-badge is-' + b.tone + '" title="' + esc(b.pluginName) + '">' + (b.icon ? icons.svg(b.icon, 11) : '') + esc(b.text) + '</span>'
      ).join('');
    }

    buttonHtml(b, context){
      return '<button type="button" class="ext-btn' + (b.primary ? ' is-primary' : '') + '" style="--h:' + (typeof b.hue === 'number' ? b.hue : hueFor(b.pluginId)) + '"' +
        ' data-ext-key="' + esc(b.key) + '" data-ext-ctx="' + esc(JSON.stringify(context || {})) + '"' +
        ' title="' + esc(b.pluginName + (b.tooltip ? ': ' + b.tooltip : '')) + '">' +
        (b.icon ? icons.svg(b.icon, 14) : '<span class="ext-dot" aria-hidden="true"></span>') +
        '<span>' + esc(b.label) + '</span></button>';
    }

    /* Rellena los huecos [data-ext-slot] (con su contexto en data-ext-context). */
    fillSlots(root){
      (root || document).querySelectorAll('[data-ext-slot]').forEach((el) => {
        let ctx = {};
        try{ ctx = JSON.parse(el.getAttribute('data-ext-context') || '{}'); }catch(e){}
        const list = this.buttonsAt(el.getAttribute('data-ext-slot'));
        el.innerHTML = list.map((b) => this.buttonHtml(b, ctx)).join('');
        el.hidden = !list.length;
      });
    }
  }

  const extensions = new Extensions();

  /* Un único escuchador para todos los botones de plugins. */
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest && ev.target.closest('.ext-btn[data-ext-key]');
    if(!btn) return;
    let ctx = {};
    try{ ctx = JSON.parse(btn.getAttribute('data-ext-ctx') || '{}'); }catch(e){}
    extensions.trigger(btn.getAttribute('data-ext-key'), ctx);
  });

  extensions.LOCATIONS = LOCATIONS;
  extensions.TONES = TONES;
  Workhub.views.extensions = extensions;
})();
