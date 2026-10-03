/* Pequeñas ayudas de interfaz compartidas por varias vistas. */
(function(){
  /* Copia texto al portapapeles y muestra "Copiado" en el botón durante un momento. */
  function copyWithFeedback(btn, text){
    if(!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve();
    return navigator.clipboard.writeText(text || '').then(() => {
      flashLabel(btn, 'Copiado');
    }).catch(() => {});
  }

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
     Mientras se arrastra, la página y las listas se desplazan solas al
     acercarse a sus bordes (ver utils/autoscroll.js). */
  function bindDragAndDrop(container, opts){
    const {closest} = Workhub.utils.html;
    const autoscroll = Workhub.utils.autoscroll;
    let over = null;

    function clearOver(){
      if(over){ over.classList.remove('drag-over'); over = null; }
      if(opts.onEnd) opts.onEnd();
    }

    container.addEventListener('dragstart', (ev) => {
      const item = closest(ev.target, opts.itemSelector);
      if(!item) return;
      item.setAttribute('data-dragged', '1');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', opts.getPayload(item));
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
     abre) o se apaga hacia él (el círculo se cierra). apply() es lo que cambia el tema.
     Sin View Transitions o con movimiento reducido, el cambio es inmediato. */
  function isDark(){
    const attr = document.documentElement.getAttribute('data-theme');
    return attr ? attr === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function themeSwitch(origin, apply){
    const root = document.documentElement;
    if(!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      apply();
      return;
    }
    const wasDark = isDark();
    const box = origin && origin.getBoundingClientRect ? origin.getBoundingClientRect() : null;
    const x = box ? box.left + box.width / 2 : window.innerWidth / 2;
    const y = box ? box.top + box.height / 2 : window.innerHeight / 2;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    let off = false;
    let anim = null;
    /* La animación se cancela al terminar: si se quedara, taparía la del cambio siguiente. */
    const clean = () => {
      if(anim) anim.cancel();
      root.classList.remove('theme-vt', 'theme-off');
    };
    let vt;
    try{
      vt = document.startViewTransition(() => {
        /* Sin transiciones propias: la imagen del tema nuevo se toma ya terminada. */
        root.classList.add('theme-vt');
        apply();
        off = isDark();
        root.classList.toggle('theme-off', off);
      });
    }catch(e){
      clean();
      apply();
      return;
    }
    vt.ready.then(() => {
      /* El tema no ha cambiado de claro a oscuro ni al revés (p. ej. «Sistema»): nada que animar. */
      if(off === wasDark) return;
      const small = 'circle(0px at ' + x + 'px ' + y + 'px)';
      const big = 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)';
      anim = root.animate({clipPath: off ? [big, small] : [small, big]}, {
        duration: off ? 480 : 560,
        easing: 'cubic-bezier(.4, 0, .2, 1)',
        fill: 'forwards',
        pseudoElement: off ? '::view-transition-old(root)' : '::view-transition-new(root)'
      });
    }).catch(() => {});
    vt.finished.then(clean, clean);
  }

  Workhub.utils.ui = {copyWithFeedback, flashLabel, showMessage, bindDragAndDrop, consumeDragClick, themeSwitch};
})();
