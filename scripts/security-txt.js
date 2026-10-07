/* security.txt (RFC 9116): dónde avisar de un fallo de seguridad. Lo usa scripts/build-public.js.
   Se publica en /.well-known/security.txt (la dirección de la norma) y en /security.txt (la
   antigua, por si un alojamiento no sirve carpetas que empiezan por punto). */
const FILES = ['/.well-known/security.txt', '/security.txt'];
/* «Expires» es obligatorio y no debería pasar de un año: se pone a 330 días de cada publicación,
   así que hay que volver a publicar al menos una vez al año para que no caduque. */
const DAYS = 330;
const CONTACT = /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/;

/* El texto del archivo, o null si falta un contacto o alguno no es «mailto:…» ni «https://…»
   («Contact» es obligatorio: sin él no se publica nada). */
function securityTxt(config, now){
  const contact = (config && config.contact) || [];
  if(!contact.length || !contact.every((c) => CONTACT.test(c))) return null;
  const expires = new Date(now + DAYS * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  return contact.map((c) => 'Contact: ' + c).concat([
    'Expires: ' + expires,
    'Preferred-Languages: ' + config.languages,
    'Canonical: ' + config.canonical
  ]).join('\n') + '\n';
}

module.exports = {securityTxt, FILES, DAYS};
