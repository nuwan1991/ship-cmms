-- M04 QR labels and compartment surveys. Table prefix: qr_
-- Classes: label, survey, survey_item = owner_mutable; label_print = event; survey_template = hub_reference.
-- No foreign keys on synced tables (DECISIONS D07). A label number is never reused, even after the label is voided.

CREATE TABLE qr_label (
  {{SYNC_COLUMNS}}
  label_no TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','assigned','void')),
  asset_id TEXT,
  assigned_at TEXT,
  void_reason TEXT,
  note TEXT,
  CHECK (state <> 'assigned' OR asset_id IS NOT NULL),
  CHECK (state <> 'reserved' OR asset_id IS NULL)
);
CREATE UNIQUE INDEX qr_label_no_uq ON qr_label(label_no);
CREATE UNIQUE INDEX qr_label_asset_uq ON qr_label(asset_id) WHERE state = 'assigned' AND deleted_at IS NULL;
CREATE INDEX qr_label_state_ix ON qr_label(state);
{{TRIGGERS_MUTABLE qr_label}}

-- One row per label per print job (A4 sheet). Reprints are new rows, never edits.
CREATE TABLE qr_label_print (
  {{EVENT_COLUMNS}}
  label_id TEXT NOT NULL,
  print_job_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('first','reprint')),
  note TEXT
);
CREATE INDEX qr_label_print_label_ix ON qr_label_print(label_id, occurred_at);
CREATE INDEX qr_label_print_job_ix ON qr_label_print(print_job_id);
{{TRIGGERS_EVENT qr_label_print}}

-- Simple compartment survey form: ordered questions asked of every item found (items_json = [{key,label,kind}]).
CREATE TABLE qr_survey_template (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX qr_survey_template_code_uq ON qr_survey_template(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE qr_survey_template}}

-- A walk through one compartment (org_location) of a ship. home_scope_id = ship.
CREATE TABLE qr_survey (
  {{SYNC_COLUMNS}}
  location_id TEXT NOT NULL,
  template_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  started_at TEXT NOT NULL,
  closed_at TEXT,
  note TEXT
);
CREATE UNIQUE INDEX qr_survey_open_uq ON qr_survey(location_id) WHERE status = 'open' AND deleted_at IS NULL;
CREATE INDEX qr_survey_ship_ix ON qr_survey(home_scope_id, started_at);
{{TRIGGERS_MUTABLE qr_survey}}

-- What was found: a scanned/known asset, or a pending (unregistered) item that can later be converted into an asset.
CREATE TABLE qr_survey_item (
  {{SYNC_COLUMNS}}
  survey_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('scanned','pending')),
  asset_id TEXT,
  label_no TEXT,
  observed_status TEXT CHECK (observed_status IS NULL OR observed_status IN ('in_service','in_store','under_repair','out_of_service','condemned')),
  description TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  answers_json TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  converted_asset_id TEXT,
  converted_at TEXT,
  CHECK (kind <> 'scanned' OR asset_id IS NOT NULL),
  CHECK (kind <> 'pending' OR description IS NOT NULL)
);
CREATE INDEX qr_survey_item_survey_ix ON qr_survey_item(survey_id);
CREATE UNIQUE INDEX qr_survey_item_asset_uq ON qr_survey_item(survey_id, asset_id) WHERE asset_id IS NOT NULL AND deleted_at IS NULL;
{{TRIGGERS_MUTABLE qr_survey_item}}

-- Survey progress for lists and M13.
CREATE VIEW qr_v_survey_summary AS
SELECT s.id AS survey_id, s.home_scope_id AS ship_id, s.location_id, s.status, s.started_at, s.closed_at,
       COUNT(i.id) AS item_count,
       COALESCE(SUM(i.kind = 'scanned'), 0) AS scanned_count,
       COALESCE(SUM(i.kind = 'pending' AND i.converted_asset_id IS NULL), 0) AS pending_count,
       COALESCE(SUM(i.converted_asset_id IS NOT NULL), 0) AS converted_count
FROM qr_survey s
LEFT JOIN qr_survey_item i ON i.survey_id = s.id AND i.deleted_at IS NULL
WHERE s.deleted_at IS NULL
GROUP BY s.id;
