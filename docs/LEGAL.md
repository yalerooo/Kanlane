# Páginas legales, privacidad y cookies

Kanlane trata datos personales de personas en España y la Unión Europea, así que necesita información legal y un aviso de cookies. Esta guía explica qué hay, qué tienes que rellenar tú y qué obligaciones quedan fuera del código.

> **Importante.** Los textos están redactados siguiendo el RGPD, la LOPDGDD, la LSSI-CE y la guía de cookies de la AEPD, y describen lo que Kanlane hace de verdad. Pero **no son asesoramiento jurídico**. Si Kanlane va a tener usuarios que no conoces, cobrar, o lo explotas como empresa, haz que los revise un abogado o una gestoría. Eres tú, como titular, quien responde de que sean ciertos y estén al día.

## Que no salgan en Google

Las tres páginas llevan el nombre, el NIF, el domicilio y el correo del titular, así que **no se indexan**:

- cada página tiene `<meta name="robots" content="noindex, nofollow, noarchive">` (y la equivalente para `googlebot`);
- el sitio las sirve con la cabecera HTTP `X-Robots-Tag: noindex, nofollow, noarchive` (`LEGAL` en `scripts/build-public.js`), que los buscadores obedecen aunque no lean el HTML.

**No añadas un `robots.txt` que las bloquee** (`Disallow: /legal/`): si el robot no puede leer la página, no llega a ver el `noindex` y Google puede seguir listando la dirección. Lo correcto es dejar que las lea y obedezca el `noindex`.

Lo que esto **no** hace: las páginas siguen siendo públicas para cualquiera que tenga o encuentre el enlace (están enlazadas desde la pantalla de acceso, y la ley exige que se puedan consultar). Si no quieres publicar tu domicilio particular, usa una dirección profesional o de contacto (el domicilio es obligatorio en la información del titular, pero puede ser el de tu actividad). Si alguna vez se llegó a indexar una versión anterior, pide su retirada en Google Search Console (Eliminaciones → Eliminar temporalmente); el `noindex` hace el resto al volver a rastrear.

## Qué hay

| Qué | Dónde | Para qué |
|---|---|---|
| Política de privacidad | `legal/privacidad/index.html` → `/legal/privacidad/` | RGPD art. 13: responsable, datos, finalidades y bases legales, encargados, transferencias, plazos, derechos, seguridad. Incluye el contrato de encargo del tratamiento (art. 28) para quien guarda datos de sus clientes. |
| Términos y condiciones (con aviso legal) | `legal/terminos/index.html` → `/legal/terminos/` | LSSI-CE art. 10 (identificación del titular) y condiciones de uso. |
| Política de cookies | `legal/cookies/index.html` → `/legal/cookies/` | LSSI-CE art. 22.2: lista exacta de lo que se guarda en el navegador. |
| Aviso de cookies y configuración | `src/consent/consent.js` + `assets/css/components/consent.css` | Aceptar / Rechazar / Configurar, igual en la app y en las páginas legales. |
| Datos del titular | `src/config/legal-config.js` | **Único sitio donde rellenar** nombre, NIF, domicilio y correo. |
| Cabecera, pie y datos de las páginas | `src/legal/legal.js`, `assets/css/legal.css` | Las páginas son HTML estático; esto añade la cabecera y rellena los datos. |

Enlaces desde la app: pantalla de acceso («Al continuar aceptas los Términos y condiciones y la Política de privacidad»), **Ajustes → Privacidad** (con el botón «Configurar cookies») y el pie de cada página legal.

## Lo que tienes que hacer tú (antes de publicar)

1. **Rellena `src/config/legal-config.js`**: `titular` (nombre y apellidos o razón social), `nif`, `domicilio` y `email`. Son obligatorios por ley y serán públicos. Mientras estén vacíos, las páginas los muestran en amarillo como «[completar: …]» y `node scripts/build-public.js` avisa en cada publicación.
2. **Comprueba `ubicacionDatos`**: dónde está la base de datos de Firestore (consola de Firebase → Firestore). La política dice por defecto «la Unión Europea (región eur3)». Si la creaste en otra región, cámbialo: lo que dice la política debe ser verdad.
3. **Revisa que hay un correo que lees** en `email`: es donde la gente ejercerá sus derechos. Tienes **un mes** para responder.
4. Sube `actualizado` y `version` cuando cambies algo de fondo en los textos.

## Obligaciones que quedan fuera del código

