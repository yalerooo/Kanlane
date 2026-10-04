#!/usr/bin/env node
/* Genera los iconos de la aplicación instalable (PWA) a partir del logo
   «Barras» (assets/img/favicon.svg), sin dependencias: dibuja las formas y
   escribe los PNG. Uso: node scripts/make-icons.js

   - icon-192.png / icon-512.png: el logo con esquinas redondeadas (como favicon.svg).
   - favicon-32.png: lo mismo, para la pestaña en navegadores sin SVG.
   - apple-touch-icon.png: a sangre (iOS ya redondea las esquinas).
   - icon-maskable-512.png: a sangre, con el dibujo dentro de la zona segura
     (Android recorta el icono con la forma que elija el móvil). */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets', 'img');
const INK = [0x18, 0x18, 0x1B];
const BARS = [
  {x: 16, color: [0xFF, 0xFF, 0xFF]},
  {x: 29, color: [0xFF, 0xFF, 0xFF]},
  {x: 42, color: [0xFF, 0xFF, 0xFF]}
];
const HALF = 6.5 / 2;
const SS = 4;   /* muestras por eje en cada píxel (suavizado de bordes) */

function distToSegment(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* Color (o null si queda fuera del icono) en un punto del lienzo de 64x64. */
function sample(u, v, rounded, scale){
  if(rounded){
    const r = 14;
    const cx = Math.min(Math.max(u, r), 64 - r), cy = Math.min(Math.max(v, r), 64 - r);
    if(Math.hypot(u - cx, v - cy) > r) return null;
  }
  /* maskable: el dibujo se reduce alrededor del centro */
  const x = 32 + (u - 32) / scale, y = 32 + (v - 32) / scale;
  for(let i = BARS.length - 1; i >= 0; i--){
    const b = BARS[i];
    if(distToSegment(x, y, b.x, 45, b.x + 10, 19) <= HALF) return b.color;
  }
  return INK;
}

function render(size, rounded, scale){
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for(let py = 0; py < size; py++){
    raw[py * (size * 4 + 1)] = 0;
    for(let px = 0; px < size; px++){
      let r = 0, g = 0, b = 0, a = 0;
      for(let sy = 0; sy < SS; sy++) for(let sx = 0; sx < SS; sx++){
        const c = sample((px + (sx + 0.5) / SS) * 64 / size, (py + (sy + 0.5) / SS) * 64 / size, rounded, scale);
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

function png(size, rounded, scale){
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4);
  head[8] = 8; head[9] = 6;   /* 8 bits, RGBA */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(render(size, rounded, scale), {level: 9})),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

[
  ['icon-192.png', 192, true, 1],
  ['icon-512.png', 512, true, 1],
  ['icon-maskable-512.png', 512, false, 0.66],
  ['favicon-32.png', 32, true, 1],
  ['apple-touch-icon.png', 180, false, 0.82]
].forEach(([name, size, rounded, scale]) => {
  fs.writeFileSync(path.join(OUT, name), png(size, rounded, scale));
  console.log(name);
});
