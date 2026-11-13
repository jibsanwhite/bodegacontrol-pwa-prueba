/* BodegaControl PWA - worker de SQLite (modulo ES).
   Corre en un Worker dedicado: abre la base en OPFS con la API
   asincrona OpfsDb, que NO necesita SharedArrayBuffer ni cabeceras
   COOP/COEP, asi funciona en GitHub Pages. La variante anterior
   (OpfsSAHPoolDb + installOpfsSAHPoolVfs) exigia aislamiento
   cross-origin y en Pages daba "OpfsSAHPoolDb is not a constructor".
   OJO: OpfsDb solo existe DESPUES de llamar installOpfsVfs(), que es
   lo que instala el VFS "opfs" y define la clase; sin esa llamada da
   "OpfsDb is not a constructor".
   Una sola conexion: si la misma pagina se abre en otra pestana, la
   segunda no puede abrir la base (OPFS bloquea el archivo) y el
   inicio devuelve error; el hilo principal lo traduce a un mensaje
   para el usuario ("cierra la otra pestana y recarga").
   Protocolo: {id, op, ...} -> {id, ok:true, ...} | {id, ok:false, error}
   Ops: init | query {sql, params} | exec {sql, params} | close
   El esquema vive en db-schema.sql (misma carpeta); se carga una vez.
*/
import sqlite3InitModule from './vendor/sqlite3/sqlite3.mjs';

var DB_FILE = '/bodegacontrol.sqlite3';
var sqlite3 = null;
var db = null;
var ready = null;

function init() {
  if (ready) return ready;
  ready = (async function () {
    sqlite3 = await sqlite3InitModule({
      locateFile: function (f) {
        return new URL('./vendor/sqlite3/' + f, location.href).href;
      }
    });
    // OpfsDb: API asincrona sobre OPFS, sin SharedArrayBuffer. Hay que
    // instalar el VFS "opfs" ANTES: es esa llamada la que define la
    // clase sqlite3.oo1.OpfsDb. Si este navegador no tiene OPFS, la
    // instalacion no define la clase y se lanza un error claro.
    await sqlite3.installOpfsVfs();
    if (typeof sqlite3.oo1.OpfsDb !== 'function') {
      throw new Error('Este navegador no tiene OPFS disponible (no se pudo instalar el VFS opfs)');
    }
    db = await new sqlite3.oo1.OpfsDb(DB_FILE);
    await db.exec('PRAGMA foreign_keys=ON');
    var res = await fetch(new URL('db-schema.sql', location.href));
    if (!res.ok) {
      throw new Error('No se pudo cargar db-schema.sql (HTTP ' + res.status + ')');
    }
    await db.exec(await res.text());
    return { sqliteVersion: sqlite3.version.libVersion, filename: db.filename };
  })();
  return ready;
}

self.onmessage = async function (e) {
  var msg = e.data || {};
  var id = msg.id;
  try {
    if (msg.op === 'init') {
      var info = await init();
      self.postMessage({ id: id, ok: true, sqliteVersion: info.sqliteVersion, filename: info.filename });
      return;
    }
    await init();
    if (msg.op === 'query') {
      var rows = await db.selectObjects(msg.sql, msg.params || []);
      self.postMessage({ id: id, ok: true, rows: rows });
    } else if (msg.op === 'exec') {
      await db.exec(msg.sql, { bind: msg.params || [] });
      var lastId = await db.selectValue('SELECT last_insert_rowid()');
      self.postMessage({ id: id, ok: true, changes: await db.changes(), lastInsertRowid: lastId });
    } else if (msg.op === 'close') {
      try { await db.close(); } catch (err) { /* ya cerrada */ }
      db = null;
      ready = null;
      self.postMessage({ id: id, ok: true });
    } else {
      throw new Error('Operacion desconocida: ' + msg.op);
    }
  } catch (err) {
    self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
  }
};
