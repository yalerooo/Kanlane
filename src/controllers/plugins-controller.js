/* Plugins: instalar (oficiales o por enlace), abrir, permisos y la API que
   reciben (ver src/services/plugin-host.js y docs/PLUGINS.md). */
(function(){
  const host = Workhub.services.pluginHost;
  const toast = Workhub.views.toast;
  const TaskModel = Workhub.models.TaskModel;
  const MeetingModel = Workhub.models.MeetingModel;
  const PluginModel = Workhub.models.PluginModel;
  const ProjectModel = Workhub.models.ProjectModel;

  /* Variables de color que se pasan al plugin para que siga el tema. */
  const THEME_VARS = ['--bg', '--surface', '--surface-2', '--hover', '--ink', '--ink-soft', '--ink-faint',
    '--line', '--line-strong', '--accent', '--accent-solid', '--accent-ink', '--accent-soft',
    '--danger', '--danger-bg', '--st-pend', '--st-proc', '--st-wait', '--st-done', '--meet',
    '--r-sm', '--r-md', '--r-lg', '--r-xl', '--font', '--mono'];
  const EVENT_DELAY_MS = 250;
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const HM = /^\d{2}:\d{2}$/;

  function fail(code, message){
    const e = new Error(message);
    e.code = code;
    return e;
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.indexOf(x) !== -1);

  /* Copias limpias de los datos: nada de ids de vínculos a contraseñas. */
  const cleanTask = (t) => ({id:t.id, title:t.title || '', desc:t.desc || '', cliente:t.cliente || '', status:t.status || 'pendiente',
    dueDate:t.dueDate || '', contacto:t.contacto || '', createdAt:t.createdAt || 0, updatedAt:t.updatedAt || 0});
  const cleanClient = (c) => ({id:c.id, nombre:c.nombre || '', color:typeof c.color === 'number' ? c.color : null});
  const cleanContact = (c) => ({id:c.id, cliente:c.cliente || '', nombre:c.nombre || '', email:c.email || '', telefono:c.telefono || '', notas:c.notas || ''});
  const cleanMeeting = (m) => ({id:m.id, title:m.title || '', cliente:m.cliente || '', date:m.date || '', start:m.start || '', end:m.end || '', link:m.link || '', notas:m.notas || ''});

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

      this.plugins.on('change', () => this.render());
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
      this.m.settings.on('change', () => this.schedule('theme', () => this.theme()));
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
      this.view.render(installed, official);
    }

    onShow(){
      this.render();
      if(this.active) this.view.fitStage();
    }

    /* ---------- Instalar ---------- */

    addFromUrl(raw){
      if(!this.plugins.isReady()) return;
      const url = host.resolveUrl(raw);
      if(!url){
        this.view.setAdding(false, 'Pega la dirección completa del plugin, empezando por https://', true);
        return;
      }
      this.view.setAdding(true, 'Cargando el plugin para ver qué es y qué permisos pide…');
      host.probe(url, this.view.probeArea, false).then((res) => {
        this.view.setAdding(false);
        const existing = this.plugins.find(res.manifest.id);
        if(existing && existing.official){
          this.view.setAdding(false, 'Ese identificador es de un plugin oficial.', true);
          return;
        }
        this.pending = {mode:'install', id:res.manifest.id, url:url, manifest:res.manifest, official:false};
        this.view.openDialog('install', this.pending);
      }).catch((err) => {
        this.view.setAdding(false, err.message, true);
      });
    }

    installOfficial(index){
      const o = Workhub.services.officialPlugins[index];
      if(!o || !this.plugins.isReady()) return;
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

    /* Quita el plugin y borra sus datos en todos los proyectos. */
    remove(id){
      const p = this.plugins.find(id);
      if(!p) return;
      this.view.setDialogBusy(true);
      if(this.active && this.active.id === id) this.close();
      const wipes = this.m.projects.list().map((proj) =>
        PluginModel.clearData(ProjectModel.scope(this.app.rootDb, proj.id), id).catch(() => null));
      Promise.all(wipes).then(() => this.plugins.remove(id)).then(() => {
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
        onHello: (raw) => this.hello(p, raw, official),
        api: (method, params, f) => this.api(p, method, params, f)
      });
      frame.iframe.title = (p.manifest || {}).name || 'Plugin';
      this.active = {id:id, frame:frame};
    }

    /* El plugin se presenta: tiene que ser el que se instaló. Recibe los
       permisos aprobados (nunca más de los que pide). */
    hello(p, raw, official){
      const v = host.validateManifest(raw, official);
      if(v.error){
        this.view.setNotice('<strong>Este plugin no se pudo iniciar.</strong> ' + Workhub.utils.html.esc(v.error));
        return {error:v.error};
      }
      if(v.manifest.id !== p.id){
        const msg = 'La página ya no corresponde a este plugin (su identificador ha cambiado).';
        this.view.setNotice('<strong>Este plugin no se pudo iniciar.</strong> ' + msg);
        return {error:msg};
      }
      const approved = p.granted || [];
      const requested = v.manifest.permissions;
      const granted = requested.filter((x) => approved.indexOf(x) !== -1);
      const extra = requested.filter((x) => approved.indexOf(x) === -1);
      if(extra.length){
        this.pendingExtra = {mode:'review', id:p.id, url:p.url, manifest:v.manifest, official:official, extra:extra};
        this.view.setNotice('Esta versión del plugin pide permisos nuevos. Funciona con los que ya tenía hasta que los revises. <button type="button" class="btn btn-ghost btn-sm" data-review>Revisar</button>');
      } else if(!sameSet(requested, approved) || JSON.stringify(p.manifest || {}) !== JSON.stringify(v.manifest)){
        /* Pide menos permisos o cambió su descripción: se guarda tal cual. */
        this.plugins.setGranted(p.id, granted, v.manifest).catch(() => {});
      }
      return {manifest:v.manifest, granted:granted, context:this.context()};
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
      return {theme:this.theme(), project:this.projectInfo(), locale:'es', app:{name:'Workhub', protocol:1}};
    }

    schedule(name, data){
      if(!this.active) return;
      clearTimeout(this.timers[name]);
      this.timers[name] = setTimeout(() => {
        if(this.active) this.active.frame.emit(name, data());
      }, EVENT_DELAY_MS);
    }

    onProjectChange(){
      this.schedule('project', () => this.projectInfo());
    }

    /* ---------- API ---------- */

    db(){
      return ProjectModel.scope(this.app.rootDb, this.app.projectId);
    }

    api(p, method, params){
      const m = this.m;
      const name = (p.manifest || {}).name || p.id;
      switch(method){
        case 'app.statuses':
          return TaskModel.STATUS.map((s) => ({key:s.key, label:s.label}));
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
        case 'storage.get': return PluginModel.storageGet(this.db(), p.id, params.key);
        case 'storage.set': return this.serial(p.id, () => PluginModel.storageSet(this.db(), p.id, params.key, params.value)).then(() => true);
        case 'storage.remove': return this.serial(p.id, () => PluginModel.storageRemove(this.db(), p.id, params.key)).then(() => true);
        case 'storage.keys': return PluginModel.storageKeys(this.db(), p.id);
        case 'ui.toast': {
          const msg = str(params.message, 140);
          if(!msg) throw fail('bad-params', 'Falta el mensaje.');
          (params.type === 'error' ? toast.error : toast.success)(name + ': ' + msg);
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

    createTask(params){
      const tasks = this.m.tasks;
      if(!tasks.isReady()) throw fail('not-ready', 'Los datos todavía se están cargando.');
      const title = str(params.title, 200);
      if(!title) throw fail('bad-params', 'La tarea necesita un título.');
      const status = TaskModel.STATUS.some((s) => s.key === params.status) ? params.status : 'pendiente';
      const dueDate = YMD.test(params.dueDate || '') ? params.dueDate : '';
      return tasks.save(null, {
        title: title,
        desc: str(params.desc, 5000),
        cliente: str(params.cliente, 60),
        status: status,
        contacto: str(params.contacto, 120),
        dueDate: dueDate
      }).then((ref) => ({id:ref.id}));
    }

    updateTask(params){
      const tasks = this.m.tasks;
      const t = tasks.find(params.id);
      if(!t) throw fail('not-found', 'No existe esa tarea.');
      const src = params.patch && typeof params.patch === 'object' ? params.patch : {};
      const patch = {};
      if(typeof src.title === 'string'){
        patch.title = str(src.title, 200);
        if(!patch.title) throw fail('bad-params', 'El título no puede quedar vacío.');
      }
      if(typeof src.desc === 'string') patch.desc = str(src.desc, 5000);
      if(typeof src.cliente === 'string') patch.cliente = str(src.cliente, 60);
      if(typeof src.contacto === 'string') patch.contacto = str(src.contacto, 120);
      if(typeof src.dueDate === 'string'){
        if(src.dueDate && !YMD.test(src.dueDate)) throw fail('bad-params', 'La fecha tiene que ser AAAA-MM-DD.');
        patch.dueDate = src.dueDate;
      }
      const status = typeof src.status === 'string' ? src.status : null;
      if(status && !TaskModel.STATUS.some((s) => s.key === status)) throw fail('bad-params', 'Estado desconocido.');
      const work = [];
      if(status && status !== t.status) work.push(Promise.resolve(tasks.move(t.id, status)));
      if(Object.keys(patch).length) work.push(tasks.save(t.id, patch));
      return Promise.all(work).then(() => true);
    }

    createMeeting(params){
      const meetings = this.m.meetings;
      if(!meetings.isReady()) throw fail('not-ready', 'Los datos todavía se están cargando.');
      const date = YMD.test(params.date || '') ? params.date : '';
      const start = HM.test(params.start || '') ? params.start : '';
      const end = HM.test(params.end || '') ? params.end : '';
      const v = MeetingModel.validate({
        title: str(params.title, 200), date: date, start: start, end: end,
        cliente: str(params.cliente, 60), rawLink: str(params.link, 500), notas: str(params.notas, 2000)
      });
      if(v.error !== undefined) throw fail('bad-params', v.error || 'La reunión necesita título y fecha (AAAA-MM-DD).');
      return meetings.save(null, v.body).then((ref) => ({id:ref.id}));
    }
  }

  Workhub.controllers.PluginsController = PluginsController;
})();
