/* Lectura de un correo (RFC 5322 y MIME) para la captura de tareas (worker/capture.mjs).
   Sin dependencias y sin efectos: recibe los bytes del mensaje y devuelve lo que la captura
   necesita, ya saneado. Nada de lo que hay aquí abre, ejecuta ni descarga nada: un adjunto es una
   ristra de bytes con un nombre, y un enlace o una imagen del cuerpo, texto.

   El mensaje se trabaja como «cadena binaria» (un carácter por byte): así se puede cortar por los
   separadores MIME sin estropear los adjuntos, y cada trozo de texto se decodifica con su juego de
   caracteres solo al final. */

/* ---------- Bytes y texto ---------- */

export function toBin(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return out;
}

export function toBytes(bin) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
  return out;
}

/* Texto de una cadena binaria en el juego de caracteres que dice el correo (UTF-8 si no vale). */
export function decodeText(bin, charset) {
  const bytes = toBytes(bin);
  const name = String(charset || 'utf-8').trim().toLowerCase();
  try {
    return new TextDecoder(name === 'us-ascii' || name === 'ascii' ? 'utf-8' : name).decode(bytes);
  } catch (e) {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/* Un valor de cabecera con bytes de 8 bits sin declarar: UTF-8 si lo es; si no, Latin-1. */
function rawHeaderText(bin) {
  if (!/[\x80-\xff]/.test(bin)) return bin;
  try { return new TextDecoder('utf-8', {fatal: true}).decode(toBytes(bin)); } catch (e) { return bin; }
}

function fromBase64(text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
  try { return atob(clean.slice(0, clean.length - (clean.length % 4 === 1 ? 1 : 0))); } catch (e) { return ''; }
}

function fromQuotedPrintable(text, header) {
  let s = String(text);
  if (header) s = s.replace(/_/g, ' ');
  else s = s.replace(/=[ \t]*\r?\n/g, '');
  return s.replace(/=([0-9A-Fa-f]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/* Palabras codificadas de las cabeceras (RFC 2047): =?utf-8?B?…?= y =?iso-8859-1?Q?…?= */
export function decodeWords(value) {
  const joined = String(value == null ? '' : value).replace(/(\?=)[ \t\r\n]+(=\?)/g, '$1$2');
  return rawHeaderText(joined).replace(/=\?([^?\s]{1,40})\?([bBqQ])\?([^?]*)\?=/g, (m, charset, kind, data) => {
    const bin = kind === 'b' || kind === 'B' ? fromBase64(data) : fromQuotedPrintable(data, true);
    return decodeText(bin, charset.split('*')[0]);
  });
}

/* ---------- Cabeceras ---------- */

/* Parte el mensaje en cabeceras y cuerpo. Cada cabecera guarda su texto original (`raw`, con sus
   saltos de línea: lo necesita la firma DKIM) y su valor en una línea (`value`). */
export function splitMessage(bin) {
  const end = /\r?\n\r?\n/.exec(bin);
  const head = end ? bin.slice(0, end.index) : bin;
  const body = end ? bin.slice(end.index + end[0].length) : '';
  const headers = [];
  head.split(/\r?\n/).forEach((line) => {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].raw += '\r\n' + line;
      return;
    }
    const colon = line.indexOf(':');
    if (colon < 1) return;
    headers.push({name: line.slice(0, colon), raw: line});
  });
  headers.forEach((h) => {
    h.lower = h.name.trim().toLowerCase();
    h.value = h.raw.slice(h.raw.indexOf(':') + 1).replace(/\r\n/g, '').trim();
  });
  return {headers: headers, body: body};
}

const headerValue = (headers, name) => { const h = headers.find((x) => x.lower === name); return h ? h.value : ''; };
const headerCount = (headers, name) => headers.filter((x) => x.lower === name).length;

/* «text/plain; charset=utf-8; name="a b.txt"» → {value:'text/plain', params:{charset, name}}.
   Admite parámetros partidos y con juego de caracteres (RFC 2231: filename*=UTF-8''a%20b.txt). */
export function parseParams(text) {
  const src = String(text || '');
  const parts = [];
  let cur = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted && c === '\\' && i + 1 < src.length) { cur += src[++i]; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ';' && !quoted) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  const out = {value: parts[0].trim().toLowerCase(), params: {}};
  const pieces = {};
  parts.slice(1).forEach((p) => {
    const eq = p.indexOf('=');
    if (eq < 1) return;
    const key = p.slice(0, eq).trim().toLowerCase();
    const val = p.slice(eq + 1).trim();
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
    if (!m) return;
    if (m[2] === undefined && !m[3]) { out.params[m[1]] = decodeWords(val); return; }
    (pieces[m[1]] = pieces[m[1]] || []).push({n: m[2] === undefined ? 0 : +m[2], coded: !!m[3], val: val});
  });
  Object.keys(pieces).forEach((key) => {
    const list = pieces[key].sort((a, b) => a.n - b.n);
    let charset = 'utf-8', bin = '';
    list.forEach((piece, i) => {
      let val = piece.val;
      if (piece.coded) {
        if (i === 0) {
          const at = val.split("'");
          if (at.length >= 3) { charset = at[0] || 'utf-8'; val = at.slice(2).join("'"); }
        }
        val = val.replace(/%([0-9A-Fa-f]{2})/g, (x, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      bin += val;
    });
    out.params[key] = decodeText(bin, charset);
  });
  return out;
}

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/* La dirección de una cabecera From con UN solo remitente: {address, domain, name} o null. */
export function parseAddress(value) {
  const src = String(value || '');
  let depth = 0, quoted = false, commas = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '<') depth++;
    else if (!quoted && c === '>') depth--;
    else if (!quoted && depth === 0 && (c === ',' || c === ';')) commas++;
  }
  if (commas) return null;
  const angle = /<([^<>]*)>\s*$/.exec(src);
  const address = (angle ? angle[1] : src.replace(/\([^)]*\)/g, '')).trim().toLowerCase();
  if (!ADDRESS.test(address) || address.length > 254) return null;
  const name = angle ? decodeWords(src.slice(0, angle.index)).replace(/^[\s"']+|[\s"']+$/g, '') : '';
  return {address: address, domain: address.slice(address.lastIndexOf('@') + 1), name: cleanLine(name, 80)};
}

/* ---------- Saneado ---------- */

/* Controles, marcas invisibles y cambios de dirección de escritura (con los que un nombre de
   archivo o un enlace aparentan ser otra cosa). */
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/* Una línea de texto (asunto, nombre): sin saltos, sin controles, recortada. */
export function cleanLine(text, max) {
  return String(text == null ? '' : text).replace(/[\r\n\t]+/g, ' ').replace(HIDDEN, '').replace(/ {2,}/g, ' ').trim().slice(0, max);
}

/* El cuerpo como texto de una descripción: sin controles, sin enlaces con texto que oculte su
   destino ni imágenes (el Markdown de Kanlane ya no carga nada de fuera; así ni siquiera quedan
   como enlace disfrazado), y recortado al máximo que admite una tarea. */
export function cleanText(text, max) {
  let s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(HIDDEN, '');
  s = s.replace(/!\[/g, '! [').replace(/\]\(/g, '] (').replace(/\]\[/g, '] [').replace(/^(\s*\[[^\]\n]*\]):/gm, '$1 :');
  /* Del principio se quitan las líneas en blanco y la sangría común, no la de la primera línea
     sola: Gmail sangra las listas en su texto plano («   - uno») y, quitándosela solo a la
     primera, las demás quedaban anidadas dentro de ella. */
  const lines = s.split('\n').map((line) => line.replace(/[ \t]+$/, ''));
  const pad = lines.reduce((min, line) => (line ? Math.min(min, /^[ \t]*/.exec(line)[0].length) : min), Infinity);
  s = lines.map((line) => line.slice(pad)).join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/^\n+|\n+$/g, '');
  const tail = '\n\n[…]';
  return s.length > max ? s.slice(0, max - tail.length).replace(/[\ud800-\udbff]$/, '') + tail : s;
}

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', copy: '©', euro: '€',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', iexcl: '¡', iquest: '¿'};

function entities(text) {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z]{2,8});/g, (m, code) => {
    if (code[0] !== '#') return Object.prototype.hasOwnProperty.call(ENTITIES, code) ? ENTITIES[code] : m;
    const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    try { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; } catch (e) { return ''; }
  });
}

