/* ============================================================================
   BodegaControl PWA — puente del asistente (motor local + endpoint IA).
   - Configura el chat: título, preguntas rápidas y endpoint del backend.
   - Construye el snapshot que espera AsistenteMotor desde la SQLite local
     (window.construirSnapshotAsistente -> Promise). Se construye en cada
     pregunta, así los números siempre son los de la base en ese momento.
   - Endpoint (doPost de Asistente.gs): se guarda en localStorage con la
     clave 'bc_asistente_endpoint'. Vacío = sin servidor: el asistente
     responde solo con el motor local. La PWA NUNCA lleva clave API: la
     clave de Gemini vive solo en el servidor (Propiedades del proyecto).
   MAPEO a la forma del snapshot (build_snapshot.py de Alo Rico Rico):
   - catálogo: products (nombre, categoría, unidad, precios, stock, costo;
     disponible = stock > 0).
   - ventasHoy: sales de hoy (vigentes, sin anular). El método 'Fiado' de
     la PWA se traduce a 'Crédito', que es lo que entiende el motor.
     El cliente de una venta a fiado se busca por su fiadoId; las ventas
     en efectivo/transferencia no guardan cliente en la PWA.
   - gastosHoy: tabla expenses (la PWA no tiene pantalla de gastos, así
     que hoy es 0 salvo que se registre un gasto por otro camino).
   - fondo: como la pestaña Caja de la propia PWA ("CAJA EN VIVO"): desde
     el último cierre diario — efectivo = ventas en efectivo + cobros de
     fiados - recogidas; tarjeta = ventas por transferencia desde el
     último cierre. La PWA no lleva un fondo acumulado entre días como
     Alo Rico Rico; esto es el dinero que hay en caja ahora mismo.
   - deudas: credit_sales sin pagar ni anular, menos los abonos
     (debt_payments), agrupadas por cliente.
   - totales / topUtilidad / ventasPorDia / capitalParado / ventasLentas /
     mesActual: calculados de sales + products (ganancia = total - costo x
     cantidad; parado = con stock y sin ventas en 30 días; lento = menos
     de 0.5 u/día en 30 días).
   ========================================================================== */
