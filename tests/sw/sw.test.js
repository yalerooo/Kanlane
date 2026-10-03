/* Prueba del service worker (sw.js) con un entorno simulado, sin navegador.
   Uso: node tests/sw/sw.test.js */
const path = require('path');
const fs = require('fs');
let src = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8')
  .replace("const BUILD = 'dev';", "const BUILD = 'test1';")
  .replace('const FILES = [];', "const FILES = ['/', '/index.html', '/app/index.html', '/src/a.js', '/assets/x.css'];");

const stores = {};
const norm = (r, ignoreSearch) => { const u = new URL(typeof r === 'string' ? r : r.url, 'https://w.test'); return u.origin + u.pathname + (ignoreSearch ? '' : u.search); };
const caches = {
  open: async (name) => {
    const m = stores[name] = stores[name] || new Map();
    return {
      add: async (req) => { const res = await netFetch(req); if(!res.ok) throw new Error('fail'); m.set(norm(req), res.clone()); },
      put: async (req, res) => { m.set(norm(req), res); },
      match: async (req, opts) => { const k = norm(req, opts && opts.ignoreSearch); for(const [key, v] of m) if(norm(key, opts && opts.ignoreSearch) === k) return v.clone(); return undefined; },
      keys: async () => [...m.keys()]
    };
  },
  keys: async () => Object.keys(stores),
  delete: async (k) => delete stores[k]
};

let online = true;
let failPath = '';
const calls = [];
async function netFetch(req){
  const url = typeof req === 'string' ? req : req.url;
  calls.push(url);
  if(!online) throw new TypeError('offline');
  if(failPath && url.endsWith(failPath)) throw new TypeError('partial download');
  return new Response('net:' + url, {status: 200});
}

const listeners = {};
let activated = 0;
const self = {
  location: new URL('https://w.test/sw.js'),
  addEventListener: (t, f) => { listeners[t] = f; },
  skipWaiting: async () => { activated++; },
  clients: {claim: async () => {}}
};
class SwRequest extends Request{ constructor(i, o){ super(typeof i === 'string' ? new URL(i, 'https://w.test').href : i, o); } }
new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', src)(self, caches, netFetch, SwRequest, Response, URL);

const fire = async (type, extra) => {
  let p;
  await listeners[type](Object.assign({waitUntil: (x) => { p = x; }, respondWith: (x) => { p = x; }}, extra));
  return p;
};
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLO ') + m); if(!c) process.exitCode = 1; };
const req = (url, o) => Object.assign(new Request(url), {}, o);

/* El build copia src/ entero y mete en FILES todo lo que hay en dist/: cualquier script que cargue
   app/index.html se precachea si existe. Se comprueba que existen (incluidos los del cifrado). */
const repo = path.join(__dirname, '..', '..');
const appScripts = [...fs.readFileSync(path.join(repo, 'app', 'index.html'), 'utf8').matchAll(/<script src="\.\.\/(src\/[^"]+)"/g)].map((m) => m[1]);
ok(/const INCLUDE = [^;]*'src'/.test(fs.readFileSync(path.join(repo, 'scripts', 'build-public.js'), 'utf8')) &&
  ['src/services/project-crypto.js', 'src/services/keystore.js'].every((s) => appScripts.includes(s)) &&
  appScripts.every((s) => fs.existsSync(path.join(repo, s))), 'los ' + appScripts.length + ' scripts de app/index.html existen y entran en el precache (con project-crypto.js y keystore.js)');

