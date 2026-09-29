/* Etiquetas: catálogo del proyecto abierto ([{name, color}], color en hexadecimal
   sin #) y HTML de las etiquetas y de las pull requests vinculadas. */
(function(){
  const {esc} = Workhub.utils.html;

  /* Colores para etiquetas nuevas (los mismos que ofrece GitHub por defecto). */
  const PALETTE = ['d73a4a', 'fbca04', '0e8a16', '1d76db', '5319e7', 'e99695', 'bfd4f2', '6e7681'];

  let catalog = [];
  let byName = {};

  const color = (c) => (/^[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : '6e7681');

  const PR_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>';

  Workhub.views.labels = {
    PALETTE: PALETTE,
    color: color,

    setCatalog(list){
      catalog = (Array.isArray(list) ? list : []).filter((l) => l && l.name);
      byName = {};
      catalog.forEach((l) => { byName[l.name.toLowerCase()] = l; });
    },

    catalog(){ return catalog.slice(); },

    colorOf(name){
      const l = byName[String(name).toLowerCase()];
      return color(l && l.color);
    },

    /* Etiqueta con su color. */
    chip(name, c){
      return '<span class="label-chip" translate="no" style="--lc:#' + color(c || this.colorOf(name)) + '">' + esc(name) + '</span>';
    },

    /* Etiquetas de una tarea (en tarjetas: como mucho max y un «+N»). */
    chips(names, max){
      const list = Array.isArray(names) ? names : [];
      const shown = max ? list.slice(0, max) : list;
      return shown.map((n) => this.chip(n)).join('') +
        (max && list.length > max ? '<span class="label-more">+' + (list.length - max) + '</span>' : '');
    },

    /* Pull request vinculada: {n|number, url, state, title}. Con enlace en la ficha. */
    pr(p, link){
      const n = p.n || p.number;
      const state = String(p.state || 'OPEN').toLowerCase();
      const title = (p.title ? p.title + ' · ' : '') + Workhub.t(state === 'merged' ? 'Fusionada' : state === 'closed' ? 'Cerrada' : 'Abierta');
      const inner = PR_ICON + '<span>#' + esc(n) + '</span>';
      if(link && /^https:\/\/github\.com\//.test(p.url || '')){
        return '<a class="pr-chip is-' + state + '" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(title) + '">' + inner + '</a>';
      }
      return '<span class="pr-chip is-' + state + '" title="' + esc(title) + '">' + inner + '</span>';
    },

    prs(list, max, link){
      const all = Array.isArray(list) ? list : [];
      const shown = max ? all.slice(0, max) : all;
      return shown.map((p) => this.pr(p, link)).join('') +
        (max && all.length > max ? '<span class="label-more">+' + (all.length - max) + '</span>' : '');
    }
  };
})();
