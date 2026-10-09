/* Pequeñas ayudas de interfaz compartidas por varias vistas. */
(function(){
  /* Copia texto al portapapeles y muestra "Copiado" en el botón durante un momento. */
  function copyWithFeedback(btn, text){
    if(!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve();
    /* Lo que hubiera pendiente de borrar ya no está en el portapapeles. */
    forgetSecret();
    return navigator.clipboard.writeText(text || '').then(() => {
      flashLabel(btn, 'Copiado');
    }).catch(() => {});
  }

  /* ---------- Contraseñas copiadas: se borran solas del portapapeles ---------- */

  /* Tiempo para usar una contraseña copiada antes de que se borre del portapapeles. */
  const SECRET_MS = 60000;
  /* Lo copiado que está pendiente de borrar: {text, timer, onFocus}. */
  let secret = null;

  function forgetSecret(){
    if(!secret) return;
    clearTimeout(secret.timer);
    if(secret.onFocus) window.removeEventListener('focus', secret.onFocus);
    secret = null;
  }

  /* Si el navegador ya deja leer el portapapeles, se mira si sigue ahí lo copiado; si no se
     puede saber (lo normal), se da por hecho que sí. Nunca se pide el permiso para esto. */
  function stillThere(text){
    if(!navigator.permissions || !navigator.clipboard.readText) return Promise.resolve(true);
    return navigator.permissions.query({name:'clipboard-read'})
      .then((p) => (p.state === 'granted' ? navigator.clipboard.readText().then((now) => now === text) : true))
      .catch(() => true);
  }

  function wipeSecret(){
    const mine = secret;
    if(!mine) return;
    stillThere(mine.text).then((there) => {
      if(secret !== mine) return;
      /* Se copió otra cosa desde otro sitio: no es nuestra, no se toca. */
      if(!there){ forgetSecret(); return; }
      navigator.clipboard.writeText('').then(() => {
        if(secret !== mine) return;
        forgetSecret();
        if(Workhub.views.toast) Workhub.views.toast.success('Contraseña borrada del portapapeles', {important:true});
      }, () => {
        /* El navegador solo deja escribir con la pestaña delante: se borra al volver a ella. */
        if(secret !== mine || mine.onFocus) return;
        mine.onFocus = () => { mine.onFocus = null; wipeSecret(); };
        window.addEventListener('focus', mine.onFocus, {once:true});
      });
    });
  }

  /* Copia una contraseña (o las notas cifradas de una): como copyWithFeedback, y pasado un minuto
     se borra del portapapeles. Copiar otra cosa desde Kanlane, o copiar o cortar texto de la
     página, cancela el borrado: lo que hay ya no es la contraseña. */
  function copySecret(btn, text){
    if(!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve();
    forgetSecret();
    return navigator.clipboard.writeText(text || '').then(() => {
      flashLabel(btn, 'Copiado');
      if(!text) return;
      secret = {text:text, onFocus:null, timer:setTimeout(wipeSecret, SECRET_MS)};
      if(Workhub.views.toast) Workhub.views.toast.success('Copiada. Se borrará del portapapeles en 1 minuto.', {important:true});
    }).catch(() => {});
  }
  document.addEventListener('copy', forgetSecret);
  document.addEventListener('cut', forgetSecret);

  const DONE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';

  function flashLabel(btn, label){
    /* Botón de solo icono: se cambia el icono por una marca y el nombre accesible por el aviso. */
    if(btn.querySelector('svg') && !btn.textContent.trim()){
      const html = btn.innerHTML, name = btn.getAttribute('aria-label');
      btn.innerHTML = DONE_ICON;
      btn.setAttribute('aria-label', Workhub.t(label));
      setTimeout(() => {
        btn.innerHTML = html;
        if(name === null) btn.removeAttribute('aria-label'); else btn.setAttribute('aria-label', name);
      }, 1200);
      return;
    }
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  function showMessage(el, msg){
    el.textContent = msg;
    el.hidden = false;
  }

  /* Delegación de arrastrar y soltar sobre un contenedor.
     - itemSelector: elementos arrastrables (llevan data-id)
     - targetSelector: elementos sobre los que se puede soltar
     - getPayload(item): texto que viaja en dataTransfer
     - onDrop(payload, target, ev)
     - onOver(ev, target) y onEnd(): opcionales, para pintar dónde caerá.
     - accept(ev): opcional; si devuelve false se ignora ese arrastre.
     - ghost: true para llevar bajo el cursor una copia opaca del elemento (ver ghostStart)
       en vez de la imagen semitransparente del navegador. Con ratón, además, el arrastre lo
       lleva este código con eventos de puntero y no el navegador (ver bindPointerDrag).
     Mientras se arrastra, la página y las listas se desplazan solas al
     acercarse a sus bordes (ver utils/autoscroll.js). */
  /* Copia del elemento que se arrastra, pegada al cursor. El navegador pinta su propia imagen
     de arrastre semitransparente y no deja cambiarla: se sustituye por una imagen vacía y la
     copia la mueve este código. Sigue al cursor con un poco de retraso y se inclina según la
     velocidad, como algo que cuelga de la mano. */
  const BLANK = new Image();
  BLANK.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const ghost = {el:null, raf:0};

  function ghostStart(item, ev){
    ghostStop(true);
    /* Arrastre nativo: sin poder quitar la imagen del navegador no se pone la copia. */
    if(ev.dataTransfer && !ev.dataTransfer.setDragImage) return;
    const rect = item.getBoundingClientRect();
    const el = item.cloneNode(true);
    el.classList.remove('dragging');
    el.classList.add('drag-ghost');
    el.removeAttribute('draggable');
    el.removeAttribute('tabindex');
    el.setAttribute('aria-hidden', 'true');
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    document.body.appendChild(el);
    if(ev.dataTransfer) ev.dataTransfer.setDragImage(BLANK, 0, 0);
    const reduced = document.documentElement.getAttribute('data-motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Object.assign(ghost, {el:el, origin:rect, grabX:ev.clientX - rect.left, grabY:ev.clientY - rect.top,
      x:rect.left, y:rect.top, tx:rect.left, ty:rect.top, tilt:0, reduced:reduced});
    const paint = () => { el.style.transform = 'translate3d(' + ghost.x + 'px,' + ghost.y + 'px,0) rotate(' + ghost.tilt + 'deg) scale(1.03)'; };
    paint();
    const step = () => {
      if(ghost.el !== el) return;
      const k = ghost.reduced ? 1 : 0.32;
      const dx = ghost.tx - ghost.x;
      ghost.x += dx * k;
      ghost.y += (ghost.ty - ghost.y) * k;
      /* Inclinación según lo rápido que va hacia los lados, con vuelta suave a recto. */
      const want = ghost.reduced ? 0 : Math.max(-7, Math.min(7, dx * 0.12));
      ghost.tilt += (want - ghost.tilt) * 0.18;
      paint();
      ghost.raf = requestAnimationFrame(step);
    };
    ghost.raf = requestAnimationFrame(step);
    if(ev.dataTransfer) document.addEventListener('dragover', ghostFollow, true);
  }

  function ghostFollow(ev){
    if(!ghost.el || (!ev.clientX && !ev.clientY)) return;
    ghost.tx = ev.clientX - ghost.grabX;
    ghost.ty = ev.clientY - ghost.grabY;
  }

  /* Dónde está la copia ahora mismo (para que lo soltado se asiente desde ahí). */
  function dragGhostRect(){
    return ghost.el ? {left:ghost.x, top:ghost.y} : null;
  }

  /* dropped: la copia desaparece sin más (lo soltado ya está en su sitio). Si el arrastre se
     cancela, vuelve a su origen antes de quitarse. */
  function ghostStop(dropped){
    const el = ghost.el;
    if(!el) return;
    cancelAnimationFrame(ghost.raf);
    document.removeEventListener('dragover', ghostFollow, true);
    ghost.el = null;
    if(dropped || ghost.reduced || !el.animate){ el.remove(); return; }
    const back = el.animate([
      {transform:el.style.transform, opacity:1},
      {transform:'translate3d(' + ghost.origin.left + 'px,' + ghost.origin.top + 'px,0) scale(1)', opacity:.4}
    ], {duration:220, easing:'cubic-bezier(.2, .7, .2, 1)'});
    back.onfinish = back.oncancel = () => el.remove();
  }

  /* Arrastre con el ratón llevado a mano (eventos de puntero), para los elementos con «ghost».
     Durante un arrastre nativo el navegador pone su propio cursor y no deja cambiarlo; así el
     cursor es la mano cerrada de principio a fin. Con el dedo se deja el arrastre nativo.
     hooks: {over(x, y), drop(x, y) → bool, clear()} los pone bindDragAndDrop. */
  function bindPointerDrag(container, opts, hooks){
    const {closest} = Workhub.utils.html;
    const autoscroll = Workhub.utils.autoscroll;
    const THRESHOLD = 5;
    let s = null;

    function finish(dropped){
      if(!s) return;
      const item = s.item, started = s.started;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('keydown', onKey, true);
      s = null;
      if(!started) return;
      item.classList.remove('dragging');
      setTimeout(() => { item.removeAttribute('data-dragged'); }, 0);
      document.body.classList.remove('is-dragging', 'is-grabbing');
      autoscroll.stop();
      hooks.clear();
      ghostStop(dropped);
    }

    function onMove(ev){
      if(!s || ev.pointerId !== s.pointerId) return;
      if(!s.started){
        if(Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < THRESHOLD) return;
        s.started = true;
        s.item.setAttribute('data-dragged', '1');
        ghostStart(s.item, {clientX:s.x, clientY:s.y});
        s.item.classList.add('dragging');
        document.body.classList.add('is-dragging', 'is-grabbing');
        const sel = window.getSelection && window.getSelection();
        if(sel && sel.removeAllRanges) sel.removeAllRanges();
        autoscroll.start();
      }
      ev.preventDefault();
      ghostFollow(ev);
      autoscroll.point(ev.clientX, ev.clientY);
      hooks.over(ev.clientX, ev.clientY);
    }

    function onUp(ev){
      if(!s || ev.pointerId !== s.pointerId) return;
      if(!s.started){ finish(false); return; }
      const payload = opts.getPayload(s.item);
      const x = ev.clientX, y = ev.clientY;
      /* La copia sigue viva mientras se suelta: quien recibe la suelta puede preguntar dónde está. */
      const dropped = hooks.drop(payload, x, y);
      finish(dropped);
    }

    function onCancel(){ finish(false); }
    function onKey(ev){
      if(ev.key !== 'Escape' || !s || !s.started) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    }

    container.addEventListener('pointerdown', (ev) => {
      if(ev.button !== 0 || ev.pointerType === 'touch' || s) return;
      const item = closest(ev.target, opts.itemSelector);
      if(!item || item.getAttribute('draggable') !== 'true') return;
      /* Enlaces y botones de dentro del elemento siguen siendo suyos. */
      if(closest(ev.target, 'a, button, input, select, textarea')) return;
      s = {item:item, x:ev.clientX, y:ev.clientY, pointerId:ev.pointerId, started:false};
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onCancel, true);
      document.addEventListener('keydown', onKey, true);
    });

    /* true mientras este código lleva (o puede empezar a llevar) el arrastre. */
    return () => !!s;
  }

  function bindDragAndDrop(container, opts){
    const {closest} = Workhub.utils.html;
    const autoscroll = Workhub.utils.autoscroll;
    let over = null;
    let byPointer = () => false;

    function clearOver(){
      if(over){ over.classList.remove('drag-over'); over = null; }
      if(opts.onEnd) opts.onEnd();
    }

    if(opts.ghost && window.PointerEvent){
      byPointer = bindPointerDrag(container, opts, {
        over: (x, y) => {
          const el = document.elementFromPoint(x, y);
          const target = el && container.contains(el) ? closest(el, opts.targetSelector) : null;
          if(over !== target){
            if(over) over.classList.remove('drag-over');
            if(target) target.classList.add('drag-over');
            over = target;
            if(!target && opts.onEnd) opts.onEnd();
          }
          if(target && opts.onOver) opts.onOver({clientX:x, clientY:y}, target);
        },
        drop: (payload, x, y) => {
          const el = document.elementFromPoint(x, y);
          const target = el && container.contains(el) ? closest(el, opts.targetSelector) : null;
          if(!target) return false;
          opts.onDrop(payload, target, {clientX:x, clientY:y});
          return true;
        },
        clear: clearOver
      });
    }

    container.addEventListener('dragstart', (ev) => {
      const item = closest(ev.target, opts.itemSelector);
      if(!item) return;
      /* Con el ratón el arrastre lo lleva bindPointerDrag: se anula el nativo. */
      if(byPointer()){ ev.preventDefault(); return; }
      item.setAttribute('data-dragged', '1');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', opts.getPayload(item));
      if(opts.ghost) ghostStart(item, ev);
      /* La clase se añade después para que la imagen fantasma salga opaca. */
      requestAnimationFrame(() => item.classList.add('dragging'));
      document.body.classList.add('is-dragging');
      autoscroll.start();
    });

    container.addEventListener('dragend', (ev) => {
      const item = closest(ev.target, opts.itemSelector);
      if(item){
        item.classList.remove('dragging');
        setTimeout(() => { item.removeAttribute('data-dragged'); }, 0);
      }
      document.body.classList.remove('is-dragging');
      autoscroll.stop();
      clearOver();
      if(opts.ghost) ghostStop(ev.dataTransfer && ev.dataTransfer.dropEffect !== 'none');
    });

    container.addEventListener('dragover', (ev) => {
      if(opts.accept && !opts.accept(ev)) return;
      const target = closest(ev.target, opts.targetSelector);
      if(!target) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      if(over !== target){
        if(over) over.classList.remove('drag-over');
        target.classList.add('drag-over');
        over = target;
      }
      if(opts.onOver) opts.onOver(ev, target);
    });

    container.addEventListener('dragleave', (ev) => {
      const target = closest(ev.target, opts.targetSelector);
      if(!target || target !== over || target.contains(ev.relatedTarget)) return;
      clearOver();
    });

    container.addEventListener('drop', (ev) => {
      if(opts.accept && !opts.accept(ev)) return;
      const target = closest(ev.target, opts.targetSelector);
      if(!target) return;
      ev.preventDefault();
      const payload = ev.dataTransfer.getData('text/plain') || '';
      opts.onDrop(payload, target, ev);
      clearOver();
      /* Si al soltar se repinta la lista, el elemento arrastrado ya no está en la página y su
         «dragend» no llega hasta aquí: se recoge también en este momento. */
      document.body.classList.remove('is-dragging');
      autoscroll.stop();
      if(opts.ghost) ghostStop(true);
    });
  }

  /* Un clic justo después de arrastrar no debe abrir la ficha. */
  function consumeDragClick(el){
    if(el.getAttribute('data-dragged') === '1'){
      el.removeAttribute('data-dragged');
      return true;
    }
    return false;
  }

  /* Cambio de tema sin golpe: la luz se enciende desde el botón pulsado (un círculo que se
     abre) o se apaga hacia él (el círculo se cierra), con el borde difuminado y un aro de
     luz, como una gota de cristal (las máscaras están en base.css y siguen a --theme-r).
     apply() es lo que cambia el tema.
     Sin View Transitions o con movimiento reducido, el cambio es inmediato. */
  function isDark(){
    const attr = document.documentElement.getAttribute('data-theme');
    return attr ? attr === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* Ancho de la franja del borde, en píxeles (el mismo que usan las máscaras de base.css). */
  const RIM = 120;

  function themeSwitch(origin, apply){
    const root = document.documentElement;
    if(!document.startViewTransition || root.getAttribute('data-motion') === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      apply();
      return;
    }
    const wasDark = isDark();
    const box = origin && origin.getBoundingClientRect ? origin.getBoundingClientRect() : null;
    const x = box ? box.left + box.width / 2 : window.innerWidth / 2;
    const y = box ? box.top + box.height / 2 : window.innerHeight / 2;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    let off = false;
    /* El borde del círculo es una franja ancha: el radio final la saca entera de la pantalla. */
    const small = '0px', big = Math.ceil(r + RIM) + 'px';
    const anims = [];
    /* Las animaciones se cancelan al terminar: si se quedaran, taparían las del cambio siguiente. */
    const clean = () => {
      anims.forEach((a) => a.cancel());
      root.classList.remove('theme-vt', 'theme-off');
      ['--theme-x', '--theme-y', '--theme-r'].forEach((p) => root.style.removeProperty(p));
    };
    let vt;
    try{
      vt = document.startViewTransition(() => {
        /* Sin transiciones propias: la imagen del tema nuevo se toma ya terminada. */
        root.classList.add('theme-vt');
        apply();
        off = isDark();
        root.classList.toggle('theme-off', off);
        root.style.setProperty('--theme-x', x + 'px');
        root.style.setProperty('--theme-y', y + 'px');
        root.style.setProperty('--theme-r', off ? big : small);
      });
    }catch(e){
      clean();
      apply();
      return;
    }
    vt.ready.then(() => {
      /* El tema no ha cambiado de claro a oscuro ni al revés (p. ej. «Sistema»): nada que animar. */
      if(off === wasDark) return;
      const timing = {duration: off ? 760 : 860, easing: 'cubic-bezier(.3, .1, .2, 1)', fill: 'both'};
      /* El radio se anima en <html> y lo heredan las dos imágenes de la transición. */
      anims.push(root.animate({'--theme-r': off ? [big, small] : [small, big]}, timing));
      /* La transición dura lo que duren las animaciones de sus imágenes: esta la mantiene viva. */
      anims.push(root.animate({opacity: [1, 1]}, Object.assign({pseudoElement: '::view-transition-new(root)'}, timing)));
    }).catch(() => {});
    vt.finished.then(clean, clean);
  }

  Workhub.utils.ui = {copyWithFeedback, copySecret, flashLabel, showMessage, bindDragAndDrop, consumeDragClick, themeSwitch, dragGhostRect};
})();
