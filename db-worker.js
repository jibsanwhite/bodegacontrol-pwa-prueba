/* BodegaControl PWA - worker de SQLite con sql.js + OPFS.
   La libreria oficial (@sqlite.org/sqlite-wasm) NO funciona en
   GitHub Pages: sus dos VFS de OPFS exigen SharedArrayBuffer
   (cabeceras COOP/COEP), que Pages no envia. sql.js guarda la
   base en memoria y despues de cada escritura exporta el archivo
   completo a OPFS con la API de archivos, que si funciona en
   cualquier pagina HTTPS sin COOP/COEP. El archivo sigue siendo
   un SQLite normal (mismo esquema de referencia).
   Worker clasico (importScripts), no modulo ES.
   Una sola conexion: se toma un candado exclusivo (Web Locks) al
   iniciar; si la misma pagina esta abierta en otra pestana, el
   inicio devuelve error y el hilo principal lo traduce a un
   mensaje para el usuario ("cierra la otra pestana y recarga").
   Protocolo: {id, op, ...} -> {id, ok:true, ...} | {id, ok:false, error}
   Ops: init | query {sql, params} | exec {sql, params} | close
   El esquema vive en db-schema.sql (misma carpeta); se carga una vez.
*/
importScripts('./vendor/sql-wasm.js');

var DB_FILE = 'bodegacontrol.sqlite3';
var LOCK_NAME = 'bodegacontrol-db';
var SQL = null;
var db = null;
var ready = null;
var dirPromise = null;
var releaseLock = null;
var lockPromise = null;

function opfsDir() {
  if (!dirPromise) dirPromise = self.navigator.storage.getDirectory();
  return dirPromise;
}

function acquireLock() {
  if (lockPromise) return lockPromise;
  lockPromise = new Promise(function (resolve) {
    var req = self.navigator.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, function (lock) {
      if (!lock) { resolve(false); return; }
      /* Se mantiene el candado hasta que se llame a releaseLock (al cerrar). */
      return new Promise(function (res) { releaseLock = res; resolve(true); });
    });
    req.then(function (v) { if (v === null || v === undefined) resolve(false); });
  });
  return lockPromise;
}

