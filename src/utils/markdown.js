/* Markdown de las descripciones y las notas: un subconjunto, sin dependencias y sin HTML.
   Todo el texto se escapa antes de dar formato, así que nada de lo escrito llega como etiqueta.
   Admite títulos (#), negrita, cursiva, tachado, código en línea y en bloque (```), enlaces
   (solo http, https y mailto), listas con viñetas y numeradas (anidadas), casillas (- [ ] y
   - [x]), citas (>) y líneas (---). Un salto de línea suelto se conserva, como en el texto plano.
   Las imágenes ![alt](url) salen como enlace: no se carga nada de fuera. */
(function(){
  const ESCAPES = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const FENCE = /^\s*```/;
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const TASK = /^\[([ xX])\]\s+(.*)$/;
  const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE = /^\s*>\s?(.*)$/;
  const SAFE_URL = /^(https?:\/\/|mailto:)[^\s"<>]+$/i;
  /* Marca de un trozo ya convertido (código, enlaces): no se vuelve a tocar. */
  const MARK = '\u0000';

  const clean = (src) => String(src == null ? '' : src).replace(/\u0000/g, '').replace(/\r\n?/g, '\n');

  function link(url, text){
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">' + text + '</a>';
  }

  /* Formato dentro de una línea. */
  function inline(text){
    const kept = [];
    const keep = (html) => { kept.push(html); return MARK + (kept.length - 1) + MARK; };
    let s = String(text).replace(/`([^`\n]+)`/g, (m, code) => keep('<code>' + esc(code) + '</code>'));
    s = esc(s);
    s = s.replace(/!?\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, url) => SAFE_URL.test(url) ? keep(link(url, label)) : m);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (m, before, url) => {
      const tail = (url.match(/[.,;:!?)]+$/) || [''])[0];
      const href = tail ? url.slice(0, -tail.length) : url;
      return SAFE_URL.test(href) ? before + keep(link(href, href)) + tail : m;
    });
    s = s.replace(/\*\*(?!\s)([^\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?!\s)([^\n]+?)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/\*(?![\s*])([^\n*]+?)\*/g, '<em>$1</em>')
      .replace(/(^|[^\w])_(?![\s_])([^\n_]+?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?!\s)([^\n]+?)~~/g, '<del>$1</del>');
    return s.replace(new RegExp(MARK + '(\\d+)' + MARK, 'g'), (m, i) => kept[+i]);
  }

  /* items: [{level, ordered, text, task}] → listas anidadas. */
  function listHtml(items, opts, count){
    let out = '';
    const open = [];
    items.forEach((it) => {
      while(open.length && open[open.length - 1].level > it.level) out += '</li></' + open.pop().tag + '>';
      const top = open[open.length - 1];
      if(!top || top.level < it.level){
        const tag = it.ordered ? 'ol' : 'ul';
        out += '<' + tag + '>';
        open.push({level:it.level, tag:tag});
      } else out += '</li>';
      if(it.task === null){
        out += '<li>' + inline(it.text);
        return;
      }
      const n = count.tasks++;
      out += '<li class="md-task' + (it.task ? ' is-done' : '') + '"><input type="checkbox" data-md-task="' + n + '"' +
        (it.task ? ' checked' : '') + (opts.tasks === 'interactive' ? '' : ' disabled') + '><span>' + inline(it.text) + '</span>';
    });
    while(open.length) out += '</li></' + open.pop().tag + '>';
    return out;
  }

  /* opts.tasks: 'interactive' deja marcar las casillas (data-md-task = su número en el texto). */
  function render(src, opts){
    opts = opts || {};
    const lines = clean(src).split('\n');
    const count = {tasks:0};
    const out = [];
    let para = [], items = [], quote = [];
    const flush = () => {
      if(para.length){ out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; }
      if(items.length){ out.push(listHtml(items, opts, count)); items = []; }
      if(quote.length){ out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>'); quote = []; }
    };
    for(let i = 0; i < lines.length; i++){
      const line = lines[i];
      if(FENCE.test(line)){
        flush();
        const code = [];
        for(i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if(!line.trim()){ flush(); continue; }
      const item = ITEM.exec(line);
      if(item && !RULE.test(line)){
        if(para.length || quote.length) flush();
        const last = items[items.length - 1];
        const task = TASK.exec(item[3]);
        items.push({
          level:Math.min(Math.floor(item[1].replace(/\t/g, '  ').length / 2), last ? last.level + 1 : 0),
          ordered:/\d/.test(item[2]),
          text:task ? task[2] : item[3],
          task:task ? task[1] !== ' ' : null
        });
        continue;
      }
      /* Una línea con sangría bajo un elemento de lista sigue siendo ese elemento. */
      if(items.length && /^\s+\S/.test(line)){ items[items.length - 1].text += ' ' + line.trim(); continue; }
      const head = HEADING.exec(line);
      if(head){
        flush();
        const level = Math.min(head[1].length, 3);
        out.push('<p class="md-h md-h' + level + '" role="heading" aria-level="' + (level + 2) + '">' + inline(head[2]) + '</p>');
        continue;
      }
      if(RULE.test(line)){ flush(); out.push('<hr>'); continue; }
      const q = QUOTE.exec(line);
      if(q){
        if(para.length || items.length) flush();
        quote.push(q[1]);
        continue;
      }
      if(items.length || quote.length) flush();
      para.push(line);
    }
    flush();
    return out.join('');
  }

  /* Marca o desmarca la casilla número n del texto (el mismo número que data-md-task). */
  function toggleTask(src, n, checked){
    const lines = clean(src).split('\n');
    let fenced = false, seen = 0;
    for(let i = 0; i < lines.length; i++){
      if(FENCE.test(lines[i])){ fenced = !fenced; continue; }
      if(fenced) continue;
      const item = ITEM.exec(lines[i]);
      if(!item || RULE.test(lines[i]) || !TASK.test(item[3])) continue;
      if(seen++ !== n) continue;
      lines[i] = lines[i].replace(/\[([ xX])\]/, checked ? '[x]' : '[ ]');
      break;
    }
    return lines.join('\n');
  }

  /* Texto sin marcas, para los resúmenes (la tarjeta del tablero). */
  function plain(src){
    return clean(src).split('\n').filter((l) => !FENCE.test(l) && !RULE.test(l)).map((l) => l
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?/, (m, pad, box) => pad + (box === undefined ? '· ' : box === ' ' ? '☐ ' : '☑ '))
      .replace(/!?\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
      .replace(/(\*\*|~~|`)/g, '')
      .replace(/(^|[^\w])__([^\n]+?)__(?!\w)/g, '$1$2')
      .replace(/\*(?![\s*])([^\n*]+?)\*/g, '$1')
      .replace(/(^|[^\w])_(?![\s_])([^\n_]+?)_(?!\w)/g, '$1$2')
    ).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  Workhub.utils.markdown = {render, plain, toggleTask};
})();
