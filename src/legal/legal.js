/* Páginas legales: tema, cabecera, pie y datos del titular.
   Las páginas son HTML estático (el texto se lee aunque falle esto); este script
   añade la cabecera y el pie, aplica el tema guardado y rellena los datos del
   titular desde src/config/legal-config.js. Va en un archivo aparte, no en línea,
   por la política de seguridad (CSP) del sitio. */
(function(){
  var L = window.WORKHUB_LEGAL || {};
  var root = document.documentElement;

  /* Tema: el que eligió el usuario en la app, o el del sistema. */
  try{
    var theme = localStorage.getItem('workhub_theme');
    if(theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  }catch(e){}

  /* Idioma: el de la página (<html lang>). Las inglesas cuelgan de /en/legal/. */
  var EN = /^en/i.test(root.getAttribute('lang') || '');
  var PAGES = [
    {href: '/legal/privacidad/', en: '/en/legal/privacy/', key: 'privacidad', label: 'Privacidad', labelEn: 'Privacy'},
    {href: '/legal/terminos/', en: '/en/legal/terms/', key: 'terminos', label: 'Términos y condiciones', labelEn: 'Terms and conditions'},
    {href: '/legal/cookies/', en: '/en/legal/cookies/', key: 'cookies', label: 'Cookies', labelEn: 'Cookies'}
  ];
  var LABELS = EN ? {
    titular: "owner's name or company name",
    nif: 'tax ID',
    domicilio: 'address',
    email: 'contact email'
  } : {
    titular: 'nombre o razón social del titular',
    nif: 'NIF o CIF',
    domicilio: 'domicilio',
    email: 'correo de contacto'
  };
  var TEXT = EN ? {
    home: '/en/', back: 'Back to the app', nav: 'Legal documents', settings: 'Cookie settings',
    version: 'Version ', updated: ' · Last updated: ', missing: '[to complete: '
  } : {
    home: '/', back: 'Volver a la app', nav: 'Documentos legales', settings: 'Configurar cookies',
    version: 'Versión ', updated: ' · Última actualización: ', missing: '[completar: '
  };
  function hrefOf(p){ return EN ? p.en : p.href; }
  function labelOf(p){ return EN ? p.labelEn : p.label; }

  function el(tag, attrs, children){
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function(k){
      if(k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function(c){ node.appendChild(c); });
    return node;
  }

  /* Rellena [data-legal="campo"] con el dato del titular; si falta, lo marca. */
  function fill(){
    var nodes = document.querySelectorAll('[data-legal]');
    Array.prototype.forEach.call(nodes, function(node){
      var key = node.getAttribute('data-legal');
      var value = String(L[key] == null ? '' : L[key]).trim();
      if(key === 'actualizado' && value){
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if(m){
          var months = EN
            ? ['January','February','March','April','May','June','July','August','September','October','November','December']
            : ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
          var month = months[parseInt(m[2], 10) - 1];
          value = EN ? parseInt(m[3], 10) + ' ' + month + ' ' + m[1] : parseInt(m[3], 10) + ' de ' + month + ' de ' + m[1];
        }
      }
      if(!value){
        node.textContent = TEXT.missing + (LABELS[key] || key) + ']';
        node.classList.add('legal-missing');
        return;
      }
      if(key === 'email'){
        node.textContent = '';
        node.appendChild(el('a', {href: 'mailto:' + value, text: value}));
        return;
      }
      node.textContent = value;
    });
  }

  function chrome(){
    var current = (document.body.getAttribute('data-page') || '');
    var top = document.getElementById('legalTop');
    var bottom = document.getElementById('legalBottom');
    if(top){
      var links = PAGES.map(function(p){
        var a = el('a', {href: hrefOf(p), text: labelOf(p)});
        if(p.key === current) a.setAttribute('aria-current', 'page');
        return a;
      });
      top.appendChild(el('div', {'class': 'legal-bar'}, [
        el('a', {'class': 'legal-brand', href: TEXT.home}, [
          el('img', {src: '/assets/img/favicon.svg', width: '28', height: '28', alt: ''}),
          el('span', {text: 'Kanlane'})
        ]),
        el('a', {'class': 'legal-back', href: '/app/', text: TEXT.back})
      ]));
      top.appendChild(el('nav', {'class': 'legal-nav', 'aria-label': TEXT.nav}, links));
    }
    if(bottom){
      var settings = el('button', {type: 'button', 'class': 'legal-link-btn', 'data-cookie-settings': '', text: TEXT.settings});
      bottom.appendChild(el('p', {}, [
        el('span', {text: TEXT.version + (L.version || 1) + TEXT.updated}),
        el('span', {'data-legal': 'actualizado'})
      ]));
      /* La misma página en el otro idioma. */
      var other = PAGES.filter(function(p){ return p.key === current; })[0];
      var lang = EN ? 'es' : 'en';
      var switchTo = other ? [el('a', {href: EN ? other.href : other.en, hreflang: lang, lang: lang, text: EN ? 'Español' : 'English'})] : [];
      bottom.appendChild(el('p', {'class': 'legal-footlinks'}, PAGES.map(function(p){
        return el('a', {href: hrefOf(p), text: labelOf(p)});
      }).concat([settings], switchTo)));
    }
  }

  function init(){
    chrome();
    fill();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
