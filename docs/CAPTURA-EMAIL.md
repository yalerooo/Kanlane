# Tareas por correo (captura por email)

Fase 3 de las automatizaciones. Cada proyecto puede tener una dirección de correo propia: un mensaje enviado a ella por alguien que puede editar el proyecto crea una tarea. Este documento explica cómo entra el correo, dónde corre el código, qué se guarda, cómo se pone en marcha y qué está comprobado y qué no. Slack (fase 4) no está hecho.

## Cómo entra el correo y dónde corre el código

```
remitente → su proveedor de correo → Cloudflare Email Routing (MX del dominio de captura)
          → manejador `email` del Worker de Kanlane (worker/index.js → worker/capture.mjs)
          → Firestore, por su API REST, con la cuenta de servicio
```

- **Proveedor de entrada: Cloudflare Email Routing**, que entrega cada mensaje al **mismo Worker** que ya sirve la web y ejecuta el cron. No hay proveedor nuevo, ni Cloud Functions, ni cambio de plan de Firebase.
- **No hay webhook.** El correo no llega por una ruta HTTP: Cloudflare invoca el manejador `email` directamente. Nadie de fuera puede llamar a ese código, así que no hay firma ni marca de tiempo de webhook que verificar. Lo que sí hay que autenticar es **quién envía el correo**, y eso se hace con DKIM (más abajo).
- **App Check no cambia.** Las rutas de cliente siguen igual. La entrada de correo no es una ruta ni usa un token de App Check; la gestión de la dirección (`/__/capture/v1`) usa el ID token de Firebase, como `/__/kms/`.
- El Worker escribe con la **cuenta de servicio** que ya usa el cron (`FIREBASE_SERVICE_ACCOUNT`, rol «Usuario de Cloud Datastore»). No hace falta ningún permiso nuevo en Google Cloud.

### Costes y límites

| Qué | Límite | Coste |
|---|---|---|
| Cloudflare Email Routing | Mensaje entrante de 25 MiB como mucho. | Gratuito. |
| Workers, plan gratuito (el actual) | 10 ms de CPU por mensaje, 50 subpeticiones, 128 MB de memoria. | Gratuito. |
| Workers Paid | 30 s de CPU por defecto (hasta 5 min), 10 000 subpeticiones. | De pago (unos 5 USD al mes la última vez que se miró; **compruébalo en Cloudflare antes de contratar**). |
| Firestore, plan gratuito | 1 GiB en total, 20 000 escrituras y 50 000 lecturas al día. Los adjuntos se guardan en Firestore, en trozos, como los que se suben desde la app. | Gratuito. |

**Con el plan gratuito** (`CAPTURE_PLAN: "free"`) se admite un mensaje de hasta 8 MB. Un correo de texto entra sin problema. Con adjuntos, **no se ha medido** si 10 ms de CPU bastan: leer el mensaje, comprobar la firma y trocear los archivos cuesta CPU, y si Cloudflare corta el proceso a mitad, la tarea puede quedarse sin sus adjuntos (ver «Fallo parcial»). Hay que probarlo con correos reales antes de darlo por bueno.

**Con Workers Paid** (`CAPTURE_PLAN: "paid"`) se admiten 25 MB y hay CPU de sobra. El código es el mismo: solo cambian los topes. Para pasar a él basta cambiar esa variable en `wrangler.jsonc` y desplegar; contratar el plan es una decisión aparte que **no se ha tomado**.

El límite de 10 MB por archivo y de 10 adjuntos por nota es el del producto y vale en los dos planes.

## Dos dominios de captura

`CAPTURE_DOMAINS` admite una lista: el primero es el principal (el que enseña la app) y los demás son de respaldo. **La misma dirección vale en todos**: si el principal falla, se puede escribir al de respaldo sin cambiar nada. La app enseña las dos.

**Tienen que ser dominios raíz, no subdominios.** Según la documentación de Cloudflare, la regla «Catch-all» de Email Routing solo existe en el dominio raíz de la zona (`kanlane.com`), no en sus subdominios (`in.kanlane.com`), y la captura la necesita: cada proyecto tiene una dirección distinta y al azar. Así que las direcciones son `…@kanlane.com`.

