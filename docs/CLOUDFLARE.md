# Publicar Kanlane en Cloudflare

Cloudflare publica la web **desde la nube, cada vez que se fusiona algo en `main`**: no hace falta ningún ordenador encendido. Firebase sigue encargándose del inicio de sesión y de la base de datos (ver [FIREBASE.md](FIREBASE.md)); Cloudflare solo sirve los ficheros de la web, con su red mundial y protección contra ataques.

Se usa **Cloudflare Workers con recursos estáticos** (la pantalla de Cloudflare que pide *Build command*, *Deploy command* y *Preview command*). Qué está ya preparado en el repositorio:

- `scripts/build-public.js` copia **solo** `index.html`, `assets/`, `src/` y `plugins/` a `dist/` (`data-backup.json` y el resto **nunca** se publican), une los scripts y estilos de cada página en `dist/assets/bundle/` (`scripts/bundle.js`) y genera `dist/_headers` con las cabeceras de seguridad (CSP, anti-marcos, HTTPS obligatorio…). Es la **única fuente** de esas cabeceras.
- El JavaScript se publica **minificado** (`scripts/minify.js`, con terser). El *Build command* no cambia: si terser no está instalado, el propio script hace `npm ci` en `scripts/` antes de seguir, y si no puede, la publicación falla y se queda la versión anterior.
- `wrangler.jsonc` le dice a Cloudflare qué publicar (`dist/`), qué Worker ejecutar y a qué dominios conectarlo (ver «Dominios» más abajo).
- `worker/index.js` es el Worker: reenvía `/__/auth/*` y `/__/firebase/*` a Firebase sin cambiar la dirección. Así el inicio de sesión (Google, GitHub) se completa en tu propio dominio y funciona también en Safari, Firefox estricto o Chrome con cookies de terceros bloqueadas. Solo reenvía esas rutas; no es un proxy abierto. Todo lo demás lo sirven los recursos estáticos.
- `src/config/firebase-config.js` lista los dominios en `hostingDomains`, para que la app use ese dominio como `authDomain`.

---

## 1. Crear el proyecto

1. Entra en <https://dash.cloudflare.com> → **Workers y Pages** (*Workers & Pages*) → **Crear** (*Create application*) → **Importar un repositorio** (*Connect to Git*).
2. Autoriza a Cloudflare en GitHub y elige el repositorio **yalerooo/Kanlane**.
3. **Nombre del proyecto: `workhub`.** Tiene que ser igual al campo `"name"` de `wrangler.jsonc`; si usas otro nombre, cambia ese campo (o el compilado falla).
4. Rama de producción: **`main`**.
5. Configuración de compilación:

   | Campo | Valor |
   |---|---|
   | *Build command* (comando de compilación) | `node scripts/build-public.js` |
   | *Deploy command* (comando de despliegue) | `npx wrangler deploy` |
   | *Preview command* / *Non-production branch deploy command* (comando de vista previa) | `npx wrangler versions upload` |
   | *Root directory* (directorio raíz) | `/` (vacío) |
   | Variable de compilación (opcional) | `NODE_VERSION` = `20` |

   El comando de despliegue publica la rama `main`; el de vista previa se usa para las demás ramas y las PR, sin tocar producción.
6. **Guardar y desplegar**. Al terminar, la web está en `https://workhub.<tu-subdominio>.workers.dev` y, si el paso 2 va bien, en `https://workhub.yalero.net`.

## Dominios (migración de Workhub a Kanlane)

La web se sirve ahora desde **cuatro dominios que apuntan al mismo Worker** (`wrangler.jsonc`):

| Dominio | Qué hace |
|---|---|
| **kanlane.com** | El definitivo: el que ve la gente y el que indexa Google. |
| **kanlane.yalero.net** | Respaldo: sirve la misma web con `X-Robots-Tag: noindex` (Google solo ve el definitivo). |
| **www.kanlane.com** | Redirige a kanlane.com. |
| **workhub.yalero.net** | Nombre antiguo: redirige a kanlane.com (y entrega un service worker que se desinstala solo, para quien tenga la app instalada). |

