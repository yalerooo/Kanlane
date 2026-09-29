# Workhub

Gestor de trabajo por cliente: tareas, calendario con reuniones, contactos, contraseñas cifradas y clientes (Finba, Mondragón Unibertsitatea, UNIA, Institut de Teatre, etc.). En Ajustes se puede elegir el color de acento y el tema claro/oscuro.

**Versión en vivo:**
https://workhub-project.netlify.app/ 

## Qué hay en esta carpeta

- `index.html` — la página: estructura HTML de la app y carga de estilos y scripts.
- `assets/css/` — estilos, separados en tokens de diseño, base, layout, componentes y vistas.
- `src/` — el código JavaScript, organizado en MVC (ver abajo).
- `data-backup.json` — copia de los datos guardados en el momento de exportar (tareas, notas, contactos, clientes y las contraseñas **cifradas**, nunca en texto plano). Tiene el mismo formato que genera el propio botón "Exportar copia de seguridad" del tablero.
- `start-workhub.bat` — doble clic y ya está (ver abajo).
- `firebase.json`, `firestore.rules`, `firestore.indexes.json` y `src/config/firebase-config.js` — publicación en la web con inicio de sesión (ver abajo).
- `docs/FIREBASE.md` — guía paso a paso para publicarlo con Firebase.
- `netlify.toml` y `docs/NETLIFY.md` — publicación en Netlify.

## Arquitectura (MVC)

```
assets/css/
  tokens.css, base.css, layout.css    variables de color/tema, reset y estructura general
  components/                         botones, campos, barras, tarjetas, diálogos
  views/                              estilos propios de tablero, calendario, contraseñas y ajustes
src/
  core/         namespace global, emisor de eventos y almacén local (IndexedDB) sin Claude
  utils/        HTML/iconos, fechas, URLs, ayudas de interfaz (copiar, arrastrar y soltar)
                y desplazamiento automático al arrastrar
  config/       configuración de Firebase (vacía = modo local)
  services/     acceso a la plataforma (db, imágenes, descargas), backend de Firebase,
                cifrado y preferencias
  models/       datos y reglas de negocio: tareas, clientes, contactos, reuniones,
                contraseñas (cifrado y recuperación), ajustes y copia de seguridad
  views/        solo DOM: pintan el estado y avisan de las acciones del usuario
                (incluye dropdown.js, el desplegable propio que sustituye a los <select>)
  controllers/  conectan vistas y modelos; AppController arranca todo y navega entre secciones
  main.js       punto de entrada
```

- **Modelos**: cada colección (`tasks`, `clients`, `contacts`, `meetings`, `vault`) extiende `CollectionModel`, que la mantiene sincronizada en memoria y emite `change` cuando llegan datos nuevos. No tocan el DOM.
- **Vistas**: reciben datos y los pintan; exponen métodos `bind…(handler)` para que el controlador reaccione a clics, formularios y arrastres. No guardan nada.
- **Controladores**: escuchan a los modelos, deciden qué pintar y ejecutan las acciones (guardar, borrar, desbloquear…).

Detalles de interfaz:

- **Tablero**: ocupa el alto de la ventana y cada columna tiene scroll propio. Al arrastrar una tarea, las columnas y la página se desplazan solas al acercarte a un borde, y una línea marca la posición exacta donde caerá; el orden dentro de cada columna se guarda (campo `order`). El botón **+** de cada columna crea una tarea con ese estado.
- **Proyectos**: el selector de la parte de arriba de la barra lateral cambia de proyecto al instante, sin recargar. Cada proyecto tiene sus propias tareas (con notas), reuniones, contactos, contraseñas (con su propia contraseña maestra) y clientes. Desde el mismo menú se crea un proyecto, y el lápiz de cada uno permite renombrarlo, cambiar su color o eliminarlo con todos sus datos (pide confirmación). El **proyecto principal** usa los datos de siempre, en la raíz de la base de datos, así que no hay que migrar nada y no se puede eliminar; los demás guardan todo en `projects/{id}/…`. La lista está en la colección `projects` (`ProjectModel`), y el último proyecto abierto se recuerda en el navegador. La copia de seguridad exporta e importa el proyecto abierto.
- **Paleta de comandos** (`Ctrl K` / `⌘K` o el botón *Buscar…* de la barra lateral): busca tareas, contactos, reuniones y clientes, y lanza acciones (nueva tarea/reunión/contacto/credencial/cliente, nuevo proyecto o cambiar a otro, ir a una sección, cambiar el tema, exportar la copia).
- **Atajos**: `N` crea una tarea y `/` enfoca el buscador de la sección actual (no se activan mientras escribes ni con un diálogo abierto).
- **Avisos**: confirmación breve al crear, guardar, mover o eliminar, y aviso si algo falla.
- **Ficha de tarea**: al hacer clic en una tarea (en el tablero o en el calendario) se abre una ficha de solo lectura con estado, cliente, fecha límite (con días restantes), contacto, descripción, notas y vínculos. Desde ella se puede cambiar el estado o pulsar **Editar tarea**; al guardar o cancelar la edición se vuelve a la ficha.
- **Colores de cliente**: en Clientes, el botón de paleta (o el avatar) permite elegir el color de cada cliente; se usa en etiquetas, avatares y desplegables. "Auto" vuelve al color derivado del nombre. Se guarda en el campo `color` (tono HSL) del cliente.
- **Desplegables**: cada `<select>` se muestra con `Dropdown` (lista flotante, buscador a partir de 8 opciones, teclado). El `<select>` real sigue existiendo oculto y es el que leen los controladores.

