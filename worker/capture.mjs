/* Captura de tareas por correo (fase 3). Guía: docs/CAPTURA-EMAIL.md.

   Cómo entra el correo: Cloudflare Email Routing entrega cada mensaje enviado a un dominio de
   captura al manejador `email` de este Worker (worker/index.js → receive). No hay ninguna ruta
   HTTP que reciba correo: nadie de fuera puede llamar a este código, así que no hay firma de
   webhook que comprobar; lo que hace falta autenticar es el remitente (ver más abajo).

   La dirección: <32 letras>@<dominio de captura>. Las 16 primeras son un identificador al azar y
   las 16 siguientes, su HMAC con el secreto CAPTURE_SECRET del Worker. Una dirección inventada se
   descarta sin leer nada de la base de datos. En Firestore solo queda el hash de la dirección
   (mail_capture/{hash}) y el identificador (mail_capture_cfg/{proyecto}), que sin el secreto no
   sirve para reconstruirla. Esas colecciones están cerradas a los clientes: solo entra la cuenta
   de servicio del Worker. Activar, desactivar o regenerar cambia el identificador: la dirección
   anterior deja de existir.

   Quién puede qué:
   - Gestionar la dirección (activar, desactivar, regenerar, elegir columna y remitentes): el dueño
     del proyecto personal o el propietario del equipo, con su ID token de Firebase (manage).
   - Enviar correo al proyecto: quien puede editarlo. El From tiene que ser el correo de la cuenta
     del dueño o de un miembro propietario o editor, y el mensaje tiene que llevar una firma DKIM
     válida de ese dominio (worker/dkim.mjs). Conocer la dirección no basta, y la lista opcional de
     remitentes solo puede restringir más: nunca deja entrar a quien no es miembro.

   El correo es contenido que no es de fiar: de él solo salen el título, la descripción (texto
   plano saneado) y los adjuntos admitidos de UNA tarea. No cambia permisos ni automatizaciones,
   no se siguen sus enlaces ni se cargan sus imágenes, y los adjuntos no se abren.

   Proyectos con cifrado total: sin captura. El Worker recibe el correo en claro y no tiene la
   clave del proyecto; guardar la tarea sin cifrar rompería lo que el proyecto promete. */
import './automations-global.mjs';
import '../src/models/project-templates.js';
import {restStore} from './automations.mjs';
import {parseMail, automatic, baseSubject, cleanText, htmlToText, blockedFile, toBytes, toBin} from './mime.mjs';
import {verifyDkim, resolveTxt} from './dkim.mjs';

const PT = globalThis.Workhub.models.ProjectTemplates;

const CONTEXT = 'kanlane-capture-v1|';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const LOCAL = /^[a-z2-7]{32}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9.-]{3,253}$/;
const MIB = 1024 * 1024;
/* Los mismos que en la app (src/services/platform.js y firebase-backend.js). */
const FILE_MAX_BYTES = 10 * MIB;
const NOTE_MAX_FILES = 10;
const FILE_CHUNK_BYTES = 640000;
const FILE_PREFIX = 'data:application/octet-stream;base64,';
const TITLE_MAX = 500;
const DESC_MAX = 20000;
const ALLOW_MAX = 20;
const SEEN_DAYS = 30;
const DAY_MS = 86400000;
const STALE_MS = 10 * 60000;
const RATE = {projectHour: 30, projectDay: 200, senderHour: 20};

/* Lo que cabe según el plan de Workers (variable CAPTURE_PLAN). El gratuito da 10 ms de CPU por
   mensaje: un correo de texto entra; con adjuntos grandes Cloudflare puede cortar el proceso.
   Por eso ahí el mensaje admitido es más pequeño. El límite de 10 MB por archivo y de 10 adjuntos
   por nota es el del producto y vale en los dos. */
const PLANS = {
  free: {messageBytes: 8 * MIB, filesBytes: 6 * MIB, ms: 20000},
  paid: {messageBytes: 25 * MIB, filesBytes: 20 * MIB, ms: 120000}
};

