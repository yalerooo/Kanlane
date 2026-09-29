# Publicar Workhub en Netlify

Netlify sirve la web y la **publica sola cada vez que se fusiona algo en `main`**. Firebase sigue encargándose del inicio de sesión y de la base de datos (ver [FIREBASE.md](FIREBASE.md)).

Qué ya está preparado en el repositorio (`netlify.toml`):

- Netlify ejecuta `node scripts/build-public.js` y publica **solo** `dist/` (`index.html`, `assets/`, `src/`): `data-backup.json` y el resto de archivos **nunca** se publican.
- Las páginas de acceso de Firebase (`/__/auth/…`) se reenvían desde tu dominio de Netlify, para que el inicio de sesión funcione también en Safari, Firefox estricto o Chrome con cookies de terceros bloqueadas.

---

## 1. Crear el sitio

1. Entra en <https://app.netlify.com> y regístrate con **GitHub**.
2. **Add new site → Import an existing project → GitHub** y autoriza a Netlify.
3. Elige el repositorio **yalerooo/Workhub**.
4. En la configuración verás ya rellenado, leído de `netlify.toml`:
   - *Branch to deploy*: `main`
   - *Build command*: `node scripts/build-public.js`
   - *Publish directory*: `dist`

   No cambies nada y pulsa **Deploy**.
5. Cambia el nombre del sitio: **Site configuration → General → Site details → Change site name**, por ejemplo `workhub-yalero`. Tu web queda en `https://workhub-yalero.netlify.app`.

## 2. Autorizar el dominio en Firebase (imprescindible)

Consola de Firebase → **Authentication → Settings → Authorized domains → Add domain** → `workhub-yalero.netlify.app`.

Con esto ya puedes entrar con correo, Google y GitHub en Chrome.

## 3. Acceso desde tu propio dominio (recomendado)

Para que el acceso funcione en cualquier navegador, haz **los tres pasos juntos**. Si solo haces el último, Google dará un error de redirección.

1. **Google**: <https://console.cloud.google.com/apis/credentials> (proyecto **workhub-26f50**) → *IDs de clientes de OAuth 2.0* → **Web client (auto created by Google Service)**:
   - *Orígenes de JavaScript autorizados*: añade `https://workhub-yalero.netlify.app`
   - *URIs de redireccionamiento autorizados*: añade `https://workhub-yalero.netlify.app/__/auth/handler`
   - Guardar (puede tardar unos minutos en aplicarse).
2. **GitHub**: <https://github.com/settings/developers> → tu OAuth App **Workhub** → añade `https://workhub-yalero.netlify.app/__/auth/handler` como otra *Redirect URI*.
3. **Workhub**: en `src/config/firebase-config.js` pon tu dominio en `hostingDomains`:

   ```js
   hostingDomains: ['workhub-yalero.netlify.app'],
   ```

   Súbelo a `main` y Netlify lo publica solo en uno o dos minutos.

## 4. Día a día

- **Publicar cambios**: fusiona la PR en `main`. Netlify publica solo; puedes ver el progreso en **Deploys**.
- **Vistas previas**: cada PR tiene su propia URL de prueba (`deploy-preview-N--workhub-yalero.netlify.app`). En ellas no se puede iniciar sesión, porque Firebase no admite comodines en los dominios autorizados; sirven para ver el diseño.
- **Reglas de seguridad de Firestore**: siguen subiéndose con `firebase deploy --only firestore:rules` (o pegándolas en la consola), solo cuando cambia `firestore.rules`. Ver [SEGURIDAD.md](SEGURIDAD.md).
- **Cabeceras de seguridad** (CSP, anti-marcos, HTTPS obligatorio): están en `netlify.toml` y se aplican solas en cada publicación.

## 5. ¿Y la versión de Firebase Hosting?

`https://workhub-26f50.web.app` sigue funcionando con los mismos datos; son dos puertas a la misma base de datos. Si prefieres dejar solo Netlify:

```bash
firebase hosting:disable
```

## Dominio propio (opcional)

En Netlify: **Domain management → Add a domain** y sigue las instrucciones de DNS. Después repite los pasos 2 y 3 con el nuevo dominio: autorizarlo en Firebase, en Google y en GitHub, y añadirlo a `hostingDomains`.
