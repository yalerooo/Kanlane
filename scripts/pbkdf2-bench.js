/* Mide cuánto tarda PBKDF2-SHA256 con las iteraciones del cifrado por proyecto (600 000, D15)
   usando el propio src/services/project-crypto.js con Web Crypto de Node.
     node scripts/pbkdf2-bench.js          → 5 rondas
     node scripts/pbkdf2-bench.js 10       → 10 rondas
   Esto mide ESTE ordenador. D15 pide medirlo en un móvil de gama baja: ver
   docs/CIFRADO-PROYECTOS.md, apartado 15.2 (PR1), con el fragmento para la consola del navegador. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const Workhub = {services:{}};
for(const rel of ['src/services/crypto.js', 'src/services/project-crypto.js']){
  new Function('Workhub', 'window', 'crypto', fs.readFileSync(path.join(root, rel), 'utf8'))(Workhub, {crypto:globalThis.crypto}, globalThis.crypto);
}
const PC = Workhub.services.projectCrypto;
const rounds = Math.max(1, Math.min(50, parseInt(process.argv[2], 10) || 5));

(async () => {
  const ctx = {pid:PC.newPid(), kid:PC.newKid(), uid:'bench'};
  const raw = PC.newDekBytes();
  const PASS = 'una contraseña de prueba cualquiera';
  const doc = await PC.wrapPassword(raw, PASS, ctx);   /* calentamiento */
  const times = [];
  for(let i = 0; i < rounds; i++){
    const t0 = process.hrtime.bigint();
    await PC.unwrapPassword(doc, PASS, ctx);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log('PBKDF2-SHA256 ' + PC.KDF_ITERATIONS.toLocaleString('es-ES') + ' iteraciones (desenvolver la DEK), ' + rounds + ' rondas');
  console.log('  mediana ' + median.toFixed(0) + ' ms · mínimo ' + times[0].toFixed(0) + ' ms · máximo ' + times[times.length - 1].toFixed(0) + ' ms');
  console.log('  ' + os.cpus()[0].model.trim() + ' · Node ' + process.version + ' · ' + os.platform());
  console.log(median < 1000
    ? '  Menos de 1 s en este equipo. D15 decide con la medida de un móvil de gama baja, no con esta.'
    : '  Más de 1 s en este equipo: no subir las iteraciones.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