export function limitsOf(env) {
  const plan = PLANS[String(env.CAPTURE_PLAN || 'free').toLowerCase()] || PLANS.free;
  const custom = Math.floor(+env.CAPTURE_MAX_MESSAGE_MB || 0);
  const messageBytes = custom >= 1 && custom <= 25 ? custom * MIB : plan.messageBytes;
  return {messageBytes: messageBytes, filesBytes: Math.min(plan.filesBytes, messageBytes), fileBytes: FILE_MAX_BYTES, files: NOTE_MAX_FILES, ms: plan.ms};
}

/* ---------- Dirección ---------- */

const text = (s) => new TextEncoder().encode(s);
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? text(data) : data));

function base32(bytes) {
  const abc = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { out += abc[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out;
}

function secretOf(env) {
  try {
    const bin = atob(String(env.CAPTURE_SECRET || '').replace(/-/g, '+').replace(/_/g, '/'));
    return bin.length >= 32 ? toBytes(bin) : null;
  } catch (e) {
    return null;
  }
}

export function domainsOf(env) {
  return String(env.CAPTURE_DOMAINS || '').toLowerCase().split(',').map((d) => d.trim()).filter((d) => /^[a-z0-9](?:[a-z0-9.-]{1,251})[a-z0-9]$/.test(d) && d.indexOf('.') > 0);
}

async function macOf(secret, id) {
  const key = await crypto.subtle.importKey('raw', secret, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return base32(new Uint8Array(await crypto.subtle.sign('HMAC', key, text(CONTEXT + id))).slice(0, 10));
}

/* La parte de delante de la @ para un identificador. */
export async function localFor(secret, id) { return id + await macOf(secret, id); }

/* ¿Es una dirección que este Worker pudo haber dado? (Sin tocar la base de datos.) */
async function genuine(secret, local) {
  if (!LOCAL.test(local)) return false;
  const want = await macOf(secret, local.slice(0, 16));
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= want.charCodeAt(i) ^ local.charCodeAt(16 + i);
  return diff === 0;
}

const hashOf = (local) => sha256(CONTEXT + local);
const newLocalId = () => base32(crypto.getRandomValues(new Uint8Array(10)));
function newId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => abc[b % abc.length]).join('');
}

/* ---------- Proyecto ---------- */

const list = (v) => (Array.isArray(v) ? v : []);
export const keyOf = (ref) => (ref.kind === 't' ? 't~' + ref.tid : 'u~' + ref.uid + '~' + ref.pid);

/* Dónde está y cómo está el proyecto de una captura. → {gone:true} | {root, assets, doc, enc, team, stages} */
export async function loadProject(ref, store) {
  let doc, root, assets, team = null;
  if (ref.kind === 't') {
    doc = team = await store.get('teams/' + ref.tid);
    if (!team) return {gone: true};
    root = 'teams/' + ref.tid;
    assets = root + '/assets';
  } else {
    doc = await store.get('users/' + ref.uid + '/projects/' + ref.pid);
    if ((!doc && ref.pid !== 'main') || (doc && doc.deleted)) return {gone: true};
    root = ref.pid === 'main' ? 'users/' + ref.uid : 'users/' + ref.uid + '/projects/' + ref.pid;
    assets = 'users/' + ref.uid + '/assets';
  }
  /* stages: las columnas del tablero. archived: las claves de las archivadas (sus tareas no se ven). */
  const cfg = PT.resolve(doc || {});
  return {root: root, assets: assets, doc: doc || {}, enc: !!(doc && doc.enc), team: team,
    stages: cfg.stages.map((s) => ({key: s.key, label: String(s.label || s.key), done: !!s.done})),
    archived: cfg.archived.map((s) => s.key)};
}

/* El papel de una cuenta en un equipo: 'owner' | 'editor' | 'viewer' | ''. */
export function roleIn(team, uid) {
  if (!team || list(team.memberIds).indexOf(uid) === -1) return '';
  const role = team.members && team.members[uid] && team.members[uid].role;
  return role === 'owner' ? (team.ownerUid === uid ? 'owner' : '') : role === 'editor' || role === 'viewer' ? role : '';
}

/* ---------- Gestión (ruta /__/capture/v1, con el ID token ya verificado) ---------- */

const reply = (status, body) => ({status: status, body: body});

function cleanAllow(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > ALLOW_MAX) return false;
  const out = [];
  for (const item of value) {
    const email = String(item == null ? '' : item).trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return false;
    if (out.indexOf(email) === -1) out.push(email);
  }
  return out;
}

