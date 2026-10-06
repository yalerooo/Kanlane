/* Portada pública: interacciones de los ejemplos y movimiento al avanzar por la página.
   Sin dependencias, sin red (salvo la demo, que se pide al acercarse) y sin guardar nada.
   Textos en español o inglés según <html lang>.

   El movimiento solo existe con html.js-motion (lo decide landing-boot.js antes de pintar:
   hay IntersectionObserver y la persona no ha pedido menos movimiento). Sin esa clase todo
   el contenido está a la vista y los ejemplos siguen respondiendo a los clics. */
(function(){
  'use strict';
  var root = document.documentElement;
  var en = root.lang === 'en';
  var motion = root.classList.contains('js-motion');
  var byId = function(id){ return document.getElementById(id); };
  var all = function(sel, from){ return Array.prototype.slice.call((from || document).querySelectorAll(sel)); };
  var clamp = function(v, a, b){ return Math.max(a, Math.min(b, v)); };

  /* ---------- Con sesión iniciada (se llega con «?portada»): nada de «Iniciar sesión» ni «Crear cuenta» ----------
     Los enlaces de registro pasan a abrir la aplicación y los de acceso sobran. Un invitado no
     tiene cuenta, así que a él se le siguen ofreciendo. */
  var session = false;
  try{ session = localStorage.getItem('workhub_session') === '1'; }catch(e){}
  if(session) all('a[href]').forEach(function(a){
    var m = /^((?:\.\.\/|\/)?app\/)(\?registro\b.*)?$/.exec(a.getAttribute('href'));
    if(!m) return;
    if(!m[2]){ a.parentNode.removeChild(a); return; }
    a.setAttribute('href', m[1]);
    a.firstChild.nodeValue = (en ? 'Open the app' : 'Abrir la aplicación') + (a.children.length ? ' ' : '');
  });

  var year = byId('year');
  if(year) year.textContent = String(new Date().getFullYear());

  /* ---------- Demo: pesa bastante más que la portada, se pide al acercarse ---------- */
  var frame = byId('demoFrame');
  if(frame){
    var load = function(){ if(!frame.getAttribute('src')) frame.setAttribute('src', frame.getAttribute('data-src')); };
    if('IntersectionObserver' in window){
      var near = new IntersectionObserver(function(entries){
        if(entries.some(function(e){ return e.isIntersecting; })){ load(); near.disconnect(); }
      }, {rootMargin:'400px 0px'});
      near.observe(frame);
    } else if(document.readyState === 'complete') load();
    else window.addEventListener('load', load, {once:true});
  }

  /* ---------- Ejemplos interactivos ---------- */
  function select(buttons, chosen){
    buttons.forEach(function(b){
      b.classList.toggle('is-active', b === chosen);
      b.setAttribute('aria-pressed', String(b === chosen));
    });
  }
  /* Pequeño fundido al cambiar el contenido de un ejemplo. */
  function swap(el){
    if(!motion || !el) return;
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  }

  /* Un día: marcar tareas. */
  var dayTasks = all('[data-day-task]');
  var dayText = en
    ? ['Try completing a task.', 'One less pending. Keep your pace.', 'Almost done for the day.', 'All done. Now breathe.']
    : ['Prueba a completar una tarea.', 'Un pendiente menos. Sigue a tu ritmo.', 'Ya queda menos para cerrar el día.', 'Todo listo. Ahora sí, respira.'];
  function updateDay(){
    var done = dayTasks.filter(function(t){ return t.checked; }).length;
    byId('dayPending').textContent = String(dayTasks.length - done);
    byId('dayCount').textContent = done + ' / ' + dayTasks.length;
    byId('dayProgress').style.width = done / dayTasks.length * 100 + '%';
    byId('dayFeedback').textContent = dayText[done];
  }
  if(dayTasks.length){
    dayTasks.forEach(function(t){ t.addEventListener('change', updateDay); });
    updateDay();
  }

  /* Clientes de ejemplo. */
  var clients = en ? {
    north:{c:'norte', initial:'N', name:'North Studio', task:'Mock up the new homepage', status:'In progress', person:'Marta Ruiz', role:'Communications manager', meeting:'Design review', date:'Wednesday · 16:30', access:'Website panel'},
    coast:{c:'costa', initial:'C', name:'Coast Workshop', task:'Prepare the quote', status:'Pending', person:'Lucas Costa', role:'Shop manager', meeting:'Maintenance plan', date:'Thursday · 10:00', access:'Admin email'},
    house:{c:'aldea', initial:'A', name:'Aldea House', task:'Review the website copy', status:'In review', person:'Irene Vega', role:'Content coordinator', meeting:'Photo delivery', date:'Friday · 12:00', access:'Content manager'}
  } : {
    north:{c:'norte', initial:'N', name:'Estudio Norte', task:'Maquetar la nueva portada', status:'En proceso', person:'Marta Ruiz', role:'Responsable de comunicación', meeting:'Revisión del diseño', date:'Miércoles · 16:30', access:'Panel de la web'},
    coast:{c:'costa', initial:'C', name:'Taller Costa', task:'Preparar el presupuesto', status:'Pendiente', person:'Lucas Costa', role:'Responsable de la tienda', meeting:'Plan de mantenimiento', date:'Jueves · 10:00', access:'Correo de administración'},
    house:{c:'aldea', initial:'A', name:'Casa Aldea', task:'Revisar los textos de la web', status:'En revisión', person:'Irene Vega', role:'Coordinadora de contenidos', meeting:'Entrega de fotografías', date:'Viernes · 12:00', access:'Gestor de contenidos'}
  };
  var clientButtons = all('[data-client]');
  var fields = {clientName:'name', clientTask:'task', clientStatus:'status', clientPerson:'person', clientPersonRole:'role', clientMeeting:'meeting', clientDate:'date', clientAccess:'access'};
  clientButtons.forEach(function(button){
    button.addEventListener('click', function(){
      var client = clients[button.getAttribute('data-client')];
      select(clientButtons, button);
      byId('clientInitial').className = 'mono ' + client.c;
      byId('clientInitial').textContent = client.initial;
      Object.keys(fields).forEach(function(id){ byId(id).textContent = client[fields[id]]; });
      swap(byId('clientDetail').querySelector('.ctx'));
    });
  });

  /* Roles de equipo. */
  var roles = en ? {
    owner:{title:'The project, in your hands.', text:'Manage the work, invite people and decide who can edit or view.', rights:[true, true, true]},
    editor:{title:'All set to collaborate.', text:'Create tasks, update the work and join the comments. Members and permissions are managed by the owner.', rights:[true, true, false]},
    viewer:{title:'Up to date, without changing the work.', text:'View tasks, comments and project progress. This role cannot edit or manage members.', rights:[true, false, false]}
  } : {
    owner:{title:'El proyecto, en tus manos.', text:'Gestiona el trabajo, invita a otras personas y decide quién puede editar o consultar.', rights:[true, true, true]},
    editor:{title:'Todo listo para colaborar.', text:'Crea tareas, actualiza el trabajo y participa en los comentarios. Los miembros y sus permisos los gestiona el propietario.', rights:[true, true, false]},
    viewer:{title:'Al día, sin cambiar el trabajo.', text:'Consulta tareas, comentarios y avances del proyecto. Este rol no permite editar ni gestionar miembros.', rights:[true, false, false]}
  };
  var roleButtons = all('[data-role]');
  roleButtons.forEach(function(button){
    button.addEventListener('click', function(){
      var role = roles[button.getAttribute('data-role')];
      var box = byId('roleDescription');
      select(roleButtons, button);
      box.querySelector('strong').textContent = role.title;
      box.querySelector('p').textContent = role.text;
      all('span', byId('roleRights')).forEach(function(span, i){
        span.textContent = role.rights[i] ? (en ? 'Yes' : 'Sí') : 'No';
        span.classList.toggle('is-denied', !role.rights[i]);
      });
      swap(box);
    });
  });

  /* Plugins y color de acento del ejemplo. */
  var pluginButtons = all('[data-plugin]');
  pluginButtons.forEach(function(button){
    var panel = byId('plugin-' + button.getAttribute('data-plugin'));
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', function(){
      select(pluginButtons, button);
      all('.plugin-panel').forEach(function(other){ other.hidden = other !== panel; });
      swap(panel);
    });
  });
  var accents = {blue:'#2563EB', purple:'#4F46E5', green:'#0D8F6F'};
  var swatches = all('[data-accent]');
  swatches.forEach(function(button){
    button.addEventListener('click', function(){
      select(swatches, button);
      byId('appearanceExample').style.setProperty('--preview-accent', accents[button.getAttribute('data-accent')]);
    });
  });

  /* Calendario de ejemplo: mes, semana o día. */
  var calendar = byId('calendarPreview');
  if(calendar){
    var weekHtml = calendar.innerHTML;
    var captions = en
      ? {month:'October. The full picture.', week:'One week. All your clients.', day:'Wednesday 7. Space to focus.'}
      : {month:'Octubre. La perspectiva completa.', week:'Una semana. Todos tus clientes.', day:'Miércoles 7. Espacio para concentrarte.'};
    var calButtons = all('[data-calendar]');
    calButtons.forEach(function(button){
      button.addEventListener('click', function(){
        var mode = button.getAttribute('data-calendar');
        calendar.className = 'mweek' + (mode === 'week' ? '' : ' is-' + mode);
        calendar.innerHTML = weekHtml;
        if(mode === 'month'){
          /* Octubre de 2026 empieza en jueves: tres huecos antes del día 1 y uno después del 31. */
          var events = {};
          all('.mday', calendar).forEach(function(day){
            events[day.querySelector('b').textContent] = all('em', day).map(function(ev){ return ev.outerHTML; }).join('');
          });
          var html = '';
          for(var blank = 0; blank < 3; blank++) html += '<div class="mday empty" aria-hidden="true"></div>';
          for(var d = 1; d <= 31; d++) html += '<div class="mday' + (d === 7 ? ' now' : '') + ((d + 2) % 7 > 4 ? ' we' : '') + '"><b>' + d + '</b>' + (events[d] || '') + '</div>';
          html += '<div class="mday empty" aria-hidden="true"></div>';
          calendar.innerHTML = html;
        }
        calButtons.forEach(function(other){
          other.classList.toggle('on', other === button);
          other.setAttribute('aria-pressed', String(other === button));
        });
        byId('calendarCaption').textContent = captions[mode];
        swap(calendar);
      });
    });
  }

  /* ---------- Sección actual en la navegación ---------- */
  if('IntersectionObserver' in window){
    var links = all('.nav-links a');
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting) return;
        links.forEach(function(a){
          var on = a.hash === '#' + entry.target.id;
          a.classList.toggle('is-current', on);
          if(on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
        });
      });
    }, {rootMargin:'-20% 0px -70% 0px'});
    all('section[id]').forEach(function(s){ spy.observe(s); });
  }

  /* ==========================================================================
     Movimiento al avanzar por la página
     ========================================================================== */
  if(!motion) return;

  /* Entradas: cada pieza marcada con data-r aparece al llegar a ella. */
  var reveal = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      reveal.unobserve(entry.target);
    });
  }, {threshold:.12, rootMargin:'0px 0px -6% 0px'});
  all('[data-r]').forEach(function(el){ reveal.observe(el); });

  /* El velo del fondo toma el tono de la sección que se está viendo. */
  var HUES = {grafito:['#71717A', '#71717A'], azul:['#3B82F6', '#6366F1'], violeta:['#6366F1', '#D946EF'], verde:['#14B8A6', '#22C55E'], ambar:['#F59E0B', '#F97316'], rosa:['#EC4899', '#F97316']};
  var hueNow = '';
  var hueSpy = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var name = entry.target.getAttribute('data-hue');
      if(!entry.isIntersecting || name === hueNow || !HUES[name]) return;
      hueNow = name;
      root.style.setProperty('--hue-a', HUES[name][0]);
      root.style.setProperty('--hue-b', HUES[name][1]);
    });
  }, {rootMargin:'-45% 0px -45% 0px'});
  all('[data-hue]').forEach(function(s){ hueSpy.observe(s); });

  /* Cifras que cuentan hasta su valor. */
  var counter = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      counter.unobserve(entry.target);
      var el = entry.target, to = +el.getAttribute('data-count'), t0 = null;
      var tick = function(t){
        if(t0 === null) t0 = t;
        var p = clamp((t - t0) / 900, 0, 1);
        el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if(p < 1) requestAnimationFrame(tick);
      };
      el.textContent = '0';
      requestAnimationFrame(tick);
    });
  }, {threshold:.6});
  all('.facts [data-count]').forEach(function(el){ counter.observe(el); });

  /* La frase de presentación, palabra a palabra. */
  var phrase = document.querySelector('[data-words]');
  var words = [];
  if(phrase){
    var text = phrase.textContent;
    phrase.setAttribute('aria-label', text);
    phrase.innerHTML = text.split(' ').map(function(w){ return '<span class="w" aria-hidden="true">' + w.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>'; }).join(' ');
    words = all('.w', phrase);
  }

  /* La tarjeta de la portada avanza de columna (técnica FLIP: se mueve en el DOM y se anima
     desde donde estaba). */
  var win = byId('heroWin');
  var mover = win && win.querySelector('.mc-move');
  var slots = win ? all('[data-slot]', win) : [];
  var counts = win ? all('[data-count]', win).map(function(el){ return {el:el, base:+el.textContent - (el.getAttribute('data-count') === '0' ? 1 : 0)}; }) : [];
  var doneLabel = en ? 'Done' : 'Hecha';
  var movePill = mover && mover.querySelector('.mpill');
  var pillHtml = movePill ? movePill.innerHTML : '';
  function setPhase(phase){
    if(!mover || +win.getAttribute('data-phase') === phase) return;
    /* Se anotan las posiciones de todas las tarjetas: al cambiar de columna, las demás también
       se recolocan y deben deslizarse, no saltar ni pisarse. */
    var cards = all('.mc', win);
    var before = cards.map(function(c){ return c.getBoundingClientRect(); });
    slots[phase].appendChild(mover);
    win.setAttribute('data-phase', String(phase));
    counts.forEach(function(c, i){ c.el.textContent = String(c.base + (i === phase ? 1 : 0)); });
    mover.classList.toggle('is-done', phase === 2);
    movePill.className = 'mpill' + (phase === 2 ? ' ok' : ' late');
    movePill.innerHTML = phase === 2 ? '<svg class="ico" width="11" height="11" aria-hidden="true"><use href="#i-check"/></svg>' + doneLabel : pillHtml;
    cards.forEach(function(c, i){
      var to = c.getBoundingClientRect();
      var dx = before[i].left - to.left, dy = before[i].top - to.top;
      if(!dx && !dy) return;
      c.style.transition = 'none';
      c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    });
    void win.offsetWidth;
    cards.forEach(function(c){ c.style.transition = ''; c.style.transform = ''; });
  }

  /* Recorrido fijo por las funciones: solo en pantallas anchas y con alto suficiente. */
  var tour = byId('tour');
  var chapters = tour ? all('.chapter', tour) : [];
  var stepButtons = tour ? all('[data-goto]', tour) : [];
  var pinned = false;
  function fitTour(){
    if(!tour) return;
    var should = window.innerWidth >= 1001 && window.innerHeight >= 640;
    if(should === pinned) return;
    pinned = should;
    tour.classList.toggle('is-pinned', pinned);
    tour.style.setProperty('--tour-len', (chapters.length - 1) * 80 + 'vh');
    if(!pinned) chapters.forEach(function(c){ c.classList.remove('on'); });
    else setStep(+tour.getAttribute('data-step') || 0, true);
  }
  function setStep(i, force){
    if(!force && +tour.getAttribute('data-step') === i) return;
    tour.setAttribute('data-step', String(i));
    chapters.forEach(function(c, k){ c.classList.toggle('on', k === i); });
    stepButtons.forEach(function(b, k){ b.classList.toggle('on', k === i); });
  }
  stepButtons.forEach(function(b){
    b.addEventListener('click', function(){
      if(!pinned) return;
      var i = +b.getAttribute('data-goto');
      var span = tour.offsetHeight - window.innerHeight;
      window.scrollTo({top:tour.getBoundingClientRect().top + window.scrollY + span * (i + .5) / chapters.length, behavior:'smooth'});
    });
  });
  /* Sin fijar (tableta y móvil), cada capítulo se anima al entrar en pantalla. */
  var chapterSpy = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){ if(entry.isIntersecting) entry.target.classList.add('is-in'); });
  }, {threshold:.35});
  chapters.forEach(function(c){ chapterSpy.observe(c); });

  var steps = byId('steps');
  var queued = false;
  function paint(){
    queued = false;
    var vh = window.innerHeight;
    /* Portada: la tarea pasa a «En proceso» y a «Completada» según sube la ventana. */
    if(win){
      var r = win.getBoundingClientRect();
      var p = clamp((vh * .78 - r.top) / (vh * .62), 0, 1);
      var phase = p < .34 ? 0 : p < .72 ? 1 : 2;
      /* En móvil no se ve la primera columna: la tarea empieza ya «En proceso». */
      if(phase === 0 && slots[0].parentNode.offsetParent === null) phase = 1;
      setPhase(phase);
    }
    /* Frase: se ilumina mientras cruza la pantalla. */
    if(words.length){
      var pr = phrase.getBoundingClientRect();
      var lit = Math.round(clamp((vh * .85 - pr.top) / (vh * .5 + pr.height), 0, 1) * words.length);
      words.forEach(function(w, i){ w.classList.toggle('is-lit', i < lit); });
    }
    /* Recorrido: el capítulo depende de cuánto se ha avanzado dentro del tramo fijo. */
    if(pinned){
      var tr = tour.getBoundingClientRect();
      var span = tour.offsetHeight - vh;
      var tp = span > 0 ? clamp(-tr.top / span, 0, .999) : 0;
      setStep(Math.floor(tp * chapters.length));
    }
    /* Pasos: la línea se rellena al cruzar la sección. */
    if(steps){
      var sr = steps.getBoundingClientRect();
      steps.style.setProperty('--fill', clamp((vh * .8 - sr.top) / (vh * .45), 0, 1).toFixed(3));
    }
  }
  function onScroll(){ if(!queued){ queued = true; requestAnimationFrame(paint); } }
  window.addEventListener('scroll', onScroll, {passive:true});
  window.addEventListener('resize', function(){ fitTour(); onScroll(); }, {passive:true});
  fitTour();
  paint();
})();
