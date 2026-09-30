/* Prepara dist/: la carpeta que publica Cloudflare Pages (y Firebase Hosting).
   Copia SOLO lo que forma la app (lista blanca), para que nunca se publiquen
   por error datos o archivos privados de la carpeta (data-backup.json, etc.).
   Además genera dist/_headers con las cabeceras de seguridad: es la ÚNICA
   fuente de la CSP y del resto de cabeceras (guía: docs/CLOUDFLARE.md).
   Cloudflare Pages ejecuta este script en cada publicación
   (build command: node scripts/build-public.js, output directory: dist).
   Firebase Hosting lo ejecuta antes de "firebase deploy" (predeploy). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
const INCLUDE = ['index.html', 'assets', 'src', 'plugins'];

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
  "script-src 'self' https://www.gstatic.com https://apis.google.com",
  "connect-src 'self' https://*.googleapis.com https://apis.google.com https://api.github.com",
  "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
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

/* Formato de _headers de Cloudflare Pages: una ruta y, debajo, sus cabeceras
   con sangría. Si varias rutas coinciden, se suman. */
function headersFile(){
  const block = (route, values) => route + '\n' + Object.keys(values).map((k) => '  ' + k + ': ' + values[k]).join('\n') + '\n';
  return [block('/*', ALL), block('/', PAGE), block('/index.html', PAGE)].join('\n');
}

/* ---------- dist/ ---------- */

fs.rmSync(out, {recursive:true, force:true});
fs.mkdirSync(out);
for(const item of INCLUDE){
  fs.cpSync(path.join(root, item), path.join(out, item), {recursive:true});
}
fs.writeFileSync(path.join(out, '_headers'), headersFile());

/* Aviso si la configuración de Firebase sigue vacía o apunta a los emuladores. */
const cfg = fs.readFileSync(path.join(root, 'src/config/firebase-config.js'), 'utf8');
if(/apiKey:\s*''/.test(cfg)) console.warn('⚠  src/config/firebase-config.js no tiene apiKey: la web funcionará en modo local, sin inicio de sesión.');
if(/useEmulators:\s*true/.test(cfg)) console.warn('⚠  useEmulators está en true: ponlo en false antes de publicar.');
console.log('dist/ listo: ' + INCLUDE.join(', ') + ' + _headers');
