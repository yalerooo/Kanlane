/* Portada pública: sombra de la cabecera al desplazarse y año del pie. */
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
  if(!top) return;
  function onScroll(){ top.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, {passive: true});
  onScroll();
})();
