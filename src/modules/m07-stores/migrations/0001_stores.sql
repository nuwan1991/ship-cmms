-- M07 Parts and stores. Table prefix: stk_
-- Classes: part, part_compatibility = hub_reference; location, stock_level, transfer = owner_mutable; transaction, reservation = event.
-- No foreign keys on synced tables (DECISIONS D07). Stock is never edited: every change is a transaction event, and balances are a view (D39).

CREATE TABLE stk_part (
  {{SYNC_COLUMNS}}
  part_no TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'each',
  category TEXT,
  manufacturer TEXT,
  manufacturer_part_no TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX stk_part_no_uq ON stk_part(part_no) WHERE deleted_at IS NULL;
CREATE INDEX stk_part_name_ix ON stk_part(name);
{{TRIGGERS_MUTABLE stk_part}}

-- A part fits an equipment classification or one specific asset (exactly one of the two).
CREATE TABLE stk_part_compatibility (
  {{SYNC_COLUMNS}}
  part_id TEXT NOT NULL,
  classification_id TEXT,
  asset_id TEXT,
  note TEXT,
  CHECK ((classification_id IS NULL) <> (asset_id IS NULL))
);
CREATE UNIQUE INDEX stk_compat_class_uq ON stk_part_compatibility(part_id, classification_id) WHERE classification_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX stk_compat_asset_uq ON stk_part_compatibility(part_id, asset_id) WHERE asset_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX stk_compat_class_ix ON stk_part_compatibility(classification_id);
CREATE INDEX stk_compat_asset_ix ON stk_part_compatibility(asset_id);
{{TRIGGERS_MUTABLE stk_part_compatibility}}

-- A place where stock is held. home_scope_id = the ship or workshop that holds it; NULL = a fleet/hub store.
CREATE TABLE stk_location (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'store' CHECK (kind IN ('store','locker','workshop','other')),
  org_location_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX stk_location_code_uq ON stk_location(COALESCE(home_scope_id, ''), code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE stk_location}}

-- Minimum and re-order quantity of a part at a location.
CREATE TABLE stk_stock_level (
  {{SYNC_COLUMNS}}
  part_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  min_level REAL NOT NULL CHECK (min_level >= 0),
  reorder_qty REAL CHECK (reorder_qty IS NULL OR reorder_qty > 0)
);
CREATE UNIQUE INDEX stk_stock_level_uq ON stk_stock_level(part_id, location_id) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE stk_stock_level}}

