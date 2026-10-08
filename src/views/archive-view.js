/* Archivados: las columnas y las tareas que se han archivado en el proyecto abierto, con
   «Restaurar» (vuelven al tablero con todo lo que tenían) y «Eliminar» (borrarlas de verdad).
   Archivar no borra nada: es otra acción, y por eso aquí van las dos separadas. */
(function(){
  const {esc, closest} = Workhub.utils.html;
  const {fmtDate, ymd} = Workhub.utils.dates;
  const $ = (id) => document.getElementById(id);
  /* A partir de cuántas tareas archivadas se ofrece el buscador. */
  const SEARCH_FROM = 8;

  class ArchiveView {
    constructor(){
      this.dlg = $('dlgArchive');
      this.btn = $('btnArchive');
      this.empty = $('archiveEmpty');
      this.colsWrap = $('archiveColumnsWrap');
      this.cols = $('archiveColumns');
      this.colsCount = $('archiveColumnsCount');
      this.tasksWrap = $('archiveTasksWrap');
      this.tasks = $('archiveTasks');
      this.tasksCount = $('archiveTasksCount');
      this.search = $('archiveSearch');
      this.state = {columns:[], tasks:[], canEdit:false};
      this.search.addEventListener('input', () => this._renderTasks());
      $('btnArchiveClose').addEventListener('click', () => this.dlg.close());
    }

    /* handlers: {open(), restoreTask(id), removeTask(id), restoreColumn(key), removeColumn(key)} */
    bind(handlers){
      this.btn.addEventListener('click', () => handlers.open());
      this.dlg.addEventListener('click', (ev) => {
        const b = closest(ev.target, 'button[data-archive]');
        if(!b || b.disabled) return;
        const act = b.getAttribute('data-archive');
        const id = b.getAttribute('data-id');
        if(act === 'restore-task') handlers.restoreTask(id);
        else if(act === 'remove-task') handlers.removeTask(id);
        else if(act === 'restore-column') handlers.restoreColumn(id);
        else if(act === 'remove-column') handlers.removeColumn(id);
      });
    }

    isOpen(){ return this.dlg.open; }

    open(){
      this.search.value = '';
      this._render();
      if(!this.dlg.open) this.dlg.showModal();
      $('btnArchiveClose').focus();
    }

    close(){
      if(this.dlg.open) this.dlg.close();
    }

    /* state: {columns:[{key, label, dot, count}], tasks:[{id, title, column, cliente, at, locked}], canEdit}
       locked: la tarea no se puede descifrar con la clave del proyecto. */
    render(state){
      this.state = state;
      if(this.dlg.open) this._render();
    }

    _actions(kind, id, name){
      if(!this.state.canEdit) return '';
      return '<span class="archive-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-archive="restore-' + kind + '" data-id="' + esc(id) + '" aria-label="' + esc(Workhub.t('Restaurar «{name}»', {name:name})) + '">' + esc(Workhub.t('Restaurar')) + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm is-danger" data-archive="remove-' + kind + '" data-id="' + esc(id) + '" aria-label="' + esc(Workhub.t('Eliminar «{name}»', {name:name})) + '">' + esc(Workhub.t('Eliminar')) + '</button>' +
        '</span>';
    }

    _render(){
      const s = this.state;
      this.empty.hidden = !!(s.columns.length || s.tasks.length);
      this.colsWrap.hidden = !s.columns.length;
      this.colsCount.textContent = s.columns.length || '';
      this.cols.innerHTML = s.columns.map((c) => {
        const n = c.count === 1 ? Workhub.t('1 tarea') : Workhub.t('{n} tareas', {n:c.count});
        return '<div class="archive-item">' +
          '<span class="archive-main"><span class="archive-title"><i class="archive-dot" style="--st:' + c.dot + '"></i><span translate="no">' + esc(c.label) + '</span></span>' +
          '<span class="archive-meta">' + esc(n) + '</span></span>' +
          this._actions('column', c.key, c.label) + '</div>';
      }).join('');
      this.tasksWrap.hidden = !s.tasks.length;
      this.tasksCount.textContent = s.tasks.length || '';
      this.search.hidden = s.tasks.length < SEARCH_FROM;
      if(this.search.hidden) this.search.value = '';
      this._renderTasks();
    }

    _renderTasks(){
      const q = this.search.value.trim().toLowerCase();
      const list = this.state.tasks.filter((t) => !q || (t.title + ' ' + t.cliente + ' ' + t.column).toLowerCase().indexOf(q) !== -1);
      if(!list.length){
        this.tasks.innerHTML = this.state.tasks.length ? '<p class="cf-empty">' + esc(Workhub.t('Ninguna tarea archivada coincide con la búsqueda.')) + '</p>' : '';
        return;
      }
      this.tasks.innerHTML = list.map((t) => {
        const title = t.locked ? Workhub.t('No se puede descifrar') : (t.title || Workhub.t('Sin título'));
        const meta = [t.cliente, t.column, t.at ? Workhub.t('Archivada el {fecha}', {fecha:fmtDate(ymd(new Date(t.at)))}) : ''].filter(Boolean);
        return '<div class="archive-item">' +
          '<span class="archive-main"><span class="archive-title" translate="no">' + esc(title) + '</span>' +
          '<span class="archive-meta">' + meta.map((m, i) => '<span' + (i < meta.length - 1 ? ' translate="no"' : '') + '>' + esc(m) + '</span>').join('') + '</span></span>' +
          this._actions('task', t.id, title) + '</div>';
      }).join('');
    }
  }

  Workhub.views.ArchiveView = ArchiveView;
})();
