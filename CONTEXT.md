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
- **Rama de trabajo de Claude:** `claude/sleepy-brown-tdi6yq`.
  - Siempre se trabaja y se sube aquí, y después se abre un pull request contra `main`.
  - Si el último pull request ya está fusionado, se reinicia la rama desde `origin/main`: `git checkout -B claude/sleepy-brown-tdi6yq origin/main`.
- **Firebase:** proyecto `workhub-26f50` (Auth + Firestore).
- **Correo del usuario:** yaleros2@gmail.com.

## 2. Preferencias y reglas del usuario (importante)

- Todo **en español**: conversación, commits y pull requests.
- **Crea los pull requests tú mismo** siempre que termines algo, en español y con explicaciones claras (secciones *Qué cambia*, *Cómo funciona*, *Pruebas*). No hace falta preguntar. Si GitHub falla, reintenta; el usuario llegó a decir "haz tú el pull request".
- El cuerpo del pull request termina con "🤖 Generated with [Claude Code](https://claude.com/claude-code)".
- **Solo Netlify.** claude.ai ya no se usa como alojamiento. El código aún soporta ese modo, pero no es prioritario.
- **NUNCA publiques ni pegues `data-backup.json`.** Contiene datos reales de clientes.
  - Está en el repositorio, pero `scripts/build-public.js` usa una lista blanca y solo publica `index.html`, `assets`, `src` y `plugins`.
- **NUNCA pegues ni subas el client secret de GitHub OAuth.** Solo va en la consola de Firebase.
- La visibilidad de producción en Netlify debe seguir en **Public**.
- Cualquiera puede **crearse una cuenta**, no solo el usuario. El correo tiene que verificarse.
- Estética: **minimalista**, estilo Linear/Vercel, **sin emojis**. Usa iconos SVG.
- Todo debe ser **responsive**: pantallas grandes, portátil, tablet y móvil.
- El usuario da libertad de diseño ("hazlo como tú veas").
- Si el usuario pide las reglas de Firestore, pégalas en el chat, porque las publica él a mano en la consola. Solo tiene permisos para "desarrollar y probar" en algunos sitios.

## 3. Arquitectura técnica

- **JavaScript sin frameworks ni build.** Scripts clásicos cargados en orden desde `index.html` y un espacio de nombres global `Workhub` (`src/core/namespace.js`).
- **Patrón MVC:**
  - `src/models/`: datos y lógica. `CollectionModel` sincroniza en memoria y emite `change`.
  - `src/views/`: solo DOM. Exponen `bindX(handler)`.
  - `src/controllers/`: conectan modelos y vistas.
  - `src/services/`: plataforma, Firebase, cifrado, host de plugins, preferencias, plugins oficiales.
  - `src/utils/`: html/iconos, fechas, urls, ui, autoscroll.
  - `src/core/`: namespace, emitter, local-storage-shim.
  - `src/i18n/`: traducciones.
  - `src/config/firebase-config.js`: configuración de Firebase.
- **Arranque:**
  1. `src/boot.js` se carga pronto. Pone la clase `auth-gate` si hay Firebase (oculta la app hasta el login), `i18n-pending` si el idioma no es español, y el tema guardado.
  2. `src/main.js` llama a `Workhub.i18n.observe()`, quita `i18n-pending` y crea `AppController` y `AuthController`.
- **Modos de datos:**
  - Con Firebase configurado y servido por http(s), hay que iniciar sesión y los datos van a Firestore.
  - Sin `apiKey`, la app funciona en **modo local** con IndexedDB, sin login ("Modo local" abajo en la barra lateral).
  - `start-workhub.bat` lanza el modo local en Windows.
- **Firebase** (`src/config/firebase-config.js`):
  - `hostingDomains: ['workhub-project.netlify.app']`.
  - `providers: ['google','github','password']` (Microsoft se quitó).
  - `allowSignup: true`, `useEmulators: false`.
  - Netlify redirige `/__/auth/*` y `/__/firebase/*` a `workhub-26f50.firebaseapp.com`, así el login se completa en el propio dominio.
  - El login usa popup y, si falla, redirect.
  - Al cerrar sesión se ejecuta `clearPersistence` (se borra la caché local).
- **Estructura en Firestore:**
  - Proyecto principal: `users/{uid}/{tasks|clients|contacts|meetings|vault|vault_meta|plugin_data}/…`.
  - Notas de cada tarea: `users/{uid}/tasks/{id}/notes/{id}`.
  - Otros proyectos: `users/{uid}/projects/{projectId}/{misma colección}/…`.
  - Del usuario, comunes a todos sus proyectos: `users/{uid}/projects` (lista), `assets` (imágenes de notas), `settings` (acento, tema e idioma), `plugins` (instalados).
- **Reglas** (`firestore.rules`):
  - `canUse(uid)` exige `auth.uid == uid`, y además correo verificado si el proveedor es `password`.
  - Solo se permiten las colecciones de la lista blanca. Todo lo demás está cerrado.
