/* Traducciones. Kanlane está escrito en español; para otros idiomas, cada
   texto de la interfaz se traduce al pintarse:
   - Diccionario exacto: 'Nueva tarea' → 'New task'.
   - Patrones para textos con datos: /^Cliente «(.+)» añadido$/ → 'Client “$1” added'.
   Un observador traduce todo lo que aparece en la página (texto, placeholder,
   title, aria-label…), así las vistas no tienen que saber nada de idiomas.
   Nunca se traduce lo que está dentro de un elemento con translate="no"
   (datos del usuario: títulos de tareas, clientes, notas…), ni campos de
   texto, ni el contenido de los plugins (van en su propio marco).

   Idioma: localStorage 'workhub_lang' (y la cuenta del usuario, ver
   SettingsModel) o, si no hay, el del navegador. Cambiarlo recarga la app.

   La pantalla de acceso lo cambia en vivo (setLang(código, {live:true})): la página vuelve a
   traducirse o recupera el español que tenía, sin recargar. Como dentro de la app hay textos
   que se calcularon al cargar en el idioma anterior, queda apuntado en i18n.stale y la app se
   recarga una vez al entrar (AuthController.enter). */
(function(){
  const LANGS = {
    es: {name:'Español', locale:'es-ES'},
    en: {name:'English', locale:'en-US'}
  };
  const KEY = 'workhub_lang';
  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-short', 'data-placeholder-text', 'alt'];
  const SKIP = {SCRIPT:1, STYLE:1, TEXTAREA:1, INPUT:1, CODE:1, IFRAME:1, svg:1, SVG:1};
  /* De los campos se traducen los atributos (placeholder…), nunca su valor. */
  const FIELDS = {INPUT:1, TEXTAREA:1};

  function detect(){
    let saved = null;
    try{ saved = localStorage.getItem(KEY); }catch(e){}
    if(saved && LANGS[saved]) return saved;
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'es';
    return /^es\b/i.test(nav) ? 'es' : 'en';
  }

  let lang = detect();
  /* Lo que había en español en cada texto y atributo traducido, para poder volver a él. */
  const sourceText = new WeakMap();
  const sourceAttrs = new WeakMap();
  let stale = false;
  const dicts = {};
  const patterns = {};
  const missing = new Set();

  function add(code, exact, pats){
    dicts[code] = Object.assign(dicts[code] || {}, exact || {});
    patterns[code] = (patterns[code] || []).concat(pats || []);
  }

  /* Traduce un texto completo (sin espacios alrededor). null si no se conoce. */
  function lookup(text){
    if(lang === 'es' || !text) return null;
    const d = dicts[lang] || {};
    if(Object.prototype.hasOwnProperty.call(d, text)) return d[text];
    const pats = patterns[lang] || [];
    for(let i = 0; i < pats.length; i++){
      const m = text.match(pats[i][0]);
      if(m){
        const out = pats[i][1];
        return typeof out === 'function'
          ? out.apply(null, m)
          : out.replace(/\$(\d)/g, (_, n) => translateFragment(m[+n] || ''));
      }
    }
    return null;
  }

  /* Las partes capturadas por un patrón también se traducen si son textos
     conocidos (p. ej. el nombre de un estado dentro de una frase). */
  function translateFragment(s){
    const out = lookup(s);
    return out === null ? s : out;
  }

  /* Para usar desde el código: t('Guardar'), t('Hola {name}', {name}). */
  function t(text, params){
    let out = lookup(text);
    if(out === null) out = text;
    if(params) out = out.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : ''));
    return out;
  }

  /* ---------- Traducción de la página ---------- */

  function isUserContent(el){
    return !!(el && el.closest && el.closest('[translate="no"],[contenteditable="true"]'));
  }

  function translateText(node){
    const raw = node.nodeValue;
    if(!raw || !/[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡]/.test(raw)) return;
    const text = raw.trim();
    const out = lookup(text);
    if(out === null){
      if(text.length > 1) missing.add(text);
      return;
    }
    if(out === text) return;
    const lead = raw.slice(0, raw.indexOf(text));
    const trail = raw.slice(raw.indexOf(text) + text.length);
    const done = lead + out + trail;
    sourceText.set(node, {src:raw, out:done});
    node.nodeValue = done;
  }

  function translateAttrs(el){
    for(let i = 0; i < ATTRS.length; i++){
      const a = ATTRS[i];
      const v = el.getAttribute && el.getAttribute(a);
      if(!v || !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v)) continue;
      const out = lookup(v.trim());
      if(out === null){ missing.add(v.trim()); continue; }
      if(out !== v){
        const kept = sourceAttrs.get(el) || {};
        kept[a] = {src:v, out:out};
        sourceAttrs.set(el, kept);
        el.setAttribute(a, out);
      }
    }
  }

  function translateTree(root){
    if(lang === 'es' || !root) return;
    if(root.nodeType === 3){
      if(root.parentNode && !SKIP[root.parentNode.nodeName] && !isUserContent(root.parentNode)) translateText(root);
      return;
    }
    if(root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if(root.nodeType === 1){
      if(isUserContent(root)) return;
      if(SKIP[root.nodeName]){ if(FIELDS[root.nodeName]) translateAttrs(root); return; }
      translateAttrs(root);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        if(n.nodeType === 1){
          if(n.getAttribute('translate') === 'no' || n.isContentEditable) return NodeFilter.FILTER_REJECT;
          if(FIELDS[n.nodeName]){ translateAttrs(n); return NodeFilter.FILTER_REJECT; }
          if(SKIP[n.nodeName]) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n = walker.nextNode();
    while(n){
      if(n.nodeType === 3) translateText(n);
      else translateAttrs(n);
      n = walker.nextNode();
    }
  }

  let observer = null;
  function observe(){
    if(lang === 'es' || observer) return;
    translateTree(document.body);
    document.title = t(document.title);
    observer = new MutationObserver((records) => {
      for(let i = 0; i < records.length; i++){
        const r = records[i];
        if(r.type === 'childList'){
          r.addedNodes.forEach((n) => translateTree(n));
        } else if(r.type === 'characterData'){
          const p = r.target.parentNode;
          if(p && !SKIP[p.nodeName] && !isUserContent(p)) translateText(r.target);
        } else if(r.type === 'attributes'){
          if(!isUserContent(r.target)) translateAttrs(r.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:ATTRS
    });
    /* El título de la pestaña también cambia (nombre del proyecto…). */
    const titleEl = document.querySelector('title');
    if(titleEl) new MutationObserver(() => {
      const out = lookup(document.title);
      if(out !== null && out !== document.title) document.title = out;
    }).observe(titleEl, {childList:true, characterData:true, subtree:true});
  }

  /* Devuelve al español lo que este módulo tradujo y sigue como lo dejó. */
  function restoreTree(root){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for(let n = walker.currentNode; n; n = walker.nextNode()){
      if(n.nodeType === 3){
        const kept = sourceText.get(n);
        if(kept && n.nodeValue === kept.out) n.nodeValue = kept.src;
        sourceText.delete(n);
      } else {
        const kept = sourceAttrs.get(n);
        if(kept){
          Object.keys(kept).forEach((a) => { if(n.getAttribute(a) === kept[a].out) n.setAttribute(a, kept[a].src); });
          sourceAttrs.delete(n);
        }
      }
    }
  }

  /* options.live: sin recargar (ver la cabecera). */
  function setLang(code, options){
    if(!LANGS[code]) return;
    try{ localStorage.setItem(KEY, code); }catch(e){}
    if(code === lang) return;
    if(!(options && options.live)){ location.reload(); return; }
    /* Primero al español de origen y, desde ahí, al idioma nuevo. */
    restoreTree(document.body);
    lang = code;
    stale = true;
    document.documentElement.lang = lang;
    if(lang !== 'es'){
      if(observer){
        translateTree(document.body);
        document.title = t(document.title);
      } else observe();
    }
  }

  document.documentElement.lang = lang;

  Workhub.i18n = {
    LANGS, add, t, setLang, observe, translateTree,
    get lang(){ return lang; },
    get locale(){ return LANGS[lang].locale; },
    /* true si el idioma se cambió sin recargar: la app tiene que recargarse antes de usarse. */
    get stale(){ return stale; },
    /* Textos que no se encontraron (para completar el diccionario). */
    missing: () => {
      const done = new Set(Object.values(dicts[lang] || {}));
      return Array.from(missing).filter((m) => !done.has(m)).sort();
    }
  };
  Workhub.t = t;
})();