/* who: {uid, email, emailVerified} (del token, nunca del cuerpo). body: {op, pid | tid, stage, allow}.
   op: 'status' | 'enable' | 'regenerate' | 'disable' | 'configure' | 'purge'.
   → {status, body}. La dirección solo se devuelve a quien puede enviar (propietario o editor). */
export async function manage(who, body, env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  const secret = secretOf(env);
  const domains = domainsOf(env);
  const store = deps.store || restStore(env, deps);
  if (!secret || !domains.length || !store) return reply(503, {error: 'not-configured'});
  if (!body || typeof body.op !== 'string') return reply(400, {error: 'request'});

  /* Al eliminar la cuenta: fuera todas las direcciones que dejó. */
  if (body.op === 'purge') {
    const mine = await store.where('mail_capture_cfg', 'uid', who.uid, 100);
    const writes = [];
    mine.forEach((c) => { writes.push({path: 'mail_capture_cfg/' + c.id, remove: true}); if (c.data.hash) writes.push({path: 'mail_capture/' + c.data.hash, remove: true}); });
    if (writes.length) await store.commit(writes);
    return reply(200, {v: 1, removed: mine.length});
  }

  const isTeam = typeof body.tid === 'string';
  if (isTeam ? !ID.test(body.tid) || body.pid !== undefined : typeof body.pid !== 'string' || !ID.test(body.pid)) return reply(400, {error: 'request'});
  const ref = isTeam ? {kind: 't', tid: body.tid} : {kind: 'u', uid: who.uid, pid: body.pid};
  const project = await loadProject(ref, store);
  const role = project.gone ? '' : isTeam ? roleIn(project.team, who.uid) : 'owner';
  const key = keyOf(ref);
  const cfgPath = 'mail_capture_cfg/' + key;
  /* Un proyecto personal ya borrado: su dueño aún puede retirar la dirección que dejó. */
  if (project.gone && !isTeam && body.op === 'disable') {
    const left = await store.get(cfgPath);
    if (left) await store.commit([{path: cfgPath, remove: true}].concat(left.hash ? [{path: 'mail_capture/' + left.hash, remove: true}] : []));
    return reply(200, {v: 1, available: true, on: false, role: 'owner'});
  }
  /* Lo mismo para «no existe» y «no es tuyo»: no se dice cuál. */
  if (!role) return reply(404, {error: 'project'});

  const cfg = await store.get(cfgPath);
  const limits = limitsOf(env);
  const shown = {messageMb: Math.floor(limits.messageBytes / MIB), fileMb: Math.floor(limits.fileBytes / MIB), files: limits.files};
  const drop = () => store.commit([{path: cfgPath, remove: true}].concat(cfg && cfg.hash ? [{path: 'mail_capture/' + cfg.hash, remove: true}] : []));

  if (project.enc) {
    /* Si quedaba una dirección de antes de cifrarlo, se retira. */
    if (cfg) await drop();
    return body.op === 'status' || body.op === 'disable' ? reply(200, {v: 1, available: false, reason: 'encrypted', on: false, role: role}) : reply(409, {error: 'encrypted'});
  }

  const view = async (c) => {
    const out = {v: 1, available: true, on: !!c, role: role, limits: shown, stages: project.stages.map((s) => ({key: s.key, label: s.label}))};
    if (!c || role === 'viewer') return out;
    const local = await localFor(secret, c.id);
    out.address = local + '@' + domains[0];
    out.alt = domains.slice(1).map((d) => local + '@' + d);
    out.stage = c.stage || '';
    out.stageMissing = !!c.stage && !project.stages.some((s) => s.key === c.stage);
    out.allow = list(c.allow);
    return out;
  };

  if (body.op === 'status') return reply(200, await view(cfg));
  if (role !== 'owner') return reply(403, {error: 'owner'});

  if (body.op === 'disable') {
    if (cfg) await drop();
    return reply(200, await view(null));
  }

  /* La columna se valida cuando se elige. La que ya estaba guardada se conserva aunque después se
     haya borrado (regenerar la dirección no tiene por qué fallar por eso): se avisa con stageMissing. */
  const stage = body.stage === undefined ? (cfg ? cfg.stage || '' : '') : String(body.stage || '');
  if (body.stage !== undefined && stage && !project.stages.some((s) => s.key === stage)) return reply(400, {error: 'stage'});
  const allow = cleanAllow(body.allow);
  if (allow === false) return reply(400, {error: 'allow'});

  if (body.op === 'configure') {
    if (!cfg) return reply(409, {error: 'off'});
    const next = Object.assign({}, cfg, {stage: stage, allow: allow || list(cfg.allow), updatedAt: deps.now()});
    await store.commit([{path: cfgPath, set: next}, {path: 'mail_capture/' + cfg.hash, patch: {stage: next.stage, allow: next.allow}}]);
    return reply(200, await view(next));
  }

  if (body.op === 'enable' || body.op === 'regenerate') {
    if (body.op === 'enable' && cfg) return reply(200, await view(cfg));
    /* En un proyecto personal el remitente autorizado es el correo de la cuenta: tiene que estar comprobado. */
    if (!isTeam && (!who.emailVerified || !EMAIL.test(String(who.email || '').toLowerCase()))) return reply(409, {error: 'email'});
    const id = newLocalId();
    const hash = await hashOf(await localFor(secret, id));
    const next = {v: 1, id: id, hash: hash, uid: who.uid, stage: stage, allow: allow || (cfg ? list(cfg.allow) : []), createdAt: deps.now(), updatedAt: deps.now()};
    const target = Object.assign({v: 1, key: key, stage: next.stage, allow: next.allow, createdAt: next.createdAt}, ref,
      isTeam ? {uid: who.uid} : {email: String(who.email).toLowerCase()});
    await store.commit([{path: cfgPath, set: next}, {path: 'mail_capture/' + hash, create: target}]
      .concat(cfg && cfg.hash ? [{path: 'mail_capture/' + cfg.hash, remove: true}] : []));
    return reply(200, await view(next));
  }
  return reply(400, {error: 'request'});
}