(async () => {
  stores['workhub-shell-viejo'] = new Map();
  failPath = '/src/a.js';
  let installFailed = false;
  try{ await fire('install'); }catch(e){ installFailed = true; }
  ok(installFailed && activated === 0 && !!stores['workhub-shell-viejo'], 'instalación incompleta no activa ni borra la versión anterior');
  failPath = '';
  await fire('install');
  ok([...stores['workhub-shell-test1'].keys()].length === 5, 'install guarda los 5 archivos');
  await fire('activate');
  ok(!stores['workhub-shell-viejo'], 'activate borra cachés de versiones viejas');

  online = false;
  const nav = new Request('https://w.test/', {headers: {}});
  Object.defineProperty(nav, 'mode', {value: 'navigate'});
  const rNav = await fire('fetch', {request: nav});
  ok((await rNav.text()) === 'net:https://w.test/index.html', 'navegación sin red responde con el HTML guardado');
  ok(rNav.ok, 'navegación sin conexión usa /index.html guardado');

  /* La aplicación vive en /app/ y la portada en /: cada una con su propia copia. */
  const navApp = new Request('https://w.test/app/');
  Object.defineProperty(navApp, 'mode', {value: 'navigate'});
  const rApp = await fire('fetch', {request: navApp});
  ok(rApp.ok && (await rApp.text()) === 'net:https://w.test/app/index.html', 'sin conexión /app/ sale de su propia copia (no de la portada)');

  const rAsset = await fire('fetch', {request: new Request('https://w.test/src/a.js?v=2')});
  ok(rAsset.ok && (await rAsset.text()).indexOf('/src/a.js') !== -1, 'archivo de la app sin conexión sale de la caché (ignora ?v=)');

  let handled = true;
  try{ const p = await fire('fetch', {request: new Request('https://w.test/__/auth/handler')}); handled = p !== undefined; }catch(e){ handled = false; }
  ok(!handled, 'no toca /__/auth/');
  const fs2 = await (async () => { let got; await listeners.fetch({request: new Request('https://firestore.googleapis.com/x'), respondWith: (x) => { got = x; }}); return got; })();
  ok(fs2 === undefined, 'no toca Firestore');
  const post = await (async () => { let got; await listeners.fetch({request: new Request('https://w.test/x', {method: 'POST', body: 'a'}), respondWith: (x) => { got = x; }}); return got; })();
  ok(post === undefined, 'no toca las peticiones que no son GET');

  /* Las fuentes ya no vienen de Google: no se tocan (así no se piden a terceros). */
  const gfont = await (async () => { let got; await listeners.fetch({request: new Request('https://fonts.gstatic.com/s/geist.woff2'), respondWith: (x) => { got = x; }}); return got; })();
  ok(gfont === undefined, 'no toca Google Fonts (las fuentes son del propio sitio)');

  /* Otra página (política de privacidad) no debe pisar la copia de la app. */
  online = true;
  const legalReq = new Request('https://w.test/legal/privacidad/');
  Object.defineProperty(legalReq, 'mode', {value: 'navigate'});
  const legalRes = await fire('fetch', {request: legalReq});
  ok(legalRes.ok, 'página legal: con red responde');
  online = false;
  const appReq = new Request('https://w.test/');
  Object.defineProperty(appReq, 'mode', {value: 'navigate'});
  const appOffline = await fire('fetch', {request: appReq});
  const appText = await appOffline.text();
  ok(appText.indexOf('/legal/') === -1, 'abrir una página legal no pisa la copia de la app sin conexión');
  const legalReq2 = new Request('https://w.test/legal/privacidad/');
  Object.defineProperty(legalReq2, 'mode', {value: 'navigate'});
  const legalOffline = await fire('fetch', {request: legalReq2});
  ok(legalOffline.ok, 'página legal sin conexión sale de su propia copia');
  const sdk = await (async () => { online = true; await fire('fetch', {request: new Request('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js')}); online = false; return fire('fetch', {request: new Request('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js')}); })();
  ok(sdk.ok, 'SDK de Firebase sin conexión sale de la caché');
  const other = await (async () => { let got; await listeners.fetch({request: new Request('https://www.gstatic.com/otra/cosa.js'), respondWith: (x) => { got = x; }}); return got; })();
  ok(other === undefined, 'no guarda otras URL de gstatic');
})();
