# Publicar Workhub en Cloudflare

Cloudflare publica la web **desde la nube, cada vez que se fusiona algo en `main`**: no hace falta ningún ordenador encendido. Firebase sigue encargándose del inicio de sesión y de la base de datos (ver [FIREBASE.md](FIREBASE.md)); Cloudflare solo sirve los ficheros de la web, con su red mundial y protección contra ataques.

Se usa **Cloudflare Workers con recursos estáticos** (la pantalla de Cloudflare que pide *Build command*, *Deploy command* y *Preview command*). Qué está ya preparado en el repositorio:

- `scripts/build-public.js` copia **solo** `index.html`, `assets/`, `src/` y `plugins/` a `dist/` (`data-backup.json` y el resto **nunca** se publican) y genera `dist/_headers` con las cabeceras de seguridad (CSP, anti-marcos, HTTPS obligatorio…). Es la **única fuente** de esas cabeceras.
- `wrangler.jsonc` le dice a Cloudflare qué publicar (`dist/`), qué Worker ejecutar y a qué dominio conectarlo (`workhub.yalero.net`).
- `worker/index.js` es el Worker: reenvía `/__/auth/*` y `/__/firebase/*` a Firebase sin cambiar la dirección. Así el inicio de sesión (Google, GitHub) se completa en tu propio dominio y funciona también en Safari, Firefox estricto o Chrome con cookies de terceros bloqueadas. Solo reenvía esas rutas; no es un proxy abierto. Todo lo demás lo sirven los recursos estáticos.
- `src/config/firebase-config.js` lista `workhub.yalero.net` en `hostingDomains`, para que la app use ese dominio como `authDomain`.

---

## 1. Crear el proyecto

1. Entra en <https://dash.cloudflare.com> → **Workers y Pages** (*Workers & Pages*) → **Crear** (*Create application*) → **Importar un repositorio** (*Connect to Git*).
2. Autoriza a Cloudflare en GitHub y elige el repositorio **yalerooo/Workhub**.
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

## 2. El dominio `workhub.yalero.net`

`wrangler.jsonc` ya incluye el dominio, así que el despliegue lo conecta solo (crea el registro DNS y el certificado; tarda unos minutos). Compruébalo en el Worker → **Configuración** → **Dominios y rutas**. Si prefieres hacerlo a mano, borra el bloque `routes` de `wrangler.jsonc` y añade el dominio ahí.

Si el despliegue se queja de que el dominio ya existe, borra en **DNS** de `yalero.net` el registro `workhub` que hubiera de antes y vuelve a lanzar el despliegue.

## 3. Autorizar el dominio (imprescindible para entrar)

Hazlo **todo antes** de probar el acceso; si falta algo, Google o GitHub darán un error de redirección.

1. **Firebase** → Authentication → Settings → **Authorized domains** → añade `workhub.yalero.net`.
2. **Google**: <https://console.cloud.google.com/apis/credentials> (proyecto **workhub-26f50**) → *IDs de clientes de OAuth 2.0* → **Web client (auto created by Google Service)**:
   - *Orígenes de JavaScript autorizados*: `https://workhub.yalero.net`
   - *URIs de redireccionamiento autorizados*: `https://workhub.yalero.net/__/auth/handler`
3. **GitHub**: <https://github.com/settings/developers> → tu OAuth App **Workhub** → en *Authorization callback URL* pon `https://workhub.yalero.net/__/auth/handler`. Una OAuth App de GitHub puede aceptar **una sola** URL de callback: si cambias la de Netlify por la nueva, la de Netlify deja de funcionar (es lo esperado si ya no lo usas). Esa misma app es la de «Conectar con GitHub» en Ajustes (integración con GitHub Projects).
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
- **Firebase Hosting** (`https://workhub-26f50.web.app`, mismos datos) sigue configurado en `firebase.json` como alternativa de emergencia: `firebase deploy --only hosting`. **No lleva las cabeceras de seguridad** de `_headers`, que son propias de Cloudflare.

## Registros y trazas

`wrangler.jsonc` incluye el bloque `observability`: registros, trazas e incidencias del Worker (el reenvío del login), que se ven en el Worker → **Observabilidad**. Cloudflare avisa con «Update your Wrangler configuration…» cuando lo que hay activado en el panel no coincide con este fichero; se copia aquí para que los despliegues no lo cambien. Si algún día cambias esos interruptores en el panel y sale ese aviso, copia el bloque que te propone. Está `redact_query_string` en `true` para que los registros no guarden los parámetros de las URL del login.

## Si algo falla

- **La compilación dice que el Worker no coincide**: el nombre del proyecto en Cloudflare tiene que ser igual a `"name"` en `wrangler.jsonc` (`workhub`).
- **El acceso da error de redirección**: falta alguno de los pasos del apartado 3, o los cambios de Google tardan unos minutos en aplicarse.
- **`/__/auth/handler` da 404**: el Worker no se desplegó o no se ejecuta. Mira el registro de la última compilación y que `wrangler.jsonc` esté en la raíz del repositorio.
- **La web carga sin estilos o sin scripts**: casi siempre es la CSP. Abre la consola del navegador: el mensaje dice qué dominio se bloqueó; añádelo a `CSP` en `scripts/build-public.js`.
