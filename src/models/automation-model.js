/* Automatizaciones de un proyecto: reglas «cuando pasa algo en una tarea, haz esto».
   Una regla: {id, name, on, trigger:{type, stage, stageName, days}, cond:{label, assignee, assigneeName},
   actions:[{type, …}]}.
   - Disparadores: 'created' (tarea creada, opcionalmente en una columna), 'moved' (movida a una
     columna), 'completed' (pasa a una etapa final), 'due' (faltan N días o menos para su fecha) y
     'button' (alguien pulsa el botón de la regla en la ficha de una tarea).
   - Condición opcional: que lleve una etiqueta y/o quién la tiene asignada ('none' = nadie).
   - Acciones: 'move', 'complete', 'assign', 'label', 'subtask' y 'due' (fecha a N días de hoy).
   - Junto a cada columna y cada persona se guarda su nombre (stageName, assigneeName, memberName):
     si después se borra, los avisos la pueden nombrar.
   Aquí no hay DOM ni base de datos: son funciones puras y un motor (Engine) al que se le dice cómo
   leer y escribir tareas. Lo usan igual el navegador (controllers/automations-controller.js) y el
   servidor (worker/automations.mjs), y se prueba sin ninguno de los dos (tests/automations). */
(function(){
  const TRIGGERS = ['created', 'moved', 'completed', 'due', 'button'];
  const ACTIONS = ['move', 'complete', 'assign', 'label', 'subtask', 'due'];
  const MAX_RULES = 30;
  const MAX_ACTIONS = 6;
  /* Una regla puede disparar otra (mover → otra regla): como mucho estos saltos seguidos. */
  const MAX_DEPTH = 3;
  /* Ejecuciones por minuto y proyecto (una importación o un arrastre masivo no desbocan nada). */
  const MAX_PER_MINUTE = 60;
  const MAX_CHECKLIST = 200;

  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const days = (v, max) => Math.max(0, Math.min(max, Math.round(+v) || 0));
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  /* es(): la frase en español, tal cual. Es lo que se guarda en la actividad de la tarea (la
     pantalla lo traduce al enseñarlo). t(): la frase en el idioma de la interfaz. */
  const es = (text, params) => text.replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? params[k] : ''));
  const t = (text, params) => (typeof Workhub.t === 'function' ? Workhub.t(text, params) : es(text, params));

  function newId(){
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* Deja una regla guardada (o escrita en el formulario) en su forma válida; null si no sirve. */
  function normalize(raw){
    if(!raw || typeof raw !== 'object') return null;
    const tr = raw.trigger || {};
    if(TRIGGERS.indexOf(tr.type) === -1) return null;
    const named = (o, key, value, max) => { if(str(value, max)) o[key] = str(value, max); return o; };
    const trigger = {type:tr.type};
    if(tr.type === 'moved' || tr.type === 'created'){
      trigger.stage = str(tr.stage, 80);
      if(trigger.stage) named(trigger, 'stageName', tr.stageName, 80);
    }
    if(tr.type === 'moved' && !trigger.stage) return null;
    if(tr.type === 'due') trigger.days = days(tr.days, 365);
    const cond = {label:str(raw.cond && raw.cond.label, 60), assignee:str(raw.cond && raw.cond.assignee, 128)};
    if(cond.assignee && cond.assignee !== 'none') named(cond, 'assigneeName', raw.cond.assigneeName, 80);
    const actions = (Array.isArray(raw.actions) ? raw.actions : []).map((a) => {
      if(!a || ACTIONS.indexOf(a.type) === -1) return null;
      if(a.type === 'move') return str(a.stage, 80) ? named({type:'move', stage:str(a.stage, 80)}, 'stageName', a.stageName, 80) : null;
      if(a.type === 'assign') return str(a.uid, 128) ? named({type:'assign', uid:str(a.uid, 128)}, 'memberName', a.memberName, 80) : null;
      if(a.type === 'label') return str(a.name, 60) ? {type:'label', name:str(a.name, 60)} : null;
      if(a.type === 'subtask') return str(a.text, 120) ? {type:'subtask', text:str(a.text, 120)} : null;
      if(a.type === 'due') return {type:'due', days:days(a.days, 365)};
      return {type:'complete'};
    }).filter(Boolean).slice(0, MAX_ACTIONS);
    if(!actions.length) return null;
    const name = str(raw.name, 80);
    /* El nombre de un botón es lo que se lee en la ficha: no puede faltar. */
    if(tr.type === 'button' && !name) return null;
    return {id:str(raw.id, 40) || newId(), name:name, on:raw.on !== false, trigger:trigger, cond:cond, actions:actions};
  }

  function normalizeAll(list){
    return (Array.isArray(list) ? list : []).map(normalize).filter(Boolean).slice(0, MAX_RULES);
  }

  /* ctx: {stages:[{key, label, done}], labels:[nombre], members:[{uid, name}], team:bool, me:uid} */
  const stageOf = (ctx, key) => ctx.stages.find((s) => s.key === key) || null;
  const memberOf = (ctx, uid) => ctx.members.find((x) => x.uid === uid) || null;
  /* El nombre de ahora; si ya no existe, el que se guardó con la regla. */
  const stageName = (ctx, key, kept) => { const s = stageOf(ctx, key); return s ? s.label : (kept || key); };
  const memberName = (ctx, uid, kept) => { const m = memberOf(ctx, uid); return m ? m.name : (kept || t('alguien que ya no está')); };

  /* La regla con los nombres de sus columnas y personas apuntados (los que existan ahora). */
  function withNames(rule, ctx){
    const out = JSON.parse(JSON.stringify(rule));
    const stage = (o) => { const s = o.stage && stageOf(ctx, o.stage); if(s) o.stageName = s.label; };
    stage(out.trigger);
    const who = memberOf(ctx, out.cond.assignee);
    if(who) out.cond.assigneeName = who.name;
    out.actions.forEach((a) => {
      if(a.type === 'move') stage(a);
      if(a.type === 'assign'){ const m = memberOf(ctx, a.uid); if(m) a.memberName = m.name; }
    });
    return out;
  }

  /* Qué le falta a la regla para poder ejecutarse ('' si nada): una columna, una etiqueta o una
     persona que ya no existe. Una regla así queda en pausa y se avisa; no falla en silencio. */
  function problem(rule, ctx){
    const noStage = (key, kept) => (key && !stageOf(ctx, key) ? t('la columna «{name}» ya no existe', {name:kept || key}) : '');
    const noLabel = (name) => (name && !ctx.labels.some((l) => same(l, name)) ? t('la etiqueta «{name}» ya no existe', {name:name}) : '');
    const noMember = (uid, kept) => (uid && uid !== 'none' && !memberOf(ctx, uid)
      ? (kept ? t('{name} ya no está en el proyecto', {name:kept}) : t('la persona asignada ya no está en el proyecto')) : '');
    const found = [noStage(rule.trigger.stage, rule.trigger.stageName), noLabel(rule.cond.label), noMember(rule.cond.assignee, rule.cond.assigneeName)];
    rule.actions.forEach((a) => {
      if(a.type === 'move') found.push(noStage(a.stage, a.stageName));
      if(a.type === 'label') found.push(noLabel(a.name));
      if(a.type === 'assign') found.push(ctx.team ? noMember(a.uid, a.memberName) : t('asignar tareas solo existe en los proyectos de equipo'));
      if(a.type === 'complete' && !ctx.stages.some((s) => s.done)) found.push(t('el proyecto no tiene ninguna etapa final'));
    });
    return found.filter(Boolean)[0] || '';
  }

  const assignedTo = (task) => (Array.isArray(task.assignees) ? task.assignees : []);
  const labelsOf = (task) => (Array.isArray(task.labels) ? task.labels : []);
  /* Etapa de la tarea; si la suya ya no existe, cuenta la primera (como en el tablero). */
  const stageKey = (ctx, task) => (stageOf(ctx, task.status) ? task.status : (ctx.stages[0] || {}).key);
  const isDone = (ctx, key) => { const s = stageOf(ctx, key); return !!(s && s.done); };

  function meets(rule, task){
    if(rule.cond.label && !labelsOf(task).some((l) => same(l, rule.cond.label))) return false;
    if(rule.cond.assignee === 'none') return !assignedTo(task).length;
    if(rule.cond.assignee) return assignedTo(task).indexOf(rule.cond.assignee) !== -1;
    return true;
  }

  /* ¿Dispara este cambio la regla? ev: {type:'created'|'moved', id, from, to}. Las reglas por
     fecha y los botones no entran aquí: tienen su propia entrada en el motor. */
  function matches(rule, ev, task, ctx){
    const tr = rule.trigger;
    if(tr.type === 'created'){
      if(ev.type !== 'created' || (tr.stage && stageKey(ctx, task) !== tr.stage)) return false;
    } else if(tr.type === 'moved'){
      /* Tiene que seguir en esa columna: otra regla de la misma tanda pudo habérsela llevado. */
      if(ev.type !== 'moved' || ev.to !== tr.stage || ev.from === ev.to || stageKey(ctx, task) !== tr.stage) return false;
    } else if(tr.type === 'completed'){
      if(!isDone(ctx, ev.to) || (ev.type === 'moved' && isDone(ctx, ev.from))) return false;
    } else return false;
    return meets(rule, task);
  }

  /* Lo que la regla cambiaría en la tarea → {patch, did:[frases], moved:{from, to}|null}. Solo
     cuenta lo que de verdad cambia: aplicar dos veces la misma regla no hace nada la segunda.
     Las frases de `did` van en español (se guardan en la actividad de la tarea). */
  function plan(rule, task, ctx, io){
    const patch = {};
    const did = [];
    let moved = null;
    const now = Object.assign({}, task);
    const moveTo = (key) => {
      const from = stageKey(ctx, now);
      const stage = stageOf(ctx, key);
      if(!stage || from === key) return;
      now.status = patch.status = key;
      moved = {from:moved ? moved.from : from, to:key};
      did.push(es('movió la tarea a «{name}»', {name:stage.raw || stage.label}));
    };
    rule.actions.forEach((a) => {
      if(a.type === 'move') moveTo(a.stage);
      else if(a.type === 'complete'){
        const done = ctx.stages.find((s) => s.done);
        if(done && !isDone(ctx, stageKey(ctx, now))) moveTo(done.key);
      } else if(a.type === 'assign'){
        const who = memberOf(ctx, a.uid);
        if(!ctx.team || !who || assignedTo(now).indexOf(a.uid) !== -1) return;
        now.assignees = patch.assignees = assignedTo(now).concat([a.uid]);
        did.push(es('asignó la tarea a {name}', {name:who.name}));
      } else if(a.type === 'label'){
        if(labelsOf(now).some((l) => same(l, a.name))) return;
        now.labels = patch.labels = labelsOf(now).concat([a.name]);
        did.push(es('añadió la etiqueta «{name}»', {name:a.name}));
      } else if(a.type === 'subtask'){
        const list = Array.isArray(now.checklist) ? now.checklist : [];
        if(list.length >= MAX_CHECKLIST || list.some((c) => c && same(c.text, a.text))) return;
        now.checklist = patch.checklist = list.concat([{id:'c' + newId(), text:a.text, done:false}]);
        did.push(es('añadió la subtarea «{name}»', {name:a.text}));
      } else if(a.type === 'due'){
        const date = io.dateIn(a.days);
        if(now.dueDate === date) return;
        now.dueDate = patch.dueDate = date;
        did.push(es('puso la fecha límite el {date}', {date:date.split('-').reverse().join('/')}));
      }
    });
    return {patch:patch, did:did, moved:moved};
  }

  /* La línea que queda en la actividad de la tarea, en español. */
  function logText(rule, did){
    return es(rule.trigger.type === 'button' ? 'Botón «{name}»: {what}' : 'Automatización «{name}»: {what}', {name:rule.name, what:did.join(', ')});
  }

  /* La regla dicha en una frase: «Cuando una tarea se mueve a «Hecho»: marcarla como completada.» */
  function describe(rule, ctx){
    const tr = rule.trigger;
    let when = tr.type === 'created' ? (tr.stage ? t('Cuando se crea una tarea en «{name}»', {name:stageName(ctx, tr.stage, tr.stageName)}) : t('Cuando se crea una tarea'))
      : tr.type === 'moved' ? t('Cuando una tarea se mueve a «{name}»', {name:stageName(ctx, tr.stage, tr.stageName)})
      : tr.type === 'completed' ? t('Cuando una tarea se completa')
      : tr.type === 'button' ? t('Al pulsar el botón en una tarea')
      : tr.days === 0 ? t('El día en que vence una tarea') : tr.days === 1 ? t('Cuando falta 1 día para la fecha límite') : t('Cuando faltan {n} días para la fecha límite', {n:tr.days});
    const only = [];
    if(rule.cond.label) only.push(t('lleva la etiqueta «{name}»', {name:rule.cond.label}));
    if(rule.cond.assignee === 'none') only.push(t('no tiene a nadie asignado'));
    else if(rule.cond.assignee) only.push(t('está asignada a {name}', {name:memberName(ctx, rule.cond.assignee, rule.cond.assigneeName)}));
    if(only.length) when += ' ' + t('y {what}', {what:only.join(' ' + t('y') + ' ')});
    const then = rule.actions.map((a) => (
      a.type === 'move' ? t('moverla a «{name}»', {name:stageName(ctx, a.stage, a.stageName)})
      : a.type === 'complete' ? t('marcarla como completada')
      : a.type === 'assign' ? t('asignarla a {name}', {name:memberName(ctx, a.uid, a.memberName)})
      : a.type === 'label' ? t('añadir la etiqueta «{name}»', {name:a.name})
      : a.type === 'subtask' ? t('añadir la subtarea «{name}»', {name:a.text})
      : a.days === 0 ? t('poner la fecha límite hoy') : t('poner la fecha límite dentro de {n} días', {n:a.days})));
    return when + ': ' + then.join(', ') + '.';
  }

  /* Nombre corto para una regla que se guardó sin nombre: lo que la dispara. */
  function title(rule, ctx){
    const tr = rule.trigger;
    return tr.type === 'created' ? (tr.stage ? t('Al crear en «{name}»', {name:stageName(ctx, tr.stage, tr.stageName)}) : t('Al crear una tarea'))
      : tr.type === 'moved' ? t('Al mover a «{name}»', {name:stageName(ctx, tr.stage, tr.stageName)})
      : tr.type === 'completed' ? t('Al completar una tarea')
      : tr.type === 'button' ? rule.name
      : tr.days === 0 ? t('El día que vence') : t('A {n} días de vencer', {n:tr.days});
  }

  /* Ejemplos listos para activar, adaptados a las columnas, las etiquetas y el equipo del proyecto. */
  function templates(ctx){
    const first = ctx.stages[0];
    const middle = ctx.stages.filter((s) => s !== first && !s.done).pop();
    const urgent = ctx.labels.find((l) => same(l, 'Urgente')) || ctx.labels[0];
    const list = [];
    if(first) list.push({name:t('Dar plazo a lo nuevo'), text:t('Cada tarea nueva en «{name}» vence en 7 días.', {name:first.label}),
      rule:{trigger:{type:'created', stage:first.key}, actions:[{type:'due', days:7}]}});
    if(middle) list.push({name:t('Preparar la revisión'), text:t('Al pasar a «{name}», añade la subtarea «Revisar».', {name:middle.label}),
      rule:{trigger:{type:'moved', stage:middle.key}, actions:[{type:'subtask', text:t('Revisar')}]}});
    if(middle) list.push({name:t('Enviar a revisión'), text:t('Un botón en la tarea: la mueve a «{name}» y añade la subtarea «Revisar».', {name:middle.label}),
      rule:{trigger:{type:'button'}, actions:[{type:'move', stage:middle.key}, {type:'subtask', text:t('Revisar')}]}});
    if(urgent) list.push({name:t('Avisar de lo que vence'), text:t('Cuando faltan 2 días para la fecha límite, añade la etiqueta «{name}».', {name:urgent}),
      rule:{trigger:{type:'due', days:2}, actions:[{type:'label', name:urgent}]}});
    if(first && ctx.team && ctx.me) list.push({name:t('Repartir lo que nadie tiene'), text:t('Las tareas nuevas sin responsable se te asignan a ti.'),
      rule:{trigger:{type:'created', stage:first.key}, cond:{assignee:'none'}, actions:[{type:'assign', uid:ctx.me}]}});
    return list.map((x) => ({name:x.name, text:x.text, rule:normalize(Object.assign({name:x.name}, x.rule))})).filter((x) => x.rule);
  }

  /* Motor: decide qué reglas se ejecutan ante un cambio y las encadena con límites.
     io: {rules() → [regla], ctx() → ctx, task(id) → tarea|null, update(id, patch) → Promise,
          log(id, regla, did) → Promise, warn(código), dateIn(días) → 'AAAA-MM-DD',
          daysUntil('AAAA-MM-DD') → número, now() → ms,
          skip(regla, tarea) → bool (opcional: lo que este motor no debe tocar)} */
  class Engine {
    constructor(io){
      this.io = io;
      this.queue = Promise.resolve();
      this.stamps = [];
    }

    /* ¿Queda cupo en este minuto? */
    budget(){
      const now = this.io.now();
      this.stamps = this.stamps.filter((s) => now - s < 60000);
      if(this.stamps.length >= MAX_PER_MINUTE) return false;
      this.stamps.push(now);
      return true;
    }

    /* Un cambio hecho por una persona: se atienden de uno en uno. */
    handle(ev){
      this.queue = this.queue.then(() => this.run(ev, 0, {})).catch(() => null);
      return this.queue;
    }

    /* Reglas que pueden ejecutarse: activas y sin nada roto (las rotas traen `broken`). */
    active(){
      const ctx = this.io.ctx();
      return this.io.rules().filter((r) => r.on && !(r.broken || problem(r, ctx)));
    }

    /* Aplica una regla a una tarea; devuelve el movimiento que hizo, si hizo alguno. */
    apply(rule, id){
      const task = this.io.task(id);
      if(!task) return Promise.resolve(null);
      const res = plan(rule, task, this.io.ctx(), this.io);
      if(!Object.keys(res.patch).length) return Promise.resolve(null);
      return this.io.update(id, res.patch).then(() => this.io.log(id, rule, res.did)).then(() => res.moved);
    }

    /* Aplica una regla porque sí (una fecha, un botón) y sigue con las que dispare su movimiento. */
    fire(rule, id){
      if(!this.budget()){ this.io.warn('rate'); return Promise.resolve(); }
      const seen = {};
      seen[rule.id] = true;
      return this.apply(rule, id).then((moved) => (moved ? this.run({type:'moved', id:id, from:moved.from, to:moved.to}, 1, seen) : null));
    }

    /* Alguien pulsa el botón de una regla en una tarea. */
    press(ruleId, id){
      this.queue = this.queue.then(() => {
        const rule = this.active().find((r) => r.id === ruleId && r.trigger.type === 'button');
        return rule ? this.fire(rule, id) : null;
      }).catch(() => null);
      return this.queue;
    }

    /* seen: reglas ya ejecutadas en esta cadena. Una regla no se repite en la misma cadena (así
       «A mueve y B devuelve» se corta sola, con aviso) y la cadena no pasa de MAX_DEPTH saltos. */
    run(ev, depth, seen){
      const task = this.io.task(ev.id);
      if(!task) return Promise.resolve();
      const ctx = this.io.ctx();
      const due = this.active().filter((r) => matches(r, ev, task, ctx));
      return due.reduce((chain, rule) => chain.then(() => {
        const now = this.io.task(ev.id);
        /* Otra regla de esta misma tanda pudo cambiar la tarea: se vuelve a mirar. */
        if(!now || !matches(rule, ev, now, this.io.ctx())) return null;
        if(seen[rule.id]){ this.io.warn('loop'); return null; }
        if(depth >= MAX_DEPTH){ this.io.warn('depth'); return null; }
        if(!this.budget()){ this.io.warn('rate'); return null; }
        seen[rule.id] = true;
        return this.apply(rule, ev.id).then((moved) => (moved ? this.run({type:'moved', id:ev.id, from:moved.from, to:moved.to}, depth + 1, seen) : null));
      }), Promise.resolve());
    }

    /* Reglas por fecha: tareas sin terminar a las que les faltan N días o menos. Cada regla se
       ejecuta una vez por tarea y fecha (fired: {idRegla:idTarea → fecha}); si la fecha cambia,
       vuelve a contar. Devuelve true si apuntó algo nuevo en fired. */
    checkDue(tasks, fired){
      const rules = this.active().filter((r) => r.trigger.type === 'due');
      if(!rules.length) return Promise.resolve(false);
      let changed = false;
      const jobs = [];
      const ctx = this.io.ctx();
      tasks.forEach((task) => {
        if(!task.dueDate || isDone(ctx, stageKey(ctx, task))) return;
        const left = this.io.daysUntil(task.dueDate);
        rules.forEach((rule) => {
          const key = rule.id + ':' + task.id;
          if(!(left <= rule.trigger.days) || fired[key] === task.dueDate || !meets(rule, task)) return;
          if(this.io.skip && this.io.skip(rule, task)) return;
          jobs.push({rule:rule, id:task.id, key:key, date:task.dueDate});
        });
      });
      this.queue = this.queue.then(() => jobs.reduce((chain, job) => chain.then(() => {
        if(!this.budget()){ this.io.warn('rate'); return null; }
        /* El cupo ya está contado: fire() no lo vuelve a gastar. */
        this.stamps.pop();
        fired[job.key] = job.date;
        changed = true;
        return this.fire(job.rule, job.id);
      }), Promise.resolve())).catch(() => null);
      return this.queue.then(() => changed);
    }
  }

  Workhub.models.Automations = {
    TRIGGERS, ACTIONS, MAX_RULES, MAX_ACTIONS, MAX_DEPTH, MAX_PER_MINUTE,
    newId, normalize, normalizeAll, withNames, problem, matches, meets, plan, logText, describe, title, templates,
    stageKey, isDone, Engine
  };
})();
