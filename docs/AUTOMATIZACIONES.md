# Automatizaciones

Reglas «cuando pasa algo en una tarea, haz esto», por proyecto. Este documento explica cómo funcionan por dentro, qué hace el servidor y cómo se pone en marcha. Las fases 3 (correo) y 4 (Slack) no están hechas.

## Qué hay

- **Reglas** (fase 1): al crear una tarea, al moverla a una columna, al completarla o cuando se acerca su fecha límite. Acciones: mover, completar, etiquetar, añadir subtarea, poner fecha y, en equipos, asignar.
- **Botones de tarea** (fase 2): una regla cuyo disparador es «alguien pulsa su botón». Sale en la ficha de cada tarea para quien puede editar el proyecto; un clic ejecuta sus acciones.
- **Reglas por fecha con Kanlane cerrado** (fase 2): las ejecuta el servidor cada 30 minutos.

Todo usa el mismo motor, `src/models/automation-model.js`, en el navegador y en el servidor: mismas acciones, mismo corte de bucles y mismo tope.

## Activada, en pausa, desactivada

Una regla tiene dos cosas distintas y la pantalla las enseña por separado:

- **La casilla** es la intención de quien la configuró: activada o no (`on`). Nada la cambia salvo esa persona.
- **El estado** es lo que pasa de verdad, y va escrito con palabras junto al nombre (no solo con color): «Activa», «En pausa» o «Desactivada». La casilla lo lleva además como descripción accesible (`aria-describedby`), con el motivo.

Una regla está **en pausa** cuando está activada pero le falta algo: una columna, una etiqueta o una persona que ya no existe en el proyecto. No se ejecuta, no falla en silencio y no se arregla sola por otra cosa: debajo dice qué falta («No se ejecuta: la columna «Revisión» ya no existe.») y, a quien puede cambiarla, que la edite.

- Al **editarla**, lo que ya no existe sigue elegido en su lista con su nombre («Revisión (ya no existe)»). Guardar sin elegir otra cosa da error; no se sustituye a escondidas por la primera opción.
- Si lo que faltaba **vuelve** con la misma identidad (se vuelve a invitar a la persona, se crea otra vez una etiqueta con ese nombre), la regla sale de la pausa sola. Una columna borrada no vuelve: una nueva con el mismo nombre es otra columna.

### Nombres guardados

Junto a la clave de cada columna y al identificador de cada persona, la regla guarda su nombre (`stageName`, `assigneeName`, `memberName`). Se renueva al guardar la regla y cada vez que la carga quien puede cambiarla, así que un **cambio de nombre** se refleja solo. Si la columna o la persona **desaparece**, ese nombre guardado es el que usan los avisos, la frase de la regla y el formulario. Las etiquetas se guardan por su nombre, que siempre se puede leer.

Una regla antigua sin nombre guardado (anterior a la fase 2) que ya apuntaba a algo borrado dice «columna borrada» o «alguien que ya no está»: nunca enseña la clave interna.

### Aviso antes de borrar

Antes de confirmar, el diálogo dice qué automatizaciones dejarán de poder ejecutarse y que quedarán en pausa:

| Qué se borra | Dónde avisa |
|---|---|
| Una columna desde el tablero | Diálogo «Eliminar columna». |
| Una o varias columnas desde «Editar proyecto» (o al cambiar el tipo de proyecto) | Confirmación nueva al guardar, solo si alguna regla las usaba. |
| Una persona del equipo | Diálogo «Quitar del equipo», si el proyecto que se comparte es el abierto. |
| Una etiqueta | No hay aviso porque Kanlane no tiene dónde borrar etiquetas del catálogo: solo se añaden. Pueden desaparecer si el proyecto está enlazado con GitHub y allí se borran; entonces la regla queda en pausa y lo dice, pero sin aviso previo. |

No avisa a quien **sale** del equipo por su cuenta: no es propietario, así que no puede cambiar las reglas, y el aviso sería para otra persona.

## Dónde corre el código de servidor y por qué

En el **Worker de Cloudflare que ya sirve la web**, con un **cron** (`triggers.crons` en `wrangler.jsonc`, cada 30 minutos). Se eligió por ser lo más simple y barato:

