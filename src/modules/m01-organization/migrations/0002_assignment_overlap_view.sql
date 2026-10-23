-- Published read model for the M14 integrity checks: ships whose command attachments overlap in time (possible after replication; flagged, never rejected).
CREATE VIEW org_v_assignment_overlap AS
SELECT a.ship_id, a.id AS assignment_id, b.id AS other_assignment_id, a.effective_from, a.effective_to, b.effective_from AS other_from, b.effective_to AS other_to
FROM org_ship_command_assignment a
JOIN org_ship_command_assignment b ON b.ship_id = a.ship_id AND a.id < b.id AND b.deleted_at IS NULL
WHERE a.deleted_at IS NULL
  AND a.effective_from < COALESCE(b.effective_to, '9999-12-31T00:00:00.000Z')
  AND b.effective_from < COALESCE(a.effective_to, '9999-12-31T00:00:00.000Z');
