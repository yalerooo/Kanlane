/* Preferencias de apariencia: color de acento y tema claro/oscuro.
   Se guardan en la cuenta del usuario (users/{uid}/settings/preferences, igual
   en todos sus proyectos y dispositivos) y, además, en este navegador, para
   pintarlas al instante al abrir la app (ver src/boot.js). Emite 'change'
   cuando llegan cambios hechos en otro dispositivo. */
(function(){
  const prefs = Workhub.services.preferences;

  /* Claves estables (se guardan en las preferencias); los nombres y colores
     pueden cambiar. solid/ink: botones principales; textL/textD: texto e iconos
     de acento en claro/oscuro; softL/softD: fondos de selección. */
  const ACCENTS = [
    {key:'azul',      name:'Azul',    solid:'#2F6BFF', ink:'#FFFFFF', textL:'#2457E0', textD:'#8FB0FF', softL:'#EEF3FF', softD:'#18223A', solidD:'#4D82FF'},
    {key:'lavanda',   name:'Violeta', solid:'#7C5CFF', ink:'#FFFFFF', textL:'#6443E8', textD:'#B6A5FF', softL:'#F3F0FF', softD:'#211B3A', solidD:'#8E73FF'},
    {key:'rosa',      name:'Rosa',    solid:'#E0457B', ink:'#FFFFFF', textL:'#C62F66', textD:'#F59BBB', softL:'#FDEFF4', softD:'#35182A', solidD:'#EC5A8D'},
    {key:'menta',     name:'Verde',   solid:'#16A36A', ink:'#FFFFFF', textL:'#0F8456', textD:'#6BDDA8', softL:'#E8F7F0', softD:'#122B21', solidD:'#1DB477'},
    {key:'melocoton', name:'Naranja', solid:'#EA6A1F', ink:'#FFFFFF', textL:'#C4520F', textD:'#F7A673', softL:'#FDF1E9', softD:'#33200F', solidD:'#F27B32'},
    {key:'limon',     name:'Ámbar',   solid:'#E6A310', ink:'#1F1600', textL:'#9A6A00', textD:'#F2C75A', softL:'#FDF6E3', softD:'#2F2610', solidD:'#EBB42F'},
    {key:'grafito',   name:'Grafito', solid:'#18181B', ink:'#FFFFFF', textL:'#18181B', textD:'#EDEDEF', softL:'#F1F1F3', softD:'#232328', solidD:'#EDEDEF', inkD:'#111113'}
  ];

  const ACCENT_KEY = 'workhub_accent';
  const THEME_KEY = 'workhub_theme';
  const DOC_PATH = 'settings/preferences';
  const THEMES = ['system', 'light', 'dark'];

  class SettingsModel extends Workhub.Emitter {
    constructor(){
      super();
      this.ref = null;
      this.accent = this.findAccent(prefs.read(ACCENT_KEY, 'azul')).key;
      /* 'system' | 'light' | 'dark' */
      this.theme = prefs.read(THEME_KEY, 'system');
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
      const accent = this.findAccent(data.accent).key;
      const theme = THEMES.indexOf(data.theme) !== -1 ? data.theme : this.theme;
      if(accent === this.accent && theme === this.theme) return;
      this.accent = accent;
      this.theme = theme;
      prefs.write(ACCENT_KEY, accent);
      prefs.write(THEME_KEY, theme);
      this.emit('change');
    }

    save(){
      if(!this.ref) return;
      this.ref.set({accent:this.accent, theme:this.theme, lang:Workhub.i18n.lang, updatedAt:Date.now()}).catch(() => {});
    }

    setAccent(key){
      this.accent = this.findAccent(key).key;
      prefs.write(ACCENT_KEY, this.accent);
      this.save();
    }

    /* Guarda el idioma en la cuenta (la app se recarga después). */
    setLang(lang){
      if(!this.ref) return Promise.resolve();
      return this.ref.set({accent:this.accent, theme:this.theme, lang:lang, updatedAt:Date.now()}).catch(() => {});
    }

    setTheme(theme){
      this.theme = THEMES.indexOf(theme) !== -1 ? theme : 'system';
      prefs.write(THEME_KEY, this.theme);
      this.save();
    }
  }

  SettingsModel.ACCENTS = ACCENTS;
  Workhub.models.SettingsModel = SettingsModel;
})();