Eso es compatible con tener buzones normales en el mismo dominio **siempre que ese correo lo lleve también Email Routing**: una regla con una dirección concreta (`hola@kanlane.com` → reenviar a tu buzón) va antes que la «Catch-all», y el Worker rechaza todo lo que no sea una dirección de captura. Si el correo del dominio lo lleva otro proveedor (Google Workspace, Zoho…), activar Email Routing cambia los registros MX y ese correo dejaría de llegar: en ese caso hace falta un dominio aparte para la captura.

## La dirección

`<32 letras>@<dominio de captura>`, por ejemplo `k3m…7q@in.kanlane.com`.

- Las 16 primeras letras son un identificador al azar (80 bits) y las 16 siguientes, su HMAC-SHA256 con el secreto `CAPTURE_SECRET` del Worker.
- Una dirección inventada no supera esa comprobación y se rechaza **sin leer la base de datos**: no se puede gastar la cuota de Firestore probando direcciones.
- En Firestore se guarda el **hash** de la dirección (para encontrar el proyecto) y el identificador (para volver a enseñarla). Sin el secreto del Worker, con esos dos datos no se reconstruye. La dirección no está en ningún documento, ni en el paquete de la app.
- **Activar, regenerar o volver a activar** crea un identificador nuevo: la dirección anterior deja de existir en ese momento y no revive.
- Aun así es un secreto a medias: quien puede enviar tiene que conocerla. Por eso conocerla **no basta** para crear tareas.

## Quién puede qué

| | Dueño / propietario | Editor | Lector | Otros |
|---|---|---|---|---|
| Activar, desactivar, regenerar, elegir columna y remitentes | sí | no | no | no |
| Ver la dirección | sí | sí (puede enviar) | no | no |
| Enviar correo que cree tareas | sí | sí | no | no |

- **Gestionar** se decide en el servidor (`manage`): quién llama sale del ID token verificado, nunca del cuerpo de la petición; el proyecto se lee de Firestore y se mira su papel en él. A quien no es miembro se le responde lo mismo que si el proyecto no existiera.
- **Enviar** se decide al recibir cada correo, con el equipo tal como está en ese momento: quitar a alguien del equipo corta su correo al instante.
- En un proyecto personal la única remitente es la dirección de correo **comprobada** de la cuenta de su dueño (la del token, en el momento de activar). Si el dueño cambia el correo de su cuenta, tiene que regenerar la dirección para que valga el nuevo.
- En un equipo, el correo de cada miembro es el que consta en el equipo.

### El From no prueba nada

La cabecera From la escribe quien envía. Cloudflare rechaza el correo que no pasa ni SPF ni DKIM, pero no le dice al Worker qué pasó ni con qué dominio, y pasar SPF con un dominio propio no impide poner el From de otra persona. Por eso el Worker **comprueba él mismo la firma DKIM** (`worker/dkim.mjs`): el mensaje tiene que ir firmado por el dominio del From (o por uno del que cuelga), la firma tiene que cubrir el From y el cuerpo no puede haber cambiado. Solo entonces se mira si ese remitente es miembro.

Consecuencias que conviene saber:

- Solo se acepta `rsa-sha256` y firmas del cuerpo entero. Es lo que usan los proveedores habituales; **no se ha probado con correo real de ninguno** (Gmail, Outlook, etc.): solo con firmas generadas en las pruebas.
- Un proveedor que no firme con DKIM, o que firme con un dominio que no es el del From, no sirve para enviar tareas.
- Un mensaje **reenviado automáticamente** por otro servidor suele conservar la firma; uno modificado por el camino (listas de correo, pies añadidos), no.

### La lista de remitentes solo restringe

El propietario puede dejar una lista de hasta 20 direcciones. Con la lista puesta, el remitente tiene que ser miembro con permiso de edición **y además** estar en ella. Una dirección de la lista que no es de un miembro no entra: la lista no da acceso a nadie.

## Qué se hace con cada correo

