/* COPIA para la PWA (funciona sin conexión).
   Original canónico: ~/workspace/negocio-alo-rico-rico/asistente/AsistenteMotor.js
   Si cambia el original, volver a copiarlo aquí y subir la PWA.
   NO editar esta copia a mano: los cambios se pierden en la próxima copia. */
/* Asistente de Alo Rico Rico — MOTOR determinista (Paso 1).
   Responde con números exactos del snapshot, sin inventar.
   Funciona en el navegador (window.AsistenteMotor), en Google Apps Script
   (global AsistenteMotor) y en Node (module.exports).
   Uso: AsistenteMotor.responder(pregunta, SNAP) -> {html, tipo, cubierto}
   - cubierto=true: el motor respondió con datos verificados.
   - cubierto=false: pasar a Gemini (entendimiento real).
   El motor NUNCA escribe nada: los "registros" son BORRADORES (paso 2). */
var AsistenteMotor = (function () {
'use strict';

function norm(s) { return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function fmt(n) { n = Math.round(+n || 0); return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtFechaISO(iso) { var p = (iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ---------- catálogo ---------- */
function buscarProducto(q, CAT) {
  var nq = norm(q), byNorm = {}, cands = [];
  CAT.forEach(function (p) { byNorm[norm(p.n)] = p; });
  CAT.forEach(function (p) {
    var np = norm(p.n), score = 0;
    if (nq === np) score = 100;
    else if (nq.indexOf(np) !== -1) score = 90;
    else if (np.indexOf(nq) !== -1 && nq.length >= 4) score = 70;
    else {
      var words = np.split(' ').filter(function (w) { return w.length > 3; });
      var hit = words.filter(function (w) { return nq.indexOf(w) !== -1; }).length;
      if (hit === words.length && words.length) score = 80;
      else if (hit > 0) score = 30 + hit;
    }
    if (score > 0) cands.push({ p: p, s: score });
  });
  cands.sort(function (a, b) { return b.s - a.s; });
  if (!cands.length) return { tipo: 'ninguno' };
  if (cands.length > 1 && cands[0].s === cands[1].s && cands[0].s >= 70)
    return { tipo: 'varios', lista: cands.filter(function (c) { return c.s === cands[0].s; }).map(function (c) { return c.p; }) };
  return { tipo: 'uno', p: cands[0].p, score: cands[0].s };
}

function aliasProducto(q, CAT) {
  var byNorm = {};
  CAT.forEach(function (p) { byNorm[norm(p.n)] = p; });
  var nq = norm(q);
  if (/\barroz\b/.test(nq) && nq.indexOf('1kg') === -1 && nq.indexOf('1 kg') === -1)
    return byNorm[norm('Arroz x Lb')] || null;
  if (/\bpicadillo\b/.test(nq) && nq.indexOf('mdm') === -1 && nq.indexOf('mixto') === -1)
    return byNorm[norm('picadillo de pollo americano')] || null;
  if (/\bsalamito\b/.test(nq)) return byNorm[norm('Salami')] || null;
  if (/caramelo duro/.test(nq)) return byNorm[norm('caramelo mentolado')] || null;
  return null;
}

function textoProducto(p, conCosto) {
  var t = '<b>' + esc(p.n) + '</b>: ';
  if (!p.d || p.s <= 0) t += 'agotado ahora mismo (stock 0). ';
  else t += 'quedan <b>' + p.s + ' ' + esc(p.u) + '</b>. ';
  t += 'Precio ' + fmt(p.p) + (p.t ? ' (por transferencia ' + fmt(p.t) + ')' : '') + '.';
  if (conCosto && p.c != null) {
    var margen = p.p - p.c, pct = p.p ? Math.round(margen / p.p * 100) : 0;
    t += '<br>Costo ' + fmt(p.c) + ', margen ' + fmt(margen) + ' por unidad (' + pct + '%).';
  }
  return t;
}

/* ---------- respuestas ---------- */
function rVentasHoy(SNAP) {
  var v = SNAP.ventasHoy, f = SNAP.actualizadoFecha;
  if (!v.lineas.length) {
    var ult = (SNAP.ventasPorDia && SNAP.ventasPorDia.length > 1) ? SNAP.ventasPorDia[SNAP.ventasPorDia.length - 2] : null;
    var ultTxt = ult ? fmtFechaISO(ult.fecha) + ' (' + fmt(ult.total) + ')' : '—';
    return 'Hoy, ' + f + ', no hay ventas todavía. El último día con ventas fue el ' + ultTxt + '.';
  }
  var mayor = v.lineas.reduce(function (a, b) { return (b.t > a.t) ? b : a; }, v.lineas[0]);
  var h = 'Hoy, ' + f + ', vendiste <b>' + fmt(v.total) + '</b> en ' + v.lineas.length + ' líneas.<br>• En efectivo: <b>' + fmt(v.efectivo) + '</b> (' + v.lineas.filter(function (l) { return l.m === 'Efectivo'; }).length + ' líneas)';
  if (v.credito > 0) h += '<br>• A crédito: <b>' + fmt(v.credito) + '</b> (' + v.lineas.filter(function (l) { return l.m === 'Crédito'; }).length + ' líneas, no entran en caja hasta cobrarse)';
  h += '<br>La línea mayor: <b>' + esc(mayor.p) + ' ' + mayor.c + ' × ' + fmt(mayor.pr) + ' = ' + fmt(mayor.t) + '</b> (' + esc(mayor.cl || 'sin cliente') + ').';
  return h;
}

function rCaja(SNAP) {
  var f = SNAP.fondo;
  var h = 'En el Fondo hay <b>' + fmt(f.total) + '</b>: ' + fmt(f.efectivo) + ' en efectivo y ' + fmt(f.tarjeta) + ' en tarjeta.';
  if (f.ultimoCierre) h += '<br>Último cierre aplicado al Fondo: el ' + f.ultimoCierre + ' (entraron ' + fmt(f.cierreUltimo) + ' en efectivo).';
  if (f.ventasPendientesCierre && f.ventasPendientesCierre.length) {
    h += '<br>Pendiente de aplicar al Fondo: ' + f.ventasPendientesCierre.map(function (p) {
      var fe = p.fecha || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(fe)) fe = fe.split('-').reverse().join('/');
      /* El snapshot local trae p.efectivo; el del servidor trae p.total. */
      return 'ventas del ' + fe + ' (' + fmt(p.efectivo != null ? p.efectivo : p.total) + ' en efectivo)';
    }).join(', ') + '.';
  }
  h += '<br>Hoy, pendiente de cierre: <b>' + fmt(f.pendienteHoyEfectivo) + '</b> en efectivo. Todavía no se suma al Fondo: va al cierre de las 23:50.';
  return h;
}

function rDeudas(SNAP) {
  var ds = SNAP.deudas;
  var h = 'Te deben <b>' + fmt(ds.total) + '</b> entre ' + ds.lista.length + ' clientes (según el registro del ' + ds.fecha + '):<br>';
  ds.lista.forEach(function (d) { h += '• <b>' + esc(d.cliente) + '</b>: ' + fmt(d.monto) + (d.nota ? ' <small>(' + esc(d.nota) + ')</small>' : '') + '<br>'; });
  if (ds.pendientes && ds.pendientes.length)
    h += '<small>Sin confirmar todavía: ' + ds.pendientes.map(function (p) { return esc(p); }).join(' ') + '</small>';
  return h;
}

function rCierre(SNAP) {
  var v = SNAP.ventasHoy, g = SNAP.gastosHoy, f = SNAP.fondo;
  var h = 'Para cerrar hoy, ' + SNAP.actualizadoFecha + ':<br>• Ventas: <b>' + fmt(v.total) + '</b> (' + v.lineas.length + ' líneas)<br>• Gastos: <b>' + fmt(g.total) + '</b>' +
    (g.lista.length ? ' (' + g.lista.map(function (x) { return esc(x.concepto) + ' ' + fmt(x.monto) + (x.nota ? ' ' + esc(x.nota) : ''); }).join(', ') + ')' : ' (ninguno anotado hoy)') +
    '<br>• Efectivo a cerrar: <b>' + fmt(f.pendienteHoyEfectivo) + '</b>' +
    (v.credito > 0 ? ' (los ' + fmt(v.credito) + ' a crédito no entran en caja hasta cobrarse)' : '') +
    (function () {
      var pend = f.ventasPendientesCierre || [];
      if (!pend.length) return '';
      return '<br>⚠ Pendiente de aplicar al Fondo: ' + pend.map(function (p) {
        return 'ventas del ' + fmtFechaISO(p.fecha) + ' (' + fmt(p.efectivo != null ? p.efectivo : p.total) + (p.efectivo != null ? ' en efectivo' : ' en total') + ')';
      }).join(', ') + '.';
    })() +
    '<br>Falta el conteo de caja. El cierre es a las <b>23:50</b>, si ya no hay más ventas.';
  return h;
}

function rAgotados(SNAP) {
  var ag = SNAP.catalogo.filter(function (p) { return !p.d || p.s <= 0; });
  return 'Agotados ahora mismo (' + ag.length + '):<br>' + ag.map(function (p) { return '• ' + esc(p.n); }).join('<br>');
}

function rTopUtilidad(SNAP) {
  var top = SNAP.topUtilidad || [];
  if (!top.length) return null;
  var h = 'Lo que más ganancia te ha dejado (todo el historial):<br>';
  top.slice(0, 5).forEach(function (t, i) {
    h += (i + 1) + '. <b>' + esc(t.producto) + '</b>: ' + fmt(t.utilidad) + ' en ' + t.unidades + ' unidades.<br>';
  });
  return h;
}

function rCapitalParado(SNAP) {
  var cp = SNAP.capitalParado || [];
  if (!cp.length) return 'No hay capital parado ahora mismo: todo lo que tienes en stock se mueve.';
  var tot = cp.reduce(function (a, p) { return a + p.dinero; }, 0);
  var h = 'Dinero parado en stock lento (' + fmt(tot) + ' en los 5 primeros):<br>';
  cp.forEach(function (p, i) {
    h += (i + 1) + '. <b>' + esc(p.nombre) + '</b>: ' + p.stock + ' u × ' + fmt(p.costo) + ' = <b>' + fmt(p.dinero) + '</b>' +
      (p.dias_stock ? ' (' + p.dias_stock + ' días de stock)' : ' (sin ventas registradas)') + '.<br>';
  });
  return h;
}

function rVentasLentas(SNAP) {
  var vl = SNAP.ventasLentas || [];
  if (!vl.length) return 'No hay ventas lentas con stock ahora mismo.';
  var h = 'Ventas lentas con stock:<br>';
  vl.forEach(function (p, i) {
    h += (i + 1) + '. <b>' + esc(p.nombre) + '</b>: ' + p.stock + ' u' +
      (p.dias_stock >= 999 ? ' (sin ventas registradas)' : ' (' + p.dias_stock + ' días de stock)') +
      (p.ultima_venta ? ', última venta ' + p.ultima_venta : '') + '.<br>';
  });
  return h;
}

function rUtilidadMes(SNAP) {
  var m = SNAP.mesActual || {};
  if (!m.mes) return null;
  var partes = m.mes.split('-');
  var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var nombreMes = meses[parseInt(partes[1], 10) - 1] + ' de ' + partes[0];
  return 'En ' + nombreMes + ' llevas <b>' + fmt(m.ventas) + '</b> en ventas y <b>' + fmt(m.utilidad) + '</b> de ganancia.';
}

function rVentasPeriodo(SNAP, dias) {
  var vpd = SNAP.ventasPorDia || [];
  if (!vpd.length) return null;
  var ult = vpd.slice(-dias), tot = ult.reduce(function (a, d) { return a + (d.total || 0); }, 0);
  var h = 'Últimos ' + ult.length + ' días (' + ult[0].fecha + ' a ' + ult[ult.length - 1].fecha + '): <b>' + fmt(tot) + '</b>.<br>';
  h += ult.map(function (d) { return '• ' + d.fecha + ': ' + fmt(d.total); }).join('<br>');
  return h;
}

function rRegistro(q, SNAP) {
  var nq = norm(q);
  var esVenta = /venta|vend/i.test(q), esGasto = /gasto/i.test(q), esCobro = /cobro|abono|pago/i.test(q);
  function borrador(tipo, titulo, detalle) {
    return '🧾 <b>Borrador de ' + esc(tipo) + ' (sin guardar)</b><br>' + titulo + '<br>' + detalle +
      '<br><br><b>Esto es solo un borrador: todavía no se guardó nada.</b> El registro llega en el paso 2; por ahora revisa que los datos estén bien.';
  }
  if (esGasto) {
    var m = q.match(/\$?\s*(\d[\d.,]*)/);
    var monto = m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : null;
    var concepto = /pan/i.test(q) ? 'Pan' : 'Gasto';
    if (monto) return borrador('Gasto', concepto + ' — ' + fmt(monto), 'Gasto de ' + fmt(monto) + ' (' + esc(concepto) + ').');
    return 'Para anotar el gasto dime el concepto y el monto. Por ejemplo: "Registra gasto Pan 420".';
  }
  if (esCobro) {
    var mc = q.match(/\$?\s*(\d[\d.,]*)/);
    var cliente = null;
    SNAP.deudas.lista.forEach(function (d) { if (nq.indexOf(norm(d.cliente)) !== -1) cliente = d; });
    if (mc && cliente) {
      var mm = parseFloat(mc[1].replace(/\./g, '').replace(',', '.'));
      return borrador('Cobro', 'Abono de ' + esc(cliente.cliente) + ' — ' + fmt(mm),
        'Abono de <b>' + esc(cliente.cliente) + '</b> por ' + fmt(mm) + '. Deuda antes: ' + fmt(cliente.monto) + ' → después: ' + fmt(Math.max(0, cliente.monto - mm)) + '.');
    }
    return 'Para anotar el cobro dime el cliente y el monto. Por ejemplo: "Registra cobro Yiyo 1000".';
  }
  if (esVenta) {
    var mv = q.match(/(\d+(?:[.,]\d+)?)\s*(?:x|\*)\s*\$?\s*(\d[\d.,]*)/);
    var prod = aliasProducto(q, SNAP.catalogo) || (function () { var b = buscarProducto(q, SNAP.catalogo); return (b.tipo === 'uno' && b.score >= 70) ? b.p : null; })();
    if (mv && prod) {
      var cant = parseFloat(mv[1].replace(',', '.')), precio = parseFloat(mv[2].replace(/\./g, '').replace(',', '.'));
      var total = cant * precio;
      var metodo = /transferencia|\(t\)/i.test(q) ? 'Transferencia' : (/credito|debe|fiado/i.test(q) ? 'Crédito' : 'Efectivo');
      var det = 'Venta de <b>' + esc(prod.n) + '</b> ' + cant + ' × ' + fmt(precio) + ' = <b>' + fmt(total) + '</b> (' + metodo + '). Stock después: ' + Math.max(0, prod.s - cant) + ' ' + esc(prod.u) + '.';
      return borrador('Venta', prod.n + ' ' + cant + ' × ' + fmt(precio) + ' = ' + fmt(total), det);
    }
    return 'Para registrar la venta dime el producto, la cantidad y el precio. Por ejemplo: "Registra venta Arroz x Lb 2*410".';
  }
  return '¿Qué quieres registrar: una venta, un gasto o un cobro? Dime cuál y los datos, por ejemplo: "Registra venta Arroz x Lb 2*410".';
}

function saludo(SNAP) {
  return 'Hola, soy el asistente de tu negocio. Te ayudo con las ventas, el inventario y la caja. ¿En qué puedo ayudarte hoy?<br><br><small>Datos en vivo del ' + esc(SNAP.actualizadoFecha) + ' a las ' + esc(SNAP.actualizadoHora) + '. Si algo no cuadra, dime y lo revisamos.</small>';
}

/* ---------- motor: decide qué responde ---------- */
function responder(q, SNAP) {
  var nq = norm(q);
  if (!nq) return { html: 'Escríbeme una pregunta, por ejemplo: "¿Cuánto vendí hoy?"', tipo: 'vacio', cubierto: true };
  if (/\b(registr|anot|apunt|guard)/.test(nq) && /(venta|gasto|cobro|abono|pago)/.test(nq))
    return { html: rRegistro(q, SNAP), tipo: 'registro-borrador', cubierto: true };
  if (/(cerrar|cierre|cuadre)/.test(nq)) return { html: rCierre(SNAP), tipo: 'cierre', cubierto: true };
  if (/(ultimos 7 dias|esta semana|ultima semana)/.test(nq)) {
    var per = rVentasPeriodo(SNAP, 7);
    if (per) return { html: per, tipo: 'ventas-periodo', cubierto: true };
  }
  if ((/(vendi|ventas|vendiste)/.test(nq) && /hoy/.test(nq)) || /cuanto (vendi|se vendio).*hoy/.test(nq))
    return { html: rVentasHoy(SNAP), tipo: 'ventas-hoy', cubierto: true };
  if (/(debe|deuda|fiado|me deben|quien.*debe)/.test(nq)) return { html: rDeudas(SNAP), tipo: 'deudas', cubierto: true };
  if (/(agotad|agoto|se acabo|se acabaron)/.test(nq)) return { html: rAgotados(SNAP), tipo: 'agotados', cubierto: true };
  if (/(mayor ganancia|mas ganancia|que deja mas|que me deja mas)/.test(nq)) {
    var top = rTopUtilidad(SNAP);
    if (top) return { html: top, tipo: 'top-utilidad', cubierto: true };
  }
  if (/(capital parado|dinero parado|parados|parado|plata parada)/.test(nq))
    return { html: rCapitalParado(SNAP), tipo: 'capital-parado', cubierto: true };
  if (/(ventas lentas|lentos|se venden poco|no se vende|se mueve poco)/.test(nq))
    return { html: rVentasLentas(SNAP), tipo: 'ventas-lentas', cubierto: true };
  if (/(cuanto gane|cuanta ganancia|ganancia.*(noviembre|este mes|en el mes)|utilidad.*(noviembre|este mes)|gane en)/.test(nq))
    return { html: rUtilidadMes(SNAP), tipo: 'utilidad-mes', cubierto: true };
  /* Decisiones de compra y análisis: al saco, al proveedor, a si conviene
     — eso lo resuelve Gemini con el radar, no el motor de productos. */
  if (/(saco|conviene|proveedor|radar)/.test(nq))
    return { html: '', tipo: 'gemini', cubierto: false };
  /* Producto PRIMERO: "cuánto hay de arroz" es el producto, no la caja (corrección 23/11). */
  var al = aliasProducto(q, SNAP.catalogo);
  if (al) return { html: textoProducto(al, /(me cuesta|\bcosto\b|cuesta comprar|gano|margen)/.test(nq)), tipo: 'producto', cubierto: true };
  if (/(queda|quedan|stock|precio|cuesta|vale|cuanto|hay de|queda de|costo|gano|margen)/.test(nq)) {
    var b = buscarProducto(q, SNAP.catalogo);
    if (b.tipo === 'uno' && b.score >= 70)
      return { html: textoProducto(b.p, /(me cuesta|\bcosto\b|cuesta comprar|gano|margen)/.test(nq)), tipo: 'producto', cubierto: true };
    if (b.tipo === 'varios')
      return { html: '¿Cuál de estos? ' + b.lista.map(function (p) { return esc(p.n); }).join(', ') + '.', tipo: 'desambiguacion', cubierto: true };
    /* Si no hay producto claro, que lo resuelva Gemini (no inventar). */
    if (!/(caja|fondo|dinero)/.test(nq)) return { html: '', tipo: 'gemini', cubierto: false };
  }
  if (/(caja|fondo|dinero)/.test(nq) || nq === 'cuanto hay' || nq === 'cuanto tengo' || /cuanto (hay|tengo|queda) en/.test(nq))
    return { html: rCaja(SNAP), tipo: 'caja', cubierto: true };
  if (/(hola|buenas|hey|saludos)/.test(nq) && nq.length < 20) return { html: saludo(SNAP), tipo: 'saludo', cubierto: true };
  return { html: '', tipo: 'gemini', cubierto: false };
}

return { responder: responder, norm: norm, fmt: fmt, esc: esc, buscarProducto: buscarProducto, aliasProducto: aliasProducto };
})();

/* Exposición según el entorno */
if (typeof module !== 'undefined' && module.exports) { module.exports = AsistenteMotor; }
if (typeof window !== 'undefined') { window.AsistenteMotor = AsistenteMotor; }
