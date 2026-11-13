# BodegaControl PWA (prueba)

Aplicación web instalable (PWA) para llevar una bodega sin conexión a internet:
vender, fiar, controlar el stock y cerrar el día, todo guardado en el
propio teléfono.

URL en vivo: https://jibsanwhite.github.io/bodegacontrol-pwa-prueba/

## Qué hace (Fase 1)

- Vender en efectivo, por transferencia o a crédito (fiado).
- Productos con stock y alerta de stock mínimo; cantidades con decimales
  (Lb, kg, L...).
- Fiados con abonos parciales y marca de pagado.
- Cierre de caja del día con conteo y diferencia; recogidas de efectivo
  (Fondo).
- Importar productos desde CSV.
- Reportes y auditoría.
- Funciona sin internet una vez cargada (service worker); los datos viven
  en el teléfono.

## Qué hace (Fase 2: turnos y dependientes)

- Turno por dependiente: un solo turno abierto por dependiente, con
  fondo inicial en CUP.
- Una venta solo se registra si el dependiente tiene turno abierto; cada
  venta queda asignada a su dependiente y a su número de turno (efectivo,
  transferencia +30%, fiado).
- Cierre de turno: esperado = fondo inicial + ventas en efectivo −
  recogidas parciales; el dependiente escribe cuánto contó y la
  diferencia se ve (cuadra / sobra / falta). Un turno cerrado ya no
  acepta ventas.
- Recogida parcial durante el turno (saca efectivo de la caja y baja el
  esperado; también queda en la Caja del día, que es la misma caja).
- Dependientes con rendimiento del día (total vendido, nº de ventas,
  turno abierto o no); se pueden añadir y desactivar (nunca se borra
  uno con turnos).
- Transferencia y fiado no entran en el conteo de efectivo, pero sí en
  el resumen del turno.

## Cómo guarda los datos

- Base de datos SQLite real (archivo `bodegacontrol.sqlite3` en OPFS, el
  almacenamiento del navegador).
- Motor: sql.js (SQLite 3.54.1 compilado a WebAssembly). La base vive en
  memoria y se escribe el archivo completo a OPFS después de cada cambio.
- Por qué no la librería oficial de SQLite: sus modos de OPFS exigen
  SharedArrayBuffer (cabeceras COOP/COEP) y GitHub Pages no las envía;
  con sql.js no hace falta nada de eso.
- Una sola pestaña a la vez: si la app está abierta en dos pestañas, la
  segunda avisa que cierre la otra (candado Web Locks).
- Si el teléfono tenía datos de la versión anterior (IndexedDB), se migran
  solos la primera vez y la copia vieja queda como respaldo.

## Estructura

- `index.html` — interfaz; `app.js` — lógica de la interfaz; `style.css`.
- `db.js` — capa de datos (misma interfaz que la versión IndexedDB:
  openDb/all/put/del).
- `db-worker.js` — worker que opera la base con sql.js y la persiste en
  OPFS.
- `db-schema.sql` — esquema SQLite (mismo que el de referencia de
  BodegaControl).
- `vendor/` — sql.js 1.16.0 (sql-wasm.js + sql-wasm.wasm).
- `sw.js` — service worker (caché de los archivos para uso sin conexión).
- `test-opfs.html` — página de diagnóstico (prueba sql.js + OPFS en el
  navegador).
- `manifest.json`, `icon.svg` — instalación como app.

## Probarla

1. Abrir la URL: deben verse 3 productos de ejemplo (Ejemplo A, B y C).
2. Vender 1 Ejemplo A en efectivo: el stock pasa de 50 a 49.
3. Vender 1 Ejemplo B a crédito: aparece en Fiados; abonar una parte y
   luego el resto: queda Pagado.
4. Stock: Ejemplo C muestra alerta (stock 3, mínimo 5).
5. Cerrar el día con un conteo: el cierre queda guardado.
6. Cerrar la app, volver a abrirla y recargar: todo sigue ahí.
7. No abrirla en dos pestañas a la vez.

## Publicar cambios

Es un sitio estático en GitHub Pages: cada cambio a `main` se publica
solo al cabo de unos minutos. El service worker guarda los archivos en
caché, así que después de un cambio puede tardar unos minutos en verse
la versión nueva (cerrar la pestaña y volver a abrir).

## Estado

Prueba (Fase 1 + Fase 2: turnos y dependientes). La base de los
teléfonos con Fase 1 se migra sola al abrir la app (tablas nuevas y
columna turno_id; las ventas viejas quedan sin turno, legibles).
