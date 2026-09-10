-- Mini-Project Portfolio Monitoring Portal - relational schema
-- Requirement 8: the operational store is a relational database. Git/GitHub holds
-- source code only; object storage holds large files. Both are referenced from here.
--
-- Every institute-owned row carries institute_id so tenant isolation can be enforced
-- in the data access layer (requirement 7), not just in the UI.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  designation         TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  mfa_enabled         INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  token_version       INTEGER NOT NULL DEFAULT 1,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);

-- ---------------------------------------------------------------------------
-- Hierarchy: institute -> department -> project
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutes (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  city        TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id                   TEXT PRIMARY KEY,
  institute_id         TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  code                 TEXT NOT NULL,
  name                 TEXT NOT NULL,
  head_user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  coordinator_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (institute_id, code)
);
CREATE INDEX IF NOT EXISTS idx_departments_institute ON departments(institute_id);

CREATE TABLE IF NOT EXISTS projects (
  id                      TEXT PRIMARY KEY,
  code                    TEXT NOT NULL UNIQUE,
  institute_id            TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  department_id           TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  academic_year           TEXT NOT NULL,
  semester                TEXT NOT NULL,
  start_date              TEXT,
  expected_completion_date TEXT,
  actual_completion_date  TEXT,

  -- Project definition (requirement 5.5)
  need_statement          TEXT,
  problem_statement       TEXT,
  objective               TEXT,
  learning_outcomes       TEXT,
  foundation_courses      TEXT,
  functional_blocks       TEXT,
  interfaces              TEXT,
  dependencies            TEXT,
  expected_deliverables   TEXT,

  -- Execution
  rag_status              TEXT NOT NULL DEFAULT 'GREEN'
                            CHECK (rag_status IN ('GREEN', 'YELLOW', 'RED')),
  rag_status_since        TEXT NOT NULL DEFAULT (datetime('now')),
  completion_percentage   INTEGER NOT NULL DEFAULT 0
                            CHECK (completion_percentage BETWEEN 0 AND 100),
  last_update_at          TEXT NOT NULL DEFAULT (datetime('now')),
  last_review_at          TEXT,
  next_review_date        TEXT,

  is_archived             INTEGER NOT NULL DEFAULT 0,

  -- Once the guide freezes the definition, students can no longer edit theme,
  -- title or the other definition fields - the guide and staff still can.
  definition_frozen       INTEGER NOT NULL DEFAULT 0,
  frozen_by               TEXT REFERENCES users(id) ON DELETE SET NULL,
  frozen_by_name          TEXT,
  frozen_at                TEXT,

  -- Foundation Integration extension: the catalog theme this project has
  -- been assigned. Only settable once a guide is allocated (project_members
  -- carries an APPROVED FACULTY_MENTOR row) - see docs/DATABASE-DESIGN.txt
  -- Section 9.0. Confirmed by the guide, not the student, per the deck's
  -- "One Faculty -> One Theme" ownership model.
  theme_id                 TEXT REFERENCES project_themes(id) ON DELETE SET NULL,
  theme_confirmed_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  theme_confirmed_by_name   TEXT,
  theme_confirmed_at        TEXT,

  created_by              TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_institute ON projects(institute_id);
CREATE INDEX IF NOT EXISTS idx_projects_department ON projects(department_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(rag_status);
-- idx_projects_theme is created in connection.js, after theme_id is added via
-- addColumnIfMissing() - an existing database's projects table predates this
-- column, and CREATE TABLE IF NOT EXISTS above is a no-op on it, so an index
-- on theme_id here would fail against that column before it exists.

-- ---------------------------------------------------------------------------
-- Authorization: role grants scoped to platform / institute / department / project
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS access_grants (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN (
                  'PLATFORM_ADMIN',
                  'GLOBAL_PROGRAMME_LEADER',
                  'INSTITUTE_ADMIN',
                  'DEAN',
                  'DEPARTMENT_HEAD',
                  'COORDINATOR',
                  'FACULTY_MENTOR',
                  'REVIEWER',
                  'READ_ONLY',
                  'STUDENT')),
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('PLATFORM', 'INSTITUTE', 'DEPARTMENT', 'PROJECT')),
  institute_id  TEXT REFERENCES institutes(id) ON DELETE CASCADE,
  department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
  is_active     INTEGER NOT NULL DEFAULT 1,
  granted_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT,
  -- The scope target must match the scope type. A malformed grant cannot widen access.
  CHECK (
    (scope_type = 'PLATFORM'   AND institute_id IS NULL AND department_id IS NULL AND project_id IS NULL) OR
    (scope_type = 'INSTITUTE'  AND institute_id IS NOT NULL AND department_id IS NULL AND project_id IS NULL) OR
    (scope_type = 'DEPARTMENT' AND institute_id IS NOT NULL AND department_id IS NOT NULL AND project_id IS NULL) OR
    (scope_type = 'PROJECT'    AND institute_id IS NOT NULL AND project_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_grants_user ON access_grants(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_grants_institute ON access_grants(institute_id);

-- ---------------------------------------------------------------------------
-- Project team
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_members (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id     TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  user_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  member_role      TEXT NOT NULL CHECK (member_role IN ('FACULTY_MENTOR', 'CO_MENTOR', 'STUDENT', 'REVIEWER')),
  -- Stakeholder decision 15: student names may be withheld; a team identifier is
  -- always stored and the display name is optional.
  team_identifier  TEXT,
  display_name     TEXT,
  -- A student team entered by a guide starts PENDING until the coordinator
  -- confirms it; a member added directly by staff (coordinator, admin, dept
  -- head) is self-approved, since the person entering it already has standing.
  status           TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  approved_at      TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);

-- ---------------------------------------------------------------------------
-- Execution detail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS milestones (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id  TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  sequence      INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  description   TEXT,
  planned_date  TEXT,
  actual_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'UPCOMING'
                  CHECK (status IN ('UPCOMING', 'CURRENT', 'COMPLETED', 'MISSED')),
  is_critical   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

CREATE TABLE IF NOT EXISTS kpis (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id         TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  definition           TEXT,
  target_value         TEXT NOT NULL,
  unit                 TEXT,
  accountable_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  accountable_name     TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kpis_project ON kpis(project_id);

CREATE TABLE IF NOT EXISTS kpi_measurements (
  id                TEXT PRIMARY KEY,
  kpi_id            TEXT NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id      TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  measured_value    TEXT NOT NULL,
  measurement_date  TEXT NOT NULL,
  evidence          TEXT,
  meets_target      INTEGER NOT NULL DEFAULT 0,
  recorded_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kpi_meas_kpi ON kpi_measurements(kpi_id);

-- ---------------------------------------------------------------------------
-- Intervention workflow (requirement 5.6)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS issues (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id        TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  root_cause          TEXT,
  impact              TEXT,
  assistance_required TEXT,
  support_source      TEXT CHECK (support_source IN
                        ('DEPARTMENT', 'INSTITUTE', 'INDUSTRY_PARTNER', 'APNILEAP', 'NONE')),
  severity            TEXT NOT NULL DEFAULT 'MEDIUM'
                        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status              TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED')),
  escalation_level    TEXT NOT NULL DEFAULT 'NONE'
                        CHECK (escalation_level IN ('NONE', 'DEPARTMENT', 'INSTITUTE', 'PROGRAMME', 'INDUSTRY')),
  evidence            TEXT,
  raised_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  raised_by_role      TEXT,
  verified_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  opened_at           TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at         TEXT,
  closed_at           TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id, status);

CREATE TABLE IF NOT EXISTS corrective_actions (
  id                       TEXT PRIMARY KEY,
  project_id               TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id             TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  issue_id                 TEXT REFERENCES issues(id) ON DELETE SET NULL,
  description              TEXT NOT NULL,
  owner_user_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  owner_name               TEXT,
  escalation_owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'OPEN'
                             CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED')),
  completed_at             TEXT,
  verified_by              TEXT REFERENCES users(id) ON DELETE SET NULL,
  evidence                 TEXT,
  created_by               TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_actions_project ON corrective_actions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_actions_due ON corrective_actions(due_date, status);

-- ---------------------------------------------------------------------------
-- Review and status history (requirement 5.7 - immutable trail)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reviews (
  id                        TEXT PRIMARY KEY,
  project_id                TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id              TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  reviewer_user_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewer_name             TEXT NOT NULL,
  review_date               TEXT NOT NULL DEFAULT (datetime('now')),
  previous_status           TEXT,
  recommended_status        TEXT CHECK (recommended_status IN ('GREEN', 'YELLOW', 'RED')),
  decision                  TEXT NOT NULL CHECK (decision IN
                              ('APPROVED', 'CHANGES_REQUESTED', 'EVIDENCE_REQUESTED', 'ESCALATED', 'NOTED')),
  comments                  TEXT NOT NULL,
  corrective_action_summary TEXT,
  next_review_date          TEXT,
  -- The rubric this review was scored against, and the round it belongs to
  -- (Review 1 / 2 / 3 ...), so every team a mentor guides is judged on the
  -- same declared criteria rather than whatever the mentor feels like typing
  -- that day. scores is a JSON object of {criterionName: awardedMarks}.
  rubric_id                 TEXT REFERENCES review_rubrics(id) ON DELETE SET NULL,
  review_number             INTEGER,
  scores                    TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);

-- ---------------------------------------------------------------------------
-- Review rubrics: a mentor defines one set of scoring criteria once, then
-- applies it identically across every team (project) they guide, so all
-- their teams are judged the same way.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_rubrics (
  id           TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  -- JSON array of { name, maxMarks, description }.
  criteria     TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rubrics_creator ON review_rubrics(created_by);

-- ---------------------------------------------------------------------------
-- Scheduled reviews: the "Review 1 / Review 2 / Review 3" slots a mentor
-- generates in bulk for every team they guide, from one rubric. Each slot is
-- filled in later (via /conduct) into a real reviews row using the exact
-- same rubric_id and review_number, so the rubric can never quietly drift
-- between generation and the actual review.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduled_reviews (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id  TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  rubric_id     TEXT NOT NULL REFERENCES review_rubrics(id) ON DELETE CASCADE,
  review_number INTEGER NOT NULL,
  title         TEXT NOT NULL,
  planned_date  TEXT,
  status        TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'COMPLETED')),
  review_id     TEXT REFERENCES reviews(id) ON DELETE SET NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, rubric_id, review_number)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_reviews_project ON scheduled_reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reviews_rubric ON scheduled_reviews(rubric_id);

CREATE TABLE IF NOT EXISTS status_history (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id    TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status      TEXT NOT NULL CHECK (new_status IN ('GREEN', 'YELLOW', 'RED')),
  changed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name TEXT NOT NULL,
  changed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  rationale       TEXT NOT NULL,
  evidence        TEXT,
  approved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  review_id       TEXT REFERENCES reviews(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_history_project ON status_history(project_id, changed_at);

-- History is append-only: material changes must stay immutable (NFR auditability).
--
-- The one narrow exception: deleting a user account nulls status_history.changed_by
-- and approved_by via ON DELETE SET NULL, which SQLite implements as an UPDATE and
-- would otherwise be caught by this trigger. The WHEN guard lets that specific,
-- one-directional nulling through - never a re-population, never any other column -
-- while still rejecting every other kind of edit. changed_by_name/approved_by_name
-- keep the human-readable record intact either way. Dropped and recreated on every
-- migrate() so an existing database picks up a corrected guard.
DROP TRIGGER IF EXISTS status_history_no_update;
CREATE TRIGGER status_history_no_update
BEFORE UPDATE ON status_history
WHEN NOT (
  NEW.id = OLD.id
  AND NEW.project_id = OLD.project_id
  AND NEW.institute_id = OLD.institute_id
  AND NEW.previous_status IS OLD.previous_status
  AND NEW.new_status = OLD.new_status
  AND NEW.changed_by_name = OLD.changed_by_name
  AND NEW.changed_at = OLD.changed_at
  AND NEW.rationale = OLD.rationale
  AND NEW.evidence IS OLD.evidence
  AND NEW.approved_by_name IS OLD.approved_by_name
  AND NEW.review_id IS OLD.review_id
  AND (NEW.changed_by IS OLD.changed_by OR (NEW.changed_by IS NULL AND OLD.changed_by IS NOT NULL))
  AND (NEW.approved_by IS OLD.approved_by OR (NEW.approved_by IS NULL AND OLD.approved_by IS NOT NULL))
)
BEGIN
  SELECT RAISE(ABORT, 'status_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS status_history_no_delete
BEFORE DELETE ON status_history
WHEN (SELECT COUNT(*) FROM projects WHERE id = OLD.project_id) > 0
BEGIN
  SELECT RAISE(ABORT, 'status_history is append-only');
END;

-- ---------------------------------------------------------------------------
-- Progress submissions: the draft -> review -> approval workflow.
--
-- A student's or mentor's reported completion percentage and narrative is
-- never written straight onto the project. It lands here first, and only a
-- reviewer's APPROVED decision copies the numbers onto
-- projects.approved_completion_percentage - the value every dashboard,
-- report and higher-level view actually reads. This is what keeps "what a
-- student just typed" and "what management is told" from being the same
-- unverified number.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS progress_submissions (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id           TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  version                INTEGER NOT NULL,

  completion_percentage  INTEGER NOT NULL CHECK (completion_percentage BETWEEN 0 AND 100),
  work_completed         TEXT,
  work_in_progress       TEXT,
  work_planned_next      TEXT,
  problems_encountered   TEXT,
  support_required       TEXT,
  expected_completion_date TEXT,
  student_remarks        TEXT,
  proposed_rag_status    TEXT CHECK (proposed_rag_status IN ('GREEN', 'YELLOW', 'RED')),
  evidence                TEXT,

  status                 TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                           ('DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED',
                            'REJECTED', 'CHANGES_REQUESTED')),

  submitted_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_name       TEXT,
  submitted_at             TEXT,

  reviewed_by              TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_name         TEXT,
  review_comment           TEXT,
  reviewed_at               TEXT,

  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_progress_project ON progress_submissions(project_id, version);
CREATE INDEX IF NOT EXISTS idx_progress_status ON progress_submissions(status);

-- Once a decision is recorded (anything but DRAFT/PENDING_REVIEW/UNDER_REVIEW),
-- the submission becomes part of the reviewable record and cannot be edited or
-- removed - a student who disagrees files a new submission, they do not rewrite
-- what the guide already decided on.
CREATE TRIGGER IF NOT EXISTS progress_submission_decided_immutable
BEFORE UPDATE ON progress_submissions
WHEN OLD.status IN ('APPROVED', 'REJECTED') AND NEW.status = OLD.status
BEGIN
  SELECT RAISE(ABORT, 'a decided progress submission cannot be edited');
END;

CREATE TRIGGER IF NOT EXISTS progress_submission_decided_no_delete
BEFORE DELETE ON progress_submissions
WHEN OLD.status IN ('APPROVED', 'REJECTED', 'PENDING_REVIEW', 'UNDER_REVIEW')
BEGIN
  SELECT RAISE(ABORT, 'only a draft or changes-requested submission may be deleted');
END;

-- ---------------------------------------------------------------------------
-- Role requests: account self-registration awaiting approval.
--
-- A Faculty Mentor / Guide registers themselves. The account exists and can
-- sign in immediately, but holds no access_grants row yet - so every project
-- read returns nothing (deny-by-default, same as any ungranted account) until
-- a Department Head, Institute Administrator or Platform Administrator
-- approves the request, at which point approval creates the actual grant.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS role_requests (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_role    TEXT NOT NULL CHECK (requested_role IN ('FACULTY_MENTOR')),
  institute_id      TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  department_id     TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  designation       TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_name  TEXT,
  review_comment    TEXT,
  reviewed_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_role_requests_status ON role_requests(status);
CREATE INDEX IF NOT EXISTS idx_role_requests_department ON role_requests(department_id);

-- ---------------------------------------------------------------------------
-- Artefact links (requirement 8: code in Git, files in object storage)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS repository_links (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'GITHUB',
  label        TEXT NOT NULL,
  repo_url     TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'INTERNAL')),
  added_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_repos_project ON repository_links(project_id);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'OTHER'
                 CHECK (kind IN ('REPORT', 'PRESENTATION', 'IMAGE', 'RECORDING', 'OTHER')),
  label        TEXT NOT NULL,
  storage_key  TEXT,
  external_url TEXT,
  content_type TEXT,
  size_bytes   INTEGER,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments(project_id);

-- ---------------------------------------------------------------------------
-- Notifications and audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institute_id TEXT REFERENCES institutes(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP', 'EMAIL')),
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  institute_id TEXT,
  outcome      TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
  ip_address   TEXT,
  user_agent   TEXT,
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, outcome);

-- Same narrow exception as status_history above: deleting a user nulls
-- audit_log.actor_user_id via ON DELETE SET NULL. actor_email already holds a
-- redundant copy, so the entry stays readable. Dropped and recreated on every
-- migrate() so an existing database picks up a corrected guard.
DROP TRIGGER IF EXISTS audit_log_no_update;
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
WHEN NOT (
  NEW.id = OLD.id
  AND NEW.occurred_at = OLD.occurred_at
  AND NEW.actor_email IS OLD.actor_email
  AND NEW.action = OLD.action
  AND NEW.entity_type IS OLD.entity_type
  AND NEW.entity_id IS OLD.entity_id
  AND NEW.institute_id IS OLD.institute_id
  AND NEW.outcome = OLD.outcome
  AND NEW.ip_address IS OLD.ip_address
  AND NEW.user_agent IS OLD.user_agent
  AND NEW.detail IS OLD.detail
  AND (NEW.actor_user_id IS OLD.actor_user_id OR (NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL))
)
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- ---------------------------------------------------------------------------
-- Foundation Integration extension (docs/DATABASE-DESIGN.txt Section 9), v2.
--
-- Source of truth: "Mini Project Handbook - Computer Science and
-- Engineering" (Handbook v4) plus the companion "Generic Mini Project
-- Framework" deck (v1, 5 Sept 2026). This supersedes the v1 extension,
-- which was built from an earlier, less precise slide deck and got the
-- gate mark weights, stage names and engine template wrong. v1's tables
-- are replaced in place (same table names, corrected columns/seed data)
-- rather than left stranded, since nothing outside this extension itself
-- ever depended on the wrong numbers.
--
-- All of this stays locked at the application layer until a project has an
-- APPROVED FACULTY_MENTOR project_members row - i.e. it activates after
-- guide allocation, the same dependency review_rubrics already has on the
-- guide relationship.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_themes (
  id                          TEXT PRIMARY KEY,
  -- NULL = platform-wide catalog theme (the handbook's ten CSE themes);
  -- non-null = one institute's own custom theme, authored the same way.
  institute_id                TEXT REFERENCES institutes(id) ON DELETE CASCADE,
  code                        TEXT NOT NULL UNIQUE,
  title                       TEXT NOT NULL,
  academic_subtitle           TEXT,
  -- JSON array of the 6 foundation-course names this theme integrates.
  foundational_courses        TEXT,
  -- JSON array of { course, concepts } - the per-course integration mapping.
  core_concepts                TEXT,
  -- JSON array of evidence-artefact labels this theme requires beyond the
  -- generic gate checklist (e.g. "ER Diagram", "State Machine").
  minimum_evidence             TEXT,
  final_artefact_description   TEXT,
  -- The faculty member who has taken ownership of this theme's full
  -- reference solution ("One Faculty -> One Theme"). NULL = unclaimed.
  owner_faculty_user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  owner_faculty_name           TEXT,
  is_active                    INTEGER NOT NULL DEFAULT 1,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_themes_institute ON project_themes(institute_id);
CREATE INDEX IF NOT EXISTS idx_themes_owner ON project_themes(owner_faculty_user_id);

-- Engines follow the handbook's "Engine Definition & Readiness Template"
-- (13 fields) plus its 8-point validity test (Sec 1.9.1): clear inputs and
-- outputs, owned data/state, a meaningful algorithm, a defined interface
-- contract, identifiable failure behaviour, independent testability, a
-- measurable KPI traceable to an NFR, and exactly one named student owner.
-- The columns below exist so that test can actually be checked, not just
-- asserted - failure_case and kpi_target are NOT NULL at the API layer
-- once an engine leaves PROPOSED, because Gate 1 explicitly checks them.
CREATE TABLE IF NOT EXISTS project_engines (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id          TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  -- "Primary Course" on the template: the main foundation course/concept
  -- this engine is anchored in (OS / DSA / DBMS / Networks / Web / ...).
  -- Deliberately free text, not a CHECK enum - see project_engines.category
  -- note in docs/DATABASE-DESIGN.txt Section 9.
  primary_course        TEXT,
  responsibility        TEXT NOT NULL,
  inputs                TEXT,
  outputs                TEXT,
  -- The data/state this engine owns exclusively - "no two engines claim
  -- write authority over the same state" (validity test #2).
  internal_state         TEXT,
  algorithm_mechanism     TEXT,
  interface_spec          TEXT,
  -- Free-text dependency note (the template's field 9); the authoritative,
  -- cycle-checked dependency graph lives in project_engine_dependencies.
  dependencies_note        TEXT,
  -- One measurable target, traceable to an NFR (validity test #7).
  kpi_target                TEXT,
  -- At least one realistic failure case and its expected behaviour
  -- (validity test #5 asks for three; one is required to leave PROPOSED,
  -- the guide's approval is where the other two are actually checked).
  failure_case               TEXT,
  validation_method           TEXT,
  -- Must reference a project_members row with member_role = 'STUDENT',
  -- enforced at the API - "exactly one named owner" (validity test #8).
  owner_member_id              TEXT REFERENCES project_members(id) ON DELETE SET NULL,
  status                       TEXT NOT NULL DEFAULT 'PROPOSED'
                                 CHECK (status IN ('PROPOSED', 'APPROVED', 'IN_PROGRESS', 'VALIDATED')),
  approved_by                  TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by_name             TEXT,
  approved_at                  TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_engines_project ON project_engines(project_id);
CREATE INDEX IF NOT EXISTS idx_engines_owner ON project_engines(owner_member_id);

CREATE TABLE IF NOT EXISTS project_engine_dependencies (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  engine_id             TEXT NOT NULL REFERENCES project_engines(id) ON DELETE CASCADE,
  depends_on_engine_id  TEXT NOT NULL REFERENCES project_engines(id) ON DELETE CASCADE,
  note                  TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (engine_id, depends_on_engine_id),
  CHECK (engine_id != depends_on_engine_id)
);
CREATE INDEX IF NOT EXISTS idx_engine_deps_engine ON project_engine_dependencies(engine_id);
CREATE INDEX IF NOT EXISTS idx_engine_deps_depends_on ON project_engine_dependencies(depends_on_engine_id);

-- Seeded, platform-wide reference catalog (institute_id-free by design -
-- this pedagogy is not per-institute policy). A PLATFORM_ADMIN may edit it
-- directly; every other role only reads it. Unlike project data, these five
-- reference tables (gates, stage_definitions, stage_gate_map, sprints,
-- gate_rubric_criteria) are UPSERTED on every migrate() - see
-- seedFoundation.js - so a corrected mark weight or stage name in a future
-- handbook revision reaches an already-running deployment without a
-- destructive reset.

-- Handbook Section 1.12: five gates, 50 marks total (5+10+10+15+10).
-- A gate reviews a RANGE of stage maturity, not one closing stage - Gate 3
-- and Gate 4 both partially review S6/S7 (engine-level vs system-level),
-- so the stage/gate relationship is a many-to-many map, not a single FK.
CREATE TABLE IF NOT EXISTS gates (
  id                     TEXT PRIMARY KEY,
  sequence               INTEGER NOT NULL,
  name                   TEXT NOT NULL,
  marks_weight           INTEGER NOT NULL,
  -- Human-readable maturity range, e.g. "S2, S3, S4" (Handbook Table 1.12).
  stage_range            TEXT NOT NULL,
  primary_review_focus   TEXT NOT NULL,
  -- JSON array of Course Outcome codes this gate assesses, e.g. ["CO1"].
  course_outcomes        TEXT NOT NULL,
  -- Default COE-calendar week for this gate (Handbook Table 1.12); the
  -- actual date for a given academic_year lives in calendar_weeks.
  default_week_number     INTEGER
);

CREATE TABLE IF NOT EXISTS stage_definitions (
  id                          TEXT PRIMARY KEY,
  sequence                    INTEGER NOT NULL,
  name                        TEXT NOT NULL,
  primary_question             TEXT,
  expected_outcome             TEXT,
  description                  TEXT,
  -- S0 and S1 are the Sequential Foundation: common to the whole team, not
  -- sprinted or parallelised across engines (Handbook Sec 1.7). S2-S7 are
  -- Agile Technical Maturity stages: engines may sit at different stages
  -- within the same sprint (Sec 1.8).
  is_sequential_foundation      INTEGER NOT NULL DEFAULT 0,
  -- JSON array of the evidence checklist items for this stage. Fully
  -- populated for S0 (Handbook Sec 2.5/Gate 0 sheet); other stages carry
  -- only the "Expected outcome" summary until a future handbook revision
  -- details their own faculty execution chapter, per docs/DATABASE-
  -- DESIGN.txt Section 9 - this is a deliberate, documented gap, not an
  -- oversight.
  evidence_checklist            TEXT
);

-- Many-to-many: which stage(s) each gate's review draws maturity evidence
-- from (Handbook Table 1.12's "Maturity evaluated" column).
CREATE TABLE IF NOT EXISTS stage_gate_map (
  stage_id  TEXT NOT NULL REFERENCES stage_definitions(id) ON DELETE CASCADE,
  gate_id   TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  PRIMARY KEY (stage_id, gate_id)
);

-- Handbook Sections 1.10-1.11: three Agile execution windows, common across
-- engines, distinct from both stage (maturity) and gate (review). Read-only
-- reference data - no per-project "current sprint" is tracked, since an
-- engine's stage (project_engines.status plus its own progress, tracked by
-- the guide's weekly check-ins) is what actually varies per engine, not the
-- shared calendar window every engine executes inside.
CREATE TABLE IF NOT EXISTS sprints (
  id              TEXT PRIMARY KEY,
  sequence        INTEGER NOT NULL,
  name            TEXT NOT NULL,
  stage_range     TEXT NOT NULL,
  objective       TEXT NOT NULL,
  purpose         TEXT,
  closes_gate_id  TEXT REFERENCES gates(id) ON DELETE SET NULL
);

-- Handbook Sec 1.15: the COE-aligned 17-week calendar. Scoped by
-- academic_year (not institute_id) because the calendar is a programme-wide
-- schedule decision, not an institute-specific one - every institute
-- running this handbook in the same term shares the same weeks.
CREATE TABLE IF NOT EXISTS calendar_weeks (
  id                TEXT PRIMARY KEY,
  academic_year     TEXT NOT NULL,
  week_number       INTEGER NOT NULL,
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  activity          TEXT NOT NULL,
  -- JSON array of stage_definitions ids active this week (empty for a
  -- protected/administrative week).
  stage_ids         TEXT NOT NULL DEFAULT '[]',
  gate_id           TEXT REFERENCES gates(id) ON DELETE SET NULL,
  sprint_id         TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  -- Minor-I / Minor-II protected weeks: no compulsory Mini Project activity.
  is_protected_week  INTEGER NOT NULL DEFAULT 0,
  required_output     TEXT,
  UNIQUE (academic_year, week_number)
);
CREATE INDEX IF NOT EXISTS idx_calendar_year ON calendar_weeks(academic_year);

-- Handbook Sec "Assessment Rubric": each gate has 4 weighted criteria,
-- scored 0-5 against a performance descriptor and converted to marks as
-- (rating / 5) * weight. Only Gate 0's descriptors are given in full in
-- Handbook v4 (the S0 Phase Assessment Sheet); Gates 1-4 are seeded with
-- their criterion names and weights only (derived from Table 1.12's
-- "Primary review focus" column) - level_descriptors is NULL until a
-- future handbook chapter defines them, which is a documented gap, not a
-- guess dressed up as a fact.
CREATE TABLE IF NOT EXISTS gate_rubric_criteria (
  id                 TEXT PRIMARY KEY,
  gate_id            TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  sequence           INTEGER NOT NULL,
  criterion_name     TEXT NOT NULL,
  weight_marks       REAL NOT NULL,
  -- JSON object {"5": "...", "4": "...", ..., "0": "..."}, nullable.
  level_descriptors  TEXT
);
CREATE INDEX IF NOT EXISTS idx_rubric_criteria_gate ON gate_rubric_criteria(gate_id);

-- The formal, Reviewer-run gate decision for one project. A gate is a
-- TEAM-level review (Handbook: "Team Decision: Pass / Resubmit") but marks
-- are recorded PER STUDENT ("5 MARKS PER STUDENT") - see
-- project_gate_review_scores below for the per-student breakdown; the
-- columns here are the team-level record (decision, comments, whether the
-- next gate unlocks).
CREATE TABLE IF NOT EXISTS project_gate_reviews (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id          TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  gate_id               TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  -- A Resubmit decision allows a re-attempt as a new row rather than an
  -- in-place edit of a graded attempt - same idea as
  -- progress_submissions.version.
  attempt_number         INTEGER NOT NULL DEFAULT 1,
  reviewer_user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewer_name          TEXT NOT NULL,
  review_date            TEXT NOT NULL DEFAULT (datetime('now')),
  -- Team-level decision, per the Phase Assessment Sheet's "Team Decision"
  -- field. RESUBMIT is the handbook's own term (not FAIL - a team resubmits
  -- corrected evidence, it does not fail a semester's mini project).
  decision               TEXT NOT NULL CHECK (decision IN ('PASS', 'RESUBMIT')),
  max_marks              INTEGER NOT NULL,
  comments                TEXT NOT NULL,
  next_gate_unlocked      INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, gate_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_gate_reviews_project ON project_gate_reviews(project_id, gate_id);

-- Append-only, same shape as progress_submissions: a PASS attempt can never
-- be edited or deleted once decided.
CREATE TRIGGER IF NOT EXISTS gate_review_decided_immutable
BEFORE UPDATE ON project_gate_reviews
WHEN OLD.decision = 'PASS'
BEGIN
  SELECT RAISE(ABORT, 'a passed gate review cannot be edited');
END;

CREATE TRIGGER IF NOT EXISTS gate_review_decided_no_delete
BEFORE DELETE ON project_gate_reviews
BEGIN
  SELECT RAISE(ABORT, 'gate reviews are append-only');
END;

-- Per-student marks against the gate's weighted rubric criteria - the
-- "5 MARKS PER STUDENT" line on the Phase Assessment Sheet, and the basis
-- for the individual viva at Gate 4.
CREATE TABLE IF NOT EXISTS project_gate_review_scores (
  id                 TEXT PRIMARY KEY,
  gate_review_id     TEXT NOT NULL REFERENCES project_gate_reviews(id) ON DELETE CASCADE,
  member_id          TEXT NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
  -- JSON object {criterionName: rating 0-5}, one entry per
  -- gate_rubric_criteria row for this gate.
  criterion_ratings  TEXT NOT NULL,
  marks_awarded      REAL NOT NULL,
  viva_notes         TEXT,
  UNIQUE (gate_review_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_gate_scores_review ON project_gate_review_scores(gate_review_id);

CREATE TABLE IF NOT EXISTS project_gate_evidence (
  id                    TEXT PRIMARY KEY,
  gate_review_id        TEXT NOT NULL REFERENCES project_gate_reviews(id) ON DELETE CASCADE,
  stage_id              TEXT REFERENCES stage_definitions(id) ON DELETE SET NULL,
  checklist_item        TEXT NOT NULL,
  -- Evidence points at the artefact tables that already exist - it is never
  -- re-uploaded into a new blob store.
  evidence_ref_type     TEXT NOT NULL DEFAULT 'TEXT_NOTE'
                          CHECK (evidence_ref_type IN
                            ('ATTACHMENT', 'REPOSITORY_LINK', 'PROGRESS_SUBMISSION', 'TEXT_NOTE')),
  evidence_ref_id       TEXT,
  note                  TEXT,
  submitted_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_name     TEXT,
  submitted_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gate_evidence_review ON project_gate_evidence(gate_review_id);

-- The guide's continuous, informal check ("Weekly Review Vs Formal Gate
-- Review") - deliberately NOT append-only (a coaching log, not a graded
-- decision).
CREATE TABLE IF NOT EXISTS project_weekly_checkins (
  id                        TEXT PRIMARY KEY,
  project_id                TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  institute_id              TEXT NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  guide_user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  guide_name                TEXT NOT NULL,
  checkin_date              TEXT NOT NULL DEFAULT (datetime('now')),
  stage_id                  TEXT REFERENCES stage_definitions(id) ON DELETE SET NULL,
  git_commits_reviewed      TEXT,
  process_discipline_notes  TEXT,
  flags                     TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_weekly_checkins_project ON project_weekly_checkins(project_id, checkin_date);
