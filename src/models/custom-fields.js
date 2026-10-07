/* Campos personalizados de un proyecto.
   - La definición vive en el documento del proyecto: customFields = [{id, name, type, card, options}].
     El orden del array es el orden en que se ven. `card`: si el valor se enseña en la tarjeta.
     `options` (solo en las listas desplegables): [{id, label}].
   - El valor vive en cada tarea: custom = {idDelCampo: valor}. Un campo vacío no se guarda.
     Texto: cadena; número: número; fecha: 'AAAA-MM-DD'; casilla: true; lista: el id de la opción.
   Aquí no se pinta nada: solo se limpia, se valida y se da formato. */
(function(){
  const TYPES = [
    {key:'text', label:'Texto'},
    {key:'number', label:'Número'},
    {key:'date', label:'Fecha'},
    {key:'checkbox', label:'Casilla de verificación'},
    {key:'select', label:'Lista desplegable'}
  ];
  const TYPE_KEYS = TYPES.map((t) => t.key);
  /* Los de firestore.rules: 50 campos por proyecto y 50 valores por tarea. */
  const MAX_FIELDS = 50;
  const MAX_NAME = 60;
  const MAX_TEXT = 500;
  const MAX_OPTIONS = 50;
  const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

  const list = (x) => (Array.isArray(x) ? x : []);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function newId(prefix){
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* 'AAAA-MM-DD' de un día que existe (el 31 de febrero no). */
  function validDate(s){
    const m = YMD.exec(String(s || ''));
    if(!m) return false;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }

  /* Definiciones tal como se guardan: sin tipos desconocidos, nombres vacíos ni ids repetidos. */
  function normalize(fields){
    const seen = {};
    const out = [];
    list(fields).forEach((f) => {
      if(!f || typeof f !== 'object' || out.length >= MAX_FIELDS) return;
      const id = String(f.id || '').slice(0, 40);
      const name = String(f.name || '').trim().slice(0, MAX_NAME);
      if(!id || !name || seen[id] || TYPE_KEYS.indexOf(f.type) === -1) return;
      seen[id] = true;
      const field = {id:id, name:name, type:f.type, card:!!f.card};
      if(f.type === 'select'){
        const ids = {};
        field.options = [];
        list(f.options).forEach((o) => {
          const oid = String(o && o.id || '').slice(0, 40);
          const label = String(o && o.label || '').trim().slice(0, MAX_NAME);
          if(!oid || !label || ids[oid] || field.options.length >= MAX_OPTIONS) return;
          ids[oid] = true;
          field.options.push({id:oid, label:label});
        });
      }
      out.push(field);
    });
    return out;
  }

  /* Lo que escribió la persona → {value} (undefined si está vacío) o {error} con el motivo. */
  function clean(field, raw){
    if(raw === undefined || raw === null || raw === '' || raw === false) return {value:undefined};
    switch(field.type){
      case 'text': {
        const s = String(raw).trim();
        if(s.length > MAX_TEXT) return {error:'El texto no puede pasar de ' + MAX_TEXT + ' caracteres.'};
        return {value:s || undefined};
      }
      case 'number': {
        const s = typeof raw === 'number' ? raw : String(raw).trim().replace(',', '.');
        if(s === '') return {value:undefined};
        const n = typeof s === 'number' ? s : (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN);
        if(!isFinite(n) || Math.abs(n) > 1e15) return {error:'Escribe un número válido.'};
        return {value:n};
      }
      case 'date':
        return validDate(raw) ? {value:String(raw)} : {error:'Escribe una fecha válida.'};
      case 'checkbox':
        return {value:raw === true || raw === 'true' ? true : undefined};
      case 'select':
        /* Una opción que ya no existe cuenta como vacío. */
        return {value:list(field.options).some((o) => o.id === raw) ? raw : undefined};
    }
    return {value:undefined};
  }

  /* Los valores de una tarea que siguen valiendo con las definiciones de ahora (lo demás se ignora). */
  function values(fields, custom){
    const out = {};
    const src = custom && typeof custom === 'object' ? custom : {};
    list(fields).forEach((f) => {
      if(!own(src, f.id)) return;
      const r = clean(f, src[f.id]);
      if(r.value !== undefined) out[f.id] = r.value;
    });
    return out;
  }

  /* El valor como texto para enseñar ('' si no hay). */
  function format(field, value){
    const r = clean(field, value);
    if(r.value === undefined) return '';
    switch(field.type){
      case 'number': return r.value.toLocaleString(Workhub.i18n ? Workhub.i18n.locale : undefined, {maximumFractionDigits:6});
      case 'date': return Workhub.utils.dates.fmtDate(r.value) + ' ' + r.value.slice(0, 4);
      case 'checkbox': return Workhub.t('Sí');
      case 'select': return (list(field.options).find((o) => o.id === r.value) || {label:''}).label;
    }
    return r.value;
  }

  /* Las tareas que tienen valor en un campo (para avisar antes de borrarlo). */
  function usedBy(tasks, fieldId){
    return list(tasks).filter((t) => t && t.custom && typeof t.custom === 'object' && own(t.custom, fieldId));
  }

  /* Copia de `custom` sin un campo. */
  function without(custom, fieldId){
    const out = {};
    Object.keys(custom || {}).forEach((k) => { if(k !== fieldId) out[k] = custom[k]; });
    return out;
  }

  /* Al importar una copia: las definiciones que el proyecto no tiene todavía se añaden al final. */
  function merge(current, incoming){
    const base = normalize(current);
    const ids = {};
    base.forEach((f) => { ids[f.id] = true; });
    return base.concat(normalize(incoming).filter((f) => !ids[f.id])).slice(0, MAX_FIELDS);
  }

  Workhub.models.CustomFields = {
    TYPES, MAX_FIELDS, MAX_NAME, MAX_TEXT, MAX_OPTIONS,
    newId, validDate, normalize, clean, values, format, usedBy, without, merge,
    typeLabel(key){ return (TYPES.find((t) => t.key === key) || {label:''}).label; }
  };
})();
