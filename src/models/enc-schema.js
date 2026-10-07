/* Esquema de los proyectos con cifrado total (docs/CIFRADO-PROYECTOS.md, 5.6 y 5.7).
   Tabla única de qué campos de cada colección se quedan en claro; todo lo demás va dentro del blob `e`.
   Tiene que coincidir con encFields() y encMax() de firestore.rules: lo comprueba
   tests/crypto/schema-rules.test.js. Si cambias una, cambia la otra y vuelve a publicar las reglas. */
(function(){
  'use strict';

  /* Campos del sellado, presentes en todo documento cifrado. */
  const SEAL = ['e', 'ev', 'kid'];

  /* En claro: lo que necesitan las reglas, una consulta del servidor o una actualización parcial
     frecuente (mover, reprogramar, reordenar), e identificadores opacos. */
  const CLEAR = {
    tasks: ['status', 'order', 'dueDate', 'repeat', 'repeatSpawned', 'createdAt', 'updatedAt',
            'assignees', 'linkedContacts', 'linkedVault'],
    notes: ['createdAt', 'kind', 'actorUid', 'imageAssetId', 'assetIds'],
    clients: ['color', 'createdAt'],
    contacts: ['createdAt', 'updatedAt'],
    meetings: ['date', 'createdAt', 'updatedAt'],
    vault: ['order', 'createdAt', 'updatedAt', 'iv', 'cipher', 'ivV2', 'cipherV2'],
    plugin_data: ['updatedAt'],
    assets: ['createdAt']
  };

  /* Tamaño máximo de `e` en caracteres. */
  const MAX_E = {
    tasks: 200000, notes: 100000, clients: 4000, contacts: 50000,
    meetings: 100000, vault: 20000, plugin_data: 900000, assets: 900000
  };

  /* El servidor ya no ve el contenido: los límites de validData() se aplican aquí antes de cifrar. */
  const TEXT_MAX = {
    tasks: {title: 500, desc: 20000, cliente: 200, dueTime: 5, startDate: 10, repeatAnchor: 13},
    notes: {text: 20000, actorName: 200},
    clients: {nombre: 200},
    contacts: {nombre: 200, email: 320, notas: 10000},
    meetings: {title: 500, notas: 20000, link: 2048},
    vault: {label: 500}
  };
  const LIST_MAX = {
    tasks: {labels: 1000, checklist: 200, assignees: 50},
    notes: {attachments: 20, assetIds: 400}
  };

  function has(col){
    return Object.prototype.hasOwnProperty.call(CLEAR, col);
  }

  /* 'tasks/{id}/notes' → 'notes'. */
  function collectionOf(path){
    const parts = String(path || '').split('/');
    return parts[parts.length - 1];
  }

  Workhub.models.EncSchema = Object.freeze({
    SEAL: Object.freeze(SEAL.slice()),
    COLLECTIONS: Object.freeze(Object.keys(CLEAR)),
    isSealable: has,
    collectionOf: collectionOf,
    clearFields(col){ return has(col) ? CLEAR[col].slice() : []; },
    /* Los campos que puede llevar un documento sellado (lo mismo que encFields() de las reglas). */
    sealedFields(col){ return has(col) ? CLEAR[col].concat(SEAL) : []; },
    isClear(col, field){ return has(col) && CLEAR[col].indexOf(field) !== -1; },
    maxE(col){ return has(col) ? MAX_E[col] : 0; },
    textLimits(col){ return Object.assign({}, TEXT_MAX[col]); },
    listLimits(col){ return Object.assign({}, LIST_MAX[col]); }
  });
})();
