/* Cabeceras de seguridad que genera scripts/build-public.js (dist/_headers) y security.txt.
   Construye dist/ y comprueba la CSP de cada tipo de página: node tests/build/headers.test.js */
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {securityTxt, FILES, DAYS} = require('../../scripts/security-txt');

const repo = path.join(__dirname, '../..');
let passed = 0;
function test(name, fn){
  fn();
  passed++;
  console.log('ok   ' + name);
}

cp.execFileSync(process.execPath, [path.join(repo, 'scripts/build-public.js')], {cwd: repo, stdio: 'pipe'});
const dist = path.join(repo, 'dist');

/* dist/_headers → {ruta: {cabecera: valor}} */
const rules = {};
let current = null;
fs.readFileSync(path.join(dist, '_headers'), 'utf8').split(/\r?\n/).forEach((line) => {
  if(!line.trim()) return;
  if(/^\s/.test(line)){
    const at = line.indexOf(':');
    current[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }else{
    current = rules[line.trim()] = {};
  }
});
/* La CSP de una ruta → {directiva: [valores]} */
function csp(route){
  assert.ok(rules[route], 'hay cabeceras para ' + route);
  const out = {};
  rules[route]['Content-Security-Policy'].split(';').forEach((part) => {
    const words = part.trim().split(/\s+/);
    out[words[0]] = words.slice(1);
  });
  return out;
}
const pages = Object.keys(rules).filter((r) => rules[r]['Content-Security-Policy']);

test('todas las páginas llevan CSP, y la aplicación, la portada, la demo y las legales están entre ellas', () => {
  ['/', '/index.html', '/app/*', '/demo/*', '/legal/*', '/en/*', '/alternativa-a-trello/*'].forEach((r) => assert.ok(pages.includes(r), r));
});

test('solo la aplicación abre marcos de otros dominios (plugins de terceros)', () => {
  assert.deepEqual(csp('/app/*')['frame-src'], ["'self'", 'https:', 'http://localhost:*', 'http://127.0.0.1:*']);
  pages.filter((r) => r !== '/app/*').forEach((r) => assert.deepEqual(csp(r)['frame-src'], ["'self'"], r));
});

test('ninguna página admite hojas de estilo en línea; los atributos style sí', () => {
  pages.forEach((r) => {
    const p = csp(r);
    assert.deepEqual(p['style-src-elem'], ["'self'"], r);
    assert.deepEqual(p['style-src-attr'], ["'unsafe-inline'"], r);
  });
});

test('ninguna página admite scripts en línea, eval ni orígenes abiertos', () => {
  pages.forEach((r) => {
    const p = csp(r);
    ['script-src', 'connect-src', 'default-src'].forEach((d) => {
      assert.ok(p[d].length, r + ' ' + d);
      p[d].forEach((v) => assert.ok(!/^('unsafe-inline'|'unsafe-eval'|\*|https:|http:|data:|blob:)$/.test(v), r + ' ' + d + ' ' + v));
    });
    assert.deepEqual(p['object-src'], ["'none'"], r);
    assert.deepEqual(p['base-uri'], ["'self'"], r);
    assert.deepEqual(p['form-action'], ["'self'"], r);
  });
});

test('nadie enmarca el sitio, salvo el propio sitio a la demo', () => {
  pages.forEach((r) => {
    const demo = r === '/demo/*';
    assert.deepEqual(csp(r)['frame-ancestors'], [demo ? "'self'" : "'none'"], r);
    assert.equal(rules[r]['X-Frame-Options'], demo ? 'SAMEORIGIN' : 'DENY', r);
  });
});

test('las páginas del repositorio no llevan <style> ni scripts en línea (la CSP los bloquearía)', () => {
  const html = [];
  (function walk(dir){
    fs.readdirSync(dir, {withFileTypes: true}).forEach((d) => {
      const file = path.join(dir, d.name);
      if(d.isDirectory()){ if(d.name !== 'plugins') walk(file); }
      else if(d.name.endsWith('.html')) html.push(file);
    });
  })(dist);
  assert.ok(html.length > 10);
  html.forEach((file) => {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/<style[\s>]/i.test(text), path.relative(dist, file) + ' no lleva <style>');
    [...text.matchAll(/<script\b([^>]*)>/gi)].forEach((m) => {
      assert.ok(/\bsrc=/.test(m[1]) || /type="application\/ld\+json"/.test(m[1]), path.relative(dist, file) + ' no lleva scripts en línea');
    });
  });
});

test('security.txt: sin contacto no se genera', () => {
  assert.equal(securityTxt({contact: [], languages: 'es', canonical: 'https://kanlane.com/.well-known/security.txt'}, 0), null);
  assert.equal(securityTxt({contact: ['alguien@example.com'], languages: 'es', canonical: 'x'}, 0), null);
  assert.equal(securityTxt({contact: ['mailto:a@example.com', 'http://example.com/'], languages: 'es', canonical: 'x'}, 0), null);
});

test('security.txt: con contacto lleva los campos obligatorios y caduca en menos de un año', () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);
  const text = securityTxt({contact: ['mailto:seguridad@example.com', 'https://example.com/aviso'], languages: 'es, en', canonical: 'https://kanlane.com/.well-known/security.txt'}, now);
  assert.deepEqual(text.split('\n'), [
    'Contact: mailto:seguridad@example.com',
    'Contact: https://example.com/aviso',
    'Expires: 2027-09-02T12:00:00Z',
    'Preferred-Languages: es, en',
    'Canonical: https://kanlane.com/.well-known/security.txt',
    ''
  ]);
  assert.ok(DAYS < 365);
});

test('security.txt: lo publicado coincide con el contacto configurado y no entra en el service worker', () => {
  const configured = /contact:\s*\[\s*\]/.test(fs.readFileSync(path.join(repo, 'scripts/build-public.js'), 'utf8')) === false;
  FILES.forEach((f) => {
    const file = path.join(dist, f);
    assert.equal(fs.existsSync(file), configured, f);
    if(configured){
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /^Contact: (mailto:|https:\/\/)/m);
      assert.match(text, /^Expires: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/m);
    }
  });
  const cached = JSON.parse(fs.readFileSync(path.join(dist, 'sw.js'), 'utf8').match(/const FILES = (\[.*\]);/)[1]);
  FILES.forEach((f) => assert.ok(!cached.includes(f), f));
});

console.log('\n' + passed + ' correctas');
