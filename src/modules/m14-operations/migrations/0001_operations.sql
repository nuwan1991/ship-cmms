-- M14 Integration, deployment, backup, recovery. Table prefix: ops_
-- Local operational history of this installation; never synchronized.
CREATE TABLE ops_backup_log (
  id TEXT PRIMARY KEY NOT NULL,
  file_name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('manual','scheduled','pre_upgrade','pre_restore')),
  schema_versions TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  verified_at TEXT,
  verify_ok INTEGER,
  verify_detail TEXT,
  removed_at TEXT
);
CREATE INDEX ops_backup_log_created_ix ON ops_backup_log(created_at);

CREATE TABLE ops_restore_log (
  id TEXT PRIMARY KEY NOT NULL,
  restored_from TEXT NOT NULL,
  restored_at TEXT NOT NULL,
  backup_created_at TEXT,
  source_installation_id TEXT,
  safety_backup TEXT,
  note TEXT
);

CREATE TABLE ops_integrity_check (
  id TEXT PRIMARY KEY NOT NULL,
  ran_at TEXT NOT NULL,
  ran_by TEXT NOT NULL,
  ok INTEGER NOT NULL,
  problem_count INTEGER NOT NULL,
  findings_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);
CREATE INDEX ops_integrity_check_ran_ix ON ops_integrity_check(ran_at);
