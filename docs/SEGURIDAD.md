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
| Inyección de código (XSS) | Todo lo que escribe el usuario se escapa antes de pintarse. Además, la **política de seguridad de contenido (CSP)** solo permite scripts de Kanlane y del SDK de Firebase/Google. Prohíbe scripts en línea y `eval`, así que aunque se colara HTML, no ejecutaría nada. Tampoco se aplica una hoja de estilos en línea (`<style>`): `style-src-elem 'self'`; los atributos `style="…"` sí, porque las vistas los usan para colores y anchos. |
| Una página del sitio carga en un marco una web ajena | Solo la aplicación (`/app/`) puede abrir marcos de otros dominios, y es por los plugins de terceros (aislados, ver arriba), reCAPTCHA y el acceso de Firebase. La portada, las páginas de captación, la demo y las legales solo pueden enmarcar al propio dominio (`frame-src 'self'`). |
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

### 9. Correo de verificación desde `kanlane.com` (SPF, DKIM y DMARC)

**Estado (9-oct-2026):** los correos de Firebase (verificar la dirección, restablecer la contraseña) salen de `noreply@kanlane.com`, con los asuntos «Verifica tu correo en Kanlane» y «Restablece tu contraseña de Kanlane», y su enlace lleva a `https://kanlane.com/__/auth/action`. Lo aplicó la asistencia de Firebase (caso 10430109); desde la consola siguen sin poder editarse el cuerpo, el asunto ni la URL de acción (ver el paso 3). El cuerpo de las plantillas de Firebase es el de serie, en texto y con el enlace completo; ya no importa, porque esos dos correos los envía Kanlane con su propio diseño y con botón (Worker + Resend, `docs/CORREOS-CUENTA.md`) y Firebase solo los envía si eso falla.

**Qué pasa al pulsar el enlace:** ya no sale la página gris de Firebase. El Worker no reenvía `/__/auth/action` cuando el enlace es de verificación o de cambio de contraseña: lo manda a la app (`/app/?mode=…&oobCode=…`), que valida el código y enseña su propia pantalla (`AuthController.resolveAction`). Al verificar se entra directamente si la sesión de esa cuenta está en ese navegador; si el correo se abre en otro dispositivo queda el acceso con el correo puesto, porque el enlace demuestra que el correo es de quien lo abre pero no sirve para iniciar sesión. Al cambiar la contraseña se pide la nueva con el diseño de Kanlane y se entra con ella. Un enlace caducado o ya usado se avisa y se ofrece pedir otro. El código se quita de la barra de direcciones nada más leerlo. Los demás modos (`recoverEmail`, `verifyAndChangeEmail`), que la app no envía, se siguen reenviando a Firebase.

Antes de eso salían de `noreply@workhub-26f50.firebaseapp.com` y su enlace llevaba a `https://workhub-26f50.firebaseapp.com/__/auth/action`: un nombre antiguo y un dominio que no es el de la web, que es justo lo que se enseña a desconfiar. El código no decide nada de esto (`sendEmailVerification()` usa la plantilla del proyecto): se cambia en la consola y en el DNS. Los pasos que siguen cuentan cómo se hizo.

Estado comprobado el 7-oct-2026 con una consulta de DNS pública: `kanlane.com` tiene `v=spf1 include:_spf.mx.cloudflare.net ~all` (lo puso Email Routing para las tareas por correo), **no** tiene los registros DKIM de Firebase (`firebase1._domainkey`, `firebase2._domainkey`) y **no** tiene DMARC (`_dmarc.kanlane.com`).

1. **Firebase → Authentication → Templates** → lápiz de cualquier plantilla → **Personalizar dominio** (*Customize domain*) → `kanlane.com`. La consola enseña los registros que hay que crear; **copia los valores de la consola**, no los de esta guía. Son de este tipo:
   - Un TXT de verificación en `kanlane.com` (`firebase=workhub-26f50`).
   - SPF: `include:_spf.firebasemail.com`. **Un dominio solo puede tener un registro SPF**: no añadas otro TXT, edita el que ya hay para que quede `v=spf1 include:_spf.mx.cloudflare.net include:_spf.firebasemail.com ~all`. Con dos registros SPF fallan los dos, y con ellos las tareas por correo.
   - DKIM: dos CNAME, `firebase1._domainkey` y `firebase2._domainkey`. En Cloudflare tienen que ir **sin proxy** («Solo DNS», nube gris).
