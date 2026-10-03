/* Almacén de claves (src/services/keystore.js) en un navegador de verdad: la CryptoKey no extraíble
   se guarda en IndexedDB, se recupera, sigue sin poder exportarse y sobrevive a recargar la página.
   Usa su propio servidor estático (solo los cuatro scripts que hacen falta, en http://127.0.0.1, que
   es un contexto seguro) y Edge si está instalado (si no, Chrome o el Chromium de Playwright).
   Uso: node tests/e2e/keystore-check.js   (necesita npm ci --prefix tests/e2e) */
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const SCRIPTS = ['src/core/namespace.js', 'src/services/crypto.js', 'src/services/project-crypto.js', 'src/services/keystore.js'];
const PAGE = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>keystore</title>' +
  SCRIPTS.map((s) => '<script src="/' + s + '"></script>').join('') + '</head><body></body></html>';
const browserPath = process.env.CHROME_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((candidate) => fs.existsSync(candidate));

function serve(){
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if(url === '/'){
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      return res.end(PAGE);
    }
    const rel = url.slice(1);
    if(SCRIPTS.indexOf(rel) === -1){ res.statusCode = 404; return res.end('No encontrado'); }
    res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8', 'Cache-Control':'no-store'});
    res.end(fs.readFileSync(path.join(root, rel)));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main(){
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless:true, ...(browserPath ? {executablePath:browserPath} : {})});
  console.log('     navegador: ' + (browserPath ? path.basename(browserPath) : 'Chromium de Playwright') + ' ' + browser.version());
  try{
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/', {waitUntil:'load'});

    /* 1. Crear una DEK, guardarla y leerla. */
    const first = await page.evaluate(async () => {
      const PC = Workhub.services.projectCrypto, KS = Workhub.services.keystore;
      const pid = PC.newPid(), kid = PC.newKid(), raw = PC.newDekBytes();
      const key = await PC.importDek(raw);
      raw.fill(0);
      const aad = {pid, kid, path:'tasks', id:'t1', ev:1};
      const e = await PC.seal(key, aad, {title:'Tarea secreta'});
      const where = await KS.put({uid:'uid-ana', pid, projectId:'p1', kid, key});
      const got = await KS.get('uid-ana', pid);
      let exported = true;
      try{ await crypto.subtle.exportKey('raw', got.key); }catch(err){ exported = false; }
      return {pid, kid, e, where, available:KS.isAvailable(), extractable:got.key.extractable, trusted:got.trusted,
        isCryptoKey:got.key instanceof CryptoKey, exported, opened:await PC.open(got.key, aad, e), kcv:await PC.kcv(got.key, pid, kid)};
    });
    assert.equal(first.available, true, 'IndexedDB disponible');
    assert.equal(first.where, 'disk', 'la clave se guarda en IndexedDB');
    assert.equal(first.isCryptoKey, true);
    assert.equal(first.extractable, false);
    assert.equal(first.exported, false, 'exportKey falla: la clave no es extraíble');
    assert.equal(first.trusted, false);
    assert.deepEqual(first.opened, {title:'Tarea secreta'});
    console.log('OK   navegador: la CryptoKey se guarda en IndexedDB, se recupera y no se puede exportar');

    /* 2. Recargar: la clave sigue ahí y descifra lo de antes. */
    await page.reload({waitUntil:'load'});
    const after = await page.evaluate(async ({pid, kid, e, kcv}) => {
      const PC = Workhub.services.projectCrypto, KS = Workhub.services.keystore;
      const got = await KS.get('uid-ana', pid);
      if(!got) return null;
      let exported = true;
      try{ await crypto.subtle.exportKey('raw', got.key); }catch(err){ exported = false; }
      return {kid:got.kid, projectId:got.projectId, extractable:got.key.extractable, exported,
        opened:await PC.open(got.key, {pid, kid, path:'tasks', id:'t1', ev:1}, e), kcv:await PC.checkKcv(got.key, pid, kid, kcv)};
    }, first);
    assert.ok(after, 'la clave sobrevive a recargar');
    assert.deepEqual(after, {kid:first.kid, projectId:'p1', extractable:false, exported:false, opened:{title:'Tarea secreta'}, kcv:true});
    const raw = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('workhub-keys');
      req.onsuccess = () => {
        const all = req.result.transaction('keys').objectStore('keys').getAll();
        all.onsuccess = () => resolve(all.result.map((r) => ({id:r.id, keyType:Object.prototype.toString.call(r.key), fields:Object.keys(r).sort()})));
      };
    }));
    assert.deepEqual(raw, [{id:'uid-ana:' + first.pid, keyType:'[object CryptoKey]', fields:['id', 'key', 'kid', 'pid', 'projectId', 'savedAt', 'trusted', 'uid']}]);
    console.log('OK   navegador: la clave sobrevive a recargar y el registro solo guarda la CryptoKey (sin bytes)');

    /* 3. Otra pestaña recibe el aviso; olvidar y purgar. */
    const other = await context.newPage();
    await other.goto(origin + '/', {waitUntil:'load'});
    await other.evaluate(() => { window.__msgs = []; Workhub.services.keystore.onChange((m) => window.__msgs.push(m)); });
    const counts = await page.evaluate(async () => {
      const KS = Workhub.services.keystore, PC = Workhub.services.projectCrypto;
      const key = await PC.importDek(PC.newDekBytes());
      await KS.put({uid:'uid-ana', pid:'pid-confianza', projectId:'p2', kid:'k', key, trusted:true});
      await KS.put({uid:'uid-bea', pid:'pid-bea', projectId:'main', kid:'k', key});
      const signOut = await KS.forgetUser('uid-ana', {keepTrusted:true});
      const purge = await KS.purgeUntrusted();
      return {signOut, purge, trusted:!!(await KS.get('uid-ana', 'pid-confianza')), bea:await KS.get('uid-bea', 'pid-bea')};
    });
    assert.deepEqual(counts, {signOut:1, purge:1, trusted:true, bea:null});
    await other.waitForFunction(() => window.__msgs.length >= 4);
    const msgs = await other.evaluate(() => window.__msgs);
    assert.deepEqual(msgs.map((m) => m.type), ['put', 'put', 'forget', 'forget']);
    assert.ok(msgs.every((m) => !('key' in m)));
    assert.equal(await other.evaluate(() => Workhub.services.keystore.get('uid-ana', 'pid-confianza').then((x) => x && x.trusted)), true, 'la otra pestaña lee la misma base');
    console.log('OK   navegador: aviso a otra pestaña; cerrar sesión conserva solo la de confianza; purgar borra las demás');

    /* 4. Rendimiento de PBKDF2 600 000 en este navegador (dato para D15). */
    const ms = await page.evaluate(async () => {
      const PC = Workhub.services.projectCrypto;
      const ctx = {pid:PC.newPid(), kid:PC.newKid(), uid:'u'};
      const t0 = performance.now();
      const doc = await PC.wrapPassword(PC.newDekBytes(), 'una contraseña de prueba', ctx);
      const t1 = performance.now();
      await PC.unwrapPassword(doc, 'una contraseña de prueba', ctx);
      return {wrap:Math.round(t1 - t0), unwrap:Math.round(performance.now() - t1)};
    });
    console.log('     PBKDF2 600 000 en el navegador: envolver ' + ms.wrap + ' ms, desenvolver ' + ms.unwrap + ' ms');
    assert.deepEqual(errors, [], 'sin errores JavaScript');
    await context.close();

    /* 5. Un navegador nuevo (sin datos) no tiene la clave. */
    const clean = await browser.newContext();
    const cleanPage = await clean.newPage();
    await cleanPage.goto(origin + '/', {waitUntil:'load'});
    assert.equal(await cleanPage.evaluate((pid) => Workhub.services.keystore.get('uid-ana', pid), first.pid), null);
    await clean.close();

    /* 6. Sin IndexedDB (como algunos modos privados): memoria, sin excepciones. */
    const priv = await browser.newContext();
    await priv.addInitScript(() => { IDBFactory.prototype.open = function(){ throw new DOMException('No disponible', 'InvalidStateError'); }; });
    const privPage = await priv.newPage();
    const privErrors = [];
    privPage.on('pageerror', (error) => privErrors.push(error.message));
    await privPage.goto(origin + '/', {waitUntil:'load'});
    const result = await privPage.evaluate(async () => {
      const KS = Workhub.services.keystore, PC = Workhub.services.projectCrypto;
      const key = await PC.importDek(PC.newDekBytes());
      const where = await KS.put({uid:'u', pid:'p', projectId:'x', kid:'k', key});
      return {where, got:!!(await KS.get('u', 'p')), available:KS.isAvailable(), forgot:await KS.forgetUser('u')};
    });
    assert.deepEqual(result, {where:'memory', got:true, available:false, forgot:1});
    await privPage.reload({waitUntil:'load'});
    assert.equal(await privPage.evaluate(() => Workhub.services.keystore.get('u', 'p')), null, 'en memoria no sobrevive a recargar');
    assert.deepEqual(privErrors, []);
    await priv.close();
    console.log('OK   navegador: sin IndexedDB la clave queda en memoria y no hay excepciones');
  }finally{
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
