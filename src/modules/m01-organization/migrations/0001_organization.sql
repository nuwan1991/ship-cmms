-- M01 Organizations, ships, commands, locations. Table prefix: org_
-- Classes: all hub_reference except org_location (owner_mutable). No foreign keys on synced tables (DECISIONS D07).
-- Uniqueness is enforced only among live rows (deleted_at IS NULL) so a tombstoned code can be reused.

CREATE TABLE org_fleet (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX org_fleet_code_uq ON org_fleet(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE org_fleet}}

CREATE TABLE org_command (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX org_command_code_uq ON org_command(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE org_command}}

CREATE TABLE org_ship (
  {{SYNC_COLUMNS}}
  fleet_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  pennant_no TEXT,
  ship_class TEXT,
  ship_type TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','laid_up','decommissioned'))
);
CREATE UNIQUE INDEX org_ship_code_uq ON org_ship(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX org_ship_pennant_uq ON org_ship(pennant_no) WHERE deleted_at IS NULL AND pennant_no IS NOT NULL;
{{TRIGGERS_MUTABLE org_ship}}

-- Dated attachment of a ship to a command. Interval is [effective_from, effective_to); NULL effective_to = open.
CREATE TABLE org_ship_command_assignment (
  {{SYNC_COLUMNS}}
  ship_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  reason TEXT,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX org_ship_command_assignment_ship_ix ON org_ship_command_assignment(ship_id, effective_from);
CREATE INDEX org_ship_command_assignment_cmd_ix ON org_ship_command_assignment(command_id);
{{TRIGGERS_MUTABLE org_ship_command_assignment}}
-- Backstop for the service rule: live assignments of one ship never overlap (hub is the only writer).
CREATE TRIGGER org_ship_command_assignment_no_overlap_ins BEFORE INSERT ON org_ship_command_assignment
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM org_ship_command_assignment a
  WHERE a.ship_id = NEW.ship_id AND a.deleted_at IS NULL AND a.id <> NEW.id
    AND a.effective_from < COALESCE(NEW.effective_to, '9999-12-31T23:59:59.999Z')
    AND COALESCE(a.effective_to, '9999-12-31T23:59:59.999Z') > NEW.effective_from)
BEGIN SELECT RAISE(ABORT, 'ship command assignments overlap'); END;
CREATE TRIGGER org_ship_command_assignment_no_overlap_upd BEFORE UPDATE ON org_ship_command_assignment
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM org_ship_command_assignment a
  WHERE a.ship_id = NEW.ship_id AND a.deleted_at IS NULL AND a.id <> NEW.id
    AND a.effective_from < COALESCE(NEW.effective_to, '9999-12-31T23:59:59.999Z')
    AND COALESCE(a.effective_to, '9999-12-31T23:59:59.999Z') > NEW.effective_from)
BEGIN SELECT RAISE(ABORT, 'ship command assignments overlap'); END;

CREATE TABLE org_department (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX org_department_code_uq ON org_department(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE org_department}}

-- kind: onboard (ship_id set) | command (command_id set) | specialist (neither; serves any command by capability, M08)
CREATE TABLE org_workshop (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('onboard','command','specialist')),
  command_id TEXT,
  ship_id TEXT,
  has_replica INTEGER NOT NULL DEFAULT 0 CHECK (has_replica IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX org_workshop_code_uq ON org_workshop(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE org_workshop}}

CREATE TABLE org_external_provider (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX org_external_provider_code_uq ON org_external_provider(code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE org_external_provider}}

-- Physical places. One tree per site; home_scope_id = the site (ship or workshop) id. Owner = installation that entered it.
CREATE TABLE org_location (
  {{SYNC_COLUMNS}}
  site_kind TEXT NOT NULL CHECK (site_kind IN ('ship','workshop')),
  parent_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'compartment' CHECK (kind IN ('deck','compartment','space','room','tank','area','yard','other')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX org_location_code_uq ON org_location(home_scope_id, COALESCE(parent_id, ''), code) WHERE deleted_at IS NULL;
CREATE INDEX org_location_parent_ix ON org_location(parent_id);
{{TRIGGERS_MUTABLE org_location}}

-- Published read model: each live ship with its command attachment at this moment (NULL command when unattached).
CREATE VIEW org_v_ship_current_command AS
SELECT s.id AS ship_id, s.code AS ship_code, s.name AS ship_name, s.status AS ship_status,
       a.id AS assignment_id, a.effective_from AS assigned_since,
       c.id AS command_id, c.code AS command_code, c.name AS command_name
FROM org_ship s
LEFT JOIN org_ship_command_assignment a
  ON a.ship_id = s.id AND a.deleted_at IS NULL
 AND a.effective_from <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 AND (a.effective_to IS NULL OR a.effective_to > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
LEFT JOIN org_command c ON c.id = a.command_id AND c.deleted_at IS NULL
WHERE s.deleted_at IS NULL;
