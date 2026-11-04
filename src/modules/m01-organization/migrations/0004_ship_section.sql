-- Ship sections (Electrical, Engineering, General ...) become records held by their ship, like locations: the installation that
-- serves the ship (or the hub / a command) creates them, and only the creating installation edits them. org_department keeps the
-- command HQ departments, which stay hub reference data.
CREATE TABLE org_ship_section (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
-- home_scope_id = the ship. Codes are unique per ship among live rows.
CREATE UNIQUE INDEX org_ship_section_code_uq ON org_ship_section(home_scope_id, code) WHERE deleted_at IS NULL;
{{TRIGGERS_MUTABLE org_ship_section}}

-- Sections entered as departments under 0003 move here with the same id, owner, version and history columns, so parties and
-- user sections that point at them keep working. Every installation runs this on the same replicated rows, so the copies agree.
-- The old org_department rows stay (hub reference rows are never deleted locally) and are ignored from now on: the service
-- refuses owner_kind 'ship' for departments and lists leave them out.
INSERT INTO org_ship_section (id, version, owner_installation_id, home_scope_id, created_at, created_by, created_installation_id,
                              updated_at, updated_by, deleted_at, deleted_by, code, name, sort_order, status)
SELECT id, version, owner_installation_id, owner_id, created_at, created_by, created_installation_id,
       updated_at, updated_by, deleted_at, deleted_by, code, name, sort_order, status
FROM org_department WHERE owner_kind = 'ship' AND owner_id IS NOT NULL;
