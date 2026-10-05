/* Paisaje en 3D de la pantalla de acceso.
   Una escena pintada en tiempo real con WebGL 2, sin librerías: una colina de hierba mecida
   por el viento, cielo con nubes, un cerezo y, en lo alto, un monitor de tubo antiguo con un
   tablero en la pantalla. Atardecer en tema claro y noche en oscuro. La cámara está fija: lo
   único que se mueve es la hierba, las nubes, los pétalos y las luciérnagas.

   Se pinta en cuatro pasadas:
   1. La escena (FRAG): un sombreador que traza rayos (terreno, ordenador, cielo, el cerezo
      como imagen) y escribe además la profundidad de lo que pinta.
   2. El arbolado lejano (TREES_VERT / TREES_FRAG): unos cientos de árboles pequeños en las
      lomas del fondo, cada uno un rectángulo que mira a la cámara.
   3. La hierba (GRASS_SIM / GRASS_VERT / GRASS_FRAG): geometría de verdad, una cinta por brizna,
      cientos de miles, dibujadas de una vez (instancias). La profundidad de la pasada 1 decide
      qué briznas quedan delante o detrás del ordenador y del tronco. Lo que es igual para toda
      la brizna se calcula antes, una vez por brizna (GRASS_SIM, transform feedback).
   4. Lo que va por delante (OVER): pétalos, pájaros y luciérnagas.
   COMMON son las funciones que comparten (ruido, terreno, ordenador, cielo...).

   El ordenador se coloca siempre en el centro del panel de cristal de la tarjeta de acceso
   (uFocus), sea cual sea el tamaño de la ventana.

   Rendimiento. El cielo y el suelo, que cambian muy despacio, se pintan por turnos en una
   imagen intermedia y en cada fotograma solo se rehace lo que se mueve (FRAG, COMP); de cada
   brizna se guarda lo que no depende del viento (GRASS_BASE). Lo que no cambia de un fotograma a otro (dónde toca cada rayo el suelo y el
   ordenador, y sus sombras) se calcula una vez por tamaño de ventana y se guarda en una imagen
   (GEO, BAKE). La calidad se adapta al equipo: antes de enseñar la escena se mide lo que tarda
   la tarjeta gráfica y se elige un escalón (LEVELS: resolución, cantidad de hierba, fotogramas
   por segundo); si después va justa, se baja otro. Se pinta solo mientras la pantalla de
   acceso está a la vista, y no se prepara nada hasta que se ve por primera vez. Los
   sombreadores se compilan en segundo plano (compilarlos de golpe dejaba el navegador entero
   parado varios segundos). Hasta que acaban se enseña una imagen de la escena hecha de antemano
   (WAIT, POSTER, backdrop), colocada con la misma cuenta y con la pantalla del ordenador pintada
   de verdad; cuando la escena está lista, la imagen se funde sobre ella. Con movimiento
   reducido se pinta un único fotograma. Si el navegador no tiene WebGL 2, queda el degradado
   de cielo que pone auth.css. */
