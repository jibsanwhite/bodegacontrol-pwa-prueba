/* ============================================================================
   Asistente de Alo Rico Rico — UI del chat (página del sistema, producción).
   Se carga con <script src="asistente_ui.js"> en la página principal.
   - Modo servidor (producción): pregunta a Asistente.gs por
     google.script.run.asistentePreguntar, o por fetch al endpoint doPost
     (window.ASISTENTE_ENDPOINT) cuando la página no es de Apps Script
     (PWA de BodegaControl). El servidor corre el motor primero y Gemini
     después, con datos en vivo.
   - Modo local (TEST): si la página define window.ASISTENTE_SNAP y carga
     AsistenteMotor.js, responde con el motor en el navegador (sin Gemini).
     La PWA define window.construirSnapshotAsistente() y el snapshot se
     construye desde su SQLite local en cada pregunta.
   - Sin google.script.run, sin endpoint ni snapshot: avisa que necesita
     la página del sistema; nunca inventa una respuesta.
   CONEXIÓN (orden de D.J., 24/11): con conexión el asistente puede usar
   la IA; sin conexión NO puede y responde solo con el motor de reglas
   locales, diciéndolo claro.
   - hayConexion() = navigator.onLine distinto de false Y el servidor no
     está marcado caído. Una llamada al servidor fallida marca
     servidorCaido=true; se limpia con el evento 'online' del navegador
     o cuando una llamada vuelve a funcionar.
   - Sin red (navigator.onLine === false): NUNCA se llama al servidor.
     Si el motor cubre la pregunta, responde con "· reglas locales"; si
     no la cubre: "Sin conexión no puedo consultar a la IA; con conexión
     sí respondo esa pregunta."
   - Con red y servidor caído: si el motor cubre, responde del motor sin
     esperar al servidor; si no cubre, reintenta el servidor una vez.
   - Si el servidor falla: se prueba el motor local si está disponible;
     solo si no hay ni servidor ni motor, sale "No pude hablar con el
     servidor del sistema".
   El encabezado del panel muestra el estado: "● En línea · IA
   disponible" (verde) o "● Sin conexión · solo reglas locales" (ámbar),
   y el saludo dice en qué modo está.
   Config opcional antes de cargar este archivo: window.ASISTENTE_TITULO,
   window.ASISTENTE_PREGUNTAS (chips), window.ASISTENTE_LOGO,
   window.ASISTENTE_ENDPOINT (URL del doPost).
   Diseño: mismo botón de la prueba del 23/11 (78px, abajo 28px, panel a
   122px), corregido por D.J. ese día.
   ========================================================================== */
