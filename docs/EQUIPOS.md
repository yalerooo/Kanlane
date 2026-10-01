# Trabajo en equipo

Un proyecto de Workhub puede compartirse con otras personas: cada una entra con su propia cuenta, ve el mismo tablero en tiempo real y las tareas se pueden **asignar** (a otras personas o a uno mismo), como en Trello.

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

## Compartir contraseñas: siguiente fase

Lo acordado es **cifrado extremo a extremo por miembro**, sin compartir ninguna contraseña maestra:

1. Cada persona genera un par de claves (RSA-OAEP o ECDH) en su navegador. La clave pública se guarda en su perfil; la privada, cifrada con una frase de paso suya (o derivada de su contraseña maestra actual).
2. Cada gestor de contraseñas de equipo tiene una **clave de proyecto** aleatoria (AES-256) con la que se cifran las credenciales.
3. La clave de proyecto se guarda cifrada **una vez por miembro**, con la clave pública de cada uno (`teams/{id}/keys/{uid}`).
4. Para **invitar**, el propietario cifra la clave de proyecto para el nuevo miembro al aceptar. Para **expulsar**, se genera una clave nueva, se vuelven a cifrar las credenciales y se reparte solo a los que quedan.
5. El servidor solo ve texto cifrado. Perder la frase de paso implica no poder descifrar (con clave de recuperación, como hoy).

Hasta entonces, las contraseñas se quedan en los proyectos personales.
