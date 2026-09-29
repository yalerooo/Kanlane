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

  Workhub.services.platform = {mode, isAvailable, isLocal, connectDb, uploadAsset, download, assetSrc, hydrateAssetImages, whenReady};
})();
