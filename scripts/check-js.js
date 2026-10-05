/* Comprueba la sintaxis de los scripts publicados y las pruebas sin dependencias. */
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dirs = ['src', 'plugins', 'tests/sw', 'tests/demo', 'tests/plugins', 'tests/consent', 'tests/vault', 'tests/crypto', 'tests/backup', 'tests/assets', 'tests/build', 'tests/season', 'tests/e2e', 'scripts', 'worker'];
const files = ['sw.js'];
function scan(dir){
  for(const entry of fs.readdirSync(dir, {withFileTypes:true})){
    const full = path.join(dir, entry.name);
    if(entry.isDirectory() && entry.name !== 'node_modules') scan(full);
    else if(entry.name.endsWith('.js')) files.push(full);
  }
}
dirs.forEach((dir) => scan(path.join(root, dir)));
for(const file of files){
  const result = spawnSync(process.execPath, ['--check', file], {cwd:root, stdio:'inherit'});
  if(result.status !== 0) process.exit(result.status || 1);
}
console.log('OK   sintaxis de ' + files.length + ' archivos JavaScript');
