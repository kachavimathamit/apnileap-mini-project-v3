import { Router } from 'express';
import { z } from 'zod';
import { db, newId } from '../db/connection.js';
import { validate } from '../middleware/validate.js';
import { badRequest, notFoundOrDenied } from '../middleware/errors.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/audit.js';

export const themesRouter = Router();

/**
 * Project theme catalog (Foundation Integration extension, docs/DATABASE-
 * DESIGN.txt Section 9.1). institute_id = NULL rows are the deck's ten
 * platform-wide CSE themes, seeded once by seedFoundation.js; non-null rows
 * are an institute's own custom themes, authored the same way.
 */

function parseTheme(row) {
  return {
    ...row,
    foundational_courses: row.foundational_courses ? JSON.parse(row.foundational_courses) : [],
    core_concepts: row.core_concepts ? JSON.parse(row.core_concepts) : [],
    minimum_evidence: row.minimum_evidence ? JSON.parse(row.minimum_evidence) : [],
  };
}

/** Every theme a caller may pick from: the platform catalog plus their own institute's custom ones. */
themesRouter.get('/', requireAnyPermission('project:view'), (req, res) => {
  let rows;
  if (req.scope.isPlatformAdmin) {
    rows = db.prepare('SELECT * FROM project_themes WHERE is_active = 1 ORDER BY institute_id IS NOT NULL, title').all();
  } else {
    const institutes = [...req.scope.visibleInstituteIds];
    if (institutes.length === 0) {
      rows = db.prepare('SELECT * FROM project_themes WHERE institute_id IS NULL AND is_active = 1 ORDER BY title').all();
    } else {
      const placeholders = institutes.map(() => '?').join(', ');
      rows = db
        .prepare(
          `SELECT * FROM project_themes
           WHERE is_active = 1 AND (institute_id IS NULL OR institute_id IN (${placeholders}))
           ORDER BY institute_id IS NOT NULL, title`,
        )
        .all(...institutes);
    }
  }
  res.json({ themes: rows.map(parseTheme) });
});

const customThemeSchema = z.object({
  instituteId: z.string().min(1).max(64),
  code: z.string().trim().min(2).max(60).regex(/^[A-Z0-9-]+$/, 'Use upper-case letters, digits and hyphens only'),
  title: z.string().trim().min(3).max(200),
  academicSubtitle: z.string().trim().max(300).optional(),
  coreConcepts: z.array(z.object({ course: z.string().trim().min(1).max(120), concepts: z.string().trim().min(1).max(500) })).max(12).optional(),
  minimumEvidence: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  finalArtefactDescription: z.string().trim().max(1000).optional(),
});

/** An institute (via its coordinator/mentor/admins) authoring its own theme, same shape as the seeded catalog. */
themesRouter.post('/', requireAnyPermission('theme:manage'), validate(customThemeSchema), (req, res, next) => {
  try {
    const v = req.valid;
    if (!req.scope.isPlatformAdmin && !req.scope.visibleInstituteIds.has(v.instituteId)) {
      return next(badRequest('That institute is outside your authorized scope.'));
    }
    if (db.prepare('SELECT 1 FROM project_themes WHERE code = ?').get(v.code)) {
      return next(badRequest('A theme with that code already exists.'));
    }
    const id = newId('thm');
    db.prepare(
      `INSERT INTO project_themes
         (id, institute_id, code, title, academic_subtitle, foundational_courses, core_concepts,
          minimum_evidence, final_artefact_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, v.instituteId, v.code, v.title, v.academicSubtitle ?? null,
      JSON.stringify([
        'Data Structures & Algorithms', 'Database Management Systems', 'Operating Systems',
        'Software Engineering & SDLC', 'Web Technologies & Networks', 'Discrete Mathematics',
      ]),
      JSON.stringify(v.coreConcepts ?? []),
      v.minimumEvidence ? JSON.stringify(v.minimumEvidence) : null,
      v.finalArtefactDescription ?? null,
    );
    recordAudit(req, { action: 'THEME_CREATED', entityType: 'project_theme', entityId: id, instituteId: v.instituteId, detail: { code: v.code } });
    res.status(201).json({ theme: parseTheme(db.prepare('SELECT * FROM project_themes WHERE id = ?').get(id)) });
  } catch (error) {
    next(error);
  }
});

/** "One Faculty -> One Theme": a faculty mentor claims ownership of an as-yet-unclaimed theme. */
themesRouter.post('/:themeId/claim', requireAnyPermission('theme:manage'), (req, res, next) => {
  try {
    const theme = db.prepare('SELECT * FROM project_themes WHERE id = ?').get(req.params.themeId);
    if (!theme) return next(notFoundOrDenied());
    if (theme.institute_id && !req.scope.isPlatformAdmin && !req.scope.visibleInstituteIds.has(theme.institute_id)) {
      return next(notFoundOrDenied());
    }
    if (theme.owner_faculty_user_id && theme.owner_faculty_user_id !== req.user.id) {
      return next(badRequest(`This theme is already owned by ${theme.owner_faculty_name}.`));
    }
    db.prepare('UPDATE project_themes SET owner_faculty_user_id = ?, owner_faculty_name = ? WHERE id = ?')
      .run(req.user.id, req.user.full_name, theme.id);
    recordAudit(req, { action: 'THEME_CLAIMED', entityType: 'project_theme', entityId: theme.id, instituteId: theme.institute_id });
    res.json({ theme: parseTheme(db.prepare('SELECT * FROM project_themes WHERE id = ?').get(theme.id)) });
  } catch (error) {
    next(error);
  }
});
