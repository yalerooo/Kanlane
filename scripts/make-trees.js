/* Genera las imágenes de los árboles de la pantalla de acceso (assets/img/tree-*.webp), una por
   estación, a partir de modelos 3D (OBJ con sus texturas) que NO están en el repositorio.

   La escena (src/views/auth-scene.js) no pinta el árbol en 3D: pone sobre un plano una imagen
   hecha de antemano, de 2048×1024, con dos capas del mismo encuadre: a la izquierda la madera
   (tronco y ramas), que no se mueve, y a la derecha las hojas que se ven, que el viento
   desplaza. El encuadre es un cuadrado de 9,2 unidades con el suelo a 0,9 del borde de abajo
   y el pie del tronco en el centro. El cerezo de primavera (assets/img/sakura.webp) se hizo
   aparte con el mismo formato.

   Uso:  node scripts/make-trees.js [verano] [otono] [invierno]     (sin nada, los tres)
         KANLANE_TREES=C:\ruta\con\los\modelos node scripts/make-trees.js
   Necesita Playwright (tests/e2e) y un Chrome o Edge con tarjeta gráfica. Los modelos se
   buscan en KANLANE_TREES o, si no, en la carpeta que contiene al repositorio. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const {chromium} = require(path.join(root, 'tests/e2e/node_modules/playwright'));

/* La carpeta de los modelos: la que contiene al repositorio (o a su copia de trabajo). */
function modelsDir(){
  if(process.env.KANLANE_TREES) return path.resolve(process.env.KANLANE_TREES);
  for(let dir = root, i = 0; i < 8; i++, dir = path.dirname(dir)){
    if(fs.existsSync(path.join(dir, 'summer tree')) || fs.existsSync(path.join(dir, 'Autumn tree'))) return dir;
  }
  return path.dirname(root);
}
const MODELS = modelsDir();

/* Cada árbol: su OBJ y, por material, la capa (wood: madera; leaf: hojas) y sus texturas.
   turn: giro alrededor del tronco, en grados, para elegir el lado bueno. cut: transparencia
   a partir de la cual un punto de la textura no se pinta. tint: color [r, g, b, cuánto] que
   sustituye al de la textura (cuando esta solo trae la silueta). gain: más o menos luz.
   sink: cuánto se hunde el pie en el suelo, en unidades del encuadre; la escena recorta el
   árbol a ras de suelo, y con el pie justo en la línea parecía flotar sobre la loma.
   strip: quita lo que el modelo trae a ras de suelo alrededor del tronco (un montón de nieve):
   las caras por debajo de `below` y a más de `beyond` del eje, las dos en partes del alto.
   foot: entre qué alturas (partes del alto) se mide dónde está el eje del tronco. */
const TREES = {
  verano: {
    out: 'tree-summer.webp', obj: 'summer tree/TreeOld_2.obj', turn: 270, sink: 0.85,
    materials: {
      Trunk: {layer: 'wood', tex: 'summer tree/Textures/Textures/Trunk_BaseColorUntitled.png'},
      Branches: {layer: 'wood', tex: 'summer tree/Textures/Textures/BranchesDiffuse.jpg'},
      Branches2D: {layer: 'leaf', tex: 'summer tree/Textures/Textures/Branches_1_Diffuse.png', cut: 0.4, tint: [0.30, 0.25, 0.17, 1]},
      Leaves: {layer: 'leaf', tex: 'summer tree/Textures/Textures/LeafOld_2_Diffuse.png', cut: 0.4, gain: 1.45}
    }
  },
  otono: {
    out: 'tree-autumn.webp', obj: 'Autumn tree/TR_01_autumn.obj', turn: 180, sink: 0.7,
    materials: {
      Tr_01_Stem_autumn_001_mat: {layer: 'wood', tex: 'Autumn tree/texture/Tr_01_Stem_autumn_001_mat_Base_color.png'},
      Tr_01_Leaves_autumn_001_mat: {layer: 'leaf', tex: 'Autumn tree/texture/Tr_01_Leaves_autumn_001_Base_color.png', alpha: 'Autumn tree/texture/Tr_01_Leaves_autumn_001_Opacity.png', cut: 0.5}
    }
  },
  invierno: {
    out: 'tree-winter.webp', obj: 'winter tree/winter-tree8_HIGH_RES.obj', turn: 0, sink: 1.0,
    strip: {below: 0.09, beyond: 0.10}, foot: [0.14, 0.20],
    /* Un solo material, con la nieve ya puesta en las ramas: todo es madera, nada se mueve. */
    materials: {'winter-tree8': {layer: 'wood', tex: 'winter tree/textures/winter-tree8.png'}}
  }
};