- Firebase no ofrece Cloud Functions en el plan gratuito (Spark); pasar a Blaze obliga a dar una tarjeta.
- El Worker ya existe, ya se despliega con la web y los cron entran en su plan gratuito. No hay servicio nuevo ni proveedor nuevo.

El cron no atiende peticiones: no hay ninguna ruta que lo dispare desde fuera. Lee y escribe Firestore por su API REST con una **cuenta de servicio de Google**, cuyo JSON es un secreto del Worker (`FIREBASE_SERVICE_ACCOUNT`). Esa cuenta entra como administrador: las reglas de seguridad de Firestore no le aplican, así que el código (`worker/automations.mjs`) es quien limita lo que hace.

### Límites de esta opción

| Límite | Consecuencia |
|---|---|
| 50 subpeticiones por ejecución (plan gratuito) | Cada vuelta atiende 10 proyectos (3 subpeticiones cada uno personal y 4 cada equipo: tareas, marcas, la comprobación de quién es el propietario y la escritura) más 4 fijas (token, cursor, lista y constancia de la vuelta): 44 como mucho. Recuerda por dónde iba en `automation_state/cursor`. Con N proyectos con reglas por fecha, cada uno se revisa cada `ceil(N / 10) × 30` minutos. |
| 10 ms de CPU por ejecución (plan gratuito) | Sin medir en producción. Si el cron empieza a fallar por CPU con muchas tareas, hay que bajar `JOBS_PER_RUN` o pasar al plan de pago de Workers (5 USD al mes). |
| Precisión | Una regla «a 2 días de vencer» se ejecuta en algún momento de ese día, no a una hora fija. El día se calcula en la zona horaria del navegador de quien dejó las reglas. |
| 200 tareas con fecha cercana por proyecto y vuelta | Las que no entren se atienden en vueltas siguientes. |
| 60 ejecuciones por proyecto y vuelta | El resto queda para la vuelta siguiente (es el mismo tope por minuto del navegador). |
| Cuotas de Firestore (plan gratuito: 50 000 lecturas y 20 000 escrituras al día) | Cada vuelta lee las copias de 10 proyectos, sus marcas y sus tareas con fecha cercana. |

## El cron, con detalle

**Cuándo.** `*/30 * * * *` en **UTC** (Cloudflare no admite otra zona): a las :00 y :30 de cada hora. Cloudflare no garantiza el segundo exacto y una vuelta puede perderse; la siguiente recupera lo pendiente, porque lo que decide si una regla toca son las marcas guardadas, no la hora.

**Zona horaria de las reglas.** «Hoy» se calcula en la zona horaria del navegador de quien dejó la copia (`tz` en `automation_jobs`, la que tenía la última vez que cargó o cambió las reglas). Si no vale o falta, UTC. Las fechas límite de Kanlane son días sin hora, así que una regla «a 2 días de vencer» toca desde las 00:00 de ese día en esa zona.

**Ventana de ejecución.** Desde que toca hasta que se ejecuta pasan, como mucho, 30 minutos por cada tanda de 10 proyectos que haya delante: con hasta 10 proyectos con reglas por fecha, menos de 30 minutos; con 25, menos de 90. No hay hora fija.

**Constancia de cada vuelta.** Cada vuelta, haya hecho algo o no:

- escribe una línea en los registros del Worker: «automatizaciones: N ejecuciones en M proyectos» (y cuántos quedan para reintentar, si alguno); sin el secreto, «automatizaciones: sin configurar»; si falla entera, «automatizaciones: » y el motivo. Sin identificadores de proyecto ni contenido;
- actualiza `automation_state/cursor` con `updatedAt`, `runs` (vueltas dadas), `jobs` (proyectos mirados en esta), `ran` (reglas ejecutadas en esta) y `errors`. Ese documento solo lo lee y lo escribe el servidor (las reglas de Firestore lo cierran a todo el mundo): se ve en la consola de Firebase.

Cada **ejecución** de una regla deja además su línea en la actividad de la tarea y su marca.

