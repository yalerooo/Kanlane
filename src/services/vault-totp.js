/* Verificación en dos pasos del gestor de contraseñas (TOTP, RFC 6238).
   El código lo comprueba el Worker (/__/kms/v1/totp, ver worker/index.js), no el navegador: solo
   con un código válido devuelve la clave («share») que, junto con la contraseña maestra, abre la
   clave del cofre. Por eso hace falta una cuenta: en modo local no hay quien lo compruebe.
   Errores (.code): 'totp-code', 'totp-rate', 'totp-auth', 'totp-network', 'totp-unavailable'. */
(function(){
  const URL_PATH = '/__/kms/v1/totp';
  const SECRET_BYTES = 20;
  const SHARE_BYTES = 32;
  /* Base32 de RFC 4648: el que entienden las aplicaciones de autenticación (el de la clave de
     recuperación, en crypto.js, es otro alfabeto). */
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function fail(code){
    const err = new Error(code);
    err.code = code;
    return err;
  }

  function base32(bytes){
    let bits = 0, value = 0, out = '';
    for(let i = 0; i < bytes.length; i++){
      value = ((value << 8) | bytes[i]) & 0xffff;
      bits += 8;
      while(bits >= 5){
        out += B32[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if(bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
  }

  function b64url(bytes){
    return Workhub.services.crypto.b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64url(str){
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while(s.length % 4) s += '=';
    return Workhub.services.crypto.b64decode(s);
  }

  /* ¿Se puede usar? Hace falta la función activada y una cuenta que dé ID token. */
  function available(rootDb){
    return !!(Workhub.features && Workhub.features.vaultTotp) && !!rootDb && typeof rootDb.idToken === 'function';
  }

  function newSecret(){
    return Workhub.services.crypto.randomBytes(SECRET_BYTES);
  }

  /* La clave tal como se teclea en la aplicación: grupos de cuatro. */
  function formatSecret(bytes){
    return (base32(bytes).match(/.{1,4}/g) || []).join(' ');
  }

  /* Enlace otpauth:// (lo abren las aplicaciones de autenticación del propio dispositivo). */
  function uri(bytes, account){
    const make = (label) => 'otpauth://totp/' + encodeURIComponent(label) + '?secret=' + base32(bytes) + '&issuer=Kanlane';
    const full = make('Kanlane' + (account ? ':' + account : ''));
    /* Con un correo larguísimo no cabría en el código QR (utils/qr.js): va sin él. */
    return full.length <= 200 ? full : make('Kanlane');
  }

  async function request(rootDb, body){
    let res;
    try{
      const token = await rootDb.idToken();
      res = await fetch(URL_PATH, {
        method:'POST', cache:'no-store', credentials:'omit',
        headers:{'Content-Type':'application/json', Authorization:'Bearer ' + token},
        body:JSON.stringify(body)
      });
    }catch(err){
      throw fail('totp-network');
    }
    if(res.status === 401) throw fail('totp-auth');
    if(res.status === 403) throw fail('totp-code');
    if(res.status === 429) throw fail('totp-rate');
    if(!res.ok) throw fail('totp-unavailable');
    try{
      const data = await res.json();
      const share = fromB64url(data.share);
      if(typeof data.token !== 'string' || share.length !== SHARE_BYTES) throw fail('totp-unavailable');
      return {token:data.token, share:share};
    }catch(err){
      throw fail('totp-unavailable');
    }
  }

  /* Alta: el Worker comprueba el primer código y devuelve {token, share}. */
  function enroll(rootDb, secretBytes, code){
    return request(rootDb, {op:'enroll', secret:b64url(secretBytes), code:cleanCode(code)});
  }

  /* Devuelve la clave (bytes) si el código es válido. */
  function verify(rootDb, token, code){
    return request(rootDb, {op:'verify', token:token, code:cleanCode(code)}).then((r) => r.share);
  }

  function cleanCode(code){
    return String(code || '').replace(/\D/g, '');
  }

  Workhub.services.vaultTotp = {available, newSecret, formatSecret, uri, enroll, verify, cleanCode};
})();
