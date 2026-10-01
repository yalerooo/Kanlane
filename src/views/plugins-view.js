/* Plugins: instalados, catálogo oficial, añadir por enlace, el plugin abierto
   (su marco ocupa el área de contenido) y la ficha de cada plugin (instalar,
   aprobar permisos nuevos o ver detalles). */
(function(){
  const {esc, closest, hueFor} = Workhub.utils.html;
  const pluginHost = Workhub.services.pluginHost;
  const icons = Workhub.views.pluginIcons;
  const $ = (id) => document.getElementById(id);
  const svg = (d, size) => '<svg viewBox="0 0 24 24" width="' + (size || 14) + '" height="' + (size || 14) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const VERIFIED = '<svg class="plugin-verified" viewBox="0 0 24 24" width="15" height="15" aria-label="Oficial" role="img"><path fill="currentColor" d="M12 1.5l2.4 1.8 3-.1 1 2.8 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-1 2.8-3-.1L12 20.5l-2.4-1.8-3 .1-1-2.8L3.1 14.3l.9-2.9-.9-2.9L5.6 6.8l1-2.8 3 .1Z"/><path d="M8.5 11.8l2.3 2.3 4.7-4.7" fill="none" stroke="var(--accent-ink, #fff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SHIELD = svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/>', 16);
  const EXTERNAL = svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>', 13);
  const LINK = svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 16);

  function hostOf(url){
    try{
      const u = new URL(url, location.href);
      return u.protocol === 'file:' || u.origin === location.origin ? '' : u.host;
    }catch(e){ return ''; }
  }

  function hueOf(m){
    return typeof m.color === 'number' ? m.color : hueFor(m.id || m.name || '');
  }

  /* Icono del plugin sobre un degradado de su color. */
  function tileHtml(m, cls, size){
    return '<span class="plugin-tile' + (cls ? ' ' + cls : '') + '" style="--h:' + hueOf(m) + '" aria-hidden="true">' + icons.svg(m.icon, size) + '</span>';
  }

  function sourceText(url, official){
    if(official) return 'Oficial de Workhub';
    return hostOf(url) || 'De terceros';
  }

  function dateText(ms){
    if(!ms) return '';
    return new Date(ms).toLocaleDateString(Workhub.i18n.locale, {day:'numeric', month:'long', year:'numeric'});
  }

  class PluginsView {
    constructor(){
      this.home = $('pluginsHome');
      this.installed = $('pluginsInstalled');
      this.official = $('pluginsOfficial');
      this.installedEmpty = $('pluginsInstalledEmpty');
      this.installedCount = $('pluginsInstalledCount');
      this.form = $('formPluginUrl');
      this.readonlyNotice = $('pluginsReadonlyNotice');
      this.urlInput = $('pluginUrl');
      this.formBtn = this.form.querySelector('button[type=submit]');
      this.formMsg = $('pluginUrlMsg');
      this.stage = $('pluginStage');
      this.stageTile = $('pluginStageTile');
      this.stageName = $('pluginStageName');
      this.stageMeta = $('pluginStageMeta');
      this.notice = $('pluginNotice');
      this.frameWrap = $('pluginFrameWrap');
      this.probeArea = $('pluginProbeArea');

      this.dlg = $('dlgPlugin');
      this.dlgBody = $('pluginDlgBody');
      this.dlgTitle = $('pluginDlgTitle');
      this.dlgConfirm = $('btnPluginConfirm');
      this.dlgRemove = $('btnPluginRemove');
      this.dlgCancel = $('btnPluginCancel');
      this.dlgCancel.addEventListener('click', () => this.closeDialog());
      this.pendingRemove = false;

      window.addEventListener('resize', () => this.fitStage());

      /* Abierto como archivo (file://): los marcos aislados no pueden cargar
         nada del disco, así que los plugins no pueden funcionar. */
      if(location.protocol === 'file:'){
        $('pluginsFileNotice').hidden = false;
        this.urlInput.disabled = true;
        this.formBtn.disabled = true;
        this.fileMode = true;
      }
    }

    /* ---------- Eventos ---------- */

    bindAddUrl(handler){
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const url = this.urlInput.value.trim();
        if(url) handler(url);
      });
    }

    /* handlers: {open(id), details(id), install(officialIndex), officialDetails(officialIndex)} */
    bindCards(handlers){
      const onClick = (ev) => {
        const btn = closest(ev.target, '[data-plugin-action]');
        const card = closest(ev.target, '.plugin-card');
        if(!btn && !card) return;
        const el = btn || card;
        const id = el.getAttribute('data-id');
        const index = +el.getAttribute('data-index');
        switch(el.getAttribute('data-plugin-action')){
          case 'open': handlers.open(id); break;
          case 'details': handlers.details(id); break;
          case 'install': handlers.install(index); break;
          case 'official-details': handlers.officialDetails(index); break;
        }
      };
      this.installed.addEventListener('click', onClick);
      this.official.addEventListener('click', onClick);
      const onKey = (ev) => {
        const card = ev.target.classList && ev.target.classList.contains('plugin-card') ? ev.target : null;
        if(card && (ev.key === 'Enter' || ev.key === ' ')){ ev.preventDefault(); onClick({target:card}); }
      };
      this.installed.addEventListener('keydown', onKey);
      this.official.addEventListener('keydown', onKey);
    }

    /* handlers: {back(), details(), review()} */
    bindStage(handlers){
      $('btnPluginBack').addEventListener('click', handlers.back);
      $('btnPluginManage').addEventListener('click', handlers.details);
      this.notice.addEventListener('click', (ev) => {
        if(closest(ev.target, '[data-review]')) handlers.review();
      });
    }

    /* handlers: {confirm(), remove()} (según el modo de la ficha) */
    bindDialog(handlers){
      this.dlgConfirm.addEventListener('click', () => handlers.confirm());
      this.dlgRemove.addEventListener('click', () => {
        if(!this.pendingRemove){
          this.pendingRemove = true;
          this.dlgRemove.textContent = 'Sí, quitar y borrar sus datos';
          return;
        }
        handlers.remove();
      });
    }

    /* ---------- Lista ---------- */

    setAdding(busy, msg, isError){
      this.formBtn.disabled = busy || this.fileMode;
      this.urlInput.disabled = busy || this.fileMode;
      this.formBtn.textContent = busy ? 'Comprobando…' : 'Añadir';
      this.formMsg.hidden = !msg;
      this.formMsg.textContent = msg || '';
      this.formMsg.classList.toggle('is-error', !!isError);
    }

    clearUrl(){ this.urlInput.value = ''; }

    _card(m, opts){
      const official = opts.official;
      const perms = (m.permissions || []).map((p) => (pluginHost.PERMISSION_INFO[p] || {short:p}).short);
      const meta = [m.author || 'Autor desconocido', 'v' + (m.version || '1.0.0'), official ? '' : sourceText(opts.url, false)].filter(Boolean).join(' · ');
      return '<article class="plugin-card" tabindex="' + (opts.cardAction ? '0' : '-1') + '" style="--h:' + hueOf(m) + '" data-plugin-action="' + opts.cardAction + '" ' + opts.dataAttr + (opts.cardAction ? ' aria-label="' + esc(m.name) + ': ver detalles"' : '') + '>' +
        '<div class="plugin-card-head">' + tileHtml(m, '', 17) +
          '<div class="plugin-card-title"><h3><span>' + esc(m.name) + '</span>' + (official ? VERIFIED : '') + '</h3>' +
          '<p>' + esc(meta) + '</p></div>' +
          (opts.actions ? '<div class="plugin-card-actions">' + opts.actions + '</div>' : '') +
        '</div>' +
        '<p class="plugin-desc">' + esc(m.description || 'Sin descripción.') + '</p>' +
        '<p class="plugin-perm-line">' + (perms.length ? esc(perms.join(' · ')) : 'Sin acceso a tus datos') + '</p>' +
        '</article>';
    }

    /* installed: [{id, url, manifest, official}], official: [{url, manifest, installed}] */
    render(installed, official, canManage){
      const editable = canManage !== false;
      this.form.hidden = !editable;
      this.readonlyNotice.hidden = editable;
      this.installedEmpty.hidden = installed.length > 0;
      this.installed.hidden = !installed.length;
      this.installedCount.textContent = installed.length ? String(installed.length) : '';
      this.installed.innerHTML = installed.map((p) => this._card(p.manifest || {}, {
        official: p.official,
        url: p.url,
        cardAction: 'details',
        dataAttr: 'data-id="' + esc(p.id) + '"',
        actions: this.fileMode ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-plugin-action="open" data-id="' + esc(p.id) + '">Abrir</button>'
      })).join('');

      this.official.innerHTML = official.map((o, i) => this._card(o.manifest, {
        official: true,
        url: o.url,
        cardAction: o.installed ? 'details' : (editable ? 'official-details' : ''),
        dataAttr: o.installed ? 'data-id="' + esc(o.manifest.id) + '"' : 'data-index="' + i + '"',
        actions: this.fileMode || !editable ? '' : o.installed
          ? '<span class="plugin-installed">Instalado</span>'
          : '<button type="button" class="btn btn-ghost btn-sm" data-plugin-action="install" data-index="' + i + '">Instalar</button>'
      })).join('');
    }

    /* ---------- Plugin abierto ---------- */

    showHome(){
      this.stage.hidden = true;
      this.home.hidden = false;
      this.syncOpenClass();
    }

    /* body.plugin-open: hay un plugin abierto y se está viendo (oculta la cabecera de la sección). */
    syncOpenClass(){
      document.body.classList.toggle('plugin-open', !this.stage.hidden && !document.getElementById('viewPlugins').hidden);
    }

    showStage(plugin){
      const m = plugin.manifest || {};
      this.home.hidden = true;
      this.stage.hidden = false;
      this.syncOpenClass();
      this.stageTile.outerHTML = tileHtml(m, 'is-sm', 16).replace('<span class="plugin-tile', '<span id="pluginStageTile" class="plugin-tile');
      this.stageTile = $('pluginStageTile');
      this.stageName.innerHTML = esc(m.name) + (plugin.official ? VERIFIED : '');
      this.stageMeta.textContent = (m.author ? m.author + ' · ' : '') + sourceText(plugin.url, plugin.official);
      this.setNotice(null);
      this.fitStage();
    }

    setNotice(html){
      this.notice.hidden = !html;
      this.notice.innerHTML = html || '';
      this.fitStage();
    }

    /* El marco ocupa hasta el final de la ventana, como el tablero. */
    fitStage(){
      if(this.stage.hidden || !this.stage.offsetParent) return;
      const top = this.frameWrap.getBoundingClientRect().top + window.scrollY;
      const main = this.stage.closest('.main');
      const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      this.frameWrap.style.setProperty('--stage-top', Math.round(top + bottom) + 'px');
    }

    /* ---------- Ficha del plugin ---------- */

    /* mode: 'install' (instalar), 'review' (aprobar permisos nuevos) o
       'details' (instalado). info: {manifest, url, official, granted?,
       extra?, installedAt?} */
    openDialog(mode, info){
      const m = info.manifest;
      const perms = mode === 'details' ? (info.granted || []) : (mode === 'review' ? info.extra : m.permissions);
      const host = hostOf(info.url);
      const homepage = Workhub.utils.urls.safeUrl(m.homepage || '');
      this.dlg.style.setProperty('--h', hueOf(m));
      this.dlgTitle.textContent = mode === 'install' ? 'Instalar plugin' : mode === 'review' ? 'Permisos nuevos' : 'Detalles del plugin';

      const facts = [
        ['Versión', esc(m.version || '1.0.0')],
        ['Autor', esc(m.author || 'Desconocido')],
        ['Origen', info.official ? 'Oficial de Workhub' : '<span class="plugin-mono">' + esc(host || info.url) + '</span>']
      ];
      if(mode === 'details' && info.installedAt) facts.push(['Instalado', esc(dateText(info.installedAt))]);
      facts.push(['Identificador', '<span class="plugin-mono">' + esc(m.id) + '</span>']);

      const permTitle = mode === 'install' ? 'Qué podrá hacer' : mode === 'review' ? 'Esta versión pide además' : 'Permisos concedidos';
      this.dlgBody.innerHTML =
        '<div class="plugin-hero">' + tileHtml(m, 'is-lg', 28) +
          '<div class="plugin-hero-text"><h3><span>' + esc(m.name) + '</span>' + (info.official ? VERIFIED : '') + '</h3>' +
          '<p>' + esc(m.author || 'Autor desconocido') + ' · v' + esc(m.version || '1.0.0') + '</p>' +
          (homepage ? '<a class="plugin-home" href="' + esc(homepage) + '" target="_blank" rel="noopener noreferrer">' + EXTERNAL + 'Web del plugin</a>' : '') +
          '</div></div>' +
        (m.description ? '<p class="plugin-lead">' + esc(m.description) + '</p>' : '') +
        '<section class="plugin-section"><h4>' + permTitle + '</h4>' +
          (perms.length
            ? '<ul class="plugin-perms">' + perms.map((p) => {
                const info2 = pluginHost.PERMISSION_INFO[p] || {short:p, icon:'puzzle'};
                return '<li><span class="plugin-perm-icon">' + icons.svg(info2.icon, 15) + '</span><div><strong>' + esc(info2.short) + '</strong><span>' + esc(pluginHost.PERMISSIONS[p] || p) + '</span></div></li>';
              }).join('') + '</ul>'
            : '<p class="plugin-none">Ningún permiso: no puede leer ni cambiar tus datos.</p>') +
        '</section>' +
        '<section class="plugin-section"><h4>Información</h4><dl class="plugin-facts">' +
          facts.map((f) => '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>').join('') +
        '</dl></section>' +
        '<div class="plugin-safe' + (info.official ? '' : ' is-third') + '">' + SHIELD +
          '<p>Se ejecuta aislado: nunca puede ver tus contraseñas guardadas ni tu sesión, y solo accede a lo que le permitas.' +
          (info.official ? '' : ' <strong>Instala solo plugins de personas en las que confíes.</strong>') + '</p></div>';

      this.mode = mode;
      this.dlgConfirm.hidden = this.fileMode && mode === 'details';
      this.dlgConfirm.textContent = mode === 'install' ? 'Instalar' : mode === 'review' ? 'Permitir' : 'Abrir';
      this.dlgConfirm.disabled = false;
      this.dlgRemove.hidden = mode !== 'details' || !Workhub.views.team.canEdit();
      this.dlgRemove.disabled = false;
      this.pendingRemove = false;
      this.dlgRemove.textContent = 'Quitar plugin';
      this.dlgCancel.textContent = mode === 'details' ? 'Cerrar' : 'Cancelar';
      this.dlg.showModal();
    }

    setDialogBusy(busy){
      this.dlgConfirm.disabled = busy;
      this.dlgRemove.disabled = busy;
    }

    closeDialog(){
      if(this.dlg.open) this.dlg.close();
    }
  }

  PluginsView.tileHtml = tileHtml;
  PluginsView.LINK_ICON = LINK;
  Workhub.views.PluginsView = PluginsView;
})();
