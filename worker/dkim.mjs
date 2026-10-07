/* Comprobación de la firma DKIM (RFC 6376) de un correo, para la captura de tareas.

   Por qué hace falta: la cabecera From la escribe quien envía, así que por sí sola no prueba nada.
   Cloudflare Email Routing rechaza el correo que no pasa ni SPF ni DKIM, pero no le dice al Worker
   cuál pasó ni con qué dominio. Aquí se comprueba lo que de verdad importa para decidir si el
   remitente es quien dice: que el mensaje va firmado por el dominio de su From (o por uno del que
   cuelga), que la firma cubre el From y que el cuerpo no ha cambiado.

   Qué se acepta: rsa-sha256 y cuerpo entero (una firma con «l=», que deja añadir texto al final,
   no vale). Lo que no se puede comprobar se trata como no firmado. */
import {toBytes} from './mime.mjs';

const MAX_SIGNATURES = 5;
const SKEW = 5 * 60;

const b64 = (bytes) => { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = (text) => { const bin = atob(String(text).replace(/[^A-Za-z0-9+/=]/g, '')); return toBytes(bin); };

/* «a=rsa-sha256; d=ejemplo.com; …» → {a, d, …} */
export function tags(value) {
  const out = {};
  String(value || '').split(';').forEach((piece) => {
    const eq = piece.indexOf('=');
    if (eq < 1) return;
    const key = piece.slice(0, eq).trim();
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !(key in out)) out[key] = piece.slice(eq + 1).trim();
  });
  return out;
}

/* El dominio que firma vale para ese From si es el mismo o uno del que cuelga (alineación
   «relajada»). Nadie puede publicar claves en un dominio que no es suyo, así que un padre común
   como «com» nunca llega a tener firma. */
export function aligned(signer, fromDomain) {
  const d = String(signer || '').toLowerCase(), f = String(fromDomain || '').toLowerCase();
  return d.indexOf('.') > 0 && (d === f || f.endsWith('.' + d));
}

export function canonBody(body, mode) {
  let s = String(body).replace(/\r?\n/g, '\r\n');
  if (mode === 'relaxed') s = s.split('\r\n').map((line) => line.replace(/[ \t]+/g, ' ').replace(/ $/, '')).join('\r\n');
  s = s.replace(/(\r\n)+$/, '');
  return mode === 'relaxed' ? (s ? s + '\r\n' : '') : s + '\r\n';
}

export function canonHeader(raw, mode) {
  if (mode !== 'relaxed') return raw;
  const colon = raw.indexOf(':');
  return raw.slice(0, colon).trim().toLowerCase() + ':' + raw.slice(colon + 1).replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').trim();
}

/* Lo que se firma: las cabeceras de «h=» (cada nombre, de abajo arriba) y la propia firma con «b=» vacío. */
export function signedData(headers, signature, list, mode) {
  const used = {};
  let out = '';
  list.forEach((name) => {
    const lower = name.trim().toLowerCase();
    const all = headers.filter((h) => h.lower === lower);
    const pick = all[all.length - 1 - (used[lower] || 0)];
    used[lower] = (used[lower] || 0) + 1;
    if (pick) out += canonHeader(pick.raw, mode) + '\r\n';
  });
  const colon = signature.raw.indexOf(':');
  const emptied = signature.raw.slice(0, colon + 1) + signature.raw.slice(colon + 1).replace(/(^|;)((?:\s|\r\n)*b(?:\s|\r\n)*=)[^;]*/, '$1$2');
  return out + canonHeader(emptied, mode);
}

/* Registro TXT de la clave, por DNS sobre HTTPS. */
export async function resolveTxt(name, fetcher) {
  const res = await (fetcher || fetch)('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=TXT',
    {headers: {accept: 'application/dns-json'}, signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined});
  if (!res.ok) throw new Error('dns ' + res.status);
  const data = await res.json();
  return (data.Answer || []).filter((a) => a.type === 16).map((a) => String(a.data || '').replace(/"\s*"/g, '').replace(/^"|"$/g, ''));
}

/* mail: {headers, body} de mime.splitMessage. deps: {resolveTxt(name) → [texto], now() → ms}.
   → {pass:true, domain} | {pass:false, reason}
   reason: 'none' (sin firma del dominio del remitente), 'unsupported', 'expired', 'body' (el cuerpo
   cambió), 'key' (no hay clave publicada), 'signature' (la firma no corresponde), 'dns'. */
export async function verifyDkim(mail, fromDomain, deps) {
  const now = Math.floor(deps.now() / 1000);
  const candidates = mail.headers.filter((h) => h.lower === 'dkim-signature').slice(0, MAX_SIGNATURES);
  let reason = 'none';
  for (const header of candidates) {
    const t = tags(header.value);
    if (!aligned(t.d, fromDomain)) continue;
    const list = String(t.h || '').split(':').map((x) => x.trim()).filter(Boolean);
    const canon = String(t.c || 'simple/simple').toLowerCase().split('/');
    const headerMode = canon[0], bodyMode = canon[1] || 'simple';
    if (t.v !== '1' || String(t.a).toLowerCase() !== 'rsa-sha256' || !t.s || !t.bh || !t.b || 'l' in t
      || ['simple', 'relaxed'].indexOf(headerMode) === -1 || ['simple', 'relaxed'].indexOf(bodyMode) === -1
      || !/^[A-Za-z0-9._-]{1,100}$/.test(t.s) || !/^[A-Za-z0-9.-]{3,253}$/.test(t.d)
      || !list.some((n) => n.toLowerCase() === 'from')) { reason = 'unsupported'; continue; }
    if ((t.x && +t.x + SKEW < now) || (t.t && +t.t - SKEW > now)) { reason = 'expired'; continue; }

    const hash = b64(await crypto.subtle.digest('SHA-256', toBytes(canonBody(mail.body, bodyMode))));
    if (hash !== t.bh.replace(/\s+/g, '')) { reason = 'body'; continue; }

    let records;
    try { records = await deps.resolveTxt(t.s + '._domainkey.' + t.d.toLowerCase()); } catch (e) { reason = 'dns'; continue; }
    const record = (records || []).map(tags).find((r) => r.p !== undefined && (!r.v || r.v === 'DKIM1'));
    if (!record || !record.p || (record.k && record.k.toLowerCase() !== 'rsa')) { reason = 'key'; continue; }
    try {
      const key = await crypto.subtle.importKey('spki', unb64(record.p), {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(t.b), toBytes(signedData(mail.headers, header, list, headerMode)));
      if (ok) return {pass: true, domain: t.d.toLowerCase()};
      reason = 'signature';
    } catch (e) {
      reason = 'key';
    }
  }
  return {pass: false, reason: reason};
}
