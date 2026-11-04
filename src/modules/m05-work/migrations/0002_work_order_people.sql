-- Who asked for the work, when, and who supervises it. User ids are plain ids (idn_user), no FK (D07).
-- requested_at defaults to the creation time for orders entered before this change.
ALTER TABLE wrk_work_order ADD COLUMN requested_at TEXT;
ALTER TABLE wrk_work_order ADD COLUMN requested_by_user_id TEXT;
ALTER TABLE wrk_work_order ADD COLUMN supervisor_user_id TEXT;
UPDATE wrk_work_order SET requested_at = created_at WHERE requested_at IS NULL;
CREATE INDEX wrk_work_order_supervisor_ix ON wrk_work_order(supervisor_user_id);

-- The crew / workers who carry out a work order (several per order). Written by the installation that owns the work order;
-- removing a member tombstones the row, so the history of who was on the job is kept.
CREATE TABLE wrk_work_order_crew (
  {{SYNC_COLUMNS}}
  work_order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  note TEXT
);
CREATE UNIQUE INDEX wrk_work_order_crew_uq ON wrk_work_order_crew(work_order_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX wrk_work_order_crew_user_ix ON wrk_work_order_crew(user_id);
{{TRIGGERS_MUTABLE wrk_work_order_crew}}
