-- M03 Asset register. Table prefix: ast_
-- Classes: classification = hub_reference; position, responsibility, asset = owner_mutable; movement = event; current = derived.
-- No foreign keys on synced tables (DECISIONS D07). Uniqueness is among live rows except asset_tag, which is never reused.

CREATE TABLE ast_classification (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('equipment','component')),
  parent_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX ast_classification_code_uq ON ast_classification(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE ast_classification}}

-- Functional tree of one ship (home_scope_id = ship id): system > equipment_group > equipment > component.
-- A position is a place in the ship's structure; physical assets are installed into positions over time.
CREATE TABLE ast_position (
  {{SYNC_COLUMNS}}
  parent_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('system','equipment_group','equipment','component')),
  position_tag TEXT NOT NULL,
  name TEXT NOT NULL,
  classification_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX ast_position_tag_uq ON ast_position(home_scope_id, position_tag) WHERE deleted_at IS NULL;
CREATE INDEX ast_position_parent_ix ON ast_position(parent_id);
{{TRIGGERS_MUTABLE ast_position}}

-- Dated responsible department per position (department responsibility is separate from location and command attachment).
CREATE TABLE ast_position_responsibility (
  {{SYNC_COLUMNS}}
  position_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  reason TEXT,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX ast_position_responsibility_pos_ix ON ast_position_responsibility(position_id, effective_from);
{{TRIGGERS_MUTABLE ast_position_responsibility}}
CREATE TRIGGER ast_position_responsibility_no_overlap_ins BEFORE INSERT ON ast_position_responsibility
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM ast_position_responsibility a
  WHERE a.position_id = NEW.position_id AND a.deleted_at IS NULL AND a.id <> NEW.id
    AND a.effective_from < COALESCE(NEW.effective_to, '9999-12-31T23:59:59.999Z')
    AND COALESCE(a.effective_to, '9999-12-31T23:59:59.999Z') > NEW.effective_from)
BEGIN SELECT RAISE(ABORT, 'position responsibilities overlap'); END;
CREATE TRIGGER ast_position_responsibility_no_overlap_upd BEFORE UPDATE ON ast_position_responsibility
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM ast_position_responsibility a
  WHERE a.position_id = NEW.position_id AND a.deleted_at IS NULL AND a.id <> NEW.id
    AND a.effective_from < COALESCE(NEW.effective_to, '9999-12-31T23:59:59.999Z')
    AND COALESCE(a.effective_to, '9999-12-31T23:59:59.999Z') > NEW.effective_from)
BEGIN SELECT RAISE(ABORT, 'position responsibilities overlap'); END;

-- The physical item. id and asset_tag are permanent; serial number and installation position tag are separate facts.
-- home_scope_id = home ship (NULL for stock/spares). Owner = installation that registered it.
CREATE TABLE ast_asset (
  {{SYNC_COLUMNS}}
  asset_tag TEXT NOT NULL,
  name TEXT NOT NULL,
  serial_number TEXT,
  manufacturer TEXT,
  model TEXT,
  classification_id TEXT,
  notes TEXT
);
CREATE UNIQUE INDEX ast_asset_tag_uq ON ast_asset(asset_tag);
CREATE UNIQUE INDEX ast_asset_serial_uq ON ast_asset(manufacturer, serial_number) WHERE deleted_at IS NULL AND manufacturer IS NOT NULL AND serial_number IS NOT NULL;
{{TRIGGERS_MUTABLE ast_asset}}
CREATE TRIGGER ast_asset_tag_immutable BEFORE UPDATE OF asset_tag ON ast_asset
WHEN NEW.asset_tag <> OLD.asset_tag
BEGIN SELECT RAISE(ABORT, 'asset_tag is permanent'); END;

-- Install, remove, custody transfer, status change, with when/where/who holds it. Corrections are `void` events.
CREATE TABLE ast_asset_movement (
  {{EVENT_COLUMNS}}
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('register','install','remove','custody_transfer','status_change','void')),
  position_id TEXT,
  location_id TEXT,
  custody_party_kind TEXT CHECK (custody_party_kind IN ('command','ship','department','workshop','external_provider')),
  custody_party_id TEXT,
  asset_status TEXT CHECK (asset_status IN ('in_service','in_store','under_repair','out_of_service','condemned')),
  note TEXT,
  corrects_movement_id TEXT,
  CHECK ((custody_party_kind IS NULL) = (custody_party_id IS NULL))
);
CREATE INDEX ast_asset_movement_asset_ix ON ast_asset_movement(asset_id, occurred_at, id);
CREATE INDEX ast_asset_movement_position_ix ON ast_asset_movement(position_id);
{{TRIGGERS_EVENT ast_asset_movement}}

-- derived: folded from movements, rebuilt locally, never synchronized.
CREATE TABLE ast_asset_current (
  asset_id TEXT PRIMARY KEY NOT NULL,
  position_id TEXT,
  location_id TEXT,
  custody_party_kind TEXT,
  custody_party_id TEXT,
  asset_status TEXT,
  installed_since TEXT,
  last_movement_id TEXT,
  last_occurred_at TEXT,
  rebuilt_at TEXT NOT NULL
);
CREATE INDEX ast_asset_current_position_ix ON ast_asset_current(position_id);

-- Published read models (M13 reads views only).
CREATE VIEW ast_v_asset_overview AS
SELECT a.id AS asset_id, a.asset_tag, a.name, a.serial_number, a.manufacturer, a.model,
       a.home_scope_id AS home_ship_id, k.code AS classification_code, k.name AS classification_name,
       c.position_id, p.position_tag, p.name AS position_name, p.home_scope_id AS ship_id,
       c.location_id, c.custody_party_kind, c.custody_party_id, c.asset_status, c.installed_since
FROM ast_asset a
LEFT JOIN ast_asset_current c ON c.asset_id = a.id
LEFT JOIN ast_position p ON p.id = c.position_id
LEFT JOIN ast_classification k ON k.id = a.classification_id
WHERE a.deleted_at IS NULL;

-- Positions that replicated events left with more than one asset (flagged for review, never rejected).
CREATE VIEW ast_v_position_conflicts AS
SELECT position_id, COUNT(*) AS asset_count FROM ast_asset_current WHERE position_id IS NOT NULL GROUP BY position_id HAVING COUNT(*) > 1;