/* ---------- Recepción ---------- */

/* Lo que ve el servidor de quien envía cuando se rechaza (texto SMTP, sin datos del proyecto).
   Una dirección que no existe, una desactivada, una regenerada y la de un proyecto borrado dan
   exactamente el mismo rechazo. */
const REJECT = {
  address: 'This address does not accept mail.',
  sender: 'Sender not authorized. Send from the email address of a Kanlane account that can edit the project; the message needs a valid DKIM signature from that domain.',
  size: (mb) => 'Message too large for this address (limit ' + mb + ' MB).',
  rate: 'Too many messages for this project. Try again later.',
  format: 'The message could not be read.'
};

const pad = (n) => String(n).padStart(2, '0');

/* message: el ForwardableEmailMessage de Cloudflare ({from, to, raw, rawSize, setReject}).
   → {result:'created'|'duplicate'|'dropped'|'rejected', code, taskId?, files?}
   Un fallo de la base de datos antes de crear la tarea se lanza: el servidor que envía lo reintenta. */
export async function receive(message, env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  if (!deps.resolveTxt) deps.resolveTxt = (name) => resolveTxt(name, deps.fetch);
  const log = deps.log || ((line) => console.log(line));
  const started = deps.now();
  const reject = (code, reason) => { message.setReject(reason); log('captura: rechazado (' + code + ')'); return {result: 'rejected', code: code}; };
  const drop = (code) => { log('captura: descartado (' + code + ')'); return {result: 'dropped', code: code}; };

  const secret = secretOf(env);
  const domains = domainsOf(env);
  const limits = limitsOf(env);
  const to = String(message.to || '').trim().toLowerCase();
  const at = to.lastIndexOf('@');
  const local = to.slice(0, at);
  if (!secret || !domains.length || at < 1 || domains.indexOf(to.slice(at + 1)) === -1 || !await genuine(secret, local)) return reject('address', REJECT.address);
  if (!(message.rawSize <= limits.messageBytes)) return reject('size', REJECT.size(Math.floor(limits.messageBytes / MIB)));

  const store = deps.store || restStore(env, deps);
  if (!store) return reject('address', REJECT.address);
  const hash = await hashOf(local);
  const target = await store.get('mail_capture/' + hash);
  if (!target || target.v !== 1 || (target.kind !== 'u' && target.kind !== 't')) return reject('address', REJECT.address);

  const bytes = new Uint8Array(await new Response(message.raw).arrayBuffer());
  if (bytes.length > limits.messageBytes) return reject('size', REJECT.size(Math.floor(limits.messageBytes / MIB)));
  let mail;
  try { mail = parseMail(toBin(bytes)); } catch (e) { mail = null; }
  if (!mail || !mail.headers.length) return reject('format', REJECT.format);
  /* Respuestas automáticas, rebotes y boletines: ni tarea ni rechazo (un rechazo provocaría otro mensaje). */
  const auto = automatic(mail.headers, message.from);
  if (auto) return drop(auto);
  if (!mail.from) return reject('sender', REJECT.sender);

  /* ¿Quién envía? El From solo cuenta si el mensaje va firmado por su dominio. */
  const signed = await verifyDkim(mail, mail.from.domain, deps);
  if (!signed.pass) return reject('sender-' + signed.reason, REJECT.sender);

  const ref = target.kind === 't' ? {kind: 't', tid: target.tid} : {kind: 'u', uid: target.uid, pid: target.pid};
  const key = keyOf(ref);
  if (target.key !== key || !ID.test(String(ref.tid || ref.pid)) || (ref.kind === 'u' && !ID.test(String(ref.uid)))) return reject('address', REJECT.address);
  const project = await loadProject(ref, store);
  if (project.gone || project.enc) {
    /* Proyecto borrado, o que ha pasado a cifrado total: la dirección sobra. */
    await store.commit([{path: 'mail_capture/' + hash, remove: true}, {path: 'mail_capture_cfg/' + key, remove: true}]);
    return reject('address', REJECT.address);
  }
  let sender = null;
  if (ref.kind === 't') {
    const uid = list(project.team.memberIds).find((id) => {
      const m = project.team.members && project.team.members[id];
      const role = roleIn(project.team, id);
      return m && (role === 'owner' || role === 'editor') && String(m.email || '').trim().toLowerCase() === mail.from.address;
    });
    if (uid) sender = {uid: uid, name: String(project.team.members[uid].name || '').slice(0, 200)};
  } else if (String(target.email || '').toLowerCase() === mail.from.address) {
    sender = {uid: '', name: ''};
  }
  const allow = list(target.allow);
  if (!sender || (allow.length && allow.indexOf(mail.from.address) === -1)) return reject('sender-member', REJECT.sender);

  /* Límites por proyecto y por remitente. */
  const now = deps.now();
  const stamp = new Date(now);
  const day = stamp.getUTCFullYear() + pad(stamp.getUTCMonth() + 1) + pad(stamp.getUTCDate());
  const hour = pad(stamp.getUTCHours());
  const who = (await sha256(mail.from.address)).slice(0, 12);
  const ratePath = 'mail_rate/' + key + '~' + day;
  const rate = (await store.get(ratePath)) || {};
  if ((+rate.n || 0) >= RATE.projectDay || (+rate['h' + hour] || 0) >= RATE.projectHour || (+rate['s' + hour + '_' + who] || 0) >= RATE.senderHour) return reject('rate', REJECT.rate);

  /* Qué va a la tarea. */
  const body = cleanText(mail.text && mail.text.trim() ? mail.text : htmlToText(mail.html || ''), DESC_MAX);
  const title = (mail.subject || 'Correo sin asunto').slice(0, TITLE_MAX);
  const accepted = [], refused = [];
  let total = 0;
  mail.attachments.forEach((file) => {
    const why = blockedFile(file.name, file.type, file.bin) ? 'type' : file.size > limits.fileBytes ? 'size' : !file.size ? 'empty'
      : accepted.length >= limits.files ? 'count' : total + file.size > limits.filesBytes ? 'total' : '';
    if (why) { refused.push({name: file.name, why: why}); return; }
    total += file.size;
    accepted.push(file);
  });

  /* ¿Ya se recibió? Por su Message-ID y por su contenido (el mismo correo reenviado). */
  const marks = [];
  for (const file of accepted) file.hash = await sha256(toBytes(file.bin.slice(0, 65536))) + ':' + file.size;
  const content = await sha256([key, baseSubject(mail.subject), await sha256(body.replace(/\s+/g, ' ')), accepted.map((f) => f.hash).sort().join(',')].join('|'));
  if (mail.messageId) marks.push({kind: 'm', id: await sha256(key + '|m|' + mail.messageId)});
  marks.push({kind: 'c', id: await sha256(key + '|c|' + content)});
  const seenNow = () => Promise.all(marks.map((m) => store.getDoc('mail_seen/' + m.id)));
  const alive = (docs) => docs.filter((d) => d && d.data.key === key && d.data.expireAt > now);
  let seen = await seenNow();
  let taskId = '';
  let resumed = false;
  const before = alive(seen);
  if (before.length) {
    /* Un reintento de un mensaje cuyos adjuntos se quedaron a medias (el proceso se cortó): se
       retoman, sin crear otra tarea. Solo uno puede reclamarlo, y pasado un rato prudencial. */
    const stuck = before.find((d) => d.data.files === 'working' && d.data.filesAt < now - STALE_MS);
    if (!stuck || !accepted.length) return drop('duplicate');
    try {
      await store.commit(before.map((d, i) => ({path: 'mail_seen/' + marks[seen.indexOf(d)].id, patch: {filesAt: now}, updateTime: d.updateTime})));
    } catch (err) {
      if (err && (err.status === 400 || err.status === 409 || err.status === 412)) return drop('duplicate');
      throw err;
    }
    taskId = stuck.data.taskId;
    resumed = true;
  }

  const taskPath = () => project.root + '/tasks/' + taskId;
  const note = (data) => ({path: taskPath() + '/notes/' + newId(), create: Object.assign({kind: 'activity', actorUid: '', actorName: ''}, data)});
  const WHY = {type: 'tipo no permitido', size: 'más de 10 MB', empty: 'vacío', count: 'demasiados adjuntos', total: 'el correo supera el tamaño admitido'};

  if (!resumed) {
    taskId = newId();
    /* La columna configurada; si ya no existe (o no hay ninguna), la primera. */
    const wanted = project.stages.find((s) => s.key === target.stage);
    const stage = wanted || project.stages[0];
    const writes = [{path: taskPath(), create: {title: title, desc: body, status: stage.key, cliente: '', contacto: '', dueDate: '', labels: [], checklist: [],
      order: now, createdAt: now, updatedAt: now}}];
    writes.push(note({text: 'Creada desde un correo de ' + mail.from.address + '.' + (target.stage && !wanted ? ' La columna elegida para el correo ya no existe: se creó en «' + stage.label + '».' : ''), createdAt: now}));
    if (refused.length) {
      writes.push(note({text: 'Adjuntos del correo que no se guardaron: ' + refused.slice(0, 12).map((f) => f.name.slice(0, 60) + ' (' + WHY[f.why] + ')').join(', ') +
        (refused.length > 12 ? ' y ' + (refused.length - 12) + ' más' : '') + '.', createdAt: now + 1}));
    }
    marks.forEach((m, i) => {
      const data = {v: 1, key: key, kind: m.kind, taskId: taskId, at: now, expireAt: now + SEEN_DAYS * DAY_MS, ttl: new Date(now + SEEN_DAYS * DAY_MS),
        files: accepted.length ? 'working' : 'none', filesAt: now};
      /* Una marca caducada se sustituye, siempre que nadie la haya cambiado mientras tanto. */
      writes.push(seen[i] ? {path: 'mail_seen/' + m.id, set: data, updateTime: seen[i].updateTime} : {path: 'mail_seen/' + m.id, create: data});
    });
    const inc = {n: 1};
    inc['h' + hour] = 1;
    inc['s' + hour + '_' + who] = 1;
    writes.push({path: ratePath, patch: {day: day, ttl: new Date(now + 3 * DAY_MS)}, upsert: true, increments: inc});
    try {
      await store.commit(writes);
    } catch (err) {
      /* Dos entregas del mismo mensaje a la vez: la otra llegó antes y esta no ha escrito nada. */
      if (err && (err.status === 400 || err.status === 409 || err.status === 412) && alive(await seenNow()).length) return drop('duplicate');
      throw err;
    }
  }
  if (!accepted.length) { log('captura: tarea creada'); return {result: 'created', code: 'created', taskId: taskId, files: 0, refused: refused.length}; }

  /* Adjuntos: en trozos, como los sube la app. La tarea ya existe; si esto falla, se dice en ella. */
  const written = [];
  const finish = (files) => marks.map((m) => ({path: 'mail_seen/' + m.id, patch: {files: files, filesAt: deps.now()}}));
  try {
    const out = [];
    let batch = [], size = 0;
    const flush = async () => {
      if (!batch.length) return;
      if (deps.now() - started > limits.ms) throw Object.assign(new Error('timeout'), {code: 'timeout'});
      await store.commit(batch);
      batch.forEach((w) => written.push(w.path));
      batch = [];
      size = 0;
    };
    for (const file of accepted) {
      const parts = [];
      for (let from = 0; from < file.bin.length; from += FILE_CHUNK_BYTES) {
        const id = newId();
        const data = FILE_PREFIX + btoa(file.bin.slice(from, from + FILE_CHUNK_BYTES));
        if (size + data.length > 5500000) await flush();
        batch.push({path: project.assets + '/' + id, create: {data: data, contentType: 'application/octet-stream', createdAt: now}});
        size += data.length;
        parts.push(id);
      }
      out.push({name: file.name, type: file.type.slice(0, 120), size: file.size, image: false, parts: parts});
    }
    await flush();
    await store.commit([{path: taskPath() + '/notes/' + newId(), create: {text: '', imageAssetId: '', createdAt: now + 2, kind: sender.uid ? 'comment' : 'note',
      actorUid: sender.uid, actorName: sender.name, attachments: out, assetIds: out.reduce((ids, a) => ids.concat(a.parts), [])}}].concat(finish('done')));
  } catch (err) {
    /* Nada de trozos sueltos: se borran los que llegaron a escribirse y la tarea lo cuenta. */
    try {
      for (let i = 0; i < written.length; i += 200) await store.commit(written.slice(i, i + 200).map((path) => ({path: path, remove: true})));
      await store.commit([note({text: 'No se pudieron guardar los adjuntos del correo (' + accepted.length + ').', createdAt: now + 2})].concat(finish('failed')));
    } catch (e) { /* se queda en 'working': un reintento del mismo mensaje lo retoma */ }
    log('captura: tarea creada, adjuntos sin guardar (' + ((err && err.code) || 'error') + ')');
    return {result: 'created', code: 'files-failed', taskId: taskId, files: 0, refused: refused.length};
  }
  log('captura: tarea creada con ' + accepted.length + ' adjuntos');
  return {result: 'created', code: resumed ? 'files-resumed' : 'created', taskId: taskId, files: accepted.length, refused: refused.length};
}

