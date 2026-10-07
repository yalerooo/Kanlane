/* Automatizaciones del proyecto abierto: guarda las reglas con el proyecto, escucha lo que la
   persona hace con las tareas (crear, mover, pulsar un botón) y ejecuta lo que toque con el motor
   de models/automation-model.js.
   - Dónde se guardan: en plugin_data del proyecto, así que viajan con él (equipos, copia al
     convertir, borrado) y en un proyecto con cifrado total van selladas. Las reglas van en
     kanlane.automations (en un equipo solo las escribe quien es propietario: firestore.rules) y
     las marcas de las reglas por fecha, en kanlane.automations.state (las escribe quien edita).
   - Quién las ejecuta: el navegador de quien hace el cambio, una sola vez. Lo que llega de otro
     dispositivo no vuelve a dispararlas.
   - Reglas por fecha: las ejecuta el servidor aunque nadie tenga Kanlane abierto
     (worker/automations.mjs). Para eso, quien es dueño del proyecto deja en automation_jobs una
     copia de las reglas que el servidor puede ejecutar. Un proyecto cifrado no la deja: el
     servidor no puede leerlo, y ahí las reglas por fecha solo se miran con Kanlane abierto. El
     navegador también las mira (al abrir, al cambiar las tareas y cada diez minutos); las marcas
     compartidas evitan que se ejecuten dos veces.
   - Quién las cambia: en un equipo, solo quien es propietario. Como invitado no hay automatizaciones. */
