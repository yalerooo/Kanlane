#!/usr/bin/env node
/* Genera los iconos de la aplicación instalable (PWA) con Sumi, la mascota de Kanlane,
   sin dependencias: lee la forma de src/views/sumi.js (la única definición), la dibuja
   punto a punto y escribe los PNG. Uso: node scripts/make-icons.js

   - icon-192.png / icon-512.png: Sumi sobre grafito con esquinas redondeadas.
   - favicon-32.png: la versión reducida, para la pestaña en navegadores sin SVG.
   - apple-touch-icon.png: a sangre (iOS ya redondea las esquinas).
   - icon-maskable-512.png: a sangre, con el dibujo dentro de la zona segura
     (Android recorta el icono con la forma que elija el móvil).

   El favicon.svg y los SVG de la marca salen de scripts/make-brand.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sumi = require('../src/views/sumi.js');

const OUT = path.join(__dirname, '..', 'assets', 'img');
const INK = [0x18, 0x18, 0x1B];
const WHITE = [0xFF, 0xFF, 0xFF];
const FIT = 0.76;   /* como en sumi.svg({bg}): Sumi ocupa el 62 % del ancho del cuadrado */
const SS = 4;       /* muestras por eje en cada píxel (suavizado de bordes) */

/* La forma, lista para preguntar «¿este punto es cuerpo, ojo o fondo?». */
function shape(mini){
  const g = sumi.geometry(mini);
  const poly = [];
  g.head.forEach((c) => {
    for(let i = 0; i <= 32; i++){
      const t = i / 32, m = 1 - t;
      poly.push([
        m * m * m * c[0] + 3 * m * m * t * c[2] + 3 * m * t * t * c[4] + t * t * t * c[6],
        m * m * m * c[1] + 3 * m * m * t * c[3] + 3 * m * t * t * c[5] + t * t * t * c[7]
      ]);
    }
  });
  poly.push([g.x1, g.root], [g.x0, g.root]);
  return {g: g, poly: poly, dy: 32 - (mini ? 31.5 : 32.5) * FIT};
}

function inPolygon(poly, x, y){
  let inside = false;
  for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const a = poly[i], b = poly[j];
    if((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/* 0: fondo, 1: cuerpo, 2: ojo. */
function part(S, x, y){
  const g = S.g, e = g.eyes;
  for(let i = 0; i < 2; i++) if(Math.pow((x - e.x[i]) / e.rx, 2) + Math.pow((y - e.y) / e.ry, 2) <= 1) return 2;
  for(let i = 0; i < 3; i++){
    const a = g.arms[i], r = a[1] / 2, cx = a[0] + r;
    const turn = (1 - i) * g.splay * Math.PI / 180, dx = x - cx, dy = y - g.root;
    /* deshace el giro del brazo alrededor de su raíz */
    const lx = cx + dx * Math.cos(turn) + dy * Math.sin(turn), ly = g.root - dx * Math.sin(turn) + dy * Math.cos(turn);
    const sy = Math.max(g.top + r, Math.min(a[2] - r, ly));
    if(Math.hypot(lx - cx, ly - sy) <= r) return 1;
  }
  if(inPolygon(S.poly, x, y)){
    for(let i = 0; i < 2; i++) if(Math.hypot(x - g.gaps[i][0], y - g.root) < g.gaps[i][1]) return 0;
    return 1;
  }
  return 0;
}

/* Color (o null si queda fuera del icono) en un punto del lienzo de 64x64. */
function sample(S, u, v, rounded, scale){
  if(rounded){
    const r = 14;
    const cx = Math.min(Math.max(u, r), 64 - r), cy = Math.min(Math.max(v, r), 64 - r);
    if(Math.hypot(u - cx, v - cy) > r) return null;
  }
  /* maskable: el dibujo se reduce alrededor del centro */
  const x = 32 + (u - 32) / scale, y = 32 + (v - 32) / scale;
  return part(S, (x - 7.68) / FIT, (y - S.dy) / FIT) === 1 ? WHITE : INK;
}

function render(S, size, rounded, scale){
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for(let py = 0; py < size; py++){
    raw[py * (size * 4 + 1)] = 0;
    for(let px = 0; px < size; px++){
      let r = 0, g = 0, b = 0, a = 0;
      for(let sy = 0; sy < SS; sy++) for(let sx = 0; sx < SS; sx++){
        const c = sample(S, (px + (sx + 0.5) / SS) * 64 / size, (py + (sy + 0.5) / SS) * 64 / size, rounded, scale);
        if(c){ r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if(a){ raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a); }
      raw[o + 3] = Math.round(255 * a / (SS * SS));
    }
  }
  return raw;
}

const CRC = (() => {
  const t = [];
  for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (buf) => { let c = 0xFFFFFFFF; for(let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
})();

function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(S, size, rounded, scale){
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6;   /* 8 bits, RGBA */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(render(S, size, rounded, scale), {level: 9})),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const FULL = shape(false), MINI = shape(true);
[
  ['icon-192.png', FULL, 192, true, 1],
  ['icon-512.png', FULL, 512, true, 1],
  ['icon-maskable-512.png', FULL, 512, false, 0.66],
  ['favicon-32.png', MINI, 32, true, 1],
  ['apple-touch-icon.png', FULL, 180, false, 0.82]
].forEach(([name, S, size, rounded, scale]) => {
  fs.writeFileSync(path.join(OUT, name), png(S, size, rounded, scale));
  console.log(name);
});
