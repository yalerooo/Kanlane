# Sincronizar con GitHub Projects

Kanlane puede enlazar un proyecto suyo con un **GitHub Project** (los tableros nuevos, "v2"). Las columnas de GitHub pasan a ser las columnas de Kanlane y las tareas se mantienen sincronizadas en los dos sentidos: si mueves algo en un lado, se mueve en el otro.

## Dos formas de conectarlo

- **Crear un proyecto nuevo desde GitHub**: en el menú de proyectos, *Nuevo proyecto → Desde GitHub*. Pegas el token y el enlace, y Kanlane crea un proyecto nuevo (con el nombre que quieras o el del proyecto de GitHub) con sus columnas y elementos, ya sincronizado.
- **Añadirlo a un proyecto que ya tienes**: *Ajustes → GitHub Projects*. Eliges en qué proyecto de Kanlane se añade (por defecto, el abierto) o *Crear un proyecto nuevo*. Si eliges uno existente, **sus columnas se sustituyen por las de GitHub** y los elementos se importan junto a las tareas que ya tenía.

## Conectar

### Con un clic (sin token)

Si Kanlane tiene la cuenta activada y el acceso con GitHub habilitado en Firebase, aparece el botón **Conectar con GitHub** (en Ajustes, en *Nuevo proyecto → Desde GitHub* y donde falte el acceso). Se abre la ventana de GitHub para que autorices Kanlane con el permiso `project` y Kanlane guarda el acceso **solo en este navegador**, sin que tengas que crear ni copiar ningún token.

- Se hace con una segunda instancia de Firebase, con su propia sesión: **no cambia los métodos de acceso de tu cuenta** ni choca con que uses Google u otro proveedor con el mismo correo. La sesión temporal se cierra (y se borra si era una cuenta nueva) nada más recibir el acceso.
- Firebase no guarda ese acceso; lo guarda la app en `localStorage` (`workhub_gh_token`), como el token pegado a mano.
- Si el proyecto está en una **organización**, esa organización tiene que permitir la aplicación OAuth de Kanlane (GitHub lo pide en la ventana de autorización).
- Requisito de configuración: el proveedor **GitHub** activado en Firebase (Authentication → Sign-in method) y `'github'` en `providers` de `firebase-config.js`. Ver [FIREBASE.md](FIREBASE.md).

### Con un token

1. En GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic)** → *Generate new token (classic)* y marca el permiso **`project`** (o `read:project` si solo quieres leer). Los tokens *fine-grained* no funcionan con proyectos de usuario.
2. En Kanlane: *Nuevo proyecto → Desde GitHub*, o **Ajustes → GitHub Projects** (ver arriba).
3. Pega el token y el enlace del proyecto de GitHub, por ejemplo `https://github.com/users/yalerooo/projects/1/views/1` (también valen los de organización: `https://github.com/orgs/…`).
4. Solo al añadirlo a un proyecto existente, opcional: *Enviar también a GitHub las tareas que ya hay en ese proyecto*. Sin marcar, solo se envían las que crees a partir de ahora.
5. **Enlazar proyecto**. Las columnas del tablero se sustituyen por las opciones del campo *Status* del proyecto y se importan sus elementos.

Cada proyecto de Kanlane puede enlazarse con un proyecto de GitHub distinto. El enlace se guarda en el documento del proyecto (`github`), sin secretos.

## Qué se sincroniza

| Cambio | Resultado |
|---|---|
| Mover una tarea de columna (en cualquiera de los dos lados) | Se mueve en el otro |
| Cambiar título o descripción | Se copia en el otro lado (borradores y *issues*; las *pull requests* solo bajan) |
| Elemento nuevo en GitHub | Aparece como tarea en Kanlane |
| Tarea nueva en Kanlane | Se crea en GitHub como **borrador** del proyecto (si está activado *Enviar a GitHub las tareas nuevas*) |
| Columna nueva en GitHub | Se añade una columna en Kanlane |
| **Etiquetas** de una incidencia o pull request | Se sincronizan en los dos sentidos. En Kanlane se eligen en el formulario de la tarea (con el catálogo de etiquetas de los repositorios de GitHub, con sus colores) y también se pueden crear etiquetas propias. Al enviar a GitHub solo se aplican las que ya existen en el repositorio; las demás se quedan en Kanlane. Los borradores del proyecto no tienen etiquetas en GitHub |
| **Pull requests vinculadas** | Aparecen como chips en la tarjeta (verde abierta, morada fusionada, roja cerrada) y con enlace en la ficha. Solo se leen |
| **Actividad** de la incidencia | La ficha de la tarea muestra su línea de tiempo de GitHub (asignaciones, etiquetas, movimientos en el proyecto, pull requests vinculadas, cierres, reaperturas y comentarios). Solo se lee; no se puede comentar desde Kanlane |
| Cambian los dos lados a la vez | Gana el cambio más reciente |
| Borrar | **No se sincroniza.** Lo borrado en Kanlane no vuelve a importarse; lo borrado en GitHub se queda en Kanlane |

Las tareas enlazadas muestran una marca de GitHub en la tarjeta y un enlace al elemento en su ficha. Los datos de Kanlane que GitHub no tiene (cliente, contacto, fecha límite, subtareas, notas, contraseñas vinculadas) se quedan solo en Kanlane.

## Qué sale de Kanlane hacia GitHub

Es lo que dicen la [política de privacidad](../legal/privacidad/index.html) («Integración con GitHub») y el aviso que la app muestra antes de conectar (en *Nuevo proyecto → Desde GitHub* y en *Ajustes → GitHub Projects*):

