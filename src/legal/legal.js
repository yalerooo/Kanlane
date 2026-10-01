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

  var PAGES = [
    {href: '/legal/privacidad/', key: 'privacidad', label: 'Privacidad'},
    {href: '/legal/terminos/', key: 'terminos', label: 'Términos y condiciones'},
    {href: '/legal/cookies/', key: 'cookies', label: 'Cookies'}
  ];
  var LABELS = {
    titular: 'nombre o razón social del titular',
    nif: 'NIF o CIF',
    domicilio: 'domicilio',
    email: 'correo de contacto'
  };

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
          var months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
          value = parseInt(m[3], 10) + ' de ' + months[parseInt(m[2], 10) - 1] + ' de ' + m[1];
        }
      }
      if(!value){
        node.textContent = '[completar: ' + (LABELS[key] || key) + ']';
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
        var a = el('a', {href: p.href, text: p.label});
        if(p.key === current) a.setAttribute('aria-current', 'page');
        return a;
      });
      top.appendChild(el('div', {'class': 'legal-bar'}, [
        el('a', {'class': 'legal-brand', href: '/'}, [
          el('img', {src: '/assets/img/favicon.svg', width: '28', height: '28', alt: ''}),
          el('span', {text: 'Workhub'})
        ]),
        el('a', {'class': 'legal-back', href: '/', text: 'Volver a la app'})
      ]));
      top.appendChild(el('nav', {'class': 'legal-nav', 'aria-label': 'Documentos legales'}, links));
    }
    if(bottom){
      var settings = el('button', {type: 'button', 'class': 'legal-link-btn', 'data-cookie-settings': '', text: 'Configurar cookies'});
      bottom.appendChild(el('p', {}, [
        el('span', {text: 'Versión ' + (L.version || 1) + ' · Última actualización: '}),
        el('span', {'data-legal': 'actualizado'})
      ]));
      bottom.appendChild(el('p', {'class': 'legal-footlinks'}, PAGES.map(function(p){
        return el('a', {href: p.href, text: p.label});
      }).concat([settings])));
    }
  }

  function init(){
    chrome();
    fill();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