1. **Tamaño.** Si supera el tope del plan se rechaza antes de leerlo, diciendo el límite.
2. **Dirección.** Dominio de captura, formato y HMAC. Si no vale, rechazo genérico.
3. **Proyecto.** Se busca por el hash. Si no hay (nunca existió, se desactivó o se regeneró), el mismo rechazo genérico.
4. **Automáticos.** Respuestas automáticas, rebotes, boletines y mensajes que dan vueltas se **descartan sin rechazo** (un rechazo generaría otro mensaje y podría empezar un bucle). Kanlane nunca contesta a un correo.
5. **Remitente.** Un solo From, firma DKIM alineada, miembro con permiso, lista si la hay.
6. **Estado del proyecto.** Si se borró o pasó a cifrado total, se retira la dirección y se rechaza.
7. **Límites.** 30 mensajes por proyecto y hora, 200 por proyecto y día, 20 por remitente y hora.
8. **Duplicados.** Ver más abajo.
9. **Tarea.** Una sola escritura: la tarea, su línea de actividad, las marcas de «ya recibido» y el contador.
10. **Adjuntos.** Después, en trozos; al terminar, una nota con ellos.

### Qué va a la tarea

- **Título:** el asunto, sin saltos ni caracteres de control, 500 caracteres como mucho. Sin asunto: «Correo sin asunto».
- **Descripción:** el cuerpo en texto plano, 20 000 caracteres como mucho (lo que admite una tarea; si se recorta, acaba en «[…]»). Si el correo solo trae HTML, se convierte a texto: sin estilos, scripts ni imágenes, y cada enlace con su dirección visible al lado. Se quitan los caracteres invisibles y los que invierten el sentido del texto, y se desactiva la sintaxis de enlaces e imágenes de Markdown para que ningún enlace oculte a dónde va. Kanlane escapa el HTML al pintar y no carga imágenes de fuera; nada del correo se interpreta, se sigue ni se descarga.
- **Columna:** la primera («Por hacer» en la plantilla por defecto) o la que elija el propietario, que el servidor valida contra las columnas del proyecto. **Si esa columna se borra después**, la tarea se crea en la primera, su línea de actividad lo dice («La columna elegida para el correo ya no existe: se creó en «…»») y el apartado de correo avisa hasta que se elija otra. Borrar la columna no desactiva la captura.
- **Nada más.** No pone prioridad, etiquetas, fecha ni responsable; no toca otras tareas, ni permisos, ni automatizaciones. Las reglas «al crear una tarea» **no se disparan** con las tareas que llegan por correo (esas reglas las ejecuta el navegador de quien crea la tarea).
- **Registro:** «Creada desde un correo de ana@ejemplo.com.» en la actividad de la tarea. No aparece la dirección de captura.

### Adjuntos

- Hasta 10 por correo y 10 MB cada uno; el total, lo que quepa en el mensaje (8 MB en el plan gratuito, 25 MB en el de pago, contando su codificación).
- **No se guardan** ejecutables, instaladores, guiones, accesos directos, imágenes de disco, documentos de Office con macros ni contenido activo (HTML, SVG). Se decide por la extensión, por el tipo declarado y por los primeros bytes (un `.jpg` que empieza como un programa de Windows no entra). Tampoco los vacíos.
- Los archivos **no se abren ni se ejecutan**: se copian. Un `.zip` se admite sin mirar dentro.
- Los nombres se limpian: sin rutas, sin caracteres de control ni invisibles, sin puntos iniciales, 120 caracteres.
- Lo que no se guarda queda apuntado en la actividad con su nombre y el motivo. El correo no se rechaza por eso: la tarea se crea con lo que sí vale.
- Se guardan como archivos descargables, no como imágenes incrustadas (el servidor no las comprime).

### Duplicados

Un correo cuenta como ya recibido en un proyecto si, en los últimos **30 días**:

- llegó otro con el mismo `Message-ID`, **o**
- llegó otro con el mismo contenido: el asunto sin los «Re:», «Fwd:», «RV:»… de delante, el mismo texto (sin contar espacios y saltos) y los mismos adjuntos.

Eso cubre los reintentos del proveedor, las entregas repetidas, el mismo correo por el dominio de respaldo, los mensajes sin `Message-ID` y el mismo correo reenviado tal cual. **No** reconoce un reenvío al que el programa de correo añade texto («---------- Forwarded message ----------» y las cabeceras del original): para el servidor es otro contenido.

- Un duplicado se **acepta en silencio**: ni tarea ni rechazo (rechazarlo haría rebotar un correo que sí entró).
- Las dos marcas se crean en la misma escritura que la tarea, con la condición de que no existan: si dos entregas llegan a la vez, Firestore deja pasar una sola.
- El mismo correo a dos proyectos crea una tarea en cada uno.
- Pasados 30 días el mismo correo vuelve a crear una tarea. Para enviar antes lo mismo a propósito hay que cambiar algo del asunto o del texto.

