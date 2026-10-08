/* Menciones en los comentarios de un equipo: «@Nombre» avisa a esa persona.
   - spans / find: qué miembros se mencionan en un texto (el nombre entero, sin distinguir
     mayúsculas; «@Ana García» no cuenta además como «@Ana»).
   - mark: resalta las menciones de un comentario ya pintado.
   - attach: al escribir «@» en un campo de texto, lista de miembros para elegir. */
(function(){
  const {esc} = Workhub.utils.html;
  const MENU_MAX = 6;
  /* Lo que puede ir justo delante de la arroba y lo que no puede ir justo detrás del nombre. */
  const BEFORE = /[\s(\[{¡¿"'«>]/;
  const WORD = /[\p{L}\p{N}_]/u;

  /* members: [{uid, name}]. → [{start, end, uid}] ordenados por posición. */
  function spans(text, members){
    const src = String(text || '');
    const low = src.toLowerCase();
    const taken = [];
    const out = [];
    const free = (a, b) => !taken.some((s) => a < s[1] && b > s[0]);
    /* Los nombres largos primero, para que no se los quede uno más corto que empieza igual. */
    (members || []).map((m) => ({uid:m.uid, name:String(m.name || '').trim().toLowerCase()}))
      .filter((m) => m.uid && m.name).sort((a, b) => b.name.length - a.name.length).forEach((m) => {
        let from = 0;
        for(;;){
          const at = low.indexOf('@' + m.name, from);
          if(at === -1) break;
          const end = at + 1 + m.name.length;
          from = at + 1;
          if(at > 0 && !BEFORE.test(src[at - 1])) continue;
          if(end < src.length && WORD.test(src[end])) continue;
          if(!free(at, end)) continue;
          taken.push([at, end]);
          out.push({start:at, end:end, uid:m.uid});
        }
      });
    return out.sort((a, b) => a.start - b.start);
  }

  /* Los uid mencionados, sin repetir. */
  function find(text, members){
    const seen = [];
    spans(text, members).forEach((s) => { if(seen.indexOf(s.uid) === -1) seen.push(s.uid); });
    return seen;
  }

  /* Envuelve las menciones del texto de `root` (no dentro de código ni de enlaces). */
  function mark(root, members, meUid){
    if(!root || !members || !members.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.indexOf('@') === -1 || n.parentNode.closest('code, pre, a, .mention') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      const found = spans(text, members);
      if(!found.length) return;
      const frag = document.createDocumentFragment();
      let at = 0;
      found.forEach((s) => {
        if(s.start > at) frag.appendChild(document.createTextNode(text.slice(at, s.start)));
        const el = document.createElement('span');
        el.className = 'mention' + (s.uid === meUid ? ' is-me' : '');
        el.textContent = text.slice(s.start, s.end);
        frag.appendChild(el);
        at = s.end;
      });
      if(at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  /* Lista de miembros al escribir «@» en `input` (un textarea). getMembers() → [{uid, name}]
     (vacío fuera de un equipo: entonces no sale nada). El menú se cuelga de `host`, que tiene
     que estar posicionado (position: relative). */
  function attach(input, host, getMembers){
    const menu = document.createElement('div');
    menu.className = 'mention-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', Workhub.t('Mencionar a un miembro'));
    menu.hidden = true;
    host.appendChild(menu);
    let options = [];
    let active = 0;
    let range = null;

    const close = () => { menu.hidden = true; options = []; range = null; };
    const paint = () => {
      menu.innerHTML = options.map((m, i) => '<button type="button" class="mention-option' + (i === active ? ' is-active' : '') + '" role="option" aria-selected="' + (i === active) + '" data-i="' + i + '" translate="no">' +
        Workhub.views.team.avatar(m, 'is-mini') + '<span>' + esc(m.name) + '</span></button>').join('');
    };
    const refresh = () => {
      const members = getMembers();
      const caret = input.selectionStart;
      const m = members.length && input.selectionEnd === caret ? /(^|[\s(\[{¡¿"'«])@([^\s@]{0,30})$/.exec(input.value.slice(0, caret)) : null;
      if(!m){ close(); return; }
      const q = m[2].toLowerCase();
      options = members.filter((x) => x.name && x.name.toLowerCase().split(/\s+/).some((w) => w.indexOf(q) === 0) || (x.name || '').toLowerCase().indexOf(q) === 0).slice(0, MENU_MAX);
      if(!options.length){ close(); return; }
      range = [caret - m[2].length - 1, caret];
      active = Math.min(active, options.length - 1);
      menu.hidden = false;
      paint();
    };
    const pick = (i) => {
      const m = options[i];
      if(!m || !range) return;
      const insert = '@' + m.name + ' ';
      input.value = input.value.slice(0, range[0]) + insert + input.value.slice(range[1]);
      const pos = range[0] + insert.length;
      close();
      input.focus();
      input.setSelectionRange(pos, pos);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    };

    input.addEventListener('input', refresh);
    input.addEventListener('click', refresh);
    input.addEventListener('blur', () => setTimeout(close, 150));
    /* En captura: Intro elige del menú antes de que el formulario lo tome por «enviar». */
    input.addEventListener('keydown', (ev) => {
      if(menu.hidden) return;
      if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
        active = (active + (ev.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        paint();
      } else if(ev.key === 'Enter' || ev.key === 'Tab'){
        pick(active);
      } else if(ev.key === 'Escape'){
        close();
      } else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }, true);
    menu.addEventListener('mousedown', (ev) => ev.preventDefault());
    menu.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-i]');
      if(b) pick(+b.getAttribute('data-i'));
    });
    return {close:close};
  }

  Workhub.views.mentions = {spans, find, mark, attach};
})();
