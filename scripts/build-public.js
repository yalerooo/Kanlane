/* Prepara dist/: la carpeta que publica Cloudflare (y Firebase Hosting).
   Copia SOLO lo que forma la app (lista blanca), para que nunca se publiquen
   por error datos o archivos privados de la carpeta (data-backup.json, etc.).
   Los scripts y las hojas de estilo de cada página se unen en unos pocos archivos
   (scripts/bundle.js): la app pasa de más de cien peticiones a un puñado.
   Además genera dist/_headers con las cabeceras de seguridad: es la ÚNICA
   fuente de la CSP y del resto de cabeceras (guía: docs/CLOUDFLARE.md).
   Cloudflare ejecuta este script en cada publicación (Build command:
   node scripts/build-public.js; wrangler.jsonc publica la carpeta dist).
   Firebase Hosting lo ejecuta antes de "firebase deploy" (predeploy). */
const fs = require('fs');
const path = require('path');
const {pageDirs, buildSitemap} = require('./site-pages');
const {bundle, DIR: BUNDLE_DIR} = require('./bundle');
const {securityTxt, FILES: SECURITY_FILES} = require('./security-txt');

/* KANLANE_ROOT solo lo usan las pruebas (tests/e2e/sitemap-check.js) para construir una copia. */
const root = process.env.KANLANE_ROOT ? path.resolve(process.env.KANLANE_ROOT) : path.join(__dirname, '..');
const out = path.join(root, 'dist');
/* Páginas de captación e idiomas: toda carpeta de primer nivel con index.html que no sea app, demo,
   legal o un directorio de recursos (ver scripts/site-pages.js). Añadir una página = crear su carpeta. */
const PAGES = pageDirs(root);
const INCLUDE = ['index.html', '404.html', 'app', 'demo'].concat(PAGES, ['robots.txt', 'llms.txt', 'manifest.webmanifest', 'sw.js', 'assets', 'src', 'plugins', 'legal']);

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
   - frame-ancestors / X-Frame-Options: ninguna otra web puede meter Kanlane
     en un marco para engañarte con clics.
   - script-src: solo scripts de este dominio y del SDK de Firebase/Google;
     ningún script en línea ni eval, así una inyección de HTML no ejecuta nada.
   - connect-src: la app solo habla con los servicios de Google/Firebase y con
     la API de GitHub (integración con GitHub Projects). www.gstatic.com está
     para que las herramientas de desarrollo puedan bajar los mapas de código
     (.js.map) del SDK de Firebase, que ya se carga desde ahí en script-src.
   - frame-src: solo la aplicación (/app/) abre marcos de otros dominios: los plugins de
     terceros, que se cargan en un <iframe sandbox> desde la dirección https que pega cada
     persona (aislados: ver src/services/plugin-host.js; http://localhost es para
     desarrollarlos), el marco de reCAPTCHA (App Check) y el del acceso de Firebase. No se
     puede cerrar a una lista de dominios sin quitar los plugins de terceros. El resto del
     sitio (portada, páginas de captación, demo y legales) solo enmarca al propio dominio.
   - style-src: las hojas de estilo son solo las del propio dominio (style-src-elem): un
     <style> inyectado no se aplica. Los atributos style="…" siguen permitidos
     (style-src-attr) porque las vistas pintan con ellos colores y anchos que salen de los
     datos. style-src es el respaldo para los navegadores que no conocen las dos anteriores
     (Safari anterior a 15.4, Firefox anterior a 105): ahí queda como estaba.
   Si añades otro servicio externo, añade su dominio aquí. */
const FRAMES_SITE = "'self'";
const FRAMES_APP = "'self' https: http://localhost:* http://127.0.0.1:*";
function csp(frames){
  return [
    "default-src 'self'",
    "script-src 'self' https://www.gstatic.com https://apis.google.com https://www.google.com https://www.recaptcha.net",
    "connect-src 'self' https://www.gstatic.com https://*.googleapis.com https://apis.google.com https://api.github.com https://www.google.com https://www.recaptcha.net",
    'frame-src ' + frames,
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests'
  ].join('; ');
}
const CSP = csp(FRAMES_SITE);

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
const APP = Object.assign({}, PAGE, {'Content-Security-Policy': csp(FRAMES_APP), 'X-Robots-Tag': 'noindex, follow'});

/* La demo del tablero (/demo/) se enseña dentro de la portada en un marco del mismo sitio:
   por eso, a diferencia del resto, permite que la enmarque el propio dominio. No se indexa. */
const DEMO = Object.assign({}, PAGE, {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
  'X-Robots-Tag': 'noindex, follow'
});

/* ---------- security.txt (scripts/security-txt.js) ----------
   «contact» lo tiene que poner el titular: una o varias direcciones «mailto:…» o «https://…»
   que de verdad se atiendan. Vacío, no se publica el archivo y el build avisa (no se inventa
   ningún contacto). */
