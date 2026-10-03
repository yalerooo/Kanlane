# Trabajo en equipo

Un proyecto de Kanlane puede compartirse con otras personas: cada una entra con su propia cuenta, ve el mismo tablero en tiempo real y las tareas se pueden **asignar** (a otras personas o a uno mismo), como en Trello.

Requiere cuenta (Firebase). El modo invitado y el modo local no tienen equipos.

## Cómo se usa

1. **Compartir un proyecto**: menú de proyectos (arriba a la izquierda) → **Compartir este proyecto**, o `Ctrl K` → *Compartir proyecto*.
   - Si el proyecto es **personal**, se ofrece **convertirlo en proyecto de equipo**. Se crea un equipo nuevo con una copia de sus tareas (con notas e imágenes), clientes, contactos y reuniones. El proyecto original **no cambia**.
   - Si ya es de equipo, se ve la lista de miembros y (solo el propietario) se puede invitar, cambiar roles y quitar gente.
2. **Invitar**: se escribe el correo de la otra persona y se elige su rol. Tiene que registrarse (o ya tener cuenta) con **ese mismo correo, verificado**.
3. **Aceptar**: al entrar, la persona invitada ve la invitación en el menú de proyectos (con un punto en el botón). Si es una cuenta nueva, aparece dentro de la pantalla de «Crea tu primer proyecto», y aceptarla evita crear un proyecto propio.
4. **Asignar**: en el formulario de la tarea, *Asignada a* (uno o varios miembros). En la ficha de la tarea, **Asignármela** / **Quitar mi asignación**. Las tarjetas muestran los avatares. En la barra de Tareas, el filtro por miembro (*Asignadas a mí*, *Sin asignar*, una persona) y `Ctrl K` → *Mis tareas*.

## Roles

| Rol | Puede |
|---|---|
| **Propietario** | Todo: invitar, cambiar roles, quitar miembros, cambiar el tipo y las columnas, eliminar el proyecto. Solo hay uno (quien lo creó). |
| **Editor** | Crear, editar, mover y borrar tareas, notas, clientes, contactos y reuniones. Cambiar columnas y etiquetas. No gestiona miembros. |
| **Lector** | Solo ver. La interfaz oculta los botones de edición y el servidor rechaza cualquier escritura. |

Cualquiera que no sea propietario puede **salir del equipo** (Compartir → *Salir del equipo*). El propietario, en cambio, tiene que eliminar el proyecto.

## Qué no se comparte (todavía)

