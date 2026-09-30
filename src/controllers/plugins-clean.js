/* Validación de lo que un plugin envía al anfitrión y copias limpias de los datos
   que recibe (ver plugins-controller.js y docs/PLUGINS.md). Nada de HTML, tipos y
   tamaños cerrados. */
(function(){
  const TaskModel = Workhub.models.TaskModel;

  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const HM = /^\d{2}:\d{2}$/;
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const FORM_TYPES = ['number', 'text', 'select', 'dates'];
  const FORM_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

  function fail(code, message){
    const e = new Error(message);
    e.code = code;
    return e;
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.indexOf(x) !== -1);

  /* Copias limpias de los datos: nada de ids de vínculos a contraseñas. */
  const cleanTask = (t) => ({id:t.id, title:t.title || '', desc:t.desc || '', cliente:t.cliente || '', status:TaskModel.stageKey(t),
    dueDate:t.dueDate || '', contacto:t.contacto || '', createdAt:t.createdAt || 0, updatedAt:t.updatedAt || 0});
  const cleanClient = (c) => ({id:c.id, nombre:c.nombre || '', color:typeof c.color === 'number' ? c.color : null});
  const cleanContact = (c) => ({id:c.id, cliente:c.cliente || '', nombre:c.nombre || '', email:c.email || '', telefono:c.telefono || '', notas:c.notas || ''});
  const cleanMeeting = (m) => ({id:m.id, title:m.title || '', cliente:m.cliente || '', date:m.date || '', start:m.start || '', end:m.end || '', link:m.link || '', notas:m.notas || ''});

  /* Valida la descripción de un formulario (wh.ui.form): nada de HTML, tipos y
     tamaños cerrados. Devuelve una copia limpia. */
  function cleanForm(p){
    const title = str(p.title, 80);
    if(!title) throw fail('bad-params', 'El formulario necesita un título.');
    const list = Array.isArray(p.fields) ? p.fields.slice(0, 8) : [];
    if(!list.length) throw fail('bad-params', 'El formulario necesita al menos un campo.');
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    const seen = {};
    const fields = list.map((f) => {
      f = f && typeof f === 'object' ? f : {};
      if(!FORM_KEY.test(f.key || '') || seen[f.key]) throw fail('bad-params', 'Cada campo necesita una clave única (letras, números y _).');
      if(FORM_TYPES.indexOf(f.type) === -1) throw fail('bad-params', 'Tipo de campo desconocido: ' + f.type);
      seen[f.key] = true;
      const o = {key:f.key, type:f.type, label:str(f.label, 60) || f.key, hint:str(f.hint, 140), required:f.required !== false};
      if(f.type === 'number'){
        o.min = num(f.min); o.max = num(f.max); o.step = num(f.step) > 0 ? num(f.step) : null;
        o.value = num(f.value); o.unit = str(f.unit, 8);
      } else if(f.type === 'text'){
        o.value = str(f.value, 200); o.placeholder = str(f.placeholder, 80); o.maxlength = Math.min(200, Math.max(1, num(f.maxlength) || 120));
      } else if(f.type === 'select'){
        o.options = (Array.isArray(f.options) ? f.options : []).slice(0, 100).map((x) => ({
          value: str(x && x.value, 64), label: str(x && x.label, 60)
        })).filter((x) => x.value && x.label);
        o.value = str(f.value, 64);
        o.allowNew = !!f.allowNew;
        /* Para volver a abrir el formulario con un «nuevo» ya escrito. */
        o.newName = str(f.newName, 60);
        o.newColorValue = HEX.test(f.newColorValue || '') ? f.newColorValue : '';
        o.newLabel = str(f.newLabel, 60) || Workhub.t('+ Añadir nuevo…');
        o.newPlaceholder = str(f.newPlaceholder, 60) || Workhub.t('Nombre');
        o.newColor = !!f.newColor;
        if(!o.options.length && !o.allowNew) throw fail('bad-params', 'Un desplegable necesita opciones o allowNew.');
      } else {
        o.max = Math.min(62, Math.max(1, num(f.max) || 62));
        o.value = (Array.isArray(f.value) ? f.value : []).filter((d) => typeof d === 'string' && YMD.test(d)).slice(0, o.max);
      }
      return o;
    });
    return {title:title, subtitle:str(p.subtitle, 140), intro:str(p.intro, 240), notice:str(p.notice, 400), submit:str(p.submit, 24), cancel:str(p.cancel, 24), fields:fields};
  }

  Workhub.pluginClean = {fail, str, sameSet, cleanTask, cleanClient, cleanContact, cleanMeeting, cleanForm, YMD, HM, HEX};
})();
