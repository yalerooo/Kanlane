/* Ejemplos de producto. Estado efímero: sin cuentas, red ni almacenamiento. */
(function(){
  'use strict';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function byId(id){ return document.getElementById(id); }
  function feedback(element){
    if(!reducedMotion.matches && element.animate){
      element.animate([{opacity:.65, transform:'translateY(5px)'}, {opacity:1, transform:'translateY(0)'}], {duration:280, easing:'ease-out'});
    }
  }
  function select(buttons, selected){
    buttons.forEach(function(button){
      button.classList.toggle('is-active', button === selected);
      button.setAttribute('aria-pressed', String(button === selected));
    });
  }

  var dayTasks = document.querySelectorAll('[data-day-task]');
  function updateDay(){
    var done = Array.from(dayTasks).filter(function(task){ return task.checked; }).length;
    byId('dayPending').textContent = String(dayTasks.length - done);
    byId('dayCount').textContent = done + ' / ' + dayTasks.length;
    byId('dayProgress').style.width = done / dayTasks.length * 100 + '%';
    byId('dayFeedback').textContent = ['Prueba a completar una tarea.', 'Un pendiente menos. Sigue a tu ritmo.', 'Ya queda menos para cerrar el día.', 'Todo listo. Ahora sí, respira.'][done];
  }
  if(dayTasks.length){ dayTasks.forEach(function(task){ task.addEventListener('change', updateDay); }); updateDay(); }

  var clients = {
    north:{initial:'N', name:'Estudio Norte', task:'Maquetar la nueva portada', status:'En proceso', person:'Marta Ruiz', role:'Responsable de comunicación', meeting:'Revisión del diseño', date:'Miércoles · 16:30', access:'Panel de la web'},
    coast:{initial:'C', name:'Taller Costa', task:'Preparar el presupuesto', status:'Pendiente', person:'Lucas Costa', role:'Responsable de la tienda', meeting:'Plan de mantenimiento', date:'Jueves · 10:00', access:'Correo de administración'},
    house:{initial:'A', name:'Casa Aldea', task:'Revisar los textos de la web', status:'En revisión', person:'Irene Vega', role:'Coordinadora de contenidos', meeting:'Entrega de fotografías', date:'Viernes · 12:00', access:'Gestor de contenidos'}
  };
  var clientButtons = document.querySelectorAll('[data-client]');
  clientButtons.forEach(function(button){
    button.addEventListener('click', function(){
      var key = button.dataset.client, client = clients[key];
      select(clientButtons, button);
      byId('clientInitial').className = 'client-monogram ' + key;
      byId('clientInitial').textContent = client.initial;
      var fields = {clientName:'name', clientTask:'task', clientStatus:'status', clientPerson:'person', clientPersonRole:'role', clientMeeting:'meeting', clientDate:'date', clientAccess:'access'};
      Object.keys(fields).forEach(function(id){ byId(id).textContent = client[fields[id]]; });
      feedback(document.querySelector('.client-detail'));
    });
  });

  var roles = {
    owner:{title:'El proyecto, en tus manos.', text:'Gestiona el trabajo, invita a otras personas y decide quién puede editar o consultar.', rights:[true,true,true]},
    editor:{title:'Todo listo para colaborar.', text:'Crea tareas, actualiza el trabajo y participa en los comentarios. Los miembros y sus permisos los gestiona el propietario.', rights:[true,true,false]},
    viewer:{title:'Al día, sin cambiar el trabajo.', text:'Consulta tareas, comentarios y avances del proyecto. Este rol no permite editar ni gestionar miembros.', rights:[true,false,false]}
  };
  var roleButtons = document.querySelectorAll('[data-role]');
  roleButtons.forEach(function(button){
    button.addEventListener('click', function(){
      var role = roles[button.dataset.role];
      select(roleButtons, button);
      byId('roleDescription').querySelector('strong').textContent = role.title;
      byId('roleDescription').querySelector('p').textContent = role.text;
      byId('roleRights').querySelectorAll('span').forEach(function(span, index){
        span.textContent = role.rights[index] ? 'Sí' : 'No';
        span.classList.toggle('is-denied', !role.rights[index]);
      });
    });
  });

  var pluginButtons = document.querySelectorAll('[data-plugin]');
  pluginButtons.forEach(function(button){
    var panel = byId('plugin-' + button.dataset.plugin);
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', function(){
      select(pluginButtons, button);
      document.querySelectorAll('.plugin-panel').forEach(function(other){ other.hidden = other !== panel; });
    });
  });
  var accents = {blue:'#2F6BFF', purple:'#7C5CFF', green:'#16A36A'};
  var swatches = document.querySelectorAll('[data-accent]');
  swatches.forEach(function(button){
    button.addEventListener('click', function(){
      select(swatches, button);
      byId('appearanceExample').style.setProperty('--preview-accent', accents[button.dataset.accent]);
    });
  });
})();