Los scripts son clásicos (no módulos ES) y comparten el espacio de nombres global `Workhub`, para que `index.html` siga funcionando abierto directamente desde el disco. El orden de los `<script>` en `index.html` importa: núcleo → utilidades → servicios → modelos → vistas → controladores → `main.js`.

## Publicarlo en la web con inicio de sesión (Firebase)

Workhub se puede publicar en `https://TU-PROYECTO.web.app` con inicio de sesión (Google, GitHub, Microsoft y correo) y los datos de cada usuario en Firestore, con el plan gratuito de Firebase, que no se pausa por inactividad. Sigue **[docs/FIREBASE.md](docs/FIREBASE.md)**; en resumen:

1. Crea el proyecto en la consola de Firebase y copia su configuración en `src/config/firebase-config.js`.
2. Activa los métodos de acceso (Authentication → Sign-in method) y crea la base de datos Firestore.
3. `firebase deploy --only hosting,firestore`.

También se puede publicar en **Netlify** (publicación automática al fusionar en `main`), usando Firebase solo para el acceso y los datos: ver **[docs/NETLIFY.md](docs/NETLIFY.md)**.

Con `apiKey` vacío (como viene), Workhub sigue funcionando exactamente igual que antes: en local o dentro de claude.ai.

## Cómo lanzarlo en local

`index.html` ya funciona por su cuenta, sin depender de claude.ai. Cuando lo abres fuera de un Artifact de Claude, detecta que no existe `window.claude` y usa en su lugar un almacén propio en el navegador (IndexedDB) con la misma forma — así que tareas, notas, imágenes, contactos, clientes y contraseñas se guardan igual, pero **solo en ese navegador y ese origen** (no se sincronizan con la versión de claude.ai ni entre distintos navegadores/ordenadores).

**La forma más rápida:** doble clic en **`start-workhub.bat`**. Abre una ventana de consola con el servidor local corriendo (no la cierres mientras uses el tablero) y te abre el navegador en `http://localhost:5500` automáticamente. Para cerrar el tablero, cierra esa ventana de consola.

Otras formas:

- **Doble clic en `index.html`** — en Chrome/Edge suele funcionar tal cual (IndexedDB y el cifrado funcionan igual sobre `file://`), pero es menos fiable que servirlo.
- **A mano**, con Python (ya lo tienes instalado):
  ```bash
  cd Tablero
  python -m http.server 5500
  ```
  y abre `http://localhost:5500` en el navegador.

Los datos de esta copia local y los de la versión en vivo (claude.ai) son **independientes** — usa la pestaña "Copia de seguridad" de cada una para exportar/importar y mantenerlas igualadas si lo necesitas.

## Restaurar los datos

Desde la pestaña **"Copia de seguridad"** del tablero, botón **"Importar copia de seguridad"**, seleccionando `data-backup.json`. Añade los datos a lo que ya haya en el tablero (no borra nada). Las contraseñas del archivo solo se importan si el tablero de destino todavía no tiene su propia contraseña maestra configurada.

## Subir esto a GitHub

Esta carpeta ya está inicializada como repositorio git local. Para subirla:

```bash
cd Tablero
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git branch -M main
git push -u origin main
```

Si el repositorio en GitHub es público, ten en cuenta que `data-backup.json` contiene nombres de clientes, contactos y tareas reales (las contraseñas van cifradas, pero el resto no) — usa un repositorio **privado** si no quieres que esa información sea visible.