- **Redirección temporal (302)** mientras se prueba; cuando todo funcione se pone `"LEGACY_STATUS": "301"` en `wrangler.jsonc`. Una 301 se queda en la caché del navegador y es difícil de deshacer.
- **Marcha atrás si kanlane.com da problemas:** en `wrangler.jsonc` cambia `"REDIRECT_TARGET": "https://kanlane.com"` por `"https://kanlane.yalero.net"` y despliega. Los antiguos pasan a redirigir al respaldo y este deja de llevar `noindex`. **No es automática**: una redirección no sabe si su destino está caído.
- `run_worker_first` hace que **solo las páginas y las rutas del propio Worker** pasen por él (`/`, `/app/*`, `/demo/*`, `/legal/*`, `/sw.js`, `/__/auth/*`, `/__/firebase/*`, `/__/kms/*`…). **Toda ruta que atienda el Worker tiene que estar en esa lista**: con `"not_found_handling": "404-page"`, lo que no es un archivo no llega al Worker y responde la página 404 (así se rompió el acceso con Google el 7-oct-2026). Así, los scripts, estilos e imágenes no gastan peticiones del plan gratuito (100 000 al día).
- Cada dominio es un **origen distinto** para el navegador: sesión, modo invitado, datos locales y app instalada no se comparten entre ellos. Los datos de la nube (Firebase) son los mismos.
- Pruebas: `node tests/worker/domains.test.js`.

### Lo que hay que hacer a mano (en las consolas)

1. **Cloudflare:** el dominio `kanlane.com` tiene que estar en tu cuenta (si lo compraste en otro registrador, añade el sitio a Cloudflare y cambia los servidores de nombres). Al desplegar, el Worker conecta solo `kanlane.com`, `www.kanlane.com`, `kanlane.yalero.net` y `workhub.yalero.net`. Comprueba en el Worker → **Configuración** → **Dominios y rutas**.
2. **Firebase** → Authentication → Settings → **Authorized domains**: añade `kanlane.com` y `kanlane.yalero.net` (deja `workhub.yalero.net` mientras redirija).
3. **Google** (Cloud Console, proyecto **workhub-26f50** → Credenciales → *Web client*): en *Orígenes de JavaScript autorizados* añade `https://kanlane.com` y `https://kanlane.yalero.net`; en *URIs de redireccionamiento* añade `https://kanlane.com/__/auth/handler` y `https://kanlane.yalero.net/__/auth/handler`.
4. **GitHub** (OAuth App): *Authorization callback URL* = `https://kanlane.com/__/auth/handler`. **Una OAuth App solo admite una dirección**: si algún día usas el respaldo (`kanlane.yalero.net`), el acceso con GitHub allí no funcionará hasta que cambies esa dirección. Google y el correo sí funcionan en todos.
5. **reCAPTCHA Enterprise / App Check** (clave `appCheckSiteKey`): añade `kanlane.com` y `kanlane.yalero.net` a los **dominios permitidos** de la clave; si no, App Check rechazará al cliente nuevo.
6. **Restricción de la clave de API** (si la activaste, [SEGURIDAD.md](SEGURIDAD.md) punto 7): añade `https://kanlane.com/*` y `https://kanlane.yalero.net/*`.
7. **Search Console**: da de alta `kanlane.com` (verificación por registro TXT en el DNS de Cloudflare), envía `https://kanlane.com/sitemap.xml` y pide indexar `/`. Para el sitio antiguo, usa la herramienta de *cambio de dirección* de Search Console cuando pases a 301.

## 2. El dominio `workhub.yalero.net` (antiguo)

`wrangler.jsonc` ya incluye el dominio, así que el despliegue lo conecta solo (crea el registro DNS y el certificado; tarda unos minutos). Compruébalo en el Worker → **Configuración** → **Dominios y rutas**. Si prefieres hacerlo a mano, borra el bloque `routes` de `wrangler.jsonc` y añade el dominio ahí.

Si el despliegue se queja de que el dominio ya existe, borra en **DNS** de `yalero.net` el registro `workhub` que hubiera de antes y vuelve a lanzar el despliegue.

## 3. Autorizar el dominio (imprescindible para entrar)

Hazlo **todo antes** de probar el acceso; si falta algo, Google o GitHub darán un error de redirección.

1. **Firebase** → Authentication → Settings → **Authorized domains** → añade `workhub.yalero.net`.
2. **Google**: <https://console.cloud.google.com/apis/credentials> (proyecto **workhub-26f50**) → *IDs de clientes de OAuth 2.0* → **Web client (auto created by Google Service)**:
   - *Orígenes de JavaScript autorizados*: `https://workhub.yalero.net`
   - *URIs de redireccionamiento autorizados*: `https://workhub.yalero.net/__/auth/handler`
