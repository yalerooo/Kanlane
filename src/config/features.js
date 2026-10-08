/* Interruptores de funciones a medio desplegar.
   encryptedProjects: ofrecer «Cifrado total» al crear un proyecto (docs/CIFRADO-PROYECTOS.md). Ponerlo
   en false retira la opción del asistente; los proyectos cifrados que ya existan se siguen abriendo.
   managedEncryption: ofrecer «Gestionado por Kanlane» (apartado 12 del plan). Necesita el secreto
   KMS_MASTER_V1 en el Worker y las reglas de Firestore que admiten el modo 'managed'. En false la
   tarjeta vuelve a «Próximamente»; los proyectos gestionados que ya existan se siguen abriendo (y
   siguen dependiendo del Worker).
   vaultTotp: ofrecer la verificación en dos pasos del gestor de contraseñas. Necesita KMS_MASTER_V1
   y el límite TOTP_RATE_LIMIT en el Worker (wrangler.jsonc). En false no se puede activar; los
   cofres que ya la tengan siguen pidiendo el código (y siguen dependiendo del Worker).
   mailCapture: ofrecer la captura de tareas por correo en el diálogo de automatizaciones
   (docs/CAPTURA-EMAIL.md). Necesita los secretos CAPTURE_SECRET y FIREBASE_SERVICE_ACCOUNT, la
   variable CAPTURE_DOMAINS y Email Routing apuntando al Worker. Mientras el servidor no lo tenga
   todo, el apartado no se enseña aunque esto esté en true. En false no se enseña ni se consulta;
   las direcciones que ya existan siguen recibiendo correo hasta que se desactiven.
   mcp: ofrecer en Ajustes → Integraciones los tokens del servidor MCP (docs/MCP.md). Necesita los
   secretos MCP_SECRET y FIREBASE_SERVICE_ACCOUNT en el Worker. Mientras el servidor no los tenga,
   el apartado no se enseña aunque esto esté en true. En false no se enseña ni se consulta; los
   tokens que ya existan siguen funcionando hasta que se revoquen.
   push: ofrecer en Ajustes los avisos con Kanlane cerrado y avisar al servidor de menciones,
   asignaciones y cambios en tareas seguidas (docs/NOTIFICACIONES.md). Necesita los secretos
   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT y FIREBASE_SERVICE_ACCOUNT en el Worker. Mientras el
   servidor no los tenga, activar los avisos dice que aún no están disponibles. En false no se
   enseña ni se avisa; las menciones y «Seguir» siguen funcionando dentro de la app. */
Workhub.features = {
  encryptedProjects: true,
  managedEncryption: true,
  vaultTotp: true,
  mailCapture: true,
  mcp: true,
  push: true
};
