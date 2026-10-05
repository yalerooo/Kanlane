/* Genera la imagen de las flores de primavera de la pantalla de acceso (assets/img/flowers.webp)
   a partir de un modelo 3D (OBJ con su MTL y sus texturas) que NO está en el repositorio.

   La escena (src/views/auth-scene.js, FLOWERS_VERT) no pinta las flores en 3D: reparte por la
   hierba cientos de rectángulos que miran a la cámara, cada uno con una de las flores de esta
   imagen. El modelo trae varias (un objeto del OBJ por flor): salen una al lado de otra, cada
   una en su casilla de CELL×CELL, con el pie del tallo abajo en el centro y fondo transparente.
   Luz neutra: la escena le da después el color de la hora.

   Uso:  node scripts/make-flowers.js
         KANLANE_FLOWERS=C:\ruta\con\el\modelo node scripts/make-flowers.js
   Necesita Playwright (tests/e2e) y un Chrome o Edge con tarjeta gráfica. El modelo se busca
   en KANLANE_FLOWERS o, si no, en una carpeta «flowers» junto al repositorio o por encima. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const {chromium} = require(path.join(root, 'tests/e2e/node_modules/playwright'));

const OBJ = 'Coreopsis+Flower.obj', MTL = 'Coreopsis+Flower.mtl';
/* Lado de cada casilla, en píxeles. OJO: la escena cuenta las casillas por el ancho de la imagen. */
const CELL = 256;
/* Giro de cada flor alrededor de su tallo, en grados, para enseñar su lado bueno. */
const TURN = [0, 0, 0];

function modelDir(){
  if(process.env.KANLANE_FLOWERS) return path.resolve(process.env.KANLANE_FLOWERS);
  for(let dir = root, i = 0; i < 8; i++, dir = path.dirname(dir)){
    if(fs.existsSync(path.join(dir, 'flowers', OBJ))) return path.join(dir, 'flowers');
  }
  return path.join(path.dirname(root), 'flowers');
}
const MODEL = modelDir();

/* Los materiales: color y, si la hay, textura (el MTL trae la ruta del equipo del autor; aquí
   solo cuenta el nombre del archivo, que se busca en la carpeta texture). */
function readMtl(file){
  const out = {};
  let cur = null;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const p = line.trim().split(/\s+/);
    if(p[0] === 'newmtl') cur = out[p.slice(1).join(' ')] = {kd:[0.8, 0.8, 0.8], tex:null};
    else if(cur && p[0] === 'Kd') cur.kd = [+p[1], +p[2], +p[3]];
    else if(cur && p[0] === 'map_Kd') cur.tex = line.trim().slice(7).split(/[\\/]+/).pop();
  });
  return out;
}

/* Por objeto y material, los triángulos como [x,y,z, nx,ny,nz, u,v] seguidos. */
function readObj(file){
  const P = [], N = [], T = [], objects = [];
  let obj = null, cur = null;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim(), p = line.split(/\s+/);
    if(p[0] === 'v') P.push(+p[1], +p[2], +p[3]);
    else if(p[0] === 'vn') N.push(+p[1], +p[2], +p[3]);
    else if(p[0] === 'vt') T.push(+p[1], +p[2]);
    else if(p[0] === 'o'){ obj = {name:p.slice(1).join(' '), groups:{}}; objects.push(obj); cur = null; }
    else if(p[0] === 'usemtl'){ const m = p.slice(1).join(' '); cur = obj.groups[m] || (obj.groups[m] = []); }
    else if(p[0] === 'f' && cur){
      const idx = p.slice(1).map((s) => s.split('/').map((n) => parseInt(n, 10)));
      const corner = (k) => {
        const pi = (idx[k][0] - 1) * 3, ti = idx[k][1] ? (idx[k][1] - 1) * 2 : -1, ni = idx[k][2] ? (idx[k][2] - 1) * 3 : -1;
        return [P[pi], P[pi + 1], P[pi + 2], ni < 0 ? 0 : N[ni], ni < 0 ? 1 : N[ni + 1], ni < 0 ? 0 : N[ni + 2], ti < 0 ? 0 : T[ti], ti < 0 ? 0 : T[ti + 1]];
      };
      for(let k = 1; k + 1 < idx.length; k++) [corner(0), corner(k), corner(k + 1)].forEach((v) => v.forEach((n) => cur.push(n)));
    }
  });
  return objects;
}

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><script>
const VS = \`#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec2 aUV;
uniform vec4 uTurn; uniform vec4 uFit;
out vec3 vN; out vec2 vUV;
void main(){
  vec3 p = aPos - vec3(uFit.x, uFit.y, uFit.z);
  p.xz = vec2(p.x * uTurn.x + p.z * uTurn.y, -p.x * uTurn.y + p.z * uTurn.x);
  vec3 n = aNor; n.xz = vec2(n.x * uTurn.x + n.z * uTurn.y, -n.x * uTurn.y + n.z * uTurn.x);
  vN = n; vUV = aUV;
  gl_Position = vec4(p.x * uFit.w, p.y * uFit.w * 2. - 1., -p.z * uFit.w * .5, 1.);
}\`;
const FS = \`#version 300 es
precision highp float;
in vec3 vN; in vec2 vUV;
uniform sampler2D uTex; uniform float uHasTex; uniform vec3 uKd;
out vec4 o;
void main(){
  vec4 c = uHasTex > .5 ? texture(uTex, vUV) : vec4(1.);
  if(c.a < .4) discard;
  vec3 n = normalize(vN);
  if(!gl_FrontFacing) n = -n;
  /* Luz neutra y blanda: pétalos y hojas son láminas, la reciben por las dos caras. */
  float d = dot(n, normalize(vec3(-.35, .8, .5)));
  o = vec4(pow(c.rgb * uKd, vec3(1. / 2.2)) * (.66 + .34 * abs(d)) * (.92 + .10 * n.y), 1.);
}\`;
function loadImg(url){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('no carga ' + url)); i.src = url; }); }
async function render(cfg){
  const BIG = cfg.cell * 4;
  const cv = document.createElement('canvas'); cv.width = cv.height = BIG;
  const gl = cv.getContext('webgl2', {antialias:true, alpha:true, premultipliedAlpha:false, preserveDrawingBuffer:true});
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if(!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
  const U = (n) => gl.getUniformLocation(pr, n);
  const sheet = document.createElement('canvas'); sheet.width = cfg.cell * cfg.flowers.length; sheet.height = cfg.cell;
  const sx = sheet.getContext('2d'); sx.imageSmoothingQuality = 'high';
  const half = document.createElement('canvas'); half.width = half.height = BIG / 2;
  const hx = half.getContext('2d'); hx.imageSmoothingQuality = 'high';
  gl.viewport(0, 0, BIG, BIG); gl.enable(gl.DEPTH_TEST); gl.uniform1i(U('uTex'), 0);
  for(let f = 0; f < cfg.flowers.length; f++){
    const fl = cfg.flowers[f];
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform4f(U('uTurn'), Math.cos(fl.turn), Math.sin(fl.turn), 0, 0);
    gl.uniform4f(U('uFit'), fl.base[0], fl.base[1], fl.base[2], fl.scale);
    for(const g of fl.groups){
      const data = new Float32Array(await (await fetch(g.bin)).arrayBuffer());
      gl.bindVertexArray(gl.createVertexArray());
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      if(g.tex){
        const img = await loadImg(g.tex), t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
      }
      gl.uniform1f(U('uHasTex'), g.tex ? 1 : 0); gl.uniform3f(U('uKd'), g.kd[0], g.kd[1], g.kd[2]);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
    }
    gl.finish();
    hx.clearRect(0, 0, BIG / 2, BIG / 2); hx.drawImage(cv, 0, 0, BIG / 2, BIG / 2);
    sx.drawImage(half, f * cfg.cell, 0, cfg.cell, cfg.cell);
  }
  return sheet.toDataURL('image/webp', cfg.quality);
}
</script>`;

