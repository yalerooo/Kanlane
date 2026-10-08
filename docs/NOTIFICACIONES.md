# Menciones, seguir tareas y avisos con Kanlane cerrado

En los proyectos de **equipo**:

- **Menciones.** En un comentario, `@` abre la lista de miembros; `@Nombre` queda resaltado y avisa a esa persona.
- **Seguir.** El botón «Seguir» de la ficha de una tarea apunta a quien lo pulsa en `followers`. Quien sigue una tarea recibe un aviso cuando otra persona comenta en ella o la mueve de columna.
- **Asignación.** A quien se le asigna una tarea se le avisa.
- **Avisos push.** Los avisos llegan como notificaciones del sistema aunque Kanlane no esté abierto, en cada navegador donde la persona los activó (Ajustes → Recordatorios → «Avisos con Kanlane cerrado»).

El correo no está hecho todavía: ver «Pendiente».

## Cómo funciona

No hay Cloud Functions (plan gratuito de Firebase), así que nada reacciona solo a una escritura. Lo hace el navegador de quien actúa:

1. Ana comenta, asigna o mueve una tarea. El cambio se guarda en Firestore como siempre.
2. Su navegador llama a `/__/notify/v1` del Worker con su ID token de Firebase y `{op:'event', tid, taskId, kind, to}`.
3. El Worker (`worker/notify.mjs`) comprueba que Ana puede escribir en ese equipo, lee la tarea, decide a quién avisar y envía un push cifrado a cada navegador suscrito (`worker/webpush.mjs`, RFC 8291 y 8292, sin dependencias).
4. El service worker (`sw.js`) enseña la notificación. Al pulsarla se abre esa tarea, en la pestaña de Kanlane que ya haya o en una nueva (`#tarea=proyecto/tarea`).

Si el paso 2 falla (sin red, servidor sin configurar), el cambio ya está guardado y simplemente no hay aviso.

### De quién se fía el servidor

El navegador solo dice **qué pasó y en qué tarea**. Todo lo demás lo decide el Worker:

| Dato | De dónde sale |
|---|---|
| Quién lo provoca | Del ID token verificado, nunca del cuerpo |
| Si puede provocarlo | Del equipo: propietario o editor (un lector no) |
| A quién se avisa por seguir | De `followers` de la tarea |
| A quién se avisa por asignación | De `to`, pero solo quien esté de verdad en `assignees` |
| A quién se avisa por mención | De `to`, pero solo miembros del equipo |
| El texto del aviso | Lo compone el Worker con el nombre del miembro, el título de la tarea y el proyecto |

Nunca se avisa a quien lo provoca ni a quien no es miembro. Una mención manda sobre «sigues esta tarea»: un solo aviso.

Lo que el servidor **no** puede comprobar es que el comentario mencione de verdad a esa persona (en un proyecto cifrado ni siquiera puede leerlo). Un miembro con permiso de edición podría, llamando a la ruta a mano, hacer llegar a otro miembro un aviso «X te mencionó» sobre una tarea real del equipo. No puede escribir el texto, ni avisar a gente de fuera, ni pasar de 500 avisos al día.

### Qué dice el aviso

- Mención: «Ana te mencionó» · «Título» · Proyecto
- Asignación: «Ana te asignó una tarea»
- Comentario en una tarea seguida: «Ana comentó en una tarea que sigues»
- Movida: «Ana movió una tarea que sigues» · «Título» → Columna

Nunca lleva el texto del comentario. En un proyecto con **cifrado total** el Worker no puede leer la tarea: el aviso es «Tienes novedades en «Proyecto»». El idioma (español o inglés) es el de la app en el navegador que se suscribió.

### Lo que no avisa

- Los cambios que hace una automatización, el servidor MCP o la captura por correo.
- Asignarse una tarea a uno mismo.
- Los proyectos personales, el modo local y el modo invitado (no hay con quién).

## Dónde se guarda cada cosa

