/* Prepara dist/: la carpeta que publica Cloudflare (y Firebase Hosting).
   Copia SOLO lo que forma la app (lista blanca), para que nunca se publiquen
   por error datos o archivos privados de la carpeta (data-backup.json, etc.).
   Además genera dist/_headers con las cabeceras de seguridad: es la ÚNICA
   fuente de la CSP y del resto de cabeceras (guía: docs/CLOUDFLARE.md).
   Cloudflare ejecuta este script en cada publicación (Build command:
   node scripts/build-public.js; wrangler.jsonc publica la carpeta dist).
   Firebase Hosting lo ejecuta antes de "firebase deploy" (predeploy). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
const INCLUDE = ['index.html', 'app', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'sw.js', 'assets', 'src', 'plugins', 'legal'];

/* ---------- Cabeceras de seguridad ---------- */

/* Para todo el sitio. */
const ALL = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

/* Solo la página de la app (no /__/auth/*, que es de Firebase y tiene sus
   propias reglas: debe poder abrirse en ventana y en un marco oculto).
   - frame-ancestors / X-Frame-Options: ninguna otra web puede meter Workhub
     en un marco para engañarte con clics.
   - script-src: solo scripts de este dominio y del SDK de Firebase/Google;
     ningún script en línea ni eval, así una inyección de HTML no ejecuta nada.
   - connect-src: la app solo habla con los servicios de Google/Firebase y con
     la API de GitHub (integración con GitHub Projects).
   - frame-src https:: los plugins de terceros se cargan en un <iframe sandbox>
     desde su propio dominio (aislados: ver src/services/plugin-host.js).
   Si añades otro servicio externo, añade su dominio aquí. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com https://apis.google.com https://www.google.com https://www.recaptcha.net",
  "connect-src 'self' https://*.googleapis.com https://apis.google.com https://api.github.com https://www.google.com https://www.recaptcha.net",
  "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests'
].join('; ');

const PAGE = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': CSP
};

/* Páginas legales: llevan el nombre, NIF, domicilio y correo del titular, así que no
   deben salir en buscadores ni guardarse en su caché. Siguen siendo públicas para
   quien tenga el enlace (la ley exige que se puedan consultar).
   OJO: no bloquear /legal/ en robots.txt. Si el robot no puede leer la página, no ve
   el noindex y Google puede indexar igualmente la dirección. */
const LEGAL = Object.assign({}, PAGE, {'X-Robots-Tag': 'noindex, nofollow, noarchive'});

/* La aplicación (/app/) necesita sesión: no tiene nada que indexar. A diferencia de las
   páginas legales NO se bloquea en robots.txt, para que el robot pueda leer el noindex. */
const APP = Object.assign({}, PAGE, {'X-Robots-Tag': 'noindex, follow'});

/* Formato de _headers de Cloudflare: una ruta y, debajo, sus cabeceras
   con sangría. Si varias rutas coinciden, se suman. */
function headersFile(){
  const block = (route, values) => route + '\n' + Object.keys(values).map((k) => '  ' + k + ': ' + values[k]).join('\n') + '\n';
  /* El service worker nunca se guarda en caché: así una versión nueva se detecta al momento. */
  const SW = {'Cache-Control': 'no-cache'};
  return [block('/*', ALL), block('/', PAGE), block('/index.html', PAGE), block('/app/*', APP), block('/legal/*', LEGAL), block('/sw.js', SW), block('/manifest.webmanifest', SW)].join('\n');
}

/* ---------- dist/ ---------- */

fs.rmSync(out, {recursive:true, force:true});
fs.mkdirSync(out);
for(const item of INCLUDE){
  fs.cpSync(path.join(root, item), path.join(out, item), {recursive:true});
}
fs.writeFileSync(path.join(out, '_headers'), headersFile());

/* Service worker: se le inyecta la lista de archivos de esta versión y una marca
   (un resumen de su contenido). Si cambia un solo archivo, la marca cambia y los
   navegadores instalan la versión nueva. */
function listFiles(dir, base){
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((d) => {
    const rel = base + '/' + d.name;
    return d.isDirectory() ? listFiles(path.join(dir, d.name), rel) : [rel];
  });
}
const files = listFiles(out, '').filter((f) => f !== '/_headers' && f !== '/sw.js').sort();
const hash = require('crypto').createHash('sha1');
files.forEach((f) => { hash.update(f); hash.update(fs.readFileSync(path.join(out, f))); });
const build = hash.digest('hex').slice(0, 10);
const swPath = path.join(out, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if(!/const BUILD = '[^']*';/.test(sw) || !/const FILES = \[\];/.test(sw)) throw new Error('sw.js: no encuentro BUILD y FILES');
sw = sw.replace(/const BUILD = '[^']*';/, "const BUILD = '" + build + "';")
  .replace(/const FILES = \[\];/, () => 'const FILES = ' + JSON.stringify(['/'].concat(files)) + ';');
fs.writeFileSync(swPath, sw);

/* Aviso si faltan los datos del titular de las páginas legales (obligatorios: LSSI-CE art. 10 y RGPD art. 13). */
const legal = fs.readFileSync(path.join(root, 'src/config/legal-config.js'), 'utf8');
const missingLegal = ['titular', 'nif', 'domicilio', 'email'].filter((k) => new RegExp(k + ":\\s*''").test(legal));
if(missingLegal.length) console.warn('⚠  src/config/legal-config.js: faltan datos del titular (' + missingLegal.join(', ') + '). Las páginas legales los muestran como «[completar: …]»; rellénalos antes de publicar.');

/* Aviso si la configuración de Firebase sigue vacía o apunta a los emuladores. */
const cfg = fs.readFileSync(path.join(root, 'src/config/firebase-config.js'), 'utf8');
if(/apiKey:\s*''/.test(cfg)) console.warn('⚠  src/config/firebase-config.js no tiene apiKey: la web funcionará en modo local, sin inicio de sesión.');
if(/useEmulators:\s*true/.test(cfg)) console.warn('⚠  useEmulators está en true: ponlo en false antes de publicar.');
console.log('dist/ listo: ' + INCLUDE.join(', ') + ' + _headers (' + files.length + ' archivos en el service worker, versión ' + build + ')');
