/* Estructura general: barra lateral, cabecera de página y cambio de sección. */
(function(){
  const PAGE_INFO = {
    tasks: ['Tareas', 'Organiza el trabajo de cada cliente por estado. Arrastra las tarjetas para moverlas entre columnas.'],
    calendar: ['Calendario', 'Fechas límite de las tareas y reuniones programadas con cada cliente.'],
    vault: ['Contraseñas', 'Credenciales cifradas en tu navegador con tu contraseña maestra.'],
    clients: ['Clientes y contactos', 'Cada cliente con sus personas de contacto. Busca por cliente, nombre, email o teléfono.'],
    plugins: ['Plugins', 'Amplía Workhub con plugins oficiales o de terceros. Cada uno se ejecuta aislado y solo accede a lo que le permitas.'],
    data: ['Copia de seguridad', 'Exporta los datos del proyecto abierto a un archivo o restáuralos desde una copia.'],
    settings: ['Ajustes', 'Personaliza el aspecto de Workhub.']
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

  class ShellView {
    constructor(){
      this.nav = document.querySelector('.tabs');
      this.tabs = Array.from(this.nav.querySelectorAll('.tab[data-view]'));
      this.pageTitle = document.getElementById('pageTitle');
      this.pageDesc = document.getElementById('pageDesc');
      this.btnNewTask = document.getElementById('btnNew');
      this.storageLabel = document.getElementById('storageLabel');
      this.sections = {};
      Object.keys(SECTION_IDS).forEach((k) => { this.sections[k] = document.getElementById(SECTION_IDS[k]); });
    }

    static get VIEWS(){
      return Object.keys(SECTION_IDS);
    }

    bindTabClick(handler){
      this.tabs.forEach((t) => {
        t.addEventListener('click', () => handler(t.getAttribute('data-view')));
      });
    }

    isVisible(view){
      return !this.sections[view].hidden;
    }

    show(view){
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
      const info = PAGE_INFO[view] || PAGE_INFO.tasks;
      this.pageTitle.textContent = info[0];
      this.pageDesc.textContent = info[1];
    }

    /* En móvil la barra de secciones es horizontal y desplazable. */
    _scrollTabIntoView(t){
      const nav = t.parentNode;
      if(nav.scrollWidth <= nav.clientWidth) return;
      const left = t.offsetLeft - nav.offsetLeft;
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
      ['filterCliente', 'calFilterCliente', 'filterClienteVault'].forEach((id) => {
        const el = document.getElementById(id);
        if(!el || !el.value) return;
        el.value = '';
        el.dispatchEvent(new Event('change', {bubbles:true}));
      });
    }

    /* mode: 'local' | 'firebase' | 'claude' (ver services/platform.js) */
    setStorageMode(mode){
      this.storageLabel.textContent = mode === 'local' ? 'Modo local' : mode === 'firebase' ? 'En la nube' : 'Sincronizado';
    }
  }

  Workhub.views.ShellView = ShellView;
})();