- **Publicación en Netlify** (`netlify.toml`):
  - Build: `node scripts/build-public.js`, publica `dist/`.
  - Cabeceras de seguridad:
    - `X-Frame-Options: DENY`, HSTS, `nosniff` y `Permissions-Policy`.
    - **CSP estricta**: sin scripts en línea; `script-src` solo el propio dominio más gstatic y apis.google.
    - `frame-src 'self' https: http://localhost:* http://127.0.0.1:*`, para los plugins.
  - Si añades un servicio externo, añade su dominio a la CSP.
- **Documentación:**
  - `README.md`: todo el funcionamiento, sección Plugins y sección Idiomas.
  - `docs/FIREBASE.md`, `docs/NETLIFY.md`.
  - `docs/SEGURIDAD.md`: pasos en la consola, como publicar reglas, política de contraseñas, protección contra la enumeración de correos, dominios autorizados y restringir la API key.
  - `docs/PLUGINS.md`: guía completa para crear plugins.

## 4. Funcionalidades (estado actual)

### Tareas (tablero)
- **Estados**, en `task-model.js` `STATUSES`: `pendiente` (Pendiente), `proceso` (En proceso), `espera` (Esperando al cliente), `completada` (Completada).
- **Campos de la tarea:** `title`, `desc`, `cliente`, `status`, `contacto`, `dueDate` (YYYY-MM-DD), `order`, `createdAt`, `updatedAt`, contactos y contraseñas vinculados, y notas en una subcolección (`text`, `imageAssetId`, `createdAt`).
- **Tablero:**
  - Ocupa el alto de la ventana y cada columna tiene su propio scroll.
  - Arrastrar y soltar con autoscroll y una línea que marca dónde caerá la tarea. El orden se guarda en `order`.
  - El botón **+** de cada columna crea una tarea con ese estado.
- **Ficha de tarea** (solo lectura, al hacer clic):
  - Muestra estado, cliente, fecha límite con "Faltan N días / Venció hace N días", contacto, descripción, notas con imágenes y vínculos.
  - Botón **Editar tarea**; al guardar o cancelar se vuelve a la ficha.
- **Filtros:** buscador (título, cliente o contacto) y selector de cliente.
- **Atajos:** `N` crea una tarea y `/` enfoca el buscador (no funcionan mientras escribes ni con un diálogo abierto).

### Tipos de proyecto (etapas y clientes)
- Al crear o editar un proyecto se elige el tipo (`src/models/project-templates.js`, `ProjectTemplates`): **soporte** (4 etapas, con clientes; el de siempre y el que usa el proyecto principal), **desarrollo** (Por hacer, En curso, Hecho), **kanban** (Backlog, En curso, En revisión, Hecho) y **personalizado** (2 a 8 etapas con nombre, color y orden, una o varias finales, y casilla "trabaja con clientes").
- Se guarda en el documento del proyecto: `tipo` (y `stages`, `clients` solo si es personalizado). Sin `tipo` = soporte, así que no hay migración. Se copia también en `workhub_project` (localStorage) para pintar bien antes de que llegue la lista.
- `TaskModel.STATUS` es un array único que `TaskModel.setStages()` rellena en el sitio al abrir/editar un proyecto (`AppController.applyProjectConfig`). Usa `TaskModel.isDone(t)` (no `'completada'`) y `TaskModel.stageKey(t)`, que manda a la primera etapa las tareas cuyo estado ya no existe.
- Sin clientes: `body.no-clients` y la clase `.needs-clients` en el HTML (JS `ShellView.setClientsEnabled`); las tareas y credenciales no piden cliente (`AppController.clientsEnabled()`). `Workhub.clientsEnabled` lo leen las vistas.
- Menú «···» por columna (`ColumnView`, `TasksController.bindColumns`): editar nombre/color/límite/final, ocultar (localStorage `workhub_hidden_{proyecto}`), eliminar columna, eliminar todas las tarjetas, mover izquierda/derecha, y arrastrar la cabecera para reordenar. Cada cambio pasa por `ProjectsController.updateStages`, que convierte el proyecto en personalizado y guarda `stages` (con `limit` opcional). No hay «archivar» porque las tareas no tienen archivo.
- **GitHub Projects** (`docs/GITHUB.md`): se crea un proyecto nuevo desde GitHub (Nuevo proyecto → «Desde GitHub», pseudo-tipo solo del diálogo) o, en Ajustes → GitHub Projects, se elige el proyecto de destino (existente, o uno nuevo). Enlaza un proyecto con un GitHub Project v2 (GraphQL, token clásico con permiso `project` guardado solo en localStorage `workhub_gh_token`). Las columnas pasan a ser las opciones de Status (clave `g`+id) y las tareas se sincronizan en ambos sentidos (`GithubSync`). La config va en el doc del proyecto (`github`; `ProjectModel.patch`), los enlaces en cada tarea (`gh*`). CSP: `connect-src` incluye api.github.com. Pendiente: probarlo con un token real (se verificó contra una API simulada).
- Los plugins reciben las etapas con `wh.statuses()` (`key`, `label`, `done`, `color`); los oficiales ya no asumen `completada`.

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
- **Diseño:** lista de clientes a la izquierda (cada uno con número de contactos y tareas abiertas) y ficha a la derecha.
- **Ficha del cliente:**
  - Personas de contacto: email y teléfono se pueden pulsar.
  - Botones para ver sus tareas o sus contraseñas.
  - Acciones para cambiar el color, renombrar o eliminar (con confirmación).
