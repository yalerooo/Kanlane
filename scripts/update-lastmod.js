/* Mantiene al día <meta name="last-modified" content="YYYY-MM-DD"> en las páginas indexables.
   Cloudflare clona sin historial de git, así que el sitemap saca `lastmod` de esa meta.

     node scripts/update-lastmod.js          pone la fecha de hoy (meta, "dateModified" del JSON-LD y la fecha visible
                                             <time datetime="…" data-lastmod>, si la hay) en las páginas con cambios
                                             (respecto a origin/main o sin confirmar)
     node scripts/update-lastmod.js --check  no escribe; sale con código 1 si alguna meta falta,
                                             es más antigua que el último cambio en git o la
                                             página tiene cambios y la meta no es de hoy
   Sin git o con un clon superficial (sin historial) --check solo avisa y no falla. */
'use strict';
const fs = require('fs');
const path = require('path');
const {pageFiles, validDate, metaContent, jsonLdDates, gitDate, git} = require('./site-pages');

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

/* Fecha visible («Actualizado: 2 de octubre de 2026» / «Updated: October 2, 2026») según <html lang>. */
const MONTHS = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};
function visibleDate(html, date){
  const [y, m, d] = date.split('-').map(Number);
  const lang = ((html.match(/<html[^>]*\slang="([a-z]+)/i) || [])[1] || 'es').toLowerCase();
  return lang === 'en' ? MONTHS.en[m - 1] + ' ' + d + ', ' + y : d + ' de ' + MONTHS.es[m - 1] + ' de ' + y;
}
const TIME_RE = /(<time datetime=")([^"]*)(" data-lastmod>)([^<]*)(<\/time>)/g;

/* Cambia el valor de la meta (o la inserta tras description), respetando saltos de línea y sangría.
   También pone la misma fecha en el "dateModified" del JSON-LD y en la fecha visible
   <time datetime="…" data-lastmod>, para que no se desincronicen. */
function withMeta(html, date){
  html = html.replace(/("dateModified"\s*:\s*")[^"]*(")/g, '$1' + date + '$2');
  html = html.replace(TIME_RE, (m, a, v, b, t, c) => a + date + b + visibleDate(html, date) + c);
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
  const ld = jsonLdDates(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).filter((d) => d !== meta);
  if(ld.length) return problems.push(f + ': el "dateModified" del JSON-LD (' + ld[0] + ') no coincide con la meta (' + meta + ')');
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const shown = [...html.matchAll(TIME_RE)].find((t) => t[2] !== meta || t[4] !== visibleDate(html, meta));
  if(shown) return problems.push(f + ': la fecha visible (' + shown[2] + ', «' + shown[4] + '») no coincide con la meta (' + meta + ')');
  if(last && meta < last) return problems.push(f + ': la meta (' + meta + ') es más antigua que su último cambio en git (' + last + ')');
  if(changed && changed.has(f) && meta !== TODAY) problems.push(f + ': tiene cambios y la meta (' + meta + ') no es de hoy (' + TODAY + ')');
});
if(!hasHistory) console.warn('Aviso: sin git o sin historial (clon superficial); no se puede comparar con los cambios.');
if(problems.length){
  console.error('Fechas last-modified por actualizar (' + problems.length + '):\n  ' + problems.join('\n  ') + '\nEjecuta: node scripts/update-lastmod.js');
  process.exit(1);
}
console.log('last-modified correcta en ' + files.length + ' páginas.');
