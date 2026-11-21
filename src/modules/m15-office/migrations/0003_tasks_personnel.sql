-- M15 Day 3: personnel register, responsibilities, duty periods, tasks. OFFICE_R1_SPEC.md §1.5, §1.6.
-- Work is assigned to a PERSON (ofc_person), who may or may not sign in (user_id). Day 2 columns action_user_id and
-- responsible_user_id hold person ids from now on (D72).

CREATE TABLE ofc_person (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  user_id TEXT,
  service_no TEXT,
  rank TEXT,
  name TEXT NOT NULL,
  appointment TEXT,
  unit_id TEXT,
  supervisor_person_id TEXT,
  contact TEXT,
  duty_status TEXT NOT NULL DEFAULT 'available' CHECK (duty_status IN ('available','on_leave','temporary_duty','course','sick','transferred')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_person_service_uq ON ofc_person(command_id, service_no) WHERE deleted_at IS NULL AND service_no IS NOT NULL;
CREATE UNIQUE INDEX ofc_person_user_uq ON ofc_person(command_id, user_id) WHERE deleted_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX ofc_person_unit_ix ON ofc_person(unit_id);
{{TRIGGERS_MUTABLE ofc_person}}

CREATE TABLE ofc_responsibility (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  title TEXT NOT NULL,
  unit_id TEXT,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ofc_resp_person_ix ON ofc_responsibility(person_id);
{{TRIGGERS_MUTABLE ofc_responsibility}}

CREATE TABLE ofc_duty_period (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  duty_status TEXT NOT NULL CHECK (duty_status IN ('on_leave','temporary_duty','course','sick')),
  date_from TEXT NOT NULL,
  date_to TEXT,
  place TEXT,
  acting_person_id TEXT,
  remarks TEXT,
  CHECK (date_to IS NULL OR date_to >= date_from)
);
CREATE INDEX ofc_duty_person_ix ON ofc_duty_period(person_id);
{{TRIGGERS_MUTABLE ofc_duty_period}}

CREATE TABLE ofc_task (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  unit_id TEXT,
  assignee_person_id TEXT,
  assigned_by TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('immediate','high','normal','low')),
  start_date TEXT,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','assigned','in_progress','awaiting_info','awaiting_approval','on_hold','completed','closed','cancelled')),
  progress_pct INTEGER CHECK (progress_pct IS NULL OR (progress_pct BETWEEN 0 AND 100)),
  delay_reason TEXT,
  completion_note TEXT,
  completed_at TEXT,
  completed_by TEXT,
  closed_at TEXT,
  closed_by TEXT,
  verify_note TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_task_ref_uq ON ofc_task(ref_no) WHERE deleted_at IS NULL;
CREATE INDEX ofc_task_assignee_ix ON ofc_task(assignee_person_id);
CREATE INDEX ofc_task_parent_ix ON ofc_task(parent_id);
CREATE INDEX ofc_task_unit_ix ON ofc_task(unit_id);
{{TRIGGERS_MUTABLE ofc_task}}
