/* Diálogo de crear y editar proyecto: tipo, etapas, colores, GitHub y borrado.
   Se añade a ProjectView (ver project-view.js). */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const {PT, GITHUB_TYPE, TEMPLATE_TYPE, TRELLO_TYPE, CHECK_SMALL, ARROW_UP, ARROW_DOWN, TRASH} = Workhub.views.shared.project;
  /* Tipos que crean el proyecto con contenido (una semilla, ver project-seed.js). */
  const isSeeded = (tipo) => tipo === TEMPLATE_TYPE || tipo === TRELLO_TYPE;

  Object.assign(Workhub.views.ProjectView.prototype, {
    /* handler(id|null, nombre, color|null, config, seed): config son los campos del tipo de proyecto;
       seed, las tareas con las que nace (plantilla o tablero de Trello), si las hay. */
    bindSubmit(handler){
      this.submitHandler = handler;
      /* El botón principal avanza por los pasos del asistente (ver project-privacy-view.js). */
      this.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        this._onSubmit();
      });
    },

    /* Valida el primer paso y devuelve lo que hay que crear o guardar (null si falta algo):
       {id, nombre, color, config}, con seed si nace con tareas (plantilla o Trello), o
       {github:{nombre, url, token}} para «Desde GitHub». */
    _collect(){
      const nombre = this.nameInput.value.trim();
      if(this.tipo === GITHUB_TYPE){
        const url = this.ghUrl.value.trim();
        if(!url){ this.ghUrl.focus(); this.showError('Pega el enlace de tu proyecto de GitHub.'); return null; }
        if(!Workhub.services.github.token() && !this.ghToken.value.trim()){ this.ghToken.focus(); this.showError('Pega un token de GitHub.'); return null; }
        this.error.hidden = true;
        return {nombre:nombre, github:{nombre:nombre, url:url, token:this.ghToken.value.trim()}};
      }
      if(isSeeded(this.tipo)){
        const trello = this.tipo === TRELLO_TYPE;
        const seed = trello ? this.trelloSeed : Workhub.models.ProjectGallery.seed(this.galleryKey);
        if(!seed){
          if(trello) this.showError('Elige el archivo JSON que exportaste de Trello.');
          else this.showError('Elige una plantilla.');
          return null;
        }
        this.error.hidden = true;
        /* Sin nombre, el del tablero o el de la plantilla. */
        const name = nombre || seed.nombre || Workhub.t('Proyecto importado');
        return {id:null, nombre:name, color:this.color, config:Workhub.models.ProjectSeed.config(seed), seed:seed};
      }
      if(!nombre){ this.nameInput.focus(); return null; }
      if(!this.tipo){ this.showError('Elige un tipo de proyecto.'); return null; }
      if(this.tipo === PT.CUSTOM_TYPE){
        const named = this.stages.filter((st) => st.label.trim());
        if(named.length < PT.MIN_STAGES){
          this.showError('Añade al menos ' + PT.MIN_STAGES + ' etapas con nombre.');
          return null;
        }
        this.stages = named;
      }
      return {id:this.idInput.value || null, nombre:nombre, color:this.color, config:PT.fieldsFor(this.tipo, this.stages, this.clients)};
    },

    _dispatch(p){
      if(p.github){
        if(this.githubHandler) this.githubHandler(p.github);
        return;
      }
      this.submitHandler(p.id, p.nombre, p.color, p.config, p.seed || null);
    },

    /* «Conectar con GitHub» (sin token) en el tipo «Desde GitHub». */
    bindGithubOAuth(handler){
      this.oauthHandler = handler;
    },

    /* Repinta el bloque de GitHub (p. ej. tras conectar la cuenta). */
    refreshGithub(){
      this._renderCustom();
    },

    /* handler({nombre, url, token}) para el tipo «Desde GitHub». */
    bindGithubSubmit(handler){
      this.githubHandler = handler;
    },

    /* Primer clic: avisa de lo que se va a borrar. Segundo: handler(id). */
    bindDelete(handler){
      this.btnDelete.addEventListener('click', () => {
        const id = this.idInput.value;
        if(!id) return;
        if(!this.pendingDelete){
          this.pendingDelete = true;
          this.deleteNote.hidden = false;
          this.btnDelete.textContent = 'Sí, eliminar todo';
          return;
        }
        handler(id);
      });
    },

    openNew(){
      this._open(null, '', null, PT.resolve(null));
      this.title.textContent = 'Nuevo proyecto';
      this._stepButtons();
    },

    /* Cuenta nueva: no hay ningún proyecto y hay que crear el primero. Sin tipo
       elegido de antemano, sin GitHub y sin poder cerrar el diálogo. */
    openOnboarding(){
      /* Puede estar abierto el de editar/eliminar el proyecto que acaba de borrarse. */
      if(this.dlg.open) this.dlg.close();
      this.onboarding = true;
      this._open(null, '', null, PT.resolve(null));
      this.title.textContent = 'Crea tu primer proyecto';
      this.lead.textContent = 'Elige para qué lo vas a usar: el tipo define las etapas del tablero y si trabajas con clientes. Podrás cambiarlo más tarde y crear más proyectos.';
      this.dlg.classList.add('is-onboarding');
      this._stepButtons();
    },

    endOnboarding(){
      this.onboarding = false;
      this.invitesBox.hidden = true;
      this.invitesBox.innerHTML = '';
      this.dlg.classList.remove('is-onboarding');
      this.btnCancel.hidden = false;
      this.lead.textContent = this.leadText;
    },

    /* canDelete: false para el proyecto principal. cfg: ProjectTemplates.resolve(project). */
    openEdit(project, canDelete, cfg){
      this._open(project.id, project.nombre, typeof project.color === 'number' ? project.color : null, cfg);
      this.title.textContent = 'Editar proyecto';
      this._stepButtons();
      this.btnDelete.hidden = !canDelete;
    },

    _open(id, nombre, color, cfg){
      this.idInput.value = id || '';
      this.nameInput.value = nombre;
      this.color = color;
      /* En el primer proyecto no hay tipo preelegido: lo elige el usuario. */
      this.tipo = this.onboarding ? null : cfg.tipo;
      this.ghUrl.value = '';
      this.ghToken.value = '';
      this.galleryKey = null;
      this._clearTrello();
      this.stages = cfg.stages.map((st) => Object.assign({}, st));
      this.clients = cfg.clients;
      this.typeNote.hidden = !id;
      this._resetPrivacy();
      this.steps.forEach((el, i) => { el.hidden = i !== 0; });
      this.lead.hidden = false;
      this.btnCancel.disabled = false;
      this._renderTypes();
      this._renderCustom();
      this.btnDelete.hidden = true;
      this.error.hidden = true;
      this._resetDelete();
      this.setBusy(false);
      this._renderColors();
      this.dlg.showModal();
      this.nameInput.focus();
      this.nameInput.select();
    },

    closeDialog(){
      if(this.dlg.open) this.dlg.close();
    },

    setBusy(busy, label){
      this.btnSave.disabled = busy || (this.step === 4 && !this.encKey.isSaved());
      this.btnDelete.disabled = busy;
      if(busy && label) this.btnDelete.textContent = label;
    },

    showError(msg){
      this.error.textContent = msg;
      this.error.hidden = false;
      /* El diálogo tiene scroll: que el error no quede fuera de la vista. */
      this.error.scrollIntoView({block:'nearest'});
    },

    _resetDelete(){
      this.pendingDelete = false;
      this.deleteNote.hidden = true;
      this.btnDelete.textContent = 'Eliminar proyecto';
    },

    /* ---------- Tipo de proyecto ---------- */

    _pickType(tipo){
      if(tipo === this.tipo) return;
      /* Al pasar un proyecto que ya existe a "personalizado" se parte de sus
         etapas actuales; uno nuevo empieza con las de la plantilla. */
      if(tipo === PT.CUSTOM_TYPE && this.tipo !== PT.CUSTOM_TYPE && this.tipo !== GITHUB_TYPE && !isSeeded(this.tipo)){
        const from = this.idInput.value ? this.tipo : PT.CUSTOM_TYPE;
        this.stages = PT.stagesOf(from);
        this.clients = PT.template(from).clients;
      }
      this.tipo = tipo;
      this.error.hidden = true;
      this._renderTypes();
      this._renderCustom();
    },

    _renderTypes(){
      /* Si en el paso de privacidad se eligió cifrado total y se vuelve atrás, GitHub ya no se puede elegir. */
      const noGh = this.privacy === 'B';
      const github = this.idInput.value || this.onboarding ? '' :
        '<button type="button" class="type-option' + (this.tipo === GITHUB_TYPE ? ' is-selected' : '') + (noGh ? ' is-disabled' : '') + '" role="radio" aria-checked="' + (this.tipo === GITHUB_TYPE) + '"' + (noGh ? ' aria-disabled="true"' : '') + ' data-type="' + GITHUB_TYPE + '">' +
        '<span class="type-radio" aria-hidden="true"></span>' +
        '<span class="type-body"><span class="type-name">Desde GitHub</span>' +
        '<span class="type-desc">' + (noGh ? 'No se puede sincronizar con GitHub un proyecto con cifrado total.' : 'Crea el proyecto con las columnas y los elementos de un GitHub Project y los mantiene sincronizados.') + '</span>' +
        '<span class="type-chips"><span class="type-chip is-plain">Sincronizado con GitHub</span></span></span></button>';
      /* Solo al crear: un proyecto que ya existe no se rellena con una plantilla ni con un tablero. */
      const extra = (tipo, name, desc, chip) =>
        '<button type="button" class="type-option' + (this.tipo === tipo ? ' is-selected' : '') + '" role="radio" aria-checked="' + (this.tipo === tipo) + '" data-type="' + tipo + '">' +
        '<span class="type-radio" aria-hidden="true"></span>' +
        '<span class="type-body"><span class="type-name">' + name + '</span>' +
        '<span class="type-desc">' + desc + '</span>' +
        '<span class="type-chips"><span class="type-chip is-plain">' + chip + '</span></span></span></button>';
      const seeded = this.idInput.value ? '' :
        extra(TEMPLATE_TYPE, 'Desde una plantilla', 'Un tablero ya montado para lanzamientos, contenidos, ventas, altas de cliente o sprints.', 'Con tareas de ejemplo') +
        extra(TRELLO_TYPE, 'Importar de Trello', 'Trae un tablero de Trello con sus listas, tarjetas, etiquetas, checklists y comentarios.', 'Desde un archivo JSON');
      this.typesEl.innerHTML = PT.TEMPLATES.map((t) => {
        const on = t.key === this.tipo;
        const chips = t.key === PT.CUSTOM_TYPE
          ? '<span class="type-chip is-plain">Etapas y clientes a tu gusto</span>'
          : t.stages.map((st) => '<span class="type-chip"><i style="background:' + PT.colorOf(st.color).dot + '"></i>' + esc(st.label) + '</span>').join('') +
            '<span class="type-chip is-plain">' + (t.clients ? 'Con clientes' : 'Sin clientes') + '</span>';
        return '<button type="button" class="type-option' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-type="' + t.key + '">' +
          '<span class="type-radio" aria-hidden="true"></span>' +
          '<span class="type-body"><span class="type-name">' + esc(t.name) + '</span>' +
          '<span class="type-desc">' + esc(t.desc) + '</span>' +
          '<span class="type-chips">' + chips + '</span></span></button>';
      }).join('') + seeded + github;
    },

    /* ---------- Plantillas y Trello ---------- */

    _renderGallery(){
      this.galleryList.innerHTML = Workhub.models.ProjectGallery.list().map((t) => {
        const on = t.key === this.galleryKey;
        return '<button type="button" class="type-option' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-gallery="' + t.key + '">' +
          '<span class="type-radio" aria-hidden="true"></span>' +
          '<span class="type-body"><span class="type-name">' + esc(t.name) + '</span>' +
          '<span class="type-desc">' + esc(t.desc) + '</span>' +
          '<span class="type-chips">' + t.stages.map((st) => '<span class="type-chip"><i style="background:' + PT.colorOf(st.color).dot + '"></i>' + esc(st.label) + '</span>').join('') +
          '<span class="type-chip is-plain">' + (t.clients ? 'Con clientes' : 'Sin clientes') + '</span></span></span></button>';
      }).join('');
    },

    _clearTrello(){
      this.trelloSeed = null;
      this.trelloFile.value = '';
      this.trelloName.textContent = '';
      this.trelloSummary.hidden = true;
    },

    /* Lee el archivo elegido y enseña qué trae antes de crear nada. */
    _readTrello(file){
      this.trelloSeed = null;
      this.trelloSummary.hidden = true;
      this.error.hidden = true;
      if(!file){ this.trelloName.textContent = ''; return; }
      this.trelloName.textContent = file.name;
      file.text().then((text) => {
        /* Entre tanto se ha elegido otro archivo. */
        if(this.trelloFile.files[0] !== file) return;
        const TI = Workhub.models.TrelloImport;
        let seed;
        try{ seed = TI.parse(text); }catch(err){
          this._clearTrello();
          if(err && err.code === 'few-lists') this.showError('Ese tablero tiene menos de dos listas abiertas: no hay etapas que importar.');
          else this.showError('Ese archivo no es un tablero exportado de Trello en JSON.');
          return;
        }
        this.trelloSeed = seed;
        this.trelloSummary.textContent = TI.summary(seed);
        this.trelloSummary.hidden = false;
        if(!this.nameInput.value.trim() && seed.nombre){
          this.nameInput.value = seed.nombre;
          if(this.color === null) this._renderColors();
        }
      }, () => {
        this._clearTrello();
        this.showError('No se pudo leer el archivo.');
      });
    },

    _renderCustom(){
      const gh = this.tipo === GITHUB_TYPE;
      this.ghEl.hidden = !gh;
      if(gh){
        const has = !!Workhub.services.github.token();
        this.ghTokenField.hidden = has;
        this.ghTokenSaved.hidden = !has;
        this.ghTokenSaved.textContent = Workhub.t(Workhub.services.github.tokenKind() === 'oauth'
          ? 'Se usará tu cuenta de GitHub conectada en este navegador.'
          : 'Se usará el token de GitHub guardado en este navegador.');
        this.ghOauthBox.hidden = has || !Workhub.services.github.canOAuth();
        this.nameInput.placeholder = 'Por defecto, el nombre del proyecto de GitHub';
      } else if(this.tipo === TRELLO_TYPE){
        this.nameInput.placeholder = 'Por defecto, el nombre del tablero de Trello';
      } else if(this.tipo === TEMPLATE_TYPE){
        this.nameInput.placeholder = 'Por defecto, el nombre de la plantilla';
      } else {
        this.nameInput.placeholder = 'Por ejemplo: Agencia, Freelance, Personal…';
      }
      this.galleryEl.hidden = this.tipo !== TEMPLATE_TYPE;
      if(this.tipo === TEMPLATE_TYPE) this._renderGallery();
      this.trelloEl.hidden = this.tipo !== TRELLO_TYPE;
      const custom = this.tipo === PT.CUSTOM_TYPE;
      this.customEl.hidden = !custom;
      if(!custom) return;
      this.clientsChk.checked = this.clients;
      this._renderStages();
    },

    _renderStages(){
      const n = this.stages.length;
      this.stagesEl.innerHTML = this.stages.map((st, i) => {
        const c = PT.colorOf(st.color);
        return '<div class="stage-row" data-i="' + i + '">' +
          '<button type="button" class="stage-color" data-act="color" style="--c:' + c.dot + '" title="Color: ' + esc(c.name) + '" aria-label="Cambiar color (' + esc(c.name) + ')"></button>' +
          '<input class="stage-name" maxlength="40" value="' + esc(PT.stageText(st)) + '" placeholder="Nombre de la etapa" aria-label="Nombre de la etapa ' + (i + 1) + '" autocomplete="off" translate="no">' +
          '<label class="stage-done" title="Las tareas de esta etapa cuentan como terminadas"><input type="radio" name="pDone"' + (st.done ? ' checked' : '') + ' aria-label="Etapa final (tareas terminadas)"><span>Final</span></label>' +
          '<button type="button" class="icon-only stage-btn" data-act="up"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir etapa" title="Subir">' + ARROW_UP + '</button>' +
          '<button type="button" class="icon-only stage-btn" data-act="down"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Bajar etapa" title="Bajar">' + ARROW_DOWN + '</button>' +
          '<button type="button" class="icon-only stage-btn" data-act="del"' + (n <= PT.MIN_STAGES ? ' disabled' : '') + ' aria-label="Quitar etapa" title="Quitar">' + TRASH + '</button>' +
          '</div>';
      }).join('');
      this.addStageBtn.disabled = n >= PT.MAX_STAGES;
    },

    _stageClick(ev){
      const b = closest(ev.target, 'button[data-act]');
      const row = closest(ev.target, '.stage-row');
      if(!b || !row) return;
      const i = +row.getAttribute('data-i');
      const act = b.getAttribute('data-act');
      if(act === 'color'){
        const at = PT.COLORS.findIndex((c) => c.key === this.stages[i].color);
        this.stages[i].color = PT.COLORS[(at + 1) % PT.COLORS.length].key;
      } else if(act === 'up' && i > 0){
        this.stages.splice(i - 1, 0, this.stages.splice(i, 1)[0]);
      } else if(act === 'down' && i < this.stages.length - 1){
        this.stages.splice(i + 1, 0, this.stages.splice(i, 1)[0]);
      } else if(act === 'del' && this.stages.length > PT.MIN_STAGES){
        const removed = this.stages.splice(i, 1)[0];
        if(removed.done) this.stages[this.stages.length - 1].done = true;
      }
      this._renderStages();
    },

    _renderColors(){
      const colors = Workhub.models.ClientModel.COLORS;
      const auto = Workhub.utils.html.hueFor(this.nameInput.value.trim());
      const swatch = (hue, label, selected, extra) =>
        '<button type="button" class="color-swatch' + (extra || '') + (selected ? ' is-selected' : '') + '" role="radio" aria-checked="' + selected + '" data-hue="' + (hue === null ? '' : hue) + '" style="--h:' + (hue === null ? auto : hue) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + (selected ? CHECK_SMALL : '') + '</button>';
      this.colors.innerHTML = swatch(null, 'Automático', this.color === null, ' is-auto') +
        '<span class="color-sep" aria-hidden="true"></span>' +
        colors.map((c) => swatch(c.hue, c.name, this.color === c.hue)).join('');
    }
  });
})();
