# Servidor MCP

Kanlane tiene un servidor MCP (Model Context Protocol): un asistente como Claude Code puede leer las tareas de **un proyecto**, moverlas de columna, añadirles notas y crear tareas nuevas. Este documento explica cómo entra una llamada, qué se guarda, quién puede qué, cómo se pone en marcha y qué está comprobado y qué no.

**Estado:** el servidor (este documento) está hecho. La pantalla de Ajustes para crear y revocar tokens y la página pública que lo explica van en entregas aparte; hasta entonces los tokens solo se pueden crear llamando a la ruta de gestión.

## Cómo entra una llamada y dónde corre el código

```
asistente → POST https://kanlane.com/__/mcp/v1   (Authorization: Bearer kl_…)
          → Worker de Kanlane (worker/index.js → worker/mcp.mjs)
          → Firestore, por su API REST, con la cuenta de servicio
```

- **En el mismo Worker** que sirve la web, ejecuta el cron y recibe el correo. No hay proveedor nuevo ni nada que instalar en el ordenador de quien lo usa.
- **Sin estado.** Cada petición es un mensaje JSON-RPC y su respuesta en JSON. No hay sesiones, ni conexiones abiertas, ni eventos del servidor: `GET` responde 405.
- **Protocolo:** `initialize`, `ping`, `tools/list` y `tools/call`. Versiones admitidas: `2025-06-18`, `2025-03-26` y `2024-11-05`. Un mensaje por petición (sin lotes).
- **No es para navegadores.** Una petición con `Origin` de otro sitio se rechaza y la ruta no envía cabeceras CORS.
- Escribe con la **cuenta de servicio** que ya usan el cron y la captura por correo (`FIREBASE_SERVICE_ACCOUNT`). No hace falta ningún permiso nuevo en Google Cloud.

## El token

`kl_` y 32 letras, por ejemplo `kl_k3m…7q`.

- Las 16 primeras letras son un identificador al azar (80 bits) y las 16 siguientes, su HMAC-SHA256 con el secreto `MCP_SECRET` del Worker.
- Un token inventado no supera esa comprobación y se rechaza **sin leer la base de datos**: no se puede gastar la cuota de Firestore probando tokens.
- En Firestore se guarda el **hash** del token (`mcp_tokens/{hash}`), nunca el token. Se enseña **una sola vez**, al crearlo.
- Cada token es de **un proyecto**. No sirve para ningún otro, ni siquiera de la misma cuenta.
- Hasta 10 tokens por proyecto. Cada uno lleva un nombre («Portátil», «Claude del trabajo») y, si se quiere, es de **solo lectura**.
- Revocarlo borra su documento: deja de valer en la siguiente llamada.

## Quién puede qué

| | Dueño / propietario | Editor | Lector | Otros |
|---|---|---|---|---|
| Crear tokens | sí | sí | sí, solo de lectura | no |
| Ver y revocar los suyos | sí | sí | sí | no |
| Ver y revocar los de los demás | sí | no | no | no |

- **Gestionar** (`manage`, ruta `/__/mcp/v1/tokens`) pide el ID token de Firebase, como `/__/kms/` y `/__/capture/v1`: quién llama sale del token verificado, nunca del cuerpo. A quien no es miembro se le responde lo mismo que si el proyecto no existiera.
- **Lo que puede hacer un token se decide en cada llamada**, con el papel que tiene en ese momento quien lo creó: propietario o editor leen y escriben; lector, solo lee. Si esa persona pasa a lectora, su token deja de escribir sin tocarlo; si sale del equipo, el token deja de valer y se retira.
- Un token de solo lectura no ve las herramientas que escriben (no salen en `tools/list`) y, si las llama, se le dice que es de solo lectura.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `list_tasks` | Las columnas reales del proyecto y sus tareas. Por defecto, las que no están en una columna de «hechas». Con `column` (clave o nombre), solo esa. `limit` hasta 200. |
| `get_task` | Una tarea entera: descripción, subtareas y sus 50 notas y líneas de actividad más recientes. |
| `move_task` | Mueve una tarea a otra columna. Queda al final de la columna y con una línea en su actividad. |
| `add_note` | Añade una nota a una tarea. |
| `create_task` | Crea una tarea: título, descripción, columna (por defecto la primera), fecha límite y etiquetas. |

Detalles que conviene saber:

- **Columnas.** Son las del proyecto, no tres estados fijos. El asistente puede nombrarlas por su clave o por su nombre, sin distinguir mayúsculas. Una tarea cuyo estado ya no existe aparece en la primera columna, como en la app.
- **Firma.** Lo que hace un token se nota: la actividad dice «Movida de «Por hacer» a «En curso» por Ana · MCP (token «Portátil»).» y las notas llevan de autor «Ana · MCP» (en un proyecto personal, «MCP»).
- **Si la tarea cambia mientras tanto**, `move_task` no la pisa: Firestore rechaza la escritura y el asistente recibe el aviso de que vuelva a leerla.
- **Tareas que se repiten.** Al completar una (moverla a una columna de «hechas»), se crea la siguiente en la misma escritura, igual que hace la app, y una sola vez por tarea.
- **Automatizaciones.** Las reglas «al crear» y «al mover» **no se disparan** con lo que hace el servidor, igual que con las tareas que llegan por correo: esas reglas las ejecuta el navegador de quien cambia la tarea.
- **El contenido no es de fiar.** Un título puede venir de un correo. Las herramientas lo devuelven como datos y sus descripciones le dicen al asistente que no lo trate como instrucciones. Aun así, quien conecta un asistente decide qué le deja hacer.

