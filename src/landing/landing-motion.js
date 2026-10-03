/* Portada: movimiento al bajar. Sin dependencias.
   Solo actúa si landing-boot.js ha puesto html.js-motion (hay IntersectionObserver y la persona no
   ha pedido menos movimiento). Si no, la página se queda como está, con todo visible.
   - Titulares partidos en líneas que suben desde una máscara.
   - Apariciones en cadena con direcciones distintas según la pieza.
   - Efectos ligados al scroll: línea de avance, demo que se endereza, frase que se ilumina,
     paralaje de las maquetas y pasos que se rellenan.
   - Cursor: punto de luz en las tarjetas e inclinación de la tarjeta de la portada. */
(function(){
  'use strict';
  var root = document.documentElement;
  var top = document.getElementById('top');

  /* La línea de avance va siempre (no es una animación de entrada). */
  var bar = null;
  if(top){
    bar = document.createElement('span');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    top.appendChild(bar);
  }
  function paintBar(){
    if(!bar) return;
    var max = root.scrollHeight - window.innerHeight;
    bar.style.setProperty('--scroll', max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : '0');
  }

  var motion = root.classList.contains('js-motion');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function all(sel, base){ return Array.prototype.slice.call((base || document).querySelectorAll(sel)); }

  /* Punto de luz que sigue al cursor (solo con ratón). */
  if(window.matchMedia('(hover: hover)').matches){
    all('.grid3:not(.plain) .feat, .anywhere-grid article').forEach(function(card){
      card.addEventListener('pointermove', function(ev){
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
        card.style.setProperty('--my', (ev.clientY - r.top) + 'px');
      });
    });
  }

  if(!motion || !('IntersectionObserver' in window)){
    window.addEventListener('scroll', paintBar, {passive:true});
    window.addEventListener('resize', paintBar, {passive:true});
    paintBar();
    /* Sin animaciones los pasos se muestran ya rellenos. */
    all('.steps li').forEach(function(li){ li.style.setProperty('--fill', '1'); });
    return;
  }

  /* ---------- titulares en líneas ---------- */
  function split(heading){
    if(heading.classList.contains('is-split')) return;
    var groups = [[]];
    Array.prototype.slice.call(heading.childNodes).forEach(function(node){
      if(node.nodeName === 'BR'){ groups.push([]); return; }
      groups[groups.length - 1].push(node);
    });
    var frag = document.createDocumentFragment();
    groups.forEach(function(nodes, index){
      if(index) frag.appendChild(document.createElement('br'));
      var mask = document.createElement('span'), inner = document.createElement('span');
      mask.className = 'ln';
      inner.style.setProperty('--l', String(index));
      nodes.forEach(function(node){ inner.appendChild(node); });
      mask.appendChild(inner);
      frag.appendChild(mask);
    });
    heading.textContent = '';
    heading.appendChild(frag);
    heading.classList.add('is-split');
  }
  var headings = all('.hero h1, .section-head h2, .flow-copy h2, .demo-intro h2, .closing h2, .split-text h3');
  headings.forEach(split);

  /* ---------- piezas con entrada propia ---------- */
  function mark(sel, kind, opts){
    all(sel).forEach(function(el, index){
      if(el.classList.contains('m')) return;
      el.classList.add('m', 'm-' + kind);
      if(opts && opts.stagger) el.style.setProperty('--i', String(opts.cycle ? index % opts.cycle : index));
      if(opts && opts.delay) el.style.setProperty('--d', opts.delay + 'ms');
    });
  }
  function stagger(groupSel, childSel, kind){
    all(groupSel).forEach(function(group){
      all(childSel, group).forEach(function(el, index){
        el.style.setProperty('--i', String(index));
        if(kind){ el.classList.add('m', 'm-' + kind); }
      });
    });
  }
  /* Portada: orden de las filas de la jornada. */
  all('.hero .day-metrics > div, .hero .day-task, .hero .day-meeting').forEach(function(el, index){ el.style.setProperty('--i', String(index)); });
  /* Bloques a dos columnas: el texto y la maqueta llegan de lados opuestos. */
  all('.split').forEach(function(splitEl){
    var reverse = splitEl.classList.contains('is-reverse');
    var text = splitEl.querySelector('.split-text'), mock = splitEl.querySelector('.mock');
    if(text) text.classList.add('m', reverse ? 'm-right' : 'm-left');
    if(mock){ mock.classList.add('m', reverse ? 'm-left' : 'm-right'); mock.style.setProperty('--d', '120ms'); }
  });
  stagger('.calendar-preview', '.ev');
  stagger('.vault', '.vrow');
  stagger('.ticks', 'li', 'up');
  stagger('.context-grid', 'article', 'up');
  stagger('.context-benefits', 'p', 'up');
  stagger('.comparison-copy', 'p', 'up');
  stagger('.faq', 'details', 'up');
  stagger('.facts', 'li', 'up');
  stagger('.demo-footnotes', 'span', 'up');
  stagger('.flow-controls', '.flow-choice', 'left');
  stagger('.client-options', '.client-option', 'left');
  stagger('.plugin-menu', '.plugin-option', 'left');
  stagger('.team-people', '.day-avatar', 'pop');
  stagger('.foot-cols', 'div', 'up');
  mark('.more-title, .plugin-footer, .demo-caption, .foot-brand', 'up');
  mark('.statement-text', 'fade');

  /* ---------- observadores ---------- */
  var seen = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      seen.unobserve(entry.target);
    });
  }, {threshold:.12, rootMargin:'0px 0px -6% 0px'});
  all('.m, .section-head, .flow-copy, .demo-intro, .closing, .closing .wrap, .mock, .split-text').forEach(function(el){ seen.observe(el); });
  /* Los titulares fuera de un bloque observado se observan ellos mismos. */
  headings.forEach(function(h){ if(!h.closest('.section-head, .flow-copy, .demo-intro, .closing .wrap, .hero')) seen.observe(h); });

  /* La portada entra al cargar. */
  var hero = document.querySelector('.hero');
  if(hero){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ hero.classList.add('is-in'); }); });
    setTimeout(function(){ hero.classList.add('is-settled'); }, 1700);
  }

  /* Pasos: cada uno se rellena al verse. */
  var stepsObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      var items = all('li', entry.target);
      items.forEach(function(li, index){ setTimeout(function(){ li.style.setProperty('--fill', '1'); }, 250 + index * 320); });
      stepsObserver.unobserve(entry.target);
    });
  }, {threshold:.4});
  all('.steps').forEach(function(el){ stepsObserver.observe(el); });

  /* Datos: los números cuentan hasta su valor. */
  var counted = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      var el = entry.target, target = Number(el.getAttribute('data-count')), start = null;
      counted.unobserve(el);
      function tick(now){
        if(start === null) start = now;
        var t = Math.min(1, (now - start) / 1100), eased = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(target * eased));
        if(t < 1) requestAnimationFrame(tick);
      }
      el.textContent = '0';
      requestAnimationFrame(tick);
    });
  }, {threshold:.6});
  all('[data-count]').forEach(function(el){ counted.observe(el); });

  /* ---------- frase que se ilumina ---------- */
  var statement = document.querySelector('.statement-text');
  var words = [];
  if(statement){
    var text = statement.textContent.trim().split(/\s+/);
    statement.textContent = '';
    text.forEach(function(word, index){
      var span = document.createElement('span');
      span.className = 'w';
      span.textContent = word;
      statement.appendChild(span);
      if(index < text.length - 1) statement.appendChild(document.createTextNode(' '));
      words.push(span);
    });
  }

  /* ---------- efectos ligados al scroll ---------- */
  var demo = document.querySelector('.demo');
  var parallax = all('.day-preview, .client-detail, .flow-stage, .split .mock, .team-preview, .plugin-window');
  parallax.forEach(function(el){ el.setAttribute('data-parallax', ''); });
  var queued = false;
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function paint(){
    queued = false;
    var vh = window.innerHeight, wide = window.innerWidth > 700;
    paintBar();
    if(demo){
      var r = demo.getBoundingClientRect();
      /* 0 cuando asoma por abajo, 1 cuando su borde superior llega al 30 % de la ventana. */
      var p = wide ? clamp((vh - r.top) / (vh * .7), 0, 1) : 1;
      var eased = 1 - Math.pow(1 - p, 2);
      demo.style.setProperty('--demo-rx', ((1 - eased) * 13).toFixed(2) + 'deg');
      demo.style.setProperty('--demo-s', (.9 + eased * .1).toFixed(4));
    }
    if(words.length){
      var sr = statement.getBoundingClientRect();
      var sp = clamp((vh * .82 - sr.top) / (sr.height + vh * .34), 0, 1);
      var lit = Math.round(sp * words.length);
      words.forEach(function(span, index){ span.classList.toggle('is-lit', index < lit); });
    }
    if(wide){
      parallax.forEach(function(el){
        var pr = el.getBoundingClientRect();
        if(pr.bottom < -200 || pr.top > vh + 200) return;
        var center = (pr.top + pr.height / 2 - vh / 2) / vh;
        el.style.setProperty('--py', (clamp(center, -1, 1) * -22).toFixed(1) + 'px');
      });
    }
  }
  function onScroll(){ if(!queued){ queued = true; requestAnimationFrame(paint); } }
  window.addEventListener('scroll', onScroll, {passive:true});
  window.addEventListener('resize', onScroll, {passive:true});
  paint();

  /* ---------- la tarjeta de la portada se inclina hacia el cursor ---------- */
  var card = document.querySelector('.hero-layout > .day-preview');
  if(card && window.matchMedia('(hover: hover)').matches){
    var area = document.querySelector('.hero-layout');
    area.addEventListener('pointermove', function(ev){
      if(window.innerWidth <= 900) return;
      var r = card.getBoundingClientRect();
      var x = clamp((ev.clientX - (r.left + r.width / 2)) / r.width, -1, 1);
      var y = clamp((ev.clientY - (r.top + r.height / 2)) / r.height, -1, 1);
      card.style.setProperty('--tilt-y', (x * 3.2).toFixed(2) + 'deg');
      card.style.setProperty('--tilt-x', (y * -3.2).toFixed(2) + 'deg');
    });
    area.addEventListener('pointerleave', function(){
      card.style.setProperty('--tilt-y', '0deg');
      card.style.setProperty('--tilt-x', '0deg');
    });
  }

  /* Si la persona pide menos movimiento con la página abierta, todo queda visible y quieto. */
  if(reduce.addEventListener) reduce.addEventListener('change', function(){
    if(!reduce.matches) return;
    root.classList.remove('js-motion');
    all('.steps li').forEach(function(li){ li.style.setProperty('--fill', '1'); });
  });
})();
