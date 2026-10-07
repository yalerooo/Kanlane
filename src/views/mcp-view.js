/* Apartado «Asistentes de IA (MCP)» de Ajustes → Integraciones: los tokens con los que un asistente
   entra al proyecto abierto. Solo pinta; lo que se puede hacer lo decide el servidor (McpController). */
(function(){
  const $ = (id) => document.getElementById(id);
  const t = (text, params) => Workhub.t(text, params);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

  /* "hace 3 min" */
  function ago(ts){
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if(s < 45) return t('hace unos segundos');
    const m = Math.round(s / 60);
    if(m < 60) return t('hace {n} min', {n:m});
    const h = Math.round(m / 60);
    if(h < 24) return t('hace {n} h', {n:h});
    return t('hace {n} d', {n:Math.round(h / 24)});
  }

  const day = (ts) => Workhub.utils.dates.fmtDate(Workhub.utils.dates.ymd(new Date(ts)));

  class McpView {
    constructor(){
      this.card = $('mcpCard');
      this.body = $('mcpBody');
      this.handlers = {};
      if(!this.body) return;
      this.body.addEventListener('click', (ev) => {
        const b = ev.target.closest ? ev.target.closest('button[data-mcp]') : null;
        if(!b || b.disabled) return;
        const act = b.getAttribute('data-mcp');
        if(act === 'revoke') this.handlers.revoke(b.getAttribute('data-id'), b.getAttribute('data-name'));
        else if(act === 'copy-token') this.handlers.copy('mcpToken', 'Token copiado.');
        else if(act === 'copy-command') this.handlers.copy('mcpCommand', 'Comando copiado.');
        else if(act === 'done') this.handlers.dismiss();
      });
      this.body.addEventListener('submit', (ev) => {
        if(ev.target.id !== 'mcpForm') return;
        ev.preventDefault();
        this.handlers.create($('mcpName').value, $('mcpReadOnly').checked);
      });
    }

    /* handlers: {create(name, readOnly), revoke(id, name), copy(inputId, done), dismiss()} */
    bind(handlers){
      this.handlers = handlers;
    }

    /* Lo que se enseña una sola vez, justo después de crear un token. */
    freshHtml(f){
      return '<div class="gh-box mcp-fresh" role="group" aria-labelledby="mcpFreshTitle">' +
        '<h4 id="mcpFreshTitle">' + esc(t('Token «{name}» creado', {name:f.name})) + '</h4>' +
        '<p>' + esc(f.readOnly ? t('Cópialo ahora: no se volverá a mostrar. Trátalo como una contraseña: quien lo tenga puede leer las tareas de este proyecto.')
          : t('Cópialo ahora: no se volverá a mostrar. Trátalo como una contraseña: quien lo tenga puede leer y cambiar las tareas de este proyecto.')) + '</p>' +
        '<div class="field"><label for="mcpToken">' + esc(t('Token')) + '</label>' +
          '<div class="cap-row"><input id="mcpToken" class="cap-address" readonly translate="no" spellcheck="false" autocomplete="off" value="' + esc(f.token) + '">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-mcp="copy-token">' + esc(t('Copiar')) + '</button></div></div>' +
        '<div class="field"><label for="mcpCommand">' + esc(t('Para conectarlo desde Claude Code, pega esto en un terminal')) + '</label>' +
          '<textarea id="mcpCommand" class="mcp-command" rows="3" readonly translate="no" spellcheck="false">' + esc(f.command) + '</textarea>' +
          '<div class="gh-actions"><button type="button" class="btn btn-ghost btn-sm" data-mcp="copy-command">' + esc(t('Copiar comando')) + '</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-mcp="done">' + esc(t('Ya lo he copiado')) + '</button></div></div>' +
        '</div>';
    }

    tokenHtml(tk, team, busy){
      const bits = [tk.readOnly ? t('Solo lectura') : t('Lectura y escritura'), t('creado el {date}', {date:day(tk.createdAt)}),
        tk.usedAt ? t('usado {when}', {when:ago(tk.usedAt)}) : t('sin usar todavía')];
      if(team && !tk.mine) bits.push(tk.by ? t('de {name}', {name:tk.by}) : t('de otra persona'));
      return '<li class="gh-row"><div><b translate="no">' + esc(tk.name) + '</b><p>' + esc(bits.join(' · ')) + '</p></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-mcp="revoke" data-id="' + esc(tk.id) + '" data-name="' + esc(tk.name) + '"' + (busy ? ' disabled' : '') +
        ' aria-label="' + esc(t('Revocar el token «{name}»', {name:tk.name})) + '">' + esc(t('Revocar')) + '</button></li>';
    }

    /* s: {state: 'hidden' | 'loading' | 'error' | 'encrypted' | 'ready', data, busy, fresh, team, note:{text, error}} */
    render(s){
      if(!this.card || !this.body) return;
      this.card.hidden = s.state === 'hidden';
      if(s.state === 'hidden'){ this.body.innerHTML = ''; return; }
      const p = (text) => '<p class="gh-note">' + esc(text) + '</p>';
      if(s.state === 'loading'){ this.body.innerHTML = p(t('Cargando…')); return; }
      if(s.state === 'error'){ this.body.innerHTML = p(t('No se pudieron consultar los tokens de este proyecto. Sal de Ajustes y vuelve a entrar para intentarlo otra vez.')); return; }
      if(s.state === 'encrypted'){
        this.body.innerHTML = p(t('Este proyecto está cifrado y no admite asistentes. El servidor de Kanlane no tiene su clave, así que no puede leer ni cambiar sus tareas.'));
        return;
      }
      const d = s.data;
      const typed = $('mcpName') ? $('mcpName').value : '';
      const viewer = d.role === 'viewer';
      const disabled = s.busy ? ' disabled' : '';
      this.body.innerHTML = '<div class="gh-linked">' +
        (s.fresh ? this.freshHtml(s.fresh) : '') +
        p(t('Crea un token y dáselo a tu asistente: podrá ver las tareas de este proyecto, moverlas de columna, añadirles notas y crear tareas nuevas. Cada token vale solo para este proyecto y puedes revocarlo cuando quieras.')) +
        (d.tokens.length ? '<ul class="gh-rows mcp-list" aria-label="' + esc(t('Tokens de este proyecto')) + '">' + d.tokens.map((tk) => this.tokenHtml(tk, s.team, s.busy)).join('') + '</ul>'
          : p(d.role === 'owner' ? t('Todavía no hay ningún token en este proyecto.') : t('Todavía no has creado ningún token en este proyecto.'))) +
        '<form class="mcp-form" id="mcpForm" novalidate>' +
          '<div class="field"><label for="mcpName">' + esc(t('Nombre del token nuevo')) + '</label>' +
          '<input id="mcpName" maxlength="60" autocomplete="off" placeholder="' + esc(t('Por ejemplo: Claude en mi portátil')) + '" aria-describedby="mcpNameHelp" value="' + esc(typed) + '"' + disabled + '>' +
          '<p class="field-help" id="mcpNameHelp">' + esc(t('Solo sirve para que lo reconozcas en esta lista.')) + '</p></div>' +
          '<label class="check-row"><input type="checkbox" id="mcpReadOnly"' + (viewer ? ' checked disabled' : disabled) + '> ' + esc(t('Solo lectura: puede ver las tareas, pero no cambiarlas')) + '</label>' +
          (viewer ? '<p class="field-help">' + esc(t('Como solo puedes leer este proyecto, tus tokens también son de solo lectura.')) + '</p>' : '') +
          '<div class="gh-actions"><button type="submit" class="btn btn-primary btn-sm"' + disabled + '>' + esc(t('Crear token')) + '</button></div></form>' +
        '<p class="gh-note' + (s.note && s.note.error ? ' lock-error' : '') + '" id="mcpNote" role="status"' + (s.note ? '' : ' hidden') + '>' + esc(s.note ? s.note.text : '') + '</p>' +
        '</div>';
    }

    /* Aviso corto bajo el formulario, sin repintar (no se pierde el foco ni lo seleccionado). */
    note(text, error){
      const el = $('mcpNote');
      if(!el) return;
      el.textContent = text;
      el.classList.toggle('lock-error', !!error);
      el.hidden = !text;
    }

    clearName(){
      const el = $('mcpName');
      if(el) el.value = '';
    }

    focus(id){
      const el = $(id);
      if(el){ el.focus(); if(el.select) el.select(); }
    }
  }

  Workhub.views.McpView = McpView;
})();
