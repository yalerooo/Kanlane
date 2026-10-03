# Cifrado por proyecto: plan de implementación

> Estado: **plan, sin implementar**. Redactado en octubre de 2026 a partir del código de `main` (commit `c39c011`).
> Las decisiones del dueño (modos A/B/C, sin migración, GitHub incompatible con B, compartir con código de un solo uso, orden reglas → código) se dan por cerradas y aquí solo se concretan. Lo que todavía necesita una decisión está en el apartado 20, con una recomendación.
> Las marcas **[MANUAL]** son pasos que tiene que hacer el dueño a mano (consola de Firebase, Cloudflare, revisión de textos). Las marcas **[SIN VERIFICAR]** son supuestos que no se han podido comprobar contra un servicio real.

---

## 1. Resumen

Al crear un proyecto se elegirá su privacidad en un paso nuevo del asistente «Nuevo proyecto»:

| Modo | Nombre en la interfaz | Qué se cifra | Quién puede descifrar | Fase |
|---|---|---|---|---|
| **A** | Solo contraseñas | Contraseña y notas de las credenciales del cofre (lo de hoy) | El usuario (contraseña maestra del cofre) | Ya existe; es el predeterminado |
| **B** | Cifrado total | Todo el contenido del proyecto (tareas, notas, clientes, contactos, reuniones, metadatos del cofre, datos de plugins, imágenes) | Solo quien tenga la contraseña de cifrado del proyecto o la clave de recuperación | PR1–PR7 |
| **C** | Gestionado por Kanlane | Lo mismo que B | El usuario **y técnicamente Kanlane** (la clave la custodia un Worker de Cloudflare) | PR9 (tarjeta desactivada con «Próximamente» hasta entonces) |

Principios:

1. **No se migra nada.** Los proyectos existentes siguen en modo A. Convertir uno a B es la fase final opcional (PR11).
2. **Cada documento cifrado lleva su versión de esquema** (`ev`) y su identificador de clave (`kid`). El servidor no puede leer el contenido, pero las reglas sí comprueban la forma: un documento cifrado nunca puede volver a escribirse en claro.
3. **Una clave de datos aleatoria (DEK) por proyecto**, envuelta con la contraseña (PBKDF2-SHA256, 600 000 iteraciones como mínimo) y con una clave de recuperación (160 bits). La DEK vive en el navegador como `CryptoKey` **no extraíble** en IndexedDB.
4. **GitHub y cifrado total son incompatibles**, y eso se aplica en la interfaz, en el motor de sincronización y en las reglas.
5. **Primero reglas, después código.** Las reglas de PR2 son compatibles con el código actual y se publican a mano antes de desplegar PR3.
6. **Los textos públicos solo cambian cuando la fase está desplegada** (PR8). La tabla de almacenamiento de `legal/cookies/` sí se actualiza en el mismo PR que añade el almacenamiento, porque se despliega a la vez y es una obligación legal (ver 18).

---

## 2. Lo que hay hoy (verificado en el código)

- **Cofre** (`src/models/vault-model.js`, `src/services/crypto.js`): DEK aleatoria de 256 bits envuelta con la contraseña maestra (PBKDF2-SHA256, **300 000** iteraciones) y con una clave de recuperación de 256 bits, en `vault_meta/check`. Solo `password` y `notas` van cifradas (`iv`/`cipher`, `ivV2`/`cipherV2`); `tipo`, `cliente`, `label`, `correo`, `web`, `ip`, `usuario`, `puerto`, `dominio` van en claro. Sin AAD.
- **Todo lo demás va en claro en Firestore**: `tasks` (+ `notes`), `clients`, `contacts`, `meetings`, `plugin_data`, `assets` (imágenes como `data:` URL), documento del proyecto.
- **`docs/SEGURIDAD.md` línea 23 dice «En Firestore solo hay texto cifrado»: es falso** (solo lo es para la contraseña y las notas de cada credencial). Se corrige en PR0.
- **Desajuste de imágenes**: `IMAGE_MAX_BYTES = 850 * 1024` (`src/services/firebase-backend.js:16`) se compara con `out.length * 0.75`, es decir, admite una `data:` URL de hasta ~1 160 000 caracteres, pero las reglas exigen `textWithin(data, 'data', 900000)`. Una imagen que comprimida ocupe entre ~675 KB y 850 KB pasa la comprobación del cliente y el servidor la rechaza con `permission-denied`. Se corrige en PR0.
- **Rutas** (`ProjectModel.scope`): principal en la raíz `users/{uid}/…`; otros personales en `users/{uid}/projects/{id}/…`; equipos en `teams/{tid}/…`. Las imágenes de los proyectos personales (todos) van a `users/{uid}/assets`; las de equipo, a `teams/{tid}/assets` (vía `window.__teamId`).
- **Consultas al servidor sobre colecciones de datos** (lista completa, búsqueda de `where`/`orderBy` en `src/`):
  - `CollectionModel.idsWhere/updateWhere/removeWhere` → usadas solo por `ClientModel.rename` (campo `cliente` en tareas, reuniones, contactos y cofre) y `ClientModel.removeWithTasks` (campo `cliente` en tareas).
  - `TaskModel.watchNotes` → `orderBy('createdAt')`.
  - `PluginModel.connect` → `where('_kind', '==', 'plugin-install')` en `plugin_data`.
  - `cloud-backup.js` → `where('projectId')` sobre `backup_versions` (de la cuenta, no del proyecto).
  - `firebase-backend.js` → `where('memberIds', 'array-contains')`, `where('email')`, `where('teamId')+where('invitedByUid')` (equipos e invitaciones; no son contenido).
- **Escrituras que sustituyen el documento entero** (`set()`): `MeetingModel.save`, `VaultModel.saveEntry`, `CollectionModel.restore`, `PluginModel.set`/`projectBucket.write`, `ProjectModel.set/save/patch` (en personales sustituye; en equipos calcula la diferencia y **borra con `FieldValue.delete()` las claves que no vengan**).
- **Escrituras que se saltan el modelo** (irían en claro si no se tocan): `TaskModel.addNote/addActivity` (`notes(taskId).add`), `BackupModel.import` (`ref.collection('notes').add`), `CollectionModel.restore` (`snap.col.doc(id).set`), `TeamModel.convert` (`op[0].set(op[1])`), `PluginModel.projectBucket`, `VaultModel.setMeta`, `firebase-backend` `userAssets.upload`.
- **Copias**: `backup-history.js` guarda **el JSON en claro** en IndexedDB (`workhub-backup-history`), siete versiones por proyecto. `cloud-backup.js` cifra con una clave aleatoria guardada en `localStorage['workhub_cloud_backup_key:{uid}']`.
- **Cierre de sesión**: `AuthController.signOut` borra `workhub_project` y `workhub_session` y llama a `firebase.signOut()`; la recarga sin sesión ejecuta `clearLocalCache()` → `firestore.clearPersistence()`. No toca otras bases de IndexedDB.
- **CSP** (`scripts/build-public.js`): `script-src 'self' https://www.gstatic.com …` sin `'wasm-unsafe-eval'`.
- **Límite de lotes**: las reglas de equipo hacen `get()` del equipo; Firestore limita a 10 accesos por operación y 20 por lote. En equipos se escribe de una en una (`runPool`, 12 a la vez).

---

## 3. Modelo de amenazas

### 3.1 Contra qué protege el modo B

| Amenaza | ¿Protege B? | Comentario |
|---|---|---|
| Alguien obtiene una copia de la base de datos de Firestore (fuga, exportación, error de reglas, empleado de Google o de Kanlane con acceso a la consola) | **Sí** | Solo ve `e` (AES-256-GCM) y los campos en claro del apartado 5.6. |
| Kanlane (el titular) mira los datos en la consola de Firebase | **Sí** | No tiene la contraseña ni la clave de recuperación. |
| Orden judicial o requerimiento a Kanlane o a Google sobre los datos guardados | **Sí, para el contenido cifrado** | Se puede entregar el texto cifrado y los metadatos en claro, no el contenido. |
| Un servidor manipulado cambia un blob cifrado o lo mueve a otro documento | **Sí (detección)** | AAD con proyecto, colección, id, versión y clave: el descifrado falla y se marca el documento como ilegible. |
| Un servidor manipulado cambia **campos en claro** (estado, orden, fecha, asignados) | **No** | No están autenticados. Se documenta. |
| Un servidor manipulado devuelve **una versión antigua** del mismo documento (*replay*) | **No** | Haría falta un contador firmado; fuera de alcance. |
| Fuerza bruta de la contraseña por quien tenga el documento `crypto/{uid}` (Kanlane, Google, quien robe la base) | **Parcial** | Depende de la contraseña: PBKDF2 600 000 encarece cada intento, pero una contraseña débil cae. Por eso: mínimo 12 caracteres y avisos. |
| Fuerza bruta del código de acceso de una invitación | **Sí** | 100 bits de entropía, legible solo por el destinatario y 24 horas. No hay ningún oráculo en línea que limitar (ver 10.5). |
| Otra cuenta de Kanlane intenta leer el proyecto | Sí (reglas, como hoy) | Además, aunque las reglas fallasen, no tendría la clave. |

### 3.2 Contra qué NO protege (hay que decirlo)

- **El código lo sirve Kanlane.** Una aplicación web cifrada de extremo a extremo confía en el JavaScript que recibe. Si el titular, Cloudflare, una cuenta de GitHub con permisos o una dependencia (SDK de Firebase en `gstatic.com`) sirviesen código malicioso, ese código podría leer las claves al desbloquear. No hay forma de evitarlo en una web sin extensión ni aplicación firmada.
- **XSS en el origen de la app.** La `CryptoKey` no extraíble impide copiar los bytes de la clave, pero cualquier script que se ejecute en `kanlane.com` puede **usarla** para descifrar. La CSP estricta (sin scripts en línea ni `eval`) es la defensa.
- **El dispositivo del usuario**: malware, extensiones del navegador con acceso a la página, alguien con la sesión abierta. Con «Este dispositivo es de confianza», la clave sobrevive al cierre de sesión.
- **Los metadatos en claro** (apartado 5.6): nombre del proyecto, columnas, etiquetas del catálogo, fechas, estados, orden, asignados, número y tamaño aproximado de los documentos, fechas de cambio, quién es miembro.
- **Lo que ya ha salido**: notificaciones del navegador de los recordatorios (título de la tarea en el centro de notificaciones del sistema), archivos exportados sin cifrar, lo que reciben los plugins con permiso, lo que se guarda en `wh.storage.user` (no se cifra, es de la cuenta).
- **Un miembro expulsado** conserva lo que ya descifró y, hasta la rotación de clave (PR10), la propia DEK.
- **Pérdida**: sin contraseña ni clave de recuperación el proyecto es irrecuperable. Kanlane no puede ayudar. Es una propiedad, no un fallo.

### 3.3 Modo C (gestionado)

Protege frente a una copia de la base de datos de Firestore (la clave no está en Firestore) y frente a quien solo tenga acceso a Google. **No** protege frente a Kanlane: quien controle el secreto del Worker y una sesión válida (o el propio Worker) puede obtener la clave. Hay que decirlo con esas palabras.

---

## 4. Qué se podrá afirmar y qué no

Solo cuando PR4 (B personal) y, para equipos, PR7 estén desplegados:

**Se podrá afirmar** (con estas palabras o equivalentes):

- «Con el cifrado total, el contenido del proyecto (tareas, notas, clientes, contactos, reuniones, contraseñas, imágenes y datos de plugins) se cifra en tu navegador con AES-256 antes de enviarse.»
- «Kanlane no tiene tu contraseña de cifrado ni puede leer ese contenido.»
- «Si pierdes la contraseña y la clave de recuperación, ni nosotros podemos recuperar el proyecto.»
- «Se elige por proyecto. Los proyectos con cifrado total no se pueden sincronizar con GitHub.»
- «Para compartir un proyecto cifrado, das a cada persona un código de acceso de un solo uso por otro canal.» (tras PR7)

**No se podrá afirmar**:

- «Nadie puede leer tus datos» o «conocimiento cero» sin matices (los metadatos van en claro y el código lo sirve Kanlane).
- «Se cifra todo» (nombre del proyecto, columnas, etiquetas del catálogo, fechas y estados no; ver 5.6).
- «Protegido aunque tu ordenador esté comprometido».
- «Si expulsas a alguien, deja de poder leer» (hasta PR10, solo deja de poder **descargar** datos nuevos).
- Nada del modo C hasta PR9, y nunca que en C «Kanlane no puede leerlo».
- «Auditado», «certificado» o similares.

---

## 5. Modelo de datos

### 5.1 Claves

```
                     contraseña de cifrado (la elige el usuario, ≥ 12 caracteres)
                              │ PBKDF2-SHA256, 600 000 it., sal 16 B aleatoria
                              ▼
                     KEK_pw (AES-256-GCM, no extraíble, solo en memoria)
                              │ envuelve (AES-GCM, IV 12 B, AAD "kanlane/wrap/v1|pw|pid|kid|uid")
                              ▼
clave de recuperación ─HKDF─► KEK_rk ──envuelve──► ┌───────────────────────────┐
(160 bits, base32 32 car.)                          │ DEK (256 bits aleatorios,  │
                                                    │ crypto.getRandomValues)    │
código de acceso ─PBKDF2──► KEK_code ─envuelve──►   └───────────────────────────┘
(100 bits, 20 car., solo invitaciones, 24 h)                │
                                                            │ AES-256-GCM, IV 96 bits aleatorio por escritura
(PR9) secreto del Worker ─HKDF─► KEK_kms ─envuelve──►       │ AAD "kanlane/v1|pid|kid|ruta|id|ev"
                                                            ▼
                                       e de cada documento, bytes de cada imagen
kcv = AES-GCM(DEK, "kanlane-kcv", AAD "kcv|pid|kid") → en el documento del proyecto
```

- **DEK**: 32 bytes de `crypto.getRandomValues`. Nunca derivada de hora, uid, correo ni contraseña. Se importa como `CryptoKey` AES-GCM **no extraíble** (`extractable:false`, usos `encrypt`/`decrypt`). Los bytes en claro solo existen un instante al crearla o al reenvolverla, y se sobrescriben con ceros (`raw.fill(0)`).
- **pid**: identificador criptográfico del proyecto, 16 bytes aleatorios en base64url (22 caracteres). No se usa el id de Firestore porque el principal se llama `main` en todas las cuentas y porque al convertir a equipo cambia la ruta.
- **kid**: identificador de la DEK, 8 bytes aleatorios en base64url (11 caracteres). Cambia al rotar (PR10).
- **kcv** (comprobación de clave): cifrado AES-GCM de la cadena fija `kanlane-kcv` con la DEK y AAD `kcv|pid|kid`. Sirve para comprobar, sin descifrar datos, que la DEK guardada en el navegador o recibida con un código es la del proyecto y la versión vigente (`kid`). No revela nada de la clave.
- **Clave de recuperación**: 20 bytes aleatorios (160 bits; el mínimo pedido es 128), base32 legible del alfabeto de `crypto.js` (`0-9A-Z` sin I, L, O, U), en grupos de 4: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. Como tiene entropía de sobra, KEK_rk = HKDF-SHA256(bytes, sal = pid, info = `kanlane/rk/v1`), sin iteraciones.
- **Código de acceso**: 100 bits aleatorios = 20 caracteres base32 en 5 grupos (`XXXX-XXXX-XXXX-XXXX-XXXX`). Cumple el mínimo de 16 caracteres y 80 bits con margen. KEK_code = PBKDF2-SHA256(código normalizado, sal 16 B, 100 000 iteraciones): con 100 bits la KDF no es lo que protege, pero encarece aún más un ataque fuera de línea.