## Proyectos cifrados

Sin MCP, tanto con cifrado total como gestionado por Kanlane: el Worker no tiene la clave del proyecto, y guardar tareas sin cifrar rompería lo que el proyecto promete. La ruta de gestión responde `available: false`, y si un proyecto pasa a cifrado, sus tokens se retiran.

## Límites y costes

| Qué | Límite |
|---|---|
| Llamadas por token | 60 por minuto (`MCP_RATE_LIMIT`), además del límite por IP que ya tiene el Worker. |
| Cambios por proyecto | 2 000 al día (UTC), entre todos sus tokens. Leer no cuenta. |
| Tareas leídas por llamada | 500 como mucho; devueltas, 200. |
| Tamaño de la petición | 64 KiB. |

- **Coste:** nada nuevo. Entra en el plan gratuito de Workers (100 000 peticiones al día) y de Firestore (50 000 lecturas y 20 000 escrituras al día; **compruébalo en sus paneles**).
- **Lecturas de Firestore.** Cada tarea que devuelve la consulta cuenta como una lectura. Por eso `list_tasks` pide solo las abiertas o las de una columna, en vez de leer el proyecto entero.
- **CPU.** El plan gratuito da 10 ms por petición. Comprobar un token son dos operaciones cortas; firmar con la cuenta de servicio solo ocurre cuando caduca su credencial (una vez por hora y proceso), como en el cron. **No se ha medido en producción.**

## Qué se guarda

Solo lo escribe y lo lee el servidor; ningún cliente entra (sin regla en `firestore.rules`).

- `mcp_tokens/{hash}`: el proyecto, quién lo creó, el nombre, si es de solo lectura, cuándo se creó y cuándo se usó por última vez (se apunta como mucho una vez por hora).
- `mcp_rate/{proyecto}~{día}`: el contador de cambios del día. El cron borra los de más de tres días.

En los registros del Worker no queda ni el token ni el contenido de las tareas.

## Puesta en marcha

1. **Secreto.** 32 bytes al azar en base64:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   ```bash
   npx wrangler secret put MCP_SECRET
   ```

   **Si se cambia, todos los tokens existentes dejan de valer.** Si se filtra, eso es justo lo que hay que hacer. Sin el secreto, las dos rutas responden 503.
2. **Cuenta de servicio.** La misma `FIREBASE_SERVICE_ACCOUNT` del cron (docs/AUTOMATIZACIONES.md). Si ya funcionan las automatizaciones por fecha o la captura por correo, no hay nada que hacer.
3. **Desplegar.** `wrangler.jsonc` ya lleva la ruta (`/__/mcp/*` en `run_worker_first`) y el límite `MCP_RATE_LIMIT`.
4. **No hay reglas de Firestore que publicar**: el cambio en `firestore.rules` es solo un comentario.

Para apagarlo: borrar el secreto `MCP_SECRET` y desplegar.

## Conectarlo desde Claude Code

```bash
claude mcp add --transport http kanlane https://kanlane.com/__/mcp/v1 --header "Authorization: Bearer kl_…"
```

Después, en una conversación: «lista las tareas pendientes de Kanlane», «pasa esta a En curso», «márcala como hecha y deja una nota con lo que has cambiado».

El conector de claude.ai en la web no se ha probado: es posible que exija OAuth en lugar de un token fijo.

## Comprobación en producción (pendiente)

Las pruebas no pasan por Cloudflare ni por un cliente MCP real. Antes de anunciarlo, en un proyecto creado para la prueba:

1. Crear un token y conectarlo desde Claude Code. Debe listar las herramientas.
2. Listar, mover una tarea a «En curso» y luego a una columna de hechas, y añadir una nota. Con la app abierta, los cambios deben verse sin recargar.
3. Revocar el token y repetir: debe fallar con «Invalid or revoked token».
4. Mirar en los registros del Worker si alguna llamada se corta por CPU («Exceeded CPU»), sobre todo la primera tras un rato sin uso.
5. Con un token de solo lectura, comprobar que el asistente no ofrece mover ni crear.

## Pruebas

Ninguna toca proyectos reales.

- `tests/worker/mcp.test.js` (18): tokens, permisos y herramientas con una base de datos en memoria que impone las mismas condiciones de escritura que Firestore; y lo que la ruta rechaza antes de mirar nada (método, origen, token sin forma de token, tamaño, límite por token).
- `tests/e2e/mcp.js`: por HTTP contra el Firestore emulado, sin navegador. Las consultas por columna y por exclusión, las notas ordenadas, las escrituras con condición, la tarea que se repite y el contador las resuelve el emulador.
- `tests/rules/rules-test.js`: ningún cliente lee ni escribe `mcp_tokens` ni `mcp_rate`.
