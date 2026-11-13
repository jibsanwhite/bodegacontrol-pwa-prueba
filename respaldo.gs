/* ============================================================================
   BodegaControl — Respaldo en la nube (Apps Script, un archivo).
   Guarda la copia completa de la base de la PWA (archivo .sqlite3) en
   el Google Drive DEL NEGOCIO. Cada cliente copia este archivo a SU
   propio proyecto de Apps Script: las copias de un negocio nunca van
   al Drive de otro negocio ni al de BodegaControl.
   Organización automática (reglas fijas, sin IA):
     BodegaControl / Respaldos / <correo-del-negocio> /
       respaldo-AAAA-MM-DD_HH-MM-SS.sqlite3
   Se guardan las últimas 5 copias; las más viejas pasan a Mensuales/
   (una por mes, la primera de ese mes) y el resto se va a la papelera.
   Acciones (POST JSON a la URL /exec):
     ping      {accion:'ping'} -> {ok:true}
     subir     {accion:'subir', correo, clave, nombre, datos} (datos =
               base64 de la base) -> {ok, nombre, tamano, total}
     listar    {accion:'listar', correo, clave} -> {ok, copias:
               [{nombre, fecha, tamano, carpeta}]}
     descargar {accion:'descargar', correo, clave, nombre} -> {ok,
               nombre, tamano, datos} (datos = base64)
   La clave viaja en cada petición y se compara con la propiedad del
   script CLAVE_RESPALDO. Sin clave correcta no se lee ni se escribe
   nada. La clave NO va en este código: va en Propiedades del script.
   ----------------------------------------------------------------------------
   DESPLIEGUE (el dueño del negocio, una sola vez):
   1. En el Drive de la cuenta de Google del negocio, abre
      script.google.com y crea un "Nuevo proyecto".
   2. Borra el contenido de Code.gs y pega TODO este archivo. Guarda.
   3. Propiedades del script: en el editor, abre la rueda (Configuración
      del proyecto) -> "Propiedades del script" -> "Añadir propiedad":
      nombre: CLAVE_RESPALDO
      valor:  una clave inventada por ti (letras y números, sin espacios).
      Guárdala: es la misma clave que escribirás en la app. Sin ella el
      respaldo no funciona (así nadie con la URL puede tocar tus copias).
   4. Implementar -> Nueva implementación -> tipo "Aplicación web":
      "Ejecutar como: Yo" y "Quién tiene acceso: Cualquiera".
      Implementar y autoriza con tu cuenta (Google avisará que la app no
      está verificada: sigue con tu cuenta, es tu propio script).
   5. Copia la URL de la implementación (termina en /exec).
   6. En la PWA: pestaña Respaldo -> escribe el correo del negocio
      (cuenta de Google), pega la URL y escribe la misma clave.
      Toca "Respaldar ahora". La primera copia crea las carpetas sola.
   ----------------------------------------------------------------------------
   Sin datos reales en este archivo. No lleva cuentas ni credenciales.
   ========================================================================== */

var RAIZ = 'BodegaControl';
var RESPALDOS = 'Respaldos';
var MENSUALES = 'Mensuales';
var MAX_COPIAS = 5;
var PREFIJO = 'respaldo-';

function doGet(e) {
  return salida_({ ok: true, servicio: 'respaldo-bodegacontrol', accion: 'ping' });
}

function doPost(e) {
  try {
    var contenido = (e.postData && e.postData.contents) || '{}';
    var req = JSON.parse(contenido);
    return salida_(atender_(req));
  } catch (err) {
    return salida_({ ok: false, error: 'Error: ' + err });
  }
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function atender_(req) {
  var accion = req.accion || '';
  if (accion === 'ping') return { ok: true, servicio: 'respaldo-bodegacontrol' };
  var correo = String(req.correo || '').trim().toLowerCase();
  if (!correo || correo.indexOf('@') < 0) {
    return { ok: false, error: 'Falta el correo del negocio.' };
  }
  if (!claveOk_(req.clave)) {
    return { ok: false, error: 'Clave del respaldo incorrecta o sin configurar en el script (propiedad CLAVE_RESPALDO).' };
  }
  var carpeta = carpetaNegocio_(correo);
  if (accion === 'subir') return subir_(carpeta, req);
  if (accion === 'listar') return listar_(carpeta);
  if (accion === 'descargar') return descargar_(carpeta, req.nombre);
  return { ok: false, error: 'Acción desconocida: ' + accion };
}

function claveOk_(clave) {
  var esperada = PropertiesService.getScriptProperties().getProperty('CLAVE_RESPALDO');
  if (!esperada) return false;
  return String(clave || '') === esperada;
}

function carpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return padre.createFolder(nombre);
}