(function(){
  const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
  const VERT = HEAD + 'layout(location = 0) in vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const COMMON = [
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec2 uFocus;',
    'uniform float uNight;',
    'uniform float uTreeX;',
    'uniform float uTreeS;',
    /* La hora, con el tema claro: 0 hora dorada (amanecer o atardecer), 1 pleno día. */
    'uniform float uDay;',
    /* 1 si la hora dorada es la de la mañana: algo más fría y rosada que la de la tarde. */
    'uniform float uDawn;',
    /* El cursor sobre la escena: posición en píxeles del lienzo y fuerza (0 si no está). */
    'uniform vec3 uMouse;',
    /* El formulario, para la pantalla del ordenador: caracteres escritos, cuánto se ve el */
    /* cuadro de acceso, «entrando…» y el resultado (hacia 1, acceso correcto; hacia -1, error). */
    'uniform vec4 uUI;',
    /* Lo que se escribe en el campo, pintado como texto en una imagen (el correo o el nombre; */
    /* la contraseña nunca). uTextW: cuánto ancho de la imagen ocupa, o -1 si toca enseñar puntos. */
    'uniform sampler2D uText;',
    'uniform float uTextW;',
    /* Luciérnagas: posición y brillo de cada una (las mueve el JS). */
    'const int FF_N = 40;',
    'uniform vec4 uFF[40];',
    /* Altura del suelo bajo el ordenador, de donde cuelga la cámara: terrain(vec2(0.)). La */
    /* calcula el JS (baseHeight) una vez por tamaño de ventana, igual para todas las pasadas. */
    'uniform float uBase;',
    /* Cuántas luciérnagas alumbran la hierba: todas, o solo unas pocas en los equipos justos. */
    'uniform int uFFLit;',
    /* Siempre cero. Un bucle que empieza en un valor que el compilador no conoce no se puede */
    /* desenrollar: sin esto, cada llamada a una función grande se copia entera tantas veces */
    /* como se la llama, y compilar la escena tardaba varios segundos con el navegador parado. */
    'uniform int uZero;',
    /* Solo para generar las imágenes de espera (ver poster()): 1, el color sin el revelado */
    /* final; 2, en blanco los píxeles del cristal de la pantalla y en negro los demás. */
    'uniform float uRaw;',

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
    /* Un color según el momento: hora dorada, pleno día o noche. */
    'vec3 pal(vec3 gold, vec3 noon, vec3 night){',
    '  gold = mix(gold, gold * vec3(.94, .93, 1.17), uDawn);',
    '  return mix(mix(gold, noon, uDay), night, uNight);',
    '}',
    'vec3 sunColor(){ return pal(vec3(1.30, .58, .30), vec3(.76, .73, .62), vec3(.30, .36, .62)); }',
    'vec3 ambientColor(){ return pal(vec3(.20, .11, .11), vec3(.15, .19, .25), vec3(.045, .055, .12)); }',
    'vec3 skyLightColor(){ return pal(vec3(.12, .13, .17), vec3(.17, .22, .31), vec3(.05, .07, .16)); }',
    'vec3 mistColor(){ return pal(vec3(1., .60, .36), vec3(.90, .94, 1.), vec3(.20, .23, .42)); }',
    /* La bruma: su color y, hacia el sol, lo que se enciende. */
    'vec3 fogColor(vec3 rd, vec3 L){',
    '  vec3 c = pal(vec3(.66, .30, .20), vec3(.62, .73, .88), vec3(.09, .09, .22));',
    '  return c + pal(vec3(.24, .15, .04), vec3(.10, .09, .05), vec3(.03, .04, .09)) * pow(max(dot(normalize(vec3(rd.x, 0., rd.z)), normalize(vec3(L.x, 0., L.z))), 0.), 3.);',
    '}',
    'float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }',

    /* Dónde está plantado el cerezo (lo fija main antes de nada): el terreno le hace una loma. */
    'vec2 gTree;',
    /* Altura del suelo al pie del cerezo. Es una constante a propósito: si se calculara con */
    /* terrain() en cada píxel, con tarjeta gráfica el resultado baila en el último decimal de un */
    /* fotograma a otro y el árbol entero salta un píxel arriba y abajo. */
    'const float TREE_H = 1.80;',
    /* Terreno: un montículo bajo el ordenador, otro bajo el cerezo, lomas suaves que se van */
    /* solapando hacia el fondo y sierras a lo lejos. */
    'float terrain(vec2 p){',
    '  float r2 = dot(p, p);',
    '  float h = 1.5 * exp(-r2 / 30.);',
    /* Lomas intermedias: crestas anchas, cada una asomando tras la anterior. */
    '  float roll = sin(p.x * .105 + p.y * .060 + 2.4 * noise(p * .045)) * .5 + .5;',
    '  h += smoothstep(4., 30., p.y) * 1.5 * roll * roll;',
    '  h += smoothstep(-2., 14., abs(p.x + 3.) - 6.) * .55 * (sin(p.x * .16 - p.y * .21 + 1.1) * .5 + .5);',
    '  h += .60 * sin(p.x * .23 + 1.3) * cos(p.y * .19 + .4);',
    /* Bultos y hondonadas: lo que da relieve a la luz rasante (lisos bajo el ordenador). */
    '  h += (.75 * fbm3(p * .30 + 4.) + .16 * noise(p * 1.4)) * smoothstep(1.5, 22., r2);',
    '  h += smoothstep(8., 60., p.y) * 4.2 * fbm3(p * .05 + 3.1);',
    '  h -= smoothstep(2., -9., p.y) * 1.1;',
    /* La hondonada del lago, al fondo a la derecha. */
    '  vec2 dl = (p - vec2(9., 27.)) * vec2(.75, 1.);',
    '  h -= 2.6 * exp(-dot(dl, dl) / 110.);',
    /* La loma del cerezo: el terreno sube y se alisa hacia TREE_H al acercarse al árbol. */
    '  vec2 dt = p - gTree;',
    '  float k = exp(-dot(dt, dt) / 14.);',
    '  return mix(h + .55 * k, TREE_H, k * k);',
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
    /* Tamaño del ordenador. Todo él está descrito en sus propias medidas (toLocal divide por */
    /* CS), así que las distancias que devuelve computer() hay que multiplicarlas por CS. */
    'const float CS = 1.22;',
    'vec3 toLocal(vec3 p, float base){ p.y -= base; p.xz = rot(YAW) * p.xz; return p / CS; }',
    'float glassD(vec3 q){',
    '  return max(sdBox(q - vec3(0., 1.16, -.57), vec3(.62, .46, .07)) - .01, length(q - vec3(0., 1.16, 5.37)) - 6.);',
    '}',
    'float computer(vec3 q){',
    /* Como un monitor de tubo de verdad (el dueño mandó fotos de referencia): un marco frontal */
    /* grueso y, detrás, la carcasa, que se estrecha hacia atrás siguiendo al tubo (el techo cae */
    /* más de lo que sube el suelo). Es una caja deformada, no dos cajas pegadas: dos cajas */
    /* dejaban entre ellas un escalón en sombra que parecía una separación. El .66 compensa que */
    /* el estrechamiento deforma las distancias, para que el trazado no se pase de largo. */
    '  float bezel = sdBox(q - vec3(0., 1.06, -.60), vec3(.80, .66, .13)) - .06;',
    '  float taper = mix(1., .60, smoothstep(-.40, .92, q.z));',
    '  float shell = (sdBox(vec3(q.x / taper, (q.y - .78) / taper + .78, q.z - .22) - vec3(0., 1.06, 0.), vec3(.72, .58, .66)) - .12) * .66;',
    '  float body = smin(bezel, shell, .05);',
    /* La junta bajo la pantalla va grabada en la superficie (un surco fino), no cortada. */
    '  body = max(body, -max(max(abs(q.y - .635) - .008, q.z + .70), -body - .012));',
    '  float recess = sdBox(q - vec3(0., 1.16, -.80), vec3(.63, .47, .21)) - .035;',
    '  body = max(body, -recess);',
    '  body = min(body, glassD(q));',
    '  float slot = sdBox(q - vec3(-.06, .47, -.80), vec3(.22, .016, .05)) - .004;',
    '  body = max(body, -slot);',
    /* Dos mandos redondos bajo la pantalla: cilindros cortos, de canto redondeado. */
    '  vec3 k1 = q - vec3(.50, .47, -.815), k2 = q - vec3(.68, .47, -.815);',
    '  float knobs = min(max(length(k1.xy) - .052, abs(k1.z) - .035), max(length(k2.xy) - .052, abs(k2.z) - .035)) - .010;',
    '  body = min(body, knobs);',
    /* El pie, macizo y pegado al ordenador de arriba abajo: un zócalo que entra en la carcasa */
    /* y baja hasta el suelo, y un plato redondo alrededor. Nada de cuello fino entre dos */
    /* piezas: por la rendija que quedaba a los lados se veía el fondo, y parecía un hueco. */
    '  float skirt = sdBox(q - vec3(0., .27, -.16), vec3(.50, .19, .36)) - .05;',
    '  vec2 dw = vec2(length(q.xz - vec2(0., -.14)) - .66, abs(q.y - .045) - .018);',
    '  float dish = min(max(dw.x, dw.y), 0.) + length(max(dw, 0.)) - .035;',
    '  float stand = smin(skirt, dish, .09);',
    /* El cable sale por detrás y se pierde en la hierba. */
    '  float cable = min(sdCapsule(q, vec3(.22, .62, .90), vec3(.30, .30, 1.20), .028), sdCapsule(q, vec3(.30, .30, 1.20), vec3(.70, -.05, 1.75), .028));',
    '  return min(smin(body, stand, .05), cable);',
    '}',
    /* La pendiente de la superficie: seis medidas alrededor del punto, en un bucle que empieza */
    /* en uZero (ver arriba) para que computer() se compile una vez y no seis. */
    'vec3 computerNormal(vec3 q){',
    '  vec3 n = vec3(0.);',
    '  for(int i = uZero; i < 6; i++){',
    '    int axis = i / 2;',
    '    float sg = float(1 - 2 * (i - axis * 2));',
    '    vec3 e = vec3(0.);',
    '    e[axis] = .003 * sg;',
    '    n[axis] += sg * computer(q + e);',
    '  }',
    '  return normalize(n);',
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
    'float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }',
    /* La luz que da la pantalla: cálida; se atenúa con el cuadro de acceso delante, se pone */
    /* verde al entrar y rojiza si el acceso falla. */
    'vec3 screenLight(){',
    '  vec3 c = mix(vec3(1., .91, .70), vec3(.74, .70, .62), uUI.y * .45);',
    '  c = mix(c, vec3(.62, 1.25, .70), max(uUI.w, 0.));',
    '  c = mix(c, vec3(1.10, .42, .34), max(-uUI.w, 0.) * .7);',
    '  return c * (1. + .10 * uUI.z * sin(uTime * 6.));',
    '}',
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
    '  for(int i = uZero; i < 3; i++){',
    '    float fi = float(i);',
    '    float cx = -.62 + fi * .62;',
    '    col = mix(col, vec3(.95, .915, .82), 1. - smoothstep(0., aa, rr(u - vec2(cx, -.14), vec2(.28, .80), .06)));',
    '    vec3 ring = i == 0 ? vec3(.55, .56, .60) : (i == 1 ? vec3(.23, .51, .96) : vec3(.13, .77, .37));',
    '    float dr = i == 2 ? length(u - vec2(cx - .20, .55)) - .05 : abs(length(u - vec2(cx - .20, .55)) - .035) - .014;',
    '    col = mix(col, ring, 1. - smoothstep(0., aa, dr));',
    '    col = mix(col, vec3(.36, .35, .34), 1. - smoothstep(0., aa, rr(u - vec2(cx + .02, .55), vec2(.12, .025), .02)));',
    '    for(int j = uZero; j < 3; j++){',
    /* La tercera fila queda libre: por ahí pasa la tarjeta que viaja. */
    '      if(j == 2) continue;',
    '      float fj = float(j);',
    '      vec3 tag = mix(.5 + .5 * cos(6.283 * (hash(vec2(fi, fj)) + vec3(0., .33, .67))), vec3(.5), .2);',
    '      col = card(col, u, vec2(cx, .30 - fj * .31), tag, aa);',
    '    }',
    '  }',
    /* Una tarea recorre el tablero: aparece en la primera columna, pasa a la segunda y acaba */
    /* en la tercera, ya en verde; se desvanece y vuelve a empezar. */
    '  float ph = mod(uTime, 15.);',
    '  float k1 = smoothstep(2.4, 3.3, ph), k2 = smoothstep(6.8, 7.7, ph);',
    '  float vis = smoothstep(0., .5, ph) * (1. - smoothstep(13.3, 14., ph));',
    '  vec2 c = vec2(-.62 + .62 * (k1 + k2), -.32) + vec2(0., .13 * (sin(k1 * 3.1416) + sin(k2 * 3.1416)));',
    '  col = mix(col, card(col, u, c, mix(vec3(.96, .55, .20), vec3(.13, .77, .37), k2), aa), vis);',
    /* El cursor la lleva mientras se mueve y, entre tanto, se queda cerca, sin estarse quieto. */
    '  float carry = clamp(4. * (k1 * (1. - k1) + k2 * (1. - k2)), 0., 1.);',
    '  vec2 m = c + vec2(.10, -.10) + (1. - carry) * vec2(.11 + .05 * sin(uTime * .7), -.10 + .04 * cos(uTime * .9));',
    '  float cur = max(sdBox2(rot(.6) * (u - m), vec2(.035, .06)), -(u.y - m.y - .05));',
    '  col = mix(col, vec3(.08), (1. - smoothstep(0., aa, cur)) * (1. - uUI.y));',

    /* El cuadro de acceso: aparece sobre el tablero mientras se escribe en el formulario. El */
    /* correo se ve con sus letras; la contraseña, un punto por carácter (de ella solo llega */
    /* cuántos hay). Debajo, el botón, con una barra que va y viene mientras se espera. */
    '  float show = uUI.y;',
    '  vec2 e = vec2(1., .733);',
    '  if(show > .002){',
    '    float bad = max(-uUI.w, 0.);',
    '    col = mix(col, col * .50 + vec3(.11, .10, .09), show * .85);',
    '    vec2 dc = u - vec2(.045 * sin(uTime * 40.) * bad, -.02 - .10 * (1. - show));',
    '    float dd = rr(dc, vec2(.88, .62), .10);',
    '    col = mix(col, vec3(.16, .14, .13), (1. - smoothstep(0., .10, dd)) * .40 * show);',
    '    vec3 dlg = vec3(.99, .975, .94);',
    '    dlg = mix(dlg, vec3(.20, .20, .23), 1. - smoothstep(0., aa, rr(dc - vec2(-.44, .42), vec2(.30, .045), .04)));',
    '    float fd = rr(dc - vec2(0., .08), vec2(.78, .19), .08);',
    '    dlg = mix(dlg, mix(vec3(.90, .88, .83), vec3(.98, .72, .68), bad), 1. - smoothstep(0., aa, fd));',
    '    float dots = 1e3;',
    '    for(int i = uZero; i < 9; i++){',
    '      float fi = float(i);',
    '      float on = clamp(uUI.x - fi, 0., 1.);',
    '      dots = min(dots, length((dc - vec2(-.60 + fi * .15, .08)) * e) - .050 * on + (1. - on));',
    '    }',
    '    float typed = step(0., uTextW);',
    '    dlg = mix(dlg, vec3(.16, .16, .19), (1. - smoothstep(0., aa, dots)) * (1. - typed));',
    /* Las letras: la imagen ocupa el interior del campo. */
    '    vec2 tu = (dc - vec2(-.70, -.05)) / vec2(1.40, .26);',
    '    float ink = textureLod(uText, clamp(tu, 0., 1.), 0.).a * step(0., tu.x) * step(tu.x, 1.) * step(0., tu.y) * step(tu.y, 1.);',
    '    dlg = mix(dlg, vec3(.13, .13, .16), ink * typed);',
    '    float cx = mix(-.675 + min(uUI.x, 9.) * .15, -.685 + uTextW * 1.40, typed);',
    '    float caret = rr(dc - vec2(cx, .08), vec2(.014, .115), .006);',
    '    dlg = mix(dlg, vec3(.16, .16, .19), (1. - smoothstep(0., aa, caret)) * step(.5, fract(uTime * 1.1)) * (1. - uUI.z));',
    '    float bd = rr(dc - vec2(0., -.34), vec2(.78, .12), .08);',
    '    vec3 btn = vec3(.11, .11, .13);',
    '    float sweep = abs(dc.x - .62 * sin(uTime * 2.6));',
    '    btn = mix(btn, vec3(.62, .66, .78), uUI.z * (1. - smoothstep(.02, .26, sweep)));',
    '    btn = mix(btn, vec3(.80, .80, .84), (1. - uUI.z) * (1. - smoothstep(0., aa, rr(dc - vec2(0., -.34), vec2(.24, .028), .025))));',
    '    dlg = mix(dlg, btn, 1. - smoothstep(0., aa, bd));',
    '    col = mix(col, dlg, (1. - smoothstep(0., aa, dd)) * show);',
    '  }',
    /* Acceso correcto: la pantalla se aclara y sale la marca de «hecho». */
    '  float ok = max(uUI.w, 0.);',
    '  if(ok > .002){',
    '    col = mix(col, vec3(.92, .99, .93), ok * .92);',
    '    vec2 v = u * e;',
    '    float pop = min(ok * 1.5, 1.);',
    '    pop = 1. - (1. - pop) * (1. - pop);',
    '    col = mix(col, vec3(.13, .70, .36), (1. - smoothstep(0., aa, length(v) - .36 * pop)) * ok);',
    '    float tick = min(sdSeg(v, vec2(-.16, -.01), vec2(-.05, -.12)), sdSeg(v, vec2(-.05, -.12), vec2(.17, .12)));',
    '    col = mix(col, vec3(1.), (1. - smoothstep(.034, .034 + aa, tick)) * smoothstep(.45, .85, ok));',
    '  }',
    '  return col;',
    '}',

    /* ---------- Cielo ---------- */
    /* De dónde viene la luz: del sol (o de la luna), bajo, al fondo y algo a la derecha. No se */
    /* ve: queda tras las sierras y solo asoma su resplandor. */
    /* A pleno día el sol está alto, pero sigue al fondo: la hierba se ve siempre a contraluz. */
    'vec3 sunDir(){ return normalize(mix(mix(vec3(.21, .108, .97), vec3(.26, .50, .83), uDay), vec3(.17, .235, .955), uNight)); }',
    /* Nivel del agua del lago. */
    'const float WATER_Y = .62;',
    /* El cielo sin nubes ni estrellas: el degradado y el resplandor del sol. Es barato: lo usan */
    /* la bruma, los reflejos y la hierba. */
    'vec3 skyBase(vec3 rd, vec3 L){',
    '  float y = max(rd.y, 0.);',
    /* Cuánto se mira hacia el sol, en horizontal: de ese lado el cielo arde; del otro, se enfría. */
    '  float sunny = max(dot(normalize(vec3(rd.x, 0., rd.z) + 1e-5), normalize(vec3(L.x, 0., L.z))), 0.);',
    '  sunny *= sunny;',
    '  vec3 day = mix(vec3(.84, .40, .34), vec3(1., .70, .30), sunny);',
    '  day = mix(day, mix(vec3(.72, .27, .32), vec3(.98, .42, .24), sunny), smoothstep(0., .15, y));',
    '  day = mix(day, mix(vec3(.42, .22, .42), vec3(.62, .26, .36), sunny), smoothstep(.10, .38, y));',
    '  day = mix(day, vec3(.15, .18, .40), smoothstep(.28, .85, y));',
    '  vec3 night = mix(mix(vec3(.16, .15, .34), vec3(.24, .24, .46), sunny), vec3(.06, .07, .21), smoothstep(0., .3, y));',
    '  night = mix(night, vec3(.012, .016, .06), smoothstep(.25, .9, y));',
    /* Pleno día: azul hondo arriba y claro, casi blanco, en el horizonte del lado del sol. */
    '  vec3 noon = mix(vec3(.60, .76, .94), vec3(.86, .90, .95), sunny);',
    '  noon = mix(noon, vec3(.30, .52, .88), smoothstep(0., .34, y));',
    '  noon = mix(noon, vec3(.11, .27, .66), smoothstep(.28, .9, y));',
    '  vec3 col = pal(day, noon, night);',
    /* El resplandor del sol: ancho y pegado al horizonte, sin disco. */
    '  float s = max(dot(rd, normalize(vec3(L.x, .02, L.z))), 0.);',
    '  vec3 glow = pal(vec3(1., .60, .24), vec3(1., .97, .88), vec3(.42, .50, .90));',
    '  col += glow * (pow(s, 5.) * .26 + pow(s, 24.) * .34 * exp(-y * 5.)) * mix(mix(1., .50, uDay), .34, uNight);',
    '  return col;',
    '}',
    /* El cielo entero: estrellas, vía láctea, alguna estrella fugaz y dos capas de nubes. */
    'vec3 sky(vec3 rd, vec3 L){',
    '  vec3 col = skyBase(rd, L);',
    '  float s = max(dot(rd, normalize(vec3(L.x, .02, L.z))), 0.);',
    /* Estrellas: muchas pequeñas, unas pocas grandes, y la vía láctea cruzando. */
    '  float starry = smoothstep(.45, 1., uNight) * smoothstep(.02, .25, rd.y);',
    '  vec2 sp = rd.xy / (1. + abs(rd.z)) * 420.;',
    '  vec2 si = floor(sp);',
    '  float st = step(.986, hash(si)) * smoothstep(.42, .05, length(fract(sp) - .5));',
    '  st *= .42 + .58 * (.5 + .5 * sin(uTime * (1.4 + 2.6 * hash(si + 3.)) + hash(si + 7.) * 40.));',
    '  vec2 sp2 = rd.xy / (1. + abs(rd.z)) * 90.;',
    '  vec2 si2 = floor(sp2);',
    '  float big = step(.972, hash(si2 + 31.)) * smoothstep(.16, .0, length(fract(sp2) - .5 - (hash2(si2) - .5) * .5));',
    '  big *= .58 + .42 * sin(uTime * (.9 + 1.5 * hash(si2 + 5.)) + hash(si2 + 3.) * 30.) * sin(uTime * .37 + hash(si2) * 9.);',
    '  float band = exp(-pow(dot(rd, normalize(vec3(.62, .42, -.66))) * 3.2, 2.));',
    '  float dust = fbm(rd.xy * 5. + 11.);',
    '  vec3 stars = vec3(.9, .92, 1.) * st + mix(vec3(1., .88, .74), vec3(.78, .86, 1.), hash(si2)) * big * 1.4;',
    '  stars += vec3(.30, .30, .50) * band * (.25 + .75 * dust) * .50;',
    '  stars += vec3(.9, .92, 1.) * step(.955, hash(si + 91.)) * smoothstep(.40, .05, length(fract(sp) - .5)) * band * dust * 1.2;',
    /* De vez en cuando, una estrella fugaz. */
    '  float cyc = uTime * .11;',
    '  float sid = floor(cyc), sf = fract(cyc);',
    '  vec2 sh2 = hash2(vec2(sid, 4.7));',
    '  vec2 sq = rd.xy / (1. + abs(rd.z));',
    '  vec2 sdir = normalize(vec2(-.8 - .4 * sh2.y, -.34));',
    '  vec2 head = vec2(mix(-.25, .55, sh2.x), mix(.24, .44, sh2.y)) + sdir * sf * 1.5;',
    '  vec2 rel = sq - head;',
    '  float along = dot(rel, -sdir);',
    '  float perp = length(rel + sdir * along);',
    '  float streak = exp(-perp * perp * 120000.) * smoothstep(.10, 0., along) * step(0., along);',
    '  stars += vec3(.92, .96, 1.) * streak * smoothstep(0., .03, sf) * (1. - smoothstep(.10, .20, sf)) * step(.45, hash(vec2(sid, 1.3))) * 1.6;',
    /* Nubes altas: jirones finos y alargados, encendidos por debajo. */
    '  float sunny = pow(max(dot(normalize(vec3(rd.x, 0., rd.z) + 1e-5), normalize(vec3(L.x, 0., L.z))), 0.), 2.);',
    '  vec2 c1 = rd.xz / (rd.y + .10);',
    '  float hi = fbm(vec2(c1.x * .34 + uTime * .013, c1.y * 1.25 + 4. + uTime * .003));',
    '  float cirrus = smoothstep(.50, .78, hi) * smoothstep(.03, .22, rd.y) * .62;',
    '  vec3 hiCol = pal(mix(vec3(.66, .28, .36), vec3(1., .68, .40), sunny * .7 + hi * .3), mix(vec3(.80, .86, .95), vec3(1.), hi), mix(vec3(.07, .08, .18), vec3(.20, .23, .42), hi));',
    /* Nubes bajas: bancos con volumen; el borde que mira al sol se enciende. */
    '  vec2 c2 = rd.xz / (rd.y + .16) * 1.3 + vec2(uTime * .032, 0.);',
    /* Los bancos no solo pasan: se deshacen y se rehacen despacio. */
    '  c2 += .30 * (vec2(noise(c2 * .55 + vec2(0., uTime * .021)), noise(c2 * .55 + vec2(5.2, -uTime * .017))) - .5);',
    '  float dn = fbm(c2);',
    '  float cl = smoothstep(.44, .74, dn) * smoothstep(0., .11, rd.y);',
    '  float edge = clamp((dn - fbm(c2 + normalize(L.xz) * .32)) * 3. + .45, 0., 1.);',
    '  vec3 loCol = pal(mix(vec3(.25, .12, .22), vec3(1.05, .60, .34), edge), mix(vec3(.56, .63, .78), vec3(1.02, 1.01, .98), edge), mix(vec3(.04, .05, .12), vec3(.22, .25, .45), edge));',
    /* Cerca del sol, el filo de la nube se pone de oro. */
    '  loCol += vec3(1., .72, .36) * pow(s, 10.) * (1. - smoothstep(.55, .9, dn)) * .9 * (1. - uNight) * (1. - .8 * uDay);',
    '  float cover = max(cirrus, cl);',
    '  col += stars * starry * (1. - cover);',
    '  col = mix(col, hiCol, cirrus);',
    '  col = mix(col, loCol, cl * .9);',
    '  return col;',
    '}',

    /* ---------- Hierba ---------- */
    /* La hierba es geometría: una cinta por brizna (grass.vert). Aquí solo va hasta dónde llega: */
    /* entre GRASS_F0 y GRASS_F1 unidades de la cámara las briznas se encogen y el suelo pasa a */
    /* pintarse como textura. */
    'const float GRASS_F0 = 19.;',
    'const float GRASS_F1 = 27.;',

    /* El cerezo: a qué distancia va y cuánto mide (unidades de escena por unidad del modelo). */
    'const float TREE_Z = -2.2;',
    'const float TREE_SC = .80;',

    /* Coloca el cerezo: su tronco cae siempre en el mismo punto de la pantalla (uTreeX), cerca */
    /* del borde izquierdo. Hay que llamarla antes que a terrain(), que le hace una loma. */
    'void setupTree(){',
    '  vec3 fw0 = normalize(vec3(-2.2, .40, 11.5)), rt0 = normalize(cross(vec3(0., 1., 0.), fw0));',
    '  vec3 rdT = normalize(fw0 * 1.5 + (uTreeX - uFocus.x) / uRes.y * rt0);',
    '  gTree = vec2(2.2 + rdT.x * (TREE_Z + 11.5) / rdT.z, TREE_Z);',
    '}',
    /* Profundidad (0..1) a partir de la distancia a lo largo del eje de la cámara: la misma */
    /* cuenta en la escena (que la escribe a mano) y en la hierba (que la saca de su proyección). */
    'const float Z_NEAR = .3;',
    'const float Z_FAR = 400.;',
    'float depth01(float zv){ return clamp(Z_FAR * (zv - Z_NEAR) / ((Z_FAR - Z_NEAR) * max(zv, 1e-3)), 0., 1.); }',
    /* Revelado final, igual para todo lo que se pinta: viñeta, recorte, contraste y grano. */
    'vec3 post(vec3 col, vec2 fc){',
    '  if(uRaw > .5) return clamp(col, 0., 1.);',
    '  vec2 vq = fc / uRes - .5;',
    '  col *= 1. - .34 * dot(vq, vq) * 2.2;',
    '  col = clamp(col, 0., 1.);',
    '  col = mix(col, col * col * (3. - 2. * col), .35);',
    '  col += (hash(fc + fract(uTime) * 91.7) - .5) * .045;',
    '  return clamp(col, 0., 1.);',
    '}'
  ].join('\n');
  const GEO = [
    /* ---------- Lo que no cambia de un fotograma a otro ---------- */
    /* La cámara está fija y ni el terreno ni el ordenador se mueven: dónde toca cada rayo, la */
    /* pendiente del suelo en ese punto y la sombra que le cae son siempre las mismas. Es, con */
    /* mucho, lo más caro de la escena, así que se calcula una vez por tamaño de ventana (BAKE) */
    /* y la escena lo lee de una imagen (CACHE). Sin CACHE se calcula en cada fotograma. */
    'float hitTerrain(vec3 ro, vec3 rd){',
    '  float t = .4, tHit = -1.;',
    '  if(rd.y < .2){',
    '    for(int i = 0; i < 130; i++){',
    '      vec3 p = ro + rd * t;',
    '      float d = p.y - terrain(p.xz);',
    '      if(d < .0015 * t){ tHit = t; break; }',
    '      t += max(.02 + t * .005, d * .48);',
    '      if(t > 170.) break;',
    '    }',
    '  }',
    /* Por debajo del horizonte siempre hay suelo. */
    '  if(tHit < 0. && rd.y < .012) tHit = 170.;',
    '  return tHit;',
    '}',
    /* El ordenador (solo si el rayo pasa cerca). */
    'float hitComputer(vec3 ro, vec3 rd, float base){',
    '  float tObj = -1.;',
    '  float t0 = sph(ro, rd, vec3(0., base + 1.02 * CS, 0.), 1.95 * CS);',
    '  if(t0 >= 0.){',
    '    float tt = t0;',
    /* Si los pasos se acaban rozando una superficie (rincones estrechos, cantos vistos de */
    /* refilón), cuenta como tocada: si no, por ahí se vería el fondo. */
    '    for(int i = 0; i < 96; i++){',
    '      float d = computer(toLocal(ro + rd * tt, base));',
    '      if(d < .0015 || (i == 95 && d < .03)){ tObj = tt; break; }',
    '      tt += d * CS;',
    '      if(tt > t0 + 5. * CS) break;',
    '    }',
    '  }',
    '  return tObj;',
    '}',
    'vec2 groundGrad(vec2 p){',
    '  float e = .06;',
    '  float g0 = terrain(p);',
    '  return vec2(terrain(p + vec2(e, 0.)) - g0, terrain(p + vec2(0., e)) - g0) / e;',
    '}',
    /* Las sombras que no se mueven: la del ordenador y la del propio terreno. */
    'float groundShadow(vec3 p, float base, vec3 L){',
    '  float sh = 1.;',
    '  vec3 ql = toLocal(p, base);',
    '  vec3 Ll = L; Ll.xz = rot(YAW) * Ll.xz;',
    '  if(dot(ql.xz, ql.xz) < 30.) sh = computerShadow(ql, Ll);',
    '  return sh * terrainShadow(vec3(p.x, terrain(p.xz) + .08, p.z), L);',
    '}'
  ].join('\n');
  const BAKE = [
    /* ---------- La imagen de lo que no cambia ---------- */
    /* uMode 0: por cada píxel, a qué distancia toca el rayo el suelo y el ordenador y la */
    /* pendiente del suelo. uMode 1: la sombra en ese punto, que depende de dónde esté el sol */
    /* (solo cambia con el tema) y si es el cristal de la pantalla del ordenador; lee lo anterior */
    /* de uGeo. */
    'uniform sampler2D uGeo;',
    'uniform float uMode;',
    'out vec4 fragColor;',

    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    '  setupTree();',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);',
    '  if(uMode < .5){',
    '    float tHit = hitTerrain(ro, rd);',
    '    vec2 grad = tHit > 0. ? groundGrad((ro + rd * tHit).xz) : vec2(0.);',
    '    fragColor = vec4(tHit, hitComputer(ro, rd, base), grad);',
    '  }else{',
    '    float tHit = texelFetch(uGeo, ivec2(gl_FragCoord.xy), 0).x;',
    '    vec4 geo = texelFetch(uGeo, ivec2(gl_FragCoord.xy), 0);',
    '    float glass = 0.;',
    '    if(geo.y > 0. && (geo.x < 0. || geo.y < geo.x)){',
    '      vec3 q = toLocal(ro + rd * geo.y, base);',
    '      glass = float(abs(glassD(q)) < .006 && q.z < -.5);',
    '    }',
    '    fragColor = vec4(tHit > 0. ? groundShadow(ro + rd * tHit, base, sunDir()) : 1., glass, 0., 1.);',
    '  }',
    '}'
  ].join('\n');
  const TREE_FN = [
    'uniform sampler2D uTree;',
    'uniform float uTreeOn;',
    /* Enfoque del cerezo (1) o no (0): a poca resolución no se nota y son ocho lecturas más. */
    'uniform float uSharp;',
    /* El cerezo en un punto de su imagen: la madera, quieta, y encima las flores, desplazadas */
    /* por el viento. textureLod: sin niveles de detalle, se puede leer desde cualquier sitio. */
    'vec4 treeAt(vec2 tuv, vec2 dsp){',
    '  vec2 fuv = tuv - dsp;',
    '  vec4 wood = textureLod(uTree, vec2(clamp(tuv.x, .002, .998) * .5, clamp(tuv.y, 0., 1.)), 0.);',
    '  vec4 bloom = textureLod(uTree, vec2(clamp(fuv.x, .002, .998) * .5 + .5, clamp(fuv.y, 0., 1.)), 0.);',
    '  bloom *= step(0., fuv.x) * step(fuv.x, 1.) * step(0., fuv.y) * step(fuv.y, 1.);',
    '  return wood * (1. - bloom.a) + bloom;',
    '}',
  ].join('\n');
  /* El final de cada píxel, igual vaya todo junto (FRAG, PART 0) o por partes (COMP): el cerezo
     por delante, el halo de la pantalla, el revelado y la profundidad. */
  /* El cerezo, por delante de lo ya pintado. Lo usa también la imagen de espera (WAIT). */
  const TREE_PART = [
    '  float zTree = -1.;',
    /* ---------- El cerezo ---------- */
    /* Es un modelo 3D renderizado aparte a una imagen con transparencia (assets/img/sakura.webp), */
    /* puesta sobre un plano fijo, de cara a la cámara. El tronco y las ramas no se mueven; las */
    /* flores, sí. */
    '  if(uTreeOn > .002){',
    '    vec3 pn = normalize(vec3(-2.2, 0., 11.5));',
    '    vec3 pr = vec3(pn.z, 0., -pn.x);',
    '    float tp = dot(treeB - ro, pn) / dot(rd, pn);',
    '    vec3 hp = ro + rd * tp - treeB;',
    /* En unidades del modelo (la imagen abarca 9,2 de lado, con el suelo a 0,9 del borde de abajo). */
    '    vec2 u = vec2(dot(hp, pr), hp.y) / treeSc;',
    '    vec2 tuv = vec2(u.x / 9.2 + .5, (u.y + .9) / 9.2);',
    /* Fuera de la imagen (casi toda la pantalla) no hay árbol: ni se mira el viento. */
    '    if(tp > 0. && tuv.x > 0. && tuv.x < 1. && tuv.y > 0. && tuv.y < 1.){',
    /* La imagen trae dos capas, una al lado de la otra: la madera (tronco y ramas), que no se */
    /* mueve, y las flores, que el viento desplaza un poco: un vaivén lento por zonas de la */
    /* copa y un temblor fino, más fuertes cuando pasa una racha (la misma que tumba la */
    /* hierba) y cuanto más arriba. El desplazamiento es suave, así que nada se rasga. */
    '    vec2 wdir = normalize(vec2(1., .45));',
    '    float gust = noise(gTree * .16 - wdir * uTime * .50);',
    '    gust = gust * gust * (3. - 2. * gust);',
    '    float ph = noise(u * .42 + 3.) * 6.283;',
    '    vec2 dsp = vec2(1., .18) * (sin(uTime * 1.05 + ph) * .6 + sin(uTime * .61 + ph * 1.7) * .4) * (.030 + .085 * gust);',
    '    dsp += (vec2(noise(u * 2.1 + vec2(uTime * .85, 0.)), noise(u * 2.1 + vec2(7., uTime * .75))) - .5) * (.035 + .060 * gust);',
    '    dsp *= smoothstep(.6, 5.5, u.y);',
    '    vec2 dq = dsp / 9.2;',
    '    vec4 tr = treeAt(tuv, dq);',
    /* La imagen es de 1024 px por capa y se ve más o menos a su tamaño: queda blanda. Se le */
    /* devuelve el filo comparándola con sus vecinos (máscara de enfoque). */
    '    vec2 px = vec2(1.15 / 1024.);',
    '    if(uSharp > .5 && tuv.x > 0. && tuv.x < 1. && tuv.y > 0. && tuv.y < 1.){',
    '      vec4 soft = (treeAt(tuv + vec2(px.x, 0.), dq) + treeAt(tuv - vec2(px.x, 0.), dq) + treeAt(tuv + vec2(0., px.y), dq) + treeAt(tuv - vec2(0., px.y), dq)) * .25;',
    '      tr = clamp(tr + (tr - soft) * .9, 0., 1.);',
    '      tr.rgb = min(tr.rgb, vec3(tr.a));',
    '    }',
    /* Mientras llega la imagen, el árbol entra poco a poco. */
    '    tr *= uTreeOn;',
    '    if(tp > 0. && !(tGround > 0. && tGround < tp)){',
    '      if(tuv.x > 0. && tuv.x < 1. && tuv.y > 0. && tuv.y < 1.){',
    /* Luz del momento: cálida al atardecer, fría y apagada de noche; algo más honda abajo. */
    '        vec3 tint = pal(vec3(1.12, .90, .86), vec3(1.05, 1.0, 1.02), vec3(.50, .47, .74)) * mix(.86, 1.06, smoothstep(.5, 6.5, u.y));',
    '        vec3 tc = tr.rgb * tint;',
    /* A contraluz las flores se encienden un poco. */
    '        tc += tr.rgb * vec3(1., .55, .45) * pow(max(dot(rd, L), 0.), 3.) * .18 * (1. - uNight) * (1. - .7 * uDay);',
    /* La pantalla del ordenador no llega hasta aquí, pero la bruma sí. */
    '        float tf = (1. - exp(-tp * mix(.017, .024, uNight))) * .7;',
    '        tc = mix(tc, mix(fogCol, skyBase(normalize(vec3(rd.x, .03, rd.z)), L), .28) * tr.a, tf);',
    '        col = col * (1. - tr.a) + tc;',
    '        if(tr.a > .2) zTree = tp;',
    '      }',
    '    }',
    '    }',
    '  }',
  ];
  const TAIL = TREE_PART.concat([
    /* Halo de la pantalla en el aire. */
    '  vec3 oc = ro - sc;',
    '  float bq = dot(oc, rd);',
    '  float dq = length(oc + rd * max(-bq, 0.));',
    '  col += screenGlow * .06 * exp(-dq * dq * 1.5) * mix(.5, 1.5, uNight) * step(0., -bq);',
    '  fragColor = vec4(post(col, gl_FragCoord.xy), 1.);',
    '  if(uRaw > 1.5) fragColor = vec4(vec3(glass), 1.);',
    /* Profundidad de lo pintado, para que la hierba quede delante o detrás de cada cosa. */
    '  float zr = tFin > 0. ? tFin : 1e4;',
    '  if(zTree > 0.) zr = min(zr, zTree);',
    '  gl_FragDepth = depth01(zr * dot(rd, fw));'
  ]);
  const COMP = [
    /* ---------- La escena: lo que se pone en cada fotograma ---------- */
    /* Lee la imagen intermedia que pintan las partes (ver FRAG) y le pone el final: el cerezo, */
    /* el halo, el revelado y la profundidad (del lago, uScene trae cuánto hay en el píxel). */
    'uniform sampler2D uGeo;',
    'uniform sampler2D uShade;',
    'uniform sampler2D uScene;',
    'out vec4 fragColor;',

    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    '  setupTree();',
    '  float treeSc = TREE_SC * uTreeS;',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);',
    '  vec3 L = sunDir();',
    '  vec3 screenGlow = screenLight();',
    '  vec3 sc = vec3(0., 1.16, -.66) * CS; sc.xz = rot(-YAW) * sc.xz; sc.y += base;',
    '  ivec2 at = ivec2(gl_FragCoord.xy);',
    '  vec4 geo = texelFetch(uGeo, at, 0);',
    '  float tHit = geo.x, tObj = geo.y;',
    '  vec4 px = texelFetch(uScene, at, 0);',
    '  vec3 col = px.rgb;',
    '  float glass = texelFetch(uShade, at, 0).y;',
    '  float tGround = tHit > 0. ? tHit : -1.;',
    '  float tFin = tGround > 0. ? mix(tGround, (WATER_Y - ro.y) / min(rd.y, -1e-4), px.a) : -1.;',
    '  if(tObj > 0. && (tGround < 0. || tObj < tGround)) tFin = tObj;',
    '  vec3 treeB = vec3(gTree.x, TREE_H + .22 * treeSc, gTree.y);',
    '  vec3 fogCol = fogColor(rd, L);'
  ].concat(TAIL, ['}']).join('\n');
  const FRAG = [
    /* La escena va por partes, una por cada cosa que puede haber en un píxel: el cielo con sus */
    /* sierras (PART 1), el suelo con el lago (PART 2), la carcasa del ordenador (PART 3) y su */
    /* pantalla (GLASS). Cada una descarta los píxeles que no son suyos, así que entre todas */
    /* pintan la pantalla entera sin pisarse. No pintan en el lienzo, sino en una imagen */
    /* intermedia (uScene), sin el cerezo ni el revelado final: eso lo pone COMP encima, en cada */
    /* fotograma. Dos razones. Compilación: un solo programa con todo tardaba muchos segundos, y */
    /* así se compilan a la vez. Y ritmo: cielo y suelo cambian muy despacio, así que se */
    /* repintan por turnos, uno en cada fotograma, y lo que se mueve de verdad (la hierba, el */
    /* cerezo, la pantalla) va a su ritmo. Hace falta saber de antemano qué hay en cada píxel */
    /* (CACHE); sin eso va todo en un programa y directo al lienzo (PART 0). */
    '#ifdef CACHE',
    'uniform sampler2D uGeo;',
    'uniform sampler2D uShade;',
    '#endif',
    'out vec4 fragColor;',

    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    '  setupTree();',
    '  float treeSc = TREE_SC * uTreeS;',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);',
    '  vec3 L = sunDir();',
    '  vec3 Ll = L; Ll.xz = rot(YAW) * Ll.xz;',
    '  vec3 sunCol = sunColor();',
    '  vec3 ambient = ambientColor();',
    '  vec3 skyLight = skyLightColor();',
    '  vec3 screenGlow = screenLight();',
    /* La pantalla, vista desde el mundo: dónde está y hacia dónde mira. */
    '  vec3 sn = vec3(0., 0., -1.); sn.xz = rot(-YAW) * sn.xz;',
    '  vec3 sc = vec3(0., 1.16, -.66) * CS; sc.xz = rot(-YAW) * sc.xz; sc.y += base;',

    /* Dónde toca el rayo el suelo y el ordenador (ver GEO). La hierba se pinta después, */
    /* encima, como geometría. */
    '#ifdef CACHE',
    '  vec4 geo = texelFetch(uGeo, ivec2(gl_FragCoord.xy), 0);',
    '  float tHit = geo.x, tObj = geo.y;',
    '#else',
    '  float tHit = hitTerrain(ro, rd);',
    '  float tObj = hitComputer(ro, rd, base);',
    '#endif',
    '#if PART != 0',
    '  bool isComputer = tObj > 0. && (tHit < 0. || tObj < tHit);',
    '#endif',
    '#if PART == 1',
    '  if(isComputer || tHit > 0.) discard;',
    '#elif PART == 2',
    '  if(isComputer || tHit < 0.) discard;',
    '#elif PART == 3',
    '  if(!isComputer || texelFetch(uShade, ivec2(gl_FragCoord.xy), 0).y > .5) discard;',
    '#endif',

    /* El cerezo, plantado: las raíces quedan a medias entre la hierba. */
    '  vec3 treeB = vec3(gTree.x, TREE_H + .22 * treeSc, gTree.y);',

    '  vec3 fogCol = fogColor(rd, L);',
    '#if PART == 0 || PART == 1',
    '  vec3 col = sky(rd, L);',
    /* Sierras lejanas: tres cordilleras, una tras otra. Cuanto más lejos, más pálidas; al pie */
    /* de cada una se posa la bruma y el filo que mira al sol se enciende. */
    '  if(tHit < 0.){',
    '    float az = atan(rd.x, rd.z);',
    '    vec3 hz = skyBase(normalize(vec3(rd.x, .02, rd.z)), L);',
    '    float toSun = pow(max(dot(normalize(vec3(rd.x, 0., rd.z)), normalize(vec3(L.x, 0., L.z))), 0.), 6.);',
    '    vec3 rimCol = pal(vec3(1.25, .80, .40), vec3(.50, .52, .50), vec3(.40, .46, .80));',
    '    for(int i = 0; i < 3; i++){',
    '      float fi = float(i);',
    '      float fr = 3.6 + fi * 3.4;',
    /* El perfil: una forma ancha y, encima, crestas (ruido «con cresta», 1 - |2n - 1|). */
    '      float n1 = fbm3(vec2(az * fr + fi * 17., fi * 3.1));',
    '      float n2 = 1. - abs(2. * noise(vec2(az * fr * 3.1 + fi * 5., 9. + fi)) - 1.);',
    '      float n3 = 1. - abs(2. * noise(vec2(az * fr * 7.3, 2. + fi * 7.)) - 1.);',
    '      float mh = (.050 - fi * .016) + (.120 - fi * .030) * (n1 * .66 + n2 * .22 + n3 * .12) - .030;',
    '      float inside = 1. - smoothstep(mh - .0025, mh + .0025, rd.y);',
    '      float deep = (.34 + fi * .20);',
    '      vec3 mc = mix(hz, pal(vec3(.36, .15, .22), vec3(.20, .31, .47), vec3(.05, .055, .16)), deep);',
    /* Bruma al pie y filo de luz arriba. */
    /* Pliegues de la ladera y, en la cordillera del fondo, la última luz en las cumbres. */
    '      float fold = noise(vec2(az * fr * 5. + rd.y * 46., rd.y * 30. + fi * 9.));',
    '      mc *= .86 + .28 * fold;',
    '      mc = mix(mc, pal(vec3(.96, .50, .40), vec3(.84, .88, .93), vec3(.20, .22, .40)), smoothstep(mh - .034, mh, rd.y) * (.42 + .3 * fold) * (1. - min(fi, 1.)) * mix(1., .35, uNight));',
    /* La bruma del pie no está quieta: bancos que se deslizan entre una sierra y la siguiente. */
    '      float drift = fbm3(vec2(az * (5. + fi * 2.) + uTime * (.020 + .012 * fi), fi * 4.7 + uTime * .006));',
    '      mc = mix(mc, hz, clamp(smoothstep(mh, mh - .07, rd.y) * (.30 + .62 * drift), 0., .9));',
    '      mc += rimCol * toSun * smoothstep(mh - .006, mh, rd.y) * (.24 - fi * .05) * mix(1., .22, uNight);',
    '      col = mix(col, mc, inside);',
    '    }',
    '  }',
    '#else',
    '  vec3 col = vec3(0.);',
    '#endif',
    '  vec3 ffCol = vec3(.80, 1., .34);',
    '  float tFin = -1.;',
    '  float glass = 0.;',
    /* Cuánto lago hay en el píxel (0 si no hay). */
    '  float wet = 0.;',

    /* ---------- Hierba y suelo ---------- */
    '  vec3 gcol = vec3(0.);',
    '  float tGround = tHit > 0. ? tHit : -1.;',
    '#if PART == 0 || PART == 2',
    '  if(tHit > 0.){',
    '    vec3 p0 = ro + rd * tHit;',
    '#ifdef CACHE',
    '    vec2 grad = geo.zw;',
    '#else',
    '    vec2 grad = groundGrad(p0.xz);',
    '#endif',
    '    vec3 n = normalize(vec3(-grad.x, 1., -grad.y));',
    /* Cerca, lo que se ve entre las briznas: el fondo de la hierba, oscuro. Lejos, donde ya */
    /* no hay briznas, la hierba como textura. */
    '    float near = 1. - smoothstep(GRASS_F0, GRASS_F1, tHit);',
    '    float tt = tHit;',
    '    vec4 b = vec4(0., .16, .5, 0.);',
    '    tGround = tt;',
    '    vec3 p = ro + rd * tt;',
    '    float kk = b.y;',
    /* Color de la brizna: oscura en la raíz, clara en la punta; algunas, secas. */
    '    float zone = fbm3(p.xz * .55);',
    '    vec3 root = mix(vec3(.040, .060, .020), vec3(.070, .100, .032), zone);',
    '    vec3 tip = mix(vec3(.20, .40, .09), vec3(.42, .58, .15), zone);',
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
    '    vec3 far = mix(vec3(.060, .105, .030), vec3(.25, .39, .10), zone * .6 + fine * .4);',
    '    far = mix(far, vec3(.44, .36, .15), smoothstep(.62, .92, fine) * .55);',
    '    far = mix(far, vec3(.30, .14, .09), smoothstep(.55, .85, fbm3(p.xz * .21 + 8.)) * .35 * (1. - uNight));',
    '    float woods = smoothstep(.52, .66, fbm3(p.xz * .11 + 21.)) * smoothstep(24., 42., tHit);',
    '    far = mix(far, mix(vec3(.030, .075, .034), vec3(.060, .11, .045), fine), woods * .85);',
    '    float kFar = (.35 + .65 * fine) * (1. - .45 * woods);',
    '    alb = mix(far, alb, near);',
    /* De noche el ojo casi no ve el color: la hierba se apaga y se enfría (si no, queda de un */
    /* verde encendido que no es de noche). */
    '    alb = mix(alb, vec3(dot(alb, vec3(.30, .59, .11))) * vec3(.70, .90, 1.02), uNight * .50);',
    '    kk = mix(kFar, kk, near);',
    /* Luz: las raíces quedan a la sombra de las demás briznas; las puntas reciben el sol y */
    /* dejan pasar la luz cuando se miran a contraluz. */
    '    float ao = mix(.26, 1., smoothstep(0., .85, kk));',
    '    float dif = clamp((dot(n, L) + .30) / 1.30, 0., 1.);',
    '    float through = pow(max(dot(rd, L), 0.), 3.) * kk;',
    '#ifdef CACHE',
    '    float sh = texelFetch(uShade, ivec2(gl_FragCoord.xy), 0).x;',
    '#else',
    '    float sh = groundShadow(p, base, L);',
    '#endif',
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
    '    gcol += mix(alb, vec3(dot(alb, vec3(.33))), .35 * uNight) * screenGlow * spill * mix(mix(1.6, .9, uDay), 7.0, uNight) * (.35 + .65 * kk);',
    /* Cada luciérnaga alumbra un corro de hierba debajo. */
    '    if(uNight > .01){',
    '      vec3 fl = vec3(0.);',
    '      for(int i = 0; i < FF_N; i++){',
    '        if(i >= uFFLit) break;',
    '        vec3 d = uFF[i].xyz - p;',
    '        fl += ffCol * max(uFF[i].w - .15, 0.) * exp(-dot(d, d) * 3.2);',
    '      }',
    '      gcol += alb * fl * 1.5 * (.35 + .65 * kk) * uNight;',
    '    }',
    '    col = gcol;',
    '    tFin = tGround;',
    /* El lago: donde el terreno queda bajo el nivel del agua. Refleja el cielo, con ondas */
    /* finas. */
    '    float tW = (WATER_Y - ro.y) / min(rd.y, -1e-4);',
    '    if(rd.y < 0. && tW < tGround){',
    '      vec3 pw = ro + rd * tW;',
    '      float depth = WATER_Y - terrain(pw.xz);',
    '      float rip = noise(pw.xz * vec2(1.2, 5.) + vec2(uTime * .25, uTime * .1)) + .5 * noise(pw.xz * vec2(3., 11.) - uTime * .3);',
    '      vec3 wn = normalize(vec3((rip - .75) * .05, 1., (noise(pw.xz * vec2(1.5, 6.) + 5. - uTime * .2) - .5) * .09));',
    '      vec3 wr = reflect(rd, wn);',
    '      wr.y = abs(wr.y);',
    '      vec3 wc = sky(wr, L) * mix(.80, .92, uNight);',
    /* El reflejo de las sierras, oscuro, cerca de la orilla del fondo. */
    '      wc = mix(wc, wc * vec3(.42, .36, .42), smoothstep(.10, .02, wr.y) * .7);',
    '      wc += pal(vec3(1.2, .78, .40), vec3(.90, .90, .84), vec3(.40, .46, .70)) * pow(max(dot(wr, normalize(vec3(L.x, .05, L.z))), 0.), 40.) * .35;',
    /* Agua, solo de la colina hacia el fondo: el terreno también queda por debajo de su nivel */
    /* al pie de la colina, pegado a la cámara, y ahí asomaba un charco en la esquina de abajo */
    /* a la izquierda de las ventanas anchas; eso es hierba. */
    '      float shore = smoothstep(0., .10, depth) * smoothstep(0., 6., pw.z);',
    '      wet = shore;',
    '      col = mix(col, wc, shore * .94);',
    /* Un filo claro en la orilla. */
    '      col += pal(vec3(.50, .32, .20), vec3(.50, .56, .60), vec3(.10, .12, .20)) * smoothstep(.06, .0, abs(depth - .03)) * .5;',
    '      tFin = mix(tGround, tW, shore);',
    '    }',
    '  }',
    '#endif',

    /* ---------- El ordenador ---------- */
    '#if PART == 0 || PART == 3',
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
    '#if PART == 0',
    '      if(abs(glassD(q)) < .006 && q.z < -.5){',
    '        glass = 1.;',
    /* La pantalla: el tablero, líneas del tubo, bordes más oscuros y el reflejo del cielo. */
    '        vec2 su = (q.xy - vec2(0., 1.16)) / vec2(.60, .44);',
    '        vec3 b = board(su);',
    '        b *= .93 + .07 * sin(su.y * 170.);',
    '        b *= 1. - .20 * dot(su * .85, su * .85);',
    '        b *= 1. + .03 * sin(uTime * 7.);',
    '        col = b * (mix(1.02, 1.14, uNight) + .16 * max(uUI.w, 0.)) + vec3(.05, .03, 0.) * (1. - uNight);',
    '        col = mix(col, skyBase(refl, L), .05 + fres * .55);',
    '        col += vec3(1.) * pow(max(dot(refl, L), 0.), 60.) * .5;',
    '      }else',
    '#endif',
    '      {',
    /* La carcasa: plástico azul grisáceo, más claro en el marco y más oscuro en la peana. */
    '        float ao = 1.;',
    '        for(int i = uZero; i < 2; i++){',
    '          float r = i == 0 ? .10 : .30;',
    '          float k = clamp(computer(q + nl * r) / r, 0., 1.);',
    '          ao *= i == 0 ? k : k * .5 + .5;',
    '        }',
    '        ao = mix(1., ao, .8);',
    /* Dos plásticos, como los monitores de la época: el marco frontal, claro; la carcasa, */
    /* azul, algo más honda hacia atrás. El pie, del color del marco. */
    '        vec3 shellCol = mix(vec3(.36, .52, .74), vec3(.28, .43, .64), smoothstep(-.3, .9, q.z));',
    '        vec3 alb = mix(vec3(.82, .86, .92), shellCol, smoothstep(-.44, -.40, q.z));',
    '        float frame = step(q.z, -.50) * step(.30, q.y);',
    /* El faldón bajo la pantalla, un punto más oscuro que el marco. */
    '        alb = mix(alb, alb * .93, step(q.y, .635) * step(q.z, -.55));',
    '        alb = mix(alb, vec3(.66, .71, .79), step(q.y, .335));',
    /* Hueco del marco y de la ranura: más oscuros. */
    '        float inRecess = step(abs(q.x), .68) * step(abs(q.y - 1.16), .52) * smoothstep(-.77, -.70, q.z) * step(q.z, -.50);',
    '        alb = mix(alb, vec3(.10, .13, .18), inRecess);',
    '        alb = mix(alb, vec3(.03, .03, .04), step(abs(q.x + .06), .225) * step(abs(q.y - .47), .021) * step(q.z, -.60));',
    /* Mandos: claros, con una muesca que dice hacia dónde apuntan. El cable, oscuro. */
    '        vec2 kd1 = q.xy - vec2(.50, .47), kd2 = q.xy - vec2(.68, .47);',
    '        float onKnob = clamp(step(length(kd1), .064) + step(length(kd2), .064), 0., 1.) * step(q.z, -.80);',
    '        alb = mix(alb, vec3(.42, .50, .62), onKnob);',
    '        vec2 n1 = rot(.6) * kd1, n2 = rot(-.9) * kd2;',
    '        float notch = step(abs(n1.x), .009) * step(0., n1.y) + step(abs(n2.x), .009) * step(0., n2.y);',
    '        alb = mix(alb, vec3(.12, .14, .19), clamp(notch, 0., 1.) * onKnob * step(q.z, -.84));',
    '        alb = mix(alb, vec3(.04, .04, .05), step(.88, q.z) * step(q.y, .70));',
    /* Rejillas de ventilación: en los costados y arriba, por detrás. */
    '        vec2 vg = vec2(q.z, q.y) * 17.;',
    '        vg.x += .5 * mod(floor(vg.y), 2.);',
    /* Un abanico de puntos que se abre hacia atrás y hacia abajo. */
    '        float fan = step(-.12, q.z) * step(q.z, .72) * step(.62, q.y) * step(q.y, .74 + (q.z + .12) * .78);',
    '        float sideVent = step(.45, abs(nl.x)) * fan * step(length(fract(vg) - .5), .27);',
    '        float topVent = step(.5, nl.y) * step(abs(q.z - .50), .22) * step(abs(q.x), .40) * step(.5, fract(q.x * 13.));',
    '        alb *= 1. - .62 * max(sideVent, topVent);',
    /* Insignia con las tres barras de Kanlane, bajo la pantalla. */
    '        vec2 bd = q.xy - vec2(-.60, .47);',
    '        float badge = (1. - smoothstep(0., .006, rr(bd, vec2(.078, .078), .022))) * step(q.z, -.60);',
    '        float bx = bd.x - bd.y * .42;',
    '        float bars = (step(abs(bx + .040), .012) + step(abs(bx), .012) + step(abs(bx - .040), .012)) * step(abs(bd.y), .046);',
    '        alb = mix(alb, mix(vec3(.10, .11, .15), vec3(.94, .96, 1.), clamp(bars, 0., 1.)), badge);',
    /* Grano fino del plástico. */
    '        alb *= .94 + .12 * noise(q.xy * 60. + q.z * 37.);',
    '        float dif = max(dot(n, L), 0.);',
    '        float shd = computerShadow(q + nl * .02, Ll);',
    '        vec3 hv = normalize(L - rd);',
    '        float spec = pow(max(dot(n, hv), 0.), 48.) * .55 + pow(max(dot(n, hv), 0.), 8.) * .08;',
    '        float skyL = .5 + .5 * n.y;',
    '        col = alb * (ambient * .9 * ao + mix(vec3(.20, .27, .40), skyLight, uNight) * skyL * 1.7 * ao + sunCol * dif * 1.1 * shd);',
    '        col += sunCol * spec * shd;',
    /* De noche, sin esto, la carcasa se queda en una silueta negra: luz de relleno del cielo */
    /* y un filo frío en los cantos, para que se lea la forma. */
    '        col += alb * (vec3(.030, .040, .075) + vec3(.10, .13, .24) * pow(1. - max(dot(n, -rd), 0.), 2.5)) * uNight;',
    '        col += skyBase(refl, L) * fres * .22 * ao;',
    /* La hierba le devuelve un poco de verde por debajo. */
    '        col += alb * vec3(.05, .09, .03) * max(-n.y, 0.) * (1. - uNight);',
    /* La pantalla ilumina el hueco de su marco. */
    '        col += screenGlow * inRecess * .34 * mix(.7, 1.2, uNight);',
    /* Piloto verde. */
    '        float led = 1. - smoothstep(.014, .024, length(q.xy - vec2(.30, .47)));',
    /* Parpadea deprisa mientras se espera la respuesta. */
    '        float blink = mix(.85 + .15 * sin(uTime * 2.), .25 + .75 * step(.5, fract(uTime * 5.)), uUI.z);',
    '        col = mix(col, mix(vec3(.35, 1., .55), vec3(1., .30, .24), max(-uUI.w, 0.)) * blink, led * step(q.z, -.55));',
    '      }',
    '    }',
    '  }',
    '#endif',

    '  if(tFin > 0.){',
    '    float fog = 1. - exp(-tFin * mix(.017, .024, uNight));',
    /* A lo lejos el suelo se funde con la bruma del horizonte. */
    '    fog = max(fog, smoothstep(30., 110., tFin) * .92);',
    '    col = mix(col, mix(fogCol, skyBase(normalize(vec3(rd.x, .03, rd.z)), L), .28), fog);',
    /* Bruma baja: se posa en las hondonadas y deja las crestas fuera. */
    '    float py = ro.y + rd.y * tFin;',
    '    float mist = exp(-max(py - base + 1.9, 0.) * 1.5) * smoothstep(9., 34., tFin) * (1. - smoothstep(70., 150., tFin));',
    '    vec2 mp = (ro + rd * tFin).xz;',
    '    mist *= .50 + 1.0 * fbm3(mp * .045 + vec2(uTime * .034, uTime * .012));',
    '    col = mix(col, mistColor(), mist * mix(.42, .56, uDawn * (1. - uDay)) * (1. - .45 * uDay));',
    '  }',
    '#if PART != 0',
    '  fragColor = vec4(col, wet);',
    '#else'
  ].concat(TAIL, ['#endif', '}']).join('\n');
  const TREES_VERT = [
    /* ---------- Arbolado lejano ---------- */
    /* Árboles pequeños repartidos por las lomas del fondo: cada uno es un rectángulo que mira a */
    /* la cámara y su silueta se dibuja en trees.frag. */
    'layout(location = 0) in vec2 aQuad;',
    'layout(location = 1) in vec4 aInst;',
    'out vec2 vUv;',
    'out vec3 vKind;',
    'out vec4 vFog;',

    'void main(){',
    '  setupTree();',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 L = sunDir();',

    /* aQuad: x de -1 a 1, y de 0 (suelo) a 1 (copa). aInst: raíz (x, z), azar y tipo. */
    '  vec2 r0 = aInst.xy;',
    '  float rnd = aInst.z, kind = aInst.w;',
    '  vec3 root = vec3(r0.x, terrain(r0) - .06, r0.y);',
    /* Ni dentro del lago ni en su orilla. */
    '  float alive = step(WATER_Y + .12, root.y);',
    '  float h = (1.25 + 1.7 * rnd) * alive;',
    /* Tipos: 0 redondo, 1 ciprés (alto y estrecho), 2 cerezo en flor (redondo y rosa). */
    '  float w = h * mix(.46, .17, step(.5, kind) * step(kind, 1.5));',
    '  vec3 side = normalize(vec3(rt.x, 0., rt.z));',
    '  vec3 p = root + side * aQuad.x * w + vec3(0., aQuad.y * h, 0.);',
    '  vUv = aQuad;',
    '  vKind = vec3(kind, rnd, fract(rnd * 17.3));',

    /* Bruma: la misma que el suelo. */
    '  float dist = length(root - ro);',
    '  vec3 rd = normalize(root - ro);',
    '  vec3 fogCol = fogColor(rd, L);',
    '  float fog = 1. - exp(-dist * mix(.017, .024, uNight));',
    '  fog = max(fog, smoothstep(30., 110., dist) * .92);',
    '  vFog = vec4(mix(fogCol, skyBase(normalize(vec3(rd.x, .03, rd.z)), L), .28), fog);',

    '  vec3 v = p - ro;',
    '  float zv = dot(v, fw);',
    '  vec2 frag = uFocus + uRes.y * 1.5 * vec2(dot(v, rt), dot(v, up)) / zv;',
    '  vec2 ndc = frag / uRes * 2. - 1.;',
    '  float zn = (Z_FAR * (zv - Z_NEAR) / ((Z_FAR - Z_NEAR) * zv)) * 2. - 1.;',
    '  gl_Position = vec4(ndc * zv, zn * zv, zv);',
    '}'
  ].join('\n');
  const TREES_FRAG = [
    /* ---------- Arbolado lejano: la silueta y la luz de cada árbol ---------- */
    'in vec2 vUv;',
    'in vec3 vKind;',
    'in vec4 vFog;',
    'out vec4 fragColor;',

    'void main(){',
    '  float kind = vKind.x, seed = vKind.y * 31.;',
    '  vec2 u = vUv;',
    '  float cypress = step(.5, kind) * step(kind, 1.5);',
    '  float pink = step(1.5, kind);',
    /* Copa. Redonda: tres bultos con el borde irregular. Ciprés: una llama estrecha. */
    '  float lump = (noise(u * vec2(4., 7.) + seed) - .5) * .30 + (noise(u * vec2(9., 15.) + seed * 2.) - .5) * .14;',
    '  float r1 = length((u - vec2(0., .64)) / vec2(.92, .36));',
    '  float r2 = length((u - vec2(-.38, .50)) / vec2(.52, .26));',
    '  float r3 = length((u - vec2(.40, .54)) / vec2(.50, .25));',
    '  float round = min(r1, min(r2, r3)) + lump;',
    '  float flame = abs(u.x) / max(.92 * (1. - pow(clamp((u.y - .10) / .90, 0., 1.), 1.7)) * step(.10, u.y), 1e-3) + lump * .8;',
    '  float crown = mix(round, flame, cypress);',
    '  float aCrown = 1. - smoothstep(.88, 1.02, crown);',
    /* Tronco. */
    '  float aTrunk = (1. - smoothstep(.05, .09, abs(u.x) * mix(1., .35, cypress))) * step(u.y, .45);',
    '  float a = max(aCrown, aTrunk * .9);',
    '  if(a < .01) discard;',

    /* Luz: a contraluz, la copa es oscura y el borde que mira al sol se enciende. */
    '  float edge = smoothstep(.45, 1., crown);',
    '  float sunSide = clamp(.55 + u.x * .5 + (u.y - .5) * .5, 0., 1.);',
    '  vec3 dark = mix(vec3(.030, .070, .034), vec3(.050, .095, .040), vKind.z);',
    '  vec3 lit = mix(vec3(.46, .44, .14), vec3(.34, .50, .15), uDay);',
    '  dark = mix(dark, dark * 1.7, uDay);',
    '  dark = mix(dark, vec3(.34, .17, .22), pink);',
    '  lit = mix(lit, vec3(1.10, .62, .58), pink);',
    /* De noche todo se apaga y se enfría. */
    '  dark = mix(dark, dark * vec3(.45, .55, 1.1) * .7, uNight);',
    '  lit = mix(lit, vec3(.10, .13, .26) + pink * vec3(.08, .03, .08), uNight);',
    '  vec3 col = mix(dark, lit, edge * sunSide * .85);',
    '  col *= .80 + .40 * noise(u * vec2(11., 17.) + seed);',
    '  col = mix(col, vec3(.045, .035, .035) * (1. - uNight * .5), (1. - aCrown) * aTrunk);',
    '  col = mix(col, vFog.rgb, vFog.a);',
    '  fragColor = vec4(post(col, gl_FragCoord.xy) * a, a);',
    '}'
  ].join('\n');
  const SCREEN = [
    /* ---------- La pantalla del ordenador, por cuenta directa ---------- */
    /* El cristal es un trozo de esfera, así que dónde lo toca un rayo sale de una cuenta, sin */
    /* tantear. Devuelve el color de ese punto: el tablero, las líneas del tubo, los bordes más */
    /* oscuros, el reflejo del cielo y la bruma que hay hasta allí. Qué píxeles son cristal lo */
    /* dice quien llama. La usan la imagen de espera (WAIT) y la escena (GLASS): así la pantalla */
    /* es idéntica en las dos y no se nota el relevo. */
    'vec3 screenColor(vec3 ro, vec3 rd, float base, vec3 L){',
    '  vec3 rol = toLocal(ro, base);',
    '  vec3 rdl = rd; rdl.xz = rot(YAW) * rdl.xz;',
    '  vec3 gc = vec3(0., 1.16, 5.37);',
    '  float sl = sph(rol, rdl, gc, 6.);',
    '  vec3 q = rol + rdl * sl;',
    '  vec3 n = (q - gc) / 6.; n.xz = rot(-YAW) * n.xz;',
    '  float fres = pow(1. - max(dot(n, -rd), 0.), 4.);',
    '  vec3 refl = reflect(rd, n);',
    '  vec2 su = (q.xy - vec2(0., 1.16)) / vec2(.60, .44);',
    '  vec3 b = board(su);',
    '  b *= .93 + .07 * sin(su.y * 170.);',
    '  b *= 1. - .20 * dot(su * .85, su * .85);',
    '  b *= 1. + .03 * sin(uTime * 7.);',
    '  vec3 col = b * (mix(1.02, 1.14, uNight) + .16 * max(uUI.w, 0.)) + vec3(.05, .03, 0.) * (1. - uNight);',
    '  col = mix(col, skyBase(refl, L), .05 + fres * .55);',
    '  col += vec3(1.) * pow(max(dot(refl, L), 0.), 60.) * .5;',
    '  float fog = 1. - exp(-sl * CS * mix(.017, .024, uNight));',
    '  return mix(col, mix(fogColor(rd, L), skyBase(normalize(vec3(rd.x, .03, rd.z)), L), .28), fog);',
    '}'
  ].join('\n');
  const GLASS = [
    /* ---------- La escena: la pantalla del ordenador ---------- */
    /* Solo los píxeles del cristal (los marca uShade). Va aparte del resto del ordenador porque */
    /* es lo único suyo que cambia deprisa (lo que se escribe) y porque el tablero era lo que */
    /* más tardaba en compilarse. */
    'uniform sampler2D uShade;',
    'out vec4 fragColor;',

    'void main(){',
    '  if(texelFetch(uShade, ivec2(gl_FragCoord.xy), 0).y < .5) discard;',
    '  vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);',
    '  fragColor = vec4(screenColor(ro, rd, base, sunDir()), 0.);',
    '}'
  ].join('\n');
  const WAIT = [
    /* ---------- Mientras se compila lo demás ---------- */
    /* Los programas de la escena tardan segundos en compilarse. Entre tanto se enseña una imagen */
    /* de la escena hecha de antemano con este mismo código (poster(), assets/img/acceso-*.webp): */
    /* la escena solo depende de dónde cae cada píxel respecto al ordenador, en alturas de */
    /* pantalla, así que la imagen se coloca con esa misma cuenta y coincide con lo que vendrá. */
    /* uPosterMap: en la imagen, dónde está el ordenador (x, y, en píxeles) y cuánto mide una */
    /* altura de pantalla. La imagen va sin el revelado final (post), que se le da aquí. */
    /* Con LIVE, además, van el cerezo y la pantalla del ordenador, pintada de verdad (el cuadro de acceso, lo */
    /* que se escribe): la imagen marca con su transparencia qué píxeles son cristal, y dónde */
    /* toca cada rayo el cristal sale de una cuenta directa (SCREEN), la misma que usa la escena. */
    'uniform sampler2D uPoster;',
    'uniform vec3 uPosterMap;',
    'uniform float uFade;',
    'out vec4 fragColor;',

    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    '  vec4 px = texture(uPoster, clamp((uv * uPosterMap.z + uPosterMap.xy) / vec2(textureSize(uPoster, 0)), .001, .999));',
    '  vec3 col = px.rgb;',
    '#ifdef LIVE',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);',
    '  vec3 L = sunDir();',
    '  if(px.a < .75){',
    '    col = screenColor(ro, rd, base, L);',
    /* El halo de la pantalla en el aire. */
    '    vec3 sc = vec3(0., 1.16, -.66) * CS; sc.xz = rot(-YAW) * sc.xz; sc.y += base;',
    '    vec3 oc = ro - sc;',
    '    float bq = dot(oc, rd);',
    '    float dq = length(oc + rd * max(-bq, 0.));',
    '    col += screenLight() * .06 * exp(-dq * dq * 1.5) * mix(.5, 1.5, uNight) * step(0., -bq);',
    '  }',
    /* El cerezo, igual que en la escena y en su sitio (que depende de la ventana: por eso no */
    /* va en la imagen). Aquí no se sabe qué terreno hay delante, así que nada lo tapa. */
    '  setupTree();',
    '  float treeSc = TREE_SC * uTreeS;',
    '  vec3 treeB = vec3(gTree.x, TREE_H + .22 * treeSc, gTree.y);',
    '  vec3 fogCol = fogColor(rd, L);',
    '  float tGround = -1.;'
  ].concat(TREE_PART, [
    '#endif',
    /* uFade: cuánto se ve, para fundirla con la escena de verdad cuando llega. */
    '  fragColor = vec4(post(col, gl_FragCoord.xy), 1.) * uFade;',
    '}'
  ]).join('\n');
  const GRASS_BASE = [
    /* ---------- La hierba, paso previo: lo que no cambia de cada brizna ---------- */
    /* Dónde está su raíz, cuánto mide, la sombra fija que le cae (la del terreno y la del */
    /* ordenador), el contacto con el cerezo y el ordenador, y la bruma que tiene delante: es lo */
    /* más caro de la hierba y no depende del viento, así que se calcula una sola vez por tamaño */
    /* de ventana, y otra cuando cambia la luz (el tema), y se guarda (transform feedback). */
    'layout(location = 1) in vec4 aInst;',
    /* Altura de la raíz, alto de la brizna, sombra fija y contacto. */
    'out vec4 oB0;',
    /* Mata, dos ruidos fijos (el desfase de la onda del viento y las manchas de la copa) y la */
    /* distancia a la cámara. */
    'out vec4 oB1;',
    'out vec4 oB2;',

    'void main(){',
    '  setupTree();',
    '  float treeSc = TREE_SC * uTreeS;',
    '  float base = uBase;',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 L = sunDir();',

    /* aInst: raíz (x, z) y dos números al azar. */
    '  vec2 r0 = aInst.xy;',
    '  float rA = aInst.z, rB = aInst.w;',
    '  vec3 root = vec3(r0.x, terrain(r0), r0.y);',
    '  float dist = length(root - ro);',

    /* Hasta dónde hay briznas; bajo el ordenador, ninguna. */
    '  float fade = 1. - smoothstep(GRASS_F0, GRASS_F1, dist);',
    '  vec3 ql = toLocal(root, base);',
    '  fade *= 1. - step(length(ql.xz - vec2(0., -.14)), .72);',

    /* Matas: la hierba crece a manchas, más alta y más espesa en unas zonas que en otras. */
    '  float clump = noise(r0 * .85 + 3.);',
    '  float tuft = noise(r0 * 3.1 + 11.);',
    '  float stray = step(.94, fract(rB * 7.31));',
    '  float h = (.095 + .125 * rA + .10 * clump + .05 * tuft) * (1. + .60 * stray) * fade;',

    /* Sombras que no se mueven: el terreno y el ordenador. */
    '  float sh = terrainShadow(vec3(root.x, root.y + .10, root.z), L);',
    '  if(dot(ql.xz, ql.xz) < 30.){',
    '    vec3 Ll = L; Ll.xz = rot(YAW) * Ll.xz;',
    '    sh *= computerShadow(vec3(ql.x, ql.y + .08, ql.z), Ll);',
    '  }',
    /* Al pie del cerezo y al del ordenador la hierba queda en penumbra. */
    '  float foot = length((r0 - gTree) * vec2(1., 1.6)) / treeSc;',
    '  float contact = smoothstep(.25, 1.9, foot) * .72 + .28;',
    '  contact *= .45 + .55 * smoothstep(.55, 1.5, length(ql.xz - vec2(0., -.12)));',
    '  oB0 = vec4(root.y, h, sh, contact);',
    '  oB1 = vec4(clump, noise(r0 * .35), noise(r0 * 6.1), dist);',

    /* Bruma: la misma que el suelo. */
    '  vec3 rd = normalize(root - ro);',
    '  vec3 fogCol = fogColor(rd, L);',
    '  float fog = 1. - exp(-dist * mix(.017, .024, uNight));',
    '  vec3 fc = mix(fogCol, skyBase(normalize(vec3(rd.x, .03, rd.z)), L), .28);',
    '  float mist = exp(-max(root.y - base + 1.9, 0.) * 1.5) * smoothstep(9., 34., dist);',
    '  vec3 mistCol = mistColor();',
    /* Dos mezclas seguidas (bruma y bruma baja) resumidas en un color y una cantidad. */
    '  float fa = 1. - (1. - fog) * (1. - mist * .42);',
    '  oB2 = vec4((fc * fog * (1. - mist * .42) + mistCol * mist * .42) / max(fa, 1e-4), fa);',
    '  gl_Position = vec4(0., 0., 0., 1.);',
    '}'
  ].join('\n');
  const GRASS_SIM = [
    /* ---------- La hierba, primer paso: lo que es igual para toda la brizna ---------- */
    /* Cada brizna sale de su raíz en el suelo, se curva hacia un lado y el viento la tumba a */
    /* rachas que recorren la colina. Hacia dónde cae y qué sombra y qué luz le llegan vale lo */
    /* mismo para sus nueve vértices: se calcula aquí una vez por brizna en cada fotograma y se */
    /* guarda (transform feedback); GRASS_VERT solo le da forma. Calcularlo en cada vértice */
    /* costaba nueve veces más. Lo que además no cambia con el tiempo viene ya de GRASS_BASE. */
    'layout(location = 1) in vec4 aInst;',
    'layout(location = 2) in vec4 aB0;',
    'layout(location = 3) in vec4 aB1;',
    'layout(location = 4) in vec4 aB2;',
    'uniform float uWide;',
    /* Raíz (altura), alto de la brizna y hacia dónde cae. */
    'out vec4 oA;',
    /* Sombra, contacto, racha y mata. */
    'out vec4 oLight;',
    'out vec4 oFog;',
    /* Luces de cerca y ancho de la brizna. */
    'out vec4 oExtra;',

    'void main(){',
    '  setupTree();',
    '  float treeSc = TREE_SC * uTreeS;',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 L = sunDir();',

    /* aInst: raíz (x, z) y dos números al azar. */
    '  vec2 r0 = aInst.xy;',
    '  float rA = aInst.z, rB = aInst.w;',
    '  vec3 root = vec3(r0.x, aB0.x, r0.y);',
    '  float h = aB0.y, clump = aB1.x, dist = aB1.w;',
    /* De lejos las briznas se ensanchan para seguir cubriendo con menos. */
    '  float w = (.0046 + .0032 * fract(rB * 3.7)) * (1. + dist * .13) * uWide;',

    /* Viento: rachas anchas que cruzan la colina, una onda que las acompaña y un temblor fino */
    /* en cada brizna. */
    '  vec2 wdir = normalize(vec2(1., .45));',
    '  float gust = noise(r0 * .16 - wdir * uTime * .50);',
    '  gust = gust * gust * (3. - 2. * gust);',
    '  float wave = sin(dot(r0, wdir) * 1.1 - uTime * 1.7 + aB1.y * 5.) * .5 + .5;',
    '  float blow = .03 + .50 * gust + .16 * wave * gust;',
    '  float flutter = sin(uTime * (3.2 + 2.6 * rA) + rB * 43.) * (.035 + .07 * gust);',
    '  float ang = rB * 19.;',
    '  vec2 own = vec2(cos(ang), sin(ang));',
    '  vec2 lean = own * (.14 + .36 * rA) + wdir * blow + vec2(-wdir.y, wdir.x) * flutter;',
    /* El cursor: las briznas de su alrededor se tumban hacia fuera, como si pasara una mano. */
    /* Se mide en pantalla (dónde cae la raíz respecto al cursor), llevado a medidas de la */
    /* escena a esa distancia; en vertical cuenta más, porque el suelo se ve muy de canto. */
    '  if(uMouse.z > .002){',
    '    vec3 v0 = root - ro;',
    '    float z0 = max(dot(v0, fw), .3);',
    '    vec2 f0 = uFocus + uRes.y * 1.5 * vec2(dot(v0, rt), dot(v0, up)) / z0;',
    '    vec2 md = (f0 - uMouse.xy) / uRes.y * z0 / 1.5;',
    '    md.y *= 2.4;',
    '    float push = exp(-dot(md, md) / .62) * uMouse.z;',
    '    lean += normalize(rt.xz * md.x + normalize(fw.xz) * md.y + 1e-4) * push * 1.35;',
    '    h *= 1. - .22 * push;',
    '  }',
    '  oA = vec4(root.y, h, lean);',

    /* Sombras: a las fijas (terreno y ordenador) se suman las que se mueven: las nubes y la */
    /* copa del cerezo, a manchas. */
    '  float sh = aB0.z;',
    '  float cloudSh = smoothstep(.34, .66, fbm3(r0 * .075 + vec2(uTime * .035, uTime * .014)));',
    '  sh *= mix(.40, 1., cloudSh);',
    '  vec2 tsh = (r0 - gTree) / treeSc + L.xz * 4.2;',
    '  float dapple = smoothstep(.30, .62, noise(r0 * 2.4 + vec2(uTime * .10, 0.)) * .6 + aB1.z * .4);',
    '  sh *= 1. - .62 * smoothstep(5.4, 2.2, length(tsh * vec2(1., 1.3))) * mix(1., .25, dapple);',
    '  float contact = aB0.w;',
    '  sh *= contact;',
    '  sh = mix(sh, 1., uNight * .5);',
    '  oLight = vec4(sh, .45 + .55 * contact, gust, clump);',
    '  oFog = aB2;',

    /* Luces de cerca: la pantalla del ordenador y, de noche, las luciérnagas. */
    '  vec3 sn = vec3(0., 0., -1.); sn.xz = rot(-YAW) * sn.xz;',
    '  vec3 sc = vec3(0., 1.16, -.66) * CS; sc.xz = rot(-YAW) * sc.xz; sc.y += base;',
    '  vec3 tl = sc - root;',
    '  float dl = length(tl);',
    '  float spill = max(dot(normalize(tl), vec3(0., 1., 0.)) * .6 + .4, 0.) * max(dot(-normalize(tl), sn), 0.) / (1. + dl * dl * .5);',
    '  vec3 extra = screenLight() * spill * mix(mix(1.6, .9, uDay), 7.0, uNight);',
    '  if(uNight > .01){',
    '    vec3 fl = vec3(0.);',
    '    for(int i = 0; i < FF_N; i++){',
    '      if(i >= uFFLit) break;',
    '      vec3 d = uFF[i].xyz - root;',
    '      fl += vec3(.80, 1., .34) * max(uFF[i].w - .15, 0.) * exp(-dot(d, d) * 3.2);',
    '    }',
    '    extra += fl * 1.5 * uNight;',
    '  }',
    '  oExtra = vec4(extra, w);',
    '  gl_Position = vec4(0., 0., 0., 1.);',
    '}'
  ].join('\n');
  const GRASS_VERT = [
    /* ---------- La hierba, segundo paso: una cinta por brizna ---------- */
    /* Cada brizna es una cinta de cuatro tramos (dos en los equipos justos) que acaba en punta. */
    /* Aquí solo se le da forma: lo demás viene ya calculado de GRASS_SIM. */
    'layout(location = 0) in vec2 aBlade;',
    'layout(location = 1) in vec4 aInst;',
    'layout(location = 2) in vec4 aA;',
    'layout(location = 3) in vec4 aLight;',
    'layout(location = 4) in vec4 aFog;',
    'layout(location = 5) in vec4 aExtra;',
    'out vec3 vN;',
    'out vec3 vPos;',
    'out vec4 vBlade;',
    'out vec4 vLight;',
    'out vec4 vFog;',
    'out vec3 vExtra;',

    'void main(){',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',

    /* aBlade: lado (-1..1) y altura dentro de la brizna (0 raíz, 1 punta). */
    '  float rA = aInst.z, rB = aInst.w;',
    '  float t = aBlade.y;',
    '  vec3 root = vec3(aInst.x, aA.x, aInst.y);',
    '  float h = aA.y, w = aExtra.w;',
    '  vec2 lean = aA.zw;',
    '  float ang = rB * 19.;',
    '  vec2 own = vec2(cos(ang), sin(ang));',
    '  float lm2 = min(dot(lean, lean), 1.);',

    /* La curva de la brizna y su tangente. */
    '  float tc = pow(t, 1.7);',
    '  vec3 p = root + vec3(lean.x, 0., lean.y) * h * tc;',
    '  p.y += h * t * (1. - .30 * lm2 * t);',
    '  vec3 tang = normalize(vec3(lean.x * 1.7 * pow(max(t, .02), .7), 1. - .60 * lm2 * t, lean.y * 1.7 * pow(max(t, .02), .7)));',

    /* El ancho mira a medias a la cámara: así ninguna brizna queda de canto y desaparece. */
    '  vec3 toCam = normalize(ro - p);',
    '  vec3 camSide = normalize(cross(tang, toCam));',
    '  vec3 ownSide = vec3(-own.y, 0., own.x);',
    '  ownSide *= sign(dot(ownSide, camSide) + 1e-4);',
    '  vec3 side = normalize(mix(ownSide, camSide, .60));',
    '  float taper = 1. - pow(t, 1.5);',
    '  p += side * aBlade.x * w * taper;',

    '  vec3 n = normalize(cross(side, tang));',
    '  n *= sign(dot(n, toCam) + 1e-4);',
    /* Algo de curva a lo ancho, como una hoja doblada por su nervio. */
    '  vN = normalize(n + side * aBlade.x * .55);',
    '  vPos = p;',
    '  vBlade = vec4(t, rA, rB, aLight.w);',
    '  vLight = aLight;',
    '  vFog = aFog;',
    '  vExtra = aExtra.xyz;',

    /* Proyección: la misma cámara que la escena (el punto de fuga está en uFocus, no en el centro). */
    '  vec3 v = p - ro;',
    '  float zv = dot(v, fw);',
    '  vec2 frag = uFocus + uRes.y * 1.5 * vec2(dot(v, rt), dot(v, up)) / zv;',
    '  vec2 ndc = frag / uRes * 2. - 1.;',
    '  float zn = (Z_FAR * (zv - Z_NEAR) / ((Z_FAR - Z_NEAR) * zv)) * 2. - 1.;',
    '  gl_Position = vec4(ndc * zv, zn * zv, zv);',
    '}'
  ].join('\n');
  const GRASS_FRAG = [
    /* ---------- La hierba: el color de cada brizna ---------- */
    'in vec3 vN;',
    'in vec3 vPos;',
    'in vec4 vBlade;',
    'in vec4 vLight;',
    'in vec4 vFog;',
    'in vec3 vExtra;',
    'out vec4 fragColor;',

    'void main(){',
    '  float t = vBlade.x, rA = vBlade.y, rB = vBlade.z, clump = vBlade.w;',
    '  float sh = vLight.x, contact = vLight.y, gust = vLight.z;',
    '  vec3 L = sunDir();',
    '  vec3 sunCol = sunColor();',
    '  vec3 ambient = ambientColor();',
    '  vec3 skyLight = skyLightColor();',
    '  vec3 ro = vec3(2.2, 2.65, -11.5);',
    '  vec3 V = normalize(ro - vPos);',
    '  vec3 N = normalize(vN);',

    /* Color: raíz oscura, cuerpo verde y punta más clara y amarilla. Cada mata tiene su verde */
    /* y cada brizna, su tono; algunas están secas. */
    '  vec3 rootCol = mix(vec3(.020, .040, .012), vec3(.036, .066, .020), clump);',
    '  vec3 midCol = mix(vec3(.105, .26, .050), vec3(.20, .40, .075), clump);',
    '  vec3 tipCol = mix(vec3(.34, .58, .12), vec3(.62, .76, .20), clump * .6 + rA * .4);',
    '  vec3 alb = mix(rootCol, midCol, smoothstep(0., .45, t));',
    '  alb = mix(alb, tipCol, smoothstep(.35, 1., t));',
    '  alb *= .78 + .44 * fract(rB * 9.7);',
    '  alb = mix(alb, alb * vec3(.78, 1.02, 1.12), smoothstep(.6, 1., fract(rB * 23.3)) * .45);',
    '  float dry = smoothstep(.80, .97, fract(rA * 5.3 + rB * 1.7));',
    '  alb = mix(alb, vec3(.50, .43, .17) * (.35 + .65 * t), dry * .75);',
    /* Manchas rojizas de tierra seca, de día. */
    '  alb = mix(alb, vec3(.26, .15, .10), smoothstep(.66, .9, fbm3(vPos.xz * .23 + 8.)) * .20 * (1. - uNight));',
    /* De noche, apagada y fría, igual que el suelo. */
    '  alb = mix(alb, vec3(dot(alb, vec3(.30, .59, .11))) * vec3(.70, .90, 1.02), uNight * .50);',

    /* Luz. Abajo, entre las demás briznas, casi no llega; arriba recibe el sol, lo deja pasar */
    /* a contraluz y brilla en el filo cuando el viento la tumba. */
    '  float ao = mix(.14, 1., smoothstep(0., .80, t)) * contact;',
    '  float nl = dot(N, L);',
    '  float dif = clamp((abs(nl) * .75 + nl * .25 + .30) / 1.30, 0., 1.);',
    '  float back = pow(max(dot(-V, L), 0.), 3.);',
    '  float through = back * smoothstep(.10, .9, t);',
    '  vec3 H = normalize(L + V);',
    '  float spec = pow(max(dot(N, H), 0.), 26.) * smoothstep(.15, .7, t);',
    '  float rim = pow(1. - max(dot(N, V), 0.), 3.) * t;',

    '  vec3 col = alb * (ambient * 1.5 * ao + skyLight * 2.4 * ao + sunCol * dif * 3.0 * ao * sh);',
    '  col += sunCol * mix(vec3(.62, .70, .16), vec3(.90, .62, .18), back) * through * 1.45 * sh * (.55 + .45 * rA);',
    '  col += sunCol * vec3(.95, .90, .62) * spec * .75 * sh * (.45 + .9 * gust);',
    '  col += sunCol * alb * rim * .9 * sh;',
    /* La racha se ve pasar: la hierba tumbada enseña el envés, más claro. */
    '  col += alb * sunCol * gust * smoothstep(.2, 1., t) * .40 * sh * (1. - uNight * .6);',
    '  col += alb * vExtra * (.30 + .70 * t);',

    '  col = mix(col, vFog.rgb, vFog.a);',
    '  fragColor = vec4(post(col, gl_FragCoord.xy), 1.);',
    '}'
  ].join('\n');
  const OVER = [
    /* ---------- Lo que va por delante de la hierba: pétalos y luciérnagas ---------- */
    /* Las luciérnagas, ya llevadas a la pantalla (flies2d): dónde cae cada una, su escala y a */
    /* qué distancia está; y hacia dónde queda su estela, cuánto se desenfoca y cuánto brilla. */
    'uniform vec4 uFly[40];',
    'uniform vec4 uFlyB[40];',
    /* Los pétalos: dónde está cada uno y cómo está girado (coseno y seno), y cuánto se ve. Los */
    /* mueve el JS (petals): calcularlo aquí era repetir las mismas cuentas en cada píxel. */
    'uniform vec4 uPetal[22];',
    'uniform float uPetalA[22];',
    '#ifdef CACHE',
    'uniform sampler2D uGeo;',
    '#endif',
    'out vec4 fragColor;',

    'void main(){',
    '  setupTree();',
    '  vec3 col = vec3(0.);',
    '  float alpha = 0.;',
    /* Pétalos del cerezo: caen despacio y el viento los lleva hacia la derecha. */
    '  vec2 pa = gl_FragCoord.xy / uRes.y;',
    '  float asp = uRes.x / uRes.y;',
    '  for(int i = 0; i < 22; i++){',
    '    vec2 v = pa - uPetal[i].xy;',
    /* Lejos del pétalo no hay nada que pintar. */
    '    if(dot(v, v) > .00002) continue;',
    '    vec2 dp = vec2(uPetal[i].z * v.x + uPetal[i].w * v.y, uPetal[i].z * v.y - uPetal[i].w * v.x);',
    '    float petal = 1. - smoothstep(.0020, .0042, length(dp * vec2(1., 1.9)));',
    '    float a = petal * uPetalA[i] * .9;',
    '    col = col * (1. - a) + mix(vec3(1., .78, .86), vec3(.62, .56, .86), uNight * .6) * a;',
    '    alpha = alpha * (1. - a) + a;',
    '  }',
    /* Una bandada cruza el cielo al atardecer, lejos. */
    '  if(uNight < .99 && abs(pa.y - .80) < .10){',
    '    float bt = uTime * .011;',
    '    for(int i = 0; i < 6; i++){',
    '      float fi = float(i);',
    '      vec2 bp = vec2(fract(bt + .37) * (asp + .5) - .25, .80 + .035 * sin(bt * 9.));',
    '      bp += vec2(-.022 * fi - .010 * mod(fi, 2.), (mod(fi, 2.) * 2. - 1.) * .011 * ceil(fi * .5));',
    '      vec2 q = (pa - bp) / .0062;',
    '      float flap = .25 + .65 * sin(uTime * 5.5 + fi * 1.9);',
    '      float wing = abs(q.y - abs(q.x) * flap + .18 * q.x * q.x);',
    '      float bird = (1. - smoothstep(.10, .26, wing)) * (1. - smoothstep(.85, 1., abs(q.x)));',
    '      float a = bird * .62 * (1. - uNight);',
    '      col *= 1. - a;',
    '      col += vec3(.10, .05, .08) * a;',
    '      alpha = alpha * (1. - a) + a;',
    '    }',
    '  }',
    /* Luciérnagas, de noche. Las tapa el ordenador. */
    '  if(uNight > .01){',
    '    vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    '#ifdef CACHE',
    '    float tObj = texelFetch(uGeo, ivec2(gl_FragCoord.xy), 0).y;',
    '    if(tObj < 0.) tObj = 1e4;',
    '#else',
    '    float base = uBase;',
    '    vec3 ta = vec3(0., base + 1.02, 0.);',
    '    vec3 ro = vec3(2.2, base + .62, -11.5);',
    '    vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '    vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);',
    '    float tObj = 1e4;',
    '    float t0 = sph(ro, rd, vec3(0., base + 1.02 * CS, 0.), 1.95 * CS);',
    '    if(t0 >= 0.){',
    '      float tt = t0;',
    '      for(int i = 0; i < 48; i++){',
    '        float d = computer(toLocal(ro + rd * tt, base));',
    '        if(d < .003){ tObj = tt; break; }',
    '        tt += d * CS;',
    '        if(tt > t0 + 5. * CS) break;',
    '      }',
    '    }',
    '#endif',
    /* Cada una: un punto vivo, un halo, un resplandor amplio y la estela de por dónde acaba */
    /* de pasar. Las que vuelan pegadas a la cámara salen desenfocadas, como discos de luz. */
    '    vec3 glow = vec3(0.);',
    '    for(int i = 0; i < FF_N; i++){',
    '      vec2 d = uv - uFly[i].xy;',
    '      float k = uFly[i].z;',
    '      float d2 = dot(d, d) * k * k;',
    /* A esta distancia ya no llega ni el resplandor amplio ni la estela; o la tapa el ordenador */
    /* (las que quedan detrás de la cámara traen una distancia enorme). */
    '      if(d2 > .25 || uFly[i].w >= tObj) continue;',
    '      vec3 tint = mix(vec3(.72, 1., .30), vec3(1., .86, .34), hash(vec2(float(i), 2.9)));',
    '      float g = 1.5 * exp(-d2 / .00042) + .30 * exp(-d2 / .0055) + .040 * exp(-d2 / .070);',
    /* Estela. */
    '      vec2 ab = uFlyB[i].xy;',
    '      float h = clamp(dot(d, ab) / max(dot(ab, ab), 1e-7), 0., 1.);',
    '      vec2 dt = d - ab * h;',
    '      g += .34 * exp(-dot(dt, dt) * k * k / .00050) * (1. - h) * (1. - h);',
    /* Desenfoque de las cercanas: un disco suave con el borde algo más marcado. */
    '      float blur = uFlyB[i].z;',
    '      if(blur > 0.){',
    '        float rr = length(d) / blur;',
    '        g = g * .35 + (1. - smoothstep(.55, 1., rr)) * (.13 + .07 * smoothstep(.55, .95, rr));',
    '      }',
    '      glow += tint * g * uFlyB[i].w;',
    '    }',
    '    col += min(glow, vec3(1.)) * smoothstep(.35, 1., uNight);',
    '  }',
    /* Donde no hay nada (casi toda la pantalla), ni se escribe. */
    '  if(alpha <= 0. && col == vec3(0.)) discard;',
    '  fragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  /* Escalones de calidad, del mejor al más ligero. Cada equipo empieza en el mejor que aguanta
     (se mide, ver measure()) y baja si aun así va justo.
     - side: lado mayor del lienzo, en píxeles; por encima de esto se estira.
     - part: qué parte de las briznas se pinta (las que quedan, más anchas).
     - tall: briznas de cuatro tramos (true) o de dos.
     - fps: fotogramas por segundo.
     - lit: cuántas luciérnagas alumbran la hierba (se ven todas siempre).
     - sharp: enfoque del cerezo. */
  const LEVELS = [
    {side:1920, part:1, tall:true, fps:30, lit:40, sharp:1},
    {side:1600, part:0.72, tall:true, fps:30, lit:40, sharp:1},
    {side:1366, part:0.5, tall:true, fps:30, lit:24, sharp:1},
    {side:1152, part:0.34, tall:false, fps:30, lit:16, sharp:0},
    {side:960, part:0.22, tall:false, fps:30, lit:8, sharp:0},
    {side:800, part:0.14, tall:false, fps:20, lit:0, sharp:0}
  ];
  /* Las imágenes de espera (ver WAIT): una de noche y otra de atardecer. Sus medidas y dónde
     cae en ellas el ordenador están en src/boot.js (window.__authPoster), que es quien las
     pone de fondo desde el primer fotograma. Abarcan más ancho que cualquier ventana; lo poco
     que pueda faltar por arriba es cielo y se estira. Se generan con
     Workhub.views.authScene.poster(true | false). */
  const POSTER = window.__authPoster;
  /* La pantalla de acceso no se ve: ni oculta ni enseñada antes de tiempo (auth-early). */
  const away = (screen) => screen.hidden && !document.documentElement.classList.contains('auth-early');
  /* Qué parte del tiempo de cada fotograma puede llevarse la escena, como mucho: el resto es
     para el navegador, que el formulario tiene que seguir yendo fino. */
  const BUDGET = 0.62;
  /* Desde /app/. La imagen (2048x1024) trae dos capas del mismo encuadre, una al lado de la
     otra: a la izquierda la madera y a la derecha las flores. */
  const TREE_URL = '../assets/img/sakura.webp';
  /* Briznas de hierba. Se reparten en un abanico delante de la cámara, muchas más cerca que
     lejos (de lejos cada una se ensancha y cubre más). Si el equipo va justo se pinta solo
     una parte (LEVELS): salen en orden al azar, así que cualquier tramo inicial cubre toda la
     colina; antes de subirlas, las de cada escalón se ordenan de cerca a lejos (nearFirst). */
  const BLADES = 420000;
  /* La cámara de la escena, vista desde arriba: dónde está y hacia dónde mira. */
  const CAM_X = 2.2, CAM_Z = -11.5, CAM_YAW = Math.atan2(-2.2, 11.5);

  function blades(){
    const data = new Float32Array(BLADES * 4);
    /* Azar con semilla: la colina es la misma en cada visita. */
    let seed = 20261004;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const far = new Float32Array(BLADES);
    for(let i = 0; i < BLADES; i++){
      const r = 0.7 + 27 * Math.pow(rnd(), 1.32);
      const a = CAM_YAW + (rnd() - 0.5) * 1.7;
      data[i * 4] = CAM_X + Math.sin(a) * r;
      data[i * 4 + 1] = CAM_Z + Math.cos(a) * r;
      data[i * 4 + 2] = rnd();
      data[i * 4 + 3] = rnd();
      far[i] = r;
    }
    return {data, far};
  }
  /* Las primeras count briznas (las que pinta un escalón), ordenadas de cerca a lejos. Así las
     de delante se pintan antes y la tarjeta descarta sin colorear casi todo lo que queda tapado
     detrás: pintadas al azar, la mitad del trabajo de la hierba era colorear briznas que luego
     no se veían. La imagen es la misma (quién tapa a quién lo decide la profundidad, no el
     orden). Se ordenan por cajones de distancia, que es inmediato. */
  function nearFirst(field, count){
    const SLOTS = 4096, heads = new Int32Array(SLOTS + 1), out = new Float32Array(count * 4);
    const slot = (i) => Math.min(SLOTS - 1, Math.floor((field.far[i] - 0.7) / 27 * SLOTS));
    for(let i = 0; i < count; i++) heads[slot(i) + 1]++;
    for(let k = 0; k < SLOTS; k++) heads[k + 1] += heads[k];
    for(let i = 0; i < count; i++) out.set(field.data.subarray(i * 4, i * 4 + 4), heads[slot(i)]++ * 4);
    return out;
  }

  /* Arbolado lejano: entre 30 y 95 unidades de la cámara, a manchas (bosquetes) y ordenado
     de lejos a cerca, porque se pinta con transparencia en los bordes. Cada árbol: raíz (x, z),
     azar y tipo (0 redondo, 1 ciprés, 2 cerezo en flor). */
  const TREES = 620;
  function trees(){
    let seed = 7741;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    /* Unos cuantos centros de bosquete; los árboles caen cerca de alguno. */
    const groves = [];
    for(let i = 0; i < 46; i++){
      const r = 30 + 62 * Math.pow(rnd(), 1.2), a = CAM_YAW + (rnd() - 0.5) * 1.5;
      groves.push([CAM_X + Math.sin(a) * r, CAM_Z + Math.cos(a) * r, 1.5 + rnd() * 5]);
    }
    const list = [];
    for(let i = 0; i < TREES; i++){
      const g = groves[Math.floor(rnd() * groves.length)];
      const a = rnd() * Math.PI * 2, d = g[2] * Math.sqrt(rnd());
      const x = g[0] + Math.cos(a) * d, z = g[1] + Math.sin(a) * d * 1.6;
      const k = rnd();
      list.push([x, z, rnd(), k < 0.62 ? 0 : (k < 0.86 ? 1 : 2)]);
    }
    const far = (t) => (t[0] - CAM_X) * (t[0] - CAM_X) + (t[1] - CAM_Z) * (t[1] - CAM_Z);
    list.sort((p, q) => far(q) - far(p));
    const data = new Float32Array(TREES * 4);
    list.forEach((t, i) => data.set(t, i * 4));
    return data;
  }

  /* Luciérnagas: las mueve este código (no el sombreador) y pasa sus posiciones a las pasadas
     que las necesitan: la escena y la hierba, para la luz que dan; lo de delante, para
     pintarlas. Tres grupos: las de la colina, unas pocas lejanas y otras pocas que pasan
     pegadas a la cámara. Cada una tiene su casa, su manera de vagar y su ritmo de destello.
     OJO: TREE_Z y TREE_H repiten las constantes del sombreador. */
  const FIREFLIES = 40, TREE_Z = -2.2, TREE_H = 1.8, CAM_Y = 2.65;
  const flies = (function(){
    let seed = 90210;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const list = [];
    for(let i = 0; i < FIREFLIES; i++){
      const kind = i < 32 ? 0 : (i < 38 ? 1 : 2);
      const home = kind === 0 ? [-9.5 + 18.5 * rnd(), -8.5 + 13.5 * rnd()] : (kind === 1 ? [-7 + 23 * rnd(), 8 + 18 * rnd()] : [0.4 + 3.6 * rnd(), -10.1 + 1.5 * rnd()]);
      list.push({
        kind, home,
        reach: kind === 2 ? 0.5 + 0.5 * rnd() : 1.0 + 1.8 * rnd(),
        up: kind === 0 ? 0.42 + 0.9 * rnd() : (kind === 1 ? 1.0 + 1.8 * rnd() : -0.30 + 0.5 * rnd()),
        f: [0.13 + 0.16 * rnd(), 0.31 + 0.25 * rnd(), 0.71 + 0.5 * rnd(), 0.11 + 0.15 * rnd(), 0.37 + 0.22 * rnd(), 0.45 + 0.4 * rnd()],
        p: [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283],
        rate: 0.10 + 0.11 * rnd(), phase: rnd(), dim: 0.10 + 0.14 * rnd()
      });
    }
    return list;
  })();
  /* Altura aproximada del suelo (sin el ruido fino): la misma idea que terrain() en el sombreador. */
  function ground(x, z, tree){
    const r2 = x * x + z * z;
    const st = (a, b, v) => { const k = Math.min(Math.max((v - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); };
    let h = 1.5 * Math.exp(-r2 / 30) + 0.6 * Math.sin(x * 0.23 + 1.3) * Math.cos(z * 0.19 + 0.4);
    h += 0.42 * st(1.5, 22, r2) - st(2, -9, z) * 1.1;
    const dx = x - tree[0], dz = z - tree[1];
    const k = Math.exp(-(dx * dx + dz * dz) / 14);
    return (h + 0.55 * k) * (1 - k * k) + TREE_H * k * k;
  }
  /* Posición (x, y, z) y brillo de la luciérnaga i en el instante t. */
  function fly(i, t, tree, out, at){
    const q = flies[i], f = q.f, p = q.p;
    /* Vaga en curvas: dos vaivenes lentos y uno rápido y corto, que es el que la hace dudar. */
    const x = q.home[0] + q.reach * (Math.sin(t * f[0] + p[0]) + 0.45 * Math.sin(t * f[1] + p[1]) + 0.12 * Math.sin(t * f[2] * 2.3 + p[2]));
    const z = q.home[1] + q.reach * (Math.cos(t * f[3] + p[3]) + 0.45 * Math.sin(t * f[4] + p[4]) + 0.12 * Math.cos(t * f[2] * 1.9 + p[5]));
    const bob = 0.20 * Math.sin(t * f[5] + p[5]) + 0.07 * Math.sin(t * f[2] * 2.7 + p[0]);
    const y = (q.kind === 2 ? CAM_Y : Math.max(ground(x, z, tree), 0.7)) + q.up + bob;
    /* Destello: sube rápido, se apaga despacio y pasa un rato casi a oscuras. */
    const ph = (t * q.rate + q.phase) % 1;
    const rise = Math.min(ph / 0.07, 1), fall = 1 - Math.min(Math.max((ph - 0.12) / 0.6, 0), 1);
    const flash = rise * rise * (3 - 2 * rise) * fall * fall;
    out[at] = x; out[at + 1] = y; out[at + 2] = z;
    out[at + 3] = (q.dim + (1 - q.dim) * flash) * (q.kind === 2 ? 0.55 : 1);
  }

  /* Pétalos del cerezo: caen despacio y el viento los lleva hacia la derecha. Para cada uno,
     dónde está (en alturas de pantalla), cómo está girado (coseno y seno) y cuánto se ve: entra
     y sale poco a poco. asp: ancho entre alto del lienzo. */
  const PETALS = 22;
  const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  function petals(t, asp, out, alpha){
    const st = (a, b, v) => { const k = Math.min(Math.max((v - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); };
    for(let i = 0; i < PETALS; i++){
      const sp = 0.028 + hash(i, 2.2) * 0.030;
      const v = hash(i, 9.1) + t * sp, ph = v - Math.floor(v);
      const ang = t * (0.6 + hash(i, 5.5)) + i;
      out[i * 4] = -0.05 + hash(i, 4.7) * 0.30 * asp + ph * (0.55 + hash(i, 6.3) * 0.5) * asp + 0.020 * Math.sin(t * 0.9 + i * 3.1);
      out[i * 4 + 1] = 0.95 - ph * 1.05 + 0.020 * Math.cos(t * 1.3 + i * 1.7);
      out[i * 4 + 2] = Math.cos(ang);
      out[i * 4 + 3] = Math.sin(ang);
      alpha[i] = st(0, 0.08, ph) * (1 - st(0.85, 1, ph));
    }
  }

  /* terrain(vec2(0.)) del sombreador: la altura del suelo bajo el ordenador. En ese punto todos
     los términos con ruido valen cero, así que sale con estas pocas cuentas. */
  function baseHeight(tree){
    const st = (a, b, v) => { const k = Math.min(Math.max((v - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); };
    const h = 1.5 + 0.6 * Math.sin(1.3) * Math.cos(0.4) - st(2, -9, 0) * 1.1 - 2.6 * Math.exp(-(6.75 * 6.75 + 27 * 27) / 110);
    const k = Math.exp(-(tree[0] * tree[0] + tree[1] * tree[1]) / 14);
    return (h + 0.55 * k) * (1 - k * k) + TREE_H * k * k;
  }

  /* Dónde va cada cosa, en píxeles de pantalla. Se calcula una vez por tamaño de ventana y
     no en cada fotograma: si siguiera a la tarjeta, la escena entera (y con ella el árbol)
     daría saltos cada vez que la tarjeta se anima o cambia de alto. Por eso tampoco se usa
     getBoundingClientRect, que incluye las transformaciones de la animación de entrada.
     - fx, fy: centro del panel de cristal, donde se coloca el ordenador.
     - tx: dónde cae el tronco del cerezo, cerca del borde izquierdo.
     - ts: tamaño del cerezo; entero en horizontal, más pequeño en pantallas estrechas.
     - base: altura del suelo bajo el ordenador (uBase). */
  function layoutOf(screen, focusEl, w, h){
    /* Dónde va el ordenador y dónde empieza la tarjeta: la cuenta es de src/boot.js, que la
       necesita antes para colocar la imagen de espera. */
    const at = POSTER.focus(screen, focusEl, w, h);
    return placeAt(w, h, at.fx, at.fy, Math.max(at.left * 0.36, h * 0.05), Math.min(Math.max(w / h * 0.8, 0.6), 1));
  }
  function placeAt(w, h, fx, fy, tx, ts){
    /* Dónde queda plantado el cerezo en la escena: la misma cuenta que setupTree() en el
       sombreador (el rayo que pasa por tx, hasta la distancia TREE_Z). */
    const fl = Math.hypot(2.2, 0.4, 11.5), fw = [-2.2 / fl, 0.4 / fl, 11.5 / fl];
    const rl = Math.hypot(fw[2], fw[0]), rt = [fw[2] / rl, 0, -fw[0] / rl];
    const k = (tx - fx) / h;
    const dx = fw[0] * 1.5 + k * rt[0], dz = fw[2] * 1.5 + k * rt[2];
    const tree = [2.2 + dx * (TREE_Z + 11.5) / dz, TREE_Z];
    return {w, h, fx, fy, tx, ts, tree, base: baseHeight(tree)};
  }

  /* La imagen de espera (ver WAIT y POSTER), de fondo tras el lienzo y colocada con la misma
     cuenta que la escena. La pone src/boot.js desde el primer fotograma; aquí se mantiene al
     día (tamaño de ventana, tema, la tarjeta que aparece). Se queda puesta: es lo que se ve
     hasta que el lienzo pinta (entra sobre ella con el fundido de auth.css, porque a la imagen
     le falta el revelado final) y lo que queda si no hay WebGL o el lienzo se pierde. */
  function backdrop(screen){
    const root = document.documentElement;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const paint = () => { POSTER.paint(); };
    paint();
    window.addEventListener('resize', paint);
    new MutationObserver(paint).observe(screen, {attributes:true, attributeFilter:['hidden']});
    new MutationObserver(paint).observe(root, {attributes:true, attributeFilter:['data-theme']});
    if(darkQuery.addEventListener) darkQuery.addEventListener('change', paint);
  }

  /* La escena no se prepara hasta que la pantalla de acceso se ve por primera vez: quien entra
     con la sesión ya iniciada no paga la compilación de los sombreadores. */
  function start(canvas, screen, focusEl){
    let done = false;
    const go = () => {
      /* Hasta que la tarjeta se ve de verdad, no: con la pantalla enseñada a medias (auth-early)
         basta la imagen de fondo, y arrancar antes retrasaba medio segundo el formulario. */
      if(done || screen.hidden || document.hidden) return;
      done = true;
      watch.disconnect();
      document.removeEventListener('visibilitychange', go);
      requestAnimationFrame(() => setTimeout(() => boot(canvas, screen, focusEl), 0));
    };
    /* La imagen de fondo sí, desde ya: no cuesta nada. */
    backdrop(screen);
    const watch = new MutationObserver(go);
    watch.observe(screen, {attributes:true, attributeFilter:['hidden']});
    document.addEventListener('visibilitychange', go);
    requestAnimationFrame(go);
    return true;
  }

  function boot(canvas, screen, focusEl){
    let gl = null;
    try{ gl = canvas.getContext('webgl2', {antialias:true, alpha:false, depth:true, stencil:false}); }catch(e){}
    if(!gl) return false;

    /* Lo que no cambia de un fotograma a otro (GEO) se guarda en imágenes de números con
       decimales. Si el navegador no deja pintar en ellas, se calcula en cada fotograma. */
    const cache = (function(){
      if(!gl.getExtension('EXT_color_buffer_float')) return false;
      const tex = gl.createTexture(), fbo = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 4, 0, gl.RGBA, gl.FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return ok;
    })();
    const DEF = cache ? '#define CACHE\n' : '';
    /* Los sombreadores son largos y compilarlos tarda (segundos la primera vez, hasta que el
       navegador los guarda): se piden todos y, si el navegador sabe compilar en segundo plano
       (KHR_parallel_shader_compile), se espera sin parar la página; mientras, se ve el degradado
       de cielo. Preguntar antes de tiempo por el resultado es lo que la dejaba congelada.
       feedback: nombres de lo que el sombreador de vértices guarda (transform feedback). */
    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    function prepare(vsrc, fsrc, feedback){
      const prog = gl.createProgram();
      [[gl.VERTEX_SHADER, vsrc], [gl.FRAGMENT_SHADER, fsrc]].forEach((part) => {
        const sh = gl.createShader(part[0]);
        gl.shaderSource(sh, part[1]);
        gl.compileShader(sh);
        gl.attachShader(prog, sh);
      });
      if(feedback) gl.transformFeedbackVaryings(prog, feedback, gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(prog);
      return prog;
    }
    function finish(prog){
      if(!prog || !gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      const U = {};
      ['uRes', 'uTime', 'uFocus', 'uNight', 'uDay', 'uDawn', 'uMouse', 'uUI', 'uText', 'uTextW', 'uTree', 'uTreeOn', 'uTreeX', 'uTreeS', 'uWide', 'uFF', 'uFFp', 'uBase', 'uFFLit', 'uSharp', 'uGeo', 'uShade', 'uMode', 'uPetal', 'uPetalA', 'uRaw', 'uPoster', 'uPosterMap', 'uFade', 'uScene', 'uFly', 'uFlyB'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
      return {prog, U};
    }
    /* Lo que se enseña mientras tanto (ver WAIT), en dos programas que se piden antes que nada
       para que acaben los primeros: la imagen sola, que es casi inmediato, y la imagen con la
       pantalla del ordenador en vivo. Si no se puede compilar en segundo plano no hay espera
       que cubrir. */
    const holds = parallel ? [prepare(VERT, HEAD + '#define LIVE\n' + COMMON + '\n' + SCREEN + '\n' + TREE_FN + '\n' + WAIT), prepare(VERT, HEAD + COMMON + '\n' + WAIT)] : [];
    const held = [null, null];
    /* Por orden: hierba (dos pasos), arbolado, lo de delante, lo que no cambia, lo fijo de la
       hierba y, al final, la
       escena: cielo, suelo, carcasa, pantalla y lo que se pone en cada fotograma (ver FRAG) o,
       sin CACHE, un solo programa con todo. */
    const part = (n) => prepare(VERT, HEAD + DEF + '#define PART ' + n + '\n' + COMMON + '\n' + GEO + '\n' + TREE_FN + '\n' + FRAG);
    const queue = [
      prepare(HEAD + COMMON + '\n' + GRASS_SIM, HEAD + 'out vec4 c;void main(){c=vec4(0.);}', ['oA', 'oLight', 'oFog', 'oExtra']),
      prepare(HEAD + COMMON + '\n' + GRASS_VERT, HEAD + COMMON + '\n' + GRASS_FRAG),
      prepare(HEAD + COMMON + '\n' + TREES_VERT, HEAD + COMMON + '\n' + TREES_FRAG),
      prepare(VERT, HEAD + DEF + COMMON + '\n' + OVER),
      cache ? prepare(VERT, HEAD + COMMON + '\n' + GEO + '\n' + BAKE) : null,
      prepare(HEAD + COMMON + '\n' + GRASS_BASE, HEAD + 'out vec4 c;void main(){c=vec4(0.);}', ['oB0', 'oB1', 'oB2'])
    ].concat(cache ? [part(1), part(2), part(3), prepare(VERT, HEAD + COMMON + '\n' + SCREEN + '\n' + GLASS), prepare(VERT, HEAD + COMMON + '\n' + TREE_FN + '\n' + COMP)] : [part(0)]);
    const compiled = () => !parallel || gl.isContextLost() || queue.every((p) => !p || gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR));
    setup(gl, canvas, screen, focusEl, cache, {
      /* Hay espera que cubrir: se compila en segundo plano. */
      waits: !!parallel,
      /* El programa de la imagen de espera: con la pantalla en vivo en cuanto está; antes, el
         de la imagen sola; null si aún no hay ninguno. */
      hold(){
        holds.forEach((p, i) => {
          if(p && gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR)){ held[i] = finish(p); holds[i] = null; }
        });
        return held[0] || held[1];
      },
      /* Avisa cuando todos los programas están compilados (con la lista, por orden). */
      linked(done){
        const wait = () => {
          if(!compiled()){ setTimeout(wait, 40); return; }
          const list = queue.map(finish);
          if(!list.some((p, i) => !p && (i !== 4 || cache))) done(list);
        };
        setTimeout(wait, 0);
      }
    });
    return true;
  }

  function setup(gl, canvas, screen, focusEl, cache, kit){
    /* Los programas llegan cuando acaban de compilarse (live); hasta entonces, la imagen de espera. */
    let sim = null, grass = null, wood = null, over = null, bake = null, grassBase = null, scenes = [], live = false;
    kit.linked((list) => {
      sim = list[0]; grass = list[1]; wood = list[2]; over = list[3]; bake = list[4]; grassBase = list[5]; scenes = list.slice(6);
      plant();
      live = true;
      last = 0;
      wake();
    });

    /* Un triángulo que cubre la pantalla, para la escena y para lo de delante. */
    const fullVao = gl.createVertexArray();
    gl.bindVertexArray(fullVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    /* La hierba. instBuf: la raíz y el azar de cada brizna. simBuf: lo que GRASS_SIM calcula
       para cada una en cada fotograma (cuatro vec4). */
    /* baseBuf: lo que GRASS_BASE calcula para cada una y no cambia (tres vec4). grown: para
       cuántas briznas y con qué luz está calculado. field: todas las briznas, en su orden al
       azar; sown: cuántas hay subidas a instBuf, ordenadas de cerca a lejos. */
    const instBuf = gl.createBuffer(), simBuf = gl.createBuffer(), baseBuf = gl.createBuffer();
    let grown = 0, grownNight = -1, grownDay = -1, grownWait = 0;
    /* Sembrar las briznas lleva unas décimas: se hace aparte, mientras se compila (plant). */
    let planted = false, field = null, sown = 0;
    function plant(){
      if(planted) return;
      planted = true;
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      field = blades();
      gl.bufferData(gl.ARRAY_BUFFER, BLADES * 16, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, simBuf);
      gl.bufferData(gl.ARRAY_BUFFER, BLADES * 64, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, baseBuf);
      gl.bufferData(gl.ARRAY_BUFFER, BLADES * 48, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    setTimeout(plant, 400);
    const baseVao = gl.createVertexArray();
    gl.bindVertexArray(baseVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    const simVao = gl.createVertexArray();
    gl.bindVertexArray(simVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, baseBuf);
    for(let i = 0; i < 3; i++){
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 48, i * 16);
    }
    const feedback = gl.createTransformFeedback();
    /* La brizna: una cinta que acaba en punta (lado, altura). */
    function bladeVao(shape){
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shape), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, simBuf);
      for(let i = 0; i < 4; i++){
        gl.enableVertexAttribArray(2 + i);
        gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 64, i * 16);
        gl.vertexAttribDivisor(2 + i, 1);
      }
      return {vao, count:shape.length / 2};
    }
    /* De cuatro tramos y, para los equipos justos, de dos. */
    const bladeTall = bladeVao([-1, 0, 1, 0, -1, 0.3, 1, 0.3, -1, 0.55, 1, 0.55, -1, 0.78, 1, 0.78, 0, 1]);
    const bladeShort = bladeVao([-1, 0, 1, 0, -1, 0.5, 1, 0.5, 0, 1]);

    /* El árbol lejano: un rectángulo (x de -1 a 1, y de 0 a 1). */
    const woodVao = gl.createVertexArray();
    gl.bindVertexArray(woodVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, trees(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const ffNow = new Float32Array(FIREFLIES * 4), ffBefore = new Float32Array(FIREFLIES * 4);
    const petalNow = new Float32Array(PETALS * 4), petalAlpha = new Float32Array(PETALS);
    /* Las luciérnagas llevadas a la pantalla, para pintarlas (ver OVER): con la misma cámara que
       los sombreadores, dónde cae cada una (en alturas de pantalla desde el ordenador), su
       escala y su distancia; y el tramo hasta donde estaba hace un instante (la estela), cuánto
       se desenfoca por cercana y cuánto brilla. Hacerlo por píxel era repetir las mismas
       cuentas dos millones de veces. */
    const flyA = new Float32Array(FIREFLIES * 4), flyB = new Float32Array(FIREFLIES * 4);
    function flies2d(){
      const ro = [2.2, place.base + 0.62, -11.5];
      let fw = [-ro[0], place.base + 1.02 - ro[1], -ro[2]];
      const fl = Math.hypot(fw[0], fw[1], fw[2]);
      fw = [fw[0] / fl, fw[1] / fl, fw[2] / fl];
      const rl = Math.hypot(fw[2], fw[0]), rt = [fw[2] / rl, 0, -fw[0] / rl];
      const up = [fw[1] * rt[2], fw[2] * rt[0] - fw[0] * rt[2], -fw[1] * rt[0]];
      const dot = (a, x, y, z) => a[0] * x + a[1] * y + a[2] * z;
      for(let i = 0; i < FIREFLIES; i++){
        const o = i * 4;
        const x = ffNow[o] - ro[0], y = ffNow[o + 1] - ro[1], z = ffNow[o + 2] - ro[2];
        const zv = dot(fw, x, y, z);
        if(!(zv > 0.25)){ flyA[o] = 0; flyA[o + 1] = 0; flyA[o + 2] = 0; flyA[o + 3] = 1e9; continue; }
        const cx = 1.5 * dot(rt, x, y, z) / zv, cy = 1.5 * dot(up, x, y, z) / zv;
        const px = ffBefore[o] - ro[0], py = ffBefore[o + 1] - ro[1], pz = ffBefore[o + 2] - ro[2];
        const zp = Math.max(dot(fw, px, py, pz), 0.25);
        flyA[o] = cx; flyA[o + 1] = cy; flyA[o + 2] = zv / 1.5; flyA[o + 3] = Math.hypot(x, y, z);
        flyB[o] = 1.5 * dot(rt, px, py, pz) / zp - cx;
        flyB[o + 1] = 1.5 * dot(up, px, py, pz) / zp - cy;
        flyB[o + 2] = Math.min(Math.max((3 - zv) * 0.007, 0), 0.011);
        flyB[o + 3] = ffNow[o + 3];
      }
    }

    /* Las imágenes de lo que no cambia (ver GEO y BAKE), del tamaño del lienzo. Van siempre en
       las unidades de textura 2 y 3. stale: hay que volver a calcularlas. */
    const geoTex = gl.createTexture(), shadeTex = gl.createTexture();
    const geoFbo = gl.createFramebuffer(), shadeFbo = gl.createFramebuffer();
    /* La imagen intermedia donde pintan las partes de la escena (ver FRAG), en la unidad 5.
       turn: a cuál de las dos lentas, cielo o suelo, le toca en este fotograma. */
    const sceneTex = gl.createTexture(), sceneFbo = gl.createFramebuffer();
    let turn = 0;
    let stale = true, litNight = -1, litDay = -1, litWait = 0;
    function target(unit, tex, fbo, format, kind, type){
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, canvas.width, canvas.height, 0, kind, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
    }
    /* mode 0: dónde toca cada rayo y la pendiente del suelo. mode 1: la sombra en ese punto. */
    function bakePass(mode, time){
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      uniforms(bake, time);
      gl.uniform1f(bake.U.uMode, mode);
      /* Al pintar uGeo no se puede leer de ella a la vez: se apunta a otra unidad (no se usa). */
      gl.uniform1i(bake.U.uGeo, mode ? 2 : 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, mode ? shadeFbo : geoFbo);
      gl.bindVertexArray(fullVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* El cerezo: un modelo 3D renderizado aparte a una imagen con transparencia. Hasta que
       llega, la escena se pinta sin él. */
    let treeReady = false, treeFade = 0;
    const treeTex = gl.createTexture();
    const treeImg = new Image();
    treeImg.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, treeTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, treeImg);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      treeReady = true;
      last = 0;
      wake();
    };
    treeImg.src = TREE_URL;

    /* Lo que se escribe en el formulario (correo o nombre), como texto para la pantalla del
       ordenador: se pinta en un lienzo aparte y se sube como imagen cada vez que cambia. Si no
       cabe, se ve el final, como en un campo de verdad. La contraseña no pasa por aquí. */
    const textCanvas = document.createElement('canvas');
    textCanvas.width = 512; textCanvas.height = 96;
    /* willReadFrequently: el lienzo se queda en memoria y subirlo como imagen es inmediato (si
       no, la primera vez tardaba cerca de un segundo). */
    const textCtx = textCanvas.getContext('2d', {willReadFrequently:true});
    const textTex = gl.createTexture();
    let textW = -1;
    function setText(value){
      if(!textCtx) return;
      if(value === null){ textW = -1; return; }
      const W = textCanvas.width, H = textCanvas.height;
      textCtx.clearRect(0, 0, W, H);
      textCtx.font = '600 52px ui-monospace, Consolas, "Courier New", monospace';
      textCtx.textBaseline = 'middle';
      textCtx.fillStyle = '#fff';
      const w = textCtx.measureText(value).width;
      const room = W - 28;
      textCtx.fillText(value, w > room ? room - w : 0, H / 2 + 3);
      textW = Math.min(w, room) / W;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
    }
    /* Hasta que se escriba algo, una imagen vacía. */
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);

    const root = document.documentElement;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const stillQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isDark = () => { const a = root.getAttribute('data-theme'); return a ? a === 'dark' : darkQuery.matches; };
    /* Sin tarjeta gráfica (el navegador pinta WebGL con el procesador) cada fotograma tarda
       muchísimo y bloquearía el formulario: se pinta una sola imagen, pequeña, y se deja quieta. */
    const software = (function(){
      try{
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        return /swiftshader|llvmpipe|software|basic render/i.test(name);
      }catch(e){ return false; }
    })();
    const saver = !!(navigator.connection && navigator.connection.saveData);
    /* frozen: el equipo no puede con la animación ni en la calidad más baja; se queda la imagen. */
    let frozen = software || saver;
    const isStill = () => frozen || stillQuery.matches || root.getAttribute('data-motion') === 'reduced';

    /* El tema claro es siempre el atardecer y el oscuro, la noche. El sombreador sabe pintar
       también el amanecer y el pleno día, pero el dueño prefirió el atardecer como modo claro:
       esos momentos solo se ven fijando una hora a mano (authScene.hour(13), para probar). */
    const SUNSET = 20;
    let hourFixed = null;
    function hour(){
      return hourFixed !== null ? hourFixed : SUNSET;
    }
    const smooth = (a, b, v) => { const k = Math.min(Math.max((v - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); };
    const dayAt = (h) => smooth(7.5, 10, h) * (1 - smooth(16.5, 19, h));
    const dawnAt = (h) => (h >= 4.5 && h < 12 ? 1 : 0);

    let scale = 1, night = isDark() ? 1 : 0, day = dayAt(hour()), dawn = dawnAt(hour());
    let raf = 0, last = 0, prev = 0, t0 = performance.now();
    /* Calidad (ver LEVELS). Se empieza por la que el equipo aguanta, que se mide antes de enseñar
       el primer fotograma animado (measure); si después la tarjeta va justa, se baja un escalón,
       y si ni en el más ligero llega, la escena se queda quieta. Sin tarjeta gráfica no se mide:
       la imagen fija se pinta en el escalón más ligero y pequeña. cost: lo que midió measure(),
       ronda a ronda (escalón y milisegundos por fotograma). */
    let level = software ? LEVELS.length - 1 : 0, measured = software, measuring = false, cost = null;
    let slow = 0, counted = 0, settle = 0, shown = false;
    /* A cuántos fotogramas por segundo se pinta: los del escalón o, si el equipo va sobrado
       (fluid, lo decide measure), 60. */
    let rate = LEVELS[level].fps, fluid = false;
    /* Para medir: qué pasadas se pintan (1 escena, 2 arbolado, 4 hierba, 8 lo de delante) y con
       qué brizna (null: la del escalón). */
    let passes = 15, tallForced = null;

    /* El cursor sobre la escena (en píxeles de pantalla) y con cuánta fuerza aparta la hierba. */
    const mouse = {x:0, y:0, tx:0, ty:0, s:0, inside:false, moved:0};
    /* El formulario, para la pantalla del ordenador (ver signal()). */
    const ui = {chars:0, show:0, busy:0, res:0, tChars:0, tShow:0, tBusy:0, tRes:0};

    function resize(){
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      scale = Math.min(1, (software ? 720 : LEVELS[level].side) / Math.max(w, h));
      const cw = Math.max(2, Math.round(w * scale)), ch = Math.max(2, Math.round(h * scale));
      if(canvas.width !== cw || canvas.height !== ch){ canvas.width = cw; canvas.height = ch; stale = true; }
      gl.viewport(0, 0, cw, ch);
      if(!place || relayout || place.w !== w || place.h !== h){
        const at = layout(w, h);
        /* Solo se rehace lo que no cambia si de verdad se ha movido algo. */
        if(!place || at.w !== place.w || at.h !== place.h || at.fx !== place.fx || at.fy !== place.fy || at.tx !== place.tx){ place = at; stale = true; }
        relayout = false;
      }
    }
    function setLevel(l){
      level = Math.max(0, Math.min(LEVELS.length - 1, l | 0));
      rate = fluid ? 60 : LEVELS[level].fps;
      counted = 0; slow = 0;
      /* El primer fotograma tras el cambio vuelve a calcular lo que no cambia: no cuenta. */
      settle = performance.now() + 800;
      resize();
    }

    /* relayout: la tarjeta acaba de aparecer (la escena puede arrancar antes, con la pantalla
       de acceso enseñada a medias, ver auth-early): hay que volver a mirar dónde ha quedado. */
    let place = null, relayout = false;
    const layout = (w, h) => layoutOf(screen, focusEl, w, h);

    function uniforms(p, time){
      gl.useProgram(p.prog);
      gl.uniform2f(p.U.uRes, canvas.width, canvas.height);
      gl.uniform1f(p.U.uTime, time);
      gl.uniform2f(p.U.uFocus, place.fx * scale, (place.h - place.fy) * scale);
      gl.uniform1f(p.U.uNight, night);
      gl.uniform1f(p.U.uDay, day);
      gl.uniform1f(p.U.uDawn, dawn * (1 - day));
      gl.uniform3f(p.U.uMouse, mouse.x * scale, (place.h - mouse.y) * scale, mouse.s);
      gl.uniform4f(p.U.uUI, ui.chars, ui.show, ui.busy, ui.res);
      gl.uniform1f(p.U.uTreeX, place.tx * scale);
      gl.uniform1f(p.U.uTreeS, place.ts);
      gl.uniform1f(p.U.uBase, place.base);
      gl.uniform1i(p.U.uFFLit, posing ? 0 : LEVELS[level].lit);
      gl.uniform1f(p.U.uRaw, raw);
      if(p.U.uFF) gl.uniform4fv(p.U.uFF, ffNow);
      if(p.U.uFFp) gl.uniform4fv(p.U.uFFp, ffBefore);
    }

    /* Lo que avanza con el tiempo, lo use la escena o la imagen de espera. posing: se está
       generando una imagen de espera (poster): todo quieto, sin cerezo ni luciérnagas. */
    let still = false, time = 0, toNight = 0, toDay = 0, ease = null;
    let posing = false, raw = 0, nightFixed = null;
    function advance(now){
      still = isStill() || posing;
      /* Todo lo que cambia poco a poco avanza según el tiempo pasado, no por fotograma: dura lo
         mismo en un equipo rápido que en uno lento. */
      const dt = prev ? Math.min((now - prev) / 1000, 0.1) : 0;
      prev = now;
      ease = (cur, to, rate) => (still || Math.abs(to - cur) < 0.002 ? to : cur + (to - cur) * (1 - Math.exp(-dt * rate)));
      /* Cambiar de tema es un atardecer (o un amanecer) de un par de segundos. */
      toNight = nightFixed !== null ? nightFixed : (isDark() ? 1 : 0);
      toDay = dayAt(hour());
      night = ease(night, toNight, 1.9);
      day = ease(day, toDay, 1.5);
      dawn = ease(dawn, dawnAt(hour()), 1.5);
      mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-dt * 9));
      mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-dt * 9));
      mouse.s = still ? 0 : ease(mouse.s, mouse.inside ? (now - mouse.moved < 1500 ? 1 : 0.55) : 0, 4);
      ui.chars = ease(ui.chars, ui.tChars, 14);
      ui.show = ease(ui.show, ui.tShow, 6);
      ui.busy = ease(ui.busy, ui.tBusy, 7);
      /* El error es un golpe que se apaga solo; el acceso correcto se queda. */
      if(ui.tRes < 0) ui.tRes = Math.min(ui.tRes + dt * 1.4, 0);
      ui.res = ease(ui.res, ui.tRes, 9);
      time = still ? 12 : (now - t0) / 1000;
    }

    function draw(now){
      advance(now);
      const q = LEVELS[level];
      /* Las luciérnagas, ahora y hace un instante (para la estela). */
      for(let i = 0; i < FIREFLIES; i++){
        fly(i, time, place.tree, ffNow, i * 4);
        fly(i, time - 0.22, place.tree, ffBefore, i * 4);
      }

      /* Lo que no cambia: entero al cambiar el tamaño, y solo las sombras cuando se mueve el sol
         (al cambiar de tema; mientras dura, una vez de cada cuatro fotogramas, que el sol va
         despacio). */
      const fresh = stale;
      if(cache){
        const moving = night !== toNight || day !== toDay;
        if(stale){
          target(gl.TEXTURE2, geoTex, geoFbo, gl.RGBA32F, gl.RGBA, gl.FLOAT);
          target(gl.TEXTURE3, shadeTex, shadeFbo, gl.RG16F, gl.RG, gl.HALF_FLOAT);
          target(gl.TEXTURE5, sceneTex, sceneFbo, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
          bakePass(0, time);
          bakePass(1, time);
          litNight = night; litDay = day; litWait = 0;
        }else if((night !== litNight || day !== litDay) && (!moving || ++litWait >= 4)){
          bakePass(1, time);
          litNight = night; litDay = day; litWait = 0;
        }
      }
      stale = false;

      /* 1. La hierba, antes de pintarla: lo de cada brizna, guardado. No pinta nada. Lo que no
         cambia (baseBuf) solo se rehace al cambiar el tamaño, al entrar briznas nuevas (otro
         escalón) o al moverse el sol; lo demás (simBuf), en cada fotograma. */
      const count = Math.round(BLADES * q.part);
      const store = (p, vao, buf) => {
        gl.bindVertexArray(vao);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      };
      if(passes & 4){
        /* Las briznas de este escalón, de cerca a lejos (ver nearFirst). */
        if(sown !== count){
          gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, nearFirst(field, count));
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          sown = count; grown = 0;
        }
        const relit = night !== grownNight || day !== grownDay;
        if(fresh || count !== grown || (relit && (!(night !== toNight || day !== toDay) || ++grownWait >= 4))){
          uniforms(grassBase, time);
          store(grassBase, baseVao, baseBuf);
          grown = count; grownNight = night; grownDay = day; grownWait = 0;
        }
        uniforms(sim, time);
        gl.uniform1f(sim.U.uWide, 1 / Math.sqrt(q.part));
        store(sim, simVao, simBuf);
      }

      /* 2. La escena, que escribe también la profundidad. */
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, treeTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.activeTexture(gl.TEXTURE0);
      treeFade = treeReady && !posing ? ease(treeFade, 1, 2.6) : 0;
      gl.bindVertexArray(fullVao);
      const paint = (scene) => {
        uniforms(scene, time);
        gl.uniform1i(scene.U.uTree, 0);
        gl.uniform1i(scene.U.uText, 1);
        gl.uniform1f(scene.U.uTextW, textW);
        if(cache){
          gl.uniform1i(scene.U.uGeo, 2);
          gl.uniform1i(scene.U.uShade, 3);
        }
        gl.uniform1i(scene.U.uScene, 5);
        gl.uniform1f(scene.U.uSharp, q.sharp);
        gl.uniform1f(scene.U.uTreeOn, treeFade);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      if((passes & 1) && cache){
        /* Por partes, en la imagen intermedia: cada una pinta solo sus píxeles y los demás se
           quedan como estaban. La pantalla del ordenador, siempre (es lo que se mira al
           escribir); el cielo y el suelo, por turnos, y la carcasa, que apenas cambia (el
           piloto, el reflejo de la pantalla), con el cielo; salvo que haya que rehacerlo todo. */
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
        gl.disable(gl.DEPTH_TEST);
        paint(scenes[3]);
        if(fresh || still){ paint(scenes[0]); paint(scenes[1]); paint(scenes[2]); }
        else{
          paint(scenes[turn]);
          if(turn === 0) paint(scenes[2]);
          turn = 1 - turn;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(true);
      /* Al lienzo: la imagen intermedia con el cerezo y el revelado (o, sin CACHE, todo de una). */
      if(passes & 1) paint(scenes[cache ? 4 : 0]);

      /* 3. El arbolado lejano: con prueba de profundidad (lo tapan las lomas), pero sin
         escribirla, y con los bordes transparentes. */
      gl.depthFunc(gl.LESS);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      uniforms(wood, time);
      gl.bindVertexArray(woodVao);
      if(passes & 2) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, TREES);
      gl.disable(gl.BLEND);
      gl.depthMask(true);

      /* 4. La hierba, segundo paso: las cintas, delante o detrás de lo ya pintado según su
         profundidad. */
      if(passes & 4){
        const blade = (tallForced === null ? q.tall : tallForced) ? bladeTall : bladeShort;
        uniforms(grass, time);
        gl.bindVertexArray(blade.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, blade.count, count);
      }

      /* 5. Pétalos, pájaros y luciérnagas, por delante de todo. */
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      uniforms(over, time);
      if(cache) gl.uniform1i(over.U.uGeo, 2);
      petals(time, canvas.width / canvas.height, petalNow, petalAlpha);
      flies2d();
      gl.uniform4fv(over.U.uFly, flyA);
      gl.uniform4fv(over.U.uFlyB, flyB);
      gl.uniform4fv(over.U.uPetal, petalNow);
      gl.uniform1fv(over.U.uPetalA, petalAlpha);
      gl.bindVertexArray(fullVao);
      if(passes & 8) gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }

    /* La imagen de espera (ver WAIT), en la unidad de textura 4: la del tema que haya. veil:
       cuánto tapa todavía a la escena (1 hasta que llega; después se funde y se suelta). */
    const posterTex = gl.createTexture();
    let posterOk = false, posterDark = null, posterBusy = false, veil = 1, veilFrom = 0;
    function loadPoster(){
      const dark = isDark();
      if(!kit.waits || posterBusy || posterDark === dark || veil <= 0) return;
      posterBusy = true;
      const img = new Image();
      img.onload = () => {
        posterBusy = false;
        posterDark = dark;
        if(veil <= 0) return;
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, posterTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
        posterOk = true;
        last = 0;
        wake();
      };
      img.onerror = () => { posterBusy = false; posterDark = dark; };
      img.src = dark ? POSTER.night : POSTER.dusk;
    }
    /* Encima de lo que haya pintado, con esa opacidad. */
    function drawPoster(alpha){
      const p = kit.hold();
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      uniforms(p, time);
      gl.uniform1i(p.U.uPoster, 4);
      gl.uniform3f(p.U.uPosterMap, POSTER.fx, POSTER.fy, POSTER.h);
      gl.uniform1f(p.U.uFade, alpha);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(p.U.uText, 1);
      gl.uniform1f(p.U.uTextW, textW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, treeTex);
      gl.uniform1i(p.U.uTree, 0);
      gl.uniform1f(p.U.uTreeOn, treeFade);
      gl.uniform1f(p.U.uSharp, LEVELS[level].sharp);
      gl.bindVertexArray(fullVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
    /* Para generar las imágenes de espera: pinta la escena a su tamaño, con el ordenador en su
       sitio, quieta, sin cerezo, sin luciérnagas y sin el revelado final, y devuelve la imagen
       (WebP, como data:) con el cristal de la pantalla marcado en la transparencia. Hay que
       guardarla en assets/img/ (acceso-noche.webp con true, acceso-tarde.webp con false) y
       repetirlo si cambia el aspecto de la escena. */
    function poster(dark){
      if(!live) return null;
      const W = POSTER.w, H = POSTER.h, back = level;
      level = 0; scale = 1;
      canvas.width = W; canvas.height = H;
      gl.viewport(0, 0, W, H);
      place = placeAt(W, H, POSTER.fx, H - POSTER.fy, POSTER.fx + POSTER.tree * H, 1);
      posing = true; nightFixed = dark ? 1 : 0;
      const shot = (kind, which) => {
        raw = kind; passes = which; stale = true;
        draw(performance.now());
        draw(performance.now());
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const colour = shot(1, 7), glass = shot(2, 1);
      raw = 0; passes = 15; posing = false; nightFixed = null;
      level = back; place = null; stale = true;
      resize();
      last = 0;
      wake();
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const ctx = out.getContext('2d');
      const data = ctx.createImageData(W, H);
      for(let y = 0; y < H; y++){
        for(let x = 0; x < W; x++){
          const from = ((H - 1 - y) * W + x) * 4, to = (y * W + x) * 4;
          data.data[to] = colour[from]; data.data[to + 1] = colour[from + 1]; data.data[to + 2] = colour[from + 2];
          data.data[to + 3] = glass[from] > 127 ? 128 : 255;
        }
      }
      ctx.putImageData(data, 0, 0);
      return out.toDataURL('image/webp', 0.86);
    }

    /* Cuánto tarda de verdad pintar n fotogramas (readPixels obliga a la tarjeta a terminar
       antes de seguir), en milisegundos por fotograma. Para la página mientras dura: solo para
       las pruebas (bench). */
    const pixel = new Uint8Array(4);
    function timed(n){
      const from = performance.now();
      for(let i = 0; i < n; i++) draw(performance.now());
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return (performance.now() - from) / n;
    }
    /* Lo mismo sin parar la página: se le mandan los fotogramas a la tarjeta con una marca al
       final (fenceSync) y se mira cada poco si ya ha llegado a ella. Devuelve el total. */
    function gauge(n){
      return new Promise((resolve) => {
        const from = performance.now();
        for(let i = 0; i < n; i++) draw(performance.now());
        const flag = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        /* Estos fotogramas son de prueba: encima, la imagen de espera. */
        if(posterOk && veil > 0 && kit.hold()) drawPoster(1);
        gl.flush();
        const poll = () => {
          if(flag && gl.clientWaitSync(flag, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - from < 4000){ setTimeout(poll, 2); return; }
          if(flag) gl.deleteSync(flag);
          resolve(performance.now() - from);
        };
        setTimeout(poll, 0);
      });
    }
    /* Milisegundos por fotograma. Enterarse de que la tarjeta ha terminado lleva siempre unos
       milisegundos, sean los fotogramas que sean: se mide una tanda de tres y otra de uno y se
       mira la diferencia. La de uno se mide dos veces y vale la más corta: si sale inflada (al
       arrancar pasa), la cuenta daría un equipo más rápido de lo que es. */
    async function pace(){
      const a = await gauge(1), three = await gauge(3), b = await gauge(1);
      return Math.max((three - Math.min(a, b)) / 2, three / 6);
    }
    /* Lo que cuesta un escalón a este tamaño de ventana, en unidades que solo sirven para
       comparar unos con otros: lo que pesan sus píxeles más lo que pesan sus briznas. Ajustado
       con medidas en una gráfica integrada (Iris Xe) a 1280x720 y a 1920x1080: el coste crece
       algo más deprisa que el número de píxeles. */
    function weight(i){
      const q = LEVELS[i], s = Math.min(1, q.side / Math.max(place.w, place.h));
      return Math.pow(place.w * place.h * s * s, 1.15) / 35 + BLADES * q.part * (q.tall ? 1 : 0.6);
    }
    /* Qué calidad aguanta este equipo. No se deduce del nombre de la tarjeta ni del número de
       núcleos (un portátil con gráfica integrada tiene ocho y dieciséis gigas): se mide, con la
       escena todavía sin enseñar. Se empieza por un escalón intermedio, que no ahoga a una
       tarjeta floja (mientras la tarjeta está saturada, el navegador entero va a tirones), y
       con lo que tarda se calcula, por lo que pesa cada escalón, a dónde ir; después se
       comprueba. Tres rondas como mucho, unas décimas de segundo. Primero se busca ir a 60
       fotogramas por segundo sin bajar del cuarto escalón: se nota más la fluidez que el
       detalle. Si no da, a 30 (o a 20 en el último) en el mejor escalón que quepa. El primer
       fotograma de cada ronda no cuenta: calcula lo que no cambia. */
    async function measure(){
      measuring = true;
      const lowest = LEVELS.length - 1;
      const log = [];
      let l = 2, first = true;
      fluid = true;
      for(let round = 0; round < 3; round++){
        setLevel(l);
        await gauge(1);
        let ms = await pace();
        const room = (i) => BUDGET * 1000 / (fluid ? 60 : LEVELS[i].fps);
        /* Si no cabe, se repite y vale la mejor: la primera medida suele salir inflada (la
           tarjeta aún está arrancando y la página, cargando). */
        if(ms > room(l)) ms = Math.min(ms, await pace());
        /* Se fijó la calidad a mano mientras tanto (quality): manda eso. */
        if(measured) return;
        log.push([l, fluid ? 60 : LEVELS[l].fps, Math.round(ms * 10) / 10]);
        /* Lo que tardaría el escalón j, por lo que pesa: ¿cabe? */
        const fits = (j) => ms * weight(j) / weight(l) <= 0.9 * room(j);
        let next = l;
        if(fluid && ms > room(l)){
          /* A 60 no llega aquí: ¿en uno más ligero, sin pasar del cuarto? Si no, a 30. */
          next = -1;
          /* Aquí sin margen: la primera medida sale inflada y la ronda siguiente lo comprueba. */
          for(let j = 3; j > l; j--) if(ms * weight(j) / weight(l) <= room(j)) next = j;
          if(next < 0){ fluid = false; next = l; }
        }
        if(!fluid && next === l && ms > room(l) && l < lowest){
          next = lowest;
          for(let j = lowest; j > l; j--) if(fits(j)) next = j;
        }
        if(next === l && ms <= room(l) && first) for(let j = l - 1; j >= 0; j--) if(fits(j)) next = j;
        first = false;
        if(next === l) break;
        l = next;
      }
      /* En móviles y tabletas, nunca por encima del tercer escalón: se calientan enseguida. */
      if(window.matchMedia('(pointer: coarse)').matches) l = Math.max(l, 2);
      cost = log;
      measured = true;
      measuring = false;
      setLevel(l);
      wake();
    }

    /* La marca del último fotograma mandado a la tarjeta. heavy: no lo había terminado cuando
       tocaba (ver loop). */
    let mark = null, heavy = false;
    function judge(){
      if(!mark) return;
      if(gl.clientWaitSync(mark, 0, 0) === gl.TIMEOUT_EXPIRED){ heavy = true; return; }
      gl.deleteSync(mark);
      mark = null;
    }
    function loop(now){
      raf = 0;
      if(away(screen) || document.hidden || measuring) return;
      /* Aún se está compilando: la imagen de espera, con la pantalla del ordenador en vivo. */
      if(!live){
        loadPoster();
        if(posterOk && kit.hold() && now - last >= 1000 / 30 - 2){
          last = now;
          advance(now);
          treeFade = treeReady ? ease(treeFade, 1, 2.6) : 0;
          if(!shown){ shown = true; canvas.classList.add('is-on'); }
          drawPoster(1);
        }
        if(!isStill()) raf = requestAnimationFrame(loop);
        return;
      }
      if(!measured && !isStill()){ measure(); return; }
      const every = 1000 / rate;
      if(now - last >= every - 2){
        /* Si la tarjeta aún no ha terminado el fotograma anterior, no se le manda otro: se
           amontonarían y el formulario iría a tirones. */
        judge();
        if(mark){ raf = requestAnimationFrame(loop); return; }
        /* Fotogramas pesados: más de un tercio de una tanda, un escalón menos. En el más ligero,
           si lo son casi todos, la escena se queda quieta. Mientras cambia el tema no se
           cuentan: esos segundos se rehacen las sombras y pesan más de la cuenta. */
        if(last && now > settle && night === toNight && day === toDay){
          counted++;
          if(heavy) slow++;
          if(counted >= 24){
            /* Antes de bajar de escalón, se baja de 60 a 30. */
            if(slow > 8 && fluid){ fluid = false; setLevel(level); }
            else if(slow > 8 && level < LEVELS.length - 1) setLevel(level + 1);
            else if(slow > 16) frozen = true;
            counted = 0; slow = 0;
          }
        }
        heavy = false;
        last = now;
        if(!shown){ shown = true; canvas.classList.add('is-on'); }
        draw(now);
        /* La escena ya está: la imagen de espera se funde sobre ella y se suelta. */
        if(veil > 0){
          if(!veilFrom) veilFrom = now;
          veil = posterOk && kit.hold() && !isStill() ? Math.max(0, 1 - (now - veilFrom) / 900) : 0;
          if(veil > 0) drawPoster(veil * veil * (3 - 2 * veil));
          else gl.deleteTexture(posterTex);
        }
        if(!isStill()){
          /* Pesado: la tarjeta sigue con él pasada la mayor parte del tiempo del fotograma. */
          const flag = mark = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          setTimeout(() => { if(mark === flag) judge(); }, every * 0.85);
        }
      }
      if(!isStill()) raf = requestAnimationFrame(loop);
    }
    function wake(){
      if(raf || measuring || away(screen) || document.hidden) return;
      resize();
      /* Tras una pausa (pestaña oculta, escena quieta) el primer fotograma no cuenta como pesado. */
      last = 0;
      raf = requestAnimationFrame(loop);
    }

    /* Lo que pasa en el formulario, para la pantalla del ordenador. {text}: lo escrito en el
       correo o el nombre, para enseñarlo con letras (null: enseñar puntos). De la contraseña solo
       llega cuántos caracteres hay, nunca cuáles.
       {chars, active}: caracteres del campo en uso y si el formulario tiene algo escrito.
       {busy}: se espera la respuesta. {ok:true}: acceso
       correcto. {error:true}: un golpe de error. {reset:true}: todo a cero. */
    function signal(o){
      if(o.reset){ ui.tChars = ui.tShow = ui.tBusy = ui.tRes = 0; }
      if(typeof o.chars === 'number') ui.tChars = Math.min(o.chars, 9);
      if('text' in o) setText(typeof o.text === 'string' ? o.text : null);
      if('active' in o) ui.active = !!o.active;
      if('busy' in o) ui.tBusy = o.busy ? 1 : 0;
      if(o.error){ ui.res = -1; ui.tRes = -1; }
      if(o.ok){ ui.tRes = 1; ui.tBusy = 0; }
      ui.tShow = !o.reset && ui.tRes <= 0 && (ui.active || ui.tBusy > 0) ? 1 : 0;
      last = 0;
      wake();
    }
    /* Para las pruebas y para medir: el estado de la calidad (cost: lo que midió measure()),
       fijar la hora, fijar el escalón y cuánto tarda de verdad un fotograma (only: solo esas
       pasadas, ver passes). */
    function state(){
      return {level, side:LEVELS[level].side, blades:Math.round(BLADES * LEVELS[level].part), fps:rate, frozen, software, cache, live, cost, night, day, dawn, canvas:[canvas.width, canvas.height]};
    }
    function bench(frames, only){
      if(!live) return 0;
      passes = only || 15;
      timed(2);
      const ms = timed(frames || 20);
      passes = 15;
      return ms;
    }
    api.signal = signal;
    api.state = state;
    api.bench = bench;
    api.poster = poster;
    api.hour = (h) => { hourFixed = h == null ? null : +h; last = 0; wake(); };
    api.quality = (l, hz) => { measured = true; measuring = false; frozen = false; fluid = hz === 60; setLevel(l); last = 0; wake(); };

    /* El cursor: solo con ratón (en pantallas táctiles no hay cursor que seguir). */
    if(window.matchMedia('(hover: hover) and (pointer: fine)').matches){
      screen.addEventListener('pointermove', (ev) => {
        if(ev.pointerType && ev.pointerType !== 'mouse') return;
        mouse.tx = ev.clientX; mouse.ty = ev.clientY; mouse.moved = performance.now();
        if(!mouse.inside){ mouse.inside = true; mouse.x = mouse.tx; mouse.y = mouse.ty; }
      }, {passive:true});
      screen.addEventListener('pointerleave', () => { mouse.inside = false; });
    }

    window.addEventListener('resize', () => { resize(); wake(); });
    document.addEventListener('visibilitychange', wake);
    /* La pantalla de acceso aparece y desaparece con el atributo hidden; el tema, con data-theme. */
    new MutationObserver(() => { relayout = true; resize(); wake(); }).observe(screen, {attributes:true, attributeFilter:['hidden']});
    new MutationObserver(wake).observe(root, {attributes:true, attributeFilter:['data-theme', 'data-motion']});
    if(darkQuery.addEventListener) darkQuery.addEventListener('change', wake);
    canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); cancelAnimationFrame(raf); raf = 0; mark = null; canvas.classList.remove('is-on'); });
    wake();
    return true;
  }

  /* signal() no hace nada hasta que la escena arranca (o si no hay WebGL). */
  const api = {start, signal(){}, state(){ return null; }, bench(){ return 0; }, poster(){ return null; }, hour(){}, quality(){}};
  Workhub.views.authScene = api;
})();
