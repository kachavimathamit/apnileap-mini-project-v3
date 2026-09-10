import { db } from '../db/connection.js';
import { config } from '../config.js';

/**
 * RAG status model (requirement 6) and the governance rules around transitions.
 *
 * The mentor may PROPOSE a status. Definitions and the evidence required for a
 * transition are identical across institutes, and the return path out of Red is
 * deliberately hard: evidence plus approval by a role holding `status:approve`.
 */

export const RAG_STATUSES = ['GREEN', 'YELLOW', 'RED'];

export const RAG_DEFINITIONS = {
  GREEN: {
    label: 'On Track',
    criteria:
      'Milestones on schedule; no critical blocker; required reviews completed; quality expectations met; no overdue high-priority action.',
    response: 'Normal monitoring.',
  },
  YELLOW: {
    label: 'At Risk',
    criteria:
      'A milestone is at risk; a moderate technical or resource issue exists; guidance is required; one or more KPIs are below target.',
    response: 'Corrective action with a named owner and due date.',
  },
  RED: {
    label: 'Intervention Required',
    criteria:
      'A critical milestone is missed; no viable path is available; a major dependency is absent; learning outcomes cannot be demonstrated; a critical action is overdue.',
    response: 'Immediate review and escalation.',
  },
};

/**
 * Checks whether a proposed status change is allowed for this actor and project.
 * Returns { allowed, code, message } - never throws, so callers can audit the
 * refusal before responding.
 */
export function evaluateStatusTransition({ project, newStatus, evidence, permissions }) {
  const previous = project.rag_status;

  if (!RAG_STATUSES.includes(newStatus)) {
    return { allowed: false, code: 'INVALID_STATUS', message: 'Unknown status value.' };
  }

  if (newStatus === previous) {
    return { allowed: false, code: 'NO_CHANGE', message: `The project is already ${previous}.` };
  }

  const canPropose = permissions.has('status:propose');
  const canApprove = permissions.has('status:approve');

  if (!canPropose && !canApprove) {
    return {
      allowed: false,
      code: 'NOT_PERMITTED',
      message: 'Your role does not allow you to change project status.',
    };
  }

  // Requirement 5.6.6 / acceptance criteria: a Red project cannot return to Green
  // without evidence of resolution AND approval by an authorized reviewer.
  if (previous === 'RED' && newStatus === 'GREEN') {
    if (!canApprove) {
      return {
        allowed: false,
        code: 'APPROVAL_REQUIRED',
        message:
          'A Red project can only be returned to Green by an authorized reviewer. Propose Yellow, or request a review.',
      };
    }
    if (!evidence || evidence.trim().length < 20) {
      return {
        allowed: false,
        code: 'EVIDENCE_REQUIRED',
        message:
          'Evidence of resolution is required to move a Red project to Green. Describe what was resolved and how it was verified (at least 20 characters).',
      };
    }

    const blockers = openBlockers(project.id);
    if (blockers.criticalIssues > 0) {
      return {
        allowed: false,
        code: 'OPEN_CRITICAL_ISSUES',
        message: `${blockers.criticalIssues} high or critical challenge(s) are still open. Resolve them before returning the project to Green.`,
      };
    }
    if (blockers.overdueActions > 0) {
      return {
        allowed: false,
        code: 'OVERDUE_ACTIONS',
        message: `${blockers.overdueActions} corrective action(s) are overdue. Close them before returning the project to Green.`,
      };
    }
  }

  // Any move to Green needs a rationale trail; moves into Red need none beyond the
  // mandatory rationale field, because raising an alarm should never be obstructed.
  return { allowed: true, requiresApproval: previous === 'RED' && newStatus === 'GREEN' };
}

export function openBlockers(projectId) {
  const criticalIssues = db
    .prepare(
      `SELECT COUNT(*) AS n FROM issues
       WHERE project_id = ? AND severity IN ('HIGH', 'CRITICAL')
         AND status NOT IN ('VERIFIED', 'CLOSED')`,
    )
    .get(projectId).n;

  const overdueActions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM corrective_actions
       WHERE project_id = ? AND status IN ('OPEN', 'IN_PROGRESS')
         AND date(due_date) < date('now')`,
    )
    .get(projectId).n;

  return { criticalIssues, overdueActions };
}

/**
 * A non-binding recommendation shown next to the human-declared status. Phase 4
 * of the delivery plan may automate this; today it only informs the reviewer, who
 * remains accountable for the recorded status.
 */
export function recommendStatus(projectId) {
  const reasons = [];
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;

  const { criticalIssues, overdueActions } = openBlockers(projectId);

  const missedCritical = db
    .prepare(
      `SELECT COUNT(*) AS n FROM milestones
       WHERE project_id = ? AND is_critical = 1 AND status = 'MISSED'`,
    )
    .get(projectId).n;

  const atRiskMilestones = db
    .prepare(
      `SELECT COUNT(*) AS n FROM milestones
       WHERE project_id = ? AND status IN ('UPCOMING', 'CURRENT')
         AND planned_date IS NOT NULL AND date(planned_date) < date('now')`,
    )
    .get(projectId).n;

  const kpisBelowTarget = db
    .prepare(
      `SELECT COUNT(*) AS n FROM kpis k
       WHERE k.project_id = ?
         AND EXISTS (
           SELECT 1 FROM kpi_measurements m
           WHERE m.kpi_id = k.id AND m.meets_target = 0
             AND m.measurement_date = (
               SELECT MAX(m2.measurement_date) FROM kpi_measurements m2 WHERE m2.kpi_id = k.id
             )
         )`,
    )
    .get(projectId).n;

  let recommended = 'GREEN';

  if (missedCritical > 0) {
    recommended = 'RED';
    reasons.push(`${missedCritical} critical milestone(s) missed`);
  }
  if (criticalIssues > 0) {
    recommended = 'RED';
    reasons.push(`${criticalIssues} high/critical challenge(s) open`);
  }
  if (overdueActions > 0) {
    recommended = 'RED';
    reasons.push(`${overdueActions} corrective action(s) overdue`);
  }

  if (recommended !== 'RED') {
    if (atRiskMilestones > 0) {
      recommended = 'YELLOW';
      reasons.push(`${atRiskMilestones} milestone(s) past planned date`);
    }
    if (kpisBelowTarget > 0) {
      recommended = 'YELLOW';
      reasons.push(`${kpisBelowTarget} KPI(s) below target`);
    }
    if (isStale(project)) {
      recommended = 'YELLOW';
      reasons.push(`not updated in over ${config.staleProjectDays} days`);
    }
  }

  return {
    recommended,
    declared: project.rag_status,
    agrees: recommended === project.rag_status,
    reasons,
    note: 'Advisory only. The reviewer who records the status remains accountable for it.',
  };
}

export function isStale(project) {
  const last = new Date(`${project.last_update_at.replace(' ', 'T')}Z`);
  const ageDays = (Date.now() - last.getTime()) / 86_400_000;
  return ageDays > config.staleProjectDays;
}
