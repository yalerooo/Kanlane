/* Correos de la cuenta: «verifica tu correo» y «cambia tu contraseña», enviados por Kanlane en vez
   de por Firebase, para que el mensaje sea el nuestro (con botón, en el idioma de la persona) y no
   dependa de que la asistencia de Firebase cambie una plantilla. Guía: docs/CORREOS-CUENTA.md.

   Cómo funciona: la app llama a /__/mail/v1 (worker/index.js). Aquí se le pide a Firebase el enlace
   de un solo uso (API de Identity Toolkit, `accounts:sendOobCode` con `returnOobLink`: Firebase lo
   genera pero no envía nada), se monta el mensaje y se envía con Resend (https://resend.com).
   El enlace lleva a la app (/app/?mode=…&oobCode=…), que lo atiende (AuthController.resolveAction).

   Si algo falla (sin configurar, cupo agotado, Resend caído), la ruta responde 503 y la app recurre
   al envío de Firebase de siempre (src/services/firebase-backend.js): nadie se queda sin correo.

   De quién fiarse:
   - 'verify': a quién se escribe sale del ID token (cuenta y correo), nunca del cuerpo.
   - 'reset': el correo lo escribe cualquiera, así que solo se envía si la cuenta existe y la
     respuesta es la misma exista o no. No sirve para escribir a direcciones ajenas a Kanlane.
   El texto lo compone el Worker; del navegador solo llegan el idioma y, en 'reset', el correo.

   Topes (días en UTC): por cuenta y por correo, para que nadie llene un buzón; y uno global, por
   debajo de los 100 correos al día del plan gratuito de Resend. Se cuentan los intentos, no los
   envíos. Contadores en mail_rate/{clave}~{día}, colección cerrada a los clientes (no está en
   firestore.rules); el cron borra los de días pasados.

   Secretos: RESEND_API_KEY y FIREBASE_SERVICE_ACCOUNT (con el rol «Administrador de Firebase
   Authentication»). Variable: MAIL_FROM. Sin ellos la ruta responde «not-configured». */
import {restStore, accessToken} from './automations.mjs';

const DEFAULT_PROJECT = 'workhub-26f50';
const DEFAULT_ORIGIN = 'https://kanlane.com';
const AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const RESEND_URL = 'https://api.resend.com/emails';
const LANGS = ['es', 'en'];
const EMAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/;
const EMAIL_MAX = 254;
const CODE = /^[A-Za-z0-9_-]{8,512}$/;
const DAY_MS = 86400000;
/* Correos de verificación que puede pedir una cuenta al día, y de cambio de contraseña por correo. */
const VERIFY_PER_DAY = 8;
const RESET_PER_DAY = 5;
/* Entre todos, al día: por debajo del tope del plan gratuito de Resend (100). MAIL_DAILY_MAX lo cambia. */
const ALL_PER_DAY = 90;
const RATE_DAYS = 3;
const SWEEP_BATCH = 100;

