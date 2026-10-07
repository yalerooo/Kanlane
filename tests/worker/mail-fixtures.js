/* Lo que comparten las pruebas de la captura por correo: montar un mensaje como lo mandaría un
   servidor de correo, firmarlo con DKIM (con node:crypto, sin usar el código del Worker: así la
   comprobación del Worker se prueba contra otra implementación) y una base de datos en memoria con
   las mismas condiciones de escritura que Firestore. */
const nodeCrypto = require('node:crypto');

const CRLF = '\r\n';
const wrap = (b64) => b64.replace(/.{1,76}/g, (line) => line + CRLF);

/* o: {from, to, subject, text, html, attachments:[{name, type, data, encoding, disposition}],
       messageId (null = sin cabecera), headers:[[nombre, valor]], date, charset} → Buffer */
function buildMail(o) {
  const head = [];
  if (o.from !== null) head.push(['From', o.from || 'Ana <ana@ejemplo.test>']);
  head.push(['To', o.to || 'captura@in.kanlane.test']);
  if (o.subject !== undefined && o.subject !== null) head.push(['Subject', o.subject]);
  if (o.messageId !== null) head.push(['Message-ID', '<' + (o.messageId || nodeCrypto.randomUUID() + '@ejemplo.test') + '>']);
  head.push(['Date', o.date || 'Wed, 07 Oct 2026 09:00:00 +0000'], ['MIME-Version', '1.0']);
  (o.headers || []).forEach((h) => head.push(h));

  const leaf = (type, body, extra) => ({headers: [['Content-Type', type]].concat(extra || []), body: body});
  const textPart = (kind, value) => leaf('text/' + kind + '; charset=' + (o.charset || 'utf-8'), wrap(Buffer.from(value, o.charset === 'iso-8859-1' ? 'latin1' : 'utf8').toString('base64')), [['Content-Transfer-Encoding', 'base64']]);
  const multi = (kind, parts) => {
    const boundary = '=_' + kind + '_' + nodeCrypto.randomBytes(8).toString('hex');
    const body = parts.map((p) => '--' + boundary + CRLF + p.headers.map((h) => h[0] + ': ' + h[1]).join(CRLF) + CRLF + CRLF + p.body + (p.body.endsWith(CRLF) ? '' : CRLF)).join('') + '--' + boundary + '--' + CRLF;
    return leaf('multipart/' + kind + '; boundary="' + boundary + '"', body);
  };
  let content;
  if (o.text !== undefined && o.html !== undefined) content = multi('alternative', [textPart('plain', o.text), textPart('html', o.html)]);
  else if (o.html !== undefined) content = textPart('html', o.html);
  else content = textPart('plain', o.text === undefined ? '' : o.text);
  if (o.attachments && o.attachments.length) {
    content = multi('mixed', [content].concat(o.attachments.map((a) => {
      const data = Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data || '');
      const name = a.rawName || '"' + a.name + '"';
      const extra = [['Content-Disposition', (a.disposition || 'attachment') + (a.name === null ? '' : '; filename=' + name)]];
      if (a.encoding === '8bit') return leaf(a.type || 'application/octet-stream', data.toString('latin1'), extra.concat([['Content-Transfer-Encoding', '8bit']]));
      return leaf(a.type || 'application/octet-stream', wrap(data.toString('base64')), extra.concat([['Content-Transfer-Encoding', 'base64']]));
    })));
  }
  const all = head.concat(content.headers);
  return Buffer.from(all.map((h) => h[0] + ': ' + h[1]).join(CRLF) + CRLF + CRLF + content.body, 'latin1');
}

/* ---------- DKIM (firmante de prueba) ---------- */

const relaxedBody = (body) => {
  const s = body.replace(/\r?\n/g, CRLF).split(CRLF).map((l) => l.replace(/[ \t]+/g, ' ').replace(/ $/, '')).join(CRLF).replace(/(\r\n)+$/, '');
  return s ? s + CRLF : '';
};
const simpleBody = (body) => body.replace(/\r?\n/g, CRLF).replace(/(\r\n)+$/, '') + CRLF;
const relaxedHeader = (name, value) => name.toLowerCase() + ':' + value.replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').trim();

/* Firma el mensaje y devuelve otro Buffer con la cabecera DKIM-Signature delante.
   o: {domain, selector, key (KeyObject privada), canon:'relaxed'|'simple', time (s), expire (s), length:true} */
function dkimSign(raw, o) {
  const src = raw.toString('latin1');
  const cut = src.indexOf(CRLF + CRLF);
  const head = src.slice(0, cut), body = src.slice(cut + 4);
  const lines = [];
  head.split(CRLF).forEach((line) => { if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += CRLF + line; else lines.push(line); });
  const relaxed = (o.canon || 'relaxed') === 'relaxed';
  const names = ['from', 'to', 'subject', 'message-id', 'date', 'mime-version', 'content-type'].filter((n) => lines.some((l) => l.toLowerCase().indexOf(n + ':') === 0));
  const bh = nodeCrypto.createHash('sha256').update(Buffer.from(relaxed ? relaxedBody(body) : simpleBody(body), 'latin1')).digest('base64');
  const value = ' v=1; a=rsa-sha256; c=' + (relaxed ? 'relaxed/relaxed' : 'simple/simple') + '; d=' + o.domain + '; s=' + (o.selector || 'sel') +
    '; t=' + (o.time || 1791363600) + (o.expire ? '; x=' + o.expire : '') + (o.length ? '; l=' + body.length : '') + ';' + CRLF + '\th=' + names.join(':') + '; bh=' + bh + ';' + CRLF + '\tb=';
  let data = '';
  names.forEach((n) => {
    const line = lines.filter((l) => l.toLowerCase().indexOf(n + ':') === 0).pop();
    data += (relaxed ? relaxedHeader(line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)) : line) + CRLF;
  });
  data += relaxed ? relaxedHeader('DKIM-Signature', value) : 'DKIM-Signature:' + value;
  const b = nodeCrypto.sign('RSA-SHA256', Buffer.from(data, 'latin1'), o.key).toString('base64');
  return Buffer.from('DKIM-Signature:' + value + b.replace(/.{1,70}/g, (x) => x + CRLF + '\t').replace(/\r\n\t$/, '') + CRLF + src, 'latin1');
}