(function () {
'use strict';

var LOGO = window.ASISTENTE_LOGO || null; // data URI o URL; si no hay, avatar con letras
var TITULO = window.ASISTENTE_TITULO || 'Asistente de Alo Rico Rico';
var PREGUNTAS = window.ASISTENTE_PREGUNTAS || ['¿Cuánto vendí hoy?', '¿Cuánto hay en caja?', '¿Quién me debe?',
  '¿Cuánto queda de Arroz x Lb?', '¿Puedo cerrar el día?'];
var MSG_SIN_CONEXION = 'Sin conexión no puedo consultar a la IA; con conexión sí respondo esa pregunta.';
var MSG_SIN_GEMINI_TEST = 'Esa pregunta necesita el análisis de Gemini y en esta prueba no está conectado. En la página del sistema sí responde.';
var MSG_SIN_SERVIDOR = 'No pude hablar con el servidor del sistema. Revisa la conexión y prueba de nuevo.';
var MSG_SIN_DATOS = 'El asistente necesita la página del sistema para responder. Aquí no tengo los datos.';
var MSG_SIN_CONEXION_SERVIDOR = 'Sin conexión no puedo hablar con el servidor del sistema. Con conexión sí respondo esa pregunta.';

var CSS = '' +
'#asBtn{position:fixed;right:18px;bottom:28px;width:78px;height:78px;border-radius:50%;border:3px solid #fff;background:#1B4D2E;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;z-index:45;padding:0;overflow:hidden}' +
'#asBtn img{width:100%;height:100%;object-fit:cover;display:block;transform:scale(1.18)}' +
'#asBtn .asLogoTxt{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1.5rem;font-family:system-ui,sans-serif}' +
'#asPanel{position:fixed;right:16px;bottom:122px;width:380px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 120px);background:#fff;border:1.5px solid #1B4D2E;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.3);z-index:46;display:none;flex-direction:column;overflow:hidden;font-size:15px}' +
'#asPanel.abierto{display:flex}' +
'#asHead{background:#1B4D2E;color:#fff;padding:.7rem .9rem;display:flex;gap:.6rem;align-items:center}' +
'#asHead img{width:38px;height:38px;border-radius:50%;border:2px solid #fff;object-fit:cover;flex:none}' +
'#asHead .asLogoTxt{width:38px;height:38px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9rem;flex:none}' +
'#asHead .t{flex:1;line-height:1.25}' +
'#asHead .t b{font-size:.95rem}' +
'#asHead .t small{display:block;font-size:.75rem;color:#EAF6EC;opacity:1}' +
'#asEstado{display:block;font-size:.72rem;font-weight:700}' +
'#asEstado.en-linea{color:#BBF7D0}' +
'#asEstado.sin-conexion{color:#FDE68A}' +
'#asCerrar{background:none;border:0;color:#fff;font-size:1.4rem;cursor:pointer;padding:.2rem .5rem;line-height:1}' +
'#asBody{flex:1;overflow-y:auto;padding:.8rem;display:flex;flex-direction:column;gap:.6rem;background:#F8FAFC}' +
'.asMsg{max-width:92%;padding:.6rem .8rem;border-radius:12px;line-height:1.45;white-space:normal;word-wrap:break-word}' +
'.asMsg small{color:#475569}' +
'.asBot{background:#fff;border:1px solid #E2E8F0;align-self:flex-start;border-bottom-left-radius:4px}' +
'.asYo{background:#1B4D2E;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
'.asEscribiendo{color:#64748B;font-style:italic}' +
'#asChips{display:flex;flex-wrap:wrap;gap:.4rem;padding:.5rem .8rem;background:#fff;border-top:1px solid #E2E8F0}' +
'#asChips button{border:1.5px solid #1B4D2E;background:#fff;color:#1B4D2E;border-radius:20px;padding:.4rem .7rem;font-size:.82rem;cursor:pointer;min-height:36px}' +
'#asInputRow{display:flex;gap:.5rem;padding:.6rem .8rem;background:#fff;border-top:1px solid #E2E8F0}' +
'#asInput{flex:1;border:1.5px solid #CBD5E1;border-radius:10px;padding:.6rem;font-size:1rem;min-height:44px;margin:0}' +
'#asEnviar{background:#1B4D2E;color:#fff;border:0;border-radius:10px;padding:.6rem 1rem;font-weight:700;cursor:pointer;min-height:44px}' +
'#asEnviar:disabled{opacity:.5;cursor:default}';

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function avatarHtml(clase) {
  if (LOGO) return '<img alt="Asistente" src="' + LOGO + '"' + (clase ? ' class="' + clase + '"' : '') + '>';
  return '<span class="asLogoTxt">AR</span>';
}

/* Una llamada al servidor fallida marca sin conexión hasta que una llamada
   vuelva a funcionar o el navegador avise que la red volvió ('online'). */
var servidorCaido = false;
function redDisponible() {
  return (typeof navigator === 'undefined') || navigator.onLine !== false;
}
function hayConexion() {
  return redDisponible() && !servidorCaido;
}
function tieneGoogle() {
  return typeof google !== 'undefined' && google.script && google.script.run;
}
function endpointUrl() {
  return (window.ASISTENTE_ENDPOINT || '').toString().trim();
}
function tieneServidor() {
  return tieneGoogle() || !!endpointUrl();
}
function actualizarEstadoConexion() {
  var n = document.getElementById('asEstado');
  if (!n) return;
  var e = estadoConexion();
  n.textContent = e.texto;
  n.className = e.clase;
}
/* Tres estados honestos: sin conexión; en línea pero sin servidor (la
   prueba local no tiene la IA conectada); en línea con servidor (IA). */
function estadoConexion() {
  if (!hayConexion()) return { texto: '● Sin conexión · solo reglas locales', clase: 'sin-conexion' };
  if (!tieneServidor()) return { texto: '● En línea · solo reglas locales', clase: 'en-linea' };
  return { texto: '● En línea · IA disponible', clase: 'en-linea' };
}

function montar() {
  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  var btn = document.createElement('button');
  btn.id = 'asBtn';
  btn.setAttribute('aria-label', 'Asistente del negocio');
  btn.innerHTML = avatarHtml();
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.id = 'asPanel';
  panel.innerHTML =
    '<div id="asHead">' + avatarHtml() + '<div class="t"><b>' + esc(TITULO) + '</b><small id="asSub">Datos en vivo del sistema</small><span id="asEstado" class="en-linea">● En línea · IA disponible</span></div><button id="asCerrar" aria-label="Cerrar">✕</button></div>' +
    '<div id="asBody"></div>' +
    '<div id="asChips"></div>' +
    '<div id="asInputRow"><input id="asInput" type="text" placeholder="Pregúntame algo…" autocomplete="off"><button id="asEnviar">Enviar</button></div>';
  document.body.appendChild(panel);

  var body = panel.querySelector('#asBody');
  var chips = panel.querySelector('#asChips');
  var input = panel.querySelector('#asInput');
  var enviarBtn = panel.querySelector('#asEnviar');
  var sub = panel.querySelector('#asSub');
  var abierto = false, saludado = false, esperando = false;

  /* El botón solo vive dentro de la sesión: nunca sobre la pantalla de
     login y nunca para el rol cliente (el asistente responde con datos
     del dueño: ventas, caja, deudas). En la PWA no hay login ni sesión
     y el botón se muestra siempre. */
  function loginVisible() {
    var lp = document.getElementById('loginPantalla');
    return !!lp && window.getComputedStyle(lp).display !== 'none';
  }
  function rolPermitido() {
    var s = window.sesion;
    if (!s || !s.rol) return true;
    return s.rol === 'admin' || s.rol === 'supervisor';
  }
  function actualizarVisibilidadAsistente() {
    var mostrar = !loginVisible() && rolPermitido();
    btn.style.display = mostrar ? '' : 'none';
    if (!mostrar) { panel.classList.remove('abierto'); abierto = false; }
  }
  var lp0 = document.getElementById('loginPantalla');
  if (lp0 && typeof MutationObserver !== 'undefined') {
    var obsLogin = new MutationObserver(function () { actualizarVisibilidadAsistente(); });
    obsLogin.observe(lp0, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  actualizarVisibilidadAsistente();

  PREGUNTAS.forEach(function (p) {
    var c = document.createElement('button');
    c.type = 'button';
    c.textContent = p;
    c.addEventListener('click', function () { enviar(p); });
    chips.appendChild(c);
  });

  window.addEventListener('online', function () { servidorCaido = false; actualizarEstadoConexion(); });
  window.addEventListener('offline', function () { actualizarEstadoConexion(); });
  actualizarEstadoConexion();

  function burbuja(html, quien) {
    var d = document.createElement('div');
    d.className = 'asMsg ' + (quien === 'yo' ? 'asYo' : 'asBot');
    d.innerHTML = html;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  }
  function saludo() {
    var modo;
    if (!hayConexion())
      modo = '<br><br><small>Sin conexión: respondo solo con las reglas locales (ventas, caja, deudas, stock). Con conexión puedo consultar a la IA.</small>';
    else if (!tieneServidor())
      modo = '<br><br><small>Con conexión, pero esta prueba no tiene la IA conectada: respondo solo con las reglas locales.</small>';
    else
      modo = '<br><br><small>Con conexión: si la pregunta no la cubren las reglas, consulto a la IA (Gemini).</small>';
    return 'Hola, soy el asistente de tu negocio. Te ayudo con las ventas, el inventario y la caja. ¿En qué puedo ayudarte hoy?' + modo +
      '<br><br><small>Nada de lo que me pidas aquí se registra de verdad todavía: si te digo que algo es un borrador, es porque el registro llega en el siguiente paso.</small>';
  }
  function tieneMotorLocal() {
    return !!(window.AsistenteMotor && window.AsistenteMotor.responder &&
      (window.ASISTENTE_SNAP || typeof window.construirSnapshotAsistente === 'function'));
  }
  /* El snapshot local: fijo (TEST) o construido en el momento desde la
     SQLite de la PWA (window.construirSnapshotAsistente -> Promise). */
  function obtenerSnapLocal() {
    if (window.ASISTENTE_SNAP) return Promise.resolve(window.ASISTENTE_SNAP);
    if (typeof window.construirSnapshotAsistente === 'function') {
      try { return Promise.resolve(window.construirSnapshotAsistente()); }
      catch (e) { return Promise.reject(e); }
    }
    return Promise.reject(new Error('sin snapshot local'));
  }
  function etiquetaSnap(snap) {
    return ((snap.actualizadoFecha || '') + ' ' + (snap.actualizadoHora || '')).trim();
  }

  function enviar(texto) {
    var t = (texto || '').trim();
    if (!t || esperando) return;
    burbuja(esc(t), 'yo');
    input.value = '';
    esperando = true;
    enviarBtn.disabled = true;
    var pensando = burbuja('<span class="asEscribiendo">Escribiendo…</span>', 'bot');

    function responder(html, fuente, actualizado) {
      pensando.remove();
      if (actualizado) sub.textContent = 'Datos en vivo · ' + actualizado;
      var extra = '';
      if (fuente === 'gemini') extra = '<br><small>· con Gemini</small>';
      else if (fuente === 'motor') extra = '<br><small>· reglas locales</small>';
      burbuja(html + extra, 'bot');
      esperando = false;
      enviarBtn.disabled = false;
      input.focus();
    }
    function fallar(msg) {
      pensando.remove();
      burbuja(esc(msg), 'bot');
      esperando = false;
      enviarBtn.disabled = false;
      input.focus();
    }

    /* Solo motor local. offline=true: sin red, nunca se toca el servidor;
       offline=false: no hay servidor configurado (TEST), el motor es todo
       lo que hay y Gemini no está conectado en esta prueba. */
    function responderSoloMotor(offline) {
      if (!tieneMotorLocal()) {
        fallar(offline ? MSG_SIN_CONEXION_SERVIDOR : MSG_SIN_DATOS);
        return;
      }
      obtenerSnapLocal().then(function (snap) {
        var r;
        try { r = window.AsistenteMotor.responder(t, snap); }
        catch (e) { fallar('Me trabé con esa pregunta. Prueba con una de las de arriba.'); return; }
        if (r.cubierto) responder(r.html, 'motor', etiquetaSnap(snap));
        else fallar(offline ? MSG_SIN_CONEXION : MSG_SIN_GEMINI_TEST);
      }).catch(function () {
        fallar('No pude leer los datos del negocio para responder. Recarga la página y prueba de nuevo.');
      });
    }

    /* El servidor falló: marcar caído, probar el motor local si lo hay;
       solo si no hay ni servidor ni motor, el mensaje de siempre. */
    function alFalloServidor() {
      servidorCaido = true;
      actualizarEstadoConexion();
      if (!tieneMotorLocal()) { fallar(MSG_SIN_SERVIDOR); return; }
      obtenerSnapLocal().then(function (snap) {
        var r;
        try { r = window.AsistenteMotor.responder(t, snap); }
        catch (e) { fallar(MSG_SIN_SERVIDOR); return; }
        if (r.cubierto) responder(r.html, 'motor', etiquetaSnap(snap));
        else fallar(MSG_SIN_CONEXION);
      }).catch(function () { fallar(MSG_SIN_SERVIDOR); });
    }

    function llamarServidor(ok, err) {
      if (tieneGoogle()) {
        try {
          google.script.run
            .withSuccessHandler(function (res) { ok(res); })
            .withFailureHandler(function (e) { err(e); })
            .asistentePreguntar(t);
        } catch (e) { err(e); }
        return;
      }
      var url = endpointUrl();
      if (!url) { err(new Error('sin endpoint')); return; }
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var to = null;
      if (ctrl) to = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* ya abortado */ } }, 25000);
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ pregunta: t }),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (resp) {
        if (to) clearTimeout(to);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      }).then(function (res) { ok(res); })
      .catch(function (e) { if (to) clearTimeout(to); err(e); });
    }

    /* 1. Sin red: motor local y nada más. Nunca se llama al servidor. */
    if (!redDisponible()) { responderSoloMotor(true); return; }

    /* 2. Con red y servidor: el servidor (motor primero, Gemini después).
       Si el servidor ya falló antes y el motor cubre, responder del motor
       sin esperar al servidor; si no cubre, reintentar el servidor una vez
       (puede haber vuelto). */
    if (tieneServidor()) {
      if (servidorCaido && tieneMotorLocal()) {
        obtenerSnapLocal().then(function (snap) {
          var r;
          try { r = window.AsistenteMotor.responder(t, snap); }
          catch (e) { r = { cubierto: false }; }
          if (r.cubierto) { responder(r.html, 'motor', etiquetaSnap(snap)); return; }
          llamarServidor(function (res) {
            servidorCaido = false;
            actualizarEstadoConexion();
            if (res && res.ok) responder(res.html, res.fuente, res.actualizado);
            else fallar((res && res.error) || 'No pude responder esa pregunta.');
          }, alFalloServidor);
        }).catch(function () { alFalloServidor(); });
        return;
      }
      llamarServidor(function (res) {
        servidorCaido = false;
        actualizarEstadoConexion();
        if (res && res.ok) responder(res.html, res.fuente, res.actualizado);
        else fallar((res && res.error) || 'No pude responder esa pregunta.');
      }, alFalloServidor);
      return;
    }

    /* 3. Con red, sin servidor (TEST local): solo el motor. */
    responderSoloMotor(false);
  }

  function abrir() {
    panel.classList.add('abierto');
    abierto = true;
    actualizarEstadoConexion();
    if (!saludado) { burbuja(saludo(), 'bot'); saludado = true; }
    input.focus();
  }
  function cerrar() { panel.classList.remove('abierto'); abierto = false; }

  btn.addEventListener('click', function () { abierto ? cerrar() : abrir(); });
  panel.querySelector('#asCerrar').addEventListener('click', cerrar);
  enviarBtn.addEventListener('click', function () { enviar(input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); enviar(input.value); } });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
else montar();
})();
