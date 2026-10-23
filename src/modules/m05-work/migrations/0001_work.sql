-- M05 Defects, repair cases, work orders, job cards, labour, acceptance. Table prefix: wrk_
-- Classes: defect, repair_case, work_order, job_card = owner_mutable; status_event, labour_entry, finding, test_record, acceptance, handover = event;
-- advisory = hub_reference. No foreign keys on synced tables (DECISIONS D07).
-- Status is never one field: the four axes (progress, approval, return_to_service, closure) are events; current values are derived (D10).

CREATE TABLE wrk_defect (
  {{SYNC_COLUMNS}}
  defect_no TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','major','critical')),
  asset_id TEXT,
  position_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','dismissed')),
  repair_case_id TEXT,
  reported_at TEXT NOT NULL,
  dismiss_reason TEXT
);
CREATE UNIQUE INDEX wrk_defect_no_uq ON wrk_defect(defect_no);
CREATE INDEX wrk_defect_asset_ix ON wrk_defect(asset_id, reported_at);
CREATE INDEX wrk_defect_ship_ix ON wrk_defect(home_scope_id, status);
{{TRIGGERS_MUTABLE wrk_defect}}

CREATE TABLE wrk_repair_case (
  {{SYNC_COLUMNS}}
  case_no TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  asset_id TEXT,
  position_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  opened_at TEXT NOT NULL
);
CREATE UNIQUE INDEX wrk_repair_case_no_uq ON wrk_repair_case(case_no);
CREATE INDEX wrk_repair_case_ship_ix ON wrk_repair_case(home_scope_id);
{{TRIGGERS_MUTABLE wrk_repair_case}}

-- Parties are kept apart: operating party (who runs the equipment) and executing party (who does the work). The record owner is the
-- installation that entered it; hand-over changes who executes, recorded as events (SYNC_RULES §3).
CREATE TABLE wrk_work_order (
  {{SYNC_COLUMNS}}
  wo_no TEXT NOT NULL,
  repair_case_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  work_type TEXT NOT NULL DEFAULT 'corrective' CHECK (work_type IN ('corrective','preventive','inspection','modification')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  asset_id TEXT,
  position_id TEXT,
  operating_party_kind TEXT CHECK (operating_party_kind IN ('command','ship','department','workshop','external_provider')),
  operating_party_id TEXT,
  executing_party_kind TEXT CHECK (executing_party_kind IN ('command','ship','department','workshop','external_provider')),
  executing_party_id TEXT,
  requested_due TEXT,
  CHECK ((operating_party_kind IS NULL) = (operating_party_id IS NULL)),
  CHECK ((executing_party_kind IS NULL) = (executing_party_id IS NULL))
);
CREATE UNIQUE INDEX wrk_work_order_no_uq ON wrk_work_order(wo_no);
CREATE INDEX wrk_work_order_asset_ix ON wrk_work_order(asset_id);
CREATE INDEX wrk_work_order_case_ix ON wrk_work_order(repair_case_id);
CREATE INDEX wrk_work_order_ship_ix ON wrk_work_order(home_scope_id);
{{TRIGGERS_MUTABLE wrk_work_order}}

CREATE TABLE wrk_job_card (
  {{SYNC_COLUMNS}}
  work_order_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','completed','void')),
  completed_at TEXT
);
CREATE UNIQUE INDEX wrk_job_card_seq_uq ON wrk_job_card(work_order_id, seq) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE wrk_job_card}}

-- One transition on one axis of a repair case or work order.
CREATE TABLE wrk_status_event (
  {{EVENT_COLUMNS}}
  subject_type TEXT NOT NULL CHECK (subject_type IN ('repair_case','work_order')),
  subject_id TEXT NOT NULL,
  axis TEXT NOT NULL CHECK (axis IN ('progress','approval','return_to_service','closure')),
  value TEXT NOT NULL,
  note TEXT,
  approval_id TEXT,
  provisional INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX wrk_status_event_subject_ix ON wrk_status_event(subject_type, subject_id, axis, occurred_at, id);
{{TRIGGERS_EVENT wrk_status_event}}

CREATE TABLE wrk_labour_entry (
  {{EVENT_COLUMNS}}
  work_order_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  trade TEXT,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  note TEXT
);
CREATE INDEX wrk_labour_wo_ix ON wrk_labour_entry(work_order_id);
{{TRIGGERS_EVENT wrk_labour_entry}}

CREATE TABLE wrk_finding (
  {{EVENT_COLUMNS}}
  work_order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('observation','cause','recommendation','additional_defect')),
  text TEXT NOT NULL
);
CREATE INDEX wrk_finding_wo_ix ON wrk_finding(work_order_id);
{{TRIGGERS_EVENT wrk_finding}}

CREATE TABLE wrk_test_record (
  {{EVENT_COLUMNS}}
  work_order_id TEXT NOT NULL,
  test_name TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass','fail','not_applicable')),
  measured_value TEXT,
  note TEXT
);
CREATE INDEX wrk_test_wo_ix ON wrk_test_record(work_order_id);
{{TRIGGERS_EVENT wrk_test_record}}

