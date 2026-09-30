# Crear plugins para Workhub

Un plugin es **una página web** que se integra en Workhub. Siempre con los permisos que el usuario le da al instalarlo, puede:

- **Tener su propio panel** en la sección **Plugins** (un informe, un cronómetro, un panel de ajustes…).
- **Añadir botones y etiquetas dentro de Workhub**: en la barra de Tareas, en la ficha de cada tarea, en el Calendario, en la ficha de cada cliente, en la paleta de comandos (`Ctrl K`) y etiquetas en las tarjetas del tablero.
- **Cambiar la apariencia**: color de acento, forma de las esquinas y densidad.
- **Trabajar con los datos**: leer y crear tareas, consultar clientes, contactos y reuniones, guardar sus propios datos y mostrar avisos.

Puedes publicarlo donde quieras (GitHub Pages, Cloudflare Pages, tu propio servidor…) y cualquiera puede instalarlo pegando su enlace en **Plugins → Añadir**.

- [Cómo funciona](#cómo-funciona)
- [Tu primer plugin en 5 minutos](#tu-primer-plugin-en-5-minutos)
- [El manifiesto](#el-manifiesto)
- [Permisos](#permisos)
- [Referencia de la API](#referencia-de-la-api)
- [Integrarse en Workhub: botones, etiquetas y apariencia](#integrarse-en-workhub-botones-etiquetas-y-apariencia)
- [Eventos](#eventos)
- [Estilos: que tu plugin parezca parte de Workhub](#estilos-que-tu-plugin-parezca-parte-de-workhub)
- [Publicarlo y probarlo](#publicarlo-y-probarlo)
- [Seguridad y límites](#seguridad-y-límites)
- [Plugins oficiales](#plugins-oficiales)
- [Preguntas frecuentes](#preguntas-frecuentes)

---

## Cómo funciona

```
┌──────────────── Workhub ────────────────┐
│  Plugins → "Mi plugin"                  │
│  ┌───────── <iframe sandbox> ─────────┐ │
│  │  tu página (https://tu-web/…)      │ │
│  │  + SDK: WorkhubPlugin.connect(...)  │◄┼── mensajes (postMessage)
│  └─────────────────────────────────────┘ │   solo lo que permiten
└──────────────────────────────────────────┘   los permisos aprobados
```

- Tu página se carga en un `<iframe sandbox>` **aislado**: no puede leer el DOM de Workhub, ni su sesión, cookies o almacenamiento, ni las contraseñas guardadas.
- Se comunica con Workhub mediante **mensajes**. El SDK (`workhub-plugin.js`) te da una API sencilla basada en promesas.
- Cada llamada se comprueba contra los **permisos** que declaraste y que el usuario aprobó.
- **Tu plugin nunca toca el HTML de Workhub.** Para añadir cosas a la interfaz, *declaras* botones y etiquetas (texto, icono del set, ubicación) y Workhub los pinta con sus propios componentes. Así cualquier plugin se ve integrado y nadie puede suplantar botones de Workhub ni leer lo que hay en pantalla.

### Dos modos: panel y segundo plano

La misma página de tu plugin se carga de dos formas:

| Modo | Cuándo | Para qué | `wh.isBackground` |
|---|---|---|---|
| **Panel** | El usuario abre el plugin en la sección Plugins. | Tu interfaz. | `false` |
| **Segundo plano** | Siempre que Workhub está abierto, oculto. Solo si el plugin pide `ui:extend` o `appearance`. | Añadir botones y etiquetas, reaccionar a sus clics y aplicar la apariencia. | `true` |

```js
WorkhubPlugin.connect(MANIFEST).then((wh) => {
  if(wh.isBackground) segundoPlano(wh);   // botones, etiquetas, apariencia
  else panel(wh);                        // tu interfaz
});
```

Las dos instancias comparten el almacenamiento. Cuando una guarda algo, la otra recibe el evento `storage` para releerlo.

## Tu primer plugin en 5 minutos

1. Copia la carpeta [`plugins/plantilla`](../plugins/plantilla) de este repositorio. Tiene `index.html` y `plantilla.js`.
2. En `plantilla.js`, cambia el **manifiesto**: sobre todo `id` y `name`.
3. Publica la carpeta en una web con **https**, por ejemplo con GitHub Pages: crea un repositorio, sube los archivos y activa *Settings → Pages*.
4. En Workhub: **Plugins** → pega la dirección de tu `index.html` → **Añadir** → revisa los permisos → **Instalar**.

El esqueleto mínimo es este:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://workhub.yalero.net/plugins/sdk/workhub-plugin.css">
</head>
<body>
  <h1>Hola</h1>
  <p id="out" class="wh-muted">Conectando…</p>

  <script src="https://workhub.yalero.net/plugins/sdk/workhub-plugin.js"></script>
  <script>
    WorkhubPlugin.connect({
      id: 'com.tu-nombre.hola',
      name: 'Hola',
      version: '1.0.0',
      description: 'Cuenta tus tareas abiertas.',
      author: 'Tu nombre',
      icon: 'bolt',
      color: 262,
      permissions: ['tasks:read']
    }).then(async (wh) => {
      const tasks = await wh.tasks.list();
      document.getElementById('out').textContent =
        'Tienes ' + tasks.filter((t) => t.status !== 'completada').length + ' tareas abiertas.';
    });
  </script>
</body>
</html>
```

## El manifiesto

Es el objeto que pasas a `WorkhubPlugin.connect(manifiesto)`. Workhub lo muestra al instalar y lo vuelve a comprobar cada vez que se abre el plugin.

| Campo | Obligatorio | Descripción |
|---|---|---|
| `id` | Sí | Identificador único, en minúsculas, con letras, números, puntos o guiones (3–64). Usa tu dominio o usuario al revés: `com.tu-nombre.mi-plugin`. **No lo cambies nunca**: es lo que identifica al plugin instalado y sus datos. Los que empiezan por `workhub.` están reservados. |
| `name` | Sí | Nombre visible (hasta 40 caracteres). |
| `version` | No | Versión, por ejemplo `1.2.0`. |
| `description` | No | Una o dos frases (hasta 200 caracteres). |
| `author` | No | Tu nombre o el de tu empresa. |
| `homepage` | No | Web o repositorio del plugin (https). |
| `icon` | No | Nombre de un icono de Workhub (lista abajo), por ejemplo `chart`. Se dibuja en blanco sobre el color del plugin. Si no existe, se usa `puzzle`. **No se admiten emojis ni imágenes**: así todos los plugins se ven coherentes y ninguno puede inyectar contenido en Workhub. |
| `color` | No | Tono del color del icono, de `0` a `359` (rueda de color HSL: `0` rojo, `24` naranja, `145` verde, `214` azul, `262` violeta, `328` rosa). Si no lo indicas, sale uno a partir del `id`. |
| `permissions` | No | Lista de permisos (siguiente apartado). Pide **solo** los que uses. |

### Iconos disponibles

| Nombre | Para… | Nombre | Para… |
|---|---|---|---|
| `puzzle` | genérico | `chart` | gráficos, informes |
| `trending` | evolución, métricas | `pie` | repartos |
| `timer` | cronómetros | `clock` | horas, turnos |
| `calendar` | fechas, agenda | `check` | tareas hechas |
| `list` | listas | `kanban` | tableros |
| `users` | personas, equipos | `briefcase` | clientes, proyectos |
| `mail` | correo | `message` | mensajes, chat |
| `bell` | avisos | `file` | documentos |
| `folder` | archivos | `book` | guías, notas |
| `database` | datos | `download` | exportar |
| `link` | enlaces | `globe` | web, idiomas |
| `tag` | etiquetas | `wallet` | facturación, gastos |
| `target` | objetivos | `bolt` | automatizaciones |
| `sparkles` | IA, extras | `code` | desarrollo |
| `shield` | seguridad | `star` | favoritos |

## Permisos

| Permiso | Qué permite |
|---|---|
| `tasks:read` | Leer las tareas del proyecto abierto (título, descripción, cliente, estado, fecha límite, contacto) y abrir una tarea en Workhub. |
| `tasks:write` | Crear tareas y modificar las existentes. |
| `clients:read` | Leer la lista de clientes. |
| `contacts:read` | Leer los contactos de los clientes (nombre, email, teléfono, notas). |
| `calendar:read` | Leer las reuniones del calendario. |
| `calendar:write` | Crear reuniones. |
| `storage` | Guardar datos propios del plugin, por proyecto (`wh.storage`) o comunes a todos (`wh.storage.user`). |
| `ui:extend` | Añadir botones en Tareas, en la ficha de tarea, en Calendario, en la ficha de cliente y en la paleta de comandos, y etiquetas en las tarjetas. El plugin se carga en segundo plano. |
| `appearance` | Cambiar el color de acento, las esquinas y la densidad de Workhub. El plugin se carga en segundo plano. |

**No existe ningún permiso para las contraseñas guardadas:** ningún plugin puede leerlas.

Si publicas una versión nueva que pide **más** permisos, el usuario verá un aviso para aprobarlos. Hasta entonces, el plugin funciona solo con los que ya tenía, así que comprueba con `wh.has('permiso')` antes de usarlos.

## Referencia de la API

`WorkhubPlugin.connect(manifiesto)` devuelve una promesa con el cliente `wh`. Todos los métodos devuelven promesas. Si falta un permiso o los datos no son válidos, la promesa falla con un `Error` que trae un `code`.

### Conexión y contexto

```js
const wh = await WorkhubPlugin.connect(manifiesto);

wh.permissions          // ['tasks:read', ...] permisos concedidos
wh.has('tasks:write')   // true / false
wh.context.project      // {id, name} proyecto abierto
wh.context.theme        // {scheme: 'light' | 'dark', vars: {...}}
wh.context.locale       // idioma de Workhub: 'es' o 'en' (también wh.lang)
wh.locale               // formato de fechas: 'es-ES' o 'en-US'
await wh.statuses()     // etapas del proyecto abierto: [{key, label, done, color}, ...]
```

Las etapas dependen del tipo de proyecto (soporte, desarrollo, personalizado…), así que **no des por hechas las claves** `pendiente` o `completada`. `done` es `true` en las etapas que cuentan como terminadas; `color` es `gray`, `blue`, `orange`, `green`, `red` o `violet`. Cada tarea trae en `status` la clave de una de esas etapas, y al crear una sin `status` va a la primera. Al cambiar de proyecto llega el evento `project`: vuelve a pedir `wh.statuses()`.

Si la página se abre fuera de Workhub, `connect` falla con el mensaje `not-in-workhub`, así puedes mostrar una explicación.

### Idiomas

Workhub está en español e inglés. Para que tu plugin hable el idioma del usuario, escribe los textos en español y añade sus traducciones:

```js
const t = WorkhubPlugin.translations({
  en: {'Informe': 'Report', 'Hola, {name}': 'Hello, {name}'}
});
const wh = await WorkhubPlugin.connect(manifiesto);   // a partir de aquí t() usa el idioma de Workhub
t('Informe');                     // 'Report' si Workhub está en inglés
t('Hola, {name}', {name: 'Ana'}); // admite datos entre llaves
new Date().toLocaleDateString(WorkhubPlugin.locale);   // fechas en el formato del idioma
```

Si falta una traducción se muestra el texto original. El nombre y la descripción del manifiesto se muestran tal cual (los de los plugins oficiales los traduce Workhub). Cambiar de idioma recarga Workhub, así que tu plugin se vuelve a cargar con el idioma nuevo.

### Tareas

```js
await wh.tasks.list()
// [{id, title, desc, cliente, status, dueDate, contacto, createdAt, updatedAt}]

await wh.tasks.create({title:'Llamar a Ana', desc:'', cliente:'Acme', status:'pendiente', dueDate:'2026-10-15', contacto:''})
// {id}  — solo title es obligatorio; status por defecto 'pendiente'; dueDate 'AAAA-MM-DD'

await wh.tasks.update(id, {status:'completada'})
// campos: title, desc, cliente, status, dueDate, contacto
```

### Clientes, contactos y reuniones

```js
await wh.clients.list()     // [{id, nombre, color}]            (clients:read)
await wh.contacts.list()    // [{id, cliente, nombre, email, telefono, notas}]  (contacts:read)
await wh.meetings.list()    // [{id, title, cliente, date, start, end, link, notas}]  (calendar:read)
await wh.meetings.create({title:'Revisión', date:'2026-10-02', start:'10:00', end:'11:00', cliente:'Acme', link:'https://meet.google.com/…', notas:''})
// {id}  (calendar:write) — title y date obligatorios; horas 'HH:MM'; link solo http(s)
```

### Almacenamiento propio (`storage`)

Cada plugin tiene su propio espacio **en cada proyecto** (hasta 800 KB) y otro **común a todos los proyectos** del usuario, ambos sincronizados con su cuenta.

```js
// En el proyecto abierto:
await wh.storage.set('ajustes', {modo:'compacto'})   // cualquier valor JSON, hasta 100 KB por clave
await wh.storage.get('ajustes')                      // el valor, o null si no existe
await wh.storage.keys()                              // ['ajustes', ...]
await wh.storage.remove('ajustes')

// Común a todos los proyectos (preferencias del usuario, por ejemplo):
await wh.storage.user.set('tema', 'oscuro')
await wh.storage.user.get('tema')
```

Las claves admiten letras, números, `_`, `-` y `.` (hasta 64). Cuando el usuario quita el plugin, sus datos se borran.

### Interfaz

```js
await wh.ui.toast('Guardado')                  // aviso en Workhub ("Tu plugin: Guardado")
await wh.ui.toast('Algo falló', {type:'error'})
await wh.ui.openTask(id)                       // abre la ficha de la tarea en Workhub (tasks:read)
await wh.ui.openPanel()                        // abre tu plugin en la sección Plugins
```

### Errores

| `code` | Cuándo |
|---|---|
| `permission-denied` | Falta el permiso que exige el método. |
| `bad-params` | Datos no válidos (título vacío, fecha mal escrita…). |
| `not-found` | La tarea no existe. |
| `bad-key` / `bad-value` / `too-large` / `quota` | Problemas con el almacenamiento. |
| `rate-limited` | Más de 60 escrituras por minuto. |
| `not-ready` | Workhub todavía está cargando los datos. |
| `unknown-method` | El método no existe. |
| `background-only` | Añadir botones, etiquetas o apariencia desde el panel: hazlo en segundo plano. |

## Integrarse en Workhub: botones, etiquetas y apariencia

Todo esto se hace **en segundo plano** (`wh.isBackground`).

### Botones (`ui:extend`)

```js
await wh.ui.addButton({
  id: 'iniciar',                // tuyo; si repites el id, el botón se actualiza
  location: 'task.actions',     // dónde aparece (tabla de abajo)
  label: 'Iniciar cronómetro',  // texto (hasta 32 caracteres)
  icon: 'timer',                // icono del set (opcional)
  tooltip: 'Medir el tiempo',   // al pasar el ratón (opcional)
  variant: 'primary'            // opcional: botón destacado con el color del plugin
});
await wh.ui.removeButton('iniciar');

wh.on('action', ({id, location, context}) => {
  if(id === 'iniciar') { /* context.taskId */ }
});
```

| `location` | Dónde aparece | `context` que recibes al pulsarlo |
|---|---|---|
| `tasks.toolbar` | Barra de Tareas, junto al buscador | `{}` |
| `task.actions` | Ficha de una tarea | `{taskId}` |
| `calendar.toolbar` | Barra del Calendario | `{date}` (día elegido, `AAAA-MM-DD`) |
| `client.actions` | Ficha de un cliente (Clientes y contactos) | `{clientId, cliente}` |
| `command` | Paleta de comandos (`Ctrl K`) | `{}` |

Cada botón lleva el color de tu plugin y, al pasar el ratón, su nombre. Así el usuario siempre sabe de dónde viene. Máximo 12 botones por plugin.

### Etiquetas en las tarjetas de tareas (`ui:extend`)

```js
await wh.ui.setTaskBadges({
  [idDeTarea]: {text: '1 h 20 min', icon: 'clock', tone: 'neutral'},
  [otraTarea]: {text: 'En marcha', icon: 'timer', tone: 'accent'}
});
await wh.ui.setTaskBadges({});   // quitarlas todas
```

- `tone`: `neutral`, `accent`, `success`, `warning` o `danger`.
- Texto de hasta 24 caracteres.
- Cada llamada **sustituye** todas las etiquetas de tu plugin.

### Apariencia (`appearance`)

```js
await wh.ui.setAppearance({
  accent: '#16A36A',     // color de acento (#RRGGBB) o null para el de Ajustes
  radius: 'round',       // 'sharp' (rectas), 'normal' o 'round' (redondeadas)
  density: 'compact'     // 'compact', 'normal' o 'comfortable'
});
await wh.ui.resetAppearance();   // volver al aspecto normal
```

- **Solo esos valores, validados**, y nunca CSS libre: una hoja de estilos arbitraria podría ocultar o imitar botones, o sacar datos de la página.
- Se aplica mientras el plugin esté instalado. Al quitarlo, Workhub vuelve a su aspecto.
- Guarda la elección en `wh.storage.user` y aplícala al arrancar en segundo plano (mira el plugin oficial **Apariencia**).

## Eventos

```js
const off = wh.on('tasks', (tasks) => { /* lista completa y actualizada */ });
off(); // dejar de escuchar
```

| Evento | Dato | Permiso |
|---|---|---|
| `tasks` | lista de tareas | `tasks:read` |
| `clients` | lista de clientes | `clients:read` |
| `contacts` | lista de contactos | `contacts:read` |
| `meetings` | lista de reuniones | `calendar:read` |
| `theme` | `{scheme, vars}`: el usuario cambió el tema o el color (el SDK ya lo aplica) | — |
| `project` | `{id, name}`: el usuario cambió de proyecto; vuelve a leer tus datos | — |
| `action` | `{id, location, context}`: pulsaron uno de tus botones | `ui:extend` |
| `storage` | `{key, scope}`: la otra instancia de tu plugin (panel o segundo plano) guardó algo | `storage` |

## Estilos: que tu plugin parezca parte de Workhub

Incluye `workhub-plugin.css`. El SDK aplica al conectar los colores del usuario (tema claro u oscuro y color de acento) como variables CSS, y los actualiza si cambian.

- **Variables:** `--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-soft`, `--ink-faint`, `--line`, `--accent`, `--accent-solid`, `--accent-ink`, `--accent-soft`, `--danger`, `--st-pend`, `--st-proc`, `--st-wait`, `--st-done`, `--r-md`, `--r-lg`, `--font`, `--mono`…
- **Clases listas:**
  - botones `wh-btn` (y `is-primary`, `is-danger`);
  - campos `wh-input` y `wh-select`;
  - tarjetas `wh-card`, tablas `wh-table`, etiquetas `wh-badge`;
  - `wh-row`, `wh-grid`, `wh-muted`, `wh-empty`.

El atributo `data-theme` de `<html>` vale `light` o `dark` por si quieres ajustar algo a mano.

## Publicarlo y probarlo

- **Tiene que servirse por https.** Para desarrollar, también vale `http://localhost` o `http://127.0.0.1`: abre Workhub y pega `http://localhost:8080/index.html`, por ejemplo.
- **Cualquier hosting estático sirve:** GitHub Pages, Cloudflare Pages, Vercel, Netlify…
- **No necesitas CORS ni cabeceras especiales.** Tu página se carga en un marco y el SDK usa `postMessage`.
- **Enlaces que se abren fuera:** usa `<a target="_blank">`, que se abren en otra pestaña.
- **Descargas y portapapeles:** puedes crear descargas con un `<a download>` y usar el portapapeles (`navigator.clipboard.writeText`).
- **Para compartirlo:** pasa el enlace de tu `index.html`. En la guía no hace falta ninguna lista central de plugins.

## Seguridad y límites

- **Aislamiento:** el marco no tiene `allow-same-origin`, así que tu página funciona con un origen opaco (`null`). Por eso `localStorage`, `IndexedDB` y las cookies no están disponibles: usa `wh.storage`.
- **Qué puede hacer tu página:**
  - ejecutar scripts y enviar formularios;
  - abrir ventanas y pestañas;
  - descargar archivos;
  - escribir en el portapapeles.
- **Qué no puede hacer:**
  - navegar la página de Workhub;
  - usar la cámara, el micrófono o la ubicación.
- **No expongas secretos en tu plugin:** es una página pública. Si necesitas una clave de API de un servicio externo, pásala por tu propio servidor.
- **Sin acceso al HTML de Workhub:** botones, etiquetas y apariencia son declarativos. Los textos se muestran siempre como texto (nunca HTML), los iconos salen solo del set y las ubicaciones, tonos y valores de apariencia están cerrados.
- **Límites:**
  - 60 escrituras por minuto (incluye añadir botones o etiquetas);
  - 100 KB por clave y 800 KB por proyecto en `storage`;
  - textos recortados a longitudes razonables (título de tarea: 200 caracteres).
- **Uso responsable:** pide el mínimo de permisos y explica en `description` qué haces con los datos.

## Plugins oficiales

Están en la carpeta [`plugins/`](../plugins) de este repositorio y se publican con la app. Sirven de ejemplo completo:

| Plugin | Carpeta | Permisos |
|---|---|---|
| **Informe de trabajo** (icono `chart`): resumen por cliente y estado, vencidas, copiar resumen, descargar CSV. Añade el botón **Informe** a la barra de Tareas y una acción a `Ctrl K`. | [`plugins/informe`](../plugins/informe) | `tasks:read`, `ui:extend` |
| **Temporizador** (icono `timer`): cronómetro por tarea y totales. Añade **Iniciar cronómetro** a la ficha de cada tarea, **Detener** a la barra de Tareas y a `Ctrl K` mientras cuenta, y una **etiqueta con el tiempo** en cada tarjeta. | [`plugins/temporizador`](../plugins/temporizador) | `tasks:read`, `storage`, `ui:extend` |
| **Apariencia** (icono `sparkles`): cualquier color de acento, esquinas rectas o redondeadas y densidad compacta o amplia, iguales en todos los proyectos. | [`plugins/apariencia`](../plugins/apariencia) | `appearance`, `storage` |

Para añadir uno oficial al repositorio:

1. Crea su carpeta en `plugins/` con un `id` que empiece por `workhub.`.
2. Añádelo a `src/services/official-plugins.js` con el **mismo** manifiesto.

## Preguntas frecuentes

**¿Por qué mi plugin dice «No se pudo conectar con Workhub: timeout»?**
Estás abriendo la página fuera de Workhub, o el SDK no se cargó. Revisa la ruta de `workhub-plugin.js`.

**Workhub dice «Esa dirección no respondió como un plugin».**
La página no llama a `WorkhubPlugin.connect()` en los primeros 10 segundos, o el enlace no es el de la página del plugin.

**¿Funcionan los plugins si abro Workhub con doble clic en `index.html`?**
No. El navegador no deja que una página aislada cargue archivos del disco. Usa `start-workhub.bat` o la web publicada.

**¿Cómo actualizo mi plugin?**
Publica los cambios en la misma dirección: se cargan la próxima vez que se abra. Si pides permisos nuevos, el usuario tendrá que aprobarlos.

**¿Puede mi plugin funcionar en segundo plano?**
Sí. Si pide `ui:extend` o `appearance`, Workhub lo carga oculto mientras esté abierto (`wh.isBackground === true`). Además, el panel sigue activo aunque el usuario cambie de sección, hasta que pulse «Volver a los plugins».

**¿Puede mi plugin cambiar cualquier parte de la interfaz o inyectar su propio HTML o CSS?**
No, a propósito. Puede añadir botones y etiquetas en los sitios de la tabla y cambiar la apariencia con los valores permitidos, pero no insertar HTML ni CSS propios en Workhub. Si necesitas una interfaz más compleja, hazla en tu panel y ábrelo con un botón (`wh.ui.openPanel()`).

**¿Necesitas otro sitio para tus botones?**
Abre un *issue* en el repositorio proponiendo la nueva ubicación y qué contexto necesitaría.