const SECURITY = {
  contact: ['https://github.com/yalerooo/Kanlane/security/advisories/new'],
  languages: 'es, en',
  canonical: 'https://kanlane.com/.well-known/security.txt'
};

/* Formato de _headers de Cloudflare: una ruta y, debajo, sus cabeceras
   con sangría. Si varias rutas coinciden, se suman. */
function headersFile(){
  const block = (route, values) => route + '\n' + Object.keys(values).map((k) => '  ' + k + ': ' + values[k]).join('\n') + '\n';
  /* El service worker nunca se guarda en caché: así una versión nueva se detecta al momento. */
  const SW = {'Cache-Control': 'no-cache'};
  /* Los paquetes de scripts y estilos llevan el resumen de su contenido en el nombre: uno que
     cambia tiene otro nombre, así que el navegador puede guardarlos sin volver a preguntar. */
  const BUNDLES = {'Cache-Control': 'public, max-age=31536000, immutable'};
  /* Una entrada por página de captación o idioma, detectadas de las carpetas (PAGES). */
  return [block('/*', ALL), block('/', PAGE), block('/index.html', PAGE)].concat(PAGES.map((p) => block('/' + p + '/*', PAGE)), [block('/app/*', APP), block('/demo/*', DEMO), block('/legal/*', LEGAL), block('/sw.js', SW), block('/manifest.webmanifest', SW), block('/' + BUNDLE_DIR + '/*', BUNDLES)]).join('\n');
}

/* ---------- dist/ ---------- */

/* Se vacía el contenido en lugar de borrar la carpeta: en Windows falla (EPERM) si algún proceso la tiene abierta. */
fs.mkdirSync(out, {recursive:true});
fs.readdirSync(out).forEach((name) => fs.rmSync(path.join(out, name), {recursive:true, force:true}));
for(const item of INCLUDE){
  fs.cpSync(path.join(root, item), path.join(out, item), {recursive:true});
}
fs.writeFileSync(path.join(out, '_headers'), headersFile());

const security = securityTxt(SECURITY, Date.now());
if(security){
  SECURITY_FILES.forEach((f) => {
    fs.mkdirSync(path.dirname(path.join(out, f)), {recursive:true});
    fs.writeFileSync(path.join(out, f), security);
  });
}else{
  console.warn('⚠  security.txt no se publica: falta un contacto válido (mailto: o https://) en SECURITY.contact de scripts/build-public.js.');
}

/* Un archivo por grupo de scripts o de hojas de estilo. Los plugins no se tocan: cada uno es
   una página aparte que se carga en su propio marco. Si algo no se puede unir, el build falla. */
let packed;
try{
  packed = bundle(out, ['plugins']);
}catch(e){
  console.error('✖ ' + e.message);
  process.exit(1);
}
console.log('paquetes: ' + packed.bundles.length + ' archivos en ' + BUNDLE_DIR + '/ para ' + packed.pages + ' páginas (sustituyen a ' + packed.removed.length + ' sueltos)');

/* sitemap.xml se genera aquí (no hay copia manual): URL y alternativas de idioma salen del
   canonical y los hreflang de cada página. Si algo no cuadra, el build falla. */
let sitemap;
try{
  sitemap = buildSitemap(out, root, PAGES);
}catch(e){
  console.error('✖ ' + e.message);
  process.exit(1);
}
fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap.xml);
if(sitemap.missing.length) console.warn('⚠ sin <meta name="last-modified"> (el sitemap no tendrá lastmod si no hay historial de git): ' + sitemap.missing.join(', '));
console.log('sitemap.xml: ' + sitemap.count + ' URLs (fecha de git: ' + sitemap.sources.git + ', de meta last-modified: ' + sitemap.sources.meta + ', sin fecha: ' + sitemap.sources['sin fecha'] + ')');

/* Service worker: se le inyecta la lista de archivos de esta versión y una marca
   (un resumen de su contenido). Si cambia un solo archivo, la marca cambia y los
   navegadores instalan la versión nueva. */
function listFiles(dir, base){
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((d) => {
    const rel = base + '/' + d.name;
    return d.isDirectory() ? listFiles(path.join(dir, d.name), rel) : [rel];
  });
}
/* Las páginas 404 no se guardan: sin conexión no hacen falta y, si su descarga fallara, no se instalaría la versión.
   security.txt tampoco: no es de la app y su fecha cambia en cada build (cambiaría la versión sin haber cambiado nada). */
const files = listFiles(out, '').filter((f) => f !== '/_headers' && f !== '/sw.js' && SECURITY_FILES.indexOf(f) === -1 && !/\/404\.html$/.test(f)).sort();
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
console.log('dist/ listo: ' + INCLUDE.join(', ') + ' + _headers + sitemap.xml (' + files.length + ' archivos en el service worker, versión ' + build + ')');
