/* Tokens del servidor MCP del proyecto abierto (Ajustes → Integraciones). Todo lo decide el
   servidor (worker/mcp.mjs): aquí solo se pregunta y se pinta. Guía: docs/MCP.md. */
(function(){
  const t = (text, params) => Workhub.t(text, params);
  const ERRORS = {
    name: 'Ponle un nombre al token.',
    limit: 'Este proyecto ya tiene el máximo de tokens. Revoca alguno para crear otro.',
    token: 'Ese token ya no existe.',
    project: 'Este proyecto ya no existe o no tienes acceso.',
    encrypted: 'Un proyecto cifrado no admite asistentes.',
    rate: 'Demasiadas peticiones seguidas. Espera un minuto.',
    network: 'No hay conexión con el servidor. Inténtalo de nuevo.',
    auth: 'Tu sesión ha caducado. Vuelve a entrar.'
  };

  class McpController {
    constructor(app, view){
      this.app = app;
      this.view = view;
      /* {key, loading | data | error, busy, fresh, note}: lo último que dijo el servidor del proyecto `key`. */
      this.state = null;
      this.view.bind({
        create: (name, readOnly) => this.create(name, readOnly),
        revoke: (id, name) => this.revoke(id, name),
        copy: (inputId, done) => this.copy(inputId, done),
        dismiss: () => this.dismiss()
      });
      this.render();
    }

    projectKey(){
      return String(this.app.projectId || '');
    }

    target(){
      return Workhub.services.mcp.target(this.app.projectId);
    }

    render(){
      const mcp = Workhub.services.mcp;
      const s = this.state;
      if(!mcp.available(this.app.rootDb) || !s || s.key !== this.projectKey() || s.error === 'not-configured'){
        this.view.render({state:'hidden'});
        return;
      }
      if(s.loading){ this.view.render({state:'loading'}); return; }
      if(s.error){ this.view.render({state:'error'}); return; }
      if(!s.data.available){ this.view.render({state:'encrypted'}); return; }
      this.view.render({state:'ready', data:s.data, busy:!!s.busy, fresh:s.fresh || null, note:s.note || null,
        team:Workhub.models.ProjectModel.isTeam(this.app.projectId)});
    }

    /* Al entrar en Ajustes: se pregunta al servidor qué tokens tiene el proyecto abierto. */
    onShow(){
      const mcp = Workhub.services.mcp;
      const key = this.projectKey();
      if(!mcp.available(this.app.rootDb) || !key){ this.state = null; this.render(); return Promise.resolve(); }
      /* El token recién creado sigue a la vista aunque se salga y se vuelva a entrar en Ajustes. */
      const fresh = this.state && this.state.key === key ? this.state.fresh : null;
      if(!this.state || this.state.key !== key || this.state.error) this.state = {key:key, loading:true};
      this.render();
      return mcp.call(this.app.rootDb, Object.assign({op:'list'}, this.target())).then(
        (data) => { if(key === this.projectKey()) this.state = {key:key, data:data, fresh:fresh}; },
        (err) => { if(key === this.projectKey()) this.state = {key:key, error:(err && err.code) || 'unavailable'}; }
      ).then(() => this.render());
    }

    /* Al abrir otro proyecto: lo que se sabía era del anterior (y su token recién creado, también). */
    onProjectChange(){
      this.state = null;
      this.render();
      if(this.app.shell.isVisible('settings')) this.onShow();
    }

    /* Una petición que cambia los tokens. after(data, antes): lo que queda en pantalla si sale bien. */
    send(body, after){
      const mcp = Workhub.services.mcp;
      const s = this.state;
      if(!s || !s.data || s.busy || s.key !== this.projectKey()) return Promise.resolve(false);
      const key = s.key;
      s.busy = true;
      s.note = null;
      this.render();
      return mcp.call(this.app.rootDb, Object.assign({}, body, this.target())).then((data) => {
        if(key !== this.projectKey()) return false;
        this.state = Object.assign({key:key, data:data}, after(data, s));
        this.render();
        return true;
      }, (err) => {
        if(key !== this.projectKey()) return false;
        s.busy = false;
        s.note = {text:t(ERRORS[err && err.code] || 'No se pudo completar. Inténtalo de nuevo.'), error:true};
        this.render();
        return false;
      });
    }

    create(name, readOnly){
      const clean = String(name || '').trim();
      if(!clean){
        this.view.note(t(ERRORS.name), true);
        this.view.focus('mcpName');
        return Promise.resolve();
      }
      return this.send({op:'create', name:clean, readOnly:!!readOnly}, (data) => {
        const made = data.tokens.find((tk) => tk.id === data.created) || {name:clean, readOnly:!!readOnly};
        return {fresh:{name:made.name, readOnly:made.readOnly, token:data.token,
          command:'claude mcp add --transport http kanlane ' + Workhub.services.mcp.endpoint() + ' --header "Authorization: Bearer ' + data.token + '"'}};
      }).then((ok) => {
        if(!ok) return;
        this.view.clearName();
        this.view.focus('mcpToken');
      });
    }

    revoke(id, name){
      return this.app.controllers.tasks.columns.confirm('Revocar el token',
        t('El token «{name}» dejará de funcionar al momento y no se puede recuperar: el asistente que lo use perderá el acceso a este proyecto.', {name:name}), 'Revocar')
        .then((ok) => {
          if(!ok) return;
          return this.send({op:'revoke', id:id}, (data, before) => ({fresh:before.fresh, note:{text:t('Token revocado.'), error:false}}));
        });
    }

    copy(inputId, done){
      const el = document.getElementById(inputId);
      if(!el) return;
      const ok = () => this.view.note(t(done), false);
      const fallback = () => { this.view.focus(inputId); this.view.note(t('Selecciónalo y cópialo con el teclado.'), false); };
      if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.value).then(ok, fallback);
      else fallback();
    }

    /* «Ya lo he copiado»: el token desaparece de la pantalla y ya no se puede volver a ver. */
    dismiss(){
      if(!this.state) return;
      this.state.fresh = null;
      this.state.note = null;
      this.render();
      this.view.focus('mcpName');
    }
  }

  Workhub.controllers.McpController = McpController;
})();
