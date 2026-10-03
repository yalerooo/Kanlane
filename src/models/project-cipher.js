/* Cifrador de un proyecto con cifrado total: une la clave del proyecto (pid, kid, CryptoKey) con el
   esquema de campos (EncSchema). Los modelos lo reciben en connect(db, cipher) y no tocan Web Crypto.
   Plan: docs/CIFRADO-PROYECTOS.md, 6.2.

   Errores: Error con name 'ProjectCipherError' y .code =
     'undecryptable'  el documento no se abre con esta clave (otra clave, AAD distinta, blob manipulado)
     'too-large'      un texto, una lista o el blob superan su límite (.field dice cuál)
     'github-field'   una tarea lleva campos gh*: los proyectos cifrados no admiten GitHub
     'encrypted'      operación que no existe en un proyecto cifrado (sincronizar con GitHub)
     'stale'          se quiere cambiar un documento cuyo contenido aún no se ha leído
     'not-ready'      la colección todavía no ha cargado
     'partial'        un cambio en varios documentos no llegó a todos (.pending dice cuántos faltan) */
(function(){
  'use strict';
  const PC = Workhub.services.projectCrypto;
  const Schema = Workhub.models.EncSchema;

  /* Marcas que los modelos añaden en memoria y nunca se guardan. */
  const LOCAL_ONLY = ['id', '_undecryptable', '_plainInEncrypted', '_raw'];

  function fail(code, extra){
    const err = new Error('project-cipher: ' + code);
    err.name = 'ProjectCipherError';
    err.code = code;
    return Object.assign(err, extra || {});
  }
  function isError(err, code){
    return !!err && err.name === 'ProjectCipherError' && (code == null || err.code === code);
  }

  class ProjectCipher {
    /* opts: {pid, kid, key}; key es la DEK como CryptoKey no extraíble. */
    constructor(opts){
      const o = opts || {};
      /* Valida pid y kid con las mismas reglas que el servicio. */
      PC.aad({pid:o.pid, kid:o.kid, path:'x', id:'x', ev:PC.EV});
      if(!o.key) throw fail('undecryptable');
      this.pid = o.pid;
      this.kid = o.kid;
      this.key = o.key;
    }

    static error(code, extra){ return fail(code, extra); }
    static isError(err, code){ return isError(err, code); }
    static isSealed(raw){ return !!raw && Number.isInteger(raw.ev) && raw.ev >= 1; }

    isSealed(raw){ return ProjectCipher.isSealed(raw); }
    ivOf(e){ return PC.ivOf(e); }

    _aad(path, id){
      return {pid:this.pid, kid:this.kid, path:path, id:id, ev:PC.EV};
    }

    /* Separa un documento (o un cambio parcial) en lo que va en claro y lo que va en el blob. */
    split(path, data){
      const col = Schema.collectionOf(path);
      const clear = {}, secret = {};
      Object.keys(data || {}).forEach((k) => {
        if(LOCAL_ONLY.indexOf(k) !== -1 || Schema.SEAL.indexOf(k) !== -1) return;
        if(col === 'tasks' && /^gh[A-Z]/.test(k)) throw fail('github-field', {field:k});
        if(Schema.isClear(col, k)) clear[k] = data[k];
        else secret[k] = data[k];
      });
      return {clear:clear, secret:secret};
    }

    clearOf(path, raw){
      return this.split(path, raw).clear;
    }

    merge(clear, secret){
      return Object.assign({}, clear, secret);
    }

    /* Los límites que el servidor ya no puede comprobar dentro del blob. */
    check(path, secret){
      const col = Schema.collectionOf(path);
      const texts = Schema.textLimits(col), lists = Schema.listLimits(col);
      Object.keys(texts).forEach((k) => {
        const v = secret[k];
        if(v != null && (typeof v !== 'string' || v.length > texts[k])) throw fail('too-large', {field:k});
      });
      Object.keys(lists).forEach((k) => {
        const v = secret[k];
        if(v != null && (!Array.isArray(v) || v.length > lists[k])) throw fail('too-large', {field:k});
      });
    }

    /* Cifra los campos secretos de un documento → {e, ev, kid}. IV nuevo en cada llamada. */
    sealSecret(path, id, secret){
      return Promise.resolve().then(() => {
        this.check(path, secret);
        return PC.seal(this.key, this._aad(path, id), secret);
      }).then((e) => {
        if(e.length > Schema.maxE(Schema.collectionOf(path))) throw fail('too-large', {field:'e'});
        return {e:e, ev:PC.EV, kid:this.kid};
      });
    }

    /* Documento completo listo para guardar: {…campos en claro, e, ev, kid}. */
    seal(path, id, data){
      return Promise.resolve().then(() => {
        const parts = this.split(path, data);
        return this.sealSecret(path, id, parts.secret).then((s) => Object.assign({}, parts.clear, s));
      });
    }

    /* Abre un documento sellado → {plain, iv}. Otra clave, otra versión u otro sitio: 'undecryptable'. */
    open(path, id, raw){
      return Promise.resolve().then(() => {
        if(!this.isSealed(raw) || raw.kid !== this.kid || raw.ev !== PC.EV) throw fail('undecryptable');
        return PC.open(this.key, this._aad(path, id), raw.e);
      }).then((plain) => {
        if(!plain || typeof plain !== 'object' || Array.isArray(plain)) throw fail('undecryptable');
        return {plain:plain, iv:PC.ivOf(raw.e)};
      }, (err) => {
        throw isError(err) ? err : fail('undecryptable', {cause:err});
      });
    }

    /* Bloques sueltos que no son documentos del proyecto (archivo de copia cifrada, versiones locales
       de las copias): el mismo cifrado y la misma AAD, sin esquema ni tope de tamaño. */
    sealBlob(path, id, value){
      return Promise.resolve().then(() => PC.seal(this.key, this._aad(path, id), value));
    }

    openBlob(path, id, e){
      return Promise.resolve().then(() => PC.open(this.key, this._aad(path, id), e)).catch((err) => {
        throw fail('undecryptable', {cause:err});
      });
    }

    /* Imágenes: bytes en lugar de JSON, con la misma AAD. */
    sealBytes(path, id, bytes){
      return PC.sealBytes(this.key, this._aad(path, id), bytes).then((e) => {
        if(e.length > Schema.maxE(Schema.collectionOf(path))) throw fail('too-large', {field:'e'});
        return {e:e, ev:PC.EV, kid:this.kid};
      });
    }

    openBytes(path, id, raw){
      return Promise.resolve().then(() => {
        if(!this.isSealed(raw) || raw.kid !== this.kid || raw.ev !== PC.EV) throw fail('undecryptable');
        return PC.openBytes(this.key, this._aad(path, id), raw.e);
      }).catch((err) => {
        throw isError(err) ? err : fail('undecryptable', {cause:err});
      });
    }
  }

  Workhub.models.ProjectCipher = ProjectCipher;
})();
