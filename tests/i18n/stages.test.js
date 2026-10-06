/* Columnas por idioma: las etapas de las plantillas se enseñan en el idioma de la app mientras
   conserven su nombre, se guardan siempre en español y las que escribe el usuario no se tocan. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const EN = {'Por hacer':'To do', 'En curso':'In progress', 'En revisión':'In review', 'Hecho':'Done', 'Backlog':'Backlog'};

function boot(lang){
  const Workhub = {models:{}, t:(text) => (lang === 'en' && EN[text]) || text};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/models/project-templates.js'), 'utf8'), {Workhub, Date, Object, String, Math, Array});
  return Workhub.models.ProjectTemplates;
}

const es = boot('es');
const en = boot('en');
/* Los arrays salen de otro contexto (vm): se copian para compararlos. */
const kanban = Array.from(es.stagesOf('kanban'));

assert.deepEqual(kanban.map((s) => es.stageText(s)), ['Backlog', 'En curso', 'En revisión', 'Hecho'], 'en español, como están escritas');
assert.deepEqual(kanban.map((s) => en.stageText(s)), ['Backlog', 'In progress', 'In review', 'Done'], 'en inglés, traducidas');

/* Una columna renombrada es del usuario, aunque su nombre exista en el diccionario. */
assert.equal(en.stageText({key:'doing', label:'Hecho'}), 'Hecho');
assert.equal(en.stageText({key:'e1abc', label:'En curso'}), 'En curso');
assert.equal(en.stageText({key:'doing', label:'Sprint'}), 'Sprint');

/* Lo que se guarda desde la app en inglés sigue en español: el resto del equipo lo ve en su idioma. */
const saved = Array.from(en.normalizeStages([{key:'todo', label:'To do', color:'gray'}, {key:'doing', label:'Doing', color:'blue'}, {key:'done', label:'Done', color:'green', done:true}]));
assert.deepEqual(saved.map((s) => s.label), ['Por hacer', 'Doing', 'Hecho']);
assert.deepEqual(saved.map((s) => es.stageText(s)), ['Por hacer', 'Doing', 'Hecho']);
assert.deepEqual(Array.from(es.normalizeStages(kanban)).map((s) => s.label), kanban.map((s) => s.label), 'en español no cambia nada');

console.log('OK   columnas por idioma');