**Navegador y servidor a la vez.** Las reglas por fecha las miran los dos: el servidor cada 30 minutos y cualquier navegador abierto con permiso de edición (al abrir, al cambiar las tareas y cada 10 minutos). Lo que evita que se pisen:

1. *Marcas compartidas.* «Esta regla ya se ejecutó para esta tarea y esta fecha» se guarda en `plugin_data/kanlane.automations.state`. Quien llega segundo la ve y no hace nada, aunque alguien haya deshecho a mano lo que hizo la regla. Si la fecha límite cambia, vuelve a contar.
2. *Escritura condicionada en el servidor.* El servidor escribe todo lo de un proyecto (tareas, líneas de actividad y marcas) en una sola operación que solo entra si ni esas tareas ni las marcas han cambiado desde que las leyó. Si un navegador u otra vuelta tocó algo en medio, Firestore la rechaza entera, no queda nada a medias y el proyecto aparece como `conflict` en esa vuelta; la siguiente lo vuelve a mirar con los datos nuevos.
3. *El navegador suma, no pisa.* Antes de guardar sus marcas, el navegador vuelve a leer las que haya y las suma a las suyas.
4. *Acciones que no se repiten.* Una acción solo cuenta si cambia algo: añadir una etiqueta o una subtarea que ya está no hace nada ni deja línea.

Queda una ventana que no se cierra: dos **navegadores** que comprueban la misma regla en el mismo instante no tienen escritura condicionada entre ellos. Pueden dejar dos líneas de actividad para un único cambio (el cambio en sí no se duplica, por el punto 4). No se ha visto en las pruebas, pero no está impedido.

**Entre ciclos.** Una vuelta que no llega a escribir (fallo de red, conflicto, límite de 60 ejecuciones) no deja marca, así que la siguiente lo intenta otra vez. Una que escribe deja la marca en la misma operación: no puede quedar una regla ejecutada sin marca ni una marca sin ejecución.

### Estado de la comprobación del cron

- **Comprobado con emuladores** (`tests/e2e/automation-cron.js`): con el navegador cerrado, el proceso del servidor ejecuta la regla contra Firestore por su API REST, deja la línea y la marca, no repite en la vuelta siguiente ni al abrir o recargar la app, y un cambio simultáneo provoca `conflict` sin escribir nada.
- **Pendiente: comprobación independiente en producción.** Lo anterior llama al mismo código que llama el cron, pero no lo lanza Cloudflare ni usa la cuenta de servicio real. Falta ver, con todos los clientes cerrados, que el cron desplegado corre solo. Cómo hacerlo, en un proyecto creado para la prueba (no en uno real):
  1. Crear un proyecto personal de prueba sin cifrado, con una regla «el día en que vence → añadir la subtarea X» y una tarea que venza hoy. Comprobar que existe `automation_jobs/u~{uid}~{proyecto}`.
  2. Antes de que el navegador la ejecute (lo hace a los pocos segundos de crearla): crear la tarea con fecha de mañana, cerrar todas las sesiones y esperar a que pase la medianoche de la zona horaria del navegador más 30 minutos.
  3. Sin abrir Kanlane, mirar en la consola de Firebase: `automation_state/cursor` con `updatedAt` reciente y `runs` creciendo cada media hora; la subtarea en la tarea; una nota `kind:'activity'` en ella; la marca en `plugin_data/kanlane.automations.state`.
  4. Mirar los registros del Worker en Cloudflare: una línea «automatizaciones: …» cada media hora.
  5. Abrir Kanlane: la línea de actividad sigue siendo una.

  Hasta que eso se haga y salga bien, **el cron no está dado por cerrado**.

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

**Permisos: en Firestore y en el servidor, no solo en la pantalla.**

