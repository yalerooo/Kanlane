/* Portada pública: sombra de la cabecera al desplazarse y año del pie. */
(function(){
  var top = document.getElementById('top');
  var year = document.getElementById('year');
  if(year) year.textContent = String(new Date().getFullYear());
  if(!top) return;
  function onScroll(){ top.classList.toggle('is-scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, {passive: true});
  onScroll();
})();