3. **GitHub**: <https://github.com/settings/developers> → tu OAuth App **Kanlane** → en *Authorization callback URL* pon `https://workhub.yalero.net/__/auth/handler`. Una OAuth App de GitHub puede aceptar **una sola** URL de callback: si cambias la de Netlify por la nueva, la de Netlify deja de funcionar (es lo esperado si ya no lo usas). Esa misma app es la de «Conectar con GitHub» en Ajustes (integración con GitHub Projects).
4. *(Opcional)* Restringe la clave de API a `https://workhub.yalero.net/*` (ver [SEGURIDAD.md](SEGURIDAD.md), punto 7).

## 4. Comprobar

- Abre `https://workhub.yalero.net/__/auth/handler`: debe salir una página de Firebase con el mensaje *«Unable to process request due to missing initial state…»*. **Es lo normal**: esa página solo funciona dentro de un inicio de sesión, y significa que el reenvío al login de Firebase funciona. Mala señal sería un 404 o una página de error de Cloudflare.
- Inicia sesión con Google y con GitHub, en Chrome y en Safari o Firefox.
- Abre las herramientas del navegador → pestaña *Red*: la respuesta de la página debe llevar `content-security-policy` y `strict-transport-security`.

## 5. Día a día

- **Publicar cambios**: fusiona el PR en `main`. Cloudflare compila y publica solo; el progreso está en el Worker → **Implementaciones** (*Deployments*) y en **Compilaciones** (*Builds*).
- **Vista previa de cada rama o PR**: el comando `npx wrangler versions upload` sube una versión con su propia dirección, sin cambiar producción. En ellas no se puede iniciar sesión (el dominio no está autorizado en Firebase); sirven para ver el diseño.
- **Volver atrás**: en *Implementaciones*, elige una versión anterior → **Restaurar** (*Rollback*).
- **Reglas de seguridad de Firestore**: siguen subiéndose con `firebase deploy --only firestore:rules` (o pegándolas en la consola), solo cuando cambia `firestore.rules`. Ver [SEGURIDAD.md](SEGURIDAD.md).
- **Cabeceras de seguridad**: se cambian en `scripts/build-public.js` (constantes `ALL`, `PAGE` y `CSP`) y se aplican solas en la siguiente publicación. Si añades un servicio externo, añade su dominio a `CSP`.

## Secreto del modo «Gestionado por Kanlane» (KMS_MASTER_V1)

Los proyectos creados como **«Gestionado por Kanlane»** (ver [CIFRADO-PROYECTOS.md](CIFRADO-PROYECTOS.md), apartado 12) guardan su clave envuelta con otra que calcula el Worker (`POST /__/kms/v1/kek`) a partir de un secreto, `KMS_MASTER_V1`. Ese secreto **no está en el repositorio ni en `wrangler.jsonc`**: se pone una sola vez a mano.

1. Genera 32 bytes aleatorios en base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. **Antes de nada, guarda una copia fuera de Cloudflare** (gestor de contraseñas y papel en un lugar seguro). **Si el secreto se pierde o se cambia, todos los proyectos gestionados quedan ilegibles para siempre**: no hay contraseña ni clave de recuperación que los abra. Cloudflare no permite volver a leer un secreto una vez guardado.
3. Guárdalo en el Worker: `npx wrangler secret put KMS_MASTER_V1` y pega el valor (o, en el panel: Worker `workhub` → **Configuración** → **Variables y secretos** → *Añadir* → tipo **Secreto**). Los despliegues no lo tocan.
4. Publica las reglas de Firestore de esta versión (admiten `enc.mode: 'managed'` y el envoltorio `kms`).
5. Comprueba en producción: crear un proyecto «Gestionado por Kanlane», recargar, cerrar sesión, volver a entrar y abrirlo en otro navegador.

Mientras el secreto no esté puesto, el Worker responde 503 y crear un proyecto gestionado falla con el mensaje «El servidor de claves de Kanlane no está disponible ahora» (no se crea nada a medias). Para retirar la opción sin tocar lo ya creado: `managedEncryption: false` en `src/config/features.js` (la tarjeta vuelve a «Próximamente»; los proyectos gestionados que existan se siguen abriendo y siguen necesitando el Worker y su secreto).

