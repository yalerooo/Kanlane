/* Acceso a las capacidades del entorno (window.claude real en claude.ai o el
   almacén local de src/core/local-storage-shim.js): base de datos, imágenes
   subidas y descargas de archivos. */
(function(){
  function isAvailable(){
    return !!(window.claude && window.claude.use);
  }

  function isLocal(){
    return !!window.__usingLocalStorageShim;
  }

  function use(name){
    if(!isAvailable()) return Promise.resolve(null);
    return window.claude.use(name);
  }

  function connectDb(){
    return use('db');
  }

  /* Sube una imagen y devuelve su id, o '' si no se pudo. */
  function uploadAsset(file){
    return use('assets').then((assets) => {
      if(!assets) return '';
      return assets.upload(file).then((res) => res.id).catch(() => '');
    });
  }

  function download(filename, data){
    return use('downloads').then((dl) => {
      if(!dl) throw new Error('no-downloads');
      return dl.save({filename:filename, data:data});
    });
  }

  function assetSrc(assetId){
    return isLocal() ? '' : ('/_blob/' + assetId);
  }

  /* En modo local las imágenes viven en IndexedDB: se resuelven a URLs blob. */
  function hydrateAssetImages(container){
    if(!isLocal()) return;
    container.querySelectorAll('img[data-asset-id]').forEach((img) => {
      const id = img.getAttribute('data-asset-id');
      if(!id) return;
      window.__localAssetUrl(id).then((url) => { if(url) img.src = url; });
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

  Workhub.services.platform = {isAvailable, isLocal, connectDb, uploadAsset, download, assetSrc, hydrateAssetImages, whenReady};
})();