/* Par de claves y su registro TXT, como lo publicaría el dominio. */
function dkimKey() {
  const pair = nodeCrypto.generateKeyPairSync('rsa', {modulusLength: 2048});
  return {key: pair.privateKey, txt: 'v=DKIM1; k=rsa; p=' + pair.publicKey.export({type: 'spki', format: 'der'}).toString('base64')};
}

/* Lo que Cloudflare entrega al manejador `email`. */
function message(raw, to, envelopeFrom) {
  const m = {from: envelopeFrom === undefined ? 'rebotes@ejemplo.test' : envelopeFrom, to: to, raw: raw, rawSize: raw.length, rejected: null};
  m.setReject = (reason) => { m.rejected = reason; };
  return m;
}

/* ---------- Firestore en memoria ---------- */

/* Mismas condiciones que la API: `create` falla si existe, `patch` si no existe (salvo upsert),
   `updateTime` si cambió, y un commit se aplica entero o nada. Un fallo de condición es un 400. */
function memoryStore() {
  const s = {docs: new Map(), version: 0, reads: 0, commits: 0, failWhen: null};
  const snap = (path) => s.docs.get(path) || null;
  s.data = (path) => { const d = snap(path); return d ? d.data : null; };
  s.paths = (prefix) => Array.from(s.docs.keys()).filter((p) => p.indexOf(prefix) === 0).sort();
  s.put = (path, data) => { s.docs.set(path, {data: JSON.parse(JSON.stringify(data)), v: ++s.version}); };
  s.get = async (path) => { s.reads++; const d = snap(path); return d ? JSON.parse(JSON.stringify(d.data)) : null; };
  s.getDoc = async (path) => { s.reads++; const d = snap(path); return d ? {data: JSON.parse(JSON.stringify(d.data)), updateTime: 'v' + d.v} : null; };
  s.where = async (collection, field, value, n) => {
    s.reads++;
    return Array.from(s.docs.entries()).filter(([p, d]) => p.indexOf(collection + '/') === 0 && p.split('/').length === 2 && d.data[field] === value)
      .slice(0, n).map(([p, d]) => ({id: p.split('/')[1], data: JSON.parse(JSON.stringify(d.data))}));
  };
  s.olderThan = async (collection, field, value, n) => {
    s.reads++;
    return Array.from(s.docs.entries()).filter(([p, d]) => p.indexOf(collection + '/') === 0 && p.split('/').length === 2 && d.data[field] !== undefined && d.data[field] < value)
      .slice(0, n).map(([p]) => p.slice(collection.length + 1));
  };
  s.list = async (parent, collection, n, filter, order) => {
    s.reads++;
    const prefix = parent + '/' + collection + '/';
    let rows = Array.from(s.docs.entries()).filter(([p]) => p.indexOf(prefix) === 0 && p.slice(prefix.length).indexOf('/') === -1)
      .map(([p, d]) => ({id: p.slice(prefix.length), data: JSON.parse(JSON.stringify(d.data)), updateTime: 'v' + d.v}));
    if (filter) rows = rows.filter((r) => { const v = r.data[filter.field]; return filter.op === 'EQUAL' ? v === filter.value : v !== undefined && v !== null && filter.value.indexOf(v) === -1; });
    if (order) rows.sort((a, b) => (a.data[order.field] - b.data[order.field]) * (order.desc ? -1 : 1));
    return rows.slice(0, n);
  };
  s.commit = async (writes) => {
    s.commits++;
    if (s.failWhen && s.failWhen(writes)) throw Object.assign(new Error('POST :commit 503'), {status: 503});
    /* Como en la red: entre que sale la petición y se aplica, otra puede colarse. */
    await new Promise((resolve) => setImmediate(resolve));
    const bad = writes.some((w) => {
      const d = snap(w.path);
      if (w.remove) return false;
      if (w.updateTime) return !d || 'v' + d.v !== w.updateTime;
      if (w.create) return !!d;
      if (w.patch && !w.upsert) return !d;
      return false;
    });
    if (bad) throw Object.assign(new Error('POST :commit 400'), {status: 400});
    writes.forEach((w) => {
      if (w.remove) { s.docs.delete(w.path); return; }
      const d = snap(w.path);
      const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => x));
      let data = w.create || w.set ? plain(w.create || w.set) : Object.assign({}, d ? d.data : {});
      if (w.patch) (w.mask || Object.keys(w.patch)).forEach((f) => { data[f] = plain(w.patch)[f]; });
      Object.keys(w.increments || {}).forEach((f) => { data[f] = (+data[f] || 0) + w.increments[f]; });
      s.docs.set(w.path, {data: data, v: ++s.version});
    });
  };
  return s;
}

module.exports = {buildMail, dkimSign, dkimKey, message, memoryStore, CRLF};
