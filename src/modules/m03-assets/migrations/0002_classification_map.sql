-- M03 legacy classification crosswalk (DECISIONS D62). Hub reference data, fleet distribution.
-- One row says how a code from a legacy system relates to a standard classification:
--   exact     same meaning                                  -> records can be re-pointed automatically
--   broader   the standard class is wider than the legacy   -> records can be re-pointed automatically
--   narrower  the legacy code is split over several classes -> each record is decided by a person
--   related   for reference only                            -> never re-points anything
-- legacy_system 'CMMS' means codes that already exist as classifications in this CMMS (re-pointed by the remap tool);
-- any other value names an outside source (old CMMS, shipyard SFI list, allowance parts lists) used to translate imports.

CREATE TABLE ast_classification_map (
  {{SYNC_COLUMNS}}
  legacy_system TEXT NOT NULL,
  legacy_code TEXT NOT NULL,
  legacy_name TEXT,
  target_classification_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('exact','broader','narrower','related')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX ast_classification_map_uq ON ast_classification_map(legacy_system, legacy_code, target_classification_id) WHERE deleted_at IS NULL;
CREATE INDEX ast_classification_map_code_ix ON ast_classification_map(legacy_code);
CREATE INDEX ast_classification_map_target_ix ON ast_classification_map(target_classification_id);
{{TRIGGERS_MUTABLE ast_classification_map}}
