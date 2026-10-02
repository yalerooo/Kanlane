/* Ejemplos de producto. Estado efímero: sin cuentas, red ni almacenamiento.
   Textos en español e inglés según <html lang>. */
(function(){
  'use strict';
  var en = document.documentElement.lang === 'en';
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
  var dayFeedback = en
    ? ['Try completing a task.', 'One less pending. Keep your pace.', 'Almost done for the day.', 'All done. Now breathe.']
    : ['Prueba a completar una tarea.', 'Un pendiente menos. Sigue a tu ritmo.', 'Ya queda menos para cerrar el día.', 'Todo listo. Ahora sí, respira.'];
  function updateDay(){
    var done = Array.from(dayTasks).filter(function(task){ return task.checked; }).length;
    byId('dayPending').textContent = String(dayTasks.length - done);
    byId('dayCount').textContent = done + ' / ' + dayTasks.length;
    byId('dayProgress').style.width = done / dayTasks.length * 100 + '%';
    byId('dayFeedback').textContent = dayFeedback[done];
  }
  if(dayTasks.length){ dayTasks.forEach(function(task){ task.addEventListener('change', updateDay); }); updateDay(); }

  var clients = en ? {
    north:{initial:'N', name:'North Studio', task:'Mock up the new homepage', status:'In progress', person:'Marta Ruiz', role:'Communications manager', meeting:'Design review', date:'Wednesday · 16:30', access:'Website panel'},
    coast:{initial:'C', name:'Coast Workshop', task:'Prepare the quote', status:'Pending', person:'Lucas Costa', role:'Shop manager', meeting:'Maintenance plan', date:'Thursday · 10:00', access:'Admin email'},
    house:{initial:'A', name:'Aldea House', task:'Review the website copy', status:'In review', person:'Irene Vega', role:'Content coordinator', meeting:'Photo delivery', date:'Friday · 12:00', access:'Content manager'}
  } : {
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

  var roles = en ? {
    owner:{title:'The project, in your hands.', text:'Manage the work, invite people and decide who can edit or view.', rights:[true,true,true]},
    editor:{title:'All set to collaborate.', text:'Create tasks, update the work and join the comments. Members and permissions are managed by the owner.', rights:[true,true,false]},
    viewer:{title:'Up to date, without changing the work.', text:'View tasks, comments and project progress. This role cannot edit or manage members.', rights:[true,false,false]}
  } : {
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
        span.textContent = role.rights[index] ? (en ? 'Yes' : 'Sí') : 'No';
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
