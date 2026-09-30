# Publicar Workhub en Cloudflare Pages

Cloudflare Pages publica la web **desde la nube, cada vez que se fusiona algo en `main`**: no hace falta ningún ordenador encendido. Firebase sigue encargándose del inicio de sesión y de la base de datos (ver [FIREBASE.md](FIREBASE.md)); Cloudflare solo sirve los ficheros de la web, con su red mundial y protección contra ataques.

Qué está ya preparado en el repositorio:

- `scripts/build-public.js` copia **solo** `index.html`, `assets/`, `src/` y `plugins/` a `dist/` (`data-backup.json` y el resto **nunca** se publican) y genera `dist/_headers` con las cabeceras de seguridad (CSP, anti-marcos, HTTPS obligatorio…). Es la **única fuente** de esas cabeceras.
- `functions/__/[[path]].js` es una *Pages Function* que reenvía `/__/auth/*` y `/__/firebase/*` a Firebase sin cambiar la dirección. Así el inicio de sesión (Google, GitHub) se completa en tu propio dominio y funciona también en Safari, Firefox estricto o Chrome con cookies de terceros bloqueadas. Solo reenvía esas rutas; no es un proxy abierto.
- `src/config/firebase-config.js` lista `workhub.yalero.net` en `hostingDomains`, para que la app use ese dominio como `authDomain`.

---

## 1. Crear el proyecto en Cloudflare Pages

1. Entra en <https://dash.cloudflare.com> → **Workers y Pages** (*Workers & Pages*) → **Crear** → pestaña **Pages** → **Conectar con Git**.
2. Autoriza a Cloudflare en GitHub y elige el repositorio **yalerooo/Workhub**. Rama de producción: **`main`**.
3. Configuración de compilación:
   - *Framework preset*: **Ninguno**.
   - *Build command*: `node scripts/build-public.js`
   - *Build output directory*: `dist`
   - *Root directory*: vacío.
   - *Variables de entorno* (opcional): `NODE_VERSION` = `20`.
4. **Guardar y desplegar**. Al terminar tienes la web en `https://<nombre>.pages.dev`. La carpeta `functions/` se detecta sola.

## 2. Conectar `workhub.yalero.net`

En el proyecto de Pages → **Dominios personalizados** → **Configurar un dominio personalizado** → `workhub.yalero.net`. Como `yalero.net` ya está en tu cuenta de Cloudflare, crea el registro DNS y el certificado él solo (tarda unos minutos).

## 3. Autorizar el dominio (imprescindible para entrar)

Hazlo **todo antes** de probar el acceso; si falta algo, Google o GitHub darán un error de redirección.

1. **Firebase** → Authentication → Settings → **Authorized domains** → añade `workhub.yalero.net`.
2. **Google**: <https://console.cloud.google.com/apis/credentials> (proyecto **workhub-26f50**) → *IDs de clientes de OAuth 2.0* → **Web client (auto created by Google Service)**:
   - *Orígenes de JavaScript autorizados*: `https://workhub.yalero.net`
   - *URIs de redireccionamiento autorizados*: `https://workhub.yalero.net/__/auth/handler`
3. **GitHub**: <https://github.com/settings/developers> → tu OAuth App **Workhub** → en *Authorization callback URL* pon `https://workhub.yalero.net/__/auth/handler`. Una OAuth App de GitHub puede aceptar **una sola** URL de callback: si cambias la de Netlify por la nueva, la de Netlify deja de funcionar (es lo esperado si ya no lo usas). Esa misma app es la de «Conectar con GitHub» en Ajustes (integración con GitHub Projects).
4. *(Opcional)* Restringe la clave de API a `https://workhub.yalero.net/*` (ver [SEGURIDAD.md](SEGURIDAD.md), punto 7).

## 4. Comprobar

- Abre `https://workhub.yalero.net/__/auth/handler`: debe verse una página de Firebase (no un 404 ni un error de Cloudflare).
- Inicia sesión con Google y con GitHub, en Chrome y en Safari o Firefox.
- Abre las herramientas del navegador → pestaña *Red*: la respuesta de la página debe llevar `content-security-policy` y `strict-transport-security`.

## 5. Día a día

- **Publicar cambios**: fusiona el PR en `main`. Cloudflare compila y publica solo; el progreso está en **Implementaciones** (*Deployments*).
- **Vista previa de cada PR**: Cloudflare crea una dirección `https://<rama>.<nombre>.pages.dev`. En ellas no se puede iniciar sesión (el dominio no está autorizado en Firebase); sirven para ver el diseño.
- **Volver atrás**: en *Implementaciones*, elige una anterior → **Restaurar** (*Rollback*).
- **Reglas de seguridad de Firestore**: siguen subiéndose con `firebase deploy --only firestore:rules` (o pegándolas en la consola), solo cuando cambia `firestore.rules`. Ver [SEGURIDAD.md](SEGURIDAD.md).
- **Cabeceras de seguridad**: se cambian en `scripts/build-public.js` (constantes `ALL`, `PAGE` y `CSP`) y se aplican solas en la siguiente publicación. Si añades un servicio externo, añade su dominio a `CSP`.

## 6. Recomendado en el panel de Cloudflare

Todo esto es gratis y opcional:

- **SSL/TLS** → modo **Completo (estricto)** (*Full (strict)*) y **Usar siempre HTTPS**.
- **Seguridad** → **Bot Fight Mode**, y reglas de límite de peticiones (*Rate limiting*) si ves abusos.
- **Turnstile** (su alternativa gratuita a los captcha) si se llenan de cuentas falsas: se puede añadir a la pantalla de registro.
- **Analítica web** sin cookies, si quieres saber cuánta gente entra.

## Límites del plan gratuito

Pages: 500 compilaciones al mes, 20 000 ficheros por sitio y 25 MiB por fichero. Ancho de banda **ilimitado**. Las Pages Functions (solo el reenvío del acceso) admiten 100 000 peticiones al día, y cada inicio de sesión gasta muy pocas. Consulta los límites actuales en <https://developers.cloudflare.com/pages/platform/limits/>.

## ¿Y Netlify y Firebase Hosting?

- **Netlify** ya no se usa: el fichero `netlify.toml` se eliminó. El sitio antiguo (`workhub-project.netlify.app`) sigue en `hostingDomains` para que, mientras exista, el acceso siga funcionando ahí; quítalo cuando lo borres, y bórralo también de los dominios autorizados.
- **Firebase Hosting** (`https://workhub-26f50.web.app`, mismos datos) sigue configurado en `firebase.json` como alternativa de emergencia: `firebase deploy --only hosting`. **No lleva las cabeceras de seguridad** de `_headers`, que son propias de Cloudflare.

## Si algo falla

- **El acceso da error de redirección**: falta alguno de los pasos del apartado 3, o los cambios de Google tardan unos minutos en aplicarse.
- **`/__/auth/handler` da 404**: la carpeta `functions/` no se desplegó. Comprueba en *Implementaciones* → detalles que aparece «Functions». No debe estar en `.gitignore`.
- **La web carga sin estilos o sin scripts**: casi siempre es la CSP. Abre la consola del navegador: el mensaje dice qué dominio se bloqueó; añádelo a `CSP` en `scripts/build-public.js`.
