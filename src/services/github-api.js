/* Cliente mínimo de la API GraphQL de GitHub para GitHub Projects (v2).
   El token lo pega el usuario y se guarda solo en este navegador
   (localStorage): nunca se sube a Firestore ni al repositorio. */
(function(){
  const ENDPOINT = 'https://api.github.com/graphql';
  const TOKEN_KEY = 'workhub_gh_token';
  const MAX_PAGES = 20;   /* 20 × 100 = 2000 elementos por proyecto */

  class GithubError extends Error {
    constructor(code, message){
      super(message);
      this.code = code;
    }
  }

  function token(){
    try{ return localStorage.getItem(TOKEN_KEY) || ''; }catch(e){ return ''; }
  }

  /* ¿Se puede conectar con GitHub sin pegar un token? Hace falta la cuenta (Firebase) con GitHub activado. */
  function canOAuth(){
    const f = Workhub.services.firebase;
    return !!(f && Workhub.services.platform.mode() === 'firebase' && f.providers().indexOf('github') !== -1);
  }

  function oauth(){
    return Workhub.services.firebase.githubToken();
  }

  /* De dónde viene el acceso guardado: 'oauth' (con «Conectar con GitHub», los
     tokens de acceso de una aplicación OAuth empiezan por gho_), 'token' (pegado a
     mano) o '' si no hay ninguno. */
  function tokenKind(){
    const t = token();
    if(!t) return '';
    return /^gho_/.test(t) ? 'oauth' : 'token';
  }

  function setToken(value){
    try{
      if(value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    }catch(e){}
  }

  /* Petición cruda: devuelve el JSON completo (data y errors). */
  function request(query, variables){
    const t = token();
    if(!t) return Promise.reject(new GithubError('no-token', 'Falta el token de GitHub.'));
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json'},
      body: JSON.stringify({query:query, variables:variables || {}})
    }).catch(() => {
      throw new GithubError('network', 'No se pudo conectar con GitHub.');
    }).then((res) => {
      if(res.status === 401) throw new GithubError('auth', 'GitHub no acepta el token. Puede haber caducado o estar mal copiado.');
      if(res.status === 403 || res.status === 429) throw new GithubError('rate', 'GitHub ha limitado las peticiones. Vuelve a intentarlo dentro de unos minutos.');
      if(!res.ok) throw new GithubError('http', 'GitHub respondió con un error (' + res.status + ').');
      return res.json();
    });
  }

  function graphql(query, variables){
    return request(query, variables).then((json) => {
      const errors = json.errors || [];
      if(errors.length && !json.data){
        const scopes = errors.some((e) => e.type === 'INSUFFICIENT_SCOPES');
        throw new GithubError(scopes ? 'scopes' : 'graphql',
          scopes ? 'El token no tiene el permiso «project». Crea uno clásico con ese permiso.' : (errors[0].message || 'GitHub devolvió un error.'));
      }
      return json.data;
    });
  }

  /* https://github.com/users/NOMBRE/projects/1/views/1 → {type, login, number} */
  function parseProjectUrl(url){
    const m = /^https:\/\/github\.com\/(users|orgs)\/([A-Za-z0-9-_.]+)\/projects\/(\d+)/.exec(String(url || '').trim());
    return m ? {type:m[1] === 'orgs' ? 'organization' : 'user', login:m[2], number:+m[3]} : null;
  }

  /* Explica por qué no se ha podido leer el proyecto. */
  function notFound(ref, viewer, errors){
    if(errors.some((e) => e.type === 'INSUFFICIENT_SCOPES')){
      return new GithubError('scopes', 'El token no tiene el permiso «project». Crea un token clásico con «project» (o «read:project» si solo quieres leer).');
    }
    if(/^github_pat_/.test(token())){
      return new GithubError('scopes', 'Ese es un token «fine-grained», que GitHub no permite usar con proyectos de usuario. Crea uno clásico (Tokens (classic)) con el permiso «project».');
    }
    if(viewer && ref.type === 'user' && viewer.toLowerCase() !== ref.login.toLowerCase()){
      return new GithubError('not-found', 'El token es de la cuenta «' + viewer + '» y el proyecto es de «' + ref.login + '». Si el proyecto es privado, el token tiene que ser de esa cuenta.');
    }
    const detail = errors.length && errors[0].message ? ' (GitHub dice: ' + errors[0].message + ')' : '';
    return new GithubError('not-found', 'No se encuentra el proyecto ' + ref.number + ' de «' + ref.login + '». Comprueba el número del enlace y que el token tenga el permiso «project»' + detail + '.');
  }

  const PROJECT_FIELDS = 'id title url closed fields(first:40){nodes{... on ProjectV2SingleSelectField{id name options{id name color}}}}';

  /* Devuelve {id, title, url, fieldId, fieldName, options:[{id,name,color}]}. */
  function fetchProject(ref){
    const root = ref.type === 'organization' ? 'organization' : 'user';
    const q = 'query($login:String!,$number:Int!){viewer{login} ' + root + '(login:$login){projectV2(number:$number){' + PROJECT_FIELDS + '}}}';
    return request(q, {login:ref.login, number:ref.number}).then((json) => {
      const data = json.data || {};
      const errors = json.errors || [];
      const p = data[root] && data[root].projectV2;
      if(!p) throw notFound(ref, data.viewer && data.viewer.login, errors);
      const selects = (p.fields.nodes || []).filter((f) => f && f.options);
      const field = selects.find((f) => f.name.toLowerCase() === 'status') || selects[0];
      if(!field) throw new GithubError('no-status', 'El proyecto no tiene un campo de estado (Status) con columnas.');
      return {id:p.id, title:p.title, url:p.url, fieldId:field.id, fieldName:field.name, options:field.options};
    });
  }

  const ITEM_FIELDS = 'id updatedAt isArchived ' +
    'status:fieldValueByName(name:$field){... on ProjectV2ItemFieldSingleSelectValue{optionId}} ' +
    'content{__typename ' +
      '... on DraftIssue{id title body updatedAt} ' +
      '... on Issue{id title body url number state updatedAt repository{nameWithOwner} labels(first:20){nodes{name color}} ' +
        'closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number url state title}}} ' +
      '... on PullRequest{id title body url number state updatedAt repository{nameWithOwner} labels(first:20){nodes{name color}}}}';

  /* Todos los elementos del proyecto (sin archivados). */
  function fetchItems(projectId, fieldName){
    const q = 'query($id:ID!,$field:String!,$after:String){node(id:$id){... on ProjectV2{items(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{' + ITEM_FIELDS + '}}}}}';
    const all = [];
    const page = (after, n) => graphql(q, {id:projectId, field:fieldName, after:after}).then((data) => {
      const items = data.node && data.node.items;
      if(!items) throw new GithubError('not-found', 'No se pudieron leer los elementos del proyecto.');
      items.nodes.forEach((it) => { if(it && !it.isArchived && it.content) all.push(it); });
      if(items.pageInfo.hasNextPage && n < MAX_PAGES) return page(items.pageInfo.endCursor, n + 1);
      return all;
    });
    return page(null, 1);
  }

  function setStatus(projectId, itemId, fieldId, optionId){
    const q = 'mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id updatedAt}}}';
    return graphql(q, {p:projectId, i:itemId, f:fieldId, o:optionId}).then((d) => d.updateProjectV2ItemFieldValue.projectV2Item);
  }

  /* Borrador nuevo en el proyecto. Devuelve {id (elemento), updatedAt, contentId}. */
  function addDraft(projectId, title, body){
    const q = 'mutation($p:ID!,$t:String!,$b:String){addProjectV2DraftIssue(input:{projectId:$p,title:$t,body:$b}){projectItem{id updatedAt content{... on DraftIssue{id}}}}}';
    return graphql(q, {p:projectId, t:title, b:body || ''}).then((d) => {
      const it = d.addProjectV2DraftIssue.projectItem;
      return {id:it.id, updatedAt:it.updatedAt, contentId:it.content && it.content.id};
    });
  }

  function updateDraft(draftId, title, body){
    const q = 'mutation($d:ID!,$t:String!,$b:String){updateProjectV2DraftIssue(input:{draftIssueId:$d,title:$t,body:$b}){draftIssue{id updatedAt}}}';
    return graphql(q, {d:draftId, t:title, b:body || ''}).then((d) => d.updateProjectV2DraftIssue.draftIssue);
  }

  function updateIssue(issueId, title, body){
    const q = 'mutation($i:ID!,$t:String!,$b:String){updateIssue(input:{id:$i,title:$t,body:$b}){issue{id updatedAt}}}';
    return graphql(q, {i:issueId, t:title, b:body || ''}).then((d) => d.updateIssue.issue);
  }

  /* Etiquetas de un repositorio: [{id, name, color, description}]. */
  function fetchRepoLabels(repo){
    const parts = String(repo).split('/');
    const q = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){labels(first:100){nodes{id name color description}}}}';
    return graphql(q, {o:parts[0], n:parts[1]}).then((d) => (d.repository && d.repository.labels.nodes) || []);
  }

  function changeLabels(mutation, labelableId, labelIds){
    const q = 'mutation($i:ID!,$l:[ID!]!){' + mutation + '(input:{labelableId:$i,labelIds:$l}){labelable{... on Issue{updatedAt} ... on PullRequest{updatedAt}}}}';
    return graphql(q, {i:labelableId, l:labelIds}).then((d) => d[mutation].labelable);
  }
  const addLabels = (id, labelIds) => changeLabels('addLabelsToLabelable', id, labelIds);
  const removeLabels = (id, labelIds) => changeLabels('removeLabelsFromLabelable', id, labelIds);

  /* Actividad de una incidencia o pull request (línea de tiempo). Si GitHub
     no reconoce algún tipo de evento, se reintenta con menos. */
  const PR = '... on PullRequest{number title url}';
  const ACTOR = 'createdAt actor{login}';
  const EVENTS_BASIC = [
    '... on AssignedEvent{' + ACTOR + ' assignee{... on User{login}}}',
    '... on UnassignedEvent{' + ACTOR + ' assignee{... on User{login}}}',
    '... on LabeledEvent{' + ACTOR + ' label{name color}}',
    '... on UnlabeledEvent{' + ACTOR + ' label{name color}}',
    '... on ConnectedEvent{' + ACTOR + ' subject{' + PR + '}}',
    '... on CrossReferencedEvent{' + ACTOR + ' willCloseTarget source{' + PR + '}}',
    '... on ClosedEvent{' + ACTOR + ' closer{' + PR + '}}',
    '... on ReopenedEvent{' + ACTOR + '}',
    '... on IssueComment{createdAt author{login} body}'
  ];
  const EVENTS_PROJECT = [
    '... on AddedToProjectV2Event{' + ACTOR + ' project{title}}',
    '... on ProjectV2ItemStatusChangedEvent{' + ACTOR + ' previousStatus status project{title}}'
  ];

  function detailsQuery(events){
    const body = 'labels(first:20){nodes{name color}} timelineItems(first:100){nodes{__typename ' + events.join(' ') + '}}';
    return 'query($id:ID!){node(id:$id){... on Issue{' + body + ' closedByPullRequestsReferences(first:20,includeClosedPrs:true){nodes{number title url state}}} ' +
      '... on PullRequest{' + body + '}}}';
  }

  function fetchDetails(contentId){
    const tries = [EVENTS_BASIC.concat(EVENTS_PROJECT), EVENTS_BASIC];
    const attempt = (i) => graphql(detailsQuery(tries[i]), {id:contentId}).catch((err) => {
      if(err.code === 'graphql' && i + 1 < tries.length) return attempt(i + 1);
      throw err;
    });
    return attempt(0).then((d) => {
      const n = d.node;
      if(!n) throw new GithubError('not-found', 'No se pudo leer la actividad de GitHub.');
      return {
        labels: (n.labels && n.labels.nodes) || [],
        prs: (n.closedByPullRequestsReferences && n.closedByPullRequestsReferences.nodes) || [],
        events: (n.timelineItems && n.timelineItems.nodes || []).filter((e) => e && e.__typename)
      };
    });
  }

  Workhub.services.github = {
    fetchRepoLabels, addLabels, removeLabels, fetchDetails,
    GithubError, token, tokenKind, setToken, canOAuth, oauth, parseProjectUrl,
    fetchProject, fetchItems, setStatus, addDraft, updateDraft, updateIssue
  };
})();
