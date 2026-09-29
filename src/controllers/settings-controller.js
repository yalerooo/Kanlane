/* Ajustes de apariencia. */
(function(){
  const platform = Workhub.services.platform;
  const SettingsModel = Workhub.models.SettingsModel;

  class SettingsController {
    constructor(app, view){
      this.app = app;
      this.model = app.models.settings;
      this.view = view;

      this.view.applyAccent(this.model.currentAccent());
      this.view.applyTheme(this.model.theme, false);

      this.view.bindAccent((key) => {
        this.model.setAccent(key);
        this.view.applyAccent(this.model.currentAccent());
        this.reapplyPlugins();
        this.render();
      });
      this.view.bindTheme((theme) => this.setTheme(theme));
      /* Cambiar de idioma recarga la app (se guarda antes en la cuenta). */
      this.view.bindLang((lang) => {
        if(lang === Workhub.i18n.lang) return;
        this.model.setLang(lang).then(() => Workhub.i18n.setLang(lang));
      });

      /* Cambios hechos en otro dispositivo con la misma cuenta. */
      this.model.on('change', () => {
        this.view.applyAccent(this.model.currentAccent());
        this.view.applyTheme(this.model.theme, true);
        this.render();
      });
    }

    /* Un plugin con permiso de apariencia manda sobre el color elegido aquí. */
    reapplyPlugins(){
      const plugins = this.app.controllers && this.app.controllers.plugins;
      if(plugins && plugins.appearance) plugins.applyAppearance();
    }

    /* theme: 'system' | 'light' | 'dark' */
    setTheme(theme){
      this.model.setTheme(theme);
      this.view.applyTheme(theme, true);
      this.reapplyPlugins();
      this.render();
    }

    render(){
      this.view.render(SettingsModel.ACCENTS, this.model.accent, this.model.theme, platform.mode());
    }
  }

  Workhub.controllers.SettingsController = SettingsController;
})();
