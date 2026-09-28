/* Preferencias de apariencia: color de acento y tema claro/oscuro. */
(function(){
  const prefs = Workhub.services.preferences;

  const ACCENTS = [
    {key:'azul',      name:'Azul',      solid:'#B7D3F6', ink:'#0F2C4D', textL:'#2F66AD', textD:'#A9CBF4', softL:'#EAF2FC', softD:'#1B2636'},
    {key:'lavanda',   name:'Lavanda',   solid:'#CDC3F5', ink:'#241A52', textL:'#5B47C2', textD:'#C3B7F4', softL:'#F0EDFC', softD:'#231F38'},
    {key:'rosa',      name:'Rosa',      solid:'#F6BFD0', ink:'#4B1528', textL:'#B7386A', textD:'#F4B3C7', softL:'#FCEBF1', softD:'#35202A'},
    {key:'menta',     name:'Menta',     solid:'#B5E4CF', ink:'#0F3A29', textL:'#237A55', textD:'#A6DCC3', softL:'#E7F6EF', softD:'#1A2D25'},
    {key:'melocoton', name:'Melocotón', solid:'#F9CDB0', ink:'#4A230F', textL:'#B35523', textD:'#F5C3A2', softL:'#FDEFE6', softD:'#35251C'},
    {key:'limon',     name:'Limón',     solid:'#F1E4A2', ink:'#3A3208', textL:'#8C7212', textD:'#EADB95', softL:'#FBF6DE', softD:'#2F2B18'},
    {key:'grafito',   name:'Grafito',   solid:'#2B3038', ink:'#FFFFFF', textL:'#2B3038', textD:'#D5D9DF', softL:'#EEF0F3', softD:'#262A31', solidD:'#E4E7EB', inkD:'#15181D'}
  ];

  const ACCENT_KEY = 'workhub_accent';
  const THEME_KEY = 'workhub_theme';

  class SettingsModel {
    constructor(){
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

    setAccent(key){
      this.accent = this.findAccent(key).key;
      prefs.write(ACCENT_KEY, this.accent);
    }

    setTheme(theme){
      this.theme = theme;
      prefs.write(THEME_KEY, theme);
    }
  }

  SettingsModel.ACCENTS = ACCENTS;
  Workhub.models.SettingsModel = SettingsModel;
})();
