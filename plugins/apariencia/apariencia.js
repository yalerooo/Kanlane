/* Plugin oficial "Apariencia": personaliza el aspecto de Kanlane en el proyecto abierto.
   Permisos: appearance, storage.
   - En segundo plano: aplica la apariencia guardada al abrir Kanlane.
   - En el panel: temas listos de un clic y, debajo, cada ajuste por separado (color, cristal
     y fondo, disposición, texto y movimiento). Los cambios se ven al momento en el resto de
     Kanlane; no hay vista previa ficticia.
   Se guarda en storage ('look') del proyecto abierto. */
(function(){
  var MANIFEST = {
    id: 'workhub.apariencia',
    name: 'Apariencia',
    version: '2.0.0',
    description: 'Temas listos y ajustes finos para cada proyecto: colores, cristal y velo del fondo, navegación, tipografía, esquinas, espaciado y animaciones.',
    author: 'Kanlane',
    icon: 'sparkles',
    color: 328,
    permissions: ['appearance', 'storage']
  };

  var ACCENTS = ['#2563EB', '#4F46E5', '#9B4DFF', '#DB2777', '#E5484D', '#E0492D', '#B45309', '#0D8F6F', '#0EA5A4', '#0B84C6', '#475569', '#71717A'];
  var THEMES = ['default', 'system', 'light', 'dark'];
  var PALETTES = ['default', 'warm', 'cool', 'slate'];
  var GLASSES = ['solid', 'soft', 'normal', 'strong'];
  var WASHES = ['none', 'soft', 'normal', 'strong'];
  var NAVS = ['default', 'side', 'top'];
  var FONTS = ['default', 'system', 'serif', 'mono'];
  var TEXT_SIZES = ['small', 'normal', 'large'];
  var RADII = ['sharp', 'normal', 'round'];
  var DENSITIES = ['compact', 'normal', 'comfortable'];
  var MOTIONS = ['normal', 'reduced'];
  /* Parejas de colores para el velo del fondo (una por esquina). */
  var VEILS = {
    aurora: ['#9B4DFF', '#0EA5A4'],
    atardecer: ['#E0492D', '#DB2777'],
    oceano: ['#2563EB', '#0EA5A4'],
    bosque: ['#0D8F6F', '#B45309'],
    orquidea: ['#DB2777', '#4F46E5']
  };
  var VEIL_NAMES = {aurora:'Aurora', atardecer:'Atardecer', oceano:'Océano', bosque:'Bosque', orquidea:'Orquídea'};
  /* Temas listos: cada uno fija el color, el cristal y el fondo de una vez. No tocan la
     navegación, el tamaño del texto ni las animaciones. */
  var PRESET_KEYS = ['theme', 'palette', 'accent', 'veil', 'glass', 'wash', 'font', 'radius', 'density'];
  var PRESETS = [
    {id:'kanlane', name:'Kanlane', set:{theme:'default', palette:'default', accent:null, veil:'accent', glass:'normal', wash:'normal', font:'default', radius:'normal', density:'normal'}},
    {id:'aurora', name:'Aurora', set:{theme:'dark', palette:'slate', accent:'#9B4DFF', veil:'aurora', glass:'strong', wash:'strong', font:'default', radius:'round', density:'normal'}},
    {id:'medianoche', name:'Medianoche', set:{theme:'dark', palette:'cool', accent:'#0B84C6', veil:'oceano', glass:'normal', wash:'normal', font:'default', radius:'normal', density:'normal'}},
    {id:'atardecer', name:'Atardecer', set:{theme:'light', palette:'warm', accent:'#E0492D', veil:'atardecer', glass:'normal', wash:'strong', font:'default', radius:'round', density:'normal'}},
    {id:'bosque', name:'Bosque', set:{theme:'light', palette:'default', accent:'#0D8F6F', veil:'bosque', glass:'soft', wash:'normal', font:'default', radius:'normal', density:'normal'}},
    {id:'papel', name:'Papel', set:{theme:'light', palette:'warm', accent:'#B45309', veil:'accent', glass:'solid', wash:'none', font:'serif', radius:'sharp', density:'comfortable'}},
    {id:'terminal', name:'Terminal', set:{theme:'dark', palette:'slate', accent:'#0D8F6F', veil:'accent', glass:'solid', wash:'none', font:'mono', radius:'sharp', density:'compact'}},
    {id:'sobrio', name:'Sobrio', set:{theme:'default', palette:'slate', accent:null, veil:'accent', glass:'solid', wash:'none', font:'default', radius:'normal', density:'normal'}}
  ];
  /* Colores de las miniaturas (los mismos que usa la app para cada tema y paleta). */
  var ART_BG = {
    light: {'default':'#F4F5F7', warm:'#F6F2EC', cool:'#EEF3F8', slate:'#ECEEF2'},
    dark: {'default':'#0A0A0C', warm:'#0F0C0A', cool:'#080B10', slate:'#0D0E12'}
  };
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v4.5h4.5"/></svg>';

  var tr = WorkhubPlugin.translations({en:{
    'Apariencia':'Appearance',
    'Personaliza el proyecto abierto. Los cambios se aplican al momento y se guardan para la próxima vez.':'Customize the current project. Changes apply immediately and are saved for next time.',
    'Guardando…':'Saving…', 'Guardado':'Saved', 'No se pudo guardar':'Could not save', 'No se pudo guardar: {error}':'Could not save: {error}',
    'Restablecer':'Reset',
    'Temas listos':'Ready-made themes', 'Un clic cambia el color, el cristal y el fondo a la vez. Después puedes retocar cada cosa.':'One click changes color, glass and background together. You can fine-tune each part afterwards.',
    'Kanlane':'Kanlane', 'Aurora':'Aurora', 'Medianoche':'Midnight', 'Atardecer':'Sunset', 'Bosque':'Forest', 'Papel':'Paper', 'Terminal':'Terminal', 'Sobrio':'Plain',
    'Océano':'Ocean', 'Orquídea':'Orchid',
    'Color':'Color', 'El tema, el tono de las superficies y el color que destaca.':'Theme, surface tone and the highlight color.',
    'Tema':'Theme', 'Claro, oscuro o lo que tengas en Ajustes.':'Light, dark or whatever you have in Settings.',
    'Según Ajustes':'From Settings', 'Sistema':'System', 'Claro':'Light', 'Oscuro':'Dark',
    'Paleta':'Palette', 'Tono del fondo y de los paneles.':'Tone of the background and panels.',
    'Original':'Original', 'Cálida':'Warm', 'Fría':'Cool', 'Pizarra':'Slate',
    'Color de acento':'Accent color', 'Botones principales, sección activa y elementos seleccionados.':'Primary buttons, active section and selected items.',
    'Otro':'Other',
    'Cristal y fondo':'Glass and background', 'Cuánto se transparentan las barras y qué color asoma detrás.':'How see-through the bars are and what color shows behind them.',
    'Cristal':'Glass', 'Transparencia y desenfoque de la barra lateral, la barra de cada vista, los diálogos y los menús.':'Transparency and blur of the sidebar, the view bar, dialogs and menus.',
    'Sólido':'Solid', 'Suave':'Soft', 'Normal':'Normal', 'Intenso':'Strong',
    'Velo del fondo':'Background veil', 'El color difuso de las esquinas del fondo.':'The soft color in the corners of the background.',
    'Sin velo':'None',
    'Colores del velo':'Veil colors', 'Del color de acento o una pareja de colores, uno por esquina.':'The accent color, or a pair of colors, one per corner.',
    'Del acento':'From accent', 'A medida':'Custom', 'Esquina superior':'Top corner', 'Esquina inferior':'Bottom corner',
    'Disposición':'Layout', 'Dónde va la navegación y cuánto aire hay entre las cosas.':'Where navigation goes and how much room there is between things.',
    'Navegación':'Navigation', 'Dónde van las secciones en este proyecto. En pantallas pequeñas van siempre abajo.':'Where the sections go in this project. On small screens they always go at the bottom.',
    'Lateral':'Sidebar', 'Arriba':'Top',
    'Densidad':'Density', 'Espacio de las tarjetas del tablero, las listas y la barra lateral.':'Spacing of board cards, lists and the sidebar.',
    'Compacta':'Compact', 'Amplia':'Comfortable',
    'Esquinas':'Corners', 'Forma de las tarjetas, los botones y los campos.':'Shape of cards, buttons and fields.',
    'Rectas':'Sharp', 'Normales':'Normal', 'Redondeadas':'Rounded',
    'Texto':'Text', 'La letra de Kanlane y su tamaño.':'Kanlane\'s typeface and its size.',
    'Tipografía':'Typography', 'Fuente de los textos de Kanlane.':'Font used by Kanlane text.',
    'Del sistema':'System', 'Serif':'Serif', 'Monoespaciada':'Monospaced',
    'Tamaño del texto':'Text size', 'Para leer más cómodo o ver más de una vez.':'To read more comfortably or see more at once.',
    'Pequeño':'Small', 'Grande':'Large',
    'Movimiento':'Motion', 'Las transiciones al cambiar de pestaña o de tema.':'Transitions when switching tabs or theme.',
    'Animaciones':'Animations', 'Con «Reducidas» los cambios son inmediatos, sin transiciones.':'With "Reduced", changes are immediate, without transitions.',
    'Completas':'Full', 'Reducidas':'Reduced',
    'Conectando con Kanlane…':'Connecting to Kanlane…',
    'Este plugin se abre desde Kanlane (sección Plugins).':'This plugin opens from Kanlane (Plugins section).',
    'No se pudo conectar con Kanlane: {error}':'Could not connect to Kanlane: {error}'
  }});

  var app = document.getElementById('app');
  document.getElementById('status').textContent = tr('Conectando con Kanlane…');
  var wh = null;
  var look = norm({});
  var persisted = null;
  var writeVersion = 0;
  var lastState = 'saved';

  function hex(v, fallback){
    return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v.toUpperCase() : fallback;
  }
  function pick(list, v, fallback){
    return list.indexOf(v) !== -1 ? v : fallback;
  }

  /* Lo guardado puede venir de una versión anterior (sin cristal, velo ni movimiento). */
  function norm(v){
    v = v && typeof v === 'object' ? v : {};
    return {
      theme: pick(THEMES, v.theme, 'default'),
      palette: pick(PALETTES, v.palette, 'default'),
      accent: hex(v.accent, null),
      veil: v.veil === 'custom' || VEILS[v.veil] ? v.veil : 'accent',
      veilA: hex(v.veilA, '#9B4DFF'),
      veilB: hex(v.veilB, '#0EA5A4'),
      glass: pick(GLASSES, v.glass, 'normal'),
      wash: pick(WASHES, v.wash, 'normal'),
      nav: pick(NAVS, v.nav, 'default'),
      font: pick(FONTS, v.font, 'default'),
      textSize: pick(TEXT_SIZES, v.textSize, 'normal'),
      radius: pick(RADII, v.radius, 'normal'),
      density: pick(DENSITIES, v.density, 'normal'),
      motion: pick(MOTIONS, v.motion, 'normal')
    };
  }

  function veilColors(l){
    if(l.veil === 'custom') return [l.veilA, l.veilB];
    return VEILS[l.veil] || null;
  }

  function apply(){
    return wh.ui.setAppearance({
      theme: look.theme === 'default' ? null : look.theme,
      palette: look.palette,
      accent: look.accent,
      veil: veilColors(look),
      glass: look.glass,
      wash: look.wash,
      nav: look.nav === 'default' ? null : look.nav,
      font: look.font,
      textSize: look.textSize,
      radius: look.radius,
      density: look.density,
      motion: look.motion
    });
  }

  function save(focusKey){
    look = norm(look);
    var next = look;
    var version = ++writeVersion;
    lastState = 'saving';
    render(focusKey);
    wh.storage.set('look', next).then(function(){
      persisted = next;
      if(version === writeVersion) setStatus('saved');
    }).catch(function(err){
      if(version === writeVersion){ look = persisted || norm({}); lastState = 'error'; render(); }
      wh.ui.toast(tr('No se pudo guardar: {error}', {error:err.message}), {type:'error'});
    });
  }

  function statusText(state){
    return tr(state === 'saving' ? 'Guardando…' : state === 'error' ? 'No se pudo guardar' : 'Guardado');
  }

  function setStatus(state){
    lastState = state;
    var el = document.getElementById('saveStatus');
    if(el){ el.textContent = statusText(state); el.className = 'save-status' + (state === 'error' ? ' is-error' : ''); }
  }

  /* ---------- Piezas ---------- */

  function esc(s){
    return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]; });
  }

  function group(title, lead, rows){
    return '<section class="grp"><h2>' + tr(title) + '</h2><p class="lead">' + tr(lead) + '</p><div class="panel">' + rows + '</div></section>';
  }

  /* Fila «título + explicación + control». stack: el control va debajo, a todo el ancho. */
  function row(title, desc, control, stack){
    return '<div class="row' + (stack ? ' is-stack' : '') + '"><div class="row-text"><h3>' + tr(title) + '</h3><p>' + tr(desc) + '</p></div><div class="row-ctl">' + control + '</div></div>';
  }

  function seg(name, options){
    return '<div class="seg" role="radiogroup">' + options.map(function(o){
      var on = look[name] === o[0];
      return '<button type="button" role="radio" aria-checked="' + on + '" class="' + (on ? 'is-on' : '') + '" data-set="' + name + '" data-value="' + o[0] + '">' + tr(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  /* Miniatura de una ventana con el fondo, el velo, la barra y el acento de un aspecto. */
  function art(set){
    var scheme = set.theme === 'dark' ? 'dark' : 'light';
    var accent = set.accent || (scheme === 'dark' ? '#F4F4F5' : '#18181B');
    var veil = VEILS[set.veil] || [set.accent || '#71717A', set.accent || '#71717A'];
    var strength = {none:0, soft:22, normal:38, strong:60}[set.wash];
    return '<span class="art is-' + scheme + (set.glass === 'solid' ? ' is-solid' : '') + '" aria-hidden="true" style="--a-bg:' + ART_BG[scheme][set.palette] +
      ';--a-acc:' + accent + ';--a-h1:' + veil[0] + ';--a-h2:' + veil[1] + ';--a-wash:' + strength + '%"><i class="art-side"></i><i class="art-card"></i><i class="art-card"></i><i class="art-acc"></i></span>';
  }

  function presetActive(p){
    return PRESET_KEYS.every(function(k){ return look[k] === p.set[k]; });
  }

  function presets(){
    return '<div class="preset-grid">' + PRESETS.map(function(p){
      var on = presetActive(p);
      return '<button type="button" class="preset' + (on ? ' is-on' : '') + '" data-preset="' + p.id + '" aria-pressed="' + on + '">' + art(p.set) + '<span>' + tr(p.name) + '</span></button>';
    }).join('') + '</div>';
  }

  function palettes(){
    return '<div class="choice-grid">' + [['default', 'Original'], ['warm', 'Cálida'], ['cool', 'Fría'], ['slate', 'Pizarra']].map(function(o){
      var on = look.palette === o[0];
      return '<button type="button" class="choice' + (on ? ' is-on' : '') + '" data-set="palette" data-value="' + o[0] + '" aria-pressed="' + on + '"><span class="palette-sample is-' + o[0] + '"><i></i><i></i><i></i></span><span>' + tr(o[1]) + '</span></button>';
    }).join('') + '</div>';
  }

  function fonts(){
    return '<div class="choice-grid">' + [['default', 'Kanlane'], ['system', 'Del sistema'], ['serif', 'Serif'], ['mono', 'Monoespaciada']].map(function(o){
      var on = look.font === o[0];
      return '<button type="button" class="choice font-choice is-' + o[0] + (on ? ' is-on' : '') + '" data-set="font" data-value="' + o[0] + '" aria-pressed="' + on + '"><strong>Aa</strong><span>' + tr(o[1]) + '</span></button>';
    }).join('') + '</div>';
  }

  function accents(){
    var custom = look.accent && ACCENTS.indexOf(look.accent) === -1;
    return '<div class="swatches">' +
      '<button type="button" class="chip' + (look.accent ? '' : ' is-on') + '" data-accent="" aria-pressed="' + !look.accent + '">' + RESET + tr('Original') + '</button>' +
      ACCENTS.map(function(c){
        var on = look.accent === c;
        return '<button type="button" class="sw' + (on ? ' is-on' : '') + '" style="background:' + c + ';--sw:' + c + '" data-accent="' + c + '" aria-label="' + c + '" aria-pressed="' + on + '">' + (on ? CHECK : '') + '</button>';
      }).join('') +
      '<label class="custom' + (custom ? ' is-on' : '') + '">' + tr('Otro') + '<input type="color" id="customAccent" value="' + (look.accent || '#2563EB') + '"></label>' +
      '</div>';
  }

  function veils(){
    var chip = function(key, name, colors){
      var on = look.veil === key;
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-set="veil" data-value="' + key + '" aria-pressed="' + on + '">' +
        (colors ? '<span class="duo" style="--c1:' + colors[0] + ';--c2:' + colors[1] + '" aria-hidden="true"></span>' : '') + tr(name) + '</button>';
    };
    var html = '<div class="swatches">' + chip('accent', 'Del acento', null) +
      Object.keys(VEILS).map(function(k){ return chip(k, VEIL_NAMES[k], VEILS[k]); }).join('') +
      chip('custom', 'A medida', [look.veilA, look.veilB]) + '</div>';
    if(look.veil === 'custom'){
      html += '<div class="veil-custom">' +
        '<label class="custom">' + tr('Esquina superior') + '<input type="color" id="veilA" value="' + look.veilA + '"></label>' +
        '<label class="custom">' + tr('Esquina inferior') + '<input type="color" id="veilB" value="' + look.veilB + '"></label>' +
        '</div>';
    }
    return html;
  }

  function render(focusKey){
    app.innerHTML =
      '<header class="head"><div><h1>' + tr('Apariencia') + '</h1><p class="lead">' + tr('Personaliza el proyecto abierto. Los cambios se aplican al momento y se guardan para la próxima vez.') + '</p></div>' +
        '<div class="head-tools"><span class="save-status' + (lastState === 'error' ? ' is-error' : '') + '" id="saveStatus" role="status">' + statusText(lastState) + '</span>' +
        '<button type="button" class="wh-btn" id="reset">' + RESET + tr('Restablecer') + '</button></div></header>' +

      '<section class="grp"><h2>' + tr('Temas listos') + '</h2><p class="lead">' + tr('Un clic cambia el color, el cristal y el fondo a la vez. Después puedes retocar cada cosa.') + '</p>' + presets() + '</section>' +

      group('Color', 'El tema, el tono de las superficies y el color que destaca.',
        row('Tema', 'Claro, oscuro o lo que tengas en Ajustes.', seg('theme', [['default', 'Según Ajustes'], ['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']])) +
        row('Paleta', 'Tono del fondo y de los paneles.', palettes(), true) +
        row('Color de acento', 'Botones principales, sección activa y elementos seleccionados.', accents(), true)) +

      group('Cristal y fondo', 'Cuánto se transparentan las barras y qué color asoma detrás.',
        row('Cristal', 'Transparencia y desenfoque de la barra lateral, la barra de cada vista, los diálogos y los menús.', seg('glass', [['solid', 'Sólido'], ['soft', 'Suave'], ['normal', 'Normal'], ['strong', 'Intenso']])) +
        row('Velo del fondo', 'El color difuso de las esquinas del fondo.', seg('wash', [['none', 'Sin velo'], ['soft', 'Suave'], ['normal', 'Normal'], ['strong', 'Intenso']])) +
        row('Colores del velo', 'Del color de acento o una pareja de colores, uno por esquina.', veils(), true)) +

      group('Disposición', 'Dónde va la navegación y cuánto aire hay entre las cosas.',
        row('Navegación', 'Dónde van las secciones en este proyecto. En pantallas pequeñas van siempre abajo.', seg('nav', [['default', 'Según Ajustes'], ['side', 'Lateral'], ['top', 'Arriba']])) +
        row('Densidad', 'Espacio de las tarjetas del tablero, las listas y la barra lateral.', seg('density', [['compact', 'Compacta'], ['normal', 'Normal'], ['comfortable', 'Amplia']])) +
        row('Esquinas', 'Forma de las tarjetas, los botones y los campos.', seg('radius', [['sharp', 'Rectas'], ['normal', 'Normales'], ['round', 'Redondeadas']]))) +

      group('Texto', 'La letra de Kanlane y su tamaño.',
        row('Tipografía', 'Fuente de los textos de Kanlane.', fonts(), true) +
        row('Tamaño del texto', 'Para leer más cómodo o ver más de una vez.', seg('textSize', [['small', 'Pequeño'], ['normal', 'Normal'], ['large', 'Grande']]))) +

      group('Movimiento', 'Las transiciones al cambiar de pestaña o de tema.',
        row('Animaciones', 'Con «Reducidas» los cambios son inmediatos, sin transiciones.', seg('motion', [['normal', 'Completas'], ['reduced', 'Reducidas']])));

    each('[data-preset]', function(b){
      b.onclick = function(){
        var p = PRESETS.filter(function(x){ return x.id === b.getAttribute('data-preset'); })[0];
        PRESET_KEYS.forEach(function(k){ look[k] = p.set[k]; });
        save('[data-preset="' + p.id + '"]');
      };
    });
    each('[data-accent]', function(b){
      b.onclick = function(){ look.accent = b.getAttribute('data-accent') || null; save('[data-accent="' + (look.accent || '') + '"]'); };
    });
    each('[data-set]', function(b){
      b.onclick = function(){
        var name = b.getAttribute('data-set'), value = b.getAttribute('data-value');
        look[name] = value;
        save('[data-set="' + name + '"][data-value="' + value + '"]');
      };
    });
    document.getElementById('customAccent').onchange = function(ev){ look.accent = ev.target.value.toUpperCase(); save('#customAccent'); };
    ['veilA', 'veilB'].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.onchange = function(ev){ look[id] = ev.target.value.toUpperCase(); save('#' + id); };
    });
    document.getElementById('reset').onclick = function(){ look = norm({}); save('#reset'); };
    /* Al repintar se conserva el foco en el control que se acaba de usar (teclado). */
    if(focusKey){
      var again = document.querySelector(focusKey);
      if(again) again.focus({preventScroll:true});
    }
  }

  function each(selector, fn){
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
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
