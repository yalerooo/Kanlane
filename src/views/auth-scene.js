/* Paisaje en 3D de la pantalla de acceso. Cambia con la estación del año (SEASON, más abajo):
   lo que sigue describe la primavera; en verano el árbol es verde, en otoño es rojizo, la
   hierba amarillea y caen hojas, y en invierno hay nieve en vez de hierba, nieva (FLAKES_VERT)
   y el cursor deja su surco en la nieve (uSnow).
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
      la brizna se calcula antes, una vez por brizna (transform feedback): el viento, en cada
      fotograma (GRASS_SIM); la luz, que cambia despacio, por turnos (GRASS_LIGHT). De lejos
      las briznas llevan menos tramos (lods).
   En primavera, entre el arbolado y la hierba, las flores (FLOWERS_VERT / FLOWERS_FRAG).
   4. Lo que va por delante (OVER): pétalos, pájaros y luciérnagas, cada uno en su recuadro
      (sprites) y no a pantalla completa. En invierno, además, la
      nevada: miles de puntos (FLAKES_VERT / FLAKES_FRAG).
   COMMON son las funciones que comparten (ruido, terreno, ordenador, cielo...).

   El ordenador se coloca siempre en el centro del panel de cristal de la tarjeta de acceso
   (uFocus), sea cual sea el tamaño de la ventana.

   Rendimiento. El cielo y el suelo, que cambian muy despacio, se pintan por turnos en una
   imagen intermedia y en cada fotograma solo se rehace lo que se mueve (FRAG, COMP); de cada
   brizna se guarda lo que no depende del viento (GRASS_BASE). Lo que no cambia de un fotograma a otro (dónde toca cada rayo el suelo y el
   ordenador, y sus sombras) se calcula una vez por tamaño de ventana y se guarda en una imagen
   (GEO, BAKE). La calidad se adapta al equipo: la escena se enseña en el escalón más ligero
   (LEVELS: resolución y cantidad de hierba) y, midiendo lo que tarda de verdad la tarjeta
   gráfica en cada fotograma, sube mientras le sobre tiempo y baja si va justa (MODES y
   «Calidad», en setup()). Nunca se queda parada para siempre: si ni en lo más ligero llega,
   descansa un rato y vuelve a probar. La calidad en la que se asienta se guarda en el
   navegador (MEMO_KEY) y la visita siguiente arranca ya en ella y se enseña enseguida. Con la
   escena a la vista no cambia de calidad delante de nadie: si hay que bajar, se retira un
   instante tras la foto desenfocada y vuelve ya cambiada (retreat), y a la vista no sube. La
   primera vez la calidad se elige de una carrera de fotogramas, sin subir escalón a escalón
   (sprint). Se pinta solo mientras la pantalla de
   acceso está a la vista, y no se prepara nada hasta que se ve por primera vez. Los
   sombreadores se compilan en segundo plano (compilarlos de golpe dejaba el navegador entero
   parado varios segundos). Hasta que acaban se enseña una imagen de la escena hecha de antemano
   (WAIT, POSTER, backdrop), colocada con la misma cuenta y con la pantalla del ordenador pintada
   de verdad; cuando la escena está lista, la imagen se funde sobre ella. Con movimiento
   reducido se pinta un único fotograma. Si el navegador no tiene WebGL 2, queda el degradado
   de cielo que pone auth.css. */
