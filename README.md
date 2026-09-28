# Workhub

Gestor de trabajo por cliente: tareas, calendario con reuniones, contactos, contraseñas cifradas y clientes (Finba, Mondragón Unibertsitatea, UNIA, Institut de Teatre, etc.). En Ajustes se puede elegir el color de acento y el tema claro/oscuro.

**Versión en vivo (la que usas normalmente):**
https://claude.ai/artifact/Dq9bYTctaT6ykhXeEVmwW5

## Qué hay en esta carpeta

- `index.html` — todo el código fuente del tablero (HTML + CSS + JS en un único archivo).
- `data-backup.json` — copia de los datos guardados en el momento de exportar (tareas, notas, contactos, clientes y las contraseñas **cifradas**, nunca en texto plano). Tiene el mismo formato que genera el propio botón "Exportar copia de seguridad" del tablero.
- `iniciar-tablero.bat` — doble clic y ya está (ver abajo).

## Cómo lanzarlo en local

`index.html` ya funciona por su cuenta, sin depender de claude.ai. Cuando lo abres fuera de un Artifact de Claude, detecta que no existe `window.claude` y usa en su lugar un almacén propio en el navegador (IndexedDB) con la misma forma — así que tareas, notas, imágenes, contactos, clientes y contraseñas se guardan igual, pero **solo en ese navegador y ese origen** (no se sincronizan con la versión de claude.ai ni entre distintos navegadores/ordenadores).

**La forma más rápida:** doble clic en **`iniciar-tablero.bat`**. Abre una ventana de consola con el servidor local corriendo (no la cierres mientras uses el tablero) y te abre el navegador en `http://localhost:5500` automáticamente. Para cerrar el tablero, cierra esa ventana de consola.

Otras formas:

- **Doble clic en `index.html`** — en Chrome/Edge suele funcionar tal cual (IndexedDB y el cifrado funcionan igual sobre `file://`), pero es menos fiable que servirlo.
- **A mano**, con Python (ya lo tienes instalado):
  ```bash
  cd Tablero
  python -m http.server 5500
  ```
  y abre `http://localhost:5500` en el navegador.

Los datos de esta copia local y los de la versión en vivo (claude.ai) son **independientes** — usa la pestaña "Copia de seguridad" de cada una para exportar/importar y mantenerlas igualadas si lo necesitas.

## Restaurar los datos

Desde la pestaña **"Copia de seguridad"** del tablero, botón **"Importar copia de seguridad"**, seleccionando `data-backup.json`. Añade los datos a lo que ya haya en el tablero (no borra nada). Las contraseñas del archivo solo se importan si el tablero de destino todavía no tiene su propia contraseña maestra configurada.

## Subir esto a GitHub

Esta carpeta ya está inicializada como repositorio git local. Para subirla:

```bash
cd Tablero
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git branch -M main
git push -u origin main
```

Si el repositorio en GitHub es público, ten en cuenta que `data-backup.json` contiene nombres de clientes, contactos y tareas reales (las contraseñas van cifradas, pero el resto no) — usa un repositorio **privado** si no quieres que esa información sea visible.
