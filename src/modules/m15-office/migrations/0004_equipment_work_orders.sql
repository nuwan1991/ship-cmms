-- M15 Day 4: office equipment register with movements, office work orders. OFFICE_R1_SPEC.md §1.7, §1.8; D73.

CREATE TABLE ofc_equipment (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  equip_no TEXT,
  name TEXT NOT NULL,
  make_model TEXT,
  serial_no TEXT,
  owning_unit TEXT,
  owner_unit_id TEXT,
  asset_id TEXT,
  location_text TEXT,
  custodian_person_id TEXT,
  responsible_person_id TEXT,
  condition TEXT NOT NULL DEFAULT 'unknown' CHECK (condition IN ('serviceable','unserviceable','repairable','ber','unknown')),
  state TEXT NOT NULL DEFAULT 'in_store' CHECK (state IN ('in_store','in_workshop','at_external','awaiting_collection','returned','on_issue')),
  expected_return TEXT,
  last_movement_at TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_equipment_ref_uq ON ofc_equipment(ref_no) WHERE deleted_at IS NULL;
CREATE INDEX ofc_equipment_serial_ix ON ofc_equipment(serial_no);
CREATE INDEX ofc_equipment_no_ix ON ofc_equipment(equip_no);
{{TRIGGERS_MUTABLE ofc_equipment}}

-- Every movement is an event; the equipment's state, place and custodian follow the latest one (FR-E2, FR-E3).
CREATE TABLE ofc_equipment_movement (
  {{EVENT_COLUMNS}}
  command_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('registered','received_for_repair','sent_out','returned_from_external','repair_completed','ready_for_collection','collected','issued','returned_from_issue','condition','correction')),
  movement_date TEXT NOT NULL,
  from_text TEXT,
  to_text TEXT,
  person_id TEXT,
  document_ref TEXT,
  expected_return TEXT,
  condition TEXT CHECK (condition IS NULL OR condition IN ('serviceable','unserviceable','repairable','ber','unknown')),
  work_order_id TEXT,
  note TEXT
);
CREATE INDEX ofc_eqm_equipment_ix ON ofc_equipment_movement(equipment_id, occurred_at);
{{TRIGGERS_EVENT ofc_equipment_movement}}

CREATE TABLE ofc_work_order (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  title TEXT NOT NULL,
  requesting_unit TEXT,
  requested_by TEXT,
  request_date TEXT NOT NULL,
  equipment_id TEXT,
  reported_defect TEXT,
  unit_id TEXT,
  supervisor_person_id TEXT,
  crew_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('immediate','high','normal','low')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','under_review','approved','assigned','in_progress','awaiting_spares','awaiting_external','completed','verified','closed','cancelled')),
  target_date TEXT,
  actions_taken TEXT,
  materials_required TEXT,
  external_agency TEXT,
  completion_details TEXT,
  completed_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  approval_ref TEXT,
  verified_by TEXT,
  verified_at TEXT,
  verify_note TEXT,
  closed_at TEXT,
  delay_reason TEXT,
  wrk_work_order_id TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_wo_ref_uq ON ofc_work_order(ref_no) WHERE deleted_at IS NULL;
CREATE INDEX ofc_wo_equipment_ix ON ofc_work_order(equipment_id);
CREATE INDEX ofc_wo_unit_ix ON ofc_work_order(unit_id);
{{TRIGGERS_MUTABLE ofc_work_order}}
