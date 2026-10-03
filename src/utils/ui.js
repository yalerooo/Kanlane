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

  Workhub.utils.ui = {copyWithFeedback, flashLabel, showMessage, bindDragAndDrop, consumeDragClick};
})();
