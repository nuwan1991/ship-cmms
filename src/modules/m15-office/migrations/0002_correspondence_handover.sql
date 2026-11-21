-- M15 Day 2: correspondence register with matters (file threads), handover packets and items. See OFFICE_R1_SPEC.md §1.3, §1.4.
-- home_scope_id = the office's M01 command on every row. Imported rows keep original_ref and their dates (FR-X2).

CREATE TABLE ofc_matter (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  title TEXT NOT NULL,
  file_ref TEXT,
  unit_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_matter_ref_uq ON ofc_matter(ref_no) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE ofc_matter}}

CREATE TABLE ofc_correspondence (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('incoming','outgoing','minute','signal','other')),
  official_ref TEXT,
  file_ref TEXT,
  letter_date TEXT,
  received_date TEXT,
  sent_date TEXT,
  originator TEXT,
  recipients TEXT,
  subject TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'unclassified' CHECK (classification IN ('unclassified','restricted')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('immediate','high','normal','low')),
  reply_required INTEGER NOT NULL DEFAULT 0 CHECK (reply_required IN (0,1)),
  reply_due TEXT,
  no_reply_reason TEXT,
  action_user_id TEXT,
  unit_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('received','under_action','replied','filed','draft','signed','dispatched','acknowledged','open','cancelled')),
  dispatch_mode TEXT,
  matter_id TEXT,
  reply_to_id TEXT,
  original_ref TEXT,
  import_batch_id TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_corr_ref_uq ON ofc_correspondence(ref_no) WHERE deleted_at IS NULL;
CREATE INDEX ofc_corr_official_ix ON ofc_correspondence(official_ref);
CREATE INDEX ofc_corr_matter_ix ON ofc_correspondence(matter_id);
CREATE INDEX ofc_corr_reply_ix ON ofc_correspondence(reply_to_id);
{{TRIGGERS_MUTABLE ofc_correspondence}}

-- FR-K5: a letter is pending while a reply is required, none was dispatched, and it was not cancelled, filed or released ("no reply needed").
CREATE VIEW ofc_v_correspondence_pending AS
SELECT c.* FROM ofc_correspondence c
 WHERE c.deleted_at IS NULL AND c.reply_required = 1 AND c.no_reply_reason IS NULL
   AND c.status NOT IN ('cancelled','filed','replied')
   AND NOT EXISTS (SELECT 1 FROM ofc_correspondence r WHERE r.reply_to_id = c.id AND r.deleted_at IS NULL AND r.status IN ('dispatched','acknowledged'));

CREATE TABLE ofc_handover_packet (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  appointment TEXT NOT NULL,
  unit_id TEXT,
  from_name TEXT NOT NULL,
  from_user_id TEXT,
  to_name TEXT NOT NULL,
  to_user_id TEXT,
  handover_date TEXT,
  takeover_date TEXT,
  document_ref TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','in_progress','completed')),
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_hov_ref_uq ON ofc_handover_packet(ref_no) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE ofc_handover_packet}}

CREATE TABLE ofc_handover_item (
  {{SYNC_COLUMNS}}
  command_id TEXT NOT NULL,
  packet_id TEXT NOT NULL,
  ref_no TEXT NOT NULL,
  annex_ref TEXT,
  category TEXT NOT NULL CHECK (category IN ('responsibility','project','pending_work','unresolved','correspondence','equipment','other')),
  subject TEXT NOT NULL,
  description TEXT,
  previous_status TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','not_applicable')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('immediate','high','normal','low')),
  urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0,1)),
  responsible_user_id TEXT,
  unit_id TEXT,
  target_date TEXT,
  latest_action TEXT,
  latest_action_at TEXT,
  original_ref TEXT,
  import_batch_id TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX ofc_hoi_ref_uq ON ofc_handover_item(ref_no) WHERE deleted_at IS NULL;
CREATE INDEX ofc_hoi_packet_ix ON ofc_handover_item(packet_id);
{{TRIGGERS_MUTABLE ofc_handover_item}}