const pad = (n) => String(n).padStart(2, '0');
const reply = (status, body) => ({status: status, body: body});
const dayOf = (now) => { const d = new Date(now); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); };
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const digest = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).slice(0, 40);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Texto de una línea: sin saltos, caracteres de control ni invisibles. */
function line(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* ---------- El mensaje ---------- */

const TEXTS = {
  es: {
    verify: {
      subject: 'Verifica tu correo en Kanlane',
      preview: 'Confirma tu dirección para empezar a usar Kanlane.',
      title: 'Verifica tu correo',
      hello: (name) => (name ? 'Hola, ' + name + ':' : 'Hola:'),
      body: () => 'Confirma tu dirección de correo para empezar a usar Kanlane.',
      button: 'Verificar correo',
      ignore: 'Si no has creado una cuenta en Kanlane, ignora este mensaje.'
    },
    reset: {
      subject: 'Restablece tu contraseña de Kanlane',
      preview: 'Elige una contraseña nueva para tu cuenta de Kanlane.',
      title: 'Cambia tu contraseña',
      hello: () => 'Hola:',
      body: (email) => 'Hemos recibido una solicitud para cambiar la contraseña de la cuenta de Kanlane de ' + email + '.',
      button: 'Cambiar contraseña',
      ignore: 'Si no has pedido este cambio, ignora este correo: tu contraseña sigue siendo la misma.'
    },
    fallback: 'Si el botón no funciona, copia este enlace en tu navegador:',
    once: 'El enlace solo se puede usar una vez.',
    foot: 'Kanlane · Tareas, clientes y contraseñas en un solo sitio'
  },
  en: {
    verify: {
      subject: 'Verify your email for Kanlane',
      preview: 'Confirm your address to start using Kanlane.',
      title: 'Verify your email',
      hello: (name) => (name ? 'Hi ' + name + ',' : 'Hi,'),
      body: () => 'Confirm your email address to start using Kanlane.',
      button: 'Verify email',
      ignore: 'If you didn\'t create a Kanlane account, you can ignore this message.'
    },
    reset: {
      subject: 'Reset your Kanlane password',
      preview: 'Choose a new password for your Kanlane account.',
      title: 'Change your password',
      hello: () => 'Hi,',
      body: (email) => 'We received a request to change the password of the Kanlane account for ' + email + '.',
      button: 'Change password',
      ignore: 'If you didn\'t ask for this, ignore this email: your password stays the same.'
    },
    fallback: 'If the button doesn\'t work, copy this link into your browser:',
    once: 'The link can only be used once.',
    foot: 'Kanlane · Tasks, clients and passwords in one place'
  }
};

const FONT = '-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';

/* kind: 'verify' | 'reset'. info: {link, name, email, origin}. → {subject, html, text}
   El HTML va con tablas y estilos en línea, que es lo que entienden todos los clientes de correo. */
export function compose(kind, lang, info) {
  const all = TEXTS[LANGS.indexOf(lang) !== -1 ? lang : 'es'];
  const t = all[kind];
  const hello = t.hello(line(info.name, 60));
  const body = t.body(info.email);
  const link = esc(info.link);
  const text = [hello, '', body, '', t.button + ': ' + info.link, '', all.once + ' ' + t.ignore, '', '-- ', all.foot].join('\n');
  const html = '<!doctype html><html lang="' + (all === TEXTS.en ? 'en' : 'es') + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">' +
    '<title>' + esc(t.subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f4f4f5;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' + esc(t.preview) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:32px 16px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">' +
    '<tr><td style="padding:0 4px 20px;font-family:' + FONT + ';">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td style="padding-right:10px;"><img src="' + esc(info.origin) + '/assets/img/icon-192.png" width="32" height="32" alt="" style="display:block;border:0;border-radius:9px;"></td>' +
      '<td style="font-family:' + FONT + ';font-size:17px;font-weight:600;color:#18181b;">Kanlane</td>' +
      '</tr></table></td></tr>' +
    '<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:32px 28px;font-family:' + FONT + ';color:#18181b;">' +
      '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:650;color:#18181b;">' + esc(t.title) + '</h1>' +
      '<p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:#3f3f46;">' + esc(hello) + '</p>' +
      '<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#3f3f46;">' + esc(body) + '</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#18181b" style="border-radius:10px;">' +
        '<a href="' + link + '" target="_blank" style="display:inline-block;padding:13px 26px;font-family:' + FONT + ';font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">' + esc(t.button) + '</a>' +
      '</td></tr></table>' +
      '<p style="margin:24px 0 6px;font-size:13px;line-height:1.5;color:#71717a;">' + esc(all.fallback) + '</p>' +
      '<p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="' + link + '" target="_blank" style="color:#52525b;">' + link + '</a></p>' +
      '<p style="margin:0;padding-top:20px;border-top:1px solid #e4e4e7;font-size:13px;line-height:1.5;color:#71717a;">' + esc(all.once) + ' ' + esc(t.ignore) + '</p>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:20px 4px 0;font-family:' + FONT + ';font-size:12px;line-height:1.5;color:#a1a1aa;">' + esc(all.foot) + '</td></tr>' +
    '</table></td></tr></table></body></html>';
  return {subject: t.subject, html: html, text: text};
}

/* ---------- Firebase: el enlace de un solo uso ---------- */

function accountOf(env) {
  try {
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '');
    return account && account.client_email && account.private_key ? account : null;
  } catch (e) { return null; }
}

/* El código que Firebase genera para ese correo, sin enviar nada; null si no hay cuenta.
   type: 'VERIFY_EMAIL' | 'PASSWORD_RESET'. Con FIREBASE_AUTH_EMULATOR_HOST (pruebas), el emulador. */
async function oobCode(type, email, env, deps) {
  const emulator = env.FIREBASE_AUTH_EMULATOR_HOST;
  const account = emulator ? null : accountOf(env);
  const project = env.FIREBASE_PROJECT || (account && account.project_id) || DEFAULT_PROJECT;
  const base = emulator ? 'http://' + emulator + '/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com';
  const token = account ? await accessToken(account, deps, AUTH_SCOPE) : 'owner';
  const res = await deps.fetch(base + '/v1/projects/' + project + '/accounts:sendOobCode', {
    method: 'POST',
    headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'},
    body: JSON.stringify({requestType: type, email: email, returnOobLink: true})
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const why = String((data && data.error && data.error.message) || '');
    if (res.status === 400 && /^(EMAIL_NOT_FOUND|USER_NOT_FOUND|USER_DISABLED)/.test(why)) return null;
    throw new Error('oob ' + res.status + ' ' + why.slice(0, 60));
  }
  let code = '';
  try { code = new URL(data.oobLink).searchParams.get('oobCode') || ''; } catch (e) { code = ''; }
  return CODE.test(code) ? code : null;
}

/* ---------- Resend ---------- */

async function resend(mail, env, deps) {
  const res = await deps.fetch(RESEND_URL, {
    method: 'POST',
    headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'},
    body: JSON.stringify({from: mail.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text})
  });
  if (!res.ok) throw new Error('resend ' + res.status);
}

/* ---------- Ruta /__/mail/v1 ---------- */

/* who: {uid, email, emailVerified, name} del ID token ya verificado, o null (sin sesión).
   body: {op: 'verify', lang} | {op: 'reset', email, lang}. → {status, body}:
   200 {sent}, 400, 401, 429 (demasiados para esa cuenta o correo) o 503 (que lo envíe Firebase).
   deps.send(mail, env): en las pruebas y en desarrollo, en vez de Resend. */
export async function manage(who, body, env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  const from = line(env.MAIL_FROM, 120);
  const store = deps.store || restStore(env, deps);
  const ready = from && store && (deps.send || env.RESEND_API_KEY) && (env.FIREBASE_AUTH_EMULATOR_HOST || accountOf(env));
  if (!ready) return reply(503, {error: 'not-configured'});
  if (!body || (body.op !== 'verify' && body.op !== 'reset')) return reply(400, {error: 'request'});
  const verify = body.op === 'verify';
  const lang = LANGS.indexOf(body.lang) !== -1 ? body.lang : 'es';

  let email;
  if (verify) {
    if (!who || !who.uid || !who.email) return reply(401, {error: 'auth'});
    if (who.emailVerified) return reply(200, {v: 1, sent: false, verified: true});
    email = who.email;
  } else {
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > EMAIL_MAX || !EMAIL.test(email)) return reply(400, {error: 'request'});
  }

  /* Los topes, antes de pedir nada a Firebase: se cuenta el intento, exista o no la cuenta. */
  const now = deps.now();
  const day = dayOf(now);
  const minePath = 'mail_rate/' + (verify ? 'v-' + who.uid : 'r-' + await digest(email)) + '~' + day;
  const allPath = 'mail_rate/all~' + day;
  const [mine, all] = await Promise.all([store.get(minePath), store.get(allPath)]);
  if (mine && (+mine.n || 0) >= (verify ? VERIFY_PER_DAY : RESET_PER_DAY)) return reply(429, {error: 'rate'});
  if (all && (+all.n || 0) >= (+env.MAIL_DAILY_MAX || ALL_PER_DAY)) return reply(503, {error: 'quota'});
  const count = (path) => ({path: path, patch: {day: day}, upsert: true, increments: {n: 1}});

  const code = await oobCode(verify ? 'VERIFY_EMAIL' : 'PASSWORD_RESET', email, env, deps);
  if (!code) {
    await store.commit([count(minePath)]);
    /* Sin cuenta con ese correo: no se envía nada y no se dice. */
    return verify ? reply(503, {error: 'unavailable'}) : reply(200, {v: 1, sent: true});
  }
  await store.commit([count(minePath), count(allPath)]);

  const origin = String(env.MAIL_LINK_ORIGIN || env.REDIRECT_TARGET || DEFAULT_ORIGIN).replace(/\/+$/, '');
  const link = origin + '/app/?mode=' + (verify ? 'verifyEmail' : 'resetPassword') + '&oobCode=' + code + '&lang=' + lang;
  const mail = Object.assign({from: from, to: email}, compose(body.op, lang, {link: link, name: verify ? who.name : '', email: email, origin: origin}));
  await (deps.send ? deps.send(mail, env) : resend(mail, env, deps));
  return reply(200, {v: 1, sent: true});
}

/* ---------- Limpieza (la lanza el cron del Worker) ---------- */

/* Borra los contadores de días pasados; como mucho SWEEP_BATCH por vuelta. → {configured, rate} */
export async function sweep(env, deps) {
  deps = Object.assign({fetch: (url, init) => fetch(url, init), now: () => Date.now()}, deps);
  const store = deps.store || restStore(env, deps);
  if (!store || !env.MAIL_FROM) return {configured: false, rate: 0};
  const old = await store.olderThan('mail_rate', 'day', dayOf(deps.now() - RATE_DAYS * DAY_MS), SWEEP_BATCH);
  if (old.length) await store.commit(old.map((id) => ({path: 'mail_rate/' + id, remove: true})));
  return {configured: true, rate: old.length};
}

export const LIMITS = {verifyPerDay: VERIFY_PER_DAY, resetPerDay: RESET_PER_DAY, allPerDay: ALL_PER_DAY};
