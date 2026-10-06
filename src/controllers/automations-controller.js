/* Automatizaciones del proyecto abierto: guarda las reglas con el proyecto, escucha lo que la
   persona hace con las tareas (crear, mover) y ejecuta lo que toque con el motor de
   models/automation-model.js.
   - Dónde se guardan: en plugin_data/kanlane.automations del proyecto ({rules, fired}), así que
     viajan con él (equipos, copia al convertir, borrado) y en un proyecto con cifrado total van
     selladas. No hacen falta reglas de Firestore nuevas.
   - Quién las ejecuta: el navegador de quien hace el cambio, una sola vez. Lo que llega de otro
     dispositivo no vuelve a dispararlas. Las reglas por fecha se miran al abrir, al cambiar las
     tareas y cada diez minutos (sin servidor todavía: solo con Kanlane abierto).
   - Quién las cambia: en un equipo, solo quien es propietario. Como invitado no hay automatizaciones. */
(function(){
  const A = Workhub.models.Automations;
  const {PluginModel, ProjectModel, TaskModel} = Workhub.models;
  const {ymd, daysFromToday} = Workhub.utils.dates;
  const toast = Workhub.views.toast;
  const team = () => Workhub.views.team;
  const t = (text, params) => Workhub.t(text, params);

  const BUCKET = 'kanlane.automations';
  const FRESH_MS = 60000;
  const DUE_EVERY_MS = 10 * 60000;
  const DUE_DELAY_MS = 3000;
  const ORDER_STEP = 1024;
  const WARNINGS = {
    loop: 'Se cortó una cadena de automatizaciones que se repetía: una regla volvía a dispararse. Revisa las reglas.',
    depth: 'Se cortó una cadena de automatizaciones demasiado larga (más de tres seguidas). Revisa las reglas.',
    rate: 'Demasiadas automatizaciones a la vez: las que faltaban se han saltado. Vuelve a intentarlo en un minuto.'
  };

  class AutomationsController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      this.tasks = app.models.tasks;
      this.rules = [];
      this.fired = {};
      this.key = '';
      this.loading = null;
      this.loadedAt = 0;
      this.writes = Promise.resolve();
      this.warnedAt = {};
      this.paused = {};
      this.engine = new A.Engine({
        rules: () => this.live(),
        ctx: () => this.ctx(),
        task: (id) => this.tasks.find(id) || null,
        update: (id, patch) => this.update(id, patch),
        log: (id, rule, did) => this.log(id, rule, did),
        warn: (code) => this.warn(code),
        dateIn: (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); },
        daysUntil: (date) => daysFromToday(date),
        now: () => Date.now()
      });

      this.tasks.on('auto', (ev) => this.onEvent(ev));
      this.tasks.on('change', () => this.scheduleDue());
      setInterval(() => this.checkDue(), DUE_EVERY_MS);

      view.bind({
        open: () => this.open(),
        close: () => this.view.hide(),
        create: () => this.edit(null),
        edit: (id) => this.edit(id),
        remove: (id) => this.remove(id),
        toggle: (id, on) => this.toggle(id, on),
        use: (i) => this.useTemplate(+i),
        save: (draft) => this.saveRule(draft),
        cancel: () => this.renderList(),
        upgrade: () => { this.view.hide(); if(this.app.controllers.auth) this.app.controllers.auth.upgradeGuest(); }
      });
    }

    /* ---------- Quién puede qué ---------- */

    isGuest(){
      const auth = this.app.controllers && this.app.controllers.auth;
      return !!(auth && auth.guest);
    }

    /* Hay proyecto abierto y sus tareas están cargadas. */
    usable(){
      return !!this.app.rootDb && !this.isGuest() && this.tasks.isReady();
    }

    canRun(){ return this.usable() && team().canEdit(); }

    canManage(){ return this.canRun() && (!team().enabled() || team().isOwner()); }

    /* Columnas, etiquetas y personas del proyecto, como las pide Automations. */
    ctx(){
      const T = team();
      return {
        stages: TaskModel.STATUS.map((s) => ({key:s.key, label:s.label, done:s.done})),
        labels: Workhub.views.labels.catalog().map((l) => l.name),
        members: T.enabled() ? T.members().map((m) => ({uid:m.uid, name:m.name})) : [],
        team: T.enabled(),
        me: T.meUid()
      };
    }

    /* Las reglas con su problema de ahora mismo: una que apunta a una columna, una etiqueta o una
       persona que ya no existe queda en pausa (no se ejecuta) hasta que se arregle. */
    live(){
      const ctx = this.ctx();
      return this.rules.map((r) => Object.assign({}, r, {broken:A.problem(r, ctx)}));
    }

    /* ---------- Guardado ---------- */

    bucket(){
      return PluginModel.projectBucket(ProjectModel.scope(this.app.rootDb, this.app.projectId), BUCKET, this.app.cipher);
    }

    projectKey(){
      return this.app.projectId + '|' + (this.app.cipher ? this.app.cipher.kid : '');
    }

    /* Lee las reglas del proyecto abierto (se reutiliza lo leído durante un minuto). */
    load(force){
      if(!this.usable()) return Promise.resolve();
      const key = this.projectKey();
      if(this.key !== key){ this.rules = []; this.fired = {}; }
      else if(!force && this.loading && Date.now() - this.loadedAt < FRESH_MS) return this.loading;
      this.key = key;
      this.loadedAt = Date.now();
      const parse = (values, name, empty) => { try{ const v = JSON.parse(values[name]); return v == null ? empty : v; }catch(e){ return empty; } };
      const reading = this.loading = this.bucket().read().then((values) => {
        if(this.key !== key || this.loading !== reading) return;
        this.rules = A.normalizeAll(parse(values, 'rules', []));
        const fired = parse(values, 'fired', {});
        this.fired = fired && typeof fired === 'object' ? fired : {};
      }, () => { if(this.key === key){ this.rules = []; this.fired = {}; } });
      return reading;
    }

    /* Escrituras de una en una: reglas y marcas de fecha comparten documento. */
    write(name, value){
      const key = this.key;
      const run = this.writes.then(() => {
        if(key !== this.projectKey()) return null;
        return PluginModel.storageSet(this.bucket(), name, value);
      });
      this.writes = run.catch(() => null);
      return run;
    }

    saveRules(){
      return this.write('rules', this.rules);
    }

    /* ---------- Ejecución ---------- */

    onEvent(ev){
      if(!this.canRun()) return;
      this.load().then(() => this.whenTask(ev.id)).then((task) => {
        if(!task || !this.canRun()) return null;
        this.notePaused();
        return this.engine.handle(ev);
      });
    }

    /* Una tarea recién creada puede tardar un instante en llegar a la lista. */
    whenTask(id){
      return new Promise((resolve) => {
        let tries = 0;
        const look = () => {
          const task = this.tasks.find(id);
          if(task || ++tries > 20) resolve(task || null);
          else setTimeout(look, 50);
        };
        look();
      });
    }

    /* Aplica a una tarea lo que decide una regla. Va por update (no por save/move): así no vuelve
       a avisar de un cambio «hecho por una persona»; el motor encadena lo que haga falta. */
    update(id, patch){
      const before = this.tasks.find(id);
      if(!before) return Promise.resolve();
      const wasDone = TaskModel.isDone(before);
      if(patch.status){
        /* Al final de su columna nueva. */
        const column = this.tasks.inStatus(patch.status).filter((x) => x.id !== id);
        const last = column[column.length - 1];
        patch.order = last ? TaskModel.orderOf(last) + ORDER_STEP : Date.now();
      }
      this.tasks.patchLocal(id, patch);
      return this.tasks.update(id, Object.assign({updatedAt:Date.now()}, patch)).then(() => {
        const now = this.tasks.find(id);
        if(now && !wasDone && TaskModel.isDone(now)) this.tasks.spawnNext(now);
      });
    }

    /* Queda apuntado en la actividad de la tarea qué regla se disparó y qué hizo. */
    log(id, rule, did){
      const text = t('Automatización «{name}»: {what}', {name:rule.name, what:did.join(', ')});
      toast.success(text);
      return this.tasks.addNoteRaw(id, {kind:'activity', text:text, actorUid:'', actorName:'', createdAt:Date.now()}).catch(() => null);
    }

    warn(code){
      const now = Date.now();
      if(now - (this.warnedAt[code] || 0) < 10000) return;
      this.warnedAt[code] = now;
      toast.error(WARNINGS[code], {important:true});
    }

    /* Avisa una vez de cada regla activa que está en pausa. */
    notePaused(){
      this.live().forEach((r) => {
        if(!r.on || !r.broken || this.paused[this.key + r.id]) return;
        this.paused[this.key + r.id] = true;
        toast.error(t('La automatización «{name}» está en pausa: {why}.', {name:r.name, why:r.broken}), {important:true});
      });
    }

    scheduleDue(){
      clearTimeout(this.dueTimer);
      this.dueTimer = setTimeout(() => this.checkDue(), DUE_DELAY_MS);
    }

    checkDue(){
      if(!this.canRun()) return;
      this.load().then(() => {
        if(!this.canRun() || !this.rules.some((r) => r.on && r.trigger.type === 'due')) return null;
        const tasks = this.tasks.items.filter((x) => !x._undecryptable);
        return this.engine.checkDue(tasks, this.fired).then((changed) => {
          if(!changed) return null;
          /* Solo se guardan las marcas de tareas que siguen existiendo. */
          const alive = {};
          this.tasks.items.forEach((x) => { alive[x.id] = true; });
          Object.keys(this.fired).forEach((k) => { if(!alive[k.slice(k.indexOf(':') + 1)]) delete this.fired[k]; });
          return this.write('fired', this.fired).catch(() => null);
        });
      });
    }

    /* ---------- Diálogo ---------- */

    open(){
      if(this.isGuest()){
        this.view.showGuest();
        this.view.show();
        return;
      }
      if(!this.usable()){
        this.view.message(t('Abre un proyecto para ver sus automatizaciones.'));
        this.view.show();
        return;
      }
      this.view.message(t('Cargando…'));
      this.view.show();
      this.load(true).then(() => this.renderList());
    }

    renderList(){
      if(!this.view.isOpen()) return;
      const ctx = this.ctx();
      this.templates = A.templates(ctx);
      this.view.showList({
        rules: this.live().map((r) => ({rule:r, text:A.describe(r, ctx), problem:r.broken})),
        templates: this.templates,
        canManage: this.canManage(),
        team: team().enabled(),
        max: A.MAX_RULES
      });
    }

    edit(id){
      if(!this.canManage()) return;
      const ctx = this.ctx();
      const found = id ? this.rules.find((r) => r.id === id) : null;
      const first = ctx.stages[0] || {};
      this.view.showForm(found || {id:'', name:'', on:true, trigger:{type:'moved', stage:(ctx.stages.find((s) => s.done) || first).key}, cond:{}, actions:[{type:'subtask', text:''}]}, ctx);
    }

    useTemplate(i){
      const item = (this.templates || [])[i];
      if(!item || !this.canManage()) return;
      this.view.showForm(Object.assign({}, item.rule, {id:''}), this.ctx());
    }

    saveRule(draft){
      if(!this.canManage()) return;
      const ctx = this.ctx();
      const existing = draft.id ? this.rules.find((r) => r.id === draft.id) : null;
      const rule = A.normalize(Object.assign({}, draft, {id:existing ? existing.id : '', on:existing ? existing.on : true, broken:''}));
      if(!rule){ this.view.showError(t('Elige al menos una acción y rellena sus datos.')); return; }
      const why = A.problem(rule, ctx);
      if(why){ this.view.showError(t('No se puede guardar: {why}.', {why:why})); return; }
      if(!existing && this.rules.length >= A.MAX_RULES){ this.view.showError(t('Un proyecto admite como mucho {n} automatizaciones.', {n:A.MAX_RULES})); return; }
      if(!rule.name) rule.name = A.title(rule, ctx).slice(0, 80);
      const before = this.rules.slice();
      this.rules = existing ? this.rules.map((r) => (r.id === existing.id ? rule : r)) : this.rules.concat([rule]);
      this.saveRules().then(() => {
        toast.success(existing ? 'Automatización guardada' : 'Automatización creada');
        this.renderList();
        this.scheduleDue();
      }, () => {
        this.rules = before;
        this.view.showError(t('No se pudo guardar la automatización.'));
      });
    }

    toggle(id, on){
      const rule = this.rules.find((r) => r.id === id);
      if(!rule || !this.canManage()){ this.renderList(); return; }
      rule.on = !!on;
      this.saveRules().then(() => { this.renderList(); if(on) this.scheduleDue(); }, () => {
        rule.on = !on;
        toast.error('No se pudo guardar la automatización.');
        this.renderList();
      });
    }

    remove(id){
      if(!this.canManage()) return;
      const before = this.rules.slice();
      if(!before.some((r) => r.id === id)) return;
      this.rules = before.filter((r) => r.id !== id);
      this.saveRules().then(() => {
        this.renderList();
        toast.undoable('Automatización eliminada', () => {
          this.rules = before;
          return this.saveRules().then(() => this.renderList());
        }, 'Automatización restaurada');
      }, () => {
        this.rules = before;
        toast.error('No se pudo eliminar la automatización.');
        this.renderList();
      });
    }
  }

  Workhub.controllers.AutomationsController = AutomationsController;
})();
