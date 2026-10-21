-- Platform core (M00). Table prefix: sys_
-- Record classes: see SYNC_RULES.md §2.

-- local: this installation's own identity (one row). Never synchronized.
CREATE TABLE sys_local_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  installation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hub','command','ship','workshop')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  initialized_at TEXT NOT NULL
);

-- hub_reference: every installation known to the fleet.
CREATE TABLE sys_installation (
  {{SYNC_COLUMNS}}
  kind TEXT NOT NULL CHECK (kind IN ('hub','command','ship','workshop')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','decommissioned')),
  org_unit_kind TEXT,   -- ship | workshop | command (the unit this installation serves); no FK across modules
  org_unit_id TEXT
);
CREATE UNIQUE INDEX sys_installation_code_uq ON sys_installation(code);
{{TRIGGERS_MUTABLE sys_installation}}

-- event: audit envelope. Append-only.
CREATE TABLE sys_audit_event (
  {{EVENT_COLUMNS}}
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_version INTEGER,
  actor_user_id TEXT NOT NULL,
  actor_snapshot TEXT,      -- JSON: name/rank/number as at the time
  correlation_id TEXT NOT NULL,
  reason TEXT,
  authority_basis TEXT,     -- JSON
  changes TEXT,             -- JSON {field:[old,new]}
  outcome TEXT NOT NULL CHECK (outcome IN ('success','denied','failed'))
);
CREATE INDEX sys_audit_event_entity_ix ON sys_audit_event(entity_type, entity_id);
CREATE INDEX sys_audit_event_actor_ix ON sys_audit_event(actor_user_id, occurred_at);
{{TRIGGERS_EVENT sys_audit_event}}

-- local: transport ledger. Every locally written or received change gets a local seq (pull/push cursor).
CREATE TABLE sys_change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL UNIQUE,
  origin_installation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert','tombstone','event')),
  version INTEGER NOT NULL,
  owner_installation_id TEXT NOT NULL,
  home_scope_id TEXT,
  occurred_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  received_from_installation_id TEXT   -- NULL = written locally
);
CREATE INDEX sys_change_log_entity_ix ON sys_change_log(entity_type, entity_id, version);
CREATE INDEX sys_change_log_origin_ix ON sys_change_log(origin_installation_id, seq);

-- hub_reference: sequence definitions (tag prefix and width are configured centrally).
CREATE TABLE sys_number_sequence (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,          -- e.g. equipment_tag
  prefix TEXT NOT NULL,        -- e.g. SLN-EQ
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 12),
  description TEXT
);
CREATE UNIQUE INDEX sys_number_sequence_code_uq ON sys_number_sequence(code);
{{TRIGGERS_MUTABLE sys_number_sequence}}

-- hub_reference: non-overlapping ranges granted to installations. Immutable once granted.
CREATE TABLE sys_number_range (
  {{SYNC_COLUMNS}}
  sequence_code TEXT NOT NULL,
  allocated_to_installation_id TEXT NOT NULL,
  range_start INTEGER NOT NULL CHECK (range_start >= 1),
  range_end INTEGER NOT NULL,
  CHECK (range_end >= range_start)
);
CREATE UNIQUE INDEX sys_number_range_start_uq ON sys_number_range(sequence_code, range_start);
CREATE INDEX sys_number_range_alloc_ix ON sys_number_range(allocated_to_installation_id, sequence_code);
CREATE TRIGGER sys_number_range_no_overlap BEFORE INSERT ON sys_number_range
WHEN EXISTS (SELECT 1 FROM sys_number_range r
             WHERE r.sequence_code = NEW.sequence_code
               AND r.range_start <= NEW.range_end AND r.range_end >= NEW.range_start)
BEGIN SELECT RAISE(ABORT, 'number range overlaps an existing range'); END;
{{TRIGGERS_MUTABLE sys_number_range}}

-- local: how much of each granted range this installation has consumed.
CREATE TABLE sys_number_cursor (
  range_id TEXT PRIMARY KEY NOT NULL,
  next_value INTEGER NOT NULL
);

-- local: installation-level settings (display time zone, stale thresholds ...).
CREATE TABLE sys_setting (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
