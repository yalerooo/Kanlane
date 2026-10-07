/* Avisos para errores, acciones recuperables y confirmaciones que no son visibles
   en la pantalla. Se muestran por encima de los diálogos abiertos. */
(function(){
  const DURATION = 3200;
  const UNDO_DURATION = 8000;
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');
  const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

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

  /* Los éxitos habituales ya se ven en la interfaz. Solo se muestran errores,
     acciones disponibles y confirmaciones marcadas como importantes. */
  function show(message, opts){
    opts = opts || {};
    if(!opts.error && !opts.action && !opts.important) return null;
    const root = ensureContainer();
    const duplicate = Array.from(root.children).find((item) => item.dataset.message === message && item.classList.contains('is-error') === !!opts.error);
    if(duplicate) duplicate.remove();
    const el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' is-error' : '');
    el.dataset.message = message;
    el.setAttribute('role', opts.error ? 'alert' : 'status');
    /* Sumi acompaña al texto con el gesto que le toca: triste en un error, contento en una
       confirmación y el normal cuando solo se ofrece una acción. opts.mood lo cambia. */
    const mood = opts.mood || (opts.error ? 'triste' : opts.important ? 'contento' : 'normal');
    el.innerHTML = Workhub.views.sumi.svg({mini:true, size:mood === 'fiesta' ? 34 : 26, mood:mood, cls:'toast-sumi is-pop'}) + '<span class="toast-text"></span>';
    el.querySelector('.toast-text').textContent = message;
    if(opts.action){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', () => { opts.action.run(); dismiss(el); });
      el.appendChild(btn);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', Workhub.t('Cerrar aviso'));
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', () => dismiss(el));
    el.appendChild(close);
    root.appendChild(el);
    while(root.children.length > 2) root.firstChild.remove();
    bringToFront();
    setTimeout(() => dismiss(el), opts.duration || DURATION);
    return el;
  }

  /* Aviso con «Deshacer» durante unos segundos. restore() devuelve una promesa. */
  function undoable(message, restore, doneMessage){
    return show(message, {duration:UNDO_DURATION, action:{label:'Deshacer', run(){
      restore().then(
        () => show(doneMessage || 'Restaurado', {important:true}),
        () => show('No se pudo deshacer', {error:true}));
    }}});
  }

  Workhub.views.toast = {
    undoable,
    success(message, opts){ return show(message, opts); },
    error(message, opts){ return show(message, Object.assign({error:true}, opts)); }
  };
})();
