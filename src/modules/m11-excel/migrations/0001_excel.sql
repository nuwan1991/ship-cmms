-- M11 Excel/CSV import and export. Table prefix: xls_
-- Import jobs and rows are LOCAL working data (never synchronized): they hold an uploaded file's rows between preview and commit.
-- The export log is an append-only event so the hub can see who took data out.

CREATE TABLE xls_import_job (
  id TEXT PRIMARY KEY NOT NULL,
  template_code TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_kind TEXT NOT NULL CHECK (file_kind IN ('xlsx','csv')),
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('previewed','committed','failed')),
  total_rows INTEGER NOT NULL,
  ok_rows INTEGER NOT NULL,
  error_rows INTEGER NOT NULL,
  create_rows INTEGER NOT NULL DEFAULT 0,
  update_rows INTEGER NOT NULL DEFAULT 0,
  skip_rows INTEGER NOT NULL DEFAULT 0,
  ignored_columns TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  committed_at TEXT,
  committed_by TEXT
);
CREATE INDEX xls_import_job_ix ON xls_import_job(created_at);
CREATE INDEX xls_import_job_file_ix ON xls_import_job(template_code, file_sha256);

CREATE TABLE xls_import_row (
  job_id TEXT NOT NULL,
  row_no INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  action TEXT CHECK (action IS NULL OR action IN ('create','update','skip')),
  errors_json TEXT,
  duplicate_of TEXT,
  reference TEXT,
  PRIMARY KEY (job_id, row_no)
);

CREATE TABLE xls_export_log (
  {{EVENT_COLUMNS}}
  template_code TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('xlsx','csv')),
  row_count INTEGER NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT
);
CREATE INDEX xls_export_log_ix ON xls_export_log(occurred_at);
{{TRIGGERS_EVENT xls_export_log}}
