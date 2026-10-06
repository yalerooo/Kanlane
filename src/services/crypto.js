/* Cifrado del gestor de contraseñas (Web Crypto: PBKDF2 + AES-GCM 256)
   y codificación de la clave de recuperación en base32 legible. */
(function(){
  const PBKDF2_ITERATIONS = 300000;
  const B32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  const isAvailable = !!(window.crypto && window.crypto.subtle);

  function randomBytes(n){
    return crypto.getRandomValues(new Uint8Array(n));
  }

  function b64encode(bytes){
    const arr = new Uint8Array(bytes);
    let bin = '';
    for(let i = 0; i < arr.length; i++){ bin += String.fromCharCode(arr[i]); }
    return btoa(bin);
  }

  function b64decode(str){
    const bin = atob(str);
    const arr = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++){ arr[i] = bin.charCodeAt(i); }
    return arr;
  }

  function base32Encode(bytes){
    let bits = 0, value = 0, output = '';
    for(let i = 0; i < bytes.length; i++){
      value = (value << 8) | bytes[i];
      bits += 8;
      while(bits >= 5){
        output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if(bits > 0){ output += B32_ALPHABET[(value << (5 - bits)) & 31]; }
    return output;
  }

  function base32Decode(str){
    const clean = String(str || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    let bits = 0, value = 0;
    const out = [];
    for(let i = 0; i < clean.length; i++){
      const idx = B32_ALPHABET.indexOf(clean[i]);
      if(idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if(bits >= 8){
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function formatRecoveryKey(bytes){
    const groups = base32Encode(bytes).match(/.{1,4}/g) || [];
    return groups.join('-');
  }

  /* Contraseña aleatoria para usar de contraseña maestra: cuatro grupos de cinco letras y cifras
     (unos 116 bits), sin los caracteres que se confunden al copiarla a mano (0/O, 1/l/I). */
  const PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generatePassword(){
    const n = PASSWORD_CHARS.length;
    const limit = 256 - (256 % n);
    let out = '';
    while(out.length < 20){
      const bytes = randomBytes(32);
      for(let i = 0; i < bytes.length && out.length < 20; i++){
        /* Los bytes que sobran se descartan: si no, unas letras saldrían más que otras. */
        if(bytes[i] < limit) out += PASSWORD_CHARS[bytes[i] % n];
      }
    }
    return out.match(/.{5}/g).join('-');
  }

  function deriveKey(password, saltBytes){
    const enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), {name:'PBKDF2'}, false, ['deriveKey']).then((baseKey) => {
      return crypto.subtle.deriveKey(
        {name:'PBKDF2', salt:saltBytes, iterations:PBKDF2_ITERATIONS, hash:'SHA-256'},
        baseKey,
        {name:'AES-GCM', length:256},
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  /* Clave AES a partir de un código aleatorio largo (los códigos de respaldo: 80 bits). Con esa
     entropía no hace falta una derivación lenta como la de las contraseñas. */
  function codeKey(bytes){
    const prefix = new TextEncoder().encode('kanlane-vault-backup-v1|');
    const data = new Uint8Array(prefix.length + bytes.length);
    data.set(prefix);
    data.set(bytes, prefix.length);
    return crypto.subtle.digest('SHA-256', data).then((hash) => importAesKeyRaw(new Uint8Array(hash)));
  }

  function importAesKeyRaw(bytes){
    return crypto.subtle.importKey('raw', bytes, {name:'AES-GCM'}, false, ['encrypt', 'decrypt']);
  }

  function encryptJSON(key, obj){
    const iv = randomBytes(12);
    const data = new TextEncoder().encode(JSON.stringify(obj));
    return crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, key, data).then((buf) => {
      return {iv:b64encode(iv), cipher:b64encode(new Uint8Array(buf))};
    });
  }

  function decryptJSON(key, ivB64, cipherB64){
    return crypto.subtle.decrypt({name:'AES-GCM', iv:b64decode(ivB64)}, key, b64decode(cipherB64)).then((buf) => {
      return JSON.parse(new TextDecoder().decode(buf));
    });
  }

  Workhub.services.crypto = {
    isAvailable, randomBytes, b64encode, b64decode, base32Decode, formatRecoveryKey, generatePassword,
    deriveKey, codeKey, importAesKeyRaw, encryptJSON, decryptJSON
  };
})();
