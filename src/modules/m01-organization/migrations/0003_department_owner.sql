-- Departments have an owner: a command HQ department (owner_kind = 'command') or a section inside a ship (owner_kind = 'ship',
-- e.g. Electrical, Engineering, General). Rows from before this change have no owner and are treated as command departments
-- not yet attached to a command. Codes are unique per owner (each ship has its own ENG, ELEC, GEN ...).
-- Owner kind and id are both set or both empty; enforced in the service (SQLite cannot add a table CHECK to an existing table).
ALTER TABLE org_department ADD COLUMN owner_kind TEXT CHECK (owner_kind IS NULL OR owner_kind IN ('command','ship'));
ALTER TABLE org_department ADD COLUMN owner_id TEXT;
DROP INDEX org_department_code_uq;
CREATE UNIQUE INDEX org_department_owner_code_uq ON org_department(COALESCE(owner_id, ''), code) WHERE deleted_at IS NULL;
CREATE INDEX org_department_owner_ix ON org_department(owner_kind, owner_id);