| Qué | Dónde | Quién entra |
|---|---|---|
| Quién sigue una tarea | `followers` (lista de uid) en la tarea; en claro también con cifrado total | Los miembros del equipo |
| Suscripción de un navegador | `push_subs/{id}` = `{uid, endpoint, p256dh, auth, lang, createdAt}` | Solo el Worker |
| Contador diario | `notify_rate/{uid}~{día}` | Solo el Worker |

`push_subs` y `notify_rate` no están en `firestore.rules`: están cerradas a los clientes. El cron del Worker borra los contadores de más de tres días. Una suscripción se borra al desactivar los avisos, cuando el servicio de push dice que ya no existe (404 o 410) y al eliminar la cuenta. Tope: 10 navegadores por cuenta.

Las menciones no se guardan aparte: se reconocen en el texto del comentario comparando con los nombres de los miembros.

## Puesta en marcha

1. **Publicar `firestore.rules`** (admiten `followers` en las tareas). Sin ellas, «Seguir» da error.
2. **Claves VAPID**, una sola vez:

   ```bash
   node scripts/make-vapid.js
   ```

   y poner lo que imprime como secretos del Worker:

   ```bash
   npx wrangler secret put VAPID_PUBLIC
   ```

   ```bash
   npx wrangler secret put VAPID_PRIVATE
   ```

   ```bash
   npx wrangler secret put VAPID_SUBJECT
   ```

   `VAPID_SUBJECT` es `mailto:` y un correo de contacto (lo ven los servicios de push si hay algún problema).
3. `FIREBASE_SERVICE_ACCOUNT` ya está puesto si funcionan las automatizaciones por fecha o el MCP.
4. Desplegar. La ruta `/__/notify/*` ya está en `run_worker_first` de `wrangler.jsonc`.

Mientras falten los secretos, la ruta responde `not-configured`: al pulsar «Activar en este navegador» la app dice que los avisos aún no están disponibles, y las menciones y «Seguir» funcionan igual dentro de la app. Para retirarlo todo sin desplegar el Worker: `push: false` en `src/config/features.js`.

## Límites

- **Subpeticiones del Worker gratuito (50 por petición):** un aviso llega como mucho a 30 personas y hace como mucho 35 envíos.
- **500 avisos al día** por cuenta que los provoca.
- **iPhone y iPad:** Safari solo admite push con Kanlane instalada en la pantalla de inicio (iOS 16.4 o posterior).
- **El aviso depende del navegador de quien actúa:** si cierra la pestaña justo al comentar, puede no salir.
- Los servicios de push (Google, Mozilla, Apple, Microsoft) entregan el aviso cifrado: no pueden leerlo, pero ven a qué suscripción va y cuándo. Está en la política de privacidad.

## Pendiente

- **Correo.** No hay proveedor de envío. Cuando se elija uno, se añade como otro canal en `worker/notify.mjs` (mismos destinatarios y textos) y hay que declararlo en la política de privacidad.
- **Campana con el historial de avisos** dentro de la app.
- Comprobación en producción con dispositivos reales (ver «Pruebas»).

## Pruebas

```bash
node tests/worker/webpush.test.js
```

```bash
node tests/worker/notify.test.js
```

```bash
node tests/tasks/mentions.test.js
```

- `webpush.test.js`: el vector del RFC 8291, la firma VAPID comprobada con `node:crypto`, la lista de servicios de push admitidos y el envío.
- `notify.test.js`: suscripciones, quién recibe qué y con qué texto (los avisos se descifran con una implementación aparte del lado del navegador), permisos, cifrado total, bajas y tope diario.
- `tests/sw/sw.test.js`: el service worker enseña el aviso y abre la tarea al pulsarlo.
- `tests/rules`: `followers` en tareas en claro y selladas.

**Sin probar:** la entrega real a un navegador (Chrome, Firefox, Safari instalado) con las claves de producción. Hay que hacerlo tras desplegar: activar los avisos con dos cuentas de un equipo, mencionar, asignar y comentar en una tarea seguida con la otra pestaña cerrada.
