# Contexto para seguir en otro chat

Workhub es un gestor de trabajo por cliente: tareas (tablero), calendario, clientes y contactos, contraseñas cifradas, copias de seguridad, ajustes, proyectos, plugins e idiomas.
- **Web:** https://workhub-project.netlify.app (Netlify, con Firebase Auth y Firestore).
- **Repositorio:** `yalerooo/Workhub`. Rama de trabajo: `claude/sleepy-brown-tdi6yq`.

## Preferencias del usuario
- Idioma: español.
- Pull requests: créalos tú automáticamente, en español y con explicaciones claras.
- Publica solo en Netlify. claude.ai ya no se usa.
- **Nunca** publiques ni subas `data-backup.json` (contiene datos reales de clientes).
- **Nunca** pegues ni subas el *client secret* de GitHub OAuth. Solo va en la consola de Firebase.
- La visibilidad de producción en Netlify debe seguir en *Public*.

## Arquitectura (ver README.md)
- JavaScript sin frameworks, patrón MVC, con el espacio de nombres global `Workhub`.
- Carpetas:
  - `src/core`: espacio de nombres, eventos y almacén.
  - `src/models`: `CollectionModel` y colecciones `tasks`, `clients`, `contacts`, `meetings`, `vault`, además de `projects`, `settings` y `plugins`.
  - `src/views`: solo DOM.
  - `src/controllers`.
  - `src/services`: Firebase, cifrado, plataforma.
  - `src/i18n`.
  - `assets/css`: tokens, base, layout, componentes y vistas.
- **Firebase:** configuración en `src/config/firebase-config.js`; si está vacía, la app funciona en modo local con IndexedDB.
- **Reglas de Firestore** (`firestore.rules`):
  - `users/{uid}/…` es del propio usuario.
  - El registro está abierto y exige email verificado.
  - Los proyectos que no son el principal viven en `projects/{id}/…`.
- **CSP** en `netlify.toml`.

## Hecho (PRs fusionados #13–#21)
- #13: proyectos.
- #14: seguridad (registro con verificación, CSP, limpieza al cerrar sesión).
- #15: clientes y contactos juntos.
- #16: diseño responsive.
- #17: ajustes sincronizados con la cuenta.
- #18–#21: sistema de plugins:
  - Cada plugin corre en un iframe aislado (sandbox) y habla con Workhub por postMessage, con permisos.
  - Puede añadir botones, etiquetas y cambios de apariencia dentro de la app, y funcionar en segundo plano.
  - El SDK está en `plugins/sdk/`. Los oficiales son `informe`, `temporizador` y `apariencia`.
  - Documentación en `docs/PLUGINS.md`.

## Último trabajo: PR #22 (idioma inglés), pendiente de fusionar
- **Motor** en `src/i18n/i18n.js`:
  - La app sigue escrita en español.
  - Un MutationObserver traduce el texto y los atributos `placeholder`, `title` y `aria-label` usando un diccionario más patrones con expresiones regulares.
  - `translate="no"` marca los datos del usuario, que nunca se traducen.
- **API:** `Workhub.t(text, params)`, `Workhub.i18n.lang` y `Workhub.i18n.locale`. `Workhub.i18n.missing()` lista los textos que aún no tienen traducción.
- **Diccionario inglés:** `src/i18n/en.js`.
- **Guardado del idioma:** en localStorage (`workhub_lang`) y en la cuenta (campo `lang` del documento de ajustes, vía `SettingsModel`). Cambiarlo recarga la app.
- **Selectores de idioma:** en Ajustes (`#langSegment`) y en la pantalla de inicio de sesión (`#authLang`).
- **SDK de plugins:** `WorkhubPlugin.translations({en:{…}})`, `wh.lang` y `wh.locale`.
- **Pendiente:** comprobar en la web publicada el selector de idioma de la pantalla de inicio de sesión (no se probó con Firebase).

## Pruebas
- Las pruebas se hacen con Playwright y Chromium en `/opt/pw-browsers`. Los scripts de prueba estaban en el scratchpad de la sesión anterior y no se conservan.
- Para lanzar la app en local: `python3 -m http.server 5500`, y abrir `index.html` o usar `file://`.
- Fuerza `locale: 'es-ES'` en las pruebas, porque Chromium sin interfaz arranca en inglés.
