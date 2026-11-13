/* BodegaControl PWA - capa de datos SQLite (OPFS via Worker).
   Misma interfaz que la capa IndexedDB anterior: openDb(), all(), put(),
   del(). La interfaz (app.js) no cambia: sigue llamando a las mismas
   funciones con los mismos nombres de "store" ('productos', 'ventas',
   'fiados', 'abonos', 'cierres', 'recogidas', 'auditoria'), y este
   archivo traduce cada store a su tabla SQLite segun el esquema de
   referencia (db-schema.sql), con los mismos nombres de tabla/columna.
   Cantidades REAL (no INTEGER): hay productos por peso con fracciones.
   La base vive en OPFS (archivo bodegacontrol.sqlite3), no en
   IndexedDB. En el primer arranque con SQLite, los datos que ya haya
   en IndexedDB se migran una sola vez (meta idb_migrated=1) y la
   IndexedDB vieja se deja intacta como respaldo; si no hay datos, se
   siembran los productos de ejemplo de siempre.
   El worker (db-worker.js) es clasico (importScripts con sql.js);
   este archivo es clasico y expone las funciones como globales
   para app.js.
*/
(function () {
  'use strict';

  var TABLES = {
    productos: 'products',
    ventas: 'sales',
    fiados: 'credit_sales',
    abonos: 'debt_payments',
    cierres: 'daily_closes',
    recogidas: 'fund_movements',
    auditoria: 'audit_log'
  };

  /* campo JS -> columna SQL (solo lo que la UI lee/escribe) */
  var FIELDS = {
    productos: { id: 'id', nombre: 'name', categoria: 'category', unidad: 'unit', costo: 'cost', precio_efectivo: 'cashPrice', precio_transferencia: 'transferPrice', stock: 'stock', stock_minimo: 'minStock' },
    ventas: { id: 'id', producto: 'productName', productoId: 'productId', cantidad: 'quantity', cantidadVenta: 'cantidadVenta', unidadVenta: 'unidadVenta', precio: 'unitPrice', costo: 'costUnit', total: 'total', metodo: 'paymentMethod', fecha: 'timestamp', anulada: 'anulada', fiadoId: 'fiadoId' },
    fiados: { id: 'id', cliente: 'clientName', detalle: 'detalle', total: 'total', fecha: 'timestamp', anulada: 'anulada' },
    abonos: { id: 'id', fiadoId: 'creditSaleId', monto: 'amount', fecha: 'timestamp' },
    cierres: { id: 'id', fecha: 'closeTimestamp', efectivo: 'cashTotal', transferencia: 'transferTotal', fiados: 'creditSalesTotal', cobros: 'debtCollectedTotal', recogidas: 'recogidas', conteo: 'conteo', diferencia: 'diferencia', ventas: 'ventas' },
    recogidas: { id: 'id', monto: 'amount', nota: 'concept', fecha: 'timestamp' },
    auditoria: { id: 'id', tipo: 'type', detalle: 'detail', fecha: 'created_at' }
  };

  var SEED = [
    { nombre: 'Ejemplo A', categoria: 'Ejemplo', unidad: 'unidad', costo: 100, precio_efectivo: 100, precio_transferencia: 130, stock: 50, stock_minimo: 5 },
    { nombre: 'Ejemplo B', categoria: 'Ejemplo', unidad: 'unidad', costo: 80, precio_efectivo: 80, precio_transferencia: 104, stock: 30, stock_minimo: 5 },
    { nombre: 'Ejemplo C', categoria: 'Ejemplo', unidad: 'unidad', costo: 120, precio_efectivo: 120, precio_transferencia: 156, stock: 3, stock_minimo: 5 }
  ];

  function isoDate(ts) {
    var d = new Date(ts || Date.now());
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /* ---------------- Worker ---------------- */
  function newHandle() {
    var worker = new Worker('db-worker.js');
    var h = { worker: worker, nextId: 1, pending: {} };
    worker.onmessage = function (e) {
      var m = e.data || {};
      var p = h.pending[m.id];
      if (!p) return;
      delete h.pending[m.id];
      if (m.ok) p.ok(m);
      else p.bad(new Error(m.error || 'Error de base de datos'));
    };
    worker.onerror = function (e) {
      var err = new Error('Error en el worker de la base de datos: ' + (e.message || 'desconocido'));
      Object.keys(h.pending).forEach(function (id) { h.pending[id].bad(err); });
      h.pending = {};
    };
    return h;
  }
  function call(h, msg) {
    return new Promise(function (ok, bad) {
      var id = h.nextId++;
      h.pending[id] = { ok: ok, bad: bad };
      msg.id = id;
      h.worker.postMessage(msg);
    });
  }
  function query(h, sql, params) {
    return call(h, { op: 'query', sql: sql, params: params || [] }).then(function (r) { return r.rows; });
  }
  function exec(h, sql, params) {
    return call(h, { op: 'exec', sql: sql, params: params || [] });
  }

  /* ---------------- Apertura: init + migracion + siembra ---------------- */
  function openDb() {
    var h = newHandle();
    return call(h, { op: 'init' }).catch(function (err) {
      var msg = String((err && err.message) || err);
      if (/busy|lock|SQLITE_BUSY/i.test(msg)) {
        throw new Error('La base de datos esta abierta en otra pestana. Cierra la otra pestana de BodegaControl y recarga esta.');
      }
      throw err;
    }).then(function (info) {
      h.sqliteVersion = info.sqliteVersion;
      return migrateIfNeeded(h);
    }).then(function () {
      return seedIfEmpty(h);
    }).then(function () { return h; });
  }

  function metaGet(h, key) {
    return query(h, 'SELECT value FROM meta WHERE key=?', [key]).then(function (rows) {
      return rows.length ? rows[0].value : null;
    });
  }
  function migrateIfNeeded(h) {
    return metaGet(h, 'idb_migrated').then(function (v) {
      if (v === '1') return false;
      return migrateFromIndexedDB(h).then(function () {
        return exec(h, "INSERT OR REPLACE INTO meta(key,value) VALUES('idb_migrated','1')");
      }).then(function () { return true; });
    });
  }
  function seedIfEmpty(h) {
    return query(h, 'SELECT COUNT(*) AS n FROM products').then(function (rows) {
      if (rows[0].n > 0) return false;
      var chain = Promise.resolve();
      SEED.forEach(function (p) {
        chain = chain.then(function () {
          return exec(h, 'INSERT INTO products(name,category,unit,cost,cashPrice,transferPrice,stock,minStock,createdAt) VALUES(?,?,?,?,?,?,?,?,?)',
            [p.nombre, p.categoria, p.unidad, p.costo, p.precio_efectivo, p.precio_transferencia, p.stock, p.stock_minimo, Date.now()]);
        });
      });
      return chain.then(function () { return true; });
    });
  }

  /* ---------------- Migracion unica desde IndexedDB ---------------- */
  function idbGetAll(store) {
    return new Promise(function (ok) {
      try {
        if (!('indexedDB' in window)) { ok([]); return; }
        var req = indexedDB.open('bodegacontrol');
        req.onsuccess = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(store)) { db.close(); ok([]); return; }
          var q = db.transaction(store, 'readonly').objectStore(store).getAll();
          q.onsuccess = function () { var rows = q.result || []; db.close(); ok(rows); };
          q.onerror = function () { db.close(); ok([]); };
        };
        req.onerror = function () { ok([]); };
      } catch (e) { ok([]); }
    });
  }
  /* detalle de fiado: "2 unidad x Ejemplo A" -> {cant, unit, name} */
  function parseDetalle(detalle) {
    var m = /^([\d.,]+)\s+(\S+)\s+×\s+(.+)$/.exec(String(detalle || ''));
    if (!m) return { cant: 0, unit: null, name: null };
    return { cant: parseFloat(m[1].replace(',', '.')), unit: m[2], name: m[3] };
  }
  function migrateFromIndexedDB(h) {
    return Promise.all([
      idbGetAll('productos'), idbGetAll('ventas'), idbGetAll('fiados'),
      idbGetAll('abonos'), idbGetAll('cierres'), idbGetAll('recogidas'),
      idbGetAll('auditoria')
    ]).then(function (r) {
      var productos = r[0], ventas = r[1], fiados = r[2], abonos = r[3],
        cierres = r[4], recogidas = r[5], auditoria = r[6];
      if (!productos.length && !ventas.length && !fiados.length && !abonos.length &&
        !cierres.length && !recogidas.length && !auditoria.length) return 0;
      var chain = Promise.resolve();
      var prodByName = {};
      var fiadoById = {};
      var abonosPorFiado = {};
      productos.forEach(function (p) { prodByName[p.nombre] = p; });
      fiados.forEach(function (f) { fiadoById[f.id] = f; });
      abonos.forEach(function (a) { abonosPorFiado[a.fiadoId] = (abonosPorFiado[a.fiadoId] || 0) + a.monto; });
      var fallbackPid = productos.length ? productos[0].id : null;
      productos.forEach(function (p) {
        chain = chain.then(function () {
          return exec(h, 'INSERT OR REPLACE INTO products(id,name,category,unit,cost,cashPrice,transferPrice,stock,minStock,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
            [p.id, p.nombre, p.categoria, p.unidad, p.costo, p.precio_efectivo, p.precio_transferencia, p.stock, p.stock_minimo, Date.now()]);
        });
      });
      ventas.forEach(function (v) {
        chain = chain.then(function () {
          var cant = v.cantidadStock != null ? v.cantidadStock : v.cantidad;
          var costTotal = (v.costo || 0) * (cant || 0);
          var cliente = null;
          if (v.metodo === 'Fiado' && v.fiadoId && fiadoById[v.fiadoId]) cliente = fiadoById[v.fiadoId].cliente;
          return exec(h, 'INSERT OR REPLACE INTO sales(id,timestamp,date,productId,productName,quantity,unitPrice,total,paymentMethod,client_name,costUnit,costTotal,profit,credit_amount,cantidadVenta,unidadVenta,fiadoId,anulada,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [v.id, v.fecha, isoDate(v.fecha), v.productoId, v.producto, cant, v.precio, v.total, v.metodo, cliente, v.costo || 0, costTotal, v.total - costTotal, v.metodo === 'Fiado' ? v.total : 0, v.cantidadVenta != null ? v.cantidadVenta : null, v.unidadVenta || null, v.fiadoId || null, v.anulada ? 1 : 0, Date.now()]);
        });
      });
      fiados.forEach(function (f) {
        chain = chain.then(function () {
          var parsed = parseDetalle(f.detalle);
          var prod = parsed.name ? prodByName[parsed.name] : null;
          var pid = prod ? prod.id : fallbackPid;
          if (pid == null) return;
          var pagado = abonosPorFiado[f.id] || 0;
          return exec(h, 'INSERT OR REPLACE INTO credit_sales(id,timestamp,clientName,productId,productName,quantity,total,amountPaid,isPaid,detalle,anulada) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            [f.id, f.fecha, f.cliente, pid, parsed.name || f.detalle, parsed.cant || 0, f.total, pagado, (pagado >= f.total - 0.001) ? 1 : 0, f.detalle, f.anulada ? 1 : 0]);
        });
      });
      abonos.forEach(function (a) {
        chain = chain.then(function () {
          var f = fiadoById[a.fiadoId];
          if (!f) return;
          return exec(h, 'INSERT OR REPLACE INTO debt_payments(id,creditSaleId,clientName,amount,timestamp) VALUES(?,?,?,?,?)',
            [a.id, a.fiadoId, f.cliente, a.monto, a.fecha]);
        });
      });
      cierres.forEach(function (c) {
        chain = chain.then(function () {
          return exec(h, 'INSERT OR REPLACE INTO daily_closes(id,closeTimestamp,dateFormatted,cashTotal,transferTotal,creditSalesTotal,debtCollectedTotal,grandTotal,recogidas,conteo,diferencia,ventas) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            [c.id, c.fecha, isoDate(c.fecha), c.efectivo, c.transferencia, c.fiados, c.cobros, c.efectivo + c.transferencia + c.cobros, c.recogidas || 0, c.conteo != null ? c.conteo : null, c.diferencia != null ? c.diferencia : null, c.ventas]);
        });
      });
      recogidas.forEach(function (x) {
        chain = chain.then(function () {
          return exec(h, 'INSERT OR REPLACE INTO fund_movements(id,date,type,method,amount,concept,notes,createdAt) VALUES(?,?,?,?,?,?,?,?)',
            [x.id, isoDate(x.fecha), 'recogida', 'efectivo', -(x.monto || 0), x.nota || '', x.nota || '', Date.now()]);
        });
      });
      auditoria.forEach(function (a) {
        chain = chain.then(function () {
          return exec(h, 'INSERT OR REPLACE INTO audit_log(id,type,detail,created_at) VALUES(?,?,?,?)',
            [a.id, a.tipo, a.detalle, a.fecha]);
        });
      });
      return chain.then(function () {
        return productos.length + ventas.length + fiados.length + abonos.length +
          cierres.length + recogidas.length + auditoria.length;
      });
    });
  }

  /* ---------------- Lectura / escritura (misma firma que antes) ---------------- */
  function rowToJs(store, row) {
    var out = {};
    var map = FIELDS[store];
    Object.keys(map).forEach(function (js) {
      var v = row[map[js]];
      out[js] = (v === undefined ? null : v);
    });
    if (store === 'ventas' || store === 'fiados') out.anulada = !!row.anulada;
    if (store === 'recogidas') {
      out.monto = row.amount != null ? -row.amount : 0;
      out.nota = row.concept != null ? row.concept : '';
    }
    return out;
  }
  function all(h, store) {
    return query(h, 'SELECT * FROM ' + TABLES[store] + ' ORDER BY id').then(function (rows) {
      return rows.map(function (r) { return rowToJs(store, r); });
    });
  }
  function setExprs(cols) {
    return cols.map(function (c) { return c + '=excluded.' + c; });
  }
  function upsertSql(table, insertCols, updateExprs) {
    var qs = insertCols.map(function () { return '?'; }).join(',');
    return 'INSERT INTO ' + table + '(' + insertCols.join(',') + ') VALUES(' + qs + ')' +
      ' ON CONFLICT(id) DO UPDATE SET ' + updateExprs.join(',');
  }
  function buildPut(h, store, obj) {
    var now = Date.now();
    var id = (obj.id != null) ? obj.id : null;
    if (store === 'productos') {
      return Promise.resolve({
        sql: upsertSql('products',
          ['id', 'name', 'category', 'unit', 'cost', 'cashPrice', 'transferPrice', 'stock', 'minStock', 'createdAt'],
          setExprs(['name', 'category', 'unit', 'cost', 'cashPrice', 'transferPrice', 'stock', 'minStock'])),
        params: [id, obj.nombre, obj.categoria, obj.unidad, obj.costo, obj.precio_efectivo, obj.precio_transferencia, obj.stock, obj.stock_minimo, now]
      });
    }
    if (store === 'ventas') {
      var cant = obj.cantidad;
      var costTotal = (obj.costo || 0) * (cant || 0);
      return Promise.resolve({
        sql: upsertSql('sales',
          ['id', 'timestamp', 'date', 'productId', 'productName', 'quantity', 'unitPrice', 'total', 'paymentMethod', 'client_name', 'costUnit', 'costTotal', 'profit', 'credit_amount', 'cantidadVenta', 'unidadVenta', 'fiadoId', 'anulada', 'createdAt'],
          setExprs(['timestamp', 'date', 'productId', 'productName', 'quantity', 'unitPrice', 'total', 'paymentMethod', 'costUnit', 'costTotal', 'profit', 'credit_amount', 'cantidadVenta', 'unidadVenta', 'fiadoId', 'anulada']).concat(['client_name=COALESCE(excluded.client_name, sales.client_name)'])),
        params: [id, obj.fecha, isoDate(obj.fecha), obj.productoId, obj.producto, cant, obj.precio, obj.total, obj.metodo, null, obj.costo || 0, costTotal, obj.total - costTotal, obj.metodo === 'Fiado' ? obj.total : 0, obj.cantidadVenta != null ? obj.cantidadVenta : null, obj.unidadVenta || null, obj.fiadoId || null, obj.anulada ? 1 : 0, now]
      });
    }
    if (store === 'fiados') {
      var parsed = parseDetalle(obj.detalle);
      return query(h, 'SELECT id FROM products WHERE name=?', [parsed.name || '']).then(function (rows) {
        var pid = rows.length ? rows[0].id : null;
        if (pid == null) {
          return query(h, 'SELECT id FROM products ORDER BY id LIMIT 1').then(function (r2) {
            if (!r2.length) throw new Error('No hay productos para enlazar el fiado');
            return r2[0].id;
          });
        }
        return pid;
      }).then(function (pid) {
        return {
          sql: upsertSql('credit_sales',
            ['id', 'timestamp', 'clientName', 'productId', 'productName', 'quantity', 'total', 'amountPaid', 'isPaid', 'detalle', 'anulada'],
            setExprs(['timestamp', 'clientName', 'productId', 'productName', 'quantity', 'total', 'detalle', 'anulada'])),
          params: [id, obj.fecha, obj.cliente, pid, parsed.name || obj.detalle, parsed.cant || 0, obj.total, 0, 0, obj.detalle, obj.anulada ? 1 : 0]
        };
      });
    }
    if (store === 'abonos') {
      return query(h, 'SELECT clientName FROM credit_sales WHERE id=?', [obj.fiadoId]).then(function (rows) {
        if (!rows.length) throw new Error('Fiado no encontrado para el abono');
        return {
          sql: upsertSql('debt_payments',
            ['id', 'creditSaleId', 'clientName', 'amount', 'timestamp'],
            setExprs(['creditSaleId', 'clientName', 'amount', 'timestamp'])),
          params: [id, obj.fiadoId, rows[0].clientName, obj.monto, obj.fecha]
        };
      });
    }
    if (store === 'cierres') {
      return Promise.resolve({
        sql: upsertSql('daily_closes',
          ['id', 'closeTimestamp', 'dateFormatted', 'cashTotal', 'transferTotal', 'creditSalesTotal', 'debtCollectedTotal', 'grandTotal', 'recogidas', 'conteo', 'diferencia', 'ventas'],
          setExprs(['closeTimestamp', 'dateFormatted', 'cashTotal', 'transferTotal', 'creditSalesTotal', 'debtCollectedTotal', 'grandTotal', 'recogidas', 'conteo', 'diferencia', 'ventas'])),
        params: [id, obj.fecha, isoDate(obj.fecha), obj.efectivo, obj.transferencia, obj.fiados, obj.cobros, obj.efectivo + obj.transferencia + obj.cobros, obj.recogidas || 0, obj.conteo != null ? obj.conteo : null, obj.diferencia != null ? obj.diferencia : null, obj.ventas]
      });
    }
    if (store === 'recogidas') {
      return Promise.resolve({
        sql: upsertSql('fund_movements',
          ['id', 'date', 'type', 'method', 'amount', 'concept', 'notes', 'createdAt'],
          setExprs(['date', 'type', 'method', 'amount', 'concept', 'notes'])),
        params: [id, isoDate(obj.fecha), 'recogida', 'efectivo', -(obj.monto || 0), obj.nota || '', obj.nota || '', now]
      });
    }
    if (store === 'auditoria') {
      return Promise.resolve({
        sql: upsertSql('audit_log',
          ['id', 'type', 'detail', 'created_at'],
          setExprs(['type', 'detail', 'created_at'])),
        params: [id, obj.tipo, obj.detalle, obj.fecha]
      });
    }
    return Promise.reject(new Error('Store desconocido: ' + store));
  }
  function refreshIsPaid(h, creditSaleId) {
    if (!creditSaleId) return Promise.resolve();
    return Promise.all([
      query(h, 'SELECT total FROM credit_sales WHERE id=?', [creditSaleId]),
      query(h, 'SELECT COALESCE(SUM(amount),0) AS s FROM debt_payments WHERE creditSaleId=?', [creditSaleId])
    ]).then(function (r) {
      if (!r[0].length) return;
      var total = r[0][0].total || 0;
      var paid = r[1][0].s || 0;
      var isPaid = paid >= total - 0.001 ? 1 : 0;
      return exec(h, 'UPDATE credit_sales SET amountPaid=?, isPaid=? WHERE id=?', [paid, isPaid, creditSaleId]);
    });
  }
  function put(h, store, obj) {
    return buildPut(h, store, obj).then(function (built) {
      return exec(h, built.sql, built.params).then(function (res) {
        var newId = (obj.id != null) ? obj.id : res.lastInsertRowid;
        if (store === 'abonos') return refreshIsPaid(h, obj.fiadoId).then(function () { return newId; });
        return newId;
      });
    });
  }
  function del(h, store, id) {
    if (store === 'abonos') {
      return query(h, 'SELECT creditSaleId FROM debt_payments WHERE id=?', [id]).then(function (rows) {
        var cid = rows.length ? rows[0].creditSaleId : null;
        return exec(h, 'DELETE FROM debt_payments WHERE id=?', [id]).then(function () { return refreshIsPaid(h, cid); });
      });
    }
    return exec(h, 'DELETE FROM ' + TABLES[store] + ' WHERE id=?', [id]).then(function () { });
  }

  /* Globales para app.js (mismos nombres que la capa IndexedDB anterior). */
  window.openDb = openDb;
  window.all = all;
  window.put = put;
  window.del = del;
})();
