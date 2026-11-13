/* BodegaControl PWA - Respaldo en la nube (v1).
   La nube es SOLO de la version de pago; la gratuita solo tiene la
   descarga local de este archivo. v1 = respaldo/restauracion del
   archivo COMPLETO de la base (sin fusion entre dispositivos).
   La identidad es el correo del negocio (cuenta de Google): cada
   cliente respalda en SU propio Drive, nunca en un Drive central.
   Deteccion online/offline combinada:
   (a) navigator.onLine + eventos online/offline cambian el distintivo
       al instante, sin gastar datos;
   (b) al abrir la pestaña Respaldo o al tocar "Respaldar ahora", la
       app comprueba el acceso a Drive (ping al endpoint): si responde,
       ONLINE confirmado; si no, vuelve a OFFLINE con mensaje.
   Sin URL configurada el distintivo usa solo (a), como la gratuita.
   La base se lee directo de OPFS (archivo bodegacontrol.sqlite3): el
   worker la escribe completa tras cada cambio, asi que esta al dia.
   Para restaurar: se cierra el worker (closeDb, para que no vuelva a
   escribir la base vieja encima), se sobrescribe el archivo en OPFS
   con la copia y se recarga la pagina. */
(function () {
  'use strict';
  var DB_FILE = 'bodegacontrol.sqlite3';
  var LS_CORREO = 'bc_respaldo_correo';
  var LS_URL = 'bc_respaldo_url';
  var LS_CLAVE = 'bc_respaldo_clave';
  var LS_ULTIMO = 'bc_respaldo_ultimo';
  var LS_COPIAS = 'bc_respaldo_copias';
  /* null = sin comprobar con el endpoint; true/false = ultimo ping */
  var onlineConfirmado = null;

  function el(id) { return document.getElementById(id); }
  function escHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtFecha(ts) {
    var d = new Date(ts);
    return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function haceCuanto(ts) {
    var min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return 'ahora mismo';
    if (min < 60) return 'hace ' + min + ' minuto' + (min === 1 ? '' : 's');
    var h = Math.floor(min / 60);
    if (h < 24) return 'hace ' + h + ' hora' + (h === 1 ? '' : 's');
    var d = Math.floor(h / 24);
    return 'hace ' + d + ' día' + (d === 1 ? '' : 's');
  }
  function fmtTamano(bytes) {
    if (bytes == null || isNaN(bytes)) return '—';
    if (bytes < 1024) return bytes + ' B';
    return Math.round(bytes / 1024) + ' KB';
  }
  function nombreRespaldo(fecha) {
    var d = fecha || new Date();
    return 'respaldo-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' +
      pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds()) + '.sqlite3';
  }
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    var CHUNK = 8192;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function setMsg(texto, alerta) {
    var m = el('r-msg');
    if (!m) return;
    m.textContent = texto;
    m.className = alerta ? 'msg alerta' : 'msg';
  }

  /* ---------------- Configuracion guardada ---------------- */
  function config() {
    return {
      correo: (localStorage.getItem(LS_CORREO) || '').trim(),
      url: (localStorage.getItem(LS_URL) || '').trim(),
      clave: localStorage.getItem(LS_CLAVE) || ''
    };
  }
  function guardarConfig() {
    localStorage.setItem(LS_CORREO, el('r-correo').value.trim());
    localStorage.setItem(LS_URL, el('r-url').value.trim());
    localStorage.setItem(LS_CLAVE, el('r-clave').value);
    actualizarDistintivo();
  }

  /* ---------------- Distintivo ONLINE / OFFLINE ---------------- */
  function actualizarDistintivo() {
    var enLinea = navigator.onLine;
    var online = enLinea && onlineConfirmado !== false;
    var badge = el('badge-conexion');
    var sub = el('subtitulo');
    if (badge) badge.textContent = online ? 'ONLINE' : 'OFFLINE';
    if (sub) sub.textContent = online ? 'PRUEBA · Conectada · Respaldo en tu Drive' : 'PRUEBA · Sin conexión · Los datos viven en este teléfono';
    var cfg = config();
    var configurada = !!(cfg.correo && cfg.url);
    var nubeOk = online && configurada;
    var bResp = el('r-respaldar'), bRest = el('r-restaurar');
    if (bResp) bResp.disabled = !nubeOk;
    if (bRest) bRest.disabled = !nubeOk;
    document.querySelectorAll('[data-restaurar-copia]').forEach(function (b) { b.disabled = !nubeOk; });
    if (!configurada) {
      setMsg('Configura primero el correo y la URL de tu Apps Script para usar la nube. La descarga local funciona sin configurar nada.');
    } else if (!enLinea) {
      setMsg('Sin conexión: el respaldo en la nube necesita internet. La descarga local sí funciona.', true);
    }
  }

  /* ---------------- Acceso al endpoint (Apps Script) ---------------- */
  /* text/plain evita el preflight de CORS: Apps Script no responde
     al OPTIONS, asi que un POST application/json no llegaria nunca. */
  function llamarEndpoint(body) {
    var url = config().url;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    }).then(function (resp) {
      clearTimeout(timer);
      if (!resp.ok) throw new Error('El servidor respondió HTTP ' + resp.status);
      return resp.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    }).then(function (json) {
      if (!json || json.ok !== true) throw new Error((json && json.error) || 'Respuesta inválida del servidor');
      return json;
    });
  }
  function pingEndpoint() {
    var cfg = config();
    if (!cfg.url) return Promise.resolve(false);
    return llamarEndpoint({ accion: 'ping' }).then(function () {
      onlineConfirmado = true;
      actualizarDistintivo();
      return true;
    }).catch(function (e) {
      onlineConfirmado = false;
      actualizarDistintivo();
      setMsg('No se pudo llegar a tu Drive: revisa la URL del script o la conexión. (' + e.message + ')', true);
      return false;
    });
  }

  /* ---------------- Lectura / escritura de la base en OPFS ---------------- */
  function leerBaseBytes() {
    return navigator.storage.getDirectory().then(function (dir) {
      return dir.getFileHandle(DB_FILE);
    }).then(function (handle) {
      return handle.getFile();
    }).then(function (file) {
      return file.arrayBuffer().then(function (buf) { return { bytes: buf, size: file.size }; });
    }).catch(function (e) {
      throw new Error('No se pudo leer la base de este teléfono: ' + e.message);
    });
  }
  function leerTamanoBase() {
    return navigator.storage.getDirectory().then(function (dir) {
      return dir.getFileHandle(DB_FILE);
    }).then(function (handle) { return handle.getFile(); })
      .then(function (file) { return file.size; });
  }
  function escribirBaseBytes(buf) {
    return navigator.storage.getDirectory().then(function (dir) {
      return dir.getFileHandle(DB_FILE, { create: true });
    }).then(function (handle) {
      return handle.createWritable();
    }).then(function (w) {
      /* write no recorta: si la copia es mas corta que el archivo
         viejo, truncate quita los bytes viejos que sobran. */
      return w.write(buf).then(function () { return w.truncate(buf.byteLength); })
        .then(function () { return w.close(); });
    });
  }

  /* ---------------- Estadisticas de la tarjeta ---------------- */
  function actualizarStats() {
    var ultimo = Number(localStorage.getItem(LS_ULTIMO) || 0);
    if (ultimo) {
      el('r-ultimo').textContent = fmtFecha(ultimo);
      el('r-ultimo-detalle').textContent = haceCuanto(ultimo);
    } else {
      el('r-ultimo').textContent = 'Nunca';
      el('r-ultimo-detalle').textContent = 'Aún no hay respaldos';
    }
    var n = localStorage.getItem(LS_COPIAS);
    el('r-copias').textContent = (n == null ? '—' : n);
    leerTamanoBase().then(function (size) {
      el('r-tamano').textContent = 'tamaño de la base: ' + fmtTamano(size);
    }).catch(function () {
      el('r-tamano').textContent = 'tamaño de la base: —';
    });
  }

  /* ---------------- Lista de copias ---------------- */
  function renderLista(copias) {
    var ul = el('r-lista');
    if (!copias.length) { ul.innerHTML = '<li>Sin copias todavía.</li>'; return; }
    ul.innerHTML = copias.map(function (c) {
      var fecha = c.fecha ? new Date(c.fecha).toLocaleString('es-CU') : c.nombre;
      return '<li><strong>' + escHtml(c.nombre) + '</strong><br>' + escHtml(fecha) + ' · ' + fmtTamano(c.tamano) + ' · ' + (c.carpeta === 'Mensuales' ? 'Mensuales' : 'En Drive') +
        '<button data-restaurar-copia="' + escHtml(c.nombre) + '">Restaurar</button></li>';
    }).join('');
    ul.querySelectorAll('[data-restaurar-copia]').forEach(function (b) {
      b.onclick = function () { restaurarCopia(b.getAttribute('data-restaurar-copia')); };
    });
    actualizarDistintivo();
  }
  function listarCopias() {
    var cfg = config();
    if (!cfg.url || !cfg.correo || !navigator.onLine || onlineConfirmado === false) return Promise.resolve();
    return llamarEndpoint({ accion: 'listar', correo: cfg.correo, clave: cfg.clave }).then(function (json) {
      var copias = json.copias || [];
      localStorage.setItem(LS_COPIAS, String(copias.length));
      el('r-copias').textContent = String(copias.length);
      renderLista(copias);
    }).catch(function (e) {
      setMsg('No se pudo ver la lista de copias: ' + e.message, true);
    });
  }

  /* ---------------- Acciones ---------------- */
  function respaldarAhora() {
    guardarConfig();
    var cfg = config();
    if (!cfg.url || !cfg.correo) { setMsg('Configura primero el correo y la URL de tu Apps Script para usar la nube.', true); return; }
    if (!navigator.onLine) { setMsg('Sin conexión: el respaldo en la nube necesita internet.', true); return; }
    var btn = el('r-respaldar');
    btn.disabled = true;
    var txt = btn.textContent;
    btn.textContent = 'Respaldando...';
    setMsg('Comprobando el acceso a tu Drive...');
    pingEndpoint().then(function (ok) {
      if (!ok) throw new Error('Sin acceso a Drive');
      setMsg('Subiendo la copia a tu Drive...');
      return leerBaseBytes();
    }).then(function (res) {
      var nombre = nombreRespaldo(new Date());
      return llamarEndpoint({ accion: 'subir', correo: cfg.correo, clave: cfg.clave, nombre: nombre, datos: bufToB64(res.bytes) }).then(function (json) {
        return { json: json, size: res.size };
      });
    }).then(function (r) {
      localStorage.setItem(LS_ULTIMO, String(Date.now()));
      if (r.json.total != null) localStorage.setItem(LS_COPIAS, String(r.json.total));
      actualizarStats();
      setMsg('Respaldo guardado en tu Drive: ' + r.json.nombre + ' (' + fmtTamano(r.size) + ').');
      return listarCopias();
    }).catch(function (e) {
      setMsg('No se pudo respaldar: ' + e.message, true);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = txt;
      actualizarDistintivo();
    });
  }
  function restaurarCopia(nombre) {
    var cfg = config();
    if (!cfg.url || !cfg.correo) { setMsg('Configura primero el correo y la URL de tu Apps Script para usar la nube.', true); return; }
    if (!navigator.onLine) { setMsg('Sin conexión: restaurar necesita internet.', true); return; }
    if (!confirm('¿Restaurar ' + nombre + '?\n\nEsto reemplaza TODO lo que hay ahora en este teléfono por esa copia. Lo que no esté respaldado se pierde.')) return;
    setMsg('Descargando la copia de tu Drive...');
    llamarEndpoint({ accion: 'descargar', correo: cfg.correo, clave: cfg.clave, nombre: nombre }).then(function (json) {
      if (!json.datos) throw new Error('La copia llegó vacía.');
      var buf = b64ToBuf(json.datos);
      var cabecera = String.fromCharCode.apply(null, new Uint8Array(buf, 0, 15));
      if (buf.byteLength < 100 || cabecera !== 'SQLite format 3') {
        throw new Error('La copia descargada no es una base SQLite válida.');
      }
      setMsg('Cerrando la base y escribiendo la copia...');
      if (typeof closeDb !== 'function') throw new Error('La capa de datos no expone el cierre (closeDb).');
      return closeDb().then(function () { return escribirBaseBytes(buf); });
    }).then(function () {
      setMsg('Copia restaurada. Recargando...');
      setTimeout(function () { location.reload(); }, 800);
    }).catch(function (e) {
      setMsg('No se pudo restaurar: ' + e.message, true);
    });
  }
  function restaurarMasReciente() {
    var cfg = config();
    if (!cfg.url || !cfg.correo) { setMsg('Configura primero el correo y la URL de tu Apps Script para usar la nube.', true); return; }
    if (!navigator.onLine) { setMsg('Sin conexión: restaurar necesita internet.', true); return; }
    setMsg('Buscando la copia más reciente...');
    pingEndpoint().then(function (ok) {
      if (!ok) throw new Error('Sin acceso a Drive');
      return llamarEndpoint({ accion: 'listar', correo: cfg.correo, clave: cfg.clave });
    }).then(function (json) {
      var copias = json.copias || [];
      localStorage.setItem(LS_COPIAS, String(copias.length));
      el('r-copias').textContent = String(copias.length);
      renderLista(copias);
      if (!copias.length) { setMsg('No hay copias en la nube todavía. Respaldar primero.', true); return; }
      restaurarCopia(copias[0].nombre);
    }).catch(function (e) {
      setMsg('No se pudo restaurar: ' + e.message, true);
    });
  }
  function descargarLocal() {
    setMsg('Preparando la copia local...');
    leerBaseBytes().then(function (res) {
      var nombre = nombreRespaldo(new Date());
      var blob = new Blob([res.bytes], { type: 'application/x-sqlite3' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      setMsg('Copia descargada: ' + nombre + ' (' + fmtTamano(res.size) + '). Guárdala donde quieras: Drive, WhatsApp, Telegram.');
    }).catch(function (e) {
      setMsg('No se pudo descargar la copia: ' + e.message, true);
    });
  }
  function abrirRespaldo() {
    guardarConfig();
    actualizarStats();
    var cfg = config();
    if (!cfg.url || !cfg.correo) { actualizarDistintivo(); return; }
    if (!navigator.onLine) { actualizarDistintivo(); return; }
    pingEndpoint().then(function (ok) {
      if (ok) listarCopias();
    });
  }

  /* ---------------- Arranque ---------------- */
  function initRespaldo() {
    var cfg = config();
    el('r-correo').value = cfg.correo;
    el('r-url').value = cfg.url;
    el('r-clave').value = cfg.clave;
    ['r-correo', 'r-url', 'r-clave'].forEach(function (id) {
      el(id).addEventListener('change', guardarConfig);
    });
    el('r-respaldar').onclick = respaldarAhora;
    el('r-restaurar').onclick = restaurarMasReciente;
    el('r-descargar').onclick = descargarLocal;
    var tabBtn = document.querySelector('[data-tab="respaldo"]');
    if (tabBtn) tabBtn.addEventListener('click', abrirRespaldo);
    window.addEventListener('online', function () { onlineConfirmado = null; actualizarDistintivo(); });
    window.addEventListener('offline', function () { onlineConfirmado = null; actualizarDistintivo(); });
    actualizarDistintivo();
    actualizarStats();
  }
  try { initRespaldo(); } catch (e) { /* la pestaña Respaldo no existe en este HTML */ }
})();