(function(){
  const A = Workhub.models.Automations;
  const {PluginModel, ProjectModel, TaskModel} = Workhub.models;
  const {ymd, daysFromToday} = Workhub.utils.dates;
  const toast = Workhub.views.toast;
  const team = () => Workhub.views.team;
  const t = (text, params) => Workhub.t(text, params);

  const RULES = 'kanlane.automations';
  const STATE = 'kanlane.automations.state';
  const FRESH_MS = 60000;
  const DUE_EVERY_MS = 10 * 60000;
  const DUE_DELAY_MS = 3000;
  const ORDER_STEP = 1024;
  const WARNINGS = {
    loop: 'Se cortó una cadena de automatizaciones que se repetía: una volvía a dispararse. Revisa tus automatizaciones.',
    depth: 'Se cortó una cadena de automatizaciones demasiado larga (más de tres seguidas). Revisa tus automatizaciones.',
    rate: 'Demasiadas automatizaciones a la vez: las que faltaban se han saltado. Vuelve a intentarlo en un minuto.'
  };

  const CAPTURE_ERRORS = {
    owner: 'Solo quien es propietario puede cambiar las tareas por correo.',
    project: 'Este proyecto ya no existe o no tienes acceso.',
    encrypted: 'Un proyecto con cifrado total no admite tareas por correo.',
    email: 'Tu cuenta no tiene un correo comprobado: verifícalo antes de activar las tareas por correo.',
    stage: 'Esa columna ya no existe. Elige otra.',
    allow: 'Revisa la lista de remitentes: como mucho 20 direcciones de correo válidas, una por línea.',
    off: 'Las tareas por correo están desactivadas.',
    rate: 'Demasiadas peticiones seguidas. Espera un minuto.',
    network: 'No hay conexión con el servidor. Inténtalo de nuevo.',
    auth: 'Tu sesión ha caducado. Vuelve a entrar.'
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
      this.capture = null;
      this.engine = new A.Engine({
        rules: () => this.rules,
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
        'cap-enable': () => this.captureDo({op:'enable'}, 'Dirección de correo activada.'),
        'cap-copy': () => this.captureCopy(),
        'cap-regen': () => this.captureRegenerate(),
        'cap-off': () => this.captureDisable(),
        'cap-save': (v) => this.captureDo({op:'configure', stage:v.stage, allow:v.allow}, 'Cambios guardados.'),
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

    /* Columnas, etiquetas y personas del proyecto, como las pide Automations. `raw` es el nombre
       de la columna tal como está guardado (el que va a la actividad de la tarea). */
    ctx(){
      const T = team();
      return {
        stages: TaskModel.STATUS.map((s) => ({key:s.key, label:s.label, raw:s.raw || s.label, done:s.done})),
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

    /* Aviso para el diálogo que va a borrar una columna, una etiqueta o quitar a una persona del
       proyecto ABIERTO: qué automatizaciones la usan y qué les pasará. '' si ninguna (o si no se
       pueden leer). gone: {stage:clave} | {label:nombre} | {member:uid}; también una lista. */
    warningFor(gone){
      if(!this.usable()) return Promise.resolve('');
      const list = Array.isArray(gone) ? gone : [gone];
      return this.load().then(() => {
        const hit = this.rules.filter((r) => list.some((g) => A.uses(r, g)));
        if(!hit.length) return '';
        const names = hit.map((r) => '«' + r.name + '»').join(', ');
        return hit.length === 1
          ? t('La automatización {names} dejará de poder ejecutarse: quedará en pausa hasta que alguien con permiso la edite.', {names:names})
          : t('{n} automatizaciones dejarán de poder ejecutarse y quedarán en pausa hasta que alguien con permiso las edite: {names}.', {n:hit.length, names:names});
      }, () => '');
    }

    /* ---------- Guardado ---------- */

    bucket(name){
      return PluginModel.projectBucket(ProjectModel.scope(this.app.rootDb, this.app.projectId), name, this.app.cipher);
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
      const object = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      const reading = this.loading = Promise.all([this.bucket(RULES).read(), this.bucket(STATE).read().catch(() => ({}))]).then((got) => {
        if(this.key !== key || this.loading !== reading) return;
        this.rules = A.normalizeAll(parse(got[0], 'rules', []));
        /* Antes las marcas iban junto a las reglas: si aún no hay otras, valen esas. */
        const state = object(parse(got[1], 'fired', null)), old = object(parse(got[0], 'fired', null));
        this.fired = Object.keys(state).length ? state : old;
        this.afterLoad();
      }, () => { if(this.key === key){ this.rules = []; this.fired = {}; } });
      return reading;
    }

    /* Con las reglas recién leídas: nombres al día, copia para el servidor y botones de la ficha. */
    afterLoad(){
      if(this.canManage()){
        /* Los nombres de columnas y personas se apuntan con la regla (por si luego se borran). */
        const ctx = this.ctx();
        const named = this.rules.map((r) => A.withNames(r, ctx));
        if(JSON.stringify(named) !== JSON.stringify(this.rules)){
          this.rules = named;
          this.saveRules().catch(() => null);
        }
        this.syncJob();
      }
      if(this.app.controllers.tasks) this.app.controllers.tasks.refreshDetail();
    }

    /* Escrituras de una en una y solo si el proyecto sigue siendo el mismo. */
    write(bucket, name, value){
      const key = this.key;
      const run = this.writes.then(() => {
        if(key !== this.projectKey()) return null;
        return PluginModel.storageSet(this.bucket(bucket), name, value);
      });
      this.writes = run.catch(() => null);
      return run;
    }

    saveRules(){
      return this.write(RULES, 'rules', this.rules);
    }

    /* ---------- Copia para el servidor (reglas por fecha con Kanlane cerrado) ---------- */

    /* Documento automation_jobs/{id} de este proyecto, o null si aquí no hay servidor que valga
       (modo local) o no soy quien puede dejarlo. */
    jobRef(){
      const db = this.app.rootDb;
      if(!db || !db.me || !db.jobs) return null;
      const pid = this.app.projectId;
      const isTeam = ProjectModel.isTeam(pid);
      const id = isTeam ? 't~' + ProjectModel.teamId(pid) : 'u~' + db.me.uid + '~' + pid;
      return {ref:db.jobs.doc(id), base:isTeam ? {kind:'t', uid:db.me.uid, tid:ProjectModel.teamId(pid)} : {kind:'u', uid:db.me.uid, pid:pid}};
    }

    /* Lo que el servidor necesita para ejecutar las reglas por fecha: esas reglas, las que pueden
       encadenarse detrás (mover, completar) y el nombre de columnas, etiquetas y personas. Nada
       si el proyecto está cifrado (el servidor no puede leerlo) o no hay reglas por fecha activas. */
    jobData(){
      if(this.app.cipher) return null;
      const ctx = this.ctx();
      const active = this.rules.filter((r) => r.on && !A.problem(r, ctx));
      if(!active.some((r) => r.trigger.type === 'due')) return null;
      let tz = '';
      try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){ tz = ''; }
      return {
        v: 1,
        tz: tz,
        rules: active.filter((r) => ['due', 'moved', 'completed'].indexOf(r.trigger.type) !== -1),
        ctx: {stages:ctx.stages.map((s) => ({key:s.key, label:s.raw, done:!!s.done})), labels:ctx.labels, members:ctx.members, team:ctx.team}
      };
    }

    syncJob(){
      const job = this.canManage() ? this.jobRef() : null;
      if(!job) return Promise.resolve();
      const data = this.jobData();
      const sig = JSON.stringify(data);
      return job.ref.get().then((snap) => {
        const have = snap.exists ? snap.data() || {} : null;
        if(!data) return have ? job.ref.delete() : null;
        if(have && JSON.stringify({v:have.v, tz:have.tz, rules:have.rules, ctx:have.ctx}) === sig) return null;
        return job.ref.set(Object.assign({}, job.base, data, {updatedAt:Date.now()}));
      }).catch(() => null);
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

    /* Queda apuntado en la actividad de la tarea qué regla se disparó y qué hizo. La línea se
       guarda en español; la pantalla la traduce al enseñarla. */
    log(id, rule, did){
      const text = A.logText(rule, did);
      toast.success(t(text));
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
        toast.error(t('La automatización «{name}» está en pausa y no se ejecuta: {why}.', {name:r.name, why:r.broken}), {important:true});
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
          /* El servidor (u otro navegador) pudo apuntar marcas mientras tanto: se suman a las de
             aquí antes de guardar, para no borrárselas. Las de aquí mandan en lo que acaba de pasar. */
          const key = this.key;
          return this.bucket(STATE).read().catch(() => ({})).then((got) => {
            if(key !== this.key) return null;
            let theirs = {};
            try{ theirs = JSON.parse(got.fired) || {}; }catch(e){ theirs = {}; }
            if(theirs && typeof theirs === 'object' && !Array.isArray(theirs)) this.fired = Object.assign({}, theirs, this.fired);
            /* Solo se guardan las marcas de tareas que siguen existiendo. */
            const alive = {};
            this.tasks.items.forEach((x) => { alive[x.id] = true; });
            Object.keys(this.fired).forEach((k) => { if(!alive[k.slice(k.indexOf(':') + 1)]) delete this.fired[k]; });
            return this.write(STATE, 'fired', this.fired).catch(() => null);
          });
        });
      });
    }

    /* ---------- Botones de tarea ---------- */

    /* Los botones que se enseñan en la ficha de una tarea: [{id, name}]. */
    buttons(){
      if(!this.canRun()) return [];
      if(this.key !== this.projectKey()){ this.load(); return []; }
      return this.live().filter((r) => r.on && !r.broken && r.trigger.type === 'button').map((r) => ({id:r.id, name:r.name}));
    }

    press(ruleId, taskId){
      if(!this.canRun() || !this.tasks.find(taskId)) return Promise.resolve();
      return this.load().then(() => this.engine.press(ruleId, taskId));
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
      this.load(true).then(() => { this.renderList(); this.loadCapture(); });
    }

    /* ---------- Tareas por correo (docs/CAPTURA-EMAIL.md) ---------- */

    /* Lo que se enseña en el apartado de correo del proyecto abierto. Todo lo decide el servidor
       (worker/capture.mjs): aquí solo se pregunta y se pinta. */
    captureState(){
      const cap = Workhub.services.capture;
      if(!cap || !cap.available(this.app.rootDb) || !this.usable()) return {state:'hidden'};
      /* Con cifrado total no hay captura: el servidor no puede guardar la tarea cifrada. */
      if(this.app.cipher) return {state:'encrypted'};
      const c = this.capture;
      if(!c || c.key !== this.projectKey()) return {state:'loading'};
      if(c.error) return {state:c.error === 'not-configured' ? 'hidden' : 'error'};
      const d = c.data;
      if(d.available === false) return {state:d.reason === 'encrypted' ? 'encrypted' : 'hidden'};
      const me = this.app.rootDb.me || {};
      return {state:d.on ? 'on' : 'off', role:d.role, team:team().enabled(), address:d.address, alt:d.alt, stage:d.stage, stageMissing:d.stageMissing, allow:d.allow,
        limits:d.limits, busy:!!c.busy, me:me.email || '', stages:this.ctx().stages.map((s) => ({key:s.key, label:s.label}))};
    }

    captureTarget(){
      return Workhub.services.capture.target(this.app.projectId);
    }

    loadCapture(){
      const cap = Workhub.services.capture;
      if(!cap || !cap.available(this.app.rootDb) || !this.usable() || this.app.cipher) return Promise.resolve();
      const key = this.projectKey();
      return cap.call(this.app.rootDb, Object.assign({op:'status'}, this.captureTarget())).then(
        (data) => { if(key === this.projectKey()) this.capture = {key:key, data:data}; },
        (err) => { if(key === this.projectKey()) this.capture = {key:key, error:(err && err.code) || 'unavailable'}; }
      ).then(() => { if(this.view.isOpen() && !this.view.draft) this.renderList(); });
    }

    /* Una orden al servidor (activar, configurar, regenerar, desactivar) y lo que responde, a la pantalla. */
    captureDo(body, done){
      const cap = Workhub.services.capture;
      if(!this.capture || this.capture.busy || this.capture.key !== this.projectKey()) return Promise.resolve();
      const key = this.capture.key;
      this.capture.busy = true;
      this.renderList();
      return cap.call(this.app.rootDb, Object.assign({}, body, this.captureTarget())).then((data) => {
        if(key !== this.projectKey()) return;
        this.capture = {key:key, data:data};
        this.renderList();
        this.view.captureNote(t(done), false);
      }, (err) => {
        if(key !== this.projectKey()) return;
        this.capture.busy = false;
        this.renderList();
        this.view.captureNote(t(CAPTURE_ERRORS[err && err.code] || 'No se pudo completar. Inténtalo de nuevo.'), true);
      });
    }

    captureCopy(){
      const address = this.capture && this.capture.data && this.capture.data.address;
      if(!address) return;
      const done = () => this.view.captureNote(t('Dirección copiada.'), false);
      const fallback = () => { const el = document.getElementById('capAddress'); if(el){ el.focus(); el.select(); } this.view.captureNote(t('Selecciónala y cópiala con el teclado.'), false); };
      if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(address).then(done, fallback);
      else fallback();
    }

    captureRegenerate(){
      this.app.controllers.tasks.columns.confirm('Regenerar la dirección',
        'Se creará una dirección nueva y la actual dejará de funcionar al momento: quien siga escribiendo a la anterior recibirá un rechazo.', 'Regenerar')
        .then((ok) => { if(ok) this.captureDo({op:'regenerate'}, 'Dirección nueva creada. La anterior ya no funciona.'); });
    }

    captureDisable(){
      this.app.controllers.tasks.columns.confirm('Desactivar las tareas por correo',
        'La dirección dejará de funcionar al momento y no se podrá recuperar: si vuelves a activarlas, será otra distinta. Las tareas ya creadas no cambian.', 'Desactivar')
        .then((ok) => { if(ok) this.captureDo({op:'disable'}, 'Tareas por correo desactivadas.'); });
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
        /* Con cifrado total el servidor no puede leer el proyecto: las reglas por fecha esperan a que se abra. */
        server: !this.app.cipher && !!(this.app.rootDb && this.app.rootDb.jobs),
        max: A.MAX_RULES,
        capture: this.captureState()
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

    /* Tras cambiar las reglas: lista, botones de la ficha, copia del servidor y reglas por fecha. */
    changed(){
      this.renderList();
      this.syncJob();
      this.scheduleDue();
      if(this.app.controllers.tasks) this.app.controllers.tasks.refreshDetail();
    }

    saveRule(draft){
      if(!this.canManage()) return;
      const ctx = this.ctx();
      const existing = draft.id ? this.rules.find((r) => r.id === draft.id) : null;
      if(draft.trigger && draft.trigger.type === 'button' && !String(draft.name || '').trim()){
        this.view.showError(t('Ponle un nombre al botón: es lo que se lee en la tarea.'));
        return;
      }
      let rule = A.normalize(Object.assign({}, draft, {id:existing ? existing.id : '', on:existing ? existing.on : true}));
      if(!rule){ this.view.showError(t('Elige al menos una acción y rellena sus datos.')); return; }
      const why = A.problem(rule, ctx);
      if(why){ this.view.showError(t('No se puede guardar: {why}.', {why:why})); return; }
      if(!existing && this.rules.length >= A.MAX_RULES){ this.view.showError(t('Un proyecto admite como mucho {n} automatizaciones.', {n:A.MAX_RULES})); return; }
      rule = A.withNames(rule, ctx);
      if(!rule.name) rule.name = A.title(rule, ctx).slice(0, 80);
      const before = this.rules.slice();
      this.rules = existing ? this.rules.map((r) => (r.id === existing.id ? rule : r)) : this.rules.concat([rule]);
      this.saveRules().then(() => {
        toast.success(existing ? 'Automatización guardada' : 'Automatización creada');
        this.changed();
      }, () => {
        this.rules = before;
        this.view.showError(t('No se pudo guardar la automatización.'));
      });
    }

    toggle(id, on){
      const rule = this.rules.find((r) => r.id === id);
      if(!rule || !this.canManage()){ this.renderList(); return; }
      rule.on = !!on;
      this.saveRules().then(() => this.changed(), () => {
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
        this.changed();
        toast.undoable('Automatización eliminada', () => {
          this.rules = before;
          return this.saveRules().then(() => this.changed());
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
