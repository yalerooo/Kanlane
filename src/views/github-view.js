/* GitHub Projects: tarjeta en Ajustes para conectar el proyecto abierto y
   botón de sincronización en la barra de Tareas. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const $ = (id) => document.getElementById(id);

  const MARK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.38-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.72 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg>';

  /* "hace 3 min" */
  function ago(ts){
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if(s < 45) return Workhub.t('hace unos segundos');
    const m = Math.round(s / 60);
    if(m < 60) return Workhub.t('hace {n} min', {n:m});
    const h = Math.round(m / 60);
    if(h < 24) return Workhub.t('hace {n} h', {n:h});
    return Workhub.t('hace {n} d', {n:Math.round(h / 24)});
  }

  /* «Conectar con GitHub»: autorizar sin crear ni pegar ningún token. */
  function oauthBlock(s){
    if(!s.canOAuth) return '';
    return '<div class="gh-oauth"><button type="button" class="btn btn-primary" data-gh="oauth">' + MARK + '<span>Conectar con GitHub</span></button>' +
      '<p class="field-help">Se abre GitHub para que autorices Workhub (permiso sobre tus proyectos). No tienes que copiar ningún token.</p></div>';
  }

  class GithubView {
    constructor(){
      this.body = $('ghBody');
      this.button = $('btnGhSync');
      this.handlers = {};
      this.form = {url:'', pushExisting:false, target:'', name:''};
      this.last = null;

      this.body.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-gh]');
        if(!b || b.disabled) return;
        const act = b.getAttribute('data-gh');
        if(act === 'connect') this.handlers.connect({
          url: $('ghUrl').value.trim(),
          token: $('ghToken') ? $('ghToken').value.trim() : '',
          target: $('ghTarget').value,
          name: $('ghName') ? $('ghName').value.trim() : '',
          pushExisting: !!$('ghPushExisting') && $('ghPushExisting').checked
        });
        else if(act === 'sync') this.handlers.sync();
        else if(act === 'unlink') this.handlers.unlink();
        else if(act === 'forget') this.handlers.forget();
        else if(act === 'oauth') this.handlers.oauth();
        else if(act === 'saveToken') this.handlers.saveToken($('ghToken') ? $('ghToken').value.trim() : '');
      });
      this.body.addEventListener('change', (ev) => {
        if(ev.target.id === 'ghPushNew') this.handlers.pushNew(ev.target.checked);
        if(ev.target.id === 'ghTarget'){
          this.form.target = ev.target.value;
          this.render(this.last);
        }
      });
      this.body.addEventListener('input', (ev) => {
        if(ev.target.id === 'ghUrl') this.form.url = ev.target.value;
        if(ev.target.id === 'ghPushExisting') this.form.pushExisting = ev.target.checked;
        if(ev.target.id === 'ghName') this.form.name = ev.target.value;
      });
      this.body.addEventListener('submit', (ev) => ev.preventDefault());
      this.button.addEventListener('click', () => this.handlers.sync());
    }

    /* handlers: {connect({url, token, pushExisting}), sync, unlink, forget, pushNew(on)} */
    bind(handlers){
      this.handlers = handlers;
    }

    /* s: {linked, cfg, busy, error, hasToken, last, project, connecting, connectError} */
    render(s){
      this.last = s;
      /* Botón de la barra de Tareas. */
      this.button.hidden = !s.linked || s.canSync === false;
      if(s.linked && s.canSync !== false){
        this.button.classList.toggle('is-busy', s.busy);
        this.button.classList.toggle('is-error', !!s.error);
        this.button.disabled = s.busy;
        this.button.classList.toggle('is-error', !!s.error || !s.hasToken);
        this.button.innerHTML = MARK + '<span>' + esc(s.busy ? Workhub.t('Sincronizando…') : !s.hasToken ? Workhub.t('Añadir token de GitHub') : s.error ? Workhub.t('Error de GitHub') : Workhub.t('GitHub')) + '</span>';
        this.button.title = !s.hasToken ? Workhub.t('Falta el token de GitHub en este navegador') : s.error ? s.error.message : (s.last ? Workhub.t('Sincronizado {when}', {when:ago(s.last.at)}) : Workhub.t('Sincronizar con GitHub'));
      }

      if(!this.body) return;
      /* No se repinta mientras el usuario escribe en el formulario de conexión. */
      const focused = document.activeElement;
      if(!s.linked && this.body.contains(focused) && (focused.id === 'ghUrl' || focused.id === 'ghToken' || focused.id === 'ghName') && !s.connecting) return;
      if(s.linked && this.body.contains(focused) && focused.id === 'ghToken' && !s.hasToken && !s.busy && !s.tokenError) return;

      this.body.innerHTML = s.linked ? this._linked(s) : this._form(s);
    }

    _form(s){
      const tokenField = s.hasToken
        ? '<p class="gh-note">Ya hay un token guardado en este navegador. <button type="button" class="link-btn" data-gh="forget">Olvidarlo</button>' + (s.canOAuth ? ' · <button type="button" class="link-btn" data-gh="oauth">Conectar con GitHub en su lugar</button>' : '') + '</p>'
        : oauthBlock(s) + '<div class="field"><label for="ghToken">' + (s.canOAuth ? 'O pega un token de GitHub' : 'Token de GitHub') + '</label>' +
          '<input id="ghToken" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_…">' +
          '<p class="field-help">Un token clásico con el permiso <b>project</b> (<b>read:project</b> si solo quieres leer). Se crea en GitHub → Settings → Developer settings → Personal access tokens (classic). Se guarda solo en este navegador.</p></div>';
      /* Destino: uno de los proyectos de Workhub o uno nuevo. */
      const projects = s.projects || [];
      /* Por defecto, el proyecto que está abierto (y se reinicia al cambiar de proyecto). */
      if(this.form.forProject !== s.currentId){
        this.form.forProject = s.currentId;
        this.form.target = s.currentId;
      }
      if(!this.form.target || (this.form.target !== '__new__' && !projects.some((p) => p.id === this.form.target))) this.form.target = s.currentId;
      const isNew = this.form.target === '__new__';
      const options = projects.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === this.form.target ? ' selected' : '') + '>' + esc(p.nombre) + (p.linked ? ' · ' + esc(Workhub.t('ya enlazado')) : '') + '</option>').join('') +
        '<option value="__new__"' + (isNew ? ' selected' : '') + '>' + esc(Workhub.t('+ Crear un proyecto nuevo')) + '</option>';
      const targetName = (projects.find((p) => p.id === this.form.target) || {}).nombre || '';
      const targetField = '<div class="field"><label for="ghTarget">Proyecto de Workhub donde añadirlo</label>' +
        '<select id="ghTarget">' + options + '</select>' +
        (isNew
          ? '<input id="ghName" maxlength="60" autocomplete="off" placeholder="' + esc(Workhub.t('Nombre del proyecto nuevo (por defecto, el de GitHub)')) + '" value="' + esc(this.form.name) + '">' +
            '<p class="field-help">Se crea un proyecto nuevo con las columnas y los elementos de GitHub, y se abre.</p>'
          : '<p class="field-help">' + esc(Workhub.t('Las columnas de «{name}» se sustituirán por las de GitHub y sus elementos se importarán como tareas.', {name:targetName})) + '</p>') +
        '</div>';
      return '<form class="gh-form" autocomplete="off">' +
        '<p class="gh-lead">Enlaza este proyecto de Workhub con un GitHub Project. Las columnas de GitHub pasan a ser las columnas del tablero y las tareas se mantienen sincronizadas en los dos sentidos.</p>' +
        tokenField +
        '<div class="field"><label for="ghUrl">Enlace del proyecto de GitHub</label>' +
        '<input id="ghUrl" type="url" spellcheck="false" placeholder="https://github.com/users/tu-usuario/projects/1" value="' + esc(this.form.url) + '"></div>' +
        targetField +
        (isNew ? '' : '<label class="check-row"><input type="checkbox" id="ghPushExisting"' + (this.form.pushExisting ? ' checked' : '') + '> Enviar también a GitHub las tareas que ya hay en ese proyecto</label>') +
        (s.connectError ? '<p class="lock-error">' + esc(s.connectError) + '</p>' : '') +
        '<div class="gh-actions"><button type="button" class="btn btn-primary" data-gh="connect"' + (s.connecting ? ' disabled' : '') + '>' + esc(s.connecting ? Workhub.t('Conectando…') : Workhub.t('Conectar con GitHub')) + '</button></div>' +
        '</form>';
    }

    _linked(s){
      const c = s.cfg;
      const r = s.last;
      let state;
      if(s.busy) state = '<span class="gh-state">Sincronizando…</span>';
      else if(s.error) state = '<span class="gh-state is-error">' + esc(s.error.message) + '</span>';
      else if(r) state = '<span class="gh-state">' + esc(Workhub.t('Sincronizado {when}', {when:ago(r.at)})) + '</span>';
      else state = '<span class="gh-state">Todavía no se ha sincronizado.</span>';
      let detail = '';
      if(r && !s.error){
        const parts = [];
        if(r.created) parts.push(Workhub.t('{n} nuevas desde GitHub', {n:r.created}));
        if(r.updated) parts.push(Workhub.t('{n} actualizadas', {n:r.updated}));
        if(r.sent) parts.push(Workhub.t('{n} enviadas a GitHub', {n:r.sent}));
        if(r.columns) parts.push(Workhub.t('{n} columnas nuevas', {n:r.columns}));
        if(r.warnings) parts.push(Workhub.t('{n} sin poder sincronizar', {n:r.warnings}));
        if(parts.length) detail = '<p class="gh-note">' + esc(parts.join(' · ')) + '</p>';
      }
      /* Enlazado desde otro navegador: el token no viaja con la cuenta y hay que pegarlo aquí. */
      const readOnly = s.canSync === false;
      const tokenBlock = s.hasToken || readOnly ? '' :
        '<div class="field gh-token-missing">' +
        '<p class="gh-note is-warn">Este proyecto está enlazado con GitHub, pero este navegador no tiene acceso a tu cuenta de GitHub (se guarda solo en cada navegador y no viaja con tu cuenta). ' + (s.canOAuth ? 'Conéctala con un clic o pega un token.' : 'Pega un token para volver a sincronizar.') + '</p>' +
        oauthBlock(s) +
        '<label for="ghToken">' + (s.canOAuth ? 'O pega un token de GitHub' : 'Token de GitHub') + '</label>' +
        '<input id="ghToken" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_…">' +
        (s.tokenError ? '<p class="lock-error">' + esc(s.tokenError) + '</p>' : '') +
        '<div class="gh-actions"><button type="button" class="btn ' + (s.canOAuth ? 'btn-ghost' : 'btn-primary') + '" data-gh="saveToken"' + (s.busy ? ' disabled' : '') + '>Guardar token y sincronizar</button></div></div>';
      return '<div class="gh-linked">' +
        '<div class="gh-project">' + MARK + '<div><a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer" translate="no">' + esc(c.title) + '</a>' +
        '<div>' + state + '</div></div></div>' + tokenBlock + detail +
        (readOnly ? '<p class="gh-note">' + esc(Workhub.t('Eres lector de este proyecto: no puedes sincronizar con GitHub.')) + '</p>' : (
          '<label class="check-row"><input type="checkbox" id="ghPushNew"' + (c.pushNew ? ' checked' : '') + '> Enviar a GitHub las tareas nuevas de Workhub (como borradores)</label>' +
          '<p class="gh-note">Mover una tarea de columna, cambiar su título o su descripción en un lado se refleja en el otro. Lo que se borra en un lado no se borra en el otro.</p>' +
          '<div class="gh-actions">' +
          (s.hasToken ? '<button type="button" class="btn btn-primary" data-gh="sync"' + (s.busy ? ' disabled' : '') + '>Sincronizar ahora</button>' : '') +
          '<button type="button" class="btn btn-ghost" data-gh="unlink">Desconectar</button>' +
          (s.hasToken && s.canOAuth ? '<button type="button" class="btn btn-ghost" data-gh="oauth">Conectar con GitHub en su lugar</button>' : '') +
          (s.hasToken ? '<button type="button" class="btn btn-ghost" data-gh="forget">Olvidar token</button>' : '') +
          '</div>')) +
        '</div>';
    }
  }

  Workhub.views.GithubView = GithubView;
})();
