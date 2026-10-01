/* Servidor local para trabajar en Workhub sin esperar a ningún despliegue.
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

const args = process.argv.slice(2);
const cloud = args.indexOf('--nube') !== -1;
const emulator = args.indexOf('--emulador') !== -1;
const reload = args.indexOf('--sin-recarga') === -1;
const pi = args.indexOf('--puerto');
const PORT = pi !== -1 && +args[pi + 1] ? +args[pi + 1] : 5500;

const ROOT = path.resolve(__dirname, '..');
/* Lo mismo que publica scripts/build-public.js: nada de data-backup.json, docs, etc. */
const SERVED = ['index.html', 'app', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'sw.js', 'assets', 'src', 'plugins', 'legal'];
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