**KDF de la contraseña: PBKDF2-SHA256 con 600 000 iteraciones (mínimo exigido también por las reglas).** Justificación frente a Argon2id:

- Argon2id en el navegador necesita WebAssembly. La CSP actual no tiene `'wasm-unsafe-eval'`; añadirlo amplía la superficie de la CSP de toda la app y obliga a alojar una biblioteca de terceros (sin build, sin npm en el cliente) que habría que auditar y mantener.
- Las versiones de Argon2 en JavaScript puro son tan lentas que obligarían a usar parámetros de memoria tan bajos que perderían su ventaja.
- PBKDF2 está en Web Crypto en todos los navegadores, sin dependencias. 600 000 iteraciones es la recomendación vigente de OWASP para PBKDF2-HMAC-SHA256.
- Los parámetros se guardan en el documento (`kdf.name`, `kdf.iter`): se puede subir el número o pasar a Argon2id más adelante sin migrar datos (solo reenvolver la DEK al siguiente desbloqueo).
- Coste: ~0,3–1,5 s por intento según el dispositivo **[SIN VERIFICAR en móviles reales]**. Mientras dure se muestra el texto «Comprobando la contraseña…» con el esqueleto `.sk` (no círculo de carga, criterio del usuario).

### 5.2 Dónde se guarda cada cosa en Firestore

```
Documento del proyecto (registro):
  personal   users/{uid}/projects/{projectId}          ← campo enc
  principal  users/{uid}/projects/main                 ← campo enc (si el principal es B; ver decisión D2)
  equipo     teams/{tid}                               ← campo enc

Envoltorios de la DEK, uno por persona (solo lo lee y escribe esa persona):
  personal   users/{uid}/projects/{projectId}/crypto/{uid}
  principal  users/{uid}/crypto/{uid}
  equipo     teams/{tid}/crypto/{uid}                  ← el propietario puede borrar los de otros (expulsión)

Datos cifrados (mismas rutas de hoy; cambia el contenido de cada documento):
  <ámbito>/tasks/{id}, <ámbito>/tasks/{id}/notes/{id}, <ámbito>/clients/{id},
  <ámbito>/contacts/{id}, <ámbito>/meetings/{id}, <ámbito>/vault/{id},
  <ámbito>/plugin_data/{id}
  imágenes: users/{uid}/assets/{id} (personales) o teams/{tid}/assets/{id} (equipo)

Sin cambios:
  <ámbito>/vault_meta/check (ya es material de claves envuelto), users/{uid}/settings,
  users/{uid}/plugins (instalaciones del principal), users/{uid}/backup_versions

Invitaciones (PR7):
  invites/{tid}_{correo}             ← como hoy, más enc:true y expiresAt (orientativo, para la interfaz)
  invites/{tid}_{correo}/key/wrap    ← DEK envuelta con el código; legible solo por el destinatario y solo 24 h
```

`<ámbito>` es lo que devuelve `ProjectModel.scope(db, id)`: la raíz para el principal, `users/{uid}/projects/{id}` para los personales y `teams/{tid}` para equipos. La colección nueva se llama `crypto` (no `keys`, para no confundirla con `EQUIPOS.md`, que reservaba `keys` para el diseño futuro de pares de claves).

### 5.3 Campo `enc` del documento del proyecto

```js
enc: {
  v: 1,                 // versión del formato de enc
  mode: 'pw',           // 'pw' (B). 'managed' (C) solo a partir de PR9
  pid: 'k3J9…',         // 22 car. base64url
  kid: 'Qm7x…',         // 11 car. base64url
  kcv: 'base64url(iv||ct)',
  createdAt: 1730000000000
}
```

Reglas: inmutable una vez creado (salvo `kid`/`kcv` en PR10); incompatible con el campo `github`; solo se puede añadir al crear el documento o al reescribir el principal marcado `deleted:true` (PR11 lo amplía).

### 5.4 Documento `crypto/{uid}`

```js
{
  v: 1,
  kid: 'Qm7x…',                         // DEK que envuelve
  kdf: {name: 'PBKDF2', hash: 'SHA-256', iter: 600000, salt: 'b64url 16 B'},
  pw:  {iv: 'b64url 12 B', ct: 'b64url 48 B'},   // DEK envuelta con KEK_pw
  rk:  {iv: 'b64url 12 B', ct: 'b64url 48 B'},   // DEK envuelta con KEK_rk
  createdAt: 1730000000000,
  updatedAt: 1730000000000
  // PR7 si se decide D9: pub (clave pública ECDH P-256, JWK) y priv (privada envuelta con KEK_pw)
  // PR9: kms {iv, ct, kmsv} si el proyecto es C
}
```

AAD de cada envoltorio: `kanlane/wrap/v1|<tipo>|<pid>|<kid>|<uid>`, con `<tipo>` = `pw`, `rk`, `code` o `kms`. Un envoltorio copiado de otra persona, otro proyecto u otra clave no se abre.

### 5.5 Formato del blob cifrado

- `e` (string): `base64url( iv[12] ‖ ciphertext ‖ tag[16] )`. Los primeros 16 caracteres son el IV en base64url: sirven de **firma de caché** (si el IV no cambia, el contenido tampoco).
- `ev` (entero): versión del esquema. `1` = AES-256-GCM, texto JSON UTF-8, AAD v1. Las reglas aceptan `1 ≤ ev ≤ 1` hasta que una PR suba el máximo.
- `kid` (string): clave con la que se cifró.
- **AAD** = `kanlane/v1|{pid}|{kid}|{ruta}|{id}|{ev}`, donde `ruta` es la colección relativa al ámbito (`tasks`, `tasks/{taskId}/notes`, `clients`, `contacts`, `meetings`, `vault`, `plugin_data`, `assets`). Es la «ruta + id + versión» pedida, pero con la ruta lógica y el `pid` en lugar de la ruta de Firestore: así el principal (`main`, igual en todas las cuentas) es único y una imagen de un personal (que vive en `users/{uid}/assets`, común a la cuenta) queda ligada a su proyecto.
- **IV**: 12 bytes de `crypto.getRandomValues` **en cada escritura**, también al reescribir el mismo documento. Con IV aleatorio el límite seguro de AES-GCM es 2^32 cifrados por clave; un proyecto no se acerca (se documenta y PR10 permite rotar).
- **Texto en claro**: JSON con **solo los campos secretos** de esa colección. Sin relleno (decisión D7): el tamaño del blob revela el tamaño aproximado del contenido.
- **Imágenes**: `e` = `base64url(iv ‖ AES-GCM(bytes JPEG) ‖ tag)` con la misma AAD (ruta `assets`). No se guarda `contentType` en claro (siempre JPEG).

### 5.6 Campos en claro por colección (solo proyectos B)

Criterio: en claro solo lo que necesitan las reglas, una consulta del servidor, una actualización parcial frecuente sin reescribir el blob, o identificadores opacos sin contenido. Lo demás va en `e`.

| Colección | En claro | Dentro de `e` | Motivo de lo que queda en claro |
|---|---|---|---|
| `tasks` | `status`, `order`, `dueDate`, `repeat`, `repeatSpawned`, `createdAt`, `updatedAt`, `assignees`, `linkedContacts`, `linkedVault`, `e`, `ev`, `kid` | `title`, `desc`, `cliente`, `contacto`, `labels`, `checklist` | Arrastrar (`move`), `reschedule` y `spawnNext` escriben solo esos campos; `assignees` son uids ya visibles en el equipo; los `linked*` son ids opacos (ver D6). **No se permiten `gh*`** (B no admite GitHub). |
| `tasks/*/notes` | `createdAt`, `kind`, `actorUid`, `imageAssetId`, `e`, `ev`, `kid` | `text`, `actorName` | `orderBy('createdAt')`; `imageAssetId` es un id opaco que necesitan `removeProject` y `TeamModel.convert` para borrar o copiar imágenes sin descifrar. |
| `clients` | `color`, `createdAt`, `e`, `ev`, `kid` | `nombre` | `setColor` escribe solo `color` (un número). |
| `contacts` | `createdAt`, `updatedAt`, `e`, `ev`, `kid` | `cliente`, `nombre`, `email`, `telefono`, `notas` | — |
| `meetings` | `date`, `createdAt`, `updatedAt`, `e`, `ev`, `kid` | `title`, `cliente`, `start`, `end`, `link`, `notas` | `reschedule` escribe solo `date` (simétrico con `dueDate`; ver D5). |
| `vault` | `order`, `createdAt`, `updatedAt`, `iv`, `cipher`, `ivV2`, `cipherV2`, `e`, `ev`, `kid` | `tipo`, `cliente`, `label`, `correo`, `web`, `ip`, `usuario`, `puerto`, `dominio` | `iv/cipher` ya son texto cifrado con la clave del cofre (doble cifrado); `reorder` escribe solo `order`. |
| `vault_meta/check` | todo (sin cambios) | — | Ya es la DEK del cofre envuelta. |
| `plugin_data` (datos `wh.storage`) | `updatedAt`, `e`, `ev`, `kid` | `values` | — |
| `plugin_data` (marcas `install:{id}`) | `_kind`, `pluginId`, `url`, `manifest`, `granted`, `official`, `installedAt`, `updatedAt` | — (sin `e`) | `where('_kind')`. No es contenido del usuario; revela qué plugins hay. Ver D8. |
| `assets` | `createdAt`, `e`, `ev`, `kid` | bytes de la imagen | — |
| documento del proyecto | `nombre`, `color`, `tipo`, `stages`, `clients`, `labels`, `createdAt`, `enc` (+ en equipos `ownerUid`, `memberIds`, `members`) | — (v1) | Hacen falta para pintar el selector y el tablero y para las reglas de equipo. Ver D3 (cifrar `labels` y nombres de etapas en una fase posterior). |

`createdAt`/`updatedAt` quedan en claro: `orderBy('createdAt')` de las notas y el orden de las tareas los necesitan. Esto revela **cuándo** se trabaja; se dice en la política.

### 5.7 Límites de tamaño (cliente y reglas)

El servidor ya no puede validar `title ≤ 500` o `desc ≤ 20000` dentro del blob. El cliente aplica los mismos límites **antes de cifrar** (mensaje claro) y las reglas solo limitan el tamaño de `e`:

| Colección | Máx. `e` (caracteres) | Cálculo |
|---|---|---|
| `tasks` | 200 000 | título 500 + descripción 20 000 + 100 subtareas + etiquetas, peor caso UTF-8 ×3, base64 ×4/3 |
| `notes` | 100 000 | texto 20 000 |
| `clients` | 4 000 | nombre 200 |
| `contacts` | 50 000 | notas 10 000 |
| `meetings` | 100 000 | notas 20 000, enlace 2 048 |
| `vault` | 20 000 | metadatos; el secreto sigue en `cipher` (≤ 900 000) |
| `plugin_data` | 900 000 | ver abajo |
| `assets` | 900 000 | ver 5.9 |

`plugin_data`: hoy un plugin puede guardar 800 KB por proyecto (`PluginModel` `MAX_TOTAL_BYTES`). Cifrado y en base64 ocuparía ~1,07 M caracteres y Firestore no admite documentos de más de 1 MiB. **En proyectos B la cuota baja a 600 KB** (error `quota` con el texto actual) y se documenta en `docs/PLUGINS.md`.

### 5.8 En el navegador

Base de IndexedDB nueva **`workhub-keys`**, almacén `keys`, `keyPath: 'id'`:

```js
{
  id: uid + ':' + pid,
  uid, pid, projectId,          // projectId: id del registro (para limpiar al borrar)
  kid,
  key: CryptoKey,               // AES-GCM, extractable:false, usos encrypt/decrypt
  trusted: false,               // «Este dispositivo es de confianza»
  savedAt: 1730000000000
}
```

- La `CryptoKey` se guarda por clonado estructurado (Chrome, Edge, Firefox y Safari lo admiten **[SIN VERIFICAR en Safari iOS reales]**). Si IndexedDB no está disponible (navegación privada antigua), la clave vive solo en memoria y se pide en cada recarga.
- Al desbloquear se usa `crypto.subtle.unwrapKey(…, extractable:false, …)`: los bytes de la DEK no llegan a JavaScript.
- **Pestañas**: un `BroadcastChannel('workhub-keys')` avisa al guardar u olvidar una clave, para que las otras pestañas abiertas del mismo proyecto se desbloqueen o se bloqueen solas.
- **Convivencia con el cierre de sesión** (hoy `clearLocalCache` solo borra la caché de Firestore):
  - `AuthController.signOut()` (cuenta, no invitado) llama antes de `firebase.signOut()` a `keystore.forgetUser(uid, {keepTrusted:true})`: borra las claves de esa cuenta **no** marcadas como de confianza.
  - `AuthController.onUser(null)` (arranque sin sesión, la misma rama que `clearLocalCache()`) llama a `keystore.purgeUntrusted()`: cubre sesiones caducadas o cerradas desde otra pestaña.
  - Las claves de confianza sobreviven. No dan acceso a nada sin una sesión de esa cuenta (los datos los sigue protegiendo Firestore), pero un script en el origen con la sesión iniciada podría usarlas.
  - La casilla **viene desmarcada** (decisión D4). Sin marcar, la clave sigue guardada mientras dure la sesión (no se pide en cada recarga, como pide el dueño); se borra al cerrar sesión.
- Ajustes del proyecto → «Olvidar la clave en este navegador» y `Ctrl K` → «Bloquear este proyecto» hacen lo mismo para un proyecto.
- **Copias locales** (`backup-history.js`) de un proyecto B se guardan cifradas con la DEK (`json` → `e`, AAD `kanlane/v1|pid|kid|backup-history|{id}|1`). Sin la clave se listan (fecha y recuento) pero no se abren.
- `localStorage['workhub_project']` (proyecto recordado) añade `enc:true` para enseñar la pantalla de desbloqueo antes de que llegue la lista. Ya contiene nombre, etapas y etiquetas, que en v1 van en claro igualmente.

### 5.9 Imágenes

- **PR0 (independiente del cifrado)**: se sustituye `IMAGE_MAX_BYTES` por `IMAGE_MAX_CHARS = 880000` y se compara la longitud real de la `data:` URL (`out.length <= IMAGE_MAX_CHARS`). Margen de 20 000 caracteres frente al `900000` de las reglas. Una prueba lee los dos números (regex sobre `firestore.rules` y `firebase-backend.js`) y falla si el del cliente supera el del servidor.
- **B**: se comprime igual (los mismos 880 000 caracteres de `data:` URL), se decodifican los bytes JPEG, se cifran y se guarda `e` (≈ la misma longitud + 22 caracteres de IV y etiqueta, por debajo de 900 000). Documento: `{createdAt, e, ev, kid}`. El id se genera antes (`col.doc().id`) porque va en la AAD.
- `firebase-backend.js` no sabe de proyectos: se añade `window.__assetCipher` (lo fija `AppController.connectProject`, igual que `window.__teamId`) con `sealBytes(id, bytes)` y `openBytes(id, doc)`. `upload` cifra si existe; `__assetUrl` descifra si el documento tiene `ev` y devuelve una `data:` URL (la CSP ya permite `img-src data:`).
- Las imágenes de los personales B siguen en `users/{uid}/assets` (de la cuenta): la AAD lleva el `pid`, así que una imagen de otro proyecto no se descifra con esta clave.

