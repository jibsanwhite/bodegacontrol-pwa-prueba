/* BodegaControl PWA PRUEBA - datos en SQLite (OPFS, en este telefono).
   Sin cuentas, sin nube, sin pagos. Solo productos de ejemplo.
   La capa de datos vive en db.js (openDb/all/put/del con la misma
   firma que tenia IndexedDB); este archivo es solo la interfaz. */
(function () {
  'use strict';
  function money(n) { return '$' + Number(n).toFixed(0) + ' CUP'; }
  function fmtDate(t) { return new Date(t).toLocaleString('es-CU'); }
  var db, editId = null;
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  /* Fase 1: venta por peso/volumen. Base: peso en kg, volumen en L, conteo en unidad. */
  var DIM = {g: 'peso', kg: 'peso', Lb: 'peso', ml: 'volumen', L: 'volumen', unidad: 'cantidad'};
  var FACTOR = {g: 0.001, kg: 1, Lb: 0.453592, ml: 0.001, L: 1, unidad: 1};
  function fmtCant(n, unidad) { var u = unidad || 'unidad'; return (DIM[u] === 'cantidad' ? Math.round(n) : Number(n).toFixed(2)) + ' ' + u; }
  function convertir(cantVenta, unidadVenta, unidadStock) {
    if (unidadVenta === unidadStock) return cantVenta;
    if (DIM[unidadVenta] && DIM[unidadVenta] === DIM[unidadStock]) return cantVenta * FACTOR[unidadVenta] / FACTOR[unidadStock];
    return null;
  }
  function logAuditoria(tipo, detalle) { return put(db, 'auditoria', {tipo: tipo, detalle: detalle, fecha: Date.now()}); }
  function descargar(nombre, contenido, tipo) {
    var blob = new Blob([contenido], {type: tipo || 'text/csv;charset=utf-8'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function csvCelda(v) { var s = String(v == null ? '' : v).replace(/"/g, '""'); return '"' + s + '"'; }

  function renderTabs() {
    document.querySelectorAll('#tabs button[data-tab]').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#tabs button[data-tab]').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        el('tab-' + b.dataset.tab).classList.add('active');
        cerrarMenu();
      };
    });
  }
  function abrirMenu() { el('tabs').classList.add('open'); el('scrim').classList.add('open'); }
  function cerrarMenu() { el('tabs').classList.remove('open'); el('scrim').classList.remove('open'); }

  function renderAll() { return Promise.all([renderProductos(), renderVentas(), renderFiados(), renderCaja(), renderTurnos()]); }

  function renderProductos() {
    return all(db, 'productos').then(function (ps) {
      ps.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
      el('p-lista').innerHTML = ps.map(function (p) {
        var alerta = p.stock <= p.stock_minimo ? ' <span class="alerta">ALERTA: stock bajo</span>' : '';
        return '<li><strong>' + esc(p.nombre) + '</strong> (' + esc(p.categoria) + ')<br>' +
          'Costo ' + money(p.costo) + ' · Efectivo ' + money(p.precio_efectivo) + ' · Transferencia ' + money(p.precio_transferencia) + '<br>' +
          'Stock: ' + p.stock + ' ' + esc(p.unidad) + ' · Mínimo: ' + p.stock_minimo + alerta + '<br>' +
          '<button data-edit="' + p.id + '">Editar</button>' +
          '<button data-merma="' + p.id + '">Merma</button>' +
          '<button data-del="' + p.id + '">Borrar</button></li>';
      }).join('') || '<li>Sin productos.</li>';
      var sel = el('v-producto');
      sel.innerHTML = ps.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + ' (stock ' + p.stock + ')</option>'; }).join('');
      document.querySelectorAll('[data-edit]').forEach(function (b) {
        b.onclick = function () { cargarEdicion(Number(b.dataset.edit)); };
      });
      document.querySelectorAll('[data-merma]').forEach(function (b) {
        b.onclick = function () {
          var id = Number(b.dataset.merma);
          var cant = parseFloat(prompt('¿Cuánta merma? Escribe la cantidad en la unidad del stock:'));
          if (!cant || cant <= 0) return;
          var motivo = prompt('Motivo de la merma (opcional):') || 'Sin motivo';
          all(db, 'productos').then(function (ps) {
            var p = ps.find(function (x) { return x.id === id; });
            if (!p || cant > p.stock) { alert('No hay stock suficiente para esa merma.'); return; }
            p.stock -= cant;
            put(db, 'productos', p).then(function () {
              return logAuditoria('merma', cant + ' ' + p.unidad + ' de ' + p.nombre + ' — ' + motivo);
            }).then(renderAll);
          });
        };
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
      var cant = parseFloat(el('v-cantidad').value) || 0;
      var uv = el('v-unidad-venta').value;
      var metodo = el('v-metodo').value;
      var cantStock = convertir(cant, uv, p.unidad);
      var precio = metodo === 'Transferencia' ? p.precio_transferencia : p.precio_efectivo;
      if (cantStock === null) {
        el('v-resumen').textContent = 'BLOQUEADO: no se puede convertir ' + uv + ' a ' + p.unidad + '. Vende en la unidad del stock.';
        return;
      }
      if (uv === 'unidad' && cant % 1 !== 0) { el('v-resumen').textContent = 'Para vender por unidad la cantidad debe ser entera.'; return; }
      el('v-resumen').textContent = p.nombre + ': ' + fmtCant(cant, uv) + ' (= ' + fmtCant(cantStock, p.unidad) + ' de stock) × ' + money(precio) + ' = ' + money(cantStock * precio) +
        (metodo === 'Fiado' ? ' (fiado, se descuenta el stock al crear)' : '') +
        (cantStock > p.stock ? ' — BLOQUEADO: no hay stock suficiente (tienes ' + fmtCant(p.stock, p.unidad) + ')' : '');
    });
  }
  function renderVentas() {
    return Promise.all([all(db, 'ventas'), listTurnosDia(db), listDependientes(db)]).then(function (r) {
      var vs = r[0], turnos = r[1], deps = r[2];
      var mapaTurno = {};
      turnos.forEach(function (t) { mapaTurno[t.id] = t; });
      var mapaDep = {};
      deps.forEach(function (d) { mapaDep[d.id] = d; });
      vs.sort(function (a, b) { return b.fecha - a.fecha; });
      el('v-ventas').innerHTML = vs.slice(0, 20).map(function (v) {
        var cantTxt = v.cantidadVenta != null ? fmtCant(v.cantidadVenta, v.unidadVenta) : v.cantidad;
        var turnoTxt = '';
        if (v.turnoId) {
          var t = mapaTurno[v.turnoId];
          turnoTxt = ' · Turno #' + v.turnoId + (t ? ' · ' + esc(t.dependiente) : '');
        } else {
          turnoTxt = ' · Sin turno';
        }
        return '<li>' + esc(v.producto) + ' · ' + cantTxt + ' × ' + money(v.precio) + ' = ' + money(v.total) +
          ' · ' + esc(v.metodo) + turnoTxt + (v.anulada ? ' · <strong>ANULADA</strong>' : '') + ' · ' + fmtDate(v.fecha) +
          (v.anulada ? '' : ' <button data-anular="' + v.id + '">Anular venta</button>') + '</li>';
      }).join('') || '<li>Sin ventas todavía.</li>';
      document.querySelectorAll('[data-anular]').forEach(function (b) {
        b.onclick = function () { anularVenta(Number(b.dataset.anular)); };
      });
    });
  }
  function renderFiados() {
    return Promise.all([all(db, 'fiados'), all(db, 'abonos')]).then(function (r) {
      var fs = r[0], abs = r[1];
      var total = 0;
      fs = fs.filter(function (f) { return !f.anulada; });
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
  function ventasVigentes(vs) { return vs.filter(function (v) { return !v.anulada; }); }
  function anularVenta(id) {
    if (!confirm('¿Anular esta venta? El stock se devuelve y queda registrada en auditoría.')) return;
    Promise.all([all(db, 'ventas'), all(db, 'productos'), all(db, 'fiados'), all(db, 'abonos')]).then(function (r) {
      var v = r[0].find(function (x) { return x.id === id; });
      if (!v || v.anulada) return;
      if (v.metodo === 'Fiado') {
        var f = v.fiadoId ? r[2].find(function (x) { return x.id === v.fiadoId; }) : r[2].find(function (x) { return x.detalle === (v.cantidadVenta != null ? fmtCant(v.cantidadVenta, v.unidadVenta) : v.cantidad) + ' × ' + v.producto && x.total === v.total; });
        var pagado = f ? r[3].filter(function (a) { return a.fiadoId === f.id; }).reduce(function (s, a) { return s + a.monto; }, 0) : 0;
        if (pagado > 0) { alert('No se puede anular: ese fiado ya tiene abonos por ' + money(pagado) + '.'); return; }
        if (f) { f.anulada = true; put(db, 'fiados', f); }
      }
      var p = r[1].find(function (x) { return x.id === v.productoId; });
      var chain = Promise.resolve();
      if (p) { p.stock += (v.cantidadStock != null ? v.cantidadStock : v.cantidad); chain = chain.then(function () { return put(db, 'productos', p); }); }
      v.anulada = true;
      return chain.then(function () { return put(db, 'ventas', v); })
        .then(function () { return logAuditoria('venta anulada', v.producto + ' · ' + money(v.total) + ' (' + v.metodo + ')'); })
        .then(renderAll);
    });
  }
  var DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
  function renderDenominaciones() {
    el('c-denominaciones').innerHTML = DENOMS.map(function (d) {
      return '<div class="field"><label>' + d + ' CUP × </label><input class="denom" data-denom="' + d + '" type="number" min="0" step="1" value="0"></div>';
    }).join('');
    document.querySelectorAll('.denom').forEach(function (inp) { inp.oninput = actualizarConteo; });
    actualizarConteo();
  }
  function totalConteo() {
    var t = 0;
    document.querySelectorAll('.denom').forEach(function (inp) { t += (parseInt(inp.value, 10) || 0) * Number(inp.dataset.denom); });
    return t;
  }
  function actualizarConteo() {
    if (!window.__cajaViva) { el('c-conteo').textContent = ''; return; }
    var cont = totalConteo();
    var dif = cont - window.__cajaViva.efectivoDisponible;
    el('c-conteo').textContent = 'Contado: ' + money(cont) + ' · Debería haber: ' + money(window.__cajaViva.efectivoDisponible) +
      ' · Diferencia: ' + money(dif) + (dif === 0 ? ' (cuadra)' : dif > 0 ? ' (sobra)' : ' (falta)');
  }
  function renderCaja() {
    return Promise.all([all(db, 'ventas'), all(db, 'abonos'), all(db, 'cierres'), all(db, 'recogidas')]).then(function (r) {
      var vs = ventasVigentes(r[0]), abs = r[1], cs = r[2], recs = r[3] || [];
      var ultimo = cs.length ? Math.max.apply(null, cs.map(function (c) { return c.fecha; })) : 0;
      var nv = vs.filter(function (v) { return v.fecha > ultimo; });
      var na = abs.filter(function (a) { return a.fecha > ultimo; });
      var nr = recs.filter(function (x) { return x.fecha > ultimo; });
      var ef = nv.filter(function (v) { return v.metodo === 'Efectivo'; }).reduce(function (s, v) { return s + v.total; }, 0);
      var tr = nv.filter(function (v) { return v.metodo === 'Transferencia'; }).reduce(function (s, v) { return s + v.total; }, 0);
      var fi = nv.filter(function (v) { return v.metodo === 'Fiado'; }).reduce(function (s, v) { return s + v.total; }, 0);
      var cob = na.reduce(function (s, a) { return s + a.monto; }, 0);
      var rec = nr.reduce(function (s, x) { return s + x.monto; }, 0);
      var disp = ef + cob - rec;
      window.__cajaViva = {efectivoDisponible: disp};
      el('c-hoy').innerHTML = '<p><strong>CAJA EN VIVO (desde el último cierre)</strong><br>Efectivo en ventas: <strong>' + money(ef) + '</strong>' +
        '<br>Transferencia: <strong>' + money(tr) + '</strong>' +
        '<br>Fiados nuevos: <strong>' + money(fi) + '</strong><br>Cobros de fiados: <strong>' + money(cob) + '</strong>' +
        '<br>Recogidas: <strong>' + money(rec) + '</strong>' +
        '<br>Efectivo disponible en caja: <strong>' + money(disp) + '</strong>' +
        '<br>Ventas desde el último cierre: <strong>' + nv.length + '</strong></p>';
      cs.sort(function (a, b) { return b.fecha - a.fecha; });
      el('c-historial').innerHTML = cs.map(function (c) {
        return '<li>' + fmtDate(c.fecha) + ': efectivo ' + money(c.efectivo) + ', transferencia ' + money(c.transferencia) +
          ', fiados ' + money(c.fiados) + ', cobros ' + money(c.cobros) +
          (c.recogidas ? ', recogidas ' + money(c.recogidas) : '') +
          (c.conteo != null ? ', contado ' + money(c.conteo) + ', diferencia ' + money(c.diferencia) : '') +
          ' · ' + c.ventas + ' ventas</li>';
      }).join('') || '<li>Sin cierres todavía.</li>';
      actualizarConteo();
    });
  }

  /* ---------------- Fase 2: turnos y dependientes ---------------- */
  var depsCache = {};
  var turnoCerrando = null;
  function actualizarSelectorDependiente(rend) {
    var conTurno = (rend || []).filter(function (d) { return d.turnoAbierto; });
    var sel = el('v-dependiente');
    if (!conTurno.length) {
      sel.innerHTML = '<option value="">— Sin turnos abiertos —</option>';
      el('v-turno-msg').innerHTML = 'Nadie tiene turno abierto: ninguna venta puede registrarse. <button id="v-ir-turnos" type="button">Abrir turno</button>';
      el('v-ir-turnos').onclick = function () { document.querySelector('[data-tab="turnos"]').click(); };
      el('v-vender').disabled = true;
      return;
    }
    sel.innerHTML = conTurno.map(function (d) { return '<option value="' + d.id + '">' + esc(d.nombre) + ' — Turno #' + d.turnoAbierto + ' abierto</option>'; }).join('');
    el('v-turno-msg').textContent = '';
    el('v-vender').disabled = false;
  }
  function renderTurnos() {
    return Promise.all([estadisticasDia(db), listTurnosDia(db), rendimientoDependientes(db), listDependientes(db)]).then(function (r) {
      var est = r[0], turnos = r[1], rend = r[2], deps = r[3];
      deps.forEach(function (d) { depsCache[d.id] = d; });
      el('t-stats').innerHTML =
        '<div class="stat"><label>Turnos abiertos ahora</label><strong>' + est.abiertos + '</strong><span>' + (est.abiertos ? 'vendiendo' : 'Nadie vendiendo') + '</span></div>' +
        '<div class="stat"><label>Turnos cerrados hoy</label><strong>' + est.cerrados + '</strong><span>Con cierre y conteo registrado</span></div>' +
        '<div class="stat"><label>Ventas de hoy</label><strong>' + money(est.ventasHoy) + '</strong><span>' + est.nVentasHoy + ' operaciones registradas</span></div>' +
        '<div class="stat"><label>Fiado de hoy</label><strong>' + money(est.fiadoHoy) + '</strong><span>Queda fuera del conteo de caja</span></div>';
      var bt = el('badge-turnos');
      if (bt) { bt.textContent = est.abiertos ? String(est.abiertos) : ''; bt.style.display = est.abiertos ? 'inline-block' : 'none'; }
      var sinTurno = deps.filter(function (d) {
        return d.activo && !rend.some(function (x) { return x.id === d.id && x.turnoAbierto; });
      });
      el('t-abrir-dep').innerHTML = sinTurno.map(function (d) { return '<option value="' + d.id + '">' + esc(d.nombre) + (d.rol ? ' — ' + esc(d.rol) : '') + '</option>'; }).join('') || '<option value="">— Nadie disponible —</option>';
      var resums = turnos.map(function (t) { return turnoResumen(db, t.id); });
      return Promise.all(resums).then(function (res) {
        var mapa = {};
        res.forEach(function (x) { mapa[x.turnoId] = x; });
        el('t-lista').innerHTML = turnos.map(function (t) {
          var s = mapa[t.id];
          var abierto = t.estado === 'abierto';
          var linea = '<div class="turno' + (abierto ? ' activo' : '') + '"><strong>' + esc(t.dependiente) + ' · Turno #' + t.id + '</strong> ' +
            '<span class="badge-turno ' + (abierto ? 'abierto' : 'cerrado') + '">' + (abierto ? '● Abierto' : 'Cerrado') + '</span><br>' +
            'Apertura: ' + fmtDate(t.hora_apertura) + (abierto ? '' : ' · Cerró: ' + fmtDate(t.hora_cierre)) + '<br>' +
            'Fondo: ' + money(t.fondo_inicial) + ' · Ventas: ' + money(s.total) + ' (' + s.nVentas + ') · Efectivo: ' + money(s.efectivo) +
            ' · Transferencia: ' + money(s.transferencia) + ' · Fiado: ' + money(s.fiado) + '<br>' +
            'Recogidas: ' + money(s.recogidas) + ' · Efectivo esperado: <strong>' + money(s.esperado) + '</strong><br>';
          if (abierto) {
            linea += '<div class="field"><label>Recogida parcial (CUP)</label><input type="number" min="0" step="0.01" data-rec-monto="' + t.id + '" placeholder="Ej: 10000"></div>' +
              '<div class="field"><label>Nota (opcional)</label><input data-rec-nota="' + t.id + '" placeholder="Ej: Pago a proveedor"></div>' +
              '<button data-rec="' + t.id + '">Registrar recogida</button> ' +
              '<button data-cerrar-turno="' + t.id + '">Cerrar este turno</button>';
          } else {
            var dif = t.diferencia || 0;
            linea += 'Contó ' + money(t.contado != null ? t.contado : 0) + ' · Diferencia: ' +
              (dif === 0 ? '<span class="diff-ok">$0 — cuadra</span>' : '<span class="diff-bad">' + money(dif) + '</span>') +
              ' · ' + s.nVentas + ' ventas';
          }
          return linea + '</div>';
        }).join('') || '<p class="hint">No hay turnos hoy todavía.</p>';
        document.querySelectorAll('[data-rec]').forEach(function (b) {
          b.onclick = function () { registrarRecogida(Number(b.dataset.rec)); };
        });
        document.querySelectorAll('[data-cerrar-turno]').forEach(function (b) {
          b.onclick = function () { mostrarPanelCierre(Number(b.dataset.cerrarTurno)); };
        });
        var max = Math.max.apply(null, rend.map(function (d) { return d.total; }).concat([1]));
        el('t-deps').innerHTML = rend.map(function (d) {
          var pct = Math.round(d.total / max * 100);
          return '<li><strong>' + esc(d.nombre) + '</strong>' + (d.rol ? ' · ' + esc(d.rol) : '') + (d.activo ? '' : ' · <span class="alerta">DESACTIVADO</span>') +
            '<br>Total vendido hoy: <strong>' + money(d.total) + '</strong> · ' + d.nVentas + ' ventas' +
            '<br>' + (d.turnoAbierto ? 'Turno #' + d.turnoAbierto + ' abierto' : 'Sin turno abierto') +
            '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
            (d.activo ? (d.turnoAbierto ? '' : ' <button data-desactivar="' + d.id + '">Desactivar</button>') : ' <button data-reactivar="' + d.id + '">Reactivar</button>') + '</li>';
        }).join('') || '<li>Sin dependientes.</li>';
        document.querySelectorAll('[data-desactivar]').forEach(function (b) {
          b.onclick = function () {
            var id = Number(b.dataset.desactivar);
            desactivarDependiente(db, id).then(renderAll).catch(function (e) { alert(e.message); });
          };
        });
        document.querySelectorAll('[data-reactivar]').forEach(function (b) {
          b.onclick = function () { reactivarDependiente(db, Number(b.dataset.reactivar)).then(renderAll); };
        });
        actualizarSelectorDependiente(rend);
      });
    });
  }
  function registrarRecogida(turnoId) {
    var monto = parseFloat(document.querySelector('[data-rec-monto="' + turnoId + '"]').value);
    var nota = (document.querySelector('[data-rec-nota="' + turnoId + '"]').value || '').trim();
    if (isNaN(monto) || monto <= 0) { alert('Escribe un monto mayor que 0.'); return; }
    turnoResumen(db, turnoId).then(function (res) {
      if (monto > res.esperado) { alert('No puedes recoger más que el efectivo esperado: ' + money(res.esperado)); return; }
      return registrarRecogidaTurno(db, turnoId, monto, nota).then(function () {
        /* La recogida saca efectivo de la misma caja fisica: tambien queda
           en la Caja del dia para que el conteo de caja cuadre. */
        return put(db, 'recogidas', {monto: monto, nota: (nota ? 'Turno #' + turnoId + ' — ' + nota : 'Turno #' + turnoId), fecha: Date.now()});
      }).then(function () {
        return logAuditoria('recogida turno', 'Turno #' + turnoId + ': ' + money(monto) + (nota ? ' — ' + nota : ''));
      }).then(renderAll);
    });
  }
  function mostrarPanelCierre(turnoId) {
    turnoCerrando = turnoId;
    Promise.all([turnoResumen(db, turnoId), listTurnosDia(db)]).then(function (r) {
      var res = r[0];
      var t = r[1].find(function (x) { return x.id === turnoId; });
      el('t-cerrar-titulo').textContent = 'Cerrar turno #' + turnoId + (t ? ' · ' + t.dependiente : '');
      el('t-cerrar-detalle').textContent = 'Fondo ' + money(res.fondo) + ' + efectivo ' + money(res.efectivo) + ' − recogidas ' + money(res.recogidas) + '. Transferencia ' + money(res.transferencia) + ' y fiado ' + money(res.fiado) + ' no entran en el conteo de caja.';
      el('t-cerrar-esperado').textContent = money(res.esperado);
      el('t-cerrar-contado').value = '';
      el('t-cerrar-dif').textContent = '';
      el('t-cerrar-msg').textContent = '';
      el('t-cerrar-panel').style.display = 'block';
      el('t-cerrar-panel').scrollIntoView({behavior: 'smooth', block: 'nearest'});
    });
  }
  function actualizarDifCierre() {
    var v = parseFloat(el('t-cerrar-contado').value);
    if (isNaN(v) || turnoCerrando == null) { el('t-cerrar-dif').textContent = ''; return; }
    turnoResumen(db, turnoCerrando).then(function (res) {
      var dif = Math.round((v - res.esperado) * 100) / 100;
      el('t-cerrar-dif').innerHTML = dif === 0 ? '<span class="diff-ok">Diferencia $0 — el turno cuadra ✓</span>' :
        'Diferencia: <span class="diff-bad">' + money(dif) + '</span> ' + (dif > 0 ? '(sobra efectivo)' : '(falta efectivo)');
    });
  }

  /* La capa de datos vive en db.js (SQLite en OPFS): openDb() migra los
     datos viejos de IndexedDB una sola vez y siembra los productos de
     ejemplo si la base esta vacia. */
  openDb().then(function (d) {
    db = d;
  }).then(function () {
    renderTabs();
    el('btn-menu').onclick = function () { abrirMenu(); };
    el('btn-cerrar-menu').onclick = function () { cerrarMenu(); };
    el('scrim').onclick = function () { cerrarMenu(); };
    renderDenominaciones();
    el('v-unidad-venta').onchange = actualizarResumenVenta;
    el('v-metodo').onchange = function () {
      el('v-cliente-wrap').style.display = el('v-metodo').value === 'Fiado' ? 'block' : 'none';
      actualizarResumenVenta();
    };
    el('v-producto').onchange = actualizarResumenVenta;
    el('v-cantidad').oninput = actualizarResumenVenta;
    el('v-vender').onclick = function () {
      var depId = Number(el('v-dependiente').value);
      var pid = Number(el('v-producto').value);
      var cantVenta = parseFloat(el('v-cantidad').value);
      var uv = el('v-unidad-venta').value;
      var metodo = el('v-metodo').value;
      if (!depId) { el('v-msg').textContent = 'Nadie tiene turno abierto: abre un turno primero para poder vender.'; return; }
      if (!pid || !cantVenta || cantVenta <= 0) { el('v-msg').textContent = 'Revisa el producto y la cantidad.'; return; }
      if (uv === 'unidad' && cantVenta % 1 !== 0) { el('v-msg').textContent = 'Para vender por unidad la cantidad debe ser entera.'; return; }
      turnoAbiertoDe(db, depId).then(function (t) {
        if (!t) { el('v-msg').textContent = 'Ese dependiente no tiene turno abierto. Abre su turno primero — así ninguna venta queda sin dueño.'; return; }
        return all(db, 'productos').then(function (ps) {
          var p = ps.find(function (x) { return x.id === pid; });
          if (!p) return;
          var cantStock = convertir(cantVenta, uv, p.unidad);
          if (cantStock === null) { el('v-msg').textContent = 'BLOQUEADO: no se puede convertir ' + uv + ' a ' + p.unidad + '.'; return; }
          if (cantStock > p.stock) { el('v-msg').textContent = 'BLOQUEADO: no hay stock suficiente. Tienes ' + fmtCant(p.stock, p.unidad) + '.'; return; }
          var precio = metodo === 'Transferencia' ? p.precio_transferencia : p.precio_efectivo;
          var total = Math.round(cantStock * precio * 100) / 100;
          if (metodo === 'Fiado' && !(el('v-cliente').value || '').trim()) {
            el('v-msg').textContent = 'Escribe el nombre del cliente para el fiado.'; return;
          }
          p.stock = Math.round((p.stock - cantStock) * 1000000) / 1000000;
          var depNombre = depsCache[depId] ? depsCache[depId].nombre : 'Dependiente';
          return put(db, 'productos', p).then(function () {
            var venta = {producto: p.nombre, productoId: p.id, cantidad: cantStock, cantidadVenta: cantVenta, unidadVenta: uv,
              precio: precio, costo: p.costo, total: total, metodo: metodo, fecha: Date.now(), anulada: false, turnoId: t.id};
            return put(db, 'ventas', venta).then(function (vid) {
              if (metodo === 'Fiado') {
                return put(db, 'fiados', {cliente: (el('v-cliente').value || '').trim(), detalle: fmtCant(cantVenta, uv) + ' × ' + p.nombre, total: total, fecha: Date.now(), turnoId: t.id}).then(function (fid) {
                  venta.id = vid; venta.fiadoId = fid; return put(db, 'ventas', venta);
                });
              }
            });
          }).then(function () {
            el('v-msg').textContent = 'Venta guardada: ' + fmtCant(cantVenta, uv) + ' × ' + p.nombre + ' = ' + money(total) + ' (' + metodo + ') · Turno #' + t.id + ' · ' + depNombre + '. Stock ahora: ' + fmtCant(p.stock, p.unidad);
            renderAll();
          });
        });
      });
    };
    /* Fase 2: turnos */
    el('t-abrir').onclick = function () {
      var depId = Number(el('t-abrir-dep').value);
      var fondo = parseFloat(el('t-abrir-fondo').value);
      if (!depId) { el('t-abrir-msg').textContent = 'Elige un dependiente sin turno abierto.'; return; }
      if (isNaN(fondo) || fondo < 0) { el('t-abrir-msg').textContent = 'El fondo inicial no puede ser negativo.'; return; }
      abrirTurno(db, depId, fondo).then(function (tid) {
        return logAuditoria('turno abierto', 'Turno #' + tid + ' con fondo ' + money(fondo));
      }).then(function () {
        el('t-abrir-msg').textContent = 'Turno abierto. Desde ahora, las ventas de ese dependiente quedan a su nombre.';
        renderAll();
      }).catch(function (e) { el('t-abrir-msg').textContent = 'No se pudo abrir el turno: ' + e.message; });
    };
    el('t-dep-anadir').onclick = function () {
      var nombre = (el('t-dep-nombre').value || '').trim();
      var rol = (el('t-dep-rol').value || '').trim();
      if (!nombre) { el('t-dep-msg').textContent = 'Escribe el nombre del dependiente.'; return; }
      crearDependiente(db, nombre, rol).then(function () {
        el('t-dep-msg').textContent = 'Dependiente añadido: ' + nombre;
        el('t-dep-nombre').value = ''; el('t-dep-rol').value = '';
        renderAll();
      });
    };
    el('t-cerrar-contado').oninput = actualizarDifCierre;
    el('t-cerrar-confirmar').onclick = function () {
      var contado = parseFloat(el('t-cerrar-contado').value);
      if (isNaN(contado) || turnoCerrando == null) { el('t-cerrar-msg').textContent = 'Escribe cuánto contó el dependiente para poder cerrar.'; return; }
      cerrarTurno(db, turnoCerrando, contado).then(function (res) {
        var msgCierre = res.diferencia === 0 ?
          'Turno #' + res.turnoId + ' cerrado y cuadrado: contó ' + money(res.contado) + ', igual al esperado.' :
          'Turno #' + res.turnoId + ' cerrado con diferencia de ' + money(res.diferencia) + ': contó ' + money(res.contado) + ' frente a ' + money(res.esperado) + ' esperado.';
        el('t-cerrar-msg').textContent = msgCierre;
        /* El panel de cierre se oculta, asi que el resultado tiene que
           verse tambien en el mensaje de "Abrir turno" (si no, queda el
           "Turno abierto..." viejo y parece que sigue abierto). */
        el('t-abrir-msg').textContent = msgCierre;
        turnoCerrando = null;
        el('t-cerrar-panel').style.display = 'none';
        renderAll();
      }).catch(function (e) { el('t-cerrar-msg').textContent = 'No se pudo cerrar: ' + e.message; });
    };
    el('t-cerrar-cancelar').onclick = function () { turnoCerrando = null; el('t-cerrar-panel').style.display = 'none'; };
    el('p-form').onsubmit = function (e) {
      e.preventDefault();
      var v = {nombre: el('p-nombre').value.trim(), categoria: el('p-categoria').value.trim(), unidad: el('p-unidad').value.trim(),
        costo: parseFloat(el('p-costo').value), precio_efectivo: parseFloat(el('p-efectivo').value),
        precio_transferencia: parseFloat(el('p-transferencia').value), stock: parseFloat(el('p-stock').value),
        stock_minimo: parseInt(el('p-minimo').value, 10)};
      if (!v.nombre || !v.categoria || isNaN(v.costo) || isNaN(v.precio_efectivo) || isNaN(v.precio_transferencia) || isNaN(v.stock)) {
        el('p-msg').textContent = 'Completa todos los campos con números válidos.'; return;
      }
      var editando = editId;
      if (editando) v.id = editando;
      var auditoriaPrecio = null;
      if (editando) {
        auditoriaPrecio = all(db, 'productos').then(function (ps) {
          var viejo = ps.find(function (x) { return x.id === editando; });
          if (viejo && (viejo.precio_efectivo !== v.precio_efectivo || viejo.precio_transferencia !== v.precio_transferencia)) {
            return logAuditoria('cambio de precio', viejo.nombre + ': efectivo ' + money(viejo.precio_efectivo) + ' → ' + money(v.precio_efectivo) +
              ', transferencia ' + money(viejo.precio_transferencia) + ' → ' + money(v.precio_transferencia));
          }
        });
      }
      Promise.resolve(auditoriaPrecio).then(function () { return put(db, 'productos', v); }).then(function () {
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
    el('c-recoger').onclick = function () {
      var monto = parseFloat(el('c-recogida').value);
      if (isNaN(monto) || monto <= 0) { el('c-recogida-msg').textContent = 'Escribe un monto mayor que 0.'; return; }
      var disp = window.__cajaViva ? window.__cajaViva.efectivoDisponible : 0;
      if (monto > disp) { el('c-recogida-msg').textContent = 'No puedes recoger más que el efectivo disponible: ' + money(disp); return; }
      put(db, 'recogidas', {monto: monto, nota: (el('c-recogida-nota').value || '').trim(), fecha: Date.now()}).then(function () {
        return logAuditoria('recogida', money(monto) + (el('c-recogida-nota').value ? ' — ' + el('c-recogida-nota').value : ''));
      }).then(function () {
        el('c-recogida-msg').textContent = 'Recogida guardada: ' + money(monto) + '. No borra ventas, queda en auditoría.';
        el('c-recogida').value = ''; el('c-recogida-nota').value = '';
        renderAll();
      });
    };
    el('c-cerrar').onclick = function () {
      Promise.all([all(db, 'ventas'), all(db, 'abonos'), all(db, 'cierres'), all(db, 'recogidas')]).then(function (r) {
        var vs = ventasVigentes(r[0]), abs = r[1], cs = r[2], recs = r[3] || [];
        var ultimo = cs.length ? Math.max.apply(null, cs.map(function (c) { return c.fecha; })) : 0;
        var nv = vs.filter(function (v) { return v.fecha > ultimo; });
        var na = abs.filter(function (a) { return a.fecha > ultimo; });
        var nr = recs.filter(function (x) { return x.fecha > ultimo; });
        var ef = nv.filter(function (v) { return v.metodo === 'Efectivo'; }).reduce(function (s, v) { return s + v.total; }, 0);
        var cont = totalConteo();
        var cierre = {fecha: Date.now(),
          efectivo: ef,
          transferencia: nv.filter(function (v) { return v.metodo === 'Transferencia'; }).reduce(function (s, v) { return s + v.total; }, 0),
          fiados: nv.filter(function (v) { return v.metodo === 'Fiado'; }).reduce(function (s, v) { return s + v.total; }, 0),
          cobros: na.reduce(function (s, a) { return s + a.monto; }, 0),
          recogidas: nr.reduce(function (s, x) { return s + x.monto; }, 0),
          conteo: cont, diferencia: cont - (ef + na.reduce(function (s, a) { return s + a.monto; }, 0) - nr.reduce(function (s, x) { return s + x.monto; }, 0)),
          ventas: nv.length};
        return put(db, 'cierres', cierre).then(function () {
          return logAuditoria('cierre de día', 'efectivo ' + money(cierre.efectivo) + ', contado ' + money(cont) + ', diferencia ' + money(cierre.diferencia));
        }).then(function () {
          el('c-msg').textContent = 'Día cerrado. Contado ' + money(cont) + ', diferencia ' + money(cierre.diferencia) + '. El historial queda guardado, las ventas no se borran.';
          document.querySelectorAll('.denom').forEach(function (inp) { inp.value = 0; });
          renderAll();
        });
      });
    };
    function reporteDatos() {
      var per = el('r-periodo').value;
      var ahora = new Date();
      var desde = 0;
      if (per === 'hoy') { desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime(); }
      if (per === 'mes') { desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime(); }
      return Promise.all([all(db, 'ventas'), all(db, 'abonos'), all(db, 'recogidas'), all(db, 'cierres'), all(db, 'fiados')]).then(function (r) {
        var vs = r[0].filter(function (v) { return v.fecha >= desde; });
        var vig = ventasVigentes(vs);
        var tot = vig.reduce(function (s, v) { return s + v.total; }, 0);
        var costo = vig.reduce(function (s, v) { return s + (v.costo != null ? v.costo * (v.cantidadStock != null ? v.cantidadStock : v.cantidad) : 0); }, 0);
        return {vs: vs, vig: vig, abonos: r[1].filter(function (a) { return a.fecha >= desde; }), recs: r[2].filter(function (x) { return x.fecha >= desde; }),
          total: tot, costo: costo, utilidad: tot - costo,
          anuladas: vs.filter(function (v) { return v.anulada; }).length};
      });
    }
    function reporteCSV(d) {
      var out = ['Reporte BodegaControl PRUEBA,Periodo,' + el('r-periodo').value];
      out.push(['Fecha', 'Producto', 'Cantidad', 'Unidad venta', 'Precio', 'Total', 'Método', 'Estado'].map(csvCelda).join(','));
      d.vs.sort(function (a, b) { return a.fecha - b.fecha; }).forEach(function (v) {
        out.push([fmtDate(v.fecha), v.producto, v.cantidadVenta != null ? v.cantidadVenta : v.cantidad, v.unidadVenta || '', v.precio, v.total, v.metodo, v.anulada ? 'ANULADA' : 'Vigente'].map(csvCelda).join(','));
      });
      out.push(['', '', '', '', '', '', 'TOTAL VENTAS VIGENTES', d.total].map(csvCelda).join(','));
      out.push(['', '', '', '', '', '', 'COSTO (solo ventas nuevas)', d.costo].map(csvCelda).join(','));
      out.push(['', '', '', '', '', '', 'UTILIDAD ESTIMADA', d.utilidad].map(csvCelda).join(','));
      out.push(['', '', '', '', '', '', 'VENTAS ANULADAS', d.anuladas].map(csvCelda).join(','));
      return out.join('\n');
    }
    el('r-csv').onclick = function () {
      reporteDatos().then(function (d) {
        descargar('reporte-bodegacontrol-' + el('r-periodo').value + '.csv', reporteCSV(d));
        el('r-msg').textContent = 'Reporte descargado: ' + d.vig.length + ' ventas vigentes, total ' + money(d.total) + ', utilidad estimada ' + money(d.utilidad) + '.';
        el('r-resumen').innerHTML = '<p>Total: <strong>' + money(d.total) + '</strong> · Costo: ' + money(d.costo) + ' · Utilidad estimada: <strong>' + money(d.utilidad) + '</strong> · Anuladas: ' + d.anuladas + '</p>';
      });
    };
    el('r-imprimir').onclick = function () {
      reporteDatos().then(function (d) {
        var w = window.open('', '_blank');
        var filas = d.vs.sort(function (a, b) { return a.fecha - b.fecha; }).map(function (v) {
          return '<tr><td>' + esc(fmtDate(v.fecha)) + '</td><td>' + esc(v.producto) + '</td><td>' + (v.cantidadVenta != null ? v.cantidadVenta : v.cantidad) + '</td><td>' + money(v.total) + '</td><td>' + esc(v.metodo) + '</td><td>' + (v.anulada ? 'ANULADA' : '') + '</td></tr>';
        }).join('');
        w.document.write('<html><head><title>Reporte BodegaControl</title></head><body><h1>Reporte BodegaControl PRUEBA — ' + esc(el('r-periodo').value) + '</h1>' +
          '<table border="1" cellpadding="6"><tr><th>Fecha</th><th>Producto</th><th>Cantidad</th><th>Total</th><th>Método</th><th>Estado</th></tr>' + filas + '</table>' +
          '<p>Total ventas vigentes: ' + money(d.total) + ' · Utilidad estimada: ' + money(d.utilidad) + ' · Anuladas: ' + d.anuladas + '</p>' +
          '<p>Imprime esta página o guárdala como PDF desde el diálogo de impresión.</p></body></html>');
        w.document.close(); w.print();
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
            precio_transferencia: parseFloat(t[5]), stock: parseFloat(t[6]), stock_minimo: parseInt(t[7], 10)};
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
