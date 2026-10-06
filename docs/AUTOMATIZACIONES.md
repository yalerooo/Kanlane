# Automatizaciones

Reglas «cuando pasa algo en una tarea, haz esto», por proyecto. Este documento explica cómo funcionan por dentro, qué hace el servidor y cómo se pone en marcha. Las fases 3 (correo) y 4 (Slack) no están hechas.

## Qué hay

- **Reglas** (fase 1): al crear una tarea, al moverla a una columna, al completarla o cuando se acerca su fecha límite. Acciones: mover, completar, etiquetar, añadir subtarea, poner fecha y, en equipos, asignar.
- **Botones de tarea** (fase 2): una regla cuyo disparador es «alguien pulsa su botón». Sale en la ficha de cada tarea para quien puede editar el proyecto; un clic ejecuta sus acciones.
- **Reglas por fecha con Kanlane cerrado** (fase 2): las ejecuta el servidor cada 30 minutos.

Todo usa el mismo motor, `src/models/automation-model.js`, en el navegador y en el servidor: mismas acciones, mismo corte de bucles y mismo tope.

## Dónde corre el código de servidor y por qué

En el **Worker de Cloudflare que ya sirve la web**, con un **cron** (`triggers.crons` en `wrangler.jsonc`, cada 30 minutos). Se eligió por ser lo más simple y barato:

- Firebase no ofrece Cloud Functions en el plan gratuito (Spark); pasar a Blaze obliga a dar una tarjeta.
- El Worker ya existe, ya se despliega con la web y los cron entran en su plan gratuito. No hay servicio nuevo ni proveedor nuevo.

El cron no atiende peticiones: no hay ninguna ruta que lo dispare desde fuera. Lee y escribe Firestore por su API REST con una **cuenta de servicio de Google**, cuyo JSON es un secreto del Worker (`FIREBASE_SERVICE_ACCOUNT`). Esa cuenta entra como administrador: las reglas de seguridad de Firestore no le aplican, así que el código (`worker/automations.mjs`) es quien limita lo que hace.

### Límites de esta opción

| Límite | Consecuencia |
|---|---|
| 50 subpeticiones por ejecución (plan gratuito) | Cada vuelta atiende 10 proyectos (3 subpeticiones cada uno) y recuerda por dónde iba en `automation_state/cursor`. Con N proyectos con reglas por fecha, cada uno se revisa cada `ceil(N / 10) × 30` minutos. |
| 10 ms de CPU por ejecución (plan gratuito) | Sin medir en producción. Si el cron empieza a fallar por CPU con muchas tareas, hay que bajar `JOBS_PER_RUN` o pasar al plan de pago de Workers (5 USD al mes). |
| Precisión | Una regla «a 2 días de vencer» se ejecuta en algún momento de ese día, no a una hora fija. El día se calcula en la zona horaria del navegador de quien dejó las reglas. |
| 200 tareas con fecha cercana por proyecto y vuelta | Las que no entren se atienden en vueltas siguientes. |
| 60 ejecuciones por proyecto y vuelta | El resto queda para la vuelta siguiente (es el mismo tope por minuto del navegador). |
| Cuotas de Firestore (plan gratuito: 50 000 lecturas y 20 000 escrituras al día) | Cada vuelta lee las copias de 10 proyectos, sus marcas y sus tareas con fecha cercana. |

## Qué ejecuta el servidor y qué no

- Solo las reglas por fecha, y detrás de ellas las de «mover» y «completar» que se encadenen. Nunca botones ni «al crear».
- **Proyectos con cifrado total: nada.** El servidor no tiene la clave: no puede leer las reglas (van selladas) ni las etiquetas, las subtareas o el título de las tareas. La app no le deja copia de esas reglas, y si aun así encuentra tareas selladas, borra la copia y no escribe. En esos proyectos (también en «Gestionado por Kanlane») las reglas por fecha se ejecutan solo con Kanlane abierto, como en la fase 1. El diálogo lo dice.
- No completa tareas que se repiten: crear la siguiente es cosa de la app. Esas se dejan para el navegador.
- No toca tareas de otros proyectos: cada copia solo da acceso al proyecto que dice su identificador.

## Cómo sabe el servidor qué ejecutar: `automation_jobs`

El servidor no recorre todas las cuentas. Quien es dueño de un proyecto con reglas por fecha activas deja en `automation_jobs/{id}` una **copia** de lo que el servidor necesita:

- `id`: `u~{uid}~{proyecto}` (personal) o `t~{equipo}`.
- `rules`: las reglas por fecha y las de mover o completar que pueden encadenarse.
- `ctx`: nombre de las columnas, etiquetas y miembros.
- `tz`: zona horaria del navegador.

La app la crea, la actualiza y la borra sola (`AutomationsController.syncJob`) al cargar y al cambiar las automatizaciones, y al eliminar el proyecto. Si alguien que no es el dueño cambia las columnas, la copia se pone al día cuando el dueño abre el proyecto; mientras tanto el servidor trabaja con los nombres de la copia.

**Permisos en servidor.** Lo que autoriza una ejecución es esa copia, y las reglas de Firestore solo dejan escribirla a su dueño: el identificador tiene que coincidir con quien escribe (`u~{su uid}~…`) o con un equipo del que es propietario, y un proyecto con cifrado total no puede tenerla. El servidor comprueba además que los campos de la copia digan lo mismo que su identificador.

## Dónde se guarda cada cosa

| Qué | Dónde | Quién escribe |
|---|---|---|
| Reglas y botones | `plugin_data/kanlane.automations` del proyecto | En un equipo, solo el propietario (lo imponen las reglas de Firestore). Sellado en un proyecto cifrado. |
| Marcas «esta regla ya se ejecutó para esta tarea y fecha» | `plugin_data/kanlane.automations.state` | Quien puede editar, y el servidor. Las comparten navegador y servidor para no repetir. |
| Copia para el servidor | `automation_jobs/{id}` | El dueño. Nunca en proyectos cifrados. |
| Por dónde va el cron | `automation_state/cursor` | Solo el servidor. |
| Registro de cada ejecución | Una nota `kind:'activity'` en la tarea | El navegador o el servidor. |

El registro se guarda en español («Automatización «nombre»: movió la tarea a…», «Botón «nombre»: …») y la pantalla lo traduce al enseñarlo.

## Puesta en marcha del servidor (una vez)

Sin estos pasos todo lo demás funciona; solo queda sin hacer la ejecución con Kanlane cerrado (el diálogo seguirá diciendo que el servidor las revisa, así que conviene hacerlos antes de anunciar la función).

1. **Publicar `firestore.rules`** (colección `automation_jobs` y el documento de reglas de los equipos).
2. **Crear la cuenta de servicio.** Google Cloud → IAM y administración → Cuentas de servicio → Crear. Rol: **Usuario de Cloud Datastore** (`roles/datastore.user`), ninguno más. Después, Claves → Agregar clave → JSON. Se descarga un archivo.
3. **Guardarla como secreto del Worker**, sin que pase por el repositorio ni por ningún chat:

   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   ```

   Pega el contenido completo del JSON cuando lo pida. Borra el archivo descargado.
4. **Desplegar.** El cron (`*/30 * * * *`) va en `wrangler.jsonc` y se activa con el despliegue.
5. **Comprobar.** Cloudflare → el Worker → Registros: al ejecutar algo escribe «automatizaciones: N ejecuciones en M proyectos»; si falla, «automatizaciones: » y el motivo. En Configuración → Activadores se ve el cron y se puede lanzar a mano.

Si la clave se filtra: bórrala en Google Cloud (Cuentas de servicio → Claves), crea otra y repite el paso 3.

## Seguridad

- Ningún secreto en el cliente: la clave de la cuenta de servicio solo existe como secreto del Worker.
- El servidor solo actúa sobre copias que dejó el dueño del proyecto, y solo dentro de ese proyecto.
- Tope de ejecuciones y corte de bucles también en servidor: es el mismo motor. Una regla no se repite dentro de una cadena y una cadena no pasa de 3 saltos.
- Cada vuelta escribe todo lo de un proyecto de una vez (tareas, registro y marcas): o se guarda todo o nada, así que no puede quedar una regla ejecutada sin su marca.
- App Check: el cron no pasa por App Check (no es un cliente; usa la cuenta de servicio) y no abre ninguna ruta pública. No cambia nada de lo que App Check protege.

## Pruebas

- `tests/automations/automations.test.js`: el motor (reglas, botones, bucles, topes, nombres guardados).
- `tests/worker/automations.test.js`: el proceso del servidor con una base de datos en memoria.
- `tests/e2e/automation-cron.js`: con los emuladores y las reglas reales, el servidor ejecuta una regla por fecha con el navegador cerrado; botón de tarea; columna borrada.
- `tests/e2e/crypto-smoke.js`: un proyecto cifrado no deja copia y el servidor no lo toca.
- `tests/rules/rules-test.js`: quién puede escribir las reglas de un equipo y las copias para el servidor.