---

## 6. Cambios por módulo

Nombres de archivo y funciones reales. Los archivos nuevos se cargan con `<script>` clásico en `app/index.html` en el orden indicado.

### 6.1 Servicios nuevos (PR1)

**`src/services/project-crypto.js`** (después de `crypto.js`) → `Workhub.services.projectCrypto`:

```text
KDF_ITERATIONS = 600000, CODE_ITERATIONS = 100000, EV = 1
newDekBytes() → Uint8Array(32)                 newPid() / newKid() → string
importDek(raw, extractable) → CryptoKey
kcv(key, pid, kid) → string                    checkKcv(key, pid, kid, kcv) → Promise<boolean>
wrapPassword(raw, password, ctx) → {kdf, pw}   unwrapPassword(doc, password, ctx, extractable) → CryptoKey  (error 'bad-password')
newRecoveryKey() → {bytes, text}               parseRecoveryKey(text) → bytes | null
wrapRecovery(raw, bytes, ctx) → {rk}           unwrapRecovery(doc, bytes, ctx, extractable) → CryptoKey   (error 'bad-recovery')
newAccessCode() → {text}                       wrapCode(raw, code, ctx) → {salt, iter, iv, ct}
unwrapCode(wrap, code, ctx, extractable) → CryptoKey (error 'bad-code')
seal(key, aad, obj) → e                        open(key, aad, e) → obj      ivOf(e) → string
sealBytes(key, aad, bytes) → e                 openBytes(key, aad, e) → Uint8Array
aad({pid, kid, path, id, ev}) → Uint8Array
passwordCheck(pw, {email, projectName}) → {ok, level: 'short'|'weak'|'fair'|'good', message}
```

- `ctx = {pid, kid, uid}`. Todo con `crypto.subtle`; nada de `Math.random`.
- `passwordCheck`: mínimo 12 caracteres (bloquea); avisa (no bloquea) si está en una lista corta de contraseñas comunes incluida en el propio archivo (unas 200, sin dependencia), si repite un carácter o una secuencia, si contiene el correo, su parte local o el nombre del proyecto, o si tiene menos de 3 tipos de carácter y menos de 16 caracteres.
- Reutiliza `b64encode`, `base32Decode` y el alfabeto de `crypto.js`; añade base64url.

**`src/services/keystore.js`** → `Workhub.services.keystore`:

```text
isAvailable()            get(uid, pid) → {key, kid, trusted} | null
put(entry)               forget(uid, pid)
forgetProject(projectId) forgetUser(uid, {keepTrusted})
purgeUntrusted()         onChange(cb)   // BroadcastChannel
```

Todo con `try/catch`: si IndexedDB falla, devuelve `null` y la app pide la contraseña.

### 6.2 Esquema y cifrador del proyecto (PR3)

**`src/models/enc-schema.js`** (antes de `collection-model.js`) → `Workhub.models.EncSchema`: tabla única de campos en claro por colección (5.6), límites de `e` (5.7) y límites de texto en claro (los mismos números que `validData`). Una prueba (`tests/crypto/schema-rules.test.js`) compara esta tabla con la función `encFields` de `firestore.rules`.

**`src/models/project-cipher.js`** → `Workhub.models.ProjectCipher`: objeto ligado a `{pid, kid, key}` y al ámbito:

```text
split(col, data) → {clear, secret}     merge(clear, secret) → objeto plano
seal(path, id, data) → Promise<{...clear, e, ev, kid}>   (valida límites; rechaza gh*)
open(path, id, raw) → Promise<{plain, iv}>               (error 'undecryptable')
sealBytes / openBytes (imágenes)
isSealed(raw) → !!raw.ev
```

### 6.3 `CollectionModel` (`src/models/collection-model.js`, PR3)

- `connect(db, cipher)`: `cipher` es `null` en modo A, local, invitado y claude.ai. **Con `null` el código actual no cambia** (síncrono, `snap.docs.map`), así no se tocan el modo local, la demo (`demo/` usa `TaskModel` con `memoryDb`) ni sus pruebas.
- Con `cipher`:
  - Cola por modelo (`this._queue = this._queue.then(…)`) para procesar las instantáneas **en orden**; cada una lleva la generación (`gen`) y un número de secuencia; si llega una más nueva antes de terminar, el resultado de la vieja se descarta.
  - `snap.docChanges()`: `removed` → borra la caché; `added`/`modified` → si el documento tiene `ev` y `cipher.ivOf(e)` coincide con la caché `this._plain[id].iv`, reutiliza el texto en claro (cambio de campos en claro: mover, reprogramar); si no, `cipher.open()`. Los descifrados se lanzan en paralelo en tandas de 50.
  - `this.items` se reconstruye en el orden de `snap.docs`: `Object.assign({}, camposEnClaro, plain, {id})`.
  - Documento ilegible (AAD, clave o `kid` distintos): `{id, _undecryptable:true, …camposEnClaro}`. Las vistas lo pintan como «No se puede descifrar» y **ninguna escritura lo sustituye** (`update`/`set` lo rechazan con `undecryptable`).
  - Documento sin `ev` en un proyecto B (no debería existir; lo escribiría un cliente antiguo antes de publicar las reglas): se muestra tal cual con `_plainInEncrypted:true` y un aviso en la ficha, y al editarlo se guarda cifrado.
  - `this.loaded = true` tras la primera instantánea procesada (hace falta para filtrar en memoria).
  - Emite `'change'` tras cada instantánea procesada; `'error'` como hoy.
- Escrituras con `cipher`:
  - `add(data)` → `id = this.col.doc().id` y `set(id, data)`; devuelve la referencia (como hoy).
  - `set(id, data)` → `cipher.seal(this.name, id, data)` y `col.doc(id).set(sellado)`.
  - `update(id, patch)`: si `patch` solo toca campos en claro → `update` directo (no reescribe `e`). Si toca campos secretos → texto en claro actual de `this._plain[id]` (si no existe o es ilegible: rechaza `stale`/`undecryptable`) + `patch` → `seal` → `update({...claroDelPatch, e, ev, kid})`. **Caché de escritura inmediata**: `this._plain[id]` se actualiza al momento con el nuevo texto en claro e IV, para que dos cambios seguidos (marcar dos subtareas) no se pisen.
  - Concurrencia entre dispositivos: el blob es un único campo, así que dos cambios simultáneos a campos **secretos distintos** de un mismo documento hacen que gane el último (hoy ganaría por campo). En **equipos B** (donde es probable editar a la vez) los cambios a campos secretos se hacen con `runTransaction` (leer, descifrar, mezclar, cifrar, escribir) cuando hay conexión, y con la caché si no (D10).
  - `idsWhere/updateWhere/removeWhere(field, …)`: si `field` es secreto (p. ej. `cliente`) se filtra en memoria sobre `this.items` (exige `this.loaded`; si no, rechaza `not-ready`) y se escribe de uno en uno con concurrencia 12 (`runPool` sale de `team-model.js` a un `src/utils/pool.js` compartido). Nunca `batch`.
  - `snapshot(ids)` copia el texto en claro; `restore(snap)` pasa por `this.set()` (vuelve a cifrar con IV nuevo). Se comprueba `snap.col === this.col` como hoy.
  - `patchLocal` sin cambios.

### 6.4 Modelos

| Archivo | Cambios |
|---|---|
| `project-model.js` (PR3/PR4) | `static isEncrypted(p)`; `TEAM_PROTECTED` añade `'enc'` (si no, `set()` de un equipo **borraría `enc`** con `FieldValue.delete()`); `save()` conserva `current.enc` como hoy conserva `github` y `labels`; `patch()` ya conserva todo, pero rechaza `github` si hay `enc`; `create()` acepta un id generado antes (`this.col.doc().id`) para escribir primero `crypto/{uid}`; `removeProject()` borra también `crypto` (los propios; en equipos el propietario borra todos) y llama a `keystore.forgetProject(id)`. Nueva `createEncrypted(nombre, color, config, secret)` (orden de escritura en 6.6). |
| `task-model.js` (PR3) | `notes(taskId)` sigue devolviendo la colección, pero `addNote` y `addActivity` pasan por `cipher.seal('tasks/'+taskId+'/notes', …)`; `watchNotes` descifra (cola propia) y entrega objetos con la misma forma que un documento (`{id, data:() => plain}`) para no tocar `TaskDetailView.renderNotes` ni `TaskDialogView.renderNotes`; `withNotes()` descifra; nuevo `addNoteRaw(taskId, data)` para `BackupModel.import`. `toggleCheck`, `saveLinks`, `spawnNext`, `move`, `reschedule` no cambian (decide el modelo base). `saveSynced`/`markSynced` rechazan si el proyecto es B. |
| `client-model.js` (PR6) | `rename` y `removeWithTasks` funcionan sin cambios de firma porque `updateWhere/removeWhere` filtran en memoria con cifrado (6.3). Se añade progreso si hay más de 50 documentos afectados. No hace falta un `clientId` opaco: todo el proyecto está en memoria; queda como mejora si algún día los modelos dejan de cargar la colección entera. |
| `contact-model.js`, `meeting-model.js` (PR3) | Sin cambios de código: `save` usa `add/update/set` del modelo base. |
| `vault-model.js` (PR3) | `saveEntry` usa `set` (cifrado por el modelo base, con `iv/cipher` en claro). `unlockLegacy` lee `this.col.get()` en bruto: en B no puede haber cofres antiguos, se rechaza. `reorder` sin cambios. `setMeta/getMeta` sin cambios. |
| `plugin-model.js` (PR6) | `projectBucket(db, pluginId, cipher)`: `read` descifra si hay `ev`, `write` cifra `values`; cuota 600 KB si hay `cipher`. `set` de instalaciones sin cambios (en claro). |
| `backup-model.js` (PR6) | `build` usa `items` (ya en claro) y `withNotes()`; exportación cifrada para B (11.3). `import` usa `m.tasks.addNoteRaw` en vez de `ref.collection('notes').add`; si el destino es B todo pasa por el modelo. |
| `team-model.js` (PR7) | `convert(project, onProgress, secret)`: si el origen es B, lee con su cifrador y escribe con uno nuevo (DEK, `pid` y `kid` nuevos del equipo; 10.2); `CONFIG_KEYS` no copia `github` si hay `enc`. `invite(project, email, role, {password})`, `accept(invite, {code, password})`, `removeMember` borra `teams/{tid}/crypto/{uid}`. Limpieza de invitaciones caducadas del propietario. |
| `github-sync.js` (PR5) | Ver 9. |
| `src/services/cloud-backup.js` (PR6) | Sin cambios de formato: el JSON ya va cifrado con la clave de copias. Se documenta que `counts` (número de tareas, etc.) y `projectId` van en claro. |
| `src/services/backup-history.js` (PR6) | `save(scope, backup, cipher)`: con `cipher`, guarda `e` en lugar de `json`; `get` descifra. |
| `src/services/firebase-backend.js` (PR0, PR3) | PR0: `IMAGE_MAX_CHARS`. PR3: `window.__assetCipher` en `userAssets` (5.9). PR7: `db.teams.serverTimestamp` y, para D10, `db.teams.runTransaction`. |

### 6.5 Controladores

| Archivo | Cambios |
|---|---|
| `app-controller.js` | `connectProject()`: si el proyecto es B (`ProjectModel.isEncrypted(p)` o `cachedProject().enc`) y no hay clave en memoria ni en `keystore`, **no conecta los modelos de datos** y pide a `ProjectCryptoController` la pantalla de desbloqueo; al desbloquear, crea el `ProjectCipher`, fija `window.__assetCipher` y conecta `PROJECT_MODELS` y `plugins` con él. Si el proyecto aún no está en la lista y el recordado no dice nada, espera a `projects.loaded` antes de conectar (nunca escribir sin saber si el proyecto es B). `rememberProject` guarda `enc:true`. `switchProject` olvida de memoria el cifrador del anterior. |
| **nuevo** `project-crypto-controller.js` (PR4) | Desbloqueo (contraseña, clave de recuperación), creación de proyectos B (pasos 3 y 4 del asistente), ajustes de privacidad del proyecto (cambiar contraseña, nueva clave de recuperación, olvidar en este navegador), reacción a `keystore.onChange`. Expone `cipherFor(projectId)`, `isUnlocked()`, `lock()`. |
| `projects-controller.js` (PR4) | `save()` recibe `privacy` del asistente; si es B delega en `ProjectCryptoController`. `render()` pinta el indicador. `checkFirstRun` sin cambios (el asistente de primer proyecto incluye el paso de privacidad si se decide D2). |
| `github-controller.js` (PR5) | Ver 9. |
| `tasks-controller.js` (PR3) | Muestra `_undecryptable` y `_plainInEncrypted`; `addNote` sin cambios (el modelo cifra; la imagen la cifra `__assetCipher`). |
| `clients-controller.js` (PR6) | Progreso y error («No se pudo cambiar el nombre en todas las tareas: N pendientes») al renombrar/eliminar con filtrado en memoria. |
| `command-controller.js` (PR6) | Con el proyecto bloqueado, solo «Desbloquear proyecto», cambiar de proyecto y las acciones globales (tema, ir a…). Con B desbloqueado, «Bloquear este proyecto». «Sincronizar con GitHub» desaparece sola (`isLinked()` falso en B). La búsqueda usa `withNotes()` ya descifrado. |
| `plugins-controller.js` (PR6) | `projectBucket(this.db(), pluginId, cipher)`; aviso de privacidad en la ficha de instalación y de permisos si el proyecto es B. Los plugins reciben texto en claro (ya hoy, vía modelos). |
| `backup-controller.js` (PR6) | Exportación cifrada por defecto en B y «Exportar sin cifrar» con confirmación; importación de archivos cifrados; `history.save(scope, copy, cipher)`. |
| `team-controller.js` (PR7) | Convertir B (pide la contraseña del proyecto y muestra la clave de recuperación del equipo), invitar con código, aceptar con código. |
| `auth-controller.js` (PR4) | `signOut()` → `keystore.forgetUser(uid, {keepTrusted:true})` antes de `firebase.signOut()`; `onUser(null)` → `keystore.purgeUntrusted()` junto a `clearLocalCache()`. Invitado: nada. |
| `vault-controller.js` | Sin cambios funcionales. En B el cofre sigue pidiendo su contraseña maestra (D11). |

### 6.6 Orden de escritura al crear un proyecto B (PR4)

1. Generar en memoria: `raw` (DEK), `pid`, `kid`, clave de recuperación (ya mostrada y confirmada en el paso 4), id del proyecto (`col.doc().id`).
2. `wrapPassword` + `wrapRecovery` + `kcv`.
3. Escribir `…/crypto/{uid}` (la regla no exige que exista el proyecto).
4. Escribir el documento del proyecto con `enc` (`set`, no `add`).
5. Importar la DEK no extraíble y guardarla en `keystore` (con `trusted`); `raw.fill(0)`.
6. Abrir el proyecto (`switchProject`).

