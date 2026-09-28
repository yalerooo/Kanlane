/* Desplegables de cliente: filtros ("Todos los clientes") y selectores de
   formulario con la opción "+ Añadir cliente nuevo…" que muestra un campo en línea. */
(function(){
  const {esc} = Workhub.utils.html;
  const NEW_VALUE = '__new__';

  function option(name){
    return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
  }

  function populateFilter(selectEl, names){
    const current = selectEl.value;
    selectEl.innerHTML = '<option value="">Todos los clientes</option>' + names.map(option).join('');
    selectEl.value = names.indexOf(current) !== -1 ? current : '';
  }

  /* Si se acaba de crear un cliente desde este selector (data-pending-select),
     se selecciona en cuanto aparece en la lista. */
  function populateForm(selectEl, names, desiredValue){
    const pending = selectEl.getAttribute('data-pending-select');
    const val = pending !== null ? pending : (desiredValue !== undefined ? desiredValue : selectEl.value);
    const allowEmpty = selectEl.getAttribute('data-allow-empty') === '1';
    const opts = names.map(option);
    if(val && names.indexOf(val) === -1) opts.unshift(option(val));
    if(allowEmpty) opts.unshift('<option value="">Sin cliente</option>');
    opts.push('<option value="' + NEW_VALUE + '">+ Añadir cliente nuevo…</option>');
    selectEl.innerHTML = opts.join('');
    selectEl.value = val || '';
    if(selectEl.selectedIndex === -1 && names.length && !allowEmpty){
      selectEl.value = names[0];
    }
    if(pending !== null) selectEl.removeAttribute('data-pending-select');
  }

  /* Conecta un selector de formulario con su bloque "cliente nuevo".
     prefix: prefijo de los ids (p. ej. 'f' → fCliente, fClienteNewWrap…).
     onCreate(name) debe devolver una promesa. */
  class ClientSelect {
    constructor(prefix){
      this.select = document.getElementById(prefix + 'Cliente');
      this.newWrap = document.getElementById(prefix + 'ClienteNewWrap');
      this.newInput = document.getElementById(prefix + 'ClienteNewInput');
      this.newBtn = document.getElementById(prefix + 'ClienteNewBtn');

      this.select.addEventListener('change', () => {
        if(this.select.value === NEW_VALUE){
          this.newWrap.hidden = false;
          this.newInput.value = '';
          this.newInput.focus();
        } else {
          this.newWrap.hidden = true;
        }
      });
    }

    bindCreate(onCreate){
      this.newBtn.addEventListener('click', () => {
        const name = this.newInput.value.trim();
        if(!name) return;
        this.newBtn.disabled = true;
        this.select.setAttribute('data-pending-select', name);
        Promise.resolve(onCreate(name)).then((created) => {
          if(created === false){
            this.select.removeAttribute('data-pending-select');
            return;
          }
          this.newWrap.hidden = true;
          this.newInput.value = '';
        }).catch(() => {
          this.select.removeAttribute('data-pending-select');
        }).finally(() => { this.newBtn.disabled = false; });
      });
    }

    populate(names, desiredValue){
      populateForm(this.select, names, desiredValue);
    }

    reset(names, desiredValue){
      this.newWrap.hidden = true;
      this.populate(names, desiredValue);
    }

    /* Valor elegido, o null si no hay uno válido (vacío o "nuevo…"). */
    value(){
      const v = this.select.value;
      return !v || v === NEW_VALUE ? null : v;
    }

    rawValue(){
      return this.select.value;
    }
  }

  ClientSelect.NEW_VALUE = NEW_VALUE;
  ClientSelect.populateFilter = populateFilter;
  Workhub.views.ClientSelect = ClientSelect;
})();
