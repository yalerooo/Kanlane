/* Sumi, la mascota de Kanlane: un pulpo de tres brazos (corto, largo, medio) que son los
   carriles de un tablero. «Sumi» es tinta en japonés y, escrito de otra forma, «hecho».

   Aquí está la ÚNICA definición de su forma. La usan la aplicación (Workhub.views.sumi),
   scripts/make-brand.js (los SVG de la marca) y scripts/make-icons.js (los iconos PNG).
   Las normas de uso están en docs/marca/cuaderno-sumi.html; las que afectan al código:
   - una sola tinta (blanco o grafito) y los ojos son el fondo que asoma;
   - completo desde 32 px y, por debajo, la versión reducida (mini);
   - un Sumi por pantalla, sin contar el logotipo, y siempre junto a un texto que ya lo dice
     todo: por eso sale con aria-hidden salvo que se le pase un título. */
(function(root){
  'use strict';

  /* Lienzo de 64 × 64 y módulo de 5. Cada brazo: [x, ancho, hasta qué y llega]. */
  const ARMS = {
    full: [[12, 10, 47], [27, 10, 57], [42, 10, 52]],
    mini: [[10, 12, 49], [26, 12, 55], [42, 12, 51]]
  };
  const ARM_TOP = 34;    /* los brazos empiezan dentro del cuerpo… */
  const ARM_ROOT = 40;   /* …y asoman a esta altura; los de fuera giran aquí, para que la unión quede lisa */
  const SPLAY = 7;       /* grados que se abren los brazos de fuera (la versión reducida, 0) */
  /* Un detalle por estación, arriba a la derecha y en la tinta del cuerpo. {c} es ese color. */
  const SEASONS = {
    spring: '<g fill="{c}"><circle cx="54" cy="4.2" r="1.9"/><circle cx="56.7" cy="6.2" r="1.9"/><circle cx="55.7" cy="9.4" r="1.9"/><circle cx="52.3" cy="9.4" r="1.9"/><circle cx="51.3" cy="6.2" r="1.9"/></g>',
    summer: '<circle cx="54" cy="7" r="2.6" fill="{c}"/><path d="M54 .8v1.4M54 11.8v1.4M47.8 7h1.4M58.8 7h1.4M49.6 2.6l1 1M57.4 10.4l1 1M58.4 2.6l-1 1M50.6 10.4l-1 1" fill="none" stroke="{c}" stroke-width="1.6" stroke-linecap="round"/>',
    autumn: '<path d="M49.5 11Q49 3 58.5 2.5Q59 11 49.5 11Z" fill="{c}"/><path d="M49.5 11l-2 2" fill="none" stroke="{c}" stroke-width="1.6" stroke-linecap="round"/>',
    winter: '<path d="M54 1.5v11M49.2 4.2l9.6 5.6M58.8 4.2l-9.6 5.6" fill="none" stroke="{c}" stroke-width="1.7" stroke-linecap="round"/>'
  };
  const MOODS = ['normal', 'contento', 'guino', 'aviso', 'concentrado', 'dormido', 'triste', 'fiesta', 'cerrado'];

  function geometry(mini){
    const arms = mini ? ARMS.mini : ARMS.full;
    const x0 = arms[0][0], x1 = arms[2][0] + arms[2][1];
    return {
      arms: arms, x0: x0, x1: x1, splay: mini ? 0 : SPLAY, top: ARM_TOP, root: ARM_ROOT,
      /* El manto: cuatro curvas de Bézier, de la base izquierda a la derecha pasando por arriba. */
      head: [
        [x0, 37, x0 - 4.5, 34, x0 - 6, 29.5, x0 - 6, 26],
        [x0 - 6, 26, x0 - 6, 15.5, 18, 8, 32, 8],
        [32, 8, 46, 8, x1 + 6, 15.5, x1 + 6, 26],
        [x1 + 6, 26, x1 + 6, 29.5, x1 + 4.5, 34, x1, 37]
      ],
      /* Los huecos entre brazos acaban en medio círculo: [centro x, radio]. */
      gaps: [1, 2].map((i) => { const g = arms[i][0] - (arms[i - 1][0] + arms[i - 1][1]); return [arms[i][0] - g / 2, g / 2]; }),
      eyes: mini ? {x: [24, 40], y: 26, rx: 4.4, ry: 4.4} : {x: [24, 40], y: 26, rx: 3.1, ry: 4.1}
    };
  }

  /* soft: las dos esquinas de abajo, redondeadas con el radio de medio brazo y el centro en
     su hombro. Con los brazos colgando no se nota (las tapan), y es lo que deja levantar un
     brazo de fuera sin que debajo asome la esquina del cuerpo como un escalón. */
  function bodyPath(g, soft){
    const r = soft ? g.arms[0][1] / 2 : 0, y = g.head[0][1];
    let d = 'M' + g.head[0][0] + ' ' + y;
    g.head.forEach((c) => { d += 'C' + c.slice(2).join(' '); });
    d += r ? 'A' + r + ' ' + r + ' 0 0 1 ' + (g.x1 - r) + ' ' + g.root : 'V' + g.root;
    for(let i = 1; i >= 0; i--) d += 'H' + (g.gaps[i][0] + g.gaps[i][1]) + 'a' + g.gaps[i][1] + ' ' + g.gaps[i][1] + ' 0 0 0 ' + (-2 * g.gaps[i][1]) + ' 0';
    return d + 'H' + (g.x0 + r) + (r ? 'A' + r + ' ' + r + ' 0 0 1 ' + g.x0 + ' ' + y : '') + 'Z';
  }

  /* flow: los brazos sueltos, para un Sumi que flota (el del fondo del acceso). Cada brazo deja
     de ser una cápsula rígida y pasa a ser un trazo curvo, vez y media más largo, que ondula
     sin parar entre dos formas, cada uno a su ritmo. Sale recto del cuerpo (su raíz no se
     mueve ni se ve la unión) y lo que se mece es la punta. La curva se anima dentro del propio
     SVG (animate), que es lo que funciona igual en todos los navegadores; con calm, quieta. */
  const FLOW = [[5.4, -2.6, 4.2], [6.8, 3.2, -4.6], [4.6, -3.4, 3.8]];   /* segundos, y cuánto se va la punta a cada lado */
  function armsMarkup(g, body, flow, calm){
    return g.arms.map((a, i) => {
      const x = a[0] + a[1] / 2, len = (a[2] - g.top) * 1.55;
      let arm;
      if(flow){
        const f = FLOW[i];
        const curve = (k) => 'M' + x + ' ' + g.top + 'C' + x + ' ' + (g.top + len * 0.42).toFixed(2) + ' ' + (x + f[1] * k * 0.55).toFixed(2) + ' ' + (g.top + len * 0.72).toFixed(2) + ' ' + (x + f[1 + (k < 0 ? 1 : 0)] * Math.abs(k)).toFixed(2) + ' ' + (g.top + len).toFixed(2);
        const there = curve(1), back = curve(-1);
        const sway = calm ? '' : '<animate attributeName="d" dur="' + f[0] + 's" begin="-' + (i * 1.7) + 's" repeatCount="indefinite" values="' + there + ';' + back + ';' + there + '" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>';
        arm = '<path class="sumi-arm sumi-arm-' + i + '" d="' + there + '" fill="none" stroke="' + body + '" stroke-width="' + a[1] + '" stroke-linecap="round">' + sway + '</path>';
      } else {
        arm = '<rect class="sumi-arm sumi-arm-' + i + '" x="' + a[0] + '" y="' + g.top + '" width="' + a[1] + '" height="' + (a[2] - g.top) + '" rx="' + a[1] / 2 + '"/>';
      }
      const turn = (1 - i) * g.splay;
      return turn ? '<g transform="rotate(' + turn + ' ' + x + ' ' + g.root + ')">' + arm + '</g>' : arm;
    }).join('');
  }

  /* La cara. fill pinta ojos y boca; line, las cejas y los arcos. Devuelve también lo que va
     fuera de la cara y en la tinta del cuerpo (la zeta de dormido, los destellos de fiesta). */
  function face(mood, g, fill){
    const e = g.eyes, L = e.x[0], R = e.x[1];
    const line = 'fill="none" stroke="' + fill + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
    const eye = (x) => '<ellipse cx="' + x + '" cy="' + e.y + '" rx="' + e.rx + '" ry="' + e.ry + '" fill="' + fill + '"/>';
    const round = (x) => '<circle cx="' + x + '" cy="26.5" r="3.9" fill="' + fill + '"/>';
    const arc = (x) => '<path ' + line + ' d="M' + (x - 3.6) + ' 28.6Q' + x + ' 23.4 ' + (x + 3.6) + ' 28.6"/>';
    const dash = (x) => '<path ' + line + ' d="M' + (x - 3.4) + ' 28H' + (x + 3.4) + '"/>';
    const smile = '<path ' + line + ' d="M29.4 33.4Q32 36 34.6 33.4"/>';
    switch(mood){
      case 'contento': return {face: arc(L) + arc(R) + smile, extra: ''};
      case 'guino': return {face: eye(L) + arc(R) + smile, extra: ''};
      case 'aviso': return {face: round(L) + round(R) + '<ellipse cx="32" cy="34.6" rx="1.9" ry="2.4" fill="' + fill + '"/>', extra: ''};
      case 'concentrado': return {face: '<ellipse cx="' + L + '" cy="28" rx="3.1" ry="3.3" fill="' + fill + '"/><ellipse cx="' + R + '" cy="28" rx="3.1" ry="3.3" fill="' + fill + '"/><path ' + line + ' d="M20.6 21.6L28.6 24.2M43.4 21.6L35.4 24.2"/>', extra: ''};
      case 'dormido': return {face: dash(L) + dash(R), extra: 'M50 3.5h6l-6 7h6'};
      case 'cerrado': return {face: dash(L) + dash(R), extra: ''};
      case 'triste': return {face: eye(L) + eye(R) + '<path ' + line + ' d="M20.8 23.6L27.4 21.4M43.2 23.6L36.6 21.4"/><path ' + line + ' d="M29.4 35.6Q32 33.2 34.6 35.6"/>', extra: ''};
      case 'fiesta': return {face: arc(L) + arc(R) + '<path ' + line + ' d="M29 33Q32 37.4 35 33"/>', extra: 'M6 12v6M3 15h6M57 6v5M54.5 8.5h5M58 22v3'};
      default: return {face: eye(L) + eye(R), extra: ''};
    }
  }

  let serial = 0;

  /* SVG de Sumi. Opciones:
     - mood: uno de MOODS ('normal' si falta). mini: la versión reducida (por debajo de 32 px).
     - size: ancho y alto en px. cls: clases de más. title: nombre accesible (sin él, decorativo).
     - body: color del cuerpo ('currentColor' si falta).
     - eye: color de los ojos. Si falta, los ojos se RECORTAN y asoma lo que haya detrás, sea
       lo que sea (cristal, velo, una tarjeta).
     - season: 'spring' | 'summer' | 'autumn' | 'winter' añade el detalle de esa estación; false lo
       quita. Si falta, se usa la estación de la aplicación (<html data-season>). Nunca lo llevan
       el logotipo, los iconos ni la versión reducida, ni los gestos que ya ocupan esa esquina.
     - flow: los brazos sueltos, que ondulan sin parar (ver armsMarkup); calm los deja quietos.
     - bg: color de un cuadrado de fondo con las esquinas a 14; Sumi ocupa entonces el 62 % del
       ancho. Con bg hay que dar también eye (normalmente el mismo color). */
  function svg(o){
    o = o || {};
    const g = geometry(!!o.mini);
    const body = o.body || 'currentColor';
    const cut = !o.eye;
    const parts = face(o.mood, g, cut ? '#000' : o.eye);
    const shape = '<path d="' + bodyPath(g, !!o.flow) + '"/>' + armsMarkup(g, body, !!o.flow, !!o.calm);
    const extra = '<path class="sumi-extra" d="' + parts.extra + '" fill="none" stroke="' + body + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    /* Solo el Sumi suelto y completo: ni el logotipo (lleva eye) ni los iconos (bg) ni el reducido. */
    const auto = cut && !o.bg && !o.mini && !parts.extra;
    const season = o.season === false ? '' : (o.season || (auto && root.document ? root.document.documentElement.getAttribute('data-season') : ''));
    const deco = auto && season && SEASONS[season] ? '<g class="sumi-season">' + SEASONS[season].replace(/\{c\}/g, body) + '</g>' : '';
    let inner;
    if(cut){
      const id = 'sumi-m' + (++serial);
      /* La máscara que recorta los ojos tiene un tamaño, y lo que se sale de ella no se pinta.
         Con los brazos sueltos (flow) el del medio, al estirarse, llegaba más abajo de su borde y
         se veía cortado en recto: ahí la máscara es bastante más grande. */
      const box = o.flow ? 'x="-48" y="-40" width="160" height="190"' : 'x="-8" y="-8" width="80" height="80"';
      inner = '<mask id="' + id + '" maskUnits="userSpaceOnUse" ' + box + '><rect ' + box + ' fill="#fff"/><g class="sumi-face">' + parts.face + '</g></mask>' +
        '<g mask="url(#' + id + ')" fill="' + body + '">' + shape + '</g>' + extra + deco;
    } else {
      inner = '<g fill="' + body + '">' + shape + '</g><g class="sumi-face">' + parts.face + '</g>' + extra;
    }
    if(o.bg){
      /* 0,76 deja a Sumi en el 62 % del ancho; se centra por su caja, no por la del lienzo. */
      const cy = o.mini ? 31.5 : 32.5;
      inner = '<rect width="64" height="64" rx="14" fill="' + o.bg + '"/><g transform="translate(7.68 ' + (32 - cy * 0.76).toFixed(2) + ') scale(0.76)">' + inner + '</g>';
    }
    const size = o.size ? ' width="' + o.size + '" height="' + o.size + '"' : '';
    const a11y = o.title ? ' role="img" aria-label="' + String(o.title).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : ' aria-hidden="true" focusable="false"';
    const data = (o.mini ? ' data-mini="1"' : '') + (cut ? '' : ' data-eye="' + o.eye + '"');
    return '<svg class="sumi' + (o.cls ? ' ' + o.cls : '') + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"' + size + data + a11y + '>' + inner + '</svg>';
  }

  const api = {svg: svg, geometry: geometry, bodyPath: bodyPath, MOODS: MOODS};
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; return; }

  /* ---------- En el navegador: gestos y movimiento ----------
     Las animaciones están en assets/css/components/sumi.css. Todo ocurre una vez y termina
     (solo el reposo, .is-alive, se repite) y nada se mueve con «reducir movimiento». */
  const doc = root.document;
  const still = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const DURATION = {wink: 350, look: 1600, dip: 600, wave: 2300, nod: 900, pop: 450};

  /* Cambia el gesto de un Sumi ya pintado, sin volver a crear el SVG. */
  function setMood(el, mood){
    if(!el) return;
    const parts = face(mood, geometry(el.getAttribute('data-mini') === '1'), el.getAttribute('data-eye') || '#000');
    const f = el.querySelector('.sumi-face'), x = el.querySelector('.sumi-extra');
    if(f) f.innerHTML = parts.face;
    if(x) x.setAttribute('d', parts.extra);
    /* La zeta y los destellos ocupan la esquina del detalle de temporada. */
    const s = el.querySelector('.sumi-season');
    if(s) s.style.display = parts.extra ? 'none' : '';
  }

  /* Reproduce una vez un movimiento: wink, look, dip, wave, nod o pop. */
  function play(el, name){
    if(!el || still() || !DURATION[name]) return;
    const cls = 'is-' + name;
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
    el._sumiTimers = el._sumiTimers || {};
    clearTimeout(el._sumiTimers[name]);
    el._sumiTimers[name] = setTimeout(() => el.classList.remove(cls), DURATION[name] + 80);
  }

  /* Los ojos siguen al cursor; el cuerpo no se gira. Se suelta solo si el SVG sale de la página. */
  const followers = [];
  let pointer = null, frame = 0;
  function track(){
    frame = 0;
    for(let i = followers.length - 1; i >= 0; i--){
      const el = followers[i];
      if(!el.isConnected){ followers.splice(i, 1); continue; }
      const r = el.getBoundingClientRect(), f = el.querySelector('.sumi-face');
      if(!f || !r.width) continue;
      const lim = (v, m) => Math.max(-m, Math.min(m, v * m));
      f.style.translate = lim((pointer.x - r.left - r.width / 2) / (r.width * 2.5), 1.8).toFixed(2) + 'px ' + lim((pointer.y - r.top - r.height * 0.4) / (r.height * 2.5), 1.3).toFixed(2) + 'px';
    }
    if(!followers.length) doc.removeEventListener('pointermove', onPointer);
  }
  function onPointer(ev){
    pointer = {x: ev.clientX, y: ev.clientY};
    if(!frame) frame = root.requestAnimationFrame(track);
  }
  function follow(el){
    if(!el || still() || followers.indexOf(el) !== -1) return;
    if(!followers.length) doc.addEventListener('pointermove', onPointer, {passive: true});
    followers.push(el);
  }

  function whenSeen(host, run){
    if(!('IntersectionObserver' in root)){ run(); return; }
    const io = new root.IntersectionObserver((entries) => {
      if(entries.some((e) => e.isIntersecting)){ io.disconnect(); run(); }
    }, {threshold: 0.6});
    io.observe(host);
  }

  /* Pinta un Sumi dentro de un hueco marcado en el HTML:
       <span data-sumi="contento" data-sumi-size="64" data-sumi-class="is-alive"
             data-sumi-play="wave" data-sumi-follow data-sumi-shy="#authPass"></span>
     play: movimiento al entrar en pantalla. shy: cierra los ojos mientras ese campo tiene el foco. */
  function mount(host){
    if(host._sumi) return host._sumi;
    const d = host.dataset, mood = d.sumi || 'normal';
    /* data-sumi-eye: color de los ojos, pintados en vez de recortados (ver svg): para un Sumi
       grande que se mueve todo el rato, recortarlos obliga a rehacer la máscara en cada fotograma. */
    host.innerHTML = svg({mood: mood, size: +d.sumiSize || 64, mini: d.sumiMini === '1', cls: d.sumiClass || '', eye: d.sumiEye || undefined,
      flow: d.sumiFlow !== undefined, calm: still() || doc.documentElement.getAttribute('data-motion') === 'reduced'});
    const el = host._sumi = host.firstChild;
    if(d.sumiFollow !== undefined) follow(el);
    if(d.sumiPlay) whenSeen(host, () => play(el, d.sumiPlay));
    if(d.sumiShy){
      const shy = (ev) => !!(ev.target && ev.target.matches && ev.target.matches(d.sumiShy));
      doc.addEventListener('focusin', (ev) => { if(shy(ev)) setMood(el, 'cerrado'); });
      doc.addEventListener('focusout', (ev) => { if(shy(ev)) setMood(el, mood); });
    }
    return el;
  }

  /* El logotipo: el mismo dibujo que hay en el HTML, pero con piezas que se pueden mover.
     Parpadea al pasar por encima y baja el brazo central cuando se completa una tarea. */
  const marks = [];
  function mark(host){
    if(host._sumi) return;
    const old = host.querySelector('svg');
    host.innerHTML = svg({mini: true, eye: 'var(--accent-solid)', size: +(old && old.getAttribute('width')) || 19});
    const el = host._sumi = host.firstChild;
    marks.push(el);
    (host.closest('a, .brand-row, .win-brand') || host).addEventListener('mouseenter', () => play(el, 'wink'));
  }

  function boot(){
    doc.querySelectorAll('.brand-mark').forEach(mark);
    doc.querySelectorAll('[data-sumi]').forEach(mount);
    doc.querySelectorAll('svg.sumi[data-sumi-follow]').forEach(follow);
    doc.addEventListener('sumi:done', () => marks.forEach((el) => { if(el.isConnected) play(el, 'dip'); }));
  }

  /* Texto de un botón que espera: con busy, los tres carriles en marcha delante del texto. */
  function busyLabel(el, busy, text){
    if(!el) return;
    el.textContent = text;
    if(busy) el.insertAdjacentHTML('afterbegin', '<span class="rails is-run is-lead" aria-hidden="true"><i></i><i></i><i></i></span>');
  }

  api.busyLabel = busyLabel;
  api.setMood = setMood; api.play = play; api.follow = follow; api.mount = mount;
  root.KanlaneSumi = api;
  if(root.Workhub && root.Workhub.views) root.Workhub.views.sumi = api;
  if(doc){
    if(doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