2. Espera a que la consola marque el dominio como verificado (puede tardar hasta 48 h) y elige el remitente, por ejemplo `noreply@kanlane.com`. Los MX de `kanlane.com` son de Email Routing y su regla «Catch-all» entrega al Worker, que rechaza lo que no es una dirección de captura: una respuesta a `noreply@` rebota, que es lo esperado.
3. **Personalizar URL de acción** (*Customize action URL*) con `https://kanlane.com/__/auth/action`: **Firebase no lo permite en este proyecto.** El 7-oct-2026, con el dominio ya verificado y el remitente en `noreply@kanlane.com`, la consola respondió «Se produjo un error mientras se actualizaba la URL de acción»; la respuesta del servidor era `400 EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`. No es la dirección (esa página responde bien a través del Worker) ni el DNS: es una restricción de Firebase sobre las plantillas del proyecto. Mientras siga así, el enlace del correo apunta a `https://workhub-26f50.firebaseapp.com/__/auth/action`, aunque el mensaje salga de `kanlane.com`. La misma restricción impide cambiar el nombre del remitente y el asunto de cualquier plantilla; al intentarlo, la consola avisa: «Por el momento, no se pueden actualizar las plantillas de correo electrónico de este proyecto. Para obtener ayuda […] comunícate con Asistencia de Firebase». Es una restricción general de Firebase contra el abuso (no depende del plan): los cambios los aplica su asistencia a mano. **El dueño envió la solicitud el 7-oct-2026** (URL de acción `https://kanlane.com/__/auth/action`, remitente «Kanlane» y asuntos en español); la asistencia lo aplicó (caso 10430109, cerrado; comprobado el 9-oct-2026). No se arregla desde el código, salvo enviando los correos desde el Worker con un servicio de correo propio. Lo que sí se pudo cambiar ese día es el **nombre público** del proyecto (*Configuración del proyecto → General → Nombre público*), que es lo que las plantillas ponen en `%APP_NAME%`: era `project-1056897810807` y ahora es `Kanlane`.
4. DMARC: crea el TXT `_dmarc.kanlane.com` con `v=DMARC1; p=none; rua=mailto:UNA-DIRECCIÓN-QUE-LEAS` y, tras un par de semanas de informes sin fallos, súbelo a `p=quarantine`. La dirección de los informes la tienes que elegir tú; no puede ser de `kanlane.com` mientras todo su correo vaya al Worker.
5. Comprobar: crear una cuenta de prueba con correo y contraseña, mirar en las cabeceras del mensaje recibido `spf=pass`, `dkim=pass` y `dmarc=pass` con `kanlane.com`, pulsar el enlace, y ver que la app deja de pedir la verificación. Repetir con «¿La has olvidado?». Enviar también una tarea por correo para confirmar que el SPF fusionado no ha roto la captura.

### 10. `security.txt`

`scripts/build-public.js` publica `/.well-known/security.txt` (y una copia en `/security.txt`) con el contacto que haya en `SECURITY.contact`: los avisos privados del repositorio en GitHub, `https://github.com/yalerooo/Kanlane/security/advisories/new` (lo eligió el dueño el 7-oct-2026; no publica ningún correo). **Ese enlace solo funciona si el repositorio tiene activado «Private vulnerability reporting»** (GitHub → el repositorio → *Settings* → *Advanced Security* / *Code security* → *Private vulnerability reporting* → *Enable*), y el 7-oct-2026 estaba desactivado: actívalo antes de publicar o quien quiera avisar verá un 404. Para cambiar de contacto vale una dirección que alguien lea (`mailto:…`) u otra página (`https://…`); sin contacto, el archivo no se publica y el build avisa. La fecha `Expires` se pone a 330 días de cada publicación: si pasa casi un año sin publicar, hay que volver a hacerlo para que no caduque. Tras publicar, comprueba que `https://kanlane.com/.well-known/security.txt` responde 200 con texto plano.

## reCAPTCHA y el aviso de cookies

`firebase-backend.js` activa App Check con reCAPTCHA Enterprise en cuanto se abre la aplicación con Firebase (pantalla de acceso incluida), **antes y al margen** de lo que se elija en el aviso de cookies. Es deliberado: se trata como medida de seguridad imprescindible, no como analítica, porque si dependiera del consentimiento no se podría hacer obligatorio (quien rechazara se quedaría sin poder entrar). No se carga en la portada, la demo, las páginas legales ni el modo invitado. Las políticas de cookies y de privacidad lo describen así (versión 11).

Dos cosas pendientes de decidir, las dos tuyas:

