# Correos de la cuenta (verificar el correo y cambiar la contraseña)

Estos dos correos los envía Kanlane, no Firebase: así el mensaje es el nuestro (con botón, con el logo y en el idioma de la persona) y cambiarlo es cambiar un archivo, sin pedir nada a la asistencia de Firebase.

- Código: `worker/account-mail.mjs` (el mensaje, los topes y el envío) y la ruta `/__/mail/v1` de `worker/index.js`.
- En la app: `sendVerification()` y `resetPassword()` de `src/services/firebase-backend.js`.
- Pruebas: `tests/worker/account-mail.test.js` y `tests/e2e/email-links.js`.

## Cómo funciona

1. La app llama a `/__/mail/v1` con `{op: 'verify'}` (y el ID token de la cuenta) o `{op: 'reset', email}`, más el idioma.
2. El Worker le pide a Firebase el enlace de un solo uso (`accounts:sendOobCode` con `returnOobLink`: Firebase genera el código pero no envía nada).
3. Monta el mensaje y lo envía con [Resend](https://resend.com). El botón lleva a `https://kanlane.com/app/?mode=…&oobCode=…`, que la app atiende con su propia pantalla (`AuthController.resolveAction`).

**Si algo falla, el correo sale igual.** Mientras falte algo por configurar, se agote el cupo del día o Resend no responda, la ruta contesta 503 y la app recurre al envío de Firebase de siempre (con su plantilla). Por eso se puede desplegar antes de terminar los pasos de abajo.

## Coste

Gratis a esta escala. El plan gratuito de Resend da 3.000 correos al mes con un tope de **100 al día**; el Worker se para en 90 (`ALL_PER_DAY`, o la variable `MAIL_DAILY_MAX`) y a partir de ahí envía Firebase. Las peticiones del Worker entran en las 100.000 diarias del plan gratuito de Cloudflare.

## Puesta en marcha (una vez)

1. **Cuenta en Resend** (<https://resend.com>) → *Domains* → *Add domain* → `kanlane.com`, región `eu-west-1`, *Custom Return-Path* `send`. El seguimiento de clics y de aperturas, **desactivado**: el de clics reescribe los enlaces para que pasen por un dominio de Resend, y el botón lleva un código de un solo uso.
2. **DNS en Cloudflare**: con *Auto configure* Resend los crea solo; a mano, **copiando los valores de su panel**. **Hecho el 9-oct-2026** (dominio verificado). Son:
   - Un TXT `resend._domainkey` (DKIM).
   - Dos CNAME, `send` y `rsend`, hacia `forge.rmta.net` (remitente de rebotes y SPF), **sin proxy** («Solo DNS»).
   No tocan lo que ya hay: el SPF y los MX de `kanlane.com` (Email Routing, tareas por correo) están en la raíz; el DKIM de Firebase usa otros nombres (`firebase1._domainkey`, `firebase2._domainkey`). No hay que editar el SPF de la raíz.
   **No actives «Enable Receiving»** en Resend: pediría cambiar los MX de la raíz, que son los de las tareas por correo.
3. Espera a que Resend marque el dominio como **Verified**.
4. **Clave de Resend**: *API Keys* → *Create API key* → permiso **Sending access**, limitada al dominio `kanlane.com`. Guárdala como secreto del Worker (no va en el repositorio):
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
5. **Permiso de la cuenta de servicio**: el Worker ya tiene `FIREBASE_SERVICE_ACCOUNT` (automatizaciones, captura, MCP), pero solo con permiso sobre Firestore. En Google Cloud Console → proyecto `workhub-26f50` → **IAM** → esa cuenta de servicio → *Editar* → añade el rol **Administrador de Firebase Authentication** (`roles/firebaseauth.admin`). Sin él, Firebase responde 403 al pedir el enlace y el correo lo envía Firebase.
6. El remitente es la variable `MAIL_FROM` de `wrangler.jsonc` (`Kanlane <noreply@kanlane.com>`). Vacía, apaga todo esto.

## Comprobar

1. Crea una cuenta de prueba con correo y contraseña. Debe llegar «Verifica tu correo en Kanlane» con el botón **Verificar correo**; al pulsarlo se entra en la app.
2. «¿La has olvidado?» → debe llegar «Restablece tu contraseña de Kanlane» con el botón **Cambiar contraseña**.
3. En las cabeceras del mensaje: `dkim=pass` con `d=kanlane.com` y `dmarc=pass`.
4. En Resend → *Emails* aparecen los dos envíos. Si no aparecen y el correo que llega es el de texto de Firebase, mira los registros del Worker: una línea `correos: …` dice qué falló (`oob 403` = falta el rol del paso 5; `resend 403` = clave o dominio).

Para ver el diseño sin enviar nada: `node scripts/dev.js --emulador` con los emuladores en marcha; los mensajes quedan en `http://localhost:5500/__dev/mail`.

## Límites y seguridad

| Qué | Tope | Dónde |
|---|---|---|
| Peticiones por IP | 6 por minuto | `MAIL_RATE_LIMIT` (`wrangler.jsonc`) |
| Correos de verificación por cuenta | 8 al día | `VERIFY_PER_DAY` |
| Correos de cambio de contraseña por dirección | 5 al día | `RESET_PER_DAY` |
| Entre todos | 90 al día | `ALL_PER_DAY` / `MAIL_DAILY_MAX` |

- **Verificación**: a quién se escribe sale del ID token, nunca de lo que mande el navegador.
- **Cambio de contraseña**: solo se envía si existe una cuenta con ese correo, y la respuesta es la misma exista o no (tampoco el tope por dirección lo delata: se cuentan los intentos). No sirve para escribir a direcciones que no sean de usuarios. Queda una diferencia de tiempo de respuesta entre los dos casos (cuando hay cuenta, además se envía).
- El texto lo compone el Worker; del navegador solo llegan el idioma y, para la contraseña, el correo.
- Los contadores están en `mail_rate/{clave}~{día}`, sin correos en el nombre (va un resumen SHA-256). La colección no está en `firestore.rules`: cerrada a los clientes. El cron borra los de más de tres días.
- En los registros del Worker no queda ninguna dirección.

## Cambiar el diseño o los textos

Todo está en `compose()` y `TEXTS` de `worker/account-mail.mjs`: HTML con tablas y estilos en línea (lo que entienden los clientes de correo), más la versión en texto. Añadir un idioma es añadir su bloque a `TEXTS` y a `LANGS`.

## Lo que sigue enviando Firebase

Los modos que la app no usa (cambio de correo, recuperación de correo) y cualquier envío cuando esta ruta responde 503. Sus plantillas siguen siendo las del proyecto (ver `docs/SEGURIDAD.md`, paso 9).
