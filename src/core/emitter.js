/* Emisor de eventos mínimo del que heredan los modelos. */
Workhub.Emitter = class Emitter {
  constructor(){
    this._handlers = {};
  }

  on(event, fn){
    (this._handlers[event] = this._handlers[event] || []).push(fn);
    return () => { this._handlers[event] = (this._handlers[event] || []).filter((f) => f !== fn); };
  }

  emit(event, payload){
    (this._handlers[event] || []).slice().forEach((fn) => fn(payload));
  }
};
