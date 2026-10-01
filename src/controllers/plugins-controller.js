/* Plugins: instalar (oficiales o por enlace), abrir, permisos y la API que
   reciben (ver src/services/plugin-host.js y docs/PLUGINS.md). */
(function(){
  const host = Workhub.services.pluginHost;
  const toast = Workhub.views.toast;
  const extensions = Workhub.views.extensions;
  const TaskModel = Workhub.models.TaskModel;
  const PluginModel = Workhub.models.PluginModel;
  const ProjectModel = Workhub.models.ProjectModel;

  /* Variables de color que se pasan al plugin para que siga el tema. */
  const THEME_VARS = ['--bg', '--surface', '--surface-2', '--hover', '--ink', '--ink-soft', '--ink-faint',
    '--line', '--line-strong', '--accent', '--accent-solid', '--accent-ink', '--accent-soft',
    '--danger', '--danger-bg', '--st-pend', '--st-proc', '--st-wait', '--st-done', '--meet',
    '--r-sm', '--r-md', '--r-lg', '--r-xl', '--font', '--mono'];
  const EVENT_DELAY_MS = 250;
  const RADII = {sharp:{sm:2, md:3, lg:4, xl:6}, round:{sm:7, md:10, lg:14, xl:18}};
  const DENSITIES = ['compact', 'normal', 'comfortable'];
  const THEMES = ['system', 'light', 'dark'];
  const PALETTES = ['default', 'warm', 'cool', 'slate'];
  const FONTS = ['default', 'system', 'serif', 'mono'];
  const TEXT_SIZES = ['small', 'normal', 'large'];

  const {fail, str, sameSet, cleanTask, cleanClient, cleanContact, cleanMeeting, cleanForm, YMD, HM, HEX} = Workhub.pluginClean;

  class PluginsController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.plugins = app.models.plugins;
      this.m = app.models;
      /* Plugin abierto: {id, frame}. */
      this.active = null;
      this.pending = null;
      this.timers = {};
      /* Plugins cargados ocultos para añadir botones o cambiar la apariencia:
         id → {frame, url}. */
      this.bg = new Map();
      /* Apariencia aplicada por un plugin: {pluginId, values}. */
      this.appearance = null;
      this.appearanceThemeOverridden = false;

      this.plugins.on('change', () => {
        this.render();
        this.upgradeOfficial();
        this.syncBackground();
      });
      /* Formularios que piden los plugins (wh.ui.form): de uno en uno. */
      this.formView = new Workhub.views.PluginFormView();
      this.formQueue = Promise.resolve();
      this.view.bindAddUrl((url) => this.addFromUrl(url));
      this.view.bindCards({
        open: (id) => this.open(id),
        details: (id) => this.details(id),
        install: (i) => this.installOfficial(i),
        officialDetails: (i) => this.installOfficial(i)
      });
      this.view.bindStage({
        back: () => this.close(),
        details: () => this.active && this.details(this.active.id),
        review: () => this.reviewExtra()
      });
      this.view.bindDialog({
        confirm: () => this.confirmDialog(),
        remove: () => this.remove(this.pending && this.pending.id)
      });

      /* Cambios de datos → evento al plugin abierto (agrupados). */
      const watch = (model, name, list) => model.on('change', () => this.schedule(name, list));
      watch(this.m.tasks, 'tasks', () => this.m.tasks.items.map(cleanTask));
      watch(this.m.clients, 'clients', () => this.m.clients.items.map(cleanClient));
      watch(this.m.contacts, 'contacts', () => this.m.contacts.items.map(cleanContact));
      watch(this.m.meetings, 'meetings', () => this.m.meetings.items.map(cleanMeeting));
      this.m.settings.on('change', () => {
        if(this.appearance) this.applyAppearance();
        else this.schedule('theme', () => this.theme());
      });
    }

    /* ---------- Lista ---------- */

    /* Los oficiales se muestran con el manifiesto del catálogo (el más reciente). */
    manifestOf(p){
      if(p.official){
        const o = Workhub.services.officialPlugins.find((x) => x.manifest.id === p.id);
        if(o) return o.manifest;
      }
      return host.validateManifest(p.manifest || {}, !!p.official).manifest || p.manifest || {};
    }

    installedList(){
      return this.plugins.list().map((p) => ({id:p.id, url:p.url, manifest:this.manifestOf(p), official:!!p.official, granted:p.granted || [], installedAt:p.installedAt}));
    }

    render(){
      const installed = this.installedList();
      const official = Workhub.services.officialPlugins.map((o) => ({
        url: o.url, manifest: o.manifest, installed: !!this.plugins.find(o.manifest.id)
      }));
      this.view.render(installed, official, this.canManage());
      this.app.shell.renderPluginNav(installed, this.active && this.active.id);
    }

    canManage(){
      return !Workhub.views.team.enabled() || Workhub.views.team.canEdit();
    }

    onShow(){
      this.render();
      if(this.active) this.view.fitStage();
    }

    /* ---------- Segundo plano ---------- */

    /* Los plugins oficiales son de Workhub: si una versión nueva pide más
       permisos, se conceden solos (una vez por sesión). */
    upgradeOfficial(){
      this.upgraded = this.upgraded || {};
      this.plugins.list().forEach((p) => {
        const key = this.app.projectId + ':' + p.id;
        if(!p.official || this.upgraded[key] || !this.canManage()) return;
        const o = Workhub.services.officialPlugins.find((x) => x.manifest.id === p.id);
        if(!o) return;
        const want = o.manifest.permissions;
        if(!sameSet(want, p.granted || []) || JSON.stringify(p.manifest || {}) !== JSON.stringify(o.manifest)){
          this.upgraded[key] = true;
          this.plugins.setGranted(p.id, want.slice(), o.manifest).catch(() => {});
        }
      });
    }

    needsBackground(p){
      return (p.granted || []).some((x) => host.BACKGROUND_PERMISSIONS.indexOf(x) !== -1);
    }

    /* Arranca (o para) la instancia oculta de cada plugin que la necesite. */
    syncBackground(){
      if(location.protocol === 'file:' || !this.app.rootDb) return;
      const want = new Map();
      this.plugins.list().forEach((p) => { if(this.needsBackground(p)) want.set(p.id, p); });
      this.bg.forEach((entry, id) => {
        const p = want.get(id);
        if(!p || p.url !== entry.url) this.stopBackground(id);
      });
      want.forEach((p, id) => {
        if(this.bg.has(id)) return;
        const official = !!p.official;
        const url = host.resolveUrl(p.url) || p.url;
        const frame = new host.PluginFrame({
          url: url,
          container: this.view.probeArea,
          hidden: true,
          official: official,
          mode: 'background',
          onHello: (raw) => this.hello(this.plugins.find(id) || p, raw, official, 'background'),
          api: (method, params, f) => this.api(this.plugins.find(id) || p, method, params, f)
        });
        this.bg.set(id, {frame:frame, url:p.url});
      });
    }

    stopBackground(id){
      const entry = this.bg.get(id);
      if(entry) entry.frame.destroy();
      this.bg.delete(id);
      extensions.clearPlugin(id);
      this.resetAppearance(id);
    }

    /* Todos los marcos vivos: el panel abierto y los de segundo plano. */
    frames(){
      const list = [];
      if(this.active) list.push(this.active.frame);
      this.bg.forEach((e) => list.push(e.frame));
      return list;
    }

    /* ---------- Apariencia ---------- */

    setAppearance(pluginId, params){
      const v = {};
      if(params.accent != null){
        if(!HEX.test(String(params.accent))) throw fail('bad-params', 'accent tiene que ser un color #RRGGBB.');
        v.accent = String(params.accent).toUpperCase();
      }
      if(params.radius != null){
        if(['sharp', 'normal', 'round'].indexOf(params.radius) === -1) throw fail('bad-params', 'radius: "sharp", "normal" o "round".');
        v.radius = params.radius;
      }
      if(params.density != null){
        if(DENSITIES.indexOf(params.density) === -1) throw fail('bad-params', 'density: "compact", "normal" o "comfortable".');
        v.density = params.density;
      }
      if(params.theme != null){
        if(THEMES.indexOf(params.theme) === -1) throw fail('bad-params', 'theme: "system", "light" o "dark".');
        v.theme = params.theme;
      }
      if(params.palette != null){
        if(PALETTES.indexOf(params.palette) === -1) throw fail('bad-params', 'palette: "default", "warm", "cool" o "slate".');
        v.palette = params.palette;
      }
      if(params.font != null){
        if(FONTS.indexOf(params.font) === -1) throw fail('bad-params', 'font: "default", "system", "serif" o "mono".');
        v.font = params.font;
      }
      if(params.textSize != null){
        if(TEXT_SIZES.indexOf(params.textSize) === -1) throw fail('bad-params', 'textSize: "small", "normal" o "large".');
        v.textSize = params.textSize;
      }
      this.appearance = {pluginId:pluginId, values:v};
      this.applyAppearance();
      return true;
    }

    resetAppearance(pluginId){
      if(!this.appearance || (pluginId && this.appearance.pluginId !== pluginId)) return;
      this.appearance = null;
      this.applyAppearance();
    }

    /* Aplica la apariencia del plugin sobre la del usuario (o la retira). */
    applyAppearance(){
      const root = document.documentElement;
      const settings = this.app.controllers.settings;
      const v = this.appearance ? this.appearance.values : {};
      settings.view.applyAccent(settings.model.currentAccent());
      settings.view.applyTheme(v.theme || settings.model.theme, !!v.theme || this.appearanceThemeOverridden);
      this.appearanceThemeOverridden = !!v.theme;
      if(v.accent){
        const hex = v.accent;
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        const ink = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111113' : '#FFFFFF';
        const set = (k, val) => root.style.setProperty(k, val);
        set('--acc-solid-l', hex); set('--acc-solid-d', hex);
        set('--acc-ink-l', ink); set('--acc-ink-d', ink);
        set('--acc-text-l', 'color-mix(in srgb, ' + hex + ' 80%, #000)');
        set('--acc-text-d', 'color-mix(in srgb, ' + hex + ' 60%, #fff)');
        set('--acc-soft-l', 'color-mix(in srgb, ' + hex + ' 10%, #fff)');
        set('--acc-soft-d', 'color-mix(in srgb, ' + hex + ' 18%, #161619)');
      }
      const radius = RADII[v.radius];
      ['sm', 'md', 'lg', 'xl'].forEach((k) => {
        if(radius) root.style.setProperty('--r-' + k, radius[k] + 'px');
        else root.style.removeProperty('--r-' + k);
      });
      if(v.density && v.density !== 'normal') root.setAttribute('data-density', v.density);
      else root.removeAttribute('data-density');
      if(v.palette && v.palette !== 'default') root.setAttribute('data-palette', v.palette);
      else root.removeAttribute('data-palette');
      const fonts = {
        system:'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        serif:'Georgia, "Times New Roman", serif',
        mono:'var(--mono)'
      };
      if(fonts[v.font]) root.style.setProperty('--font', fonts[v.font]);
      else root.style.removeProperty('--font');
      if(v.textSize && v.textSize !== 'normal') root.setAttribute('data-text-size', v.textSize);
      else root.removeAttribute('data-text-size');
      this.schedule('theme', () => this.theme());
    }

    /* ---------- Instalar ---------- */

    addFromUrl(raw){
      if(!this.plugins.isReady() || !this.canManage()) return;
      const projectId = this.app.projectId;
      const url = host.resolveUrl(raw);
      if(!url){
        this.view.setAdding(false, 'Pega la dirección completa del plugin, empezando por https://', true);
        return;
      }
      this.view.setAdding(true, 'Cargando el plugin para ver qué es y qué permisos pide…');
      host.probe(url, this.view.probeArea, false).then((res) => {
        if(this.app.projectId !== projectId) return;
        this.view.setAdding(false);
        const existing = this.plugins.find(res.manifest.id);
        if(existing && existing.official){
          this.view.setAdding(false, 'Ese identificador es de un plugin oficial.', true);
          return;
        }
        this.pending = {mode:'install', id:res.manifest.id, url:url, manifest:res.manifest, official:false};
        this.view.openDialog('install', this.pending);
      }).catch((err) => {
        if(this.app.projectId !== projectId) return;
        this.view.setAdding(false, err.message, true);
      });
    }

    installOfficial(index){
      const o = Workhub.services.officialPlugins[index];
      if(!o || !this.plugins.isReady() || !this.canManage()) return;
      this.pending = {mode:'install', id:o.manifest.id, url:o.url, manifest:o.manifest, official:true};
      this.view.openDialog('install', this.pending);
    }

    confirmDialog(){
      const p = this.pending;
      if(!p) return;
      if(p.mode === 'details'){
        this.view.closeDialog();
        this.open(p.id);
        return;
      }
      if(!this.canManage()) return;
      this.view.setDialogBusy(true);
      let done;
      if(p.mode === 'install'){
        const granted = p.manifest.permissions.slice();
        done = this.plugins.install(p.url, p.manifest, granted, p.official).then(() => {
          toast.success('Plugin «' + p.manifest.name + '» instalado');
          if(!p.official) this.view.clearUrl();
          this.view.closeDialog();
          /* La lista de instalados se actualiza un instante después. */
          this.open(p.id, false, {id:p.id, url:p.url, manifest:p.manifest, official:p.official, granted:granted});
        });
      } else {
        const plugin = this.plugins.find(p.id);
        const granted = (plugin.granted || []).concat(p.extra);
        done = this.plugins.setGranted(p.id, granted, p.manifest).then(() => {
          this.view.closeDialog();
          toast.success('Permisos actualizados');
          this.open(p.id, true, Object.assign({}, plugin, {id:p.id, granted:granted, manifest:p.manifest}));
        });
      }
      done.catch(() => {
        this.view.setDialogBusy(false);
        toast.error('No se pudo guardar. Inténtalo de nuevo.');
      });
    }

    details(id){
      const p = this.plugins.find(id);
      if(!p) return;
      this.pending = {mode:'details', id:id, url:p.url, manifest:this.manifestOf(p), official:!!p.official, granted:p.granted || [], installedAt:p.installedAt};
      this.view.openDialog('details', this.pending);
    }

    /* Quita el plugin y sus datos solo del proyecto abierto. */
    remove(id){
      const p = this.plugins.find(id);
      if(!p || !this.canManage()) return;
      this.view.setDialogBusy(true);
      if(this.active && this.active.id === id) this.close();
      this.stopBackground(id);
      const db = this.db();
      const installDoc = this.plugins.doc(id);
      /* El registro antiguo del principal puede contener wh.storage.user. */
      const preserve = this.app.projectId === ProjectModel.MAIN_ID
        ? PluginModel.userBucket(this.app.rootDb, id).read() : Promise.resolve();
      preserve.then(() => PluginModel.clearData(db, id)).then(() => installDoc.delete()).then(() => {
        this.view.closeDialog();
        toast.success('Plugin «' + ((p.manifest || {}).name || id) + '» quitado');
      }).catch(() => {
        this.view.setDialogBusy(false);
        toast.error('No se pudo quitar el plugin.');
      });
    }

    /* ---------- Abrir ---------- */

    /* fresh: datos del plugin si aún no han llegado a la lista (recién instalado). */
    open(id, force, fresh){
      const p = fresh || this.plugins.find(id);
      if(!p) return;
      this.app.navigate('plugins');
      if(this.active && this.active.id === id && !force) return;
      this.closeFrame();
      this.view.showStage(Object.assign({}, p, {manifest:this.manifestOf(p)}));
      const official = !!p.official;
      const frame = new host.PluginFrame({
        url: host.resolveUrl(p.url) || p.url,
        container: this.view.frameWrap,
        official: official,
        mode: 'panel',
        onHello: (raw) => this.hello(p, raw, official, 'panel'),
        api: (method, params, f) => this.api(p, method, params, f)
      });
      frame.iframe.title = (p.manifest || {}).name || 'Plugin';
      this.active = {id:id, frame:frame};
      this.app.shell.renderPluginNav(this.installedList(), id);
    }

    /* El plugin se presenta: tiene que ser el que se instaló. Recibe los
       permisos aprobados (nunca más de los que pide). */
    hello(p, raw, official, mode){
      const panel = mode !== 'background';
      const v = host.validateManifest(raw, official);
      if(v.error){
        if(panel) this.view.setNotice('<strong>Este plugin no se pudo iniciar.</strong> ' + Workhub.utils.html.esc(v.error));
        return {error:v.error};
      }
      if(v.manifest.id !== p.id){
        const msg = 'La página ya no corresponde a este plugin (su identificador ha cambiado).';
        if(panel) this.view.setNotice('<strong>Este plugin no se pudo iniciar.</strong> ' + msg);
        return {error:msg};
      }
      /* Los oficiales usan los permisos de su catálogo (ver upgradeOfficial). */
      const approved = official ? this.manifestOf(p).permissions || [] : (p.granted || []);
      const requested = v.manifest.permissions;
      const granted = requested.filter((x) => approved.indexOf(x) !== -1);
      const extra = requested.filter((x) => approved.indexOf(x) === -1);
      if(extra.length && panel && !official){
        this.pendingExtra = {mode:'review', id:p.id, url:p.url, manifest:v.manifest, official:official, extra:extra};
        this.view.setNotice('Esta versión del plugin pide permisos nuevos. Funciona con los que ya tenía hasta que los revises. <button type="button" class="btn btn-ghost btn-sm" data-review>Revisar</button>');
      } else if(!extra.length && panel && this.canManage() && (!sameSet(requested, approved) || JSON.stringify(p.manifest || {}) !== JSON.stringify(v.manifest))){
        /* Pide menos permisos o cambió su descripción: se guarda tal cual. */
        this.plugins.setGranted(p.id, granted, v.manifest).catch(() => {});
      }
      const ctx = this.context();
      ctx.mode = panel ? 'panel' : 'background';
      return {manifest:v.manifest, granted:granted, context:ctx};
    }

    reviewExtra(){
      if(!this.pendingExtra) return;
      this.pending = this.pendingExtra;
      this.view.openDialog('review', this.pending);
    }

    closeFrame(){
      if(this.active){
        this.active.frame.destroy();
        this.active = null;
      }
      this.pendingExtra = null;
    }

    close(){
      this.closeFrame();
      this.view.showHome();
      this.render();
    }

    /* ---------- Contexto y eventos ---------- */

    theme(){
      const cs = getComputedStyle(document.documentElement);
      const vars = {};
      THEME_VARS.forEach((name) => { vars[name] = cs.getPropertyValue(name).trim(); });
      const attr = document.documentElement.getAttribute('data-theme');
      const dark = attr ? attr === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      return {scheme: dark ? 'dark' : 'light', vars: vars};
    }

    projectInfo(){
      const p = this.app.controllers.projects.current();
      return {id:p.id, name:p.nombre};
    }

    context(){
      return {theme:this.theme(), project:this.projectInfo(), locale:Workhub.i18n.lang, app:{name:'Workhub', protocol:1}};
    }

    /* Evento a todos los marcos vivos (cada uno solo lo recibe si tiene permiso). */
    schedule(name, data){
      if(!this.active && !this.bg.size) return;
      clearTimeout(this.timers[name]);
      this.timers[name] = setTimeout(() => {
        const value = data();
        this.frames().forEach((f) => f.emit(name, value));
      }, EVENT_DELAY_MS);
    }

    /* Otra instancia del mismo plugin cambió su almacenamiento. */
    notifyStorage(pluginId, from, key, scope){
      this.frames().forEach((f) => {
        if(f !== from && f.manifest && f.manifest.id === pluginId) f.emit('storage', {key:key, scope:scope === 'user' ? 'user' : 'project'});
      });
    }

    onProjectChange(){
      this.render();
      this.schedule('project', () => this.projectInfo());
    }

    beforeProjectChange(){
      Object.keys(this.timers).forEach((key) => clearTimeout(this.timers[key]));
      this.formView._finish(null);
      this.closeFrame();
      Array.from(this.bg.keys()).forEach((id) => this.stopBackground(id));
      this.pending = null;
      this.view.closeDialog();
      this.view.showHome();
    }

    /* ---------- API ---------- */

    db(){
      return ProjectModel.scope(this.app.rootDb, this.app.projectId);
    }

    /* scope 'user': común a todos los proyectos; si no, el proyecto abierto. */
    bucket(pluginId, scope){
      return scope === 'user'
        ? PluginModel.userBucket(this.app.rootDb, pluginId)
        : PluginModel.projectBucket(this.db(), pluginId);
    }

    api(p, method, params, frame){
      const m = this.m;
      const manifest = this.manifestOf(p);
      /* Nombre visible (los oficiales, traducidos). */
      const name = Workhub.t(manifest.name || p.id);
      const who = {id:p.id, name:name, hue:typeof manifest.color === 'number' ? manifest.color : null, icon:manifest.icon};
      switch(method){
        case 'app.statuses':
          return TaskModel.STATUS.map((s) => ({key:s.key, label:Workhub.t(s.label), done:s.done, color:s.color}));
        case 'tasks.list':
          return m.tasks.items.map(cleanTask);
        case 'tasks.create': return this.createTask(params);
        case 'tasks.update': return this.updateTask(params);
        case 'clients.list':
          return m.clients.items.map(cleanClient);
        case 'contacts.list':
          return m.contacts.items.map(cleanContact);
        case 'meetings.list':
          return m.meetings.items.map(cleanMeeting);
        case 'meetings.create': return this.createMeeting(params);
        case 'storage.get': return PluginModel.storageGet(this.bucket(p.id, params.scope), params.key);
        case 'storage.set': {
          const projectId = this.app.projectId;
          const bucket = this.bucket(p.id, params.scope);
          return this.serial(projectId + ':' + p.id, () => PluginModel.storageSet(bucket, params.key, params.value))
            .then(() => { if(this.app.projectId === projectId) this.notifyStorage(p.id, frame, params.key, params.scope); return true; });
        }
        case 'storage.remove': {
          const projectId = this.app.projectId;
          const bucket = this.bucket(p.id, params.scope);
          return this.serial(projectId + ':' + p.id, () => PluginModel.storageRemove(bucket, params.key))
            .then(() => { if(this.app.projectId === projectId) this.notifyStorage(p.id, frame, params.key, params.scope); return true; });
        }
        case 'ui.openPanel':
          this.open(p.id);
          return true;
        case 'ui.form': {
          const spec = cleanForm(params);
          const run = this.formQueue.then(() => this.frames().indexOf(frame) !== -1 ? this.formView.open(spec, who) : null);
          this.formQueue = run.catch(() => null);
          return run;
        }
        case 'ui.addButton': return extensions.addButton(who, frame, params);
        case 'ui.removeButton': return extensions.removeButton(p.id, String(params.id || ''));
        case 'ui.setTaskBadges': return extensions.setTaskBadges(who, params.badges);
        case 'ui.setAppearance': return this.setAppearance(p.id, params);
        case 'storage.keys': return PluginModel.storageKeys(this.bucket(p.id, params.scope));
        case 'ui.toast': {
          const msg = str(params.message, 140);
          if(!msg) throw fail('bad-params', 'Falta el mensaje.');
          if(params.type === 'error') toast.error(name + ': ' + msg);
          else if(params.type === 'important') toast.success(name + ': ' + msg, {important:true});
          return true;
        }
        case 'ui.openTask': {
          if(!m.tasks.find(params.id)) throw fail('not-found', 'No existe esa tarea.');
          this.app.navigate('tasks');
          this.app.controllers.tasks.openDetail(params.id);
          return true;
        }
      }
      throw fail('unknown-method', 'Método desconocido.');
    }

    /* Las escrituras del almacenamiento de un plugin leen y reescriben su
       documento: se hacen de una en una para que no se pisen. */
    serial(pluginId, fn){
      this.queues = this.queues || {};
      const run = (this.queues[pluginId] || Promise.resolve()).catch(() => {}).then(fn);
      this.queues[pluginId] = run;
      return run;
    }

  }

  Workhub.controllers.PluginsController = PluginsController;
})();
