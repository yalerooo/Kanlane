/* Almacén local para cuando no existe window.claude (archivo abierto en local o
   servido fuera de claude.ai). Instala un equivalente basado en IndexedDB con la
   misma forma (claude.use('db'|'assets'|'downloads')), de modo que el resto de la
   aplicación funciona igual en los dos sitios. */
if(!window.claude){
  (function(){
    var DB_NAME = 'tablero_local_db';
    var DB_VERSION = 1;
    var DOCS_STORE = 'docs';
    var ASSETS_STORE = 'assets';
    var idbPromise = null;

    function openIdb(){
      if(idbPromise) return idbPromise;
      idbPromise = new Promise(function(resolve, reject){
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(){
          var idb = req.result;
          if(!idb.objectStoreNames.contains(DOCS_STORE)) idb.createObjectStore(DOCS_STORE, {keyPath:'path'});
          if(!idb.objectStoreNames.contains(ASSETS_STORE)) idb.createObjectStore(ASSETS_STORE, {keyPath:'id'});
        };
        req.onsuccess = function(){ resolve(req.result); };
        req.onerror = function(){ reject(req.error); };
      });
      return idbPromise;
    }
    function idbGet(store, key){
      return openIdb().then(function(idb){
        return new Promise(function(resolve, reject){
          var req = idb.transaction(store, 'readonly').objectStore(store).get(key);
          req.onsuccess = function(){ resolve(req.result || null); };
          req.onerror = function(){ reject(req.error); };
        });
      });
    }
    function idbGetAll(store){
      return openIdb().then(function(idb){
        return new Promise(function(resolve, reject){
          var req = idb.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = function(){ resolve(req.result || []); };
          req.onerror = function(){ reject(req.error); };
        });
      });
    }
    function idbPut(store, record){
      return openIdb().then(function(idb){
        return new Promise(function(resolve, reject){
          var tx = idb.transaction(store, 'readwrite');
          tx.objectStore(store).put(record);
          tx.oncomplete = function(){ resolve(); };
          tx.onerror = function(){ reject(tx.error); };
        });
      });
    }
    function idbDelete(store, key){
      return openIdb().then(function(idb){
        return new Promise(function(resolve, reject){
          var tx = idb.transaction(store, 'readwrite');
          tx.objectStore(store).delete(key);
          tx.oncomplete = function(){ resolve(); };
          tx.onerror = function(){ reject(tx.error); };
        });
      });
    }

    function randomId(){
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }

    var listeners = {};
    function notify(key){
      (listeners[key] || []).slice().forEach(function(fn){ fn(); });
    }

    function makeDocRef(collPath, id){
      var path = collPath + '/' + id;
      return {
        id: id,
        path: path,
        get: function(){
          return idbGet(DOCS_STORE, path).then(function(rec){
            return { exists: !!rec, id: id, data: function(){ return rec ? rec.data : undefined; } };
          });
        },
        set: function(data){
          return idbPut(DOCS_STORE, {path:path, data:data}).then(function(){ notify(collPath); notify(path); });
        },
        update: function(patch){
          return idbGet(DOCS_STORE, path).then(function(rec){
            var merged = Object.assign({}, rec ? rec.data : {}, patch);
            return idbPut(DOCS_STORE, {path:path, data:merged});
          }).then(function(){ notify(collPath); notify(path); });
        },
        delete: function(){
          return idbDelete(DOCS_STORE, path).then(function(){ notify(collPath); notify(path); });
        },
        onSnapshot: function(next, err){
          function fire(){
            idbGet(DOCS_STORE, path).then(function(rec){
              next({ exists: !!rec, id: id, data: function(){ return rec ? rec.data : undefined; } });
            }).catch(function(e){ if(err) err({code:'unavailable', message:String(e)}); });
          }
          if(!listeners[path]) listeners[path] = [];
          listeners[path].push(fire);
          setTimeout(fire, 0);
          return function(){ listeners[path] = (listeners[path]||[]).filter(function(f){ return f!==fire; }); };
        },
        collection: function(sub){ return makeCollRef(path + '/' + sub); }
      };
    }

    function makeCollRef(collPath, filters, order){
      filters = filters || [];
      order = order || null;
      var depth = collPath.split('/').length + 1;
      var prefix = collPath + '/';

      function snapshotDocs(){
        return idbGetAll(DOCS_STORE).then(function(all){
          var docs = all.filter(function(rec){
            return rec.path.indexOf(prefix) === 0 && rec.path.split('/').length === depth;
          }).map(function(rec){
            var id = rec.path.split('/').pop();
            return { id:id, exists:true, data: function(){ return rec.data; } };
          });
          filters.forEach(function(f){
            docs = docs.filter(function(d){
              var v = d.data()[f[0]];
              if(f[1] === '==') return v === f[2];
              if(f[1] === '!=') return v !== f[2];
              return true;
            });
          });
          if(order){
            docs.sort(function(a,b){
              var av = a.data()[order[0]], bv = b.data()[order[0]];
              if(av < bv) return order[1]==='desc' ? 1 : -1;
              if(av > bv) return order[1]==='desc' ? -1 : 1;
              return 0;
            });
          }
          return docs;
        });
      }

      var ref = {
        path: collPath,
        doc: function(id){ return makeDocRef(collPath, id || randomId()); },
        add: function(data){
          var id = randomId();
          return makeDocRef(collPath, id).set(data).then(function(){ return makeDocRef(collPath, id); });
        },
        where: function(f, op, v){ return makeCollRef(collPath, filters.concat([[f,op,v]]), order); },
        orderBy: function(f, dir){ return makeCollRef(collPath, filters, [f, dir||'asc']); },
        get: function(){
          return snapshotDocs().then(function(docs){ return { docs:docs, size:docs.length, empty:docs.length===0 }; });
        },
        onSnapshot: function(next, err){
          function fire(){
            snapshotDocs().then(function(docs){
              next({ docs:docs, size:docs.length, empty:docs.length===0, docChanges:function(){ return []; } });
            }).catch(function(e){ if(err) err({code:'unavailable', message:String(e)}); });
          }
          if(!listeners[collPath]) listeners[collPath] = [];
          listeners[collPath].push(fire);
          setTimeout(fire, 0);
          return function(){ listeners[collPath] = (listeners[collPath]||[]).filter(function(f){ return f!==fire; }); };
        }
      };
      return ref;
    }

    var localDb = {
      doc: function(path){
        var parts = path.split('/').filter(Boolean);
        var id = parts.pop();
        return makeDocRef(parts.join('/'), id);
      },
      collection: function(path){ return makeCollRef(path); }
    };

    var assetUrlCache = {};
    var localAssets = {
      upload: function(blob, options){
        var id = randomId() + randomId();
        var contentType = (options && options.type) || blob.type || 'application/octet-stream';
        return idbPut(ASSETS_STORE, {id:id, blob:blob, contentType:contentType}).then(function(){
          var url = URL.createObjectURL(blob);
          assetUrlCache[id] = url;
          return { id:id, url:url, sizeBytes: blob.size, contentType: contentType };
        });
      },
      list: function(){
        return idbGetAll(ASSETS_STORE).then(function(all){
          var assets = all.map(function(rec){
            return { id: rec.id, url: window.__localAssetUrlSync(rec.id), contentType: rec.contentType, sizeBytes: rec.blob.size, createdAt: '' };
          });
          return { assets: assets, usage: { files: assets.length, bytes:0, maxFiles:100000, maxBytes:0 } };
        });
      },
      delete: function(id){
        return idbDelete(ASSETS_STORE, id).then(function(){ delete assetUrlCache[id]; return {deleted:true}; });
      }
    };

    window.__localAssetUrl = function(id){
      if(assetUrlCache[id]) return Promise.resolve(assetUrlCache[id]);
      return idbGet(ASSETS_STORE, id).then(function(rec){
        if(!rec) return null;
        var url = URL.createObjectURL(rec.blob);
        assetUrlCache[id] = url;
        return url;
      });
    };
    window.__localAssetUrlSync = function(id){ return assetUrlCache[id] || ''; };

    var localDownloads = {
      save: function(req){
        return new Promise(function(resolve, reject){
          try{
            var blob = (req.data instanceof Blob) ? req.data : new Blob([req.data], {type:'text/plain'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = req.filename || 'archivo';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
            resolve({status:'saved'});
          }catch(e){
            reject({code:'unavailable', message:String(e)});
          }
        });
      }
    };

    window.__usingLocalStorageShim = true;
    window.claude = {
      use: function(name){
        if(name === 'db') return Promise.resolve(localDb);
        if(name === 'assets') return Promise.resolve(localAssets);
        if(name === 'downloads') return Promise.resolve(localDownloads);
        return Promise.resolve(null);
      }
    };
  })();
}
