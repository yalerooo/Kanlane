/* Formato y manejo de fechas (siempre en formato local AAAA-MM-DD). */
(function(){
  function pad2(n){ return (n < 10 ? '0' : '') + n; }

  function ymd(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function todayYmd(){ return ymd(new Date()); }

  function parseYmd(s){
    const p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function capitalize(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function fmtDate(iso){
    if(!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if(isNaN(d)) return '';
    return d.toLocaleDateString(Workhub.i18n.locale, {day:'2-digit', month:'short'});
  }

  /* Intervalo entre dos fechas AAAA-MM-DD («05 oct – 12 oct»); un solo día si coinciden. */
  function fmtRange(start, end){
    return start === end ? fmtDate(start) : fmtDate(start) + ' – ' + fmtDate(end);
  }

  function fmtDateTime(ts){
    if(!ts) return '';
    const d = new Date(ts);
    if(isNaN(d)) return '';
    return d.toLocaleDateString(Workhub.i18n.locale, {day:'2-digit', month:'short'}) + ' ' +
      d.toLocaleTimeString(Workhub.i18n.locale, {hour:'2-digit', minute:'2-digit'});
  }

  function longDay(d, withYear){
    const opts = {weekday:'long', day:'numeric', month:'long'};
    if(withYear) opts.year = 'numeric';
    return capitalize(d.toLocaleDateString(Workhub.i18n.locale, opts));
  }

  /* Días desde hoy hasta la fecha AAAA-MM-DD (negativo si ya pasó). */
  function daysFromToday(s){
    const today = parseYmd(todayYmd());
    return Math.round((parseYmd(s) - today) / 86400000);
  }

  Workhub.utils.dates = {pad2, ymd, todayYmd, parseYmd, capitalize, fmtDate, fmtRange, fmtDateTime, longDay, daysFromToday};
})();
