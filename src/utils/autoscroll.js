/* Desplazamiento automático mientras se arrastra algo.
   Los navegadores apenas desplazan la página (o una lista con scroll propio)
   durante un arrastre nativo, así que al acercar el puntero a un borde se
   desplaza aquí el contenedor más cercano que pueda moverse en esa dirección,
   y si no hay ninguno, la ventana. Cuanto más cerca del borde, más rápido. */
(function(){
  const EDGE = 72;       /* px desde el borde en los que se empieza a desplazar */
  const MAX_SPEED = 22;  /* px por fotograma pegado al borde */

  let active = false;
  let x = 0, y = 0;
  let hasPoint = false;
  let lastEvent = 0;
  let frame = 0;

  function speedFor(distance){
    if(distance >= EDGE) return 0;
    const t = 1 - Math.max(distance, 0) / EDGE;
    return Math.ceil(MAX_SPEED * t * t);
  }

  function canScroll(el, axis){
    const style = getComputedStyle(el);
    const overflow = axis === 'y' ? style.overflowY : style.overflowX;
    if(overflow !== 'auto' && overflow !== 'scroll') return false;
    return axis === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
  }

  /* Contenedores con scroll bajo el puntero, del más interno al más externo. */
  function scrollContainers(){
    const list = [];
    let el = document.elementFromPoint(x, y);
    while(el && el !== document.body && el !== document.documentElement){
      if(canScroll(el, 'y') || canScroll(el, 'x')) list.push(el);
      el = el.parentElement;
    }
    return list;
  }

  /* Desplaza el contenedor en un eje si el puntero está cerca de uno de sus bordes. */
  function nudge(el, axis){
    const r = el.getBoundingClientRect();
    const pos = axis === 'y' ? y : x;
    const start = Math.max(axis === 'y' ? r.top : r.left, 0);
    const end = Math.min(axis === 'y' ? r.bottom : r.right, axis === 'y' ? window.innerHeight : window.innerWidth);
    const scroll = axis === 'y' ? 'scrollTop' : 'scrollLeft';
    const max = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    const back = speedFor(pos - start);
    const fwd = speedFor(end - pos);
    if(back && el[scroll] > 0){ el[scroll] -= back; return true; }
    if(fwd && el[scroll] < max - 1){ el[scroll] += fwd; return true; }
    return false;
  }

  function tick(){
    if(!active) return;
    /* Sin dragover reciente el puntero ha salido de la ventana: no desplazar. */
    if(!hasPoint || performance.now() - lastEvent > 250){ frame = requestAnimationFrame(tick); return; }

    let scrolledY = false, scrolledX = false;
    for(const el of scrollContainers()){
      if(!scrolledY && canScroll(el, 'y')) scrolledY = nudge(el, 'y');
      if(!scrolledX && canScroll(el, 'x')) scrolledX = nudge(el, 'x');
    }
    if(!scrolledY){
      const up = speedFor(y);
      const down = speedFor(window.innerHeight - y);
      if(up) window.scrollBy(0, -up);
      else if(down) window.scrollBy(0, down);
    }
    frame = requestAnimationFrame(tick);
  }

  function onDragOver(ev){
    x = ev.clientX;
    y = ev.clientY;
    hasPoint = true;
    lastEvent = performance.now();
  }

  function start(){
    if(active) return;
    active = true;
    hasPoint = false;
    document.addEventListener('dragover', onDragOver, true);
    frame = requestAnimationFrame(tick);
  }

  function stop(){
    active = false;
    cancelAnimationFrame(frame);
    document.removeEventListener('dragover', onDragOver, true);
  }

  Workhub.utils.autoscroll = {start, stop};
})();