-- Repair acceptance by the operating side and the return-to-service decision it carries.
CREATE TABLE wrk_acceptance (
  {{EVENT_COLUMNS}}
  work_order_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  return_to_service TEXT NOT NULL CHECK (return_to_service IN ('restricted','cleared','withheld')),
  restrictions TEXT,
  remarks TEXT,
  approval_id TEXT,
  provisional INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX wrk_acceptance_wo_ix ON wrk_acceptance(work_order_id);
{{TRIGGERS_EVENT wrk_acceptance}}

-- Offer another party (e.g. a workshop) the execution of a work order; kind offer | accept | decline | withdraw (responses name the offer).
CREATE TABLE wrk_handover (
  {{EVENT_COLUMNS}}
  work_order_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offer','accept','decline','withdraw')),
  offer_id TEXT,
  to_party_kind TEXT CHECK (to_party_kind IN ('command','ship','department','workshop','external_provider')),
  to_party_id TEXT,
  note TEXT,
  CHECK ((to_party_kind IS NULL) = (to_party_id IS NULL))
);
CREATE INDEX wrk_handover_wo_ix ON wrk_handover(work_order_id, occurred_at);
{{TRIGGERS_EVENT wrk_handover}}

CREATE TABLE wrk_advisory (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','caution','warning')),
  classification_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  issued_at TEXT NOT NULL
);
CREATE UNIQUE INDEX wrk_advisory_code_uq ON wrk_advisory(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE wrk_advisory}}

-- ---------------------------------------------------------------- derived read models (rebuilt by SQL, never synchronized)

CREATE VIEW wrk_v_status_current AS
SELECT subject_type, subject_id, axis, value, occurred_at FROM (
  SELECT e.*, ROW_NUMBER() OVER (PARTITION BY subject_type, subject_id, axis ORDER BY occurred_at DESC, id DESC) AS rn FROM wrk_status_event e
) WHERE rn = 1;

CREATE VIEW wrk_v_handover_state AS
SELECT o.id AS offer_id, o.work_order_id, o.to_party_kind, o.to_party_id, o.occurred_at, o.note,
       COALESCE((SELECT CASE r.kind WHEN 'accept' THEN 'accepted' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END
                 FROM wrk_handover r WHERE r.offer_id = o.id AND r.kind <> 'offer' ORDER BY r.occurred_at DESC, r.id DESC LIMIT 1), 'pending') AS status
FROM wrk_handover o WHERE o.kind = 'offer';

CREATE VIEW wrk_v_work_order_overview AS
SELECT w.id AS work_order_id, w.wo_no, w.title, w.home_scope_id AS ship_id, w.asset_id, w.position_id, w.work_type, w.priority, w.repair_case_id, w.requested_due,
       w.operating_party_kind, w.operating_party_id,
       COALESCE((SELECT h.to_party_kind FROM wrk_v_handover_state h WHERE h.work_order_id = w.id AND h.status = 'accepted' ORDER BY h.occurred_at DESC, h.offer_id DESC LIMIT 1), w.executing_party_kind) AS executing_party_kind,
       COALESCE((SELECT h.to_party_id FROM wrk_v_handover_state h WHERE h.work_order_id = w.id AND h.status = 'accepted' ORDER BY h.occurred_at DESC, h.offer_id DESC LIMIT 1), w.executing_party_id) AS executing_party_id,
       COALESCE((SELECT value FROM wrk_v_status_current s WHERE s.subject_type = 'work_order' AND s.subject_id = w.id AND s.axis = 'progress'), 'planned') AS progress,
       COALESCE((SELECT value FROM wrk_v_status_current s WHERE s.subject_type = 'work_order' AND s.subject_id = w.id AND s.axis = 'approval'), 'not_required') AS approval,
       COALESCE((SELECT value FROM wrk_v_status_current s WHERE s.subject_type = 'work_order' AND s.subject_id = w.id AND s.axis = 'return_to_service'), 'not_assessed') AS return_to_service,
       COALESCE((SELECT value FROM wrk_v_status_current s WHERE s.subject_type = 'work_order' AND s.subject_id = w.id AND s.axis = 'closure'), 'open') AS closure,
       COALESCE((SELECT SUM(l.minutes) FROM wrk_labour_entry l WHERE l.work_order_id = w.id), 0) AS labour_minutes,
       EXISTS (SELECT 1 FROM wrk_v_handover_state h WHERE h.work_order_id = w.id AND h.status = 'pending') AS handover_pending,
       w.created_at
FROM wrk_work_order w WHERE w.deleted_at IS NULL;

-- Faults that keep coming back: corrective work orders and defects per asset in the last 90 days (3 or more). The API takes its own window.
CREATE VIEW wrk_v_recurring_faults AS
SELECT asset_id, home_scope_id AS ship_id, COUNT(*) AS occurrences, MIN(at) AS first_at, MAX(at) AS last_at FROM (
  SELECT asset_id, home_scope_id, reported_at AS at FROM wrk_defect WHERE deleted_at IS NULL AND asset_id IS NOT NULL AND status <> 'dismissed'
  UNION ALL
  SELECT asset_id, home_scope_id, created_at FROM wrk_work_order WHERE deleted_at IS NULL AND asset_id IS NOT NULL AND work_type = 'corrective' AND repair_case_id IS NULL
) WHERE at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')
GROUP BY asset_id, home_scope_id HAVING COUNT(*) >= 3;