/* ---------- OBJ ---------- */

/* Devuelve, por material, los triángulos como [x,y,z, nx,ny,nz, u,v] seguidos. */
function readObj(file){
  const P = [], N = [], T = [];
  const groups = {};
  let cur = null;
  const text = fs.readFileSync(file, 'utf8');
  let start = 0;
  while(start < text.length){
    let end = text.indexOf('\n', start);
    if(end < 0) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    const c = line.charCodeAt(0);
    if(c === 118){   /* v, vn, vt */
      const p = line.split(/\s+/);
      if(p[0] === 'v') P.push(+p[1], +p[2], +p[3]);
      else if(p[0] === 'vn') N.push(+p[1], +p[2], +p[3]);
      else if(p[0] === 'vt') T.push(+p[1], +p[2]);
    } else if(c === 117 && line.startsWith('usemtl')){
      const name = line.slice(7).trim();
      cur = groups[name] || (groups[name] = []);
    } else if(c === 102 && line[1] === ' '){
      if(!cur) cur = groups[''] || (groups[''] = []);
      const idx = line.slice(2).split(/\s+/).map((s) => s.split('/').map((n) => parseInt(n, 10)));
      const at = (n, len) => (n < 0 ? len + n : n - 1);
      const corner = (k) => {
        const pi = at(idx[k][0], P.length / 3) * 3;
        const ti = idx[k][1] ? at(idx[k][1], T.length / 2) * 2 : -1;
        const ni = idx[k][2] ? at(idx[k][2], N.length / 3) * 3 : -1;
        return [P[pi], P[pi + 1], P[pi + 2], ni < 0 ? 0 : N[ni], ni < 0 ? 0 : N[ni + 1], ni < 0 ? 0 : N[ni + 2], ti < 0 ? 0 : T[ti], ti < 0 ? 0 : T[ti + 1]];
      };
      for(let k = 1; k + 1 < idx.length; k++){
        const tri = [corner(0), corner(k), corner(k + 1)];
        if(!idx[0][2]){
          /* Sin normales en el archivo: la de la cara. */
          const [a, b, d] = tri;
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
          const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
          const len = Math.hypot(n[0], n[1], n[2]) || 1;
          tri.forEach((v) => { v[3] = n[0] / len; v[4] = n[1] / len; v[5] = n[2] / len; });
        }
        tri.forEach((v) => { for(let j = 0; j < 8; j++) cur.push(v[j]); });
      }
    }
  }
  return groups;
}

