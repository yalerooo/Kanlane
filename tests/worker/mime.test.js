/* Lectura y saneado de un correo (worker/mime.mjs) y comprobación de su firma DKIM
   (worker/dkim.mjs). Uso: node tests/worker/mime.test.js */
const assert = require('node:assert/strict');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {buildMail, dkimSign, dkimKey, CRLF} = require('./mail-fixtures.js');

const load = (name) => import(pathToFileURL(path.join(__dirname, '../../worker/' + name)).href);

(async () => {
  const M = await load('mime.mjs');
  const D = await load('dkim.mjs');
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('ok   ' + name); };
  const parse = (o) => M.parseMail(new Uint8Array(buildMail(o)));

  await test('asunto, remitente y Message-ID, con acentos en las dos codificaciones de cabecera', async () => {
    const m = parse({from: '=?utf-8?B?' + Buffer.from('Ángela Núñez').toString('base64') + '?= <Angela.Nunez@Ejemplo.TEST>', subject: '=?iso-8859-1?Q?Reuni=F3n_de_ma=F1ana?=', messageId: 'abc@ejemplo.test', text: 'Hola'});
    assert.deepEqual(m.from, {address: 'angela.nunez@ejemplo.test', domain: 'ejemplo.test', name: 'Ángela Núñez'});
    assert.equal(m.subject, 'Reunión de mañana');
    assert.equal(m.messageId, 'abc@ejemplo.test');
    assert.equal(m.text, 'Hola');
    /* Un asunto partido en varias palabras codificadas, y uno en UTF-8 sin codificar. */
    assert.equal(M.decodeWords('=?utf-8?Q?Presupuesto_a=C3=B1o?=\r\n =?utf-8?Q?_pr=C3=B3ximo?='), 'Presupuesto año próximo');
    assert.equal(parse({subject: Buffer.from('Informe añadido', 'utf8').toString('latin1'), text: 'x'}).subject, 'Informe añadido');
  });

  await test('un From con varios remitentes, repetido o que no es una dirección no vale', async () => {
    assert.equal(M.parseAddress('a@x.test, b@y.test'), null);
    assert.equal(M.parseAddress('"Ana, la de ventas" <ana@x.test>').address, 'ana@x.test');
    assert.equal(M.parseAddress('ana@x.test (Ana)').address, 'ana@x.test');
    assert.equal(M.parseAddress('Ana <ana@x.test> <otro@y.test>').address, 'otro@y.test', 'cuenta la dirección que de verdad lleva el campo');
    assert.equal(M.parseAddress('sin arroba'), null);
    assert.equal(M.parseAddress('ana@localhost'), null);
    assert.equal(M.parseAddress('<ana@x.test\r\nBcc: otro@y.test>'), null);
    const twice = parse({text: 'x', headers: [['From', 'otra@y.test']]});
    assert.equal(twice.from, null, 'dos cabeceras From: no se elige una');
    assert.equal(parse({from: null, text: 'x'}).from, null);
  });

  await test('cuerpo: texto plano, solo HTML, las dos cosas, ISO-8859-1 y vacío', async () => {
    assert.equal(parse({text: 'Línea 1\r\nLínea 2'}).text, 'Línea 1\r\nLínea 2');
    assert.equal(parse({text: 'Camión y cigüeña', charset: 'iso-8859-1'}).text, 'Camión y cigüeña');
    const both = parse({text: 'En texto', html: '<p>En <b>HTML</b></p>'});
    assert.equal(both.text, 'En texto');
    assert.equal(both.html, '<p>En <b>HTML</b></p>');
    const html = parse({html: '<p>Solo HTML</p>'});
    assert.equal(html.text, null);
    assert.equal(M.htmlToText(html.html), 'Solo HTML');
    assert.equal(parse({text: ''}).text, '');
    assert.equal(parse({}).attachments.length, 0);
  });

  await test('HTML a texto: nada activo, nada remoto, y los enlaces enseñan a dónde van', async () => {
    const html = '<html><head><title>T</title><style>p{color:red}</style></head><body>' +
      '<script>alert(1)</script><p>Hola&nbsp;<b>Ana</b> &amp; cía &#233;</p><img src="https://rastreo.test/p.gif" onerror="x()">' +
      '<a href="https://banco.test/entrar">Tu banco</a><br><a href="javascript:alert(1)">pulsa</a> <a href="https://ok.test">https://ok.test</a>' +
      '<ul><li>uno</li><li>dos</li></ul><iframe src="https://x.test"></iframe><!-- oculto --></body></html>';
    const out = M.htmlToText(html);
    assert.equal(out, 'Hola Ana & cía é\n\nTu banco (https://banco.test/entrar)\npulsa https://ok.test\n- uno\n- dos');
    ['script', 'alert', 'rastreo', 'javascript', 'iframe', 'oculto', 'color', '<', '>'].forEach((bad) => assert.ok(out.indexOf(bad) === -1, bad));
    assert.equal(M.htmlToText('<style>a{}'), '', 'una etiqueta sin cerrar no deja pasar su contenido');
  });

  await test('descripción saneada: sin controles ni marcas invisibles, sin enlaces disfrazados ni imágenes, recortada', async () => {
    const dirty = 'Hola\u0000\u0007 mundo\u202e\u200b\r\n[Tu banco](https://malo.test) ![x](https://rastreo.test/p.png) [ref][1]\n[1]: https://malo.test\n\n\n\n\n\nfin   ';
    const out = M.cleanText(dirty, 20000);
    assert.equal(out, 'Hola mundo\n[Tu banco] (https://malo.test) ! [x] (https://rastreo.test/p.png) [ref] [1]\n[1] : https://malo.test\n\n\nfin');
    assert.equal(M.cleanText('<script>alert(1)</script>', 100), '<script>alert(1)</script>', 'el HTML en texto plano se queda como texto: la app lo escapa al pintarlo');
    assert.equal(M.cleanText('\r\n   - uno\r\n   - dos\r\n', 100), '- uno\n- dos', 'una lista sangrada (texto plano de Gmail) no queda anidada');
    assert.equal(M.cleanText('   - uno\n      - sub\n   - dos\n\nSaludos', 100), '   - uno\n      - sub\n   - dos\n\nSaludos', 'la jerarquía se conserva');
    const long = M.cleanText('a'.repeat(30000), 20000);
    assert.equal(long.length, 20000);
    assert.ok(long.endsWith('[…]'));
    assert.equal(M.cleanLine('  Asunto\r\ncon\tsaltos\u202e  y   espacios ', 500), 'Asunto con saltos y espacios');
    assert.equal(M.cleanLine('x'.repeat(900), 500).length, 500);
  });

  await test('nombres de archivo: sin rutas, sin trucos y con su extensión', async () => {
    assert.equal(M.safeName('../../etc/passwd'), 'passwd');
    assert.equal(M.safeName('C:\\Windows\\System32\\cmd.exe'), 'cmd.exe');
    assert.equal(M.safeName('informe\u202egpj.exe'), 'informegpj.exe', 'sin la marca que le da la vuelta al nombre');
    assert.equal(M.safeName('.htaccess'), 'htaccess');
    assert.equal(M.safeName('a<b>:c|d?.txt'), 'a_b__c_d_.txt');
    assert.equal(M.safeName('nul.txt'), '_nul.txt');
    assert.equal(M.safeName('   '), 'adjunto');
    assert.equal(M.safeName('x\r\nContent-Type: text/html'), 'html', 'sin saltos de línea y solo lo de después de la última barra');
    assert.equal(M.safeName('x\r\nBcc: a@b.test'), 'x Bcc_ a@b.test');
    const long = M.safeName('n'.repeat(300) + '.pdf');
    assert.equal(long.length, 120);
    assert.ok(long.endsWith('.pdf'));
  });

  await test('adjuntos: nombre y bytes exactos, también en 8 bits, con RFC 2231 y sin nombre', async () => {
    const data = nodeCrypto.randomBytes(5000);
    const m = parse({text: 'Con adjuntos', attachments: [
      {name: 'datos.bin', data: data},
      {name: 'ocho.dat', data: Buffer.from([0, 255, 13, 10, 128, 45, 45, 200]), encoding: '8bit'},
      {name: 'x', rawName: "x; filename*=UTF-8''informe%20a%C3%B1o.pdf", data: 'pdf', type: 'application/pdf'},
      {name: null, data: 'png', type: 'image/png', disposition: 'inline'},
      {name: '=?utf-8?B?' + Buffer.from('añadido.txt').toString('base64') + '?=', data: 'hola', type: 'text/plain'}
    ]});
    assert.equal(m.text, 'Con adjuntos');
    assert.deepEqual(m.attachments.map((a) => a.name), ['datos.bin', 'ocho.dat', 'informe año.pdf', 'adjunto-4.png', 'añadido.txt']);
    assert.ok(Buffer.from(m.attachments[0].bin, 'latin1').equals(data), 'los bytes del adjunto no cambian');
    assert.deepEqual(Array.from(Buffer.from(m.attachments[1].bin, 'latin1')), [0, 255, 13, 10, 128, 45, 45, 200]);
    assert.equal(m.attachments[4].type, 'text/plain', 'un texto con nombre es un adjunto, no el cuerpo');
    assert.equal(m.attachments[0].size, 5000);
  });

  await test('MIME retorcido: límites dentro del texto, partes anidadas de más y separadores falsos', async () => {
    const raw = ['From: a@x.test', 'Content-Type: multipart/mixed; boundary=B', '', 'preámbulo', '--B', 'Content-Type: text/plain', '', 'uno', '--Bfalso no es separador', '--B  ',
      'Content-Type: multipart/mixed; boundary="B2"', '', '--B2', 'Content-Type: text/plain', 'Content-Disposition: attachment; filename="n.txt"', '', 'dos', '--B2--', '--B--', 'epílogo: --B'].join(CRLF);
    const m = M.parseMail(Buffer.from(raw, 'latin1'));
    assert.equal(m.text, 'uno\r\n--Bfalso no es separador');
    assert.deepEqual(m.attachments.map((a) => [a.name, a.bin]), [['n.txt', 'dos']]);
    /* Anidamiento sin fin: se corta y se dice. */
    let deep = 'Content-Type: text/plain' + CRLF + CRLF + 'fondo';
    for (let i = 0; i < 20; i++) deep = 'Content-Type: multipart/mixed; boundary=b' + i + CRLF + CRLF + '--b' + i + CRLF + deep + CRLF + '--b' + i + '--';
    const nested = M.parseMail(Buffer.from('From: a@x.test' + CRLF + deep, 'latin1'), {maxDepth: 8});
    assert.equal(nested.truncated, true);
    assert.equal(nested.text, null);
    const many = M.parseMail(Buffer.from('From: a@x.test' + CRLF + 'Content-Type: multipart/mixed; boundary=b' + CRLF + CRLF +
      Array.from({length: 300}, (x, i) => '--b' + CRLF + 'Content-Disposition: attachment; filename=f' + i + CRLF + CRLF + 'x' + CRLF).join('') + '--b--', 'latin1'), {maxParts: 100});
    assert.equal(many.truncated, true);
    assert.equal(many.attachments.length, 99);
    /* Sin cuerpo, sin cabeceras, saltos de línea sueltos. */
    assert.equal(M.parseMail(Buffer.from('')).headers.length, 0);
    assert.equal(M.parseMail(Buffer.from('From: a@x.test\nSubject: hola\n\ncuerpo')).subject, 'hola');
  });

  await test('archivos que no se admiten: por extensión, por tipo y por cómo empiezan', async () => {
    const no = (name, type, start) => assert.equal(M.blockedFile(name, type, start), 'type', name);
    const yes = (name, type, start) => assert.equal(M.blockedFile(name, type, start), '', name);
    ['virus.exe', 'factura.pdf.EXE', 'macro.docm', 'pagina.html', 'dibujo.svg', 'x.js', 'instalar.msi', 'acceso.lnk', 'guion.ps1', 'app.apk', 'a.jar', 'run.sh'].forEach((n) => no(n, 'application/octet-stream', ''));
    no('inocente.txt', 'application/x-msdownload', '');
    no('foto.jpg', 'image/jpeg', 'MZ\x90\x00');
    no('datos', 'application/octet-stream', '\x7fELF');
    no('nota', 'text/plain', '#!/bin/sh');
    no('img', 'image/svg+xml', '<svg');
    no('pagina', 'text/html', '<html>');
    yes('informe.pdf', 'application/pdf', '%PDF-1.7');
    yes('foto.jpg', 'image/jpeg', '\xff\xd8\xff');
    yes('hoja.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK');
    yes('datos.csv', 'text/csv', 'a,b');
    yes('archivo.zip', 'application/zip', 'PK');
  });

  await test('respuestas automáticas, rebotes, boletines y bucles', async () => {
    const h = (list) => M.splitMessage(list.concat(['', '']).join(CRLF)).headers;
    assert.equal(M.automatic(h(['From: a@x.test']), 'a@x.test'), '');
    assert.equal(M.automatic(h(['Auto-Submitted: no']), 'a@x.test'), '');
    assert.equal(M.automatic(h(['Auto-Submitted: auto-replied']), 'a@x.test'), 'auto-submitted');
    assert.equal(M.automatic(h(['Precedence: bulk']), 'a@x.test'), 'bulk');
    assert.equal(M.automatic(h(['X-Autoreply: yes']), 'a@x.test'), 'auto-reply');
    assert.equal(M.automatic(h(['X-Auto-Response-Suppress: All']), 'a@x.test'), 'auto-reply');
    assert.equal(M.automatic(h(['List-Unsubscribe: <mailto:x@y.test>']), 'a@x.test'), 'list');
    assert.equal(M.automatic(h(['From: a@x.test']), ''), 'bounce');
    assert.equal(M.automatic(h(['From: a@x.test']), '<>'), 'bounce');
    assert.equal(M.automatic(h(['From: a@x.test']), 'MAILER-DAEMON@x.test'), 'bounce');
    assert.equal(M.automatic(h(Array.from({length: 51}, () => 'Received: from a by b')), 'a@x.test'), 'loop');
    assert.equal(M.baseSubject('RE: Fwd: RV:  Presupuesto   2027'), 'presupuesto 2027');
    assert.equal(M.baseSubject('Re[2]: Hola'), 'hola');
    assert.equal(M.baseSubject('Reunión: mañana'), 'reunión: mañana', 'una palabra que empieza por «re» no es un prefijo');
  });

  /* ---------- DKIM ---------- */
  const NOW = 1791363600000;
  const k = dkimKey();
  const dns = (records) => ({now: () => NOW, resolveTxt: async (name) => { dns.asked.push(name); if (!(name in records)) return []; if (records[name] === 'fallo') throw new Error('dns'); return [records[name]]; }});
  dns.asked = [];
  const good = {'sel._domainkey.ejemplo.test': k.txt};
  const verify = (raw, from, deps) => D.verifyDkim(M.splitMessage(M.toBin(new Uint8Array(raw))), from, deps || dns(good));

  await test('DKIM: una firma buena del dominio del remitente pasa, en los dos modos', async () => {
    const raw = buildMail({subject: 'Hola  con   espacios', text: 'Cuerpo\r\n\r\n', attachments: [{name: 'a.bin', data: nodeCrypto.randomBytes(3000)}]});
    assert.deepEqual(await verify(dkimSign(raw, {domain: 'ejemplo.test', key: k.key}), 'ejemplo.test'), {pass: true, domain: 'ejemplo.test'});
    assert.deepEqual(await verify(dkimSign(raw, {domain: 'ejemplo.test', key: k.key, canon: 'simple'}), 'ejemplo.test'), {pass: true, domain: 'ejemplo.test'});
    /* Firmado por el dominio principal, remitente en un subdominio. */
    assert.equal((await verify(dkimSign(raw, {domain: 'ejemplo.test', key: k.key}), 'correo.ejemplo.test')).pass, true);
    /* Un cuerpo vacío también se firma y se comprueba. */
    assert.equal((await verify(dkimSign(buildMail({text: ''}), {domain: 'ejemplo.test', key: k.key}), 'ejemplo.test')).pass, true);
  });

  await test('DKIM: sin firma, con la firma de otro dominio o con algo cambiado, no pasa', async () => {
    const raw = buildMail({from: 'Ana <ana@ejemplo.test>', subject: 'Original', text: 'Cuerpo original'});
    const signed = dkimSign(raw, {domain: 'ejemplo.test', key: k.key});
    assert.deepEqual(await verify(raw, 'ejemplo.test'), {pass: false, reason: 'none'});
    /* Quien suplanta firma con SU dominio: la firma es buena, pero no es del dominio del From. */
    const evil = dkimKey();
    const spoof = dkimSign(raw, {domain: 'malo.test', key: evil.key});
    assert.deepEqual(await verify(spoof, 'ejemplo.test', dns({'sel._domainkey.malo.test': evil.txt})), {pass: false, reason: 'none'});
    assert.equal(D.aligned('ejemplo.test', 'ejemplo.test.malo.test'), false);
    assert.equal(D.aligned('test', 'ejemplo.test'), false, 'un dominio de primer nivel no firma por todos');
    assert.equal(D.aligned('otroejemplo.test', 'ejemplo.test'), false);
    /* O firma diciendo que es el dominio bueno, con su propia clave. */
    assert.deepEqual(await verify(dkimSign(raw, {domain: 'ejemplo.test', key: evil.key}), 'ejemplo.test'), {pass: false, reason: 'signature'});
    /* Cuerpo, asunto o remitente cambiados después de firmar. */
    const swap = (buf, a, b) => Buffer.from(buf.toString('latin1').replace(a, b), 'latin1');
    assert.deepEqual(await verify(swap(signed, Buffer.from('Cuerpo original').toString('base64'), Buffer.from('Cuerpo cambiado').toString('base64')), 'ejemplo.test'), {pass: false, reason: 'body'});
    assert.deepEqual(await verify(swap(signed, 'Subject: Original', 'Subject: Cambiado'), 'ejemplo.test'), {pass: false, reason: 'signature'});
    assert.deepEqual(await verify(swap(signed, 'ana@ejemplo.test', 'eva@ejemplo.test'), 'ejemplo.test'), {pass: false, reason: 'signature'});
    /* Un segundo From añadido delante (el que enseñaría un programa de correo) no cuela: la firma cubre el último. */
    const doubled = Buffer.concat([Buffer.from('From: Jefa <jefa@ejemplo.test>' + CRLF), signed]);
    assert.equal(M.parseMail(doubled).from, null);
  });

  await test('DKIM: caducada, parcial, sin clave, clave retirada, algoritmo raro o DNS caído', async () => {
    const raw = buildMail({text: 'Cuerpo'});
    const sec = Math.floor(NOW / 1000);
    assert.equal((await verify(dkimSign(raw, {domain: 'ejemplo.test', key: k.key, time: sec - 1000, expire: sec - 600}), 'ejemplo.test')).reason, 'expired');
    assert.equal((await verify(dkimSign(raw, {domain: 'ejemplo.test', key: k.key, time: sec + 86400}), 'ejemplo.test')).reason, 'expired', 'firmada «en el futuro»');
    assert.equal((await verify(dkimSign(raw, {domain: 'ejemplo.test', key: k.key, time: sec - 60, expire: sec + 600}), 'ejemplo.test')).pass, true);
    assert.equal((await verify(dkimSign(raw, {domain: 'ejemplo.test', key: k.key, length: true}), 'ejemplo.test')).reason, 'unsupported', 'una firma con l= deja añadir texto: no vale');
    const signed = dkimSign(raw, {domain: 'ejemplo.test', key: k.key});
    assert.equal((await verify(signed, 'ejemplo.test', dns({}))).reason, 'key');
    assert.equal((await verify(signed, 'ejemplo.test', dns({'sel._domainkey.ejemplo.test': 'v=DKIM1; k=rsa; p='}))).reason, 'key');
    assert.equal((await verify(signed, 'ejemplo.test', dns({'sel._domainkey.ejemplo.test': 'fallo'}))).reason, 'dns');
    assert.equal((await verify(signed, 'ejemplo.test', dns({'sel._domainkey.ejemplo.test': 'v=DKIM1; k=rsa; p=AAAA'}))).reason, 'key');
    const sha1 = Buffer.from(signed.toString('latin1').replace('a=rsa-sha256', 'a=rsa-sha1'), 'latin1');
    assert.equal((await verify(sha1, 'ejemplo.test')).reason, 'unsupported');
    const noFrom = Buffer.from(signed.toString('latin1').replace('h=from:', 'h='), 'latin1');
    assert.equal((await verify(noFrom, 'ejemplo.test')).reason, 'unsupported', 'una firma que no cubre el From no dice nada del remitente');
    /* Muchas firmas: solo se miran las cinco primeras (no se puede hacer trabajar al servidor sin fin). */
    dns.asked.length = 0;
    const bad = dkimKey();
    let flooded = raw;
    for (let i = 0; i < 12; i++) flooded = dkimSign(flooded, {domain: 'ejemplo.test', key: bad.key});
    assert.equal((await verify(flooded, 'ejemplo.test')).pass, false);
    assert.equal(dns.asked.length, 5);
  });

  console.log('\n' + passed + ' pruebas correctas');
})().catch((err) => { console.error(err); process.exit(1); });