(function(){
  /* La estación del año (la decide boot.js: fecha y hemisferio). Cambia el árbol, el color de
     la hierba, el arbolado lejano y lo que cae del cielo; en invierno no hay hierba, hay nieve.
     Va como constante en todos los sombreadores: 0 primavera, 1 verano, 2 otoño, 3 invierno. */
  const SEASON = Math.max(['spring', 'summer', 'autumn', 'winter'].indexOf(document.documentElement.getAttribute('data-season')), 0);
  const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n#define SEASON ' + SEASON + '\n';
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
    /* Invierno: el relieve que el cursor va dejando en la nieve. Una imagen de alturas que
       cubre la pantalla (la cámara no se mueve, así que cada casilla es siempre el mismo trozo
       de suelo): 0 la nieve intacta, hasta -1 lo hundido y por encima de 0 la que se amontona
       a los lados. La lleva el JS (stamp), que es quien hunde las casillas. */
    '#if SEASON == 3',
    'uniform sampler2D uSnow;',
    '#endif',
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
    /* Invierno: el atardecer no arde. La luz es más fría y más pálida: cada color de la hora */
    /* dorada se apaga hacia un gris azulado de su misma claridad (el cielo lleva además sus */
    /* propios tonos, ver skyBase). */
    '#if SEASON == 3',
    '  gold = mix(gold, vec3(dot(gold, vec3(.30, .59, .11))) * vec3(.94, 1., 1.14), .42);',
    '#endif',
    '  return mix(mix(gold, noon, uDay), night, uNight);',
    '}',
    /* La hierba de cada estación: más seca y dorada en verano, ocre en otoño. En invierno */
    /* no hay (GRASSY 0.): el suelo es nieve y las briznas no se pintan. */
    'vec3 seasonGrass(vec3 a){',
    '#if SEASON == 1',
    '  return mix(a, a * vec3(1.22, 1.04, .62), .40);',
    '#elif SEASON == 2',
    '  return mix(a, dot(a, vec3(.30, .59, .11)) * vec3(2.05, 1.22, .40) * mix(1., .55, uNight), .78);',
    '#else',
    '  return a;',
    '#endif',
    '}',
    '#if SEASON == 3',
    'const float GRASSY = 0.;',
    /* El relieve fino de la nieve, que el terreno no tiene: ventisqueros anchos, las ondas que
       deja el viento (alargadas, de cresta afilada) y, cerca (fine), el grano. Solo se usa su
       pendiente, para inclinar la normal: con el sol bajo es lo que hace que parezca nieve y
       no una sábana. */
    'float snowRelief(vec2 p, float fine){',
    '  float h = .10 * fbm3(p * .55 + 7.);',
    '  h += .022 * (1. - abs(2. * noise(p * vec2(1.1, 3.4) + 3.) - 1.));',
    '  h += fine * (.006 * noise(p * vec2(7., 15.)) + .0013 * noise(p * 46.));',
    '  return h;',
    '}',
    '#else',
    'const float GRASSY = 1.;',
    '#endif',
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
    /* Invierno: el ordenador está medio metido en la nieve. No baja él: sube la nieve a su
       alrededor, un montón irregular contra el pie, más alto por detrás y hacia un lado (de
       donde sopla), que le tapa el plato y parte del zócalo. Al ser terreno, lleva la misma
       luz y las mismas sombras que el resto de la nieve, y el cursor también lo pisa. En las
       medidas del ordenador. OJO: -.46 y 1.22 repiten YAW y CS, que se declaran más abajo. */
    '#if SEASON == 3',
    '  {',
    '    vec2 q = rot(-.46) * p / 1.22;',
    '    vec2 c = (q - vec2(-.10, -.25)) * vec2(.80, 1.);',
    '    h += 1.22 * (.17 * exp(-dot(q, q) / 1.4) + .24 * exp(-dot(c, c) / .85) * (.78 + .5 * noise(q * 2.6 + 1.)));',
    '  }',
    '#endif',
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
    /* Invierno: una capa de nieve encima del monitor (sobre el marco y, más atrás, siguiendo */
    /* la caída de la carcasa) y carámbanos colgando por debajo, del canto inferior del marco */
    /* y de los lados de la carcasa, sobre el pie. */
    '#if SEASON == 3',
    'float snowCap(vec3 q){',
    '  float lump = (noise(q.xz * 6.) - .5) * .05 + (noise(q.xz * 15. + 3.) - .5) * .02;',
    '  float front = sdBox(q - vec3(0., 1.87 + lump, -.60), vec3(.76, .04, .19)) - .075;',
    '  float taper = mix(1., .60, smoothstep(-.40, .92, q.z));',
    '  float roof = .78 + .98 * taper + .05 + lump;',
    '  float back = max(abs(q.y - roof) - .045, sdBox2(q.xz - vec2(0., .14), vec2(.58 * taper, .56))) - .04;',
    '  return smin(front, back, .08) * .7;',
    '}',
    'float icicles(vec3 q){',
    '  float cell = .140;',
    '  float id = clamp(floor(q.x / cell + .5), -5., 5.);',
    '  float h = hash(vec2(id, 7.));',
    /* Más cortos en el centro, donde está el pie debajo; más largos hacia las esquinas. */
    '  float len = (.05 + .16 * h * h) * mix(.55, 1.25, smoothstep(.30, .70, abs(id * cell)));',
    '  vec3 c = q - vec3(id * cell + (hash(vec2(id, 3.)) - .5) * .05, .345, -.70);',
    '  float t = clamp(-c.y / len, 0., 1.);',
    '  return (length(vec3(c.x, c.y + t * len, c.z)) - mix(.028, .003, t)) * .75;',
    '}',
    /* Escarcha en el cristal: entra desde los bordes y las esquinas, a vetas, y deja libre el
       centro, que es donde se lee. su: el punto del cristal, de -1 a 1. */
    'vec3 frosted(vec3 col, vec2 su){',
    '  float f = max(abs(su.x), abs(su.y)) + length(max(abs(su) - .55, 0.)) * .9 + (fbm3(su * 4. + 2.) - .5) * .55;',
    '  f = smoothstep(.80, 1.12, f) * (.55 + .45 * noise(su * vec2(38., 46.)));',
    '  return mix(col, vec3(.74, .84, .98) * mix(.95, .42, uNight), f * mix(.60, .40, uNight));',
    '}',
    '#endif',
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
    '#if SEASON == 3',
    '  return min(smin(min(smin(body, stand, .05), cable), snowCap(q), .03), icicles(q));',
    '#else',
    '  return min(smin(body, stand, .05), cable);',
    '#endif',
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
    /* Cada estación tiene su cielo. De abajo arriba, cuatro franjas: el horizonte, lo que hay
       justo encima, el cielo medio y lo alto; las tres primeras, con un tono del lado del sol
       y otro del lado contrario. Y lo mismo, más corto, para la noche.
       Primavera: tarde limpia y suave, de rosas y melocotón que suben a un azul claro; noche
       azul, algo verdosa en el horizonte. Verano: hora dorada, amarillos y naranjas encendidos
       bajo un azul hondo y despejado; noche tibia, con el horizonte aún caliente. Otoño: el
       atardecer que arde, cobre y granate hasta el morado; noche más parda y cerrada.
       Invierno: tarde fría, crema y melocotón pálido hacia el sol, la franja rosa del otro
       lado, lila y azul claro arriba; noche limpia y helada, la más azul. */
    '#if SEASON == 0',
    '  vec3 day = mix(vec3(.98, .64, .62), vec3(1.08, .84, .56), sunny);',
    '  day = mix(day, mix(vec3(.92, .54, .66), vec3(1.04, .64, .52), sunny), smoothstep(0., .14, y));',
    '  day = mix(day, mix(vec3(.54, .50, .84), vec3(.76, .54, .74), sunny), smoothstep(.09, .36, y));',
    '  day = mix(day, vec3(.19, .34, .72), smoothstep(.26, .85, y));',
    '  vec3 night = mix(mix(vec3(.13, .18, .36), vec3(.21, .28, .48), sunny), vec3(.05, .08, .22), smoothstep(0., .3, y));',
    '  night = mix(night, vec3(.010, .018, .065), smoothstep(.25, .9, y));',
    '#elif SEASON == 1',
    '  vec3 day = mix(vec3(.96, .56, .30), vec3(1.14, .88, .38), sunny);',
    '  day = mix(day, mix(vec3(.90, .44, .30), vec3(1.08, .62, .24), sunny), smoothstep(0., .15, y));',
    '  day = mix(day, mix(vec3(.38, .36, .64), vec3(.72, .42, .42), sunny), smoothstep(.10, .38, y));',
    '  day = mix(day, vec3(.09, .23, .58), smoothstep(.28, .85, y));',
    '  vec3 night = mix(mix(vec3(.20, .16, .34), vec3(.36, .25, .40), sunny), vec3(.07, .07, .22), smoothstep(0., .3, y));',
    '  night = mix(night, vec3(.014, .016, .07), smoothstep(.25, .9, y));',
    '#elif SEASON == 2',
    '  vec3 day = mix(vec3(.86, .41, .30), vec3(1.05, .72, .26), sunny);',
    '  day = mix(day, mix(vec3(.74, .27, .27), vec3(1., .44, .20), sunny), smoothstep(0., .15, y));',
    '  day = mix(day, mix(vec3(.44, .20, .37), vec3(.66, .26, .31), sunny), smoothstep(.10, .38, y));',
    '  day = mix(day, vec3(.16, .16, .36), smoothstep(.28, .85, y));',
    '  vec3 night = mix(mix(vec3(.18, .14, .30), vec3(.27, .21, .38), sunny), vec3(.07, .06, .19), smoothstep(0., .3, y));',
    '  night = mix(night, vec3(.014, .014, .055), smoothstep(.25, .9, y));',
    '#else',
    '  vec3 day = mix(vec3(.96, .70, .70), vec3(1.16, .92, .66), sunny);',
    '  day = mix(day, mix(vec3(.80, .62, .78), vec3(1.02, .76, .70), sunny), smoothstep(0., .13, y));',
    '  day = mix(day, mix(vec3(.54, .56, .84), vec3(.70, .62, .82), sunny), smoothstep(.08, .34, y));',
    '  day = mix(day, vec3(.26, .38, .70), smoothstep(.24, .85, y));',
    '  vec3 night = mix(mix(vec3(.11, .17, .37), vec3(.17, .25, .50), sunny), vec3(.04, .07, .23), smoothstep(0., .3, y));',
    '  night = mix(night, vec3(.008, .014, .062), smoothstep(.25, .9, y));',
    '#endif',
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
    /* Solo donde se van a ver: de día y al atardecer no hay, y eran un tercio de lo que cuesta */
    /* el cielo. */
    '  vec3 stars = vec3(0.);',
    '  if(starry > 0.){',
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
    '  stars = vec3(.9, .92, 1.) * st + mix(vec3(1., .88, .74), vec3(.78, .86, 1.), hash(si2)) * big * 1.4;',
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
    '  }',
    /* Cuánta nube: desde qué densidad empiezan a verse los jirones altos y los bancos bajos
       (cuanto más alto el número, menos nube). Verano, casi despejado; primavera, bancos
       sueltos; otoño, cargado; invierno, el más cubierto. STARS: lo que lucen las estrellas
       (más en las noches limpias de verano e invierno). */
    '#if SEASON == 0',
    'const vec2 CLOUDS = vec2(.53, .46); const float STARS = 1.;',
    '#elif SEASON == 1',
    'const vec2 CLOUDS = vec2(.52, .55); const float STARS = 1.3;',
    '#elif SEASON == 2',
    'const vec2 CLOUDS = vec2(.47, .40); const float STARS = .9;',
    '#else',
    'const vec2 CLOUDS = vec2(.46, .39); const float STARS = 1.2;',
    '#endif',
    /* Nubes altas: jirones finos y alargados, encendidos por debajo. */
    '  float sunny = pow(max(dot(normalize(vec3(rd.x, 0., rd.z) + 1e-5), normalize(vec3(L.x, 0., L.z))), 0.), 2.);',
    '  vec2 c1 = rd.xz / (rd.y + .10);',
    '  float hi = fbm(vec2(c1.x * .34 + uTime * .013, c1.y * 1.25 + 4. + uTime * .003));',
    '  float cirrus = smoothstep(CLOUDS.x, CLOUDS.x + .28, hi) * smoothstep(.03, .22, rd.y) * .62;',
    '  vec3 hiCol = pal(mix(vec3(.66, .28, .36), vec3(1., .68, .40), sunny * .7 + hi * .3), mix(vec3(.80, .86, .95), vec3(1.), hi), mix(vec3(.07, .08, .18), vec3(.20, .23, .42), hi));',
    /* Nubes bajas: bancos con volumen; el borde que mira al sol se enciende. */
    '  vec2 c2 = rd.xz / (rd.y + .16) * 1.3 + vec2(uTime * .032, 0.);',
    /* Los bancos no solo pasan: se deshacen y se rehacen despacio. */
    '  c2 += .30 * (vec2(noise(c2 * .55 + vec2(0., uTime * .021)), noise(c2 * .55 + vec2(5.2, -uTime * .017))) - .5);',
    '  float dn = fbm(c2);',
    '  float cl = smoothstep(CLOUDS.y, CLOUDS.y + .30, dn) * smoothstep(0., .11, rd.y);',
    '  float edge = clamp((dn - fbm(c2 + normalize(L.xz) * .32)) * 3. + .45, 0., 1.);',
    '  vec3 loCol = pal(mix(vec3(.25, .12, .22), vec3(1.05, .60, .34), edge), mix(vec3(.56, .63, .78), vec3(1.02, 1.01, .98), edge), mix(vec3(.04, .05, .12), vec3(.22, .25, .45), edge));',
    /* Cerca del sol, el filo de la nube se pone de oro. */
    '  loCol += vec3(1., .72, .36) * pow(s, 10.) * (1. - smoothstep(.55, .9, dn)) * .9 * (1. - uNight) * (1. - .8 * uDay);',
    '  float cover = max(cirrus, cl);',
    '  col += stars * starry * (1. - cover) * STARS;',
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
    /* Invierno: el montón de nieve del ordenador mira a la cámara, y ahí el último paso se */
    /* mete en el terreno una distancia distinta en cada franja de píxeles (se veía a bandas */
    /* con la luz de la pantalla): se afina el punto con unos pasos cortos de vuelta. */
    '#if SEASON == 3',
    '  if(tHit > 0. && tHit < 40.){',
    '    for(int i = 0; i < 4; i++){',
    '      vec3 p = ro + rd * tHit;',
    '      tHit += (p.y - terrain(p.xz)) * .55;',
    '    }',
    '  }',
    '#endif',
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
    /* Las tres alturas, en un bucle que el compilador no puede desenrollar (uZero): escritas */
    /* una a una, terrain() se copiaba entera tres veces y compilar tardaba más. */
    '  vec3 g = vec3(0.);',
    '  for(int i = uZero; i < 3; i++) g[i] = terrain(p + (i == 1 ? vec2(e, 0.) : (i == 2 ? vec2(0., e) : vec2(0.))));',
    '  return vec2(g.y - g.x, g.z - g.x) / e;',
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
    /* En la imagen de espera no hay terreno ni briznas que tapen el pie del cerezo (lo que la */
    /* imagen trae por debajo del suelo se vería entero): se recorta a la altura a la que lo */
    /* tapa la hierba en la escena, con el borde desigual de las briznas. */
    '#ifdef LIVE',
    '    float wx = u.x * treeSc;',
    /* En invierno no hay briznas: el tronco baja hasta donde lo corta la nieve. */
    '#if SEASON == 3',
    '    float top = -.62;',
    '#else',
    '    float top = -.22 + (.04 + .16 * noise(vec2(wx * 34., 3.)) + .12 * noise(vec2(wx * 5., 9.))) / treeSc;',
    '#endif',
    '    tr *= smoothstep(top - .05, top + .05, u.y);',
    '#endif',
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
    /* Solo cerca del horizonte: la más alta no pasa de ,1425 y por encima es todo cielo (más */
    /* de la mitad de sus píxeles), que se ahorra los veintisiete ruidos de las tres. */
    '  if(tHit < 0. && rd.y < .1426){',
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
    '    alb = seasonGrass(mix(far, alb, near));',
    /* Invierno: nieve, con sus ventisqueros; los bosques lejanos asoman oscuros. */
    '#if SEASON == 3',
    '    alb = mix(vec3(.80, .92, 1.22), vec3(1.30, 1.34, 1.42), fbm3(p.xz * .9 + 4.) * .6 + fine * .4);',
    '    alb = mix(alb, vec3(.10, .12, .14), woods * .7) * mix(1., .50, uNight);',
    '    kFar = 1.;',
    '    kk = 1.;',
    '#endif',
    /* De noche el ojo casi no ve el color: la hierba se apaga y se enfría (si no, queda de un */
    /* verde encendido que no es de noche). */
    '    alb = mix(alb, vec3(dot(alb, vec3(.30, .59, .11))) * vec3(.70, .90, 1.02), uNight * .50);',
    '    kk = mix(kFar, kk, near);',
    /* Luz: las raíces quedan a la sombra de las demás briznas; las puntas reciben el sol y */
    /* dejan pasar la luz cuando se miran a contraluz. */
    /* Invierno: el relieve fino de la nieve (snowRelief), que se apaga con la distancia. */
    '#if SEASON == 3',
    '    {',
    '      float fine = 1. - smoothstep(2., 12., tHit);',
    '      float s0 = snowRelief(p.xz, fine);',
    '      vec2 sg = vec2(snowRelief(p.xz + vec2(.04, 0.), fine) - s0, snowRelief(p.xz + vec2(0., .04), fine) - s0) / .04;',
    '      n = normalize(n + vec3(-sg.x, 0., -sg.y) * (1. - smoothstep(5., 30., tHit)));',
    '    }',
    '#endif',
    /* Invierno: la nieve se hunde por donde pasa el cursor. No es una mancha pintada: el
       relieve está en uSnow y aquí solo se lee. De sus alturas sale la pendiente, que inclina
       la normal antes de iluminar, así que la pared que mira al sol se enciende sola y la otra
       se apaga; y mirando la altura hacia el sol se sabe si el borde tapa la luz (lee). Una
       casilla es un trozo de pantalla: se lleva a medidas de la escena con la distancia de
       este punto y con lo tumbado que se ve el suelo (fs, con tope: de verdad, a ras de suelo
       el surco quedaría en un hilo), igual que hace snowAt() en el JS.
       OJO: .24 y .075 repiten SNOW_R y lo hondo del surco. */
    '#if SEASON == 3',
    '    float pit = 0., lee = 0.;',
    '    {',
    '      vec2 tx = 1. / vec2(textureSize(uSnow, 0));',
    '      vec2 suv = gl_FragCoord.xy / uRes;',
    '      float h0 = texture(uSnow, suv).r;',
    '      vec4 hs = vec4(texture(uSnow, suv + vec2(tx.x, 0.)).r, texture(uSnow, suv - vec2(tx.x, 0.)).r, texture(uSnow, suv + vec2(0., tx.y)).r, texture(uSnow, suv - vec2(0., tx.y)).r);',
    '      if(abs(h0) + dot(abs(hs), vec4(1.)) > .002){',
    '        float kpx = max(dot(p - ro, fw), .3) / (1.5 * uRes.y);',
    '        float fs = 1. / clamp(-rd.y, .30, 1.);',
    '        vec2 cell = tx * uRes * kpx * vec2(1., fs);',
    '        vec2 g = vec2(hs.x - hs.y, hs.z - hs.w) * .075 / (2. * cell);',
    /* La nieve no se rompe limpia: la pendiente cambia de un grumo a otro. */
    '        float rough = noise(p.xz * 11.) * .6 + noise(p.xz * 31.) * .4;',
    '        vec2 fwd = normalize(fw.xz);',
    '        vec2 gw = (rt.xz * g.x + fwd * g.y) * (.65 + .7 * rough);',
    '        n = normalize(n + vec3(-gw.x, 0., -gw.y) * .9);',
    '        pit = clamp(-h0, 0., 1.);',
    /* Hacia el sol, a tres pasos: si la nieve de allí queda por encima del rayo, da sombra. */
    '        vec2 sun = vec2(dot(L.xz, rt.xz), dot(L.xz, fwd)) / max(length(L.xz), 1e-3);',
    '        float rise = L.y / max(length(L.xz), 1e-3);',
    '        float occ = 0.;',
    '        for(int i = 1; i <= 3; i++){',
    '          float s = .24 * .42 * float(i);',
    '          float hh = texture(uSnow, suv + sun * vec2(1., 1. / fs) * s / (kpx * uRes)).r;',
    '          occ = max(occ, ((hh - h0) * .075 - rise * s) / s);',
    '        }',
    '        lee = smoothstep(0., .22, occ);',
    /* La nieve pisada es más densa: algo más oscura y azulada. */
    '        alb *= mix(vec3(1.), vec3(.91, .94, .99), pit * (.7 + .6 * rough));',
    '      }',
    '    }',
    '#endif',
    '    float ao = mix(.26, 1., smoothstep(0., .85, kk));',
    '    float dif = clamp((dot(n, L) + .30) / 1.30, 0., 1.);',
    '    float through = pow(max(dot(rd, L), 0.), 3.) * kk * GRASSY;',
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
    '#if SEASON == 3',
    '    sh *= 1. - .85 * lee * mix(1., .45, uNight);',
    '    ao *= 1. - .16 * pit;',
    '#endif',
    '    gcol = alb * (ambient * 1.5 * ao + skyLight * 2.2 * ao + sunCol * dif * 2.4 * ao * sh);',
    '    gcol += sunCol * vec3(.78, .62, .18) * through * 1.25 * sh * (.4 + .6 * streak);',
    /* Las puntas, al sol, brillan: un filo de luz en lo alto de cada brizna. */
    '    gcol += sunCol * vec3(.60, .66, .26) * pow(kk, 5.) * (.35 + .65 * b.z) * dif * .50 * sh * near * GRASSY;',
    /* La nieve, en cambio, chispea: cristales sueltos que se encienden y se apagan cada uno a
       su ritmo (solo cerca: lejos serían más pequeños que un píxel), sobre un brillo fino y
       quieto. Sus sombras son azules, que es el cielo lo que las alumbra; y a contraluz deja
       pasar algo de sol. */
    '#if SEASON == 3',
    '    {',
    '      vec2 cell = floor(p.xz * 90.);',
    '      float gh = hash(cell);',
    '      float tw = .5 + .5 * sin(uTime * (1.2 + 3. * hash(cell + 3.1)) + gh * 50.);',
    '      gcol += sunCol * step(.965, gh) * tw * tw * (1. - smoothstep(3., 13., tHit)) * (dif * sh * 1.5 + .10);',
    '      gcol += sunCol * step(.93, noise(p.xz * 60.)) * dif * sh * .30 * near;',
    '      gcol = mix(gcol, gcol * vec3(.80, .93, 1.22), (1. - dif * sh) * .55 * (1. - uNight));',
    '      gcol += alb * sunCol * pow(max(dot(rd, L), 0.), 5.) * .22 * sh;',
    /* Con el tema claro la nieve tiraba a morado (luz rojiza sobre blanco azulado): se lleva */
    /* hacia un blanco frío y se aclara un poco. */
    '      gcol = mix(gcol, vec3(dot(gcol, vec3(.30, .59, .11))) * vec3(.95, 1., 1.10), .42 * (1. - uNight)) * mix(1.10, 1., uNight);',
    '    }',
    '#endif',
    /* Luz rasante en las crestas de las lomas. */
    '    gcol += alb * sunCol * pow(clamp(1. - n.y, 0., 1.), .7) * max(dot(n, L), 0.) * 2.2 * sh;',
    '    float gustWave = smoothstep(.55, 1., sin(p.x * .55 + p.z * .33 - uTime * .9) * .5 + .5) * (.5 + .5 * noise(p.xz * .7 + uTime * .1));',
    '    gcol += alb * sunCol * gustWave * kk * .55 * sh * (1. - uNight * .7) * GRASSY;',
    /* La pantalla ilumina la hierba que tiene delante. */
    '    vec3 tl = sc - p;',
    '    float dl = length(tl);',
    '    float spill = max(dot(normalize(tl), normalize(n + vec3(0., .6, 0.))), 0.) * max(dot(-normalize(tl), sn), 0.) / (1. + dl * dl * .5);',
    '    gcol += mix(alb, vec3(dot(alb, vec3(.33))), .35 * uNight) * screenGlow * spill * mix(mix(1.6, .9, uDay), 7.0, uNight) * (.35 + .65 * kk);',
    /* Cada luciérnaga alumbra un corro de hierba debajo. */
    '    if(uNight > .01 && SEASON != 3){',
    '      vec3 fl = vec3(0.);',
    '      for(int i = 0; i < FF_N; i++){',
    '        if(i >= uFFLit) break;',
    '        vec3 d = uFF[i].xyz - p;',
    '        float q = dot(d, d);',
    '        if(q < 2.4) fl += ffCol * max(uFF[i].w - .15, 0.) * exp(-q * 3.2);',
    '      }',
    '      gcol += alb * fl * 1.5 * (.35 + .65 * kk) * uNight;',
    '    }',
    /* Invierno: el viento levanta nieve y la arrastra a ras de suelo, a rachas. */
    '#if SEASON == 3',
    '    {',
    '      float gust = smoothstep(.45, .85, noise(p.xz * .16 + vec2(uTime * .11, 0.)));',
    '      float veil = smoothstep(.50, .90, fbm3(p.xz * vec2(.45, 2.4) + vec2(uTime * 1.1, uTime * .2)));',
    '      gcol += (ambient + skyLight * 1.6 + sunCol * .5 * sh) * veil * gust * .16 * (1. - smoothstep(10., 34., tHit));',
    '    }',
    '#endif',
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
    '#if SEASON == 3',
    '        col = frosted(col, su);',
    '#endif',
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
    /* Invierno: lo que es nieve, blanco y mate; los carámbanos, hielo azulado y brillante. */
    '        float iceK = 0., snowK = 0.;',
    '#if SEASON == 3',
    '        iceK = 1. - smoothstep(.004, .012, icicles(q));',
    '        snowK = 1. - smoothstep(.006, .016, snowCap(q));',
    /* Y la que se posa en todo lo que mira hacia arriba: el alféizar de la pantalla, los */
    /* mandos, el cable. A manchas, no una capa lisa. */
    '        snowK = max(snowK, smoothstep(.50, .88, nl.y) * smoothstep(.30, .55, noise(q.xz * 11.) * .6 + noise(q.xz * 29. + q.y * 7.) * .4) * .9);',
    '        snowK *= 1. - iceK;',
    '        alb = mix(alb, mix(vec3(.92, 1.02, 1.26), vec3(1.30, 1.34, 1.42), noise(q.xz * 5. + 2.)) * mix(1., .50, uNight), snowK);',
    '        alb = mix(alb, vec3(.62, .80, 1.), iceK);',
    '#endif',
    '        float dif = max(dot(n, L), 0.);',
    '        float shd = computerShadow(q + nl * .02, Ll);',
    '        vec3 hv = normalize(L - rd);',
    '        float spec = pow(max(dot(n, hv), 0.), 48.) * .55 + pow(max(dot(n, hv), 0.), 8.) * .08;',
    '        float skyL = .5 + .5 * n.y;',
    '        col = alb * (ambient * .9 * ao + mix(vec3(.20, .27, .40), skyLight, uNight) * skyL * 1.7 * ao + sunCol * dif * 1.1 * shd);',
    '#if SEASON == 3',
    /* La nieve, con la luz del suelo (no la del plástico): que sea la misma nieve arriba y abajo. */
    '        {',
    '          float wrap = clamp((dot(n, L) + .30) / 1.30, 0., 1.);',
    '          vec3 snowCol = alb * (ambient * 1.5 * ao + skyLight * 2.2 * ao + sunCol * wrap * 2.4 * ao * shd);',
    '          snowCol = mix(snowCol, snowCol * vec3(.80, .93, 1.22), (1. - wrap * shd) * .55 * (1. - uNight));',
    '          snowCol = mix(snowCol, vec3(dot(snowCol, vec3(.30, .59, .11))) * vec3(.95, 1., 1.10), .42 * (1. - uNight)) * mix(1.10, 1., uNight);',
    '          col = mix(col, snowCol, snowK);',
    '        }',
    '#endif',
    '        col += sunCol * spec * shd * (1. - snowK) * (1. + 2.5 * iceK);',
    /* El hielo deja pasar la luz y refleja el cielo. */
    '        col += (skyBase(refl, L) * (.25 + fres * .6) + sunCol * pow(max(dot(rd, L), 0.), 4.) * .5) * iceK;',
    /* De noche, sin esto, la carcasa se queda en una silueta negra: luz de relleno del cielo */
    /* y un filo frío en los cantos, para que se lea la forma. */
    '        col += alb * (vec3(.030, .040, .075) + vec3(.10, .13, .24) * pow(1. - max(dot(n, -rd), 0.), 2.5)) * uNight;',
    '        col += skyBase(refl, L) * fres * .22 * ao;',
    /* La hierba le devuelve un poco de verde por debajo. */
    '        col += alb * vec3(.05, .09, .03) * max(-n.y, 0.) * (1. - uNight) * GRASSY;',
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
    /* Los cerezos lejanos solo están en flor en primavera. */
    '  float pink = SEASON == 0 ? step(1.5, kind) : 0.;',
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
    /* Otoño: los de hoja caduca (los cipreses no) se ponen rojizos. Invierno: nevados. */
    '#if SEASON == 2',
    '  float turned = (1. - cypress) * (.55 + .45 * vKind.z);',
    '  dark = mix(dark, vec3(.20, .085, .035), turned);',
    '  lit = mix(lit, vec3(1.05, .50, .13), turned);',
    '#elif SEASON == 3',
    '  dark = mix(dark, vec3(.15, .17, .20), 1. - cypress * .5);',
    '  lit = mix(lit, vec3(.80, .84, .92), .85);',
    '#endif',
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
    '#if SEASON == 3',
    '  col = frosted(col, su);',
    '#endif',
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
    /* La imagen se hizo con el cerezo (y la loma que le hace el terreno) en un sitio fijo, pero */
    /* en cada ventana el cerezo cae en otro: sin más, el árbol quedaba plantado donde la imagen */
    /* no tiene loma y el suelo cambiaba de forma al llegar la escena. uWarp: dónde cae el */
    /* cerezo (x, en alturas de pantalla desde el ordenador) y cuánto hay que correr la imagen */
    /* para que su loma quede debajo (yz). Se corre entera a la izquierda del cerezo y cada vez */
    /* menos hasta WARP_X1, antes del ordenador, que no se mueve. */
    'uniform vec3 uWarp;',
    'const float WARP_X1 = -.30;',
    'uniform float uFade;',
    'out vec4 fragColor;',

    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
    '  vec2 puv = uv + uWarp.yz * (1. - smoothstep(uWarp.x, WARP_X1, uv.x));',
    '  vec4 px = texture(uPoster, clamp((puv * uPosterMap.z + uPosterMap.xy) / vec2(textureSize(uPoster, 0)), .001, .999));',
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
  /* La cámara de la hierba: no depende de nada (ni de la altura del suelo, que se va en la
     resta), así que va como constante y no se rehace en cada vértice. */
  const GRASS_CAM = [
    'const vec3 G_FW = normalize(vec3(-2.2, .40, 11.5));',
    'const vec3 G_RT = normalize(cross(vec3(0., 1., 0.), G_FW));',
    'const vec3 G_UP = cross(G_FW, G_RT);'
  ].join('\n');
  const GRASS_BASE = [
    /* ---------- La hierba, paso previo: lo que no cambia de cada brizna ---------- */
    /* Dónde está su raíz, cuánto mide, la sombra fija que le cae (la del terreno y la del */
    /* ordenador), el contacto con el cerezo y el ordenador, y la bruma que tiene delante: es lo */
    /* más caro de la hierba y no depende del viento, así que se calcula una sola vez por tamaño */
    /* de ventana, y otra cuando cambia la luz (el tema), y se guarda (transform feedback). */
    'layout(location = 1) in vec4 aInst;',
    'uniform float uWide;',
    /* Altura de la raíz, alto de la brizna, sombra fija y contacto. */
    'out vec4 oB0;',
    /* Mata, dos ruidos fijos (el desfase de la onda del viento y las manchas de la copa) y el */
    /* ancho de la brizna. */
    'out vec4 oB1;',
    'out vec4 oB2;',
    /* Cuánta luz de la pantalla del ordenador le llega, las manchas de tierra seca y hacia dónde */
    /* mira la brizna (coseno y seno). */
    'out vec4 oB3;',

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
    /* De lejos las briznas se ensanchan para seguir cubriendo con menos. */
    '  float w = (.0046 + .0032 * fract(rB * 3.7)) * (1. + dist * .13) * uWide;',
    '  oB1 = vec4(clump, noise(r0 * .35), noise(r0 * 6.1), w);',

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

    /* La pantalla del ordenador alumbra la hierba que tiene delante: cuánto, que el color lo */
    /* pone GRASS_LIGHT. Y las manchas rojizas de tierra seca, que antes se calculaban en cada */
    /* píxel de cada brizna. */
    '  vec3 sn = vec3(0., 0., -1.); sn.xz = rot(-YAW) * sn.xz;',
    '  vec3 sc = vec3(0., 1.16, -.66) * CS; sc.xz = rot(-YAW) * sc.xz; sc.y += base;',
    '  vec3 tl = sc - root;',
    '  float dl = length(tl);',
    '  float spill = max(dot(normalize(tl), vec3(0., 1., 0.)) * .6 + .4, 0.) * max(dot(-normalize(tl), sn), 0.) / (1. + dl * dl * .5);',
    '  float ang = rB * 19.;',
    '  oB3 = vec4(spill, smoothstep(.66, .9, fbm3(r0 * .23 + 8.)), cos(ang), sin(ang));',
    '  gl_Position = vec4(0., 0., 0., 1.);',
    '}'
  ].join('\n');
  const GRASS_SIM = [
    /* ---------- La hierba, primer paso: el viento ---------- */
    /* Cada brizna sale de su raíz en el suelo, se curva hacia un lado y el viento la tumba a */
    /* rachas que recorren la colina. Hacia dónde cae vale lo mismo para sus nueve vértices: se */
    /* calcula aquí una vez por brizna en cada fotograma y se guarda (transform feedback); */
    /* GRASS_VERT solo le da forma. Calcularlo en cada vértice costaba nueve veces más. Aquí va */
    /* solo lo que tiene que ir a cada fotograma, que es lo que se mueve; la luz, que cambia */
    /* despacio, va aparte y por turnos (GRASS_LIGHT), y lo que no cambia viene de GRASS_BASE. */
    'layout(location = 1) in vec4 aInst;',
    'layout(location = 2) in vec4 aB0;',
    'layout(location = 3) in vec4 aB1;',
    'layout(location = 4) in vec4 aB3;',
    /* Cuánto ha crecido la hierba (0..1): al relevar a la imagen de espera sale del suelo en */
    /* vez de aparecer de golpe encima de la hierba de la imagen. */
    'uniform float uGrow;',
    /* Alto de la brizna, hacia dónde cae y la racha. */
    'out vec4 oA;',

    'void main(){',
    /* aInst: raíz (x, z) y dos números al azar. */
    '  vec2 r0 = aInst.xy;',
    '  float rA = aInst.z, rB = aInst.w;',
    '  float h = aB0.y;',
    /* Sale por zonas, del ordenador hacia fuera, y no toda a la vez: unas briznas sueltas o a */
    /* medio crecer enseñan el pie, que es oscuro, y el relevo se veía como un césped ralo y */
    /* apagado tapando el de la imagen. Detrás del frente la hierba ya está entera. */
    '  h *= smoothstep(0., .2, uGrow * 1.3 - min(length(r0) / 30., 1.) - .1 * fract(rB * 5.3));',

    /* Viento: rachas anchas que cruzan la colina, una onda que las acompaña y un temblor fino */
    /* en cada brizna. */
    '  vec2 wdir = normalize(vec2(1., .45));',
    '  float gust = noise(r0 * .16 - wdir * uTime * .50);',
    '  gust = gust * gust * (3. - 2. * gust);',
    '  float wave = sin(dot(r0, wdir) * 1.1 - uTime * 1.7 + aB1.y * 5.) * .5 + .5;',
    '  float blow = .03 + .50 * gust + .16 * wave * gust;',
    '  float flutter = sin(uTime * (3.2 + 2.6 * rA) + rB * 43.) * (.035 + .07 * gust);',
    '  vec2 lean = aB3.zw * (.14 + .36 * rA) + wdir * blow + vec2(-wdir.y, wdir.x) * flutter;',
    /* El cursor: las briznas de su alrededor se tumban hacia fuera, como si pasara una mano. */
    /* Se mide en pantalla (dónde cae la raíz respecto al cursor), llevado a medidas de la */
    /* escena a esa distancia; en vertical cuenta más, porque el suelo se ve muy de canto. */
    '  if(uMouse.z > .002){',
    '    vec3 v0 = vec3(r0.x, aB0.x, r0.y) - vec3(2.2, uBase + .62, -11.5);',
    '    float z0 = max(dot(v0, G_FW), .3);',
    '    vec2 f0 = uFocus + uRes.y * 1.5 * vec2(dot(v0, G_RT), dot(v0, G_UP)) / z0;',
    '    vec2 md = (f0 - uMouse.xy) / uRes.y * z0 / 1.5;',
    '    md.y *= 2.4;',
    '    float push = exp(-dot(md, md) / .62) * uMouse.z;',
    '    lean += normalize(G_RT.xz * md.x + normalize(G_FW.xz) * md.y + 1e-4) * push * 1.35;',
    '    h *= 1. - .22 * push;',
    '  }',
    '  oA = vec4(h, lean, gust);',
    '  gl_Position = vec4(0., 0., 0., 1.);',
    '}'
  ].join('\n');
  const GRASS_LIGHT = [
    /* ---------- La hierba: la luz que le llega a cada brizna ---------- */
    /* Las sombras que se mueven (las nubes, la copa del cerezo) y las luces de cerca (la */
    /* pantalla del ordenador, las luciérnagas). Cambian despacio, así que no se rehacen para */
    /* todas las briznas en cada fotograma, sino para una parte cada vez (ver draw): era la */
    /* mitad de lo que costaba mover la hierba. */
    'layout(location = 1) in vec4 aInst;',
    'layout(location = 2) in vec4 aB0;',
    'layout(location = 3) in vec4 aB1;',
    'layout(location = 4) in vec4 aB3;',
    /* Sombra y contacto. */
    'out vec4 oLight;',
    /* Luces de cerca. */
    'out vec4 oExtra;',

    'void main(){',
    '  setupTree();',
    '  float treeSc = TREE_SC * uTreeS;',
    '  vec3 L = sunDir();',
    '  vec2 r0 = aInst.xy;',
    '  float sh = aB0.z;',
    '  float cloudSh = smoothstep(.34, .66, fbm3(r0 * .075 + vec2(uTime * .035, uTime * .014)));',
    '  sh *= mix(.40, 1., cloudSh);',
    '  vec2 tsh = (r0 - gTree) / treeSc + L.xz * 4.2;',
    '  float dapple = smoothstep(.30, .62, noise(r0 * 2.4 + vec2(uTime * .10, 0.)) * .6 + aB1.z * .4);',
    '  sh *= 1. - .62 * smoothstep(5.4, 2.2, length(tsh * vec2(1., 1.3))) * mix(1., .25, dapple);',
    '  float contact = aB0.w;',
    '  sh *= contact;',
    '  sh = mix(sh, 1., uNight * .5);',
    '  oLight = vec4(sh, .45 + .55 * contact, 0., 0.);',

    /* Luces de cerca: la pantalla del ordenador y, de noche, las luciérnagas (solo las que */
    /* alumbran y de cerca: a metro y medio ya no llega nada). */
    '  vec3 extra = screenLight() * aB3.x * mix(mix(1.6, .9, uDay), 7.0, uNight);',
    '  if(uNight > .01){',
    '    vec3 root = vec3(r0.x, aB0.x, r0.y);',
    '    vec3 fl = vec3(0.);',
    '    for(int i = 0; i < FF_N; i++){',
    '      if(i >= uFFLit) break;',
    '      vec3 d = uFF[i].xyz - root;',
    '      float q = dot(d, d);',
    '      if(q < 2.4) fl += vec3(.80, 1., .34) * max(uFF[i].w - .15, 0.) * exp(-q * 3.2);',
    '    }',
    '    extra += fl * 1.5 * uNight;',
    '  }',
    '  oExtra = vec4(extra, 0.);',
    '  gl_Position = vec4(0., 0., 0., 1.);',
    '}'
  ].join('\n');
  const GRASS_VERT = [
    /* ---------- La hierba, segundo paso: una cinta por brizna ---------- */
    /* Cada brizna es una cinta de cuatro tramos (dos de lejos y en los equipos justos) que */
    /* acaba en punta. Aquí solo se le da forma: lo demás viene ya calculado de GRASS_BASE, */
    /* GRASS_SIM y GRASS_LIGHT. OJO: lo que es igual para toda la brizna no se marca «flat»: en */
    /* Windows el navegador lo resuelve con un sombreador de geometría y la hierba tarda cinco */
    /* veces más (medido). */
    'layout(location = 0) in vec2 aBlade;',
    /* Las potencias de la altura que piden la curva y el ancho, ya hechas para cada vértice. */
    'layout(location = 9) in vec3 aShape;',
    'layout(location = 1) in vec4 aInst;',
    'layout(location = 2) in vec4 aA;',
    'layout(location = 3) in vec4 aLight;',
    'layout(location = 4) in vec4 aExtra;',
    'layout(location = 5) in vec4 aB0;',
    'layout(location = 6) in vec4 aB1;',
    'layout(location = 7) in vec4 aFog;',
    'layout(location = 8) in vec4 aB3;',
    'out vec3 vN;',
    'out vec3 vPos;',
    'out float vT;',
    /* Los dos números al azar, la mata y la tierra seca; sombra, contacto y racha. */
    'out vec4 vBlade;',
    'out vec3 vLight;',
    'out vec4 vFog;',
    'out vec3 vExtra;',

    'void main(){',
    '  vec3 ro = vec3(2.2, uBase + .62, -11.5);',

    /* aBlade: lado (-1..1) y altura dentro de la brizna (0 raíz, 1 punta). */
    '  float t = aBlade.y;',
    '  vec3 root = vec3(aInst.x, aB0.x, aInst.y);',
    '  float h = aA.x, w = aB1.w;',
    '  vec2 lean = aA.yz;',
    '  vec2 own = aB3.zw;',
    '  float lm2 = min(dot(lean, lean), 1.);',

    /* La curva de la brizna y su tangente. aShape: t^1,7; 1,7·max(t, ,02)^,7; 1 - t^1,5. */
    '  vec3 p = root + vec3(lean.x, 0., lean.y) * h * aShape.x;',
    '  p.y += h * t * (1. - .30 * lm2 * t);',
    '  vec3 tang = normalize(vec3(lean.x * aShape.y, 1. - .60 * lm2 * t, lean.y * aShape.y));',

    /* El ancho mira a medias a la cámara: así ninguna brizna queda de canto y desaparece. */
    '  vec3 toCam = normalize(ro - p);',
    '  vec3 camSide = normalize(cross(tang, toCam));',
    '  vec3 ownSide = vec3(-own.y, 0., own.x);',
    '  ownSide *= sign(dot(ownSide, camSide) + 1e-4);',
    '  vec3 side = normalize(mix(ownSide, camSide, .60));',
    '  p += side * aBlade.x * w * aShape.z;',

    '  vec3 n = normalize(cross(side, tang));',
    '  n *= sign(dot(n, toCam) + 1e-4);',
    /* Algo de curva a lo ancho, como una hoja doblada por su nervio. */
    '  vN = normalize(n + side * aBlade.x * .55);',
    '  vPos = p;',
    '  vT = t;',
    '  vBlade = vec4(aInst.z, aInst.w, aB1.x, aB3.y);',
    '  vLight = vec3(aLight.xy, aA.w);',
    '  vFog = aFog;',
    '  vExtra = aExtra.xyz;',

    /* Proyección: la misma cámara que la escena (el punto de fuga está en uFocus, no en el centro). */
    '  vec3 v = p - ro;',
    '  float zv = dot(v, G_FW);',
    '  vec2 frag = uFocus + uRes.y * 1.5 * vec2(dot(v, G_RT), dot(v, G_UP)) / zv;',
    '  vec2 ndc = frag / uRes * 2. - 1.;',
    '  float zn = (Z_FAR * (zv - Z_NEAR) / ((Z_FAR - Z_NEAR) * zv)) * 2. - 1.;',
    '  gl_Position = vec4(ndc * zv, zn * zv, zv);',
    '}'
  ].join('\n');
  const GRASS_FRAG = [
    /* ---------- La hierba: el color de cada brizna ---------- */
    'in vec3 vN;',
    'in vec3 vPos;',
    'in float vT;',
    'in vec4 vBlade;',
    'in vec3 vLight;',
    'in vec4 vFog;',
    'in vec3 vExtra;',
    'out vec4 fragColor;',

    'void main(){',
    '  float t = vT, rA = vBlade.x, rB = vBlade.y, clump = vBlade.z;',
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
    /* Manchas rojizas de tierra seca, de día (vienen de GRASS_BASE). */
    '  alb = mix(alb, vec3(.26, .15, .10), vBlade.w * .20 * (1. - uNight));',
    '  alb = seasonGrass(alb);',
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
  /* ---------- Lo que va por delante de la hierba: pétalos, pájaros y luciérnagas ---------- */
  /* Cada cosa es un recuadro pequeño (una instancia) que pinta solo lo suyo: antes era una
     pasada a pantalla completa que en cada píxel repasaba los veintidós pétalos y las cuarenta
     luciérnagas, y casi siempre para no pintar nada; en una gráfica integrada se llevaba un
     tercio del fotograma. Los recuadros los prepara el JS (sprites): aBox, el centro y el medio
     lado en alturas de pantalla; aP y aQ, lo de cada cosa; aQ.x dice qué es (0 pétalo, 1 pájaro,
     2 luciérnaga). Van en ese orden y se mezclan como antes: pétalos y pájaros tapan, la luz
     de las luciérnagas se suma. */
  const OVER_VERT = [
    'layout(location = 0) in vec2 aQuad;',
    'layout(location = 1) in vec4 aBox;',
    'layout(location = 2) in vec4 aP;',
    'layout(location = 3) in vec4 aQ;',
    'out vec4 vBox;',
    'out vec4 vP;',
    'out vec4 vQ;',
    'void main(){',
    '  vBox = aBox; vP = aP; vQ = aQ;',
    '  gl_Position = vec4((aBox.xy + aQuad * aBox.zw) * uRes.y / uRes * 2. - 1., 0., 1.);',
    '}'
  ].join('\n');
  const OVER = [
    '#ifdef CACHE',
    'uniform sampler2D uGeo;',
    '#endif',
    'in vec4 vBox;',
    'in vec4 vP;',
    'in vec4 vQ;',
    'out vec4 fragColor;',

    'void main(){',
    '  vec2 v = gl_FragCoord.xy / uRes.y - vBox.xy;',
    '  if(vQ.x < .5){',
    /* Pétalos del cerezo: caen despacio y el viento los lleva hacia la derecha. vP: cómo está */
    /* girado (coseno y seno), cuánto se ve y cuál es. Los mueve el JS (petals). */
    '    if(dot(v, v) > .00004) discard;',
    '    vec2 dp = vec2(vP.x * v.x + vP.y * v.y, vP.x * v.y - vP.y * v.x);',
    /* Según la estación: pétalos rosas u hojas secas (más grandes, cada una de su color). En */
    /* verano no cae nada y en invierno nieva aparte (FLAKES): lo apaga el JS (petals). */
    '#if SEASON == 2',
    '    float petal = 1. - smoothstep(.0028, .0056, length(dp * vec2(1., 1.6)));',
    '    vec3 pc = mix(vec3(1., .52, .14), vec3(.66, .20, .08), fract(floor(vP.w + .5) * .37));',
    '    pc = mix(pc, pc * vec3(.50, .52, .95), uNight * .6);',
    '#else',
    '    float petal = 1. - smoothstep(.0020, .0042, length(dp * vec2(1., 1.9)));',
    '    vec3 pc = mix(vec3(1., .78, .86), vec3(.62, .56, .86), uNight * .6);',
    '#endif',
    '    float a = petal * vP.z * .9;',
    '    if(a <= 0.) discard;',
    '    fragColor = vec4(pc * a, a);',
    '  }else if(vQ.x < 1.5){',
    /* Una bandada cruza el cielo al atardecer, lejos. vP.x: el aleteo de este pájaro. */
    '    vec2 q = v / .0062;',
    '    float wing = abs(q.y - abs(q.x) * vP.x + .18 * q.x * q.x);',
    '    float bird = (1. - smoothstep(.10, .26, wing)) * (1. - smoothstep(.85, 1., abs(q.x)));',
    '    float a = bird * .62 * (1. - uNight);',
    '    if(a <= 0.) discard;',
    '    fragColor = vec4(vec3(.10, .05, .08) * a, a);',
    '  }else{',
    /* Luciérnagas, de noche. Las tapa el ordenador. vP: su escala, a qué distancia está, cuánto */
    /* se desenfoca y cuánto brilla; vQ: cuál es y hacia dónde queda su estela (flies2d). */
    '    float k = vP.x;',
    '    float d2 = dot(v, v) * k * k;',
    /* A esta distancia ya no llega ni el resplandor amplio ni la estela. */
    '    if(d2 > .25) discard;',
    '#ifdef CACHE',
    '    float tObj = texelFetch(uGeo, ivec2(gl_FragCoord.xy), 0).y;',
    '    if(tObj < 0.) tObj = 1e4;',
    '#else',
    '    vec2 uv = (gl_FragCoord.xy - uFocus) / uRes.y;',
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
    '    if(vP.y >= tObj) discard;',
    /* Un punto vivo, un halo, un resplandor amplio y la estela de por dónde acaba de pasar. */
    /* Las que vuelan pegadas a la cámara salen desenfocadas, como discos de luz. */
    '    vec3 tint = mix(vec3(.72, 1., .30), vec3(1., .86, .34), hash(vec2(floor(vQ.y + .5), 2.9)));',
    '    float g = 1.5 * exp(-d2 / .00042) + .30 * exp(-d2 / .0055) + .040 * exp(-d2 / .070);',
    /* Estela. */
    '    vec2 ab = vQ.zw;',
    '    float h = clamp(dot(v, ab) / max(dot(ab, ab), 1e-7), 0., 1.);',
    '    vec2 dt = v - ab * h;',
    '    g += .34 * exp(-dot(dt, dt) * k * k / .00050) * (1. - h) * (1. - h);',
    /* Desenfoque de las cercanas: un disco suave con el borde algo más marcado. */
    '    float blur = vP.z;',
    '    if(blur > 0.){',
    '      float rr = length(v) / blur;',
    '      g = g * .35 + (1. - smoothstep(.55, 1., rr)) * (.13 + .07 * smoothstep(.55, .95, rr));',
    '    }',
    '    fragColor = vec4(min(tint * g * vP.w, vec3(1.)) * smoothstep(.35, 1., uNight), 0.);',
    '  }',
    '}'
  ].join('\n');

  /* Escalones de calidad, del mejor al más ligero. Todos los equipos empiezan en el más ligero
     y van subiendo mientras les sobre tiempo (ver «Calidad», en setup()).
     - side: lado mayor del lienzo, en píxeles; por encima de esto se estira.
     - part: qué parte de las briznas se pinta (las que quedan, más anchas).
     - tall: briznas de cuatro tramos (true) o de dos.
     - lit: cuántas luciérnagas alumbran la hierba (se ven todas siempre).
     - sharp: enfoque del cerezo. */
  const LEVELS = [
    {side:1920, part:1, tall:true, lit:40, sharp:1},
    {side:1600, part:0.72, tall:true, lit:40, sharp:1},
    {side:1366, part:0.5, tall:true, lit:24, sharp:1},
    {side:1152, part:0.34, tall:false, lit:16, sharp:0},
    {side:960, part:0.22, tall:false, lit:8, sharp:0},
    {side:800, part:0.14, tall:false, lit:0, sharp:0}
  ];
  /* Los modos en que se puede pintar, del preferido al último: un escalón (l) y cada cuántos
     fotogramas de la pantalla se pinta (n). Manda la fluidez (el dueño: «aunque tenga mala
     calidad, que se vea fluido»): primero todos los escalones pintando en cada fotograma de la
     pantalla, sea de 60 Hz o de 144; solo si ni el más ligero da, uno de cada dos, y lo último,
     el más ligero uno de cada tres. */
  const MODES = LEVELS.map((q, l) => ({l, n:1}))
    .concat(LEVELS.map((q, l) => ({l, n:2})).slice(2), [{l:LEVELS.length - 1, n:3}]);
  /* Por dónde se empieza: el escalón más ligero, en cada fotograma. Y el de una imagen quieta:
     el mejor. */
  const MODE_START = LEVELS.length - 1, MODE_STILL = 0;
  /* Las imágenes de espera (ver WAIT): una de noche y otra de atardecer. Sus medidas y dónde
     cae en ellas el ordenador están en src/boot.js (window.__authPoster), que es quien las
     pone de fondo desde el primer fotograma. Abarcan más ancho que cualquier ventana; lo poco
     que pueda faltar por arriba es cielo y se estira. Se generan con
     Workhub.views.authScene.poster(true | false). */
  const POSTER = window.__authPoster;
  /* La pantalla de acceso no se ve: ni oculta ni enseñada antes de tiempo (auth-early). */
  /* En móviles y tabletas no hay escena (WORKHUB_AUTH.plain, en auth-early.js): si una ventana
     de escritorio se estrecha hasta ahí, se para; al ensancharla, sigue. */
  const PLAIN = (window.WORKHUB_AUTH && window.WORKHUB_AUTH.plain) || {matches:false};
  const onPlain = (fn, opts) => { if(PLAIN.addEventListener) PLAIN.addEventListener('change', fn, opts); };
  const away = (screen) => PLAIN.matches || (screen.hidden && !document.documentElement.classList.contains('auth-early'));
  /* Qué parte del tiempo de cada fotograma puede llevarse la escena, como mucho: el resto es
     para el navegador, que el formulario tiene que seguir yendo fino. */
  const BUDGET = 0.62;
  /* La calidad en la que se asentó este equipo se guarda en el navegador (MEMO_KEY) y la visita
     siguiente arranca ya en ella, sin volver a subir desde lo más ligero: la escena sale de
     primeras como va a quedar. Vale MEMO_DAYS días, para la misma tarjeta gráfica, la misma
     estación (en invierno no hay hierba y cuesta otra cosa) y una ventana parecida; si no, se
     empieza como la primera vez. */
  const MEMO_KEY = 'workhub_scene_q', MEMO_DAYS = 14;
  /* Desde /app/. La imagen (2048x1024) trae dos capas del mismo encuadre, una al lado de la
     otra: a la izquierda la madera y a la derecha las flores. */
  /* Hasta dónde se corre la imagen de espera: la misma que en el sombreador (WARP_X1 en WAIT). */
  const WARP_X1 = -0.30;
  const TREE_URL = '../assets/img/' + ['sakura', 'tree-summer', 'tree-autumn', 'tree-winter'][SEASON] + '.webp';
  /* ---------- Las flores (primavera) ----------
     Flores sueltas entre la hierba. Como el arbolado lejano, cada una es un rectángulo que mira
     a la cámara; lo que lleva pintado sale de una imagen (assets/img/flowers.webp, la hace
     scripts/make-flowers.js de un modelo 3D): varias flores, una al lado de otra, cada una en
     su casilla cuadrada con el pie del tallo abajo en el centro. Se pintan antes que la hierba
     y escriben la profundidad, así que las briznas de delante las tapan y ellas tapan a las de
     detrás. aInst: raíz (x, z), azar y cuál de las flores. uCells: cuántas trae la imagen. */
  const FLOWERS_VERT = [
    'layout(location = 0) in vec2 aQuad;',
    'layout(location = 1) in vec4 aInst;',
    'uniform float uCells;',
    'out vec2 vUv;',
    'out vec3 vLight;',
    'out vec3 vExtra;',
    'out vec4 vFog;',

    'void main(){',
    '  setupTree();',
    '  float base = uBase;',
    '  vec3 ta = vec3(0., base + 1.02, 0.);',
    '  vec3 ro = vec3(2.2, base + .62, -11.5);',
    '  vec3 fw = normalize(ta - ro), rt = normalize(cross(vec3(0., 1., 0.), fw)), up = cross(fw, rt);',
    '  vec3 L = sunDir();',
    '  vec2 r0 = aInst.xy;',
    '  float rnd = aInst.z, kind = aInst.w;',
    '  vec3 root = vec3(r0.x, terrain(r0) - .03, r0.y);',
    /* Ni dentro del lago ni en su orilla. */
    '  float h = (.50 + .34 * rnd) * step(WATER_Y + .10, root.y);',
    '  vec3 side = normalize(vec3(rt.x, 0., rt.z));',
    /* El viento las mece: el pie quieto y la flor, arriba, de un lado a otro; unas van del */
    /* derecho y otras del revés, para que no sean todas la misma. */
    '  float sway = sin(uTime * 1.3 + r0.x * .9 + r0.y * .6) * .055 + sin(uTime * 2.9 + r0.x * 2.3 + rnd * 9.) * .02;',
    /* El cursor: las flores de su alrededor se apartan con la hierba, como si pasara una mano */
    /* (la misma cuenta que en GRASS_SIM): se tumban hacia fuera y bajan un poco. */
    '  vec2 bend = vec2(0.);',
    '  if(uMouse.z > .002){',
    '    vec3 v0 = root - ro;',
    '    float z0 = max(dot(v0, fw), .3);',
    '    vec2 f0 = uFocus + uRes.y * 1.5 * vec2(dot(v0, rt), dot(v0, up)) / z0;',
    '    vec2 md = (f0 - uMouse.xy) / uRes.y * z0 / 1.5;',
    '    md.y *= 2.4;',
    '    float push = exp(-dot(md, md) / .62) * uMouse.z;',
    '    bend = normalize(rt.xz * md.x + normalize(fw.xz) * md.y + 1e-4) * push * .85;',
    '    h *= 1. - .30 * push;',
    '  }',
    '  float k = aQuad.y * aQuad.y;',
    '  vec3 p = root + side * (aQuad.x * .5 + sway * k) * h + vec3(bend.x * k * h, aQuad.y * h, bend.y * k * h);',
    '  float flip = step(.5, fract(rnd * 7.3)) * 2. - 1.;',
    '  vUv = vec2((kind + .5 + aQuad.x * .5 * flip) / uCells, aQuad.y);',
    /* La luz, una por flor: la del suelo, con las manchas de sombra de las nubes. */
    '  float cloudSh = smoothstep(.34, .66, fbm3(r0 * .075 + vec2(uTime * .035, uTime * .014)));',
    '  vec3 rd = normalize(root - ro);',
    '  vLight = ambientColor() * 1.5 + skyLightColor() * 2.2 + sunColor() * (1.5 + 1.2 * pow(max(dot(rd, L), 0.), 3.)) * mix(.40, 1., cloudSh) * mix(1., .75, uNight);',
    /* Luces de cerca, como en la hierba (GRASS_SIM): la pantalla del ordenador y, de noche, las
       luciérnagas. Se miden desde la flor, que es lo que se ve, no desde el pie del tallo. */
    '  vec3 head = root + vec3(0., h * .75, 0.);',
    '  vec3 sn = vec3(0., 0., -1.); sn.xz = rot(-YAW) * sn.xz;',
    '  vec3 sc = vec3(0., 1.16, -.66) * CS; sc.xz = rot(-YAW) * sc.xz; sc.y += base;',
    '  vec3 tl = sc - head;',
    '  float dl = length(tl);',
    '  float spill = max(dot(normalize(tl), vec3(0., 1., 0.)) * .6 + .4, 0.) * max(dot(-normalize(tl), sn), 0.) / (1. + dl * dl * .5);',
    '  vec3 extra = screenLight() * spill * mix(mix(1.6, .9, uDay), 7.0, uNight);',
    '  if(uNight > .01){',
    '    vec3 fl = vec3(0.);',
    '    for(int i = 0; i < FF_N; i++){',
    '      if(i >= uFFLit) break;',
    '      vec3 d = uFF[i].xyz - head;',
    '      float q = dot(d, d);',
    '      if(q < 2.4) fl += vec3(.80, 1., .34) * max(uFF[i].w - .15, 0.) * exp(-q * 3.2);',
    '    }',
    '    extra += fl * 1.5 * uNight;',
    '  }',
    '  vExtra = extra;',
    /* Bruma: la misma que el suelo. */
    '  float dist = length(root - ro);',
    '  vFog = vec4(mix(fogColor(rd, L), skyBase(normalize(vec3(rd.x, .03, rd.z)), L), .28), 1. - exp(-dist * mix(.017, .024, uNight)));',
    '  vec3 v = p - ro;',
    '  float zv = dot(v, fw);',
    '  vec2 frag = uFocus + uRes.y * 1.5 * vec2(dot(v, rt), dot(v, up)) / zv;',
    '  vec2 ndc = frag / uRes * 2. - 1.;',
    '  float zn = (Z_FAR * (zv - Z_NEAR) / ((Z_FAR - Z_NEAR) * zv)) * 2. - 1.;',
    '  gl_Position = vec4(ndc * zv, zn * zv, zv);',
    '}'
  ].join('\n');
  const FLOWERS_FRAG = [
    'uniform sampler2D uFlowers;',
    'in vec2 vUv;',
    'in vec3 vLight;',
    'in vec3 vExtra;',
    'in vec4 vFog;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec4 t = texture(uFlowers, vUv);',
    '  if(t.a < .06) discard;',
    '  vec3 alb = t.rgb * t.rgb;',
    /* De noche el ojo casi no ve el color: sin esto, con la luz azul, salían todas de un azul */
    /* encendido. Quedan pálidas, y las claras siguen siendo las que más se ven. */
    '  alb = mix(alb, vec3(dot(sqrt(alb), vec3(.30, .59, .11))) * vec3(1.0, 1.12, 1.34), uNight * .72);',
    '  vec3 light = mix(vLight, vec3(dot(vLight, vec3(.333))) * vec3(.80, .96, 1.04), uNight * .85);',
    '  vec3 col = mix(alb * (light + vExtra), vFog.rgb, vFog.a);',
    /* La transparencia del borde la reparte el suavizado del lienzo (ver draw). */
    '  fragColor = vec4(post(col, gl_FragCoord.xy), t.a);',
    '}'
  ].join('\n');
  /* Dónde va cada flor: a corros (cada corro, casi todo de un color), más cerca que lejos, en
     el abanico que ve la cámara y sin pegarse a ella (de cerca la imagen se vería borrosa) ni
     al ordenador. kinds: cuántas flores distintas trae la imagen. */
  const FLOWERS = 720;
  function flowerField(kinds){
    let seed = 4121;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const patches = [];
    for(let i = 0; i < 64; i++){
      const r = 4.6 + 20 * Math.pow(rnd(), 1.5), a = CAM_YAW + (rnd() - 0.5) * 2.0;
      patches.push([CAM_X + Math.sin(a) * r, CAM_Z + Math.cos(a) * r, 0.35 + 1.5 * rnd(), Math.floor(rnd() * kinds)]);
    }
    const data = new Float32Array(FLOWERS * 4);
    for(let i = 0; i < FLOWERS; i++){
      const g = patches[Math.floor(rnd() * patches.length)];
      const a = rnd() * Math.PI * 2, d = g[2] * Math.sqrt(rnd());
      let x = g[0] + Math.cos(a) * d, z = g[1] + Math.sin(a) * d;
      /* La que cae pegada al ordenador se aparta. */
      const near = Math.hypot(x, z);
      if(near < 1.5){ x *= 1.5 / Math.max(near, 0.01); z *= 1.5 / Math.max(near, 0.01); }
      data.set([x, z, rnd(), rnd() < 0.82 ? g[3] : Math.floor(rnd() * kinds)], i * 4);
    }
    return data;
  }

  /* ---------- La nevada (invierno) ----------
     Es el «Snowfall WebGL Shader» de Boris Šehovac (codepen.io/bsehovac/pen/GPwXxq), traído a
     esta escena: miles de puntos repartidos en una caja delante de una cámara propia (a 100
     de distancia, 60 grados), que caen, dan la vuelta por arriba al salir por abajo, se mecen
     en una hélice y se van con un viento que cambia de fuerza y de lado (lo lleva el JS, wind).
     Los de cerca pasan grandes y desenfocados. Se suman a lo pintado, como allí. El copo de
     aquel es una imagen: una mancha blanca redonda y difusa, que aquí se calcula (misma forma).
     aPos: dónde nace. aSpeed: cuánto le empuja el viento, a qué velocidad cae y el ritmo del
     vaivén. aLook: tamaño, anchura del vaivén y opacidad. uWorld: media caja (ancho, alto). */
  const FLAKES_VERT = [
    'layout(location = 0) in vec3 aPos;',
    'layout(location = 1) in vec3 aSpeed;',
    'layout(location = 2) in vec3 aLook;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform float uWind;',
    'uniform vec2 uWorld;',
    'out float vAlpha;',
    'void main(){',
    '  float t = uTime / 5.;',
    '  vec3 pos = aPos;',
    '  pos.x = mod(pos.x + t + uWind * aSpeed.x, uWorld.x * 2.) - uWorld.x;',
    '  pos.y = mod(pos.y - t * aSpeed.y * 100., uWorld.y * 2.) - uWorld.y;',
    '  pos.x += sin(t * aSpeed.z) * aLook.y;',
    '  pos.z += cos(t * aSpeed.z) * aLook.y;',
    '  float w = 100. - pos.z;',
    '  vAlpha = aLook.z;',
    /* Los que quedan detrás de la cámara, fuera. Y un tope al tamaño: pegado a la cámara un */
    /* copo llenaría la pantalla. */
    '  gl_Position = w < 1. ? vec4(2., 2., 2., 1.) : vec4(pos.x * 1.7320508 * uRes.y / uRes.x, pos.y * 1.7320508, 0., w);',
    '  gl_PointSize = min(aLook.x * uRes.y / 1000. / max(w, 1.) * 100., uRes.y * .22);',
    '}'
  ].join('\n');
  const FLAKES_FRAG = [
    'uniform float uNight;',
    'in float vAlpha;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 v = gl_PointCoord - .5;',
    '  float a = .757 * exp(-dot(v, v) / .061) * vAlpha;',
    '  fragColor = vec4(mix(vec3(1.), vec3(.72, .78, 1.), uNight * .6) * a, 0.);',
    '}'
  ].join('\n');
  /* Los copos para una ventana de esa proporción (asp: ancho entre alto), como en el original:
     7000 por cada alto de ancho, en una caja de 110 de media altura. Nueve números por copo. */
  function flakes(asp){
    const count = Math.round(asp * 7000), data = new Float32Array(count * 9);
    const width = asp * 110, height = 110, depth = 80;
    for(let i = 0; i < count; i++){
      data.set([
        -width + Math.random() * width * 2, -height + Math.random() * height * 2, Math.random() * depth * 2,
        1 + Math.random(), 1 + Math.random(), Math.random() * 10,
        25 * Math.random(), Math.random() * 10, 0.1 + Math.random() * 0.2
      ], i * 9);
    }
    return {data, count, world:[width, height]};
  }

  /* Briznas de hierba. Se reparten en un abanico delante de la cámara, muchas más cerca que
     lejos (de lejos cada una se ensancha y cubre más). Si el equipo va justo se pinta solo
     una parte (LEVELS): salen en orden al azar, así que cualquier tramo inicial cubre toda la
     colina; antes de subirlas, las de cada escalón se ordenan de cerca a lejos (nearFirst). */
  const BLADES = 420000;
  /* Desde este escalón (ver LEVELS) el equipo cuenta como modesto: html.scene-lite. */
  const LITE_FROM = 3;
  /* La cámara de la escena, vista desde arriba: dónde está y hacia dónde mira. */
  const CAM_X = 2.2, CAM_Z = -11.5, CAM_YAW = Math.atan2(-2.2, 11.5);

  /* El abanico normal de briznas, a cada lado de donde mira la cámara (radianes). */
  const FAN = 0.85;
  /* from, to: entre qué ángulos se reparten (ver widen(), para ventanas muy anchas). */
  function blades(from, to){
    const data = new Float32Array(BLADES * 4);
    /* Azar con semilla: la colina es la misma en cada visita. */
    let seed = 20261004;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const far = new Float32Array(BLADES);
    for(let i = 0; i < BLADES; i++){
      const r = 0.7 + 27 * Math.pow(rnd(), 1.32);
      const a = from + rnd() * (to - from);
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
      /* Salen del lado del árbol y el viento se los lleva. */
      const sp = 0.028 + hash(i, 2.2) * 0.030;
      const v = hash(i, 9.1) + t * sp, ph = v - Math.floor(v);
      const ang = t * (0.6 + hash(i, 5.5)) + i;
      out[i * 4] = -0.05 + hash(i, 4.7) * 0.30 * asp + ph * (0.55 + hash(i, 6.3) * 0.5) * asp + 0.020 * Math.sin(t * 0.9 + i * 3.1);
      out[i * 4 + 1] = 0.95 - ph * 1.05 + 0.020 * Math.cos(t * 1.3 + i * 1.7);
      out[i * 4 + 2] = Math.cos(ang);
      out[i * 4 + 3] = Math.sin(ang);
      /* En verano no cae nada; en invierno nieva, que va aparte (FLAKES). */
      alpha[i] = SEASON === 1 || SEASON === 3 ? 0 : st(0, 0.08, ph) * (1 - st(0.85, 1, ph));
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

  /* Cuánto hay que correr la imagen de espera para que la loma del cerezo, que en ella está
     en un sitio fijo, quede bajo el cerezo de esta ventana (uWarp, ver WAIT): dónde cae el pie
     del árbol en pantalla, en alturas desde el ordenador, aquí y en la imagen. Si el cerezo
     queda pegado al ordenador (ventanas estrechas) se corre menos, o nada: la imagen no puede
     estirarse tanto en tan poco sitio. */
  function posterWarp(place){
    const foot = (at) => {
      const ro = [CAM_X, at.base + 0.62, CAM_Z];
      const fl = Math.hypot(2.2, 0.4, 11.5), fw = [-2.2 / fl, 0.4 / fl, 11.5 / fl];
      const rl = Math.hypot(fw[2], fw[0]), rt = [fw[2] / rl, 0, -fw[0] / rl];
      const up = [fw[1] * rt[2], fw[2] * rt[0] - fw[0] * rt[2], -fw[1] * rt[0]];
      const v = [at.tree[0] - ro[0], TREE_H - ro[1], at.tree[1] - ro[2]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return [1.5 * dot(v, rt) / dot(v, fw), 1.5 * dot(v, up) / dot(v, fw)];
    };
    const here = foot(place);
    const there = foot(placeAt(POSTER.w, POSTER.h, POSTER.fx, POSTER.h - POSTER.fy, POSTER.fx + POSTER.tree * POSTER.h, 1));
    const dx = there[0] - here[0], room = WARP_X1 - here[0];
    if(room <= 0.02) return [WARP_X1 - 1, 0, 0];
    const k = Math.min(1, 0.4 * room / Math.max(Math.abs(dx), 1e-6));
    return [here[0], dx * k, (there[1] - here[1]) * k];
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

  /* ---------- Arrancar, parar y volver a arrancar ----------
     La escena no se prepara hasta que la pantalla de acceso se ve por primera vez: quien entra
     con la sesión ya iniciada no paga la compilación de los sombreadores. Y se puede quitar
     del todo (enable(false), el botón del acceso: ver WORKHUB_AUTH.setScene en auth-early.js):
     se para, suelta la tarjeta gráfica y no queda nada escuchando. Si se vuelve a pedir, o si
     el navegador pierde el contexto (lost), es una escena nueva en un lienzo nuevo.
     host: la pantalla de acceso, el panel y el lienzo de ahora. engine: la escena en marcha.
     broken: no hay WebGL 2, o el contexto se ha perdido ya demasiadas veces. */
  let host = null, engine = null, wanted = false, pending = false, broken = false, losses = 0;
  /* Tras perder el contexto, el escalón del que ya no se pasa: lo más probable es que la tarjeta
     no pudiera con el de antes. */
  let cap = 0;
  function go(){
    /* Hasta que la tarjeta se ve de verdad, no: con la pantalla enseñada a medias (auth-early)
       basta la imagen de fondo, y arrancar antes retrasaba medio segundo el formulario. */
    if(!wanted || engine || pending || broken || !host || host.screen.hidden || document.hidden || PLAIN.matches) return;
    pending = true;
    /* Y no antes de que la foto de espera esté pintada (WORKHUB_AUTH.painted, en
       auth-early.js): compilar ocupa a la tarjeta, y en un equipo modesto la foto no salía. */
    const EARLY = window.WORKHUB_AUTH;
    const painted = EARLY && EARLY.painted ? EARLY.painted() : Promise.resolve();
    painted.then(() => requestAnimationFrame(() => setTimeout(() => {
      pending = false;
      if(!wanted || engine) return;
      engine = boot(host.canvas, host.screen, host.focusEl);
      if(!engine) broken = true;
    }, 0)));
  }
  /* Un lienzo que ha tenido contexto no sirve para otro: se cambia por uno nuevo. */
  function renew(){
    const fresh = document.createElement('canvas');
    fresh.id = host.canvas.id;
    host.canvas.replaceWith(fresh);
    host.canvas = fresh;
  }
  function stop(){
    if(!engine) return;
    engine.destroy(true);
    engine = null;
    renew();
  }
  /* El navegador ha tirado el contexto (la tarjeta se reinició, o iba ahogada). at: el escalón
     en el que pasó. Se vuelve a empezar, un par de veces como mucho, sin pasar del siguiente. */
  function lost(at){
    if(!engine) return;
    engine.destroy(false);
    engine = null;
    renew();
    cap = Math.min(LEVELS.length - 1, Math.max(cap, at + 1));
    if(++losses > 2){ broken = true; return; }
    setTimeout(go, 1500);
  }
  function start(canvas, screen, focusEl){
    host = {canvas, screen, focusEl};
    /* La imagen de fondo sí, desde ya: no cuesta nada. */
    backdrop(screen);
    new MutationObserver(go).observe(screen, {attributes:true, attributeFilter:['hidden']});
    document.addEventListener('visibilitychange', go);
    onPlain(go);
    enable(!document.documentElement.classList.contains('scene-off'));
    return true;
  }
  function enable(on){
    wanted = !!on;
    if(!host) return;
    if(wanted) requestAnimationFrame(go);
    else stop();
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
      ['uRes', 'uTime', 'uFocus', 'uNight', 'uDay', 'uDawn', 'uMouse', 'uSnow', 'uWind', 'uWorld', 'uFlowers', 'uCells', 'uUI', 'uText', 'uTextW', 'uTree', 'uTreeOn', 'uTreeX', 'uTreeS', 'uWide', 'uGrow', 'uFF', 'uFFp', 'uBase', 'uFFLit', 'uSharp', 'uGeo', 'uShade', 'uMode', 'uPetal', 'uPetalA', 'uRaw', 'uPoster', 'uPosterMap', 'uWarp', 'uFade', 'uScene', 'uFly', 'uFlyB'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
      return {prog, U};
    }
    /* Lo que se enseña mientras tanto (ver WAIT), en dos programas que se piden antes que nada
       para que acaben los primeros: la imagen sola, que es casi inmediato, y la imagen con la
       pantalla del ordenador en vivo. Si no se puede compilar en segundo plano no hay espera
       que cubrir. */
    /* Desactivado (oct-2026): mientras se compila ya no se pinta la imagen nítida en el lienzo,
       sino que se ve la foto desenfocada que pone auth.css (.auth-scene::before y ::after, la
       coloca auth-early.js) y la escena entra encima con un fundido, como si enfocara: lo
       prefirió el dueño. De paso son dos programas menos que compilar en un equipo modesto.
       La línea de antes, por si se quiere volver a la espera en el lienzo (y waits, abajo):
       holds = parallel ? [prepare(VERT, HEAD + '#define LIVE\n' + COMMON + '\n' + SCREEN + '\n' + TREE_FN + '\n' + WAIT), prepare(VERT, HEAD + COMMON + '\n' + WAIT)] : []; */
    const holds = [];
    const held = [null, null];
    /* Por orden: hierba (dos pasos), arbolado, lo de delante, lo que no cambia, lo fijo de la
       hierba, su luz y, al final, la
       escena: cielo, suelo, carcasa, pantalla y lo que se pone en cada fotograma (ver FRAG) o,
       sin CACHE, un solo programa con todo. */
    const part = (n) => prepare(VERT, HEAD + DEF + '#define PART ' + n + '\n' + COMMON + '\n' + GEO + '\n' + TREE_FN + '\n' + FRAG);
    const queue = [
      prepare(HEAD + COMMON + '\n' + GRASS_CAM + '\n' + GRASS_SIM, HEAD + 'out vec4 c;void main(){c=vec4(0.);}', ['oA']),
      prepare(HEAD + COMMON + '\n' + GRASS_CAM + '\n' + GRASS_VERT, HEAD + COMMON + '\n' + GRASS_FRAG),
      prepare(HEAD + COMMON + '\n' + TREES_VERT, HEAD + COMMON + '\n' + TREES_FRAG),
      prepare(HEAD + COMMON + '\n' + OVER_VERT, HEAD + DEF + COMMON + '\n' + OVER),
      cache ? prepare(VERT, HEAD + COMMON + '\n' + GEO + '\n' + BAKE) : null,
      prepare(HEAD + COMMON + '\n' + GRASS_BASE, HEAD + 'out vec4 c;void main(){c=vec4(0.);}', ['oB0', 'oB1', 'oB2', 'oB3']),
      prepare(HEAD + COMMON + '\n' + GRASS_LIGHT, HEAD + 'out vec4 c;void main(){c=vec4(0.);}', ['oLight', 'oExtra'])
    ].concat(cache ? [part(1), part(2), part(3), prepare(VERT, HEAD + COMMON + '\n' + SCREEN + '\n' + GLASS), prepare(VERT, HEAD + COMMON + '\n' + TREE_FN + '\n' + COMP)] : [part(0)]);
    /* En invierno, al final de la lista, la nevada (ver FLAKES_VERT). */
    if(SEASON === 3) queue.push(prepare(HEAD + FLAKES_VERT, HEAD + FLAKES_FRAG));
    /* Y en primavera, las flores (ver FLOWERS_VERT). */
    if(SEASON === 0) queue.push(prepare(HEAD + COMMON + '\n' + FLOWERS_VERT, HEAD + COMMON + '\n' + FLOWERS_FRAG));
    const compiled = () => !parallel || gl.isContextLost() || queue.every((p) => !p || gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR));
    return setup(gl, canvas, screen, focusEl, cache, {
      /* Hay espera que cubrir: se compila en segundo plano. */
      waits: false,
      /* El programa de la imagen de espera: con la pantalla en vivo en cuanto está; antes, el
         de la imagen sola; null si aún no hay ninguno. */
      hold(){
        holds.forEach((p, i) => {
          if(p && gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR)){ held[i] = finish(p); holds[i] = null; }
        });
        return held[0] || held[1];
      },
      lost,
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
  }

  function setup(gl, canvas, screen, focusEl, cache, kit){
    /* Los programas llegan cuando acaban de compilarse (live); hasta entonces, la imagen de espera. */
    let sim = null, grass = null, wood = null, over = null, bake = null, grassBase = null, shine = null, scenes = [], fall = null, bloom = null, live = false;
    /* dead: esta escena se ha parado para siempre (se quitó el paisaje o se perdió el contexto;
       ver destroy). heard y watch: con qué se apunta todo lo que escucha, para soltarlo de golpe. */
    let dead = false;
    const life = new AbortController(), heard = {signal:life.signal}, watching = [];
    const watch = (fn, node, names) => {
      const o = new MutationObserver(fn);
      o.observe(node, {attributes:true, attributeFilter:names});
      watching.push(o);
    };
    kit.linked((list) => {
      if(dead) return;
      sim = list[0]; grass = list[1]; wood = list[2]; over = list[3]; bake = list[4]; grassBase = list[5]; shine = list[6]; scenes = list.slice(7);
      if(SEASON === 3) fall = scenes.pop();
      if(SEASON === 0) bloom = scenes.pop();
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
       para cada una en cada fotograma (un vec4). lightBuf: su luz, que GRASS_LIGHT rehace por
       turnos (dos vec4; lit: para cuántas briznas está calculada; lightFrom: por cuál va el
       turno; lightAt: cuándo fue el último). */
    /* baseBuf: lo que GRASS_BASE calcula para cada una y no cambia (cuatro vec4). grown: para
       cuántas briznas y con qué luz está calculado. field: todas las briznas, en su orden al
       azar; sown: cuántas hay subidas a instBuf, ordenadas de cerca a lejos. */
    const instBuf = gl.createBuffer(), simBuf = gl.createBuffer(), baseBuf = gl.createBuffer(), lightBuf = gl.createBuffer();
    let grown = 0, grownNight = -1, grownDay = -1, grownAt = 0, lit = 0, lightFrom = 0, lightAt = 0;
    /* De lejos una brizna mide pocos píxeles y su curva no se distingue: se pinta con menos
       tramos. Como van ordenadas de cerca a lejos, son tres tandas seguidas: hasta lodA, de
       cuatro tramos; hasta lodB, de dos; el resto, un triángulo. lodFor: para qué briznas y
       qué alto de lienzo está hecha la cuenta. */
    let lodA = 0, lodB = 0, lodFor = '';
    function lods(count){
      const key = count + ':' + canvas.height + ':' + sown;
      if(key === lodFor) return;
      lodFor = key;
      /* A esta distancia una brizna mide unos 18 píxeles de alto (con dos tramos su curva se
         aparta de la de cuatro menos de un píxel), y a esta otra, unos 8. */
      const a = canvas.height / 60, b = canvas.height / 27;
      lodA = 0; lodB = 0;
      for(let i = 0; i < count; i++){ if(field.far[i] <= a) lodA++; if(field.far[i] <= b) lodB++; }
    }
    /* Sembrar las briznas lleva unas décimas: se hace aparte, mientras se compila (plant). */
    let planted = false, field = null, sown = 0;
    /* El abanico de briznas cubre una pantalla normal de sobra, pero en una ultrapanorámica la
       hierba se acababa antes del borde y quedaba el terreno pelado (lo vio el dueño). Si la
       ventana enseña más que el abanico, se abre hasta el rayo de cada borde (con un margen) y
       se siembra otra vez; nunca se cierra, así que en una pantalla normal no cambia nada. Con
       las mismas briznas en más sitio, ahí la hierba queda algo más rala. */
    const fan = [CAM_YAW - FAN, CAM_YAW + FAN];
    function widen(){
      if(!field || !place) return;
      const from = CAM_YAW - Math.atan(place.fx / place.h / 1.5) - 0.07;
      const to = CAM_YAW + Math.atan((place.w - place.fx) / place.h / 1.5) + 0.07;
      if(from >= fan[0] - 0.004 && to <= fan[1] + 0.004) return;
      fan[0] = Math.min(fan[0], from); fan[1] = Math.max(fan[1], to);
      field = blades(fan[0], fan[1]);
      sown = 0;
    }
    function plant(){
      if(planted || dead) return;
      planted = true;
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      field = blades(fan[0], fan[1]);
      gl.bufferData(gl.ARRAY_BUFFER, BLADES * 16, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, simBuf);
      gl.bufferData(gl.ARRAY_BUFFER, BLADES * 16, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, baseBuf);
      gl.bufferData(gl.ARRAY_BUFFER, BLADES * 64, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
      gl.bufferData(gl.ARRAY_BUFFER, BLADES * 32, gl.DYNAMIC_COPY);
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
    /* De lo fijo, lo que piden el viento y la luz: oB0, oB1 y oB3. */
    gl.bindBuffer(gl.ARRAY_BUFFER, baseBuf);
    [0, 16, 48].forEach((at, i) => {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 64, at);
    });
    const feedback = gl.createTransformFeedback();
    /* La brizna: una cinta que acaba en punta (lado, altura). */
    function bladeVao(shape){
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      /* Cada vértice: lado, altura y las potencias de la altura que usa GRASS_VERT (aShape),
         que son siempre las mismas y allí se calculaban en cada vértice de cada brizna. */
      const data = [];
      for(let i = 0; i < shape.length; i += 2){
        const t = shape[i + 1];
        data.push(shape[i], t, Math.pow(t, 1.7), 1.7 * Math.pow(Math.max(t, 0.02), 0.7), 1 - Math.pow(t, 1.5));
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(9);
      gl.vertexAttribPointer(9, 3, gl.FLOAT, false, 20, 8);
      for(let i = 1; i <= 8; i++){
        gl.enableVertexAttribArray(i);
        gl.vertexAttribDivisor(i, 1);
      }
      const blade = {vao, count:shape.length / 2, first:-1};
      aim(blade, 0);
      return blade;
    }
    /* Desde qué brizna pinta esa forma (ver lods): lo de cada brizna se lee a partir de ahí.
       Por orden: raíz y azar, viento, luz (dos) y lo fijo (cuatro). */
    function aim(blade, first){
      gl.bindVertexArray(blade.vao);
      if(blade.first === first) return;
      blade.first = first;
      const at = (loc, buf, stride, off) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, first * stride + off); };
      at(1, instBuf, 16, 0); at(2, simBuf, 16, 0); at(3, lightBuf, 32, 0); at(4, lightBuf, 32, 16);
      at(5, baseBuf, 64, 0); at(6, baseBuf, 64, 16); at(7, baseBuf, 64, 32); at(8, baseBuf, 64, 48);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    /* De cuatro tramos; de dos, para las de lejos y para los equipos justos; y un triángulo,
       para las que ya casi no se ven. */
    const bladeTall = bladeVao([-1, 0, 1, 0, -1, 0.3, 1, 0.3, -1, 0.55, 1, 0.55, -1, 0.78, 1, 0.78, 0, 1]);
    const bladeShort = bladeVao([-1, 0, 1, 0, -1, 0.5, 1, 0.5, 0, 1]);
    const bladeTip = bladeVao([-1, 0, 1, 0, 0, 1]);

    /* Lo que va por delante (ver OVER): un recuadro por pétalo, pájaro y luciérnaga. spr: lo de
       cada uno (doce números); sprN: cuántos hay en este fotograma. */
    const SPRITES = PETALS + 6 + FIREFLIES;
    const spr = new Float32Array(SPRITES * 12), sprBuf = gl.createBuffer(), sprVao = gl.createVertexArray();
    let sprN = 0;
    gl.bindVertexArray(sprVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, sprBuf);
    gl.bufferData(gl.ARRAY_BUFFER, spr.byteLength, gl.DYNAMIC_DRAW);
    for(let i = 0; i < 3; i++){
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }

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
    /* Las que alumbran la hierba y el suelo en este fotograma (uFF): de las que le tocan al
       escalón, solo las que están encendidas (por debajo de ,15 de brillo no dan luz). Casi
       siempre son menos de la mitad, y es una cuenta por brizna y por píxel de suelo. */
    const ffLit = new Float32Array(FIREFLIES * 4);
    let ffCount = 0;
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
    let turn = 0, turnAt = 0;
    let stale = true, litNight = -1, litDay = -1, litAt = 0;
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
    let treeReady = false, treeFailed = false, treeFade = 0;
    const treeTex = gl.createTexture();
    const treeImg = new Image();
    treeImg.onload = () => {
      if(dead) return;
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
    treeImg.onerror = () => { treeFailed = true; };
    treeImg.src = TREE_URL;

    /* Primavera: las flores. Su imagen va en la unidad de textura 7; hasta que llega no se
       pintan. Cuántas flores trae lo dice su forma (casillas cuadradas en fila). */
    const bloomVao = gl.createVertexArray(), bloomTex = gl.createTexture();
    let bloomCells = 0;
    if(SEASON === 0){
      const img = new Image();
      img.onload = () => {
        if(dead) return;
        bloomCells = Math.max(1, Math.round(img.width / img.height));
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, bloomTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindVertexArray(bloomVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, flowerField(bloomCells), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        last = 0;
        wake();
      };
      img.src = '../assets/img/flowers.webp';
    }

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
    const gpu = (function(){
      try{
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      }catch(e){ return ''; }
    })();
    const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
    /* La calidad guardada de una visita anterior (ver MEMO_KEY). De la tarjeta no se guarda el
       nombre, solo un número sacado de él, que basta para saber si es la misma. */
    const gpuKey = (function(){ let h = 0; for(let i = 0; i < gpu.length; i++) h = (h * 31 + gpu.charCodeAt(i)) | 0; return h; })();
    const area = () => (canvas.clientWidth || window.innerWidth) * (canvas.clientHeight || window.innerHeight);
    const memo = (function(){
      if(software) return null;
      try{
        const m = JSON.parse(localStorage.getItem(MEMO_KEY));
        const a = area();
        if(m && m.g === gpuKey && m.s === SEASON && MODES[m.m] && Date.now() - m.t < MEMO_DAYS * 864e5 && a <= m.a * 1.3 && a >= m.a * 0.6) return m;
      }catch(e){}
      return null;
    })();
    /* Apunta ese modo para la próxima visita. Con la calidad fijada a mano o la escena quieta
       no: no dicen nada de lo que aguanta el equipo. */
    function remember(m){
      if(pinned || software || stillQuery.matches || root.getAttribute('data-motion') === 'reduced') return;
      try{ localStorage.setItem(MEMO_KEY, JSON.stringify({g:gpuKey, s:SEASON, a:area(), m, t:Date.now()})); }catch(e){}
    }
    const saver = !!(navigator.connection && navigator.connection.saveData);
    /* frozen: la escena se queda en una imagen. Para siempre sin tarjeta gráfica o con ahorro de
       datos; un rato (rest) si el equipo no puede con la animación ni en lo más ligero. */
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
    /* ---------- Calidad (ver LEVELS y MODES) ----------
       Se empieza por lo más ligero, que cualquier equipo mueve y se enseña enseguida, y se sube
       mientras sobre tiempo. Lo que se mira es lo que tarda de verdad la tarjeta gráfica en
       pintar un fotograma (clock, más abajo), no cuándo avisa de que ha acabado: ese aviso
       llega con el fotograma siguiente por poco trabajo que haya (medido: más de 20 ms por un
       lienzo vacío), y fiarse de él bajaba la calidad sin motivo, escalón a escalón, hasta dejar
       la escena parada (lo vio el dueño: «a veces se queda completamente parada»).
       mode: en cuál de MODES se pinta. pinned: fijado a mano (quality), no se toca. cost: por
       dónde ha ido pasando (escalón, fotogramas por segundo y milisegundos medidos). barred:
       hasta cuándo no se vuelve a cada modo, porque al probarlo no dio. */
    /* Con pantalla táctil, nunca por encima del tercer escalón: se calientan enseguida. */
    if(window.matchMedia('(pointer: coarse)').matches) cap = Math.max(cap, 2);
    /* Con la calidad de la visita anterior guardada (memo) se arranca en ella, ya asentada. */
    let mode = memo ? memo.m : MODE_START, level = Math.max(MODES[mode].l, cap), step = MODES[mode].n;
    let pinned = software, measuring = false, settle = 0, shown = false;
    /* swapping: la escena se está retirando para cambiar de calidad sin que se vea (retreat). */
    let swapping = false;
    /* Lo que dura un fotograma de la pantalla, en milisegundos: se mide (beat), porque no todas
       van a 60. steady: la calidad ya ha dejado de moverse; hasta entonces la escena no se
       enseña (ver ready), para que nadie la vea cambiar de resolución al arrancar. */
    let frameMs = 1000 / 60, beatAt = 0, steady = !!memo, liveAt = 0, ups = 0;
    const beats = [];
    const cost = [], barred = MODES.map(() => 0);
    let strikes = 0, barWait = 20000, restWait = 30000, restTimer = 0;
    root.classList.toggle('scene-lite', level >= LITE_FROM);
    /* Para medir: qué pasadas se pintan (1 escena, 2 arbolado, 4 hierba, 8 lo de delante) y con
       qué brizna (null: la del escalón). */
    let passes = 15, tallForced = null;

    /* El cursor sobre la escena (en píxeles de pantalla) y con cuánta fuerza aparta la hierba. */
    const mouse = {x:0, y:0, tx:0, ty:0, s:0, inside:false, moved:0};
    /* Invierno: el viento de la nevada, como en el original (ver FLAKES_VERT): una fuerza que
       tira hacia un objetivo, y el objetivo cambia de vez en cuando de valor y de lado. current
       es lo que lleva empujado cada copo. Allí se contaba por fotograma (a 60); aquí, por
       tiempo, para que nieve igual en un equipo lento. */
    const wind = {current:0, force:0.1, target:0.1, min:0.1, max:0.25, easing:0.005};
    const fallVao = gl.createVertexArray(), fallBuf = gl.createBuffer();
    let fallAsp = 0, fallCount = 0, fallWorld = [0, 0];
    /* Los copos de una ventana de esa proporción: se reparten otra vez si cambia. */
    function sow(asp){
      const f = flakes(asp);
      fallAsp = asp; fallCount = f.count; fallWorld = f.world;
      gl.bindVertexArray(fallVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, fallBuf);
      gl.bufferData(gl.ARRAY_BUFFER, f.data, gl.STATIC_DRAW);
      for(let i = 0; i < 3; i++){
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    /* Invierno: la nieve del suelo se hunde al paso del cursor. La idea es la de «A man walking
       on snow» de Den Dionigi (codepen.io/DenDionigi/pen/vEGwVYQ): el suelo es una malla y lo
       que la pisa hunde los vértices que tiene cerca, y hundidos se quedan; cada pisada resta
       altura con la misma curva que allí ((1 - d)^3 · sen(d·π), con d de 0 en el centro a 1 en
       el borde: un hoyo de centro algo más alto), y pisada tras pisada sale el surco.
       Aquí la malla es una rejilla de alturas que cubre la pantalla (snowMap; la cámara no se
       mueve, así que cada casilla es siempre el mismo trozo de suelo) y quien pisa es el cursor.
       El sombreador no la deforma: lee las alturas e ilumina con su pendiente (uSnow, en la
       unidad de textura 6). Dos cosas de más: la nieve apartada se amontona en los bordes, y,
       como está nevando, las huellas se van tapando despacio (SNOW_HEAL).
       SNOW_SIDE: casillas en el lado largo. SNOW_R: radio de la pisada, en medidas de la escena. */
    const SNOW_SIDE = 640, SNOW_R = 0.24, SNOW_HEAL = 90;
    const snowTex = gl.createTexture();
    let snowMap = null, snowW = 1, snowH = 1, snowFor = null;
    /* snowLast: la última pisada (null: el cursor acaba de llegar). snowArea: el recuadro de
       casillas tocadas, que es lo que hay que ir tapando. snowNew: lo que falta por subir. */
    let snowLast = null, snowArea = null, snowNew = null, snowWait = 0;
    const boxed = (box, i0, j0, i1, j1) => (box ? [Math.min(box[0], i0), Math.min(box[1], j0), Math.max(box[2], i1), Math.max(box[3], j1)] : [i0, j0, i1, j1]);
    function snowUp(box){
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, snowTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if(!box){
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, snowW, snowH, 0, gl.RED, gl.FLOAT, snowMap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }else{
        /* Solo el recuadro que ha cambiado, leído del sitio que le toca en la rejilla. */
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, snowW);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, box[0]);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, box[1]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1, gl.RED, gl.FLOAT, snowMap);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    /* Hasta que haya ventana que medir, una casilla sin pisar. */
    snowMap = new Float32Array(1);
    if(SEASON === 3) snowUp(null);
    /* La rejilla, a la medida de la ventana: nieve nueva cada vez que cambia. */
    function snowFit(){
      if(snowFor === place) return;
      snowFor = place;
      const k = SNOW_SIDE / Math.max(place.w, place.h);
      snowW = Math.max(2, Math.round(place.w * k)); snowH = Math.max(2, Math.round(place.h * k));
      snowMap = new Float32Array(snowW * snowH);
      snowLast = snowArea = snowNew = null;
      snowUp(null);
    }
    /* La cámara (la misma de los sombreadores): hacia dónde mira, su derecha y su arriba. */
    const eyeFw = [-2.2 / Math.hypot(2.2, 0.4, 11.5), 0.4 / Math.hypot(2.2, 0.4, 11.5), 11.5 / Math.hypot(2.2, 0.4, 11.5)];
    const eyeRt = [eyeFw[2] / Math.hypot(eyeFw[2], eyeFw[0]), 0, -eyeFw[0] / Math.hypot(eyeFw[2], eyeFw[0])];
    const eyeUp = [eyeFw[1] * eyeRt[2], eyeFw[2] * eyeRt[0] - eyeFw[0] * eyeRt[2], -eyeFw[1] * eyeRt[0]];
    /* El suelo que hay bajo un punto de la pantalla: k, cuánto mide allí un píxel en medidas
       de la escena; fs, cuántas veces más tumbado que de frente se ve (lo mismo que calcula
       FRAG al leer uSnow). null si ahí no hay suelo cerca (el cielo, las lomas del fondo). */
    function snowAt(x, y){
      const ux = (x - place.fx) / place.h, uy = (place.fy - y) / place.h;
      let rx = eyeFw[0] * 1.5 + ux * eyeRt[0] + uy * eyeUp[0], ry = eyeFw[1] * 1.5 + ux * eyeRt[1] + uy * eyeUp[1], rz = eyeFw[2] * 1.5 + ux * eyeRt[2] + uy * eyeUp[2];
      const rl = Math.hypot(rx, ry, rz);
      rx /= rl; ry /= rl; rz /= rl;
      if(ry > -0.03) return null;
      const oy = place.base + 0.62;
      let t = 0.3;
      for(let i = 0; i < 70; i++){
        const d = oy + ry * t - ground(CAM_X + rx * t, CAM_Z + rz * t, place.tree);
        if(d < 0.015) break;
        t += Math.max(d * 0.7, 0.06);
        if(t > 40) return null;
      }
      return {k:Math.max(t * (rx * eyeFw[0] + ry * eyeFw[1] + rz * eyeFw[2]), 0.3) / (1.5 * place.h), fs:1 / Math.min(Math.max(-ry, 0.30), 1)};
    }
    /* Una pisada en ese punto de la pantalla (at: lo que dice snowAt de él). */
    function stamp(x, y, at){
      const cw = place.w / snowW, ch = place.h / snowH;
      const rx = SNOW_R / at.k / cw, ry = Math.max(SNOW_R / (at.k * at.fs) / ch, 0.9);
      /* Demasiado lejos: la pisada no llega a una casilla. */
      if(rx < 1.3) return;
      const gx = x / cw - 0.5, gy = (place.h - y) / ch - 0.5;
      const i0 = Math.max(0, Math.floor(gx - rx * 1.4)), i1 = Math.min(snowW - 1, Math.ceil(gx + rx * 1.4));
      const j0 = Math.max(0, Math.floor(gy - ry * 1.4)), j1 = Math.min(snowH - 1, Math.ceil(gy + ry * 1.4));
      if(i0 > i1 || j0 > j1) return;
      for(let j = j0; j <= j1; j++){
        for(let i = i0; i <= i1; i++){
          const d = Math.hypot((i - gx) / rx, (j - gy) / ry);
          if(d >= 1.4) continue;
          const o = j * snowW + i;
          let h = snowMap[o];
          /* La curva del original; cada casilla cede un poco distinto y ninguna pasa del fondo. */
          if(d < 1) h = Math.max(h - 1.6 * (1 - d) * (1 - d) * (1 - d) * Math.sin(d * Math.PI) * (0.85 + 0.3 * hash(i, j)), -1);
          /* La nieve apartada: un reborde irregular alrededor, que no rellena lo ya hundido. */
          if(d > 0.7 && h > -0.12){
            const e = (d - 1.06) / 0.17;
            h = Math.max(h, 0.30 * Math.exp(-e * e) * (0.55 + 0.45 * Math.sin(i * 0.9 + j * 1.7) * Math.sin(i * 0.37 - j * 0.53)));
          }
          snowMap[o] = h;
        }
      }
      snowArea = boxed(snowArea, i0, j0, i1, j1);
      snowNew = boxed(snowNew, i0, j0, i1, j1);
    }
    /* El cursor avanza: una pisada cada tercio de radio de camino, para que el surco salga
       igual vaya el cursor deprisa o despacio. Si sale, o da un salto, el trazo se corta. */
    function tread(){
      if(!mouse.inside){ snowLast = null; return; }
      const at = snowAt(mouse.x, mouse.y);
      if(!at){ snowLast = null; return; }
      if(!snowLast || Math.hypot(mouse.x - snowLast.x, mouse.y - snowLast.y) > place.h * 0.3){
        stamp(mouse.x, mouse.y, at);
        snowLast = {x:mouse.x, y:mouse.y};
        return;
      }
      const dx = mouse.x - snowLast.x, dy = mouse.y - snowLast.y;
      /* El camino, medido sobre el suelo: hacia el fondo cunde más de lo que parece. */
      const steps = Math.hypot(dx, dy * at.fs) / (0.3 * SNOW_R / at.k);
      if(steps < 1) return;
      const n = Math.min(Math.floor(steps), 48);
      for(let i = 1; i <= n; i++){
        const x = snowLast.x + dx * i / steps, y = snowLast.y + dy * i / steps;
        const here = snowAt(x, y);
        if(here) stamp(x, y, here);
      }
      snowLast = steps > 48 ? {x:mouse.x, y:mouse.y} : {x:snowLast.x + dx * n / steps, y:snowLast.y + dy * n / steps};
    }
    /* Lo que avanza en invierno con el tiempo: el viento, las pisadas y la nieve que las tapa. */
    function snowfall(dt){
      if(!place) return;
      snowFit();
      if(still) return;
      const frames = dt * 60;
      wind.force += (wind.target - wind.force) * (1 - Math.pow(1 - wind.easing, frames));
      wind.current += wind.force * dt * 200;
      if(Math.random() < 0.005 * frames) wind.target = (wind.min + Math.random() * (wind.max - wind.min)) * (Math.random() > 0.5 ? -1 : 1);
      tread();
      snowWait += dt;
      if(snowArea && snowWait > 0.4){
        const keep = Math.exp(-snowWait / SNOW_HEAL);
        let any = false;
        for(let j = snowArea[1]; j <= snowArea[3]; j++){
          for(let o = j * snowW + snowArea[0], end = j * snowW + snowArea[2]; o <= end; o++){
            const h = snowMap[o] * keep;
            if(h > 0.004 || h < -0.004){ snowMap[o] = h; any = true; }else snowMap[o] = 0;
          }
        }
        snowNew = snowArea;
        if(!any) snowArea = null;
      }
      if(snowWait > 0.4) snowWait = 0;
      if(snowNew){ snowUp(snowNew); snowNew = null; }
    }
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
        if(!place || at.w !== place.w || at.h !== place.h || at.fx !== place.fx || at.fy !== place.fy || at.tx !== place.tx){
          /* Con otro tamaño de ventana, lo que tardaba cada escalón ya no vale. */
          if(place && (at.w !== place.w || at.h !== place.h)) seen.fill(null);
          place = at; stale = true;
        }
        relayout = false;
      }
    }
    /* Pasa a pintar en ese modo. */
    function setMode(i){
      mode = Math.max(0, Math.min(MODES.length - 1, i | 0));
      const to = Math.max(MODES[mode].l, cap);
      step = MODES[mode].n;
      strikes = 0;
      ups = 0;
      ticks.length = 0;
      if(to === level) return;
      level = to;
      /* En los escalones de un equipo modesto, los cristales de la pantalla de acceso dejan de
         desenfocar lo que tienen detrás (auth.css, html.scene-lite): con la escena moviéndose
         debajo, el navegador rehace ese desenfoque en cada fotograma, y a una gráfica integrada
         le cuesta casi tanto como la propia escena. */
      root.classList.toggle('scene-lite', level >= LITE_FROM);
      /* Los primeros fotogramas tras el cambio vuelven a calcular lo que no cambia: no cuentan. */
      settle = performance.now() + (shown ? 300 : 120);
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
      if(SEASON === 3 && p.U.uSnow) gl.uniform1i(p.U.uSnow, 6);
      gl.uniform4f(p.U.uUI, ui.chars, ui.show, ui.busy, ui.res);
      gl.uniform1f(p.U.uTreeX, place.tx * scale);
      gl.uniform1f(p.U.uTreeS, place.ts);
      gl.uniform1f(p.U.uBase, place.base);
      gl.uniform1i(p.U.uFFLit, ffCount);
      gl.uniform1f(p.U.uRaw, raw);
      if(p.U.uFF) gl.uniform4fv(p.U.uFF, ffLit);
    }

    /* Lo que avanza con el tiempo, lo use la escena o la imagen de espera. posing: se está
       generando una imagen de espera (poster): todo quieto, sin cerezo ni luciérnagas. */
    let still = false, time = 0, toNight = 0, toDay = 0, ease = null;
    /* Cada cuánto se rehacen las sombras mientras se mueve el sol (ms). redone: este fotograma
       ha rehecho algo de lo que no cambia, así que pesa más de la cuenta y no sirve de medida. */
    const RELIGHT = 140;
    let redone = false;
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
      if(SEASON === 3) snowfall(dt);
      ui.chars = ease(ui.chars, ui.tChars, 14);
      ui.show = ease(ui.show, ui.tShow, 6);
      ui.busy = ease(ui.busy, ui.tBusy, 7);
      /* El error es un golpe que se apaga solo; el acceso correcto se queda. */
      if(ui.tRes < 0) ui.tRes = Math.min(ui.tRes + dt * 1.4, 0);
      ui.res = ease(ui.res, ui.tRes, 9);
      time = still ? 12 : (now - t0) / 1000;
    }

    /* Los recuadros de lo que va por delante en este fotograma (ver OVER), en el orden en que
       se pintan: pétalos, pájaros y luciérnagas. Lo que no se ve no entra. Todo en alturas de
       pantalla desde la esquina de abajo a la izquierda. */
    function sprites(){
      const asp = canvas.width / canvas.height;
      let n = 0;
      const put = (x, y, hw, hh, p0, p1, p2, p3, q0, q1, q2, q3) => {
        spr.set([x, y, hw, hh, p0, p1, p2, p3, q0, q1, q2, q3], n++ * 12);
      };
      petals(time, asp, petalNow, petalAlpha);
      for(let i = 0; i < PETALS; i++){
        if(petalAlpha[i] > 0) put(petalNow[i * 4], petalNow[i * 4 + 1], 0.0064, 0.0064, petalNow[i * 4 + 2], petalNow[i * 4 + 3], petalAlpha[i], i, 0, 0, 0, 0);
      }
      /* Una bandada cruza el cielo al atardecer, lejos. */
      if(night < 0.99){
        const bt = time * 0.011, fr = bt + 0.37;
        for(let i = 0; i < 6; i++){
          const odd = i % 2;
          const x = (fr - Math.floor(fr)) * (asp + 0.5) - 0.25 - 0.022 * i - 0.010 * odd;
          const y = 0.80 + 0.035 * Math.sin(bt * 9) + (odd * 2 - 1) * 0.011 * Math.ceil(i * 0.5);
          put(x, y, 0.0064, 0.0085, 0.25 + 0.65 * Math.sin(time * 5.5 + i * 1.9), 0, 0, 0, 1, 0, 0, 0);
        }
      }
      /* Luciérnagas, de noche. El recuadro llega hasta donde su luz deja de verse: el
         resplandor amplio de una que está casi apagada no alcanza ni la mitad que el de una
         encendida, y son las más. */
      const dusk = Math.min(Math.max((night - 0.35) / 0.65, 0), 1), nightK = dusk * dusk * (3 - 2 * dusk);
      if(nightK > 0 && SEASON !== 3){
        flies2d();
        const ox = place.fx * scale / canvas.height, oy = (place.h - place.fy) * scale / canvas.height;
        for(let i = 0; i < FIREFLIES; i++){
          const o = i * 4, k = flyA[o + 2], b = flyB[o + 3] * nightK;
          if(flyA[o + 3] > 1e8 || !(k > 0) || b <= 0) continue;
          /* Hasta dónde llega cada cosa por encima de media milésima (un octavo de tono): el
             resplandor amplio, el halo y la estela (que sale del centro hacia atrás). */
          const wide = Math.sqrt(0.070 * Math.max(Math.log(80 * b), 0));
          const halo = Math.sqrt(0.0055 * Math.max(Math.log(600 * b), 0)) + Math.sqrt(0.00042 * Math.max(Math.log(3000 * b), 0));
          const tail = Math.hypot(flyB[o], flyB[o + 1]) * k + Math.sqrt(0.0005 * Math.max(Math.log(680 * b), 0));
          const r = Math.max(Math.min(Math.max(wide, halo, tail), 0.5) / k, flyB[o + 2]);
          if(!(r > 0)) continue;
          put(ox + flyA[o], oy + flyA[o + 1], r, r, k, flyA[o + 3], flyB[o + 2], flyB[o + 3], 2, i, flyB[o], flyB[o + 1]);
        }
      }
      sprN = n;
    }

    function draw(now){
      advance(now);
      const q = LEVELS[level];
      /* Las luciérnagas, ahora y hace un instante (para la estela). */
      for(let i = 0; i < FIREFLIES; i++){
        fly(i, time, place.tree, ffNow, i * 4);
        fly(i, time - 0.22, place.tree, ffBefore, i * 4);
      }
      ffCount = 0;
      for(let i = 0, n = posing || SEASON === 3 ? 0 : q.lit; i < n; i++){
        if(ffNow[i * 4 + 3] > 0.15) ffLit.set(ffNow.subarray(i * 4, i * 4 + 4), ffCount++ * 4);
      }

      /* Lo que no cambia: entero al cambiar el tamaño, y solo las sombras cuando se mueve el sol
         (al cambiar de tema; mientras dura, unas siete veces por segundo, vaya la escena a 30
         fotogramas o a 60: el sol va despacio y rehacerlas es de lo más caro que hay). */
      const fresh = stale;
      const moving = night !== toNight || day !== toDay;
      if(cache){
        if(stale){
          target(gl.TEXTURE2, geoTex, geoFbo, gl.RGBA32F, gl.RGBA, gl.FLOAT);
          target(gl.TEXTURE3, shadeTex, shadeFbo, gl.RG16F, gl.RG, gl.HALF_FLOAT);
          target(gl.TEXTURE5, sceneTex, sceneFbo, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
          bakePass(0, time);
          bakePass(1, time);
          litNight = night; litDay = day; litAt = now; redone = true;
        }else if((night !== litNight || day !== litDay) && (!moving || now - litAt >= RELIGHT)){
          bakePass(1, time);
          litNight = night; litDay = day; litAt = now; redone = true;
        }
      }
      stale = false;

      /* 1. La hierba, antes de pintarla: lo de cada brizna, guardado. No pinta nada. Lo que no
         cambia (baseBuf) solo se rehace al cambiar el tamaño, al entrar briznas nuevas (otro
         escalón) o al moverse el sol; lo demás (simBuf), en cada fotograma. */
      const count = Math.round(BLADES * q.part);
      /* Guarda en buf (stride bytes por brizna) lo de n briznas a partir de first. */
      const store = (vao, buf, stride, first, n) => {
        gl.bindVertexArray(vao);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
        gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf, first * stride, n * stride);
        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, first, n);
        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      };
      if((passes & 4) && SEASON !== 3){
        widen();
        /* Las briznas de este escalón, de cerca a lejos (ver nearFirst). */
        if(sown !== count){
          gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, nearFirst(field, count));
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          sown = count; grown = 0;
        }
        const relit = night !== grownNight || day !== grownDay;
        if(fresh || count !== grown || (relit && (!moving || now - grownAt >= RELIGHT))){
          uniforms(grassBase, time);
          gl.uniform1f(grassBase.U.uWide, 1 / Math.sqrt(q.part));
          store(baseVao, baseBuf, 64, 0, count);
          grown = count; grownNight = night; grownDay = day; grownAt = now; redone = true;
          lit = 0;
        }
        uniforms(sim, time);
        gl.uniform1f(sim.U.uGrow, grow);
        store(simVao, simBuf, 16, 0, count);
        /* La luz, por turnos: en cada fotograma solo una parte de las briznas, la que toca
           para que cada una se ponga al día unas quince veces por segundo, se pinte a 30, a 60
           o a 144; de sobra para unas sombras de nube y unas luciérnagas. Toda de una vez si no
           hay nada hecho, si la escena está quieta (un solo fotograma) o mientras cambia el
           tema. */
        uniforms(shine, time);
        const share = lit !== count || still || moving ? 1 : Math.min((now - lightAt) * 0.015, 1);
        const some = Math.max(1, Math.min(count, Math.ceil(count * share)));
        if(some >= count){ store(simVao, lightBuf, 32, 0, count); lightFrom = 0; }
        else{
          if(lightFrom >= count) lightFrom = 0;
          const first = Math.min(some, count - lightFrom);
          store(simVao, lightBuf, 32, lightFrom, first);
          if(some > first) store(simVao, lightBuf, 32, 0, some - first);
          lightFrom = (lightFrom + some) % count;
        }
        lit = count; lightAt = now;
        lods(count);
      }

      /* 2. La escena, que escribe también la profundidad. */
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, treeTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.activeTexture(gl.TEXTURE0);
      /* El árbol no aparece poco a poco: la escena no se enseña hasta que está (ver ready).
         Solo si su imagen llega tarde, con la escena ya a la vista, entra con un fundido. */
      treeFade = treeReady && !posing ? (shown ? ease(treeFade, 1, 2.6) : 1) : 0;
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
        else if(now - turnAt >= 31){
          /* Uno de los dos cada treintavo de segundo como mucho (quince veces por segundo cada
             uno): cambian muy despacio, y pintando en cada fotograma de una pantalla de 60 o de
             144 Hz se rehacían dos o cinco veces más a menudo sin que se notara. */
          paint(scenes[turn]);
          if(turn === 0) paint(scenes[2]);
          turn = 1 - turn;
          turnAt = now;
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

      /* El relevo de la imagen de espera: va aquí, bajo la hierba, que crece encima mientras la
         imagen se va (ver loop). */
      if(cover > 0){
        drawPoster(cover);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
      }

      /* Primavera: las flores, antes que la hierba. Sin mezcla: el borde de cada una lo suaviza
         el propio lienzo, que reparte su transparencia entre las muestras de cada píxel; así
         pueden escribir la profundidad y cruzarse bien con las briznas. */
      if((passes & 4) && bloom && bloomCells && !posing){
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        uniforms(bloom, time);
        gl.uniform1i(bloom.U.uFlowers, 7);
        gl.uniform1f(bloom.U.uCells, bloomCells);
        gl.bindVertexArray(bloomVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, FLOWERS);
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      }

      /* 4. La hierba, segundo paso: las cintas, delante o detrás de lo ya pintado según su
         profundidad. */
      if((passes & 4) && SEASON !== 3){
        uniforms(grass, time);
        /* Tres tandas, de cerca a lejos (ver lods); en los equipos justos no hay de cuatro tramos. */
        const tall = tallForced === null ? q.tall : tallForced;
        const a = tall ? Math.min(lodA, count) : 0, b = Math.max(a, Math.min(lodB, count));
        [[bladeTall, 0, a], [bladeShort, a, b], [bladeTip, b, count]].forEach((run) => {
          if(run[2] <= run[1]) return;
          aim(run[0], run[1]);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, run[0].count, run[2] - run[1]);
        });
      }

      /* 5. Pétalos, pájaros y luciérnagas, por delante de todo. */
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      uniforms(over, time);
      if(cache) gl.uniform1i(over.U.uGeo, 2);
      if(passes & 8){
        sprites();
        if(sprN){
          gl.bindVertexArray(sprVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, sprBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, spr, 0, sprN * 12);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sprN);
        }
      }
      /* La nevada, encima: los puntos se suman a lo pintado. */
      if((passes & 8) && fall){
        const asp = canvas.width / canvas.height;
        if(Math.abs(asp - fallAsp) > 0.01) sow(asp);
        gl.useProgram(fall.prog);
        gl.uniform2f(fall.U.uRes, canvas.width, canvas.height);
        gl.uniform1f(fall.U.uTime, time);
        gl.uniform1f(fall.U.uNight, night);
        gl.uniform1f(fall.U.uWind, wind.current);
        gl.uniform2f(fall.U.uWorld, fallWorld[0], fallWorld[1]);
        gl.bindVertexArray(fallVao);
        gl.drawArrays(gl.POINTS, 0, fallCount);
      }
      gl.depthMask(true);
    }

    /* La imagen de espera (ver WAIT), en la unidad de textura 4: la del tema que haya. veil:
       cuánto tapa todavía a la escena (1 hasta que llega; después se funde y se suelta). */
    const posterTex = gl.createTexture();
    let posterOk = false, posterDark = null, posterBusy = false, veil = 1, veilFrom = 0;
    /* El relevo. La imagen y la escena no pueden ser iguales brizna a brizna (otra calidad, otro
       instante del viento): fundir una sobre otra enseñaba dos hierbas distintas a la vez. Así
       que la imagen se desvanece por debajo (cover: cuánto tapa aún) y la hierba de verdad
       crece encima (grow, ver uGrow en GRASS_SIM). Mientras crece, esos fotogramas no
       cuentan para la calidad (queryOk): saldrían más ligeros de lo que son. */
    let cover = 0, grow = 1;
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
      gl.uniform3fv(p.U.uWarp, posterWarp(place));
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
       comparar unos con otros (vienen a ser milisegundos en una gráfica integrada). mp:
       millones de píxeles del lienzo; n: cuánta hierba (1, toda y de cuatro tramos; en
       invierno no hay). La escena pesa según los píxeles; la hierba, sobre todo según lo que
       ocupa en pantalla (briznas por píxeles), porque lo que cuesta es colorearla, no moverla.
       Ajustado con medidas en una Radeon integrada a 1366x768 y a 1920x1080, los seis
       escalones. */
    function weight(i){
      const q = LEVELS[Math.max(i, cap)], s = Math.min(1, q.side / Math.max(place.w, place.h));
      const mp = place.w * place.h * s * s / 1e6, n = SEASON === 3 ? 0 : q.part * (q.tall ? 1 : 0.6);
      return 0.6 + 8.6 * mp + (1.5 + 7.7 * mp) * n;
    }
    /* El reloj de la tarjeta gráfica (EXT_disjoint_timer_query_webgl2): lo que tarda en pintar
       un fotograma, sin parar la página. Una consulta cada vez: se abre al pintar (loop) y el
       resultado se recoge fotogramas después. Donde no lo hay (Firefox, Safari), o si no da
       números, se mide a tandas (probe). queryOk: ese fotograma vale como medida. */
    const clock = software ? null : gl.getExtension('EXT_disjoint_timer_query_webgl2');
    let clockOn = !!clock, query = null, queryOk = false, blanks = 0, took = 0;
    const ticks = [];
    function readClock(){
      if(!query || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
      const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      const clean = !gl.getParameter(clock.GPU_DISJOINT_EXT);
      gl.deleteQuery(query);
      query = null;
      if(!clean || !queryOk) return;
      if(ms > 0){ blanks = 0; tick(ms); }
      else if(++blanks > 20){ clockOn = false; probeAt = performance.now(); }
    }
    function tick(ms){
      if(pinned || frozen || swapping || performance.now() < settle) return;
      ticks.push(ms);
      /* La primera vez se decide pronto; después, con más calma. */
      if(ticks.length < (shown ? 14 : 6)) return;
      /* No la media: lo que tardan los fotogramas más bien lentos. */
      ticks.sort((a, b) => a - b);
      took = ticks[Math.floor(ticks.length * 0.7)];
      ticks.length = 0;
      decide(took);
    }
    /* Qué parte del fotograma puede llevarse la escena en cada modo, en milisegundos. */
    const room = (i) => BUDGET * frameMs * MODES[i].n;
    const fps = () => Math.round(1000 / (frameMs * step));
    const note = (ms) => { cost.push([level, fps(), Math.round(ms * 10) / 10]); if(cost.length > 40) cost.shift(); };
    /* La escena se enseña cuando ya no va a cambiar a la vista: con el árbol puesto y la calidad
       asentada (o pasado un tiempo prudente, por si algo no llega). Hasta entonces se pinta con
       el lienzo transparente, sobre la foto de espera. */
    const ready = (now) => (treeReady || treeFailed || now - liveAt > 5000) && (steady || pinned || isStill() || now - liveAt > 3000);
    /* Con lo que tarda un fotograma en el modo de ahora, a cuál ir. Lo que tardaría otro
       escalón es lo que tardó la última vez que se pintó en él (seen), si es reciente; si no,
       se estima por lo que pesa (weight), y al llegar se vuelve a medir.
       - Si no cabe (dos veces seguidas, o de largo), se baja al primero en el que quepa y a ese
         modo no se vuelve en un rato, cada vez más largo: así no va y viene.
       - Si cabe en uno mejor con margen, se sube: dos escalones como mucho de una vez, salvo que
         sobre muchísimo (la cuenta es una estimación, y pasarse ahoga a una tarjeta floja).
       - La estimación peca de prudente: si aquí sobra más de un cuarto del tiempo, se prueba
         el escalón siguiente aunque la cuenta diga que no.
       - Si no cabe ni en el último, la escena descansa (rest). */
    const seen = LEVELS.map(() => null);
    function decide(ms){
      const now = performance.now();
      seen[level] = {ms, at:now};
      const known = (i) => { const k = seen[Math.max(MODES[i].l, cap)]; return k && now - k.at < 180000 ? k.ms : 0; };
      const guess = (i) => ms * weight(MODES[i].l) / weight(level);
      /* Antes de enseñarla se exige margen y se baja a la primera: a la vista cuesta algo más
         (el navegador compone encima) y bajar entonces se notaría. */
      if(ms > (shown ? 1 : 0.82) * room(mode)){
        if(shown && ++strikes < 2 && ms < room(mode) * 1.5) return;
        barred[mode] = now + barWait;
        barWait = Math.min(barWait * 2, 300000);
        note(ms);
        let to = -1;
        for(let i = mode + 1; i < MODES.length && to < 0; i++) if((known(i) || guess(i)) <= 0.9 * room(i)) to = i;
        if(to < 0 && mode === MODES.length - 1){ steady = true; remember(mode); rest(); return; }
        to = to < 0 ? MODES.length - 1 : to;
        remember(to);
        if(shown && !isStill()) retreat(to);
        else setMode(to);
        return;
      }
      strikes = 0;
      let to = -1;
      for(let i = 0; i < mode && to < 0; i++){
        if(barred[i] > now) continue;
        const m = MODES[i], was = known(i);
        if(was){ if(was <= 0.85 * room(i)) to = i; continue; }
        if(guess(i) <= 0.8 * room(i) && (m.l >= level - 2 || guess(i) <= 0.5 * room(i))) to = i;
        else if(m.l === level - 1 && m.n === step && ms <= 0.72 * room(i)) to = i;
      }
      if(to < 0){ steady = true; ups = 0; remember(mode); return; }
      /* Con la escena ya a la vista no se sube: se notaría (cambia la resolución) y no hace
         falta para que vaya fluida. Tampoco se apunta para la próxima visita: lo que tardaría
         el modo de arriba es una estimación, y cuando fallaba la visita siguiente arrancaba
         demasiado alto y tenía que retirarse para bajar (medido). La calidad guardada caduca
         (MEMO_DAYS) y entonces se elige de nuevo. */
      if(shown) return;
      note(ms);
      setMode(to);
    }
    /* Con la escena ya a la vista, si hay que bajar de calidad (otra ventana, el equipo más
       cargado que cuando se asentó) no se cambia delante de nadie: la escena se retira un
       instante tras la foto desenfocada, cambia, vuelve a asentarse sin verse y se enseña otra
       vez (ready). */
    function retreat(to){
      swapping = true;
      shown = false;
      canvas.classList.add('is-swap');
      canvas.classList.remove('is-on');
      setTimeout(() => {
        swapping = false;
        canvas.classList.remove('is-swap');
        if(dead) return;
        steady = false;
        liveAt = performance.now();
        setMode(to);
        wake();
      }, 320);
    }
    /* Ni en lo más ligero: la escena se queda en una imagen un rato y vuelve a probar (antes se
       quedaba parada para siempre). Cada vez espera más. */
    function rest(){
      frozen = true;
      restTimer = setTimeout(() => {
        restTimer = 0;
        if(dead) return;
        frozen = false;
        setMode(MODE_START);
        wake();
      }, restWait);
      restWait = Math.min(restWait * 2, 240000);
    }
    /* La primera visita (sin calidad guardada), con reloj. Subir desde lo más ligero midiendo
       fotogramas al ritmo de la pantalla llevaba uno o dos segundos con la escena ya lista y
       sin enseñar, y era casi todo lo que tardaba en salir en un equipo modesto. Aquí se
       mide de una carrera: unos fotogramas seguidos en lo más ligero, que no ahoga a nadie, y
       con lo que tardan y lo que pesa cada modo (weight) se salta al mejor que quepa; allí se
       comprueba con otra carrera y, si no cabe, se baja al que diga esa medida, que ya es de
       cerca. Tres o cuatro tandas, unas décimas. Después sigue el reloj de siempre (decide). */
    function burst(n){
      return new Promise((resolve) => {
        /* Los fotogramas van con la hora que les tocaría en pantalla, para que hagan lo que
           harían de verdad (los turnos del cielo, el suelo y la luz de la hierba van por
           tiempo). El primero rehace lo que no cambia y no cuenta. */
        const gap = frameMs * step, from = performance.now();
        draw(from);
        const q = gl.createQuery();
        gl.beginQuery(clock.TIME_ELAPSED_EXT, q);
        for(let i = 1; i <= n; i++) draw(from + i * gap);
        gl.endQuery(clock.TIME_ELAPSED_EXT);
        gl.flush();
        const poll = () => {
          if(dead || gl.isContextLost()){ resolve(0); return; }
          if(!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)){
            if(performance.now() - from > 3000){ gl.deleteQuery(q); resolve(0); return; }
            setTimeout(poll, 4);
            return;
          }
          const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n, clean = !gl.getParameter(clock.GPU_DISJOINT_EXT);
          gl.deleteQuery(q);
          resolve(clean ? ms : 0);
        };
        setTimeout(poll, 4);
      });
    }
    async function sprint(){
      measuring = true;
      /* El mejor modo en el que cabría, por lo que tarda este y lo que pesa cada uno. */
      const fit = (ms) => {
        for(let i = 0; i < MODES.length; i++) if(ms * weight(MODES[i].l) / weight(level) <= 0.75 * room(i)) return i;
        return MODES.length - 1;
      };
      /* floor: de ahí para arriba ya se ha visto que no cabe. */
      let floor = 0, ok = false;
      for(let round = 0; round < 4; round++){
        const ms = await burst(4);
        if(!(ms > 0) || dead || pinned) break;
        took = ms;
        seen[level] = {ms, at:performance.now()};
        note(ms);
        const fits = ms <= 0.82 * room(mode);
        if(!fits) floor = mode + 1;
        const to = Math.min(MODES.length - 1, Math.max(fit(ms), floor));
        if(to === mode || (fits && to > mode)){ ok = fits; break; }
        setMode(to);
      }
      measuring = false;
      if(dead) return;
      /* Lo que la carrera ha adelantado en el reloj de la escena se olvida. */
      prev = 0; lightAt = 0; turnAt = 0;
      if(ok && !pinned){ steady = true; remember(mode); }
      settle = performance.now() + 120;
      wake();
    }
    /* Sin reloj: una tanda de fotogramas de prueba (pace) y a decidir con eso. Se repite poco
       después si ha cambiado algo (hay que medir el modo nuevo) y, si se bajó, cuando toque
       volver a intentar subir. probeAt: cuándo toca la siguiente. */
    let probeAt = Infinity;
    async function probe(){
      if(measuring || pinned || dead) return;
      measuring = true;
      /* El primer fotograma no cuenta: calcula lo que no cambia. */
      await gauge(1);
      const ms = took = Math.min(await pace(), await pace());
      measuring = false;
      if(dead) return;
      if(!pinned){
        const before = mode, now = performance.now();
        decide(ms);
        const retry = barred.reduce((t, until, i) => (i < mode && until > now ? Math.min(t, until) : t), Infinity);
        probeAt = mode !== before || strikes ? now + (shown ? 700 : 150) : retry;
      }
      wake();
    }

    /* La marca del último fotograma mandado a la tarjeta: mientras no lo haya terminado no se le
       manda otro (se amontonarían y el formulario iría a tirones). skipped: cuántas veces ha
       tocado pintar y seguía con él. La marca avisa tarde aunque el trabajo sea poco, así que
       de ella no se deduce la calidad, salvo donde no hay reloj y solo si se pasa de largo. */
    let mark = null, skipped = 0, counted = 0, slow = 0;
    function judge(){
      if(!mark) return;
      /* Medio segundo sin avisar: se da por terminado (hay controladores que no avisan). */
      if(gl.clientWaitSync(mark, 0, 0) === gl.TIMEOUT_EXPIRED && skipped < 30) return;
      gl.deleteSync(mark);
      mark = null;
    }
    function loop(now){
      raf = 0;
      if(dead || away(screen) || document.hidden || measuring) return;
      /* Lo que dura un fotograma de esta pantalla: lo habitual entre dos llamadas seguidas. Se
         mide ya mientras se compila, para saberlo cuando haya que elegir la calidad (sprint). */
      if(beatAt && now - beatAt > 3 && now - beatAt < 60){
        beats.push(now - beatAt);
        if(beats.length >= 30){
          beats.sort((a, b) => a - b);
          frameMs = Math.min(Math.max(beats[9], 4), 34);
          beats.length = 0;
        }
      }
      beatAt = now;
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
      if(!liveAt){
        liveAt = now; probeAt = now + 100;
        /* La primera vez en este equipo: la calidad se elige de una carrera, no subiendo. */
        if(clockOn && !memo && !pinned && !isStill()){ sprint(); return; }
      }
      if(clockOn) readClock();
      /* Con movimiento reducido (o ahorro de datos) es una sola imagen: en el mejor escalón, que
         no hay que moverla. */
      if(!pinned && !restTimer && mode !== MODE_STILL && isStill()) setMode(MODE_STILL);
      const every = frameMs * step;
      if(now - last >= every - 3){
        /* Solo donde no hay reloj: con él, la marca (que avisa un fotograma tarde) dejaría la
           escena a la mitad de fotogramas. */
        if(!clockOn){
          judge();
          if(mark){ skipped++; raf = requestAnimationFrame(loop); return; }
        }
        if(!clockOn && !pinned && !isStill()){
          if(now >= probeAt){ probeAt = Infinity; skipped = 0; probe(); return; }
          /* Fotogramas que la tarjeta no había acabado dos turnos después: si son más de un
             tercio de una tanda, se vuelve a medir. Mientras cambia el tema no se cuentan. */
          if(last && now > settle && night === toNight && day === toDay){
            counted++;
            if(skipped >= 2) slow++;
            if(counted >= 24){
              if(slow > 8) probeAt = now;
              counted = 0; slow = 0;
            }
          }
        }
        skipped = 0;
        last = now;
        /* Sin enseñar todavía, el lienzo ya se compone con la página (auth.css, canvas.is-trial):
           lo que se mide es lo que costará a la vista, con la tarjeta de acceso encima. */
        if(!shown && !swapping){
          if(ready(now)){ shown = true; canvas.classList.remove('is-trial'); canvas.classList.add('is-on'); }
          else canvas.classList.add('is-trial');
        }
        /* La escena ya está: la imagen de espera se va por debajo de la hierba, que crece, y
           se suelta. */
        if(veil > 0){
          if(!veilFrom) veilFrom = now;
          veil = posterOk && kit.hold() && !isStill() ? Math.max(0, 1 - (now - veilFrom) / 1500) : 0;
        }
        cover = veil * veil * (3 - 2 * veil);
        /* Sin imagen de espera en el lienzo (kit.waits) no hay relevo: la hierba, entera. */
        grow = kit.waits && veilFrom && !isStill() ? Math.min(1, (now - veilFrom) / 1100) : 1;
        const timing = clockOn && !query && !pinned && !isStill();
        if(timing){ query = gl.createQuery(); gl.beginQuery(clock.TIME_ELAPSED_EXT, query); }
        redone = false;
        draw(now);
        /* Vale de medida si no ha rehecho nada, la hierba ya está entera y el sol no se mueve. */
        if(timing){ gl.endQuery(clock.TIME_ELAPSED_EXT); queryOk = !redone && grow >= 1 && night === toNight && day === toDay; }
        cover = 0;
        if(veil <= 0 && veilFrom >= 0){ gl.deleteTexture(posterTex); veilFrom = -1; }
        if(!clockOn && !isStill()){
          mark = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
        }
      }
      if(!isStill()) raf = requestAnimationFrame(loop);
    }
    function wake(){
      if(dead || raf || measuring || away(screen) || document.hidden) return;
      resize();
      /* Tras una pausa (pestaña oculta, escena quieta) el primer fotograma no cuenta como pesado. */
      last = 0;
      beatAt = 0;
      raf = requestAnimationFrame(loop);
    }
    /* Para del todo y suelta lo que escuchaba (ver stop() y lost(), arriba). lose: además
       devuelve la memoria de la tarjeta gráfica. */
    function destroy(lose){
      dead = true;
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(restTimer);
      life.abort();
      watching.forEach((o) => o.disconnect());
      canvas.classList.remove('is-on', 'is-trial', 'is-swap');
      root.classList.remove('scene-lite');
      Object.assign(api, IDLE);
      if(lose){
        const ext = gl.getExtension('WEBGL_lose_context');
        if(ext) ext.loseContext();
      }
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
    /* Para las pruebas y para medir: el estado de la calidad (cost: los cambios de modo; ms: lo último medido),
       fijar la hora, fijar el escalón y cuánto tarda de verdad un fotograma (only: solo esas
       pasadas, ver passes). */
    function state(){
      return {level, side:LEVELS[level].side, blades:Math.round(BLADES * LEVELS[level].part), fps:fps(), hz:Math.round(1000 / frameMs), shown, frozen, software, cache, live, clock:clockOn, ms:took, cost, memo:!!memo, night, day, dawn, canvas:[canvas.width, canvas.height]};
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
    early.splice(0).forEach(signal);
    api.state = state;
    api.bench = bench;
    api.poster = poster;
    api.hour = (h) => { hourFixed = h == null ? null : +h; last = 0; wake(); };
    /* Fija el escalón y los fotogramas por segundo (los de la pantalla si no se dicen); sin
       escalón, lo suelta. */
    api.quality = (l, hz) => {
      pinned = l != null;
      if(!pinned) return;
      clearTimeout(restTimer);
      frozen = false;
      const n = hz ? Math.max(1, Math.round(1000 / frameMs / hz)) : 1;
      const i = MODES.findIndex((m) => m.l === (l | 0) && m.n === n);
      setMode(i < 0 ? (l | 0) : i);
      last = 0;
      wake();
    };

    /* El cursor: solo con ratón (en pantallas táctiles no hay cursor que seguir). */
    if(window.matchMedia('(hover: hover) and (pointer: fine)').matches){
      screen.addEventListener('pointermove', (ev) => {
        if(ev.pointerType && ev.pointerType !== 'mouse') return;
        mouse.tx = ev.clientX; mouse.ty = ev.clientY; mouse.moved = performance.now();
        if(!mouse.inside){ mouse.inside = true; mouse.x = mouse.tx; mouse.y = mouse.ty; }
      }, {passive:true, signal:life.signal});
      screen.addEventListener('pointerleave', () => { mouse.inside = false; }, heard);
    }

    window.addEventListener('resize', () => { resize(); wake(); }, heard);
    document.addEventListener('visibilitychange', wake, heard);
    onPlain(wake, heard);
    /* La pantalla de acceso aparece y desaparece con el atributo hidden; el tema, con data-theme. */
    watch(() => { relayout = true; resize(); wake(); }, screen, ['hidden']);
    watch(wake, root, ['data-theme', 'data-motion']);
    if(darkQuery.addEventListener) darkQuery.addEventListener('change', wake, heard);
    canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); kit.lost(level); }, heard);
    wake();
    return {destroy};
  }

  /* signal() no hace nada hasta que la escena arranca (o si no hay WebGL). */
  /* Hasta que la escena está lista, signal() apunta lo que pasa en el formulario (en un equipo
     modesto compilar lleva segundos, y si no, lo escrito o un acceso en curso no llegaban a la
     pantalla del ordenador); setup() lo repasa. */
  const early = [];
  /* Sin escena en marcha (aún no ha arrancado, se ha quitado o no hay WebGL). */
  const IDLE = {
    signal(o){ early.push(o); if(early.length > 60) early.shift(); },
    state(){ return null; }, bench(){ return 0; }, poster(){ return null; }, hour(){}, quality(){}
  };
  const api = Object.assign({
    start(canvas, screen, focusEl){ return host ? true : start(canvas, screen, focusEl); },
    /* Quitar el paisaje del todo, o volver a ponerlo. */
    enable
  }, IDLE);
  /* Este script lo pide auth-early.js (loadScene) cuando la pantalla de acceso se va a ver con
     paisaje, así que puede llegar antes o después de que exista Workhub: se publica en los dos
     sitios (AuthView lo recoge de WORKHUB_AUTH.scene si llegó antes). La escena se empieza a
     preparar ya, mientras se cargan los demás scripts: en un equipo modesto compilar los
     sombreadores lleva varios segundos en cada visita (el navegador no guarda lo compilado en
     segundo plano), y así corren a la vez que la descarga. */
  const EARLY = window.WORKHUB_AUTH;
  if(window.Workhub && Workhub.views) Workhub.views.authScene = api;
  if(!EARLY) return;
  EARLY.scene = api;
  /* start() espera por su cuenta a que la pantalla de acceso y la foto de espera se vean. */
  api.start(document.getElementById('authCanvas'), document.getElementById('authScreen'), document.getElementById('authWindow'));
})();