- **Edición:** al editar un cliente se editan ahí mismo sus personas de contacto.
- **Buscador:** busca a la vez clientes y personas (nombre, email, teléfono o notas) y resalta las coincidencias.
- **Sin cliente:** los contactos cuyo cliente se eliminó aparecen en "Sin cliente".
- **Renombrar** un cliente actualiza sus tareas, reuniones, contactos y contraseñas.
- **Color del cliente:** tono HSL en el campo `color`; "Auto" lo deriva del nombre. Se usa en etiquetas, avatares y desplegables.
- **En móvil** se ve primero la lista y, al elegir un cliente, su ficha.

### Proyectos
- **Selector** arriba en la barra lateral: avatar con iniciales y color, nombre y "Workhub". Cambia de proyecto sin recargar.
- **Gestión:** crear, renombrar, cambiar el color y eliminar con todos sus datos (con confirmación).
- **"Proyecto principal"** usa la raíz de la base de datos y no se puede eliminar. El último proyecto abierto se recuerda.

### Paleta de comandos (`Ctrl K` / `⌘K`, o el botón "Buscar…" de la barra lateral)
- **Busca** tareas, contactos, reuniones y clientes.
- **Acciones:**
  - Crear: nueva tarea, reunión, contacto, credencial, cliente o proyecto.
  - Cambiar de proyecto.
  - "Ir a {sección}".
  - Cambiar el tema: claro, oscuro o del sistema.
  - Exportar la copia de seguridad.
  - Acciones de los plugins.

### Copia de seguridad
- **Exportar e importar** el proyecto abierto en JSON (`formatVersion`).
- **Contenido:** tareas, notas, contactos, clientes, reuniones y contraseñas **cifradas**.
- Al importar se conservan el puerto y dominio RDP y el orden manual.

### Ajustes (se guardan en la cuenta, `users/{uid}/settings`)
- **Color de acento:** azul (predeterminado, #2F6BFF), lavanda/Violeta (#7C5CFF), rosa (#E0457B), menta/Verde (#16A36A), melocotón/Naranja (#EA6A1F), limón/Ámbar (#E6A310) y grafito (#18181B). Definidos en `settings-model.js` `ACCENTS`.
- **Tema:** Sistema, Claro u Oscuro.
- **Idioma:** Español o English.
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
- **Favicon:** SVG en línea (portapapeles con check blanco sobre `#1F2328`).

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
- **Datos de los plugins:** instalados en `users/{uid}/plugins`; almacenamiento en `plugin_data`.

## 7. Idiomas (PR #22, el último)

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
- **Pendiente:** comprobar en producción el selector de idioma de la pantalla de login (no se probó con Firebase real).

## 8. Historial de pull requests (todos fusionados salvo #22)

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
| **22** | **Idioma inglés, traducciones (PENDIENTE DE FUSIONAR)** |

## 9. Cómo trabajar y probar

- **En local:** `python3 -m http.server 5500` en la raíz y abrir `http://localhost:5500/`.
  - Si `firebase-config.js` tiene `apiKey`, pedirá login.
  - Para probar sin login: abrir `file:///…/index.html`, o en Playwright interceptar `**/src/config/firebase-config.js` con `window.WORKHUB_FIREBASE={apiKey:'',projectId:''};`.
- **Playwright:** usa el Chromium de `/opt/pw-browsers` (`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`); no ejecutes `playwright install`.
- **Idioma en las pruebas:** Chromium sin interfaz arranca en inglés, así que pon `locale: 'es-ES'` en `newContext` para probar en español, o `localStorage.workhub_lang='en'` para inglés.
- **Emuladores de Firebase** (opcionales): `useEmulators: true` solo en local, nunca en producción.
- **Datos de prueba:** importar `data-backup.json` desde Copia de seguridad (`#importFileInput`). Solo en local; nunca subirlo a ningún sitio.
- **Qué comprobar:** sin errores en consola y sin scroll horizontal en móvil, en tema claro y oscuro.
- **GitHub:** a veces da errores 503 o "token store unavailable". Reintenta el push en bucle y verifica con `git ls-remote`.
- **Commits:** en español, descriptivos.

## 10. Ideas y posibles siguientes pasos (no pedidas todavía)

- Fusionar el PR #22 y probar el idioma en producción (pantalla de login).
- Más idiomas (catalán, euskera…) con el mismo sistema.
- Más plugins oficiales.