- **Registro de actividades de tratamiento** (RGPD art. 30). Aunque seas pequeño, si tratas datos de forma habitual tienes que llevarlo. Basta un documento sencillo. Plantilla:

  | Campo | Contenido |
  |---|---|
  | Responsable | (tus datos) |
  | Actividad | Gestión de cuentas y contenido de usuarios de Kanlane |
  | Categorías de interesados | Usuarios; personas de contacto que los usuarios introducen |
  | Categorías de datos | Identificativos y de contacto; contenido de trabajo; datos técnicos |
  | Destinatarios / encargados | Google (Firebase), Cloudflare, GitHub (si se activa) |
  | Transferencias internacionales | EE. UU. (Marco de Privacidad UE-EE. UU. y cláusulas tipo) |
  | Plazos de supresión | Mientras exista la cuenta; baja en 30 días |
  | Medidas de seguridad | HTTPS/HSTS, CSP, reglas de acceso, cifrado de contraseñas guardadas en el navegador, verificación de correo |

- **Contratos con los proveedores.** Los términos de Google Cloud/Firebase y de Cloudflare incluyen su contrato de encargo (DPA) y las cláusulas tipo; compruébalo en sus consolas y consérvalos.
- **Derechos de las personas.** Hay que atenderlos en un mes. Hoy **no existe el botón «Eliminar mi cuenta»** en la aplicación: la baja se pide por correo y la haces tú a mano (borrar la cuenta en Firebase Authentication y sus datos en Firestore). Está prometido el plazo de 30 días en la política.
- **Brechas de seguridad.** Si ocurre una que afecte a datos personales, hay que notificarla a la AEPD en 72 horas (sede electrónica de la AEPD) y, si el riesgo es alto, a los afectados.
- **Si cambia lo que haces** (analítica, publicidad, cobros, nuevos proveedores, otro país de alojamiento), actualiza la política, la de cookies y, si hace falta, pide consentimiento (ver más abajo).

## El aviso de cookies: qué cubre y por qué

Hoy Kanlane **solo usa almacenamiento técnico imprescindible** (sesión, idioma, tema, proyecto abierto, copia sin conexión…), que la ley **no obliga a consentir** (LSSI-CE art. 22.2). Aun así el aviso existe, y funciona de verdad, porque:

- da transparencia y deja al usuario elegir;
- está listo para el día que añadas algo que **sí** necesite consentimiento (analítica, publicidad, vídeos incrustados…).

Cumple la guía de la AEPD: nada premarcado; «Aceptar» y «Rechazar» con idéntico aspecto y a la misma altura; no hay «muro de cookies» (se puede usar la app sin responder); se puede retirar el consentimiento tan fácil como darlo (botón «Configurar cookies» en Ajustes, en el pie de las páginas legales y en la política de cookies); se guarda la fecha y vuelve a preguntar a los **12 meses** o si sube `VERSION`.

La categoría **Analítica y medición** existe pero **no se usa**: las páginas lo dicen así. Si la usas, cambia los textos.

### Añadir analítica u otro script de terceros (en el futuro)

Nunca lo pongas con un `<script>` fijo: cárgalo solo si hay consentimiento, y quítalo si se retira.

```js
function loadAnalytics(){ /* añade aquí el <script> del proveedor */ }
if(WorkhubConsent.has('analytics')) loadAnalytics();
WorkhubConsent.onChange(function(c){ if(c.analytics) loadAnalytics(); else location.reload(); });
```

Además: añade el dominio a `CSP` en `scripts/build-public.js`, apúntalo en la tabla de `legal/cookies/index.html` y en el apartado de proveedores de `legal/privacidad/index.html`, y súbele `VERSION` a `consent.js` para que todos vuelvan a decidir.

## Decisiones técnicas relacionadas

- **Tipografías propias.** Antes se cargaban desde Google Fonts, lo que envía la IP de cada visitante a Google (y está sancionado en algunos países de la UE sin consentimiento). Ahora Geist se sirve desde `assets/fonts/` (licencia SIL OFL incluida) y la CSP ya no permite `fonts.googleapis.com` ni `fonts.gstatic.com`.
- **Service worker.** Cada página guarda su propia copia sin conexión; antes todas se guardaban como `/index.html` y abrir una página legal pisaba la de la app. Las páginas legales también funcionan sin conexión.
- **Cabeceras.** Las páginas legales llevan la misma CSP y `X-Frame-Options` que la app (`/legal/*` en `scripts/build-public.js`).

## Limitaciones conocidas

- Solo se cifran la **contraseña y las notas** de cada credencial; el resto de campos (servicio, usuario, cliente…) se guardan en claro. La política lo dice. Cifrar también el usuario sería una mejora.
- La aceptación de los términos se informa («Al continuar aceptas…») pero **no se guarda cuándo la dio cada persona**. Si necesitas prueba, habría que guardar `termsAcceptedAt` en los ajustes de la cuenta.
- Los textos legales están **solo en español**. La interfaz sí está en inglés.

## Pruebas

```bash
node tests/consent/consent.test.js   # caducidad, versión, retirar, almacenamiento bloqueado
node tests/sw/sw.test.js             # incluye que una página legal no pisa la copia de la app
node scripts/check-i18n.js --strict  # textos nuevos traducidos
```
