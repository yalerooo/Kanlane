/* Acceso a las capacidades del entorno: base de datos, imágenes subidas y
   descargas de archivos. Tres modos posibles:
   - 'claude':   dentro de un Artifact de claude.ai (window.claude real);
   - 'firebase': publicado en la web con cuenta de usuario (services/firebase-backend.js);
   - 'local':    sin nada de lo anterior, en IndexedDB del navegador
                 (core/local-storage-shim.js). */
(function(){
  function isAvailable(){
    return !!(window.claude && window.claude.use);
  }

  function mode(){
    if(window.__workhubBackend) return window.__workhubBackend;
    return window.__usingLocalStorageShim ? 'local' : 'claude';
  }

  function isLocal(){
    return mode() === 'local';
  }

  function use(name){
    if(!isAvailable()) return Promise.resolve(null);
    return window.claude.use(name);
  }

  function connectDb(){
    return use('db');
  }

  function connectAssets(){
    return use('assets');
  }

  /* Sube una imagen y devuelve su id ('' si este modo no guarda imágenes). Si la subida
     falla, la promesa se rechaza (con err.code 'image-too-large' o 'image-unreadable'
     cuando es por la imagen) para que la nota no se guarde sin ella sin avisar. */
  function uploadAsset(file){
    return use('assets').then((assets) => {
      if(!assets) return '';
      return assets.upload(file).then((res) => res.id);
    });
  }

  /* Archivos adjuntos que no son imágenes: como mucho 10 MB cada uno y 10 adjuntos por nota. */
  const FILE_MAX_BYTES = 10 * 1024 * 1024;
  const NOTE_MAX_FILES = 10;

  /* Sube un archivo tal cual y devuelve los ids de sus trozos ([] si este modo no guarda
     archivos). En la nube se reparte en varios documentos (firebase-backend.js); en local y
     en claude.ai va entero. Se rechaza con err.code 'file-too-large' si pasa del máximo. */
  function uploadFile(file){
    if(file.size > FILE_MAX_BYTES){
      const err = new Error('file-too-large');
      err.code = 'file-too-large';
      return Promise.reject(err);
    }
    return use('assets').then((assets) => {
      if(!assets) return [];
      if(assets.uploadFile) return assets.uploadFile(file).then((res) => res.parts);
      return assets.upload(file, {type:file.type || 'application/octet-stream'}).then((res) => [res.id]);
    });
  }

  /* Contenido de un adjunto ({parts, type}) como Blob, para descargarlo. */
  function fileBlob(att){
    const parts = Array.isArray(att && att.parts) ? att.parts : [];
    const type = (att && att.type) || 'application/octet-stream';
    if(window.__assetBytes){
      return Promise.all(parts.map((id) => window.__assetBytes(id))).then((chunks) => {
        if(!chunks.length || chunks.some((c) => !c)) throw new Error('file-missing');
        return new Blob(chunks, {type:type});
      });
    }
    const url = mode() === 'claude' ? Promise.resolve('/_blob/' + parts[0])
      : window.__localAssetUrl ? window.__localAssetUrl(parts[0]) : Promise.resolve('');
    return url.then((src) => {
      if(!src || !parts[0]) throw new Error('file-missing');
      return fetch(src).then((res) => res.blob()).then((blob) => new Blob([blob], {type:type}));
    });
  }

  /* Borra imágenes y trozos de archivos que ya no enlaza ninguna nota. Si alguno falla, se sigue. */
  function deleteAssets(ids){
    if(!ids || !ids.length) return Promise.resolve();
    return use('assets').then((assets) => {
      if(!assets || !assets.delete) return null;
      return Promise.all(ids.map((id) => assets.delete(id).catch(() => null)));
    }).catch(() => null);
  }

  function download(filename, data){
    return use('downloads').then((dl) => {
      if(!dl) throw new Error('no-downloads');
      return dl.save({filename:filename, data:data});
    });
  }

  function assetSrc(assetId){
    return mode() === 'claude' ? ('/_blob/' + assetId) : '';
  }

  /* En modo local y en la nube las imágenes se resuelven a URLs al pintarlas. */
  function hydrateAssetImages(container){
    if(mode() === 'claude') return;
    const resolve = window.__assetUrl || window.__localAssetUrl;
    if(!resolve) return;
    container.querySelectorAll('img[data-asset-id]').forEach((img) => {
      const id = img.getAttribute('data-asset-id');
      if(!id) return;
      resolve(id).then((url) => { if(url) img.src = url; }).catch(() => {});
    });
  }

  /* Ejecuta fn cuando el entorno está listo (recarga en caliente en claude.ai). */
  function whenReady(fn){
    if(window.claude && window.claude.hot && window.claude.hot.ready){
      window.claude.hot.ready(fn);
    } else {
      fn();
    }
  }

  Workhub.services.platform = {mode, isAvailable, isLocal, connectDb, connectAssets, uploadAsset, uploadFile, fileBlob, deleteAssets, download, assetSrc, hydrateAssetImages, whenReady,
    fileLimits: {maxBytes: FILE_MAX_BYTES, maxPerNote: NOTE_MAX_FILES}};
})();
