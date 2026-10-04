/* Paisaje en 3D de la pantalla de acceso.
   Una escena dibujada en tiempo real con WebGL (un único sombreador que traza rayos, sin
   librerías ni imágenes): una colina con hierba, un árbol, cielo con nubes y, en lo alto,
   un ordenador antiguo con un tablero en la pantalla. Atardecer en tema claro y noche en
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
    'uniform vec2 uRes;uniform float uTime;uniform vec2 uFocus;uniform vec2 uMouse;uniform float uNight;',

    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
    'float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}',
    'mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}',

    /* Terreno: un montículo bajo el ordenador, lomas suaves y sierras a lo lejos. */
    'float terrain(vec2 p){',
    '  float h=1.7*exp(-dot(p,p)/26.);',
    '  h+=.55*sin(p.x*.21+1.3)*cos(p.y*.17+.4);',
    '  h+=.22*fbm(p*.45);',
    '  h+=smoothstep(10.,60.,p.y)*3.4*fbm(p*.045+3.1);',
    '  h-=smoothstep(2.,-9.,p.y)*.9;',
    '  h+=.05*noise(p*9.)+.025*noise(p*23.);',
    '  return h;}',
    'float fbm3(vec2 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}',
    'float terrainLow(vec2 p){',
    '  float h=1.7*exp(-dot(p,p)/26.);',
    '  h+=.55*sin(p.x*.21+1.3)*cos(p.y*.17+.4);',
    '  h+=.22*fbm3(p*.45);',
    '  h+=smoothstep(10.,60.,p.y)*3.4*fbm3(p*.045+3.1);',
    '  h-=smoothstep(2.,-9.,p.y)*.9;',
    '  return h;}',
    'vec3 terrainNormal(vec2 p,float t){float e=.02+.004*t;',
    '  return normalize(vec3(terrain(p-vec2(e,0.))-terrain(p+vec2(e,0.)),2.*e,terrain(p-vec2(0.,e))-terrain(p+vec2(0.,e))));}',

    'float sdBox(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}',
    'float sdBox2(vec2 p,vec2 b){vec2 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,q.y),0.);}',

    /* El ordenador: cuerpo redondeado con la pantalla hundida, una ranura y la peana. */
    'const float YAW=-.42;',
    'vec3 toLocal(vec3 p,float base){p.y-=base;p.xz=rot(YAW)*p.xz;return p;}',
    'float computer(vec3 q){',
    '  float body=sdBox(q-vec3(0.,1.02,0.),vec3(.86,.72,.66))-.09;',
    '  float hole=sdBox(q-vec3(0.,1.12,-.80),vec3(.66,.47,.10))-.03;',
    '  body=max(body,-hole);',
    '  float slot=sdBox(q-vec3(.02,.44,-.76),vec3(.13,.05,.04));',
    '  body=max(body,-slot);',
    '  float foot=sdBox(q-vec3(0.,.14,0.),vec3(.60,.14,.50))-.04;',
    '  return min(body,foot);}',

    /* El árbol: copa de esferas deformadas y tronco. */
    'float tree(vec3 p,vec3 c){',
    '  vec3 q=p-c;',
    '  float d=length(q*vec3(1.,.82,1.))-1.9;',
    '  d=min(d,length(q-vec3(1.25,-.7,.2))-1.25);',
    '  d=min(d,length(q-vec3(-1.1,-.9,-.2))-1.15);',
    '  d-=.38*fbm(q.xy*1.2+q.z*.9);',
    '  float trunk=max(length(q.xz-vec2(.05,0.))-.20,abs(q.y+2.2)-1.5);',
    '  return min(d,trunk);}',

    'float sph(vec3 ro,vec3 rd,vec3 c,float r){vec3 o=ro-c;float b=dot(o,rd),h=b*b-dot(o,o)+r*r;return h<0.?-1.:max(-b-sqrt(h),0.);}',

    /* El tablero de la pantalla: tres columnas con tarjetas, y una que pasa de una a otra. */
    'float rr(vec2 p,vec2 b,float r){return sdBox2(p,b-r)-r;}',
    'vec3 board(vec2 u){',
    '  vec3 col=vec3(.99,.955,.86);',
    '  float aa=.02;',
    '  col=mix(col,vec3(.93,.885,.78),smoothstep(.70,.72,u.y));',
    '  col=mix(col,vec3(.36,.33,.30),1.-smoothstep(0.,aa,rr(u-vec2(-.52,.84),vec2(.26,.045),.04)));',
    '  col=mix(col,vec3(.16,.16,.18),1.-smoothstep(0.,aa,rr(u-vec2(.70,.84),vec2(.14,.055),.05)));',
    '  for(int i=0;i<3;i++){',
    '    float fi=float(i);float cx=-.62+fi*.62;',
    '    col=mix(col,vec3(.955,.915,.81),1.-smoothstep(0.,aa,rr(u-vec2(cx,-.14),vec2(.28,.80),.06)));',
    '    vec3 dot3=i==0?vec3(.55,.56,.60):(i==1?vec3(.23,.51,.96):vec3(.13,.77,.37));',
    '    float ring=abs(length(u-vec2(cx-.20,.55))-.035)-.014;',
    '    col=mix(col,dot3,1.-smoothstep(0.,aa,i==2?length(u-vec2(cx-.20,.55))-.05:ring));',
    '    col=mix(col,vec3(.42,.40,.38),1.-smoothstep(0.,aa,rr(u-vec2(cx+.02,.55),vec2(.12,.025),.02)));',
    '    for(int j=0;j<3;j++){',
    '      if(i==1&&j==2)continue;',
    '      float fj=float(j);vec2 c=vec2(cx,.30-fj*.31);',
    '      float d=rr(u-c,vec2(.24,.125),.05);',
    '      col=mix(col,vec3(1.),1.-smoothstep(0.,aa,d));',
    '      vec3 tag=.5+.5*cos(6.283*(hash(vec2(fi,fj))+vec3(0.,.33,.67)));',
    '      col=mix(col,mix(tag,vec3(.5),.25),1.-smoothstep(0.,aa,rr(u-c-vec2(-.15,.055),vec2(.045,.03),.02)));',
    '      col=mix(col,vec3(.30,.30,.33),1.-smoothstep(0.,aa,rr(u-c-vec2(-.02,-.005),vec2(.17,.02),.02)));',
    '      col=mix(col,vec3(.72,.72,.74),1.-smoothstep(0.,aa,rr(u-c-vec2(-.07,-.065),vec2(.12,.016),.015)));',
    '    }',
    '  }',
    /* Una tarjeta viaja de la primera columna a la segunda y vuelve. */
    '  float ph=mod(uTime*.12,2.);float k=smoothstep(.15,.5,ph)-smoothstep(1.15,1.5,ph);',
    '  vec2 c=mix(vec2(-.62,-.63),vec2(0.,-.32),k)+vec2(0.,.10*sin(k*3.1416));',
    '  float d=rr(u-c,vec2(.24,.125),.05);',
    '  col=mix(col,vec3(.80,.77,.70),(1.-smoothstep(0.,.08,d))*.5*sin(k*3.1416));',
    '  col=mix(col,vec3(1.),1.-smoothstep(0.,aa,d));',
    '  col=mix(col,vec3(.96,.55,.20),1.-smoothstep(0.,aa,rr(u-c-vec2(-.15,.055),vec2(.045,.03),.02)));',
    '  col=mix(col,vec3(.30,.30,.33),1.-smoothstep(0.,aa,rr(u-c-vec2(-.02,-.005),vec2(.17,.02),.02)));',
    '  col=mix(col,vec3(.72,.72,.74),1.-smoothstep(0.,aa,rr(u-c-vec2(-.07,-.065),vec2(.12,.016),.015)));',
    '  return col;}',

    /* Cielo: degradado, sol o luna con su halo, nubes y estrellas. */
    'vec3 sky(vec3 rd,vec3 L){',
    '  float y=max(rd.y,0.);',
    '  vec3 day=mix(vec3(.98,.50,.26),vec3(.84,.27,.24),smoothstep(0.,.22,y));',
    '  day=mix(day,vec3(.42,.30,.40),smoothstep(.18,.55,y));',
    '  day=mix(day,vec3(.20,.30,.42),smoothstep(.45,.95,y));',
    '  vec3 night=mix(vec3(.20,.17,.36),vec3(.07,.08,.22),smoothstep(0.,.3,y));',
    '  night=mix(night,vec3(.015,.02,.07),smoothstep(.25,.9,y));',
    '  vec3 col=mix(day,night,uNight);',
    '  float s=max(dot(rd,L),0.);',
    '  vec3 glow=mix(vec3(1.,.62,.28),vec3(.55,.60,.95),uNight);',
    '  col+=glow*(pow(s,6.)*.35+pow(s,40.)*.5)*mix(1.,.45,uNight);',
    '  col+=mix(vec3(1.,.93,.75),vec3(.97,.96,.90),uNight)*smoothstep(.9990,.9994,s)*mix(1.,1.3,uNight);',
    '  vec2 cp=rd.xz/(rd.y+.16)*1.3+vec2(uTime*.012,0.);',
    '  float cl=smoothstep(.42,.78,fbm(cp))*smoothstep(0.,.12,rd.y);',
    '  float lit=fbm(cp+L.xz*.5);',
    '  vec3 ccol=mix(mix(vec3(.30,.16,.24),vec3(1.,.60,.42),lit),mix(vec3(.05,.06,.14),vec3(.24,.26,.46),lit),uNight);',
    '  col=mix(col,ccol,cl*.85);',
    '  vec2 sp=rd.xy/(1.+abs(rd.z))*420.;vec2 si=floor(sp);',
    '  float st=step(.988,hash(si))*smoothstep(.42,.05,length(fract(sp)-.5));',
    '  st*=.6+.4*sin(uTime*1.7+hash(si+7.)*40.);',
    '  col+=vec3(.9,.92,1.)*st*uNight*(1.-cl)*smoothstep(.02,.25,rd.y);',
    '  return col;}',

    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy-uFocus)/uRes.y;',
    '  float base=terrain(vec2(0.));',
    '  vec3 ta=vec3(0.,base+1.02,0.);',
    '  vec3 ro=vec3(2.1+uMouse.x*.9,base+.55+uMouse.y*.3+.03*sin(uTime*.25),-11.5);',
    '  vec3 fw=normalize(ta-ro),rt=normalize(cross(vec3(0.,1.,0.),fw)),up=cross(fw,rt);',
    '  vec3 rd=normalize(fw*1.5+uv.x*rt+uv.y*up);',
    '  vec3 L=normalize(mix(vec3(.62,.16,.77),vec3(.50,.40,.77),uNight));',
    '  vec3 sunCol=mix(vec3(1.10,.64,.40),vec3(.30,.36,.62),uNight);',
    '  vec3 ambient=mix(vec3(.30,.24,.28),vec3(.045,.055,.12),uNight);',
    '  vec3 skyLight=mix(vec3(.20,.27,.40),vec3(.05,.07,.16),uNight);',
    '  vec3 treeC=vec3(-6.4,terrain(vec2(-6.4,3.0))+3.5,3.0);',

    /* Terreno. */
    '  float t=.4,tHit=-1.;',
    /* Los rayos que miran al cielo no tocan el suelo: se ahorran el recorrido. */
    '  if(rd.y<.2){',
    '    for(int i=0;i<110;i++){',
    '      vec3 p=ro+rd*t;float d=p.y-terrainLow(p.xz)-.04;',
    '      if(d<.0025*t){tHit=t;break;}',
    '      t+=max(.02,d*.42);',
    '      if(t>170.)break;}',
    '  }',
    /* Por debajo del horizonte siempre hay suelo: si el rayo no llegó, es la llanura del fondo. */
    '  if(tHit<0.&&rd.y<.012)tHit=170.;',

    /* Ordenador y árbol (solo si el rayo pasa cerca). */
    '  float tObj=-1.;float kind=0.;',
    '  float t0=sph(ro,rd,ta,1.75);',
    '  if(t0>=0.){float tt=t0;for(int i=0;i<56;i++){vec3 p=ro+rd*tt;float d=computer(toLocal(p,base));if(d<.002){tObj=tt;kind=1.;break;}tt+=d;if(tt>t0+4.5)break;}}',
    '  float t1=sph(ro,rd,treeC-vec3(0.,.9,0.),3.6);',
    '  if(t1>=0.){float tt=t1;for(int i=0;i<70;i++){vec3 p=ro+rd*tt;float d=tree(p,treeC);if(d<.006){if(tObj<0.||tt<tObj){tObj=tt;kind=2.;}break;}tt+=d*.5;if(tt>t1+8.)break;}}',

    '  vec3 col=sky(rd,L);',
    '  vec3 fogCol=mix(vec3(.56,.25,.22),vec3(.09,.09,.22),uNight);',
    '  vec3 screenGlow=mix(vec3(1.,.90,.68),vec3(1.,.92,.74),uNight);',
    /* La pantalla, vista desde el mundo: dónde está y hacia dónde mira. */
    '  vec3 sn=vec3(0.,0.,-1.);sn.xz=rot(-YAW)*sn.xz;',
    '  vec3 sc=vec3(0.,1.12,-.72);sc.xz=rot(-YAW)*sc.xz;sc.y+=base;',

    '  float tFin=tHit;',
    '  if(tObj>0.&&(tHit<0.||tObj<tHit)){',
    '    tFin=tObj;vec3 p=ro+rd*tObj;',
    '    if(kind>1.5){',
    '      vec2 e=vec2(.03,0.);',
    '      vec3 n=normalize(vec3(tree(p+e.xyy,treeC)-tree(p-e.xyy,treeC),tree(p+e.yxy,treeC)-tree(p-e.yxy,treeC),tree(p+e.yyx,treeC)-tree(p-e.yyx,treeC)));',
    '      float dif=max(dot(n,L),0.);float rim=pow(1.-max(dot(n,-rd),0.),2.5);',
    '      vec3 leaf=mix(vec3(.05,.07,.04),vec3(.10,.13,.06),noise(p.xy*6.+p.z*5.));',
    '      col=leaf*(ambient*1.2+sunCol*dif*.8)+sunCol*rim*.10*max(dot(rd,L),0.);',
    '    }else{',
    '      vec3 q=toLocal(p,base);',
    '      vec2 e=vec2(.004,0.);',
    '      vec3 nl=normalize(vec3(computer(q+e.xyy)-computer(q-e.xyy),computer(q+e.yxy)-computer(q-e.yxy),computer(q+e.yyx)-computer(q-e.yyx)));',
    '      vec3 n=nl;n.xz=rot(-YAW)*n.xz;',
    '      vec2 su=(q.xy-vec2(0.,1.12))/vec2(.63,.44);',
    '      bool onScreen=q.z<-.60&&abs(su.x)<1.&&abs(su.y)<1.&&nl.z<-.5;',
    '      if(onScreen){',
    '        vec3 b=board(su);',
    '        b*=.94+.06*sin(su.y*150.);',
    '        b*=1.-.22*dot(su*.8,su*.8);',
    '        col=b*mix(1.,1.12,uNight)+vec3(.06,.03,.0)*(1.-uNight);',
    '      }else{',
    '        float dif=max(dot(n,L),0.);float rim=pow(1.-max(dot(n,-rd),0.),3.);',
    '        vec3 alb=q.y<.30?vec3(.24,.32,.44):vec3(.38,.54,.74);',
    '        alb*=.92+.16*noise(q.xy*26.+q.z*17.);',
    '        float vent=step(.5,abs(nl.x))*step(abs(q.z-.05),.34)*step(abs(q.y-1.36),.20)*step(.5,fract(q.y*14.));',
    '        alb*=1.-.45*vent;',
    '        float skyL=.5+.5*n.y;',
    '        col=alb*(ambient*.8+skyLight*skyL*1.6+sunCol*dif*1.1)+sunCol*rim*.18;',
    '        float inner=smoothstep(-.60,-.76,q.z)*step(abs(q.x),.70)*step(abs(q.y-1.12),.51);',
    '        col+=screenGlow*inner*.30;',
    '        float led=1.-smoothstep(.018,.030,length(q.xy-vec2(.60,.44)));',
    '        col=mix(col,vec3(.35,1.,.55)*(.8+.2*sin(uTime*2.)),led*step(q.z,-.55));',
    '        col*=mix(1.,.55,smoothstep(.30,.0,q.y)*.6);',
    '      }',
    '    }',
    '  }else if(tHit>0.){',
    '    vec3 p=ro+rd*tHit;vec3 n=terrainNormal(p.xz,tHit);',
    '    float wind=.5+.5*sin(p.x*1.3+p.z*.7+uTime*.9);',
    '    float blades=noise(vec2(p.x*46.+wind*1.5,p.z*7.))*.6+noise(p.xz*9.)*.4;',
    '    float patch=fbm(p.xz*.55);',
    '    vec3 grass=mix(vec3(.06,.10,.04),vec3(.19,.27,.09),patch);',
    '    grass=mix(grass,vec3(.46,.42,.16),smoothstep(.60,.95,blades)*.45);',
    '    grass=mix(grass,vec3(.26,.15,.10),smoothstep(.66,.9,fbm(p.xz*.23+8.))*.25*(1.-uNight));',
    '    vec2 fc=floor(p.xz*7.);float fl=step(.972,hash(fc))*smoothstep(.34,.12,length(fract(p.xz*7.)-.5))*smoothstep(26.,6.,tHit);',
    '    vec3 flc=hash(fc+3.)>.5?vec3(1.,.86,.42):vec3(1.,.62,.66);',
    '    grass=mix(grass,flc,fl*mix(.9,.35,uNight));',
    '    float dif=max(dot(n,L),0.);',
    '    float back=pow(max(dot(rd,L),0.),3.)*(.35+.65*blades);',
    '    col=grass*(ambient*.9+skyLight*1.3+sunCol*dif*1.3)+sunCol*back*vec3(.40,.34,.12)*.35;',
    /* Sombra del ordenador y del árbol, y la luz de la pantalla sobre la hierba. */
    '    vec2 sd=p.xz-vec2(0.)+L.xz*1.1;',
    '    col*=1.-.50*smoothstep(1.9,.5,length(sd*vec2(1.,1.25)))*(1.-uNight*.5);',
    '    vec2 td=p.xz-treeC.xz+L.xz*2.4;',
    '    col*=1.-.40*smoothstep(3.6,1.2,length(td));',
    '    vec3 tl=sc-p;float dl=length(tl);',
    '    float spill=max(dot(normalize(tl),n),0.)*max(dot(-normalize(tl),sn),0.)/(1.+dl*dl*.55);',
    '    col+=grass*screenGlow*spill*mix(1.3,7.,uNight);',
    '  }',
    '  if(tFin>0.){',
    '    float fog=1.-exp(-tFin*mix(.013,.024,uNight));',
    '    col=mix(col,mix(fogCol,sky(normalize(vec3(rd.x,.03,rd.z)),L),.28),fog);',
    '  }',
    /* Halo de la pantalla en el aire. */
    '  vec3 oc=ro-sc;float bq=dot(oc,rd);float dq=length(oc+rd*max(-bq,0.));',
    '  col+=screenGlow*.07*exp(-dq*dq*1.6)*mix(.6,1.5,uNight)*step(0.,-bq);',
    /* Luciérnagas, de noche. */
    '  vec2 ns=gl_FragCoord.xy/uRes.y;',
    '  for(int i=0;i<12;i++){float fi=float(i);',
    '    vec2 fp=vec2(hash(vec2(fi,1.3))*uRes.x/uRes.y,.08+hash(vec2(fi,7.7))*.42);',
    '    fp+=.035*vec2(sin(uTime*.31+fi*2.1),cos(uTime*.23+fi*1.3));',
    '    float bl=.5+.5*sin(uTime*(.7+hash(vec2(fi,3.))*.9)+fi*5.);',
    '    col+=vec3(1.,.85,.42)*(.000035/(dot(ns-fp,ns-fp)+.00003))*bl*bl*uNight;}',
    /* Viñeta y grano. */
    '  vec2 vq=gl_FragCoord.xy/uRes-.5;',
    '  col*=1.-.30*dot(vq,vq)*1.6;',
    '  col+=(hash(gl_FragCoord.xy+fract(uTime)*91.7)-.5)*.028;',
    '  gl_FragColor=vec4(clamp(col,0.,1.),1.);',
    '}'
  ].join('\n');

  /* Lado mayor del lienzo, en píxeles: por encima de esto se estira (la escena es suave y lo admite). */
  const MAX_SIDE = 1100;
  const FRAME_MS = 1000 / 30;

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
    ['uRes', 'uTime', 'uFocus', 'uMouse', 'uNight'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
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
