/* Estructura general: barra lateral, cabecera de página y cambio de sección. */
(function(){
  const PAGE_INFO = {
    tasks: ['Tareas', 'Organiza el trabajo de cada cliente por estado. Arrastra las tarjetas para moverlas entre columnas.'],
    calendar: ['Calendario', 'Fechas límite de las tareas y reuniones programadas con cada cliente.'],
    vault: ['Contraseñas', 'Credenciales cifradas en tu navegador con tu contraseña maestra.'],
    clients: ['Clientes y contactos', 'Cada cliente con sus personas de contacto. Busca por cliente, nombre, email o teléfono.'],
    plugins: ['Plugins', 'Amplía Kanlane con plugins oficiales o de terceros. Cada uno se ejecuta aislado y solo accede a lo que le permitas.'],
    data: ['Copia de seguridad', 'Exporta los datos del proyecto abierto a un archivo o restáuralos desde una copia.'],
    settings: ['Ajustes', 'Personaliza el aspecto de Kanlane.']
  };

  /* Textos de los proyectos sin clientes. */
  const PAGE_INFO_NO_CLIENTS = {
    tasks: ['Tareas', 'Organiza las tareas por etapa. Arrastra las tarjetas para moverlas entre columnas.'],
    calendar: ['Calendario', 'Fechas límite de las tareas y reuniones programadas.']
  };

  const SECTION_IDS = {
    tasks: 'viewTasks',
    calendar: 'viewCalendar',
    vault: 'viewVault',
    clients: 'viewClients',
    plugins: 'viewPlugins',
    data: 'viewData',
    settings: 'viewSettings'
  };

  /* Cómo se presenta cada modo de almacenamiento (barra lateral y Ajustes). */
  Workhub.views.storageInfo = function(mode){
    /* Sin conexión, los datos que se ven son la copia guardada en este dispositivo
       (Firestore los guarda en el navegador); lo que se cambie se envía al volver. */
    if(mode === 'firebase' && typeof navigator !== 'undefined' && navigator.onLine === false) return {mode:'offline', side:'Sin conexión', title:'Sin conexión',
      desc:'Estás viendo la copia guardada en este dispositivo. Los cambios se enviarán a la nube cuando vuelvas a tener conexión.',
      hint:'Sin conexión: se muestra la copia guardada en este dispositivo y los cambios se enviarán al volver.'};
    if(mode === 'firebase') return {mode:'firebase', side:'En la nube', title:'En la nube',
      desc:'Tus datos se sincronizan entre todos tus dispositivos.', hint:'Tus datos están en la nube y se sincronizan entre tus dispositivos.'};
    if(mode === 'local') return {mode:'local', side:'Modo local', title:'En este navegador',
      desc:'Los datos no salen de este dispositivo. Haz copias de seguridad de vez en cuando.', hint:'Tus datos se guardan solo en este navegador.'};
    return {mode:'claude', side:'Sincronizado', title:'En tu espacio de Claude',
      desc:'Se sincroniza con tu cuenta de Claude.', hint:'Tus datos se sincronizan con tu espacio de Claude.'};
  };

  class ShellView {
    constructor(){
      this.nav = document.querySelector('.tabs');
      this.tabs = Array.from(this.nav.querySelectorAll('.tab[data-view]'));
      this.pluginNav = document.getElementById('pluginNav');
      this.pluginNavToggle = document.getElementById('pluginNavToggle');
      this.pluginNavList = document.getElementById('pluginNavList');
      this.pluginNavHasItems = false;
      this.pageTitle = document.getElementById('pageTitle');
      this.pageDesc = document.getElementById('pageDesc');
      this.btnNewTask = document.getElementById('btnNew');
      this.storageLabel = document.getElementById('storageLabel');
      this.storageStatus = document.getElementById('storageStatus');
      this.clientsOn = true;
      this.currentView = 'tasks';
      this.sections = {};
      Object.keys(SECTION_IDS).forEach((k) => { this.sections[k] = document.getElementById(SECTION_IDS[k]); });
    }

    static get VIEWS(){
      return Object.keys(SECTION_IDS);
    }

    bindTabClick(handler){
      this.tabs.forEach((t) => {
        t.addEventListener('click', () => {
          const view = t.getAttribute('data-view');
          handler(view);
          if(view === 'plugins' && this.pluginNavHasItems) this.setPluginNavExpanded(true);
        });
      });
    }

    bindPluginNav(handler){
      this.pluginNavToggle.addEventListener('click', () => this.setPluginNavExpanded(this.pluginNavList.hidden));
      this.pluginNavList.addEventListener('click', (ev) => {
        const button = ev.target.closest('[data-plugin-id]');
        if(button && this.pluginNavList.contains(button)){
          handler(button.getAttribute('data-plugin-id'));
          if(window.matchMedia('(max-width:900px)').matches) this.setPluginNavExpanded(false);
        }
      });
    }

    setPluginNavExpanded(expanded){
      const on = !!expanded && this.pluginNavHasItems;
      this.pluginNavList.hidden = !on;
      this.pluginNavToggle.setAttribute('aria-expanded', String(on));
      this.pluginNavToggle.setAttribute('aria-label', Workhub.t(on ? 'Ocultar plugins instalados' : 'Mostrar plugins instalados'));
      this.pluginNav.classList.toggle('is-expanded', on);
    }

    renderPluginNav(installed, activeId){
      const {esc, hueFor} = Workhub.utils.html;
      const icons = Workhub.views.pluginIcons;
      this.pluginNavHasItems = installed.length > 0;
      this.pluginNavToggle.hidden = !this.pluginNavHasItems;
      this.pluginNavList.innerHTML = installed.map((p) => {
        const m = p.manifest || {};
        const name = m.name || p.id;
        const hue = typeof m.color === 'number' ? m.color : hueFor(p.id);
        return '<button type="button" class="plugin-nav-item' + (p.id === activeId ? ' is-active' : '') + '" data-plugin-id="' + esc(p.id) + '" title="' + esc(name) + '"' + (p.id === activeId ? ' aria-current="page"' : '') + '>' +
          '<span class="plugin-nav-icon" style="--h:' + hue + '" aria-hidden="true">' + icons.svg(m.icon, 13) + '</span><span class="plugin-nav-name" translate="no">' + esc(name) + '</span></button>';
      }).join('');
      if(!this.pluginNavHasItems) this.setPluginNavExpanded(false);
    }

    isVisible(view){
      return !this.sections[view].hidden;
    }

    show(view){
      if(view !== 'plugins' && window.matchMedia('(max-width:900px)').matches) this.setPluginNavExpanded(false);
      this.tabs.forEach((t) => {
        const active = t.getAttribute('data-view') === view;
        t.classList.toggle('active', active);
        if(active){
          t.setAttribute('aria-current', 'page');
          this._scrollTabIntoView(t);
        } else {
          t.removeAttribute('aria-current');
        }
      });
      Object.keys(this.sections).forEach((k) => { this.sections[k].hidden = k !== view; });
      this.btnNewTask.hidden = view !== 'tasks';
      this.currentView = view;
      document.body.classList.toggle('plugin-open', view === 'plugins' && !document.getElementById('pluginStage').hidden);
      this._renderInfo();
    }

    _renderInfo(){
      const view = this.currentView;
      const info = (!this.clientsOn && PAGE_INFO_NO_CLIENTS[view]) || PAGE_INFO[view] || PAGE_INFO.tasks;
      this.pageTitle.textContent = info[0];
      this.pageDesc.textContent = info[1];
    }

    /* Proyectos sin clientes: se ocultan la sección Clientes y todo lo que
       depende de ellos (filtros, campos de formulario, etiquetas). */
    /* Elementos .team-only (filtro de miembros…) solo en proyectos de equipo. */
    setTeamMode(on){
      document.querySelectorAll('.team-only').forEach((el) => {
        el.classList.toggle('team-off', !on);
        /* Los <select> se muestran con un desplegable propio (Dropdown): también se oculta su envoltorio. */
        const wrap = el.closest('.dd');
        if(wrap) wrap.classList.toggle('team-off', !on);
      });
    }

    setClientsEnabled(on){
      this.clientsOn = on;
      document.body.classList.toggle('no-clients', !on);
      document.querySelectorAll('.needs-clients').forEach((el) => {
        el.classList.toggle('clients-off', !on);
        const wrap = el.closest('.dd');
        if(wrap) wrap.classList.toggle('clients-off', !on);
      });
      const holders = {
        search: ['Buscar por título, cliente o contacto…', 'Buscar por título o contacto…'],
        searchVault: ['Buscar por cliente, correo, web o IP…', 'Buscar por nombre, correo, web o IP…']
      };
      Object.keys(holders).forEach((id) => {
        const el = document.getElementById(id);
        if(el) el.setAttribute('placeholder', holders[id][on ? 0 : 1]);
      });
      const vCliente = document.getElementById('vCliente');
      if(vCliente) vCliente.required = on;
      this._renderInfo();
    }

    /* En móvil la barra de secciones es horizontal y desplazable. */
    _scrollTabIntoView(t){
      const nav = t.closest('.tabs');
      if(nav.scrollWidth <= nav.clientWidth) return;
      const left = t.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
      if(left < nav.scrollLeft || left + t.offsetWidth > nav.scrollLeft + nav.clientWidth){
        nav.scrollLeft = Math.max(0, left - 16);
      }
    }

    /* Botón × en cada diálogo: equivale a su botón Cancelar/Cerrar (data-dismiss),
       para que el controlador haga la misma limpieza. */
    addDialogCloseButtons(){
      document.querySelectorAll('dialog').forEach((dlg) => {
        const dismiss = dlg.querySelector('[data-dismiss]');
        const inner = dlg.querySelector('.dlg-inner');
        if(!dismiss || !inner) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dlg-close';
        btn.setAttribute('aria-label', 'Cerrar');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        btn.addEventListener('click', () => dismiss.click());
        /* Al final para que el foco inicial siga yendo al primer campo. */
        inner.appendChild(btn);
      });
    }

    /* counts: {tasks, calendar, contacts, vault, clients}; alerts: vistas a resaltar. */
    setCounts(counts, alerts){
      Object.keys(counts).forEach((view) => {
        const el = document.getElementById('count' + view.charAt(0).toUpperCase() + view.slice(1));
        if(!el) return;
        const n = counts[view];
        el.textContent = n ? String(n) : '';
        el.classList.toggle('is-alert', !!(alerts && alerts[view]));
      });
    }

    /* Al cambiar de proyecto: búsquedas vacías y todos los clientes. */
    resetFilters(){
      ['search', 'searchClients', 'searchVault'].forEach((id) => {
        const el = document.getElementById(id);
        if(!el || !el.value) return;
        el.value = '';
        el.dispatchEvent(new Event('input', {bubbles:true}));
      });
      ['filterCliente', 'calFilterCliente', 'filterClienteVault', 'filterAssignee'].forEach((id) => {
        const el = document.getElementById(id);
        if(!el || !el.value) return;
        el.value = '';
        el.dispatchEvent(new Event('change', {bubbles:true}));
      });
    }

    /* mode: 'local' | 'firebase' | 'claude' (ver services/platform.js) */
    setStorageMode(mode){
      this.storageModeNow = mode;
      if(!this.watchingConnection){
        /* El indicador cambia solo al perder o recuperar la conexión. */
        this.watchingConnection = true;
        const again = () => this.setStorageMode(this.storageModeNow);
        window.addEventListener('online', again);
        window.addEventListener('offline', again);
      }
      const info = Workhub.views.storageInfo(mode);
      this.storageLabel.textContent = info.side;
      this.storageStatus.setAttribute('data-mode', info.mode);
      this.storageStatus.setAttribute('title', info.hint);
    }
  }

  Workhub.views.ShellView = ShellView;
})();
