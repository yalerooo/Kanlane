# Tablero de tareas

Copia de seguridad del código y los datos del tablero de tareas (Finba, Mondragón Unibertsitatea, UNIA, Institut de Teatre, etc.).

**Versión en vivo (la que usas normalmente):**
https://claude.ai/artifact/Dq9bYTctaT6ykhXeEVmwW5

## Qué hay en esta carpeta

- `index.html` — todo el código fuente del tablero (HTML + CSS + JS en un único archivo).
- `data-backup.json` — copia de los datos guardados en el momento de exportar (tareas, notas, contactos, clientes y las contraseñas **cifradas**, nunca en texto plano). Tiene el mismo formato que genera el propio botón "Exportar copia de seguridad" del tablero.

## Importante: por qué abrir `index.html` en el navegador no funciona igual

Este tablero guarda y sincroniza los datos usando capacidades propias de los "Artifacts" de Claude (`window.claude.use('db')`, `'assets'`, `'downloads'`). Esas capacidades **solo existen dentro de claude.ai** — si abres `index.html` directamente en un navegador, o lo subes a GitHub Pages, verás el diseño pero:

- No cargará ninguna tarea, contacto, cliente ni contraseña.
- No podrás guardar nada nuevo.

Es decir: `index.html` es el **código fuente** (útil para revisarlo, versionarlo con git o seguir su evolución), no una web independiente que puedas desplegar en otro sitio tal cual. El único lugar donde funciona de verdad es el enlace de arriba.

Si en algún momento quieres una versión que funcione fuera de Claude, habría que reescribir la parte de almacenamiento (por ejemplo con Firebase, Supabase o un backend propio) — dímelo si llega ese caso y lo planteamos.

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
