# Protección frente a abuso y recuperación

## Estado comprobado el 1 de octubre de 2026

- Firebase `workhub-26f50` no tiene facturación activada (plan Spark). No puede generar una factura por superar las cuotas gratuitas; los servicios pueden dejar de atender peticiones al agotarlas.
- La protección contra enumeración de correos de Firebase Authentication está activada.
- La API de reCAPTCHA Enterprise se habilitó y se creó una clave de puntuación limitada a `workhub.yalero.net`, `workhub-26f50.web.app` y `workhub-project.netlify.app`. La app web está registrada en Firebase App Check con esa clave. **La clave no incluye `kanlane.com` ni `kanlane.yalero.net`** (se creó antes del cambio de nombre): en esos dominios la consola del navegador muestra `AppCheck: ReCAPTCHA error (appCheck/recaptcha-error)` en cada carga. Mientras App Check no sea obligatorio es solo ruido, pero **hay que añadir los dominios a la clave antes de activarlo** (Google Cloud → Seguridad → reCAPTCHA → la clave → Editar → Dominios), o se cortaría el acceso a todo el mundo. **App Check todavía no es obligatorio** para Authentication ni Firestore: activarlo antes de publicar y observar el cliente nuevo cortaría el acceso a usuarios reales.
- Las reglas de Firestore validan campos y tamaños de datos habituales y restringen las copias cifradas a su propietario. **Publicar `firestore.rules` al fusionar el PR**; sin ello las copias en la cuenta mostrarán un error de permisos. `npm test --prefix tests/rules` comprueba permisos y límites en el emulador.

## Activación gradual de App Check

1. Fusionar y publicar el cliente con `appCheckSiteKey` y la CSP actualizada. Probar acceso real con Google, GitHub y correo en la web principal, Firebase Hosting y el antiguo dominio de Netlify si sigue operativo. El emulador local no usa App Check.
2. En **Firebase → Seguridad → App Check → APIs**, observar Authentication y Firestore durante varios días. Comprobar que las peticiones válidas son mayoritariamente verificadas y que no hay navegadores reales bloqueados. La clave no incluye `localhost`.
3. Activar la aplicación obligatoria para **Authentication** y **Cloud Firestore**, una API cada vez, y vigilar errores de acceso. Firebase puede tardar hasta 15 minutos en aplicar el cambio. Si hay un problema, volver al modo de monitorización desde la misma pantalla.
4. Vigilar el consumo mensual de evaluaciones reCAPTCHA. En el plan sin facturación las primeras 10 000 evaluaciones mensuales son gratuitas y, al agotarlas, las nuevas evaluaciones pueden recibir un error de cuota. Mantener la renovación de tokens y ajustar su duración solo tras medir el tráfico.

`node scripts/security-status.js` consulta el estado real sin imprimir claves. Requiere `npm ci --prefix tests/rules` y una sesión `firebase login` local.

## Límites y señales de abuso

- El Worker aplica un límite de 240 peticiones por minuto y dirección IP **solo** al proxy `/__/auth/*` y `/__/firebase/*`; devuelve HTTP 429 con `Retry-After`. Es deliberadamente amplio para no bloquear oficinas o redes móviles compartidas. Las solicitudes directas a Firebase no pasan por Cloudflare y dependen de App Check, cuotas de Firebase y reglas.
- Revisar en **Cloudflare → Observabilidad** los 429 y errores del Worker, en **Firebase → Authentication** los picos de altas y correos, en **App Check** las solicitudes no verificadas, y en **Firestore → Uso** las lecturas, escrituras y almacenamiento.
- La acción `Salud de producción` comprueba cada seis horas que la web, el service worker y la política de privacidad responden. Un fallo queda visible en GitHub Actions; para recibirlo por correo o móvil hay que activar las notificaciones de Actions en GitHub.
- Si se pasa a Blaze, configurar alertas de presupuesto en Google Cloud Billing antes de vincular una cuenta de facturación. Los presupuestos normales solo avisan: no detienen Firestore. Comprobar primero las cuotas y el coste previsto de reCAPTCHA y de las copias.

## Copias de seguridad

Las versiones locales siguen funcionando sin cuenta. Las copias en la cuenta son **optativas** y solo aparecen en proyectos personales de Firebase. Al activarlas se genera una clave aleatoria de 256 bits, conservada en este navegador y mostrada para guardarla fuera de Kanlane. La app cifra cada copia con AES-GCM antes de enviarla a Firestore; el servidor solo ve el contenido cifrado, el proyecto, la fecha y los recuentos. En otro dispositivo hay que introducir la misma clave. Se guarda una versión diaria y un máximo de siete por proyecto. El tamaño máximo es de 16 fragmentos de 300 000 caracteres cifrados.

La importación **añade** elementos y no reemplaza el proyecto. Las imágenes de las notas requieren además los recursos originales del proyecto. Borrar el proyecto no borra sus versiones cifradas: se conservan para poder recuperarlo. Desde otro proyecto personal de la misma cuenta aparecen como «Otro proyecto»; se pueden descargar, borrar o importar en el proyecto abierto tras confirmarlo. Si se pierde la clave, Kanlane no puede descifrar las versiones. Para una segunda vía de recuperación, descargar periódicamente un archivo de copia y guardarlo fuera del dispositivo.
