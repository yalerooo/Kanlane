/* Exportación e importación de una copia de seguridad completa (.json).
   Importar siempre añade: nunca borra ni reemplaza datos existentes. */
(function(){
  const {safeUrl} = Workhub.utils.urls;
  const FORMAT_VERSION = 1;

  class BackupModel {
    constructor(models){
      this.models = models;
    }

    isReady(){
      const m = this.models;
      return m.tasks.isReady() && m.contacts.isReady() && m.vault.isReady() && m.clients.isReady() && m.meetings.isReady();
    }

    /* Devuelve {filename, json, counts}. */
    build(){
      const m = this.models;
      return m.tasks.withNotes().then((tasksWithNotes) => {
        return m.vault.getMeta().then((metaSnap) => {
          const data = {
            exportedAt: new Date().toISOString(),
            formatVersion: FORMAT_VERSION,
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
            filename: 'workhub-backup-' + new Date().toISOString().slice(0, 10) + '.json',
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

    /* Devuelve {counts, vaultOutcome: 'none' | 'skipped' | 'imported'}. */
    import(data){
      const m = this.models;
      const counts = {clients:0, tasks:0, notes:0, meetings:0, contacts:0, vault:0};
      const list = (x) => (Array.isArray(x) ? x : []);
      const existingClientNames = {};
      m.clients.items.forEach((c) => { existingClientNames[c.nombre] = true; });
      let vaultOutcome = 'none';

      const clientPromises = list(data.clients).map((c) => {
        if(!c || !c.nombre || existingClientNames[c.nombre]) return Promise.resolve();
        existingClientNames[c.nombre] = true;
        counts.clients++;
        return m.clients.add({nombre:c.nombre, createdAt:c.createdAt || Date.now()});
      });

      const taskPromises = list(data.tasks).map((t) => {
        if(!t || !t.title) return Promise.resolve();
        counts.tasks++;
        return m.tasks.add({
          title: t.title || '',
          desc: t.desc || '',
          cliente: t.cliente || '',
          status: t.status || 'pendiente',
          contacto: t.contacto || '',
          dueDate: t.dueDate || '',
          createdAt: t.createdAt || Date.now(),
          updatedAt: Date.now()
        }).then((ref) => {
          return Promise.all(list(t.notes).map((n) => {
            if(!n) return Promise.resolve();
            counts.notes++;
            return ref.collection('notes').add({
              text: n.text || '',
              imageAssetId: n.imageAssetId || '',
              createdAt: n.createdAt || Date.now()
            });
          }));
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

      return Promise.all(clientPromises.concat(taskPromises, contactPromises, meetingPromises)).then(() => {
        return m.vault.getMeta();
      }).then((metaSnap) => {
        const vaultData = data.vault || {};
        const entries = list(vaultData.entries);
        if(!entries.length){ vaultOutcome = 'none'; return; }
        /* Las contraseñas solo se pueden leer con la contraseña maestra con la
           que se cifraron: si este tablero ya tiene la suya, se omiten. */
        if(metaSnap.exists || !vaultData.meta){ vaultOutcome = 'skipped'; return; }
        vaultOutcome = 'imported';
        return m.vault.setMeta(vaultData.meta).then(() => {
          return Promise.all(entries.map((v) => {
            if(!v || !v.cliente || !v.iv || !v.cipher) return Promise.resolve();
            counts.vault++;
            return m.vault.add({
              tipo: v.tipo || 'correo',
              cliente: v.cliente || '',
              label: v.label || '',
              correo: v.correo || '',
              web: v.web || '',
              ip: v.ip || '',
              usuario: v.usuario || '',
              iv: v.iv,
              cipher: v.cipher,
              createdAt: v.createdAt || Date.now(),
              updatedAt: Date.now()
            });
          }));
        });
      }).then(() => ({counts:counts, vaultOutcome:vaultOutcome}));
    }
  }

  Workhub.models.BackupModel = BackupModel;
})();
