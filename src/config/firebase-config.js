/* Configuración de Firebase para publicar Workhub en la web con inicio de sesión.

   Cómo rellenarla: Consola de Firebase → ⚙ Configuración del proyecto →
   "Tus apps" → app web → "Configuración del SDK" (opción "Config") y copia aquí
   esos valores. No son secretos: identifican el proyecto, y lo que protege los
   datos son las reglas de firestore.rules. Guía completa en docs/FIREBASE.md.

   Mientras apiKey esté vacío, Workhub funciona como hasta ahora (modo local en
   el navegador, o dentro de claude.ai). */
window.WORKHUB_FIREBASE = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',

  /* Botones de acceso que se muestran, en este orden. Cada uno debe estar
     activado en Firebase → Authentication → Sign-in method.
     Posibles: 'google', 'github', 'microsoft', 'apple', 'password'. */
  providers: ['google', 'github', 'microsoft', 'password'],

  /* Solo para desarrollo: con true, en localhost se usan los emuladores de
     Firebase (firebase emulators:start) en lugar del proyecto real. */
  useEmulators: false
};
