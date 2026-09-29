/* Plugin oficial "Apariencia": personaliza el aspecto de Workhub.
   Permisos: appearance, storage.
   - En segundo plano: aplica la apariencia guardada al abrir Workhub.
   - En el panel: elegir color, esquinas y densidad (con vista previa).
   Se guarda en storage.user ('look'), igual en todos los proyectos. */
(function(){
  var MANIFEST = {
    id: 'workhub.apariencia',
    name: 'Apariencia',
    version: '1.0.0',
    description: 'Personaliza Workhub: cualquier color de acento, esquinas rectas o redondeadas y una densidad compacta o amplia.',
    author: 'Workhub',
    icon: 'sparkles',
    color: 328,
    permissions: ['appearance', 'storage']
  };
  var PRESETS = ['#2F6BFF', '#6D5DFC', '#9B4DFF', '#E0457B', '#E5484D', '#EA6A1F', '#E6A310', '#16A36A', '#0EA5A4', '#0B84C6', '#475569', '#18181B'];
  var RADIUS = {sharp:{sm:2, md:3, lg:4, xl:6}, normal:{sm:5, md:7, lg:10, xl:12}, round:{sm:7, md:10, lg:14, xl:18}};
  var DENSITY = {compact:{pad:'7px 10px', gap:'4px'}, normal:{pad:'10px 12px', gap:'6px'}, comfortable:{pad:'14px 15px', gap:'10px'}};
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  var tr = WorkhubPlugin.translations({en:{
    'No se pudo guardar: {error}':'Could not save: {error}', 'Apariencia':'Appearance',
    'Los cambios se aplican al momento en todo Workhub y en todos tus proyectos. Mientras este plugin esté instalado, su color manda sobre el elegido en Ajustes.':'Changes apply instantly across Workhub and all your projects. While this plugin is installed, its color overrides the one chosen in Settings.',
    'Color de acento':'Accent color', 'Botones principales, sección activa y elementos seleccionados.':'Primary buttons, active section and selected items.',
    'El de Ajustes':'From Settings', 'Otro':'Other', 'Esquinas':'Corners', 'Forma de tarjetas, botones y campos.':'Shape of cards, buttons and fields.',
    'Rectas':'Sharp', 'Normales':'Normal', 'Redondeadas':'Rounded', 'Densidad':'Density',
    'Espacio de las tarjetas del tablero, listas y barra lateral.':'Spacing of board cards, lists and sidebar.',
    'Compacta':'Compact', 'Normal':'Normal', 'Amplia':'Comfortable',
    'Para volver al aspecto original, restablece o quita el plugin.':'To go back to the original look, reset or remove the plugin.',
    'Restablecer':'Reset', 'Vista previa':'Preview', 'Cliente':'Client', 'Otro cliente':'Another client',
    'Preparar propuesta':'Prepare proposal', 'Revisar contrato':'Review contract', 'Nueva tarea':'New task',
    'Conectando con Workhub…':'Connecting to Workhub…',
    'Este plugin se abre desde Workhub (sección Plugins).':'This plugin opens from Workhub (Plugins section).',
    'No se pudo conectar con Workhub: {error}':'Could not connect to Workhub: {error}'
  }});

  var app = document.getElementById('app');
  document.getElementById('status').textContent = tr('Conectando con Workhub…');
  var wh = null;
  var look = {accent:null, radius:'normal', density:'normal'};

  function norm(v){
    v = v && typeof v === 'object' ? v : {};
    return {
      accent: /^#[0-9a-fA-F]{6}$/.test(v.accent || '') ? v.accent.toUpperCase() : null,
      radius: RADIUS[v.radius] ? v.radius : 'normal',
      density: DENSITY[v.density] ? v.density : 'normal'
    };
  }

  function apply(){
    return wh.ui.setAppearance({accent:look.accent, radius:look.radius, density:look.density});
  }

  function save(){
    render();
    wh.storage.user.set('look', look).catch(function(err){ wh.ui.toast(tr('No se pudo guardar: {error}', {error:err.message}), {type:'error'}); });
  }

  function seg(name, options){
    return '<div class="seg" role="radiogroup">' + options.map(function(o){
      return '<button type="button" role="radio" aria-checked="' + (look[name] === o[0]) + '" class="' + (look[name] === o[0] ? 'is-on' : '') + '" data-set="' + name + '" data-value="' + o[0] + '">' + tr(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function render(){
    var r = RADIUS[look.radius], d = DENSITY[look.density];
    var pv = '--pv-sm:' + r.sm + 'px;--pv-md:' + r.md + 'px;--pv-lg:' + r.lg + 'px;--pv-xl:' + r.xl + 'px;--pv-pad:' + d.pad + ';--pv-gap:' + d.gap + ';' + (look.accent ? '--pv-accent:' + look.accent + ';' : '');
    app.innerHTML =
      '<h1>' + tr('Apariencia') + '</h1><p class="wh-muted">' + tr('Los cambios se aplican al momento en todo Workhub y en todos tus proyectos. Mientras este plugin esté instalado, su color manda sobre el elegido en Ajustes.') + '</p>' +
      '<div class="layout"><div>' +
        '<div class="group"><h2>' + tr('Color de acento') + '</h2><p>' + tr('Botones principales, sección activa y elementos seleccionados.') + '</p><div class="swatches">' +
          '<button type="button" class="sw-default' + (look.accent ? '' : ' is-on') + '" data-accent="">' + tr('El de Ajustes') + '</button>' +
          PRESETS.map(function(c){ return '<button type="button" class="sw' + (look.accent === c ? ' is-on' : '') + '" style="background:' + c + ';--sw:' + c + '" data-accent="' + c + '" aria-label="' + c + '">' + (look.accent === c ? CHECK : '') + '</button>'; }).join('') +
          '<label class="custom">' + tr('Otro') + '<input type="color" id="custom" value="' + (look.accent || '#2F6BFF') + '"></label>' +
        '</div></div>' +
        '<div class="group"><h2>' + tr('Esquinas') + '</h2><p>' + tr('Forma de tarjetas, botones y campos.') + '</p>' + seg('radius', [['sharp', 'Rectas'], ['normal', 'Normales'], ['round', 'Redondeadas']]) + '</div>' +
        '<div class="group"><h2>' + tr('Densidad') + '</h2><p>' + tr('Espacio de las tarjetas del tablero, listas y barra lateral.') + '</p>' + seg('density', [['compact', 'Compacta'], ['normal', 'Normal'], ['comfortable', 'Amplia']]) + '</div>' +
        '<div class="foot"><span class="wh-muted">' + tr('Para volver al aspecto original, restablece o quita el plugin.') + '</span><button type="button" class="wh-btn" id="reset">' + tr('Restablecer') + '</button></div>' +
      '</div>' +
      '<div class="preview"><h2>' + tr('Vista previa') + '</h2><div class="pv-col" style="' + pv + '">' +
        '<div class="pv-card"><span class="pv-chip">' + tr('Cliente') + '</span><b>' + tr('Preparar propuesta') + '</b></div>' +
        '<div class="pv-card"><span class="pv-chip">' + tr('Otro cliente') + '</span><b>' + tr('Revisar contrato') + '</b></div>' +
        '<button class="pv-btn" type="button" tabindex="-1">' + tr('Nueva tarea') + '</button>' +
      '</div></div></div>';

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
    return wh.storage.user.get('look');
  }).then(function(saved){
    look = norm(saved);
    if(wh.isBackground){
      apply();
      /* El panel guardó cambios: aplicarlos. */
      wh.on('storage', function(ev){
        if(ev.scope === 'user') wh.storage.user.get('look').then(function(v){ look = norm(v); apply(); });
      });
    } else {
      render();
    }
  }).catch(function(err){
    document.getElementById('status').textContent = err.message === 'not-in-workhub'
      ? tr('Este plugin se abre desde Workhub (sección Plugins).')
      : tr('No se pudo conectar con Workhub: {error}', {error:err.message});
  });
})();
