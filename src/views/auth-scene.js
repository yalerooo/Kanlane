/* Paisaje en 3D de la pantalla de acceso.
   Una escena dibujada en tiempo real con WebGL (un único sombreador que traza rayos, sin
   librerías ni imágenes): una colina con hierba brizna a brizna, mecida por el viento, con
   su luz y sus sombras; cielo con nubes y, en lo alto, un monitor de tubo antiguo
   con un tablero en la pantalla. Atardecer en tema claro y noche en
   oscuro. La cámara se mueve un poco con el ratón.

   El ordenador se coloca siempre en el centro del panel de cristal de la tarjeta de acceso
   (uFocus), sea cual sea el tamaño de la ventana.

   Se pinta a resolución reducida y a 30 fotogramas por segundo, solo mientras la pantalla de
   acceso está a la vista. Con movimiento reducido se pinta un único fotograma. Si el
   navegador no tiene WebGL, queda el degradado de cielo que pone auth.css. */
(function(){
  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

  const FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec2 uFocus;',
    'uniform vec2 uMouse;',
    'uniform float uNight;',
    'uniform sampler2D uTree;',
    'uniform float uTreeOn;',
    'uniform float uTreeX;',
    'uniform float uTreeS;',

    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'vec2 hash2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3. - 2. * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);',
    '}',
    'float fbm(vec2 p){ float a = .5, s = 0.; for(int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }',
    'float fbm3(vec2 p){ float a = .5, s = 0.; for(int i = 0; i < 3; i++){ s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }',
    'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }',
    'float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }',

    /* Dónde está plantado el cerezo (lo fija main antes de nada): el terreno le hace una loma. */
    'vec2 gTree;',
    /* Terreno: un montículo bajo el ordenador, otro bajo el cerezo, lomas suaves que se van */
    /* solapando hacia el fondo y sierras a lo lejos. */
    'float terrain(vec2 p){',
    '  float r2 = dot(p, p);',
    '  float h = 1.5 * exp(-r2 / 30.);',
    '  vec2 dt = p - gTree;',
    '  h += .85 * exp(-dot(dt, dt) / 16.);',
    /* Lomas intermedias: crestas anchas, cada una asomando tras la anterior. */
    '  float roll = sin(p.x * .105 + p.y * .060 + 2.4 * noise(p * .045)) * .5 + .5;',
    '  h += smoothstep(4., 30., p.y) * 1.5 * roll * roll;',
    '  h += smoothstep(-2., 14., abs(p.x + 3.) - 6.) * .55 * (sin(p.x * .16 - p.y * .21 + 1.1) * .5 + .5);',
    '  h += .60 * sin(p.x * .23 + 1.3) * cos(p.y * .19 + .4);',
    /* Bultos y hondonadas: lo que da relieve a la luz rasante (lisos bajo el ordenador). */
    '  h += (.75 * fbm3(p * .30 + 4.) + .16 * noise(p * 1.4)) * smoothstep(1.5, 22., r2);',
    '  h += smoothstep(8., 60., p.y) * 4.2 * fbm3(p * .05 + 3.1);',
    '  h -= smoothstep(2., -9., p.y) * 1.1;',
    '  return h;',
    '}',
    /* Sombra que el propio terreno se hace con el sol bajo. */
    'float terrainShadow(vec3 p, vec3 l){',
    '  float res = 1., t = .25;',
    '  for(int i = 0; i < 14; i++){',
    '    vec3 q = p + l * t;',
    '    float d = q.y - terrain(q.xz);',
    '    res = min(res, 5. * d / t);',
    '    t += clamp(d, .25, 1.6);',
    '    if(res < .02) break;',
    '  }',
    '  return clamp(res, 0., 1.);',
    '}',

    'float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }',
    'float sdBox2(vec2 p, vec2 b){ vec2 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }',
    'float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }',

    /* ---------- El ordenador ---------- */
    /* Monitor de tubo: frontal ancho con el marco de la pantalla hundido, parte de atrás más */
    /* estrecha, cristal abombado, ranura de disquete, cuello y peana. */
    'const float YAW = -.46;',
    'const vec3 SCR = vec3(0., 1.16, 0.);',
    'vec3 toLocal(vec3 p, float base){ p.y -= base; p.xz = rot(YAW) * p.xz; return p; }',
    'float glassD(vec3 q){',
    '  return max(sdBox(q - vec3(0., 1.16, -.57), vec3(.62, .46, .07)) - .01, length(q - vec3(0., 1.16, 5.37)) - 6.);',
    '}',
    'float computer(vec3 q){',
    '  float front = sdBox(q - vec3(0., 1.06, -.22), vec3(.80, .66, .40)) - .09;',
    '  float rear = sdBox(q - vec3(0., 1.03, .52), vec3(.56, .48, .34)) - .12;',
    '  float body = smin(front, rear, .16);',
    '  float recess = sdBox(q - vec3(0., 1.16, -.76), vec3(.63, .47, .17)) - .035;',
    '  body = max(body, -recess);',
    '  body = min(body, glassD(q));',
    '  float slot = sdBox(q - vec3(.02, .50, -.72), vec3(.21, .017, .05));',
    '  body = max(body, -slot);',
    /* Línea de unión entre el frontal y el resto de la carcasa. */
    '  body = max(body, -(sdBox(q - vec3(0., 1.06, .19), vec3(1.1, 1.1, .012))));',
    /* Dos mandos redondos bajo la pantalla. */
    '  vec3 k1 = q - vec3(.56, .50, -.74), k2 = q - vec3(.72, .50, -.74);',
    '  float knobs = min(max(length(k1.xy) - .046, abs(k1.z) - .05), max(length(k2.xy) - .046, abs(k2.z) - .05)) - .008;',
    '  body = min(body, knobs);',
    '  float neck = sdBox(q - vec3(0., .25, .04), vec3(.36, .11, .30)) - .03;',
    '  float foot = sdBox(q - vec3(0., .085, .04), vec3(.60, .055, .46)) - .04;',
    /* El cable sale por detrás y se pierde en la hierba. */
    '  float cable = min(sdCapsule(q, vec3(.22, .62, .90), vec3(.30, .30, 1.20), .028), sdCapsule(q, vec3(.30, .30, 1.20), vec3(.70, -.05, 1.75), .028));',
    '  return min(min(body, cable), smin(neck, foot, .05));',
    '}',
    'vec3 computerNormal(vec3 q){',
    '  vec2 e = vec2(.003, 0.);',
    '  return normalize(vec3(computer(q + e.xyy) - computer(q - e.xyy), computer(q + e.yxy) - computer(q - e.yxy), computer(q + e.yyx) - computer(q - e.yyx)));',
    '}',
    /* Sombra suave del ordenador hacia la luz (en coordenadas del ordenador). */
    'float computerShadow(vec3 q, vec3 l){',
    '  float res = 1., t = .06;',
    '  for(int i = 0; i < 20; i++){',
    '    float d = computer(q + l * t);',
    '    res = min(res, 7. * d / t);',
    '    t += clamp(d, .05, .4);',
    '    if(res < .02 || t > 6.) break;',
    '  }',
    '  return clamp(res, 0., 1.);',
    '}',


    'float sph(vec3 ro, vec3 rd, vec3 c, float r){ vec3 o = ro - c; float b = dot(o, rd), h = b * b - dot(o, o) + r * r; return h < 0. ? -1. : max(-b - sqrt(h), 0.); }',

    /* ---------- El tablero de la pantalla ---------- */
    'float rr(vec2 p, vec2 b, float r){ return sdBox2(p, b - r) - r; }',
    'vec3 card(vec3 col, vec2 u, vec2 c, vec3 tag, float aa){',
    '  float d = rr(u - c, vec2(.24, .125), .05);',
    '  col = mix(col, vec3(.78, .74, .66), (1. - smoothstep(0., .05, d)) * .35);',
    '  col = mix(col, vec3(1.), 1. - smoothstep(0., aa, d));',
    '  col = mix(col, tag, 1. - smoothstep(0., aa, rr(u - c - vec2(-.15, .055), vec2(.045, .03), .02)));',
    '  col = mix(col, vec3(.26, .26, .30), 1. - smoothstep(0., aa, rr(u - c - vec2(-.02, -.005), vec2(.17, .02), .02)));',
    '  col = mix(col, vec3(.72, .72, .74), 1. - smoothstep(0., aa, rr(u - c - vec2(-.07, -.065), vec2(.12, .016), .015)));',
    '  return col;',
    '}',
    'vec3 board(vec2 u){',
    '  float aa = .022;',
    '  vec3 col = vec3(.985, .955, .87);',
    '  col = mix(col, vec3(.925, .885, .79), smoothstep(.70, .72, u.y));',
    '  col = mix(col, vec3(.30, .28, .27), 1. - smoothstep(0., aa, rr(u - vec2(-.56, .84), vec2(.24, .045), .04)));',
    '  col = mix(col, vec3(.14, .14, .16), 1. - smoothstep(0., aa, rr(u - vec2(.72, .84), vec2(.15, .058), .05)));',
    '  for(int i = 0; i < 3; i++){',
    '    float fi = float(i);',
    '    float cx = -.62 + fi * .62;',
    '    col = mix(col, vec3(.95, .915, .82), 1. - smoothstep(0., aa, rr(u - vec2(cx, -.14), vec2(.28, .80), .06)));',
    '    vec3 ring = i == 0 ? vec3(.55, .56, .60) : (i == 1 ? vec3(.23, .51, .96) : vec3(.13, .77, .37));',
    '    float dr = i == 2 ? length(u - vec2(cx - .20, .55)) - .05 : abs(length(u - vec2(cx - .20, .55)) - .035) - .014;',
    '    col = mix(col, ring, 1. - smoothstep(0., aa, dr));',
    '    col = mix(col, vec3(.36, .35, .34), 1. - smoothstep(0., aa, rr(u - vec2(cx + .02, .55), vec2(.12, .025), .02)));',
    '    for(int j = 0; j < 3; j++){',
    '      if(i == 1 && j == 2) continue;',
    '      if(i == 0 && j == 2) continue;',
    '      float fj = float(j);',
    '      vec3 tag = mix(.5 + .5 * cos(6.283 * (hash(vec2(fi, fj)) + vec3(0., .33, .67))), vec3(.5), .2);',
    '      col = card(col, u, vec2(cx, .30 - fj * .31), tag, aa);',
    '    }',
    '  }',
    /* Una tarjeta viaja de la primera columna a la segunda y vuelve. */
    '  float ph = mod(uTime * .11, 2.);',
    '  float k = smoothstep(.12, .42, ph) - smoothstep(1.12, 1.42, ph);',
    '  vec2 c = mix(vec2(-.62, -.32), vec2(0., -.32), k) + vec2(0., .13 * sin(k * 3.1416));',
    '  col = card(col, u, c, vec3(.96, .55, .20), aa);',
    /* El cursor acompaña a la tarjeta. */
    '  vec2 m = c + vec2(.10, -.10);',
    '  float cur = max(sdBox2(rot(.6) * (u - m), vec2(.035, .06)), -(u.y - m.y - .05));',
    '  col = mix(col, vec3(.08), 1. - smoothstep(0., aa, cur));',
    '  return col;',
    '}',

    /* ---------- Cielo ---------- */
    'vec3 sky(vec3 rd, vec3 L){',
    '  float y = max(rd.y, 0.);',
    '  vec3 day = mix(vec3(.99, .52, .26), vec3(.86, .28, .24), smoothstep(0., .22, y));',
    '  day = mix(day, vec3(.44, .30, .40), smoothstep(.18, .55, y));',
    '  day = mix(day, vec3(.20, .30, .43), smoothstep(.45, .95, y));',
    '  vec3 night = mix(vec3(.20, .17, .36), vec3(.07, .08, .22), smoothstep(0., .3, y));',
    '  night = mix(night, vec3(.015, .02, .07), smoothstep(.25, .9, y));',
    '  vec3 col = mix(day, night, uNight);',
    '  float s = max(dot(rd, L), 0.);',
    '  vec3 glow = mix(vec3(1., .62, .28), vec3(.55, .60, .95), uNight);',
    '  col += glow * (pow(s, 6.) * .35 + pow(s, 40.) * .5) * mix(1., .45, uNight);',
    '  col += mix(vec3(1., .93, .75), vec3(.97, .96, .90), uNight) * smoothstep(.9990, .9994, s) * mix(1., 1.3, uNight);',
    '  vec2 cp = rd.xz / (rd.y + .16) * 1.3 + vec2(uTime * .012, 0.);',
    '  float cl = smoothstep(.42, .78, fbm(cp)) * smoothstep(0., .12, rd.y);',
    '  float lit = fbm(cp + L.xz * .5);',
    '  vec3 ccol = mix(mix(vec3(.30, .16, .24), vec3(1., .60, .42), lit), mix(vec3(.05, .06, .14), vec3(.24, .26, .46), lit), uNight);',
    '  col = mix(col, ccol, cl * .85);',
    '  vec2 sp = rd.xy / (1. + abs(rd.z)) * 420.;',
    '  vec2 si = floor(sp);',
    '  float st = step(.988, hash(si)) * smoothstep(.42, .05, length(fract(sp) - .5));',
    '  st *= .6 + .4 * sin(uTime * 1.7 + hash(si + 7.) * 40.);',
    '  col += vec3(.9, .92, 1.) * st * uNight * (1. - cl) * smoothstep(.02, .25, rd.y);',
    '  return col;',
    '}',

    /* ---------- Hierba ---------- */
    /* Cada brizna es un tallo fino que sale de una celda del suelo, se curva hacia un lado y */
    /* se mece con el viento. Devuelve (distancia, altura relativa 0..1, azar de la brizna, flor). */
    'const float GRASS_H = .22;',
    'const float GRASS_N = 18.;',
    'vec2 wind(vec2 r){',
    '  float gust = sin(uTime * .9 + r.x * .55 + r.y * .35) * .5 + sin(uTime * .47 + r.x * .21 - r.y * .3) * .5;',
    '  return vec2(1., .45) * (.030 * gust + .022 * (noise(r * .35 + uTime * .12) - .5));',
    '}',
    'vec4 blade(vec2 xz, float y, float wide){',
    '  vec2 g = xz * GRASS_N;',
    '  vec2 id0 = floor(g - .5);',
    '  vec4 best = vec4(1e3, 0., 0., 0.);',
    '  for(int i = 0; i < 2; i++){',
    '    for(int j = 0; j < 2; j++){',
    '      vec2 id = id0 + vec2(float(i), float(j));',
    '      vec2 r = hash2(id);',
    /* Altura por zonas (matas) y, de vez en cuando, una brizna que sobresale. */
    '      float tall = step(.90, fract(r.y * 7.31));',
    '      float hb = GRASS_H * (.34 + .44 * r.x + .22 * tall) * (.70 + .50 * noise(id * .09));',
    '      vec2 root = (id + .5 + (r - .5) * .7) / GRASS_N;',
    '      float k = y / hb;',
    '      float kk = clamp(k, 0., 1.);',
    '      float a = r.y * 6.283;',
    '      vec2 lean = (vec2(cos(a), sin(a)) * (.014 + .026 * r.x) + wind(root) * .8) * kk * kk;',
    '      float flower = 0.;',
    '      float w = (.0062 + wide) * (1. - kk * .88);',
    '      float d = max(length(xz - root - lean) - w, y - hb);',
    '      if(d < best.x) best = vec4(d, kk, r.x, flower);',
    '    }',
    '  }',
    '  return best;',
    '}',

    /* ---------- Luciérnagas ---------- */
    /* Vuelan sobre la hierba, cada una por su camino, y se encienden y se apagan despacio. */
    'const int FF_N = 24;',
    'vec4 firefly(float fi){',
    '  vec2 h = hash2(vec2(fi, 3.7));',
    '  vec2 xz = vec2(mix(-9.5, 9., h.x), mix(-8.5, 5., h.y));',
    '  xz += vec2(sin(uTime * .19 + fi * 2.1) + .5 * sin(uTime * .47 + fi), cos(uTime * .15 + fi * 1.3) + .5 * cos(uTime * .41 + fi * 2.7)) * 1.1;',
    '  float y = terrain(xz) + .30 + .85 * hash(vec2(fi, 8.1)) + .16 * sin(uTime * .55 + fi * 4.);',
    /* Destello: sube rápido, se apaga despacio y pasa un rato a oscuras. */
    '  float ph = fract(uTime * (.11 + .09 * hash(vec2(fi, 5.3))) + h.x * 7.);',
    '  float bl = smoothstep(0., .08, ph) * (1. - smoothstep(.14, .80, ph));',
    '  return vec4(xz.x, y, xz.y, .22 + .78 * bl);',
    '}',

    /* El cerezo: a qué distancia va y cuánto mide (unidades de escena por unidad del modelo). */
    'const float TREE_Z = -2.2;',
    'const float TREE_SC = .80;',

    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    /* El tronco del cerezo cae siempre en el mismo punto de la pantalla (uTreeX), cerca del */
    /* borde izquierdo. Se calcula con la cámara en reposo, para que al moverla el árbol también */
    /* se desplace respecto al fondo, y antes que nada, porque el terreno le hace una loma. */
    '  {',
    '    vec3 fw0 = normalize(vec3(-2.2, .40, 11.5)), rt0 = normalize(cross(vec3(0., 1., 0.), fw0));',
    '    vec3 rdT = normalize(fw0 * 1.5 + (uTreeX - uFocus.x) / uRes.y * rt0);',
    '    gTree = vec2(2.2 + rdT.x * (TREE_Z + 11.5) / rdT.z, TREE_Z);',
    '  }',
    '  float treeSc = TREE_SC * uTreeS;',
    '  float base = terrain(vec2(0.));',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2 + uMouse.x * .45, base + .62 + uMouse.y * .10, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);',
    '  vec3 L = normalize(mix(vec3(.72, .26, .64), vec3(.50, .40, .77), uNight));',
    '  vec3 Ll = L; Ll.xz = rot(YAW) * Ll.xz;',
    '  vec3 sunCol = mix(vec3(1.30, .58, .30), vec3(.30, .36, .62), uNight);',
    '  vec3 ambient = mix(vec3(.20, .11, .11), vec3(.045, .055, .12), uNight);',
    '  vec3 skyLight = mix(vec3(.12, .13, .17), vec3(.05, .07, .16), uNight);',
    '  vec3 screenGlow = vec3(1., .91, .70);',
    /* La pantalla, vista desde el mundo: dónde está y hacia dónde mira. */
    '  vec3 sn = vec3(0., 0., -1.); sn.xz = rot(-YAW) * sn.xz;',
    '  vec3 sc = vec3(0., 1.16, -.66); sc.xz = rot(-YAW) * sc.xz; sc.y += base;',

    /* Terreno: se avanza hasta la altura de las puntas de la hierba. */
    '  float t = .4, tHit = -1.;',
    '  if(rd.y < .2){',
    '    for(int i = 0; i < 130; i++){',
    '      vec3 p = ro + rd * t;',
    '      float d = p.y - terrain(p.xz) - GRASS_H;',
    '      if(d < .0025 * t){ tHit = t; break; }',
    '      t += max(.02 + t * .005, d * .48);',
    '      if(t > 170.) break;',
    '    }',
    '  }',
    /* Por debajo del horizonte siempre hay suelo. */
    '  if(tHit < 0. && rd.y < .012) tHit = 170.;',

    /* El cerezo, plantado: las raíces quedan a medias entre la hierba. */
    '  vec3 treeB = vec3(gTree.x, terrain(gTree) + .22 * treeSc, gTree.y);',

    /* El ordenador (solo si el rayo pasa cerca). */
    '  float tObj = -1.;',
    '  float t0 = sph(ro, rd, ta, 1.95);',
    '  if(t0 >= 0.){',
    '    float tt = t0;',
    '    for(int i = 0; i < 64; i++){',
    '      float d = computer(toLocal(ro + rd * tt, base));',
    '      if(d < .0015){ tObj = tt; break; }',
    '      tt += d;',
    '      if(tt > t0 + 5.) break;',
    '    }',
    '  }',

    '  vec3 col = sky(rd, L);',
    '  vec3 fogCol = mix(vec3(.66, .26, .17), vec3(.09, .09, .22), uNight);',
    /* Hacia el sol, la bruma se enciende. */
    '  fogCol += mix(vec3(.30, .16, .05), vec3(.03, .04, .09), uNight) * pow(max(dot(normalize(vec3(rd.x, 0., rd.z)), normalize(vec3(L.x, 0., L.z))), 0.), 3.);',
    /* Sierras lejanas: dos siluetas, una tras otra, cada vez más diluidas en la bruma. */
    '  if(tHit < 0.){',
    '    float az = atan(rd.x, rd.z);',
    '    float m1 = .030 + .075 * fbm3(vec2(az * 5. + 2., 1.3)) + .018 * noise(vec2(az * 31., 4.));',
    '    float m2 = .014 + .050 * fbm3(vec2(az * 9. + 7., 6.1)) + .010 * noise(vec2(az * 47., 9.));',
    '    vec3 hz = sky(normalize(vec3(rd.x, .02, rd.z)), L);',
    '    vec3 c1 = mix(hz, mix(vec3(.50, .20, .24), vec3(.07, .07, .19), uNight), .42);',
    '    vec3 c2 = mix(hz, mix(vec3(.33, .13, .17), vec3(.045, .05, .14), uNight), .66);',
    '    col = mix(col, c1, 1. - smoothstep(m1 - .004, m1 + .004, rd.y));',
    '    col = mix(col, mix(c2, c1, smoothstep(0., m2, rd.y) * .35), 1. - smoothstep(m2 - .003, m2 + .003, rd.y));',
    '  }',
    /* Las luciérnagas, de noche (se calculan una vez por punto). */
    '  vec4 ff[24];',
    '  if(uNight > .01){',
    '    for(int i = 0; i < FF_N; i++) ff[i] = firefly(float(i));',
    '  }',
    '  vec3 ffCol = vec3(.80, 1., .34);',
    '  float tFin = -1.;',

    /* ---------- Hierba y suelo ---------- */
    '  vec3 gcol = vec3(0.);',
    '  float tGround = -1.;',
    '  if(tHit > 0.){',
    '    vec3 p0 = ro + rd * tHit;',
    '    float e = .06;',
    '    float g0 = terrain(p0.xz);',
    '    vec2 grad = vec2(terrain(p0.xz + vec2(e, 0.)) - g0, terrain(p0.xz + vec2(0., e)) - g0) / e;',
    '    vec3 n = normalize(vec3(-grad.x, 1., -grad.y));',
    /* Dentro de la capa de hierba, brizna a brizna (solo cerca: de lejos no se distinguen). */
    '    float near = 1. - smoothstep(11., 19., tHit);',
    '    float tt = tHit;',
    '    vec4 b = vec4(1., 1., .5, 0.);',
    '    float hitBlade = 0.;',
    '    if(near > 0.){',
    '      float wide = tHit * .0005;',
    '      for(int i = 0; i < 64; i++){',
    '        vec3 p = ro + rd * tt;',
    '        float y = p.y - (g0 + dot(grad, p.xz - p0.xz));',
    '        if(y < 0.){ b = vec4(0., 0., .5, 0.); break; }',
    '        b = blade(p.xz, y, wide);',
    '        if(b.x < .0012 * tt){ hitBlade = 1.; break; }',
    '        tt += clamp(b.x * .85, .006, .028);',
    '      }',
    '    }',
    '    tGround = tt;',
    '    vec3 p = ro + rd * tt;',
    '    float kk = b.y;',
    /* Color de la brizna: oscura en la raíz, clara en la punta; algunas, secas. */
    '    float patch = fbm3(p.xz * .55);',
    '    vec3 root = mix(vec3(.040, .060, .020), vec3(.070, .100, .032), patch);',
    '    vec3 tip = mix(vec3(.20, .40, .09), vec3(.42, .58, .15), patch);',
    '    tip = mix(tip, vec3(.56, .50, .20), smoothstep(.72, .98, b.z) * .8);',
    '    vec3 alb = mix(root, tip, kk * kk * .25 + kk * .75);',
    /* Cada brizna, con su tono: unas más claras, otras más azuladas o más amarillas. */
    '    float tone = fract(b.z * 9.7);',
    '    alb *= mix(1., .72 + .56 * tone, near);',
    '    alb = mix(alb, alb * vec3(.80, 1.02, 1.10), smoothstep(.6, 1., fract(b.z * 23.3)) * .5 * near);',
    '    alb = mix(alb, vec3(.26, .15, .10), smoothstep(.66, .9, fbm3(p.xz * .23 + 8.)) * .22 * (1. - uNight));',
    /* Flores: la punta de algunas briznas. */
    /* De lejos: la misma hierba como textura, con vetas que siguen al viento. */
    '    float sway = .5 + .5 * sin(p.x * 1.3 + p.z * .7 + uTime * .9);',
    '    float fine = noise(vec2(p.x * 150. + sway * 2., p.z * 26.)) * .5 + noise(p.xz * 70.) * .3 + noise(p.xz * 19.) * .2;',
    '    float streak = fine;',
    '    vec3 far = mix(vec3(.060, .105, .030), vec3(.25, .39, .10), patch * .6 + fine * .4);',
    '    far = mix(far, vec3(.44, .36, .15), smoothstep(.62, .92, fine) * .55);',
    '    far = mix(far, vec3(.30, .14, .09), smoothstep(.55, .85, fbm3(p.xz * .21 + 8.)) * .35 * (1. - uNight));',
    '    float kFar = .35 + .65 * fine;',
    '    alb = mix(far, alb, near);',
    '    kk = mix(kFar, kk, near);',
    /* Luz: las raíces quedan a la sombra de las demás briznas; las puntas reciben el sol y */
    /* dejan pasar la luz cuando se miran a contraluz. */
    '    float ao = mix(.26, 1., smoothstep(0., .85, kk));',
    '    float dif = clamp((dot(n, L) + .30) / 1.30, 0., 1.);',
    '    float through = pow(max(dot(rd, L), 0.), 3.) * kk;',
    '    float sh = 1.;',
    '    vec3 ql = toLocal(p, base);',
    '    if(dot(ql.xz, ql.xz) < 30.) sh = computerShadow(ql, Ll);',
    '    sh *= terrainShadow(vec3(p.x, g0 + dot(grad, p.xz - p0.xz) + GRASS_H, p.z), L);',
    /* Manchas de sombra de las nubes, que barren las lomas despacio. */
    '    float cloudSh = smoothstep(.34, .66, fbm3(p.xz * .075 + vec2(uTime * .035, uTime * .014)));',
    '    sh *= mix(.40, 1., cloudSh);',
    /* El cerezo: la sombra de la copa, a manchas que se mueven con el viento, y la del pie */
    /* del tronco, que es lo que lo planta en el suelo. */
    '    vec2 tsh = (p.xz - treeB.xz) / treeSc + L.xz * 4.2;',
    '    float dapple = smoothstep(.30, .62, noise(p.xz * 2.4 + vec2(uTime * .10, 0.)) * .6 + noise(p.xz * 6.1) * .4);',
    '    sh *= 1. - .62 * smoothstep(5.4, 2.2, length(tsh * vec2(1., 1.3))) * mix(1., .25, dapple) * uTreeOn;',
    '    float foot = length((p.xz - treeB.xz) * vec2(1., 1.6)) / treeSc;',
    '    float contact = mix(1., smoothstep(.25, 1.9, foot) * .72 + .28, uTreeOn);',
    '    sh *= contact;',
    '    ao *= .45 + .55 * contact;',
    '    sh = mix(sh, 1., uNight * .5);',
    '    gcol = alb * (ambient * 1.5 * ao + skyLight * 2.2 * ao + sunCol * dif * 2.4 * ao * sh);',
    '    gcol += sunCol * vec3(.78, .62, .18) * through * 1.25 * sh * (.4 + .6 * streak);',
    /* Las puntas, al sol, brillan: un filo de luz en lo alto de cada brizna. */
    '    gcol += sunCol * vec3(.60, .66, .26) * pow(kk, 5.) * (.35 + .65 * b.z) * dif * .50 * sh * near;',
    /* Luz rasante en las crestas de las lomas. */
    '    gcol += alb * sunCol * pow(clamp(1. - n.y, 0., 1.), .7) * max(dot(n, L), 0.) * 2.2 * sh;',
    '    float gustWave = smoothstep(.55, 1., sin(p.x * .55 + p.z * .33 - uTime * .9) * .5 + .5) * (.5 + .5 * noise(p.xz * .7 + uTime * .1));',
    '    gcol += alb * sunCol * gustWave * kk * .55 * sh * (1. - uNight * .7);',
    /* La pantalla ilumina la hierba que tiene delante. */
    '    vec3 tl = sc - p;',
    '    float dl = length(tl);',
    '    float spill = max(dot(normalize(tl), normalize(n + vec3(0., .6, 0.))), 0.) * max(dot(-normalize(tl), sn), 0.) / (1. + dl * dl * .5);',
    '    gcol += alb * screenGlow * spill * mix(1.6, 9., uNight) * (.35 + .65 * kk);',
    /* Cada luciérnaga alumbra un corro de hierba debajo. */
    '    if(uNight > .01){',
    '      vec3 fl = vec3(0.);',
    '      for(int i = 0; i < FF_N; i++){',
    '        vec3 d = ff[i].xyz - p;',
    '        fl += ffCol * max(ff[i].w - .18, 0.) * exp(-dot(d, d) * 2.2);',
    '      }',
    '      gcol += alb * fl * 2.4 * (.35 + .65 * kk) * uNight;',
    '    }',
    '    col = gcol;',
    '    tFin = tGround;',
    '  }',

    /* ---------- El ordenador ---------- */
    '  if(tObj > 0. && (tGround < 0. || tObj < tGround)){',
    '    tFin = tObj;',
    '    vec3 p = ro + rd * tObj;',
    '    {',
    '      vec3 q = toLocal(p, base);',
    '      vec3 nl = computerNormal(q);',
    '      vec3 n = nl; n.xz = rot(-YAW) * n.xz;',
    '      vec3 rdl = rd; rdl.xz = rot(YAW) * rdl.xz;',
    '      float fres = pow(1. - max(dot(n, -rd), 0.), 4.);',
    '      vec3 refl = reflect(rd, n);',
    '      if(abs(glassD(q)) < .006 && q.z < -.5){',
    /* La pantalla: el tablero, líneas del tubo, bordes más oscuros y el reflejo del cielo. */
    '        vec2 su = (q.xy - vec2(0., 1.16)) / vec2(.60, .44);',
    '        vec3 b = board(su);',
    '        b *= .93 + .07 * sin(su.y * 170.);',
    '        b *= 1. - .20 * dot(su * .85, su * .85);',
    '        b *= 1. + .03 * sin(uTime * 7.);',
    '        col = b * mix(1.02, 1.14, uNight) + vec3(.05, .03, 0.) * (1. - uNight);',
    '        col = mix(col, sky(refl, L), .05 + fres * .55);',
    '        col += vec3(1.) * pow(max(dot(refl, L), 0.), 60.) * .5;',
    '      }else{',
    /* La carcasa: plástico azul grisáceo, más claro en el marco y más oscuro en la peana. */
    '        float ao = clamp(computer(q + nl * .10) / .10, 0., 1.);',
    '        ao *= clamp(computer(q + nl * .30) / .30, 0., 1.) * .5 + .5;',
    '        vec3 alb = vec3(.36, .52, .70);',
    '        float frame = step(q.z, -.50) * step(.30, q.y);',
    '        alb = mix(alb, vec3(.42, .58, .76), frame);',
    '        alb = mix(alb, vec3(.20, .27, .38), step(q.y, .36));',
    /* Hueco del marco y de la ranura: más oscuros. */
    '        float inRecess = step(abs(q.x), .68) * step(abs(q.y - 1.16), .52) * smoothstep(-.70, -.62, q.z) * step(q.z, -.50);',
    '        alb = mix(alb, vec3(.10, .13, .18), inRecess);',
    '        alb = mix(alb, vec3(.03, .03, .04), step(abs(q.x - .02), .215) * step(abs(q.y - .50), .019) * step(q.z, -.60));',
    /* Embellecedor claro alrededor de la pantalla. */
    '        float trim = step(q.z, -.66) * step(abs(q.x), .73) * step(abs(q.y - 1.16), .57) * (1. - step(abs(q.x), .665) * step(abs(q.y - 1.16), .505));',
    '        alb = mix(alb, vec3(.72, .78, .86), trim * .75);',
    /* Mandos y cable, oscuros. */
    '        float onKnob = step(length(q.xy - vec2(.56, .50)), .058) + step(length(q.xy - vec2(.72, .50)), .058);',
    '        alb = mix(alb, vec3(.09, .10, .13), clamp(onKnob, 0., 1.) * step(q.z, -.70));',
    '        alb = mix(alb, vec3(.04, .04, .05), step(.88, q.z) * step(q.y, .70));',
    /* Rejillas de ventilación: en los costados y arriba, por detrás. */
    '        float sideVent = step(.5, abs(nl.x)) * step(abs(q.z - .45), .26) * step(abs(q.y - 1.20), .26) * step(.5, fract(q.y * 15.));',
    '        float topVent = step(.5, nl.y) * step(abs(q.z - .50), .22) * step(abs(q.x), .40) * step(.5, fract(q.x * 13.));',
    '        alb *= 1. - .55 * max(sideVent, topVent);',
    /* Insignia con las tres barras de Kanlane, bajo la pantalla. */
    '        vec2 bd = q.xy - vec2(-.60, .50);',
    '        float badge = step(abs(bd.x), .075) * step(abs(bd.y), .075) * step(q.z, -.60);',
    '        float bars = step(abs(fract((bd.x + bd.y * .45) * 16.) - .5), .22);',
    '        alb = mix(alb, mix(vec3(.10, .11, .14), vec3(.92, .94, .98), bars), badge);',
    /* Grano fino del plástico. */
    '        alb *= .94 + .12 * noise(q.xy * 60. + q.z * 37.);',
    '        float dif = max(dot(n, L), 0.);',
    '        float shd = computerShadow(q + nl * .02, Ll);',
    '        vec3 hv = normalize(L - rd);',
    '        float spec = pow(max(dot(n, hv), 0.), 48.) * .55 + pow(max(dot(n, hv), 0.), 8.) * .08;',
    '        float skyL = .5 + .5 * n.y;',
    '        col = alb * (ambient * .9 * ao + mix(vec3(.20, .27, .40), skyLight, uNight) * skyL * 1.7 * ao + sunCol * dif * 1.1 * shd);',
    '        col += sunCol * spec * shd;',
    '        col += sky(refl, L) * fres * .22 * ao;',
    /* La hierba le devuelve un poco de verde por debajo. */
    '        col += alb * vec3(.05, .09, .03) * max(-n.y, 0.) * (1. - uNight);',
    /* La pantalla ilumina el hueco de su marco. */
    '        col += screenGlow * inRecess * .34 * mix(.7, 1.2, uNight);',
    /* Piloto verde. */
    '        float led = 1. - smoothstep(.016, .028, length(q.xy - vec2(.38, .50)));',
    '        col = mix(col, vec3(.35, 1., .55) * (.85 + .15 * sin(uTime * 2.)), led * step(q.z, -.55));',
    '      }',
    '    }',
    '  }',

    '  if(tFin > 0.){',
    '    float fog = 1. - exp(-tFin * mix(.021, .024, uNight));',
    /* A lo lejos el suelo se funde con la bruma del horizonte. */
    '    fog = max(fog, smoothstep(30., 110., tFin) * .92);',
    '    col = mix(col, mix(fogCol, sky(normalize(vec3(rd.x, .03, rd.z)), L), .28), fog);',
    /* Bruma baja: se posa en las hondonadas y deja las crestas fuera. */
    '    float py = ro.y + rd.y * tFin;',
    '    float mist = exp(-max(py - base + 1.9, 0.) * 1.5) * smoothstep(9., 34., tFin) * (1. - smoothstep(70., 150., tFin));',
    '    col = mix(col, mix(vec3(1., .60, .36), vec3(.20, .23, .42), uNight), mist * .42);',
    '  }',
    /* ---------- El cerezo ---------- */
    /* Es un modelo 3D renderizado aparte a una imagen con transparencia (assets/img/sakura.webp), */
    /* puesta sobre un plano fijo, de cara a la cámara en reposo. No se mueve ni se deforma: lo */
    /* que da vida al árbol son los pétalos que caen. */
    '  if(uTreeOn > .5){',
    '    vec3 pn = normalize(vec3(-2.2, 0., 11.5));',
    '    vec3 pr = vec3(pn.z, 0., -pn.x);',
    '    float tp = dot(treeB - ro, pn) / dot(rd, pn);',
    '    if(tp > 0. && !(tGround > 0. && tGround < tp)){',
    '      vec3 hp = ro + rd * tp - treeB;',
    /* En unidades del modelo (la imagen abarca 9,2 de lado, con el suelo a 0,9 del borde de abajo). */
    '      vec2 u = vec2(dot(hp, pr), hp.y) / treeSc;',
    '      vec2 tuv = vec2(u.x / 9.2 + .5, (u.y + .9) / 9.2);',
    '      if(tuv.x > 0. && tuv.x < 1. && tuv.y > 0. && tuv.y < 1.){',
    '        vec4 tr = texture2D(uTree, tuv);',
    /* Luz del momento: cálida al atardecer, fría y apagada de noche; algo más honda abajo. */
    '        vec3 tint = mix(vec3(1.12, .90, .86), vec3(.50, .47, .74), uNight) * mix(.86, 1.06, smoothstep(.5, 6.5, u.y));',
    '        vec3 tc = tr.rgb * tint;',
    /* A contraluz las flores se encienden un poco. */
    '        tc += tr.rgb * vec3(1., .55, .45) * pow(max(dot(rd, L), 0.), 3.) * .18 * (1. - uNight);',
    /* La pantalla del ordenador no llega hasta aquí, pero la bruma sí. */
    '        float tf = (1. - exp(-tp * mix(.021, .024, uNight))) * .7;',
    '        tc = mix(tc, mix(fogCol, sky(normalize(vec3(rd.x, .03, rd.z)), L), .28) * tr.a, tf);',
    '        col = col * (1. - tr.a) + tc;',
    '      }',
    '    }',
    '  }',
    /* Halo de la pantalla en el aire. */
    '  vec3 oc = ro - sc;',
    '  float bq = dot(oc, rd);',
    '  float dq = length(oc + rd * max(-bq, 0.));',
    '  col += screenGlow * .06 * exp(-dq * dq * 1.5) * mix(.5, 1.5, uNight) * step(0., -bq);',
    /* Pétalos del cerezo: caen despacio y el viento los lleva hacia la derecha. */
    '  vec2 pa = gl_FragCoord.xy / uRes.y;',
    '  float asp = uRes.x / uRes.y;',
    '  for(int i = 0; i < 22; i++){',
    '    float fi = float(i);',
    '    float sp = .028 + hash(vec2(fi, 2.2)) * .030;',
    '    float ph = fract(hash(vec2(fi, 9.1)) + uTime * sp);',
    '    vec2 pp = vec2(-.05 + hash(vec2(fi, 4.7)) * .30 * asp + ph * (.55 + hash(vec2(fi, 6.3)) * .5) * asp, .95 - ph * 1.05);',
    '    pp += .020 * vec2(sin(uTime * .9 + fi * 3.1), cos(uTime * 1.3 + fi * 1.7));',
    '    vec2 dp = rot(uTime * (.6 + hash(vec2(fi, 5.5))) + fi) * (pa - pp);',
    '    float petal = 1. - smoothstep(.0020, .0042, length(dp * vec2(1., 1.9)));',
    '    float fade = smoothstep(0., .08, ph) * smoothstep(1., .85, ph);',
    '    col = mix(col, mix(vec3(1., .78, .86), vec3(.62, .56, .86), uNight * .6), petal * fade * .9);',
    '  }',
    /* Luciérnagas, de noche: un punto vivo, un halo y un resplandor amplio. Las tapa lo que */
    /* tengan delante (una loma, el ordenador). */
    '  if(uNight > .01){',
    '    for(int i = 0; i < FF_N; i++){',
    '      vec3 v = ff[i].xyz - ro;',
    '      float tc = dot(v, rd);',
    '      if(tc > 0. && (tFin < 0. || tc < tFin)){',
    '        float d2 = max(dot(v, v) - tc * tc, 0.);',
    '        float g = 1.3 * exp(-d2 / .0011) + .42 * exp(-d2 / .018) + .11 * exp(-d2 / .22);',
    '        col += ffCol * g * ff[i].w * uNight;',
    '      }',
    '    }',
    '  }',
    /* Viñeta y grano. */
    '  vec2 vq = gl_FragCoord.xy / uRes - .5;',
    '  col *= 1. - .34 * dot(vq, vq) * 2.2;',
    /* Lo que se pasa de blanco (el centro de una luciérnaga) se recorta antes del contraste. */
    '  col = clamp(col, 0., 1.);',
    /* Contraste suave y sombras algo frías, como en una foto al atardecer. */
    '  col = mix(col, col * col * (3. - 2. * col), .35);',
    '  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * .045;',
    '  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);',
    '}'
  ].join('\n');

  /* Lado mayor del lienzo, en píxeles: por encima de esto se estira (la escena es suave y lo admite). */
  const MAX_SIDE = 1600;
  const FRAME_MS = 1000 / 30;
  /* Desde /app/. La imagen es cuadrada (1024 px), con el árbol centrado y el suelo abajo. */
  const TREE_URL = '../assets/img/sakura.webp';

  function start(canvas, screen, focusEl){
    let gl = null;
    try{ gl = canvas.getContext('webgl', {antialias:false, alpha:false, powerPreference:'low-power'}); }catch(e){}
    if(!gl) return false;

    function shader(type, src){
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if(!vs || !fs) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRes', 'uTime', 'uFocus', 'uMouse', 'uNight', 'uTree', 'uTreeOn', 'uTreeX', 'uTreeS'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    /* El cerezo: un modelo 3D renderizado aparte a una imagen con transparencia. Hasta que
       llega, la escena se pinta sin él. */
    let treeReady = false;
    const treeTex = gl.createTexture();
    const treeImg = new Image();
    treeImg.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, treeTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, treeImg);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      treeReady = true;
      last = 0;
      wake();
    };
    treeImg.src = TREE_URL;
    canvas.classList.add('is-on');

    const root = document.documentElement;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isDark = () => { const a = root.getAttribute('data-theme'); return a ? a === 'dark' : darkQuery.matches; };
    const isStill = () => stillQuery.matches || root.getAttribute('data-motion') === 'reduced';

    let scale = 1, night = isDark() ? 1 : 0, mx = 0, my = 0, tx = 0, ty = 0;
    let raf = 0, last = 0, t0 = performance.now();
    /* Calidad: si los fotogramas llegan tarde, se baja la resolución (hasta dos veces). */
    let side = MAX_SIDE, slow = 0, counted = 0, drops = 0;

    function resize(){
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      scale = Math.min(1, side / Math.max(w, h));
      canvas.width = Math.max(2, Math.round(w * scale));
      canvas.height = Math.max(2, Math.round(h * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    /* Centro del panel de cristal, en píxeles del lienzo (con el origen abajo). */
    function focus(){
      const box = canvas.getBoundingClientRect();
      const r = focusEl && focusEl.offsetParent ? focusEl.getBoundingClientRect() : null;
      const x = r ? r.left + r.width / 2 : box.width / 2;
      const y = r ? r.top + r.height * 0.56 : box.height * 0.6;
      return [(x - box.left) * scale, (box.height - (y - box.top)) * scale];
    }

    /* El cerezo sale desde la izquierda, en primer término. Devuelve dónde cae su tronco (en
       píxeles del lienzo): cerca del borde, algo más adentro cuanto más hueco deja la tarjeta;
       y su tamaño: entero en horizontal, más pequeño en pantallas estrechas. */
    function treePlace(){
      const box = canvas.getBoundingClientRect();
      const card = focusEl && focusEl.parentElement ? focusEl.parentElement.getBoundingClientRect() : null;
      const left = card ? Math.max(card.left - box.left, 0) : box.width * 0.2;
      const size = Math.min(Math.max(box.width / box.height * 0.8, 0.6), 1);
      return {x: Math.max(left * 0.36, box.height * 0.05) * scale, size};
    }

    function draw(now){
      const still = isStill();
      const target = isDark() ? 1 : 0;
      night += (target - night) * (still ? 1 : 0.06);
      if(Math.abs(target - night) < 0.002) night = target;
      mx += (tx - mx) * 0.06;
      my += (ty - my) * 0.06;
      const f = focus();
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, still ? 12 : (now - t0) / 1000);
      gl.uniform2f(U.uFocus, f[0], f[1]);
      gl.uniform2f(U.uMouse, still ? 0 : mx, still ? 0 : my);
      gl.uniform1f(U.uNight, night);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, treeTex);
      gl.uniform1i(U.uTree, 0);
      gl.uniform1f(U.uTreeOn, treeReady ? 1 : 0);
      const tree = treePlace();
      gl.uniform1f(U.uTreeX, tree.x);
      gl.uniform1f(U.uTreeS, tree.size);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function loop(now){
      raf = 0;
      if(screen.hidden || document.hidden) return;
      if(now - last >= FRAME_MS - 2){
        if(last && drops < 2){
          counted++;
          if(now - last > 70) slow++;
          if(counted >= 24){
            if(slow > 12){ side = Math.round(side * 0.72); drops++; resize(); }
            counted = 0; slow = 0;
          }
        }
        last = now;
        draw(now);
      }
      if(!isStill()) raf = requestAnimationFrame(loop);
    }
    function wake(){
      if(raf || screen.hidden || document.hidden) return;
      resize();
      raf = requestAnimationFrame(loop);
    }

    window.addEventListener('resize', () => { resize(); wake(); });
    document.addEventListener('visibilitychange', wake);
    /* La pantalla de acceso aparece y desaparece con el atributo hidden; el tema, con data-theme. */
    new MutationObserver(wake).observe(screen, {attributes:true, attributeFilter:['hidden']});
    new MutationObserver(wake).observe(root, {attributes:true, attributeFilter:['data-theme', 'data-motion']});
    if(darkQuery.addEventListener) darkQuery.addEventListener('change', wake);
    if(window.matchMedia('(pointer: fine)').matches){
      screen.addEventListener('pointermove', (ev) => {
        tx = 0.5 - ev.clientX / window.innerWidth;
        ty = ev.clientY / window.innerHeight - 0.5;
      });
    }
    canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); cancelAnimationFrame(raf); raf = 0; canvas.classList.remove('is-on'); });
    wake();
    return true;
  }

  Workhub.views.authScene = {start};
})();
