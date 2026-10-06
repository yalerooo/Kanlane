/* Códigos QR sin dependencias (ISO/IEC 18004): modo byte, corrección de errores M y versiones
   1 a 10, que dan hasta 213 bytes. Es lo que hace falta para el enlace otpauth:// de la
   verificación en dos pasos; no es un generador de uso general.
     matrix(texto) → {size, dark(x, y)} o null si no cabe
     svg(texto)    → '<svg …>' en negro sobre blanco con su margen, o '' si no cabe */
(function(){
  /* Por versión, con corrección M: [códigos de corrección por bloque, bloques, datos por bloque,
     bloques largos, datos por bloque largo]. */
  const BLOCKS = [null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  /* Centros de los patrones de alineación. */
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const MAX_VERSION = 10;

  const dataCodewords = (v) => BLOCKS[v][1] * BLOCKS[v][2] + BLOCKS[v][3] * BLOCKS[v][4];
  /* Bits del contador de longitud en modo byte. */
  const countBits = (v) => (v < 10 ? 8 : 16);

  /* ---------- Reed-Solomon sobre GF(256), polinomio 0x11D ---------- */

  function gfMul(x, y){
    let z = 0;
    for(let i = 7; i >= 0; i--){
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  /* Los n códigos de corrección de un bloque de datos. */
  function ecc(data, n){
    const divisor = new Array(n).fill(0);
    divisor[n - 1] = 1;
    let root = 1;
    for(let i = 0; i < n; i++){
      for(let j = 0; j < n; j++){
        divisor[j] = gfMul(divisor[j], root);
        if(j + 1 < n) divisor[j] ^= divisor[j + 1];
      }
      root = gfMul(root, 2);
    }
    const rem = new Array(n).fill(0);
    data.forEach((b) => {
      const factor = b ^ rem.shift();
      rem.push(0);
      divisor.forEach((coef, i) => { rem[i] ^= gfMul(coef, factor); });
    });
    return rem;
  }

  /* ---------- Datos ---------- */

  /* Códigos de datos de la versión v: modo, longitud, bytes, final y relleno. */
  function encodeData(bytes, v){
    const bits = [];
    const push = (value, len) => { for(let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(4, 4);
    push(bytes.length, countBits(v));
    bytes.forEach((b) => push(b, 8));
    const capacity = dataCodewords(v) * 8;
    push(0, Math.min(4, capacity - bits.length));
    while(bits.length % 8) bits.push(0);
    for(let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const out = [];
    for(let i = 0; i < bits.length; i += 8){
      let b = 0;
      for(let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    return out;
  }

  /* Parte los datos en bloques, añade la corrección de cada uno y los intercala. */
  function interleave(data, v){
    const [ecLen, n1, len1, n2, len2] = BLOCKS[v];
    const blocks = [];
    let at = 0;
    for(let i = 0; i < n1 + n2; i++){
      const len = i < n1 ? len1 : len2;
      const d = data.slice(at, at + len);
      at += len;
      blocks.push({d:d, e:ecc(d, ecLen)});
    }
    const out = [];
    for(let i = 0; i < Math.max(len1, len2); i++){
      blocks.forEach((b) => { if(i < b.d.length) out.push(b.d[i]); });
    }
    for(let i = 0; i < ecLen; i++){
      blocks.forEach((b) => out.push(b.e[i]));
    }
    return out;
  }

  /* ---------- Símbolo ---------- */

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
  ];

  /* Los 15 bits de formato (corrección M y máscara) y los 18 de versión, con su BCH. */
  function formatBits(mask){
    let rem = mask;
    for(let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((mask << 10) | rem) ^ 0x5412;
  }
  function versionBits(v){
    let rem = v;
    for(let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return (v << 12) | rem;
  }

  function build(codewords, v, mask){
    const size = 17 + 4 * v;
    const mod = [], fn = [];
    for(let y = 0; y < size; y++){ mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

    /* Sincronización. */
    for(let i = 0; i < size; i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    /* Localizadores (con su separador) en tres esquinas. */
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
      for(let dy = -4; dy <= 4; dy++){
        for(let dx = -4; dx <= 4; dx++){
          const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
          if(x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
        }
      }
    });
    /* Alineación, salvo donde caerían sobre un localizador. */
    const centers = ALIGN[v], last = centers.length - 1;
    centers.forEach((cy, i) => centers.forEach((cx, j) => {
      if((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for(let dy = -2; dy <= 2; dy++){
        for(let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));
    /* Formato (dos copias) y el módulo siempre oscuro. */
    const fmt = formatBits(mask), fbit = (i) => ((fmt >>> i) & 1) === 1;
    for(let i = 0; i <= 5; i++) set(8, i, fbit(i));
    set(8, 7, fbit(6));
    set(8, 8, fbit(7));
    set(7, 8, fbit(8));
    for(let i = 9; i < 15; i++) set(14 - i, 8, fbit(i));
    for(let i = 0; i < 8; i++) set(size - 1 - i, 8, fbit(i));
    for(let i = 8; i < 15; i++) set(8, size - 15 + i, fbit(i));
    set(8, size - 8, true);
    /* Versión (dos copias), a partir de la 7. */
    if(v >= 7){
      const ver = versionBits(v);
      for(let i = 0; i < 18; i++){
        const dark = ((ver >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
      }
    }

    /* Datos en zigzag, de dos en dos columnas desde la derecha, ya con la máscara. */
    let i = 0;
    for(let right = size - 1; right >= 1; right -= 2){
      if(right === 6) right = 5;
      for(let vert = 0; vert < size; vert++){
        for(let j = 0; j < 2; j++){
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
          if(fn[y][x]) continue;
          const bit = i < codewords.length * 8 && ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
          mod[y][x] = bit !== MASKS[mask](x, y);
        }
      }
    }
    return mod;
  }

  /* Cuánto cuesta leer un símbolo (las cuatro reglas de la norma): se elige la máscara que menos. */
  function penalty(mod){
    const size = mod.length;
    let total = 0, dark = 0;
    const lines = [];
    for(let y = 0; y < size; y++){
      let row = '', col = '';
      for(let x = 0; x < size; x++){
        row += mod[y][x] ? '1' : '0';
        col += mod[x][y] ? '1' : '0';
        if(mod[y][x]) dark++;
        if(x + 1 < size && y + 1 < size && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) total += 3;
      }
      lines.push(row, col);
    }
    lines.forEach((line) => {
      (line.match(/0{5,}|1{5,}/g) || []).forEach((run) => { total += run.length - 2; });
      for(let at = 0; at + 11 <= line.length; at++){
        const part = line.substr(at, 11);
        if(part === '10111010000' || part === '00001011101') total += 40;
      }
    });
    total += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return total;
  }

  function matrix(text){
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let v = 1;
    while(v <= MAX_VERSION && bytes.length * 8 + 4 + countBits(v) > dataCodewords(v) * 8) v++;
    if(v > MAX_VERSION) return null;
    const codewords = interleave(encodeData(bytes, v), v);
    let best = null, bestScore = Infinity;
    for(let mask = 0; mask < 8; mask++){
      const mod = build(codewords, v, mask);
      const score = penalty(mod);
      if(score < bestScore){ best = mod; bestScore = score; }
    }
    return {size:best.length, dark:(x, y) => best[y][x]};
  }

  /* Siempre negro sobre blanco, con los cuatro módulos de margen que piden los lectores. */
  function svg(text){
    const m = matrix(text);
    if(!m) return '';
    const QUIET = 4, full = m.size + QUIET * 2;
    let path = '';
    for(let y = 0; y < m.size; y++){
      for(let x = 0; x < m.size; x++){
        if(m.dark(x, y)) path += 'M' + (x + QUIET) + ' ' + (y + QUIET) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + full + ' ' + full + '" shape-rendering="crispEdges" role="img">' +
      '<rect width="' + full + '" height="' + full + '" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  Workhub.utils.qr = {matrix, svg, ecc, formatBits, versionBits};
})();
