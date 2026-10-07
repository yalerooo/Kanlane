/* Automatizaciones por fecha con Kanlane cerrado (fase 2). Lo lanza el cron del Worker
   (wrangler.jsonc, cada 30 minutos; ver `scheduled` en worker/index.js).

   Qué hace: recorre los documentos de `automation_jobs` (una copia de las reglas por fecha de
   cada proyecto, que solo puede dejar su dueño: firestore.rules), lee las tareas de ese proyecto
   con fecha límite cercana y les aplica las reglas con el MISMO motor que usa la app
   (src/models/automation-model.js): mismas acciones, mismo corte de bucles, mismo tope por minuto.
   Cada ejecución deja su línea en la actividad de la tarea y su marca en
   plugin_data/kanlane.automations.state, para que ni el servidor ni un navegador la repitan.

   Permisos: lo que autoriza una ejecución es la copia, y las reglas de Firestore solo dejan
   escribirla al dueño. Aquí se vuelve a comprobar (la cuenta de servicio salta esas reglas): el
   identificador y los campos tienen que decir lo mismo y, en un equipo, quien dejó la copia tiene
   que seguir siendo su propietario. Si no, la copia se borra y no se ejecuta nada.

   Dos a la vez (otra vuelta del cron, o un navegador abierto): todo lo de un proyecto se escribe
   en una sola operación, condicionada a que ni las tareas ni las marcas hayan cambiado desde que
   se leyeron. Si algo cambió, no se escribe nada ('conflict') y se reintenta en la vuelta siguiente.

   Qué no hace:
   - No toca proyectos con cifrado total: no puede leerlos (no tiene su clave) y la app no deja
     copia de sus reglas. Si aun así encuentra tareas selladas, borra la copia y no escribe nada.
   - No completa tareas que se repiten: crear la siguiente es cosa de la app; se dejan para el
     navegador.
   - No atiende peticiones: no hay ninguna ruta que lo dispare desde fuera.

   Acceso a los datos: API REST de Firestore con una cuenta de servicio de Google (secreto
   FIREBASE_SERVICE_ACCOUNT del Worker, el JSON de la clave; nunca en el repositorio ni en el
   cliente). Sin ese secreto, el cron no hace nada. Guía: docs/AUTOMATIZACIONES.md.

   Límites del plan gratuito de Cloudflare (50 subpeticiones por ejecución): cada vuelta atiende
   JOBS_PER_RUN proyectos y recuerda por dónde iba (automation_state/cursor). */
import './automations-global.mjs';
import '../src/models/automation-model.js';

const A = globalThis.Workhub.models.Automations;

const DEFAULT_PROJECT = 'workhub-26f50';
const JOBS_PER_RUN = 10;
const TASKS_PER_JOB = 200;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const STATE_DOC = 'plugin_data/kanlane.automations.state';
const CURSOR_DOC = 'automation_state/cursor';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Fechas ---------- */

/* El día de hoy ('AAAA-MM-DD') en la zona horaria del dueño del proyecto (UTC si no vale). */
export function todayIn(tz, now) {
  const date = new Date(now);
  try {
    return new Intl.DateTimeFormat('en-CA', {timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

const dayNumber = (ymd) => Math.round(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000);
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
export const addDays = (ymd, n) => new Date((dayNumber(ymd) + n) * 86400000).toISOString().slice(0, 10);

/* ---------- Valores de la API REST de Firestore ---------- */

export function encode(v) {
  if (v === null || v === undefined) return {nullValue: null};
  if (typeof v === 'boolean') return {booleanValue: v};
  if (typeof v === 'number') return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  if (typeof v === 'string') return {stringValue: v};
  if (Array.isArray(v)) return {arrayValue: {values: v.map(encode)}};
  return {mapValue: {fields: encodeFields(v)}};
}

export function encodeFields(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => { if (obj[k] !== undefined) out[k] = encode(obj[k]); });
  return out;
}

export function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(decode);
  if ('mapValue' in v) return decodeFields((v.mapValue || {}).fields);
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}

export function decodeFields(fields) {
  const out = {};
  Object.keys(fields || {}).forEach((k) => { out[k] = decode(fields[k]); });
  return out;
}

/* ---------- Cuenta de servicio ---------- */

const b64url = (bytes) => {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const text = (s) => new TextEncoder().encode(s);

/* El JWT firmado con la clave de la cuenta de servicio que Google cambia por un token de acceso. */
export async function serviceJwt(account, nowMs) {
  const pem = String(account.private_key || '').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']);
  const iat = Math.floor(nowMs / 1000);
  const head = b64url(text(JSON.stringify({alg: 'RS256', typ: 'JWT'})));
  const body = b64url(text(JSON.stringify({iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: iat, exp: iat + 3600})));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, text(head + '.' + body));
  return head + '.' + body + '.' + b64url(sig);
}

let cached = {token: '', until: 0, email: ''};

async function accessToken(account, deps) {
  const now = deps.now();
  if (cached.token && cached.email === account.client_email && now < cached.until) return cached.token;
  const res = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + await serviceJwt(account, now)
  });
  if (!res.ok) throw new Error('token ' + res.status);
  const data = await res.json();
  cached = {token: data.access_token, until: now + (Math.min(+data.expires_in || 3600, 3600) - 300) * 1000, email: account.client_email};
  return cached.token;
}