/* ---------- La página que pinta ---------- */

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><script>
const VS = \`#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec2 aUV;
uniform mat4 uModel, uProj;
out vec3 vN; out vec2 vUV; out vec3 vP;
void main(){ vec4 p = uModel * vec4(aPos, 1.); vP = p.xyz; vN = mat3(uModel) * aNor; vUV = aUV; gl_Position = uProj * p; }\`;
const FS = \`#version 300 es
precision highp float;
in vec3 vN; in vec2 vUV; in vec3 vP;
uniform sampler2D uTex, uAlpha; uniform float uCut, uHasAlpha, uLeaf; uniform vec4 uTint; uniform float uGain; uniform vec3 uCrown; uniform float uCrownR;
out vec4 o;
void main(){
  vec4 c = texture(uTex, vUV);
  float a = uHasAlpha > .5 ? texture(uAlpha, vUV).r : c.a;
  if(uCut > 0. && a < uCut) discard;
  c.rgb = mix(c.rgb, uTint.rgb, uTint.a) * uGain;
  vec3 n = normalize(vN);
  if(!gl_FrontFacing) n = -n;
  /* Luz neutra: la escena le da después el color de la hora. Las hojas, que son láminas, la
     reciben por las dos caras; el interior de la copa queda algo más oscuro. */
  vec3 L = normalize(vec3(-.45, .75, .55));
  float d = dot(n, L);
  float lit = uLeaf > .5 ? .72 + .28 * abs(d) : .50 + .50 * clamp(d * .5 + .5, 0., 1.) + .12 * max(n.y, 0.);
  float deep = clamp(length((vP - uCrown) / uCrownR), 0., 1.);
  if(uLeaf > .5) lit *= mix(.62, 1.08, deep * deep) * mix(.9, 1.06, clamp(n.y * .5 + .5, 0., 1.));
  o = vec4(c.rgb * lit, 1.);
}\`;
function mul(a, b){ const o = new Float32Array(16); for(let i = 0; i < 4; i++) for(let j = 0; j < 4; j++){ let s = 0; for(let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
function loadImg(url){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('no carga ' + url)); i.src = url; }); }
async function render(cfg){
  const SIZE = 4096, OUT = 1024;
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const gl = cv.getContext('webgl2', {antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true});
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if(!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
  const U = (n) => gl.getUniformLocation(pr, n);
  const tex = async (url) => { const img = await loadImg(url); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); const ext = gl.getExtension('EXT_texture_filter_anisotropic'); if(ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8); return t; };
  const groups = [];
  for(const g of cfg.groups){
    const data = new Float32Array(await (await fetch(g.bin)).arrayBuffer());
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    groups.push({vao, n: data.length / 8, layer: g.layer, cut: g.cut || 0, tint: g.tint || [0, 0, 0, 0], gain: g.gain || 1, tex: await tex(g.tex), alpha: g.alpha ? await tex(g.alpha) : null});
  }
  /* El modelo, girado, con el pie del tronco en el origen y a la escala del encuadre. */
  const a = cfg.turn * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = cfg.scale;
  const rot = new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  const move = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cfg.base[0], -cfg.base[1], -cfg.base[2], 1]);
  const size = new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]);
  gl.uniformMatrix4fv(U('uModel'), false, mul(size, mul(rot, move)));
  /* Cámara lejana (casi sin perspectiva) que encuadra 9,2 de lado con el suelo a 0,9 de abajo. */
  const D = 60, half = 4.6, near = 20, far = 100, cy = half - .9;
  const proj = new Float32Array([D / half, 0, 0, 0, 0, D / half, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0]);
  const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -cy, -D, 1]);
  gl.uniformMatrix4fv(U('uProj'), false, mul(proj, view));
  gl.uniform3f(U('uCrown'), cfg.crown[0], cfg.crown[1], cfg.crown[2]); gl.uniform1f(U('uCrownR'), cfg.crownR);
  gl.uniform1i(U('uTex'), 0); gl.uniform1i(U('uAlpha'), 1);
  gl.viewport(0, 0, SIZE, SIZE); gl.enable(gl.DEPTH_TEST);
  const draw = (g) => {
    gl.bindVertexArray(g.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.alpha || g.tex);
    gl.uniform4f(U('uTint'), g.tint[0], g.tint[1], g.tint[2], g.tint[3]); gl.uniform1f(U('uGain'), g.gain);
    gl.uniform1f(U('uCut'), g.cut); gl.uniform1f(U('uHasAlpha'), g.alpha ? 1 : 0); gl.uniform1f(U('uLeaf'), g.layer === 'leaf' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, g.n);
  };
  const sheet = document.createElement('canvas'); sheet.width = OUT * 2; sheet.height = OUT;
  const sx = sheet.getContext('2d'); sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
  const half2 = document.createElement('canvas'); half2.width = half2.height = SIZE / 2;
  const hx = half2.getContext('2d'); hx.imageSmoothingQuality = 'high';
  const layer = (name, x) => {
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if(name === 'leaf'){
      /* La madera tapa las hojas que tiene delante, pero no se pinta en esta capa. */
      gl.colorMask(false, false, false, false);
      groups.filter((g) => g.layer === 'wood').forEach(draw);
      gl.colorMask(true, true, true, true);
    }
    groups.filter((g) => g.layer === name).forEach(draw);
    gl.finish();
    hx.clearRect(0, 0, SIZE / 2, SIZE / 2); hx.drawImage(cv, 0, 0, SIZE / 2, SIZE / 2);
    sx.drawImage(half2, x, 0, OUT, OUT);
  };
  layer('wood', 0); layer('leaf', OUT);
  return sheet.toDataURL('image/webp', cfg.quality);
}
</script>`;

/* ---------- Programa ---------- */

