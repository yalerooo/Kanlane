/* Servidor local para trabajar en Kanlane sin esperar a ningún despliegue.
   Sirve la carpeta del proyecto y recarga el navegador solo cuando guardas un
   archivo (index.html, assets/, src/ o plugins/). No tiene dependencias: solo Node.

     node scripts/dev.js            → modo local: sin inicio de sesión, los datos se
                                      guardan solo en este navegador. Es el seguro.
     node scripts/dev.js --nube     → con Firebase real: pide iniciar sesión y usa
                                      los datos de verdad (¡lo que cambies se guarda!).
     node scripts/dev.js --puerto 8080

   Guía: README.md, apartado «Trabajar en local». */
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const {pageDirs} = require('./site-pages');

const args = process.argv.slice(2);
const cloud = args.indexOf('--nube') !== -1;
const emulator = args.indexOf('--emulador') !== -1;
const reload = args.indexOf('--sin-recarga') === -1;
const pi = args.indexOf('--puerto');
const PORT = pi !== -1 && +args[pi + 1] ? +args[pi + 1] : 5500;

const ROOT = path.resolve(__dirname, '..');
/* Lo mismo que publica scripts/build-public.js: nada de data-backup.json, docs, etc. */
/* Las páginas de captación e idiomas se detectan igual que en el build (scripts/site-pages.js).
   sitemap.xml no se sirve aquí: solo existe generado en dist/ (node scripts/build-public.js). */
const SERVED = ['index.html', 'app', 'demo'].concat(pageDirs(ROOT), ['robots.txt', 'manifest.webmanifest', 'sw.js', 'assets', 'src', 'plugins', 'legal']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};

/* Recarga automática: la página se suscribe a /__dev/events y recarga al recibir "reload". */
const clients = new Set();
const RELOAD_SNIPPET = '<script>(function(){var e=new EventSource("/__dev/events");e.onmessage=function(m){if(m.data==="reload")location.reload();};})();</script>';

let timer = null;
function changed(file){
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log('  cambió ' + file + ' → recargando');
    clients.forEach((res) => res.write('data: reload\n\n'));
  }, 120);
}
if(reload) SERVED.forEach((item) => {
  const p = path.join(ROOT, item);
  if(!fs.existsSync(p)) return;
  try{
    fs.watch(p, {recursive: true}, (ev, name) => changed(item + (name ? '/' + String(name).replace(/\\/g, '/') : '')));
  }catch(e){
    /* Linux antiguo sin watch recursivo: se sigue sin recarga automática. */
  }
});

const server = http.createServer((req, res) => {
  let url;
  try{ url = decodeURIComponent(req.url.split('?')[0]); }catch(e){ res.statusCode = 400; return res.end('Solicitud no válida'); }

  if(url === '/__dev/events'){
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  /* Servidor de claves del modo gestionado, SOLO con los emuladores (pruebas de navegador): hace lo
     mismo que worker/index.js pero con un secreto fijo y sin verificar la firma del token, porque los
     del emulador de Authentication no van firmados. En producción lo atiende el Worker. */
  if(url === '/__/kms/v1/kek' && emulator){
    const send = (status, body) => { res.writeHead(status, {'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store'}); res.end(JSON.stringify(body)); };
    if(req.method !== 'POST') return send(405, {error: 'method'});
    let raw = '';
    req.on('data', (chunk) => { if(raw.length <= 512) raw += chunk; });
    req.on('end', () => {
      try{
        const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization || '');
        const claims = JSON.parse(Buffer.from(token[1].split('.')[1], 'base64url').toString('utf8'));
        const uid = claims.user_id || claims.sub;
        const body = JSON.parse(raw);
        if(!uid) return send(401, {error: 'auth'});
        if(!/^[A-Za-z0-9_-]{22}$/.test(body.pid) || !/^[A-Za-z0-9_-]{11}$/.test(body.kid)) return send(400, {error: 'request'});
        const kek = nodeCrypto.hkdfSync('sha256', Buffer.alloc(32, 7), Buffer.from('kanlane-kms-v1'), Buffer.from('u:' + uid + '|' + body.pid + '|' + body.kid), 32);
        send(200, {v: 1, kmsv: 1, kek: Buffer.from(kek).toString('base64url')});
      }catch(e){
        send(401, {error: 'auth'});
      }
    });
    return;
  }

  /* «/legal/privacidad/» sirve su index.html, como hace Cloudflare. */
  if(url.slice(-1) === '/') url += 'index.html';

  /* Modo local: la configuración de Firebase va vacía y la app arranca sin cuenta. */
  if(url === '/src/config/firebase-config.js' && emulator){
    res.writeHead(200, {'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store'});
    return res.end('window.WORKHUB_FIREBASE = ' + JSON.stringify({apiKey:'demo-key', authDomain:'demo-workhub.firebaseapp.com',
      projectId:'demo-workhub', appId:'demo-app', providers:['password'], allowSignup:true,
      useEmulators:true, authEmulatorPort:9197, firestoreEmulatorPort:8187}) + ';\n');
  }
  if(url === '/src/config/firebase-config.js' && !cloud){
    res.writeHead(200, {'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store'});
    return res.end("window.WORKHUB_FIREBASE = {apiKey: '', projectId: ''};\n");
  }

  const first = url.split('/')[1];
  const file = path.join(ROOT, url);
  if(SERVED.indexOf(first) === -1 || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.statusCode = 404;
    return res.end('No encontrado: ' + url);
  }

  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  if(/\.html$/.test(url) && reload){
    return res.end(fs.readFileSync(file, 'utf8').replace('</body>', RELOAD_SNIPPET + '</body>'));
  }
  fs.createReadStream(file).pipe(res);
});

server.on('error', (err) => {
  if(err.code === 'EADDRINUSE') console.error('El puerto ' + PORT + ' ya está en uso. Cierra el otro servidor o usa: node scripts/dev.js --puerto ' + (PORT + 1));
  else console.error(err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('\nWorkhub en local: http://localhost:' + PORT + '/app/   (la portada pública está en http://localhost:' + PORT + '/)');
  console.log(cloud
    ? 'Modo NUBE: Firebase real. Lo que cambies se guarda en tus datos de verdad.'
    : 'Modo local: sin cuenta; los datos se guardan solo en este navegador.');
  console.log('Guarda un archivo y la página se recarga sola. Cierra con Ctrl+C.\n');
});