/* ---------- Limpieza (la lanza el cron del Worker) ---------- */

const SWEEP_BATCH = 100;
const RATE_DAYS = 3;

/* Borra lo caducado: las marcas de correos recibidos (30 días) y los contadores (3 días). Lo hace
   el cron porque el borrado automático de Firestore (TTL) exige tener la facturación activada.
   Como mucho SWEEP_BATCH de cada por vuelta: lo que quede, en la siguiente. → {seen, rate} */
export async function sweep(env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  const store = deps.store || restStore(env, deps);
  if (!store) return {configured: false, seen: 0, rate: 0};
  const now = deps.now();
  const cut = new Date(now - RATE_DAYS * DAY_MS);
  const day = cut.getUTCFullYear() + pad(cut.getUTCMonth() + 1) + pad(cut.getUTCDate());
  const [seen, rate] = await Promise.all([store.olderThan('mail_seen', 'expireAt', now, SWEEP_BATCH), store.olderThan('mail_rate', 'day', day, SWEEP_BATCH)]);
  const writes = seen.map((id) => ({path: 'mail_seen/' + id, remove: true})).concat(rate.map((id) => ({path: 'mail_rate/' + id, remove: true})));
  if (writes.length) await store.commit(writes);
  return {configured: true, seen: seen.length, rate: rate.length};
}

export const LIMITS = {plans: PLANS, rate: RATE, seenDays: SEEN_DAYS, allowMax: ALLOW_MAX};
