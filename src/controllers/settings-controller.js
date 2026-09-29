/* Ajustes de apariencia. */
(function(){
  const platform = Workhub.services.platform;
  const SettingsModel = Workhub.models.SettingsModel;

  class SettingsController {
    constructor(app, view){
      this.model = app.models.settings;
      this.view = view;

      this.view.applyAccent(this.model.currentAccent());
      this.view.applyTheme(this.model.theme, false);

      this.view.bindAccent((key) => {
        this.model.setAccent(key);
        this.view.applyAccent(this.model.currentAccent());
        this.render();
      });
      this.view.bindTheme((theme) => this.setTheme(theme));

      /* Cambios hechos en otro dispositivo con la misma cuenta. */
      this.model.on('change', () => {
        this.view.applyAccent(this.model.currentAccent());
        this.view.applyTheme(this.model.theme, true);
        this.render();
      });
    }

    /* theme: 'system' | 'light' | 'dark' */
    setTheme(theme){
      this.model.setTheme(theme);
      this.view.applyTheme(theme, true);
      this.render();
    }

    render(){
      this.view.render(SettingsModel.ACCENTS, this.model.accent, this.model.theme, platform.mode());
    }
  }

  Workhub.controllers.SettingsController = SettingsController;
})();
