/* Asistente «Nuevo proyecto»: pasos de privacidad (2), contraseña de cifrado (3) y clave de
   recuperación (4), y la sección «Privacidad» de «Editar proyecto». Se añade a ProjectView
   (ver project-view.js y project-dialog-view.js). Plan: docs/CIFRADO-PROYECTOS.md, 8.1 y 8.3. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const {paintMeter, keyPanel} = Workhub.views.shared.privacy;
  const $ = (id) => document.getElementById(id);

  function card(key, selected, disabled, name, texts, chips){
    return '<button type="button" class="type-option' + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : '') + '" role="radio" aria-checked="' + selected + '"' +
      (disabled ? ' aria-disabled="true"' : '') + ' data-privacy="' + key + '">' +
      '<span class="type-radio" aria-hidden="true"></span>' +
      '<span class="type-body"><span class="type-name">' + esc(name) + '</span>' +
      texts.map((t) => '<span class="type-desc">' + esc(t) + '</span>').join('') +
      '<span class="type-chips">' + chips.map((c) => '<span class="type-chip is-plain">' + esc(c) + '</span>').join('') + '</span></span></button>';
  }

  Object.assign(Workhub.views.ProjectView.prototype, {
    initPrivacy(){
      this.step = 1;
      this.privacy = 'A';
      this.privacyOn = false;
      this.managedOn = false;
      this.pending = null;
      this.enc = null;
      this.steps = [$('pStep1'), $('pStep2'), $('pStep3'), $('pStep4')];
      this.privacyEl = $('pPrivacy');
      this.encPass = $('pEncPass');
      this.encPass2 = $('pEncPass2');
      this.encMeter = $('pEncMeter');
      this.encTrusted = $('pEncTrusted');
      this.privacyInfo = $('pPrivacyInfo');
      this.privacyText = $('pPrivacyText');
      this.privacyActions = $('pPrivacyActions');

      this.privacyEl.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-privacy]');
        if(!b || b.getAttribute('aria-disabled') === 'true') return;
        this.privacy = b.getAttribute('data-privacy');
        this.error.hidden = true;
        this._renderPrivacy();
        this._stepButtons();
      });
      this.encPass.addEventListener('input', () => {
        this.error.hidden = true;
        paintMeter(this.encMeter, this.encPass.value && this.enc ? this.enc.check(this.encPass.value, this.pending ? this.pending.nombre : '') : null);
      });
      this.encPass2.addEventListener('input', () => { this.error.hidden = true; });
      this.encKey = keyPanel({box:$('pEncKey'), copy:$('pEncCopy'), download:$('pEncDownload'), saved:$('pEncSaved')},
        (text) => (this.enc ? this.enc.download(text, this.pending ? this.pending.nombre : '') : null),
        () => this._stepButtons());
      this.privacyActions.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-privacy-act]');
        if(b && this.enc) this.enc.action(b.getAttribute('data-privacy-act'), this.idInput.value);
      });
    },

    /* handlers: {check(pw, nombre) → resultado, prepare() → clave, reset(), create(datos) (con
       managed:true si es «Gestionado por Kanlane»),
       download(clave, nombre) → Promise, action(tipo, idProyecto)} */
    bindEncryption(handlers){
      this.enc = handlers;
    },

    /* ¿Se ofrece el paso de privacidad? Solo con cuenta (ni en modo local ni como invitado).
       managed: ¿se puede elegir «Gestionado por Kanlane»? Si no, su tarjeta dice «Próximamente». */
    setPrivacyAvailable(on, managed){
      this.privacyOn = !!on;
      this.managedOn = !!on && !!managed;
    },

    /* Sección «Privacidad» al editar: null la oculta; {encrypted, managed, canRotate} elige el texto y
       los botones (canRotate: se puede cambiar la clave del proyecto). */
    setPrivacyInfo(info){
      this.privacyInfo.hidden = !info;
      if(!info) return;
      this.privacyText.textContent = info.managed
        ? 'Gestionado por Kanlane. El contenido se guarda cifrado y la clave la custodia el servidor de Kanlane, que podría técnicamente descifrarlo.'
        : info.encrypted
          ? 'Cifrado total.'
          : 'Solo contraseñas. El contenido del proyecto no tiene cifrado de extremo a extremo.';
      /* Sin contraseña de cifrado no hay nada que cambiar ni que olvidar. */
      this.privacyActions.hidden = !info.encrypted || !!info.managed;
      $('pRotate').hidden = !info.canRotate;
    },

    _resetPrivacy(){
      this.step = 1;
      this.privacy = 'A';
      this.pending = null;
      this.encPass.value = '';
      this.encPass2.value = '';
      this.encTrusted.checked = false;
      paintMeter(this.encMeter, null);
      this.encKey.clear();
      if(this.enc) this.enc.reset();
      this.setPrivacyInfo(null);
    },

    _onSubmit(){
      if(this.step === 1){
        const p = this._collect();
        if(!p) return;
        this.pending = p;
        if(p.id || !this.privacyOn){ this._dispatch(p); return; }
        /* «Desde GitHub» no admite cifrado total: lo que se sincroniza llega a GitHub sin cifrar. */
        if(p.github) this.privacy = 'A';
        this._goStep(2);
        return;
      }
      if(this.step === 2){
        if(this.privacy === 'B' && !this.pending.github){
          this._goStep(3);
          this.encPass.focus();
        } else if(this.privacy === 'C' && this.managedOn && !this.pending.github){
          this.enc.create({nombre:this.pending.nombre, color:this.pending.color, config:this.pending.config, managed:true});
        } else {
          this._dispatch(this.pending);
        }
        return;
      }
      if(this.step === 3){
        const pw = this.encPass.value;
        const res = this.enc.check(pw, this.pending.nombre);
        if(!res.ok){ this.showError(res.message); return; }
        if(pw !== this.encPass2.value){ this.showError('Las contraseñas no coinciden.'); return; }
        /* La clave se enseña ANTES de crear nada: no existe un proyecto cifrado con una clave sin confirmar. */
        this.encKey.show(this.enc.prepare());
        this._goStep(4);
        return;
      }
      if(this.step === 4 && this.encKey.isSaved()){
        this.enc.create({
          nombre:this.pending.nombre, color:this.pending.color, config:this.pending.config,
          password:this.encPass.value, trusted:this.encTrusted.checked
        });
      }
    },

    _goStep(n){
      this.step = n;
      this.steps.forEach((el, i) => { el.hidden = i !== n - 1; });
      this.error.hidden = true;
      this.lead.hidden = n !== 1;
      if(n !== 1) this.invitesBox.hidden = true;
      if(n === 1) this._renderTypes();
      if(n === 2) this._renderPrivacy();
      this._stepButtons();
    },

    _stepButtons(){
      const n = this.step;
      const creating = !this.idInput.value;
      this.btnCancel.textContent = n === 1 ? 'Cancelar' : 'Atrás';
      this.btnCancel.hidden = n === 1 && this.onboarding;
      if(n !== 1) this.btnDelete.hidden = true;
      let label = 'Guardar';
      if(n === 1) label = !creating ? 'Guardar' : (this.privacyOn ? 'Siguiente' : 'Crear proyecto');
      else if(n === 2) label = this.privacy === 'B' && !(this.pending && this.pending.github) ? 'Siguiente' : 'Crear proyecto';
      else if(n === 3) label = 'Siguiente';
      else if(n === 4) label = 'Crear proyecto cifrado';
      this.btnSave.textContent = label;
      this.btnSave.disabled = n === 4 && !this.encKey.isSaved();
    },

    /* «Atrás» en los pasos 2–4; en el 1, cerrar. */
    _back(){
      if(this.step > 1){ this._goStep(this.step - 1); return true; }
      return false;
    },

    setEncBusy(on){
      this.btnCancel.disabled = on;
      /* Al terminar, el botón vuelve a ser el del paso en el que se estaba (el 2 o el 4). */
      if(!on){ this._stepButtons(); return; }
      this.btnSave.disabled = true;
      this.btnSave.textContent = 'Preparando el cifrado…';
    },

    _renderPrivacy(){
      const gh = !!(this.pending && this.pending.github);
      const b = this.privacy === 'B' && !gh;
      const c = this.privacy === 'C' && !gh && this.managedOn;
      this.privacyEl.innerHTML =
        card('A', !b && !c, false, 'Solo contraseñas',
          ['Las credenciales del cofre se cifran con tu contraseña maestra. El resto del proyecto (tareas, notas, clientes, contactos, reuniones e imágenes) se guarda sin cifrado de extremo a extremo: Kanlane podría leerlo. Si olvidas una contraseña, no pierdes el proyecto.'],
          ['Compatible con GitHub', 'Sin contraseña extra']) +
        card('B', b, gh, 'Cifrado total',
          gh ? ['No disponible con «Desde GitHub»: lo que se sincroniza tiene que llegar a GitHub sin cifrar.']
            : ['Todo el contenido del proyecto se cifra en tu navegador con una contraseña que solo tú conoces. Kanlane no la tiene y no puede leer el contenido. Si pierdes la contraseña y la clave de recuperación, el proyecto no se puede recuperar.',
              'No se cifran el nombre del proyecto, las columnas, las etiquetas, las fechas ni el estado de las tareas.'],
          ['Contraseña del proyecto', 'Sin GitHub']) +
        card('C', c, gh || !this.managedOn, 'Gestionado por Kanlane',
          gh ? ['No disponible con «Desde GitHub»: lo que se sincroniza tiene que llegar a GitHub sin cifrar.']
            : ['Cifrado sin contraseña extra: Kanlane guarda la clave en su servidor y se la da a tu cuenta al entrar. Es lo más cómodo y protege si alguien copia la base de datos, pero Kanlane podría técnicamente descifrar el proyecto.',
              'No se cifran el nombre del proyecto, las columnas, las etiquetas, las fechas ni el estado de las tareas. Por ahora no se puede compartir con un equipo.'],
          this.managedOn ? ['Sin contraseña extra', 'Sin GitHub'] : ['Próximamente']);
    }
  });
})();
