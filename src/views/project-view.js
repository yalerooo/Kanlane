/* Proyectos: selector de la barra lateral (botón + menú) y diálogo para crear,
   renombrar, cambiar el color o eliminar un proyecto. */
(function(){
  const {esc, closest, initials} = Workhub.utils.html;
  const PT = Workhub.models.ProjectTemplates;
  const GITHUB_TYPE = 'github';   /* solo en el diálogo: crea el proyecto desde GitHub */
  const $ = (id) => document.getElementById(id);
  const supportsPopover = typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');

  const CHECK = '<svg class="dd-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const CHECK_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ARROW_UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const ARROW_DOWN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
  const TRASH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  const SHARE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  const TEAM_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  /* Una invitación con sus botones (en el menú o en el diálogo del primer proyecto). */
  function inviteRow(i, kind){
    const attr = kind === 'menu' ? 'data-menu' : 'data-invite';
    return '<div class="invite-row-item"><div class="invite-text"><strong translate="no">' + esc(i.teamName) +
      (i.enc ? '<span class="enc-badge">' + esc(Workhub.t('Cifrado')) + '</span>' : '') + '</strong>' +
      '<span>' + esc(Workhub.t('{who} te invita como {role}', {who:i.invitedByName || i.email, role:Workhub.t(i.role === 'editor' ? 'editor' : 'lector')})) + '</span></div>' +
      '<div class="invite-btns"><button type="button" class="btn btn-primary btn-sm" ' + attr + '="accept" data-id="' + esc(i.id) + '">' + esc(Workhub.t('Aceptar')) + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" ' + attr + '="decline" data-id="' + esc(i.id) + '">' + esc(Workhub.t('Rechazar')) + '</button></div></div>';
  }

  const LOCK_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  /* enc:true es la marca del proyecto recordado en el navegador mientras llega la lista. */
  const isEncrypted = (p) => !!p && (p.enc === true || Workhub.models.ProjectModel.isEncrypted(p));

  /* Cuadrado con las iniciales en el color del proyecto. */
  function markHtml(project, hue, cls){
    return '<span class="project-mark' + (cls ? ' ' + cls : '') + '" style="--h:' + hue + '" aria-hidden="true">' + esc(initials(project.nombre)) + '</span>';
  }

  class ProjectView {
    constructor(){
      this.trigger = $('btnProject');
      this.mark = $('projectMark');
      this.name = $('projectName');
      this.sub = $('projectSub');
      this.lockIcon = $('projectLock');
      this.menu = $('projectMenu');
      if(supportsPopover){
        this.menu.setAttribute('popover', 'auto');
        this.menu.hidden = false;
      }

      this.dlg = $('dlgProject');
      this.form = $('formProject');
      this.title = $('dlgProjectTitle');
      this.invitesBox = $('pInvites');
      this.lead = $('pLead');
      this.leadText = this.lead.textContent;
      this.onboarding = false;
      this.idInput = $('pId');
      this.nameInput = $('pNombre');
      this.colors = $('pColors');
      this.btnSave = $('btnSaveProject');
      this.btnDelete = $('btnDeleteProject');
      this.btnCancel = $('btnCancelProject');
      this.deleteNote = $('pDeleteNote');
      this.error = $('pError');
      this.typesEl = $('pTypes');
      this.customEl = $('pCustom');
      this.stagesEl = $('pStages');
      this.addStageBtn = $('pAddStage');
      this.clientsChk = $('pClients');
      this.typeNote = $('pTypeNote');
      this.ghEl = $('pGh');
      this.ghTokenField = $('pGhTokenField');
      this.ghTokenSaved = $('pGhTokenSaved');
      this.ghToken = $('pGhToken');
      this.ghUrl = $('pGhUrl');
      this.ghOauthBox = $('pGhOauthBox');
      this.oauthHandler = null;
      $('pGhOauth').addEventListener('click', () => { if(this.oauthHandler) this.oauthHandler(); });
      this.githubHandler = null;

      this.tipo = PT.DEFAULT_TYPE;
      this.stages = [];
      this.clients = false;
      this.color = null;
      this.pendingDelete = false;

      this.trigger.addEventListener('click', () => this.toggleMenu());
      this.menu.addEventListener('keydown', (ev) => this._menuKeys(ev));
      if(supportsPopover){
        this.menu.addEventListener('toggle', (ev) => {
          this.trigger.setAttribute('aria-expanded', ev.newState === 'open' ? 'true' : 'false');
        });
      } else {
        document.addEventListener('mousedown', (ev) => {
          if(this.isMenuOpen() && !this.menu.contains(ev.target) && !this.trigger.contains(ev.target)) this.closeMenu();
        });
        document.addEventListener('keydown', (ev) => {
          if(ev.key === 'Escape' && this.isMenuOpen()){ this.closeMenu(); this.trigger.focus(); }
        });
      }
      window.addEventListener('resize', () => { if(this.isMenuOpen()) this.closeMenu(); });

      this.colors.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-hue]');
        if(!b) return;
        const hue = b.getAttribute('data-hue');
        this.color = hue === '' ? null : +hue;
        this._renderColors();
      });
      this.nameInput.addEventListener('input', () => {
        if(this.color === null) this._renderColors();
        this.error.hidden = true;
      });
      this.typesEl.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-type]');
        if(b && b.getAttribute('aria-disabled') !== 'true') this._pickType(b.getAttribute('data-type'));
      });
      this.stagesEl.addEventListener('click', (ev) => this._stageClick(ev));
      this.stagesEl.addEventListener('input', (ev) => {
        const row = closest(ev.target, '.stage-row');
        if(!row || !ev.target.classList.contains('stage-name')) return;
        this.stages[+row.getAttribute('data-i')].label = ev.target.value;
        this.error.hidden = true;
      });
      this.stagesEl.addEventListener('change', (ev) => {
        const row = closest(ev.target, '.stage-row');
        if(!row || ev.target.name !== 'pDone') return;
        this.stages.forEach((st, i) => { st.done = i === +row.getAttribute('data-i'); });
      });
      this.addStageBtn.addEventListener('click', () => {
        if(this.stages.length >= PT.MAX_STAGES) return;
        this.stages.push({key:'e' + Date.now().toString(36) + this.stages.length, label:'', color:'gray', done:false});
        this._renderStages();
        const inputs = this.stagesEl.querySelectorAll('.stage-name');
        inputs[inputs.length - 1].focus();
      });
      this.clientsChk.addEventListener('change', () => { this.clients = this.clientsChk.checked; });
      /* En los pasos de privacidad este botón es «Atrás». */
      this.btnCancel.addEventListener('click', () => { if(!this._back()) this.closeDialog(); });
      this.dlg.addEventListener('close', () => {
        this._resetDelete();
        /* Primer proyecto: el diálogo no se puede cerrar hasta crearlo. */
        if(this.onboarding && !this.dlg.open) this.dlg.showModal();
      });
      this.dlg.addEventListener('cancel', (ev) => { if(this.onboarding) ev.preventDefault(); });
      this.initPrivacy();
    }

    /* ---------- Botón de la barra lateral ---------- */

    renderCurrent(project, hue){
      this.mark.style.setProperty('--h', hue);
      this.mark.textContent = initials(project.nombre);
      this.name.textContent = project.nombre;
      /* Debajo del nombre, el tipo de proyecto (la marca Kanlane ya está encima). */
      if(this.sub) this.sub.textContent = PT.template(project.tipo).name;
      this.trigger.setAttribute('title', 'Proyecto: ' + project.nombre);
      /* Candado junto al nombre en los proyectos con cifrado total. */
      this.lockIcon.hidden = !isEncrypted(project);
    }

    /* ---------- Menú ---------- */

    /* handlers: {pick(id), edit(id), create(), share(), accept(id), decline(id)} */
    bindMenu(handlers){
      this.menu.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-menu]');
        if(!b) return;
        const id = b.getAttribute('data-id');
        this.closeMenu();
        switch(b.getAttribute('data-menu')){
          case 'pick': handlers.pick(id); break;
          case 'edit': handlers.edit(id); break;
          case 'new': handlers.create(); break;
          case 'share': handlers.share(); break;
          case 'accept': handlers.accept(id); break;
          case 'decline': handlers.decline(id); break;
        }
      });
    }

    /* Punto en el botón del proyecto cuando hay invitaciones esperando. */
    setInviteBadge(n){
      this.trigger.classList.toggle('has-invites', n > 0);
    }

    /* Invitaciones en el diálogo del primer proyecto (aceptar una evita crear otro). */
    bindInviteActions(handlers){
      this.invitesBox.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-invite]');
        if(!b) return;
        const id = b.getAttribute('data-id');
        if(b.getAttribute('data-invite') === 'accept') handlers.accept(id);
        else handlers.decline(id);
      });
    }

    renderInvites(list){
      if(!this.onboarding || !list.length){
        this.invitesBox.hidden = true;
        this.invitesBox.innerHTML = '';
        return;
      }
      this.invitesBox.hidden = false;
      this.invitesBox.innerHTML = '<p class="invite-box-title">' + esc(Workhub.t('Tienes invitaciones')) + '</p>' + list.map((i) => inviteRow(i, 'invite')).join('') +
        '<p class="invite-box-or">' + esc(Workhub.t('O crea tu propio proyecto:')) + '</p>';
    }

    /* Se llama antes de abrir el menú para pintarlo con los datos del momento. */
    bindMenuSource(fn){
      this.menuSource = fn;
    }

    isMenuOpen(){
      return supportsPopover ? this.menu.matches(':popover-open') : !this.menu.hidden;
    }

    toggleMenu(){
      if(this.isMenuOpen()) this.closeMenu();
      else this.openMenu();
    }

    openMenu(){
      const data = this.menuSource ? this.menuSource() : {projects:[], currentId:null, hueOf:() => 0};
      this.renderMenu(data.projects, data.currentId, data.hueOf, data);
      if(supportsPopover) this.menu.showPopover();
      else { this.menu.hidden = false; this.trigger.setAttribute('aria-expanded', 'true'); }
      this._position();
      const current = this.menu.querySelector('[data-menu="pick"][aria-checked="true"]') || this.menu.querySelector('button');
      if(current) current.focus();
    }

    closeMenu(){
      if(!this.isMenuOpen()) return;
      if(supportsPopover) this.menu.hidePopover();
      else { this.menu.hidden = true; this.trigger.setAttribute('aria-expanded', 'false'); }
    }

    renderMenu(projects, currentId, hueOf, extra){
      extra = extra || {};
      const invites = (extra.invites || []).length
        ? '<p class="project-menu-label">' + esc(Workhub.t('Invitaciones')) + '</p><div class="project-invites">' +
          extra.invites.map((i) => inviteRow(i, 'menu')).join('') + '</div><div class="dd-sep"></div>'
        : '';
      const share = extra.canShare
        ? '<button type="button" class="dd-option is-action" role="menuitem" data-menu="share">' + SHARE + '<span class="dd-text">' + esc(Workhub.t('Compartir este proyecto')) + '</span></button>'
        : '';
      this.menu.innerHTML = invites + '<p class="project-menu-label">Proyectos</p>' +
        '<div class="project-menu-list">' +
        projects.map((p) => {
          const current = p.id === currentId;
          return '<div class="project-row' + (current ? ' is-current' : '') + '">' +
            '<button type="button" class="dd-option project-pick' + (current ? ' is-selected' : '') + '" role="menuitemradio" aria-checked="' + current + '" data-menu="pick" data-id="' + esc(p.id) + '">' +
              markHtml(p, hueOf(p), 'is-sm') + '<span class="dd-text" translate="no">' + esc(p.nombre) + '</span>' + (p.team ? '<span class="project-team" title="' + esc(Workhub.t('Proyecto de equipo')) + '">' + TEAM_ICON + '</span>' : '') +
              (isEncrypted(p) ? '<span class="project-enc" title="' + esc(Workhub.t(Workhub.models.ProjectModel.isManaged(p) ? 'Gestionado por Kanlane: el contenido se guarda cifrado y Kanlane custodia la clave' : 'Cifrado total: el contenido se cifra en tu navegador')) + '">' + LOCK_ICON + '<span>' + esc(Workhub.t('Cifrado')) + '</span></span>' : '') + (current ? CHECK : '') +
            '</button>' +
            '<button type="button" class="icon-only project-edit" role="menuitem" data-menu="edit" data-id="' + esc(p.id) + '" aria-label="Editar ' + esc(p.nombre) + '" title="Editar proyecto">' + EDIT + '</button>' +
            '</div>';
        }).join('') +
        '</div><div class="dd-sep"></div>' +
        '<button type="button" class="dd-option is-action" role="menuitem" data-menu="new">' + PLUS + '<span class="dd-text">Nuevo proyecto</span></button>' + share;
    }

    /* Debajo del botón; en móvil, pegado a su borde izquierdo y sin salirse. */
    _position(){
      const r = this.trigger.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 248), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = r.bottom + 6;
      Object.assign(this.menu.style, {
        left: left + 'px',
        top: top + 'px',
        width: width + 'px',
        maxHeight: Math.max(160, window.innerHeight - top - 12) + 'px'
      });
    }

    /* Flechas arriba/abajo entre las opciones; Escape vuelve al botón. */
    _menuKeys(ev){
      const items = Array.from(this.menu.querySelectorAll('button'));
      const i = items.indexOf(document.activeElement);
      if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
        ev.preventDefault();
        const next = ev.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      } else if(ev.key === 'Home' || ev.key === 'End'){
        ev.preventDefault();
        items[ev.key === 'Home' ? 0 : items.length - 1].focus();
      } else if(ev.key === 'Escape' || ev.key === 'Tab'){
        if(ev.key === 'Escape'){ ev.preventDefault(); this.trigger.focus(); }
        this.closeMenu();
      }
    }


  }

  ProjectView.markHtml = markHtml;
  /* Lo que comparten los archivos que completan esta vista. */
  Workhub.views.shared = Workhub.views.shared || {};
  Workhub.views.shared.project = {PT, GITHUB_TYPE, CHECK_SMALL, ARROW_UP, ARROW_DOWN, TRASH};

  Workhub.views.ProjectView = ProjectView;
})();