Si falla 3, no hay nada que deshacer. Si falla 4, queda un `crypto/{uid}` huérfano e inofensivo (se intenta borrar). Sin conexión, Firestore encola 3 y 4 y la DEK ya está en el navegador; si el servidor las rechazase después, el proyecto desaparecería de la lista (riesgo bajo, documentado).

### 6.7 Vistas y estilos

| Archivo | Qué |
|---|---|
| **nuevo** `src/views/project-privacy-view.js` (PR4) | Pasos 2–4 del asistente, añadidos a `Workhub.views.ProjectView.prototype` como hace `project-dialog-view.js`. Reutiliza `.type-picker`/`.type-option` (tarjetas de radio ya existentes) con `.is-disabled`. |
| **nuevo** `src/views/project-lock-view.js` (PR4) | Pantalla de desbloqueo en el área de contenido y pantalla de clave de recuperación. Reutiliza `.lock-screen`, `.lock-desc`, `.lock-error`, `.recovery-key-box`, `.recovery-actions`, `.recovery-confirm` del cofre (`assets/css/views/vault.css`). |
| `project-view.js` (PR4) | Icono de candado SVG (trazo, estilo Lucide) junto al nombre en `#btnProject` y en la lista del menú; insignia de texto «Cifrado» en el menú. Sin barras laterales. |
| `project-dialog-view.js` (PR4) | «Siguiente»/«Atrás»; «Desde GitHub» desactivado si en el paso 2 se eligió B; sección «Privacidad» en «Editar proyecto». |
| `github-view.js` (PR5) | Aviso y destino desactivado para proyectos B. |
| `share-view.js` (PR7) | Textos de convertir B, campo de contraseña al invitar, código de acceso, aceptar con código. |
| `task-detail-view.js`, `board-view.js` (PR3) | Estado «No se puede descifrar» (tarjeta con texto gris, sin acciones de edición). |
| **nuevo** `assets/css/views/privacy.css` (PR4) | Pasos del asistente, medidor de contraseña (texto + 4 segmentos planos de `--line` a `--accent`, sin degradados), código de acceso en Geist Mono, responsive hasta 320 px. Cada `color-mix()` con su respaldo plano encima. |
| `app/index.html` | Marcado de los pasos y de la pantalla de desbloqueo (como `#vaultLockScreen`), `<script>`/`<link>` nuevos. |
| `src/i18n/en.js` | Todos los textos del apartado 8, por texto exacto. `node scripts/check-i18n.js --strict` en cada PR. |

---

## 7. Reglas de Firestore

### 7.1 Esbozo (PR2)

Se añaden funciones y cláusulas; **ninguna regla actual se relaja** y todo lo que escribe el código de hoy sigue permitido (por eso se pueden publicar antes del código).

```js
// ---- Cifrado por proyecto ----
function isSealed(d) { return d.get('ev', 0) is int && d.get('ev', 0) >= 1; }

function encFields(col) {
  return col == 'tasks' ? ['status','order','dueDate','repeat','repeatSpawned','createdAt','updatedAt',
                           'assignees','linkedContacts','linkedVault','e','ev','kid']
    : col == 'notes' ? ['createdAt','kind','actorUid','imageAssetId','e','ev','kid']
    : col == 'clients' ? ['color','createdAt','e','ev','kid']
    : col == 'contacts' ? ['createdAt','updatedAt','e','ev','kid']
    : col == 'meetings' ? ['date','createdAt','updatedAt','e','ev','kid']
    : col == 'vault' ? ['order','createdAt','updatedAt','iv','cipher','ivV2','cipherV2','e','ev','kid']
    : col == 'plugin_data' ? ['updatedAt','e','ev','kid']
    : col == 'assets' ? ['createdAt','e','ev','kid']
    : [];
}
function encMax(col) {
  return col == 'tasks' ? 200000 : col == 'notes' ? 100000 : col == 'clients' ? 4000
    : col == 'contacts' ? 50000 : col == 'meetings' ? 100000 : col == 'vault' ? 20000 : 900000;
}
function validSealed(col) {
  let d = request.resource.data;
  return d.ev is int && d.ev >= 1 && d.ev <= 1
    && d.kid is string && d.kid.size() <= 32
    && d.e is string && d.e.size() <= encMax(col)
    && d.keys().hasOnly(encFields(col))
    && listWithin(d, 'assignees', 50)
    && textWithin(d, 'cipher', 900000) && textWithin(d, 'cipherV2', 900000);
}
// Un documento cifrado nunca vuelve a claro ni baja de versión.
function keepsSeal() {
  return resource == null || !isSealed(resource.data)
    || (isSealed(request.resource.data) && request.resource.data.ev >= resource.data.ev);
}
// Escritura de datos: cifrada con su forma, o en claro con la validación de hoy.
function validWrite(col) {
  return keepsSeal() && (isSealed(request.resource.data) ? validSealed(col) : validData(col));
}

// Proyecto cifrado (solo se consulta al CREAR en claro: los sellados no pagan el get()).
function personalEnc(uid, pid) {
  let p = /databases/$(database)/documents/users/$(uid)/projects/$(pid);
  return exists(p) && get(p).data.get('enc', null) != null;
}
function teamEnc(tid) { return team(tid).get('enc', null) != null; }

// Documento del proyecto (personal o equipo).
function validEnc(e) {
  return e is map && e.keys().hasOnly(['v','mode','pid','kid','kcv','createdAt'])
    && e.v == 1 && e.mode == 'pw'                       // 'managed' en PR9
    && e.pid is string && e.pid.size() <= 32
    && e.kid is string && e.kid.size() <= 32
    && e.kcv is string && e.kcv.size() <= 128;
}
function validProjectEnc() {
  let d = request.resource.data;
  let had = resource != null && resource.data.get('enc', null) != null;
  let has = d.get('enc', null) != null;
  return (!has || (validEnc(d.enc) && !('github' in d)))
    && (!had || (has && d.enc == resource.data.enc)                 // inmutable (PR10 permite kid/kcv)
        || (d.get('deleted', false) == true && !has))               // borrar el principal
    && (had || !has || resource == null || resource.data.get('deleted', false) == true); // añadir solo al nacer (PR11 lo amplía)
}

// Envoltorio de la DEK de una persona.
function validCrypto() {
  let d = request.resource.data;
  return d.keys().hasOnly(['v','kid','kdf','pw','rk','createdAt','updatedAt'])
    && d.v == 1 && d.kid is string && d.kid.size() <= 32
    && d.kdf is map && d.kdf.name == 'PBKDF2' && d.kdf.iter is int && d.kdf.iter >= 600000
    && d.kdf.salt is string && d.kdf.salt.size() <= 64
    && d.pw is map && d.pw.iv is string && d.pw.ct is string && d.pw.ct.size() <= 256
    && d.rk is map && d.rk.iv is string && d.rk.ct is string && d.rk.ct.size() <= 256;
}
```

Cambios en los `match` existentes:

```js
match /users/{uid} {
  match /{col}/{docId} {
    allow read: if …igual…;
    allow create: if canUse(uid) && (…igual…) && validWrite(col)
      && (col != 'projects' || validProjectEnc())
      && (!isDataCollection(col) || isSealed(request.resource.data) || !personalEnc(uid, 'main'));
    allow update: if canUse(uid) && (…igual…) && validWrite(col) && (col != 'projects' || validProjectEnc());
    allow delete: …igual…;
  }
  match /tasks/{taskId}/notes/{noteId} {
    allow read, delete: if canUse(uid);
    allow create: if canUse(uid) && validWrite('notes')
      && (isSealed(request.resource.data) || !personalEnc(uid, 'main'));
    allow update: if canUse(uid) && validWrite('notes');
  }
  match /crypto/{who} {                                   // principal
    allow read, delete: if canUse(uid) && who == uid;
    allow create, update: if canUse(uid) && who == uid && validCrypto();
  }
  match /projects/{projectId}/{col}/{docId} {
    allow read, delete: if canUse(uid) && isDataCollection(col);
    allow create: if canUse(uid) && isDataCollection(col) && validWrite(col)
      && (isSealed(request.resource.data) || !personalEnc(uid, projectId));
    allow update: if canUse(uid) && isDataCollection(col) && validWrite(col);
  }
  match /projects/{projectId}/tasks/{taskId}/notes/{noteId} { …como el principal con projectId… }
  match /projects/{projectId}/crypto/{who} {
    allow read, delete: if canUse(uid) && who == uid;
    allow create, update: if canUse(uid) && who == uid && validCrypto();
  }
}
```

La validación de `assets` acepta además la forma sellada (`validWrite('assets')`). La de `projects` sigue igual y se le suma `validProjectEnc()`.

Equipos:

```js
match /teams/{tid} {
  allow create: if …igual… && (request.resource.data.get('enc', null) == null
                    || (validEnc(request.resource.data.enc) && !('github' in request.resource.data)));
  allow update: if verified()
    && request.resource.data.get('enc', null) == resource.data.get('enc', null)   // inmutable
    && !(request.resource.data.get('enc', null) != null && 'github' in request.resource.data)
    && ( …las cuatro ramas de hoy… );
}
match /teams/{tid}/{col}/{docId} {
  allow create: if isTeamCollection(col) && canEdit(tid) && validWrite(col)
    && (isSealed(request.resource.data) || !teamEnc(tid));
  allow update: if isTeamCollection(col) && canEdit(tid) && validWrite(col);
}
match /teams/{tid}/tasks/{taskId}/notes/{noteId} { …igual con validWrite('notes') y teamEnc… }
match /teams/{tid}/crypto/{who} {
  allow read: if who == request.auth.uid && isMember(tid);
  allow create, update: if verified() && who == request.auth.uid && validCrypto()
    && (isMember(tid)
        || request.auth.uid in getAfter(/databases/$(database)/documents/teams/$(tid)).data.memberIds);
  allow delete: if verified() && (who == request.auth.uid || isOwner(tid));
}
```

Invitaciones con código (en PR2 para publicar una sola vez; las usa PR7):

```js
match /invites/{inviteId} {
  // igual que hoy; el documento puede llevar enc:true y expiresAt (timestamp, solo informativo)
  match /key/{k} {
    function inv() { return get(/databases/$(database)/documents/invites/$(inviteId)).data; }
    allow read: if k == 'wrap' && verified() && request.auth.token.email_verified == true
      && inv().email == request.auth.token.email.lower()
      && request.time < resource.data.createdAt + duration.value(24, 'h');   // caducidad forzada al leer
    allow create: if k == 'wrap' && verified()
      && getAfter(/databases/$(database)/documents/invites/$(inviteId)).data.invitedByUid == request.auth.uid
      && isOwner(getAfter(/databases/$(database)/documents/invites/$(inviteId)).data.teamId)
      && request.resource.data.keys().hasOnly(['salt','iter','iv','ct','kid','kcv','createdAt'])
      && request.resource.data.createdAt == request.time                    // hora del servidor
      && request.resource.data.iter is int && request.resource.data.iter >= 100000
      && request.resource.data.ct is string && request.resource.data.ct.size() <= 256;
    allow update: if false;
    allow delete: if verified() && (inv().invitedByUid == request.auth.uid
      || (request.auth.token.email_verified == true && inv().email == request.auth.token.email.lower()));
  }
}
```

Notas sobre las reglas:

- **Por qué la clave de la invitación va en una subcolección**: la lista de invitaciones se pide con una consulta (`where('email', '==', …)`). Firestore exige que las reglas de lectura se cumplan para *cualquier* documento de una consulta y no puede comprobar `request.time < createdAt + 24 h` en una consulta. Separando el envoltorio en `key/wrap`, que se lee con un `get()` suelto, la caducidad se aplica **en la regla de lectura** y no depende de que alguien limpie.
- **`createdAt == request.time`**: la hora la pone el servidor (`FieldValue.serverTimestamp()`), así un reloj del cliente desajustado no cambia la caducidad.
- **Orden de borrado** del propietario al limpiar: primero `key/wrap` y después la invitación (la regla de borrado del envoltorio lee la invitación).
- **Coste de `get()`**: solo las **creaciones en claro** consultan el documento del proyecto (las selladas cortocircuitan). En el principal, crear una tarea en un proyecto A pasará a costar una lectura más (cuota Spark: 50 000 lecturas al día; un uso normal queda muy lejos). **[SIN VERIFICAR]** si `exists()` + `get()` del mismo documento cuentan como uno o dos accesos para el límite de 10.
- **Lotes**: aceptar una invitación cifrada es un lote de 4 operaciones (unirse, `crypto/{uid}`, borrar invitación, borrar envoltorio) con 3–5 accesos en total, por debajo de 20.
- **Clientes antiguos**: un `update` parcial de campos en claro sobre un documento sellado sigue permitido (el documento resultante conserva `e/ev/kid` y cumple `hasOnly`); cualquier escritura con `title`, `desc`, etc. sobre él se rechaza; un `set` sin `ev` se rechaza (`keepsSeal`); crear en claro dentro de un proyecto B se rechaza.

### 7.2 Pruebas nuevas en `tests/rules/rules-test.js` (PR2)

Se mantienen los 70 casos actuales. Nuevos (≈45), agrupados:

1. **Proyecto personal**: crear con `enc` válido; `enc` con `mode:'managed'` (falla); `enc` + `github` (falla); quitar `enc` (falla); cambiar `enc.kid` (falla); añadir `enc` a un proyecto existente (falla); principal `deleted:true` sin `enc` (pasa); recrear el principal borrado con `enc` (pasa).
2. **Datos sellados**: tarea sellada (pasa); sellada con `title` (falla); con `ghItemId` (falla); `e` de 200 001 caracteres (falla); `ev:2` (falla); `ev` no entero (falla); `update` solo de `status/order` sobre sellada (pasa); `update` con `title` sobre sellada (falla); `set` en claro sobre sellada (falla); bajar `ev` (falla); crear en claro en proyecto B (falla); crear en claro en proyecto A (pasa); crear en claro en el principal sin documento `projects/main` (pasa); nota sellada (pasa); nota en claro en proyecto B (falla); imagen sellada (pasa); imagen en claro de 900 001 (falla); cofre sellado con `cipher` (pasa); `plugin_data` sellado (pasa).
3. **`crypto/{uid}`**: el propio (pasa); el de otro uid (falla); leer el de otro (falla); `iter: 300000` (falla); campos de más (falla).
4. **Equipos**: crear equipo con `enc` (pasa); editor cambia `enc` (falla); propietario quita `enc` (falla); `github` en equipo con `enc` (falla); editor crea tarea en claro en equipo B (falla), sellada (pasa); lector escribe su `crypto/{uid}` (pasa); lector escribe el de otro (falla); propietario borra el `crypto` de un miembro (pasa); editor borra el de otro (falla); quien no es miembro lee un `crypto` (falla).
5. **Invitaciones con código**: propietario crea invitación + envoltorio en lote (pasa); envoltorio con `createdAt` del cliente (falla); editor crea envoltorio (falla); destinatario lee el envoltorio (pasa); otra cuenta lo lee (falla); el propio invitador lo lee (falla); destinatario lo lee pasadas 24 h (falla; se prueba escribiendo con `withSecurityRulesDisabled` un `createdAt` de hace 25 h); aceptar en lote de 4 (pasa); `crypto/{uid}` del que entra antes de unirse y fuera del lote (falla); propietario borra envoltorio caducado (pasa); modificar el envoltorio (falla).

El emulador **no aplica el límite de 20 accesos por lote**: se documenta en la prueba y se comprueba a mano en producción (PR7, paso manual).

