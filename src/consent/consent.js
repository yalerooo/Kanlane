/* Aviso de cookies y gestión del consentimiento.

   Sin dependencias: lo cargan igual la aplicación (index.html) y las páginas legales.
   Cumple el art. 22.2 de la LSSI-CE y la guía de la AEPD:
   - Las categorías no esenciales empiezan DESACTIVADAS (nada premarcado).
   - «Aceptar» y «Rechazar» tienen el mismo aspecto y están a la misma altura.
   - El aviso no tapa la página ni obliga a elegir para usarla (no hay «muro de cookies»).
   - Se puede cambiar o retirar el consentimiento en cualquier momento, tan fácil como darlo
     (botones con [data-cookie-settings], Ajustes → Privacidad y pie de las páginas legales).
   - Se guarda cuándo se decidió y se vuelve a preguntar a los 12 meses o si cambian las
     categorías (VERSION).

   HOY Workhub solo usa almacenamiento técnico imprescindible, que no necesita consentimiento
   (ver legal/cookies/). La categoría «analytics» existe para el día que se añada algo que sí
   lo necesite: cualquier script de analítica o de terceros debe cargarse SOLO si
   WorkhubConsent.has('analytics') es verdadero, y volver a comprobarlo con onChange().

   API: WorkhubConsent.get() · .has('analytics') · .accept() · .reject() · .set({analytics})
        .open() (abre la configuración) · .onChange(fn) */