-- quantity is the magnitude; qty_delta is the signed effect on on-hand stock at the location.
CREATE TABLE stk_transaction (
  {{EVENT_COLUMNS}}
  part_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('receipt','issue','return','transfer_out','transfer_in','adjustment')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  qty_delta REAL NOT NULL,
  unit_cost REAL CHECK (unit_cost IS NULL OR unit_cost >= 0),
  currency TEXT,
  ref_type TEXT,
  ref_id TEXT,
  transfer_id TEXT,
  reference TEXT,
  note TEXT,
  CHECK (abs(qty_delta) = quantity),
  CHECK (kind = 'adjustment' OR (kind IN ('receipt','return','transfer_in') AND qty_delta > 0) OR (kind IN ('issue','transfer_out') AND qty_delta < 0))
);
CREATE INDEX stk_txn_stock_ix ON stk_transaction(part_id, location_id, occurred_at);
CREATE INDEX stk_txn_ref_ix ON stk_transaction(ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX stk_txn_transfer_ix ON stk_transaction(transfer_id) WHERE transfer_id IS NOT NULL;
{{TRIGGERS_EVENT stk_transaction}}

CREATE TABLE stk_reservation (
  {{EVENT_COLUMNS}}
  part_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reserve','release')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  note TEXT
);
CREATE INDEX stk_res_stock_ix ON stk_reservation(part_id, location_id);
CREATE INDEX stk_res_ref_ix ON stk_reservation(ref_id);
{{TRIGGERS_EVENT stk_reservation}}

-- A dispatch document. lines_json = [{partId, quantity}]. Receipt is recorded as transfer_in events by the receiving installation.
CREATE TABLE stk_transfer (
  {{SYNC_COLUMNS}}
  transfer_no TEXT NOT NULL,
  from_location_id TEXT NOT NULL,
  to_location_id TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched','cancelled')),
  dispatched_at TEXT NOT NULL,
  cancel_reason TEXT,
  note TEXT,
  CHECK (from_location_id <> to_location_id)
);
CREATE UNIQUE INDEX stk_transfer_no_uq ON stk_transfer(transfer_no);
{{TRIGGERS_MUTABLE stk_transfer}}

-- On-hand and reserved stock per part and location (derived; never synchronized).
CREATE VIEW stk_v_balance AS
SELECT part_id, location_id, SUM(on_hand) AS on_hand, SUM(reserved) AS reserved, SUM(on_hand) - SUM(reserved) AS available, MAX(last_at) AS last_movement_at
FROM (
  SELECT part_id, location_id, qty_delta AS on_hand, 0.0 AS reserved, occurred_at AS last_at FROM stk_transaction
  UNION ALL
  SELECT part_id, location_id, 0.0, CASE kind WHEN 'reserve' THEN quantity ELSE -quantity END, occurred_at FROM stk_reservation
)
GROUP BY part_id, location_id;

-- Balances joined with catalogue, location and minimum level; one row per part/location that has ever moved or has a minimum.
CREATE VIEW stk_v_stock AS
SELECT b.part_id, p.part_no, p.name AS part_name, p.unit, b.location_id, l.code AS location_code, l.name AS location_name, l.home_scope_id AS site_id,
       b.on_hand, b.reserved, b.available, lv.min_level, lv.reorder_qty,
       CASE WHEN lv.min_level IS NOT NULL AND b.available < lv.min_level THEN 1 ELSE 0 END AS below_minimum,
       b.last_movement_at
FROM (
  SELECT part_id, location_id, on_hand, reserved, available, last_movement_at FROM stk_v_balance
  UNION ALL
  SELECT s.part_id, s.location_id, 0.0, 0.0, 0.0, NULL FROM stk_stock_level s
  WHERE s.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM stk_v_balance x WHERE x.part_id = s.part_id AND x.location_id = s.location_id)
) b
JOIN stk_part p ON p.id = b.part_id AND p.deleted_at IS NULL
JOIN stk_location l ON l.id = b.location_id AND l.deleted_at IS NULL
LEFT JOIN stk_stock_level lv ON lv.part_id = b.part_id AND lv.location_id = b.location_id AND lv.deleted_at IS NULL;

-- Latest receipt cost per part (used as the issue cost).
CREATE VIEW stk_v_last_cost AS
SELECT part_id, unit_cost, currency FROM (
  SELECT part_id, unit_cost, currency, ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY occurred_at DESC, id DESC) AS rn
  FROM stk_transaction WHERE kind = 'receipt' AND unit_cost IS NOT NULL
) WHERE rn = 1;

-- Net quantity (issues minus returns) and cost per referenced record (work order) and part.
CREATE VIEW stk_v_issued_by_ref AS
SELECT ref_type, ref_id, part_id,
       SUM(CASE kind WHEN 'issue' THEN quantity WHEN 'return' THEN -quantity ELSE 0 END) AS net_quantity,
       SUM(CASE kind WHEN 'issue' THEN quantity * COALESCE(unit_cost, 0) WHEN 'return' THEN -quantity * COALESCE(unit_cost, 0) ELSE 0 END) AS net_cost,
       MAX(occurred_at) AS last_at
FROM stk_transaction WHERE ref_id IS NOT NULL AND kind IN ('issue','return')
GROUP BY ref_type, ref_id, part_id;

-- Reserved and not yet released, per reference, part and location.
CREATE VIEW stk_v_reserved_by_ref AS
SELECT ref_type, ref_id, part_id, location_id,
       SUM(CASE kind WHEN 'reserve' THEN quantity ELSE -quantity END) AS outstanding
FROM stk_reservation GROUP BY ref_type, ref_id, part_id, location_id;

-- Transfers with their state: received once a transfer_in exists at the destination location.
CREATE VIEW stk_v_transfer_state AS
SELECT t.id AS transfer_id, t.transfer_no, t.from_location_id, t.to_location_id, t.lines_json, t.dispatched_at, t.note, t.home_scope_id AS from_site_id,
       t.owner_installation_id, t.version,
       CASE WHEN t.status = 'cancelled' THEN 'cancelled' WHEN r.received_at IS NOT NULL THEN 'received' ELSE 'in_transit' END AS state,
       r.received_at
FROM stk_transfer t
LEFT JOIN (SELECT transfer_id, location_id, MIN(occurred_at) AS received_at FROM stk_transaction WHERE kind = 'transfer_in' GROUP BY transfer_id, location_id) r
  ON r.transfer_id = t.id AND r.location_id = t.to_location_id
WHERE t.deleted_at IS NULL;
