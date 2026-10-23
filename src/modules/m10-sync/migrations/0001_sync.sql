-- M10 Provisioning, selective sync, conflict handling. Table prefix: syn_
-- Every table here is local working state (never synchronized): keys, peers, cursors, quarantine and session history.

-- local: this installation's signing key pair (Ed25519, PEM). Private key never leaves this database.
CREATE TABLE syn_local_key (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  public_pem TEXT NOT NULL,
  private_pem TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- local: the installations this one talks to. At a replica: one row (the hub). At the hub: one row per replica.
CREATE TABLE syn_peer (
  installation_id TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('hub','replica')),
  kind TEXT NOT NULL CHECK (kind IN ('hub','command','ship','workshop')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','decommissioned')),
  public_key_pem TEXT,
  enrol_secret_hash TEXT,          -- hub only; cleared once the replica has enrolled
  enrol_secret TEXT,               -- replica only: the one-time secret from the provisioning package, cleared after the first hello
  audience_seq INTEGER NOT NULL DEFAULT 0, -- hub: newest user-to-installation link already accounted for in sub_epoch
  sub_epoch INTEGER NOT NULL DEFAULT 0, -- hub: bumped when a subscription grows; replica: last epoch seen (a change makes it re-pull from 0)
  url TEXT,                        -- replica only: how to reach the hub
  push_cursor INTEGER NOT NULL DEFAULT 0,   -- replica: last local seq the hub has acknowledged
  pull_cursor INTEGER NOT NULL DEFAULT 0,   -- replica: last hub seq applied. hub: last hub seq delivered to this replica
  accepted_origin_seq INTEGER NOT NULL DEFAULT 0, -- hub: highest seq of this replica's log the hub has accepted
  include_unscoped_hub INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_skew_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX syn_peer_code_uq ON syn_peer(code);

-- local (hub): which scopes (ships, workshops, commands) each replica receives, besides fleet reference data.
CREATE TABLE syn_subscription (
  peer_installation_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('command','ship','workshop','department')),
  scope_id TEXT NOT NULL,
  PRIMARY KEY (peer_installation_id, scope_id)
);

-- local: changes that were received but not applied, and what to do about them.
CREATE TABLE syn_conflict (
  id TEXT PRIMARY KEY NOT NULL,
  change_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code IN ('FORK','INTEGRITY','SCHEMA_NEWER','UNKNOWN_ENTITY','APPLY_FAILED','DEPENDENCY_MISSING','HUB_OVERWRITE')),
  detail TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  incoming_version INTEGER NOT NULL,
  local_version INTEGER,
  origin_installation_id TEXT NOT NULL,
  received_from_installation_id TEXT NOT NULL,
  change_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution TEXT
);
CREATE UNIQUE INDEX syn_conflict_change_uq ON syn_conflict(change_id);
CREATE INDEX syn_conflict_status_ix ON syn_conflict(status, detected_at);

-- local: history of exchanges.
CREATE TABLE syn_session (
  id TEXT PRIMARY KEY NOT NULL,
  peer_installation_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('http','bundle_in','bundle_out')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  pushed INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0,
  pulled INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX syn_session_started_ix ON syn_session(started_at);

-- derived: outgoing changes not yet acknowledged, per peer (replica side).
CREATE VIEW syn_v_outbound AS
SELECT p.installation_id AS peer_installation_id, COUNT(c.seq) AS pending
FROM syn_peer p LEFT JOIN sys_change_log c ON c.seq > p.push_cursor AND c.received_from_installation_id IS NULL
WHERE p.role = 'hub'
GROUP BY p.installation_id;

-- Published read models for M13 (views only): one row of overall health, and one row per peer.
CREATE VIEW syn_v_peer_health AS
SELECT p.installation_id AS peer_installation_id, p.role, p.kind, p.code, p.name, p.status, p.last_sync_at, p.last_skew_ms,
       CASE WHEN p.role = 'hub' THEN (SELECT COUNT(*) FROM sys_change_log c WHERE c.seq > p.push_cursor AND c.received_from_installation_id IS NULL) ELSE 0 END AS pending_outbound
FROM syn_peer p;

CREATE VIEW syn_v_health AS
SELECT (SELECT COUNT(*) FROM syn_conflict WHERE status = 'open') AS open_conflicts,
       (SELECT COUNT(*) FROM syn_conflict WHERE status = 'open' AND code = 'FORK') AS open_forks,
       (SELECT COUNT(*) FROM sys_change_log) AS change_log_size;
