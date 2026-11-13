/* BodegaControl PWA - worker de SQLite (modulo ES).
   Corre en un Worker dedicado: abre la base en OPFS con el VFS
   "opfs-sahpool" (no necesita cabeceras COOP/COEP, asi funciona en
   GitHub Pages) y responde a mensajes del hilo principal.
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
    // Instala el VFS opfs-sahpool. Si este navegador no tiene OPFS,
    // lanza y el hilo principal muestra el error.
    await sqlite3.installOpfsSAHPoolVfs();
    db = new sqlite3.oo1.OpfsSAHPoolDb(DB_FILE);
    db.exec('PRAGMA foreign_keys=ON');
    var res = await fetch(new URL('db-schema.sql', location.href));
    if (!res.ok) {
      throw new Error('No se pudo cargar db-schema.sql (HTTP ' + res.status + ')');
    }
    db.exec(await res.text());
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
      var rows = db.selectObjects(msg.sql, msg.params || []);
      self.postMessage({ id: id, ok: true, rows: rows });
    } else if (msg.op === 'exec') {
      db.exec(msg.sql, { bind: msg.params || [] });
      var lastId = db.selectValue('SELECT last_insert_rowid()');
      self.postMessage({ id: id, ok: true, changes: db.changes(), lastInsertRowid: lastId });
    } else if (msg.op === 'close') {
      try { db.close(); } catch (err) { /* ya cerrada */ }
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
