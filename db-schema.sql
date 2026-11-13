-- ============================================================================
-- BodegaControl PWA — esquema SQLite (OPFS, API asincrona OpfsDb)
-- Copia del esquema de referencia (~/workspace/bodegacontrol-sqlite/
-- esquema.sql, v1) con extensiones PWA marcadas con "PWA:".
-- Las extensiones existen porque la interfaz de la PWA guarda campos que el
-- esquema de referencia no tiene (venta anulada, unidad de venta, detalle
-- del fiado, conteo de caja). Nada de la referencia cambia de nombre.
-- Moneda: CUP. Fechas: TEXT ISO 'YYYY-MM-DD'. Timestamps: INTEGER ms (epoch).
-- Cantidades REAL (no INTEGER): hay productos por peso con fracciones.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- Productos. PWA antes: store IndexedDB 'productos'.
CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT UNIQUE,
    name          TEXT NOT NULL,
    category      TEXT,
    unit          TEXT,
    cost          REAL NOT NULL DEFAULT 0,
    cashPrice     REAL NOT NULL DEFAULT 0,
    transferPrice REAL NOT NULL DEFAULT 0,
    stock         REAL NOT NULL DEFAULT 0,
    stock_inicial REAL NOT NULL DEFAULT 0,
    minStock      REAL NOT NULL DEFAULT 0,
    fifo_cost     REAL,
    adjustment    REAL NOT NULL DEFAULT 0,
    adjustment_date TEXT,
    in_catalog    INTEGER NOT NULL DEFAULT 0,
    createdAt     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Lotes de compra. La PWA Fase 1 no compra lotes; la tabla existe para que
-- la base tenga la misma forma que la referencia (y la APK en el futuro).
CREATE TABLE IF NOT EXISTS purchases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_number      INTEGER,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    product_name    TEXT NOT NULL,
    date            TEXT,
    quantity        REAL NOT NULL DEFAULT 0,
    unit_cost       REAL NOT NULL DEFAULT 0,
    total_cost      REAL NOT NULL DEFAULT 0,
    sale_price      REAL,
    transfer_price  REAL,
    supplier        TEXT,
    losses          REAL NOT NULL DEFAULT 0,
    notes           TEXT,
    lot_sold        REAL NOT NULL DEFAULT 0,
    lot_remaining   REAL NOT NULL DEFAULT 0,
    createdAt       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id, date);
CREATE INDEX IF NOT EXISTS idx_purchases_lot ON purchases(lot_number);

