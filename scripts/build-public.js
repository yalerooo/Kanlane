/* Prepara dist/: la carpeta que publica Firebase Hosting.
   Copia SOLO lo que forma la app (lista blanca), para que nunca se publiquen
   por error datos o archivos privados de la carpeta (data-backup.json, etc.).
   Se ejecuta solo antes de "firebase deploy" (predeploy en firebase.json). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
const INCLUDE = ['index.html', 'assets', 'src'];

fs.rmSync(out, {recursive:true, force:true});
fs.mkdirSync(out);
for(const item of INCLUDE){
  fs.cpSync(path.join(root, item), path.join(out, item), {recursive:true});
}

/* Aviso si la configuración de Firebase sigue vacía o apunta a los emuladores. */
const cfg = fs.readFileSync(path.join(root, 'src/config/firebase-config.js'), 'utf8');
if(/apiKey:\s*''/.test(cfg)) console.warn('⚠  src/config/firebase-config.js no tiene apiKey: la web funcionará en modo local, sin inicio de sesión.');
if(/useEmulators:\s*true/.test(cfg)) console.warn('⚠  useEmulators está en true: ponlo en false antes de publicar.');
console.log('dist/ listo: ' + INCLUDE.join(', '));
