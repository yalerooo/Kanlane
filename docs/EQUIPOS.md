# Trabajo en equipo

Un proyecto de Kanlane puede compartirse con otras personas: cada una entra con su propia cuenta, ve el mismo tablero en tiempo real y las tareas se pueden **asignar** (a otras personas o a uno mismo), como en Trello.

Requiere cuenta (Firebase). El modo invitado y el modo local no tienen equipos.

## Cómo se usa

1. **Compartir un proyecto**: menú de proyectos (arriba a la izquierda) → **Compartir este proyecto**, o `Ctrl K` → *Compartir proyecto*.
   - Si el proyecto es **personal**, se ofrece **convertirlo en proyecto de equipo**. El proyecto **se mueve**: se crea un equipo con sus tareas (con notas e imágenes), clientes, contactos, reuniones y contraseñas y, cuando todo está en el equipo, el proyecto personal **se elimina** (no quedan dos proyectos con el mismo nombre). Si tiene contraseñas guardadas se pide la **contraseña maestra** (ver «Contraseñas compartidas»). Solo se conserva el original si algo no se pudo copiar (documentos de un proyecto cifrado que no se pueden descifrar): entonces se avisa.
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

## Qué no se comparte

- **El acceso a GitHub.** La integración con GitHub Projects funciona en un equipo, y al convertir un proyecto enlazado el enlace pasa al equipo (el original deja de sincronizar). Pero el acceso a GitHub es de cada persona y solo está en su navegador: cada miembro conecta su cuenta con *Conectar con GitHub* (sin token) o pegando uno. Detalles en [GITHUB.md](GITHUB.md#en-un-proyecto-de-equipo).

## Cómo está guardado

```
teams/{id}                      ← el proyecto: nombre, color, tipo, etapas, etiquetas…
    ownerUid, memberIds[]       ← quién es el propietario y la lista de miembros (para consultarlos)
    members{uid: {role, name, email, photo}}
teams/{id}/tasks|clients|contacts|meetings|vault|plugin_data|assets/…
teams/{id}/tasks/{tarea}/notes/…
teams/{id}/vault_meta/check     ← marca de que el equipo tiene contraseñas compartidas
teams/{id}/vault_keys/{uid}     ← la clave del cofre de cada miembro, envuelta con SU contraseña maestra
teams/{id}/vault_grants/{correo} ← acceso de un solo uso: la clave del cofre envuelta con un código
invites/{idDelEquipo}_{correo}  ← invitación pendiente: {teamId, teamName, email, role, invitedByUid, invitedByName}
```

- Los proyectos personales siguen exactamente donde estaban (`users/{uid}/…`); no hay migración.
- En el cliente, un equipo se identifica como `t:{id}` (`ProjectModel.isTeam`). `ProjectModel.list()` mezcla los personales y los de equipo; los de equipo llevan `team: true` y `role`.
- `ProjectModel.set` **no reescribe** `ownerUid`, `memberIds` ni `members`: solo envía los campos de configuración que han cambiado, para no pisar a alguien que acaba de entrar.
- Cada tarea guarda `assignees: [uid]`. Si alguien sale del equipo, su asignación se ignora al pintar.
- Las imágenes de las notas de un equipo van a `teams/{id}/assets` (las ven todos los miembros).
- En la ficha de cada tarea, propietarios y editores pueden comentar. La ficha muestra comentarios y actividad básica (creación, edición, movimientos, asignación y subtareas) con autor y fecha. Se guardan en `teams/{id}/tasks/{taskId}/notes` y los lectores pueden consultarlos. Es un historial de colaboración, no un registro inmutable de auditoría.

Código: `src/models/project-model.js` (equipos en la lista), `src/models/team-model.js` (invitaciones, miembros, conversión), `src/models/team-vault.js` (contraseñas compartidas), `src/controllers/team-controller.js` y `src/views/share-view.js` (diálogo de compartir), `src/views/team-ui.js` (contexto de equipo para las vistas) y `src/services/firebase-backend.js` (`db.team(id)` y `db.teams`).

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
- Las credenciales (`vault`) las leen los miembros y las escriben propietario y editores. La marca del cofre (`vault_meta/check`) la crea el propietario una vez y no cambia. Cada miembro solo lee y escribe **su** clave envuelta (`vault_keys/{uid}`); el propietario puede borrar las de otros. Un acceso (`vault_grants/{correo}`) lo crea el propietario, lo lee solo la persona con ese correo verificado y solo durante 24 horas, no se puede sobrescribir y se borra al usarlo.

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

**Cofre.** Un equipo cifrado también tiene contraseñas compartidas (ver más abajo). Sus credenciales van además selladas con la clave del proyecto, como el resto de los datos, y se vuelven a cifrar al cambiar la clave del proyecto. El enlace de acceso a las contraseñas es aparte del código de acceso del proyecto: al invitar se enseñan los dos.

Cómo se guarda:

- `teams/{id}` lleva el campo `enc` (`pid`, `kid`, `kcv`), que no cambia.
- `teams/{id}/crypto/{uid}`: la clave del proyecto envuelta con la contraseña y con la clave de recuperación **de esa persona** (solo la lee ella), más su par de claves: `pub` (pública, ECDH P-256) y `priv` (privada, envuelta con su contraseña). El par no se usa todavía: servirá para repartir una clave nueva al rotar sin tener que invitar otra vez. Si la persona recupera el acceso con su clave de recuperación se le crea un par nuevo.
- `invites/{idEquipo}_{correo}` añade `enc` (`pid`, `kid`, `kcv`) y `expiresAt` (orientativo, para la interfaz).
- `invites/{…}/key/wrap`: la clave del proyecto envuelta con el código (PBKDF2, 100 000 iteraciones). Solo la lee el destinatario y solo durante 24 horas desde que el servidor la creó: eso lo aplican las reglas, no la app. Se borra al aceptar.
- Aceptar es un lote de cuatro escrituras: entrar en el equipo, guardar la clave envuelta propia, borrar la clave envuelta con el código y borrar la invitación.

**Pendiente de comprobar en producción:** el emulador no aplica el límite de 20 consultas de reglas por lote, así que ese lote de cuatro hay que probarlo con dos cuentas reales.

## Contraseñas compartidas

Un proyecto de equipo tiene su propio gestor de contraseñas, compartido entre los miembros y **cifrado en el navegador de cada uno**: el servidor solo guarda texto cifrado y nadie comparte su contraseña maestra con nadie.

**Cómo funciona.** Las credenciales del equipo se cifran con una **clave del cofre** (AES-256) que es la misma para todos. Esa clave no se guarda nunca tal cual: cada miembro tiene una copia envuelta con **su propia contraseña maestra** y otra con **su propia clave de recuperación** (`vault_keys/{uid}`, que solo lee él). Es el mismo esquema del gestor de un proyecto personal, repetido por persona.

**Convertir un proyecto con contraseñas.** «Compartir» pide la **contraseña maestra** del proyecto personal. Con ella se abre la clave del cofre, las credenciales pasan al equipo tal como estaban (no se vuelven a cifrar) y las tareas conservan sus contraseñas vinculadas. La propietaria sigue entrando con **la misma contraseña maestra y la misma clave de recuperación**. Un cofre del formato antiguo hay que desbloquearlo antes una vez (se actualiza solo). Un cofre sin credenciales no se lleva.

**Crear el cofre en un equipo que no lo tiene.** Solo el propietario: entra en *Contraseñas* y elige su contraseña maestra. Los demás ven «Todavía no hay contraseñas compartidas».

**Dar acceso.** En «Compartir», el propietario escribe **su contraseña maestra** al invitar (o pulsa la llave junto a un miembro que ya está dentro). Kanlane crea un código de 20 caracteres, deja la clave del cofre envuelta con él para **ese correo** (`vault_grants/{correo}`) y enseña **una sola vez** un enlace (`…/app/#cofre={equipo}.{código}`). El código va detrás de la almohadilla, así que el navegador no lo envía a ningún servidor, y no se guarda en ningún sitio. Hay que dárselo a esa persona por un canal privado. Dejar la contraseña maestra vacía invita **sin** acceso a las contraseñas.

**Entrar.** La persona abre el enlace con su cuenta (si aún no ha aceptado la invitación, primero la acepta): Kanlane abre el proyecto por *Contraseñas* con el código ya puesto y le pide **crear su propia contraseña maestra**; después le enseña **su propia clave de recuperación**. Sin el enlace puede pegar el enlace o el código a mano en esa misma pantalla. El acceso **se borra al usarlo** (el enlace no sirve dos veces), **caduca a las 24 horas** (lo aplican las reglas) y un acceso nuevo para el mismo correo anula el anterior.

**Roles.** Los lectores ven y copian las contraseñas si se les ha dado acceso, pero no las crean ni las cambian. Para que alguien no las vea, basta con no darle el enlace.

**Quitar a alguien** borra su clave envuelta y su acceso pendiente. Lo que ya vio no se le puede quitar y **la clave del cofre no cambia**: quien tuvo acceso pudo copiar las contraseñas, así que conviene cambiar las importantes. (Cambiar la clave del cofre al expulsar, como se hace con la del proyecto en los equipos cifrados, queda pendiente.)

**Copias de seguridad.** La copia de un equipo lleva las credenciales cifradas y la clave envuelta de quien la exporta. Al importar un archivo en un equipo, sus contraseñas no se importan.

**Pendiente de comprobar en producción:** crear el cofre es un lote de dos escrituras (la marca y la clave propia); el emulador no aplica el límite de consultas de reglas por lote, así que hay que probarlo con cuentas reales.
