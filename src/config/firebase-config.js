/* Configuración de Firebase para publicar Workhub en la web con inicio de sesión.

   Cómo rellenarla: Consola de Firebase → ⚙ Configuración del proyecto →
   "Tus apps" → app web → "Configuración del SDK" (opción "Config") y copia aquí
   esos valores. No son secretos: identifican el proyecto, y lo que protege los
   datos son las reglas de firestore.rules. Guía completa en docs/FIREBASE.md.

   Mientras apiKey esté vacío, Workhub funciona como hasta ahora (modo local en
   el navegador, o dentro de claude.ai). */
window.WORKHUB_FIREBASE = {
  apiKey: 'AIzaSyDqO3Mxm7kP7H0Mz5fOZbWN6k7nRPxhXYk',
  authDomain: 'workhub-26f50.firebaseapp.com',
  projectId: 'workhub-26f50',
  storageBucket: 'workhub-26f50.firebasestorage.app',
  messagingSenderId: '1056897810807',
  appId: '1:1056897810807:web:dacc47f0a05651f91c6172',

  /* Dominios desde los que se sirve la web FUERA de Firebase Hosting y que
     reenvían /__/auth/* a Firebase (Netlify lo hace con netlify.toml).
     En ellos el inicio de sesión se completa en el propio dominio.
     Ejemplo: ['workhub.netlify.app']. Ver docs/NETLIFY.md. */
  hostingDomains: [],

  /* Botones de acceso que se muestran, en este orden. Cada uno debe estar
     activado en Firebase → Authentication → Sign-in method.
     Posibles: 'google', 'github', 'microsoft', 'apple', 'password'. */
  providers: ['google', 'github', 'password'],

  /* Solo para desarrollo: con true, en localhost se usan los emuladores de
     Firebase (firebase emulators:start) en lugar del proyecto real. */
  useEmulators: false
};
