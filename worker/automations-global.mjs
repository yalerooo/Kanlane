/* El motor de las automatizaciones (src/models/automation-model.js) es el mismo archivo que usa
   la app: se cuelga de un objeto global `Workhub`. Aquí se crea antes de cargarlo. */
globalThis.Workhub = globalThis.Workhub || {models: {}};
