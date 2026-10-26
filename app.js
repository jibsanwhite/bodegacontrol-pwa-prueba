/* BodegaControl PWA PRUEBA - datos solo en IndexedDB de este navegador.
   Sin cuentas, sin nube, sin pagos. Solo productos de ejemplo. */
(function () {
  'use strict';
  var DB = 'bodegacontrol', VER = 1;
  var SEED = [
    {nombre: 'Ejemplo A', categoria: 'Ejemplo', unidad: 'unidad', costo: 100, precio_efectivo: 100, precio_transferencia: 130, stock: 50, stock_minimo: 5},
    {nombre: 'Ejemplo B', categoria: 'Ejemplo', unidad: 'unidad', costo: 80, precio_efectivo: 80, precio_transferencia: 104, stock: 30, stock_minimo: 5},
    {nombre: 'Ejemplo C', categoria: 'Ejemplo', unidad: 'unidad', costo: 120, precio_efectivo: 120, precio_transferencia: 156, stock: 3, stock_minimo: 5}
  ];
  function money(n) { return '$' + Number(n).toFixed(0) + ' CUP'; }
  function fmtDate(t) { return new Date(t).toLocaleString('es-CU'); }
  function openDb() {
    return new Promise(function (ok, bad) {
      var r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () {
        var d = r.result;
        ['productos', 'ventas', 'fiados', 'abonos', 'cierres'].forEach(function (s) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath: 'id', autoIncrement: true});
        });
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { bad(r.error); };
    });
  }
  function tx(db, store, mode) { return db.transaction(store, mode).objectStore(store); }
  function all(db, store) {
    return new Promise(function (ok, bad) {
      var q = tx(db, store, 'readonly').getAll();
      q.onsuccess = function () { ok(q.result || []); };
      q.onerror = function () { bad(q.error); };
    });
  }
  function put(db, store, v) {
    return new Promise(function (ok, bad) {
      var q = tx(db, store, 'readwrite').put(v);
      q.onsuccess = function () { ok(q.result); };
      q.onerror = function () { bad(q.error); };
    });
  }
  function del(db, store, id) {
    return new Promise(function (ok, bad) {
      var q = tx(db, store, 'readwrite').delete(id);
      q.onsuccess = function () { ok(); };
      q.onerror = function () { bad(q.error); };
    });
  }
  var db, editId = null;
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }

  function renderTabs() {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        el('tab-' + b.dataset.tab).classList.add('active');
      };
    });
  }

  function renderAll() { return Promise.all([renderProductos(), renderVentas(), renderFiados(), renderCaja()]); }

  function renderProductos() {
    return all(db, 'productos').then(function (ps) {
      ps.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
      el('p-lista').innerHTML = ps.map(function (p) {
        var alerta = p.stock <= p.stock_minimo ? ' <span class="alerta">ALERTA: stock bajo</span>' : '';
        return '<li><strong>' + esc(p.nombre) + '</strong> (' + esc(p.categoria) + ')<br>' +
          'Costo ' + money(p.costo) + ' · Efectivo ' + money(p.precio_efectivo) + ' · Transferencia ' + money(p.precio_transferencia) + '<br>' +
          'Stock: ' + p.stock + ' ' + esc(p.unidad) + ' · Mínimo: ' + p.stock_minimo + alerta + '<br>' +
          '<button data-edit="' + p.id + '">Editar</button>' +
          '<button data-del="' + p.id + '">Borrar</button></li>';
      }).join('') || '<li>Sin productos.</li>';
      var sel = el('v-producto');
      sel.innerHTML = ps.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + ' (stock ' + p.stock + ')</option>'; }).join('');
      document.querySelectorAll('[data-edit]').forEach(function (b) {
        b.onclick = function () { cargarEdicion(Number(b.dataset.edit)); };
      });
      document.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (confirm('¿Borrar este producto?')) del(db, 'productos', Number(b.dataset.del)).then(renderAll);
        };
      });
      actualizarResumenVenta();
    });
  }
  function cargarEdicion(id) {
    all(db, 'productos').then(function (ps) {
      var p = ps.find(function (x) { return x.id === id; });
      if (!p) return;
      editId = id;
      el('p-form-titulo').textContent = 'Editando: ' + p.nombre;
      el('p-nombre').value = p.nombre; el('p-categoria').value = p.categoria; el('p-unidad').value = p.unidad;
      el('p-costo').value = p.costo; el('p-efectivo').value = p.precio_efectivo; el('p-transferencia').value = p.precio_transferencia;
      el('p-stock').value = p.stock; el('p-minimo').value = p.stock_minimo;
      document.querySelector('[data-tab="productos"]').click();
    });
  }
  function actualizarResumenVenta() {
    all(db, 'productos').then(function (ps) {
      var p = ps.find(function (x) { return String(x.id) === el('v-producto').value; });
      if (!p) { el('v-resumen').textContent = ''; return; }
      var cant = parseInt(el('v-cantidad').value, 10) || 0;
      var metodo = el('v-metodo').value;
      var precio = metodo === 'Transferencia' ? p.precio_transferencia : p.precio_efectivo;
      el('v-resumen').textContent = p.nombre + ': ' + cant + ' × ' + money(precio) + ' = ' + money(cant * precio) +
        (metodo === 'Fiado' ? ' (fiado, se descuenta el stock al crear)' : '') +
        (cant > p.stock ? ' — BLOQUEADO: no hay stock suficiente (tienes ' + p.stock + ')' : '');
    });
  }
  function renderVentas() {
    return all(db, 'ventas').then(function (vs) {
      vs.sort(function (a, b) { return b.fecha - a.fecha; });
      el('v-ventas').innerHTML = vs.slice(0, 20).map(function (v) {
        return '<li>' + esc(v.producto) + ' · ' + v.cantidad + ' × ' + money(v.precio) + ' = ' + money(v.total) +
          ' · ' + esc(v.metodo) + ' · ' + fmtDate(v.fecha) + '</li>';
      }).join('') || '<li>Sin ventas todavía.</li>';
    });
  }
  function renderFiados() {
    return Promise.all([all(db, 'fiados'), all(db, 'abonos')]).then(function (r) {
      var fs = r[0], abs = r[1];
      var total = 0;
      el('f-lista').innerHTML = fs.map(function (f) {
        var pagado = abs.filter(function (a) { return a.fiadoId === f.id; }).reduce(function (s, a) { return s + a.monto; }, 0);
        var pend = Math.max(0, f.total - pagado);
        total += pend;
        return '<li><strong>' + esc(f.cliente) + '</strong> · ' + esc(f.detalle) + '<br>' +
          'Total ' + money(f.total) + ' · Abonado ' + money(pagado) + ' · Pendiente ' + money(pend) +
          (pend === 0 ? ' · <strong>PAGADO</strong>' : '') + ' · ' + fmtDate(f.fecha) + '</li>';
      }).join('') || '<li>No hay fiados pendientes.</li>';
      el('f-total').textContent = money(total);
      el('f-fiado').innerHTML = fs.map(function (f) {
        var pagado = abs.filter(function (a) { return a.fiadoId === f.id; }).reduce(function (s, a) { return s + a.monto; }, 0);
        return '<option value="' + f.id + '">' + esc(f.cliente) + ' — pendiente ' + money(Math.max(0, f.total - pagado)) + '</option>';
      }).join('');
    });
  }
  function renderCaja() {
    return Promise.all([all(db, 'ventas'), all(db, 'abonos'), all(db, 'cierres')]).then(function (r) {
      var vs = r[0], abs = r[1], cs = r[2];
      var ultimo = cs.length ? Math.max.apply(null, cs.map(function (c) { return c.fecha; })) : 0;
      var nv = vs.filter(function (v) { return v.fecha > ultimo; });
      var na = abs.filter(function (a) { return a.fecha > ultimo; });
      var ef = nv.filter(function (v) { return v.metodo === 'Efectivo'; }).reduce(function (s, v) { return s + v.total; }, 0);
      var tr = nv.filter(function (v) { return v.metodo === 'Transferencia'; }).reduce(function (s, v) { return s + v.total; }, 0);
      var fi = nv.filter(function (v) { return v.metodo === 'Fiado'; }).reduce(function (s, v) { return s + v.total; }, 0);
      var cob = na.reduce(function (s, a) { return s + a.monto; }, 0);
      el('c-hoy').innerHTML = '<p>Efectivo: <strong>' + money(ef) + '</strong><br>Transferencia: <strong>' + money(tr) + '</strong>' +
        '<br>Fiados nuevos: <strong>' + money(fi) + '</strong><br>Cobros de fiados: <strong>' + money(cob) + '</strong>' +
        '<br>Ventas desde el último cierre: <strong>' + nv.length + '</strong></p>';
      cs.sort(function (a, b) { return b.fecha - a.fecha; });
      el('c-historial').innerHTML = cs.map(function (c) {
        return '<li>' + fmtDate(c.fecha) + ': efectivo ' + money(c.efectivo) + ', transferencia ' + money(c.transferencia) +
          ', fiados ' + money(c.fiados) + ', cobros ' + money(c.cobros) + ' · ' + c.ventas + ' ventas</li>';
      }).join('') || '<li>Sin cierres todavía.</li>';
    });
  }

  openDb().then(function (d) {
    db = d;
    return all(db, 'productos').then(function (ps) {
      if (ps.length === 0) {
        var chain = Promise.resolve();
        SEED.forEach(function (p) { chain = chain.then(function () { return put(db, 'productos', p); }); });
        return chain;
      }
    });
  }).then(function () {
    renderTabs();
    el('v-metodo').onchange = function () {
      el('v-cliente-wrap').style.display = el('v-metodo').value === 'Fiado' ? 'block' : 'none';
      actualizarResumenVenta();
    };
    el('v-producto').onchange = actualizarResumenVenta;
    el('v-cantidad').oninput = actualizarResumenVenta;
    el('v-vender').onclick = function () {
      var pid = Number(el('v-producto').value);
      var cant = parseInt(el('v-cantidad').value, 10);
      var metodo = el('v-metodo').value;
      if (!pid || !cant || cant < 1) { el('v-msg').textContent = 'Revisa el producto y la cantidad.'; return; }
      all(db, 'productos').then(function (ps) {
        var p = ps.find(function (x) { return x.id === pid; });
        if (!p) return;
        if (cant > p.stock) { el('v-msg').textContent = 'BLOQUEADO: no hay stock suficiente. Tienes ' + p.stock + '.'; return; }
        var precio = metodo === 'Transferencia' ? p.precio_transferencia : p.precio_efectivo;
        var total = cant * precio;
        if (metodo === 'Fiado' && !(el('v-cliente').value || '').trim()) {
          el('v-msg').textContent = 'Escribe el nombre del cliente para el fiado.'; return;
        }
        p.stock -= cant;
        put(db, 'productos', p).then(function () {
          var venta = {producto: p.nombre, productoId: p.id, cantidad: cant, precio: precio, total: total, metodo: metodo, fecha: Date.now()};
          return put(db, 'ventas', venta).then(function () {
            if (metodo === 'Fiado') {
              return put(db, 'fiados', {cliente: (el('v-cliente').value || '').trim(), detalle: cant + ' × ' + p.nombre, total: total, fecha: Date.now()});
            }
          });
        }).then(function () {
          el('v-msg').textContent = 'Venta guardada: ' + cant + ' × ' + p.nombre + ' = ' + money(total) + ' (' + metodo + '). Stock ahora: ' + p.stock;
          renderAll();
        });
      });
    };
    el('p-form').onsubmit = function (e) {
      e.preventDefault();
      var v = {nombre: el('p-nombre').value.trim(), categoria: el('p-categoria').value.trim(), unidad: el('p-unidad').value.trim(),
        costo: parseFloat(el('p-costo').value), precio_efectivo: parseFloat(el('p-efectivo').value),
        precio_transferencia: parseFloat(el('p-transferencia').value), stock: parseInt(el('p-stock').value, 10),
        stock_minimo: parseInt(el('p-minimo').value, 10)};
      if (!v.nombre || !v.categoria || isNaN(v.costo) || isNaN(v.precio_efectivo) || isNaN(v.precio_transferencia) || isNaN(v.stock)) {
        el('p-msg').textContent = 'Completa todos los campos con números válidos.'; return;
      }
      if (editId) v.id = editId;
      put(db, 'productos', v).then(function () {
        el('p-msg').textContent = 'Producto guardado: ' + v.nombre;
        editId = null; el('p-form-titulo').textContent = 'Nuevo producto'; el('p-form').reset(); el('p-unidad').value = 'unidad'; el('p-minimo').value = 5;
        renderAll();
      });
    };
    el('p-limpiar').onclick = function () { editId = null; el('p-form-titulo').textContent = 'Nuevo producto'; el('p-form').reset(); el('p-unidad').value = 'unidad'; el('p-minimo').value = 5; };
    el('f-abonar').onclick = function () {
      var fid = Number(el('f-fiado').value);
      var monto = parseFloat(el('f-abono').value);
      if (!fid || isNaN(monto) || monto <= 0) { el('f-msg').textContent = 'Elige el fiado y un monto mayor que 0.'; return; }
      Promise.all([all(db, 'fiados'), all(db, 'abonos')]).then(function (r) {
        var f = r[0].find(function (x) { return x.id === fid; });
        var pagado = r[1].filter(function (a) { return a.fiadoId === fid; }).reduce(function (s, a) { return s + a.monto; }, 0);
        var pend = Math.max(0, f.total - pagado);
        if (monto > pend) { el('f-msg').textContent = 'El abono no puede pasar de lo pendiente: ' + money(pend); return; }
        return put(db, 'abonos', {fiadoId: fid, monto: monto, fecha: Date.now()}).then(function () {
          el('f-msg').textContent = 'Abono guardado: ' + money(monto) + '. Pendiente ahora: ' + money(pend - monto);
          el('f-abono').value = '';
          renderAll();
        });
      });
    };
    el('c-cerrar').onclick = function () {
      Promise.all([all(db, 'ventas'), all(db, 'abonos'), all(db, 'cierres')]).then(function (r) {
        var vs = r[0], abs = r[1], cs = r[2];
        var ultimo = cs.length ? Math.max.apply(null, cs.map(function (c) { return c.fecha; })) : 0;
        var nv = vs.filter(function (v) { return v.fecha > ultimo; });
        var na = abs.filter(function (a) { return a.fecha > ultimo; });
        var cierre = {fecha: Date.now(),
          efectivo: nv.filter(function (v) { return v.metodo === 'Efectivo'; }).reduce(function (s, v) { return s + v.total; }, 0),
          transferencia: nv.filter(function (v) { return v.metodo === 'Transferencia'; }).reduce(function (s, v) { return s + v.total; }, 0),
          fiados: nv.filter(function (v) { return v.metodo === 'Fiado'; }).reduce(function (s, v) { return s + v.total; }, 0),
          cobros: na.reduce(function (s, a) { return s + a.monto; }, 0), ventas: nv.length};
        return put(db, 'cierres', cierre).then(function () {
          el('c-msg').textContent = 'Día cerrado. El historial queda guardado, las ventas no se borran.';
          renderAll();
        });
      });
    };
    el('i-importar').onclick = function () {
      var file = el('i-archivo').files[0];
      if (!file) { el('i-msg').textContent = 'Elige primero un archivo CSV.'; return; }
      var reader = new FileReader();
      reader.onload = function () {
        var lines = String(reader.result).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
        var ok = 0, fail = 0, chain = Promise.resolve();
        lines.forEach(function (line, i) {
          var delim = (line.indexOf(';') >= 0 && line.indexOf(',') < 0) ? ';' : ',';
          var t = line.split(delim).map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
          if (i === 0 && t[0].toLowerCase().indexOf('nombre') >= 0) return;
          if (t.length < 8) { fail++; return; }
          var v = {nombre: t[0], categoria: t[1], unidad: t[2], costo: parseFloat(t[3]), precio_efectivo: parseFloat(t[4]),
            precio_transferencia: parseFloat(t[5]), stock: parseInt(t[6], 10), stock_minimo: parseInt(t[7], 10)};
          if (!v.nombre || isNaN(v.costo) || isNaN(v.precio_efectivo) || isNaN(v.precio_transferencia) || isNaN(v.stock) || isNaN(v.stock_minimo)) { fail++; return; }
          chain = chain.then(function () { return put(db, 'productos', v); }).then(function () { ok++; });
        });
        chain.then(function () {
          el('i-msg').textContent = 'Importación lista: ' + ok + ' productos importados, ' + fail + ' filas con error.';
          renderAll();
        });
      };
      reader.readAsText(file);
    };
    return renderAll();
  }).catch(function (e) {
    document.body.insertAdjacentHTML('beforeend', '<p class="msg">Error al abrir la base de datos local: ' + e + '</p>');
  });
})();