- **Hoy no protege nada y aun así se carga.** App Check no es obligatorio y la clave de reCAPTCHA no incluye `kanlane.com` (ver [ROBUSTEZ.md](ROBUSTEZ.md)), así que cada visita descarga el script de Google, le envía señales del navegador y termina en `appCheck/recaptcha-error`. O se termina de configurar (añadir los dominios a la clave y activar la obligatoriedad poco a poco), o se deja `appCheckSiteKey` vacío hasta entonces para no enviar nada a Google sin necesidad.
- **Si prefieres pedir consentimiento** antes de cargarlo, hay que renunciar a hacer App Check obligatorio, añadir una categoría al aviso (`src/consent/consent.js`) y subir su `VERSION` para volver a preguntar a todo el mundo. Conviene que lo valore un abogado: hay autoridades de protección de datos que no consideran reCAPTCHA exento de consentimiento.

## Restos del nombre «Workhub»

El producto se llamaba Workhub. Lo que sigue con ese nombre se queda así **a propósito**: cambiarlo borraría o dejaría inaccesibles datos de quien ya usa Kanlane.

| Dónde | Qué | Por qué no se toca |
|---|---|---|
| Navegador, `localStorage` y `sessionStorage` | `workhub_session`, `workhub_guest`, `workhub_guests`, `workhub_guest_migrate`, `workhub_lang`, `workhub_lang_adopted`, `workhub_theme`, `workhub_accent`, `workhub_accent_v`, `workhub_nav`, `workhub_project`, `workhub_hidden_…`, `workhub_cal_mode`, `workhub_task_mode`, `workhub_timeline`, `workhub_reminders`, `workhub_reminded`, `workhub_gh_token`, `workhub_cloud_backup_key:…`, `workhub_vault_link`, `workhub-vault-attempts:…`, `workhub_account_deleted`, `workhub_consent` | Son la sesión, las preferencias y, sobre todo, **claves**: sin `workhub_cloud_backup_key:…` las copias cifradas de la cuenta no se abren, y sin `workhub_guest` un invitado deja de ver sus datos. Renombrarlas exige copiar cada una al nombre nuevo en todos los navegadores antes de dejar de leer la antigua, y actualizar la tabla de `legal/cookies/`. |
| Navegador, IndexedDB | `workhub-keys` (claves de los proyectos con cifrado total, no exportables), `workhub-backup-history` (versiones locales) | Una base de IndexedDB no se puede renombrar, y las claves de `workhub-keys` no se pueden copiar a otra: habría que pedir la contraseña de cifrado otra vez a todo el mundo. |
| Navegador, cachés | `workhub-shell-…`, `workhub-runtime` (service worker) | No guardan datos de nadie, pero cambiarles el nombre obliga a que el service worker nuevo borre las antiguas; no aporta nada. |
| Código | `window.Workhub`, `WORKHUB_FIREBASE`, `WorkhubConsent`, `WorkhubPlugin`, `workhub-plugin.js`, ids `workhub.*` de los plugins oficiales | Es la interfaz que usan los plugins ya publicados e instalados. |
| Firebase | Proyecto `workhub-26f50` y lo que cuelga de él: `workhub-26f50.firebaseapp.com`, `workhub-26f50.web.app`, `workhub-26f50.firebasestorage.app` | El identificador de un proyecto de Firebase no se puede cambiar. La única forma es crear otro proyecto y migrar cuentas y datos. Lo que sí se puede es que **no se vea**: el paso 9 de arriba (correo) y el acceso en el propio dominio, que ya está hecho. |
| Firebase y Google Cloud, consolas | Dominios autorizados, restricción de la clave de API y dominios de la clave de reCAPTCHA: `workhub.yalero.net`, `workhub-project.netlify.app` | Ver el paso 6. `workhub-project.netlify.app` **seguía respondiendo** el 7-oct-2026: mientras exista, se puede entrar por ahí. Al borrar el sitio de Netlify, quítalo de las tres listas y de `hostingDomains` en `firebase-config.js`. `workhub.yalero.net` solo redirige (salvo `/__/`), así que se puede quitar de las listas cuando `LEGACY_STATUS` pase a `301`. |
| Cloudflare | Worker `workhub` (`wrangler.jsonc`), dominio `workhub.yalero.net` | El nombre del Worker tiene que coincidir con el del panel y con la regla de Email Routing; renombrarlo es crear otro Worker y volver a poner secretos, dominios y reglas. |
| Pruebas | Proyecto de emulador `demo-workhub`, `start-workhub.bat`, variable `WORKHUB_HEALTH_ORIGIN` | Internos; no llegan a nadie. |

## Si cambias algo

- **Servicio externo nuevo** (otro CDN, una API…): añade su dominio a la `Content-Security-Policy` de `scripts/build-public.js`, o el navegador lo bloqueará.
- **Nunca** pongas en el repositorio secretos (el *client secret* de GitHub, claves de servicio…) ni `data-backup.json`. Lo que va en `firebase-config.js` no es secreto.
