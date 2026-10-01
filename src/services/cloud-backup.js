/* Copias cifradas en Firestore, privadas de cada cuenta. La clave aleatoria
   permanece en este navegador y se puede copiar para recuperar en otro. */
(function(){
  const KEY_PREFIX = 'workhub_cloud_backup_key:';
  const MAX_CHUNKS = 16;
  const CHUNK_SIZE = 300000;
  const KEEP = 7;

  function encoded(bytes){
    let result = '';
    for(let i = 0; i < bytes.length; i += 8192){
      result += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decoded(value){
    if(!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid-key');
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }
  function keyName(uid){ return KEY_PREFIX + uid; }
  function getKey(uid){
    try{
      const key = localStorage.getItem(keyName(uid)) || '';
      return decoded(key).length === 32 ? key : '';
    }catch(e){ return ''; }
  }
  function setKey(uid, key){
    if(decoded(key).length !== 32) throw new Error('invalid-key');
    localStorage.setItem(keyName(uid), key);
  }
  function createKey(uid){
    const key = encoded(crypto.getRandomValues(new Uint8Array(32)));
    setKey(uid, key);
    return key;
  }
  function forgetKey(uid){ localStorage.removeItem(keyName(uid)); }
  function ref(db){ return db.collection('backup_versions'); }
  function chunks(db, id){ return db.collection('backup_versions/' + id + '/chunks'); }
  function list(db, projectId){
    return ref(db).where('projectId', '==', projectId).get().then((snap) =>
      snap.docs.filter((doc) => doc.data().complete === true)
        .map((doc) => Object.assign({id:doc.id}, doc.data()))
        .sort((a, b) => b.createdAt - a.createdAt));
  }
  function listAny(db){
    return ref(db).get().then((snap) => snap.docs.filter((doc) => doc.data().complete === true)
      .map((doc) => Object.assign({id:doc.id}, doc.data())));
  }
  async function encrypt(key, json){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const imported = await crypto.subtle.importKey('raw', decoded(key), 'AES-GCM', false, ['encrypt']);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, imported, new TextEncoder().encode(json)));
    return {iv:encoded(iv), data:encoded(cipher)};
  }
  async function decrypt(key, iv, data){
    const imported = await crypto.subtle.importKey('raw', decoded(key), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:decoded(iv)}, imported, decoded(data));
    return new TextDecoder('utf-8', {fatal:true}).decode(plain);
  }
  async function remove(db, id){
    const snap = await chunks(db, id).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
    await ref(db).doc(id).delete();
  }
  async function save(db, projectId, backup, key){
    const encrypted = await encrypt(key, backup.json);
    const parts = encrypted.data.match(new RegExp('.{1,' + CHUNK_SIZE + '}', 'g')) || [];
    if(parts.length < 1 || parts.length > MAX_CHUNKS) throw new Error('backup-too-large');
    const id = crypto.randomUUID();
    const meta = {projectId, createdAt:Date.now(), iv:encrypted.iv,
      chunkCount:parts.length, complete:false, counts:backup.counts};
    await ref(db).doc(id).set(meta);
    try{
      const writes = await Promise.allSettled(parts.map((data, index) => chunks(db, id).doc(String(index)).set({index, data})));
      const failed = writes.find((result) => result.status === 'rejected');
      if(failed) throw failed.reason;
      await ref(db).doc(id).update({complete:true});
    }catch(error){
      await remove(db, id).catch(() => {});
      throw error;
    }
    const entries = await list(db, projectId);
    await Promise.allSettled(entries.slice(KEEP).map((old) => remove(db, old.id)));
    return Object.assign({id}, meta, {complete:true});
  }
  async function get(db, id, projectId, key){
    const snap = await ref(db).doc(id).get();
    if(!snap.exists) throw new Error('missing-backup');
    const meta = snap.data();
    if(!meta.complete || meta.projectId !== projectId || meta.chunkCount < 1 || meta.chunkCount > MAX_CHUNKS){
      throw new Error('missing-backup');
    }
    const parts = await Promise.all(Array.from({length:meta.chunkCount}, (_, index) => chunks(db, id).doc(String(index)).get()));
    if(parts.some((part, index) => !part.exists || part.data().index !== index)) throw new Error('incomplete-backup');
    return JSON.parse(await decrypt(key, meta.iv, parts.map((part) => part.data().data).join('')));
  }

  Workhub.services.cloudBackup = {getKey, setKey, forgetKey, createKey, list, listAny, save, get, remove};
})();