La ruta solo acepta `POST` del propio dominio con un ID token de Firebase válido (firma, proyecto, caducidad y correo verificado), comparte el límite de peticiones `AUTH_RATE_LIMIT` y no guarda nada. No se debe poner nunca el secreto en `vars`, en el código ni en un PR.

El mismo secreto sirve a la **verificación en dos pasos de las contraseñas** (`POST /__/kms/v1/totp`, ver [SEGURIDAD.md](SEGURIDAD.md#verificación-en-dos-pasos-de-las-contraseñas)). Esa ruta necesita además el límite `TOTP_RATE_LIMIT` de `wrangler.jsonc` (3 intentos por minuto y cuenta), que se crea al desplegar; sin él responde 503. Para retirar la opción: `vaultTotp: false` en `src/config/features.js`.

## 6. Recomendado en el panel de Cloudflare

Todo esto es gratis y opcional:

- **SSL/TLS** → modo **Completo (estricto)** (*Full (strict)*) y **Usar siempre HTTPS**.
- **Seguridad** → **Bot Fight Mode**, y reglas de límite de peticiones (*Rate limiting*) si ves abusos.
- **Turnstile** (su alternativa gratuita a los captcha) si se llenan de cuentas falsas: se puede añadir a la pantalla de registro.
- **Analítica web** sin cookies, si quieres saber cuánta gente entra.

## Límites del plan gratuito

Las peticiones a los ficheros de la web son **gratis e ilimitadas**. El código del Worker (solo el reenvío del inicio de sesión) admite 100 000 peticiones al día, y cada inicio de sesión gasta muy pocas. Además hay un máximo de ficheros por versión y de tamaño por fichero, y un número de minutos de compilación al mes. Consulta los límites actuales en <https://developers.cloudflare.com/workers/platform/limits/>.

## ¿Y Netlify y Firebase Hosting?

- **Netlify** ya no se usa: el fichero `netlify.toml` se eliminó. El sitio antiguo (`workhub-project.netlify.app`) sigue en `hostingDomains` para que, mientras exista, el acceso siga funcionando ahí; quítalo cuando lo borres, y bórralo también de los dominios autorizados.
- **Firebase Hosting** (`https://workhub-26f50.web.app`, mismos datos) sigue configurado en `firebase.json` como alternativa de emergencia: `firebase deploy --only hosting`. **No lleva las cabeceras de seguridad** de `_headers`, que son propias de Cloudflare, y no publica `/.well-known/` (su `ignore` descarta lo que empieza por punto): ahí `security.txt` solo está en `/security.txt`.

## Registros y trazas

`wrangler.jsonc` incluye el bloque `observability`: registros, trazas e incidencias del Worker (el reenvío del login), que se ven en el Worker → **Observabilidad**. Cloudflare avisa con «Update your Wrangler configuration…» cuando lo que hay activado en el panel no coincide con este fichero; se copia aquí para que los despliegues no lo cambien. Si algún día cambias esos interruptores en el panel y sale ese aviso, copia el bloque que te propone. Está `redact_query_string` en `true` para que los registros no guarden los parámetros de las URL del login.

## Si algo falla

- **La compilación dice que el Worker no coincide**: el nombre del proyecto en Cloudflare tiene que ser igual a `"name"` en `wrangler.jsonc` (`workhub`).
- **El acceso da error de redirección**: falta alguno de los pasos del apartado 3, o los cambios de Google tardan unos minutos en aplicarse.
- **`/__/auth/handler` da 404**: si sale la página 404 de Kanlane, falta `/__/auth/*` (o `/__/firebase/*`) en `run_worker_first` de `wrangler.jsonc`. Si no, el Worker no se desplegó o no se ejecuta. Mira el registro de la última compilación y que `wrangler.jsonc` esté en la raíz del repositorio.
- **La web carga sin estilos o sin scripts**: casi siempre es la CSP. Abre la consola del navegador: el mensaje dice qué dominio se bloqueó; añádelo a `CSP` en `scripts/build-public.js`.

## Tareas por correo

El mismo Worker recibe el correo de los proyectos que activan las tareas por correo (Cloudflare Email Routing → manejador `email`). Necesita el secreto `CAPTURE_SECRET`, las variables `CAPTURE_DOMAINS` y `CAPTURE_PLAN` de `wrangler.jsonc` y una regla de Email Routing por dominio. Pasos, límites y costes: `docs/CAPTURA-EMAIL.md`.