/* ---------- Firestore por REST ---------- */

/* store: lo que el proceso necesita de la base de datos. En producción, la API REST con la cuenta
   de servicio; con FIRESTORE_EMULATOR_HOST (pruebas), el emulador. Devuelve null si falta el secreto. */
export function restStore(env, deps) {
  let account = null;
  if (!env.FIRESTORE_EMULATOR_HOST) {
    try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || ''); } catch (e) { account = null; }
    if (!account || !account.client_email || !account.private_key) return null;
  }
  const project = env.FIREBASE_PROJECT || (account && account.project_id) || DEFAULT_PROJECT;
  const db = 'projects/' + project + '/databases/(default)';
  const origin = env.FIRESTORE_EMULATOR_HOST ? 'http://' + env.FIRESTORE_EMULATOR_HOST : 'https://firestore.googleapis.com';
  const docs = db + '/documents';
  const call = async (method, path, body) => {
    const token = account ? await accessToken(account, deps) : 'owner';
    const res = await deps.fetch(origin + '/v1/' + path, {
      method: method,
      headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(method + ' ' + path.slice(docs.length) + ' ' + res.status), {status: res.status});
    return res.json();
  };
  const idOf = (name) => name.slice(name.lastIndexOf('/') + 1);
  const query = (parent, structuredQuery) => call('POST', docs + (parent ? '/' + parent : '') + ':runQuery', {structuredQuery: structuredQuery})
    .then((rows) => (rows || []).filter((r) => r.document).map((r) => ({id: idOf(r.document.name), data: decodeFields(r.document.fields), updateTime: r.document.updateTime || ''})));
  const field = (path) => ({field: {fieldPath: path}});
  return {
    /* Los siguientes `n` trabajos por orden de identificador, a partir de `after`. */
    jobs: (after, n) => query('', Object.assign({
      from: [{collectionId: 'automation_jobs'}],
      orderBy: [Object.assign(field('__name__'), {direction: 'ASCENDING'})],
      limit: n
    }, after ? {startAt: {values: [{referenceValue: docs + '/automation_jobs/' + after}], before: false}} : {})),
    get: (path) => call('GET', docs + '/' + path).then((doc) => (doc ? decodeFields(doc.fields) : null)),
    /* Como get, con la marca de la última escritura: {data, updateTime} | null. */
    getDoc: (path) => call('GET', docs + '/' + path).then((doc) => (doc ? {data: decodeFields(doc.fields), updateTime: doc.updateTime || ''} : null)),
    /* Tareas del proyecto con fecha límite hasta `maxDate` (incluye las vencidas). */
    tasksDue: (root, maxDate) => query(root, {
      from: [{collectionId: 'tasks'}],
      where: {compositeFilter: {op: 'AND', filters: [
        {fieldFilter: Object.assign(field('dueDate'), {op: 'GREATER_THAN_OR_EQUAL', value: {stringValue: '1900-01-01'}})},
        {fieldFilter: Object.assign(field('dueDate'), {op: 'LESS_THAN_OR_EQUAL', value: {stringValue: maxDate}})}
      ]}},
      limit: TASKS_PER_JOB
    }),
    /* writes: [{path, set:{…}} | {path, patch:{…}, updateTime} | {path, create:{…}} | {path, remove:true}], todo o nada.
       Un `patch` con `updateTime` solo entra si el documento no ha cambiado desde esa lectura. */
    commit: (writes) => call('POST', db + '/documents:commit', {writes: writes.map((w) => {
      const name = docs + '/' + w.path;
      if (w.remove) return {delete: name};
      if (w.create) return {update: {name: name, fields: encodeFields(w.create)}, currentDocument: {exists: false}};
      if (w.set) return {update: {name: name, fields: encodeFields(w.set)}};
      return {update: {name: name, fields: encodeFields(w.patch)}, updateMask: {fieldPaths: w.mask || Object.keys(w.patch)},
        currentDocument: w.updateTime ? {updateTime: w.updateTime} : {exists: true}};
    })})
  };
}

