# Publicar Kanlane en la web con Firebase

Esta guía deja Kanlane publicado en `https://TU-PROYECTO.web.app` con:

- inicio de sesión con **Google, GitHub, Microsoft y correo/contraseña**;
- los datos de cada usuario en **Firestore**, separados y protegidos por reglas;
- el plan gratuito **Spark**, que no pausa ni borra el proyecto por inactividad.

Se tarda unos 20–30 minutos. Todo se hace desde la consola de Firebase y una terminal; no hay que tocar código salvo pegar la configuración.

---

## 1. Crear el proyecto

1. Entra en <https://console.firebase.google.com> y pulsa **Crear un proyecto**.
2. Ponle un nombre (por ejemplo `workhub`). Google Analytics no hace falta: puedes desactivarlo.
3. Cuando termine, verás el panel del proyecto. El **ID del proyecto** (por ejemplo `workhub-1a2b3`) aparece en ⚙ **Configuración del proyecto** y se usa en varias URLs de esta guía.

## 2. Registrar la app web y copiar la configuración

1. En el panel del proyecto pulsa el icono **Web** (`</>`) para añadir una app.
2. Nombre: `Kanlane`. **No** marques "Firebase Hosting" en este paso; lo haremos con la terminal.
3. Firebase te muestra un bloque `const firebaseConfig = { … }`. Copia esos valores en
   `src/config/firebase-config.js`:

   ```js
   window.WORKHUB_FIREBASE = {
     apiKey: 'AIza…',
     authDomain: 'workhub-1a2b3.firebaseapp.com',
     projectId: 'workhub-1a2b3',
     storageBucket: 'workhub-1a2b3.appspot.com',
     messagingSenderId: '1234567890',
     appId: '1:1234567890:web:abcdef',
     providers: ['google', 'github', 'microsoft', 'password'],
     useEmulators: false
   };
   ```

   Estos valores **no son secretos**: solo identifican el proyecto. Lo que protege los datos son las reglas del paso 5, así que puedes subirlos al repositorio.

4. En `providers` deja solo los botones que vayas a activar en el paso 3. Posibles: `google`, `github`, `microsoft`, `apple`, `password`.

## 3. Activar los métodos de inicio de sesión

Consola → **Authentication** → **Comenzar** → pestaña **Sign-in method**.

### Correo y contraseña
**Añadir proveedor** → **Correo electrónico/contraseña** → activa la primera opción → Guardar.

### Google
**Añadir proveedor** → **Google** → activar → elige tu correo como "correo de asistencia" → Guardar. No hace falta nada más.

### GitHub
1. En Firebase: **Añadir proveedor** → **GitHub** → activar. Copia la **URL de devolución de llamada** que te muestra, del tipo
   `https://workhub-1a2b3.firebaseapp.com/__/auth/handler`. Deja la ventana abierta.
2. En GitHub: <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
   - *Application name*: `Kanlane`
   - *Homepage URL*: `https://workhub-1a2b3.web.app`
   - *Authorization callback URL*: la URL del paso anterior.
3. Pulsa **Register application**, luego **Generate a new client secret**.
4. Vuelve a Firebase y pega el **Client ID** y el **Client secret** → Guardar.

### Microsoft (cuentas personales y de empresa)
1. En Firebase: **Añadir proveedor** → **Microsoft** → activar. Copia la **URL de devolución de llamada** (la misma forma que la de GitHub).
2. En Azure: <https://portal.azure.com> → **Microsoft Entra ID** → **Registros de aplicaciones** → **Nuevo registro**.
   - *Nombre*: `Kanlane`
   - *Tipos de cuenta admitidos*: **Cuentas de cualquier directorio organizativo y cuentas personales de Microsoft**.
   - *URI de redirección*: plataforma **Web** y la URL copiada de Firebase.
3. Tras crearla, copia el **Id. de aplicación (cliente)**.
4. **Certificados y secretos** → **Nuevo secreto de cliente** → copia el **Valor** (solo se muestra una vez).
5. En Firebase pega el Id. de aplicación y el secreto → Guardar.

> **Una cuenta por correo, y se pueden unir.** Firebase no deja tener dos cuentas con el mismo correo. Si alguien entró con Google y luego prueba con GitHub usando el mismo correo, Kanlane le explica que entre ahora con el método original (Google, o correo y contraseña); al hacerlo, GitHub se une **a esa misma cuenta** (mismo usuario, mismos datos) y desde entonces puede entrar con cualquiera de los dos. Solo se une si el correo coincide y después de entrar con la cuenta original, así nadie puede apoderarse de una cuenta ajena. Si la segunda vez que intenta entrar cierra la página antes de hacerlo, tendrá que repetir el intento con GitHub.

### Dominios autorizados
En **Authentication** → **Settings** → **Authorized domains** ya están `localhost`, `TU-PROYECTO.web.app` y `TU-PROYECTO.firebaseapp.com`. Si usas un dominio propio (paso 7), añádelo aquí.

## 4. Crear la base de datos

Consola → **Firestore Database** → **Crear base de datos**.

- Modo: **Producción** (las reglas de este repositorio se subirán en el paso 5).
- Ubicación: una cercana, por ejemplo `eur3 (europe-west)`. **No se puede cambiar después.**

## 5. Publicar la web y las reglas de seguridad

