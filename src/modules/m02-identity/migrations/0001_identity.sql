-- M02 Identity, roles, permissions, offline authority. Table prefix: idn_
-- Classes: H hub_reference, E event, L local. No foreign keys on synced tables (DECISIONS D07).
-- Uniqueness is enforced only among live rows (deleted_at IS NULL).

-- Person identity. No credentials here; `id` is the immutable user id used by every audit row and approval.
CREATE TABLE idn_user (
  {{SYNC_COLUMNS}}
  display_name TEXT NOT NULL,
  rank TEXT,
  service_number TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX idn_user_service_number_uq ON idn_user(service_number) WHERE deleted_at IS NULL AND service_number IS NOT NULL;
{{TRIGGERS_MUTABLE idn_user}}

-- Username + password hash. Replicated only to installations the user is provisioned to (idn_user_installation).
-- credential_version increases on every change; a change affects future authentication only.
CREATE TABLE idn_credential (
  {{SYNC_COLUMNS}}
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idn_credential_user_uq ON idn_credential(user_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idn_credential_username_uq ON idn_credential(username) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE idn_credential}}

-- Which users are provisioned to which installation, with an optional per-user lease cap.
CREATE TABLE idn_user_installation (
  {{SYNC_COLUMNS}}
  user_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  lease_expires_at TEXT
);
CREATE UNIQUE INDEX idn_user_installation_uq ON idn_user_installation(user_id, installation_id) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE idn_user_installation}}

CREATE TABLE idn_role (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX idn_role_code_uq ON idn_role(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE idn_role}}

-- permission: exact code (org.ship.view), prefix wildcard (org.*) or '*'.
CREATE TABLE idn_role_permission (
  {{SYNC_COLUMNS}}
  role_id TEXT NOT NULL,
  permission TEXT NOT NULL
);
CREATE UNIQUE INDEX idn_role_permission_uq ON idn_role_permission(role_id, permission) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE idn_role_permission}}

-- Dated, scoped role assignment. scope_id NULL only for scope_kind 'fleet'.
CREATE TABLE idn_role_assignment (
  {{SYNC_COLUMNS}}
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('fleet','command','ship','workshop','department')),
  scope_id TEXT,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX idn_role_assignment_user_ix ON idn_role_assignment(user_id);
{{TRIGGERS_MUTABLE idn_role_assignment}}

-- Offline lease length. installation_id and role_id are each optional; the most specific match wins.
CREATE TABLE idn_offline_grant (
  {{SYNC_COLUMNS}}
  installation_id TEXT,
  role_id TEXT,
  lease_days INTEGER NOT NULL CHECK (lease_days BETWEEN 1 AND 365)
);
CREATE UNIQUE INDEX idn_offline_grant_uq ON idn_offline_grant(COALESCE(installation_id, ''), COALESCE(role_id, '')) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE idn_offline_grant}}

-- Per gate/permission code: approval mode and what is allowed once the offline lease has expired.
CREATE TABLE idn_gate_policy (
  {{SYNC_COLUMNS}}
  gate_code TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mandatory_prior','review_pending_allowed','none')),
  offline_policy TEXT NOT NULL DEFAULT 'provisional' CHECK (offline_policy IN ('allow','provisional','deny'))
);
CREATE UNIQUE INDEX idn_gate_policy_uq ON idn_gate_policy(gate_code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE idn_gate_policy}}

-- Immutable approvals. occurred_at = the actual decision time; recorded_at = when it was entered.
-- Keyed by user id with an actor snapshot, so username/password changes never touch them.
-- Corrections and ratifications are new rows (decision 'ratified', ratifies_approval_id).
CREATE TABLE idn_approval (
  {{EVENT_COLUMNS}}
  gate_code TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','ratified')),
  actor_user_id TEXT NOT NULL,
  actor_snapshot TEXT NOT NULL,
  authority_basis TEXT,
  confirmation_state TEXT NOT NULL DEFAULT 'confirmed' CHECK (confirmation_state IN ('confirmed','pending_confirmation')),
  ratifies_approval_id TEXT,
  comment TEXT
);
CREATE INDEX idn_approval_subject_ix ON idn_approval(subject_type, subject_id, gate_code);
CREATE INDEX idn_approval_actor_ix ON idn_approval(actor_user_id, occurred_at);
{{TRIGGERS_EVENT idn_approval}}

-- Authority withdrawn (kind 'revoke') or restored ('reinstate'), for a whole user (role_assignment_id NULL) or one assignment.
-- effective_at = when authority really changed; issued_at = when the decision was made. Receipt time is in sys_change_log.
CREATE TABLE idn_authority_revocation (
  {{EVENT_COLUMNS}}
  user_id TEXT NOT NULL,
  role_assignment_id TEXT,
  kind TEXT NOT NULL DEFAULT 'revoke' CHECK (kind IN ('revoke','reinstate')),
  effective_at TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX idn_authority_revocation_user_ix ON idn_authority_revocation(user_id, effective_at);
{{TRIGGERS_EVENT idn_authority_revocation}}

-- local: sessions (token stored only as a hash).
CREATE TABLE idn_session (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idn_session_user_ix ON idn_session(user_id);

-- local: installation-scoped password reset by a local administrator. Superseded when a newer hub credential arrives.
CREATE TABLE idn_local_password (
  user_id TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

-- Read model for M05 (administrative closure) and review queues. An approval needs review while it is a provisional
-- (offline) approval not yet ratified, or its actor's authority was withdrawn effective at or before the decision
-- (latest revoke/reinstate event at that instant wins, for the whole user and for the assignment that granted it).
CREATE VIEW idn_v_approval_status AS
SELECT approval_id, gate_code, subject_type, subject_id, decision, actor_user_id, decided_at, recorded_at,
       owner_installation_id, confirmation_state, ratified,
       (confirmation_state = 'pending_confirmation' AND ratified = 0) AS pending_confirmation,
       (ratified = 0 AND (COALESCE(user_kind, '') = 'revoke' OR COALESCE(assignment_kind, '') = 'revoke')) AS authority_disputed,
       ((confirmation_state = 'pending_confirmation' AND ratified = 0)
         OR (ratified = 0 AND (COALESCE(user_kind, '') = 'revoke' OR COALESCE(assignment_kind, '') = 'revoke'))) AS needs_review
FROM (
  SELECT a.id AS approval_id, a.gate_code, a.subject_type, a.subject_id, a.decision, a.actor_user_id,
         a.occurred_at AS decided_at, a.recorded_at, a.owner_installation_id, a.confirmation_state,
         EXISTS (SELECT 1 FROM idn_approval b WHERE b.ratifies_approval_id = a.id AND b.decision = 'ratified') AS ratified,
         (SELECT r.kind FROM idn_authority_revocation r
           WHERE r.user_id = a.actor_user_id AND r.role_assignment_id IS NULL AND r.effective_at <= a.occurred_at
           ORDER BY r.effective_at DESC, r.id DESC LIMIT 1) AS user_kind,
         (SELECT r.kind FROM idn_authority_revocation r
           WHERE r.role_assignment_id = json_extract(a.authority_basis, '$.roleAssignmentId') AND r.effective_at <= a.occurred_at
           ORDER BY r.effective_at DESC, r.id DESC LIMIT 1) AS assignment_kind
  FROM idn_approval a WHERE a.decision <> 'ratified'
);