-- Ventas. PWA antes: store IndexedDB 'ventas'.
-- PWA: cantidadVenta/unidadVenta = lo que el cliente pidio (ej. 500 g);
-- quantity = cantidad en unidad de stock. anulada = venta anulada (la UI
-- la muestra como ANULADA y devuelve el stock). fiadoId = id en
-- credit_sales cuando la venta es a credito.
CREATE TABLE IF NOT EXISTS sales (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     INTEGER NOT NULL DEFAULT 0,
    date          TEXT,
    code          TEXT UNIQUE,
    productId     INTEGER NOT NULL REFERENCES products(id),
    productName   TEXT NOT NULL,
    quantity      REAL NOT NULL DEFAULT 0,
    unitPrice     REAL NOT NULL DEFAULT 0,
    total         REAL NOT NULL DEFAULT 0,
    paymentMethod TEXT,
    client_name   TEXT,
    client_id     INTEGER REFERENCES clients(id),
    category      TEXT,
    notes         TEXT,
    costUnit      REAL,
    costTotal     REAL,
    profit        REAL,
    credit_amount REAL NOT NULL DEFAULT 0,
    cantidadVenta REAL,
    unidadVenta   TEXT,
    fiadoId       INTEGER,
    turno_id      INTEGER,
    anulada       INTEGER NOT NULL DEFAULT 0,
    createdAt     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(productId, timestamp);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_client ON sales(client_name);
CREATE INDEX IF NOT EXISTS idx_sales_turno ON sales(turno_id);

-- Ventas a credito (fiados). PWA antes: store IndexedDB 'fiados'.
-- PWA: detalle = texto que muestra la UI (ej. "2 Lb x Ejemplo A");
-- anulada = fiado anulado al anular su venta (no es lo mismo que pagado).
CREATE TABLE IF NOT EXISTS credit_sales (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL DEFAULT 0,
    clientName  TEXT NOT NULL,
    productId   INTEGER NOT NULL REFERENCES products(id),
    productName TEXT NOT NULL,
    quantity    REAL NOT NULL DEFAULT 0,
    total       REAL NOT NULL DEFAULT 0,
    amountPaid  REAL NOT NULL DEFAULT 0,
    isPaid      INTEGER NOT NULL DEFAULT 0,
    sale_code   TEXT UNIQUE,
    turno_id    INTEGER,
    detalle     TEXT,
    anulada     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_credit_client ON credit_sales(clientName);
CREATE INDEX IF NOT EXISTS idx_credit_sale ON credit_sales(sale_code);
CREATE INDEX IF NOT EXISTS idx_credit_turno ON credit_sales(turno_id);

-- Abonos a fiados. PWA antes: store IndexedDB 'abonos'.
CREATE TABLE IF NOT EXISTS debt_payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    creditSaleId INTEGER NOT NULL REFERENCES credit_sales(id),
    clientName   TEXT NOT NULL,
    amount       REAL NOT NULL DEFAULT 0,
    turno_id     INTEGER,
    timestamp    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_debt_credit ON debt_payments(creditSaleId);
CREATE INDEX IF NOT EXISTS idx_debt_turno ON debt_payments(turno_id);

-- Cierres de caja diarios. PWA antes: store IndexedDB 'cierres'.
-- PWA: recogidas/conteo/diferencia/ventas son campos del cierre de la UI
-- que la referencia no tiene. grandTotal = cashTotal + transferTotal +
-- debtCollectedTotal (efectivo y transferencia que entraron en el dia).
CREATE TABLE IF NOT EXISTS daily_closes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    closeTimestamp   INTEGER NOT NULL DEFAULT 0,
    dateFormatted    TEXT,
    cashTotal        REAL NOT NULL DEFAULT 0,
    transferTotal    REAL NOT NULL DEFAULT 0,
    creditSalesTotal REAL NOT NULL DEFAULT 0,
    debtCollectedTotal REAL NOT NULL DEFAULT 0,
    grandTotal       REAL NOT NULL DEFAULT 0,
    recogidas        REAL NOT NULL DEFAULT 0,
    conteo           REAL,
    diferencia       REAL,
    ventas           INTEGER NOT NULL DEFAULT 0
);

-- Clientes. La PWA Fase 1 no tiene pantalla de clientes (el fiado guarda
-- solo el nombre en texto); la tabla existe para la misma forma de la base.
CREATE TABLE IF NOT EXISTS clients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT UNIQUE,
    name           TEXT NOT NULL,
    phone          TEXT,
    notes          TEXT,
    first_purchase TEXT,
    last_purchase  TEXT,
    visits         INTEGER NOT NULL DEFAULT 0,
    total_bought   REAL NOT NULL DEFAULT 0,
    avg_ticket     REAL NOT NULL DEFAULT 0,
    level          TEXT,
    createdAt      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

-- Gastos. La PWA Fase 1 no tiene pantalla de gastos.
CREATE TABLE IF NOT EXISTS expenses (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT,
    concept   TEXT NOT NULL,
    category  TEXT,
    amount    REAL NOT NULL DEFAULT 0,
    notes     TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- Asignacion FIFO venta -> lote (la PWA Fase 1 no compra lotes).
CREATE TABLE IF NOT EXISTS lot_allocations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_code  TEXT NOT NULL,
    lot_id     INTEGER NOT NULL REFERENCES purchases(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity   REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alloc_sale ON lot_allocations(sale_code);
CREATE INDEX IF NOT EXISTS idx_alloc_lot ON lot_allocations(lot_id);

-- Fondo unico + cuentas de socio. PWA: recogidas -> fund_movements
-- type='recogida' (la recogida saca efectivo de la caja: amount negativo).
CREATE TABLE IF NOT EXISTS partners (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    share_pct REAL NOT NULL DEFAULT 50
);
CREATE TABLE IF NOT EXISTS fund_movements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT,
    type       TEXT NOT NULL,
    method     TEXT,
    amount     REAL NOT NULL DEFAULT 0,
    partner_id INTEGER REFERENCES partners(id),
    concept    TEXT,
    notes      TEXT,
    createdAt  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fund_date ON fund_movements(date);
CREATE TABLE IF NOT EXISTS loans (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    person  TEXT NOT NULL,
    amount  REAL NOT NULL DEFAULT 0,
    date    TEXT,
    paid    REAL NOT NULL DEFAULT 0,
    notes   TEXT
);

-- ============================================================================
-- Fase 2: turnos y dependientes.
-- Un dependiente tiene como maximo un turno abierto a la vez. Cada venta
-- queda asignada a su dependiente y a su turno (sales.turno_id);
-- turno_id NULL = venta anterior a Fase 2, sin atribuir. El fiado hereda
-- el turno de su venta y el abono hereda el turno de su fiado.
-- Esperado de un turno = fondo_inicial + ventas en efectivo (no anuladas)
-- - recogidas del turno. Transferencia y fiado no entran en el conteo de
-- efectivo, pero si en el resumen del turno.
-- ============================================================================
CREATE TABLE IF NOT EXISTS dependientes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre     TEXT NOT NULL,
    rol        TEXT,
    activo     INTEGER NOT NULL DEFAULT 1,
    creado_en  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dependientes_activo ON dependientes(activo);

CREATE TABLE IF NOT EXISTS turnos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dependiente_id INTEGER NOT NULL REFERENCES dependientes(id),
    fecha         TEXT,
    hora_apertura INTEGER NOT NULL DEFAULT 0,
    hora_cierre   INTEGER,
    fondo_inicial REAL NOT NULL DEFAULT 0,
    recogidas     REAL NOT NULL DEFAULT 0,
    contado       REAL,
    diferencia    REAL,
    estado        TEXT NOT NULL DEFAULT 'abierto'
);
CREATE INDEX IF NOT EXISTS idx_turnos_dep ON turnos(dependiente_id, estado);
CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos(fecha);

CREATE TABLE IF NOT EXISTS recogidas_turno (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    turno_id   INTEGER NOT NULL REFERENCES turnos(id),
    monto      REAL NOT NULL DEFAULT 0,
    nota       TEXT,
    timestamp  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recogidas_turno ON recogidas_turno(turno_id);

-- Meta / configuracion.
-- idb_migrated = '1' cuando la migracion unica desde IndexedDB ya corrio.
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Auditoria. PWA antes: store IndexedDB 'auditoria'.
CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    detail     TEXT,
    created_at INTEGER NOT NULL DEFAULT 0
);

-- Vistas de verificacion (la app no las lee; son diagnostico).
-- PWA: el stock se mantiene en la columna stock (la app lo descuenta en
-- cada venta) y amountPaid se mantiene en cada abono, asi que estas
-- vistas NO recalculan desde compras/pagos como la referencia.
CREATE VIEW IF NOT EXISTS v_stock AS
SELECT p.id, p.code, p.name, p.stock, p.minStock,
  CASE WHEN p.stock <= 0 THEN 'Agotado'
       WHEN p.stock <= p.minStock THEN 'Bajo' ELSE 'OK' END AS estado,
  COALESCE(v.cant,0) AS vendido
FROM products p
LEFT JOIN (SELECT productId, SUM(quantity) AS cant FROM sales WHERE anulada=0 GROUP BY productId) v ON v.productId = p.id;

CREATE VIEW IF NOT EXISTS v_client_debt AS
SELECT c.clientName AS cliente,
  SUM(c.total - c.amountPaid) AS debe
FROM credit_sales c
WHERE c.isPaid = 0 AND c.anulada = 0
GROUP BY c.clientName
HAVING debe > 0.005;

CREATE VIEW IF NOT EXISTS v_lot_remaining AS
SELECT pu.id, pu.lot_number, pu.product_name,
  pu.quantity - pu.losses - COALESCE(SUM(a.quantity),0) AS restante_calc,
  pu.lot_remaining AS restante_guardado
FROM purchases pu
LEFT JOIN lot_allocations a ON a.lot_id = pu.id
GROUP BY pu.id;
