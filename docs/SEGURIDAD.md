# Seguridad del acceso a Workhub

Cualquiera puede crearse una cuenta en Workhub; cada persona solo ve y toca sus propios datos. Esta guía explica qué protege Workhub desde el propio código y qué tienes que activar tú en la consola de Firebase. La parte del código ya está hecha. Los pasos de la consola, que están más abajo, se hacen **una sola vez**.

## Lo que ya hace el código

| Riesgo | Protección |
|---|---|
| Un usuario lee o modifica los datos de otro | Cada cuenta solo puede leer y escribir en `users/{su uid}/…`. Lo impide el servidor (`firestore.rules`), no la app. |
| Cuentas en masa con correos inventados para llenar la base de datos | Quien se registra con correo y contraseña tiene que **verificar el correo** antes de leer o guardar nada. Lo exige el servidor, y la app muestra la pantalla "Verifica tu correo". Google y GitHub ya llegan verificados por el proveedor. |
| Usar tu Firestore como almacén de cualquier cosa | Cada usuario solo puede escribir en las colecciones que usa la app (tareas, notas, clientes, contactos, reuniones, contraseñas, proyectos, imágenes, ajustes y plugins). Cualquier otra ruta está cerrada. |
| Un plugin de terceros intenta leer tus datos o tu sesión | Cada plugin corre en un `<iframe sandbox>` sin `allow-same-origin`: no ve la página, ni la sesión, ni el almacenamiento de Workhub. Solo habla por mensajes, cada llamada se comprueba contra los permisos aprobados, ninguno da acceso a las contraseñas, y hay un límite de escrituras por minuto. Ver [PLUGINS.md](PLUGINS.md). |
| Tras cerrar sesión, los datos quedan en el ordenador | Al cerrar sesión se borra la copia local de Firestore (IndexedDB) y el último proyecto recordado. |
| Otra web mete Workhub en un marco invisible para robarte clics (*clickjacking*) | Cabeceras `X-Frame-Options: DENY` y `frame-ancestors 'none'` (`netlify.toml`). |
| Inyección de código (XSS) | Todo lo que escribe el usuario se escapa antes de pintarse. Además, la **política de seguridad de contenido (CSP)** solo permite scripts de Workhub y del SDK de Firebase/Google. Prohíbe scripts en línea y `eval`, así que aunque se colara HTML, no ejecutaría nada. |
| Nombre o foto del perfil de Google/GitHub manipulados | El nombre se pinta como texto y la foto solo se acepta si es `https:`. |
| Conexión sin cifrar | HTTPS obligatorio (`Strict-Transport-Security`). |
| Contraseñas débiles | Mínimo de 8 caracteres para cuentas nuevas y para la contraseña maestra de las contraseñas. |
| Adivinar si un correo tiene cuenta | "Recuperar contraseña" responde lo mismo exista o no la cuenta. |
| Fuerza bruta contra el inicio de sesión | Firebase bloquea temporalmente tras muchos intentos (`auth/too-many-requests`). |
| Robo de la base de datos | Las contraseñas guardadas van cifradas en tu navegador (AES-256 + PBKDF2) antes de subir. En Firestore solo hay texto cifrado. |

## Lo que tienes que hacer en la consola (una vez)

### 1. Publicar las reglas nuevas

Con la terminal, en la carpeta de Workhub:

```bash
firebase deploy --only firestore:rules
```

Sin terminal: **Firestore Database** → **Reglas**, borra el texto del editor, pega el contenido de `firestore.rules` y pulsa **Publicar**. El botón solo aparece cuando el texto cambia.

Si entras con correo y contraseña y nunca verificaste tu correo, la app te pedirá hacerlo una vez. Con Google o GitHub no cambia nada.

### 2. Deja activado el registro

**Authentication** → **Settings** → **Acciones del usuario**: **Habilitar creación (registro)** debe seguir **marcado**, para que cualquiera pueda crearse una cuenta.

### 3. Correo de verificación en español (opcional)

**Authentication** → **Templates** → **Verificación de dirección de correo electrónico**: pulsa el lápiz y cambia el idioma de la plantilla a **Español** y el nombre del remitente a "Workhub".

### 4. Política de contraseñas

**Authentication** → **Settings** → **Política de contraseñas** (*Password policy*): activa **Requerir** (*Require enforcement*) con un mínimo de 8 caracteres y, si quieres, mayúsculas, minúsculas y números. Así el mínimo lo exige el servidor, no solo la app.

Si entras con correo y contraseña y la tuya no cumple la política, Firebase te pedirá cambiarla.

### 5. Protección contra la enumeración de correos

**Authentication** → **Settings** → comprueba que **Protección de enumeración de correo electrónico** (*Email enumeration protection*) está **activada**. En proyectos nuevos viene activada.

### 6. Dominios autorizados

**Authentication** → **Settings** → **Dominios autorizados**. Deja solo los que usas:

- `workhub-project.netlify.app`
- `workhub-26f50.firebaseapp.com` (lo necesita el inicio de sesión)

Quita `localhost` si no desarrollas en tu ordenador con el proyecto real, y `workhub-26f50.web.app` si no usas Firebase Hosting.

### 7. Restringir la clave de API (recomendado)

La `apiKey` de `firebase-config.js` es pública por diseño: identifica el proyecto, no da acceso a los datos. Aun así, puedes limitar desde dónde se puede usar:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials?project=workhub-26f50) → **Credenciales** → **Browser key (auto created by Firebase)**.
2. **Restricciones de aplicaciones** → **Sitios web** → añade:
   - `https://workhub-project.netlify.app/*`
   - `https://workhub-26f50.firebaseapp.com/*`
3. **Guardar**. Espera unos minutos y comprueba que puedes entrar. Si algo falla, vuelve a poner **Ninguna** y guarda.

### 8. Protege la cuenta con la que entras

Quien entre en tu cuenta de Google o GitHub entra también en Workhub. Activa la **verificación en dos pasos** en esas cuentas:

- Google: <https://myaccount.google.com/signinoptions/twosv>
- GitHub: **Settings** → **Password and authentication** → **Two-factor authentication**

Es la protección más importante de todas.

## Si cambias algo

- **Servicio externo nuevo** (otro CDN, una API…): añade su dominio a la `Content-Security-Policy` de `netlify.toml`, o el navegador lo bloqueará.
- **Nunca** pongas en el repositorio secretos (el *client secret* de GitHub, claves de servicio…) ni `data-backup.json`. Lo que va en `firebase-config.js` no es secreto.