(async () => {
  const wanted = process.argv.slice(2).filter((a) => TREES[a]);
  const names = wanted.length ? wanted : Object.keys(TREES);
  const files = new Map();   /* ruta servida → archivo o datos */
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.split('?')[0]);
    if(key === '/'){ res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); res.end(PAGE); return; }
    const hit = files.get(key);
    if(!hit){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': 'application/octet-stream'});
    res.end(Buffer.isBuffer(hit) ? hit : fs.readFileSync(hit));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((c) => fs.existsSync(c));
  const browser = await chromium.launch({executablePath: chrome, args: ['--ignore-gpu-blocklist', '--use-angle=default', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('página: ' + e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/');

  for(const name of names){
    const tree = Object.assign({}, TREES[name]);
    if(process.env.TREE_TURN) tree.turn = +process.env.TREE_TURN;
    if(process.env.TREE_OUT) tree.out = process.env.TREE_OUT + '-' + name + '-' + tree.turn + '.webp';
    const objFile = path.join(MODELS, tree.obj);
    if(!fs.existsSync(objFile)){ console.error('✖ ' + name + ': no encuentro ' + objFile); process.exitCode = 1; continue; }
    const groups = readObj(objFile);
    const unknown = Object.keys(groups).filter((m) => !tree.materials[m]);
    if(unknown.length) console.warn('⚠ ' + name + ': materiales sin configurar (no se pintan): ' + unknown.join(', '));
    /* Medidas con el giro ya aplicado: el pie del tronco (lo más bajo de la madera), el alto
       y lo que se abre a cada lado, para que quepa en el encuadre. */
    const a = tree.turn * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let minY = Infinity, maxY = -Infinity;
    const each = (fn) => Object.keys(groups).forEach((m) => { if(!tree.materials[m]) return; const g = groups[m]; for(let i = 0; i < g.length; i += 8) fn(g[i], g[i + 1], g[i + 2], tree.materials[m].layer); });
    each((x, y, z, layer) => { if(layer === 'wood' && y < minY) minY = y; if(y > maxY) maxY = y; });
    const h = maxY - minY;
    let bx = 0, bz = 0, bn = 0;
    const foot = tree.foot || [0, 0.03];
    each((x, y, z, layer) => { if(layer === 'wood' && y >= minY + h * foot[0] && y < minY + h * foot[1]){ bx += x; bz += z; bn++; } });
    bx /= bn; bz /= bn;
    if(tree.strip){
      const low = minY + h * tree.strip.below, far = h * tree.strip.beyond;
      Object.keys(groups).forEach((m) => {
        const g = groups[m], kept = [];
        for(let i = 0; i < g.length; i += 24){
          const ys = Math.max(g[i + 1], g[i + 9], g[i + 17]);
          const cx = (g[i] + g[i + 8] + g[i + 16]) / 3 - bx, cz = (g[i + 2] + g[i + 10] + g[i + 18]) / 3 - bz;
          if(ys < low && Math.hypot(cx, cz) > far) continue;
          for(let j = 0; j < 24; j++) kept.push(g[i + j]);
        }
        groups[m] = kept;
      });
    }
    let wide = 0, top = 0, cx = 0, cyy = 0, cz = 0, cn = 0;
    each((x, y, z) => {
      const rx = (x - bx) * c + (z - bz) * s, rz = -(x - bx) * s + (z - bz) * c;
      /* Las raíces que se abren a ras de suelo no cuentan para el ancho: las tapa la hierba. */
      if(y - minY > h * 0.12) wide = Math.max(wide, Math.abs(rx));
      top = Math.max(top, y - minY);
      if(y - minY > h * 0.35){ cx += rx; cyy += y - minY; cz += rz; cn++; }
    });
    const scale = Math.min(7.9 / top, 4.35 / wide);
    const crown = [cx / cn * scale, cyy / cn * scale, cz / cn * scale];
    const cfg = {turn: tree.turn, scale, base: [bx, minY + (tree.sink || 0) / scale, bz], crown, crownR: Math.max(wide, top * 0.6) * scale * 0.75, quality: 0.9, groups: []};
    Object.keys(groups).forEach((m, i) => {
      const mat = tree.materials[m];
      if(!mat) return;
      const serve = (rel) => { const key = '/' + name + '/' + path.basename(rel); files.set(key, path.join(MODELS, rel)); return key; };
      files.set('/' + name + '/' + i + '.bin', Buffer.from(new Float32Array(groups[m]).buffer));
      cfg.groups.push({bin: '/' + name + '/' + i + '.bin', layer: mat.layer, cut: mat.cut || 0, tint: mat.tint, gain: mat.gain, tex: serve(mat.tex), alpha: mat.alpha ? serve(mat.alpha) : null});
    });
    const url = await page.evaluate((cfg) => render(cfg), cfg);
    const out = path.join(root, 'assets/img', tree.out);
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('OK   ' + name + ' → assets/img/' + tree.out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB; alto ' + (top * scale).toFixed(1) + ', ancho ±' + (wide * scale).toFixed(1) + ')');
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
