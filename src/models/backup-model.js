/* Exportación e importación de una copia de seguridad completa (.json).
   Importar siempre añade: nunca borra ni reemplaza datos existentes.

   Un proyecto con cifrado total exporta por defecto un archivo cifrado (docs/CIFRADO-PROYECTOS.md,
   11.3): el JSON de siempre sellado con la clave del proyecto, junto a los envoltorios de esa clave
   (contraseña y clave de recuperación). Para abrirlo basta la contraseña de cifrado o la clave de
   recuperación que estaban vigentes al exportar. */
(function(){
  const {safeUrl} = Workhub.utils.urls;
  const FORMAT_VERSION = 1;
  const ENCRYPTED_FORMAT = 'kanlane-encrypted-backup';
  const ENCRYPTED_VERSION = 1;
  /* Ruta lógica que va en la AAD del archivo: «kanlane/v1|pid|kid|export|{fecha}|1». */
  const EXPORT_PATH = 'export';

  function fail(code){
    const err = new Error('backup: ' + code);
    err.name = 'BackupError';
    err.code = code;
    return err;
  }

  /* "Agencia Norte" → "agencia-norte" (para el nombre del archivo). */
  function slug(text){
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  /* Lo que admite una tarea (firestore.rules y enc-schema.js). */
  const CHECKLIST_MAX = 200;
  const CHECK_TEXT_MAX = 500;
  const NOTE_FILES_MAX = 20;

  /* Subtareas de una tarea del archivo, tal como se guardan: [{id, text, done}]. */
  function checklistOf(value){
    const seen = {};
    const out = [];
    (Array.isArray(value) ? value : []).forEach((c, i) => {
      const text = c && typeof c.text === 'string' ? c.text.trim().slice(0, CHECK_TEXT_MAX) : '';
      if(!text || out.length >= CHECKLIST_MAX) return;
      let id = typeof c.id === 'string' && c.id && c.id.length <= 40 && !seen[c.id] ? c.id : 'c' + Date.now().toString(36) + i.toString(36);
      while(seen[id]) id += 'x';
      seen[id] = true;
      out.push({id:id, text:text, done:c.done === true});
    });
    return out;
  }

  /* Portada de una tarea del archivo, con la forma que admiten las reglas: {color}, {asset} o null. */
  function coverOf(t){
    const c = t && t.cover;
    if(!c || typeof c !== 'object') return null;
    if(typeof c.asset === 'string' && c.asset && c.asset.length <= 200) return {asset:c.asset};
    if(typeof c.color === 'string' && c.color && c.color.length <= 20) return {color:c.color};
    return null;
  }

  /* Campos personalizados del proyecto abierto. */
  function projectFields(){
    return Workhub.views && Workhub.views.fields ? Workhub.views.fields.list() : [];
  }

  class BackupModel {
    constructor(models){
      this.models = models;
      /* Cómo copiar un adjunto: {read(att) → Promise<Blob>, image(blob) → Promise<id>, file(blob) →
         Promise<[ids]>}. Lo pone AppController; sin ello los adjuntos del archivo no se importan. */
      this.files = null;
    }

    /* Los adjuntos de una nota del archivo (`attachments`), copiados a archivos nuevos: la copia no
       comparte nada con la nota original, así que borrar una no deja a la otra sin sus archivos.
       Los que ya no están (se borraron, o el archivo viene de otra cuenta) o no se pueden subir
       se quedan fuera y se cuentan en counts.filesSkipped. → [{name, type, size, image, parts}]
       moved (opcional): ahí se apunta el id nuevo de cada imagen copiada, por su id del archivo. */
    copyAttachments(note, counts, moved){
      const list = (Array.isArray(note && note.attachments) ? note.attachments : [])
        .filter((a) => a && Array.isArray(a.parts) && a.parts.length && a.parts.every((id) => typeof id === 'string' && id)).slice(0, NOTE_FILES_MAX);
      const copied = [];
      return list.reduce((chain, a) => chain.then(() => {
        if(!this.files){ counts.filesSkipped++; return null; }
        const att = {name:String(a.name || '').slice(0, 200), type:String(a.type || '').slice(0, 120), size:+a.size || 0, image:!!a.image};
        return Promise.resolve().then(() => this.files.read({parts:a.parts, type:att.type || (att.image ? 'image/jpeg' : '')}))
          .then((blob) => (att.image ? Promise.resolve(this.files.image(blob)).then((id) => (id ? [id] : [])) : this.files.file(blob)))
          .then((parts) => {
            if(!Array.isArray(parts) || !parts.length){ counts.filesSkipped++; return; }
            counts.files++;
            if(moved && att.image) moved[a.parts[0]] = parts[0];
            copied.push(Object.assign(att, {parts:parts}));
          }, () => { counts.filesSkipped++; });
      }), Promise.resolve()).then(() => copied);
    }

    isReady(){
      const m = this.models;
      return m.tasks.isReady() && m.contacts.isReady() && m.vault.isReady() && m.clients.isReady() && m.meetings.isReady();
    }

    /* En un proyecto de equipo el cofre es compartido y cada persona tiene su propia clave
       (team-vault.js): la copia lleva la mía, pero un archivo no se importa sobre el cofre del equipo. */
    inTeam(){
      const team = Workhub.views && Workhub.views.team;
      return !!team && team.enabled();
    }

    /* Devuelve {filename, json, counts}. projectName: proyecto abierto (se
       guarda en el archivo y en su nombre). */
    build(projectName){
      const m = this.models;
      return m.tasks.withNotes().then((tasksWithNotes) => {
        return m.vault.getMeta().then((metaSnap) => {
          const data = {
            exportedAt: new Date().toISOString(),
            formatVersion: FORMAT_VERSION,
            project: projectName || '',
            /* Definiciones de los campos personalizados (los valores van en cada tarea, en custom). */
            customFields: projectFields(),
            clients: m.clients.items,
            tasks: tasksWithNotes,
            meetings: m.meetings.items,
            contacts: m.contacts.items,
            vault: {
              meta: metaSnap.exists ? metaSnap.data() : null,
              entries: m.vault.items
            }
          };
          return {
            filename: 'workhub-backup-' + (slug(projectName) ? slug(projectName) + '-' : '') + new Date().toISOString().slice(0, 10) + '.json',
            json: JSON.stringify(data, null, 2),
            counts: {
              tasks: tasksWithNotes.length,
              meetings: m.meetings.items.length,
              contacts: m.contacts.items.length,
              vault: m.vault.items.length,
              clients: m.clients.items.length
            }
          };
        });
      });
    }

    /* Devuelve {counts, vaultOutcome: 'none' | 'skipped' | 'team' | 'imported'}. */
    import(data){
      const m = this.models;
      const counts = {clients:0, tasks:0, notes:0, meetings:0, contacts:0, vault:0, files:0, filesSkipped:0};
      const list = (x) => (Array.isArray(x) ? x : []);
      const existingClientNames = {};
      m.clients.items.forEach((c) => { existingClientNames[c.nombre] = true; });
      let vaultOutcome = 'none';

      const clientPromises = list(data.clients).map((c) => {
        if(!c || !c.nombre || existingClientNames[c.nombre]) return Promise.resolve();
        existingClientNames[c.nombre] = true;
        counts.clients++;
        const client = {nombre:c.nombre, createdAt:c.createdAt || Date.now()};
        if(typeof c.color === 'number' && isFinite(c.color)) client.color = c.color;
        return m.clients.add(client);
      });

      /* Campos personalizados: las definiciones que este proyecto no tiene se añaden; los valores de
         cada tarea se quedan con los de los campos que existan al terminar. */
      const CF = Workhub.models.CustomFields;
      const had = projectFields();
      const fields = CF.merge(had, data.customFields);
      const fieldsSaved = fields.length > had.length && this.onCustomFields ? Promise.resolve(this.onCustomFields(fields)).catch(() => false) : Promise.resolve(true);

      const taskPromises = list(data.tasks).map((t) => {
        if(!t || !t.title) return Promise.resolve();
        const extra = {};
        if(CF.validDate(t.startDate) && (!t.dueDate || t.startDate <= t.dueDate)) extra.startDate = t.startDate;
        const custom = CF.values(fields, t.custom);
        if(Object.keys(custom).length) extra.custom = custom;
        /* Una tarea archivada sigue archivada al importarla. */
        if(+t.archivedAt > 0) extra.archivedAt = +t.archivedAt;
        /* Portada: el color va con la tarea; la imagen es de una nota y se enlaza cuando esa nota
           ya está copiada (más abajo), con el id que tenga aquí. */
        const cover = coverOf(t);
        if(cover && cover.color) extra.cover = cover;
        const moved = {};
        /* linkedContacts/linkedVault no se importan: guardan ids de documentos
           que cambian al importar (add() crea ids nuevos), así que quedarían rotos. */
        counts.tasks++;
        return m.tasks.add(Object.assign(t.dueDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.dueTime || '') ? {dueTime:t.dueTime} : {}, extra, {
          title: t.title || '',
          desc: t.desc || '',
          cliente: t.cliente || '',
          status: t.status || '',
          contacto: t.contacto || '',
          dueDate: t.dueDate || '',
          labels: Array.isArray(t.labels) ? t.labels.filter((n) => typeof n === 'string').slice(0, 1000) : [],
          checklist: checklistOf(t.checklist),
          order: typeof t.order === 'number' ? t.order : (t.createdAt || Date.now()),
          createdAt: t.createdAt || Date.now(),
          updatedAt: Date.now()
        })).then((ref) => {
          return Promise.all(list(t.notes).map((n) => {
            if(!n) return Promise.resolve();
            counts.notes++;
            if(n.imageAssetId) moved[n.imageAssetId] = n.imageAssetId;
            return this.copyAttachments(n, counts, moved).then((files) => {
              const note = {
                text: n.text || '',
                imageAssetId: n.imageAssetId || '',
                createdAt: n.createdAt || Date.now(),
                kind: ['comment','activity'].includes(n.kind) ? n.kind : 'note',
                actorUid: typeof n.actorUid === 'string' ? n.actorUid : '',
                actorName: typeof n.actorName === 'string' ? n.actorName : ''
              };
              if(files.length){
                note.attachments = files;
                note.assetIds = files.reduce((ids, a) => ids.concat(a.parts), []);
              }
              return m.tasks.addNoteRaw(ref.id, note);
            });
          })).then(() => {
            const asset = cover && cover.asset ? moved[cover.asset] : '';
            return asset ? m.tasks.update(ref.id, {cover:{asset:asset}}).catch(() => null) : null;
          });
        });
      });

      const contactPromises = list(data.contacts).map((c) => {
        if(!c || !c.cliente) return Promise.resolve();
        counts.contacts++;
        return m.contacts.add({
          cliente: c.cliente || '',
          nombre: c.nombre || '',
          email: c.email || '',
          telefono: c.telefono || '',
          notas: c.notas || '',
          createdAt: c.createdAt || Date.now(),
          updatedAt: Date.now()
        });
      });

      const meetingPromises = list(data.meetings).map((mt) => {
        if(!mt || !mt.title || !mt.date) return Promise.resolve();
        counts.meetings++;
        return m.meetings.add({
          title: String(mt.title),
          cliente: mt.cliente || '',
          date: String(mt.date),
          start: mt.start || '',
          end: mt.end || '',
          link: safeUrl(mt.link),
          notas: mt.notas || '',
          createdAt: mt.createdAt || Date.now(),
          updatedAt: Date.now()
        });
      });

      return Promise.all(clientPromises.concat(taskPromises, contactPromises, meetingPromises, [fieldsSaved])).then(() => {
        return this.inTeam() ? null : m.vault.getMeta();
      }).then((metaSnap) => {
        const vaultData = data.vault || {};
        const entries = list(vaultData.entries);
        if(!entries.length){ vaultOutcome = 'none'; return; }
        if(this.inTeam()){ vaultOutcome = 'team'; return; }
        /* Las contraseñas solo se pueden leer con la contraseña maestra con la
           que se cifraron: si este tablero ya tiene la suya, se omiten. */
        if(metaSnap.exists || !vaultData.meta){ vaultOutcome = 'skipped'; return; }
        vaultOutcome = 'imported';
        return m.vault.setMeta(vaultData.meta).then(() => {
          /* Si ya se miró el estado del gestor (sin contraseña maestra), hay que
             volver a comprobarlo: ahora tiene la del archivo importado. */
          m.vault.metaState = null;
          return Promise.all(entries.map((v) => {
            if(!v || !v.cliente || !v.iv || !v.cipher ||
                (!!v.ivV2 !== !!v.cipherV2)) return Promise.resolve();
            counts.vault++;
            const entry = {
              tipo: v.tipo || 'correo',
              cliente: v.cliente || '',
              label: v.label || '',
              correo: v.correo || '',
              web: v.web || '',
              ip: v.ip || '',
              usuario: v.usuario || '',
              puerto: v.puerto || '',
              dominio: v.dominio || '',
              iv: v.iv,
              cipher: v.cipher,
              createdAt: v.createdAt || Date.now(),
              updatedAt: Date.now()
            };
            if(v.ivV2 && v.cipherV2){ entry.ivV2 = v.ivV2; entry.cipherV2 = v.cipherV2; }
            /* Sin 'order' numérico, VaultModel.orderOf() cae en createdAt. */
            if(typeof v.order === 'number' && isFinite(v.order)) entry.order = v.order;
            return m.vault.add(entry);
          }));
        });
      }).then(() => ({counts:counts, vaultOutcome:vaultOutcome}));
    }

    static isEncryptedFile(data){
      return !!data && typeof data === 'object' && data.format === ENCRYPTED_FORMAT;
    }

    /* ¿Se puede abrir ese archivo con este cifrador, sin pedir nada? (la misma clave del proyecto) */
    static sameKey(file, cipher){
      return !!cipher && !!file && cipher.pid === file.pid && cipher.kid === file.kid;
    }

    /* Convierte una copia de build() en el archivo cifrado. o: {cipher, enc, wrap, uid, projectName};
       enc es el campo del proyecto y wrap su crypto/{uid} (envoltorios de la clave). */
    static seal(copy, o){
      const exportedAt = new Date().toISOString();
      return o.cipher.sealBlob(EXPORT_PATH, exportedAt, JSON.parse(copy.json)).then((data) => {
        const file = {
          format: ENCRYPTED_FORMAT, v: ENCRYPTED_VERSION,
          project: o.projectName || '', exportedAt: exportedAt,
          uid: o.uid, pid: o.enc.pid, kid: o.enc.kid, kcv: o.enc.kcv,
          kdf: o.wrap.kdf, pw: o.wrap.pw, rk: o.wrap.rk,
          data: data
        };
        return {
          filename: 'kanlane-copia-cifrada-' + (slug(o.projectName) ? slug(o.projectName) + '-' : '') + exportedAt.slice(0, 10) + '.json',
          json: JSON.stringify(file, null, 2),
          counts: copy.counts
        };
      });
    }

    /* Abre un archivo cifrado y devuelve el contenido de la copia. o: {cipher} si el proyecto abierto
       tiene la misma clave, o {secret}: contraseña de cifrado o clave de recuperación del proyecto del
       que salió. Errores (.code): 'bad-format', 'bad-secret'. */
    static open(file, o){
      const PC = Workhub.services.projectCrypto;
      const opts = o || {};
      return Promise.resolve().then(() => {
        if(!BackupModel.isEncryptedFile(file) || file.v !== ENCRYPTED_VERSION || typeof file.data !== 'string' ||
            typeof file.exportedAt !== 'string' || typeof file.uid !== 'string') throw fail('bad-format');
        if(BackupModel.sameKey(file, opts.cipher)) return opts.cipher.key;
        const ctx = {pid:file.pid, kid:file.kid, uid:file.uid};
        const secret = String(opts.secret == null ? '' : opts.secret);
        /* Lo escrito puede ser la clave de recuperación (32 símbolos) o la contraseña. */
        const recovery = PC.parseRecoveryKey(secret);
        const byRecovery = recovery ? PC.unwrapRecovery(file, recovery, ctx, false).catch(() => null) : Promise.resolve(null);
        return byRecovery.then((key) => key || PC.unwrapPassword(file, secret, ctx, false)).then((key) => {
          return PC.checkKcv(key, file.pid, file.kid, file.kcv).then((ok) => {
            if(!ok) throw fail('bad-secret');
            return key;
          });
        });
      }).then((key) => PC.open(key, {pid:file.pid, kid:file.kid, path:EXPORT_PATH, id:file.exportedAt, ev:PC.EV}, file.data)).then((data) => {
        if(!data || typeof data !== 'object' || Array.isArray(data)) throw fail('bad-format');
        return data;
      }, (err) => {
        if(err && err.name === 'BackupError') throw err;
        throw fail(PC.isError(err, 'bad-password') || PC.isError(err, 'bad-recovery') ? 'bad-secret' : 'bad-format');
      });
    }
  }

  Workhub.models.BackupModel = BackupModel;
})();
