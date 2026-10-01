/* Validación de enlaces y detección de la plataforma de videollamada. */
(function(){
  const PLATFORM_RULES = [
    {re:/(^|\.)meet\.google\.com$/, name:'Google Meet'},
    {re:/(^|\.)teams\.(microsoft|live)\.com$/, name:'Microsoft Teams'},
    {re:/(^|\.)zoom\.(us|com)$/, name:'Zoom'},
    {re:/(^|\.)webex\.com$/, name:'Webex'},
    {re:/(^|\.)whereby\.com$/, name:'Whereby'},
    {re:/(^|\.)meet\.jit\.si$/, name:'Jitsi'}
  ];

  function normalizeUrl(s){
    s = String(s || '').trim();
    if(!s) return '';
    if(!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = 'https://' + s;
    return s;
  }

  /* Devuelve la URL solo si es http(s); cualquier otra cosa se descarta. */
  function safeUrl(s){
    const n = normalizeUrl(s);
    if(!n) return '';
    try{
      const u = new URL(n);
      if(u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    }catch(e){}
    return '';
  }

  function platformOf(link){
    const url = safeUrl(link);
    if(!url) return '';
    let host = '';
    try{ host = new URL(url).hostname.toLowerCase(); }catch(e){}
    const rule = PLATFORM_RULES.find((r) => r.re.test(host));
    return rule ? rule.name : 'Videollamada';
  }

  /* Raíz del sitio: la aplicación está en /app/ (o, al abrirla como archivo, en app/),
   y lo que ella carga (sw.js, plugins/…) cuelga de la carpeta de arriba. */
function rootUrl(rel){
  const inApp = /\/app\/(index\.html)?$/.test(location.pathname);
  return new URL((inApp ? '../' : './') + (rel || ''), location.href).href;
}

Workhub.utils.urls = {rootUrl, normalizeUrl, safeUrl, platformOf};
})();
