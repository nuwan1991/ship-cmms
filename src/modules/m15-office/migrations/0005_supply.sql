-- M15 Day 4: supply demand tracking (OFFICE_R1_SPEC.md §1.8a) and office settings.

CREATE TABLE ofc_setting (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL
);
CREATE UNIQUE INDEX ofc_setting_uq ON ofc_setting(command_id, key) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE ofc_setting}}

CREATE TABLE ofc_supply_demand (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  supply_ref TEXT,
  demand_date TEXT NOT NULL,
  item TEXT NOT NULL,
  part_no TEXT,
  quantity REAL,
  unit_of_issue TEXT,
  demanding_unit TEXT,
  unit_id TEXT,
  work_order_id TEXT,
  task_id TEXT,
  equipment_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('immediate','high','normal','low')),
  stage TEXT NOT NULL,
  stage_date TEXT NOT NULL,
  expected_date TEXT,
  supply_contact TEXT,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1)),
  import_batch_id TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_supply_ref_uq ON ofc_supply_demand(ref_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ofc_supply_sref_uq ON ofc_supply_demand(command_id, supply_ref) WHERE deleted_at IS NULL AND supply_ref IS NOT NULL;
CREATE INDEX ofc_supply_wo_ix ON ofc_supply_demand(work_order_id);
{{TRIGGERS_MUTABLE ofc_supply_demand}}