- **Las contraseñas guardadas.** En un proyecto de equipo no hay gestor de contraseñas, y al convertir un proyecto no se copian. Compartirlas exige un diseño criptográfico aparte (ver más abajo).
- **El acceso a GitHub.** La integración con GitHub Projects funciona en un equipo, y al convertir un proyecto enlazado el enlace pasa al equipo (el original deja de sincronizar). Pero el acceso a GitHub es de cada persona y solo está en su navegador: cada miembro conecta su cuenta con *Conectar con GitHub* (sin token) o pegando uno. Detalles en [GITHUB.md](GITHUB.md#en-un-proyecto-de-equipo).

## Cómo está guardado

```
teams/{id}                      ← el proyecto: nombre, color, tipo, etapas, etiquetas…
    ownerUid, memberIds[]       ← quién es el propietario y la lista de miembros (para consultarlos)
    members{uid: {role, name, email, photo}}
teams/{id}/tasks|clients|contacts|meetings|plugin_data|assets/…
teams/{id}/tasks/{tarea}/notes/…
invites/{idDelEquipo}_{correo}  ← invitación pendiente: {teamId, teamName, email, role, invitedByUid, invitedByName}
```

- Los proyectos personales siguen exactamente donde estaban (`users/{uid}/…`); no hay migración.
- En el cliente, un equipo se identifica como `t:{id}` (`ProjectModel.isTeam`). `ProjectModel.list()` mezcla los personales y los de equipo; los de equipo llevan `team: true` y `role`.
- `ProjectModel.set` **no reescribe** `ownerUid`, `memberIds` ni `members`: solo envía los campos de configuración que han cambiado, para no pisar a alguien que acaba de entrar.
- Cada tarea guarda `assignees: [uid]`. Si alguien sale del equipo, su asignación se ignora al pintar.
- Las imágenes de las notas de un equipo van a `teams/{id}/assets` (las ven todos los miembros).
- En la ficha de cada tarea, propietarios y editores pueden comentar. La ficha muestra comentarios y actividad básica (creación, edición, movimientos, asignación y subtareas) con autor y fecha. Se guardan en `teams/{id}/tasks/{taskId}/notes` y los lectores pueden consultarlos. Es un historial de colaboración, no un registro inmutable de auditoría.

Código: `src/models/project-model.js` (equipos en la lista), `src/models/team-model.js` (invitaciones, miembros, conversión), `src/controllers/team-controller.js` y `src/views/share-view.js` (diálogo de compartir), `src/views/team-ui.js` (contexto de equipo para las vistas) y `src/services/firebase-backend.js` (`db.team(id)` y `db.teams`).

## Una limitación de Firestore que hay que respetar

Las reglas de un equipo consultan el documento del equipo (`get()`) para saber quién eres. Firestore limita esas consultas a **10 por operación suelta y a 20 por lote entero (`batch`)**. Por eso **en un equipo no se pueden escribir muchos documentos con un lote**: hay que escribirlos uno a uno (así lo hace `TeamModel.convert`, con 12 a la vez). **El emulador no aplica el límite de los lotes**, así que una prueba local con un lote grande pasa y en producción falla con `permission-denied`. Si se añade en el futuro algo que escriba muchos documentos de un equipo, hay que hacerlo igual.

## Reglas de Firestore (hay que publicarlas)

Los equipos **no funcionan hasta que se publican las reglas nuevas** (`firestore.rules`): `firebase deploy --only firestore:rules`, o pegar el contenido en *Firestore Database → Reglas*. Lo que aplican:

- Un equipo solo lo lee quien está en `memberIds`; sus datos, solo los miembros. **Escribir** los datos exige ser propietario o editor.
- Quien crea un equipo es su único miembro y propietario.
- El propietario cambia lo que quiera del documento (menos quién es el propietario). Un editor cambia la configuración pero no los miembros.
- **Entrar en un equipo** solo es posible si existe una invitación dirigida al correo (verificado) de quien entra, con el rol invitado, y sin tocar nada más del documento.
- Cualquiera que no sea propietario puede salirse él mismo (y solo a sí mismo).
- Las invitaciones las crea y cancela solo el propietario; las lee, acepta o rechaza solo el destinatario (por su correo verificado).
- En un equipo no se permiten `vault` ni `vault_meta`.

Estas reglas se prueban contra el emulador de Firestore con `tests/rules` (59 comprobaciones): ver [tests/rules/README.md](../tests/rules/README.md).

## Equipos con cifrado total

Un proyecto con **cifrado total** (ver `docs/CIFRADO-PROYECTOS.md`) también se puede compartir. El servidor sigue sin ver el contenido, así que la clave del proyecto tiene que llegar a cada persona por otro camino: un **código de acceso**.

**Convertir.** En «Compartir» se pide la contraseña de cifrado del proyecto y se enseña una **clave de recuperación nueva, la del equipo** (hay que confirmar que se ha guardado antes de crear nada). El equipo tiene su propia clave: todo se copia descifrando con la del original y volviendo a cifrar con la del equipo, imágenes incluidas. Lo que se edite después en el original no se puede leer con la clave del equipo, y al revés. La contraseña de cifrado de la propietaria en el equipo es la misma que la del proyecto original.

**Invitar.** Además del correo y el rol, el propietario escribe **su contraseña de cifrado**. Kanlane crea un código de 20 caracteres (`XXXX-XXXX-XXXX-XXXX-XXXX`) y lo enseña **una sola vez**: hay que dárselo a esa persona por un canal distinto del correo de la invitación (en persona, por mensaje…). El código no se guarda en ningún sitio, **caduca a las 24 horas** y solo sirve una vez. Invitar de nuevo al mismo correo crea otro código y anula el anterior.

**Aceptar.** Quien recibe la invitación (lleva la insignia «Cifrado») escribe el código y elige **su propia contraseña de cifrado** para ese proyecto; después ve **su propia clave de recuperación** y tiene que confirmar que la ha guardado. Cada miembro tiene su contraseña y su clave de recuperación: nadie conoce las de los demás. Si el código ha caducado hay que pedir otra invitación.

**Roles.** Igual que en cualquier equipo. Un lector también recibe la clave (la necesita para leer), pero las reglas no le dejan escribir.

**Expulsar.** Quitar a alguien le cierra el acceso al servidor y borra su clave envuelta y su clave pública, pero **lo que ya haya visto o descargado no se le puede quitar**, y pudo quedarse con la clave del proyecto. Por eso, después de quitar a alguien, «Compartir» ofrece **cambiar la clave del proyecto**.

**Cambiar la clave del proyecto.** Lo hace el propietario desde el aviso de «Compartir» o desde «Editar proyecto → Privacidad» (también vale en un proyecto personal con cifrado total). Escribe su contraseña de cifrado, guarda la **clave de recuperación nueva** que se le enseña y Kanlane crea una clave nueva y **vuelve a cifrar todo el proyecto** con ella (tareas, notas, imágenes, clientes, contactos, reuniones, datos de plugins y, en un proyecto personal, el cofre). La clave anterior deja de servir: quien se la hubiera copiado no puede leer nada de lo que hay ahora en el servidor, ni lo que se guarde después. Lo que esa persona ya vio o descargó sigue sin poderse retirar.

- **Cómo reciben la clave los demás.** Cada miembro publica en el equipo una **clave pública** (se crea al entrar; la privada va envuelta con su contraseña). El propietario deja la clave nueva envuelta con la clave pública de cada uno. La próxima vez que ese miembro abra el proyecto se le pide **su contraseña de cifrado** y recibe una **clave de recuperación nueva** (la anterior envolvía la clave vieja y ya no sirve).
- **Huellas.** «Compartir» enseña junto a cada miembro la huella de su clave pública (`XXXX-XXXX-XXXX`). La reparte el servidor, así que, si quieres estar seguro de que nadie la ha sustituido, compárala con esa persona por otro canal antes de cambiar la clave.
- **Quien no ha publicado su clave pública** (no ha abierto el proyecto desde que existe esta función) no puede recibir la clave nueva: el diálogo lo avisa antes de empezar. Pierde el acceso y hay que quitarle y volver a invitarle con un código.
- **Si se corta a medias** (se cierra la pestaña, se va la red) no se pierde nada: durante el cambio conviven documentos con la clave anterior y con la nueva y los miembros leen con las dos. El propietario lo termina al volver a abrir el proyecto; si su navegador ya no tiene la clave anterior (cerró sesión), basta con desbloquear con su contraseña.
- Mientras dura el cambio, las reglas solo aceptan contenido sellado con la clave nueva. Lo que un miembro hubiera escrito **sin conexión** con la clave anterior se rechaza al volver la red.

**Editar a la vez.** En un proyecto cifrado todo el contenido de una tarea va en un único campo, así que dos personas que cambiasen a la vez el título y la descripción se pisarían. En los equipos cifrados esos cambios se hacen con una transacción (leer, mezclar, escribir); sin conexión se escribe con lo que hay en memoria y gana el último.

**Sin cofre.** Igual que en el resto de equipos, no hay gestor de contraseñas.

Cómo se guarda:

- `teams/{id}` lleva el campo `enc` (`pid`, `kid`, `kcv`), que no cambia.
- `teams/{id}/crypto/{uid}`: la clave del proyecto envuelta con la contraseña y con la clave de recuperación **de esa persona** (solo la lee ella), más su par de claves: `pub` (pública, ECDH P-256) y `priv` (privada, envuelta con su contraseña). El par no se usa todavía: servirá para repartir una clave nueva al rotar sin tener que invitar otra vez. Si la persona recupera el acceso con su clave de recuperación se le crea un par nuevo.
- `invites/{idEquipo}_{correo}` añade `enc` (`pid`, `kid`, `kcv`) y `expiresAt` (orientativo, para la interfaz).
- `invites/{…}/key/wrap`: la clave del proyecto envuelta con el código (PBKDF2, 100 000 iteraciones). Solo la lee el destinatario y solo durante 24 horas desde que el servidor la creó: eso lo aplican las reglas, no la app. Se borra al aceptar.
- Aceptar es un lote de cuatro escrituras: entrar en el equipo, guardar la clave envuelta propia, borrar la clave envuelta con el código y borrar la invitación.

**Pendiente de comprobar en producción:** el emulador no aplica el límite de 20 consultas de reglas por lote, así que ese lote de cuatro hay que probarlo con dos cuentas reales.

## Compartir contraseñas: siguiente fase

Lo acordado es **cifrado extremo a extremo por miembro**, sin compartir ninguna contraseña maestra:

1. Cada persona genera un par de claves (RSA-OAEP o ECDH) en su navegador. La clave pública se guarda en su perfil; la privada, cifrada con una frase de paso suya (o derivada de su contraseña maestra actual).
2. Cada gestor de contraseñas de equipo tiene una **clave de proyecto** aleatoria (AES-256) con la que se cifran las credenciales.
3. La clave de proyecto se guarda cifrada **una vez por miembro**, con la clave pública de cada uno (`teams/{id}/keys/{uid}`).
4. Para **invitar**, el propietario cifra la clave de proyecto para el nuevo miembro al aceptar. Para **expulsar**, se genera una clave nueva, se vuelven a cifrar las credenciales y se reparte solo a los que quedan.
5. El servidor solo ve texto cifrado. Perder la frase de paso implica no poder descifrar (con clave de recuperación, como hoy).

Hasta entonces, las contraseñas se quedan en los proyectos personales.
