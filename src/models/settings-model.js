/* Preferencias de apariencia: color de acento, tema claro/oscuro y dónde va la navegación.
   Se guardan en la cuenta del usuario (users/{uid}/settings/preferences, igual
   en todos sus proyectos y dispositivos) y, además, en este navegador, para
   pintarlas al instante al abrir la app (ver src/boot.js). Emite 'change'
   cuando llegan cambios hechos en otro dispositivo. */
(function(){
  const prefs = Workhub.services.preferences;

  /* Claves estables (se guardan en las preferencias); los nombres y colores
     pueden cambiar. solid/solidD e ink/inkD: botones principales en claro/oscuro;
     textL/textD: texto e iconos de acento; softL/softD: fondos de selección;
     hueA/hueB: los dos tonos del velo del fondo. Grafito es el acento por defecto. */
  const ACCENTS = [
    {key:'grafito',   name:'Grafito', solid:'#18181B', solidD:'#F4F4F5', textL:'#18181B', textD:'#F4F4F5', softL:'rgba(23,24,28,0.07)',   softD:'rgba(255,255,255,0.09)', hueA:'#71717A', hueB:'#71717A'},
    {key:'azul',      name:'Azul',    solid:'#2563EB', solidD:'#7AA9FF', textL:'#2563EB', textD:'#7AA9FF', softL:'rgba(37,99,235,0.1)',   softD:'rgba(122,169,255,0.14)', hueA:'#3B82F6', hueB:'#6366F1'},
    {key:'lavanda',   name:'Violeta', solid:'#4F46E5', solidD:'#9B9DFF', textL:'#4F46E5', textD:'#9B9DFF', softL:'rgba(79,70,229,0.1)',   softD:'rgba(155,157,255,0.14)', hueA:'#6366F1', hueB:'#D946EF'},
    {key:'rosa',      name:'Rosa',    solid:'#DB2777', solidD:'#FF86BD', textL:'#C81E6A', textD:'#FF86BD', softL:'rgba(219,39,119,0.1)',  softD:'rgba(255,134,189,0.14)', hueA:'#EC4899', hueB:'#F97316'},
    {key:'menta',     name:'Verde',   solid:'#0D8F6F', solidD:'#4FD6A8', textL:'#0B7A5F', textD:'#4FD6A8', softL:'rgba(13,143,111,0.1)',  softD:'rgba(79,214,168,0.14)',  hueA:'#14B8A6', hueB:'#22C55E'},
    {key:'melocoton', name:'Naranja', solid:'#E0492D', solidD:'#FF8A6B', textL:'#C23D22', textD:'#FF8A6B', softL:'rgba(224,73,45,0.1)',   softD:'rgba(255,138,107,0.14)', hueA:'#F97316', hueB:'#EC4899'},
    {key:'limon',     name:'Ámbar',   solid:'#B45309', solidD:'#FBBF24', textL:'#B45309', textD:'#FBBF24', softL:'rgba(180,83,9,0.1)',    softD:'rgba(251,191,36,0.14)',  hueA:'#F59E0B', hueB:'#F97316'}
  ];
  /* El texto sobre el acento es blanco en claro y casi negro en oscuro. */
  ACCENTS.forEach((x) => { x.ink = '#FFFFFF'; x.inkD = '#0A0A0C'; });
  const DEFAULT_ACCENT = 'grafito';

  const ACCENT_KEY = 'workhub_accent';
  const THEME_KEY = 'workhub_theme';
  const NAV_KEY = 'workhub_nav';
  /* Hasta el rediseño «cristal limpio» el acento por defecto era el azul y se subía a la cuenta
     la primera vez, así que no se distingue a quien lo eligió de quien nunca eligió. Por decisión
     del propietario, quien tenga azul pasa a Grafito una sola vez: en el navegador lo recuerda
     esta marca y en la cuenta el campo «av». Después, elegir azul se respeta. */
  const ACCENT_MARK_KEY = 'workhub_accent_v';
  const ACCENT_VERSION = 2;
  const DOC_PATH = 'settings/preferences';
  const THEMES = ['system', 'light', 'dark'];
  /* Navegación: en un lateral (por defecto) o en una barra arriba. */
  const NAVS = ['side', 'top'];

  class SettingsModel extends Workhub.Emitter {
    constructor(){
      super();
      this.ref = null;
      this.accent = this.findAccent(prefs.read(ACCENT_KEY, DEFAULT_ACCENT)).key;
      if(prefs.read(ACCENT_MARK_KEY, '') !== String(ACCENT_VERSION)){
        if(this.accent === 'azul'){
          this.accent = DEFAULT_ACCENT;
          prefs.write(ACCENT_KEY, this.accent);
        }
        prefs.write(ACCENT_MARK_KEY, String(ACCENT_VERSION));
      }
      /* 'system' | 'light' | 'dark' */
      this.theme = prefs.read(THEME_KEY, 'system');
      /* 'side' | 'top' */
      this.nav = NAVS.indexOf(prefs.read(NAV_KEY, 'side')) !== -1 ? prefs.read(NAV_KEY, 'side') : 'side';
    }

    findAccent(key){
      return ACCENTS.find((x) => x.key === key) || ACCENTS[0];
    }

    currentAccent(){
      return this.findAccent(this.accent);
    }

    /* db: base de datos del usuario sin acotar a un proyecto. */
    connect(db){
      if(typeof this.stop === 'function') this.stop();
      this.ref = db.doc(DOC_PATH);
      this.stop = this.ref.onSnapshot((snap) => {
        if(!snap.exists){
          /* Primera vez: se sube lo elegido en este navegador. */
          this.save();
          return;
        }
        this.applyRemote(snap.data() || {});
      }, () => {
        /* Sin permiso (reglas antiguas) o sin conexión: se sigue con lo local. */
      });
    }

    /* Deja de sincronizar con la cuenta (al eliminarla: si no, al ver que las preferencias ya no
       están, las volvería a subir). Lo elegido sigue valiendo en este navegador. */
    disconnect(){
      if(typeof this.stop === 'function') this.stop();
      this.stop = null;
      this.ref = null;
    }

    /* Idioma de la cuenta: en un dispositivo nuevo se adopta al entrar
       (recargando una sola vez); después, cada dispositivo lo cambia al guardar. */
    adoptLang(data){
      const i18n = Workhub.i18n;
      if(!data.lang){
        if(this.ref) this.ref.update({lang:i18n.lang}).catch(() => {});
        return;
      }
      if(data.lang === i18n.lang || !i18n.LANGS[data.lang]) return;
      let done = false;
      try{ done = sessionStorage.getItem('workhub_lang_adopted') === '1'; sessionStorage.setItem('workhub_lang_adopted', '1'); }catch(e){}
      if(!done) i18n.setLang(data.lang);
    }

    applyRemote(data){
      if(!this.langChecked){
        this.langChecked = true;
        this.adoptLang(data);
      }
      let accent = this.findAccent(data.accent).key;
      /* Cuenta anterior al rediseño con el azul de siempre: pasa a Grafito una vez. */
      if(data.av !== ACCENT_VERSION && accent === 'azul') accent = DEFAULT_ACCENT;
      const theme = THEMES.indexOf(data.theme) !== -1 ? data.theme : this.theme;
      const nav = NAVS.indexOf(data.nav) !== -1 ? data.nav : this.nav;
      const changed = accent !== this.accent || theme !== this.theme || nav !== this.nav;
      this.accent = accent;
      this.theme = theme;
      this.nav = nav;
      if(changed){
        prefs.write(ACCENT_KEY, accent);
        prefs.write(THEME_KEY, theme);
        prefs.write(NAV_KEY, nav);
      }
      if(data.av !== ACCENT_VERSION) this.save();
      if(changed) this.emit('change');
    }

    save(){
      if(!this.ref) return;
      this.ref.set(this.payload(Workhub.i18n.lang)).catch(() => {});
    }

    payload(lang){
      return {accent:this.accent, av:ACCENT_VERSION, theme:this.theme, nav:this.nav, lang:lang, updatedAt:Date.now()};
    }

    setAccent(key){
      this.accent = this.findAccent(key).key;
      prefs.write(ACCENT_KEY, this.accent);
      this.save();
    }

    /* Guarda el idioma en la cuenta (la app se recarga después). */
    setLang(lang){
      if(!this.ref) return Promise.resolve();
      return this.ref.set(this.payload(lang)).catch(() => {});
    }

    setTheme(theme){
      this.theme = THEMES.indexOf(theme) !== -1 ? theme : 'system';
      prefs.write(THEME_KEY, this.theme);
      this.save();
    }

    setNav(nav){
      this.nav = NAVS.indexOf(nav) !== -1 ? nav : 'side';
      prefs.write(NAV_KEY, this.nav);
      this.save();
    }
  }

  SettingsModel.ACCENTS = ACCENTS;
  Workhub.models.SettingsModel = SettingsModel;
})();