---

## 8. Interfaz y textos (español → inglés)

Diseño: tipografía Geist (cuerpo) y Geist Mono (claves y códigos), tokens de `tokens.css`, tarjetas planas con borde fino de `--line`, selección con `--accent-soft` + borde de acento completo (como `.type-option.is-selected`), **sin rayas laterales, sin degradados, sin emojis**, iconos SVG de trazo. Responsive: en ≤ 600 px las tarjetas van en una columna y los botones del pie ocupan el ancho. Los estados de espera usan el esqueleto `.sk`.

### 8.1 Asistente «Nuevo proyecto»

Paso 1 (ya existe): nombre, color, tipo (incluido «Desde GitHub»). El botón principal pasa a ser **«Siguiente»** al crear (al editar sigue siendo «Guardar»).

Paso 2, **Privacidad**:

| Elemento | Español | English |
|---|---|---|
| Título | Privacidad del proyecto | Project privacy |
| Entradilla | Elige cómo se protege lo que guardes en este proyecto. Más adelante no se podrá cambiar. | Choose how what you store in this project is protected. You won't be able to change it later. |
| Tarjeta A, nombre | Solo contraseñas | Passwords only |
| Tarjeta A, texto | Las credenciales del cofre se cifran con tu contraseña maestra. El resto del proyecto (tareas, notas, clientes, contactos, reuniones e imágenes) se guarda sin cifrado de extremo a extremo: Kanlane podría leerlo. Si olvidas una contraseña, no pierdes el proyecto. | Vault credentials are encrypted with your master password. The rest of the project (tasks, notes, clients, contacts, meetings and images) is stored without end-to-end encryption: Kanlane could read it. If you forget a password, you don't lose the project. |
| Tarjeta A, chips | Compatible con GitHub · Sin contraseña extra | Works with GitHub · No extra password |
| Tarjeta B, nombre | Cifrado total | Full encryption |
| Tarjeta B, texto | Todo el contenido del proyecto se cifra en tu navegador con una contraseña que solo tú conoces. Kanlane no la tiene y no puede leer el contenido. Si pierdes la contraseña y la clave de recuperación, el proyecto no se puede recuperar. | All project content is encrypted in your browser with a password only you know. Kanlane doesn't have it and can't read the content. If you lose both the password and the recovery key, the project can't be recovered. |
| Tarjeta B, chips | Contraseña del proyecto · Sin GitHub | Project password · No GitHub |
| Tarjeta B, nota visible | No se cifran el nombre del proyecto, las columnas, las etiquetas, las fechas ni el estado de las tareas. | The project name, columns, labels, dates and task status are not encrypted. |
| Tarjeta B desactivada por GitHub | No disponible con «Desde GitHub»: lo que se sincroniza tiene que llegar a GitHub sin cifrar. | Not available with "From GitHub": anything synced has to reach GitHub unencrypted. |
| Tarjeta C, nombre | Gestionado por Kanlane | Managed by Kanlane |
| Tarjeta C, chip | Próximamente | Coming soon |
| Tarjeta C, texto | Cifrado sin contraseña extra: Kanlane guarda la clave en su servidor y se la da a tu cuenta al entrar. Es lo más cómodo y protege si alguien copia la base de datos, pero Kanlane podría técnicamente descifrar el proyecto. | Encryption without an extra password: Kanlane keeps the key on its server and gives it to your account when you sign in. It's the most convenient option and protects you if someone copies the database, but Kanlane could technically decrypt the project. |
| «Desde GitHub» desactivado en el paso 1 si se eligió B y se vuelve atrás | No se puede sincronizar con GitHub un proyecto con cifrado total. | A fully encrypted project can't be synced with GitHub. |
| Botones | Atrás · Siguiente · Crear proyecto | Back · Next · Create project |

En el modo local, invitado y claude.ai el paso 2 no se muestra: el asistente crea directamente un proyecto A, como hoy (decisión 6 del dueño).

Paso 3, **Contraseña de cifrado** (solo B):

| Elemento | Español | English |
|---|---|---|
| Título | Contraseña de cifrado | Encryption password |
| Entradilla | Con ella se cifra el proyecto en tu navegador. Kanlane no la guarda ni puede recuperarla. Usa una distinta de la del cofre de contraseñas y de la de tu cuenta. | It encrypts the project in your browser. Kanlane doesn't store it and can't recover it. Use a different one from your vault password and your account password. |
| Campo 1 | Contraseña de cifrado | Encryption password |
| Campo 2 | Repite la contraseña | Repeat the password |
| Ayuda | Mínimo 12 caracteres. Mejor una frase de varias palabras. | At least 12 characters. A phrase of several words is better. |
| Medidor | Demasiado corta: mínimo 12 caracteres. / Débil: es muy común o fácil de adivinar. / Débil: contiene tu correo o el nombre del proyecto. / Aceptable / Buena | Too short: at least 12 characters. / Weak: it's very common or easy to guess. / Weak: it contains your email or the project name. / Fair / Good |
| Error | Las contraseñas no coinciden. | The passwords don't match. |
| Casilla | Este dispositivo es de confianza | This device is trusted |
| Ayuda casilla | La clave se queda en este navegador también al cerrar sesión. No lo marques en un ordenador compartido. | The key stays in this browser even after you sign out. Don't tick it on a shared computer. |
| Espera | Preparando el cifrado… | Preparing encryption… |

Paso 4, **Clave de recuperación** (se muestra **antes** de escribir nada; ver D12):

| Elemento | Español | English |
|---|---|---|
| Título | Guarda tu clave de recuperación | Save your recovery key |
| Entradilla | Es la única forma de abrir este proyecto si olvidas la contraseña. Kanlane no puede restablecerla ni enviártela por correo. Guárdala fuera de Kanlane: en un gestor de contraseñas o en papel. | It's the only way to open this project if you forget the password. Kanlane can't reset it or email it to you. Keep it outside Kanlane: in a password manager or on paper. |
| Botones | Copiar · Descargar .txt | Copy · Download .txt |
| Aviso | Si pierdes la contraseña y esta clave, perderás el proyecto y tendrás que crear otro. | If you lose the password and this key, you'll lose the project and will have to create a new one. |
| Casilla (obligatoria) | La he guardado en un lugar seguro | I've saved it somewhere safe |
| Botón | Crear proyecto cifrado | Create encrypted project |
| Éxito (aviso importante) | Proyecto «{nombre}» creado con cifrado total | Project "{name}" created with full encryption |

Contenido del `.txt` (`kanlane-clave-recuperacion-{slug}.txt`; en inglés `kanlane-recovery-key-{slug}.txt`):

```
Kanlane · Clave de recuperación de un proyecto con cifrado total

Proyecto: {nombre}
Cuenta: {correo}
Creada: {fecha y hora}

Clave de recuperación:
XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX

Sirve para abrir este proyecto si olvidas su contraseña de cifrado.
Kanlane no tiene una copia y no puede recuperarla.
Guárdala fuera de Kanlane y no la compartas.
```

### 8.2 Pantalla de desbloqueo (área de contenido, como la del cofre)

| Elemento | Español | English |
|---|---|---|
| Título | Proyecto cifrado | Encrypted project |
| Texto | Escribe la contraseña de cifrado de «{nombre}». Solo se usa en tu navegador. | Enter the encryption password for "{name}". It's only used in your browser. |
| Campo / botón | Contraseña de cifrado · Desbloquear | Encryption password · Unlock |
| Casilla | Este dispositivo es de confianza | This device is trusted |
| Enlace | He olvidado la contraseña | I forgot the password |
| Recuperar: campos | Clave de recuperación · Nueva contraseña de cifrado · Repite la contraseña | Recovery key · New encryption password · Repeat the password |
| Recuperar: botón | Recuperar el acceso | Recover access |
| Recuperar: después | Se muestra una clave de recuperación nueva (paso 4) y la anterior deja de valer. | A new recovery key is shown (step 4) and the old one stops working. |
| Errores | Contraseña incorrecta. / La clave de recuperación no es correcta. / No se pudo leer la clave del proyecto. Comprueba la conexión e inténtalo de nuevo. / Tu cuenta no tiene acceso a la clave de este proyecto. Pide al propietario un código de acceso nuevo. | Wrong password. / The recovery key isn't correct. / The project key couldn't be read. Check your connection and try again. / Your account doesn't have access to this project's key. Ask the owner for a new access code. |
| Espera | Comprobando la contraseña… | Checking the password… |
| Documento ilegible (tarjeta/ficha) | No se puede descifrar | Can't be decrypted |
| Documento en claro dentro de B (ficha) | Esta tarea se guardó sin cifrar. Se cifrará al guardarla. | This task was saved unencrypted. It will be encrypted when you save it. |
| Cliente de PR3 sin la interfaz de PR4 y sin clave | Este proyecto está cifrado. Actualiza Kanlane para abrirlo. | This project is encrypted. Update Kanlane to open it. |

### 8.3 Indicador y ajustes del proyecto

- Candado SVG de 14 px junto al nombre en el selector y en la lista; `title`/`aria-label`: **«Cifrado total: el contenido se cifra en tu navegador»** / *"Full encryption: content is encrypted in your browser"*. Insignia en el menú: **«Cifrado»** / *"Encrypted"* (texto `--ink-soft`, borde fino; sin fondo de color).
- «Editar proyecto» → sección **«Privacidad»**:
  - A: «Solo contraseñas. El contenido del proyecto no tiene cifrado de extremo a extremo.» / *"Passwords only. Project content has no end-to-end encryption."* (PR11 añade «Cifrar este proyecto».)
  - B: «Cifrado total.» / *"Full encryption."* + botones «Cambiar la contraseña de cifrado» / *"Change encryption password"*, «Crear una clave de recuperación nueva» / *"Create a new recovery key"* (ambos piden la contraseña actual), «Olvidar la clave en este navegador» / *"Forget the key on this browser"* (ayuda: «Tendrás que escribir la contraseña la próxima vez.» / *"You'll need to enter the password next time."*).
- `Ctrl K`: «Desbloquear proyecto» / *"Unlock project"*, «Bloquear este proyecto» / *"Lock this project"*.

### 8.4 GitHub (PR0 y PR5)

| Dónde | Español | English |
|---|---|---|
| Ajustes → GitHub Projects con un proyecto B abierto | Este proyecto tiene cifrado total y no se puede enlazar con GitHub: GitHub necesita recibir las tareas sin cifrar. Para sincronizar, usa un proyecto con «Solo contraseñas». | This project has full encryption and can't be linked to GitHub: GitHub needs to receive tasks unencrypted. To sync, use a project with "Passwords only". |
| Opción desactivada en el selector de destino | {nombre} (cifrado total, no admite GitHub) | {name} (full encryption, GitHub not available) |
| Antes de conectar un proyecto A (PR0) | Al sincronizar, el título, la descripción, la columna y las etiquetas de las tareas se envían a GitHub sin cifrar y se quedan allí aunque desvincules el proyecto. | When syncing, task titles, descriptions, columns and labels are sent to GitHub unencrypted and stay there even if you unlink the project. |
| Error del motor (`GithubError('encrypted')`) | Los proyectos con cifrado total no se pueden sincronizar con GitHub. | Fully encrypted projects can't be synced with GitHub. |
| PR11, cifrar un proyecto enlazado | Para cifrar este proyecto primero hay que desvincularlo de GitHub. Lo que ya se envió (títulos, descripciones, columnas y etiquetas) seguirá en GitHub: bórralo allí si no quieres que esté. | To encrypt this project you first need to unlink it from GitHub. What was already sent (titles, descriptions, columns and labels) will stay on GitHub: delete it there if you don't want it there. |

### 8.5 Compartir con código (PR7)

| Elemento | Español | English |
|---|---|---|
| Convertir un B en equipo (punto de la lista) | El equipo tendrá su propia clave. A cada persona que invites le darás un código de acceso de un solo uso por otro canal (en persona, por mensaje…). Caduca en 24 horas. | The team will have its own key. You'll give each person you invite a single-use access code through another channel (in person, by message…). It expires in 24 hours. |
| Convertir: campo | Contraseña de cifrado del proyecto | Project encryption password |
| Invitar (equipo B): campo extra | Tu contraseña de cifrado | Your encryption password |
| Código, título | Código de acceso para {correo} | Access code for {email} |
| Código, texto | Dáselo por un canal distinto del correo de la invitación. Solo sirve una vez, caduca en 24 horas y no se vuelve a mostrar. | Give it through a different channel from the invitation email. It only works once, expires in 24 hours and won't be shown again. |
| Código, botones | Copiar código · Hecho | Copy code · Done |
| Invitación cifrada en el menú (insignia) | Cifrado | Encrypted |
| Aceptar, título | Unirte a «{equipo}» | Join "{team}" |
| Aceptar, texto | Este proyecto tiene cifrado total. Escribe el código de acceso que te ha dado {nombre} y elige tu propia contraseña de cifrado para este proyecto. | This project has full encryption. Enter the access code {name} gave you and choose your own encryption password for this project. |
| Aceptar, campos | Código de acceso · Tu contraseña de cifrado · Repite la contraseña | Access code · Your encryption password · Repeat the password |
| Errores | El código no es correcto. / El código ha caducado. Pide a {nombre} que te invite de nuevo. | The code isn't correct. / The code has expired. Ask {name} to invite you again. |
| Expulsar (confirmación en equipos B) | {nombre} dejará de poder abrir el proyecto, pero lo que ya haya visto o descargado no se le puede quitar. | {name} will no longer be able to open the project, but what they've already seen or downloaded can't be taken back. |

### 8.6 Plugins, exportar y copias (PR6)

| Elemento | Español | English |
|---|---|---|
| Ficha de instalación/permisos en B | Este proyecto tiene cifrado total. El plugin recibirá sin cifrar los datos a los que le des permiso, y lo que guarde en el almacenamiento de tu cuenta no se cifra. | This project has full encryption. The plugin will receive unencrypted the data you give it access to, and what it stores in your account storage isn't encrypted. |
| Exportar en B, botón principal | Exportar copia cifrada | Export encrypted backup |
| Ayuda | Para importarla hará falta la contraseña de cifrado o la clave de recuperación de este proyecto. | Importing it will require this project's encryption password or recovery key. |
| Secundario | Exportar sin cifrar | Export unencrypted |
| Confirmación | El archivo tendrá todo el proyecto sin cifrar. Guárdalo en un lugar seguro y bórralo cuando no lo necesites. | The file will contain the whole project unencrypted. Keep it somewhere safe and delete it when you no longer need it. |
| Importar un archivo cifrado | Esta copia está cifrada. Escribe la contraseña de cifrado o la clave de recuperación del proyecto del que salió. | This backup is encrypted. Enter the encryption password or recovery key of the project it came from. |

---

## 9. GitHub: bloqueo en el motor, no solo en la interfaz (PR5)

`src/models/github-sync.js`:

