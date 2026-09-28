/* Avisos breves en la esquina inferior ("Tarea guardada", "Contacto eliminado"…).
   Se muestran por encima de cualquier diálogo abierto (capa superior). */
(function(){
  const DURATION = 3200;
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');
  const OK_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ERR_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17v.01"/></svg>';

  let container = null;

  function ensureContainer(){
    if(container) return container;
    container = document.getElementById('toasts');
    if(supportsPopover) container.setAttribute('popover', 'manual');
    return container;
  }

  /* Vuelve a poner la capa de avisos encima de lo último que se abrió. */
  function bringToFront(){
    if(!supportsPopover) return;
    try{ if(container.matches(':popover-open')) container.hidePopover(); container.showPopover(); }catch(e){}
  }

  function dismiss(el){
    if(!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => {
      el.remove();
      if(supportsPopover && !container.children.length){
        try{ container.hidePopover(); }catch(e){}
      }
    }, 160);
  }

  /* opts: {error:true} para avisos de fallo; {action:{label, run}} para un botón. */
  function show(message, opts){
    opts = opts || {};
    const root = ensureContainer();
    const el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' is-error' : '');
    el.setAttribute('role', opts.error ? 'alert' : 'status');
    el.innerHTML = '<span class="toast-icon">' + (opts.error ? ERR_ICON : OK_ICON) + '</span><span class="toast-text"></span>';
    el.querySelector('.toast-text').textContent = message;
    if(opts.action){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', () => { opts.action.run(); dismiss(el); });
      el.appendChild(btn);
    }
    root.appendChild(el);
    while(root.children.length > 3) root.firstChild.remove();
    bringToFront();
    setTimeout(() => dismiss(el), opts.duration || DURATION);
    return el;
  }

  Workhub.views.toast = {
    success(message, opts){ return show(message, opts); },
    error(message, opts){ return show(message, Object.assign({error:true}, opts)); }
  };
})();
