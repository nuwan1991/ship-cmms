-- M05 defect categories (DECISIONS D67). Two levels: a main category (Electrical, Marine Engineering, Weapon ...) and its subcategories.
-- wrk_defect_category is hub reference data (fleet-wide). department_codes lists the departments (comma-separated codes) whose equipment
-- suggests a main category when a defect is reported without one. color is the display colour of a main category (#RRGGBB).

CREATE TABLE wrk_defect_category (
  {{SYNC_COLUMNS}}
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  department_codes TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE UNIQUE INDEX wrk_defect_category_code_uq ON wrk_defect_category(code) WHERE deleted_at IS NULL;
CREATE INDEX wrk_defect_category_parent_ix ON wrk_defect_category(parent_id);
{{TRIGGERS_MUTABLE wrk_defect_category}}

-- Existing defects keep NULL ("Uncategorised") until their owner categorises them (npm run defect-categories -- backfill).
ALTER TABLE wrk_defect ADD COLUMN category_id TEXT;
ALTER TABLE wrk_defect ADD COLUMN subcategory_id TEXT;
CREATE INDEX wrk_defect_category_ix ON wrk_defect(category_id, home_scope_id);

-- Published read model: categories with their main category (for filters and reports). Tombstoned rows are left out.
CREATE VIEW wrk_v_defect_category AS
SELECT c.id AS category_id, c.code, c.name, c.parent_id, p.code AS parent_code, p.name AS parent_name,
       COALESCE(c.color, p.color) AS color, c.department_codes, c.sort_order, c.status,
       CASE WHEN c.parent_id IS NULL THEN 1 ELSE 0 END AS is_main
FROM wrk_defect_category c
LEFT JOIN wrk_defect_category p ON p.id = c.parent_id
WHERE c.deleted_at IS NULL;

-- Published read model: one row per live defect with its category, and whether it is still open
-- (awaiting triage, or turned into a repair case that is not closed yet).
CREATE VIEW wrk_v_defect_overview AS
SELECT d.id AS defect_id, d.defect_no, d.title, d.severity, d.status, d.home_scope_id AS ship_id, d.asset_id, d.position_id,
       d.reported_at, d.repair_case_id, d.owner_installation_id,
       d.category_id, c.code AS category_code, c.name AS category_name, c.color AS category_color,
       d.subcategory_id, sc.code AS subcategory_code, sc.name AS subcategory_name,
       CASE
         WHEN d.status = 'open' THEN 1
         WHEN d.status = 'converted' AND COALESCE((SELECT s.value FROM wrk_v_status_current s WHERE s.subject_type = 'repair_case' AND s.subject_id = d.repair_case_id AND s.axis = 'closure'), 'open') <> 'closed' THEN 1
         ELSE 0
       END AS is_open
FROM wrk_defect d
LEFT JOIN wrk_defect_category c ON c.id = d.category_id
LEFT JOIN wrk_defect_category sc ON sc.id = d.subcategory_id
WHERE d.deleted_at IS NULL;

-- Published read model: the category of a work order, taken from the earliest categorised defect of its repair case.
CREATE VIEW wrk_v_work_order_category AS
SELECT w.id AS work_order_id, d.category_id, d.subcategory_id
FROM wrk_work_order w
LEFT JOIN wrk_defect d ON d.id = (
  SELECT d2.id FROM wrk_defect d2 WHERE w.repair_case_id IS NOT NULL AND d2.repair_case_id = w.repair_case_id
    AND d2.deleted_at IS NULL AND d2.category_id IS NOT NULL ORDER BY d2.reported_at, d2.id LIMIT 1)
WHERE w.deleted_at IS NULL;
