# Seguridad del acceso a Kanlane

Cualquiera puede crearse una cuenta en Kanlane; cada persona solo ve y toca sus propios datos. Esta guía explica qué protege Kanlane desde el propio código y qué tienes que activar tú en la consola de Firebase. La parte del código ya está hecha. Los pasos de la consola, que están más abajo, se hacen **una sola vez**.

## Lo que ya hace el código

| Riesgo | Protección |
|---|---|
| Un usuario lee o modifica los datos de otro | Cada cuenta solo puede leer y escribir en `users/{su uid}/…` y en los proyectos de equipo de los que es miembro, según su rol (ver más abajo). Lo impide el servidor (`firestore.rules`), no la app. |
| Cuentas en masa con correos inventados para llenar la base de datos | Quien se registra con correo y contraseña tiene que **verificar el correo** antes de leer o guardar nada. Lo exige el servidor, y la app muestra la pantalla "Verifica tu correo". Google y GitHub ya llegan verificados por el proveedor. |
| Usar tu Firestore como almacén de cualquier cosa | Cada usuario solo puede escribir en las colecciones que usa la app (tareas, notas, clientes, contactos, reuniones, contraseñas, proyectos, imágenes, ajustes, plugins y copias cifradas), con límites de campos y tamaños. Cualquier otra ruta está cerrada. |
| Un plugin de terceros intenta leer tus datos o tu sesión | Cada plugin corre en un `<iframe sandbox>` sin `allow-same-origin`: no ve la página, ni la sesión, ni el almacenamiento de Kanlane. Solo habla por mensajes, cada llamada se comprueba contra los permisos aprobados, ninguno da acceso a las contraseñas, y hay un límite de escrituras por minuto. Ver [PLUGINS.md](PLUGINS.md). |
| Tras cerrar sesión, los datos quedan en el ordenador | Al cerrar sesión se borra la copia local de Firestore (IndexedDB) y el último proyecto recordado. **No** se borran las versiones locales de la copia de seguridad (`workhub-backup-history`, en IndexedDB y **sin cifrar**), la clave de las copias cifradas de la cuenta ni el acceso a GitHub de ese navegador: en un ordenador compartido, borra las versiones desde *Copia de seguridad*, quita el acceso desde *Ajustes → GitHub Projects* o borra los datos del sitio en el navegador. |
| Otra web mete Kanlane en un marco invisible para robarte clics (*clickjacking*) | Cabeceras `X-Frame-Options: DENY` y `frame-ancestors 'none'` (`scripts/build-public.js`, que genera `_headers` para Cloudflare). |
| Inyección de código (XSS) | Todo lo que escribe el usuario se escapa antes de pintarse. Además, la **política de seguridad de contenido (CSP)** solo permite scripts de Kanlane y del SDK de Firebase/Google. Prohíbe scripts en línea y `eval`, así que aunque se colara HTML, no ejecutaría nada. |
| Nombre o foto del perfil de Google/GitHub manipulados | El nombre se pinta como texto y la foto solo se acepta si es `https:`. |
| Conexión sin cifrar | HTTPS obligatorio (`Strict-Transport-Security`). |
| Contraseñas débiles | Mínimo de 8 caracteres para cuentas nuevas. La contraseña maestra de las contraseñas pide 12 o más y rechaza las fáciles de adivinar (muy comunes, secuencias y repeticiones); el campo lleva un medidor, que avisa además si contiene tu correo o el nombre del proyecto, y un generador. Las contraseñas maestras creadas antes de este cambio siguen valiendo. |
| Alguien averigua tu contraseña maestra | Verificación en dos pasos opcional (TOTP) para abrir las contraseñas, que tampoco se salta con la clave de recuperación. Ver más abajo. |
| Probar contraseñas maestras una tras otra | Espera creciente tras cuatro fallos (hasta 15 minutos). Ver más abajo. |
| Adivinar si un correo tiene cuenta | "Recuperar contraseña" responde lo mismo exista o no la cuenta. |
| Fuerza bruta contra el inicio de sesión | Firebase bloquea temporalmente tras muchos intentos (`auth/too-many-requests`). |
| Token de GitHub (integración con GitHub Projects) | Se guarda solo en el navegador (`localStorage`), nunca en Firestore ni en el repositorio, tanto si se pega como si se obtiene con «Conectar con GitHub» (que usa el inicio de sesión de GitHub y no toca tu cuenta). Ver [GITHUB.md](GITHUB.md#seguridad). |
| Alguien entra en un proyecto de equipo sin permiso | Un equipo (`teams/{id}`) solo lo lee quien está en su lista de miembros, y solo propietarios y editores escriben datos. Para entrar hace falta una invitación dirigida a tu correo **verificado**, con el rol que te dieron; nadie puede darse un rol mayor ni meter a otros. Las invitaciones las crea solo el propietario y las lee solo su destinatario. Ver [EQUIPOS.md](EQUIPOS.md). |
| Robo de la base de datos | Las contraseñas y las notas de cada credencial del gestor se cifran en tu navegador (AES-256 + PBKDF2) antes de subir. El resto del contenido (proyectos con sus columnas y etiquetas, tareas, notas, clientes, contactos, reuniones, imágenes, datos de plugins y los demás campos de la credencial, como servicio, usuario o cliente) se guarda en Firestore sin cifrado de extremo a extremo: Google lo cifra en sus discos, pero quien administra el proyecto de Firebase puede leerlo, y quien robara la base de datos también. Las copias cifradas de la cuenta, si se activan, sí van cifradas con una clave que solo está en el navegador. |
| Datos enviados a GitHub | Si un proyecto se enlaza con GitHub Projects, el título, la descripción, la columna y las etiquetas de sus tareas salen del navegador hacia GitHub **sin cifrar** y se quedan allí aunque se borre la tarea o se desvincule el proyecto. La app lo avisa antes de conectar. Ver [GITHUB.md](GITHUB.md#qué-sale-de-kanlane-hacia-github). |

## Proyectos con cifrado total

Al crear un proyecto (con cuenta) el asistente pregunta la privacidad. En «Cifrado total» el contenido se cifra en el navegador con una clave aleatoria del proyecto (AES-256-GCM); esa clave se guarda en Firestore **envuelta** con la contraseña de cifrado (PBKDF2-SHA256, 600 000 iteraciones) y con una clave de recuperación, en `crypto/{uid}`. El servidor nunca recibe la contraseña, la clave de recuperación ni la clave del proyecto.

- **No hay restablecimiento por correo.** Sin la contraseña y sin la clave de recuperación el proyecto no se puede abrir, y nadie puede ayudar.
- **Qué queda en claro:** nombre del proyecto, columnas, etiquetas, fechas, estado y orden de las tareas, asignados, vínculos entre tareas y contactos o credenciales, plugins instalados y el tamaño aproximado de cada elemento.
- **En el navegador:** la clave vive en IndexedDB (`workhub-keys`) como `CryptoKey` no extraíble. Se borra al cerrar sesión salvo que se marque «Este dispositivo es de confianza». «Olvidar la clave en este navegador» (Editar proyecto) y «Bloquear este proyecto» (Ctrl K) la borran a mano.
- **Convertir un proyecto que ya existe** («Editar proyecto → Privacidad → Convertir a cifrado total»): solo proyectos personales sin enlace con GitHub. Cifra todo lo que hay y lo que venga, y no se puede deshacer. **No borra lo que ya salió**: las copias de seguridad anteriores (en la cuenta y exportadas) y lo que se hubiera sincronizado con GitHub siguen sin este cifrado.
- **Cambiar la clave del proyecto** («Editar proyecto → Privacidad», o el aviso de «Compartir» tras quitar a alguien de un equipo): crea una clave nueva y vuelve a cifrar todo el proyecto con ella, de modo que una clave copiada antes deja de servir. La contraseña no cambia; la clave de recuperación, sí. En un equipo, cada miembro recibe la clave nueva envuelta con su clave pública y la abre con su contraseña. Detalle en `docs/EQUIPOS.md`. No retira lo que alguien ya vio o descargó.
- **GitHub:** un proyecto con cifrado total no se puede enlazar ni sincronizar; lo impiden la interfaz, el motor de sincronización y las reglas.
- **Límites:** el código lo sirve Kanlane, así que la protección depende de que ese código sea el legítimo; no protege frente a un dispositivo comprometido ni frente a extensiones del navegador con acceso a la página.
- **Apagar la opción:** `Workhub.features.encryptedProjects = false` en `src/config/features.js` retira el cifrado total del asistente. Los proyectos cifrados que ya existan se siguen abriendo. No se debe revertir el código de cifrado si ya hay proyectos cifrados.

Detalle completo: `docs/CIFRADO-PROYECTOS.md`.

## Verificación en dos pasos de las contraseñas

Con las contraseñas desbloqueadas, «Activar verificación en dos pasos» enseña un código QR (y la misma clave en texto) para añadir en una aplicación de autenticación (Google Authenticator, Aegis, 1Password…). Desde entonces, abrir las contraseñas pide la contraseña maestra **y** un código de 6 cifras.

- **Lo comprueba el servidor, no el navegador.** La clave del cofre queda envuelta dos veces: con la contraseña maestra y con una clave que el Worker (`/__/kms/v1/totp`) solo entrega tras un código válido. Quien tenga la contraseña maestra y una copia de la base de datos no puede abrir el cofre sin el código.
- **La clave de recuperación no se lo salta.** Con el segundo paso activado, restablecer la contraseña con la clave de recuperación pide además un código de la aplicación o uno de respaldo, y el segundo paso sigue activado después. Para que sea así, **activarlo o desactivarlo cambia la clave de recuperación**: la app enseña la nueva y la anterior deja de valer.
- **Códigos de respaldo.** Al activarlo se dan diez códigos de un solo uso, para cuando no se tiene el teléfono. Sustituyen al código de la aplicación, no a la contraseña maestra. Se pueden cambiar por otros nuevos (los anteriores dejan de valer) y, con uno de ellos, también desactivar el segundo paso. Se comprueban en el navegador: «de un solo uso» significa que al usarlo se borra de los datos actuales, no que deje de valer contra una copia antigua de la base de datos.
- **Si se pierde todo:** sin teléfono **y** sin códigos de respaldo no hay forma de entrar, ni con la clave de recuperación. Kanlane no puede desactivarlo por nadie.
- **Qué no protege:** un código son 6 cifras; lo que impide probarlos es un límite de 3 intentos por minuto y cuenta (`TOTP_RATE_LIMIT`), que frena pero no hace imposible un ataque de días de alguien que ya tiene tu sesión y tu contraseña maestra. Tampoco protege frente a un dispositivo comprometido mientras el cofre está abierto.
- **Kanlane no guarda el secreto del autenticador**: va cifrado, dentro de los envoltorios, con una clave derivada de `KMS_MASTER_V1`. Si ese secreto del Worker se perdiera, esos cofres solo se abrirían con un código de respaldo (y con él se puede desactivar el segundo paso).
- **Solo con cuenta.** En modo local no hay servidor que compruebe el código y la opción no aparece. Una copia de seguridad con el segundo paso activado, importada en otra cuenta, pide un código de respaldo: el de la aplicación solo lo acepta el servidor para la cuenta original.
- **Equipos:** para dar acceso a las contraseñas de un equipo, o llevar las de un proyecto a un equipo, hay que desactivarla antes (esas acciones abren la clave solo con la contraseña maestra).
- **Despliegue:** hace falta desplegar el Worker con el límite `TOTP_RATE_LIMIT` de `wrangler.jsonc` (sin él la ruta responde 503), tener `KMS_MASTER_V1` (ver [CLOUDFLARE.md](CLOUDFLARE.md)) y **publicar `firestore.rules`**: las claves de los equipos (`vault_keys`) admiten ahora el campo de los códigos de respaldo, y sin las reglas nuevas no se puede activar en un proyecto de equipo. Para retirarla: `Workhub.features.vaultTotp = false`; los cofres que ya la tengan siguen pidiendo el código.

## Contraseña maestra: intentos, cambio y clave de recuperación

- **Límite de intentos.** Tras cuatro fallos seguidos (contraseña maestra, clave de recuperación o código), cada fallo más obliga a esperar: 30 s, 1 min, 2 min… hasta 15 min. La cuenta se guarda en el navegador y no se reinicia al recargar. Es un freno para quien prueba desde la app; quien tenga una copia de los datos puede probar por su cuenta, y contra eso están la longitud mínima, PBKDF2 y la verificación en dos pasos.
- **Contraseñas antiguas débiles.** Un cofre creado con una contraseña que hoy no se aceptaría sigue abriéndose, con un aviso dentro para cambiarla. «Cambiar contraseña maestra» pide la actual y aplica las reglas nuevas; la clave de recuperación no cambia.
- **Sin vuelta atrás.** Si se pierden la contraseña maestra y la clave de recuperación, las contraseñas guardadas no se pueden recuperar: Kanlane no las tiene. La pantalla de la clave lo dice y no deja seguir hasta escribir un grupo de la clave elegido al azar.

## Lo que tienes que hacer en la consola (una vez)

### 1. Publicar las reglas nuevas

Cada vez que cambia `firestore.rules` hay que publicarlas. Las últimas añaden los **proyectos de equipo** (`teams`, `invites`): sin ellas, compartir proyectos no funciona. Las del cifrado por proyecto (PR 2 del plan) son compatibles con el código actual, así que se pueden publicar antes de que exista ningún proyecto cifrado; **hay que publicarlas y confirmarlo antes de desplegar el código que cree proyectos cifrados.**

Con la terminal, en la carpeta de Kanlane:

```bash
firebase deploy --only firestore:rules
```

Sin terminal: **Firestore Database** → **Reglas**, borra el texto del editor, pega el contenido de `firestore.rules` y pulsa **Publicar**. El botón solo aparece cuando el texto cambia.

Si entras con correo y contraseña y nunca verificaste tu correo, la app te pedirá hacerlo una vez. Con Google o GitHub no cambia nada.

### 2. Deja activado el registro

**Authentication** → **Settings** → **Acciones del usuario**: **Habilitar creación (registro)** debe seguir **marcado**, para que cualquiera pueda crearse una cuenta.

### 3. Correo de verificación en español (opcional)

**Authentication** → **Templates** → **Verificación de dirección de correo electrónico**: pulsa el lápiz y cambia el idioma de la plantilla a **Español** y el nombre del remitente a "Kanlane".

### 4. Política de contraseñas

**Authentication** → **Settings** → **Política de contraseñas** (*Password policy*): activa **Requerir** (*Require enforcement*) con un mínimo de 8 caracteres y, si quieres, mayúsculas, minúsculas y números. Así el mínimo lo exige el servidor, no solo la app.

Si entras con correo y contraseña y la tuya no cumple la política, Firebase te pedirá cambiarla.

### 5. Protección contra la enumeración de correos

**Authentication** → **Settings** → comprueba que **Protección de enumeración de correo electrónico** (*Email enumeration protection*) está **activada**. En proyectos nuevos viene activada.

### 6. Dominios autorizados

**Authentication** → **Settings** → **Dominios autorizados**. Deja solo los que usas:

- `kanlane.com`
- `kanlane.yalero.net` (respaldo)
- `workhub.yalero.net` (nombre antiguo: quítalo cuando deje de redirigir)
- `workhub-project.netlify.app` (sitio antiguo: quítalo cuando lo borres)
- `workhub-26f50.firebaseapp.com` (lo necesita el inicio de sesión)

Quita `localhost` si no desarrollas en tu ordenador con el proyecto real, y `workhub-26f50.web.app` si no usas Firebase Hosting.

### 7. Restringir la clave de API (recomendado)

La `apiKey` de `firebase-config.js` es pública por diseño: identifica el proyecto, no da acceso a los datos. Aun así, puedes limitar desde dónde se puede usar:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials?project=workhub-26f50) → **Credenciales** → **Browser key (auto created by Firebase)**.
2. **Restricciones de aplicaciones** → **Sitios web** → añade:
   - `https://kanlane.com/*`
   - `https://kanlane.yalero.net/*`
   - `https://workhub.yalero.net/*` (nombre antiguo)
   - `https://workhub-project.netlify.app/*` (sitio antiguo, opcional)
   - `https://workhub-26f50.firebaseapp.com/*`
3. **Guardar**. Espera unos minutos y comprueba que puedes entrar. Si algo falla, vuelve a poner **Ninguna** y guarda.

### 8. Protege la cuenta con la que entras

Quien entre en tu cuenta de Google o GitHub entra también en Kanlane. Activa la **verificación en dos pasos** en esas cuentas:

- Google: <https://myaccount.google.com/signinoptions/twosv>
- GitHub: **Settings** → **Password and authentication** → **Two-factor authentication**

Es la protección más importante de todas.

## Si cambias algo

- **Servicio externo nuevo** (otro CDN, una API…): añade su dominio a la `Content-Security-Policy` de `scripts/build-public.js`, o el navegador lo bloqueará.
- **Nunca** pongas en el repositorio secretos (el *client secret* de GitHub, claves de servicio…) ni `data-backup.json`. Lo que va en `firebase-config.js` no es secreto.