Necesitas [Node.js](https://nodejs.org) instalado. En una terminal, dentro de la carpeta de Kanlane:

```bash
npm install -g firebase-tools     # una sola vez
firebase login                    # abre el navegador para entrar con tu cuenta de Google
firebase use --add                # solo si cambias de proyecto (.firebaserc ya apunta a workhub-26f50)
firebase deploy --only hosting,firestore
```

Al terminar verás la dirección, por ejemplo `https://workhub-1a2b3.web.app`. Ábrela y ya puedes crear tu cuenta.

Qué se publica:

- **Hosting**: solo la app. Antes de subir, `firebase deploy` ejecuta `scripts/build-public.js`, que copia **únicamente** `index.html`, `assets/` y `src/` a la carpeta `dist/`, y se publica esa carpeta. Así `data-backup.json`, `docs/`, el `README` o el `.bat` **nunca se publican**, aunque estén en la carpeta. El script también avisa si la configuración sigue vacía o si `useEmulators` está en `true`.
- **Firestore**: las reglas de `firestore.rules`. Cada usuario solo puede leer y escribir en `users/{su uid}/…`, en las colecciones de la app; las cuentas de correo y contraseña, además, tienen que haber verificado el correo. Todo lo demás está cerrado. Más detalles en [SEGURIDAD.md](SEGURIDAD.md).

Para publicar cambios más adelante, repite solo `firebase deploy --only hosting`.

## 6. Pasar tus datos actuales a la versión web

1. En tu versión actual (local o claude.ai): **Copia de seguridad** → **Exportar copia de seguridad**.
2. En la web, entra con tu cuenta y **antes de crear la contraseña maestra** ve a **Copia de seguridad** → **Importar** y elige el archivo.

Así se importan también las contraseñas cifradas. Después, en **Contraseñas**, se desbloquean con la misma contraseña maestra que usabas. Si ya habías creado una contraseña maestra en la web, las contraseñas del archivo se omiten para no dejarlas ilegibles.

Las imágenes adjuntas a las notas no viajan en la copia de seguridad.

## 7. Dominio propio (opcional)

Consola → **Hosting** → **Añadir dominio personalizado** y sigue las instrucciones (registros DNS en tu proveedor de dominio). Después añade ese dominio en **Authentication → Settings → Authorized domains**.

---

## Cómo funciona por dentro

- `src/config/firebase-config.js`: si `apiKey` está vacío, Kanlane funciona como siempre (modo local en el navegador, o dentro de claude.ai). Abierto como archivo (`file://`) también usa el modo local, porque el acceso con Google y compañía necesita una web `http(s)`.
- `src/services/firebase-backend.js`: carga el SDK de Firebase (versión *compat*) desde el CDN de Google, gestiona la sesión y entrega a la app la misma interfaz de datos que ya usaba: `collection`, `doc`, `where`, `orderBy` y `onSnapshot`. Los modelos, vistas y controladores no saben que hay Firebase detrás.
- **Datos:** todo cuelga de `users/{uid}`: `tasks` (con la subcolección `notes`), `clients`, `contacts`, `meetings`, `vault`, `vault_meta` y `assets`, además de `settings/preferences` (color de acento y tema) y `plugins` (plugins instalados), comunes a todos los proyectos. Los datos que guarda cada plugin van en `plugin_data`, por proyecto. Esos datos son los del **proyecto principal**; los **proyectos de equipo** (compartidos) viven aparte, en `teams/{id}` (ver [EQUIPOS.md](EQUIPOS.md)); cada proyecto adicional está en `projects/{id}` (nombre y color) y guarda las mismas colecciones debajo: `projects/{id}/tasks`, `projects/{id}/clients`, etc. Las reglas ya cubren todo lo que hay bajo `users/{uid}`, así que no hay que cambiarlas.
- **Imágenes de las notas:** se comprimen en el navegador (lado máximo 1600 px, JPEG) y se guardan en `users/{uid}/assets` dentro de Firestore. Así no hace falta Cloud Storage, que exige el plan de pago.
- **Contraseñas:** se cifran en el navegador con tu contraseña maestra antes de subir nada. En Firestore solo hay texto cifrado.
- **Sin conexión:** Firestore guarda una caché local, así que la app carga al instante y aguanta cortes de conexión cortos.
- **Cerrar sesión:** desde el pie de la barra lateral, desde **Ajustes** (también en móvil) o desde la paleta (`Ctrl K` → "Cerrar sesión").

## Límites del plan gratuito (Spark)

Firestore gratis: 1 GiB almacenado, 50.000 lecturas, 20.000 escrituras y 20.000 borrados al día. Hosting: 10 GB almacenados y 360 MB/día de transferencia. De sobra para uso personal o de un equipo pequeño. Consulta los límites actuales en <https://firebase.google.com/pricing>.

## Desarrollo local con emuladores (opcional)

Para probar sin tocar el proyecto real:

```bash
firebase emulators:start --only auth,firestore --project demo-workhub
```

En otra terminal sirve la app (`python -m http.server 5500`; o `node scripts/build-public.js` y añade `hosting` a `--only` para usar el emulador de alojamiento en <http://localhost:5000>) y en `src/config/firebase-config.js` pon valores de prueba (`apiKey: 'demo'`, `projectId: 'demo-workhub'`) y `useEmulators: true`. La interfaz de los emuladores está en <http://localhost:4000>.

**No olvides volver a poner `useEmulators: false` antes de publicar.**