### Fallo parcial

La tarea y los adjuntos no caben en una sola escritura, así que van en dos pasos:

| Qué falla | Qué queda |
|---|---|
| Crear la tarea | Nada. El error se propaga y el servidor que envía lo reintenta. |
| Guardar los adjuntos (error o tiempo agotado) | La tarea, con una línea «No se pudieron guardar los adjuntos del correo (N).». Los trozos que llegaron a escribirse se borran. Un reintento no crea otra tarea ni lo vuelve a intentar. |
| El proceso se corta sin poder escribir nada más (límite de CPU) | La tarea sin adjuntos y **sin aviso**. La marca queda como «a medias»: si el mismo correo vuelve a llegar pasados 10 minutos, se retoman los adjuntos en la misma tarea. Si no vuelve a llegar, se quedan sin guardar. |

El último caso es el punto débil del plan gratuito. **Sin comprobar:** qué hace Cloudflare con el mensaje cuando corta el Worker (si lo reintenta, lo rebota o lo da por entregado).

## Privacidad y cifrado

- **No hay cifrado de extremo a extremo en esta función.** El correo llega en claro a Cloudflare y al Worker, que lo lee entero.
- **Proyectos con cifrado total o «Gestionado por Kanlane»: sin captura.** El Worker no tiene la clave del proyecto; guardar la tarea sin cifrar rompería lo que el proyecto promete. El apartado lo explica, el servidor se niega a activarla y, si un proyecto con captura pasa a cifrado total, la dirección se retira al primer correo o a la primera consulta. No hay alternativa en claro. Un diseño compatible (cifrar en el Worker con una clave pública del proyecto) no está hecho ni aprobado.
- **Qué se guarda:** la tarea y sus adjuntos; la configuración de la captura; el hash de la dirección; una marca por correo recibido (identificador del proyecto, de la tarea y fechas, bajo un hash); un contador por proyecto y día con una huella del remitente. El mensaje original no se guarda.
- **Registros del Worker:** una línea por correo con el resultado («captura: tarea creada», «captura: rechazado (sender-member)»…). Sin direcciones, sin tokens, sin asunto ni contenido.
- **Qué corta el acceso:** desactivar o regenerar (al momento); eliminar el proyecto (la app retira la dirección; si eso fallara, el servidor la retira al primer correo); eliminar la cuenta (se retiran todas sus direcciones antes de borrar nada; si el servidor no responde, la cuenta no se elimina y se puede repetir); quitar a un miembro (su correo deja de valer en el siguiente mensaje).
- La política de privacidad (`legal/privacidad/index.html`, versión 10) lo describe. Los plazos que cita (30 días para las marcas, 3 para los contadores) dependen de que el borrado automático de Firestore esté configurado: es el paso 5 de la puesta en marcha.

## Dónde se guarda cada cosa

Las cuatro colecciones son **solo del servidor**: `firestore.rules` no les da ninguna regla, así que ningún cliente las lee ni las escribe, ni el dueño del proyecto.

| Colección | Documento | Contenido |
|---|---|---|
| `mail_capture` | hash de la dirección | A qué proyecto lleva, columna, lista de remitentes y, en uno personal, el correo del dueño. |
| `mail_capture_cfg` | `u~{uid}~{proyecto}` o `t~{equipo}` | Identificador de la dirección, su hash y la configuración. Solo existe mientras la captura está activada. |
| `mail_seen` | hash de proyecto + `Message-ID` o contenido | Tarea creada, fechas, caducidad (`ttl`) y estado de los adjuntos. |
| `mail_rate` | `{proyecto}~{día}` | Contadores del día, por hora y por huella de remitente; caducidad (`ttl`). |

Las tareas, notas y adjuntos van donde los pone la app: `tasks`, `tasks/{id}/notes` y `assets` del proyecto.

## Puesta en marcha

Mientras falte algo, la app no enseña el apartado y todo correo se rechaza. Nada de esto requiere contratar nada.

1. **Cuenta de servicio.** La misma del cron (`docs/AUTOMATIZACIONES.md`). Si ya está, nada.
2. **Secreto de la captura**, 32 bytes al azar en base64, sin que pase por el repositorio ni por ningún chat:

   ```bash
   openssl rand -base64 32
   ```

   ```bash
   npx wrangler secret put CAPTURE_SECRET
   ```

   **Si se cambia, todas las direcciones existentes dejan de valer** (cada proyecto tendría que mirar la nueva en la app). Si se filtra, eso es justo lo que hay que hacer.
