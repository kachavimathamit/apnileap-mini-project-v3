import { Router } from 'express';
import { z } from 'zod';
import { db, newId } from '../db/connection.js';
import {
  withProject,
  withDepartment,
  requireProjectPermission,
  requireInstitutePermission,
} from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { badRequest, conflict, notFoundOrDenied } from '../middleware/errors.js';
import { recordAudit } from '../services/audit.js';
import { projectDetail } from '../services/portfolio.js';
import { evaluateStatusTransition, recommendStatus, openBlockers } from '../services/rag.js';
import { notifyProjectEvent, notifyUser, EVENTS } from '../services/notifications.js';

export const projectsRouter = Router();

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const text = (max) => z.string().trim().max(max);

function touchProject(projectId) {
  db.prepare("UPDATE projects SET last_update_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(projectId);
}

/** Rows a child record must inherit so tenant isolation holds on every table. */
function tenantOf(project) {
  return { project_id: project.id, institute_id: project.institute_id };
}

// ---------------------------------------------------------------------------
// Project record
// ---------------------------------------------------------------------------

projectsRouter.get('/:projectId', withProject, (req, res) => {
  recordAudit(req, {
    action: 'VIEW_PROJECT',
    entityType: 'project',
    entityId: req.project.id,
    instituteId: req.project.institute_id,
  });
  res.json({
    ...projectDetail(req.project),
    permissions: [...req.projectPermissions],
    roles: [...req.projectRoles],
    blockers: openBlockers(req.project.id),
  });
});

projectsRouter.get('/:projectId/history', withProject, (req, res) => {
  res.json({
    history: db
      .prepare('SELECT * FROM status_history WHERE project_id = ? ORDER BY changed_at DESC')
      .all(req.project.id),
    reviews: db
      .prepare('SELECT * FROM reviews WHERE project_id = ? ORDER BY review_date DESC, created_at DESC')
      .all(req.project.id),
  });
});

/** Advisory status recommendation (requirement 6 governance note). */
projectsRouter.get('/:projectId/recommendation', withProject, (req, res) => {
  res.json(recommendStatus(req.project.id));
});

const definitionFields = {
  needStatement: text(2000).optional(),
  problemStatement: text(2000).optional(),
  objective: text(2000).optional(),
  learningOutcomes: text(2000).optional(),
  foundationCourses: text(1000).optional(),
  functionalBlocks: text(2000).optional(),
  interfaces: text(2000).optional(),
  dependencies: text(2000).optional(),
  expectedDeliverables: text(2000).optional(),
};

const createProjectSchema = z.object({
  departmentId: z.string().min(1).max(64),
  code: z.string().trim().min(2).max(40),
  title: z.string().trim().min(3).max(200),
  academicYear: z.string().trim().min(4).max(20),
  semester: z.string().trim().min(1).max(30),
  startDate: dateString.optional(),
  expectedCompletionDate: dateString.optional(),
  nextReviewDate: dateString.optional(),
  ...definitionFields,
});

projectsRouter.post(
  '/',
  validate(createProjectSchema),
  (req, _res, next) => {
    req.params.departmentId = req.valid.departmentId;
    next();
  },
  withDepartment,
  requireInstitutePermission('project:create'),
  (req, res, next) => {
    try {
      const v = req.valid;
      if (db.prepare('SELECT id FROM projects WHERE code = ?').get(v.code)) {
        return next(conflict('A project with that code already exists.'));
      }

      const id = newId('prj');
      db.prepare(
        `INSERT INTO projects
          (id, code, institute_id, department_id, title, academic_year, semester,
           start_date, expected_completion_date, next_review_date,
           need_statement, problem_statement, objective, learning_outcomes,
           foundation_courses, functional_blocks, interfaces, dependencies,
           expected_deliverables, created_by)
         VALUES (@id, @code, @institute_id, @department_id, @title, @academic_year, @semester,
                 @start_date, @expected_completion_date, @next_review_date,
                 @need_statement, @problem_statement, @objective, @learning_outcomes,
                 @foundation_courses, @functional_blocks, @interfaces, @dependencies,
                 @expected_deliverables, @created_by)`,
      ).run({
        id,
        code: v.code,
        institute_id: req.department.institute_id,
        department_id: req.department.id,
        title: v.title,
        academic_year: v.academicYear,
        semester: v.semester,
        start_date: v.startDate ?? null,
        expected_completion_date: v.expectedCompletionDate ?? null,
        next_review_date: v.nextReviewDate ?? null,
        need_statement: v.needStatement ?? null,
        problem_statement: v.problemStatement ?? null,
        objective: v.objective ?? null,
        learning_outcomes: v.learningOutcomes ?? null,
        foundation_courses: v.foundationCourses ?? null,
        functional_blocks: v.functionalBlocks ?? null,
        interfaces: v.interfaces ?? null,
        dependencies: v.dependencies ?? null,
        expected_deliverables: v.expectedDeliverables ?? null,
        created_by: req.user.id,
      });

      db.prepare(
        `INSERT INTO status_history
           (id, project_id, institute_id, previous_status, new_status, changed_by, changed_by_name, rationale)
         VALUES (?, ?, ?, NULL, 'GREEN', ?, ?, ?)`,
      ).run(newId('sth'), id, req.department.institute_id, req.user.id, req.user.full_name, 'Project created.');

      recordAudit(req, {
        action: 'PROJECT_CREATED',
        entityType: 'project',
        entityId: id,
        instituteId: req.department.institute_id,
        detail: { code: v.code, title: v.title },
      });

      res.status(201).json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const patchProjectSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  academicYear: z.string().trim().min(4).max(20).optional(),
  semester: z.string().trim().min(1).max(30).optional(),
  startDate: dateString.nullish(),
  expectedCompletionDate: dateString.nullish(),
  actualCompletionDate: dateString.nullish(),
  nextReviewDate: dateString.nullish(),
  completionPercentage: z.number().int().min(0).max(100).optional(),
  isArchived: z.boolean().optional(),
  ...definitionFields,
});

const PROJECT_COLUMNS = {
  title: 'title',
  academicYear: 'academic_year',
  semester: 'semester',
  startDate: 'start_date',
  expectedCompletionDate: 'expected_completion_date',
  actualCompletionDate: 'actual_completion_date',
  nextReviewDate: 'next_review_date',
  completionPercentage: 'completion_percentage',
  isArchived: 'is_archived',
  needStatement: 'need_statement',
  problemStatement: 'problem_statement',
  objective: 'objective',
  learningOutcomes: 'learning_outcomes',
  foundationCourses: 'foundation_courses',
  functionalBlocks: 'functional_blocks',
  interfaces: 'interfaces',
  dependencies: 'dependencies',
  expectedDeliverables: 'expected_deliverables',
};

projectsRouter.patch(
  '/:projectId',
  withProject,
  requireProjectPermission('project:update'),
  validate(patchProjectSchema),
  (req, res, next) => {
    try {
      const updates = [];
      const params = [];
      for (const [key, column] of Object.entries(PROJECT_COLUMNS)) {
        if (req.valid[key] === undefined) continue;
        let value = req.valid[key];
        if (typeof value === 'boolean') value = value ? 1 : 0;
        updates.push(`${column} = ?`);
        params.push(value === '' ? null : value);
      }
      if (!updates.length) return res.json({ project: req.project });

      updates.push("last_update_at = datetime('now')", "updated_at = datetime('now')");
      params.push(req.project.id);
      db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      recordAudit(req, {
        action: 'PROJECT_UPDATED',
        entityType: 'project',
        entityId: req.project.id,
        instituteId: req.project.institute_id,
        detail: { fields: Object.keys(req.valid) },
      });

      res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// RAG status transition (requirements 5.6, 5.7, 6)
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  newStatus: z.enum(['GREEN', 'YELLOW', 'RED']),
  rationale: z.string().trim().min(10).max(2000),
  evidence: z.string().trim().max(4000).optional(),
  nextReviewDate: dateString.nullish(),
});

projectsRouter.post(
  '/:projectId/status',
  withProject,
  validate(statusSchema),
  (req, res, next) => {
    try {
      const { newStatus, rationale, evidence, nextReviewDate } = req.valid;
      const verdict = evaluateStatusTransition({
        project: req.project,
        newStatus,
        evidence,
        permissions: req.projectPermissions,
      });

      if (!verdict.allowed) {
        recordAudit(req, {
          action: 'STATUS_CHANGE_REFUSED',
          entityType: 'project',
          entityId: req.project.id,
          instituteId: req.project.institute_id,
          outcome: 'DENIED',
          detail: { attempted: newStatus, from: req.project.rag_status, reason: verdict.code },
        });
        const error = badRequest(verdict.message);
        error.code = verdict.code;
        error.status = verdict.code === 'NOT_PERMITTED' || verdict.code === 'APPROVAL_REQUIRED' ? 403 : 409;
        return next(error);
      }

      const previous = req.project.rag_status;
      const historyId = newId('sth');

      db.transaction(() => {
        db.prepare(
          `INSERT INTO status_history
             (id, project_id, institute_id, previous_status, new_status, changed_by, changed_by_name,
              rationale, evidence, approved_by, approved_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          historyId,
          req.project.id,
          req.project.institute_id,
          previous,
          newStatus,
          req.user.id,
          req.user.full_name,
          rationale,
          evidence ?? null,
          verdict.requiresApproval ? req.user.id : null,
          verdict.requiresApproval ? req.user.full_name : null,
        );

        db.prepare(
          `UPDATE projects
             SET rag_status = ?, rag_status_since = datetime('now'),
                 last_update_at = datetime('now'), updated_at = datetime('now'),
                 next_review_date = COALESCE(?, next_review_date)
           WHERE id = ?`,
        ).run(newStatus, nextReviewDate ?? null, req.project.id);
      })();

      recordAudit(req, {
        action: 'STATUS_CHANGED',
        entityType: 'project',
        entityId: req.project.id,
        instituteId: req.project.institute_id,
        detail: { from: previous, to: newStatus, historyId },
      });

      if (newStatus === 'RED') {
        notifyProjectEvent({
          projectId: req.project.id,
          eventType: EVENTS.PROJECT_TURNED_RED,
          title: `Intervention required - ${req.project.title}`,
          body: `${req.user.full_name} moved this project to Red. Reason: ${rationale}`,
          excludeUserId: req.user.id,
        });
      } else if (previous === 'RED') {
        notifyProjectEvent({
          projectId: req.project.id,
          eventType: EVENTS.PROJECT_RECOVERED,
          title: `Recovering from Red - ${req.project.title}`,
          body: `${req.user.full_name} moved this project from Red to ${newStatus}. Reason: ${rationale}`,
          excludeUserId: req.user.id,
        });
      }

      res.status(201).json({
        history: db.prepare('SELECT * FROM status_history WHERE id = ?').get(historyId),
        project: db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Challenges / issues (requirement 5.6 steps 1-4; students may raise these)
// ---------------------------------------------------------------------------

const issueSchema = z.object({
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().min(10).max(4000),
  rootCause: text(2000).optional(),
  impact: text(2000).optional(),
  assistanceRequired: text(2000).optional(),
  supportSource: z.enum(['DEPARTMENT', 'INSTITUTE', 'INDUSTRY_PARTNER', 'APNILEAP', 'NONE']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  escalationLevel: z.enum(['NONE', 'DEPARTMENT', 'INSTITUTE', 'PROGRAMME', 'INDUSTRY']).default('NONE'),
  evidence: text(4000).optional(),
});

projectsRouter.post(
  '/:projectId/issues',
  withProject,
  requireProjectPermission('issue:create'),
  validate(issueSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      const id = newId('iss');
      const tenant = tenantOf(req.project);

      db.prepare(
        `INSERT INTO issues
           (id, project_id, institute_id, title, description, root_cause, impact,
            assistance_required, support_source, severity, escalation_level, evidence,
            raised_by, raised_by_role)
         VALUES (@id, @project_id, @institute_id, @title, @description, @root_cause, @impact,
                 @assistance_required, @support_source, @severity, @escalation_level, @evidence,
                 @raised_by, @raised_by_role)`,
      ).run({
        id,
        ...tenant,
        title: v.title,
        description: v.description,
        root_cause: v.rootCause ?? null,
        impact: v.impact ?? null,
        assistance_required: v.assistanceRequired ?? null,
        support_source: v.supportSource ?? null,
        severity: v.severity,
        escalation_level: v.escalationLevel,
        evidence: v.evidence ?? null,
        raised_by: req.user.id,
        raised_by_role: [...req.projectRoles].join(','),
      });

      touchProject(req.project.id);

      recordAudit(req, {
        action: 'ISSUE_RAISED',
        entityType: 'issue',
        entityId: id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, severity: v.severity },
      });

      if (v.assistanceRequired) {
        notifyProjectEvent({
          projectId: req.project.id,
          eventType: EVENTS.SUPPORT_REQUESTED,
          title: `Support requested - ${req.project.title}`,
          body: `${req.user.full_name} requested support: ${v.assistanceRequired}`,
          excludeUserId: req.user.id,
        });
      }

      res.status(201).json({ issue: db.prepare('SELECT * FROM issues WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const issuePatchSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'CLOSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  escalationLevel: z.enum(['NONE', 'DEPARTMENT', 'INSTITUTE', 'PROGRAMME', 'INDUSTRY']).optional(),
  rootCause: text(2000).optional(),
  impact: text(2000).optional(),
  assistanceRequired: text(2000).optional(),
  supportSource: z.enum(['DEPARTMENT', 'INSTITUTE', 'INDUSTRY_PARTNER', 'APNILEAP', 'NONE']).optional(),
  evidence: text(4000).optional(),
});

projectsRouter.patch(
  '/:projectId/issues/:issueId',
  withProject,
  requireProjectPermission('issue:update'),
  validate(issuePatchSchema),
  (req, res, next) => {
    try {
      const issue = db
        .prepare('SELECT * FROM issues WHERE id = ? AND project_id = ?')
        .get(req.params.issueId, req.project.id);
      if (!issue) return next(notFoundOrDenied());

      const v = req.valid;
      const columns = {
        status: 'status',
        severity: 'severity',
        escalationLevel: 'escalation_level',
        rootCause: 'root_cause',
        impact: 'impact',
        assistanceRequired: 'assistance_required',
        supportSource: 'support_source',
        evidence: 'evidence',
      };

      const updates = [];
      const params = [];
      for (const [key, column] of Object.entries(columns)) {
        if (v[key] === undefined) continue;
        updates.push(`${column} = ?`);
        params.push(v[key] === '' ? null : v[key]);
      }

      // Closing an issue requires evidence, so "resolved" cannot be asserted bare.
      if (['RESOLVED', 'VERIFIED', 'CLOSED'].includes(v.status)) {
        const evidence = v.evidence ?? issue.evidence;
        if (!evidence || evidence.trim().length < 10) {
          return next(badRequest('Evidence is required before a challenge can be marked resolved, verified or closed.'));
        }
        updates.push("resolved_at = COALESCE(resolved_at, datetime('now'))");
        if (v.status === 'VERIFIED') { updates.push('verified_by = ?'); params.push(req.user.id); }
        if (v.status === 'CLOSED') updates.push("closed_at = datetime('now')");
      }

      if (!updates.length) return res.json({ issue });

      updates.push("updated_at = datetime('now')");
      params.push(issue.id);
      db.prepare(`UPDATE issues SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      touchProject(req.project.id);

      recordAudit(req, {
        action: 'ISSUE_UPDATED',
        entityType: 'issue',
        entityId: issue.id,
        instituteId: req.project.institute_id,
        detail: { fields: Object.keys(v), status: v.status },
      });

      res.json({ issue: db.prepare('SELECT * FROM issues WHERE id = ?').get(issue.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Corrective actions (requirement 5.6 step 5)
// ---------------------------------------------------------------------------

const actionSchema = z.object({
  issueId: z.string().max(64).nullish(),
  description: z.string().trim().min(10).max(2000),
  ownerUserId: z.string().max(64).nullish(),
  ownerName: text(160).optional(),
  escalationOwnerUserId: z.string().max(64).nullish(),
  dueDate: dateString,
});

projectsRouter.post(
  '/:projectId/actions',
  withProject,
  requireProjectPermission('action:create'),
  validate(actionSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      if (!v.ownerUserId && !v.ownerName) {
        return next(badRequest('A corrective action must name an owner.'));
      }
      if (v.issueId) {
        const parent = db
          .prepare('SELECT id FROM issues WHERE id = ? AND project_id = ?')
          .get(v.issueId, req.project.id);
        if (!parent) return next(badRequest('That challenge does not belong to this project.'));
      }

      const id = newId('act');
      db.prepare(
        `INSERT INTO corrective_actions
           (id, project_id, institute_id, issue_id, description, owner_user_id, owner_name,
            escalation_owner_user_id, due_date, created_by)
         VALUES (@id, @project_id, @institute_id, @issue_id, @description, @owner_user_id, @owner_name,
                 @escalation_owner_user_id, @due_date, @created_by)`,
      ).run({
        id,
        ...tenantOf(req.project),
        issue_id: v.issueId ?? null,
        description: v.description,
        owner_user_id: v.ownerUserId ?? null,
        owner_name: v.ownerName ?? null,
        escalation_owner_user_id: v.escalationOwnerUserId ?? null,
        due_date: v.dueDate,
        created_by: req.user.id,
      });

      touchProject(req.project.id);
      recordAudit(req, {
        action: 'CORRECTIVE_ACTION_CREATED',
        entityType: 'corrective_action',
        entityId: id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, dueDate: v.dueDate },
      });

      res.status(201).json({ action: db.prepare('SELECT * FROM corrective_actions WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const actionPatchSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED']).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  dueDate: dateString.optional(),
  ownerUserId: z.string().max(64).nullish(),
  ownerName: text(160).optional(),
  evidence: text(4000).optional(),
});

projectsRouter.patch(
  '/:projectId/actions/:actionId',
  withProject,
  requireProjectPermission('action:update'),
  validate(actionPatchSchema),
  (req, res, next) => {
    try {
      const action = db
        .prepare('SELECT * FROM corrective_actions WHERE id = ? AND project_id = ?')
        .get(req.params.actionId, req.project.id);
      if (!action) return next(notFoundOrDenied());

      const v = req.valid;

      // Verification is a separate capability: the owner of an action cannot
      // certify their own work (requirement 5.6 step 6 / audit integrity).
      if (v.status === 'VERIFIED' && !req.projectPermissions.has('action:verify')) {
        return next(badRequest('Only a reviewer, department head or administrator can verify a corrective action.'));
      }
      if (['COMPLETED', 'VERIFIED'].includes(v.status)) {
        const evidence = v.evidence ?? action.evidence;
        if (!evidence || evidence.trim().length < 10) {
          return next(badRequest('Evidence is required before a corrective action can be marked complete or verified.'));
        }
      }

      const columns = {
        status: 'status',
        description: 'description',
        dueDate: 'due_date',
        ownerUserId: 'owner_user_id',
        ownerName: 'owner_name',
        evidence: 'evidence',
      };
      const updates = [];
      const params = [];
      for (const [key, column] of Object.entries(columns)) {
        if (v[key] === undefined) continue;
        updates.push(`${column} = ?`);
        params.push(v[key] === '' ? null : v[key]);
      }
      if (v.status === 'COMPLETED') updates.push("completed_at = datetime('now')");
      if (v.status === 'VERIFIED') {
        updates.push("completed_at = COALESCE(completed_at, datetime('now'))", 'verified_by = ?');
        params.push(req.user.id);
      }
      if (!updates.length) return res.json({ action });

      updates.push("updated_at = datetime('now')");
      params.push(action.id);
      db.prepare(`UPDATE corrective_actions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      touchProject(req.project.id);

      recordAudit(req, {
        action: 'CORRECTIVE_ACTION_UPDATED',
        entityType: 'corrective_action',
        entityId: action.id,
        instituteId: req.project.institute_id,
        detail: { status: v.status, fields: Object.keys(v) },
      });

      res.json({ action: db.prepare('SELECT * FROM corrective_actions WHERE id = ?').get(action.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Reviews (requirement 5.7)
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'EVIDENCE_REQUESTED', 'ESCALATED', 'NOTED']),
  comments: z.string().trim().min(10).max(4000),
  recommendedStatus: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
  correctiveActionSummary: text(2000).optional(),
  nextReviewDate: dateString.optional(),
});

projectsRouter.post(
  '/:projectId/reviews',
  withProject,
  requireProjectPermission('review:create'),
  validate(reviewSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      const id = newId('rev');

      db.transaction(() => {
        db.prepare(
          `INSERT INTO reviews
             (id, project_id, institute_id, reviewer_user_id, reviewer_name, previous_status,
              recommended_status, decision, comments, corrective_action_summary, next_review_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          req.project.id,
          req.project.institute_id,
          req.user.id,
          req.user.full_name,
          req.project.rag_status,
          v.recommendedStatus ?? null,
          v.decision,
          v.comments,
          v.correctiveActionSummary ?? null,
          v.nextReviewDate ?? null,
        );

        db.prepare(
          `UPDATE projects
             SET last_review_at = datetime('now'), last_update_at = datetime('now'),
                 updated_at = datetime('now'),
                 next_review_date = COALESCE(?, next_review_date)
           WHERE id = ?`,
        ).run(v.nextReviewDate ?? null, req.project.id);
      })();

      recordAudit(req, {
        action: 'REVIEW_RECORDED',
        entityType: 'review',
        entityId: id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, decision: v.decision, recommended: v.recommendedStatus },
      });

      res.status(201).json({ review: db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Milestones, KPIs, team and artefacts
// ---------------------------------------------------------------------------

const milestoneSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: text(2000).optional(),
  plannedDate: dateString.optional(),
  sequence: z.number().int().min(0).max(999).default(0),
  isCritical: z.boolean().default(false),
});

projectsRouter.post(
  '/:projectId/milestones',
  withProject,
  requireProjectPermission('project:update'),
  validate(milestoneSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      const id = newId('mst');
      db.prepare(
        `INSERT INTO milestones (id, project_id, institute_id, sequence, title, description, planned_date, is_critical)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, req.project.id, req.project.institute_id, v.sequence, v.title, v.description ?? null,
            v.plannedDate ?? null, v.isCritical ? 1 : 0);
      touchProject(req.project.id);
      recordAudit(req, {
        action: 'MILESTONE_CREATED',
        entityType: 'milestone',
        entityId: id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id },
      });
      res.status(201).json({ milestone: db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const milestonePatchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: text(2000).optional(),
  plannedDate: dateString.nullish(),
  actualDate: dateString.nullish(),
  status: z.enum(['UPCOMING', 'CURRENT', 'COMPLETED', 'MISSED']).optional(),
  isCritical: z.boolean().optional(),
});

projectsRouter.patch(
  '/:projectId/milestones/:milestoneId',
  withProject,
  requireProjectPermission('project:update'),
  validate(milestonePatchSchema),
  (req, res, next) => {
    try {
      const milestone = db
        .prepare('SELECT * FROM milestones WHERE id = ? AND project_id = ?')
        .get(req.params.milestoneId, req.project.id);
      if (!milestone) return next(notFoundOrDenied());

      const columns = {
        title: 'title', description: 'description', plannedDate: 'planned_date',
        actualDate: 'actual_date', status: 'status', isCritical: 'is_critical',
      };
      const updates = [];
      const params = [];
      for (const [key, column] of Object.entries(columns)) {
        if (req.valid[key] === undefined) continue;
        let value = req.valid[key];
        if (typeof value === 'boolean') value = value ? 1 : 0;
        updates.push(`${column} = ?`);
        params.push(value === '' ? null : value);
      }
      if (!updates.length) return res.json({ milestone });

      updates.push("updated_at = datetime('now')");
      params.push(milestone.id);
      db.prepare(`UPDATE milestones SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      touchProject(req.project.id);

      recordAudit(req, {
        action: 'MILESTONE_UPDATED',
        entityType: 'milestone',
        entityId: milestone.id,
        instituteId: req.project.institute_id,
        detail: req.valid,
      });
      res.json({ milestone: db.prepare('SELECT * FROM milestones WHERE id = ?').get(milestone.id) });
    } catch (error) {
      next(error);
    }
  },
);

const kpiSchema = z.object({
  name: z.string().trim().min(2).max(160),
  definition: text(1000).optional(),
  targetValue: z.string().trim().min(1).max(80),
  unit: text(40).optional(),
  accountableUserId: z.string().max(64).nullish(),
  accountableName: text(160).optional(),
});

projectsRouter.post(
  '/:projectId/kpis',
  withProject,
  requireProjectPermission('project:update'),
  validate(kpiSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      const id = newId('kpi');
      db.prepare(
        `INSERT INTO kpis (id, project_id, institute_id, name, definition, target_value, unit,
                           accountable_user_id, accountable_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, req.project.id, req.project.institute_id, v.name, v.definition ?? null,
            v.targetValue, v.unit ?? null, v.accountableUserId ?? null, v.accountableName ?? null);
      touchProject(req.project.id);
      recordAudit(req, {
        action: 'KPI_CREATED', entityType: 'kpi', entityId: id,
        instituteId: req.project.institute_id, detail: { projectId: req.project.id, name: v.name },
      });
      res.status(201).json({ kpi: db.prepare('SELECT * FROM kpis WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const measurementSchema = z.object({
  measuredValue: z.string().trim().min(1).max(80),
  measurementDate: dateString,
  evidence: z.string().trim().min(5).max(2000),
  meetsTarget: z.boolean(),
});

projectsRouter.post(
  '/:projectId/kpis/:kpiId/measurements',
  withProject,
  requireProjectPermission('project:update'),
  validate(measurementSchema),
  (req, res, next) => {
    try {
      const kpi = db.prepare('SELECT * FROM kpis WHERE id = ? AND project_id = ?')
        .get(req.params.kpiId, req.project.id);
      if (!kpi) return next(notFoundOrDenied());

      const v = req.valid;
      const id = newId('kpm');
      db.prepare(
        `INSERT INTO kpi_measurements
           (id, kpi_id, project_id, institute_id, measured_value, measurement_date, evidence, meets_target, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, kpi.id, req.project.id, req.project.institute_id, v.measuredValue,
            v.measurementDate, v.evidence, v.meetsTarget ? 1 : 0, req.user.id);
      touchProject(req.project.id);
      recordAudit(req, {
        action: 'KPI_MEASURED', entityType: 'kpi_measurement', entityId: id,
        instituteId: req.project.institute_id, detail: { kpiId: kpi.id, meetsTarget: v.meetsTarget },
      });
      res.status(201).json({ measurement: db.prepare('SELECT * FROM kpi_measurements WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const memberSchema = z.object({
  memberRole: z.enum(['FACULTY_MENTOR', 'CO_MENTOR', 'STUDENT', 'REVIEWER']),
  userId: z.string().max(64).nullish(),
  teamIdentifier: text(80).optional(),
  displayName: text(160).optional(),
});

projectsRouter.post(
  '/:projectId/members',
  withProject,
  requireProjectPermission('project:update'),
  validate(memberSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      if (!v.userId && !v.displayName && !v.teamIdentifier) {
        return next(badRequest('Provide a portal user, a display name, or a team identifier.'));
      }
      const id = newId('mem');
      // A student team a guide enters starts PENDING until the coordinator
      // confirms it; anyone who already holds team:approve is trusted to
      // self-approve what they add.
      const needsApproval = v.memberRole === 'STUDENT' && !req.projectPermissions.has('team:approve');
      const status = needsApproval ? 'PENDING' : 'APPROVED';

      db.prepare(
        `INSERT INTO project_members
           (id, project_id, institute_id, user_id, member_role, team_identifier, display_name,
            status, approved_by, approved_by_name, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, req.project.id, req.project.institute_id, v.userId ?? null, v.memberRole,
        v.teamIdentifier ?? null, v.displayName ?? null, status,
        needsApproval ? null : req.user.id,
        needsApproval ? null : req.user.full_name,
        needsApproval ? null : new Date().toISOString().replace('T', ' ').slice(0, 19),
      );
      touchProject(req.project.id);
      recordAudit(req, {
        action: 'PROJECT_MEMBER_ADDED', entityType: 'project_member', entityId: id,
        instituteId: req.project.institute_id, detail: { projectId: req.project.id, role: v.memberRole, status },
      });

      if (needsApproval) {
        notifyProjectEvent({
          projectId: req.project.id,
          eventType: EVENTS.PROGRESS_SUBMITTED,
          title: `Student team awaiting approval - ${req.project.title}`,
          body: `${req.user.full_name} added a student team member for coordinator approval.`,
          excludeUserId: req.user.id,
        });
      }

      res.status(201).json({ member: db.prepare('SELECT * FROM project_members WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const repositorySchema = z.object({
  label: z.string().trim().min(2).max(160),
  repoUrl: z.string().trim().url().max(500),
  provider: text(40).default('GITHUB'),
  visibility: z.enum(['PRIVATE', 'INTERNAL']).default('PRIVATE'),
});

projectsRouter.post(
  '/:projectId/repositories',
  withProject,
  requireProjectPermission('artefact:manage'),
  validate(repositorySchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      const id = newId('rep');
      db.prepare(
        `INSERT INTO repository_links (id, project_id, institute_id, provider, label, repo_url, visibility, added_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, req.project.id, req.project.institute_id, v.provider, v.label, v.repoUrl, v.visibility, req.user.id);
      touchProject(req.project.id);
      recordAudit(req, {
        action: 'REPOSITORY_LINKED', entityType: 'repository_link', entityId: id,
        instituteId: req.project.institute_id, detail: { projectId: req.project.id, url: v.repoUrl },
      });
      res.status(201).json({ repository: db.prepare('SELECT * FROM repository_links WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const attachmentSchema = z.object({
  kind: z.enum(['REPORT', 'PRESENTATION', 'IMAGE', 'RECORDING', 'OTHER']).default('OTHER'),
  label: z.string().trim().min(2).max(160),
  externalUrl: z.string().trim().url().max(500).optional(),
  storageKey: text(300).optional(),
  contentType: text(120).optional(),
  sizeBytes: z.number().int().min(0).optional(),
});

projectsRouter.post(
  '/:projectId/attachments',
  withProject,
  requireProjectPermission('artefact:manage'),
  validate(attachmentSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      if (!v.externalUrl && !v.storageKey) {
        return next(badRequest('Provide either an object-storage key or an external URL for the attachment.'));
      }
      const id = newId('att');
      db.prepare(
        `INSERT INTO attachments (id, project_id, institute_id, kind, label, storage_key, external_url,
                                  content_type, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, req.project.id, req.project.institute_id, v.kind, v.label, v.storageKey ?? null,
            v.externalUrl ?? null, v.contentType ?? null, v.sizeBytes ?? null, req.user.id);
      touchProject(req.project.id);
      recordAudit(req, {
        action: 'ATTACHMENT_LINKED', entityType: 'attachment', entityId: id,
        instituteId: req.project.institute_id, detail: { projectId: req.project.id, kind: v.kind },
      });
      res.status(201).json({ attachment: db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Deletion (CRUD completeness)
//
// Two different rules apply, and they are deliberately not the same rule:
//
//  - Child records that describe day-to-day execution (milestones, KPIs and
//    their measurements, team members, artefact links) are ordinary rows.
//    Removing a mistaken entry is safe and does not erase anything the audit
//    trail depends on, so these are hard deletes gated only on the same
//    permission that would let the caller create one.
//
//  - Challenges and corrective actions become part of the accountability
//    record once they have been acted on. A challenge that was opened and
//    then closed with evidence, or an action that was verified, documents
//    something that happened; deleting it would let that disappear silently.
//    These may only be deleted while still in an untouched or abandoned
//    state (OPEN/IN_PROGRESS for issues; OPEN/IN_PROGRESS/CANCELLED for
//    actions). Anything further along must be closed or cancelled through
//    the normal workflow instead, which keeps the reason on record.
//
//  - The project itself may only be hard-deleted while it still has no
//    reviewed history: at most the single "Project created" status_history
//    row and no recorded reviews. A project that has ever been reviewed or
//    had its status changed keeps the "history preserved" guarantee from
//    requirement 5.7 - archiving (PATCH isArchived) is the only removal path
//    once that line is crossed.
//
//  - reviews, status_history and audit_log have no DELETE route at all. The
//    latter two are additionally enforced append-only by database triggers.
// ---------------------------------------------------------------------------

function deleteChild(table, idParam, permission, options) {
  const action = options.action;
  const entityType = options.entityType;
  return [
    withProject,
    requireProjectPermission(permission),
    (req, res, next) => {
      try {
        const row = db
          .prepare(`SELECT * FROM ${table} WHERE id = ? AND project_id = ?`)
          .get(req.params[idParam], req.project.id);
        if (!row) return next(notFoundOrDenied());

        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
        touchProject(req.project.id);

        recordAudit(req, {
          action,
          entityType,
          entityId: row.id,
          instituteId: req.project.institute_id,
          detail: { projectId: req.project.id },
        });

        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  ];
}

projectsRouter.delete(
  '/:projectId/milestones/:milestoneId',
  ...deleteChild('milestones', 'milestoneId', 'project:update', {
    action: 'MILESTONE_DELETED', entityType: 'milestone',
  }),
);

projectsRouter.delete(
  '/:projectId/kpis/:kpiId',
  ...deleteChild('kpis', 'kpiId', 'project:update', {
    action: 'KPI_DELETED', entityType: 'kpi',
  }),
);

projectsRouter.delete(
  '/:projectId/kpis/:kpiId/measurements/:measurementId',
  withProject,
  requireProjectPermission('project:update'),
  (req, res, next) => {
    try {
      const measurement = db
        .prepare('SELECT * FROM kpi_measurements WHERE id = ? AND kpi_id = ? AND project_id = ?')
        .get(req.params.measurementId, req.params.kpiId, req.project.id);
      if (!measurement) return next(notFoundOrDenied());

      db.prepare('DELETE FROM kpi_measurements WHERE id = ?').run(measurement.id);
      touchProject(req.project.id);

      recordAudit(req, {
        action: 'KPI_MEASUREMENT_DELETED',
        entityType: 'kpi_measurement',
        entityId: measurement.id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, kpiId: req.params.kpiId },
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

projectsRouter.delete(
  '/:projectId/members/:memberId',
  ...deleteChild('project_members', 'memberId', 'project:update', {
    action: 'PROJECT_MEMBER_REMOVED', entityType: 'project_member',
  }),
);

projectsRouter.delete(
  '/:projectId/repositories/:repositoryId',
  ...deleteChild('repository_links', 'repositoryId', 'artefact:manage', {
    action: 'REPOSITORY_UNLINKED', entityType: 'repository_link',
  }),
);

projectsRouter.delete(
  '/:projectId/attachments/:attachmentId',
  ...deleteChild('attachments', 'attachmentId', 'artefact:manage', {
    action: 'ATTACHMENT_UNLINKED', entityType: 'attachment',
  }),
);

projectsRouter.delete(
  '/:projectId/issues/:issueId',
  withProject,
  requireProjectPermission('issue:update'),
  (req, res, next) => {
    try {
      const issue = db
        .prepare('SELECT * FROM issues WHERE id = ? AND project_id = ?')
        .get(req.params.issueId, req.project.id);
      if (!issue) return next(notFoundOrDenied());

      if (!['OPEN', 'IN_PROGRESS'].includes(issue.status)) {
        return next(conflict(
          'This challenge has already been resolved, verified or closed and is now part of the ' +
          'project record. It can no longer be deleted, only viewed.',
        ));
      }

      db.prepare('DELETE FROM issues WHERE id = ?').run(issue.id);
      touchProject(req.project.id);

      recordAudit(req, {
        action: 'ISSUE_DELETED',
        entityType: 'issue',
        entityId: issue.id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id },
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

projectsRouter.delete(
  '/:projectId/actions/:actionId',
  withProject,
  requireProjectPermission('action:update'),
  (req, res, next) => {
    try {
      const action = db
        .prepare('SELECT * FROM corrective_actions WHERE id = ? AND project_id = ?')
        .get(req.params.actionId, req.project.id);
      if (!action) return next(notFoundOrDenied());

      if (!['OPEN', 'IN_PROGRESS', 'CANCELLED'].includes(action.status)) {
        return next(conflict(
          'This corrective action has already been completed or verified and is now part of the ' +
          'project record. It can no longer be deleted, only viewed.',
        ));
      }

      db.prepare('DELETE FROM corrective_actions WHERE id = ?').run(action.id);
      touchProject(req.project.id);

      recordAudit(req, {
        action: 'CORRECTIVE_ACTION_DELETED',
        entityType: 'corrective_action',
        entityId: action.id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id },
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Deletes the project itself. Restricted to project:create (the same
 * capability that registers one) rather than project:update, since removing
 * the record entirely is a bigger step than editing it.
 */
projectsRouter.delete(
  '/:projectId',
  withProject,
  requireProjectPermission('project:create'),
  (req, res, next) => {
    try {
      const historyCount = db
        .prepare('SELECT COUNT(*) AS n FROM status_history WHERE project_id = ?')
        .get(req.project.id).n;
      const reviewCount = db
        .prepare('SELECT COUNT(*) AS n FROM reviews WHERE project_id = ?')
        .get(req.project.id).n;

      if (historyCount > 1 || reviewCount > 0) {
        return next(conflict(
          'This project has a recorded status or review history and cannot be deleted, to keep that ' +
          'record intact. Archive it instead from the Overview tab.',
          { historyEntries: historyCount, reviews: reviewCount },
        ));
      }

      const code = req.project.code;
      db.prepare('DELETE FROM projects WHERE id = ?').run(req.project.id);

      recordAudit(req, {
        action: 'PROJECT_DELETED',
        entityType: 'project',
        entityId: req.project.id,
        instituteId: req.project.institute_id,
        detail: { code },
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Progress submissions: draft -> review -> approval workflow.
//
// A student or mentor's reported completion is never written straight onto
// the project. It lands here as a submission; only a reviewer's APPROVED
// decision copies the number onto projects.completion_percentage - the same
// column every dashboard and report already reads, so nothing downstream had
// to change to gain this guarantee.
// ---------------------------------------------------------------------------

const progressSubmissionSchema = z.object({
  completionPercentage: z.number().int().min(0).max(100),
  workCompleted: text(2000).optional(),
  workInProgress: text(2000).optional(),
  workPlannedNext: text(2000).optional(),
  problemsEncountered: text(2000).optional(),
  supportRequired: text(2000).optional(),
  expectedCompletionDate: dateString.optional(),
  studentRemarks: text(2000).optional(),
  proposedRagStatus: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
  evidence: text(4000).optional(),
  // false = Save Draft, true = Submit for Guide Review.
  submitNow: z.boolean().default(false),
});

function nextProgressVersion(projectId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM progress_submissions WHERE project_id = ?')
    .get(projectId);
  return row.v + 1;
}

/** Everyone who can view the project can see its full submission history. */
projectsRouter.get('/:projectId/progress', withProject, (req, res) => {
  const submissions = db
    .prepare('SELECT * FROM progress_submissions WHERE project_id = ? ORDER BY version DESC')
    .all(req.project.id);
  res.json({ submissions });
});

projectsRouter.post(
  '/:projectId/progress',
  withProject,
  requireProjectPermission('progress:submit'),
  validate(progressSubmissionSchema),
  (req, res, next) => {
    try {
      const v = req.valid;
      const id = newId('psb');
      const submitting = v.submitNow;

      db.prepare(
        `INSERT INTO progress_submissions
           (id, project_id, institute_id, version, completion_percentage, work_completed,
            work_in_progress, work_planned_next, problems_encountered, support_required,
            expected_completion_date, student_remarks, proposed_rag_status, evidence,
            status, submitted_by, submitted_by_name, submitted_at)
         VALUES (@id, @project_id, @institute_id, @version, @completion_percentage, @work_completed,
                 @work_in_progress, @work_planned_next, @problems_encountered, @support_required,
                 @expected_completion_date, @student_remarks, @proposed_rag_status, @evidence,
                 @status, @submitted_by, @submitted_by_name, @submitted_at)`,
      ).run({
        id,
        ...tenantOf(req.project),
        version: nextProgressVersion(req.project.id),
        completion_percentage: v.completionPercentage,
        work_completed: v.workCompleted ?? null,
        work_in_progress: v.workInProgress ?? null,
        work_planned_next: v.workPlannedNext ?? null,
        problems_encountered: v.problemsEncountered ?? null,
        support_required: v.supportRequired ?? null,
        expected_completion_date: v.expectedCompletionDate ?? null,
        student_remarks: v.studentRemarks ?? null,
        proposed_rag_status: v.proposedRagStatus ?? null,
        evidence: v.evidence ?? null,
        status: submitting ? 'PENDING_REVIEW' : 'DRAFT',
        submitted_by: submitting ? req.user.id : null,
        submitted_by_name: submitting ? req.user.full_name : null,
        submitted_at: submitting ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
      });

      recordAudit(req, {
        action: submitting ? 'PROGRESS_SUBMITTED' : 'PROGRESS_DRAFT_SAVED',
        entityType: 'progress_submission',
        entityId: id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, completion: v.completionPercentage },
      });

      if (submitting) {
        touchProject(req.project.id);
        notifyProjectEvent({
          projectId: req.project.id,
          eventType: EVENTS.PROGRESS_SUBMITTED,
          title: `Progress submitted for review - ${req.project.title}`,
          body: `${req.user.full_name} submitted a progress update (${v.completionPercentage}% complete) for guide review.`,
          excludeUserId: req.user.id,
        });
      }

      res.status(201).json({ submission: db.prepare('SELECT * FROM progress_submissions WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const progressPatchSchema = progressSubmissionSchema.partial().extend({
  submitNow: z.boolean().default(false),
});

/**
 * Edits a submission, only while it is still DRAFT or CHANGES_REQUESTED - once
 * it is PENDING_REVIEW, UNDER_REVIEW, APPROVED or REJECTED it is part of the
 * reviewable record (the database trigger enforces the terminal states even
 * if this check is ever bypassed).
 */
projectsRouter.patch(
  '/:projectId/progress/:submissionId',
  withProject,
  requireProjectPermission('progress:submit'),
  validate(progressPatchSchema),
  (req, res, next) => {
    try {
      const submission = db
        .prepare('SELECT * FROM progress_submissions WHERE id = ? AND project_id = ?')
        .get(req.params.submissionId, req.project.id);
      if (!submission) return next(notFoundOrDenied());

      if (!['DRAFT', 'CHANGES_REQUESTED'].includes(submission.status)) {
        return next(conflict(
          'This submission has already moved past editing - it is pending review, decided, or under ' +
          'review. Create a new progress update instead.',
        ));
      }

      const v = req.valid;
      const submitting = v.submitNow;
      const columns = {
        completionPercentage: 'completion_percentage', workCompleted: 'work_completed',
        workInProgress: 'work_in_progress', workPlannedNext: 'work_planned_next',
        problemsEncountered: 'problems_encountered', supportRequired: 'support_required',
        expectedCompletionDate: 'expected_completion_date', studentRemarks: 'student_remarks',
        proposedRagStatus: 'proposed_rag_status', evidence: 'evidence',
      };
      const updates = [];
      const params = [];
      for (const [key, column] of Object.entries(columns)) {
        if (v[key] === undefined) continue;
        updates.push(`${column} = ?`);
        params.push(v[key] === '' ? null : v[key]);
      }
      if (submitting) {
        updates.push('status = ?', 'submitted_by = ?', 'submitted_by_name = ?', "submitted_at = datetime('now')");
        params.push('PENDING_REVIEW', req.user.id, req.user.full_name);
        // A resubmission is a fresh review cycle: clear the previous decision.
        updates.push('reviewed_by = NULL', 'reviewed_by_name = NULL', 'review_comment = NULL', 'reviewed_at = NULL');
      }
      if (!updates.length) return res.json({ submission });

      updates.push("updated_at = datetime('now')");
      params.push(submission.id);
      db.prepare(`UPDATE progress_submissions SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      recordAudit(req, {
        action: submitting ? 'PROGRESS_RESUBMITTED' : 'PROGRESS_DRAFT_UPDATED',
        entityType: 'progress_submission',
        entityId: submission.id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id },
      });

      if (submitting) {
        touchProject(req.project.id);
        notifyProjectEvent({
          projectId: req.project.id,
          eventType: EVENTS.PROGRESS_SUBMITTED,
          title: `Progress resubmitted for review - ${req.project.title}`,
          body: `${req.user.full_name} resubmitted a progress update for guide review.`,
          excludeUserId: req.user.id,
        });
      }

      res.json({ submission: db.prepare('SELECT * FROM progress_submissions WHERE id = ?').get(submission.id) });
    } catch (error) {
      next(error);
    }
  },
);

/** A draft the student decided not to pursue. Nothing else may ever be deleted. */
projectsRouter.delete(
  '/:projectId/progress/:submissionId',
  withProject,
  requireProjectPermission('progress:submit'),
  (req, res, next) => {
    try {
      const submission = db
        .prepare('SELECT * FROM progress_submissions WHERE id = ? AND project_id = ?')
        .get(req.params.submissionId, req.project.id);
      if (!submission) return next(notFoundOrDenied());

      if (submission.status !== 'DRAFT') {
        return next(conflict('Only a draft submission may be deleted. A submitted update becomes part of the record.'));
      }

      db.prepare('DELETE FROM progress_submissions WHERE id = ?').run(submission.id);
      recordAudit(req, {
        action: 'PROGRESS_DRAFT_DELETED',
        entityType: 'progress_submission',
        entityId: submission.id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id },
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

const progressDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
  comment: z.string().trim().max(2000).optional(),
});

/**
 * The reviewer's decision on a submission. Approving is the only path that
 * ever writes to projects.completion_percentage - the value every dashboard,
 * report and higher-level view reads. Rejecting or requesting changes
 * requires a comment: the student must be told what to do next, not just
 * that something was declined.
 */
projectsRouter.post(
  '/:projectId/progress/:submissionId/decision',
  withProject,
  requireProjectPermission('progress:review'),
  validate(progressDecisionSchema),
  (req, res, next) => {
    try {
      const submission = db
        .prepare('SELECT * FROM progress_submissions WHERE id = ? AND project_id = ?')
        .get(req.params.submissionId, req.project.id);
      if (!submission) return next(notFoundOrDenied());

      if (!['PENDING_REVIEW', 'UNDER_REVIEW'].includes(submission.status)) {
        return next(conflict('This submission has already been decided and cannot be decided again.'));
      }

      const { decision, comment } = req.valid;
      if (decision !== 'APPROVED' && (!comment || comment.trim().length < 5)) {
        return next(badRequest(
          'A comment explaining what is needed is required when rejecting a submission or requesting changes.',
        ));
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE progress_submissions
             SET status = ?, reviewed_by = ?, reviewed_by_name = ?, review_comment = ?,
                 reviewed_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`,
        ).run(decision, req.user.id, req.user.full_name, comment?.trim() || null, submission.id);

        if (decision === 'APPROVED') {
          db.prepare(
            `UPDATE projects
               SET completion_percentage = ?, last_review_at = datetime('now'),
                   last_update_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?`,
          ).run(submission.completion_percentage, req.project.id);
        }
      })();

      recordAudit(req, {
        action: `PROGRESS_${decision}`,
        entityType: 'progress_submission',
        entityId: submission.id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, decision },
      });

      const decisionLabel = { APPROVED: 'approved', REJECTED: 'rejected', CHANGES_REQUESTED: 'sent back for changes' }[decision];
      if (submission.submitted_by) {
        notifyUser({
          userId: submission.submitted_by,
          eventType: EVENTS.PROGRESS_DECIDED,
          title: `Your progress update was ${decisionLabel} - ${req.project.title}`,
          body: comment?.trim()
            ? `${req.user.full_name}: ${comment.trim()}`
            : `${req.user.full_name} approved your submitted progress.`,
          instituteId: req.project.institute_id,
          projectId: req.project.id,
        });
      }
      if (decision === 'APPROVED') {
        notifyProjectEvent({
          projectId: req.project.id,
          eventType: EVENTS.PROGRESS_DECIDED,
          title: `Progress approved - ${req.project.title}`,
          body: `${req.user.full_name} approved a progress update at ${submission.completion_percentage}% complete.`,
          excludeUserId: req.user.id,
        });
      }

      res.json({ submission: db.prepare('SELECT * FROM progress_submissions WHERE id = ?').get(submission.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Team approval: a coordinator (or department head / admin) confirms a
// student team a guide entered.
// ---------------------------------------------------------------------------

const memberDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(2000).optional(),
});

projectsRouter.post(
  '/:projectId/members/:memberId/decision',
  withProject,
  requireProjectPermission('team:approve'),
  validate(memberDecisionSchema),
  (req, res, next) => {
    try {
      const member = db
        .prepare('SELECT * FROM project_members WHERE id = ? AND project_id = ?')
        .get(req.params.memberId, req.project.id);
      if (!member) return next(notFoundOrDenied());
      if (member.status !== 'PENDING') {
        return next(conflict('This team member has already been decided.'));
      }

      const { decision, comment } = req.valid;
      if (decision === 'REJECTED' && (!comment || comment.trim().length < 5)) {
        return next(badRequest('A comment explaining the rejection is required.'));
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE project_members
             SET status = ?, approved_by = ?, approved_by_name = ?, approved_at = datetime('now')
           WHERE id = ?`,
        ).run(decision, req.user.id, req.user.full_name, member.id);

        // A student who self-registered has a real login (user_id) but no
        // access yet - exactly like a mentor's pending registration. Approval
        // is what actually grants it, here rather than in a separate step.
        if (decision === 'APPROVED' && member.member_role === 'STUDENT' && member.user_id) {
          const alreadyGranted = db
            .prepare(
              `SELECT 1 FROM access_grants
               WHERE user_id = ? AND role = 'STUDENT' AND scope_type = 'PROJECT'
                 AND project_id = ? AND is_active = 1`,
            )
            .get(member.user_id, req.project.id);
          if (!alreadyGranted) {
            db.prepare(
              `INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, project_id, granted_by)
               VALUES (?, ?, 'STUDENT', 'PROJECT', ?, ?, ?)`,
            ).run(newId('grt'), member.user_id, req.project.institute_id, req.project.id, req.user.id);
          }
        }
      })();

      recordAudit(req, {
        action: `TEAM_MEMBER_${decision}`,
        entityType: 'project_member',
        entityId: member.id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, decision, comment: comment?.trim() },
      });

      if (decision === 'APPROVED' && member.member_role === 'STUDENT' && member.user_id) {
        notifyUser({
          userId: member.user_id,
          eventType: EVENTS.ACCESS_CHANGED,
          title: `You have been approved for ${req.project.title}`,
          body: `${req.user.full_name} approved your team registration. You can now access this project.`,
          instituteId: req.project.institute_id,
          projectId: req.project.id,
        });
      }

      res.json({ member: db.prepare('SELECT * FROM project_members WHERE id = ?').get(member.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Guide allocation: a coordinator assigns which approved Faculty Mentor is
// the guide for this project. Only one active guide per project - assigning
// a new one retires the previous one rather than stacking them up.
// ---------------------------------------------------------------------------

/**
 * Mentors eligible to guide this project: everyone holding an active,
 * approved FACULTY_MENTOR grant that reaches this project's department,
 * institute or the project itself - exactly the set assign-guide will accept.
 * A coordinator has no user:manage permission and so no other way to find
 * who they may even pick.
 */
projectsRouter.get(
  '/:projectId/eligible-guides',
  withProject,
  requireProjectPermission('project:assign_guide'),
  (req, res) => {
    const mentors = db
      .prepare(
        `SELECT DISTINCT u.id, u.email, u.full_name, u.designation
         FROM users u
         JOIN access_grants g ON g.user_id = u.id AND g.is_active = 1
           AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
         WHERE u.is_active = 1 AND g.role = 'FACULTY_MENTOR'
           AND (
             (g.scope_type = 'DEPARTMENT' AND g.department_id = ?) OR
             (g.scope_type = 'INSTITUTE' AND g.institute_id = ?) OR
             (g.scope_type = 'PROJECT' AND g.project_id = ?)
           )
         ORDER BY u.full_name`,
      )
      .all(req.project.department_id, req.project.institute_id, req.project.id);
    res.json({ mentors });
  },
);

const assignGuideSchema = z.object({ userId: z.string().max(64).optional(), email: z.string().email().max(254).optional() })
  .refine((v) => v.userId || v.email, { message: 'Provide either a user ID or an email address.' });

projectsRouter.post(
  '/:projectId/assign-guide',
  withProject,
  requireProjectPermission('project:assign_guide'),
  validate(assignGuideSchema),
  (req, res, next) => {
    try {
      const guide = req.valid.userId
        ? db.prepare('SELECT id, full_name FROM users WHERE id = ? AND is_active = 1').get(req.valid.userId)
        : db.prepare('SELECT id, full_name FROM users WHERE email = ? AND is_active = 1').get(req.valid.email);
      if (!guide) return next(badRequest('That user does not exist or is not active.'));

      const holdsMentorGrant = db
        .prepare(
          `SELECT 1 FROM access_grants
           WHERE user_id = ? AND role = 'FACULTY_MENTOR' AND is_active = 1
             AND (
               (scope_type = 'DEPARTMENT' AND department_id = ?) OR
               (scope_type = 'INSTITUTE' AND institute_id = ?) OR
               (scope_type = 'PROJECT' AND project_id = ?)
             )`,
        )
        .get(guide.id, req.project.department_id, req.project.institute_id, req.project.id);
      if (!holdsMentorGrant) {
        return next(badRequest(
          'That person does not hold an approved Faculty Mentor grant reaching this project. ' +
          'Their registration may still be pending department-head approval.',
        ));
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE project_members SET is_active = 0
           WHERE project_id = ? AND member_role = 'FACULTY_MENTOR' AND is_active = 1`,
        ).run(req.project.id);

        db.prepare(
          `INSERT INTO project_members
             (id, project_id, institute_id, user_id, member_role, status, approved_by, approved_by_name, approved_at)
           VALUES (?, ?, ?, ?, 'FACULTY_MENTOR', 'APPROVED', ?, ?, datetime('now'))`,
        ).run(newId('mem'), req.project.id, req.project.institute_id, guide.id, req.user.id, req.user.full_name);
      })();

      touchProject(req.project.id);
      recordAudit(req, {
        action: 'GUIDE_ASSIGNED',
        entityType: 'project',
        entityId: req.project.id,
        instituteId: req.project.institute_id,
        detail: { guideUserId: guide.id },
      });
      notifyUser({
        userId: guide.id,
        eventType: EVENTS.ACCESS_CHANGED,
        title: `You have been assigned as guide - ${req.project.title}`,
        body: `${req.user.full_name} allocated this project to you.`,
        instituteId: req.project.institute_id,
        projectId: req.project.id,
      });

      res.status(201).json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Project definition edits reachable by students - theme, title and the
// other definition fields, blocked once the guide has frozen the project.
// ---------------------------------------------------------------------------

const definitionEditSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  ...definitionFields,
});

projectsRouter.patch(
  '/:projectId/definition',
  withProject,
  requireProjectPermission('project:edit_definition'),
  validate(definitionEditSchema),
  (req, res, next) => {
    try {
      // project:update holders (the guide, coordinator, admins) can still
      // edit after a freeze; a student whose only route in is
      // project:edit_definition cannot.
      if (req.project.definition_frozen && !req.projectPermissions.has('project:update')) {
        return next(conflict(
          `This project's definition was frozen by ${req.project.frozen_by_name ?? 'the guide'} and can no ` +
          'longer be edited by students. Ask your guide to unfreeze it if a change is genuinely needed.',
        ));
      }

      const columns = { title: 'title', ...PROJECT_COLUMNS };
      const updates = [];
      const params = [];
      for (const [key, column] of Object.entries(columns)) {
        if (req.valid[key] === undefined) continue;
        updates.push(`${column} = ?`);
        params.push(req.valid[key] === '' ? null : req.valid[key]);
      }
      if (!updates.length) return res.json({ project: req.project });

      updates.push("last_update_at = datetime('now')", "updated_at = datetime('now')");
      params.push(req.project.id);
      db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      recordAudit(req, {
        action: 'PROJECT_DEFINITION_EDITED',
        entityType: 'project',
        entityId: req.project.id,
        instituteId: req.project.institute_id,
        detail: { fields: Object.keys(req.valid) },
      });

      res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Freeze / unfreeze: once the guide is satisfied with the project definition,
// freezing it stops students editing theme/title/other details directly.
// ---------------------------------------------------------------------------

projectsRouter.post(
  '/:projectId/freeze',
  withProject,
  requireProjectPermission('project:freeze'),
  (req, res, next) => {
    try {
      if (req.project.definition_frozen) return next(conflict('This project is already frozen.'));
      db.prepare(
        `UPDATE projects SET definition_frozen = 1, frozen_by = ?, frozen_by_name = ?,
                             frozen_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      ).run(req.user.id, req.user.full_name, req.project.id);
      recordAudit(req, {
        action: 'PROJECT_FROZEN', entityType: 'project', entityId: req.project.id,
        instituteId: req.project.institute_id,
      });
      res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id) });
    } catch (error) {
      next(error);
    }
  },
);

projectsRouter.post(
  '/:projectId/unfreeze',
  withProject,
  requireProjectPermission('project:freeze'),
  (req, res, next) => {
    try {
      if (!req.project.definition_frozen) return next(conflict('This project is not frozen.'));
      db.prepare(
        `UPDATE projects SET definition_frozen = 0, frozen_by = NULL, frozen_by_name = NULL,
                             frozen_at = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(req.project.id);
      recordAudit(req, {
        action: 'PROJECT_UNFROZEN', entityType: 'project', entityId: req.project.id,
        instituteId: req.project.institute_id,
      });
      res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Scheduled reviews: the Review 1/2/3 slots generated in bulk from a rubric
// (POST /api/rubrics/:id/generate-reviews). Conducting one writes the actual
// reviews row, tagged with the same rubric_id and review_number, so the
// criteria a team was judged on is always traceable.
// ---------------------------------------------------------------------------

projectsRouter.get('/:projectId/scheduled-reviews', withProject, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, r.title AS rubric_title, r.criteria AS rubric_criteria
       FROM scheduled_reviews s
       JOIN review_rubrics r ON r.id = s.rubric_id
       WHERE s.project_id = ?
       ORDER BY s.review_number`,
    )
    .all(req.project.id);
  res.json({
    scheduledReviews: rows.map((row) => ({ ...row, rubric_criteria: JSON.parse(row.rubric_criteria) })),
  });
});

const conductSchema = z.object({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'EVIDENCE_REQUESTED', 'ESCALATED', 'NOTED']),
  comments: z.string().trim().min(10).max(4000),
  recommendedStatus: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
  correctiveActionSummary: text(2000).optional(),
  nextReviewDate: dateString.optional(),
  scores: z.record(z.string(), z.number().min(0)).optional(),
});

projectsRouter.post(
  '/:projectId/scheduled-reviews/:scheduledId/conduct',
  withProject,
  requireProjectPermission('review:create'),
  validate(conductSchema),
  (req, res, next) => {
    try {
      const scheduled = db
        .prepare('SELECT * FROM scheduled_reviews WHERE id = ? AND project_id = ?')
        .get(req.params.scheduledId, req.project.id);
      if (!scheduled) return next(notFoundOrDenied());
      if (scheduled.status !== 'PLANNED') {
        return next(conflict('This review has already been conducted.'));
      }

      const rubric = db.prepare('SELECT * FROM review_rubrics WHERE id = ?').get(scheduled.rubric_id);
      const v = req.valid;

      // Scores, if given, must match declared criteria and stay within their
      // maximum - the rubric is a contract, not a suggestion.
      if (v.scores) {
        const criteria = JSON.parse(rubric.criteria);
        const byName = new Map(criteria.map((c) => [c.name, c.maxMarks]));
        for (const [name, value] of Object.entries(v.scores)) {
          if (!byName.has(name)) {
            return next(badRequest(`"${name}" is not a criterion on this rubric.`));
          }
          if (value > byName.get(name)) {
            return next(badRequest(`The score for "${name}" exceeds its maximum of ${byName.get(name)}.`));
          }
        }
      }

      const reviewId = newId('rev');

      db.transaction(() => {
        db.prepare(
          `INSERT INTO reviews
             (id, project_id, institute_id, reviewer_user_id, reviewer_name, previous_status,
              recommended_status, decision, comments, corrective_action_summary, next_review_date,
              rubric_id, review_number, scores)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          reviewId, req.project.id, req.project.institute_id, req.user.id, req.user.full_name,
          req.project.rag_status, v.recommendedStatus ?? null, v.decision, v.comments,
          v.correctiveActionSummary ?? null, v.nextReviewDate ?? null,
          scheduled.rubric_id, scheduled.review_number, v.scores ? JSON.stringify(v.scores) : null,
        );

        db.prepare(
          `UPDATE projects
             SET last_review_at = datetime('now'), last_update_at = datetime('now'),
                 updated_at = datetime('now'), next_review_date = COALESCE(?, next_review_date)
           WHERE id = ?`,
        ).run(v.nextReviewDate ?? null, req.project.id);

        db.prepare("UPDATE scheduled_reviews SET status = 'COMPLETED', review_id = ? WHERE id = ?")
          .run(reviewId, scheduled.id);
      })();

      recordAudit(req, {
        action: 'SCHEDULED_REVIEW_CONDUCTED',
        entityType: 'review',
        entityId: reviewId,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, rubricId: scheduled.rubric_id, reviewNumber: scheduled.review_number },
      });

      res.status(201).json({
        review: db.prepare('SELECT * FROM reviews WHERE id = ?').get(reviewId),
        scheduledReview: db.prepare('SELECT * FROM scheduled_reviews WHERE id = ?').get(scheduled.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Foundation Integration extension (docs/DATABASE-DESIGN.txt Section 9):
// theme assignment, engine decomposition, the formal Gate 0-4 review model,
// and the guide's informal weekly check-in. Every write route below is
// gated on the project already having an APPROVED FACULTY_MENTOR - i.e. it
// only becomes usable after guide allocation (POST /assign-guide), per
// Section 9.0.
// ---------------------------------------------------------------------------

function hasApprovedGuide(projectId) {
  return !!db
    .prepare(
      `SELECT 1 FROM project_members
       WHERE project_id = ? AND member_role = 'FACULTY_MENTOR' AND status = 'APPROVED' AND is_active = 1`,
    )
    .get(projectId);
}

function requireGuideAllocated(req, _res, next) {
  if (!hasApprovedGuide(req.project.id)) {
    return next(conflict(
      'This project has no allocated guide yet. Theme, engines and gate reviews unlock once a coordinator ' +
      'assigns a Faculty Mentor (see POST /assign-guide).',
    ));
  }
  next();
}

// --- Theme assignment -------------------------------------------------------

const assignThemeSchema = z.object({ themeId: z.string().min(1).max(64) });

projectsRouter.patch(
  '/:projectId/theme',
  withProject,
  requireProjectPermission('project:assign_theme'),
  requireGuideAllocated,
  validate(assignThemeSchema),
  (req, res, next) => {
    try {
      const theme = db.prepare('SELECT * FROM project_themes WHERE id = ? AND is_active = 1').get(req.valid.themeId);
      if (!theme) return next(badRequest('That theme does not exist.'));
      if (theme.institute_id && theme.institute_id !== req.project.institute_id) {
        return next(badRequest("That theme belongs to a different institute's catalog."));
      }

      db.prepare(
        `UPDATE projects
           SET theme_id = ?, theme_confirmed_by = ?, theme_confirmed_by_name = ?,
               theme_confirmed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      ).run(theme.id, req.user.id, req.user.full_name, req.project.id);

      recordAudit(req, {
        action: 'PROJECT_THEME_ASSIGNED', entityType: 'project', entityId: req.project.id,
        instituteId: req.project.institute_id, detail: { themeId: theme.id, themeCode: theme.code },
      });

      res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id) });
    } catch (error) {
      next(error);
    }
  },
);

// --- Engine decomposition ----------------------------------------------------

projectsRouter.get('/:projectId/engines', withProject, (req, res) => {
  const engines = db
    .prepare(
      `SELECT e.*, m.display_name AS owner_display_name, m.team_identifier AS owner_team_identifier
       FROM project_engines e
       LEFT JOIN project_members m ON m.id = e.owner_member_id
       WHERE e.project_id = ? ORDER BY e.code`,
    )
    .all(req.project.id);
  const dependencies = db
    .prepare('SELECT * FROM project_engine_dependencies WHERE project_id = ?')
    .all(req.project.id);
  res.json({ engines, dependencies });
});

// Handbook Sec 1.9 "Engine Definition & Readiness Template" (13 fields).
// engineName/coreResponsibility/primaryCourse/owner map onto name/
// responsibility/primaryCourse/ownerMemberId; the remaining template
// fields (inputs, outputs, internal state, algorithm/mechanism, interface,
// dependencies, KPI, failure case, validation) are each their own column.
const engineSchema = z.object({
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(3).max(160),
  primaryCourse: text(80).optional(),
  responsibility: z.string().trim().min(10).max(1000),
  inputs: text(1000).optional(),
  outputs: text(1000).optional(),
  internalState: text(1000).optional(),
  algorithmMechanism: text(2000).optional(),
  interfaceSpec: text(2000).optional(),
  dependenciesNote: text(1000).optional(),
  kpiTarget: text(500).optional(),
  failureCase: text(1000).optional(),
  validationMethod: text(1000).optional(),
  ownerMemberId: z.string().min(1).max(64).optional(),
});

const ENGINE_TEMPLATE_COLUMNS = {
  primaryCourse: 'primary_course', inputs: 'inputs', outputs: 'outputs',
  internalState: 'internal_state', algorithmMechanism: 'algorithm_mechanism',
  interfaceSpec: 'interface_spec', dependenciesNote: 'dependencies_note',
  kpiTarget: 'kpi_target', failureCase: 'failure_case', validationMethod: 'validation_method',
};

/**
 * Handbook Sec 1.9.1's 8-point validity test, as far as it can be checked
 * from stored fields rather than a guide's live judgement: clear inputs
 * and outputs, a stated algorithm/mechanism, a defined interface, a
 * measurable KPI and at least one named failure case. An engine may be
 * PROPOSED without all of these (a student's first draft), but cannot be
 * APPROVED - and therefore cannot count toward gate readiness - without
 * them.
 */
function engineMeetsApprovalBar(row) {
  return Boolean(
    row.inputs && row.outputs && row.algorithm_mechanism && row.interface_spec
    && row.kpi_target && row.failure_case && row.owner_member_id,
  );
}

projectsRouter.post(
  '/:projectId/engines',
  withProject,
  requireGuideAllocated,
  validate(engineSchema),
  (req, res, next) => {
    try {
      const canManage = req.projectPermissions.has('project:manage_engines');
      const canPropose = req.projectPermissions.has('engine:propose');
      if (!canManage && !canPropose) return next(forbidden('You may not propose or create engines on this project.'));
      if (!req.project.theme_id) {
        return next(conflict('This project has no confirmed theme yet - engines are decomposed from the theme.'));
      }

      const v = req.valid;
      let ownerMemberId = v.ownerMemberId ?? null;

      if (canManage) {
        if (ownerMemberId) {
          const owner = db
            .prepare("SELECT * FROM project_members WHERE id = ? AND project_id = ? AND member_role = 'STUDENT'")
            .get(ownerMemberId, req.project.id);
          if (!owner) return next(badRequest('ownerMemberId must be an active student on this project.'));
        }
      } else {
        // A student may only propose an engine that names themselves as owner.
        const self = db
          .prepare(
            "SELECT id FROM project_members WHERE project_id = ? AND user_id = ? AND member_role = 'STUDENT' AND status = 'APPROVED'",
          )
          .get(req.project.id, req.user.id);
        if (!self) return next(forbidden('You are not an approved student member of this project.'));
        ownerMemberId = self.id;
      }

      if (db.prepare('SELECT 1 FROM project_engines WHERE project_id = ? AND code = ?').get(req.project.id, v.code)) {
        return next(badRequest(`Engine code "${v.code}" is already used on this project.`));
      }

      const id = newId('eng');
      const draft = {
        inputs: v.inputs ?? null, outputs: v.outputs ?? null,
        algorithm_mechanism: v.algorithmMechanism ?? null, interface_spec: v.interfaceSpec ?? null,
        kpi_target: v.kpiTarget ?? null, failure_case: v.failureCase ?? null, owner_member_id: ownerMemberId,
      };
      // A guide/coordinator creating an engine directly still only gets an
      // immediate APPROVED status if the validity-test fields are actually
      // filled in - otherwise it is saved as PROPOSED so it can be
      // completed and approved afterwards, same as a student's proposal.
      const status = canManage && engineMeetsApprovalBar(draft) ? 'APPROVED' : 'PROPOSED';

      db.prepare(
        `INSERT INTO project_engines
           (id, project_id, institute_id, code, name, primary_course, responsibility, inputs, outputs,
            internal_state, algorithm_mechanism, interface_spec, dependencies_note, kpi_target,
            failure_case, validation_method, owner_member_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, req.project.id, req.project.institute_id, v.code, v.name, v.primaryCourse ?? null,
        v.responsibility, v.inputs ?? null, v.outputs ?? null, v.internalState ?? null,
        v.algorithmMechanism ?? null, v.interfaceSpec ?? null, v.dependenciesNote ?? null,
        v.kpiTarget ?? null, v.failureCase ?? null, v.validationMethod ?? null, ownerMemberId, status,
      );
      if (status === 'APPROVED') {
        db.prepare('UPDATE project_engines SET approved_by = ?, approved_by_name = ?, approved_at = datetime(\'now\') WHERE id = ?')
          .run(req.user.id, req.user.full_name, id);
      }

      recordAudit(req, {
        action: 'ENGINE_CREATED', entityType: 'project_engine', entityId: id,
        instituteId: req.project.institute_id, detail: { projectId: req.project.id, code: v.code },
      });

      res.status(201).json({ engine: db.prepare('SELECT * FROM project_engines WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const engineUpdateSchema = z.object({
  status: z.enum(['PROPOSED', 'APPROVED', 'IN_PROGRESS', 'VALIDATED']).optional(),
  name: z.string().trim().min(3).max(160).optional(),
  primaryCourse: text(80).optional(),
  responsibility: z.string().trim().min(10).max(1000).optional(),
  inputs: text(1000).optional(),
  outputs: text(1000).optional(),
  internalState: text(1000).optional(),
  algorithmMechanism: text(2000).optional(),
  interfaceSpec: text(2000).optional(),
  dependenciesNote: text(1000).optional(),
  kpiTarget: text(500).optional(),
  failureCase: text(1000).optional(),
  validationMethod: text(1000).optional(),
  ownerMemberId: z.string().min(1).max(64).optional(),
});

/** Engine Approval Template lifecycle - only the guide/coordinator/admins may move an engine's status. */
projectsRouter.patch(
  '/:projectId/engines/:engineId',
  withProject,
  requireProjectPermission('project:manage_engines'),
  validate(engineUpdateSchema),
  (req, res, next) => {
    try {
      const engine = db.prepare('SELECT * FROM project_engines WHERE id = ? AND project_id = ?').get(req.params.engineId, req.project.id);
      if (!engine) return next(notFoundOrDenied());

      const v = req.valid;
      if (v.ownerMemberId) {
        const owner = db
          .prepare("SELECT id FROM project_members WHERE id = ? AND project_id = ? AND member_role = 'STUDENT'")
          .get(v.ownerMemberId, req.project.id);
        if (!owner) return next(badRequest('ownerMemberId must be an active student on this project.'));
      }

      const columns = { name: 'name', responsibility: 'responsibility', ...ENGINE_TEMPLATE_COLUMNS };
      const updates = [];
      const params = [];
      for (const [key, column] of Object.entries(columns)) {
        if (v[key] === undefined) continue;
        updates.push(`${column} = ?`);
        params.push(v[key]);
      }
      if (v.status && v.status !== engine.status) {
        if (v.status === 'APPROVED' && engine.status === 'PROPOSED') {
          const afterUpdate = { ...engine, ...Object.fromEntries(
            Object.entries(columns).filter(([key]) => v[key] !== undefined).map(([key, column]) => [column, v[key]]),
          ) };
          if (!engineMeetsApprovalBar(afterUpdate)) {
            return next(badRequest(
              'This engine cannot be approved yet - inputs, outputs, algorithm/mechanism, interface, ' +
              'KPI target, failure case and a named student owner are all required first ' +
              '(Handbook Sec 1.9.1, the engine validity test).',
            ));
          }
          updates.push('approved_by = ?', 'approved_by_name = ?', "approved_at = datetime('now')");
          params.push(req.user.id, req.user.full_name);
        }
        updates.push('status = ?');
        params.push(v.status);
      }
      if (!updates.length) return res.json({ engine });

      updates.push("updated_at = datetime('now')");
      params.push(engine.id);
      db.prepare(`UPDATE project_engines SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      recordAudit(req, {
        action: 'ENGINE_UPDATED', entityType: 'project_engine', entityId: engine.id,
        instituteId: req.project.institute_id, detail: { fields: Object.keys(v) },
      });

      res.json({ engine: db.prepare('SELECT * FROM project_engines WHERE id = ?').get(engine.id) });
    } catch (error) {
      next(error);
    }
  },
);

const dependencySchema = z.object({
  dependsOnEngineId: z.string().min(1).max(64),
  note: text(500).optional(),
});

/** Feeds the "Engine Dependency Graph" that sprint sequencing walks in topological order. */
projectsRouter.post(
  '/:projectId/engines/:engineId/dependencies',
  withProject,
  requireProjectPermission('project:manage_engines'),
  validate(dependencySchema),
  (req, res, next) => {
    try {
      const engine = db.prepare('SELECT * FROM project_engines WHERE id = ? AND project_id = ?').get(req.params.engineId, req.project.id);
      if (!engine) return next(notFoundOrDenied());
      const dependsOn = db
        .prepare('SELECT * FROM project_engines WHERE id = ? AND project_id = ?')
        .get(req.valid.dependsOnEngineId, req.project.id);
      if (!dependsOn) return next(badRequest('dependsOnEngineId must be another engine on this project.'));
      if (dependsOn.id === engine.id) return next(badRequest('An engine cannot depend on itself.'));

      // Cycle guard: walk forward from dependsOn:  if that walk can already
      // reach `engine`, adding engine -> dependsOn would close a loop.
      const edges = db.prepare('SELECT engine_id, depends_on_engine_id FROM project_engine_dependencies WHERE project_id = ?').all(req.project.id);
      const adjacency = new Map();
      for (const edge of edges) {
        if (!adjacency.has(edge.engine_id)) adjacency.set(edge.engine_id, []);
        adjacency.get(edge.engine_id).push(edge.depends_on_engine_id);
      }
      const stack = [dependsOn.id];
      const seen = new Set();
      while (stack.length) {
        const current = stack.pop();
        if (current === engine.id) {
          return next(badRequest('That dependency would create a cycle in the engine dependency graph.'));
        }
        if (seen.has(current)) continue;
        seen.add(current);
        for (const next_ of adjacency.get(current) ?? []) stack.push(next_);
      }

      const id = newId('edp');
      db.prepare(
        'INSERT INTO project_engine_dependencies (id, project_id, engine_id, depends_on_engine_id, note) VALUES (?, ?, ?, ?, ?)',
      ).run(id, req.project.id, engine.id, dependsOn.id, req.valid.note ?? null);

      recordAudit(req, {
        action: 'ENGINE_DEPENDENCY_ADDED', entityType: 'project_engine', entityId: engine.id,
        instituteId: req.project.institute_id, detail: { dependsOnEngineId: dependsOn.id },
      });

      res.status(201).json({ dependency: db.prepare('SELECT * FROM project_engine_dependencies WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

projectsRouter.delete(
  '/:projectId/engines/:engineId/dependencies/:dependencyId',
  withProject,
  requireProjectPermission('project:manage_engines'),
  (req, res, next) => {
    try {
      const dependency = db
        .prepare('SELECT * FROM project_engine_dependencies WHERE id = ? AND engine_id = ? AND project_id = ?')
        .get(req.params.dependencyId, req.params.engineId, req.project.id);
      if (!dependency) return next(notFoundOrDenied());
      db.prepare('DELETE FROM project_engine_dependencies WHERE id = ?').run(dependency.id);
      recordAudit(req, {
        action: 'ENGINE_DEPENDENCY_REMOVED', entityType: 'project_engine', entityId: req.params.engineId,
        instituteId: req.project.institute_id,
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

// --- Gate reviews (formal, Reviewer-run Gate 0-4 checkpoints) ---------------

/**
 * The gate catalog merged with this project's progress: for each gate, its
 * latest attempt (if any) and whether the previous gate has been passed, so
 * the UI can show a locked/unlocked gate ladder without recomputing it.
 */
function rubricCriteriaFor(gateId) {
  return db
    .prepare('SELECT * FROM gate_rubric_criteria WHERE gate_id = ? ORDER BY sequence')
    .all(gateId)
    .map((row) => ({ ...row, level_descriptors: row.level_descriptors ? JSON.parse(row.level_descriptors) : null }));
}

projectsRouter.get('/:projectId/gates', withProject, (req, res) => {
  const gates = db.prepare('SELECT * FROM gates ORDER BY sequence').all();
  const attempts = db
    .prepare(
      `SELECT * FROM project_gate_reviews WHERE project_id = ?
       ORDER BY gate_id, attempt_number DESC`,
    )
    .all(req.project.id);

  const latestByGate = new Map();
  for (const attempt of attempts) {
    if (!latestByGate.has(attempt.gate_id)) latestByGate.set(attempt.gate_id, attempt);
  }

  let previousPassed = true; // Gate 0 is always open to attempt.
  const result = gates.map((gate) => {
    const latest = latestByGate.get(gate.id) ?? null;
    const unlocked = previousPassed;
    previousPassed = latest ? latest.next_gate_unlocked === 1 : false;
    return {
      ...gate,
      course_outcomes: JSON.parse(gate.course_outcomes),
      criteria: rubricCriteriaFor(gate.id),
      latestAttempt: latest,
      unlocked,
    };
  });

  res.json({ gates: result, guideAllocated: hasApprovedGuide(req.project.id) });
});

projectsRouter.get('/:projectId/gates/:gateId/reviews', withProject, (req, res) => {
  const reviews = db
    .prepare('SELECT * FROM project_gate_reviews WHERE project_id = ? AND gate_id = ? ORDER BY attempt_number')
    .all(req.project.id, req.params.gateId);
  const scores = db
    .prepare(
      `SELECT sc.*, m.display_name, m.team_identifier
       FROM project_gate_review_scores sc
       JOIN project_gate_reviews gr ON gr.id = sc.gate_review_id
       LEFT JOIN project_members m ON m.id = sc.member_id
       WHERE gr.project_id = ? AND gr.gate_id = ?`,
    )
    .all(req.project.id, req.params.gateId)
    .map((row) => ({ ...row, criterion_ratings: JSON.parse(row.criterion_ratings) }));
  const evidence = db
    .prepare(
      `SELECT ev.* FROM project_gate_evidence ev
       JOIN project_gate_reviews gr ON gr.id = ev.gate_review_id
       WHERE gr.project_id = ? AND gr.gate_id = ?`,
    )
    .all(req.project.id, req.params.gateId);
  res.json({ reviews, scores, evidence });
});

// Handbook: "Team Decision: Pass / Resubmit" on the Phase Assessment Sheet -
// there is no separate FAIL or CONDITIONAL_PASS; a team resubmits corrected
// evidence rather than failing a semester's mini project outright.
const gateReviewSchema = z.object({
  decision: z.enum(['PASS', 'RESUBMIT']),
  comments: z.string().trim().min(10).max(4000),
  // "5 MARKS PER STUDENT": one entry per student on the team, each scored
  // against every one of this gate's rubric criteria (0-5).
  studentScores: z
    .array(
      z.object({
        memberId: z.string().min(1).max(64),
        criterionRatings: z.record(z.string(), z.number().int().min(0).max(5)),
        vivaNotes: text(1000).optional(),
      }),
    )
    .min(1)
    .max(8),
  evidence: z
    .array(
      z.object({
        stageId: z.string().max(8).optional(),
        checklistItem: z.string().trim().min(1).max(200),
        evidenceRefType: z.enum(['ATTACHMENT', 'REPOSITORY_LINK', 'PROGRESS_SUBMISSION', 'TEXT_NOTE']).default('TEXT_NOTE'),
        evidenceRefId: z.string().max(64).optional(),
        note: text(1000).optional(),
      }),
    )
    .max(30)
    .optional(),
});

/**
 * Conducts a formal Gate review. Requires the previous gate to already be
 * PASS (gates open in sequence), and requires at least one APPROVED engine
 * with a student owner on record - a gate cannot evidence work that has no
 * owner of record (Handbook Sec 1.9.1, validity test #8). Marks are
 * recorded per student, against the gate's declared rubric criteria - a
 * criterion named in studentScores that isn't one of this gate's actual
 * criteria is rejected, same principle as scheduled_reviews validating
 * scores against a rubric's declared criteria.
 */
projectsRouter.post(
  '/:projectId/gates/:gateId/reviews',
  withProject,
  requireProjectPermission('project:conduct_gate_review'),
  requireGuideAllocated,
  validate(gateReviewSchema),
  (req, res, next) => {
    try {
      const gate = db.prepare('SELECT * FROM gates WHERE id = ?').get(req.params.gateId);
      if (!gate) return next(notFoundOrDenied());

      const hasOwnedEngine = db
        .prepare(
          `SELECT 1 FROM project_engines
           WHERE project_id = ? AND owner_member_id IS NOT NULL AND status IN ('APPROVED', 'IN_PROGRESS', 'VALIDATED')`,
        )
        .get(req.project.id);
      if (!hasOwnedEngine) {
        return next(conflict('This project has no approved, student-owned engine yet - a gate review needs at least one.'));
      }

      if (gate.sequence > 0) {
        const previousGate = db.prepare('SELECT * FROM gates WHERE sequence = ?').get(gate.sequence - 1);
        const previousLatest = db
          .prepare('SELECT * FROM project_gate_reviews WHERE project_id = ? AND gate_id = ? ORDER BY attempt_number DESC LIMIT 1')
          .get(req.project.id, previousGate.id);
        if (!previousLatest || previousLatest.next_gate_unlocked !== 1) {
          return next(conflict(`${previousGate.name} must be passed before ${gate.name} can be attempted.`));
        }
      }

      const v = req.valid;
      const criteria = rubricCriteriaFor(gate.id);
      const criteriaByName = new Map(criteria.map((c) => [c.criterion_name, c.weight_marks]));

      // Validate every student and every criterion before writing anything.
      const memberIds = new Set();
      for (const entry of v.studentScores) {
        if (memberIds.has(entry.memberId)) return next(badRequest('Each student may only be scored once per gate review.'));
        memberIds.add(entry.memberId);
        const member = db
          .prepare("SELECT id FROM project_members WHERE id = ? AND project_id = ? AND member_role = 'STUDENT'")
          .get(entry.memberId, req.project.id);
        if (!member) return next(badRequest(`${entry.memberId} is not a student member of this project.`));
        for (const name of Object.keys(entry.criterionRatings)) {
          if (!criteriaByName.has(name)) {
            return next(badRequest(`"${name}" is not one of ${gate.name}'s rubric criteria.`));
          }
        }
        for (const name of criteriaByName.keys()) {
          if (!(name in entry.criterionRatings)) {
            return next(badRequest(`A rating for "${name}" is required for every scored student.`));
          }
        }
      }

      const previousAttempts = db
        .prepare('SELECT MAX(attempt_number) AS n FROM project_gate_reviews WHERE project_id = ? AND gate_id = ?')
        .get(req.project.id, gate.id);
      if (previousAttempts?.n) {
        const lastDecision = db
          .prepare('SELECT decision FROM project_gate_reviews WHERE project_id = ? AND gate_id = ? AND attempt_number = ?')
          .get(req.project.id, gate.id, previousAttempts.n)?.decision;
        if (lastDecision === 'PASS') {
          return next(conflict('This gate has already been passed and its decided attempt cannot be repeated.'));
        }
      }
      const attemptNumber = (previousAttempts?.n ?? 0) + 1;

      const id = newId('gtr');
      const unlocked = v.decision === 'PASS' ? 1 : 0;

      db.transaction(() => {
        db.prepare(
          `INSERT INTO project_gate_reviews
             (id, project_id, institute_id, gate_id, attempt_number, reviewer_user_id, reviewer_name,
              decision, max_marks, comments, next_gate_unlocked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, req.project.id, req.project.institute_id, gate.id, attemptNumber, req.user.id, req.user.full_name,
          v.decision, gate.marks_weight, v.comments, unlocked,
        );

        const insertScore = db.prepare(
          `INSERT INTO project_gate_review_scores (id, gate_review_id, member_id, criterion_ratings, marks_awarded, viva_notes)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const entry of v.studentScores) {
          // (rating / 5) * weight per criterion, summed - the formula given
          // on the Gate 0 Assessment Rubric, applied generically.
          const marks = Object.entries(entry.criterionRatings)
            .reduce((sum, [name, rating]) => sum + (rating / 5) * criteriaByName.get(name), 0);
          insertScore.run(
            newId('gsc'), id, entry.memberId, JSON.stringify(entry.criterionRatings),
            Math.round(marks * 100) / 100, entry.vivaNotes ?? null,
          );
        }

        const insertEvidence = db.prepare(
          `INSERT INTO project_gate_evidence
             (id, gate_review_id, stage_id, checklist_item, evidence_ref_type, evidence_ref_id, note, submitted_by, submitted_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of v.evidence ?? []) {
          insertEvidence.run(
            newId('gev'), id, item.stageId ?? null, item.checklistItem, item.evidenceRefType,
            item.evidenceRefId ?? null, item.note ?? null, req.user.id, req.user.full_name,
          );
        }
      })();

      touchProject(req.project.id);
      recordAudit(req, {
        action: 'GATE_REVIEW_CONDUCTED', entityType: 'project_gate_review', entityId: id,
        instituteId: req.project.institute_id,
        detail: { projectId: req.project.id, gateId: gate.id, decision: v.decision, attemptNumber, studentsScored: v.studentScores.length },
      });

      res.status(201).json({
        gateReview: db.prepare('SELECT * FROM project_gate_reviews WHERE id = ?').get(id),
        scores: db.prepare('SELECT * FROM project_gate_review_scores WHERE gate_review_id = ?').all(id)
          .map((row) => ({ ...row, criterion_ratings: JSON.parse(row.criterion_ratings) })),
      });
    } catch (error) {
      next(error);
    }
  },
);

// --- Weekly check-ins (informal, guide-run process-discipline log) ---------

projectsRouter.get('/:projectId/weekly-checkins', withProject, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM project_weekly_checkins WHERE project_id = ? ORDER BY checkin_date DESC')
    .all(req.project.id);
  res.json({ checkins: rows.map((r) => ({ ...r, flags: r.flags ? JSON.parse(r.flags) : [] })) });
});

const checkinSchema = z.object({
  stageId: z.string().max(8).optional(),
  gitCommitsReviewed: text(1000).optional(),
  processDisciplineNotes: text(2000).optional(),
  flags: z.array(z.enum(['BULK_COMMIT', 'POST_DATED_DOC', 'UNDOCUMENTED_DESIGN_CHANGE'])).max(10).optional(),
});

projectsRouter.post(
  '/:projectId/weekly-checkins',
  withProject,
  requireProjectPermission('project:log_checkin'),
  requireGuideAllocated,
  validate(checkinSchema),
  (req, res, next) => {
    try {
      // Only the project's own current guide logs a check-in on it (unless staff/admin).
      const isCurrentGuide = db
        .prepare(
          `SELECT 1 FROM project_members
           WHERE project_id = ? AND user_id = ? AND member_role = 'FACULTY_MENTOR' AND status = 'APPROVED' AND is_active = 1`,
        )
        .get(req.project.id, req.user.id);
      if (!isCurrentGuide && !req.projectPermissions.has('project:assign_guide') && !req.scope.isPlatformAdmin) {
        return next(forbidden('Only this project\'s current guide may log a weekly check-in.'));
      }

      const v = req.valid;
      const id = newId('chk');
      db.prepare(
        `INSERT INTO project_weekly_checkins
           (id, project_id, institute_id, guide_user_id, guide_name, stage_id,
            git_commits_reviewed, process_discipline_notes, flags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, req.project.id, req.project.institute_id, req.user.id, req.user.full_name, v.stageId ?? null,
        v.gitCommitsReviewed ?? null, v.processDisciplineNotes ?? null, v.flags ? JSON.stringify(v.flags) : null,
      );

      recordAudit(req, {
        action: 'WEEKLY_CHECKIN_LOGGED', entityType: 'project_weekly_checkin', entityId: id,
        instituteId: req.project.institute_id, detail: { projectId: req.project.id },
      });

      const row = db.prepare('SELECT * FROM project_weekly_checkins WHERE id = ?').get(id);
      res.status(201).json({ checkin: { ...row, flags: row.flags ? JSON.parse(row.flags) : [] } });
    } catch (error) {
      next(error);
    }
  },
);
