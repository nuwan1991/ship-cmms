-- M16 Docking: dry docks, ship docking periods, the docking work list and underwater survey findings (DECISIONS D75). Table prefix: dck_
-- Classes: dock = hub_reference; docking, work_item = owner_mutable (home scope = the ship); survey_record = event.
-- No foreign keys on synced tables (DECISIONS D07). Work orders are created through M05's createWorkOrder, never by writing wrk_ tables.

-- A docking facility: graving (dry) dock, floating dock, slipway or ship lift.
CREATE TABLE dck_dock (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('graving_dock','floating_dock','slipway','shiplift')),
  operator TEXT,
  max_length_m REAL CHECK (max_length_m IS NULL OR max_length_m > 0),
  max_beam_m REAL CHECK (max_beam_m IS NULL OR max_beam_m > 0),
  max_draught_m REAL CHECK (max_draught_m IS NULL OR max_draught_m > 0),
  lift_capacity_t REAL CHECK (lift_capacity_t IS NULL OR lift_capacity_t > 0),
  capacity_ships INTEGER NOT NULL DEFAULT 1 CHECK (capacity_ships BETWEEN 1 AND 10),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX dck_dock_code_uq ON dck_dock(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE dck_dock}}

-- One docking period of one ship: planned -> in_dock -> undocked -> completed; planned -> cancelled.
CREATE TABLE dck_docking (
  {{SYNC_COLUMNS}}
  ship_id TEXT NOT NULL,
  dock_id TEXT,
  reference TEXT,
  docking_type TEXT NOT NULL DEFAULT 'routine' CHECK (docking_type IN ('routine','emergency','refit','survey','other')),
  purpose TEXT,
  authority TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_dock','undocked','completed','cancelled')),
  planned_dock_in TEXT NOT NULL CHECK (planned_dock_in GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  planned_undock TEXT NOT NULL CHECK (planned_undock GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  docked_at TEXT,
  undocked_at TEXT,
  completed_at TEXT,
  next_due_on TEXT CHECK (next_due_on IS NULL OR next_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  remarks TEXT,
  cancel_reason TEXT,
  CHECK (planned_undock >= planned_dock_in),
  CHECK (status IN ('planned','cancelled') OR (docked_at IS NOT NULL AND dock_id IS NOT NULL)),
  CHECK (status NOT IN ('undocked','completed') OR undocked_at IS NOT NULL),
  CHECK (status <> 'completed' OR (completed_at IS NOT NULL AND next_due_on IS NOT NULL))
);
CREATE UNIQUE INDEX dck_docking_reference_uq ON dck_docking(ship_id, reference) WHERE deleted_at IS NULL AND reference IS NOT NULL;
CREATE INDEX dck_docking_ship_ix ON dck_docking(ship_id, planned_dock_in);
CREATE INDEX dck_docking_dock_ix ON dck_docking(dock_id, status);
{{TRIGGERS_MUTABLE dck_docking}}

-- The docking work list: what must be done while the ship is out of the water.
CREATE TABLE dck_work_item (
  {{SYNC_COLUMNS}}
  docking_id TEXT NOT NULL,
  item_no INTEGER NOT NULL CHECK (item_no > 0),
  category TEXT NOT NULL CHECK (category IN ('hull','underwater_fittings','propulsion','rudder_steering','sea_valves','cathodic_protection','painting','sensors','other')),
  title TEXT NOT NULL,
  description TEXT,
  asset_id TEXT,
  work_order_id TEXT,
  executed_by TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','deferred','cancelled')),
  completed_at TEXT,
  note TEXT,
  CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
CREATE UNIQUE INDEX dck_work_item_no_uq ON dck_work_item(docking_id, item_no) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE dck_work_item}}

-- Underwater survey findings recorded while the ship is in dock. Append-only.
CREATE TABLE dck_survey_record (
  {{EVENT_COLUMNS}}
  docking_id TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('hull_plating','propeller','shaft','rudder','sea_chest','anodes','paint_coating','stabilisers','echo_sounder_log','other')),
  condition TEXT NOT NULL CHECK (condition IN ('good','fair','poor','defective')),
  finding TEXT NOT NULL,
  measurement TEXT,
  surveyed_by TEXT,
  action_required INTEGER NOT NULL DEFAULT 0 CHECK (action_required IN (0,1))
);
CREATE INDEX dck_survey_docking_ix ON dck_survey_record(docking_id, occurred_at);
{{TRIGGERS_EVENT dck_survey_record}}

-- Each live docking with its dock, work-list counts, days in dock and lateness (derived, never synchronized; dates UTC).
CREATE VIEW dck_v_docking AS
SELECT d.id AS docking_id, d.ship_id, s.ship_code, s.ship_name, s.pennant_no, d.dock_id, k.code AS dock_code, k.name AS dock_name, d.reference, d.docking_type,
       d.purpose, d.authority, d.status, d.planned_dock_in, d.planned_undock, d.docked_at, d.undocked_at, d.completed_at, d.next_due_on, d.remarks,
       d.cancel_reason, d.version, d.owner_installation_id,
       (SELECT COUNT(*) FROM dck_work_item w WHERE w.docking_id = d.id AND w.deleted_at IS NULL) AS items_total,
       (SELECT COUNT(*) FROM dck_work_item w WHERE w.docking_id = d.id AND w.deleted_at IS NULL AND w.status IN ('open','in_progress')) AS items_open,
       (SELECT COUNT(*) FROM dck_work_item w WHERE w.docking_id = d.id AND w.deleted_at IS NULL AND w.status = 'done') AS items_done,
       (SELECT COUNT(*) FROM dck_survey_record r WHERE r.docking_id = d.id) AS survey_count,
       CASE WHEN d.docked_at IS NOT NULL THEN CAST(julianday(date(COALESCE(d.undocked_at, 'now'))) - julianday(date(d.docked_at)) AS INTEGER) END AS days_in_dock,
       (d.status = 'planned' AND d.planned_dock_in < date('now')) AS late_dock_in,
       (d.status = 'in_dock' AND d.planned_undock < date('now')) AS late_undock
FROM dck_docking d
LEFT JOIN dck_dock k ON k.id = d.dock_id
LEFT JOIN org_v_ship_status_current s ON s.ship_id = d.ship_id
WHERE d.deleted_at IS NULL;

-- Planned or current dockings that overlap on a single-ship dock (a planning warning, not a block).
CREATE VIEW dck_v_dock_conflict AS
SELECT a.dock_id, a.id AS docking_id, b.id AS other_docking_id, a.ship_id, b.ship_id AS other_ship_id,
       MAX(a.planned_dock_in, b.planned_dock_in) AS overlap_from, MIN(a.planned_undock, b.planned_undock) AS overlap_to
FROM dck_docking a
JOIN dck_docking b ON b.dock_id = a.dock_id AND b.id <> a.id AND b.deleted_at IS NULL AND b.status IN ('planned','in_dock')
JOIN dck_dock k ON k.id = a.dock_id AND k.capacity_ships = 1
WHERE a.deleted_at IS NULL AND a.status IN ('planned','in_dock')
  AND a.planned_dock_in <= b.planned_undock AND b.planned_dock_in <= a.planned_undock;

-- Every live ship with its docking state (in_dock, undocked = out of the water but the docking not yet closed, never, overdue, due_soon, ok),
-- its last completed docking, next due date and next planned docking.
CREATE VIEW dck_v_ship_due AS
SELECT s.ship_id, s.ship_code, s.ship_name, s.pennant_no,
       cur.id AS current_docking_id, cur.status AS current_status, cur.dock_id AS current_dock_id,
       last.id AS last_docking_id, last.undocked_at AS last_undocked_at, last.next_due_on,
       (SELECT MIN(p.planned_dock_in) FROM dck_docking p WHERE p.ship_id = s.ship_id AND p.deleted_at IS NULL AND p.status = 'planned') AS next_planned_dock_in,
       CASE WHEN cur.id IS NOT NULL THEN cur.status
            WHEN last.id IS NULL THEN 'never'
            WHEN last.next_due_on < date('now') THEN 'overdue'
            WHEN last.next_due_on <= date('now', '+90 days') THEN 'due_soon'
            ELSE 'ok' END AS due_state
FROM org_v_ship_status_current s
LEFT JOIN dck_docking cur ON cur.id = (
  SELECT c.id FROM dck_docking c WHERE c.ship_id = s.ship_id AND c.deleted_at IS NULL AND c.status IN ('in_dock','undocked') ORDER BY c.docked_at DESC, c.id DESC LIMIT 1)
LEFT JOIN dck_docking last ON last.id = (
  SELECT l.id FROM dck_docking l WHERE l.ship_id = s.ship_id AND l.deleted_at IS NULL AND l.status = 'completed' ORDER BY l.undocked_at DESC, l.id DESC LIMIT 1)
WHERE s.ship_record_status IS NULL OR s.ship_record_status <> 'decommissioned';
