/* Contexto de equipo del proyecto abierto para las vistas: quiénes son los
   miembros, quién soy yo y si puedo editar. Lo fija ProjectsController cada vez
   que cambia el proyecto o sus miembros; las tarjetas, la ficha y el formulario
   de tarea lo leen para pintar avatares y asignaciones. Un proyecto personal no
   tiene equipo: enabled() es false y nada de esto se ve. */
(function(){
  const {esc, initials, hueFor} = Workhub.utils.html;

  let ctx = {on:false, project:null, members:[], me:'', role:''};

  function find(uid){
    return ctx.members.find((m) => m.uid === uid) || null;
  }

  /* Avatar de un miembro: la foto (solo https) o sus iniciales. title (opcional): el texto de
     ayuda, en lugar de su nombre. */
  function avatar(m, cls, title){
    const photo = Workhub.utils.urls.safeUrl(m.photo);
    const inner = photo && photo.indexOf('https:') === 0
      ? '<img alt="" referrerpolicy="no-referrer" src="' + esc(photo) + '">'
      : esc(initials(m.name || m.email || '?'));
    return '<span class="avatar ' + (cls || 'is-mini') + '" style="--h:' + hueFor(m.uid) + '" title="' + esc(title || m.name || m.email) + '" translate="no">' + inner + '</span>';
  }

  const ASSIGN_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 11.6-4M18 14v6M15 17h6"/></svg>';

  /* Quién lleva una subtarea (solo en equipos): la persona asignada —si se puede editar, un botón
     que abre el menú para cambiarla— y, con una marca, quien la completó. c: la subtarea. */
  function checkWho(c){
    if(!ctx.on) return '';
    const t = Workhub.t;
    const to = find(c.assignee);
    const by = c.done ? find(c.doneBy) : null;
    const doneTitle = by ? t('Completada por {name}', {name:by.name}) + (c.doneAt ? ' · ' + Workhub.utils.dates.fmtDateTime(c.doneAt) : '') : '';
    /* Asignada y completada por la misma persona: un solo avatar, con la marca. */
    const same = !!(to && by && to.uid === by.uid);
    const toTitle = to ? t('Asignada a {name}', {name:to.name}) + (same ? ' · ' + doneTitle : '') : t('Asignar subtarea');
    const doer = by && !same ? '<span class="check-doer">' + avatar(by, 'is-mini', doneTitle) + '</span>' : '';
    let own = '';
    if(Workhub.views.team.canEdit()){
      own = '<button type="button" class="check-assign' + (to ? '' : ' is-empty') + (same ? ' check-doer' : '') + '" data-act="check-assign" data-uid="' + esc(to ? to.uid : '') + '"' +
        ' aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(toTitle) + '"' + (to ? '' : ' title="' + esc(toTitle) + '"') + '>' +
        (to ? avatar(to, 'is-mini', toTitle) : ASSIGN_ICON) + '</button>';
    } else if(to){
      own = '<span' + (same ? ' class="check-doer"' : '') + '>' + avatar(to, 'is-mini', toTitle) + '</span>';
    }
    return doer || own ? '<span class="check-who">' + doer + own + '</span>' : '';
  }

  /* Menú para elegir a una persona del equipo (o a nadie), junto al botón que lo abre. Se cierra
     al elegir, con Escape o al pulsar fuera; pulsar otra vez el botón también lo cierra. */
  let menu = null;

  function closeMenu(focus){
    if(!menu) return;
    const m = menu;
    menu = null;
    m.el.remove();
    document.removeEventListener('pointerdown', m.away, true);
    m.btn.setAttribute('aria-expanded', 'false');
    if(focus && m.btn.isConnected) m.btn.focus();
  }

  /* onPick(uid): '' es «Sin asignar». */
  function pick(btn, current, onPick){
    const again = menu && menu.btn === btn;
    closeMenu();
    if(again) return;
    const el = document.createElement('div');
    el.className = 'member-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', Workhub.t('Asignar subtarea'));
    const item = (uid, html, on) => '<button type="button" role="menuitemradio" aria-checked="' + on + '" data-uid="' + esc(uid) + '">' + html + '</button>';
    el.innerHTML = ctx.members.map((m) => item(m.uid, avatar(m, 'is-mini') + '<span translate="no">' + esc(m.name) + (m.uid === ctx.me ? ' (' + esc(Workhub.t('yo')) + ')' : '') + '</span>', m.uid === current)).join('') +
      item('', '<span>' + esc(Workhub.t('Sin asignar')) + '</span>', !find(current));
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-uid]');
      if(!b) return;
      closeMenu(true);
      onPick(b.getAttribute('data-uid'));
    });
    el.addEventListener('keydown', (ev) => {
      /* Escape cierra el menú, no el diálogo en el que está. */
      if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); closeMenu(true); return; }
      if(ev.key === 'Tab'){ closeMenu(); return; }
      if(ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      const all = Array.from(el.querySelectorAll('button'));
      all[(all.indexOf(document.activeElement) + (ev.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
    });
    const away = (ev) => { if(!el.contains(ev.target) && !btn.contains(ev.target)) closeMenu(); };
    document.addEventListener('pointerdown', away, true);
    menu = {el:el, btn:btn, away:away};
    btn.parentNode.appendChild(el);
    btn.setAttribute('aria-expanded', 'true');
    (el.querySelector('[aria-checked="true"]') || el.firstChild).focus({preventScroll:true});
    el.scrollIntoView({block:'nearest'});
  }

  Workhub.views.team = {
    /* project: el proyecto abierto (con role si es de equipo). */
    set(project, members, meUid){
      const on = !!(project && project.team);
      ctx = {on:on, project:on ? project : null, members:on ? members : [], me:meUid || '', role:on ? project.role : ''};
    },

    enabled(){ return ctx.on; },
    project(){ return ctx.project; },
    role(){ return ctx.role; },
    meUid(){ return ctx.me; },
    members(){ return ctx.members.slice(); },
    /* Los proyectos personales siempre se pueden editar. */
    canEdit(){ return !ctx.on || ctx.role === 'owner' || ctx.role === 'editor'; },
    isOwner(){ return ctx.on && ctx.role === 'owner'; },

    member(uid){ return find(uid); },
    name(uid){
      const m = find(uid);
      return m ? m.name : '';
    },

    /* Solo las asignaciones a personas que siguen en el equipo. */
    assigned(t){
      return (Array.isArray(t && t.assignees) ? t.assignees : []).filter((uid) => !!find(uid));
    },

    /* Cambia cuando cambian los miembros, mi rol o quién soy: para saber si hay que repintar. */
    signature(){
      return JSON.stringify([ctx.on, ctx.role, ctx.me, ctx.members.map((m) => [m.uid, m.role, m.name, m.photo])]);
    },

    avatar: avatar,
    checkWho: checkWho,
    pick: pick,

    /* Pila de avatares (hasta max) con «+N» si hay más. */
    stack(uids, max, cls){
      const list = uids.map(find).filter(Boolean);
      if(!list.length) return '';
      const shown = list.slice(0, max || 3);
      const rest = list.length - shown.length;
      return '<span class="avatar-stack">' + shown.map((m) => avatar(m, cls)).join('') +
        (rest > 0 ? '<span class="avatar is-mini avatar-more">+' + rest + '</span>' : '') + '</span>';
    },

    roleLabel(role){
      return role === 'owner' ? 'Propietario' : role === 'editor' ? 'Editor' : 'Lector';
    }
  };
})();
