-- M15 Office management (SLE (E&T) II – North). Table prefix: ofc_
-- Day 1 foundation: office unit tree, generic record links, attachments, generic timeline. See OFFICE_R1_SPEC.md and D71.
-- No foreign keys on synced tables (DECISIONS D07). Nothing is deleted: units are deactivated, links are tombstoned with a reason.

-- Office unit tree anchored to an M01 command (home_scope_id = command id).
-- Levels: department > section (optional) > workshop > subsection. The dockyard itself is the M01 command.
CREATE TABLE ofc_org_unit (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  parent_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('department','section','workshop','subsection')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  head_user_id TEXT,
  deputy_user_id TEXT,
  -- Who may verify/close work owned by this unit (A5): the in-charge alone, or the officer over the unit must also be involved.
  verify_rule TEXT NOT NULL DEFAULT 'in_charge' CHECK (verify_rule IN ('in_charge','officer_required')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX ofc_org_unit_code_uq ON ofc_org_unit(command_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ofc_org_unit_parent_ix ON ofc_org_unit(parent_id);
{{TRIGGERS_MUTABLE ofc_org_unit}}

-- Link between any two records (letter <-> task <-> handover item <-> work order <-> equipment). Shown on both ends.
CREATE TABLE ofc_link (
  {{SYNC_COLUMNS}}
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('originated_from','reply_to','relates_to','supersedes')),
  note TEXT,
  CHECK (NOT (from_type = to_type AND from_id = to_id))
);
CREATE UNIQUE INDEX ofc_link_uq ON ofc_link(from_type, from_id, to_type, to_id, link_type) WHERE deleted_at IS NULL;
CREATE INDEX ofc_link_to_ix ON ofc_link(to_type, to_id);
{{TRIGGERS_MUTABLE ofc_link}}

-- Attachment metadata. The bytes live once per content hash in ofc_attachment_content (local to this installation, A9).
CREATE TABLE ofc_attachment (
  {{SYNC_COLUMNS}}
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  title TEXT,
  classification TEXT NOT NULL DEFAULT 'unclassified' CHECK (classification IN ('unclassified','restricted'))
);
CREATE INDEX ofc_attachment_sha_ix ON ofc_attachment(sha256);
{{TRIGGERS_MUTABLE ofc_attachment}}

-- One attachment can be attached to several records.
CREATE TABLE ofc_attachment_link (
  {{SYNC_COLUMNS}}
  attachment_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL
);
CREATE UNIQUE INDEX ofc_attachment_link_uq ON ofc_attachment_link(attachment_id, record_type, record_id) WHERE deleted_at IS NULL;
CREATE INDEX ofc_attachment_link_rec_ix ON ofc_attachment_link(record_type, record_id);
{{TRIGGERS_MUTABLE ofc_attachment_link}}

-- Not a synced entity: file bytes, written once, keyed by content hash.
CREATE TABLE ofc_attachment_content (
  sha256 TEXT PRIMARY KEY NOT NULL,
  bytes BLOB NOT NULL
);

-- Append-only timeline for any office record: comments, progress, status changes, reassignment, corrections.
CREATE TABLE ofc_record_event (
  {{EVENT_COLUMNS}}
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment','progress','status','assign','target_date','correction','attachment','link','cancel','reopen')),
  field TEXT,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  actor_name TEXT
);
CREATE INDEX ofc_record_event_rec_ix ON ofc_record_event(record_type, record_id, occurred_at);
{{TRIGGERS_EVENT ofc_record_event}}
