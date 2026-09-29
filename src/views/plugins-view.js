/* Plugins: instalados, catálogo oficial, añadir por enlace, el plugin abierto
   (su marco ocupa el área de contenido) y el diálogo de instalación/permisos. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const PERMISSIONS = Workhub.services.pluginHost.PERMISSIONS;
  const $ = (id) => document.getElementById(id);
  const svg = (d) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const PUZZLE = svg('<path d="M19.4 11H18V7a1 1 0 0 0-1-1h-4V4.6a2.1 2.1 0 1 0-4 0V6H5a1 1 0 0 0-1 1v3.6h1.4a2.1 2.1 0 1 1 0 4H4V19a1 1 0 0 0 1 1h3.6v-1.4a2.1 2.1 0 1 1 4 0V20H17a1 1 0 0 0 1-1v-4h1.4a2.1 2.1 0 1 0 0-4Z"/>');
  const CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
  const SHIELD = svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>');

  function hostOf(url){
    try{
      const u = new URL(url, location.href);
      return u.protocol === 'file:' || u.origin === location.origin ? '' : u.host;
    }catch(e){ return ''; }
  }

  function markHtml(m, cls){
    return '<span class="plugin-mark' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + (m.icon ? esc(m.icon) : PUZZLE) + '</span>';
  }

  class PluginsView {
    constructor(){
      this.home = $('pluginsHome');
      this.installed = $('pluginsInstalled');
      this.official = $('pluginsOfficial');
      this.installedEmpty = $('pluginsInstalledEmpty');
      this.form = $('formPluginUrl');
      this.urlInput = $('pluginUrl');
      this.formBtn = this.form.querySelector('button[type=submit]');
      this.formMsg = $('pluginUrlMsg');
      this.stage = $('pluginStage');
      this.stageMark = $('pluginStageMark');
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

    /* handlers: {open(id), manage(id), install(officialIndex)} */
    bindCards(handlers){
      const onClick = (ev) => {
        const btn = closest(ev.target, '[data-plugin-action]');
        if(!btn) return;
        const id = btn.getAttribute('data-id');
        switch(btn.getAttribute('data-plugin-action')){
          case 'open': handlers.open(id); break;
          case 'manage': handlers.manage(id); break;
          case 'install': handlers.install(+btn.getAttribute('data-index')); break;
        }
      };
      this.installed.addEventListener('click', onClick);
      this.official.addEventListener('click', onClick);
    }

    /* handlers: {back(), manage(), review()} */
    bindStage(handlers){
      $('btnPluginBack').addEventListener('click', handlers.back);
      $('btnPluginManage').addEventListener('click', handlers.manage);
      this.notice.addEventListener('click', (ev) => {
        if(closest(ev.target, '[data-review]')) handlers.review();
      });
    }

    /* handlers: {confirm(), remove()} (según el modo del diálogo) */
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
      this.formBtn.disabled = busy;
      this.urlInput.disabled = busy;
      this.formBtn.textContent = busy ? 'Comprobando…' : 'Añadir';
      this.formMsg.hidden = !msg;
      this.formMsg.textContent = msg || '';
      this.formMsg.classList.toggle('is-error', !!isError);
    }

    clearUrl(){ this.urlInput.value = ''; }

    /* installed: [{id, url, manifest, official}], official: [{url, manifest, installed}] */
    render(installed, official){
      this.installedEmpty.hidden = installed.length > 0;
      this.installed.hidden = !installed.length;
      this.installed.innerHTML = installed.map((p) => {
        const m = p.manifest || {};
        const host = hostOf(p.url);
        const badge = p.official
          ? '<span class="plugin-badge is-official">' + CHECK + 'Oficial</span>'
          : '<span class="plugin-badge" title="' + esc(p.url) + '">' + esc(host || 'De terceros') + '</span>';
        return '<article class="plugin-card">' +
          '<div class="plugin-card-head">' + markHtml(m) +
          '<div class="plugin-card-title"><h3>' + esc(m.name) + '</h3><p>' + esc(m.author || 'Autor desconocido') + ' · v' + esc(m.version) + '</p></div>' + badge + '</div>' +
          '<p class="plugin-desc">' + esc(m.description || 'Sin descripción.') + '</p>' +
          '<div class="plugin-card-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-plugin-action="manage" data-id="' + esc(p.id) + '">Permisos</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-plugin-action="open" data-id="' + esc(p.id) + '">Abrir</button>' +
          '</div></article>';
      }).join('');

      this.official.innerHTML = official.map((o, i) => {
        const m = o.manifest;
        return '<article class="plugin-card">' +
          '<div class="plugin-card-head">' + markHtml(m) +
          '<div class="plugin-card-title"><h3>' + esc(m.name) + '</h3><p>' + esc(m.author) + ' · v' + esc(m.version) + '</p></div>' +
          '<span class="plugin-badge is-official">' + CHECK + 'Oficial</span></div>' +
          '<p class="plugin-desc">' + esc(m.description) + '</p>' +
          '<div class="plugin-card-actions">' +
          (this.fileMode ? '' : o.installed
            ? '<button type="button" class="btn btn-ghost btn-sm" data-plugin-action="open" data-id="' + esc(m.id) + '">Instalado · Abrir</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-plugin-action="install" data-index="' + i + '">Instalar</button>') +
          '</div></article>';
      }).join('');
    }

    /* ---------- Plugin abierto ---------- */

    showHome(){
      this.stage.hidden = true;
      this.home.hidden = false;
    }

    showStage(plugin){
      const m = plugin.manifest || {};
      this.home.hidden = true;
      this.stage.hidden = false;
      this.stageMark.innerHTML = m.icon ? esc(m.icon) : PUZZLE;
      this.stageName.textContent = m.name;
      const host = hostOf(plugin.url);
      this.stageMeta.textContent = plugin.official ? 'Plugin oficial' : (host ? 'De ' + host : 'De terceros');
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

    /* ---------- Diálogo ---------- */

    /* mode: 'install' (instalar), 'review' (aceptar permisos nuevos) o 'manage'.
       info: {manifest, url, official, granted?, extra?} */
    openDialog(mode, info){
      const m = info.manifest;
      const host = hostOf(info.url);
      const perms = mode === 'manage' ? (info.granted || []) : (mode === 'review' ? info.extra : m.permissions);
      this.dlgTitle.textContent = mode === 'install' ? 'Instalar plugin' : mode === 'review' ? 'Permisos nuevos' : 'Permisos del plugin';
      this.dlgBody.innerHTML =
        '<div class="plugin-dlg-head">' + markHtml(m, 'is-lg') +
        '<div><h3>' + esc(m.name) + '</h3><p>' + esc(m.author || 'Autor desconocido') + ' · v' + esc(m.version) + '</p></div></div>' +
        (m.description ? '<p class="plugin-desc">' + esc(m.description) + '</p>' : '') +
        '<div class="plugin-source">' + (info.official ? CHECK + '<span>Plugin oficial de Workhub</span>' : SHIELD + '<span>Origen: <strong>' + esc(host || info.url) + '</strong></span>') + '</div>' +
        '<h4 class="plugin-perms-title">' + (mode === 'install' ? 'Podrá:' : mode === 'review' ? 'Esta versión pide además:' : 'Tiene permiso para:') + '</h4>' +
        (perms.length
          ? '<ul class="plugin-perms">' + perms.map((p) => '<li>' + CHECK + '<span>' + esc(PERMISSIONS[p] || p) + '</span></li>').join('') + '</ul>'
          : '<p class="plugin-desc">Ningún permiso: no puede leer ni cambiar tus datos.</p>') +
        '<p class="plugin-safe">Los plugins se ejecutan aislados: nunca pueden ver tus contraseñas guardadas ni tu sesión.' +
        (info.official ? '' : ' <strong>Instala solo plugins de personas en las que confíes.</strong>') + '</p>';
      this.dlgConfirm.hidden = mode === 'manage';
      this.dlgConfirm.textContent = mode === 'install' ? 'Instalar' : 'Permitir';
      this.dlgConfirm.disabled = false;
      this.dlgRemove.hidden = mode !== 'manage';
      this.dlgRemove.disabled = false;
      this.pendingRemove = false;
      this.dlgRemove.textContent = 'Quitar plugin';
      this.dlgCancel.textContent = mode === 'manage' ? 'Cerrar' : 'Cancelar';
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

  PluginsView.markHtml = markHtml;
  Workhub.views.PluginsView = PluginsView;
})();
