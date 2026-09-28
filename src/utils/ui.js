/* Pequeñas ayudas de interfaz compartidas por varias vistas. */
(function(){
  /* Copia texto al portapapeles y muestra "Copiado" en el botón durante un momento. */
  function copyWithFeedback(btn, text){
    if(!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve();
    return navigator.clipboard.writeText(text || '').then(() => {
      flashLabel(btn, 'Copiado');
    }).catch(() => {});
  }

  function flashLabel(btn, label){
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
