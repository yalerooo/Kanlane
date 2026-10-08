/* Sincronización de un proyecto de Kanlane con un GitHub Project (v2).
   - Las columnas de Kanlane son las opciones del campo Status de GitHub
     (clave de etapa = 'g' + id de la opción).
   - Cada tarea enlazada guarda ghItemId (más ghContentId, ghUrl, ghNumber,
     ghRepo) y dos marcas de tiempo: ghSyncedAt (última vez que Kanlane y
     GitHub coincidieron) y ghRemoteAt (última modificación de GitHub vista).
       · cambio local  = updatedAt > ghSyncedAt
       · cambio remoto = fecha en GitHub > ghRemoteAt
     Si cambian los dos lados gana el más reciente.
   - Lo que se borra en un lado no se borra en el otro. Una tarea borrada en
     Kanlane se recuerda (github.ignored) para que no vuelva a importarse.
   - La configuración vive en el documento del proyecto (campo github); el
     token, solo en este navegador. */
(function(){
  const api = Workhub.services.github;
  const PT = Workhub.models.ProjectTemplates;
  const TaskModel = Workhub.models.TaskModel;

  const COLORS = {GRAY:'gray', BLUE:'blue', GREEN:'green', ORANGE:'orange', YELLOW:'orange', RED:'red', PINK:'red', PURPLE:'violet'};
  const DONE_RE = /^(done|hecho|complet|closed|cerrad|finished|terminad|resuelt)/i;
  const MAX_IGNORED = 300;
  const NEW = '__new__';
  const BODY_MAX = 5000;

  const sameNames = (a, b) => {
    const x = (a || []).map((n) => n.toLowerCase()).sort().join('\n');
    const y = (b || []).map((n) => n.toLowerCase()).sort().join('\n');
    return x === y;
  };
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
      /* Etiquetas de cada repositorio visto en la última sincronización: {repo: [{id, name, color}]} */
      this.repoLabels = {};
      /* Tareas ya enviadas como nuevas en esta sesión (evita duplicados mientras llega su ghItemId). */
      this.sent = {};
    }

    get tasks(){ return this.app.models.tasks; }
    get projects(){ return this.app.models.projects; }

    /* Un proyecto con cifrado total no se sincroniza: GitHub tendría que recibir las tareas sin cifrar.
       p puede ser el proyecto recordado en el navegador (enc:true) mientras llega la lista. */
    static isEncrypted(p){
      return !!p && (p.enc === true || Workhub.models.ProjectModel.isEncrypted(p));
    }

    encrypted(){
      return GithubSync.isEncrypted(this.app.controllers.projects.current());
    }

    encryptedError(){
      return new api.GithubError('encrypted', Workhub.t('Los proyectos con cifrado total no se pueden sincronizar con GitHub.'));
    }

    /* Configuración del proyecto abierto, o null si no está enlazado (o si tiene cifrado total:
       así se apagan solos el temporizador, el envío de cambios y la acción de Ctrl K). */
    config(){
      const p = this.app.controllers.projects.current();
      if(GithubSync.isEncrypted(p)) return null;
      if(p && p.github) this.pendingCfg = null;
      return p && p.github ? p.github : this.pendingCfg;
    }

    isLinked(){
      return !!this.config();
    }

    /* En un equipo, los lectores no escriben (ni en Kanlane ni en GitHub). */
    canSync(){
      const p = this.app.controllers.projects.current();
      return !(p && p.team && p.role === 'viewer');
    }

    /* Crear cosas al cruzar (elemento nuevo de GitHub → tarea, tarea nueva → borrador)
       no se puede repetir sin duplicar. En un equipo, donde varios sincronizan a la
       vez, lo hace solo el propietario; el resto sincroniza lo que ya existe. */
    canCreate(){
      const p = this.app.controllers.projects.current();
      return !(p && p.team && p.role !== 'owner');
    }

    /* Etapas de Kanlane a partir de las opciones del campo Status. */
    static stagesFromOptions(options){
      const list = options.map((o) => ({key:keyOf(o.id), label:o.name, color:COLORS[o.color] || 'gray', done:false}));
      if(!list.length) return list;
      list.forEach((s) => { s.done = DONE_RE.test(s.label); });
      if(!list.some((s) => s.done)) list[list.length - 1].done = true;
      return list;
    }

    /* ---------- Conectar y desconectar ---------- */

    /* opts: {url, token, pushExisting, target, name}.
       target: id del proyecto de Kanlane donde inyectarlo, o NEW para crear uno
       nuevo (con opts.name, o el título del proyecto de GitHub). */
    link(opts){
      const ref = api.parseProjectUrl(opts.url);
      if(!ref) return Promise.reject(new api.GithubError('bad-url', 'El enlace tiene que ser de un proyecto, por ejemplo https://github.com/users/tu-usuario/projects/1'));
      const opened = this.app.projectId;
      const target = opts.target && opts.target !== NEW ? opts.target : (opts.target === NEW ? NEW : opened);
      /* Antes de llamar a GitHub: el destino no puede tener cifrado total. */
      if(target !== NEW && GithubSync.isEncrypted(target === opened ? this.app.controllers.projects.current() : this.projects.get(target))){
        return Promise.reject(this.encryptedError());
      }
      if(opts.token) api.setToken(opts.token);
      return api.fetchProject(ref).then((proj) => {
        if(opened !== this.app.projectId) throw new api.GithubError('changed', 'Cambiaste de proyecto mientras se conectaba.');
        const stages = GithubSync.stagesFromOptions(proj.options);
        const cfg = {
          type: ref.type, login: ref.login, number: ref.number,
          projectId: proj.id, fieldId: proj.fieldId, fieldName: proj.fieldName,
          title: proj.title, url: proj.url,
          pushNew: true,
          pushFrom: opts.pushExisting ? 0 : Date.now(),
          ignored: []
        };
        /* Proyecto nuevo con lo que hay en GitHub (sin clientes). */
        if(target === NEW){
          const fields = Object.assign(PT.fieldsFor(PT.CUSTOM_TYPE, stages, false), {github:cfg});
          const nombre = (opts.name || '').trim().slice(0, 60) || String(proj.title).slice(0, 60);
          return this.app.controllers.projects.createAndOpen(nombre, null, fields).then(() => false);
        }
        /* Proyecto existente: sus columnas pasan a ser las de GitHub; todo en una sola escritura. */
        const current = this.projects.get(target) || {};
        const fields = Object.assign(PT.fieldsFor(PT.CUSTOM_TYPE, stages, PT.resolve(current).clients), {github:cfg});
        if(target === opened){
          this.pendingCfg = cfg;
          this.app.applyProjectConfig(PT.resolve(Object.assign({}, current, fields)));
          return this.projects.patch(target, fields).then(() => true);
        }
        return this.projects.patch(target, fields).then(() => {
          this.app.switchProject(target);
          return false;
        });
      }).then((here) => (here ? this.sync() : null));
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

    /* ¿Hay cambios en Kanlane pendientes de enviar? */
    hasPending(){
      const cfg = this.config();
      if(!cfg) return false;
      return this.tasks.items.some((t) => t.ghItemId ? this._dirty(t) : this._isNew(t, cfg));
    }

    _dirty(t){
      return (t.updatedAt || 0) > (t.ghSyncedAt || 0);
    }

    _isNew(t, cfg){
      return !!cfg.pushNew && this.canCreate() && !t.ghItemId && !this.sent[t.id] && (t.createdAt || 0) >= (cfg.pushFrom || 0);
    }

    /* ---------- Sincronizar ---------- */

    sync(){
      /* Doble protección por si algo llama directamente. */
      if(this.encrypted()){
        this.error = this.encryptedError();
        return Promise.resolve(null);
      }
      const cfg = this.config();
      if(!cfg || this.busy || !this.tasks.isReady() || !this.canSync()) return Promise.resolve(null);
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
        return this._loadRepoLabels(items, alive)
          .then(() => this._pull(items, cfg, result, alive))
          .then(() => this._push(project, items, cfg, result, alive));
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

    /* Opciones nuevas en GitHub → columnas nuevas en Kanlane. */
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

    /* Etiquetas de los repositorios de los elementos; se suman al catálogo del proyecto. */
    _loadRepoLabels(items, alive){
      const repos = {};
      items.forEach((it) => {
        const c = it.content;
        if(c.repository && c.labels) repos[c.repository.nameWithOwner] = true;
      });
      this.repoLabels = {};
      let chain = Promise.resolve();
      Object.keys(repos).forEach((repo) => {
        chain = chain.then(() => api.fetchRepoLabels(repo).then((list) => { this.repoLabels[repo] = list; }, () => null));
      });
      return chain.then(() => {
        if(!alive()) return null;
        /* Catálogo = lo que ya había + etiquetas de los repositorios (con su color de GitHub). */
        const current = this.app.controllers.projects.current() || {};
        const catalog = (Array.isArray(current.labels) ? current.labels : []).map((l) => ({name:l.name, color:l.color}));
        const seen = {};
        catalog.forEach((l) => { seen[l.name.toLowerCase()] = l; });
        Object.keys(this.repoLabels).forEach((repo) => {
          this.repoLabels[repo].forEach((l) => {
            const known = seen[l.name.toLowerCase()];
            if(known) known.color = l.color;
            else { const n = {name:l.name, color:l.color}; catalog.push(n); seen[l.name.toLowerCase()] = n; }
          });
        });
        if(JSON.stringify(catalog) === JSON.stringify(current.labels || [])) return null;
        return this.projects.patch(this.app.projectId, {labels:catalog.slice(0, 1000)}).catch(() => null);
      });
    }

    _stageFor(item){
      const stages = TaskModel.STATUS;
      const key = item.status && item.status.optionId ? keyOf(item.status.optionId) : '';
      return stages.some((s) => s.key === key) ? key : stages[0].key;
    }

    _remoteFields(item){
      const c = item.content;
      const nodes = c.labels && c.labels.nodes;
      const prs = c.closedByPullRequestsReferences && c.closedByPullRequestsReferences.nodes;
      return {
        /* Solo incidencias y pull requests tienen etiquetas; los borradores no (null). */
        labels: nodes ? nodes.map((l) => l.name) : null,
        prs: prs ? prs.map((p) => ({n:p.number, url:p.url, state:p.state, title:String(p.title || '').slice(0, 120)})) : null,
        title: (c.title || '').slice(0, 200) || 'Sin título',
        desc: (c.body || '').slice(0, BODY_MAX),
        status: this._stageFor(item),
        remoteAt: Math.max(time(item.updatedAt), time(c.updatedAt))
      };
    }

    /* Etiquetas y pull requests que vienen de GitHub. */
    _extraFields(r){
      const out = {};
      if(r.labels){ out.labels = r.labels.slice(0, 30); out.ghLabels = true; }
      if(r.prs) out.ghPrs = r.prs;
      return out;
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

    /* GitHub → Kanlane. */
    _pull(items, cfg, result, alive){
      const ignored = cfg.ignored || [];
      const byItem = {};
      /* También las archivadas: siguen enlazadas y no hay que importarlas otra vez. */
      this.tasks.everything().forEach((t) => { if(t.ghItemId) byItem[t.ghItemId] = t; });
      let chain = Promise.resolve();
      items.forEach((item) => {
        if(ignored.indexOf(item.id) !== -1) return;
        chain = chain.then(() => {
          if(!alive()) return null;
          const r = this._remoteFields(item);
          const t = byItem[item.id];
          if(!t){
            if(!this.canCreate()) return null;
            result.created++;
            return this.tasks.saveSynced(null, Object.assign({
              title: r.title, desc: r.desc, cliente: '', status: r.status, contacto: '', dueDate: '',
              ghRemoteAt: r.remoteAt
            }, this._extraFields(r), this._linkFields(item)));
          }
          /* Archivada: se queda como está hasta que se restaure. */
          if(TaskModel.isArchived(t)) return null;
          /* Tareas enlazadas antes de existir las etiquetas: se rellenan sin contar como cambio. */
          if(r.labels && !t.ghLabels && !this._dirty(t)) this.tasks.update(t.id, this._extraFields(r));
          if(r.remoteAt <= (t.ghRemoteAt || 0)) return null;
          const same = t.title === r.title && (t.desc || '') === r.desc && TaskModel.stageKey(t) === r.status &&
            (!r.labels || !t.ghLabels || sameNames(t.labels, r.labels));
          if(same) return this.tasks.update(t.id, Object.assign({ghRemoteAt:r.remoteAt}, this._extraFields(r), this._linkFields(item)));
          /* Cambiaron los dos lados: gana el más reciente. */
          if(this._dirty(t) && (t.updatedAt || 0) >= r.remoteAt) return null;
          result.updated++;
          return this.tasks.saveSynced(t.id, Object.assign({
            title: r.title, desc: r.desc, status: r.status, ghRemoteAt: r.remoteAt
          }, this._extraFields(r), this._linkFields(item)));
        });
      });
      return chain;
    }

    /* Etiquetas de una incidencia o pull request: añade y quita lo que difiere.
       Solo se tocan las que ya existen en el repositorio. Devuelve la fecha nueva o null. */
    _pushLabels(t, c, result){
      if(!t.ghLabels || !Array.isArray(t.labels) || !c.labels || !c.repository) return Promise.resolve(null);
      const remote = c.labels.nodes.map((l) => l.name);
      const low = (a) => a.map((x) => x.toLowerCase());
      const add = t.labels.filter((n) => low(remote).indexOf(n.toLowerCase()) === -1);
      const rem = remote.filter((n) => low(t.labels).indexOf(n.toLowerCase()) === -1);
      if(!add.length && !rem.length) return Promise.resolve(null);
      const repo = this.repoLabels[c.repository.nameWithOwner] || [];
      const ids = (names) => names.map((n) => repo.find((l) => l.name.toLowerCase() === n.toLowerCase())).filter(Boolean).map((l) => l.id);
      const addIds = ids(add);
      const remIds = ids(rem);
      result.warnings += (add.length - addIds.length);
      let at = null;
      let chain = Promise.resolve();
      if(addIds.length) chain = chain.then(() => api.addLabels(c.id, addIds)).then((x) => { at = x.updatedAt; });
      if(remIds.length) chain = chain.then(() => api.removeLabels(c.id, remIds)).then((x) => { at = x.updatedAt; });
      return chain.then(() => at);
    }

    /* Kanlane → GitHub. */
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
            step = step.then((at) => this._pushLabels(t, c, result).then((labelAt) => labelAt || at));
            return step.then((at) => {
              result.sent++;
              return this.tasks.markSynced(t.id, startedAt, {ghRemoteAt:Math.max(time(at), r.remoteAt)});
            });
          }
          /* Tarea nueva de Kanlane → borrador en el proyecto. */
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

  GithubSync.NEW = NEW;
  Workhub.models.GithubSync = GithubSync;
})();
