import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireAnyPermission } from '../middleware/authorize.js';

export const gatesRouter = Router();

function parseStage(row) {
  return {
    ...row,
    evidence_checklist: row.evidence_checklist ? JSON.parse(row.evidence_checklist) : null,
    gates: db.prepare('SELECT gate_id FROM stage_gate_map WHERE stage_id = ?').all(row.id).map((r) => r.gate_id),
  };
}

/**
 * The seeded, platform-wide reference catalog: the Gate 0-4 / S0-S7 model,
 * the three sprints and each gate's weighted rubric criteria. Read-only -
 * see docs/DATABASE-DESIGN.txt Section 9 for how this data is sourced and
 * kept in sync with the handbook.
 */
gatesRouter.get('/', requireAnyPermission('project:view'), (_req, res) => {
  const gates = db.prepare('SELECT * FROM gates ORDER BY sequence').all().map((g) => ({
    ...g,
    course_outcomes: JSON.parse(g.course_outcomes),
    criteria: db
      .prepare('SELECT * FROM gate_rubric_criteria WHERE gate_id = ? ORDER BY sequence')
      .all(g.id)
      .map((c) => ({ ...c, level_descriptors: c.level_descriptors ? JSON.parse(c.level_descriptors) : null })),
  }));

  res.json({
    gates,
    stages: db.prepare('SELECT * FROM stage_definitions ORDER BY sequence').all().map(parseStage),
    sprints: db.prepare('SELECT * FROM sprints ORDER BY sequence').all(),
  });
});

/**
 * The COE-aligned calendar for one academic year - every week, its gate/
 * sprint/stage, and whether it is a protected (Minor exam) week. Defaults
 * to the latest seeded year when none is given, and flags the current
 * week (by wall-clock date) so the UI can highlight "where we are" without
 * doing date arithmetic itself.
 */
gatesRouter.get('/calendar', requireAnyPermission('project:view'), (req, res) => {
  const academicYear = req.query.academicYear
    ?? db.prepare('SELECT academic_year FROM calendar_weeks ORDER BY academic_year DESC LIMIT 1').get()?.academic_year;
  if (!academicYear) return res.json({ academicYear: null, weeks: [] });

  const today = new Date().toISOString().slice(0, 10);
  const weeks = db
    .prepare('SELECT * FROM calendar_weeks WHERE academic_year = ? ORDER BY week_number')
    .all(academicYear)
    .map((w) => ({ ...w, stage_ids: JSON.parse(w.stage_ids), is_current_week: today >= w.start_date && today <= w.end_date }));

  res.json({ academicYear, weeks });
});
