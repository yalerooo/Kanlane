/* Plugin oficial "Apariencia": personaliza el aspecto de Kanlane.
   Permisos: appearance, storage.
   - En segundo plano: aplica la apariencia guardada al abrir Kanlane.
   - En el panel: tema, paleta, acento, navegación, fuente, tamaño, esquinas y espaciado.
   Se guarda en storage ('look') del proyecto abierto. */
(function(){
  var MANIFEST = {
    id: 'workhub.apariencia',
    name: 'Apariencia',
    version: '1.2.0',
    description: 'Personaliza el tema, los colores, la navegación, la tipografía, el tamaño del texto, las esquinas y el espaciado de cada proyecto.',
    author: 'Kanlane',
    icon: 'sparkles',
    color: 328,
    permissions: ['appearance', 'storage']
  };
  var PRESETS = ['#2563EB', '#4F46E5', '#9B4DFF', '#DB2777', '#E5484D', '#E0492D', '#B45309', '#0D8F6F', '#0EA5A4', '#0B84C6', '#475569', '#71717A'];
  var RADII = ['sharp', 'normal', 'round'];
  var DENSITIES = ['compact', 'normal', 'comfortable'];
  var THEMES = ['default', 'system', 'light', 'dark'];
  var PALETTES = ['default', 'warm', 'cool', 'slate'];
  var FONTS = ['default', 'system', 'serif', 'mono'];
  var TEXT_SIZES = ['small', 'normal', 'large'];
  var NAVS = ['default', 'side', 'top'];
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  var tr = WorkhubPlugin.translations({en:{
    'No se pudo guardar: {error}':'Could not save: {error}', 'Apariencia':'Appearance',
    'Personaliza el proyecto abierto. Los cambios se aplican al momento y se guardan para la próxima vez.':'Customize the current project. Changes apply immediately and are saved for next time.',
    'Tema':'Theme', 'Según Ajustes':'From Settings', 'Según el sistema':'Follow system', 'Claro':'Light', 'Oscuro':'Dark',
    'Paleta de interfaz':'Interface palette', 'Colores de fondo, paneles y barra lateral.':'Background, panels and sidebar colors.',
    'Original':'Original', 'Cálida':'Warm', 'Fría':'Cool', 'Pizarra':'Slate',
    'Color de acento':'Accent color', 'Botones principales, sección activa y elementos seleccionados.':'Primary buttons, active section and selected items.',
    'Otro':'Other', 'Navegación':'Navigation', 'Dónde van las secciones en este proyecto. En pantallas pequeñas van siempre abajo.':'Where the sections go in this project. On small screens they always go at the bottom.',
    'Lateral':'Sidebar', 'Arriba':'Top', 'Esquinas':'Corners', 'Forma de tarjetas, botones y campos.':'Shape of cards, buttons and fields.',
    'Rectas':'Sharp', 'Normales':'Normal', 'Redondeadas':'Rounded', 'Densidad':'Density',
    'Espacio de las tarjetas del tablero, listas y barra lateral.':'Spacing of board cards, lists and sidebar.',
    'Compacta':'Compact', 'Normal':'Normal', 'Amplia':'Comfortable',
    'Tipografía':'Typography', 'Fuente de los textos de Kanlane.':'Font used by Kanlane text.',
    'Kanlane':'Kanlane', 'Del sistema':'System', 'Serif':'Serif', 'Monoespaciada':'Monospaced',
    'Tamaño del texto':'Text size', 'Ajusta la lectura de la interfaz.':'Adjust interface text for reading.',
    'Pequeño':'Small', 'Grande':'Large', 'Guardando…':'Saving…', 'Guardado':'Saved', 'No se pudo guardar':'Could not save',
    'Restablecer':'Reset',
    'Conectando con Kanlane…':'Connecting to Kanlane…',
    'Este plugin se abre desde Kanlane (sección Plugins).':'This plugin opens from Kanlane (Plugins section).',
    'No se pudo conectar con Kanlane: {error}':'Could not connect to Kanlane: {error}'
  }});

  var app = document.getElementById('app');
  document.getElementById('status').textContent = tr('Conectando con Kanlane…');
  var wh = null;
  var look = {theme:'default', palette:'default', accent:null, nav:'default', font:'default', textSize:'normal', radius:'normal', density:'normal'};
  var persisted = null;
  var writeVersion = 0;

  function norm(v){
    v = v && typeof v === 'object' ? v : {};
    return {
      theme: THEMES.indexOf(v.theme) !== -1 ? v.theme : 'default',
      palette: PALETTES.indexOf(v.palette) !== -1 ? v.palette : 'default',
      accent: /^#[0-9a-fA-F]{6}$/.test(v.accent || '') ? v.accent.toUpperCase() : null,
      nav: NAVS.indexOf(v.nav) !== -1 ? v.nav : 'default',
      font: FONTS.indexOf(v.font) !== -1 ? v.font : 'default',
      textSize: TEXT_SIZES.indexOf(v.textSize) !== -1 ? v.textSize : 'normal',
      radius: RADII.indexOf(v.radius) !== -1 ? v.radius : 'normal',
      density: DENSITIES.indexOf(v.density) !== -1 ? v.density : 'normal'
    };
  }

  function apply(){
    return wh.ui.setAppearance({theme:look.theme === 'default' ? null : look.theme,
      palette:look.palette, accent:look.accent, nav:look.nav === 'default' ? null : look.nav, font:look.font, textSize:look.textSize,
      radius:look.radius, density:look.density});
  }

  function save(){
    look = norm(look);
    var next = look;
    var version = ++writeVersion;
    render();
    setStatus('saving');
    wh.storage.set('look', next).then(function(){
      persisted = next;
      if(version === writeVersion) setStatus('saved');
    }).catch(function(err){
      if(version === writeVersion){ look = persisted || norm({}); render(); setStatus('error'); }
      wh.ui.toast(tr('No se pudo guardar: {error}', {error:err.message}), {type:'error'});
    });
  }

  function setStatus(state){
    var el = document.getElementById('saveStatus');
    if(el){ el.textContent = tr(state === 'saving' ? 'Guardando…' : state === 'error' ? 'No se pudo guardar' : 'Guardado'); el.className = 'save-status' + (state === 'error' ? ' is-error' : ''); }
  }

  function seg(name, options){
    return '<div class="seg" role="radiogroup">' + options.map(function(o){
      return '<button type="button" role="radio" aria-checked="' + (look[name] === o[0]) + '" class="' + (look[name] === o[0] ? 'is-on' : '') + '" data-set="' + name + '" data-value="' + o[0] + '">' + tr(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function render(){
    var palettes = [['default', 'Original'], ['warm', 'Cálida'], ['cool', 'Fría'], ['slate', 'Pizarra']].map(function(o){
      return '<button type="button" class="palette-choice' + (look.palette === o[0] ? ' is-on' : '') + '" data-set="palette" data-value="' + o[0] + '" aria-pressed="' + (look.palette === o[0]) + '"><span class="palette-sample is-' + o[0] + '"><i></i><i></i><i></i></span><span>' + tr(o[1]) + '</span></button>';
    }).join('');
    var fonts = [['default', 'Kanlane'], ['system', 'Del sistema'], ['serif', 'Serif'], ['mono', 'Monoespaciada']].map(function(o){
      return '<button type="button" class="font-choice is-' + o[0] + (look.font === o[0] ? ' is-on' : '') + '" data-set="font" data-value="' + o[0] + '" aria-pressed="' + (look.font === o[0]) + '"><strong>Aa</strong><span>' + tr(o[1]) + '</span></button>';
    }).join('');
    app.innerHTML =
      '<h1>' + tr('Apariencia') + '</h1><p class="wh-muted">' + tr('Personaliza el proyecto abierto. Los cambios se aplican al momento y se guardan para la próxima vez.') + '</p>' +
      '<div class="layout">' +
        '<div class="group"><h2>' + tr('Tema') + '</h2>' + seg('theme', [['default', 'Según Ajustes'], ['system', 'Según el sistema'], ['light', 'Claro'], ['dark', 'Oscuro']]) + '</div>' +
        '<div class="group"><h2>' + tr('Paleta de interfaz') + '</h2><p>' + tr('Colores de fondo, paneles y barra lateral.') + '</p><div class="palette-grid">' + palettes + '</div></div>' +
        '<div class="group"><h2>' + tr('Color de acento') + '</h2><p>' + tr('Botones principales, sección activa y elementos seleccionados.') + '</p><div class="swatches">' +
          '<button type="button" class="sw-default' + (look.accent ? '' : ' is-on') + '" data-accent="" aria-pressed="' + !look.accent + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v4.5h4.5"/></svg>' + tr('Original') + '</button>' +
          PRESETS.map(function(c){ return '<button type="button" class="sw' + (look.accent === c ? ' is-on' : '') + '" style="background:' + c + ';--sw:' + c + '" data-accent="' + c + '" aria-label="' + c + '">' + (look.accent === c ? CHECK : '') + '</button>'; }).join('') +
          '<label class="custom' + (look.accent && PRESETS.indexOf(look.accent) === -1 ? ' is-on' : '') + '">' + tr('Otro') + '<input type="color" id="custom" value="' + (look.accent || '#2563EB') + '"></label>' +
        '</div></div>' +
        '<div class="group"><h2>' + tr('Navegación') + '</h2><p>' + tr('Dónde van las secciones en este proyecto. En pantallas pequeñas van siempre abajo.') + '</p>' + seg('nav', [['default', 'Según Ajustes'], ['side', 'Lateral'], ['top', 'Arriba']]) + '</div>' +
        '<div class="group"><h2>' + tr('Tipografía') + '</h2><p>' + tr('Fuente de los textos de Kanlane.') + '</p><div class="font-grid">' + fonts + '</div></div>' +
        '<div class="group"><h2>' + tr('Tamaño del texto') + '</h2><p>' + tr('Ajusta la lectura de la interfaz.') + '</p>' + seg('textSize', [['small', 'Pequeño'], ['normal', 'Normal'], ['large', 'Grande']]) + '</div>' +
        '<div class="group"><h2>' + tr('Esquinas') + '</h2><p>' + tr('Forma de tarjetas, botones y campos.') + '</p>' + seg('radius', [['sharp', 'Rectas'], ['normal', 'Normales'], ['round', 'Redondeadas']]) + '</div>' +
        '<div class="group"><h2>' + tr('Densidad') + '</h2><p>' + tr('Espacio de las tarjetas del tablero, listas y barra lateral.') + '</p>' + seg('density', [['compact', 'Compacta'], ['normal', 'Normal'], ['comfortable', 'Amplia']]) + '</div>' +
        '<div class="foot"><span class="save-status" id="saveStatus" role="status">' + tr('Guardado') + '</span><button type="button" class="wh-btn" id="reset">' + tr('Restablecer') + '</button></div>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('[data-accent]'), function(b){
      b.onclick = function(){ look.accent = b.getAttribute('data-accent') || null; save(); };
    });
    document.getElementById('custom').onchange = function(ev){ look.accent = ev.target.value.toUpperCase(); save(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-set]'), function(b){
      b.onclick = function(){ look[b.getAttribute('data-set')] = b.getAttribute('data-value'); save(); };
    });
    document.getElementById('reset').onclick = function(){ look = norm({}); save(); };
  }

  WorkhubPlugin.connect(MANIFEST).then(function(client){
    wh = client;
    return wh.storage.get('look');
  }).then(function(saved){
    look = norm(saved);
    persisted = look;
    if(wh.isBackground){
      apply().catch(function(err){ wh.ui.toast(tr('No se pudo conectar con Kanlane: {error}', {error:err.message}), {type:'error'}); });
      /* El panel guardó cambios: aplicarlos. */
      wh.on('storage', function(ev){
        if(ev.scope === 'project' && ev.key === 'look') wh.storage.get('look').then(function(v){ look = norm(v); return apply(); }).catch(function(err){ wh.ui.toast(tr('No se pudo conectar con Kanlane: {error}', {error:err.message}), {type:'error'}); });
      });
    } else {
      render();
    }
  }).catch(function(err){
    document.getElementById('status').textContent = err.message === 'not-in-workhub'
      ? tr('Este plugin se abre desde Kanlane (sección Plugins).')
      : tr('No se pudo conectar con Kanlane: {error}', {error:err.message});
  });
})();