- `config()`: si el proyecto abierto es B devuelve `null` aunque tuviese `github` (no debería: lo impiden las reglas). Con eso `isLinked()` es falso y se apagan solos `schedule()` (temporizador de 2 min), `waitAndSync()`, `queuePush()`, el `visibilitychange`, el `online` y la acción de `Ctrl K`.
- `sync()`: primera línea, si el proyecto (`this.app.controllers.projects.current()`) es B → `this.error = new api.GithubError('encrypted', …)` y `return Promise.resolve(null)`. Doble protección por si algo llama directamente.
- `link(opts)`: antes de llamar a la API, si `target` es un proyecto B → rechaza con `GithubError('encrypted')`. `NEW` crea siempre un proyecto A.
- `setPushNew`, `ignore`, `_loadRepoLabels` (escriben en el proyecto): no hacen nada si es B.
- `TaskModel.saveSynced/markSynced`: rechazan si el cifrador está activo (no hay campos `gh*` en B; las reglas también los rechazan).

`src/controllers/github-controller.js`: `connect`, `createFromGithub`, `syncNow`, `connectOAuth` y `saveToken` comprueban B y muestran el texto de 8.4; `render()` pasa `encrypted` por proyecto a la vista; `onProjectChange()` limpia el error `encrypted`.

`ProjectModel.patch/save`: rechazan `github` si hay `enc` (`Error('encrypted-github')`).

Reglas: `enc` y `github` no pueden convivir en el mismo documento (7.1).

Asistente: «Desde GitHub» en el paso 1 desactiva la tarjeta B del paso 2, y viceversa (8.1).

PR11: cifrar un proyecto enlazado exige desvincular antes (`GithubSync.unlink`), con el aviso de que lo enviado sigue en GitHub.

---

## 10. Compartir un proyecto B (equipos, PR7)

### 10.1 Situación actual

Compartir = convertir un personal en equipo (`TeamModel.convert`) y después invitar por correo. El cofre no existe en equipos (reglas y `TEAM_DATA_COLLECTIONS`), y al convertir no se copian las credenciales.

### 10.2 Convertir un B personal en equipo

1. Requiere el proyecto desbloqueado y **pedir la contraseña de cifrado** (verifica y permite reenvolver).
2. Se generan una DEK, un `pid` y un `kid` **nuevos** para el equipo (separación limpia: lo que se edite después en el original no se puede leer con la clave del equipo) y una clave de recuperación nueva (pantalla del paso 4).
3. Se crea `teams/{tid}` con `enc`, después `teams/{tid}/crypto/{uid}` (envuelta con la misma contraseña), después se copia de una en una (`runPool`, 12) leyendo con el cifrador del original y escribiendo con el del equipo; `linkedVault` se quita como hoy (ya en claro tras descifrar); imágenes descifradas y vueltas a cifrar.
4. Si falla, se deshace como hoy (`removeProject` del equipo a medias) y `err.phase` dice el paso.

### 10.3 Invitar

1. El propietario escribe correo, rol y **su contraseña de cifrado** (motivo técnico: la DEK guardada en el navegador no es extraíble, así que para envolverla con el código hay que volver a abrirla con la contraseña; además confirma que es él; ver D13).
2. Se genera el código (100 bits), se envuelve la DEK y se escribe en un lote: `invites/{tid}_{correo}` (con `enc:true`, `expiresAt` orientativo) + `invites/{…}/key/wrap` (`createdAt: serverTimestamp()`, `kid`, `kcv`).
3. Se muestra el código **una sola vez** (8.5). No se guarda en ningún sitio.

### 10.4 Aceptar

1. El invitado ve la invitación con la insignia «Cifrado» y pulsa «Aceptar» → diálogo con código + contraseña nueva.
2. `get` de `key/wrap` (si la regla lo deniega y `expiresAt` ya pasó → «El código ha caducado»).
3. `unwrapCode` (extraíble en memoria) → `checkKcv` → `wrapPassword` + `wrapRecovery` con su propia contraseña → pantalla de su clave de recuperación (confirmación obligatoria).
4. Guarda la DEK no extraíble en su `keystore` **antes** de escribir nada (si el lote falla no se pierde).
5. Lote de 4: unirse al equipo, `teams/{tid}/crypto/{uid}`, borrar la invitación, borrar el envoltorio.
6. Abre el proyecto.

Roles: sin cambios (los aplican las reglas). Un lector también recibe la DEK (la necesita para leer) y no puede escribir datos.

### 10.5 Por qué no hay «rate limiting» que poner

Descifrar con el código se hace en el navegador del invitado: no hay ningún servicio al que preguntar «¿es este el código?». Un atacante necesitaría leer `key/wrap`, que solo puede leer el destinatario y solo durante 24 horas; aun con el documento en la mano (por ejemplo, Kanlane desde la consola), 100 bits + PBKDF2 100 000 hacen inviable probarlos todos. La limitación efectiva es: entropía, caducidad forzada por reglas, un solo uso (se borra al aceptar) y lectura restringida al destinatario.

### 10.6 Limpieza de invitaciones caducadas

Al abrir la app, el propietario (que ya escucha `invitesFrom(tid)` en `TeamModel.watchSent`) borra las que tengan `expiresAt` pasado: primero `key/wrap`, después la invitación. Como la caducidad ya la impone la regla de lectura, la limpieza es solo orden.

### 10.7 Expulsar

`removeMember` + borrar `teams/{tid}/crypto/{uid}`. Riesgo mientras no exista PR10: la persona expulsada no puede leer nada nuevo del servidor (reglas), pero conserva lo ya descifrado y pudo copiar la DEK al aceptar; si además consiguiese los datos cifrados (por ejemplo, con ayuda de alguien con acceso a la base), podría leerlos. Se muestra en la confirmación (8.5) y en `docs/EQUIPOS.md`.

### 10.8 El cofre en equipos cifrados

Hoy no hay cofre en equipos y se mantiene igual en los equipos B: al convertir no se copian las credenciales y la pestaña Contraseñas sigue oculta (`body.team-project`). **Decisión pendiente (D11b)**. Observación para cuando se diseñe: en un equipo B ya existe una clave compartida por todos los miembros, así que un cofre compartido podría cifrarse con la DEK del proyecto (más, si se quiere, la contraseña del cofre), sin el par de claves por persona que propone `docs/EQUIPOS.md`. Necesitaría la rotación de PR10 para expulsar de verdad.

---

## 11. Plugins, copias y exportación

### 11.1 Plugins

- Siguen en su `<iframe sandbox>` sin acceso a la clave; reciben texto en claro de los modelos según sus permisos (como hoy). Aviso en la instalación y en la ficha de permisos si el proyecto es B (8.6).
- `wh.storage` (por proyecto) se cifra (`plugin_data/{id}` → `e`); cuota 600 KB en B.
- `wh.storage.user` (de la cuenta, `settings/plugin-user:{id}`) **no se cifra**: se avisa. Los plugins oficiales que lo usaban (Smart GP, Apariencia) ya migraron a `wh.storage` por proyecto.

### 11.2 Copias en la nube

Sin cambios de formato: el JSON se cifra con la clave de copias de la cuenta (`localStorage`, 256 bits), que el servidor no tiene. Quedan en claro `projectId`, `createdAt`, `counts` (cuántas tareas, contactos…). Se documenta.

### 11.3 Exportar e importar (recomendación D14)

- **Exportar en B, por defecto cifrado**: archivo `kanlane-copia-cifrada-{slug}-{fecha}.json` con `{format:'kanlane-encrypted-backup', v:1, pid, kid, kcv, kdf, pw, rk, iv, data}` donde `kdf/pw/rk` son los envoltorios de `crypto/{uid}` (ya publicables: están protegidos por la KDF) y `data` es el JSON de siempre cifrado con la DEK (AAD `kanlane/v1|pid|kid|export|{fecha}|1`). Es autosuficiente: se abre con la contraseña o la clave de recuperación vigentes al exportar.
- «Exportar sin cifrar» con confirmación (8.6): el formato actual.
- Importar: si el archivo es cifrado, se pide contraseña o clave de recuperación; después se importa por los modelos (en un destino B se vuelve a cifrar con la clave del destino; en un destino A se avisa de que el contenido quedará sin cifrado de extremo a extremo).
- Las versiones locales (`backup-history`) van cifradas con la DEK (5.8).

---

## 12. Modo gestionado (C, PR9)

- **Worker** (`worker/index.js`, el mismo `workhub`): ruta nueva `POST /__/kms/v1/kek` (mismo origen: no hay que tocar `connect-src`; añadirla a `run_worker_first` en `wrangler.jsonc`).
- **Autenticación**: `Authorization: Bearer <ID token de Firebase>`. El Worker verifica el JWT RS256 con las claves públicas de `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com` (cacheadas según `Cache-Control`), `iss = https://securetoken.google.com/workhub-26f50`, `aud = workhub-26f50`, `exp`, `iat`, `auth_time`, `sub` no vacío, y `email_verified` si el proveedor es `password`. Sin SDK de administración ni cuenta de servicio, así que **no hace falta Blaze**.
- **Autorización en equipos**: el Worker pide `GET https://firestore.googleapis.com/v1/projects/workhub-26f50/databases/(default)/documents/teams/{tid}` **con el mismo token del usuario**: si las reglas le dejan leer el equipo, es miembro. Sin credenciales propias.
- **Derivación**: `KEK_kms = HKDF-SHA256(IKM = KMS_MASTER_V{n}, salt = "kanlane-kms-v1", info = "{ámbito}|{pid}|{kid}")`, con `ámbito` = `u:{uid}` (personal) o `t:{tid}` (equipo). La DEK sigue siendo **aleatoria** y se envuelve con `KEK_kms` (en `crypto/{uid}.kms` o en un único `teams/{tid}/crypto/_kms`; D18). El Worker devuelve la KEK por HTTPS; el cliente desenvuelve y guarda la DEK no extraíble como en B.
- **Secreto**: `npx wrangler secret put KMS_MASTER_V1` **[MANUAL]**, 32 bytes aleatorios en base64. **Riesgo principal: perder el secreto = perder todos los proyectos C.** Mitigaciones: el dueño guarda una copia fuera de Cloudflare (gestor de contraseñas + papel en un lugar seguro) **antes** de activar la tarjeta; versión en el nombre (`KMS_MASTER_V1`, `kmsv` en el documento) para poder rotar reenvolviendo; opción de que el usuario genere además una clave de recuperación propia (recomendado: sí, opcional).
- **Límite**: `AUTH_RATE_LIMIT` existente o uno nuevo (p. ej. 60/min por uid). Workers gratis: 100 000 peticiones/día; con la DEK guardada en el navegador se llama una vez por dispositivo y proyecto.
- **Reglas**: `enc.mode in ['pw','managed']` y `validCrypto` acepta `kms` → **[MANUAL] publicar reglas** antes de desplegar PR9.
- **Textos**: honestos (8.1, tarjeta C); política de privacidad: Cloudflare pasa a custodiar material de claves.

---

## 13. Rotación, expulsión y conversión

### 13.1 PR10: rotación de la DEK

- **Problema de fondo**: con envoltorios por contraseña, el propietario no puede repartir una DEK nueva a los demás miembros (no conoce sus contraseñas). Opciones:
  1. **Par de claves ECDH P-256 por miembro** (recomendado, D9): al aceptar (PR7) cada miembro genera un par, publica la pública en su `crypto/{uid}` y guarda la privada envuelta con su KEK_pw. Al rotar, el propietario envuelve la DEK nueva para cada pública. Hay que **confiar en que el servidor entrega las públicas correctas**; se mitiga mostrando la huella de cada miembro para compararla por otro canal. Si se decide, PR7 ya debería generar el par para no tener que reinvitar a nadie.
  2. Reinvitar a los que quedan con códigos nuevos (sin cambios de esquema, molesto).
- **Proceso**: `kid2` nuevo; cada documento lleva su `kid`, así que conviven `kid1` y `kid2` mientras se recifra de uno en uno (12 a la vez, sin lotes); el cliente guarda ambas claves hasta terminar; al acabar, `enc.kid/kcv` = `kid2` (las reglas de PR10 permiten cambiar solo `kid` y `kcv` al propietario). Se puede reanudar si se corta.
- **[MANUAL] publicar reglas** de PR10.

### 13.2 PR11: convertir un proyecto A existente en B

- Requiere: no estar enlazado con GitHub (8.4), ser propietario, conexión.
- Proceso: crear claves y `crypto/{uid}`; escribir `enc` con `state:'converting'` (las reglas de PR11 permiten añadir `enc` a un proyecto existente y, durante la conversión, que convivan documentos en claro y sellados); recifrar todo de uno en uno (reanudable); `state:'done'`. Mientras tanto otras pestañas ven el proyecto en modo solo lectura.
- **Advertencia obligatoria**: lo que estuvo en claro puede seguir en copias de seguridad de Google, en exportaciones y copias locales anteriores y en GitHub si estuvo enlazado. Convertir protege lo que viene, no borra el pasado.
- **[MANUAL] publicar reglas** de PR11.

---

## 14. Estrategia de pruebas

### 14.1 Unitarias (Node, sin navegador)

Node 20 tiene `globalThis.crypto.subtle`, así que el servicio se prueba con Web Crypto real cargando el archivo con `vm` (como `tests/vault/vault.test.js`).

`tests/crypto/project-crypto.test.js` (PR1):

- Ida y vuelta de `seal/open` con texto español, emojis, 20 000 caracteres y objetos anidados.
- **AAD manipulada**: cambiar `pid`, `kid`, `path`, `id` o `ev` hace fallar `open`.
- Blob manipulado (un bit del texto cifrado o de la etiqueta) falla.
- **kcv**: correcto con la DEK buena; falso con otra DEK o con otro `kid`.
- **IV único**: 10 000 `seal` del mismo objeto → 10 000 IV distintos y blobs distintos; `ivOf(e)` coincide con los 12 primeros bytes.
- `wrapPassword/unwrapPassword`: correcta abre; incorrecta → `bad-password`; documento de otro `uid`/`pid` → falla; `iter` se respeta.
- Recuperación: formato `XXXX-…` de 8 grupos; `parseRecoveryKey` tolera minúsculas, espacios, `O/I/L`; clave errónea → `bad-recovery`.
- Código de acceso: 20 caracteres, alfabeto correcto; `unwrapCode` con un carácter cambiado falla.
- `unwrapKey(…, extractable:false)` → `crypto.subtle.exportKey` lanza.
- `passwordCheck`: 11 caracteres bloquea; lista común avisa; contiene el correo avisa; frase larga «Buena».
- No se usa `Math.random` (búsqueda en el código fuente dentro de la prueba).

`tests/crypto/schema-rules.test.js` (PR3): `EncSchema` coincide con `encFields`/`encMax` de `firestore.rules`.

`tests/assets/limits.test.js` (PR0): `IMAGE_MAX_CHARS` ≤ el límite de `assets` en las reglas, para la forma en claro y la sellada.

### 14.2 Modelos (Node con almacén simulado)

`tests/crypto/collection-model.test.js` (PR3), con un Firestore en memoria que imita `onSnapshot`/`docChanges`:

- A (sin cifrador) se comporta igual que hoy (mismas `items`, mismo orden).
- B: `add` → el documento guardado no contiene `title`; `items` sí.
- Mover (`update` de `status/order`) no reescribe `e` ni descifra de nuevo (contador de `open`).
- Dos `toggleCheck` seguidos conservan las dos marcas (caché de escritura).
- Instantáneas que se solapan durante el descifrado: gana la última.
- Cambio de proyecto a mitad de descifrado: no se emite nada de la generación vieja.
- Documento ilegible → `_undecryptable`; `update/set` sobre él rechazan.
- `updateWhere('cliente')` filtra en memoria y escribe uno a uno; con `loaded` falso rechaza.
- `restore` vuelve a cifrar con IV nuevo.
- `watchNotes` entrega `{id, data()}` descifrados en orden de `createdAt`.
- `ProjectModel.save` de un equipo **no** borra `enc`; de un personal lo conserva.
- `GithubSync.sync/link` con proyecto B → rechazo, sin llamadas a la API (fetch simulado que falla si se llama).
- `BackupModel.import` en B: notas cifradas; exportación cifrada → importación → mismo contenido.

