/* Avisos con Kanlane cerrado: notificaciones push a los miembros de un equipo cuando alguien los
   menciona en un comentario, les asigna una tarea o pasa algo en una tarea que siguen.
   Guía: docs/NOTIFICACIONES.md.

   Cómo funciona, sin Cloud Functions: el navegador de quien comenta, asigna o mueve la tarea avisa
   a este Worker (ruta /__/notify/v1 de worker/index.js, con su ID token de Firebase ya verificado)
   y el Worker envía el push (worker/webpush.mjs) a los navegadores que cada destinatario activó.

   De quién fiarse: el navegador solo dice qué pasó y en qué tarea. Quién lo envía sale del token;
   que pueda escribir en ese equipo, del documento del equipo; a quién se avisa, de la tarea
   (seguidores y asignados) y de la lista de miembros. Solo se avisa a miembros del equipo, nunca a
   quien lo provoca, y el texto lo compone el Worker: el navegador no puede escribir el aviso.

   Qué dice el aviso: quién, qué y el título de la tarea; nunca el texto del comentario. En un
   proyecto con cifrado total el Worker no puede leer la tarea: el aviso solo dice que hay
   novedades en el proyecto.

   Dónde se guarda: push_subs/{id} = {uid, endpoint, p256dh, auth, lang, createdAt} (un documento
   por navegador que activó los avisos) y notify_rate/{uid}~{día} (contador). Las dos colecciones
   están cerradas a los clientes: solo entra la cuenta de servicio del Worker.

   Secretos: VAPID_PUBLIC, VAPID_PRIVATE y VAPID_SUBJECT (scripts/make-vapid.js los genera) y
   FIREBASE_SERVICE_ACCOUNT. Sin ellos, la ruta responde «not-configured» y la app no ofrece nada. */
import {restStore} from './automations.mjs';
import {loadProject, roleIn} from './capture.mjs';
import {send, validVapid, allowedEndpoint} from './webpush.mjs';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const P256DH = /^[A-Za-z0-9_-]{86,88}$/;
const AUTH = /^[A-Za-z0-9_-]{22,24}$/;
const KINDS = ['comment', 'assigned', 'moved'];
const LANGS = ['es', 'en'];
const DAY_MS = 86400000;
/* Navegadores con avisos por cuenta: al pasar de ahí, se retira el más antiguo. */
const SUBS_MAX = 10;
/* Por aviso: a cuántas personas y cuántos envíos (un Worker gratuito hace 50 subpeticiones por
   petición, y varias se van en leer el equipo, la tarea y las suscripciones). */
const RECIPIENTS_MAX = 30;
const PUSH_MAX = 35;
/* Avisos que puede provocar una cuenta al día (UTC). */
const EVENTS_PER_DAY = 500;
const RATE_DAYS = 3;
const SWEEP_BATCH = 100;
const TTL_SECONDS = 86400;

const list = (v) => (Array.isArray(v) ? v : []);
const pad = (n) => String(n).padStart(2, '0');
const reply = (status, body) => ({status: status, body: body});
const dayOf = (now) => { const d = new Date(now); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); };
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const subId = async (endpoint) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).slice(0, 40);