/* ---------- Un proyecto ---------- */

/* Dónde está el proyecto de un trabajo. El identificador manda (u~uid~proyecto o t~equipo): las
   reglas de Firestore solo dejan escribirlo a su dueño, y los campos tienen que decir lo mismo. */
export function rootOf(id, job) {
  const parts = String(id).split('~');
  if (!parts.every((p) => ID.test(p)) || !job) return null;
  if (parts[0] === 'u' && parts.length === 3 && job.kind === 'u' && job.uid === parts[1] && job.pid === parts[2]) {
    return parts[2] === 'main' ? 'users/' + parts[1] : 'users/' + parts[1] + '/projects/' + parts[2];
  }
  if (parts[0] === 't' && parts.length === 2 && job.kind === 't' && job.tid === parts[1]) return 'teams/' + parts[1];
  return null;
}

const list = (v) => (Array.isArray(v) ? v : []);
const cleanCtx = (c) => ({
  stages: list(c && c.stages).filter((s) => s && typeof s.key === 'string').map((s) => ({key: s.key, label: String(s.label || s.key), done: !!s.done})),
  labels: list(c && c.labels).filter((l) => typeof l === 'string'),
  members: list(c && c.members).filter((m) => m && typeof m.uid === 'string').map((m) => ({uid: m.uid, name: String(m.name || '')})),
  team: !!(c && c.team)
});

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return b64url(bytes).replace(/[-_]/g, 'x');
}

/* ¿Sigue pudiendo quien dejó la copia cambiar las automatizaciones de ese proyecto? En uno personal
   el identificador ya lo dice (u~uid~…: es su árbol). En un equipo hay que mirarlo: solo vale si
   sigue siendo el propietario. → 'ok' | 'gone' (el equipo ya no existe) | 'not-owner' */
async function ownership(job, store) {
  if (job.kind !== 't') return 'ok';
  const team = await store.get('teams/' + job.tid);
  if (!team) return 'gone';
  const member = team.members && team.members[job.uid];
  return team.ownerUid === job.uid && member && member.role === 'owner' && list(team.memberIds).indexOf(job.uid) !== -1 ? 'ok' : 'not-owner';
}

/* Ejecuta las reglas por fecha de un proyecto. → {status, ran, warns}
   status: 'ok' | 'bad-job' | 'no-rules' | 'idle' | 'conflict' (algo cambió mientras tanto: nada escrito)
     | 'encrypted' | 'gone' | 'not-owner' (en estos tres se borra la copia). */