(function(){
  'use strict';
  if(window.WorkhubConsent) return;

  var KEY = 'workhub_consent';
  /* Súbela cuando cambien las categorías o lo que se hace con ellas: volverá a preguntar. */
  var VERSION = 2;
  var MAX_AGE = 365 * 24 * 60 * 60 * 1000;   /* 12 meses */

  var TEXT = {
    es: {
      region: 'Aviso de cookies',
      title: 'Tu privacidad',
      body: 'Workhub solo usa almacenamiento técnico imprescindible: mantener tu sesión y recordar tu idioma y tu tema. No usamos cookies de analítica ni de publicidad. Si algún día añadiéramos alguna, no se activaría sin tu permiso.',
      cookies: 'Política de cookies',
      privacy: 'Privacidad',
      reject: 'Rechazar',
      accept: 'Aceptar',
      configure: 'Configurar',
      dialogTitle: 'Configuración de cookies',
      dialogIntro: 'Elige qué tipos de cookies permites. Puedes cambiarlo cuando quieras desde Ajustes → Privacidad o desde el pie de las páginas legales.',
      necessaryTitle: 'Técnicas y de personalización',
      necessaryBadge: 'Siempre activas',
      necessaryText: 'Imprescindibles para iniciar sesión, usar la aplicación y recordar lo que tú eliges (idioma, tema, proyecto abierto). No se pueden desactivar.',
      analyticsTitle: 'Analítica y medición',
      analyticsText: 'Servirían para entender cómo se usa Workhub. Hoy no se usa ninguna; si algún día se añade, solo se activará si lo permites aquí.',
      save: 'Guardar mi elección',
      acceptAll: 'Aceptar todas',
      rejectAll: 'Rechazar todas',
      close: 'Cerrar'
    },
    en: {
      region: 'Cookie notice',
      title: 'Your privacy',
      body: 'Workhub only uses essential technical storage: keeping you signed in and remembering your language and theme. We do not use analytics or advertising cookies. If we ever added any, they would not run without your permission.',
      cookies: 'Cookie policy',
      privacy: 'Privacy',
      reject: 'Reject',
      accept: 'Accept',
      configure: 'Customize',
      dialogTitle: 'Cookie settings',
      dialogIntro: 'Choose which types of cookies you allow. You can change this at any time from Settings → Privacy or from the footer of the legal pages.',
      necessaryTitle: 'Technical and personalization',
      necessaryBadge: 'Always on',
      necessaryText: 'Essential to sign in, use the app and remember what you choose (language, theme, open project). They cannot be turned off.',
      analyticsTitle: 'Analytics and measurement',
      analyticsText: 'They would help understand how Workhub is used. None is used today; if one is ever added, it will only run if you allow it here.',
      save: 'Save my choice',
      acceptAll: 'Accept all',
      rejectAll: 'Reject all',
      close: 'Close'
    }
  };

  function lang(){
    var l = '';
    try{ l = localStorage.getItem('workhub_lang') || ''; }catch(e){}
    if(!l) l = navigator.language || 'es';
    return /^en/i.test(l) ? 'en' : 'es';
  }
  function t(key){ return TEXT[lang()][key]; }

  /* ---------- Estado ---------- */

  var memory = null;          /* por si el navegador no deja guardar */
  var listeners = [];

  function read(){
    var raw = null;
    try{ raw = JSON.parse(localStorage.getItem(KEY) || 'null'); }catch(e){}
    var c = raw || memory;
    if(!c || c.v !== VERSION || !c.at || Date.now() - c.at > MAX_AGE) return null;
    return c;
  }

  function save(analytics){
    var c = {v: VERSION, at: Date.now(), analytics: !!analytics};
    memory = c;
    try{ localStorage.setItem(KEY, JSON.stringify(c)); }catch(e){}
    listeners.forEach(function(fn){ try{ fn(c); }catch(e){} });
    return c;
  }

  /* ---------- Interfaz ---------- */

  function h(tag, attrs, kids){
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function(k){
      if(k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function(kid){ node.appendChild(kid); });
    return node;
  }

  var banner = null;
  var dialog = null;

  function hideBanner(){
    if(banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function showBanner(){
    if(banner || read()) return;
    var actions = h('div', {'class': 'consent-actions'}, [
      h('button', {type: 'button', 'class': 'consent-btn', 'data-act': 'reject', text: t('reject')}),
      h('button', {type: 'button', 'class': 'consent-btn', 'data-act': 'accept', text: t('accept')}),
      h('button', {type: 'button', 'class': 'consent-btn is-text', 'data-act': 'configure', text: t('configure')})
    ]);
    banner = h('div', {'class': 'consent', role: 'region', 'aria-label': t('region'), translate: 'no'}, [
      h('div', {'class': 'consent-card'}, [
        h('p', {'class': 'consent-title', text: t('title')}),
        h('p', {'class': 'consent-text', text: t('body')}),
        h('p', {'class': 'consent-links'}, [
          h('a', {href: '/legal/cookies/', text: t('cookies')}),
          h('span', {'aria-hidden': 'true', text: ' · '}),
          h('a', {href: '/legal/privacidad/', text: t('privacy')})
        ]),
        actions
      ])
    ]);
    banner.addEventListener('click', function(ev){
      var btn = ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if(!btn) return;
      var act = btn.getAttribute('data-act');
      if(act === 'accept'){ save(true); hideBanner(); }
      else if(act === 'reject'){ save(false); hideBanner(); }
      else if(act === 'configure') openDialog();
    });
    document.body.appendChild(banner);
  }

  function closeDialog(){
    if(!dialog) return;
    if(dialog.open) dialog.close();
    if(dialog.parentNode) dialog.parentNode.removeChild(dialog);
    dialog = null;
  }

  function openDialog(){
    if(dialog) return;
    var current = read();
    var analytics = h('input', {type: 'checkbox', role: 'switch', id: 'consentAnalytics', 'aria-describedby': 'consentAnalyticsText'});
    analytics.checked = !!(current && current.analytics);   /* sin consentimiento previo, desactivada */

    var choose = function(value){ save(value); hideBanner(); closeDialog(); };
    dialog = h('dialog', {'class': 'consent-dialog', 'aria-labelledby': 'consentDialogTitle', translate: 'no'}, [
      h('div', {'class': 'consent-dialog-inner'}, [
        h('h2', {id: 'consentDialogTitle', text: t('dialogTitle')}),
        h('p', {'class': 'consent-text', text: t('dialogIntro')}),
        h('div', {'class': 'consent-cat'}, [
          h('div', {'class': 'consent-cat-head'}, [
            h('strong', {text: t('necessaryTitle')}),
            h('span', {'class': 'consent-badge', text: t('necessaryBadge')})
          ]),
          h('p', {'class': 'consent-text', text: t('necessaryText')})
        ]),
        h('div', {'class': 'consent-cat'}, [
          h('label', {'class': 'consent-cat-head', 'for': 'consentAnalytics'}, [
            h('strong', {text: t('analyticsTitle')}),
            h('span', {'class': 'consent-switch'}, [analytics, h('span', {'class': 'consent-slider', 'aria-hidden': 'true'})])
          ]),
          h('p', {'class': 'consent-text', id: 'consentAnalyticsText', text: t('analyticsText')})
        ]),
        h('p', {'class': 'consent-links'}, [
          h('a', {href: '/legal/cookies/', text: t('cookies')}),
          h('span', {'aria-hidden': 'true', text: ' · '}),
          h('a', {href: '/legal/privacidad/', text: t('privacy')})
        ]),
        h('div', {'class': 'consent-actions is-dialog'}, [
          h('button', {type: 'button', 'class': 'consent-btn', 'data-act': 'rejectAll', text: t('rejectAll')}),
          h('button', {type: 'button', 'class': 'consent-btn', 'data-act': 'acceptAll', text: t('acceptAll')}),
          h('button', {type: 'button', 'class': 'consent-btn is-primary', 'data-act': 'save', text: t('save')})
        ]),
        h('button', {type: 'button', 'class': 'consent-x', 'data-act': 'close', 'aria-label': t('close'), text: '×'})
      ])
    ]);
    dialog.addEventListener('click', function(ev){
      var btn = ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if(btn){
        var act = btn.getAttribute('data-act');
        if(act === 'rejectAll') choose(false);
        else if(act === 'acceptAll') choose(true);
        else if(act === 'save') choose(analytics.checked);
        else if(act === 'close') closeDialog();
      } else if(ev.target === dialog) closeDialog();   /* clic en el fondo */
    });
    dialog.addEventListener('cancel', function(){ closeDialog(); });
    document.body.appendChild(dialog);
    if(dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }

  /* Cualquier botón con [data-cookie-settings] abre la configuración. */
  document.addEventListener('click', function(ev){
    var btn = ev.target.closest ? ev.target.closest('[data-cookie-settings]') : null;
    if(!btn) return;
    ev.preventDefault();
    openDialog();
  });

  window.WorkhubConsent = {
    get: read,
    has: function(category){
      var c = read();
      if(category === 'necessary') return true;
      return !!(c && c[category]);
    },
    accept: function(){ var c = save(true); hideBanner(); return c; },
    reject: function(){ var c = save(false); hideBanner(); return c; },
    set: function(choices){ var c = save(choices && choices.analytics); hideBanner(); return c; },
    open: openDialog,
    onChange: function(fn){ listeners.push(fn); },
    /* Solo para pruebas. */
    _reset: function(){ memory = null; try{ localStorage.removeItem(KEY); }catch(e){} }
  };

  function start(){ showBanner(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
