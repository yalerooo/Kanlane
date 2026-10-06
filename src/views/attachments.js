/* Adjuntos de las notas: cómo se pintan (imágenes en mosaico, el resto como archivo que se
   descarga), el selector de lo que se va a adjuntar (varios archivos, pegar y soltar) y el
   visor de imágenes ampliadas. Lo comparten la ficha y el diálogo de la tarea. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const platform = Workhub.services.platform;
  const $ = (id) => document.getElementById(id);

  const LIMITS = platform.fileLimits || {maxBytes:10 * 1024 * 1024, maxPerNote:10};
  const FILE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
  const REMOVE_ICON = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* 1536 → «1,5 KB». */
  function sizeText(bytes){
    if(!(bytes > 0)) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes, u = 0;
    while(n >= 1024 && u < units.length - 1){ n /= 1024; u++; }
    return (u && n < 10 ? n.toFixed(1) : String(Math.round(n))).replace('.', ',') + ' ' + units[u];
  }

  const isImage = (file) => /^image\//.test(file.type || '');

  /* ---------- Adjuntos de una nota guardada ---------- */

  function html(n){
    const list = Workhub.models.TaskModel.attachmentsOf(n);
    const images = list.filter((a) => a.image);
    const files = list.filter((a) => !a.image);
    return (images.length ? '<div class="att-grid' + (images.length > 1 ? ' is-many' : '') + '">' + images.map((a) =>
        '<img src="' + esc(platform.assetSrc(a.parts[0])) + '" data-asset-id="' + esc(a.parts[0]) + '" alt="' + esc(a.name || Workhub.t('Imagen de la nota')) + '" loading="lazy">').join('') + '</div>' : '') +
      (files.length ? '<div class="att-files">' + files.map((a) =>
        '<button type="button" class="att-file" data-att-parts="' + esc(a.parts.join(',')) + '" data-att-name="' + esc(a.name) + '" data-att-type="' + esc(a.type) + '" title="' + esc(Workhub.t('Descargar')) + '">' +
        FILE_ICON + '<span class="att-file-name" translate="no">' + esc(a.name || Workhub.t('Archivo')) + '</span>' +
        (a.size ? '<span class="att-file-size">' + esc(sizeText(a.size)) + '</span>' : '') + '</button>').join('') + '</div>' : '');
  }

  /* Clic en una imagen → visor (con las demás de su nota); clic en un archivo → descarga. */
  function bind(container){
    container.addEventListener('click', (ev) => {
      const img = closest(ev.target, 'img[data-asset-id]');
      if(img){
        const group = closest(img, '.att-grid');
        const all = group ? Array.prototype.slice.call(group.querySelectorAll('img[data-asset-id]')) : [img];
        lightbox.open(all.map((el) => el.currentSrc || el.src), all.indexOf(img));
        return;
      }
      const file = closest(ev.target, 'button[data-att-parts]');
      if(!file || file.disabled) return;
      file.disabled = true;
      file.classList.add('is-busy');
      platform.fileBlob({parts:file.getAttribute('data-att-parts').split(',').filter(Boolean), type:file.getAttribute('data-att-type')})
        .then((blob) => platform.download(file.getAttribute('data-att-name') || 'archivo', blob))
        .catch(() => Workhub.views.toast && Workhub.views.toast.error('No se pudo descargar el archivo.'))
        .then(() => { file.disabled = false; file.classList.remove('is-busy'); });
    });
  }

  /* ---------- Selector de lo que se va a adjuntar ---------- */

  /* o: {input, button, list, drop, paste, onError(msg)}
     - input: <input type="file" multiple>; button: lo abre; list: donde se pintan los elegidos;
     - drop: zona sobre la que se pueden soltar archivos; paste: campo en el que se pueden pegar. */
  class Picker {
    constructor(o){
      this.o = o;
      this.files = [];
      this.urls = [];
      o.button.addEventListener('click', () => o.input.click());
      o.input.addEventListener('change', () => {
        this.add(o.input.files);
        o.input.value = '';
      });
      o.list.addEventListener('click', (ev) => {
        const btn = closest(ev.target, 'button[data-att-remove]');
        if(!btn) return;
        this.files.splice(+btn.getAttribute('data-att-remove'), 1);
        this.render();
      });
      if(o.paste){
        o.paste.addEventListener('paste', (ev) => {
          const files = ev.clipboardData && ev.clipboardData.files;
          if(!files || !files.length) return;
          ev.preventDefault();
          this.add(files);
        });
      }
      if(o.drop){
        const hasFiles = (ev) => ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') !== -1;
        o.drop.addEventListener('dragover', (ev) => {
          if(!hasFiles(ev)) return;
          ev.preventDefault();
          o.drop.classList.add('is-dropping');
        });
        o.drop.addEventListener('dragleave', (ev) => { if(!o.drop.contains(ev.relatedTarget)) o.drop.classList.remove('is-dropping'); });
        o.drop.addEventListener('drop', (ev) => {
          if(!hasFiles(ev)) return;
          ev.preventDefault();
          o.drop.classList.remove('is-dropping');
          this.add(ev.dataTransfer.files);
        });
      }
    }

    add(fileList){
      let problem = '';
      Array.prototype.forEach.call(fileList || [], (file) => {
        if(this.files.length >= LIMITS.maxPerNote){
          problem = Workhub.t('Una nota admite como mucho {n} adjuntos.', {n:LIMITS.maxPerNote});
        } else if(!isImage(file) && file.size > LIMITS.maxBytes){
          problem = Workhub.t('«{name}» supera el máximo de {max} por archivo.', {name:file.name, max:sizeText(LIMITS.maxBytes)});
        } else this.files.push(file);
      });
      this.render();
      if(problem && this.o.onError) this.o.onError(problem);
    }

    clear(){
      this.files = [];
      this.o.input.value = '';
      this.render();
    }

    render(){
      this.urls.forEach((u) => URL.revokeObjectURL(u));
      this.urls = [];
      this.o.list.hidden = !this.files.length;
      this.o.list.innerHTML = this.files.map((file, i) => {
        let thumb = FILE_ICON;
        if(isImage(file)){
          const url = URL.createObjectURL(file);
          this.urls.push(url);
          thumb = '<img src="' + esc(url) + '" alt="">';
        }
        return '<span class="att-chip">' + thumb + '<span class="att-file-name" translate="no">' + esc(file.name || Workhub.t('Imagen')) + '</span>' +
          (isImage(file) ? '' : '<span class="att-file-size">' + esc(sizeText(file.size)) + '</span>') +
          '<button type="button" class="att-chip-remove" data-att-remove="' + i + '" aria-label="' + esc(Workhub.t('Quitar adjunto')) + '" title="' + esc(Workhub.t('Quitar adjunto')) + '">' + REMOVE_ICON + '</button></span>';
      }).join('');
    }
  }

  /* Sube los archivos elegidos, uno detrás de otro → adjuntos listos para TaskModel.addNote. Las
     imágenes se reducen como siempre; lo demás (y las imágenes que el navegador no sabe
     dibujar) se sube tal cual. Si algo falla, se borra lo ya subido y se rechaza con err.file. */
  function upload(files){
    const done = [];
    const asFile = (file) => platform.uploadFile(file).then((parts) => ({name:file.name || '', type:file.type || '', size:file.size, image:false, parts:parts}));
    const one = (file) => !isImage(file) ? asFile(file)
      : platform.uploadAsset(file).then((id) => ({name:file.name || '', type:'image/jpeg', size:0, image:true, parts:id ? [id] : []}),
        (err) => { if(err && err.code === 'image-unreadable' && file.size <= LIMITS.maxBytes) return asFile(file); throw err; });
    return files.reduce((chain, file) => chain.then(() => one(file)).then((att) => { if(att.parts.length) done.push(att); }, (err) => {
      const fail = err instanceof Error ? err : new Error(String(err));
      if(!fail.file) fail.file = file.name || '';
      throw fail;
    }), Promise.resolve()).then(() => done, (err) => {
      return platform.deleteAssets(done.reduce((ids, a) => ids.concat(a.parts), [])).then(() => { throw err; });
    });
  }

  /* Por qué no se pudo subir, dicho para la persona. */
  function uploadError(err){
    const code = err && (err.code || err.message);
    const name = (err && err.file) || '';
    const t = Workhub.t;
    if(code === 'image-too-large') return t('La imagen «{name}» es demasiado grande y no se pudo reducir lo suficiente. La nota no se ha guardado: prueba con una imagen más pequeña.', {name:name});
    if(code === 'file-too-large') return t('«{name}» supera el máximo de {max} por archivo.', {name:name, max:sizeText(LIMITS.maxBytes)}) + ' ' + t('La nota no se ha guardado.');
    return t('No se pudo subir «{name}». La nota no se ha guardado.', {name:name});
  }

  /* ---------- Visor de imágenes ---------- */

  /* Es un <dialog> modal: así queda por encima de la ficha de la tarea, que también lo es. */
  const lightbox = {
    urls: [],
    at: 0,
    ready: false,
    init(){
      if(this.ready) return;
      this.ready = true;
      this.dlg = $('lightbox');
      this.img = $('lightboxImg');
      this.prev = $('lightboxPrev');
      this.next = $('lightboxNext');
      this.count = $('lightboxCount');
      this.dlg.addEventListener('click', (ev) => {
        if(closest(ev.target, '#lightboxPrev')) this.show(this.at - 1);
        else if(closest(ev.target, '#lightboxNext')) this.show(this.at + 1);
        else if(ev.target !== this.img) this.dlg.close();
      });
      this.dlg.addEventListener('keydown', (ev) => {
        if(ev.key === 'ArrowLeft') this.show(this.at - 1);
        else if(ev.key === 'ArrowRight') this.show(this.at + 1);
      });
      this.dlg.addEventListener('close', () => { this.img.removeAttribute('src'); });
    },
    open(urls, index){
      this.init();
      this.urls = (urls || []).filter(Boolean);
      if(!this.urls.length) return;
      this.show(Math.max(0, index || 0));
      if(!this.dlg.open) this.dlg.showModal();
    },
    show(i){
      const n = this.urls.length;
      this.at = (i + n) % n;
      this.img.src = this.urls[this.at];
      this.prev.hidden = this.next.hidden = this.count.hidden = n < 2;
      this.count.textContent = (this.at + 1) + ' / ' + n;
    }
  };

  Workhub.views.attachments = {html, bind, Picker, upload, uploadError, sizeText, lightbox};
})();
