-- The section (org_department) a user belongs to, usually a ship section such as Electrical or Engineering.
-- Used to pre-fill forms (work order ship and party); it grants no rights - role assignments do that. Plain id, no FK (D07).
ALTER TABLE idn_user ADD COLUMN section_id TEXT;
CREATE INDEX idn_user_section_ix ON idn_user(section_id);
