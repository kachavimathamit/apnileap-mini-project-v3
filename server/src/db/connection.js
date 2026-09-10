import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { seedFoundationCatalog } from './seedFoundation.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

export const db = new Database(config.databaseFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Adds a column to an existing table if it is not already there. `CREATE
 * TABLE IF NOT EXISTS` in schema.sql only helps a brand-new database - once a
 * table exists, a later column added to its definition needs an explicit
 * ALTER on any database created before that change. This keeps that
 * bookkeeping in one place instead of a one-off script per change.
 */
function tableExists(table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function addColumnIfMissing(table, column, definition) {
  if (!columnNames(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * project_gate_reviews changed shape between the v1 and v2 Foundation
 * Integration extension (v2 corrects the gate model against Handbook v4 -
 * see schema.sql's comment above the table): the decision enum narrowed
 * from 4 values to the handbook's actual PASS/RESUBMIT, and per-student
 * marks moved out to project_gate_review_scores. Unlike gates/
 * stage_definitions this table can hold real reviewer decisions, so a
 * stale-shape table is renamed aside, rebuilt fresh by schema.sql, and its
 * rows are copied back with the old decision values mapped onto the new
 * enum (CONDITIONAL_PASS -> PASS, FAIL/RESUBMIT_REQUIRED -> RESUBMIT) -
 * old marks_awarded/bloom_answers values are dropped in that copy, since
 * per-student marks are now a separate concern this table no longer
 * carries at all.
 */
function stageGateReviewsRebuildIfStale() {
  if (tableExists('project_gate_reviews') && columnNames('project_gate_reviews').includes('bloom_answers')) {
    db.exec('ALTER TABLE project_gate_reviews RENAME TO project_gate_reviews_v1');
    return true;
  }
  return false;
}

function finishGateReviewsRebuild() {
  if (!tableExists('project_gate_reviews_v1')) return;
  const oldRows = db.prepare('SELECT * FROM project_gate_reviews_v1').all();
  const insert = db.prepare(
    `INSERT INTO project_gate_reviews
       (id, project_id, institute_id, gate_id, attempt_number, reviewer_user_id, reviewer_name,
        review_date, decision, max_marks, comments, next_gate_unlocked, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const decisionMap = { PASS: 'PASS', CONDITIONAL_PASS: 'PASS', FAIL: 'RESUBMIT', RESUBMIT_REQUIRED: 'RESUBMIT' };
  for (const row of oldRows) {
    insert.run(
      row.id, row.project_id, row.institute_id, row.gate_id, row.attempt_number,
      row.reviewer_user_id, row.reviewer_name, row.review_date,
      decisionMap[row.decision] ?? 'RESUBMIT', row.max_marks, row.comments,
      row.next_gate_unlocked, row.created_at,
    );
  }
  db.exec('DROP TABLE project_gate_reviews_v1');
}

/**
 * Renaming a table with `ALTER TABLE ... RENAME TO` also rewrites the
 * FOREIGN KEY clauses of every OTHER table that references it (SQLite's
 * documented behaviour since 3.25.0) - so renaming project_gate_reviews
 * aside for the rebuild above silently repointed project_gate_evidence.
 * gate_review_id's REFERENCES clause at the old name. That old name is
 * then dropped once the rebuild finishes, leaving project_gate_evidence
 * with a foreign key to a table that no longer exists - "no such table"
 * on its very next INSERT, discovered by live-testing this migration
 * against the real database, not by inspection. This is a self-healing,
 * general fix (not special-cased to one column): any table whose foreign
 * keys reference a table that doesn't currently exist is rebuilt the same
 * rename/recreate/copy-back way, since a plain ALTER cannot repoint a
 * foreign key.
 */
function hasDanglingForeignKey(table) {
  if (!tableExists(table)) return false;
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().some((fk) => !tableExists(fk.table));
}

function repairDanglingForeignKeysIfNeeded(table) {
  if (!hasDanglingForeignKey(table)) return null;
  const tempName = `${table}__fk_repair`;
  db.exec(`ALTER TABLE ${table} RENAME TO ${tempName}`);
  return tempName;
}

function finishForeignKeyRepair(table, tempName) {
  if (!tempName || !tableExists(tempName)) return;
  const columns = columnNames(table).filter((c) => columnNames(tempName).includes(c));
  const columnList = columns.join(', ');
  db.exec(`INSERT INTO ${table} (${columnList}) SELECT ${columnList} FROM ${tempName}`);
  db.exec(`DROP TABLE ${tempName}`);
}

/** Applies schema.sql, then any incremental column additions. Safe to call repeatedly. */
export function migrate() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');

  const rebuildingGateReviews = stageGateReviewsRebuildIfStale();
  db.exec(schema);
  if (rebuildingGateReviews) finishGateReviewsRebuild();

  // Checked only now - after project_gate_reviews_v1 has been fully
  // dropped above, not while it still exists under that temporary name -
  // because a dangling foreign key genuinely isn't dangling yet at any
  // earlier point: right after the rename, project_gate_evidence's
  // REFERENCES clause points at project_gate_reviews_v1, and that table
  // still exists (it hasn't been dropped yet), so an earlier check would
  // wrongly see nothing wrong. schema.sql is re-run (harmless - every
  // statement is already IF NOT EXISTS) after the rename below so it can
  // actually recreate project_gate_evidence under its now-free name, since
  // the first db.exec(schema) call above only ran once and can't retroactively
  // create a table that didn't need creating at the time.
  const gateEvidenceRepairTemp = repairDanglingForeignKeysIfNeeded('project_gate_evidence');
  if (gateEvidenceRepairTemp) db.exec(schema);
  finishForeignKeyRepair('project_gate_evidence', gateEvidenceRepairTemp);

  // Added after `reviews` first shipped: rubric-scored, rubric-driven reviews.
  addColumnIfMissing('reviews', 'rubric_id', 'TEXT REFERENCES review_rubrics(id) ON DELETE SET NULL');
  addColumnIfMissing('reviews', 'review_number', 'INTEGER');
  addColumnIfMissing('reviews', 'scores', 'TEXT');

  // Foundation Integration extension: theme assignment on an existing projects table.
  addColumnIfMissing('projects', 'theme_id', 'TEXT REFERENCES project_themes(id) ON DELETE SET NULL');
  addColumnIfMissing('projects', 'theme_confirmed_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  addColumnIfMissing('projects', 'theme_confirmed_by_name', 'TEXT');
  addColumnIfMissing('projects', 'theme_confirmed_at', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_theme ON projects(theme_id)');

  // Foundation Integration extension v2: the corrected Engine Definition &
  // Readiness Template fields (Handbook Sec 1.9). `category` and
  // `inputs_outputs` from v1 are left in place, unused, rather than
  // dropped - SQLite can add a column cheaply but not drop one without a
  // full table rebuild, and nothing reads those two columns any more.
  addColumnIfMissing('project_engines', 'primary_course', 'TEXT');
  addColumnIfMissing('project_engines', 'inputs', 'TEXT');
  addColumnIfMissing('project_engines', 'outputs', 'TEXT');
  addColumnIfMissing('project_engines', 'internal_state', 'TEXT');
  addColumnIfMissing('project_engines', 'algorithm_mechanism', 'TEXT');
  addColumnIfMissing('project_engines', 'dependencies_note', 'TEXT');
  addColumnIfMissing('project_engines', 'kpi_target', 'TEXT');
  addColumnIfMissing('project_engines', 'failure_case', 'TEXT');
  addColumnIfMissing('project_engines', 'validation_method', 'TEXT');

  // Foundation Integration extension v2: gates/stage_definitions gained
  // columns when the gate model was corrected against Handbook v4. These
  // two tables are otherwise pure, fully-reseeded reference catalogs, but
  // dropping and recreating them isn't safe here - project_gate_reviews.
  // gate_id has ON DELETE CASCADE onto gates, so a DROP TABLE gates would
  // cascade-delete real gate-review rows and hit their append-only
  // trigger. Additive columns avoid that entirely; the old `closing_stage_id`
  // (gates) and `gate_id`/`bloom_questions`/etc. (stage_definitions) columns
  // from v1 are left in place, unused.
  addColumnIfMissing('gates', 'stage_range', 'TEXT');
  addColumnIfMissing('gates', 'primary_review_focus', 'TEXT');
  addColumnIfMissing('gates', 'course_outcomes', 'TEXT');
  addColumnIfMissing('gates', 'default_week_number', 'INTEGER');
  addColumnIfMissing('stage_definitions', 'primary_question', 'TEXT');
  addColumnIfMissing('stage_definitions', 'expected_outcome', 'TEXT');
  addColumnIfMissing('stage_definitions', 'is_sequential_foundation', 'INTEGER NOT NULL DEFAULT 0');

  // Seeds/upserts the platform-wide gate, stage, sprint, calendar and gate-
  // rubric catalogs, and inserts any not-yet-seeded theme. Idempotent - see
  // seedFoundation.js.
  seedFoundationCatalog(db);
}

/** Wraps a function in a transaction. Rolls back on any thrown error. */
export function transaction(fn) {
  return db.transaction(fn);
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
