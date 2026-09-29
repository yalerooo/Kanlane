/* Sincronización de un proyecto de Workhub con un GitHub Project (v2).
   - Las columnas de Workhub son las opciones del campo Status de GitHub
     (clave de etapa = 'g' + id de la opción).
   - Cada tarea enlazada guarda ghItemId (más ghContentId, ghUrl, ghNumber,
     ghRepo) y dos marcas de tiempo: ghSyncedAt (última vez que Workhub y
     GitHub coincidieron) y ghRemoteAt (última modificación de GitHub vista).
       · cambio local  = updatedAt > ghSyncedAt
       · cambio remoto = fecha en GitHub > ghRemoteAt
     Si cambian los dos lados gana el más reciente.
   - Lo que se borra en un lado no se borra en el otro. Una tarea borrada en
     Workhub se recuerda (github.ignored) para que no vuelva a importarse.
   - La configuración vive en el documento del proyecto (campo github); el
     token, solo en este navegador. */
(function(){
  const api = Workhub.services.github;
  const PT = Workhub.models.ProjectTemplates;
  const TaskModel = Workhub.models.TaskModel;

  const COLORS = {GRAY:'gray', BLUE:'blue', GREEN:'green', ORANGE:'orange', YELLOW:'orange', RED:'red', PINK:'red', PURPLE:'violet'};
  const DONE_RE = /^(done|hecho|complet|closed|cerrad|finished|terminad|resuelt)/i;
  const MAX_IGNORED = 300;
  const BODY_MAX = 5000;

  const keyOf = (optionId) => 'g' + String(optionId).replace(/[^a-z0-9_-]/gi, '');
  const time = (iso) => (iso ? Date.parse(iso) || 0 : 0);

  class GithubSync extends Workhub.Emitter {
    constructor(app){
      super();
      this.app = app;
      this.busy = false;
      this.error = null;
      this.lastResult = null;
      /* Configuración recién guardada que aún no ha llegado en la lista de proyectos. */
      this.pendingCfg = null;
      /* Tareas ya enviadas como nuevas en esta sesión (evita duplicados mientras llega su ghItemId). */
      this.sent = {};
    }

    get tasks(){ return this.app.models.tasks; }
    get projects(){ return this.app.models.projects; }

    /* Configuración del proyecto abierto, o null si no está enlazado. */
    config(){
      const p = this.app.controllers.projects.current();
      if(p && p.github) this.pendingCfg = null;
      return p && p.github ? p.github : this.pendingCfg;
    }

    isLinked(){
      return !!this.config();
    }

    /* Etapas de Workhub a partir de las opciones del campo Status. */
    static stagesFromOptions(options){
      const list = options.map((o) => ({key:keyOf(o.id), label:o.name, color:COLORS[o.color] || 'gray', done:false}));
      if(!list.length) return list;
      list.forEach((s) => { s.done = DONE_RE.test(s.label); });
      if(!list.some((s) => s.done)) list[list.length - 1].done = true;
      return list;
    }

    /* ---------- Conectar y desconectar ---------- */

    /* opts: {url, token, pushExisting}. Enlaza el proyecto abierto. */
    link(opts){
      const ref = api.parseProjectUrl(opts.url);
      if(!ref) return Promise.reject(new api.GithubError('bad-url', 'El enlace tiene que ser de un proyecto, por ejemplo https://github.com/users/tu-usuario/projects/1'));
      if(opts.token) api.setToken(opts.token);
      const pid = this.app.projectId;
      return api.fetchProject(ref).then((proj) => {
        if(pid !== this.app.projectId) throw new api.GithubError('changed', 'Cambiaste de proyecto mientras se conectaba.');
        const stages = GithubSync.stagesFromOptions(proj.options);
        const cfg = {
          type: ref.type, login: ref.login, number: ref.number,
          projectId: proj.id, fieldId: proj.fieldId, fieldName: proj.fieldName,
          title: proj.title, url: proj.url,
          pushNew: true,
          pushFrom: opts.pushExisting ? 0 : Date.now(),
          ignored: []
        };
        /* Las columnas pasan a ser las de GitHub; todo en una sola escritura. */
        const current = this.projects.get(pid) || {};
        const fields = Object.assign(PT.fieldsFor(PT.CUSTOM_TYPE, stages, PT.resolve(current).clients), {github:cfg});
        this.pendingCfg = cfg;
        this.app.applyProjectConfig(PT.resolve(Object.assign({}, current, fields)));
        return this.projects.patch(pid, fields);
      }).then(() => this.sync());
    }

    unlink(){
      this.pendingCfg = null;
      return this.projects.patch(this.app.projectId, {github:null}).then(() => {
        this.error = null;
        this.lastResult = null;
        this.emit('change');
      });
    }

    setPushNew(on){
      const cfg = this.config();
      if(!cfg) return Promise.resolve();
      return this.projects.patch(this.app.projectId, {github:Object.assign({}, cfg, {pushNew:!!on})});
    }

    /* Recuerda una tarea borrada para no volver a importarla. */
    ignore(task){
      const cfg = this.config();
      if(!cfg || !task.ghItemId) return;
      const ignored = (cfg.ignored || []).concat(task.ghItemId).slice(-MAX_IGNORED);
      this.projects.patch(this.app.projectId, {github:Object.assign({}, cfg, {ignored:ignored})}).catch(() => {});
    }

    /* ¿Hay cambios en Workhub pendientes de enviar? */
    hasPending(){
      const cfg = this.config();
      if(!cfg) return false;
      return this.tasks.items.some((t) => t.ghItemId ? this._dirty(t) : this._isNew(t, cfg));
    }

    _dirty(t){
      return (t.updatedAt || 0) > (t.ghSyncedAt || 0);
    }

    _isNew(t, cfg){
      return !!cfg.pushNew && !t.ghItemId && !this.sent[t.id] && (t.createdAt || 0) >= (cfg.pushFrom || 0);
    }

    /* ---------- Sincronizar ---------- */

    sync(){
      const cfg = this.config();
      if(!cfg || this.busy || !this.tasks.isReady()) return Promise.resolve(null);
      const pid = this.app.projectId;
      const gen = this.tasks.generation;
      /* Si se cambia de proyecto a mitad, no se escribe nada más. */
      const alive = () => pid === this.app.projectId && gen === this.tasks.generation;
      this.busy = true;
      this.error = null;
      this.emit('change');
      const result = {created:0, updated:0, sent:0, columns:0, warnings:0};
      let project;
      return api.fetchProject({type:cfg.type, login:cfg.login, number:cfg.number}).then((proj) => {
        project = proj;
        return this._ensureColumns(proj.options, result);
      }).then(() => api.fetchItems(project.id, project.fieldName)).then((items) => {
        if(!alive()) throw new api.GithubError('changed', 'Se cambió de proyecto.');
        return this._pull(items, cfg, result, alive).then(() => this._push(project, items, cfg, result, alive));
      }).then(() => {
        result.at = Date.now();
        this.lastResult = result;
        this.busy = false;
        this.emit('change');
        return result;
      }).catch((err) => {
        this.busy = false;
        if(err && err.code !== 'changed') this.error = err;
        this.emit('change');
        return null;
      });
    }

    /* Opciones nuevas en GitHub → columnas nuevas en Workhub. */
    _ensureColumns(options, result){
      const projects = this.app.controllers.projects;
      const wanted = GithubSync.stagesFromOptions(options);
      return projects.updateStages((cur) => {
        const have = {};
        cur.forEach((s) => { have[s.key] = true; });
        const add = wanted.filter((s) => !have[s.key]);
        if(!add.length) return false;
        add.forEach((s) => { s.done = false; cur.push(s); });
        result.columns = add.length;
      });
    }

    _stageFor(item){
      const stages = TaskModel.STATUS;
      const key = item.status && item.status.optionId ? keyOf(item.status.optionId) : '';
      return stages.some((s) => s.key === key) ? key : stages[0].key;
    }

    _remoteFields(item){
      const c = item.content;
      return {
        title: (c.title || '').slice(0, 200) || 'Sin título',
        desc: (c.body || '').slice(0, BODY_MAX),
        status: this._stageFor(item),
        remoteAt: Math.max(time(item.updatedAt), time(c.updatedAt))
      };
    }

    _linkFields(item){
      const c = item.content;
      return {
        ghItemId: item.id,
        ghContentId: c.id || '',
        ghType: c.__typename,
        ghUrl: c.url || '',
        ghNumber: c.number || 0,
        ghRepo: c.repository ? c.repository.nameWithOwner : ''
      };
    }

    /* GitHub → Workhub. */
    _pull(items, cfg, result, alive){
      const ignored = cfg.ignored || [];
      const byItem = {};
      this.tasks.items.forEach((t) => { if(t.ghItemId) byItem[t.ghItemId] = t; });
      let chain = Promise.resolve();
      items.forEach((item) => {
        if(ignored.indexOf(item.id) !== -1) return;
        chain = chain.then(() => {
          if(!alive()) return null;
          const r = this._remoteFields(item);
          const t = byItem[item.id];
          if(!t){
            result.created++;
            return this.tasks.saveSynced(null, Object.assign({
              title: r.title, desc: r.desc, cliente: '', status: r.status, contacto: '', dueDate: '',
              ghRemoteAt: r.remoteAt
            }, this._linkFields(item)));
          }
          if(r.remoteAt <= (t.ghRemoteAt || 0)) return null;
          const same = t.title === r.title && (t.desc || '') === r.desc && TaskModel.stageKey(t) === r.status;
          if(same) return this.tasks.update(t.id, Object.assign({ghRemoteAt:r.remoteAt}, this._linkFields(item)));
          /* Cambiaron los dos lados: gana el más reciente. */
          if(this._dirty(t) && (t.updatedAt || 0) >= r.remoteAt) return null;
          result.updated++;
          return this.tasks.saveSynced(t.id, Object.assign({
            title: r.title, desc: r.desc, status: r.status, ghRemoteAt: r.remoteAt
          }, this._linkFields(item)));
        });
      });
      return chain;
    }

    /* Workhub → GitHub. */
    _push(project, items, cfg, result, alive){
      const remote = {};
      items.forEach((it) => { remote[it.id] = it; });
      const optionFor = (t) => {
        const key = TaskModel.stageKey(t);
        const o = project.options.find((x) => keyOf(x.id) === key);
        return o ? o.id : '';
      };
      const list = this.tasks.items.filter((t) => t.ghItemId ? (remote[t.ghItemId] && this._dirty(t)) : this._isNew(t, cfg));
      let chain = Promise.resolve();
      list.forEach((t) => {
        chain = chain.then(() => {
          if(!alive()) return null;
          const startedAt = Date.now();
          const optionId = optionFor(t);
          let step;
          if(t.ghItemId){
            const it = remote[t.ghItemId];
            const c = it.content;
            const r = this._remoteFields(it);
            /* El cambio remoto es más reciente: ya se aplicó al bajar. */
            if(r.remoteAt > (t.updatedAt || 0) && r.remoteAt > (t.ghRemoteAt || 0)) return null;
            step = Promise.resolve(it.updatedAt);
            const wantsText = t.title !== r.title || (t.desc || '') !== r.desc;
            if(wantsText && c.__typename === 'DraftIssue') step = api.updateDraft(c.id, t.title, t.desc || '').then((d) => d.updatedAt);
            else if(wantsText && c.__typename === 'Issue') {
              step = api.updateIssue(c.id, t.title, t.desc || '').then((d) => d.updatedAt).catch(() => { result.warnings++; return it.updatedAt; });
            }
            if(optionId && optionId !== (it.status && it.status.optionId)){
              step = step.then(() => api.setStatus(project.id, it.id, project.fieldId, optionId)).then((n) => n.updatedAt);
            }
            return step.then((at) => {
              result.sent++;
              return this.tasks.markSynced(t.id, startedAt, {ghRemoteAt:Math.max(time(at), r.remoteAt)});
            });
          }
          /* Tarea nueva de Workhub → borrador en el proyecto. */
          this.sent[t.id] = true;
          return api.addDraft(project.id, t.title, t.desc || '').then((d) => {
            const done = optionId ? api.setStatus(project.id, d.id, project.fieldId, optionId).then((n) => n.updatedAt) : Promise.resolve(d.updatedAt);
            return done.then((at) => {
              result.sent++;
              return this.tasks.markSynced(t.id, startedAt, {
                ghItemId:d.id, ghContentId:d.contentId || '', ghType:'DraftIssue', ghUrl:'', ghNumber:0, ghRepo:'',
                ghRemoteAt: time(at)
              });
            });
          });
        }).catch((err) => {
          /* Un fallo aislado no corta el resto, salvo que sea de acceso. */
          if(err && (err.code === 'auth' || err.code === 'rate' || err.code === 'network' || err.code === 'scopes')) throw err;
          result.warnings++;
        });
      });
      return chain;
    }
  }

  Workhub.models.GithubSync = GithubSync;
})();