### 14.3 Reglas (emulador)

`npm test --prefix tests/rules` con los casos de 7.2 (PR2) y los de PR9, PR10 y PR11 cuando lleguen.

### 14.4 Extremo a extremo (navegador)

- `tests/e2e/crypto-smoke.js` con emuladores de Auth y Firestore (misma receta que `cloud-smoke.js`), Chromium en la CI y **Edge en local** (`channel: 'msedge'` de Playwright en Windows):
  1. Cuenta verificada → asistente → B → contraseña débil avisa → clave de recuperación → descarga del `.txt` (se comprueba el contenido) → proyecto creado.
  2. Crear tarea con nota e imagen → leer Firestore por REST del emulador: **ningún** título, descripción, nota ni byte JPEG en claro; `e/ev/kid` presentes.
  3. Recargar: no pide contraseña. Cerrar sesión sin «confianza» y volver: la pide. Con «confianza»: no.
  4. Otro contexto (navegador nuevo) → contraseña errónea → correcta → mismos datos.
  5. Recuperación con la clave → contraseña nueva → clave nueva → la vieja ya no sirve.
  6. GitHub: «Desde GitHub» desactiva B; ajustes de GitHub con B abierto muestran el aviso; `sync()` no llama a `api.github.com`.
  7. (PR7) Convertir a equipo, invitar con código, aceptar con otra cuenta (dos orígenes `localhost`/`127.0.0.1`), lector no escribe, código erróneo, código caducado (documento con `createdAt` antiguo), expulsar.
- Móvil: 375×812 y 320×640 en cada pantalla nueva; sin scroll horizontal; claro y oscuro; sin errores en consola.
- Rendimiento: tablero de 2 000 tareas cifradas → tiempo hasta pintar (objetivo < 1,5 s en portátil **[SIN VERIFICAR en móvil]**).

### 14.5 Matriz de casos peligrosos

| Caso | Qué debe pasar | Cómo se prueba |
|---|---|---|
| Cliente antiguo (antes de PR3) abre un proyecto B | Ve tarjetas vacías; mover funciona; editar el texto, crear o `set()` falla con error visible; nunca escribe en claro | Reglas (7.2) + e2e cargando la app de `main` antigua contra el emulador |
| Cliente de PR3 sin la UI de PR4 | Muestra la pantalla «Proyecto cifrado» (sin crear) y desbloquea si hay clave | e2e |
| Dos pestañas: una desbloquea | La otra se desbloquea sola (`BroadcastChannel`) | e2e con dos páginas del mismo contexto |
| Dos pestañas editan la misma tarea (campos secretos distintos) | Personal: gana la última escritura (documentado). Equipo: transacción, no se pierde ninguno | modelo + e2e |
| Carrera al crear un proyecto B y cerrar la pestaña entre pasos | `crypto` huérfano o proyecto sin abrir; nunca un proyecto sin `crypto` | prueba de modelo con fallos inyectados en cada paso |
| Sin conexión: crear tarea en B | Se cifra y se encola; aparece al instante | e2e con `context.setOffline(true)` |
| Sin conexión: desbloquear en un navegador que ya tenía la caché | Funciona si `crypto/{uid}` está en caché; si no, mensaje de conexión | e2e |
| Caché de IndexedDB borrada (datos del sitio) | Pide la contraseña; nada se corrompe | e2e borrando `workhub-keys` |
| Cierre de sesión con y sin «confianza» | Sin: se borra la clave. Con: se conserva | e2e |
| Sesión caducada (sin pasar por `signOut`) | `purgeUntrusted` al arrancar sin sesión | e2e simulando `onAuthStateChanged(null)` |
| Contraseña errónea repetida | Mensaje; sin bloqueo (no hay servidor); sin pistas | e2e |
| Invitación caducada | Regla deniega; mensaje «ha caducado»; el propietario la limpia | reglas + e2e |
| Código usado dos veces | La segunda vez el envoltorio ya no existe | reglas + e2e |
| Lote de aceptar con > 20 accesos | No ocurre (4 operaciones); se verifica en producción | **[MANUAL]** prueba con cuentas reales tras PR7 |
| Documento con `kid` de una clave rotada (PR10) | Se descifra con la clave vieja mientras dure la rotación | modelo |
| `ProjectModel.set()` de equipo sin `enc` | No borra `enc` (y si lo hiciese, las reglas lo rechazan) | modelo + reglas |
| Imagen de 880 000 caracteres | Se guarda en A y en B | e2e con imagen generada en canvas |
| Plugin intenta escribir 700 KB en B | `quota` | modelo |
| Exportación cifrada importada en otro proyecto B | Pide contraseña del origen; contenido idéntico | modelo + e2e |

---

## 15. Desglose en pull requests

### 15.1 Tabla

| PR | Título | Depende de | Tamaño | Pruebas que lo cubren | Pasos manuales del dueño | ¿Se despliega sin riesgo? |
|---|---|---|---|---|---|---|
| **PR0** | Correcciones previas: texto de seguridad, límite de imágenes y GitHub en la política | — | S | `tests/assets/limits.test.js`, `check-i18n`, prueba manual de nota con imagen grande | Revisar el texto de la política | Sí |
| **PR1** | Servicio de cifrado de proyecto y almacén de claves (sin UI ni datos) | — | M | `tests/crypto/project-crypto.test.js`; prueba de `keystore` en Playwright | — | Sí (código no usado) |
| **PR2** | Reglas en doble formato + pruebas | PR1 (formato) | M | `tests/rules` (≈115 casos) | **[MANUAL] publicar reglas en la consola y confirmar** | Sí: compatibles con el código actual |
| **PR3** | Capa de cifrado en `CollectionModel` y colecciones (lee y escribe cifrado; sin crear proyectos B) | PR1, **reglas de PR2 publicadas** | L | modelos (14.2), esquema↔reglas, e2e con un proyecto B sembrado en el emulador, demo | — | Sí: sin UI nadie tiene proyectos B |
| **PR4** | Asistente de privacidad, creación de B, clave de recuperación, desbloqueo, indicador, cierre de sesión, tabla de cookies | PR3 | L | e2e 14.4 (1–5), `check-i18n`, móvil | Probar en producción con una cuenta propia; revisar `legal/cookies` | Sí, con el interruptor `Workhub.features.encryptedProjects` |
| **PR5** | Bloqueo de GitHub en el motor y avisos | PR4 | S | modelos (GitHub), e2e 14.4 (6) | — | Sí |
| **PR6** | Clientes, Ctrl K, plugins, exportar/importar, copias locales en B | PR4 | M | modelos, e2e de renombrar cliente y exportar/importar | — | Sí |
| **PR7** | Compartir B: convertir en equipo, invitar y aceptar con código | PR4, PR6, reglas de PR2 | L | reglas (invitaciones), e2e 14.4 (7) | **[MANUAL] prueba con dos cuentas reales** (límite de lotes) | Sí |
| **PR8** | Textos públicos y política | PR0–PR7 **desplegados** | M | `seo-check`, `sitemap-check`, `update-lastmod --check`, `landing-check` | **[MANUAL] revisar textos** (idealmente un abogado la política) | Sí, solo texto |
| **PR9** | Modo gestionado (Worker) | PR4 | L | pruebas del Worker (JWT falso/caducado/otra audiencia, HKDF determinista), reglas, e2e | **[MANUAL] `wrangler secret put KMS_MASTER_V1` + copia del secreto fuera de Cloudflare; publicar reglas** | Sí, tarjeta C activable por interruptor |
| **PR10** | Rotación de la DEK y expulsión efectiva | PR7 (D9) | L | modelos (rotación reanudable), reglas, e2e | **[MANUAL] publicar reglas** | Con cuidado: recifra datos |
| **PR11** | Convertir un proyecto A existente en B | PR5, PR6 | L | modelos (reanudable), reglas, e2e | **[MANUAL] publicar reglas** | Con cuidado: recifra datos |

Un único `push` por PR (Cloudflare construye una vista previa por cada `push`).

### 15.2 Detalle por PR

**PR0 — Correcciones previas (S)**

- `docs/SEGURIDAD.md` línea 23, texto propuesto: «Las contraseñas y las notas de cada credencial del gestor se cifran en tu navegador (AES-256 + PBKDF2) antes de subir. El resto del contenido (tareas, notas, clientes, contactos, reuniones, imágenes y los demás campos de la credencial, como servicio, usuario o cliente) se guarda en Firestore sin cifrado de extremo a extremo: Google lo cifra en sus discos, pero quien administra el proyecto de Firebase puede leerlo.»
- `src/services/firebase-backend.js`: `IMAGE_MAX_CHARS = 880000` y comparación por longitud real; prueba de límites; añadirla a `checks.yml`.
- `legal/privacidad/index.html` («Integración con GitHub» y tabla de proveedores): decir que **el título, la descripción, la columna (estado) y las etiquetas** de las tareas del proyecto enlazado se envían a GitHub sin cifrar (y que las tareas nuevas se crean allí como borradores), que GitHub los guarda según sus condiciones y que **siguen allí al desvincular o borrar la tarea en Kanlane**; subir `actualizado`/`version` en `src/config/legal-config.js`.
- Aviso de 8.4 «Al sincronizar…» en el bloque «Desde GitHub» del asistente y en la tarjeta de Ajustes (texto nuevo + `en.js`).
- `docs/GITHUB.md` y `CONTEXT.md` al día.
- Criterios de aceptación: una imagen de 3 MB se guarda en producción sin `permission-denied`; `check-i18n --strict` pasa; la política y `SEGURIDAD.md` no afirman nada falso.

**PR1 — Servicio de cifrado (M)**

- `src/services/project-crypto.js`, `src/services/keystore.js`, `<script>` en `app/index.html` (no los usa nadie todavía), pruebas 14.1, entrada en `checks.yml`.
- Medir PBKDF2 600 000 en un móvil de gama baja (D15).
- Criterios: todas las pruebas unitarias en verde; ningún cambio visible; `node scripts/check-js.js` pasa.

**PR2 — Reglas (M)**

- `firestore.rules` (7.1), `tests/rules/rules-test.js` (7.2), `tests/rules/README.md`, `docs/SEGURIDAD.md` (sección de publicar reglas).
- **[MANUAL] Publicación, en este orden**: (1) fusionar PR2; (2) el dueño pega `firestore.rules` en *Firestore Database → Reglas* (o `firebase deploy --only firestore:rules`) y pulsa «Publicar»; (3) comprueba en la app de producción que crear, editar y borrar una tarea, una nota con imagen, un cliente y aceptar una invitación siguen funcionando; (4) avisa de que están publicadas. **No se despliega PR3 hasta ese aviso.** Se le pegan las reglas sin comentarios en el chat (preferencia del usuario).
- Reversión: volver a pegar las reglas anteriores (se guardan en la descripción del PR).
- Criterios: 70 casos antiguos + nuevos en verde; publicadas y confirmadas.

**PR3 — Capa de cifrado (L)**

- `enc-schema.js`, `project-cipher.js`, `CollectionModel` (6.3), `TaskModel` (notas), `VaultModel`, `ProjectModel` (`isEncrypted`, `TEAM_PROTECTED`, `save`), `firebase-backend` (`__assetCipher`), `AppController.connectProject` (espera a saber si es B; pantalla «Proyecto cifrado» mínima que desbloquea si ya hay clave y, si no, dice «Este proyecto está cifrado. Actualiza Kanlane para abrirlo.»), estados `_undecryptable`.
- Interruptor `Workhub.features.encryptedProjects = false` (archivo nuevo `src/config/features.js`): la creación sigue imposible.
- Si se ve grande, se divide en **PR3a** (`CollectionModel`, esquema, tareas y notas) y **PR3b** (imágenes, cofre, `plugin_data`, `ProjectModel`).
- Criterios: con proyectos A todo igual (e2e `smoke.js` y `cloud-smoke.js` en verde, demo en verde); un proyecto B sembrado a mano en el emulador se lee, se edita y en Firestore solo hay cifrado.

**PR4 — Asistente, creación y desbloqueo (L)**

- Vistas, controlador, CSS, textos 8.1–8.3, `AuthController` (cierre de sesión), indicador, ajustes de privacidad, interruptor a `true`.
- **Tabla de `legal/cookies/`**: nueva fila «`workhub-keys` (IndexedDB): clave de cifrado de los proyectos con cifrado total; se borra al cerrar sesión salvo en dispositivos de confianza; técnica, no requiere consentimiento»; nota en `legal/privacidad/` de que existe la modalidad (descripción factual, sin promesas de marketing); `legal-config.js` sube versión. Se despliega a la vez que el almacenamiento, así que es verdad desde el primer momento.
- `docs/SEGURIDAD.md`, `CONTEXT.md`, README (sección técnica, no comercial).
- Pasos manuales: probar en producción crear un proyecto B, recargar, cerrar sesión, entrar desde otro navegador.
- Reversión: `encryptedProjects = false` (los B existentes siguen abriéndose; no se pueden crear más). Nunca revertir PR3 con proyectos B ya creados.
- Criterios: e2e 14.4 (1–5) en verde en Chromium y Edge; 320–1280 px sin scroll horizontal; claro/oscuro; `check-i18n --strict`.

**PR5 — GitHub (S)**: apartado 9 completo; textos 8.4. Criterio: con un proyecto B no hay ninguna petición a `api.github.com` (simulador de `fetch` que falla si se llama).

**PR6 — Consultas, Ctrl K, plugins, exportar (M)**: 6.4/6.5 (cliente, comando, plugins, copias), textos 8.6, `docs/PLUGINS.md` (cuota y aviso). Criterio: renombrar un cliente con 300 tareas en B actualiza todas; exportar cifrado → importar → igual.

**PR7 — Compartir con código (L)**: apartado 10 completo, textos 8.5, `docs/EQUIPOS.md`. Si se decide D9, genera el par ECDH al aceptar. Paso manual: prueba con dos cuentas reales (Google + correo) en producción.

**PR8 — Textos públicos (M)**: ver 18. Solo cuando PR4–PR7 estén desplegados y probados.

**PR9 — Modo gestionado (L)**: apartado 12 completo. Interruptor `managedEncryption`.

**PR10 — Rotación y expulsión (L)**: 13.1.

**PR11 — Convertir A en B (L)**: 13.2.

### 15.3 Orden de despliegue y pasos manuales

```
PR0 ─► PR1 ─► PR2 ─► [MANUAL: publicar reglas y confirmar] ─► PR3 ─► PR4+PR5 ─► PR6 ─► PR7 ─► [MANUAL: prueba con dos cuentas] ─► PR8
                                                                       └─► PR9 ([MANUAL] secreto + reglas)
                                                                                         PR7 ─► PR10 ([MANUAL] reglas)
                                                                                 PR5+PR6 ─► PR11 ([MANUAL] reglas)
```

