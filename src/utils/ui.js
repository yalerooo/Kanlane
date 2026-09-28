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
     - onDrop(payload, target) */
  function bindDragAndDrop(container, opts){
    let over = null;

    container.addEventListener('dragstart', (ev) => {
      const item = Workhub.utils.html.closest(ev.target, opts.itemSelector);
      if(!item) return;
      item.classList.add('dragging');
      item.setAttribute('data-dragged', '1');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', opts.getPayload(item));
    });

    container.addEventListener('dragend', (ev) => {
      const item = Workhub.utils.html.closest(ev.target, opts.itemSelector);
      if(item){
        item.classList.remove('dragging');
        setTimeout(() => { item.removeAttribute('data-dragged'); }, 0);
      }
      if(over){ over.classList.remove('drag-over'); over = null; }
    });

    container.addEventListener('dragover', (ev) => {
      const target = Workhub.utils.html.closest(ev.target, opts.targetSelector);
      if(!target) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      if(over !== target){
        if(over) over.classList.remove('drag-over');
        target.classList.add('drag-over');
        over = target;
      }
    });

    container.addEventListener('dragleave', (ev) => {
      const target = Workhub.utils.html.closest(ev.target, opts.targetSelector);
      if(!target || target !== over || target.contains(ev.relatedTarget)) return;
      target.classList.remove('drag-over');
      over = null;
    });

    container.addEventListener('drop', (ev) => {
      const target = Workhub.utils.html.closest(ev.target, opts.targetSelector);
      if(!target) return;
      ev.preventDefault();
      target.classList.remove('drag-over');
      over = null;
      opts.onDrop(ev.dataTransfer.getData('text/plain') || '', target);
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