/* Un cuerpo HTML como texto plano. No se interpreta ni se carga nada: se quitan estilos, scripts,
   cabecera y etiquetas; las imágenes desaparecen y de un enlace queda su texto y, al lado, su
   dirección (solo http, https y mailto), para que se vea a dónde lleva. */
export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title|template|svg|noscript|object|iframe)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(head|style|script|title|template|svg|noscript|object|iframe)\b[\s\S]*$/gi, '');
  s = s.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (m, a, b, c, inner) => {
    const url = entities(String(a || b || c || '')).trim();
    const text = inner.replace(/<[^>]*>/g, '').trim();
    if (!/^(https?:\/\/|mailto:)[^\s"<>]+$/i.test(url)) return text;
    const shown = entities(text).replace(/\s+/g, ' ');
    return shown && shown !== url && shown !== url.replace(/^mailto:/i, '') ? text + ' (' + url + ')' : url;
  });
  s = s.replace(/\r?\n/g, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|tr|table|h[1-6]|ul|ol|blockquote|section|article|header|footer)\s*>/gi, '\n\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  s = entities(s).replace(/[ \t ]+/g, ' ');
  return s.split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/* Un nombre de archivo que se puede enseñar y guardar: sin rutas, sin controles ni marcas
   invisibles, sin puntos al principio y de 120 caracteres como mucho (conserva la extensión). */
export function safeName(name) {
  let s = String(name == null ? '' : name).replace(HIDDEN, '').replace(/[\r\n\t]+/g, ' ');
  s = s.split(/[\\/]/).pop();
  s = s.replace(/[<>:"|?*]/g, '_').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!s) return 'adjunto';
  if (RESERVED.test(s)) s = '_' + s;
  if (s.length > 120) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : '';
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

/* Ejecutables, guiones, instaladores, accesos directos, documentos con macros y contenido activo
   (HTML, SVG). Se decide por la extensión, por el tipo declarado y por cómo empieza el archivo. */
const BLOCKED_EXT = ['exe', 'dll', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'mst', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh', 'hta', 'jar',
  'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'bash', 'run', 'elf', 'lnk', 'url', 'scf', 'reg', 'inf', 'gadget', 'iso', 'img', 'vhd', 'vhdx',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'html', 'htm', 'xhtml', 'xht', 'shtml', 'svg', 'svgz', 'mht', 'mhtml', 'chm', 'hlp', 'php', 'py', 'pl', 'rb'];
const BLOCKED_TYPE = /^(application\/(x-msdownload|x-msdos-program|x-dosexec|x-executable|x-sharedlib|x-elf|x-mach-binary|vnd\.microsoft\.portable-executable|x-msi|x-ms-installer|x-sh|x-shellscript|x-csh|x-bat|x-ms-shortcut|javascript|x-javascript|ecmascript|hta|java-archive|x-java-archive|vnd\.android\.package-archive|x-apple-diskimage|x-httpd-php|xhtml\+xml)|text\/(html|javascript|ecmascript|x-shellscript|x-python|x-php|vbscript)|image\/svg\+xml)$/;

/* → '' si se admite; si no, el motivo ('type'). `start`: los primeros bytes, como cadena binaria. */
export function blockedFile(name, type, start) {
  const dot = String(name).lastIndexOf('.');
  const ext = dot >= 0 ? String(name).slice(dot + 1).trim().toLowerCase() : '';
  if (ext && BLOCKED_EXT.indexOf(ext) !== -1) return 'type';
  if (BLOCKED_TYPE.test(String(type || '').toLowerCase())) return 'type';
  const head = String(start || '').slice(0, 8);
  if (head.slice(0, 2) === 'MZ' || head.slice(0, 4) === '\x7fELF' || head.slice(0, 2) === '#!' || /^(\xfe\xed\xfa[\xce\xcf]|[\xce\xcf]\xfa\xed\xfe|\xca\xfe\xba\xbe)/.test(head)) return 'type';
  return '';
}

const cleanType = (type) => (/^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,60}$/.test(type) ? type : 'application/octet-stream');

/* ---------- Partes MIME ---------- */

/* La siguiente línea separadora «--límite» a partir de `from`: {at, end, close} o null. */
function nextDelimiter(body, mark, from) {
  let at = from;
  for (;;) {
    at = at === 0 && body.startsWith(mark) ? 0 : body.indexOf('\n' + mark, Math.max(0, at - 1));
    if (at < 0) return null;
    if (at !== 0 || !body.startsWith(mark)) at += 1;
    let lineEnd = body.indexOf('\n', at);
    if (lineEnd < 0) lineEnd = body.length;
    const tail = body.slice(at + mark.length, lineEnd).replace(/[ \t\r]+$/, '');
    if (tail === '' || tail === '--') return {at: at, end: Math.min(body.length, lineEnd + 1), close: tail === '--'};
    at = lineEnd;
  }
}

function splitParts(body, boundary) {
  const mark = '--' + boundary;
  const parts = [];
  let open = nextDelimiter(body, mark, 0);
  while (open && !open.close) {
    const next = nextDelimiter(body, mark, open.end);
    const stop = next ? next.at : body.length;
    /* El salto de línea de antes del separador es del separador, no de la parte. */
    parts.push(body.slice(open.end, stop).replace(/\r?\n$/, ''));
    open = next;
  }
  return parts;
}

function decodeBody(bin, encoding) {
  const enc = String(encoding || '').trim().toLowerCase();
  if (enc === 'base64') return fromBase64(bin);
  if (enc === 'quoted-printable') return fromQuotedPrintable(bin, false);
  return bin;
}

const EXT_OF = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/calendar': 'ics', 'message/rfc822': 'eml', 'text/csv': 'csv', 'application/zip': 'zip'};

/* limits: {maxParts, maxDepth}. → {headers, body, from, subject, messageId, text, html,
   attachments:[{name, type, bin, size}], truncated} */
export function parseMail(bytes, limits) {
  const lim = Object.assign({maxParts: 100, maxDepth: 8}, limits);
  const bin = typeof bytes === 'string' ? bytes : toBin(bytes);
  const top = splitMessage(bin);
  const out = {headers: top.headers, body: top.body, text: null, html: null, attachments: [], truncated: false};
  let seen = 0;

  const walk = (headers, body, depth) => {
    if (++seen > lim.maxParts || depth > lim.maxDepth) { out.truncated = true; return; }
    const type = parseParams(headerValue(headers, 'content-type') || 'text/plain');
    const disp = parseParams(headerValue(headers, 'content-disposition'));
    if (type.value.indexOf('multipart/') === 0) {
      const boundary = type.params.boundary;
      if (!boundary || boundary.length > 200) return;
      splitParts(body, boundary).forEach((part) => { const p = splitMessage(part); walk(p.headers, p.body, depth + 1); });
      return;
    }
    const filename = disp.params.filename || type.params.name || '';
    const isText = type.value === 'text/plain' || type.value === 'text/html';
    const data = decodeBody(body, headerValue(headers, 'content-transfer-encoding'));
    if (isText && !filename && disp.value !== 'attachment') {
      const text = decodeText(data, type.params.charset);
      if (type.value === 'text/plain' && out.text === null) out.text = text;
      else if (type.value === 'text/html' && out.html === null) out.html = text;
      return;
    }
    /* Firmas y partes de control sin nombre: no son adjuntos de nadie. */
    if (!filename && /^(application\/(pgp-signature|pkcs7-signature|x-pkcs7-signature|pgp-encrypted)|message\/(delivery-status|disposition-notification)|text\/rfc822-headers)$/.test(type.value)) return;
    const kind = cleanType(type.value);
    const name = safeName(filename || 'adjunto-' + (out.attachments.length + 1) + (EXT_OF[kind] ? '.' + EXT_OF[kind] : ''));
    out.attachments.push({name: name, type: kind, bin: data, size: data.length});
  };
  walk(top.headers, top.body, 0);

  out.from = headerCount(top.headers, 'from') === 1 ? parseAddress(headerValue(top.headers, 'from')) : null;
  out.subject = cleanLine(decodeWords(headerValue(top.headers, 'subject')), 500);
  const id = /<([^<>\s]{1,300})>/.exec(headerValue(top.headers, 'message-id'));
  out.messageId = headerCount(top.headers, 'message-id') === 1 && id ? id[1] : '';
  return out;
}

/* ¿Es una respuesta automática, un rebote, un boletín o un mensaje que da vueltas? → motivo o ''.
   A esos no se les contesta ni se les rechaza (un rechazo generaría otro mensaje): se descartan. */
export function automatic(headers, envelopeFrom) {
  const get = (name) => headerValue(headers, name).toLowerCase();
  const sender = String(envelopeFrom || '').trim();
  if (!sender || sender === '<>') return 'bounce';
  if (/^(mailer-daemon|postmaster)@/i.test(sender)) return 'bounce';
  const auto = get('auto-submitted');
  if (auto && auto !== 'no') return 'auto-submitted';
  if (/^(bulk|junk|list|auto_reply|auto-reply)\b/.test(get('precedence'))) return 'bulk';
  if (get('x-autoreply') || get('x-autorespond') || get('x-autoresponder')) return 'auto-reply';
  if (/\b(oof|autoreply|all)\b/.test(get('x-auto-response-suppress'))) return 'auto-reply';
  if (get('list-id') || get('list-unsubscribe')) return 'list';
  if (headerCount(headers, 'received') > 50) return 'loop';
  return '';
}

/* El asunto sin los «Re:», «Fwd:», «RV:»… de delante, para reconocer el mismo correo reenviado. */
export function baseSubject(subject) {
  let s = String(subject || '').trim();
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/^(re|fw|fwd|rv|reenv|enc|tr|aw|wg|res|rif)(\[\d+\])?\s*[:：]\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').toLowerCase();
}

export {headerValue, headerCount};
