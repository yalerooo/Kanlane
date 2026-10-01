/* La migración de los datos globales antiguos debe ser segura al repetirla. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class CollectionModel {}
const context = {Workhub:{models:{CollectionModel}}, Date, Promise, Object};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/models/plugin-model.js'), 'utf8'), context);
const PluginModel = context.Workhub.models.PluginModel;

const docs = new Map();
const db = {
  doc(key){
    return {
      get: async () => ({exists:docs.has(key), data:() => docs.get(key)}),
      set: async (value) => { docs.set(key, value); },
      delete: async () => { docs.delete(key); }
    };
  }
};

(async () => {
  docs.set('projects/main', {nombre:'Principal'});
  docs.set('plugins/workhub.smartgp', {userValues:{projects:'[{"id":"a"}]', 'log-2026-10':'[{"hours":2}]'}});
  docs.set('plugins/workhub.apariencia', {userValues:{look:'{"accent":"#123456"}'}});

  await PluginModel.migrateLegacyMain(db);
  assert.equal(docs.get('plugin_data/workhub.smartgp').values.projects, '[{"id":"a"}]');
  assert.equal(docs.get('plugin_data/workhub.smartgp').values['log-2026-10'], '[{"hours":2}]');
  assert.equal(docs.get('plugin_data/workhub.apariencia').values.look, '{"accent":"#123456"}');

  docs.delete('plugin_data/workhub.smartgp');
  await PluginModel.migrateLegacyMain(db);
  assert.equal(docs.has('plugin_data/workhub.smartgp'), false, 'no debe restaurar datos borrados al desinstalar');
  assert.equal(docs.get('plugins/workhub.smartgp').userValues.projects, '[{"id":"a"}]', 'conserva el origen');
  console.log('Migración de plugins: correcta');
})().catch((error) => { console.error(error); process.exitCode = 1; });
