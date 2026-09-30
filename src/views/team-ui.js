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

  /* Avatar de un miembro: la foto (solo https) o sus iniciales. */
  function avatar(m, cls){
    const photo = Workhub.utils.urls.safeUrl(m.photo);
    const inner = photo && photo.indexOf('https:') === 0
      ? '<img alt="" referrerpolicy="no-referrer" src="' + esc(photo) + '">'
      : esc(initials(m.name || m.email || '?'));
    return '<span class="avatar ' + (cls || 'is-mini') + '" style="--h:' + hueFor(m.uid) + '" title="' + esc(m.name || m.email) + '" translate="no">' + inner + '</span>';
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
