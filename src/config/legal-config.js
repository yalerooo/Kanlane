/* Datos del titular que aparecen en las páginas legales (aviso legal, política de
   privacidad, términos y política de cookies). Es el ÚNICO sitio donde hay que
   rellenarlos: las tres páginas leen de aquí (src/legal/legal.js).

   Son datos públicos: lo que pongas aquí lo verá cualquiera que abra las páginas.
   Obligación legal (LSSI-CE, art. 10 y RGPD, art. 13): hay que identificar al titular
   del servicio y dar una forma de contacto. Si dejas un campo vacío, la página lo
   marca en amarillo como «[completar: …]» y `node scripts/build-public.js` avisa. */
window.WORKHUB_LEGAL = {
  /* Nombre y apellidos si eres persona física (autónomo o particular), o razón social. */
  titular: '',
  /* NIF o CIF. */
  nif: '',
  /* Domicilio completo (calle, número, código postal, localidad, provincia, país). */
  domicilio: '',
  /* Correo de contacto, también para ejercer derechos de protección de datos. */
  email: '',
  /* Dirección de la web. */
  sitio: 'https://kanlane.com',
  /* Dónde se guardan los datos de las cuentas. Comprueba la región con la que creaste
     la base de datos de Firestore (consola de Firebase → Firestore → Datos; la guía
     docs/FIREBASE.md recomienda «eur3», que es la Unión Europea). */
  ubicacionDatos: 'la Unión Europea (región «eur3» de Google Cloud Firestore)',
  /* Fecha de la última revisión de los textos (AAAA-MM-DD) y número de versión. Súbela
     cuando cambies algo de fondo en las páginas legales. */
  actualizado: '2026-10-06',
  version: 9
};
