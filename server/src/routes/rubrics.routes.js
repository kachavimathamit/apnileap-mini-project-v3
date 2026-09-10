import { Router } from 'express';
import { z } from 'zod';
import { db, newId } from '../db/connection.js';
import { validate } from '../middleware/validate.js';
import { badRequest, notFoundOrDenied } from '../middleware/errors.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/audit.js';

export const rubricsRouter = Router();

/**
 * Review rubrics (requirement: every team a mentor guides is judged on the
 * same declared criteria). A rubric is defined once and reused across every
 * project the creator guides - reviews reference it by id, so the criteria
 * cannot silently drift between one team's review and the next.
 */
const criterionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  maxMarks: z.number().min(0).max(1000),
  description: z.string().trim().max(500).optional(),
});

const rubricSchema = z.object({
  instituteId: z.string().min(1).max(64),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(1000).optional(),
  criteria: z.array(criterionSchema).min(1).max(30),
});

function assertInstituteReachable(scope, instituteId) {
  if (scope.isPlatformAdmin) return;
  if (scope.visibleInstituteIds.has(instituteId)) return;
  throw badRequest('That institute is outside your authorized scope.');
}

rubricsRouter.post('/', requireAnyPermission('review:create'), validate(rubricSchema), (req, res, next) => {
  try {
    assertInstituteReachable(req.scope, req.valid.instituteId);
    const id = newId('rbc');
    db.prepare(
      `INSERT INTO review_rubrics (id, institute_id, created_by, created_by_name, title, description, criteria)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, req.valid.instituteId, req.user.id, req.user.full_name,
      req.valid.title, req.valid.description ?? null, JSON.stringify(req.valid.criteria),
    );

    recordAudit(req, {
      action: 'RUBRIC_CREATED', entityType: 'review_rubric', entityId: id,
      instituteId: req.valid.instituteId, detail: { title: req.valid.title, criteriaCount: req.valid.criteria.length },
    });

    const row = db.prepare('SELECT * FROM review_rubrics WHERE id = ?').get(id);
    res.status(201).json({ rubric: { ...row, criteria: JSON.parse(row.criteria) } });
  } catch (error) {
    next(error);
  }
});

/** A mentor's own rubrics - the templates they have defined for their teams. */
rubricsRouter.get('/', requireAnyPermission('review:create'), (req, res) => {
  const rows = db
    .prepare('SELECT * FROM review_rubrics WHERE created_by = ? AND is_active = 1 ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({ rubrics: rows.map((row) => ({ ...row, criteria: JSON.parse(row.criteria) })) });
});

const generateSchema = z.object({
  reviewCount: z.number().int().min(1).max(10).default(3),
  titlePrefix: z.string().trim().min(1).max(40).default('Review'),
});

/**
 * Dynamically creates `reviewCount` scheduled review slots, using this
 * rubric, for every project the caller currently guides as Faculty Mentor -
 * "all the teams", not one at a time. Already-scheduled numbers for a given
 * project+rubric are left alone rather than duplicated, so calling this
 * again after a new team is assigned only fills in the gap.
 */
rubricsRouter.post('/:rubricId/generate-reviews', requireAnyPermission('review:create'), validate(generateSchema), (req, res, next) => {
  try {
    const rubric = db.prepare('SELECT * FROM review_rubrics WHERE id = ?').get(req.params.rubricId);
    if (!rubric || (rubric.created_by !== req.user.id && !req.scope.isPlatformAdmin)) {
      return next(notFoundOrDenied());
    }

    const teams = db
      .prepare(
        `SELECT DISTINCT p.id, p.institute_id, p.title, p.code
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = ? AND pm.member_role = 'FACULTY_MENTOR' AND pm.is_active = 1
           AND p.is_archived = 0`,
      )
      .all(req.user.id);

    if (teams.length === 0) {
      return next(badRequest('You are not currently the assigned guide on any active project.'));
    }

    const insert = db.prepare(
      `INSERT INTO scheduled_reviews (id, project_id, institute_id, rubric_id, review_number, title, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const alreadyExists = db.prepare(
      'SELECT 1 FROM scheduled_reviews WHERE project_id = ? AND rubric_id = ? AND review_number = ?',
    );

    let created = 0;
    let skipped = 0;
    const perTeam = [];

    db.transaction(() => {
      for (const team of teams) {
        const numbers = [];
        for (let n = 1; n <= req.valid.reviewCount; n += 1) {
          if (alreadyExists.get(team.id, rubric.id, n)) { skipped += 1; continue; }
          insert.run(newId('scr'), team.id, team.institute_id, rubric.id, n, `${req.valid.titlePrefix} ${n}`, req.user.id);
          created += 1;
          numbers.push(n);
        }
        perTeam.push({ projectId: team.id, projectCode: team.code, projectTitle: team.title, scheduled: numbers });
      }
    })();

    recordAudit(req, {
      action: 'REVIEWS_GENERATED', entityType: 'review_rubric', entityId: rubric.id,
      detail: { teams: teams.length, created, skipped, reviewCount: req.valid.reviewCount },
    });

    res.status(201).json({
      rubric: { ...rubric, criteria: JSON.parse(rubric.criteria) },
      teamsAffected: teams.length,
      created,
      skipped,
      perTeam,
    });
  } catch (error) {
    next(error);
  }
});
