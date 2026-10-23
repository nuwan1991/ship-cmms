-- M06 Planned maintenance, meters and calibration. Table prefix: pm_
-- Classes: task_template = hub_reference; plan, meter = owner_mutable; meter_reading, calibration_record = event.
-- No foreign keys on synced tables (DECISIONS D07). Preventive work orders are created through M05's createWorkOrder, never by writing wrk_ tables.

CREATE TABLE pm_task_template (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  classification_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX pm_task_template_code_uq ON pm_task_template(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE pm_task_template}}

CREATE TABLE pm_meter (
  {{SYNC_COLUMNS}}
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('running_hours','counter')),
  unit TEXT NOT NULL DEFAULT 'h',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX pm_meter_name_uq ON pm_meter(asset_id, name) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE pm_meter}}

-- cumulative = running total that survives meter replacement; reading = what the dial showed.
CREATE TABLE pm_meter_reading (
  {{EVENT_COLUMNS}}
  meter_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reading','replacement')),
  reading REAL NOT NULL CHECK (reading >= 0),
  cumulative REAL NOT NULL CHECK (cumulative >= 0),
  note TEXT
);
CREATE INDEX pm_meter_reading_ix ON pm_meter_reading(meter_id, occurred_at);
{{TRIGGERS_EVENT pm_meter_reading}}

CREATE TABLE pm_plan (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  template_id TEXT,
  asset_id TEXT,
  position_id TEXT,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('calendar','running_hours')),
  interval_days INTEGER CHECK (interval_days IS NULL OR interval_days > 0),
  interval_hours REAL CHECK (interval_hours IS NULL OR interval_hours > 0),
  meter_id TEXT,
  lead_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_days >= 0),
  lead_hours REAL NOT NULL DEFAULT 50 CHECK (lead_hours >= 0),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  start_at TEXT NOT NULL,
  last_done_at TEXT,
  last_done_hours REAL,
  last_generated_key TEXT,
  last_work_order_id TEXT,
  last_rolled_wo_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  CHECK ((asset_id IS NULL) <> (position_id IS NULL)),
  CHECK (trigger_kind <> 'calendar' OR interval_days IS NOT NULL),
  CHECK (trigger_kind <> 'running_hours' OR (interval_hours IS NOT NULL AND meter_id IS NOT NULL))
);
CREATE UNIQUE INDEX pm_plan_code_uq ON pm_plan(code) WHERE deleted_at IS NULL;
CREATE INDEX pm_plan_asset_ix ON pm_plan(asset_id);
{{TRIGGERS_MUTABLE pm_plan}}

CREATE TABLE pm_calibration_record (
  {{EVENT_COLUMNS}}
  asset_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass','fail','adjusted')),
  next_due_on TEXT CHECK (next_due_on IS NULL OR next_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  certificate_no TEXT,
  calibrated_by TEXT,
  note TEXT
);
CREATE INDEX pm_calibration_asset_ix ON pm_calibration_record(asset_id, occurred_at);
{{TRIGGERS_EVENT pm_calibration_record}}

-- Latest cumulative value of each meter.
CREATE VIEW pm_v_meter_current AS
SELECT meter_id, cumulative, reading, occurred_at AS read_at FROM (
  SELECT r.*, ROW_NUMBER() OVER (PARTITION BY meter_id ORDER BY occurred_at DESC, id DESC) AS rn FROM pm_meter_reading r
) WHERE rn = 1;

-- Each live plan with its next due point. Calendar: due_at (UTC instant). Running hours: due_hours and remaining_hours.
CREATE VIEW pm_v_plan_due AS
SELECT p.id AS plan_id, p.code, p.title, p.asset_id, p.position_id, p.home_scope_id AS ship_id, p.trigger_kind, p.priority, p.status, p.meter_id,
       p.lead_days, p.lead_hours, p.last_work_order_id,
       CASE WHEN p.trigger_kind = 'calendar' THEN strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(p.last_done_at, p.start_at), '+' || p.interval_days || ' days') END AS due_at,
       CASE WHEN p.trigger_kind = 'running_hours' THEN COALESCE(p.last_done_hours, 0) + p.interval_hours END AS due_hours,
       CASE WHEN p.trigger_kind = 'running_hours' THEN COALESCE(p.last_done_hours, 0) + p.interval_hours - COALESCE(m.cumulative, 0) END AS remaining_hours,
       m.cumulative AS meter_hours
FROM pm_plan p LEFT JOIN pm_v_meter_current m ON m.meter_id = p.meter_id
WHERE p.deleted_at IS NULL;

CREATE VIEW pm_v_calibration_due AS
SELECT asset_id, result, next_due_on, certificate_no, occurred_at AS calibrated_at, home_scope_id AS ship_id FROM (
  SELECT c.*, ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY occurred_at DESC, id DESC) AS rn FROM pm_calibration_record c
) WHERE rn = 1;

-- One due list for lists and M13 (derived, never synchronized). Dates are UTC; status uses the current time.
CREATE VIEW pm_v_due AS
SELECT 'plan' AS source, plan_id AS ref_id, code AS ref_code, title, asset_id, position_id, ship_id, trigger_kind AS basis, priority,
       substr(due_at, 1, 10) AS due_on, remaining_hours,
       CASE WHEN trigger_kind = 'calendar' THEN due_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE remaining_hours <= 0 END AS overdue,
       CASE WHEN trigger_kind = 'calendar' THEN due_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || lead_days || ' days') ELSE remaining_hours <= lead_hours END AS due_soon,
       last_work_order_id AS work_order_id
FROM pm_v_plan_due WHERE status = 'active'
UNION ALL
SELECT 'calibration', asset_id, NULL, 'Calibration', asset_id, NULL, ship_id, 'calendar', 'normal', next_due_on, NULL,
       next_due_on < date('now'), next_due_on <= date('now', '+30 days'), NULL
FROM pm_v_calibration_due WHERE next_due_on IS NOT NULL;
