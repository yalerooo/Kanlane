/* Interruptores de funciones a medio desplegar.
   encryptedProjects: ofrecer «Cifrado total» al crear un proyecto (docs/CIFRADO-PROYECTOS.md). Ponerlo
   en false retira la opción del asistente; los proyectos cifrados que ya existan se siguen abriendo.
   managedEncryption: ofrecer «Gestionado por Kanlane» (apartado 12 del plan). Necesita el secreto
   KMS_MASTER_V1 en el Worker y las reglas de Firestore que admiten el modo 'managed'. En false la
   tarjeta vuelve a «Próximamente»; los proyectos gestionados que ya existan se siguen abriendo (y
   siguen dependiendo del Worker).
   vaultTotp: ofrecer la verificación en dos pasos del gestor de contraseñas. Necesita KMS_MASTER_V1
   y el límite TOTP_RATE_LIMIT en el Worker (wrangler.jsonc). En false no se puede activar; los
   cofres que ya la tengan siguen pidiendo el código (y siguen dependiendo del Worker). */
Workhub.features = {
  encryptedProjects: true,
  managedEncryption: true,
  vaultTotp: true
};
