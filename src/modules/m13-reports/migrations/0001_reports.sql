-- M13 Reports, readiness, notifications. Table prefix: rpt_
-- Reports read only published views (<prefix>_v_*) of other modules. Notifications are local: each installation raises its own from its own data.
CREATE TABLE rpt_notification (
  id TEXT PRIMARY KEY NOT NULL,
  dedupe_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT,
  ref_type TEXT,
  ref_id TEXT,
  ship_id TEXT,
  first_raised_at TEXT NOT NULL,
  last_raised_at TEXT NOT NULL,
  resolved_at TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT
);
CREATE UNIQUE INDEX rpt_notification_key_uq ON rpt_notification(dedupe_key);
CREATE INDEX rpt_notification_open_ix ON rpt_notification(resolved_at, severity);