function carpetaNegocio_(correo) {
  var raiz = carpeta_(DriveApp.getRootFolder(), RAIZ);
  var resp = carpeta_(raiz, RESPALDOS);
  return carpeta_(resp, correo);
}

function carpetaMensuales_(carpeta, crear) {
  var it = carpeta.getFoldersByName(MENSUALES);
  if (it.hasNext()) return it.next();
  return crear ? carpeta.createFolder(MENSUALES) : null;
}

function nombreAuto_() {
  var f = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
  return PREFIJO + f + '.sqlite3';
}

function subir_(carpeta, req) {
  if (!req.datos) return { ok: false, error: 'Faltan los datos de la copia.' };
  var nombre = String(req.nombre || '');
  if (!/^respaldo-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sqlite3$/.test(nombre)) {
    nombre = nombreAuto_();
  }
  var bytes = Utilities.base64Decode(req.datos);
  if (!bytes || !bytes.length) return { ok: false, error: 'La copia llegó vacía.' };
  carpeta.createFile(Utilities.newBlob(bytes, 'application/x-sqlite3', nombre));
  var total = podar_(carpeta);
  return { ok: true, nombre: nombre, tamano: bytes.length, total: total };
}

function listar_(carpeta) {
  var copias = listarEn_(carpeta, 'Drive');
  var men = carpetaMensuales_(carpeta, false);
  if (men) copias = copias.concat(listarEn_(men, 'Mensuales'));
  copias.sort(function (a, b) { return b.nombre < a.nombre ? -1 : 1; });
  return { ok: true, copias: copias };
}

function listarEn_(carpeta, donde) {
  var out = [];
  var it = carpeta.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(PREFIJO) !== 0) continue;
    out.push({ nombre: f.getName(), fecha: f.getLastUpdated().getTime(), tamano: f.getSize(), carpeta: donde });
  }
  return out;
}

function descargar_(carpeta, nombre) {
  if (!nombre) return { ok: false, error: 'Falta el nombre de la copia.' };
  var f = buscar_(carpeta, nombre);
  if (!f) {
    var men = carpetaMensuales_(carpeta, false);
    if (men) f = buscar_(men, nombre);
  }
  if (!f) return { ok: false, error: 'No se encontró la copia: ' + nombre };
  return { ok: true, nombre: f.getName(), tamano: f.getSize(), datos: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function buscar_(carpeta, nombre) {
  var it = carpeta.getFilesByName(nombre);
  return it.hasNext() ? it.next() : null;
}

/* Deja las últimas MAX_COPIAS en la carpeta del negocio. De las viejas,
   la primera de cada mes pasa a Mensuales/ (una por mes) y el resto va
   a la papelera. Devuelve cuántas copias quedan en la carpeta. */
function podar_(carpeta) {
  var files = [];
  var it = carpeta.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(PREFIJO) === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
  var men = null;
  for (var i = MAX_COPIAS; i < files.length; i++) {
    var viejo = files[i];
    var mes = viejo.getName().slice(9, 16); /* 'respaldo-' son 9 letras: yyyy-MM */
    if (!men) men = carpetaMensuales_(carpeta, true);
    if (!hayDelMes_(men, mes)) {
      try {
        viejo.moveTo(men);
      } catch (e) {
        men.createFile(viejo.getBlob());
        viejo.setTrashed(true);
      }
    } else {
      viejo.setTrashed(true);
    }
  }
  return Math.min(files.length, MAX_COPIAS);
}

function hayDelMes_(men, mes) {
  var it = men.getFiles();
  while (it.hasNext()) {
    var n = it.next().getName();
    if (n.indexOf(PREFIJO) === 0 && n.slice(9, 16) === mes) return true;
  }
  return false;
}