export async function runJob(id, job, store, nowMs) {
  const root = rootOf(id, job);
  if (!root || job.v !== 1) return {status: 'bad-job', ran: 0, warns: []};
  const ctx = cleanCtx(job.ctx);
  const rules = A.normalizeAll(job.rules).filter((r) => r.trigger.type !== 'button' && r.trigger.type !== 'created');
  const due = rules.filter((r) => r.on && r.trigger.type === 'due' && !A.problem(r, ctx));
  if (!due.length) return {status: 'no-rules', ran: 0, warns: []};

  const today = todayIn(job.tz, nowMs);
  const maxDate = addDays(today, Math.max.apply(null, due.map((r) => r.trigger.days)));
  const [found, stateDoc, owner] = await Promise.all([store.tasksDue(root, maxDate), store.getDoc(root + '/' + STATE_DOC), ownership(job, store)]);
  const state = stateDoc && stateDoc.data;
  const drop = async (status) => {
    await store.commit([{path: 'automation_jobs/' + id, remove: true}]);
    return {status: status, ran: 0, warns: []};
  };
  if (owner !== 'ok') return drop(owner);
  /* Tareas o marcas selladas: el proyecto pasó a cifrado total. No se toca y la copia sobra. */
  if (found.some((t) => t.data.ev) || (state && state.ev)) return drop('encrypted');
  const read = {};
  found.forEach((t) => { read[t.id] = t.updateTime || ''; });
  const tasks = found.filter((t) => DAY.test(String(t.data.dueDate || ''))).map((t) => Object.assign({}, t.data, {id: t.id}));
  let fired = {};
  try { fired = JSON.parse((state && state.values && state.values.fired) || '{}') || {}; } catch (e) { fired = {}; }
  if (typeof fired !== 'object' || Array.isArray(fired)) fired = {};

  const patches = {};
  const notes = [];
  const warns = [];
  const moves = (rule) => rule.actions.some((a) => a.type === 'move' || a.type === 'complete');
  const engine = new A.Engine({
    rules: () => rules,
    ctx: () => ctx,
    task: (taskId) => tasks.find((t) => t.id === taskId) || null,
    update: (taskId, patch) => {
      const change = Object.assign({}, patch, {updatedAt: nowMs});
      /* Al final de su columna nueva (los órdenes del tablero son marcas de tiempo o mayores). */
      if (patch.status) change.order = nowMs;
      Object.assign(tasks.find((t) => t.id === taskId), change);
      patches[taskId] = Object.assign(patches[taskId] || {}, change);
      return Promise.resolve();
    },
    log: (taskId, rule, did) => {
      notes.push({taskId: taskId, text: A.logText(rule, did)});
      return Promise.resolve();
    },
    warn: (code) => { if (warns.indexOf(code) === -1) warns.push(code); },
    dateIn: (n) => addDays(today, n),
    daysUntil: (date) => daysBetween(today, date),
    now: () => nowMs,
    /* Completar una tarea que se repite crea la siguiente, y eso lo hace la app. */
    skip: (rule, task) => !!task.repeat && moves(rule)
  });
  const changed = await engine.checkDue(tasks, fired);
  if (!changed) return {status: 'idle', ran: 0, warns: warns};

  const writes = Object.keys(patches).map((taskId) => ({path: root + '/tasks/' + taskId, patch: patches[taskId], updateTime: read[taskId]}));
  notes.forEach((n, i) => writes.push({path: root + '/tasks/' + n.taskId + '/notes/' + newId(),
    create: {kind: 'activity', text: n.text, actorUid: '', actorName: '', createdAt: nowMs + i}}));
  const marks = {values: {fired: JSON.stringify(fired)}, updatedAt: nowMs};
  /* Las marcas: si ya había documento, tal como se leyó; si no, que siga sin haberlo. */
  writes.push(state ? {path: root + '/' + STATE_DOC, patch: marks, mask: ['values.fired', 'updatedAt'], updateTime: stateDoc.updateTime} : {path: root + '/' + STATE_DOC, create: marks});
  try {
    await store.commit(writes);
  } catch (err) {
    /* Una tarea o las marcas cambiaron después de leerlas (un navegador, otra vuelta): no se ha
       escrito nada. La vuelta siguiente lo vuelve a mirar con los datos nuevos. */
    if (err && (err.status === 400 || err.status === 409 || err.status === 412)) return {status: 'conflict', ran: 0, warns: warns};
    throw err;
  }
  return {status: 'ok', ran: notes.length, warns: warns};
}

/* ---------- Una vuelta del cron ---------- */

export async function run(env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  const store = deps.store || restStore(env, deps);
  if (!store) return {configured: false, jobs: 0, ran: 0};
  const cursor = await store.get(CURSOR_DOC);
  const jobs = await store.jobs((cursor && cursor.after) || '', JOBS_PER_RUN);
  const out = {configured: true, jobs: jobs.length, ran: 0, results: []};
  for (const job of jobs) {
    let res;
    try { res = await runJob(job.id, job.data, store, deps.now()); } catch (err) { res = {status: 'error', ran: 0, warns: [String(err && err.message)]}; }
    out.ran += res.ran;
    out.results.push({id: job.id, status: res.status, ran: res.ran, warns: res.warns});
  }
  /* Menos de una tanda completa: se llegó al final y la próxima vuelta empieza de nuevo.
     Cada vuelta deja constancia (cuándo, cuántos proyectos miró y cuántas reglas ejecutó): es lo
     que permite comprobar desde fuera, sin ningún navegador abierto, que el cron está corriendo. */
  const after = jobs.length === JOBS_PER_RUN ? jobs[jobs.length - 1].id : '';
  await store.commit([{path: CURSOR_DOC, set: {after: after, updatedAt: deps.now(), jobs: jobs.length, ran: out.ran,
    runs: ((cursor && cursor.runs) || 0) + 1, errors: out.results.filter((r) => r.status === 'error').length}}]);
  return out;
}

export const LIMITS = {jobsPerRun: JOBS_PER_RUN, tasksPerJob: TASKS_PER_JOB};
