# CONTEXT.md: todo lo necesario para seguir en otro chat

> Pega esto al empezar: *"Lee CONTEXT.md del repo yalerooo/Workhub y continúa desde ahí."*

---

## 1. El proyecto

**Workhub** es un gestor de trabajo por cliente para una persona que trabaja con varios clientes. Los datos reales incluyen Finba – RIBA, Mondragón Unibertsitatea, UNIA, Institut de Teatre e Interno.

Secciones:
- Tareas (tablero kanban)
- Calendario (reuniones y fechas límite)
- Contraseñas (gestor cifrado)
- Clientes y contactos (una sola sección)
- Plugins
- Copia de seguridad
- Ajustes

Encima de todo va el selector de **proyectos**: cada proyecto es un tablero independiente con sus propios datos.

- **Web en producción:** https://workhub-project.netlify.app (Netlify).
- **Repositorio:** `yalerooo/Workhub` (GitHub), rama principal `main`.
- **Ramas de trabajo de Claude:** se trabaja en un worktree con su propia rama y se sube ahí; después se abre (o el usuario abre) el pull request contra `main`.
  - La rama más reciente es **`claude/context-docs-review-985e75`** (PR #31–#40, todos fusionados; el último cambio, los nombres de los botones de GitHub, va en el siguiente PR). Antes: `claude/read-context-md-df6b13` (PR #25–#30) y `claude/sleepy-brown-tdi6yq`.
  - Si el último pull request ya está fusionado, se reinicia la rama desde `origin/main` (`git checkout -B <rama> origin/main`) o se hace `git merge origin/main`.
  - **En el equipo Windows del usuario no hay `gh`**: no se pueden abrir PR desde aquí. Se sube la rama y se da el enlace `https://github.com/yalerooo/Workhub/pull/new/<rama>` (el usuario lo abre y lo fusiona él).
- **Estado del despliegue (30-sep-2026):** Netlify se quedó **sin créditos de build** (los despliegues de producción salen «Skipped» y hay un aviso de «operational credits»); la web publicada sigue viva pero con código antiguo hasta el siguiente ciclo de facturación o hasta mejorar el plan. Alternativa ya configurada: **Firebase Hosting** (`https://workhub-26f50.web.app`, mismos datos): `firebase login` y `firebase deploy --only hosting` desde `main` (el `predeploy` ejecuta `scripts/build-public.js`). Se habló de Vercel/Cloudflare Pages solo como entorno de pruebas; no se ha montado (haría falta `vercel.json` con las cabeceras y las redirecciones de `/__/auth/*`, y autorizar el dominio en Firebase, Google y GitHub).
- **Firebase:** proyecto `workhub-26f50` (Auth + Firestore).
- **Correo del usuario:** yaleros2@gmail.com.

## 2. Preferencias y reglas del usuario (importante)

- Todo **en español**: conversación, commits y pull requests.
- **Crea los pull requests tú mismo** siempre que termines algo, en español y con explicaciones claras (secciones *Qué cambia*, *Cómo funciona*, *Pruebas*). No hace falta preguntar. Si GitHub falla, reintenta; el usuario llegó a decir "haz tú el pull request". Sin `gh` (caso actual), sube la rama y da el enlace `pull/new/{rama}`; el usuario los fusiona.
- El cuerpo del pull request termina con "🤖 Generated with [Claude Code](https://claude.com/claude-code)".
- **Solo Netlify.** claude.ai ya no se usa como alojamiento. El código aún soporta ese modo, pero no es prioritario.
- **NUNCA publiques ni pegues `data-backup.json`.** Contiene datos reales de clientes.
  - Está en el repositorio, pero `scripts/build-public.js` usa una lista blanca y solo publica `index.html`, `assets`, `src` y `plugins`.
- **NUNCA pegues ni subas el client secret de GitHub OAuth.** Solo va en la consola de Firebase.
- **Tokens:** el acceso a GitHub de la integración no se guarda en ningún fichero ni en Firestore, solo en el navegador. Si el usuario pega un token en el chat, no se usa; se le recuerda que no lo haga (aunque diga que ya lo borró). **Prefiere no pegar tokens nunca**: hay «Conectar con GitHub» (OAuth) y hay que seguir ese criterio en cualquier integración futura.
- **Cuentas nuevas sin proyecto por defecto:** el usuario no quiere que se cree ningún proyecto por su cuenta; hay que elegir nombre y tipo (ver «Primer proyecto»). Y quiere poder **borrar también el primero**.
- **PROHIBIDO en cualquier diseño: rayas o barras de acento en el lateral de un elemento** (una línea de color a la izquierda de un elemento seleccionado, de una tarjeta, de un aviso, de una cita, etc.: `border-left`/`border-right` de color, `box-shadow: inset 2px 0 0 …`, pseudoelementos que dibujan una barra…). El usuario dijo que «queda horrible» y que **no lo quiere en ningún diseño**. Para marcar un elemento seleccionado o destacado se usa el **fondo suave de acento** (`--accent-soft`), el color del texto, un borde completo o un punto/insignia, como ya hace el resto de la web. Vale también para lo que se añada en el futuro y para los plugins.
- **Nombres de botones claros:** si dos acciones se parecen («Desconectar» / «Desconectar cuenta»), el usuario se confunde; usar verbos distintos y una ayuda al pasar el ratón.
- **Cuando el usuario pega un error, mira el texto exacto y no lo des por explicado**: un `permission-denied` de Firestore parecía «reglas sin publicar» y era el límite de los lotes (ver §9). Los mensajes de error deben decir el paso que falló.
- El usuario pide cambios de forma directa y con libertad de diseño; cuando algo no puede verificarse contra un servicio real (GitHub, Firebase), hay que decirlo claramente en el resumen.
- La visibilidad de producción en Netlify debe seguir en **Public**.
- Cualquiera puede **crearse una cuenta**, no solo el usuario. El correo tiene que verificarse.
- Estética: **minimalista**, estilo Linear/Vercel, **sin emojis**. Usa iconos SVG.
- Todo debe ser **responsive**: pantallas grandes, portátil, tablet y móvil.
- El usuario da libertad de diseño ("hazlo como tú veas").
- Si el usuario pide las reglas de Firestore, pégalas en el chat (versión sin comentarios), porque las publica él a mano en la consola. Solo tiene permisos para "desarrollar y probar" en algunos sitios. **Cada cambio de `firestore.rules` hay que recordárselo**: sin publicarlas, los equipos no funcionan.
- Entra con **Google** (a veces también prueba en incógnito). Trabaja con varios navegadores/dispositivos: por eso pide que el enlace con GitHub y los accesos funcionen «en cada navegador» sin fricción.

## 3. Arquitectura técnica

- **JavaScript sin frameworks ni build.** Scripts clásicos cargados en orden desde `index.html` y un espacio de nombres global `Workhub` (`src/core/namespace.js`).
- **Patrón MVC:**
  - `src/models/`: datos y lógica. `CollectionModel` sincroniza en memoria y emite `change`.
  - `src/views/`: solo DOM. Exponen `bindX(handler)`.
  - `src/controllers/`: conectan modelos y vistas.
  - `src/services/`: plataforma, Firebase, cifrado, host de plugins, preferencias, plugins oficiales y `github-api.js` (cliente GraphQL de GitHub).
  - `src/utils/`: html/iconos, fechas, urls, ui, autoscroll.
  - `src/core/`: namespace, emitter, local-storage-shim.
  - `src/i18n/`: traducciones.
  - `src/config/firebase-config.js`: configuración de Firebase.
- **Arranque:**
  1. `src/boot.js` se carga pronto. Pone la clase `auth-gate` si hay Firebase (oculta la app hasta el login), `i18n-pending` si el idioma no es español, y el tema guardado.
  2. `src/main.js` llama a `Workhub.i18n.observe()`, quita `i18n-pending` y crea `AppController` y `AuthController`.
- **Modos de datos:**
  - Con Firebase configurado y servido por http(s), hay que iniciar sesión y los datos van a Firestore.
  - **Modo invitado** (botón «Continuar como invitado» en el login): solo un nombre, sin cuenta ni Firebase; datos en IndexedDB (mismo almacén que el modo local). Se recuerda en `localStorage['workhub_guest']` ({name}); `AuthController.gate()` salta Firebase por completo si existe. Salir lo borra pero deja los datos del navegador.
  - Sin `apiKey`, la app funciona en **modo local** con IndexedDB, sin login ("Modo local" abajo en la barra lateral).
  - `start-workhub.bat` lanza el modo local en Windows.
- **Firebase** (`src/config/firebase-config.js`):
  - `hostingDomains: ['workhub-project.netlify.app']`.
  - `providers: ['google','github','password']` (Microsoft se quitó).
  - `allowSignup: true`, `useEmulators: false`.
  - Netlify redirige `/__/auth/*` y `/__/firebase/*` a `workhub-26f50.firebaseapp.com`, así el login se completa en el propio dominio.
  - El login usa popup y, si falla, redirect.
  - Al cerrar sesión se ejecuta `clearPersistence` (se borra la caché local).
- **Ficheros de las últimas tandas** (todos con `<script>`/`<link>` en `index.html`, en este orden relativo): `models/project-templates.js` (antes de `task-model.js`), `models/github-sync.js`, `models/team-model.js` (después de `project-model.js`), `services/github-api.js`, `views/labels.js`, `views/team-ui.js` (justo después de `labels.js`), `views/column-view.js`, `views/github-view.js`, `views/share-view.js`, `controllers/github-controller.js`, `controllers/team-controller.js`, `assets/css/views/github.css` y `assets/css/views/team.css`. Fuera de `src`: `docs/EQUIPOS.md` y `tests/rules/`.
- **Estructura en Firestore:**
  - Proyecto principal: `users/{uid}/{tasks|clients|contacts|meetings|vault|vault_meta|plugin_data}/…`.
  - Notas de cada tarea: `users/{uid}/tasks/{id}/notes/{id}`.
  - Otros proyectos personales: `users/{uid}/projects/{projectId}/{misma colección}/…`.
  - Del usuario, comunes a todos sus proyectos: `users/{uid}/projects` (lista; el documento `main` guarda nombre/tipo del principal o `deleted:true`), `assets` (imágenes de notas), `settings` (acento, tema e idioma), `plugins` (instalados).
  - **Proyectos de equipo** (compartidos): `teams/{id}` (documento con la config del proyecto + `ownerUid`, `memberIds[]`, `members{uid:{role,name,email,photo}}`) y debajo `tasks` (con `notes`), `clients`, `contacts`, `meetings`, `plugin_data`, `assets`. **Sin `vault`**.
  - **Invitaciones**: `invites/{idEquipo}_{correo en minúsculas}` = `{teamId, teamName, email, role, invitedByUid, invitedByName, createdAt}`.
- **Reglas** (`firestore.rules`, **se publican a mano en la consola**):
  - `canUse(uid)` exige `auth.uid == uid`, y además correo verificado si el proveedor es `password`; `verified()` es lo mismo sin uid.
  - Solo se permiten las colecciones de la lista blanca. Todo lo demás está cerrado.
  - Equipos: lee quien está en `memberIds`; escriben datos propietario y editor; el propietario cambia todo menos `ownerUid`; un editor no toca `memberIds/members`; entrar exige una invitación a tu correo verificado con el rol invitado y sin cambiar nada más; cualquiera que no sea propietario puede salir; invitar/cancelar solo el propietario; leer/rechazar una invitación solo su destinatario.
  - Probadas con `tests/rules` (59 casos contra el emulador; ver §9).
- **Publicación en Netlify** (`netlify.toml`):
  - Build: `node scripts/build-public.js`, publica `dist/`.
  - Cabeceras de seguridad:
    - `X-Frame-Options: DENY`, HSTS, `nosniff` y `Permissions-Policy`.
    - **CSP estricta**: sin scripts en línea; `script-src` solo el propio dominio más gstatic y apis.google.
    - `frame-src 'self' https: http://localhost:* http://127.0.0.1:*`, para los plugins.
    - `connect-src` incluye `https://api.github.com` (integración con GitHub Projects) en las dos cabeceras de `netlify.toml`.
  - Si añades un servicio externo, añade su dominio a la CSP.
- **Documentación:**
  - `README.md`: todo el funcionamiento, sección Plugins y sección Idiomas.
  - `docs/FIREBASE.md`, `docs/NETLIFY.md`.
  - `docs/SEGURIDAD.md`: pasos en la consola, como publicar reglas, política de contraseñas, protección contra la enumeración de correos, dominios autorizados y restringir la API key.
  - `docs/PLUGINS.md`: guía completa para crear plugins.
  - `docs/GITHUB.md`: integración con GitHub Projects (conectar con un clic o con token, qué se sincroniza, en equipos, límites, seguridad, estructura interna).
  - `docs/EQUIPOS.md`: trabajo en equipo (uso, roles, cómo se guarda, límite de lotes de Firestore, reglas, diseño de la fase de contraseñas compartidas).
  - `tests/rules/`: pruebas de las reglas con el emulador (`README.md`, `package.json`, `rules-test.js`).

## 4. Funcionalidades (estado actual)

### Tareas (tablero)
- **Estados**, en `task-model.js` `STATUSES`: `pendiente` (Pendiente), `proceso` (En proceso), `espera` (Esperando al cliente), `completada` (Completada).
- **Campos de la tarea:** `title`, `desc`, `cliente`, `status`, `contacto`, `dueDate` (YYYY-MM-DD), `order`, `createdAt`, `updatedAt`, `labels`, contactos y contraseñas vinculados, `assignees` (uids, solo en equipos) y notas en una subcolección (`text`, `imageAssetId`, `createdAt`).
- **Tablero:**
  - Ocupa el alto de la ventana y cada columna tiene su propio scroll.
  - Arrastrar y soltar con autoscroll y una línea que marca dónde caerá la tarea. El orden se guarda en `order`.
  - El botón **+** de cada columna crea una tarea con ese estado.
- **Ficha de tarea** (solo lectura, al hacer clic):
  - Muestra estado, cliente, fecha límite con "Faltan N días / Venció hace N días", contacto, descripción, notas con imágenes y vínculos.
  - Botón **Editar tarea**; al guardar o cancelar se vuelve a la ficha.
- **Filtros:** buscador (título, cliente, contacto, etiquetas y nombres de asignados), selector de cliente y, en equipos, selector de miembro (*Todos los miembros*, *Asignadas a mí*, *Sin asignar*, una persona; `TaskModel.filter(query, cliente, assignee)`).
- **Atajos:** `N` crea una tarea y `/` enfoca el buscador (no funcionan mientras escribes ni con un diálogo abierto).

### Tipos de proyecto (etapas y clientes)
- Al crear o editar un proyecto se elige el tipo (`src/models/project-templates.js`, `ProjectTemplates`):
  - **soporte**: Pendiente, En proceso, Esperando al cliente, Completada; con clientes. Es el de siempre y el del proyecto principal (claves `pendiente`, `proceso`, `espera`, `completada`).
  - **desarrollo**: Por hacer, En curso, Hecho; sin clientes (estilo GitHub).
  - **kanban**: Backlog, En curso, En revisión, Hecho; sin clientes.
  - **personalizado**: 2 a 8 etapas con nombre, color (gray, blue, orange, green, red, violet) y orden, una o varias finales, casilla "trabaja con clientes".
  - **Desde GitHub** existe solo en el diálogo de crear (pseudo-tipo `github`): no se guarda como tipo; crea un proyecto personalizado ya enlazado.
- Se guarda en el documento del proyecto: `tipo` (y `stages`, `clients` solo si es personalizado). Sin `tipo` = soporte, así que no hubo migración. Se copian `tipo`, `stages`, `clients` y `labels` también en `workhub_project` (localStorage) para pintar bien antes de que llegue la lista de proyectos.
- `TaskModel.STATUS` es un único array que `TaskModel.setStages()` rellena en el sitio al abrir o editar un proyecto (`AppController.applyProjectConfig`, que solo repinta si cambió la configuración). Se usa `TaskModel.isDone(t)` (nunca `'completada'` fijo) y `TaskModel.stageKey(t)`, que manda a la primera etapa las tareas cuyo estado ya no existe (etapa borrada, copia importada de otro tipo).
- **Sin clientes**: `body.no-clients` y la clase `.needs-clients` en el HTML (JS `ShellView.setClientsEnabled`) ocultan la sección Clientes, filtros, campos y etiquetas de cliente; tareas y credenciales no piden cliente (`AppController.clientsEnabled()`); `Workhub.clientsEnabled` lo leen las vistas. Los contactos viven en Clientes, así que desaparecen con ella.
- `ProjectModel.patch(id, campos)` cambia campos sueltos sin perder el resto (null quita el campo); `ProjectModel.save` conserva `github` y `labels`.

### Columnas del tablero
- Cada cabecera tiene un menú «···» (`ColumnView`, `TasksController.bindColumns`): **editar detalles** (nombre, color, límite, "cuenta como terminada"), **establecer límite**, **ocultar de la vista**, **eliminar columna** (sus tarjetas pasan a la primera), **eliminar todas las tarjetas**, **mover izquierda/derecha**. También se reordenan arrastrando la cabecera (MIME propio `text/x-workhub-column`; `bindDragAndDrop` acepta `accept(ev)` para ignorar ese arrastre).
- **Límite** opcional (`stage.limit`, 1–999; sin límite por defecto). Solo avisa: la cuenta pasa a `3/2` y se pone roja; no impide añadir.
- Ocultar es local al navegador (localStorage `workhub_hidden_{proyectoId}`), con enlace «N columnas ocultas · Mostrar» en el resumen; siempre queda una visible.
- Todo cambio de columnas pasa por `ProjectsController.updateStages(fn)`: convierte el proyecto en personalizado, se ve al instante y luego guarda. No hay «archivar» (las tareas no tienen archivo). Con más de 4 columnas el tablero se desplaza en horizontal en escritorio (`--cols`, `.is-many`).

### Etiquetas
- `labels` (array de nombres) en cada tarea; el catálogo del proyecto es `labels: [{name, color}]` (color hex sin #) en el documento del proyecto. `Workhub.views.labels` (`views/labels.js`) tiene el catálogo, la paleta y el HTML de las etiquetas y de los chips de pull request.
- Se eligen o crean en el formulario de la tarea (`ProjectsController.addLabel`); se muestran en tarjetas (máx. 3 + «+N») y en la ficha; la búsqueda del tablero también mira las etiquetas. La copia de seguridad las exporta e importa.

### Integración con GitHub Projects (`docs/GITHUB.md`)
- **Conectar**: *Nuevo proyecto → Desde GitHub* (crea un proyecto nuevo) o *Ajustes → GitHub Projects* (selector de destino: proyecto existente —por defecto el abierto, avisa de que sus columnas se sustituyen— o «+ Crear un proyecto nuevo»). Cada proyecto de Workhub puede enlazarse con un GitHub Project distinto.
- **API**: GraphQL de GitHub (Projects v2) con un acceso con permiso `project`, guardado solo en `localStorage` (`workhub_gh_token`, nunca en Firestore, **cada navegador el suyo**). Dos formas de obtenerlo: **(a) «Conectar con GitHub»** (OAuth, sin token; ver más abajo) o **(b) un token clásico pegado**. Los *fine-grained* no funcionan con proyectos de usuario (la app lo detecta y lo explica). `api.tokenKind()` distingue `'oauth'` (empieza por `gho_`) de `'token'` (`ghp_…`) para pintar la interfaz. Los errores distinguen: sin token, token rechazado, sin permiso `project`, token de otra cuenta, número de proyecto inexistente. Un token rechazado se borra solo y la sincronización periódica se detiene hasta que el usuario lo arregle.
- **Modelo**: config en el doc del proyecto, campo `github` = `{type, login, number, projectId, fieldId, fieldName, title, url, pushNew, pushFrom, ignored[]}`. Cada tarea enlazada guarda `ghItemId`, `ghContentId`, `ghType` (DraftIssue | Issue | PullRequest), `ghUrl`, `ghNumber`, `ghRepo`, `ghPrs`, `ghLabels`, `ghSyncedAt` y `ghRemoteAt`. Cambio local = `updatedAt > ghSyncedAt`; cambio remoto = fecha en GitHub `> ghRemoteAt`; si cambian ambos gana el más reciente. `TaskModel.saveSynced/markSynced` escriben sin contar como cambio local.
- **Columnas**: las opciones del campo Status son las columnas (clave `g`+id de la opción; color de GitHub → uno de los 6; final = nombre tipo done/hecho o la última). Las columnas nuevas de GitHub se añaden solas; renombrar no se propaga en ningún sentido.
- **Qué se sincroniza**: mover, título y descripción en ambos sentidos (borradores e issues; las PR solo bajan); elementos nuevos de GitHub → tareas; tareas nuevas de Workhub → borradores del proyecto (solo las creadas después de conectar salvo que se marque enviar las existentes; opción `pushNew`); etiquetas en ambos sentidos (solo las que existen en el repo; el catálogo se alimenta de las etiquetas de los repos); pull requests vinculadas como chips (verde abierta, morada fusionada, roja cerrada); la ficha muestra la actividad de la incidencia (asignaciones, etiquetas, movimientos en el proyecto, PRs vinculadas, cierres, comentarios) pedida bajo demanda (`fetchDetails`, cache 1 min, con reintento sin `ProjectV2ItemStatusChangedEvent` por si la API no lo reconoce). **Borrar no se sincroniza**: lo borrado en Workhub se apunta en `github.ignored` (`TaskModel` emite `removed`) y no se reimporta.
- **Cuándo**: al abrir el proyecto, al volver a la pestaña (>30 s), al recuperar conexión, cada 2 min y 2 s después de un cambio local pendiente; botón «GitHub» en la barra de Tareas, «Sincronizar ahora» en Ajustes y acción en `Ctrl K`. Límite: 2000 elementos, 8 columnas, 100 etiquetas por repo.
- **Piezas**: `services/github-api.js`, `models/github-sync.js` (motor: `link`, `sync`, `_pull`, `_push`, `_loadRepoLabels`, `canSync`, `canCreate`), `controllers/github-controller.js` (temporizadores, `createFromGithub`, `loadDetails`, `saveToken`, `connectOAuth`), `views/github-view.js`. Ojo con la carrera de `ProjectModel.loaded`: el controlador reacciona a `projects.change` con un microtask.
- **Enlazado pero sin acceso en este navegador** (p. ej. entras desde otro navegador o eres un miembro nuevo del equipo): la tarjeta de Ajustes muestra un aviso, el botón «Conectar con GitHub» (si hay OAuth) y un campo para pegar un token; el botón de la barra de Tareas pasa a «Añadir token de GitHub» (en rojo) y, sin acceso, «Sincronizar» lleva a Ajustes. Ya no se queda mudo.
- **Conectar con GitHub sin token (OAuth)**: `firebase.githubToken()` (en `firebase-backend.js`) abre el popup de GitHub con `addScope('project')` en una **segunda instancia de Firebase** (`gh-oauth`, sin persistencia) para no tocar la cuenta con la que se entró (evita `account-exists-with-different-credential`; si aun así salta ese error se usa `err.credential.accessToken`), recoge `credential.accessToken`, cierra la sesión temporal (o la borra si era una cuenta nueva) y `connectOAuth()` lo guarda en `workhub_gh_token`. Solo se ofrece si `Workhub.services.github.canOAuth()`: **backend en modo `firebase`** (ojo: `firebase.isEnabled()` devuelve falso una vez iniciada la sesión, por eso se comprueba `platform.mode()`) y `'github'` en `providers`. Requiere el proveedor GitHub activado en Firebase; si el proyecto es de una organización, esta tiene que aprobar la aplicación OAuth.
- **Botones** (Ajustes, proyecto enlazado): «Sincronizar ahora»; **«Desvincular proyecto»** (quita el enlace con el GitHub Project, no borra tareas); **«Olvidar token»** (token pegado) o **«Quitar mi acceso a GitHub»** (acceso OAuth): ambos quitan el acceso de este navegador y el proyecto sigue enlazado; «Conectar con GitHub en su lugar» solo si el acceso es un token pegado. Con OAuth conectado se muestra «Conectado con tu cuenta de GitHub en este navegador».
- **En equipos** (ver «Trabajo en equipo»): `convert()` copia `github` (sin token) al equipo y desenlaza el original; cada miembro conecta su cuenta; **solo el propietario crea al cruzar** (elemento nuevo de GitHub → tarea, tarea nueva → borrador) para no duplicar cuando varios sincronizan; mover/editar/etiquetas se sincronizan desde cualquiera (idempotente); los **lectores no sincronizan**.
- **Pendiente / sin verificar**: la sincronización se probó contra una **API de GitHub simulada** (fetch reemplazado), no contra la real; y el OAuth solo hasta la petición del popup con el emulador de Auth (URL con `appName=gh-oauth&scopes=project`). Hay que probar con GitHub real: sincronización (actividad, `closedByPullRequestsReferences`) y «Conectar con GitHub» (que devuelva de verdad un `gho_…` con acceso a los Projects, sobre todo con proyectos de organización).

### Calendario
- **Vista mensual** con reuniones (morado, `--meet`), fechas límite de tareas y tareas vencidas (rojo).
- **Panel lateral del día elegido**, con los botones "+ Reunión" y "Tarea en esta fecha".
- **Interacción:**
  - Arrastrar una tarea o reunión a otro día la mueve.
  - Doble clic en un día crea una reunión.
- **Reunión:** `title`, `cliente`, `date`, `start`, `end` (debe ser posterior al inicio), `link` (se valida y rechaza `javascript:`) y `notas`.

### Contraseñas (vault)
- **Cifrado:** Web Crypto, PBKDF2-SHA256 con 300 000 iteraciones más AES-GCM 256 (`src/services/crypto.js`).
- **Contraseña maestra** por proyecto, de al menos 8 caracteres.
- **Clave de recuperación:**
  - Formato `XXXX-XXXX-…`; se descarga un .txt y hay que confirmar que se ha guardado.
  - Al usarla se genera una nueva y la anterior deja de valer.
- **Tipos**, en `vault-model.js`: `correo` (Correo / Web), `usuario` (Usuario / Web), `servidor`, `rdp` (con puerto y dominio), `vpn`.
- **Interfaz:**
  - Ver y editar están separados.
  - Se pueden reordenar arrastrando.
  - Se pueden vincular a tareas.
  - Botón para bloquear.
  - Filtros por cliente y por tipo.

### Clientes y contactos (una sola sección)
- **Diseño:** lista de clientes a la izquierda (etiqueta «Clientes N», avatar, nº de contactos y una **insignia con las tareas abiertas**; el elegido se marca con el fondo de acento, sin raya lateral) y ficha a la derecha.
- **Ficha del cliente:**
  - Cabecera con avatar grande (clic = color), nombre y «N tareas en total».
  - **Tres tarjetas de cifras** (`.crm-stats`): Contactos, Tareas abiertas y Contraseñas; las dos últimas son botones que llevan a esa sección (`view-tasks` / `view-vault`). Los botones de plugins (`client.actions`) van debajo y el bloque solo se ve si hay alguno.
  - Personas de contacto como **tarjetas** en cuadrícula (`.people`, una columna en móvil): email y teléfono se pueden pulsar, las notas van separadas con línea discontinua y el lápiz aparece al pasar el ratón. Con contador en la cabecera y, si no hay ninguna, un cuadro vacío con «Añadir contacto».
  - Acciones para cambiar el color, renombrar o eliminar (con confirmación).
- **Edición:** al editar un cliente se editan ahí mismo sus personas de contacto.
- **Buscador:** busca a la vez clientes y personas (nombre, email, teléfono o notas) y resalta las coincidencias.
- **Sin cliente:** los contactos cuyo cliente se eliminó aparecen en "Sin cliente".
- **Renombrar** un cliente actualiza sus tareas, reuniones, contactos y contraseñas.
- **Color del cliente:** tono HSL en el campo `color`; "Auto" lo deriva del nombre. Se usa en etiquetas, avatares y desplegables.
- **En móvil** se ve primero la lista y, al elegir un cliente, su ficha.

### Acceso (login) y modo invitado
- Pantalla de acceso: proveedores (Google, GitHub), correo y contraseña, **«Continuar como invitado»**, e idioma. Al pulsar invitado se muestra **solo ese paso** (título «Entrar como invitado», campo «Tu nombre», aviso de que todo queda en el navegador, «Entrar como invitado» y «Volver»); antes se apilaba debajo de todo y la tarjeta se cortaba por arriba.
- El contenedor `.auth-screen` centra con `margin:auto` en los hijos (no `justify-content:center`): si la tarjeta no cabe, se puede desplazar hasta arriba.
- **Modo invitado**: solo un nombre; sin cuenta y sin Firebase (ni se descarga su SDK); datos en IndexedDB (mismo almacén que el modo local). Se recuerda en `localStorage['workhub_guest']` = `{name}`; `AuthController.gate()` salta Firebase si existe. «Salir del modo invitado» borra la marca pero **deja los datos** del navegador (al volver a entrar como invitado siguen). Un solo invitado por navegador. No puede usar equipos ni «Conectar con GitHub».
- El usuario que entra con cuenta y el invitado comparten navegador pero no datos (Firestore vs IndexedDB).

### Proyectos
- **Selector** arriba en la barra lateral: avatar con iniciales y color, nombre y "Workhub". Cambia de proyecto sin recargar. Los de equipo llevan un icono de personas; hay un punto en el botón si tienes invitaciones pendientes.
- **Menú del selector**: invitaciones recibidas (Aceptar/Rechazar), lista de proyectos con lápiz, «Nuevo proyecto» y «Compartir este proyecto» (solo con cuenta).
- **Gestión:** crear, renombrar, cambiar el color, elegir el **tipo** (etapas y clientes, ver más arriba) y eliminar con todos sus datos (con confirmación en dos pasos). Al crear también se puede elegir «Desde GitHub».
- **Primer proyecto (cuentas nuevas)**: si el registro de proyectos (personales y de equipo) está vacío y la raíz no tiene tareas, clientes, contactos, reuniones ni contraseñas, `ProjectsController.checkFirstRun` abre el diálogo de proyecto en modo `onboarding` (`ProjectView.openOnboarding`, «Crea tu primer proyecto»): **sin tipo preelegido** (hay que elegir uno, si no error «Elige un tipo de proyecto.»), sin «Desde GitHub», sin cerrar (ni Esc ni X ni Cancelar) y con `body.is-onboarding` ocultando la app. Al guardar se escribe `projects/main` con lo elegido: **el primer proyecto ES el principal** (misma raíz), no se crea ningún otro. Las cuentas con datos o proyectos no lo ven. Si la cuenta nueva tiene **invitaciones pendientes**, aparecen dentro de este diálogo; aceptar una lleva al equipo y deja `projects/main` = `{deleted:true}` (no se queda con un proyecto vacío por defecto).
- **"Proyecto principal"** usa la raíz de la base de datos. **Sí se puede eliminar** (`ProjectModel.removeProject` vacía la raíz y deja `projects/main` = `{deleted:true, createdAt:0}`; `list()` lo oculta). Al borrar el abierto se pasa al primero que quede; si no queda ninguno, `checkFirstRun` reabre «Crea tu primer proyecto» (que reescribe `projects/main` sin `deleted`). El último proyecto abierto se recuerda (`workhub_project`).

### Trabajo en equipo (`docs/EQUIPOS.md`)
- **Qué es**: un proyecto compartido con otras cuentas; todos ven el mismo tablero en tiempo real y las tareas se asignan. Requiere cuenta (Firebase); invitado y modo local no tienen equipos (`TeamModel.enabled()` = `db.teams && db.me`).
- **Roles**: *owner* (todo: invitar, roles, quitar, config, borrar; solo uno), *editor* (datos y config, no miembros), *viewer* (solo lectura: `body.is-readonly` oculta `#btnNew`, `.col-add`, editar; tarjetas no arrastrables; el servidor rechaza escrituras). Quien no es propietario puede salir; el propietario tiene que eliminar el proyecto.
- **Flujo**: menú de proyectos → «Compartir este proyecto» (o `Ctrl K` → «Compartir proyecto»). Si es personal, **«Convertir en proyecto de equipo»**; si ya es de equipo, lista de miembros + invitar por correo con rol + invitaciones pendientes (+ «Salir del equipo»). La persona invitada tiene que entrar con **ese correo, verificado**; ve la invitación en el menú (o en «Crea tu primer proyecto» si es cuenta nueva).
- **Convertir** (`TeamModel.convert(project, onProgress)`): crea `teams/{id}` con la config (`tipo, stages, clients, labels, github`), copia tareas (con notas), clientes, contactos, reuniones, `plugin_data` y las imágenes de las notas al equipo; **no copia las contraseñas** (se quitan los `linkedVault` de las tareas); **el original queda intacto** salvo que su enlace con GitHub se quita (`patch({github:null})`). Copia **de una en una, 12 a la vez** (`runPool`), nunca con `batch`; si algo falla se deshace el equipo a medias y el error dice el paso (`err.phase`: crear el equipo / leer los datos / copiar los datos). El equipo se abre y se ofrece invitar.
- **Cliente**: id `t:{id}` (`ProjectModel.isTeam/teamId/teamKey`); `ProjectModel.list()` mezcla personales y equipos (`team:true`, `role`, `members`) y `loaded` espera a los dos; `ProjectModel.scope(db, 't:…')` → `db.team(id)` (backend: `userDb` añade `db.me`, `db.team(tid)` y `db.teams` con `query/doc/newId/invitesForMe/invitesFrom/invite/batch/FieldValue`). **`ProjectModel.set` de un equipo manda solo los campos que cambian y nunca `ownerUid/memberIds/members`** (para no pisar a quien acaba de entrar). Imágenes: `window.__teamId` (lo fija `AppController.connectProject`) hace que `firebase-backend` guarde/lea en `teams/{id}/assets`.
- **Contexto para las vistas**: `Workhub.views.team` (`views/team-ui.js`: `enabled/role/canEdit/members/meUid/assigned(t)/avatar/stack`); lo fija `ProjectsController.applyTeam` (también `body.team-project`, que oculta la pestaña Contraseñas, y `ShellView.setTeamMode` que muestra/oculta los `.team-only`; los `<select>` con `Dropdown` necesitan ocultar también su envoltorio `.dd`).
- **Asignar**: formulario de tarea («Asignada a», chips de miembros), ficha («Asignada a» con avatares y **«Asignármela» / «Quitar mi asignación»**, `TasksController.toggleMine`), avatares en la tarjeta, filtro por miembro y `Ctrl K` → «Mis tareas» (`showMine`). Si un miembro sale, su asignación se ignora al pintar (`assigned()` filtra).
- **Piezas**: `models/project-model.js` (equipos en la lista, `createTeam`, `roleOf`, `membersOf`, `removeProject` de equipos), `models/team-model.js` (`TeamModel`, `InviteModel`: invite/revoke/accept/decline/setRole/removeMember/leave/convert), `controllers/team-controller.js` + `views/share-view.js` (diálogo `#dlgShare`; ojo: «Cerrar» y la X necesitan un listener propio, `data-dismiss` no hace nada solo), `controllers/projects-controller.js` (`applyTeam`, invitaciones en menú/primer proyecto, `pendingSwitch`), `views/project-view.js`.
- **Sin probar con Firebase real**: solo con los emuladores de Auth y Firestore (dos cuentas: crear, convertir, invitar, aceptar, asignar, cambiar rol a lector, expulsar, salir, eliminar). Hay que probarlo en producción tras publicar las reglas y desplegar.
- **Pendiente**: **contraseñas compartidas con cifrado extremo a extremo por miembro** (acordado; diseño en `docs/EQUIPOS.md`: par de claves por persona, clave de proyecto AES cifrada una vez por miembro en `teams/{id}/keys/{uid}`, rotación al expulsar), comentarios en tareas, registro de actividad, notificaciones, foto/nombre de miembro que se actualice si cambia en su cuenta, avisar al propietario de una invitación aceptada, nombre distinto para la copia al convertir (hoy el equipo y el original se llaman igual y solo los distingue un icono).

### Paleta de comandos (`Ctrl K` / `⌘K`, o el botón "Buscar…" de la barra lateral)
- **Busca** tareas, contactos, reuniones y clientes.
- **Acciones:**
  - Crear: nueva tarea, reunión, contacto, credencial, cliente o proyecto.
  - Cambiar de proyecto.
  - "Ir a {sección}".
  - Cambiar el tema: claro, oscuro o del sistema.
  - Exportar la copia de seguridad.
  - Acciones de los plugins.
  - "Sincronizar con GitHub" (solo si el proyecto está enlazado).
  - En proyectos de equipo: "Mis tareas". Con cuenta: "Compartir proyecto".

### Copia de seguridad
- **Exportar e importar** el proyecto abierto en JSON (`formatVersion`).
- **Contenido:** tareas (con sus etiquetas), notas, contactos, clientes, reuniones y contraseñas **cifradas**. No incluye la configuración de etapas ni el enlace con GitHub; al importar, una tarea con una etapa que no existe en el proyecto aparece en la primera columna.
- Al importar se conservan el puerto y dominio RDP y el orden manual.

### Ajustes (se guardan en la cuenta, `users/{uid}/settings`)
- **Color de acento:** azul (predeterminado, #2F6BFF), lavanda/Violeta (#7C5CFF), rosa (#E0457B), menta/Verde (#16A36A), melocotón/Naranja (#EA6A1F), limón/Ámbar (#E6A310) y grafito (#18181B). Definidos en `settings-model.js` `ACCENTS`.
- **Tema:** Sistema, Claro u Oscuro.
- **Idioma:** Español o English.
- **GitHub Projects:** tarjeta encima de las demás para conectar el proyecto abierto (o uno nuevo) con un GitHub Project; enlazado, muestra el estado, «Sincronizar ahora», el interruptor de enviar tareas nuevas, «Desvincular proyecto» (quita el enlace, no borra tareas) y «Olvidar token» / «Quitar mi acceso a GitHub» (quita el acceso de este navegador; el proyecto sigue enlazado). No se guarda en la cuenta: la config va en el proyecto y el token en el navegador.
- **Almacenamiento:** indica si es modo local o nube.
- En un dispositivo nuevo se adoptan los ajustes de la cuenta.

### Avisos (toasts)
- Confirmación breve al crear, guardar, mover o eliminar, y aviso de error.
- Aparecen abajo a la derecha.

### Desplegables
- Cada `<select>` se muestra con `Dropdown` propio (`src/views/dropdown.js`).
- Buscador a partir de 8 opciones y manejo con teclado.
- El `<select>` real sigue existiendo oculto, y es el que leen los controladores.

## 5. Diseño (sistema visual)

- **Tipografía:** Geist y Geist Mono (Google Fonts).
- **Tokens** en `assets/css/tokens.css`:
  - Claro: bg `#FAFAFA`, sidebar `#F4F4F5`, surface `#FFFFFF`, ink `#18181B`, ink-soft `#56565F`, ink-faint `#8E8E97`, line `#E6E6E9`.
  - Oscuro: bg `#0F0F11`, surface `#161619`, ink `#EDEDEF`, line `#26262B`.
  - Colores de estado:
    - pendiente: gris `#71717A`
    - proceso: azul `#2563EB`
    - espera: naranja `#C2690A`
    - completada: verde `#15803D`
    - peligro: `#DC2626`
    - reunión: `#7C3AED`
    - En oscuro, cada uno tiene su versión más clara.
  - Radios: sm 5, md 7, lg 10, xl 12 px.
  - Sombras suaves: `--shadow-sm`, `--shadow`, `--shadow-lg`, `--shadow-pop`, `--shadow-drag`.
  - Etiquetas de cliente: `--h` (tono) con `--chip-s`/`--chip-bg-l`/`--chip-fg-l`/`--chip-dot-l`.
- **Tema:** `data-theme="light|dark"` en `<html>`, o sin atributo para seguir el sistema (`prefers-color-scheme`).
- **Acento:** lo inyecta `SettingsView.applyAccent` con las variables `--acc-*`.
- **Layout:**
  - Barra lateral fija a la izquierda:
    - arriba, el selector de proyecto;
    - debajo, "Buscar… Ctrl K";
    - navegación: Tareas, Calendario, Contraseñas, Clientes;
    - grupo "Sistema": Plugins, Copia de seguridad, Ajustes;
    - abajo, el indicador de modo o cuenta.
  - Contenido: título grande, subtítulo gris y una línea separadora.
- **CSS:**
  - `assets/css/`: `tokens`, `base`, `layout`, `responsive`, `components/` y `views/`.
  - `components/`: buttons, cards, dialogs, dropdown, extensions, forms, overlays, projects, toolbar.
  - `views/`: auth, board, calendar, clients, plugins, settings, task-detail, vault.
- **Responsive** (`responsive.css`):
  - ≥1600 px y ≥2200 px: más ancho y espacio.
  - 901–1279 px: portátil.
  - ≤900 px: tablet/móvil; la barra lateral pasa a pestañas o cajón.
  - ≤600 px: móvil.
  - ≤380 px: móvil pequeño.
  - Sin scroll horizontal en ninguna vista (probado a 360, 390, 768, 1024, 1366, 1920 y 2560 px).
- **Iconos:** SVG de trazo, al estilo Lucide. Los de plugins están en `src/views/plugin-icons.js`: puzzle, chart, trending, pie, timer, clock, calendar, check, list, kanban, users, briefcase, mail, message, bell, file, folder, book, database, download, link, globe, tag, wallet, target, bolt, sparkles, code, shield, star.
- **Tarjetas:** fondo surface, borde 1px `--line`, radio lg, `shadow-sm`; al pasar el ratón, `line-strong` y `shadow`. Mismo acabado en clientes, contraseñas y plugins.
- **Etiquetas y PRs**: `.label-chip` (color con `--lc`, mezcla con `color-mix`) y `.pr-chip` (`is-merged`, `is-closed`) en `assets/css/views/github.css`; línea de tiempo `.gh-timeline`.
- **Sin barras laterales de color** en ningún componente (ver la regla en §2): la selección se marca con fondo `--accent-soft` y texto de acento, no con una raya al lado.
- **Equipos** (`assets/css/views/team.css`): `.team-off` (oculta lo de equipo fuera de equipos), `.avatar.is-mini` (20 px, foto o iniciales) y `.avatar-stack` (solapados, «+N»), `.assignee-chip` / `.assignee-picker` (asignar), `.card-assignees`, `.member-list` / `.member-row` (diálogo de compartir), `.invite-box` / `.invite-row-item` (invitaciones), punto `#btnProject.has-invites`, `body.is-readonly`.
- **Login** (`assets/css/views/auth.css`): `.auth-guest` y `#authPanel.is-guest` (paso «invitado»: oculta proveedores, correo y cambio de modo).
- **Barra de desplazamiento de los diálogos** (`dialogs.css`): fina, pulgar redondeado y separado de las esquinas (`::-webkit-scrollbar`); en navegadores sin soporte, `scrollbar-color` estándar (en Chrome reciente esas propiedades anularían el estilo redondeado, por eso van en `@supports not selector(::-webkit-scrollbar)`).
- **Logo y favicon** (`assets/img/`): un símbolo, no una letra: **una pila de tarjetas** (una blanca al frente con un **check azul** y dos capas translúcidas detrás, hacia arriba y a la derecha), que representa las tareas y el trabajo organizado, sobre un cuadrado de esquinas redondeadas con degradado azul (`#6AA2FF` → `#3D6BF5` → `#2A45E0`), con brillo suave arriba, un fino borde interior claro y sombra sutil bajo la tarjeta. Centrado y reducido al 90 % para que respire. `favicon.svg` (el principal, en `index.html`), `favicon-32.png` (respaldo) y `apple-touch-icon.png` (180 px, **a sangre y sin esquinas redondeadas**, porque iOS aplica su propia máscara); `<meta name="theme-color" content="#2F6BFF">`. La pantalla de acceso usa el mismo SVG (`.brand-logo`). Historial de ideas: primero una **W** (descartada: el usuario pidió algo más simbólico); también se probaron barras de tablero (parecía un ecualizador), W con punto (una corona), un check con nodo (un simple «visto») y un tablero de tres columnas con tarjetas (a 16 px se vuelve ruido). Para regenerar los PNG: dibujar el SVG en un canvas (32 px con esquinas; 180 px cambiando `rx="16"` por `rx="0"` y quitando el borde interior) y guardar el resultado.

## 6. Plugins (sistema completo)

- **Sección Plugins:** oficiales (instalación con un clic), añadir por enlace (URL https) e instalados. Las tarjetas son minimalistas: icono con su color, nombre, check azul si es oficial, autor, descripción de 2 líneas y línea de permisos. Hay una ficha del plugin (diálogo) con permisos, datos (versión, autor, origen, identificador) y un aviso de seguridad.
- **Aislamiento:**
  - Cada plugin corre en un `<iframe sandbox="allow-scripts ...">` **sin allow-same-origin** (origin null).
  - Habla con Workhub solo por `postMessage`, protocolo v1. El host está en `src/services/plugin-host.js`.
  - Nunca ve las contraseñas ni la sesión.
- **SDK:** `plugins/sdk/workhub-plugin.js` y `workhub-plugin.css` (clases `wh-btn`, `wh-muted`, `wh-table`, `wh-empty`, `wh-select`, `wh-row`, `wh-dot`…). Se conecta con `WorkhubPlugin.connect(manifest)`.
- **Manifiesto:** `id`, `name`, `version`, `description`, `author`, `homepage`, `icon`, `color` (tono 0–359), `permissions`. Los ids `workhub.*` están reservados a los oficiales.
- **Permisos:** `tasks:read`, `tasks:write`, `clients:read`, `contacts:read`, `calendar:read`, `calendar:write`, `storage`, `ui:extend`, `appearance`.
- **API:**
  - Datos: `wh.tasks.list/create/update`, `wh.clients.list`, `wh.contacts.list`, `wh.meetings.list/create`, `wh.statuses()`.
  - Almacenamiento: `wh.storage.get/set/remove/keys` (por proyecto) y `wh.storage.user.*` (común a todos los proyectos).
  - Interfaz: `wh.ui.toast/openTask/openPanel/addButton/removeButton/setTaskBadges/setAppearance/resetAppearance`.
  - Eventos con `wh.on('tasks'|'project'|'storage'|'action'…)`.
  - Contexto: `wh.context.{project, theme, locale}`, `wh.lang`, `wh.locale`.
  - Traducciones: `WorkhubPlugin.translations({en:{…}})`.
- **Modos:**
  - **Panel:** se abre en la sección Plugins.
  - **Segundo plano:** oculto al abrir Workhub, para plugins con `ui:extend` o `appearance`. Desde aquí añaden botones, etiquetas y apariencia.
- **Ubicaciones de botones:** `tasks.toolbar`, `task.actions`, `calendar.toolbar`, `client.actions`, `command` (paleta). El registro está en `src/views/extensions.js`.
- **Etiquetas en las tarjetas del tablero:** `setTaskBadges`.
- **Apariencia:** accent, radius (sharp, normal o round) y density (compact, normal o comfortable).
- **Límites:**
  - 60 escrituras por minuto (error `rate-limited`).
  - Cuota de almacenamiento.
  - Códigos de error: `permission-denied`, `bad-params`, `not-found`, `bad-key`, `bad-value`, `too-large`, `quota`, `not-ready`, `unknown-method`, `background-only`.
  - Etiquetas y textos siempre escapados (probado contra XSS).
- **Oficiales** (`plugins/`, lista en `src/services/official-plugins.js`):
  - **Informe de trabajo** (`workhub.informe`, icono chart): KPIs, tabla por cliente, tareas que requieren atención, copiar resumen y exportar a CSV. Añade un botón en Tareas y otro en la paleta.
  - **Temporizador** (`workhub.temporizador`, icono timer):
    - Botón "Iniciar cronómetro" en la ficha de cada tarea y "Detener · X min" en la barra de Tareas.
    - Etiqueta con el tiempo en cada tarjeta.
    - Panel con cronómetro grande y totales por tarea y por cliente.
  - **Apariencia** (`workhub.apariencia`, icono sparkles): color libre, esquinas y densidad con vista previa. Se guarda en `storage.user`.
  - `plugins/plantilla/`: plantilla para crear plugins.
- **Etapas variables**: `wh.statuses()` devuelve `{key, label, done, color}` del proyecto abierto; los plugins no deben asumir `pendiente`/`completada`. Los oficiales (Informe, Temporizador, plantilla) usan `done` y vuelven a pedir las etapas en el evento `project`. Crear una tarea sin `status` la deja en la primera etapa.
- **Datos de los plugins:** instalados en `users/{uid}/plugins`; almacenamiento en `plugin_data`.

## 7. Idiomas (PR #22, fusionado)

- **Motor** en `src/i18n/i18n.js`:
  - La app sigue escrita en **español**. Un MutationObserver traduce el texto y los atributos `placeholder`, `title`, `aria-label`, `data-short`, `data-placeholder-text` y `alt`.
  - Traduce con un **diccionario** exacto más **patrones** con expresiones regulares para textos con datos.
  - Los campos (input y textarea) solo traducen sus atributos, nunca su valor.
- **`translate="no"`** marca los datos del usuario, que nunca se traducen.
- **API:** `Workhub.t(texto, {params})`, `Workhub.i18n.{lang, locale, setLang, missing()}`.
- **Diccionario:** `src/i18n/en.js`.
- **Idioma inicial:** el del navegador (si es español, español; si no, inglés).
- **Guardado:** en `localStorage['workhub_lang']` y en la cuenta (campo `lang` de settings). Cambiarlo recarga la app.
- **Selectores:** en Ajustes (`#langSegment`) y en la pantalla de login (`#authLang`).
- **Fechas:** usan `Workhub.i18n.locale` (`es-ES` / `en-US`).
- **Para añadir un idioma:**
  1. Crea `src/i18n/xx.js` con `Workhub.i18n.add('xx', {...}, [...])`.
  2. Añádelo a `LANGS` en `i18n.js`.
  3. Pon su `<script>` en `index.html`.
  4. Añade un botón en el selector de Ajustes.
- **Nota:** los textos con datos se traducen con claves con marcadores (`Workhub.t('hace {n} min', {n})` necesita esa clave exacta en `en.js`) o con patrones regex al final de `en.js`. En `en.js` las barras invertidas de los patrones deben escaparse bien al generarlos con scripts.
- **Pendiente:** comprobar en producción el selector de idioma de la pantalla de login (no se probó con Firebase real).

## 8. Historial de pull requests (todos fusionados salvo el último)

| # | Qué |
|---|---|
| — | Commits iniciales, antes de los pull requests: modo local con IndexedDB, `.bat`, tipos RDP/VPN/Usuario, vincular contactos y contraseñas a tareas, calendario con reuniones, rediseño con Geist |
| 1 | Reorganización en MVC |
| 2 | Importar conserva RDP y orden |
| 3 | Mejor arrastre, desplegables propios |
| 4 | Color por cliente |
| 5 | Ficha de tarea con botón Editar |
| 6 | Rediseño completo, paleta de comandos, atajos, avisos |
| 7 | Firebase: login y datos en la nube |
| 8 | Quita Microsoft del login |
| 9–11 | Publicación en Netlify y login en workhub-project.netlify.app |
| 12 | No mostrar la app antes del login |
| 13 | Proyectos |
| 14 | Seguridad: registro abierto con verificación, CSP, limpieza al cerrar sesión |
| 15 | Clientes y contactos juntos |
| 16 | Responsive completo |
| 17 | Ajustes guardados en la cuenta |
| 18 | Sistema de plugins, SDK, oficiales, docs |
| 19 | Rediseño de plugins con iconos en vez de emojis |
| 20 | Plugins integrados en la app (botones, etiquetas, apariencia, segundo plano) |
| 21 | Tarjetas de plugins minimalistas |
| 22 | Idioma inglés, traducciones |
| 23 | CONTEXT.md (contexto para continuar en otro chat) |
| 24–30 | Rama `claude/read-context-md-df6b13`: tipos de proyecto (soporte, desarrollo, kanban, personalizado), menú y límite de columnas, arrastrar columnas, integración con GitHub Projects (crear proyecto desde GitHub, destino en Ajustes, sincronización bidireccional), etiquetas, PRs vinculadas, actividad de la incidencia, scrollbar de los diálogos y CONTEXT.md (en varios PR; el #30 cierra la tanda) |
| 31 | GitHub: pedir el token cuando el proyecto está enlazado pero el navegador no lo tiene (antes «Sincronizar ahora» no hacía nada) |
| 32 | Acceso como invitado (solo un nombre, todo en el navegador, sin Firebase) |
| 33 | Login: el paso de invitado ocupa solo su pantalla y la tarjeta ya no se corta por arriba |
| 34 | Cuentas nuevas: obligar a crear el primer proyecto (nombre y tipo a elegir), sin proyecto por defecto |
| 35 | Permitir eliminar el primer proyecto; al eliminar el último vuelve a pedir crear uno |
| 36 | **Trabajo en equipo**: proyectos compartidos (`teams/`), invitaciones por correo, roles, asignación de tareas, reglas de Firestore nuevas y `tests/rules` |
| 37 | Compartir: los botones Cerrar y X no cerraban el diálogo |
| 38 | GitHub en equipos: el enlace viaja con el equipo, «Conectar con GitHub» sin token (OAuth), solo el propietario crea al cruzar, lectores sin sincronizar, errores de conversión claros |
| 39 | Convertir a equipo: copiar de una en una en vez de en lotes (límite de reglas de Firestore) |
| 40 | GitHub: con la cuenta conectada no se ofrece «Olvidar token» ni «Conectar en su lugar» (`tokenKind`) |
| **pendiente** | Rama `claude/context-docs-review-985e75`, sin PR abierto todavía: «Desvincular proyecto» / «Quitar mi acceso a GitHub» (nombres distintos y con ayuda) y esta actualización de CONTEXT.md |

## 9. Cómo trabajar y probar

- **En local:** `python3 -m http.server 5500` en la raíz y abrir `http://localhost:5500/`.
  - Si `firebase-config.js` tiene `apiKey`, pedirá login.
  - Para probar sin login: abrir `file:///…/index.html`, o en Playwright interceptar `**/src/config/firebase-config.js` con `window.WORKHUB_FIREBASE={apiKey:'',projectId:''};`.
- **Playwright:** usa el Chromium de `/opt/pw-browsers` (`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`); no ejecutes `playwright install`.
- **Idioma en las pruebas:** Chromium sin interfaz arranca en inglés, así que pon `locale: 'es-ES'` en `newContext` para probar en español, o `localStorage.workhub_lang='en'` para inglés.
- **Emuladores de Firebase** (opcionales): `useEmulators: true` solo en local, nunca en producción. Receta que funcionó en el equipo Windows (Java 11): instalar **`firebase-tools@13`** (las 14+ piden Java 21) y `@firebase/rules-unit-testing@3` + `firebase@10` **fuera del repo** (una carpeta temporal); `firebase emulators:start --only auth,firestore --project demo-workhub` con un `firebase.json` que apunte a `firestore.rules`; un servidor estático de Node que sirva `firebase-config.js` con `{apiKey:'fake-key', projectId:'demo-workhub', providers:['password','github'], useEmulators:true}` (solo entonces la app usa `127.0.0.1:9099/8080`); crear las cuentas por REST (`accounts:signUp` → `sendOobCode VERIFY_EMAIL` → leer `/emulator/v1/projects/demo-workhub/oobCodes` → `accounts:update` con el `oobCode`) para que salgan **verificadas** (las reglas lo exigen para `password`). **Dos sesiones a la vez**: dos pestañas con **orígenes distintos** (`http://localhost:PUERTO` y `http://127.0.0.1:PUERTO`), porque Firebase Auth guarda la sesión por origen. Ojo con dejar `workhub_guest` en `localStorage` de un origen: esa pestaña arranca en modo invitado aunque haya Firebase. Para parar todo: matar los procesos que escuchan en 8080, 9099, 4400, 4500, 9150 y los puertos de los servidores.
- **Pruebas de las reglas** (`tests/rules`): `cd tests/rules && npm install` y `npx firebase emulators:exec --only firestore --project demo-workhub --config ../../firebase.json "node rules-test.js"` → «59 correctas, 0 fallidas». Los `PERMISSION_DENIED` que salen por el camino son lo que **debe** rechazarse.
- **TRAMPA: límite de lotes con reglas que consultan otro documento.** Las reglas de un equipo hacen `get()` del documento del equipo en cada escritura; Firestore limita esas consultas a **10 por operación suelta y 20 por lote (`batch`) entero**. Un lote grande de escrituras a un equipo falla en producción con `permission-denied` (**y el emulador NO lo aplica, así que en local pasa**). Regla: en equipos, escribir de una en una (con concurrencia limitada), nunca con `batch`. Los lotes pequeños de 2 operaciones (aceptar una invitación) están bien.
- **Datos de prueba:** importar `data-backup.json` desde Copia de seguridad (`#importFileInput`). Solo en local; nunca subirlo a ningún sitio.
- **Qué comprobar:** sin errores en consola y sin scroll horizontal en móvil, en tema claro y oscuro.
- **Sin Python ni `gh`** en el equipo Windows: se edita con scripts de Node (`node script.js`) y los PR se abren con el enlace `.../pull/new/{rama}`. Los ficheros del repo están en **CRLF**; los scripts de edición deben normalizar los saltos de línea (leer, `replace(/\r\n/g,'\n')`, editar, volver a CRLF si lo tenía). Las heredocs de bash con comillas o `\\` se corrompen: escribir el script con la herramienta de ficheros y ejecutarlo. Las rutas `/c/Users/…` de Git Bash no las entiende `node` en Windows: usar PowerShell (o rutas `C:/…`) para esos casos. **`git push` funciona desde Bash pero no desde PowerShell** (allí no hay credenciales: «could not read Username»).
- **Verificar la interfaz sin Firebase real**: con el navegador integrado, servir la app con Node en un puerto y llamar a las vistas/controladores desde `javascript_tool` (`Workhub.app.controllers…`); para estados visuales, `view.render({...})` con un estado inventado. Para móvil, `resize_window` a `mobile` (y volver a `desktop`). Cuidado con simular clics sobre listas que se repintan (los nodos se sustituyen): volver a consultar en cada paso.
- **Servidor de pruebas local**: un servidor estático de Node que sirve `src/config/firebase-config.js` vacío (`window.WORKHUB_FIREBASE={apiKey:'',projectId:''}`) arranca el modo local sin login. Para probar GitHub sin token real se sustituye `window.fetch` en la consola del navegador por un simulador de la API GraphQL (proyecto, elementos, etiquetas, mutaciones, actividad) y se pega un token de mentira; al terminar, `localStorage.removeItem('workhub_gh_token')`.
- **GitHub:** a veces da errores 503 o "token store unavailable". Reintenta el push en bucle y verifica con `git ls-remote`.
- **Commits:** en español, descriptivos.

## 10. Ideas y posibles siguientes pasos (no pedidas todavía)

- **Desplegar** lo fusionado (Netlify sin créditos → `firebase deploy --only hosting`, o esperar al ciclo) y **publicar `firestore.rules`** (sin ellas, «Compartir» falla con permission-denied). Después **probar con Firebase real**: equipos (crear, convertir, invitar con otra cuenta de Google, asignar, roles), primer proyecto y modo invitado.
- **Probar «Conectar con GitHub» y la sincronización con GitHub real** (OAuth devuelve `gho_…`; proyectos de organización; actividad de la incidencia).
- **Contraseñas compartidas** en equipos con cifrado extremo a extremo por miembro (ver `docs/EQUIPOS.md`), y después comentarios, actividad y notificaciones de equipo.
- Pulir equipos: renombrar/etiquetar la copia al convertir, avisar al propietario cuando se acepta una invitación, «Mis tareas» en el calendario, asignar también reuniones.
- Si Netlify sigue sin créditos, decidir alojamiento definitivo (Firebase Hosting ya está configurado; Cloudflare Pages/Vercel requieren rehacer cabeceras y redirecciones).
- Renombrar columnas en GitHub desde Workhub (`updateProjectV2Field`): probar primero que conserva los ids de las opciones, si no los elementos perderían su columna.
- Comentar desde la ficha (hoy la actividad de GitHub es solo lectura), crear etiquetas nuevas en el repositorio, borrar/renombrar etiquetas del catálogo, filtrar el tablero por etiqueta.
- Probar el idioma en producción (pantalla de login y los textos nuevos de equipos y GitHub).
- Más idiomas (catalán, euskera…) con el mismo sistema.
- Más plugins oficiales.
