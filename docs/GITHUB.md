# Sincronizar con GitHub Projects

Workhub puede enlazar un proyecto suyo con un **GitHub Project** (los tableros nuevos, "v2"). Las columnas de GitHub pasan a ser las columnas de Workhub y las tareas se mantienen sincronizadas en los dos sentidos: si mueves algo en un lado, se mueve en el otro.

## Conectar

1. En GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic)** → *Generate new token (classic)* y marca el permiso **`project`** (o `read:project` si solo quieres leer). Los tokens *fine-grained* no funcionan con proyectos de usuario.
2. En Workhub abre el proyecto que quieras enlazar → **Ajustes → GitHub Projects**.
3. Pega el token y el enlace del proyecto, por ejemplo `https://github.com/users/yalerooo/projects/1/views/1` (también valen los de organización: `https://github.com/orgs/…`).
4. Opcional: *Enviar también a GitHub las tareas que ya hay en este proyecto*. Sin marcar, solo se envían las que crees a partir de ahora.
5. **Conectar con GitHub**. Las columnas del tablero se sustituyen por las opciones del campo *Status* del proyecto y se importan sus elementos.

Cada proyecto de Workhub puede enlazarse con un proyecto de GitHub distinto. El enlace se guarda en el documento del proyecto (`github`), sin secretos.

## Qué se sincroniza

| Cambio | Resultado |
|---|---|
| Mover una tarea de columna (en cualquiera de los dos lados) | Se mueve en el otro |
| Cambiar título o descripción | Se copia en el otro lado (borradores y *issues*; las *pull requests* solo bajan) |
| Elemento nuevo en GitHub | Aparece como tarea en Workhub |
| Tarea nueva en Workhub | Se crea en GitHub como **borrador** del proyecto (si está activado *Enviar a GitHub las tareas nuevas*) |
| Columna nueva en GitHub | Se añade una columna en Workhub |
| Cambian los dos lados a la vez | Gana el cambio más reciente |
| Borrar | **No se sincroniza.** Lo borrado en Workhub no vuelve a importarse; lo borrado en GitHub se queda en Workhub |

Las tareas enlazadas muestran una marca de GitHub en la tarjeta y un enlace al elemento en su ficha. Los datos de Workhub que GitHub no tiene (cliente, contacto, fecha límite, notas, contraseñas vinculadas) se quedan solo en Workhub.

Se sincroniza al abrir el proyecto, al volver a la pestaña, cada 2 minutos y unos segundos después de cambiar algo en Workhub. También con el botón **GitHub** de la barra de Tareas o **Sincronizar ahora** en Ajustes.

## Límites

- Workhub admite hasta **8 columnas**; si el proyecto de GitHub tiene más, los elementos de las sobrantes se ven en la primera columna.
- Renombrar una columna en Workhub no la renombra en GitHub.
- Se leen hasta 2 000 elementos por proyecto. Los archivados se ignoran.
- La API de GitHub limita las peticiones (5 000 puntos por hora); una sincronización gasta muy pocos.

## Seguridad

- El **token se guarda solo en este navegador** (`localStorage`); nunca se sube a Firestore ni al repositorio. En otro dispositivo hay que pegarlo otra vez. **Olvidar token** lo borra.
- Un token con permiso `project` puede leer y modificar **todos** tus proyectos de GitHub. Créalo con caducidad, y revócalo en GitHub si dejas de usar la integración.
- La política de contenido (`netlify.toml`) permite conectar con `https://api.github.com`, y nada más de GitHub.

## Por dentro

- `src/services/github-api.js`: cliente GraphQL (proyecto, elementos, mutaciones).
- `src/models/github-sync.js`: motor de sincronización. Cada tarea enlazada guarda `ghItemId`, `ghContentId`, `ghUrl`, `ghNumber`, `ghRepo`, `ghSyncedAt` y `ghRemoteAt`. Cambio local = `updatedAt > ghSyncedAt`; cambio remoto = fecha en GitHub `> ghRemoteAt`.
- `src/controllers/github-controller.js` y `src/views/github-view.js`: tarjeta de Ajustes, botón de la barra de Tareas y temporizadores.
- Las claves de las columnas son `g` + el id de la opción de GitHub.
