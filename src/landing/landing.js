/* Portada: movimiento progresivo e interacciones sin dependencias ni persistencia. */
(function(){
  var top = document.getElementById('top');
  /* La demo pesa bastante más que la portada: se pide cuando ya se ha pintado todo. */
  var frame = document.getElementById('demoFrame');
  if(frame){
    var start = function(){ if(!frame.getAttribute('src')) frame.setAttribute('src', frame.getAttribute('data-src')); };
    if(document.readyState === 'complete') start(); else window.addEventListener('load', start);
  }
  var year = document.getElementById('year');
  if(year) year.textContent = String(new Date().getFullYear());
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var demo = document.querySelector('.demo');
  var queued = false;
  function paintScroll(){
    queued = false;
    if(top) top.classList.toggle('is-scrolled', window.scrollY > 8);
    if(demo){
      var rect = demo.parentElement.getBoundingClientRect();
      var offset = motion.matches || window.innerWidth < 701 ? 0 : Math.max(0, Math.min(22, (rect.top - 100) * .035));
      demo.style.setProperty('--demo-y', offset + 'px');
    }
  }
  function onScroll(){ if(!queued){ queued = true; requestAnimationFrame(paintScroll); } }
  window.addEventListener('scroll', onScroll, {passive:true});
  window.addEventListener('resize', onScroll, {passive:true});
  paintScroll();

  if('IntersectionObserver' in window){
    var reveal = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){ entry.target.classList.remove('is-waiting'); reveal.unobserve(entry.target); }
      });
    }, {threshold:.08});
    document.querySelectorAll('.grid3,.more,.steps').forEach(function(group){
      Array.from(group.children).forEach(function(child, index){ child.style.setProperty('--reveal-delay', (index % 3) * 85 + 'ms'); });
    });
    document.querySelectorAll('.section-head,.feat,.split,.more li,.steps li,.faq,.flow-copy,.flow-stage,.closing .wrap,.demo-intro,.client-options,.client-detail,.context-benefits,.team-preview,.plugin-menu,.plugin-window,.anywhere-grid article').forEach(function(el){
      el.classList.add('reveal');
      if(!motion.matches && el.getBoundingClientRect().top > window.innerHeight) el.classList.add('is-waiting');
      reveal.observe(el);
    });
    var navigation = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting) return;
        document.querySelectorAll('.top-nav a').forEach(function(a){
          var current = a.hash === '#' + entry.target.id;
          a.classList.toggle('is-current', current);
          if(current) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
        });
      });
    }, {rootMargin:'-15% 0px -65% 0px'});
    document.querySelectorAll('section[id]').forEach(function(el){ navigation.observe(el); });
  }

  var stage = document.querySelector('.flow-stage');
  var messages = ['La idea ya tiene su sitio.', 'Cada paso te acerca a la entrega.', 'Menos pendientes. Más tranquilidad.'];
  var statuses = ['Pendiente', 'En curso', 'Completada'];
  document.querySelectorAll('[data-flow]').forEach(function(button){
    button.addEventListener('click', function(){
      var index = Number(button.dataset.flow);
      stage.dataset.stage = String(index);
      document.querySelectorAll('[data-flow]').forEach(function(other){
        var active = other === button;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', String(active));
      });
      document.getElementById('flowMessage').textContent = messages[index];
      stage.querySelector('.flow-status').textContent = statuses[index];
    });
  });
  var calendar = document.getElementById('calendarPreview');
  if(calendar){
    var weekHtml = calendar.innerHTML;
    document.querySelectorAll('[data-calendar]').forEach(function(button){
      button.addEventListener('click', function(){
        var mode = button.dataset.calendar;
        calendar.className = 'week calendar-' + mode;
        calendar.innerHTML = weekHtml;
        if(mode === 'month'){
          var events = {};
          calendar.querySelectorAll('.wd').forEach(function(day){ events[day.querySelector('b').textContent] = Array.from(day.querySelectorAll('.ev')).map(function(ev){ return ev.outerHTML; }).join(''); });
          var html = '';
          for(var blank = 0; blank < 3; blank++) html += '<div class="wd empty" aria-hidden="true"></div>';
          for(var day = 1; day <= 31; day++) html += '<div class="wd' + (day === 7 ? ' today' : '') + '"><b>' + day + '</b>' + (events[day] || '') + '</div>';
          calendar.innerHTML = html;
        }
        document.querySelectorAll('[data-calendar]').forEach(function(other){
          other.classList.toggle('on', other === button);
          other.setAttribute('aria-pressed', String(other === button));
        });
        document.querySelector('.calendar-caption').textContent = mode === 'day' ? 'Miércoles 7. Espacio para concentrarte.' : mode === 'month' ? 'Octubre. La perspectiva completa.' : 'Una semana. Todos tus clientes.';
      });
    });
  }
  if(motion.addEventListener) motion.addEventListener('change', function(){
    if(motion.matches) document.querySelectorAll('.is-waiting').forEach(function(el){ el.classList.remove('is-waiting'); });
    paintScroll();
  });
})();
