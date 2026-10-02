/* Mantiene al día <meta name="last-modified" content="YYYY-MM-DD"> en las páginas indexables.
   Cloudflare clona sin historial de git, así que el sitemap saca `lastmod` de esa meta.

     node scripts/update-lastmod.js          pone la fecha de hoy en las páginas con cambios
                                             (respecto a origin/main o sin confirmar)
     node scripts/update-lastmod.js --check  no escribe; sale con código 1 si alguna meta falta,
                                             es más antigua que el último cambio en git o la
                                             página tiene cambios y la meta no es de hoy
   Sin git o con un clon superficial (sin historial) --check solo avisa y no falla. */
'use strict';
const fs = require('fs');
const path = require('path');
const {pageFiles, validDate, metaContent, gitDate, git} = require('./site-pages');

const ROOT = process.env.KANLANE_ROOT ? path.resolve(process.env.KANLANE_ROOT) : path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

/* Archivos con cambios: respecto a origin/main (o main) y sin confirmar. null = sin git. */
function changedFiles(){
  try{
    git(ROOT, ['rev-parse', '--is-inside-work-tree']);
  }catch(e){ return null; }
  const set = new Set();
  const lines = (args) => { try{ return git(ROOT, args).split('\n').filter(Boolean); }catch(e){ return null; } };
  const base = ['origin/main', 'main'].find((b) => lines(['rev-parse', '--verify', '--quiet', b]) !== null);
  if(base) (lines(['diff', '--name-only', base]) || []).forEach((f) => set.add(f));
  (lines(['diff', '--name-only', 'HEAD']) || []).forEach((f) => set.add(f));
  (lines(['status', '--porcelain', '--untracked-files=all']) || []).forEach((l) => set.add(l.slice(3).replace(/^"|"$/g, '').replace(/.* -> /, '')));
  return set;
}

/* Cambia el valor de la meta (o la inserta tras description), respetando saltos de línea y sangría. */
function withMeta(html, date){
  if(/<meta\s+name="last-modified"/i.test(html)) return html.replace(/(<meta\s+name="last-modified"\s+content=")[^"]*(")/i, '$1' + date + '$2');
  const n = html.replace(/^([ \t]*)(<meta name="description"[^\r\n]*>)(\r?\n)/m,
    (m, i, t, e) => i + t + e + i + '<meta name="last-modified" content="' + date + '">' + e);
  if(n === html) throw new Error('no encuentro <meta name="description"> donde insertar la meta');
  return n;
}

const files = pageFiles(ROOT);
const changed = changedFiles();
const hasHistory = changed !== null && (() => {
  try{ return git(ROOT, ['rev-parse', '--is-shallow-repository']) === 'false' && git(ROOT, ['log', '-1', '--format=%H']) !== ''; }catch(e){ return false; }
})();

if(!CHECK){
  if(changed === null){ console.log('No hay git: no sé qué páginas cambiaron, no se toca nada.'); process.exit(0); }
  let n = 0;
  files.filter((f) => changed.has(f)).forEach((f) => {
    const file = path.join(ROOT, f);
    const html = fs.readFileSync(file, 'utf8');
    const next = withMeta(html, TODAY);
    if(next !== html){ fs.writeFileSync(file, next); n++; console.log('  ' + f + ' -> ' + TODAY); }
  });
  console.log(n ? 'last-modified actualizada en ' + n + ' página(s).' : 'Nada que actualizar (' + files.length + ' páginas indexables revisadas).');
  process.exit(0);
}

const problems = [];
files.forEach((f) => {
  const meta = metaContent(fs.readFileSync(path.join(ROOT, f), 'utf8'), 'last-modified');
  if(meta === null) return problems.push(f + ': no tiene <meta name="last-modified">');
  if(!validDate(meta)) return problems.push(f + ': la meta vale "' + meta + '" y no es una fecha YYYY-MM-DD válida');
  const last = hasHistory ? gitDate(ROOT, f) : null;
  if(last && meta < last) return problems.push(f + ': la meta (' + meta + ') es más antigua que su último cambio en git (' + last + ')');
  if(changed && changed.has(f) && meta !== TODAY) problems.push(f + ': tiene cambios y la meta (' + meta + ') no es de hoy (' + TODAY + ')');
});
if(!hasHistory) console.warn('Aviso: sin git o sin historial (clon superficial); no se puede comparar con los cambios.');
if(problems.length){
  console.error('Fechas last-modified por actualizar (' + problems.length + '):\n  ' + problems.join('\n  ') + '\nEjecuta: node scripts/update-lastmod.js');
  process.exit(1);
}
console.log('last-modified correcta en ' + files.length + ' páginas.');
