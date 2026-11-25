-- M16 pre-docking requirements (DECISIONS D76).
-- Classes: req_template, req_template_item = hub_reference (per ship class; no class = every ship);
-- ship_req_item = owner_mutable (standing items for one ship); requirement = owner_mutable (the checklist of one docking).

CREATE TABLE dck_req_template (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  ship_class TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX dck_req_template_code_uq ON dck_req_template(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE dck_req_template}}

-- One line of a template. lead_days = due this many days before the planned docking date.
CREATE TABLE dck_req_template_item (
  {{SYNC_COLUMNS}}
  template_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  category TEXT NOT NULL CHECK (category IN ('documents','ship_preparation','safety','services','work_package','stores_fuel_ammunition','other')),
  title TEXT NOT NULL,
  description TEXT,
  responsible TEXT,
  lead_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_days BETWEEN 0 AND 365),
  mandatory INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE INDEX dck_req_template_item_ix ON dck_req_template_item(template_id, seq);
{{TRIGGERS_MUTABLE dck_req_template_item}}

-- Standing requirements of one ship on top of its class template (e.g. a special underwater fitting).
CREATE TABLE dck_ship_req_item (
  {{SYNC_COLUMNS}}
  ship_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  category TEXT NOT NULL CHECK (category IN ('documents','ship_preparation','safety','services','work_package','stores_fuel_ammunition','other')),
  title TEXT NOT NULL,
  description TEXT,
  responsible TEXT,
  lead_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_days BETWEEN 0 AND 365),
  mandatory INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE INDEX dck_ship_req_item_ix ON dck_ship_req_item(ship_id, seq);
{{TRIGGERS_MUTABLE dck_ship_req_item}}

-- The checklist of one docking: copied from the class templates and the ship's own items, plus items added for this docking only.
CREATE TABLE dck_requirement (
  {{SYNC_COLUMNS}}
  docking_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('template','ship','adhoc')),
  source_item_id TEXT,
  template_id TEXT,
  seq INTEGER NOT NULL CHECK (seq > 0),
  category TEXT NOT NULL CHECK (category IN ('documents','ship_preparation','safety','services','work_package','stores_fuel_ammunition','other')),
  title TEXT NOT NULL,
  description TEXT,
  responsible TEXT,
  lead_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_days BETWEEN 0 AND 365),
  mandatory INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','not_applicable')),
  completed_at TEXT,
  reference TEXT,
  note TEXT,
  CHECK ((source = 'adhoc') = (source_item_id IS NULL)),
  CHECK (status <> 'done' OR completed_at IS NOT NULL),
  CHECK (status <> 'not_applicable' OR note IS NOT NULL)
);
CREATE UNIQUE INDEX dck_requirement_source_uq ON dck_requirement(docking_id, source_item_id) WHERE deleted_at IS NULL AND source_item_id IS NOT NULL;
CREATE INDEX dck_requirement_docking_ix ON dck_requirement(docking_id, seq);
{{TRIGGERS_MUTABLE dck_requirement}}

-- A docking may be docked in with mandatory items still pending only with a recorded reason.
ALTER TABLE dck_docking ADD COLUMN requirements_waiver TEXT;

-- Checklist lines with their due date (planned docking date minus lead days) and overdue flag (derived).
CREATE VIEW dck_v_requirement AS
SELECT r.id AS requirement_id, r.docking_id, r.source, r.source_item_id, r.template_id, r.seq, r.category, r.title, r.description, r.responsible,
       r.lead_days, r.mandatory, r.status, r.completed_at, r.reference, r.note, r.version, r.updated_at, r.updated_by,
       d.ship_id, d.status AS docking_status, date(d.planned_dock_in, '-' || r.lead_days || ' days') AS due_on,
       (r.status = 'pending' AND d.status = 'planned' AND date(d.planned_dock_in, '-' || r.lead_days || ' days') < date('now')) AS overdue
FROM dck_requirement r JOIN dck_docking d ON d.id = r.docking_id
WHERE r.deleted_at IS NULL AND d.deleted_at IS NULL;

DROP VIEW dck_v_docking;
CREATE VIEW dck_v_docking AS
SELECT d.id AS docking_id, d.ship_id, s.ship_code, s.ship_name, s.pennant_no, d.dock_id, k.code AS dock_code, k.name AS dock_name, d.reference, d.docking_type,
       d.purpose, d.authority, d.status, d.planned_dock_in, d.planned_undock, d.docked_at, d.undocked_at, d.completed_at, d.next_due_on, d.remarks,
       d.cancel_reason, d.requirements_waiver, d.version, d.owner_installation_id,
       (SELECT COUNT(*) FROM dck_work_item w WHERE w.docking_id = d.id AND w.deleted_at IS NULL) AS items_total,
       (SELECT COUNT(*) FROM dck_work_item w WHERE w.docking_id = d.id AND w.deleted_at IS NULL AND w.status IN ('open','in_progress')) AS items_open,
       (SELECT COUNT(*) FROM dck_work_item w WHERE w.docking_id = d.id AND w.deleted_at IS NULL AND w.status = 'done') AS items_done,
       (SELECT COUNT(*) FROM dck_survey_record r WHERE r.docking_id = d.id) AS survey_count,
       (SELECT COUNT(*) FROM dck_requirement q WHERE q.docking_id = d.id AND q.deleted_at IS NULL) AS req_total,
       (SELECT COUNT(*) FROM dck_requirement q WHERE q.docking_id = d.id AND q.deleted_at IS NULL AND q.status = 'pending') AS req_pending,
       (SELECT COUNT(*) FROM dck_requirement q WHERE q.docking_id = d.id AND q.deleted_at IS NULL AND q.status = 'pending' AND q.mandatory = 1) AS req_mandatory_pending,
       (SELECT COUNT(*) FROM dck_requirement q WHERE q.docking_id = d.id AND q.deleted_at IS NULL AND q.status = 'pending'
          AND d.status = 'planned' AND date(d.planned_dock_in, '-' || q.lead_days || ' days') < date('now')) AS req_overdue,
       CASE WHEN d.docked_at IS NOT NULL THEN CAST(julianday(date(COALESCE(d.undocked_at, 'now'))) - julianday(date(d.docked_at)) AS INTEGER) END AS days_in_dock,
       (d.status = 'planned' AND d.planned_dock_in < date('now')) AS late_dock_in,
       (d.status = 'in_dock' AND d.planned_undock < date('now')) AS late_undock
FROM dck_docking d
LEFT JOIN dck_dock k ON k.id = d.dock_id
LEFT JOIN org_v_ship_status_current s ON s.ship_id = d.ship_id
WHERE d.deleted_at IS NULL;