/* Texto de una línea: sin saltos, caracteres de control ni invisibles. */
function line(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function vapidOf(env) {
  const vapid = {publicKey: String(env.VAPID_PUBLIC || ''), privateKey: String(env.VAPID_PRIVATE || ''), subject: String(env.VAPID_SUBJECT || '')};
  return validVapid(vapid) ? vapid : null;
}

/* ---------- Textos del aviso ---------- */

const TEXTS = {
  es: {
    someone: 'Alguien',
    mention: (a) => a + ' te mencionó',
    assigned: (a) => a + ' te asignó una tarea',
    comment: (a) => a + ' comentó en una tarea que sigues',
    moved: (a) => a + ' movió una tarea que sigues',
    sealed: (p) => 'Tienes novedades en «' + p + '»',
    untitled: 'Sin título'
  },
  en: {
    someone: 'Someone',
    mention: (a) => a + ' mentioned you',
    assigned: (a) => a + ' assigned you a task',
    comment: (a) => a + ' commented on a task you follow',
    moved: (a) => a + ' moved a task you follow',
    sealed: (p) => 'There is news in «' + p + '»',
    untitled: 'Untitled'
  }
};

/* what: 'mention' | 'assigned' | 'comment' | 'moved'. info: {actor, title, project, column, sealed}. */
export function message(what, lang, info) {
  const t = TEXTS[LANGS.indexOf(lang) !== -1 ? lang : 'es'];
  if (info.sealed) return {title: 'Kanlane', body: t.sealed(info.project)};
  const title = '«' + (info.title || t.untitled) + '»';
  return {title: t[what](info.actor || t.someone),
    body: what === 'moved' && info.column ? title + ' → ' + info.column : title + (info.project ? ' · ' + info.project : '')};
}

/* ---------- Ruta /__/notify/v1 (con el ID token ya verificado) ---------- */

/* who: {uid} (del token de Firebase, nunca del cuerpo). body.op:
   - 'key' → {key}: la clave pública con la que el navegador se suscribe.
   - 'subscribe' {endpoint, p256dh, auth, lang} y 'unsubscribe' {endpoint}: este navegador.
   - 'purge': fuera todas las suscripciones de la cuenta (al eliminarla).
   - 'event' {tid, taskId, kind, to}: ha pasado algo en una tarea de un equipo. kind:
       'comment'  → a quien sigue la tarea; `to` son los uid mencionados en el comentario.
       'assigned' → a los uid de `to` que de verdad estén asignados a la tarea.
       'moved'    → a quien sigue la tarea.
   → {status, body}. */
export async function manage(who, body, env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  const vapid = vapidOf(env);
  const store = deps.store || restStore(env, deps);
  if (!vapid || !store) return reply(503, {error: 'not-configured'});
  if (!body || typeof body.op !== 'string') return reply(400, {error: 'request'});
  const now = deps.now();

  if (body.op === 'key') return reply(200, {v: 1, key: vapid.publicKey});

  if (body.op === 'purge') {
    const mine = await store.where('push_subs', 'uid', who.uid, SUBS_MAX * 2);
    if (mine.length) await store.commit(mine.map((s) => ({path: 'push_subs/' + s.id, remove: true})));
    return reply(200, {v: 1, removed: mine.length});
  }

  if (body.op === 'subscribe' || body.op === 'unsubscribe') {
    if (!allowedEndpoint(body.endpoint)) return reply(400, {error: 'endpoint'});
    const id = await subId(body.endpoint);
    const have = await store.get('push_subs/' + id);
    if (body.op === 'unsubscribe') {
      if (have && have.uid === who.uid) await store.commit([{path: 'push_subs/' + id, remove: true}]);
      return reply(200, {v: 1, on: false});
    }
    if (typeof body.p256dh !== 'string' || !P256DH.test(body.p256dh) || typeof body.auth !== 'string' || !AUTH.test(body.auth)) return reply(400, {error: 'request'});
    const lang = LANGS.indexOf(body.lang) !== -1 ? body.lang : 'es';
    /* Ya está al día (la app lo repite al abrirse): nada que escribir. */
    if (have && have.uid === who.uid && have.p256dh === body.p256dh && have.auth === body.auth && have.lang === lang) return reply(200, {v: 1, on: true});
    const writes = [{path: 'push_subs/' + id, set: {uid: who.uid, endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth, lang: lang, createdAt: now}}];
    if (!have || have.uid !== who.uid) {
      const mine = (await store.where('push_subs', 'uid', who.uid, SUBS_MAX * 2)).sort((a, b) => (a.data.createdAt || 0) - (b.data.createdAt || 0));
      mine.slice(0, Math.max(0, mine.length - SUBS_MAX + 1)).forEach((s) => writes.push({path: 'push_subs/' + s.id, remove: true}));
    }
    await store.commit(writes);
    return reply(200, {v: 1, on: true});
  }

  if (body.op !== 'event') return reply(400, {error: 'request'});
  if (typeof body.tid !== 'string' || !ID.test(body.tid) || typeof body.taskId !== 'string' || !ID.test(body.taskId) || KINDS.indexOf(body.kind) === -1) return reply(400, {error: 'request'});
  const project = await loadProject({kind: 't', tid: body.tid}, store);
  const role = project.gone ? '' : roleIn(project.team, who.uid);
  /* Lo mismo para «no existe» y «no es tuyo»: no se dice cuál. */
  if (!role) return reply(404, {error: 'project'});
  if (role === 'viewer') return reply(403, {error: 'role'});
  const ratePath = 'notify_rate/' + who.uid + '~' + dayOf(now);
  const rate = await store.get(ratePath);
  if (rate && (+rate.n || 0) >= EVENTS_PER_DAY) return reply(429, {error: 'rate'});
  const task = await store.get(project.root + '/tasks/' + body.taskId);
  if (!task) return reply(404, {error: 'task'});

  /* A quién y por qué. Lo directo (mención, asignación) manda sobre «sigues esta tarea». */
  const members = list(project.team.memberIds);
  const asked = list(body.to).filter((u) => typeof u === 'string' && ID.test(u)).slice(0, RECIPIENTS_MAX);
  const assignees = list(task.assignees);
  const why = {};
  const add = (uid, what) => { if (uid !== who.uid && members.indexOf(uid) !== -1 && !why[uid]) why[uid] = what; };
  if (body.kind === 'comment') asked.forEach((u) => add(u, 'mention'));
  if (body.kind === 'assigned') asked.filter((u) => assignees.indexOf(u) !== -1).forEach((u) => add(u, 'assigned'));
  else list(task.followers).forEach((u) => add(u, body.kind));
  const uids = Object.keys(why).slice(0, RECIPIENTS_MAX);
  const count = {path: ratePath, patch: {day: dayOf(now), uid: who.uid}, upsert: true, increments: {n: 1}};
  if (!uids.length) {
    await store.commit([count]);
    return reply(200, {v: 1, sent: 0});
  }

  const subs = (await store.whereIn('push_subs', 'uid', uids, PUSH_MAX)).filter((s) => why[s.data.uid]);
  const member = project.team.members && project.team.members[who.uid];
  const stage = project.stages.find((s) => s.key === task.status) || project.stages[0];
  const info = {actor: line(member && member.name, 60), title: line(task.title, 120), project: line(project.doc.nombre, 80),
    column: stage ? line(stage.label, 60) : '', sealed: !!(project.enc || task.ev)};
  const results = await Promise.all(subs.map(async (s) => {
    const payload = Object.assign(message(why[s.data.uid], s.data.lang, info), {tag: 'kl-' + body.taskId, project: 't:' + body.tid, task: body.taskId});
    const res = await send(s.data, JSON.stringify(payload), vapid, {ttl: TTL_SECONDS, fetch: deps.fetch, now: now});
    return {id: s.id, ok: res.ok, gone: res.gone};
  }));
  /* El navegador ya no quiere avisos (los quitó o desinstaló la app): su suscripción sobra. */
  const writes = results.filter((r) => r.gone).map((r) => ({path: 'push_subs/' + r.id, remove: true}));
  await store.commit(writes.concat(count));
  return reply(200, {v: 1, sent: results.filter((r) => r.ok).length});
}

/* ---------- Limpieza (la lanza el cron del Worker) ---------- */

/* Borra los contadores de días pasados; como mucho SWEEP_BATCH por vuelta. → {configured, rate} */
export async function sweep(env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  const store = deps.store || restStore(env, deps);
  if (!store || !vapidOf(env)) return {configured: false, rate: 0};
  const old = await store.olderThan('notify_rate', 'day', dayOf(deps.now() - RATE_DAYS * DAY_MS), SWEEP_BATCH);
  if (old.length) await store.commit(old.map((id) => ({path: 'notify_rate/' + id, remove: true})));
  return {configured: true, rate: old.length};
}

export const LIMITS = {subs: SUBS_MAX, recipients: RECIPIENTS_MAX, pushes: PUSH_MAX, eventsPerDay: EVENTS_PER_DAY};