async function persist() {
  var data = db.export();
  var dir = await opfsDir();
  var handle = await dir.getFileHandle(DB_FILE, { create: true });
  var w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

/* ---------------- Migracion Fase 2 (turnos y dependientes) ----------------
   Las bases Fase 1 que ya existen en los telefonos no tienen estas tablas
   ni la columna turno_id. La migracion es idempotente: CREATE TABLE IF
   NOT EXISTS, ALTER solo si PRAGMA table_info no muestra la columna, y
   la siembra del dependiente "Dueno" solo si no hay dependientes.
   Corre en cada arranque (base nueva y base vieja); una base nueva ya
   trae las tablas desde db-schema.sql, asi que no hace nada de mas.
   La marca meta fase2_migrated='1' se escribe solo tras el exito. */
var FASE2_DDL = [
  "CREATE TABLE IF NOT EXISTS dependientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, rol TEXT, activo INTEGER NOT NULL DEFAULT 1, creado_en INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS idx_dependientes_activo ON dependientes(activo)",
  "CREATE TABLE IF NOT EXISTS turnos (id INTEGER PRIMARY KEY AUTOINCREMENT, dependiente_id INTEGER NOT NULL REFERENCES dependientes(id), fecha TEXT, hora_apertura INTEGER NOT NULL DEFAULT 0, hora_cierre INTEGER, fondo_inicial REAL NOT NULL DEFAULT 0, recogidas REAL NOT NULL DEFAULT 0, contado REAL, diferencia REAL, estado TEXT NOT NULL DEFAULT 'abierto')",
  "CREATE INDEX IF NOT EXISTS idx_turnos_dep ON turnos(dependiente_id, estado)",
  "CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos(fecha)",
  "CREATE TABLE IF NOT EXISTS recogidas_turno (id INTEGER PRIMARY KEY AUTOINCREMENT, turno_id INTEGER NOT NULL REFERENCES turnos(id), monto REAL NOT NULL DEFAULT 0, nota TEXT, timestamp INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS idx_recogidas_turno ON recogidas_turno(turno_id)"
];
function columnExists(table, col) {
  var rows = toObjects(db.exec('PRAGMA table_info(' + table + ')'));
  return rows.some(function (r) { return r.name === col; });
}
function migrateFase2() {
  FASE2_DDL.forEach(function (sql) { db.exec(sql); });
  /* ALTER solo si falta la columna (las bases Fase 1 no la tienen). */
  if (!columnExists('sales', 'turno_id')) db.exec('ALTER TABLE sales ADD COLUMN turno_id INTEGER');
  if (!columnExists('credit_sales', 'turno_id')) db.exec('ALTER TABLE credit_sales ADD COLUMN turno_id INTEGER');
  if (!columnExists('debt_payments', 'turno_id')) db.exec('ALTER TABLE debt_payments ADD COLUMN turno_id INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sales_turno ON sales(turno_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_credit_turno ON credit_sales(turno_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_debt_turno ON debt_payments(turno_id)');
  db.exec("INSERT INTO dependientes(nombre, rol, activo, creado_en) SELECT 'Dueño', 'Dueño', 1, 0 WHERE NOT EXISTS (SELECT 1 FROM dependientes)");
  db.exec("INSERT OR REPLACE INTO meta(key,value) VALUES('fase2_migrated','1')");
}

async function loadOrCreate() {
  var dir = await opfsDir();
  var bytes = null;
  try {
    var handle = await dir.getFileHandle(DB_FILE);
    var file = await handle.getFile();
    var buf = await file.arrayBuffer();
    if (buf.byteLength > 0) bytes = new Uint8Array(buf);
  } catch (e) { /* no existe aun: se crea una base nueva */ }
  if (bytes) {
    db = new SQL.Database(bytes);
  } else {
    db = new SQL.Database();
    var res = await fetch(new URL('db-schema.sql', self.location.href));
    if (!res.ok) throw new Error('No se pudo cargar db-schema.sql (HTTP ' + res.status + ')');
    db.exec(await res.text());
  }
  migrateFase2();
  await persist();
  db.run('PRAGMA foreign_keys=ON');
}

function toObjects(result) {
  /* sql.js devuelve [{columns, values}]; la app espera [{columna: valor}] */
  if (!result || !result.length) return [];
  var cols = result[0].columns, out = [];
  result[0].values.forEach(function (row) {
    var o = {};
    cols.forEach(function (c, i) { o[c] = row[i]; });
    out.push(o);
  });
  return out;
}

function init() {
  if (ready) return ready;
  ready = (async function () {
    if (typeof self.initSqlJs !== 'function') throw new Error('No se pudo cargar sql.js');
    var granted = await acquireLock();
    if (!granted) throw new Error('La base de datos esta abierta en otra pestana (SQLITE_BUSY).');
    SQL = await self.initSqlJs({
      locateFile: function (f) { return new URL('./vendor/' + f, self.location.href).href; }
    });
    await loadOrCreate();
    var v = toObjects(db.exec('SELECT sqlite_version() AS v'));
    return { sqliteVersion: v.length ? v[0].v : '', filename: DB_FILE };
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
      var rows = toObjects(db.exec(msg.sql, msg.params || []));
      self.postMessage({ id: id, ok: true, rows: rows });
    } else if (msg.op === 'exec') {
      db.run(msg.sql, msg.params || []);
      var changes = db.getRowsModified();
      var lastId = toObjects(db.exec('SELECT last_insert_rowid() AS v'));
      await persist();
      self.postMessage({ id: id, ok: true, changes: changes, lastInsertRowid: lastId.length ? lastId[0].v : 0 });
    } else if (msg.op === 'close') {
      try { await persist(); db.close(); } catch (err) { /* ya cerrada */ }
      db = null; SQL = null; ready = null;
      if (releaseLock) { releaseLock(); releaseLock = null; lockPromise = null; }
      self.postMessage({ id: id, ok: true });
    } else {
      throw new Error('Operacion desconocida: ' + msg.op);
    }
  } catch (err) {
    self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
  }
};
