/* Ajustes: muestras de color de acento, selector de tema y almacenamiento.
   También aplica acento y tema al documento (variables CSS y data-theme). */
(function(){
  const {esc, closest, CHECK_ICON} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  class SettingsView {
    constructor(){
      this.swatches = $('accentSwatches');
      this.themeSegment = $('themeSegment');
      this.storageDetail = $('storageDetail');
    }

    bindAccent(handler){
      this.swatches.addEventListener('click', (ev) => {
        const b = closest(ev.target, '.swatch');
        if(b) handler(b.getAttribute('data-accent'));
      });
    }

    bindTheme(handler){
      this.themeSegment.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-theme-choice]');
        if(b) handler(b.getAttribute('data-theme-choice'));
      });
    }

    applyAccent(a){
      const s = document.documentElement.style;
      s.setProperty('--acc-solid-l', a.solid);
      s.setProperty('--acc-ink-l', a.ink);
      s.setProperty('--acc-text-l', a.textL);
      s.setProperty('--acc-soft-l', a.softL);
      s.setProperty('--acc-solid-d', a.solidD || a.solid);
      s.setProperty('--acc-ink-d', a.inkD || a.ink);
      s.setProperty('--acc-text-d', a.textD);
      s.setProperty('--acc-soft-d', a.softD);
    }

    /* 'system' solo quita el atributo si lo ha pedido el usuario: al arrancar se
       respeta el que ya tuviera la página (p. ej. el que fija el visor de Claude). */
    applyTheme(choice, fromUser){
      const root = document.documentElement;
      if(choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
      else if(fromUser) root.removeAttribute('data-theme');
    }

    render(accents, currentAccent, currentTheme, isLocal){
      this.swatches.innerHTML = accents.map((a) => {
        const sel = a.key === currentAccent;
        return '<button type="button" class="swatch" role="radio" aria-checked="' + (sel ? 'true' : 'false') + '" data-accent="' + a.key + '" style="--sw:' + a.solid + ';--sw-ink:' + a.ink + '">' +
          '<span class="swatch-dot">' + CHECK_ICON + '</span>' + esc(a.name) + '</button>';
      }).join('');
      this.themeSegment.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-checked', b.getAttribute('data-theme-choice') === currentTheme ? 'true' : 'false');
      });
      this.storageDetail.textContent = isLocal
        ? 'En este navegador (modo local). Haz copias de seguridad de vez en cuando.'
        : 'Sincronizado en tu espacio de Claude.';
    }
  }

  Workhub.views.SettingsView = SettingsView;
})();