(function () {
'use strict';

/* Configuración del negocio. El endpoint lo pone el dueño (o la versión
   de pago al configurarla): es la URL /exec del despliegue web de Apps
   Script que contiene Asistente.gs. Sin endpoint no hay servidor. */
window.ASISTENTE_TITULO = 'Asistente de BodegaControl';
window.ASISTENTE_PREGUNTAS = ['¿Cuánto vendí hoy?', '¿Cuánto hay en caja?', '¿Quién me debe?',
  '¿Qué se agotó?', '¿Puedo cerrar el día?'];
try {
  window.ASISTENTE_ENDPOINT = localStorage.getItem('bc_asistente_endpoint') || '';
} catch (e) {
  window.ASISTENTE_ENDPOINT = '';
}

function isoDeFecha(ts) {
  var d = new Date(ts || Date.now());
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function dmyDeISO(iso) {
  var p = (iso || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}
function horaAhora() {
  var d = new Date();
  var h = d.getHours(), m = d.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}
function redondear(n) { return Math.round((+n || 0) * 100) / 100; }

/* app.js guarda el handle abierto en window.__bcDbHandle al abrir la base.
   Se espera hasta 10 s (la base puede estar migrando o sembrando). */
function esperarDb() {
  return new Promise(function (ok, bad) {
    var intentos = 0;
    (function paso() {
      if (window.__bcDbHandle) return ok(window.__bcDbHandle);
      if (++intentos > 50) return bad(new Error('La base de datos no está abierta todavía.'));
      setTimeout(paso, 200);
    })();
  });
}

function construirSnapshot() {
  var hoy = isoDeFecha();
  var mes = hoy.substring(0, 7);
  var hace30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return esperarDb().then(function (h) {
    return Promise.all([
      window.all(h, 'productos'),
      window.all(h, 'ventas'),
      window.all(h, 'fiados'),
      window.all(h, 'abonos'),
      window.all(h, 'cierres'),
      window.all(h, 'recogidas'),
      window.all(h, 'gastos')
    ]);
  }).then(function (r) {
    var productos = r[0], ventas = r[1], fiados = r[2], abonos = r[3],
        cierres = r[4], recogidas = r[5], gastos = r[6];
    var vigentes = ventas.filter(function (v) { return !v.anulada; });
    function ganancia(v) { return (v.total || 0) - (v.costo || 0) * (v.cantidad || 0); }
    function esHoy(ts) { return isoDeFecha(ts) === hoy; }

    /* --- catálogo --- */
    var catalogo = productos.map(function (p) {
      return { n: p.nombre, cat: p.categoria || '', u: p.unidad || 'unidad',
        p: p.precio_efectivo || 0, t: p.precio_transferencia || 0,
        s: p.stock || 0, c: (p.costo == null ? null : p.costo), d: (p.stock || 0) > 0 };
    });

    /* --- ventas de hoy --- */
    var fiadoPorId = {};
    fiados.forEach(function (f) { fiadoPorId[f.id] = f; });
    var lineasHoy = vigentes.filter(function (v) { return esHoy(v.fecha); })
      .map(function (v) {
        var cliente = '';
        if (v.metodo === 'Fiado' && v.fiadoId && fiadoPorId[v.fiadoId]) cliente = fiadoPorId[v.fiadoId].cliente || '';
        return { p: v.producto, c: v.cantidad, pr: v.precio, t: v.total,
          m: v.metodo === 'Fiado' ? 'Crédito' : (v.metodo || 'Efectivo'),
          cl: cliente, n: '' };
      });
    var efecHoy = lineasHoy.filter(function (l) { return l.m === 'Efectivo'; })
      .reduce(function (a, l) { return a + (l.t || 0); }, 0);
    var credHoy = lineasHoy.filter(function (l) { return l.m === 'Crédito'; })
      .reduce(function (a, l) { return a + (l.t || 0); }, 0);

    /* --- gastos de hoy --- */
    var gastosHoyLista = gastos.filter(function (g) { return g.fecha === hoy; })
      .map(function (g) { return { concepto: g.concepto, monto: g.monto || 0, nota: g.nota || '' }; });
    var gastosHoyTotal = gastosHoyLista.reduce(function (a, g) { return a + (g.monto || 0); }, 0);

    /* --- fondo / caja (misma definición que la pestaña Caja de la PWA) --- */
    var ultimoCierreMs = 0, ultimoCierre = null;
    cierres.forEach(function (c) {
      if (c.fecha && c.fecha > ultimoCierreMs) { ultimoCierreMs = c.fecha; ultimoCierre = c; }
    });
    function despuesDeUltimo(ts) { return (ts || 0) > ultimoCierreMs; }
    var ef = vigentes.filter(function (v) { return despuesDeUltimo(v.fecha) && v.metodo === 'Efectivo'; })
      .reduce(function (a, v) { return a + (v.total || 0); }, 0);
    var tr = vigentes.filter(function (v) { return despuesDeUltimo(v.fecha) && v.metodo === 'Transferencia'; })
      .reduce(function (a, v) { return a + (v.total || 0); }, 0);
    var cob = abonos.filter(function (a) { return despuesDeUltimo(a.fecha); })
      .reduce(function (a, x) { return a + (x.monto || 0); }, 0);
    var rec = recogidas.filter(function (x) { return despuesDeUltimo(x.fecha); })
      .reduce(function (a, x) { return a + (x.monto || 0); }, 0);
    var efectivoCaja = redondear(ef + cob - rec);
    var pendientes = {};
    vigentes.forEach(function (v) {
      var f = isoDeFecha(v.fecha);
      if (ultimoCierreMs && v.fecha > ultimoCierreMs && f < hoy && v.metodo === 'Efectivo') {
        pendientes[f] = (pendientes[f] || 0) + (v.total || 0);
      }
    });
    var movimientosHoy = recogidas.filter(function (x) { return esHoy(x.fecha); })
      .map(function (x) { return { concepto: x.nota || 'Recogida', tipo: 'salida', medio: 'efectivo', monto: x.monto || 0 }; });

    /* --- deudas --- */
    var pagadoPorFiado = {};
    abonos.forEach(function (a) { pagadoPorFiado[a.fiadoId] = (pagadoPorFiado[a.fiadoId] || 0) + (a.monto || 0); });
    var porCliente = {};
    fiados.forEach(function (f) {
      if (f.anulada) return;
      var pend = (f.total || 0) - (pagadoPorFiado[f.id] || 0);
      if (pend <= 0.005) return;
      porCliente[f.cliente] = (porCliente[f.cliente] || 0) + pend;
    });
    var listaDeudas = Object.keys(porCliente).map(function (cl) {
      return { cliente: cl, monto: redondear(porCliente[cl]), nota: '' };
    }).sort(function (a, b) { return b.monto - a.monto; });
    var totalDeudas = listaDeudas.reduce(function (a, d) { return a + d.monto; }, 0);

    /* --- totales, top, por día, mes --- */
    var totalVentas = vigentes.reduce(function (a, v) { return a + (v.total || 0); }, 0);
    var utilidadTotal = vigentes.reduce(function (a, v) { return a + ganancia(v); }, 0);
    var porProducto = {};
    vigentes.forEach(function (v) {
      var p = porProducto[v.producto] || (porProducto[v.producto] = { producto: v.producto, utilidad: 0, unidades: 0 });
      p.utilidad += ganancia(v);
      p.unidades += v.cantidad || 0;
    });
    var topUtilidad = Object.keys(porProducto).map(function (k) { return porProducto[k]; })
      .map(function (t) { return { producto: t.producto, utilidad: redondear(t.utilidad), unidades: t.unidades }; })
      .sort(function (a, b) { return b.utilidad - a.utilidad; }).slice(0, 5);
    var porDia = {};
    vigentes.forEach(function (v) {
      var f = isoDeFecha(v.fecha);
      porDia[f] = (porDia[f] || 0) + (v.total || 0);
    });
    var ventasPorDia = Object.keys(porDia).sort().map(function (f) {
      return { fecha: f, total: redondear(porDia[f]) };
    });
    var ventasMes = vigentes.filter(function (v) { return isoDeFecha(v.fecha).substring(0, 7) === mes; });
    var mesVentas = ventasMes.reduce(function (a, v) { return a + (v.total || 0); }, 0);
    var mesUtilidad = ventasMes.reduce(function (a, v) { return a + ganancia(v); }, 0);

    /* --- capital parado y ventas lentas (ventana de 30 días) --- */
    var ultimasVentas = {};
    var unidades30d = {};
    vigentes.forEach(function (v) {
      if (v.fecha >= hace30d) unidades30d[v.producto] = (unidades30d[v.producto] || 0) + (v.cantidad || 0);
      var f = isoDeFecha(v.fecha);
      if (!ultimasVentas[v.producto] || f > ultimasVentas[v.producto]) ultimasVentas[v.producto] = f;
    });
    var parados = [], lentos = [];
    productos.forEach(function (p) {
      if ((p.stock || 0) <= 0) return;
      var u30 = unidades30d[p.nombre] || 0;
      var uDia = u30 / 30;
      if (u30 === 0) {
        parados.push({ nombre: p.nombre, stock: p.stock, costo: p.costo || 0,
          dinero: redondear((p.stock || 0) * (p.costo || 0)), dias_stock: null,
          ultima_venta: ultimasVentas[p.nombre] || null });
      }
      if (uDia < 0.5) {
        lentos.push({ nombre: p.nombre, stock: p.stock,
          dias_stock: uDia > 0 ? Math.round((p.stock || 0) / uDia) : 999,
          ultima_venta: ultimasVentas[p.nombre] || null });
      }
    });
    parados.sort(function (a, b) { return b.dinero - a.dinero; });
    lentos.sort(function (a, b) { return b.dias_stock - a.dias_stock; });

    return {
      actualizadoFecha: dmyDeISO(hoy),
      actualizadoHora: horaAhora(),
      fuente: 'SQLite local de la PWA (BodegaControl)',
      ventasHoy: { total: redondear(efecHoy + credHoy + lineasHoy.filter(function (l) { return l.m === 'Transferencia'; }).reduce(function (a, l) { return a + (l.t || 0); }, 0)),
        lineas: lineasHoy, efectivo: redondear(efecHoy), credito: redondear(credHoy) },
      gastosHoy: { total: redondear(gastosHoyTotal), lista: gastosHoyLista },
      fondo: { efectivo: efectivoCaja, tarjeta: redondear(tr), total: redondear(efectivoCaja + tr),
        ultimoCierre: ultimoCierre ? dmyDeISO(isoDeFecha(ultimoCierre.fecha)) : null,
        cierreUltimo: ultimoCierre ? (ultimoCierre.efectivo || 0) : 0,
        pendienteHoyEfectivo: redondear(efecHoy),
        ventasPendientesCierre: Object.keys(pendientes).sort().map(function (f) {
          return { fecha: f, efectivo: redondear(pendientes[f]) };
        }),
        movimientosHoy: movimientosHoy },
      deudas: { fecha: dmyDeISO(hoy), total: redondear(totalDeudas), lista: listaDeudas, pendientes: [] },
      catalogo: catalogo,
      totales: { ventas: redondear(totalVentas), lineas: vigentes.length, utilidad: redondear(utilidadTotal) },
      topUtilidad: topUtilidad,
      ventasPorDia: ventasPorDia,
      capitalParado: parados.slice(0, 5),
      ventasLentas: lentos.slice(0, 5),
      mesActual: { mes: mes, ventas: redondear(mesVentas), utilidad: redondear(mesUtilidad) }
    };
  });
}

window.construirSnapshotAsistente = construirSnapshot;
})();
