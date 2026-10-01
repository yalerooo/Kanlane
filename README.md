# Kanlane

Gestor de trabajo por cliente: tareas, calendario con reuniones, contactos, contraseñas cifradas y clientes (Finba, Mondragón Unibertsitatea, UNIA, Institut de Teatre, etc.). En Ajustes se puede elegir el color de acento, el tema claro/oscuro y el idioma (español o inglés).

**Versión en vivo:**
https://kanlane.com/

## Qué hay en esta carpeta

- `index.html` — la página: estructura HTML de la app y carga de estilos y scripts.
- `assets/css/` — estilos, separados en tokens de diseño, base, layout, componentes y vistas.
- `src/` — el código JavaScript, organizado en MVC (ver abajo).
- `start-workhub.bat` — doble clic y ya está (ver abajo).
- `firebase.json`, `firestore.rules`, `firestore.indexes.json` y `src/config/firebase-config.js` — publicación en la web con inicio de sesión (ver abajo).
- `docs/FIREBASE.md` — guía paso a paso para publicarlo con Firebase.
- `docs/LEGAL.md` — páginas legales (privacidad, términos y cookies), aviso de cookies y lo que hay que rellenar antes de publicar.
- `docs/ROBUSTEZ.md` — App Check, límites contra abusos, copias cifradas recuperables y comprobaciones de producción.
- `docs/EQUIPOS.md` — proyectos de equipo: miembros, roles, invitaciones y asignación de tareas.
- `tests/rules/` — pruebas de `firestore.rules` contra el emulador.
- `scripts/build-public.js`, `wrangler.jsonc`, `worker/` y `docs/CLOUDFLARE.md` — publicación en Cloudflare (la web se publica sola al fusionar en `main`).

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
  i18n/         traducciones: motor (i18n.js) y diccionario inglés (en.js)
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
- **Trabajo en equipo**: un proyecto se puede compartir con otras cuentas (menú de proyectos → *Compartir este proyecto*). Un proyecto personal se convierte en uno de equipo (copia de sus datos, el original no cambia); se invita por correo con un rol (propietario, editor o lector) y las tareas se pueden asignar a los miembros, con avatares en las tarjetas, filtro por miembro y *Mis tareas*. Los datos del equipo están en `teams/{id}` y hay que publicar las reglas de Firestore nuevas. Las contraseñas guardadas todavía no se comparten. Guía completa: [docs/EQUIPOS.md](docs/EQUIPOS.md).
- **Eliminar el proyecto principal**: se puede, como cualquier otro. Se vacía la raíz (tareas, clientes, contactos, reuniones, contraseñas, instalaciones y datos de plugins) y su documento `projects/main` queda con `deleted:true`, así no reaparece en la lista. Si había más proyectos se pasa al primero que quede; si era el último, vuelve a salir el diálogo de primer proyecto (ver abajo).
- **Primer proyecto**: una cuenta nueva (sin proyectos y sin datos) no tiene ningún proyecto por defecto: al entrar aparece un diálogo, que no se puede cerrar, para elegir nombre, color y tipo (sin tipo preseleccionado, y sin la opción «Desde GitHub», que se puede añadir después desde Ajustes). Hasta crearlo no se ve la app. Ese primero ocupa el sitio del proyecto principal (raíz de la base de datos, documento `projects/main`), así que las cuentas que ya tienen datos no cambian. También sale al eliminar el último proyecto. Ver `ProjectsController.checkFirstRun`.
- **Proyectos**: el selector de la parte de arriba de la barra lateral cambia de proyecto al instante, sin recargar. Cada proyecto tiene sus propias tareas (con notas), reuniones, contactos, contraseñas (con su propia contraseña maestra) y clientes. Desde el mismo menú se crea un proyecto, y el lápiz de cada uno permite renombrarlo, cambiar su color o eliminarlo con todos sus datos (pide confirmación). El **proyecto principal** usa los datos de siempre, en la raíz de la base de datos, así que no hay que migrar nada; los demás guardan todo en `projects/{id}/…`. **Tipo de proyecto**: al crear (o editar) un proyecto se elige para qué es. *Soporte y tickets* (el de siempre: Pendiente, En proceso, Esperando al cliente, Completada, con clientes), *Desarrollo* (Por hacer, En curso, Hecho, sin clientes), *Kanban con revisión* (Backlog, En curso, En revisión, Hecho, sin clientes) o *Personalizado* (hasta 8 etapas con nombre, color y orden a tu gusto, una marcada como final, y con o sin clientes). Sin clientes se ocultan la sección Clientes y contactos, los filtros y campos de cliente y las etiquetas. El tipo vive en el documento del proyecto (`tipo`, y `stages` y `clients` si es personalizado; los proyectos sin `tipo` son de soporte, sin migrar nada) y se resuelve en `ProjectTemplates`. Si una tarea tiene una etapa que ya no existe, aparece en la primera columna. **Integración con GitHub Projects**: en Ajustes se enlaza el proyecto abierto con un GitHub Project y las tareas se sincronizan en los dos sentidos (ver [docs/GITHUB.md](docs/GITHUB.md)). **Columnas del tablero**: el menú «···» de cada cabecera (como en GitHub Projects) permite editar el nombre, el color y el **límite de tarjetas** (sin límite por defecto; la cuenta pasa a `3/2` en rojo al superarlo), ocultarla de la vista (solo en tu navegador, con un enlace «Mostrar» en el resumen), moverla a izquierda o derecha, eliminarla (sus tarjetas pasan a la primera columna) o eliminar todas sus tarjetas; las columnas también se reordenan arrastrando su cabecera. Editar las columnas de un proyecto de tipo predefinido lo convierte en personalizado (`ProjectsController.updateStages`). La lista está en la colección `projects` (`ProjectModel`), y el último proyecto abierto se recuerda en el navegador. La copia de seguridad exporta e importa el proyecto abierto.
- **Clientes y contactos**: una sola sección. A la izquierda, la lista de clientes (con cuántos contactos y tareas abiertas tiene cada uno); a la derecha, la ficha del cliente elegido con sus personas de contacto (email y teléfono se pueden pulsar para escribir o llamar), botones para ver sus tareas o sus contraseñas, y acciones para cambiar el color, renombrar o eliminar. El buscador encuentra a la vez clientes y personas (nombre, email, teléfono o notas) y resalta las coincidencias. Los contactos cuyo cliente se eliminó aparecen en "Sin cliente". Renombrar un cliente actualiza también sus tareas, reuniones, contactos y contraseñas. En móvil se ve primero la lista y, al elegir un cliente, su ficha.
- **Modo invitado**: en la pantalla de acceso, «Continuar como invitado» pide solo un nombre y entra sin cuenta. No se contacta con Firebase en ningún momento (ni siquiera se carga su SDK) y todo se guarda en el almacén local del navegador (IndexedDB), igual que el modo local. Los datos no viajan entre navegadores: para llevarlos hay que usar la copia de seguridad. El invitado se recuerda en `localStorage['workhub_guest']`; «Salir del modo invitado» lo olvida, pero los datos siguen en el navegador y reaparecen al volver a entrar como invitado. Ver `AuthController.enterGuest/startGuest`.
- **Plugins**: ver la sección [Plugins](#plugins) más abajo.
- **Idiomas**: español e inglés (Ajustes → Idioma, o el selector de la pantalla de inicio de sesión). La primera vez se usa el idioma del navegador; después, el elegido, que se guarda en la cuenta. La app está escrita en español y `src/i18n/i18n.js` traduce cada texto al pintarse (diccionario y patrones en `src/i18n/en.js`), así las vistas no saben nada de idiomas. Los datos del usuario (tareas, clientes, notas…) van marcados con `translate="no"` y nunca se traducen. Para añadir un idioma: crea `src/i18n/<código>.js` con `Workhub.i18n.add('<código>', {...}, [...])`, añádelo a `LANGS` en `i18n.js`, cárgalo en `index.html` y ponlo en el selector de Ajustes. `Workhub.i18n.missing()` lista en la consola los textos que aún no tienen traducción.
- **Paleta de comandos** (`Ctrl K` / `⌘K` o el botón *Buscar…* de la barra lateral): busca tareas, contactos, reuniones y clientes, y lanza acciones (nueva tarea/reunión/contacto/credencial/cliente, nuevo proyecto o cambiar a otro, ir a una sección, cambiar el tema, exportar la copia).
- **Atajos**: `N` crea una tarea y `/` enfoca el buscador de la sección actual (no se activan mientras escribes ni con un diálogo abierto).
- **Avisos**: aparecen ante errores, acciones que se pueden deshacer y confirmaciones importantes; las acciones habituales se reflejan en la propia interfaz.
- **Accesibilidad del tablero**: una tarjeta se abre con Intro o espacio; Alt + flechas la mueve entre columnas o dentro de ellas. Las pestañas de columnas responden a las flechas izquierda/derecha.
- **Equipos**: la ficha de tarea permite publicar comentarios y muestra la actividad básica (creación, edición, movimientos y subtareas) con autor y fecha.
- **Ficha de tarea**: al hacer clic en una tarea (en el tablero o en el calendario) se abre una ficha de solo lectura con estado, cliente, fecha límite (con días restantes), contacto, descripción, notas y vínculos. Desde ella se puede cambiar el estado o pulsar **Editar tarea**; al guardar o cancelar la edición se vuelve a la ficha.
- **Colores de cliente**: en Clientes, el botón de paleta (o el avatar) permite elegir el color de cada cliente; se usa en etiquetas, avatares y desplegables. "Auto" vuelve al color derivado del nombre. Se guarda en el campo `color` (tono HSL) del cliente.
- **Desplegables**: cada `<select>` se muestra con `Dropdown` (lista flotante, buscador a partir de 8 opciones, teclado). El `<select>` real sigue existiendo oculto y es el que leen los controladores.

Los scripts son clásicos (no módulos ES) y comparten el espacio de nombres global `Kanlane`, para que `index.html` siga funcionando abierto directamente desde el disco. El orden de los `<script>` en `index.html` importa: núcleo → utilidades → servicios → modelos → vistas → controladores → `main.js`.

## Publicarlo en la web con inicio de sesión (Firebase)

Kanlane se puede publicar en `https://TU-PROYECTO.web.app` con inicio de sesión (Google, GitHub, Microsoft y correo) y los datos de cada usuario en Firestore, con el plan gratuito de Firebase, que no se pausa por inactividad. Sigue **[docs/FIREBASE.md](docs/FIREBASE.md)**; en resumen:

1. Crea el proyecto en la consola de Firebase y copia su configuración en `src/config/firebase-config.js`.
2. Activa los métodos de acceso (Authentication → Sign-in method) y crea la base de datos Firestore.
3. `firebase deploy --only hosting,firestore`.

La web de producción se publica en **Cloudflare** (Workers con recursos estáticos; publicación automática al fusionar en `main`, sin ningún ordenador encendido), usando Firebase solo para el acceso y los datos: ver **[docs/CLOUDFLARE.md](docs/CLOUDFLARE.md)**.

Con `apiKey` vacío (como viene), Kanlane sigue funcionando exactamente igual que antes: en local o dentro de claude.ai.

## Plugins

Kanlane se puede ampliar con **plugins**: páginas web que se abren dentro de la sección **Plugins**, aisladas en un `<iframe sandbox>`, y que solo acceden a los datos que el usuario les permite al instalarlas (nunca a las contraseñas guardadas).

Los plugins se **instalan en el proyecto abierto**. Si quieres usar uno en otro proyecto, instálalo allí también. Al cambiar de proyecto se cierran sus paneles y botones y se cargan únicamente los plugins del nuevo proyecto. Al quitar uno se borran solo sus datos de ese proyecto. En equipos, propietarios y editores gestionan las instalaciones; los lectores pueden usar las ya instaladas.

- **Qué pueden hacer:** además de su propio panel, un plugin puede añadir **botones** en Tareas, en la ficha de tarea, en Calendario, en la ficha de cliente y en `Ctrl K`, **etiquetas** en las tarjetas del tablero, y cambiar la **apariencia** (tema, paleta, acento, tipografía, tamaño del texto, esquinas y densidad). No toca el HTML de Kanlane: declara lo que quiere añadir y Kanlane lo pinta.
- **Oficiales** (carpeta [`plugins/`](plugins)): **Informe de trabajo**, **Temporizador** (cronómetro desde la ficha de cada tarea y tiempo en cada tarjeta), **Smart GP** (al terminar una tarea pide las horas, los días y el proyecto, y las muestra en un calendario) y **Apariencia**. Se instalan con un clic desde la sección Plugins.
- **De terceros:** cualquiera puede publicar el suyo en una web con https, y se instala pegando su enlace.

**Guía para crear un plugin:** [docs/PLUGINS.md](docs/PLUGINS.md) (SDK, permisos, API, eventos, estilos y una [plantilla](plugins/plantilla) lista para copiar).

## Seguridad

Qué protege el código y qué hay que activar en la consola de Firebase (verificación de correo, política de contraseñas, dominios autorizados…): [docs/SEGURIDAD.md](docs/SEGURIDAD.md).

## Trabajar en local (con recarga automática)

Para desarrollar sin esperar a que Cloudflare despliegue nada, hay un servidor local con Node (no necesita instalar nada más):

```bash
node scripts/dev.js
```

o doble clic en **`start-dev.bat`** (Windows). Abre `http://localhost:5500/app/` (la aplicación; la portada pública está en `/`) y **la página se recarga sola cada vez que guardas** un archivo de `index.html`, `assets/`, `src/` o `plugins/`.

- **Modo local (por defecto):** sin inicio de sesión; los datos se guardan solo en ese navegador. Es el modo seguro para probar cosas.
- **Modo nube:** `node scripts/dev.js --nube` usa el Firebase real (te pide iniciar sesión, y **lo que cambies se guarda en tus datos de verdad**). `localhost` ya está autorizado en Firebase.
- Otro puerto: `node scripts/dev.js --puerto 8080`.
- Solo sirve lo que se publica (nunca `data-backup.json`, `docs/`, etc.). Lo que no se puede probar aquí es lo que depende de Cloudflare (el reenvío del inicio de sesión de `worker/` y las cabeceras de `_headers`).

## Cómo lanzarlo en local con Python

`index.html` ya funciona por su cuenta, sin depender de claude.ai. Cuando lo abres fuera de un Artifact de Claude, detecta que no existe `window.claude` y usa en su lugar un almacén propio en el navegador (IndexedDB) con la misma forma — así que tareas, notas, imágenes, contactos, clientes y contraseñas se guardan igual, pero **solo en ese navegador y ese origen** (no se sincronizan con la versión de claude.ai ni entre distintos navegadores/ordenadores).

**La forma más rápida:** doble clic en **`start-workhub.bat`**. Abre una ventana de consola con el servidor local corriendo (no la cierres mientras uses el tablero) y te abre el navegador en `http://localhost:5500` automáticamente. Para cerrar el tablero, cierra esa ventana de consola.

Otras formas:

- **Doble clic en `index.html`** — en Chrome/Edge suele funcionar tal cual (IndexedDB y el cifrado funcionan igual sobre `file://`), pero es menos fiable que servirlo.
- **A mano**, con Python (ya lo tienes instalado):
  ```bash
  cd Tablero
  python -m http.server 5500
  ```
  y abre `http://localhost:5500/app/` en el navegador.

Los datos de esta copia local y los de la versión en vivo (claude.ai) son **independientes** — usa la pestaña "Copia de seguridad" de cada una para exportar/importar y mantenerlas igualadas si lo necesitas.

## Restaurar los datos

Desde la pestaña **"Copia de seguridad"** del tablero, botón **"Importar copia de seguridad"**, selecciona un archivo exportado previamente. Añade los datos a lo que ya haya en el tablero (no borra nada). Las contraseñas del archivo solo se importan si el tablero de destino todavía no tiene su propia contraseña maestra configurada.

La misma pestaña conserva en este navegador hasta siete versiones por cuenta y proyecto. Se crea una versión diaria tras abrir la app (si permanece abierta unos segundos), y **Guardar versión** permite crear otra a mano. Puedes descargar o importar cualquiera; importar añade datos. Este historial es local y desaparece al borrar los datos del navegador, así que conviene descargar las copias importantes.

## Comprobaciones automáticas

Cada pull request ejecuta análisis de sintaxis, traducciones, compilación, pruebas del cofre y del service worker, reglas de Firestore en el emulador y recorridos de navegador con Chromium. Para ejecutarlas localmente:

```bash
node scripts/check-js.js
node scripts/check-i18n.js --strict
node tests/vault/vault.test.js
node tests/backup/backup.test.js
node tests/sw/sw.test.js
cd tests/rules && npm install && npm test
cd ../e2e && npm install && npm test
cd ../.. && npx --prefix tests/rules firebase emulators:exec --only auth,firestore --project demo-workhub --config firebase.test.json "node tests/e2e/cloud-smoke.js"
```

## Subir esto a GitHub

Esta carpeta ya está inicializada como repositorio git local. Para subirla:

```bash
cd Tablero
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git branch -M main
git push -u origin main
```

Las copias exportadas no se guardan en el repositorio. `data-backup.json` está excluido por `.gitignore`; guarda cualquier copia fuera de Git.
