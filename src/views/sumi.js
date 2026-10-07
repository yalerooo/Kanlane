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

  function bodyPath(g){
    let d = 'M' + g.head[0][0] + ' ' + g.head[0][1];
    g.head.forEach((c) => { d += 'C' + c.slice(2).join(' '); });
    d += 'V' + g.root;
    for(let i = 1; i >= 0; i--) d += 'H' + (g.gaps[i][0] + g.gaps[i][1]) + 'a' + g.gaps[i][1] + ' ' + g.gaps[i][1] + ' 0 0 0 ' + (-2 * g.gaps[i][1]) + ' 0';
    return d + 'H' + g.x0 + 'Z';
  }

  function armsMarkup(g){
    return g.arms.map((a, i) => {
      const rect = '<rect class="sumi-arm sumi-arm-' + i + '" x="' + a[0] + '" y="' + g.top + '" width="' + a[1] + '" height="' + (a[2] - g.top) + '" rx="' + a[1] / 2 + '"/>';
      const turn = (1 - i) * g.splay;
      return turn ? '<g transform="rotate(' + turn + ' ' + (a[0] + a[1] / 2) + ' ' + g.root + ')">' + rect + '</g>' : rect;
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
     - bg: color de un cuadrado de fondo con las esquinas a 14; Sumi ocupa entonces el 62 % del
       ancho. Con bg hay que dar también eye (normalmente el mismo color). */
  function svg(o){
    o = o || {};
    const g = geometry(!!o.mini);
    const body = o.body || 'currentColor';
    const cut = !o.eye;
    const parts = face(o.mood, g, cut ? '#000' : o.eye);
    const shape = '<path d="' + bodyPath(g) + '"/>' + armsMarkup(g);
    const extra = parts.extra ? '<path d="' + parts.extra + '" fill="none" stroke="' + body + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : '';
    let inner;
    if(cut){
      const id = 'sumi-m' + (++serial);
      inner = '<mask id="' + id + '" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><rect x="-8" y="-8" width="80" height="80" fill="#fff"/><g class="sumi-face">' + parts.face + '</g></mask>' +
        '<g mask="url(#' + id + ')" fill="' + body + '">' + shape + '</g>' + extra;
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
    return '<svg class="sumi' + (o.cls ? ' ' + o.cls : '') + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"' + size + a11y + '>' + inner + '</svg>';
  }

  const api = {svg: svg, geometry: geometry, bodyPath: bodyPath, MOODS: MOODS};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Workhub.views.sumi = api;
})(typeof window !== 'undefined' ? window : globalThis);