3. **Dominios.** Primero hay que desplegar el Worker con esta versión (para que tenga el manejador de correo). Después, en Cloudflare → el dominio raíz → Email Routing: activarlo (añade los registros MX y SPF) y, en Routing Rules, activar la regla «Catch-all» con la acción **Send to a Worker** → `workhub`. Repetir en el dominio de respaldo. Si el dominio ya recibe correo con otro proveedor, **no lo actives ahí**: usa un dominio dedicado (un subdominio no sirve, no admite «Catch-all»).
4. **Variables.** En `wrangler.jsonc`, `CAPTURE_DOMAINS` con los dominios (el principal primero) y `CAPTURE_PLAN` según el plan de Workers. Desplegar.
5. **Borrado automático.** En la consola de Google Cloud → Firestore → TTL, crear una política para el campo `ttl` de la colección `mail_seen` y otra para el de `mail_rate`. Sin esto la deduplicación funciona igual (la caducidad se comprueba al leer), pero las marcas no se borran solas y la política de privacidad dice que sí.
6. **No hay reglas de Firestore que publicar**: el cambio en `firestore.rules` es solo un comentario.

Para apagarla: `CAPTURE_DOMAINS` vacío y desplegar (o `mailCapture: false` en `src/config/features.js` para ocultarla sin tocar el servidor; las direcciones existentes seguirían recibiendo).

### Comprobación en producción (pendiente)

Las pruebas no pasan por Cloudflare Email Routing. Antes de anunciar la función, en un proyecto creado para la prueba:

1. Activar la captura y enviar un correo de texto desde la cuenta del dueño, con Gmail y con otro proveedor. Debe aparecer una tarea. Si se rechaza, mirar el motivo en los registros del Worker (`sender-none`, `sender-body`, `sender-key`…): dice en qué punto falla la firma.
2. Enviar el mismo correo dos veces; reenviarlo. Una sola tarea.
3. Enviar desde otra cuenta que no sea miembro. Debe rebotar con «Sender not authorized», sin datos del proyecto.
4. Enviar con un adjunto pequeño, y luego con uno de varios MB, en el plan gratuito. Mirar en los registros si el Worker termina o Cloudflare lo corta («Exceeded CPU»), y qué le llega al remitente en ese caso.
5. Escribir a la dirección en el dominio de respaldo.
6. Regenerar y escribir a la anterior: rebote.
7. Activar una respuesta automática en el buzón del remitente y comprobar que no se crea ninguna tarea ni ningún bucle.

## Pruebas

Ninguna toca proyectos reales.

- `tests/worker/mime.test.js` (13): lectura del correo (acentos, multipart, solo HTML, MIME retorcido), saneado, nombres de archivo, tipos no admitidos, mensajes automáticos y la firma DKIM contra un firmante escrito aparte con `node:crypto` (firma buena, de otro dominio, cuerpo o cabeceras cambiados, caducada, parcial, sin clave, DNS caído).
- `tests/worker/capture.test.js` (22): gestión y recepción con una base de datos en memoria que impone las mismas condiciones de escritura que Firestore. Permisos, regenerar y desactivar, remitentes, lista, columna, adjuntos y sus límites, duplicados (colisiones, sin `Message-ID`, cinco entregas a la vez, caducidad), fallo parcial, proceso cortado, tiempo agotado, límites de envío, proyecto borrado, cuenta eliminada, cifrado y registros sin secretos.
- `tests/rules/rules-test.js`: ningún cliente lee ni escribe las colecciones de la captura.
- `tests/e2e/mail-capture.js`: con los emuladores, la pantalla, la ruta de gestión y la escritura real en Firestore. Activar con el teclado, móvil, una tarea con adjunto que se descarga byte a byte desde la app, duplicados, remitentes, recarga sin caché y sesión nueva, columna y columna borrada, regenerar, desactivar, equipo con propietaria y editor, miembro retirado, inglés y proyecto eliminado.
- `tests/e2e/guest-migrate.js` y `crypto-smoke.js`: lo que ve un invitado y un proyecto cifrado.