- **Qué se envía, sin cifrar:** el **título**, la **descripción**, la **columna** (opción del campo *Status*) y las **etiquetas** de las tareas del proyecto enlazado. Las tareas nuevas se crean como **borradores** del GitHub Project si está activado *Enviar a GitHub las tareas nuevas* (y las que ya había, si se marcó al conectar). Si la tarea está vinculada a una incidencia de un repositorio, el título, la descripción y las etiquetas se cambian **en esa incidencia** (`updateIssue`, `addLabelsToLabelable`, `removeLabelsFromLabelable`).
- **Cómo:** desde el navegador del usuario directamente a `https://api.github.com` (GraphQL), con su token. No pasa por los servidores de Kanlane ni por Firebase. En un proyecto de equipo, desde el navegador de cada miembro que sincroniza.
- **Dónde acaba:** en GitHub, que lo trata según sus propios términos y su declaración de privacidad (responsable independiente; puede tratarlo en EE. UU.). Si el Project o el repositorio son públicos, esas tareas son públicas.
- **Borrar no se propaga:** lo enviado **se queda en GitHub** aunque se borre la tarea o el proyecto en Kanlane, se desvincule el proyecto o se cierre la cuenta. Hay que borrarlo en GitHub.
- **Cifrado por proyecto (plan, `docs/CIFRADO-PROYECTOS.md`):** cuando exista el cifrado total, esos proyectos **no se podrán enlazar con GitHub** (GitHub necesita las tareas sin cifrar); se bloqueará en la interfaz, en el motor y en las reglas (PR5).

Texto del aviso en la app (`app/index.html` `#pGhPrivacy` y `src/views/github-view.js` `PRIVACY`, traducido en `src/i18n/en.js`): «Al sincronizar, el título, la descripción, la columna y las etiquetas de las tareas se envían a GitHub sin cifrar y se quedan allí aunque desvincules el proyecto.» Si cambia lo que se sincroniza, hay que cambiar a la vez este apartado, el aviso y la política.

**Aviso antes de activar** (`app/index.html` `#dlgGhConsent`, `GithubView.consent`): al pulsar *Enlazar proyecto* o al crear un proyecto *Desde GitHub* se abre un diálogo que repite lo anterior y, si el destino es un proyecto que ya existe, que sus columnas se sustituyen. El botón *Activar sincronización* solo se habilita al marcar la casilla; *Cancelar* cierra sin guardar el token ni llamar a GitHub. Se muestra cada vez que se enlaza, no al sincronizar un proyecto ya enlazado. Prueba: `node tests/e2e/github-consent.js` (con GitHub interceptado).

Se sincroniza al abrir el proyecto, al volver a la pestaña, cada 2 minutos y unos segundos después de cambiar algo en Kanlane. También con el botón **GitHub** de la barra de Tareas o **Sincronizar ahora** en Ajustes.

## En un proyecto de equipo

Un proyecto enlazado con GitHub se puede convertir en **proyecto de equipo** (ver [EQUIPOS.md](EQUIPOS.md)). El enlace (`github`, sin ningún token) pasa al equipo y el original deja de sincronizar, para no tener dos proyectos con el mismo tablero.

- **Cada miembro conecta su propia cuenta de GitHub** (botón *Conectar con GitHub* o token): el acceso no se comparte ni viaja con la cuenta. Sin él, el proyecto muestra «Añadir token de GitHub» y no sincroniza en ese navegador.
- Varias personas pueden sincronizar a la vez. Lo que ya existe (mover, título, descripción, etiquetas) se sincroniza desde cualquiera. Lo que **crea** algo al cruzar (un elemento nuevo de GitHub → tarea, una tarea nueva → borrador en GitHub) lo hace solo el **propietario**, para no duplicar: si el propietario no está conectado, esos elementos nuevos esperan a que lo esté.
- Los **lectores** no sincronizan con GitHub.

## Límites

- Kanlane admite hasta **8 columnas**; si el proyecto de GitHub tiene más, los elementos de las sobrantes se ven en la primera columna.
- Renombrar una columna en Kanlane no la renombra en GitHub.
- Se leen hasta 2 000 elementos por proyecto. Los archivados se ignoran.
- La API de GitHub limita las peticiones (5 000 puntos por hora); una sincronización gasta muy pocos.

## Seguridad

- El **token se guarda solo en este navegador** (`localStorage`); nunca se sube a Firestore ni al repositorio. En otro dispositivo hay que pegarlo otra vez. **Olvidar token** / **Quitar mi acceso a GitHub** lo borran **de este navegador**, pero no lo revocan: para eso, en GitHub, *Settings → Applications* (autorización de «Conectar con GitHub») o *Developer settings → Personal access tokens* (token pegado). Cerrar sesión en Kanlane tampoco lo borra.
- Un token con permiso `project` puede leer y modificar **todos** tus proyectos de GitHub. Créalo con caducidad, y revócalo en GitHub si dejas de usar la integración.
- La política de contenido (`scripts/build-public.js`) permite conectar con `https://api.github.com`, y nada más de GitHub.

## Por dentro

- `src/services/github-api.js`: cliente GraphQL (proyecto, elementos, mutaciones).
- `src/models/github-sync.js`: motor de sincronización. Cada tarea enlazada guarda `ghItemId`, `ghContentId`, `ghUrl`, `ghNumber`, `ghRepo`, `ghSyncedAt` y `ghRemoteAt`. Cambio local = `updatedAt > ghSyncedAt`; cambio remoto = fecha en GitHub `> ghRemoteAt`.
- `src/controllers/github-controller.js` y `src/views/github-view.js`: tarjeta de Ajustes, botón de la barra de Tareas y temporizadores.
- Las claves de las columnas son `g` + el id de la opción de GitHub.
