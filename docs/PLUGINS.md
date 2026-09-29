# Crear plugins para Workhub

Un plugin es **una página web** que Workhub abre dentro de la sección **Plugins**. Puede leer y crear tareas, consultar clientes, contactos y reuniones, guardar sus propios datos y mostrar avisos, siempre con los permisos que el usuario le da al instalarlo.

Puedes publicarlo donde quieras (GitHub Pages, Netlify, tu propio servidor…) y cualquiera puede instalarlo pegando su enlace en **Plugins → Añadir**.

- [Cómo funciona](#cómo-funciona)
- [Tu primer plugin en 5 minutos](#tu-primer-plugin-en-5-minutos)
- [El manifiesto](#el-manifiesto)
- [Permisos](#permisos)
- [Referencia de la API](#referencia-de-la-api)
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
  <link rel="stylesheet" href="https://workhub-project.netlify.app/plugins/sdk/workhub-plugin.css">
</head>
<body>
  <h1>Hola</h1>
  <p id="out" class="wh-muted">Conectando…</p>

  <script src="https://workhub-project.netlify.app/plugins/sdk/workhub-plugin.js"></script>
  <script>
    WorkhubPlugin.connect({
      id: 'com.tu-nombre.hola',
      name: 'Hola',
      version: '1.0.0',
      description: 'Cuenta tus tareas abiertas.',
      author: 'Tu nombre',
      icon: '👋',
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
| `icon` | No | Un emoji, por ejemplo `🧩`. |
| `permissions` | No | Lista de permisos (siguiente apartado). Pide **solo** los que uses. |

## Permisos

| Permiso | Qué permite |
|---|---|
| `tasks:read` | Leer las tareas del proyecto abierto (título, descripción, cliente, estado, fecha límite, contacto) y abrir una tarea en Workhub. |
| `tasks:write` | Crear tareas y modificar las existentes. |
| `clients:read` | Leer la lista de clientes. |
| `contacts:read` | Leer los contactos de los clientes (nombre, email, teléfono, notas). |
| `calendar:read` | Leer las reuniones del calendario. |
| `calendar:write` | Crear reuniones. |
| `storage` | Guardar datos propios del plugin (por proyecto). |

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
wh.context.locale       // 'es'
await wh.statuses()     // [{key:'pendiente', label:'Pendiente'}, {key:'proceso', ...}, {key:'espera', ...}, {key:'completada', ...}]
```

Si la página se abre fuera de Workhub, `connect` falla con el mensaje `not-in-workhub`, así puedes mostrar una explicación.

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

Cada plugin tiene su propio espacio **en cada proyecto** (hasta 800 KB), sincronizado con la cuenta del usuario.

```js
await wh.storage.set('ajustes', {modo:'compacto'})   // cualquier valor JSON, hasta 100 KB por clave
await wh.storage.get('ajustes')                      // el valor, o null si no existe
await wh.storage.keys()                              // ['ajustes', ...]
await wh.storage.remove('ajustes')
```

Las claves admiten letras, números, `_`, `-` y `.` (hasta 64). Cuando el usuario quita el plugin, sus datos se borran.

### Interfaz

```js
await wh.ui.toast('Guardado')                  // aviso en Workhub ("Tu plugin: Guardado")
await wh.ui.toast('Algo falló', {type:'error'})
await wh.ui.openTask(id)                       // abre la ficha de la tarea en Workhub (tasks:read)
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
- **Cualquier hosting estático sirve:** GitHub Pages, Netlify, Vercel, Cloudflare Pages…
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
- **Límites:**
  - 60 escrituras por minuto;
  - 100 KB por clave y 800 KB por proyecto en `storage`;
  - textos recortados a longitudes razonables (título de tarea: 200 caracteres).
- **Uso responsable:** pide el mínimo de permisos y explica en `description` qué haces con los datos.

## Plugins oficiales

Están en la carpeta [`plugins/`](../plugins) de este repositorio y se publican con la app. Sirven de ejemplo completo:

| Plugin | Carpeta | Permisos |
|---|---|---|
| **Informe de trabajo**: resumen por cliente y estado, vencidas, copiar resumen, descargar CSV | [`plugins/informe`](../plugins/informe) | `tasks:read` |
| **Temporizador**: cronómetro por tarea y tiempo total por tarea y cliente | [`plugins/temporizador`](../plugins/temporizador) | `tasks:read`, `storage` |

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
Sigue activo mientras está abierto, aunque el usuario cambie de sección, hasta que pulse «Volver a los plugins». Así funciona el Temporizador.
