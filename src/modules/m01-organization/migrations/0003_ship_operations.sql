-- M01 ship operational status and sea deployments (DECISIONS D66).
-- org_ship_status_event: append-only events (any installation may record; nobody edits). A 'set' event starts a period that lasts
--   until the next live 'set' event of the same ship; a 'void' event withdraws a mistaken 'set' (corrections never rewrite history).
-- org_deployment: owner_mutable, home_scope_id = ship id, written by the installation that entered it (Command, NHQ or the ship).

CREATE TABLE org_ship_status_event (
  {{EVENT_COLUMNS}}
  ship_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'set' CHECK (kind IN ('set','void')),
  status TEXT CHECK (status IN ('operational','semi_operational','non_operational')),
  reason TEXT,
  authority TEXT,
  opdef_ref TEXT,
  opdef_category TEXT,
  voids_event_id TEXT,
  CHECK ((kind = 'set' AND status IS NOT NULL AND voids_event_id IS NULL) OR (kind = 'void' AND voids_event_id IS NOT NULL))
);
CREATE INDEX org_ship_status_event_ship_ix ON org_ship_status_event(ship_id, occurred_at, id);
CREATE INDEX org_ship_status_event_void_ix ON org_ship_status_event(voids_event_id);
{{TRIGGERS_EVENT org_ship_status_event}}

CREATE TABLE org_deployment (
  {{SYNC_COLUMNS}}
  ship_id TEXT NOT NULL,
  name TEXT NOT NULL,
  area TEXT,
  sailed_at TEXT NOT NULL,
  returned_at TEXT,
  remarks TEXT,
  CHECK (returned_at IS NULL OR returned_at > sailed_at)
);
CREATE INDEX org_deployment_ship_ix ON org_deployment(ship_id, sailed_at);
{{TRIGGERS_MUTABLE org_deployment}}

-- Published read model: status periods per ship. effective_to NULL = still in force (or the latest planned change).
CREATE VIEW org_v_ship_status_period AS
SELECT e.id AS event_id, e.ship_id, e.status, e.occurred_at AS effective_from,
       LEAD(e.occurred_at) OVER (PARTITION BY e.ship_id ORDER BY e.occurred_at, e.id) AS effective_to,
       e.reason, e.authority, e.opdef_ref, e.opdef_category, e.recorded_at, e.recorded_by, e.owner_installation_id
FROM org_ship_status_event e
WHERE e.kind = 'set'
  AND NOT EXISTS (SELECT 1 FROM org_ship_status_event v WHERE v.kind = 'void' AND v.voids_event_id = e.id);

-- Published read model: live deployments with ship and current command.
CREATE VIEW org_v_deployment AS
SELECT d.id AS deployment_id, d.ship_id, s.code AS ship_code, s.name AS ship_name, s.pennant_no, c.command_id, c.command_name,
       d.name, d.area, d.sailed_at, d.returned_at, d.remarks, d.owner_installation_id, d.version
FROM org_deployment d
JOIN org_ship s ON s.id = d.ship_id
LEFT JOIN org_v_ship_current_command c ON c.ship_id = d.ship_id
WHERE d.deleted_at IS NULL;

-- Published read model: every live ship with its status and deployment in force now (NULL status = never recorded).
CREATE VIEW org_v_ship_status_current AS
SELECT s.id AS ship_id, s.code AS ship_code, s.name AS ship_name, s.pennant_no, s.status AS ship_record_status,
       c.command_id, c.command_code, c.command_name,
       p.event_id AS status_event_id, p.status, p.effective_from AS status_since, p.reason, p.authority, p.opdef_ref, p.opdef_category,
       d.id AS deployment_id, d.name AS deployment_name, d.area AS deployment_area, d.sailed_at
FROM org_ship s
LEFT JOIN org_v_ship_current_command c ON c.ship_id = s.id
LEFT JOIN org_v_ship_status_period p ON p.ship_id = s.id
  AND p.effective_from <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  AND (p.effective_to IS NULL OR p.effective_to > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
LEFT JOIN org_deployment d ON d.id = (
  SELECT d2.id FROM org_deployment d2 WHERE d2.ship_id = s.id AND d2.deleted_at IS NULL
    AND d2.sailed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    AND (d2.returned_at IS NULL OR d2.returned_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ORDER BY d2.sailed_at DESC, d2.id LIMIT 1)
WHERE s.deleted_at IS NULL;

-- Published read model for the M14 integrity checks: deployments of one ship that overlap (possible after offline entry at two places).
CREATE VIEW org_v_deployment_overlap AS
SELECT a.ship_id, a.id AS deployment_id, b.id AS other_deployment_id, a.sailed_at, a.returned_at, b.sailed_at AS other_sailed_at, b.returned_at AS other_returned_at
FROM org_deployment a
JOIN org_deployment b ON b.ship_id = a.ship_id AND a.id < b.id AND b.deleted_at IS NULL
WHERE a.deleted_at IS NULL
  AND a.sailed_at < COALESCE(b.returned_at, '9999-12-31T00:00:00.000Z')
  AND b.sailed_at < COALESCE(a.returned_at, '9999-12-31T00:00:00.000Z');
