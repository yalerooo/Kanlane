/* La migración de los datos globales antiguos debe ser segura al repetirla. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class CollectionModel {}
const context = {Workhub:{models:{CollectionModel}}, Date, Promise, Object, setTimeout};
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

  /* Al abrir el proyecto principal la migración se comprueba una vez por sesión y base de datos:
     volver a él desde otro proyecto no repite las lecturas. Otra base de datos (otra cuenta) sí
     se comprueba, y si la comprobación falla se reintenta la próxima vez. */
  const counted = (store, failing) => {
    const reads = [];
    return {
      reads,
      doc(key){
        return {
          get: async () => { reads.push(key); if(failing && failing.on) throw new Error('offline'); return {exists:store.has(key), data:() => store.get(key)}; },
          set: async (value) => { store.set(key, value); }
        };
      },
      collection(){
        const source = {onSnapshot:() => () => {}, where:() => source};
        return source;
      }
    };
  };
  CollectionModel.prototype.disconnect = function(){};
  CollectionModel.prototype.emit = function(){};
  CollectionModel.prototype.generation = 0;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  const model = new PluginModel();
  const first = counted(new Map([['projects/main', {nombre:'Principal'}]]));
  model.connect(first, true);
  await settle();
  const once = first.reads.length;
  assert.ok(once >= 3, 'la primera vez se leen el proyecto y las marcas');
  assert.equal(model.isReady(), true);
  model.connect(first, false);
  model.connect(first, true);
  await settle();
  assert.equal(first.reads.length, once, 'al volver al proyecto principal no se repiten las lecturas');
  assert.equal(model.isReady(), true, 'y la lista de plugins se conecta igual');
  const other = counted(new Map());
  model.connect(other, true);
  await settle();
  assert.ok(other.reads.length >= 3, 'otra base de datos se comprueba aparte');
  const failing = {on:true};
  const flaky = counted(new Map(), failing);
  model.connect(flaky, true);
  await settle();
  const failed = flaky.reads.length;
  failing.on = false;
  model.connect(flaky, true);
  await settle();
  assert.ok(flaky.reads.length > failed, 'si falló, se vuelve a comprobar');
  console.log('Migración de plugins: correcta');
})().catch((error) => { console.error(error); process.exitCode = 1; });