PR0 y PR1 son independientes y pueden ir en paralelo. **PR5 debería desplegarse el mismo día que PR4** (o fusionarse en él) para que no exista un periodo en que un proyecto B pueda intentar enlazarse a GitHub desde la interfaz (las reglas ya lo impiden, pero el error sería confuso).

---

## 16. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Pérdida de datos por olvidar contraseña y clave | Media | Total para ese proyecto | Clave de recuperación con confirmación obligatoria y `.txt`; aviso en tres sitios; «Crear una clave de recuperación nueva» en ajustes; exportación cifrada; es la decisión del dueño (sin restablecimiento por correo). |
| Un error de cifrado deja documentos ilegibles | Baja | Alta | AAD y formato probados con vectores fijos; `_undecryptable` nunca se sobrescribe; `ev` permite convivir formatos; las exportaciones cifradas se prueban con ida y vuelta. |
| Pestañas con código antiguo | Media | Media | Reglas de PR2 publicadas antes: no pueden escribir en claro sobre ni dentro de B; el service worker avisa «Hay una versión nueva». |
| `set()` que sustituye un documento y borra `e` o `enc` | Media | Alta | Todo `set` de datos pasa por `seal`; `TEAM_PROTECTED` con `enc`; `save` conserva `enc`; reglas `keepsSeal` y `enc` inmutable. |
| Escrituras que se saltan el modelo (notas, importar, convertir, `restore`, `projectBucket`, imágenes) | Alta si no se revisa | Alta | Lista cerrada en el apartado 2; cada una tiene su cambio en 6.4 y su prueba; las reglas rechazan creaciones en claro en B. |
| Lotes con demasiados `get()` en reglas | Baja | Media | Nada nuevo usa lotes salvo aceptar (4 operaciones); todo lo demás uno a uno con `runPool`. Prueba manual en producción. |
| Rendimiento con miles de documentos | Media | Media | Descifrar solo lo cambiado (`docChanges` + caché por IV); tandas de 50; esqueleto mientras tanto; objetivo medido en 14.4. |
| Último en escribir gana en campos secretos | Media | Baja/Media | Caché de escritura inmediata; transacción en equipos (D10); documentado. |
| Contraseñas débiles | Alta | Alta (fuerza bruta por quien tenga la base) | Mínimo 12, avisos, PBKDF2 600 000, `iter` mínimo en reglas. |
| Coste de `get()` en reglas | Baja | Baja | Solo en creaciones en claro; Spark sobra para el uso actual. |
| El navegador no guarda `CryptoKey` en IndexedDB | Baja | Baja | Se cae a memoria y se pide la contraseña en cada recarga. |
| Perder el secreto del Worker (C) | Baja | Total para los C | Copia fuera de Cloudflare antes de activar; versionado; clave de recuperación opcional. |
| Promesas públicas antes de tiempo | Media | Legal/reputación | PR8 solo tras despliegue; lista del apartado 18. |
| Miembro expulsado conserva acceso a la clave | Segura hasta PR10 | Media | Aviso en la confirmación y en la documentación; PR10. |
| El modo invitado o local intenta crear B | — | — | No se ofrece (decisión 6). |

### 16.1 Plan de reversión por fase

| Fase | Cómo se revierte | Qué no se puede revertir |
|---|---|---|
| PR0 | `git revert` | — |
| PR1 | `git revert` | — |
| PR2 | Pegar las reglas anteriores | Si ya hay proyectos B, se pierde la protección de forma (no los datos) |
| PR3 | `git revert` **solo si no hay proyectos B** | Con proyectos B, revertir los dejaría en blanco: no se hace |
| PR4 | `encryptedProjects = false` | Los B creados siguen existiendo y abriéndose |
| PR5 | `git revert` (las reglas siguen impidiendo `github` en B) | — |
| PR6 | `git revert` (vuelve el filtrado por consulta, que en B no encuentra nada: se nota al renombrar clientes) | — |
| PR7 | Ocultar «Compartir» en proyectos B | Los equipos B creados siguen funcionando para quien ya tiene la clave |
| PR8 | Revertir textos | — |
| PR9 | `managedEncryption = false` | Los C creados dependen del Worker: no se puede retirar el Worker |
| PR10/PR11 | Son reanudables; revertir el código deja la operación a medias pero legible (doble `kid` / estado `converting`) | — |

---

## 17. Definición de hecho

Un PR de esta serie está **hecho** cuando:

1. Todas las pruebas de la CI pasan (`checks.yml`: JavaScript, pruebas de Node, `check-i18n --strict`, build, reglas, Playwright, `cloud-smoke`), más las nuevas de ese PR añadidas a `checks.yml`.
2. Se ha probado a mano con el emulador en **Edge** (local) y Chromium, a 320, 375, 768, 1024 y 1280 px, en claro y oscuro, sin scroll horizontal ni errores en consola.
3. Los textos nuevos están en `src/i18n/en.js` con el texto exacto.
4. Sin dependencias nuevas, sin build, scripts clásicos, `Workhub.*`, sin scripts en línea; la CSP no cambia.
5. Diseño: sin rayas laterales, sin degradados, sin emojis; esqueleto `.sk` para esperas.
6. Si cambia `firestore.rules`: pruebas en verde, reglas pegadas en el chat sin comentarios y **confirmación del dueño de que están publicadas** antes de desplegar el código que las necesita.
7. Si añade almacenamiento en el navegador o un proveedor: `legal/cookies/`, `legal/privacidad/` y `legal-config.js` en el mismo PR.
8. `CONTEXT.md` y el documento de `docs/` que corresponda al día; este plan actualizado si algo cambió.
9. Lo que no se pudo verificar contra un servicio real se dice en la descripción del PR.
10. Un solo `push`, PR en español con *Qué cambia*, *Cómo funciona*, *Pruebas*.

---

## 18. Textos públicos por fase

**Regla**: un texto que promete algo se publica cuando eso ya está desplegado y probado. Las tablas legales de almacenamiento y de proveedores se actualizan **en el mismo PR** que introduce el almacenamiento o el proveedor (si no, serían falsas al desplegarse).

| Fase | Textos | Qué decir |
|---|---|---|
| PR0 | `docs/SEGURIDAD.md`, `legal/privacidad/` (GitHub), `docs/GITHUB.md`, aviso en la app | Corregir lo falso de hoy; nada nuevo prometido |
| PR4 | `legal/cookies/` (fila `workhub-keys`), `legal/privacidad/` (párrafo factual: existe una modalidad en la que el contenido se cifra en el navegador y Kanlane no tiene la clave; qué queda en claro), `legal-config.js`, `docs/SEGURIDAD.md`, `CONTEXT.md`, README (parte técnica) | Factual y con limitaciones; sin marketing |
| PR7 | `docs/EQUIPOS.md`, `legal/privacidad/` (códigos de invitación, qué ve Kanlane) | Ídem |
| **PR8** (tras PR4–PR7 desplegados) | `index.html` y `en/index.html` (sección de seguridad, **FAQ y su `FAQPage` JSON-LD con el mismo texto**), `gestor-de-contrasenas-para-clientes/` y `en/client-password-manager/` (tabla «qué protege y qué no», FAQ y JSON-LD), las demás páginas de captación que mencionan el cifrado (`alternativa-a-trello/`, `alternativa-a-asana/`, `alternativa-a-notion/`, `gestion-de-proyectos/`, `gestor-de-clientes/`, `crm-para-autonomos/` y sus pares en `en/`), `llms.txt` (descripción, apartado «Qué es y qué no es», «Última actualización»), `legal/terminos/` si procede, `node scripts/update-lastmod.js` (actualiza `last-modified` y `dateModified`), README (ambos idiomas) | Lo del apartado 4; mantener «no se cifran nombre, columnas, etiquetas, fechas ni estados» |
| PR9 | Política (Cloudflare custodia material de claves; base legal), tarjeta C, `llms.txt`, FAQ | Comodidad **y** que Kanlane podría descifrar |
| PR10 | `docs/EQUIPOS.md`, política si cambia algo; ajustar la advertencia de expulsión | «Al expulsar, lo nuevo deja de poder leerse; lo ya visto no se puede retirar» |
| PR11 | Ajustes del proyecto, FAQ | Convertir protege lo que viene, no el pasado |

El texto de la pantalla del cofre en la app (`#lockDesc`) no cambia salvo que se decida D11.

---

## 19. Esfuerzo orientativo

S ≈ medio día, M ≈ 1–2 días, L ≈ 3–5 días de trabajo con pruebas. Total hasta PR8 (sin C, rotación ni conversión): ≈ 3–4 semanas de trabajo efectivo. **[Estimación, no medida]**.

---

## 20. Decisiones que aún necesita el dueño

| # | Pregunta | Recomendación |
|---|---|---|
| **D1** | ¿Longitud del código de acceso? | **20 caracteres (100 bits)** en 5 grupos de 4. Cumple el mínimo (16/80) con margen y sigue siendo fácil de dictar. |
| **D2** | ¿Se ofrece el cifrado total en «Crea tu primer proyecto» (el proyecto principal, en la raíz)? | **Sí.** Es justo cuando una persona preocupada por la privacidad decide; técnicamente el principal es solo otro ámbito (`users/{uid}/crypto/{uid}`, `projects/main.enc`). Exige el caso `deleted:true` en las reglas (ya en 7.1). |
| **D3** | ¿Cifrar también los nombres de las columnas y el catálogo de etiquetas (documento del proyecto)? | **No en v1; sí en una fase posterior** (blob `ecfg` en el documento del proyecto). Hoy hacen falta antes de desbloquear para pintar y `ProjectModel.set` de equipos calcula diferencias por campo. El nombre del proyecto queda siempre en claro (hay que listarlo para desbloquearlo). Se dice en la tarjeta B. |
| **D4** | ¿«Este dispositivo es de confianza» marcado o desmarcado por defecto? | **Desmarcado.** Sin marcar ya no se pide en cada recarga (dura lo que la sesión); solo se pierde al cerrar sesión. |
| **D5** | ¿`dueDate` de las tareas y `date` de las reuniones en claro? | **Sí** (como propuso el dueño): permiten mover en el calendario sin reescribir el blob y reducen choques. Revelan cuándo hay entregas y reuniones; se dice en la política. `start`/`end` de las reuniones van cifradas. |
| **D6** | ¿`linkedContacts`/`linkedVault` en claro? | **Sí**: son ids opacos; así `saveLinks` y la conversión a equipo no necesitan descifrar. Revelan qué tarea enlaza con qué contacto o credencial, no su contenido. |
| **D7** | ¿Relleno para ocultar el tamaño del contenido? | **No en v1.** Cuesta espacio (límite de 1 MiB por documento) y el beneficio es pequeño frente a lo que ya revelan fechas y recuentos. |
| **D8** | ¿Cifrar las marcas de instalación de plugins (`url`, `manifest`, `granted`)? | **No.** No es contenido del usuario y `where('_kind')` necesita la marca. |
| **D9** | ¿Generar ya en PR7 un par de claves ECDH por miembro para poder rotar en PR10 sin reinvitar? | **Sí.** Es poco código más en PR7 y evita pedir a todos los miembros un código nuevo en la primera rotación. Implica confiar en el servidor para repartir claves públicas (mitigado con huellas). Si se acepta, `validCrypto` de PR2 debe admitir ya `pub` y `priv`. |
| **D10** | ¿Transacciones para cambios de campos secretos? | **Solo en equipos B y con conexión.** En proyectos personales, la caché de escritura basta. |
| **D11** | ¿El cofre de un proyecto B sigue pidiendo su propia contraseña maestra? | **Sí en v1** (defensa en profundidad y sin cambios en el cofre). Más adelante se puede ofrecer «usar la clave del proyecto». |
| **D11b** | ¿Qué se hace con el cofre en equipos B? | **Igual que hoy: sin cofre en equipos.** Cuando se diseñe, valorar cifrar el cofre compartido con la DEK del proyecto (10.8) en lugar del diseño de `EQUIPOS.md`. |
| **D12** | ¿La clave de recuperación se muestra antes o después de crear el proyecto? | **Antes**: nunca existe un proyecto B con una clave de recuperación sin confirmar. Si la creación falla, se reutiliza la misma clave al reintentar. |
| **D13** | ¿Pedir la contraseña al invitar o mantener una copia extraíble de la DEK en memoria tras desbloquear? | **Pedirla.** La DEK guardada no es extraíble; pedir la contraseña confirma además que es el propietario quien invita. |
| **D14** | Exportación de un proyecto B: ¿cifrada o en claro por defecto? | **Cifrada por defecto**, con «Exportar sin cifrar» y confirmación. |
| **D15** | ¿Iteraciones de PBKDF2? | **600 000** (mínimo en reglas). Medir en un móvil de gama baja en PR1; si tarda menos de 1 s, subir a 1 000 000 en el cliente (las reglas siguen con el mínimo). |
| **D16** | ¿Longitud mínima de la contraseña de cifrado? | **12 caracteres** (el cofre y las cuentas usan 8; aquí no hay restablecimiento y el riesgo de fuerza bruta lo asume el usuario). |
| **D17** | ¿Desplegar PR5 junto a PR4? | **Sí**, en el mismo PR o el mismo día. |
| **D18** | Modo C: ¿un envoltorio KMS por miembro o uno por equipo? | **Uno por equipo** (`teams/{tid}/crypto/_kms`) para no depender de que cada miembro lo cree; se decide al empezar PR9. |

---

## 21. Suposiciones y lo que no se ha verificado

- **[SIN VERIFICAR]** Coste real de PBKDF2 600 000 en móviles de gama baja (se mide en PR1).
- **[SIN VERIFICAR]** Guardar `CryptoKey` no extraíble en IndexedDB en Safari de iPhone/iPad reales (en escritorio está soportado).
- **[SIN VERIFICAR]** Cómo cuenta Firestore `exists()` + `get()` del mismo documento para el límite de 10 accesos por operación; con un acceso por operación sobra en cualquier caso.
- **[SIN VERIFICAR]** El límite de 20 accesos por lote en producción para aceptar invitaciones cifradas (el emulador no lo aplica).
- **[SIN VERIFICAR]** La regla de lectura con `request.time < resource.data.createdAt + duration.value(24, 'h')` y `getAfter()` en la creación del envoltorio se han diseñado según la documentación de reglas; se probarán en el emulador en PR2.
- **[SIN VERIFICAR]** Rendimiento de descifrado de 2 000 documentos en un móvil.
- **[SIN VERIFICAR]** Cómo pinta un cliente anterior a PR3 un documento sellado (se espera una tarjeta vacía; no se ha ejecutado).
- **Supuesto**: los «textos de aviso propuestos en el análisis previo» sobre GitHub y el informe previo sobre lo que sale a GitHub no están en el repositorio; los textos de 8.4 y de PR0 se han redactado de nuevo a partir de `docs/GITHUB.md` y `src/models/github-sync.js` (título, descripción, columna/estado, etiquetas y creación de borradores).
- **Supuesto**: el análisis previo del modo C no está en el repositorio; el apartado 12 recoge lo indicado (secreto en `wrangler secret`, verificación del JWT de Firebase, HKDF por usuario y proyecto, sin Blaze) y añade la autorización de equipos con el token del propio usuario contra la API REST de Firestore.
- Todo lo demás (rutas, funciones, campos, reglas actuales, consultas, CSP, comportamiento del cierre de sesión) se ha comprobado leyendo el código de `main` en `c39c011`.