(async () => {
  const objFile = path.join(MODEL, OBJ);
  if(!fs.existsSync(objFile)){ console.error('✖ no encuentro ' + objFile); process.exit(1); }
  const mats = readMtl(path.join(MODEL, MTL)), objects = readObj(objFile);
  const files = new Map();
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.split('?')[0]);
    if(key === '/'){ res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(PAGE); return; }
    const hit = files.get(key);
    if(!hit){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type':/\.png$/.test(key) ? 'image/png' : 'application/octet-stream'});
    res.end(Buffer.isBuffer(hit) ? hit : fs.readFileSync(hit));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
  const browser = await chromium.launch({executablePath:chrome, args:['--ignore-gpu-blocklist', '--use-angle=default', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('página: ' + e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/');

  const cfg = {cell:CELL, quality:0.9, flowers:[]};
  objects.forEach((obj, f) => {
    /* El pie del tallo (lo más bajo) y lo que mide: la flor entera cabe en su casilla, con el
       pie abajo en el centro. */
    let minY = Infinity, maxY = -Infinity;
    const each = (fn) => Object.values(obj.groups).forEach((g) => { for(let i = 0; i < g.length; i += 8) fn(g[i], g[i + 1], g[i + 2]); });
    each((x, y) => { minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    const h = maxY - minY;
    let bx = 0, bz = 0, bn = 0, wide = 0;
    each((x, y, z) => { if(y < minY + h * 0.04){ bx += x; bz += z; bn++; } });
    bx /= bn; bz /= bn;
    each((x, y, z) => { wide = Math.max(wide, Math.hypot(x - bx, z - bz)); });
    const flower = {turn:(TURN[f] || 0) * Math.PI / 180, base:[bx, minY, bz], scale:0.96 / Math.max(h, wide * 2), groups:[]};
    Object.keys(obj.groups).forEach((m, i) => {
      const mat = mats[m] || {kd:[0.8, 0.8, 0.8], tex:null};
      const bin = '/' + f + '/' + i + '.bin';
      files.set(bin, Buffer.from(new Float32Array(obj.groups[m]).buffer));
      let tex = null;
      if(mat.tex){ tex = '/tex/' + mat.tex; files.set(tex, path.join(MODEL, 'texture', mat.tex)); }
      flower.groups.push({bin, kd:mat.kd, tex});
    });
    cfg.flowers.push(flower);
    console.log('     ' + obj.name + ': alto ' + h.toFixed(2) + ', ancho ±' + wide.toFixed(2) + ', materiales ' + Object.keys(obj.groups).join(', '));
  });
  const url = await page.evaluate((cfg) => render(cfg), cfg);
  const out = path.join(root, 'assets/img/flowers.webp');
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('OK   ' + cfg.flowers.length + ' flores → assets/img/flowers.webp (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
