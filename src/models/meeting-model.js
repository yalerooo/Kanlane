/* Reuniones del calendario. */
Workhub.models.MeetingModel = class MeetingModel extends Workhub.models.CollectionModel {
  constructor(){
    super('meetings');
  }

  static timeText(m, sep){
    if(!m.start) return 'Sin hora';
    return m.end ? m.start + (sep || '–') + m.end : m.start;
  }

  static byStart(a, b){
    return (a.start || '99:99').localeCompare(b.start || '99:99');
  }

  /* Valida y normaliza los datos del formulario. Devuelve {error} o {body}. */
  static validate(input){
    const {safeUrl} = Workhub.utils.urls;
    if(input.cliente === '__new__') return {error:'Crea el cliente nuevo o elige uno de la lista.'};
    if(!input.title || !input.date) return {error:''};
    if(input.start && input.end && input.end <= input.start) return {error:'La hora de fin tiene que ser posterior a la de inicio.'};
    if(input.end && !input.start) return {error:'Pon también la hora de inicio.'};
    const link = input.rawLink ? safeUrl(input.rawLink) : '';
    if(input.rawLink && !link) return {error:'El enlace no es válido. Pega la dirección completa de la reunión.'};
    return {body:{
      title: input.title,
      cliente: input.cliente || '',
      date: input.date,
      start: input.start,
      end: input.end,
      link: link,
      notas: input.notas
    }};
  }

  save(id, body){
    const existing = id ? this.find(id) : null;
    body.createdAt = existing ? (existing.createdAt || Date.now()) : Date.now();
    body.updatedAt = Date.now();
    return id ? this.set(id, body) : this.add(body);
  }

  reschedule(id, date){
    const m = this.find(id);
    if(!m || m.date === date || !this.isReady()) return;
    this.patchLocal(id, {date:date});
    this.update(id, {date:date, updatedAt:Date.now()}).catch(() => {});
  }
};
