-- M15: daily crew attendance per workshop, rolled up to section and department.
-- One mark per person per day. unit_id is the person's unit on that day, so moving someone later does not rewrite past summaries.

CREATE TABLE ofc_attendance (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  unit_id TEXT,
  att_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','late','leave','sick','duty','course','absent','off')),
  remarks TEXT,
  marked_by_name TEXT
);
CREATE UNIQUE INDEX ofc_attendance_uq ON ofc_attendance(person_id, att_date) WHERE deleted_at IS NULL;
CREATE INDEX ofc_attendance_day_ix ON ofc_attendance(command_id, att_date);
{{TRIGGERS_MUTABLE ofc_attendance}}