| Qué | Propietario | Editor | Lector | Dónde se impone |
|---|---|---|---|---|
| Ver las reglas | sí | sí | sí | `firestore.rules` (lectura de `plugin_data` para miembros) |
| Crear, cambiar, activar o borrar reglas y botones | sí | no | no | `firestore.rules` (`ownerOnly`: `plugin_data/kanlane.automations`), además de la pantalla y el controlador |
| Pulsar un botón, disparar reglas al mover o crear | sí | sí | no | Son escrituras normales de tareas: `canEdit` |
| Apuntar marcas de ejecución | sí | sí | no | `firestore.rules` (`plugin_data/kanlane.automations.state`) |
| Dejar, cambiar, leer o borrar la copia del servidor | sí | no | no | `firestore.rules` (`validJob`: su `uid`, su identificador y `isOwner`) |
| Que el servidor ejecute esa copia | solo si sigue siendo propietario | no | no | `worker/automations.mjs` (`ownership`) |
| Leer o escribir el estado del cron | no | no | no | `firestore.rules` (cerrado; solo la cuenta de servicio) |

Lo que autoriza una ejecución en el servidor es la copia. Las reglas de Firestore solo dejan escribirla a su dueño: el identificador tiene que coincidir con quien escribe (`u~{su uid}~…`) o con un equipo del que es propietario, y un proyecto con cifrado total no puede tenerla. Como la cuenta de servicio se salta esas reglas, el servidor lo vuelve a comprobar por su cuenta: los campos de la copia tienen que decir lo mismo que su identificador y, en un equipo, lee el equipo y solo sigue si quien dejó la copia continúa siendo su propietario. Si no (o si el equipo ya no existe), borra la copia y no ejecuta nada.

En un proyecto personal no hay editores: todo es de su dueño.

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
- Cada vuelta escribe todo lo de un proyecto de una vez (tareas, registro y marcas), y solo si nada de eso cambió desde que lo leyó: o se guarda todo o nada, así que no puede quedar una regla ejecutada sin su marca ni pisarse un cambio hecho mientras tanto.
- En un equipo, el servidor comprueba en cada vuelta que la copia sigue siendo del propietario.
- App Check: el cron no pasa por App Check (no es un cliente; usa la cuenta de servicio) y no abre ninguna ruta pública. No cambia nada de lo que App Check protege.

## Pruebas

Ninguna toca proyectos reales: usan memoria o los emuladores de Firebase con cuentas y proyectos creados para la prueba.

- `tests/automations/automations.test.js`: el motor (reglas, botones, bucles, nombres guardados, estado efectivo, reglas afectadas por un borrado). Los límites se prueban en el borde y con reloj simulado: tres reglas seguidas sí y la cuarta no; 60 ejecuciones en un minuto sí, la 61 no, sigue sin cupo a los 59 999 ms y lo recupera a los 60 000.
- `tests/worker/automations.test.js`: el proceso del servidor con una base de datos en memoria. Los mismos dos límites en el borde, la comprobación del propietario, el conflicto cuando algo cambia entre leer y escribir, y la constancia de cada vuelta.
- `tests/rules/rules-test.js`: quién puede escribir las reglas de un equipo y las copias para el servidor, con intentos de escritura directa con credenciales de editor (`update`, lote junto a una escritura permitida, suplantar a la propietaria en la copia, estado del cron).
- `tests/e2e/automation-team.js`: un equipo con dos cuentas (propietaria y editor), emuladores y reglas reales. El editor ve y ejecuta pero no cambia nada, ni por la pantalla ni escribiendo directamente; el servidor no ejecuta una copia que no sea de la propietaria; lo que ejecuta un navegador no lo repite el otro; avisos al borrar una columna y al quitar a una persona; estado en pausa con palabras; recuperación al editar; cambio de nombre; recarga sin caché, sesión nueva, móvil e inglés.
- `tests/e2e/automation-cron.js`: el servidor ejecuta una regla por fecha con el navegador cerrado, deja constancia de cada vuelta, no repite (ni en la vuelta siguiente, ni al abrir la app, ni al recargarla sin caché) y un cambio simultáneo acaba en `conflict` sin escribir nada; botón de tarea; columna borrada.
- `tests/e2e/crypto-smoke.js`: un proyecto cifrado guarda sus reglas selladas, no deja copia y el servidor no lo toca.
- `tests/e2e/cloud-smoke.js`: en un proyecto personal, las reglas se guardan con el proyecto, se ejecutan una vez y dejan registro.

Lo que estas pruebas no cubren está en «Estado de la comprobación del cron».
