import { db } from '../db/connection.js';
import { config } from '../config.js';
import { instituteScopeSql, departmentScopeSql, projectScopeSql } from './accessScope.js';

/**
 * Every read in this module composes the caller's scope predicate into the SQL.
 * There is deliberately no "fetch everything then filter in JavaScript" path.
 */

const RAG_ZERO = { GREEN: 0, YELLOW: 0, RED: 0 };

function ragCounts(rows) {
  const counts = { ...RAG_ZERO };
  for (const row of rows) counts[row.rag_status] = row.n;
  return counts;
}

function withPercentages(counts) {
  const total = counts.GREEN + counts.YELLOW + counts.RED;
  const pct = (n) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    counts,
    total,
    percentages: { GREEN: pct(counts.GREEN), YELLOW: pct(counts.YELLOW), RED: pct(counts.RED) },
  };
}

export function listInstitutes(scope) {
  const scoped = instituteScopeSql(scope, 'i');
  const projectScope = projectScopeSql(scope, 'p');
  return db
    .prepare(
      `SELECT i.id, i.code, i.name, i.short_name, i.city,
              (SELECT COUNT(*) FROM departments d
                WHERE d.institute_id = i.id AND d.is_active = 1) AS department_count,
              (SELECT COUNT(*) FROM projects p
                WHERE p.institute_id = i.id AND p.is_archived = 0 AND ${projectScope.sql}) AS project_count,
              (SELECT COUNT(*) FROM projects p
                WHERE p.institute_id = i.id AND p.is_archived = 0 AND p.rag_status = 'RED'
                  AND ${projectScope.sql}) AS red_count
       FROM institutes i
       WHERE i.is_active = 1 AND ${scoped.sql}
       ORDER BY i.short_name`,
    )
    .all(...projectScope.params, ...projectScope.params, ...scoped.params);
}

/** Programme-level roll-up across every institute the user is authorized for. */
export function programmeSummary(scope) {
  const projectScope = projectScopeSql(scope, 'p');
  const rows = db
    .prepare(
      `SELECT p.rag_status, COUNT(*) AS n
       FROM projects p
       WHERE p.is_archived = 0 AND ${projectScope.sql}
       GROUP BY p.rag_status`,
    )
    .all(...projectScope.params);

  const institutes = listInstitutes(scope);
  return {
    institutes: institutes.length,
    ...withPercentages(ragCounts(rows)),
    instituteBreakdown: institutes.map((i) => ({
      instituteId: i.id,
      shortName: i.short_name,
      name: i.name,
      projects: i.project_count,
      red: i.red_count,
    })),
  };
}

export function instituteDashboard(scope, instituteId) {
  const projectScope = projectScopeSql(scope, 'p');
  const params = [instituteId, ...projectScope.params];

  const institute = db.prepare('SELECT * FROM institutes WHERE id = ?').get(instituteId);

  const statusRows = db
    .prepare(
      `SELECT p.rag_status, COUNT(*) AS n FROM projects p
       WHERE p.institute_id = ? AND p.is_archived = 0 AND ${projectScope.sql}
       GROUP BY p.rag_status`,
    )
    .all(...params);

  const departmentScope = departmentScopeSql(scope, 'd');
  const departmentCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM departments d
       WHERE d.institute_id = ? AND d.is_active = 1 AND ${departmentScope.sql}`,
    )
    .get(instituteId, ...departmentScope.params).n;

  const single = (sql, extra = []) => db.prepare(sql).get(...params, ...extra).n;

  const awaitingReview = single(
    `SELECT COUNT(*) AS n FROM projects p
     WHERE p.institute_id = ? AND p.is_archived = 0 AND ${projectScope.sql}
       AND (p.last_review_at IS NULL
            OR (p.next_review_date IS NOT NULL AND date(p.next_review_date) <= date('now')))`,
  );

  const overdueActions = single(
    `SELECT COUNT(DISTINCT p.id) AS n FROM projects p
     JOIN corrective_actions a ON a.project_id = p.id
     WHERE p.institute_id = ? AND p.is_archived = 0 AND ${projectScope.sql}
       AND a.status IN ('OPEN', 'IN_PROGRESS') AND date(a.due_date) < date('now')`,
  );

  const staleProjects = single(
    `SELECT COUNT(*) AS n FROM projects p
     WHERE p.institute_id = ? AND p.is_archived = 0 AND ${projectScope.sql}
       AND julianday('now') - julianday(p.last_update_at) > ?`,
    [config.staleProjectDays],
  );

  const assistanceRequests = single(
    `SELECT COUNT(*) AS n FROM issues i
     JOIN projects p ON p.id = i.project_id
     WHERE p.institute_id = ? AND p.is_archived = 0 AND ${projectScope.sql}
       AND i.assistance_required IS NOT NULL AND TRIM(i.assistance_required) <> ''
       AND i.status NOT IN ('VERIFIED', 'CLOSED')`,
  );

  const upcomingMilestones = db
    .prepare(
      `SELECT m.id, m.title, m.planned_date, m.is_critical,
              p.id AS project_id, p.code AS project_code, p.title AS project_title
       FROM milestones m
       JOIN projects p ON p.id = m.project_id
       WHERE p.institute_id = ? AND p.is_archived = 0 AND ${projectScope.sql}
         AND m.status IN ('UPCOMING', 'CURRENT')
         AND m.planned_date IS NOT NULL
         AND date(m.planned_date) BETWEEN date('now') AND date('now', '+30 days')
       ORDER BY m.planned_date
       LIMIT 10`,
    )
    .all(...params);

  const departments = listDepartments(scope, instituteId);

  return {
    institute: institute
      ? { id: institute.id, code: institute.code, name: institute.name, shortName: institute.short_name, city: institute.city }
      : null,
    departmentCount,
    ...withPercentages(ragCounts(statusRows)),
    attention: {
      awaitingReview,
      overdueActions,
      staleProjects,
      assistanceRequests,
      staleThresholdDays: config.staleProjectDays,
    },
    upcomingMilestones,
    departments,
    trend: instituteTrend(scope, instituteId),
  };
}

/**
 * Status distribution at four weekly checkpoints, reconstructed from
 * status_history so the trend reflects what was actually recorded at the time.
 */
export function instituteTrend(scope, instituteId, weeks = 4) {
  const projectScope = projectScopeSql(scope, 'p');
  const points = [];

  for (let i = weeks - 1; i >= 0; i -= 1) {
    const offset = `-${i * 7} days`;
    const rows = db
      .prepare(
        `SELECT COALESCE(
                  (SELECT h.new_status FROM status_history h
                    WHERE h.project_id = p.id AND h.changed_at <= datetime('now', ?)
                    ORDER BY h.changed_at DESC LIMIT 1),
                  'GREEN') AS status,
                COUNT(*) AS n
         FROM projects p
         WHERE p.institute_id = ? AND p.is_archived = 0
           AND date(p.created_at) <= date('now', ?)
           AND ${projectScope.sql}
         GROUP BY status`,
      )
      .all(offset, instituteId, offset, ...projectScope.params);

    const counts = { ...RAG_ZERO };
    for (const row of rows) counts[row.status] = row.n;
    const date = new Date(Date.now() - i * 7 * 86_400_000).toISOString().slice(0, 10);
    points.push({ date, ...counts });
  }

  return points;
}

export function listDepartments(scope, instituteId) {
  const departmentScope = departmentScopeSql(scope, 'd');
  const projectScope = projectScopeSql(scope, 'p');

  return db
    .prepare(
      `SELECT d.id, d.code, d.name, d.institute_id,
              head.full_name AS head_name,
              coord.full_name AS coordinator_name,
              (SELECT COUNT(*) FROM projects p
                WHERE p.department_id = d.id AND p.is_archived = 0 AND ${projectScope.sql}) AS project_count,
              (SELECT COUNT(*) FROM projects p
                WHERE p.department_id = d.id AND p.is_archived = 0 AND p.rag_status = 'GREEN'
                  AND ${projectScope.sql}) AS green_count,
              (SELECT COUNT(*) FROM projects p
                WHERE p.department_id = d.id AND p.is_archived = 0 AND p.rag_status = 'YELLOW'
                  AND ${projectScope.sql}) AS yellow_count,
              (SELECT COUNT(*) FROM projects p
                WHERE p.department_id = d.id AND p.is_archived = 0 AND p.rag_status = 'RED'
                  AND ${projectScope.sql}) AS red_count
       FROM departments d
       LEFT JOIN users head  ON head.id  = d.head_user_id
       LEFT JOIN users coord ON coord.id = d.coordinator_user_id
       WHERE d.institute_id = ? AND d.is_active = 1 AND ${departmentScope.sql}
       ORDER BY d.name`,
    )
    .all(
      ...projectScope.params,
      ...projectScope.params,
      ...projectScope.params,
      ...projectScope.params,
      instituteId,
      ...departmentScope.params,
    );
}

const SORT_COLUMNS = {
  severity: `CASE p.rag_status WHEN 'RED' THEN 0 WHEN 'YELLOW' THEN 1 ELSE 2 END, p.last_update_at ASC`,
  oldest_update: 'p.last_update_at ASC',
  next_milestone: 'COALESCE(p.next_review_date, \'9999-12-31\') ASC',
  mentor: 'mentor_name ASC',
  name: 'p.title ASC',
  completion: 'p.completion_percentage ASC',
};

/**
 * Project list for a department (requirement 5.4) with the filter and sort
 * options the department dashboard offers.
 */
export function listProjects(scope, { departmentId, instituteId, filters = {}, sort = 'severity' } = {}) {
  const projectScope = projectScopeSql(scope, 'p');
  const clauses = ['p.is_archived = 0', projectScope.sql];
  const params = [...projectScope.params];

  if (departmentId) {
    clauses.push('p.department_id = ?');
    params.push(departmentId);
  }
  if (instituteId) {
    clauses.push('p.institute_id = ?');
    params.push(instituteId);
  }
  if (filters.status) {
    clauses.push('p.rag_status = ?');
    params.push(filters.status);
  }
  if (filters.semester) {
    clauses.push('p.semester = ?');
    params.push(filters.semester);
  }
  if (filters.academicYear) {
    clauses.push('p.academic_year = ?');
    params.push(filters.academicYear);
  }
  if (filters.mentorUserId) {
    clauses.push(
      `EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id
               AND pm.user_id = ? AND pm.member_role IN ('FACULTY_MENTOR','CO_MENTOR') AND pm.is_active = 1)`,
    );
    params.push(filters.mentorUserId);
  }
  if (filters.overdueActions) {
    clauses.push(
      `EXISTS (SELECT 1 FROM corrective_actions a WHERE a.project_id = p.id
               AND a.status IN ('OPEN','IN_PROGRESS') AND date(a.due_date) < date('now'))`,
    );
  }
  if (filters.stale) {
    clauses.push("julianday('now') - julianday(p.last_update_at) > ?");
    params.push(config.staleProjectDays);
  }
  if (filters.awaitingReview) {
    clauses.push(
      `(p.last_review_at IS NULL OR (p.next_review_date IS NOT NULL AND date(p.next_review_date) <= date('now')))`,
    );
  }
  if (filters.search) {
    clauses.push('(p.title LIKE ? OR p.code LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  const orderBy = SORT_COLUMNS[sort] ?? SORT_COLUMNS.severity;

  return db
    .prepare(
      `SELECT p.id, p.code, p.title, p.rag_status, p.rag_status_since, p.completion_percentage,
              p.last_update_at, p.last_review_at, p.next_review_date, p.is_archived,
              p.academic_year, p.semester, p.institute_id, p.department_id,
              d.name AS department_name, i.short_name AS institute_short_name,
              (SELECT COALESCE(pm.display_name, u.full_name)
                 FROM project_members pm LEFT JOIN users u ON u.id = pm.user_id
                WHERE pm.project_id = p.id AND pm.member_role = 'FACULTY_MENTOR' AND pm.is_active = 1
                LIMIT 1) AS mentor_name,
              (SELECT COUNT(*) FROM issues s
                WHERE s.project_id = p.id AND s.status NOT IN ('VERIFIED','CLOSED')) AS open_issues,
              (SELECT COUNT(*) FROM corrective_actions a
                WHERE a.project_id = p.id AND a.status IN ('OPEN','IN_PROGRESS')
                  AND date(a.due_date) < date('now')) AS overdue_actions,
              (julianday('now') - julianday(p.last_update_at)) > ${config.staleProjectDays} AS is_stale
       FROM projects p
       JOIN departments d ON d.id = p.department_id
       JOIN institutes i ON i.id = p.institute_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY ${orderBy}`,
    )
    .all(...params);
}

/** Distinct filter option values, restricted to the caller's scope. */
export function projectFilterOptions(scope, { departmentId, instituteId } = {}) {
  const projectScope = projectScopeSql(scope, 'p');
  const clauses = ['p.is_archived = 0', projectScope.sql];
  const params = [...projectScope.params];
  if (departmentId) {
    clauses.push('p.department_id = ?');
    params.push(departmentId);
  }
  if (instituteId) {
    clauses.push('p.institute_id = ?');
    params.push(instituteId);
  }
  const where = clauses.join(' AND ');

  const mentors = db
    .prepare(
      `SELECT DISTINCT pm.user_id AS id, COALESCE(pm.display_name, u.full_name) AS name
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       LEFT JOIN users u ON u.id = pm.user_id
       WHERE pm.member_role IN ('FACULTY_MENTOR','CO_MENTOR') AND pm.is_active = 1
         AND pm.user_id IS NOT NULL AND ${where}
       ORDER BY name`,
    )
    .all(...params);

  const semesters = db
    .prepare(`SELECT DISTINCT p.semester AS value FROM projects p WHERE ${where} ORDER BY value`)
    .all(...params)
    .map((r) => r.value);

  const academicYears = db
    .prepare(`SELECT DISTINCT p.academic_year AS value FROM projects p WHERE ${where} ORDER BY value DESC`)
    .all(...params)
    .map((r) => r.value);

  return { mentors, semesters, academicYears };
}

export function departmentDashboard(scope, department, { filters, sort } = {}) {
  const projects = listProjects(scope, { departmentId: department.id, filters, sort });
  const counts = { ...RAG_ZERO };
  for (const project of projects) counts[project.rag_status] += 1;

  const details = db
    .prepare(
      `SELECT d.*, head.full_name AS head_name, coord.full_name AS coordinator_name,
              i.short_name AS institute_short_name, i.name AS institute_name
       FROM departments d
       LEFT JOIN users head ON head.id = d.head_user_id
       LEFT JOIN users coord ON coord.id = d.coordinator_user_id
       JOIN institutes i ON i.id = d.institute_id
       WHERE d.id = ?`,
    )
    .get(department.id);

  return {
    department: {
      id: details.id,
      code: details.code,
      name: details.name,
      headName: details.head_name,
      coordinatorName: details.coordinator_name,
      instituteId: details.institute_id,
      instituteShortName: details.institute_short_name,
      instituteName: details.institute_name,
    },
    ...withPercentages(counts),
    projects,
    filterOptions: projectFilterOptions(scope, { departmentId: department.id }),
  };
}

/** Full project record (requirement 5.5). The project has already been scope-checked. */
export function projectDetail(project) {
  const id = project.id;
  const q = (sql) => db.prepare(sql).all(id);

  const context = db
    .prepare(
      `SELECT d.name AS department_name, d.code AS department_code,
              i.name AS institute_name, i.short_name AS institute_short_name,
              t.title AS theme_title, t.code AS theme_code
       FROM projects p
       JOIN departments d ON d.id = p.department_id
       JOIN institutes i ON i.id = p.institute_id
       LEFT JOIN project_themes t ON t.id = p.theme_id
       WHERE p.id = ?`,
    )
    .get(id);

  const members = q(
    `SELECT pm.id, pm.member_role, pm.team_identifier, pm.status, pm.approved_by_name, pm.approved_at,
            COALESCE(pm.display_name, u.full_name) AS name,
            u.email, u.id AS user_id
     FROM project_members pm
     LEFT JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND pm.is_active = 1
     ORDER BY CASE pm.member_role WHEN 'FACULTY_MENTOR' THEN 0 WHEN 'CO_MENTOR' THEN 1
                                  WHEN 'REVIEWER' THEN 2 ELSE 3 END, name`,
  );

  const milestones = q(
    `SELECT id, sequence, title, description, planned_date, actual_date, status, is_critical
     FROM milestones WHERE project_id = ? ORDER BY sequence, planned_date`,
  );

  const kpis = q(
    `SELECT k.id, k.name, k.definition, k.target_value, k.unit,
            COALESCE(k.accountable_name, u.full_name) AS accountable_name,
            m.measured_value AS latest_value, m.measurement_date AS latest_date,
            m.evidence AS latest_evidence, m.meets_target
     FROM kpis k
     LEFT JOIN users u ON u.id = k.accountable_user_id
     LEFT JOIN kpi_measurements m ON m.id = (
       SELECT m2.id FROM kpi_measurements m2 WHERE m2.kpi_id = k.id
       ORDER BY m2.measurement_date DESC, m2.created_at DESC LIMIT 1)
     WHERE k.project_id = ? ORDER BY k.name`,
  );

  const issues = q(
    `SELECT s.*, raiser.full_name AS raised_by_name
     FROM issues s LEFT JOIN users raiser ON raiser.id = s.raised_by
     WHERE s.project_id = ?
     ORDER BY CASE s.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
              CASE s.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
              s.opened_at DESC`,
  );

  const actions = q(
    `SELECT a.*, COALESCE(a.owner_name, owner.full_name) AS owner_display_name,
            esc.full_name AS escalation_owner_name,
            date(a.due_date) < date('now') AND a.status IN ('OPEN','IN_PROGRESS') AS is_overdue
     FROM corrective_actions a
     LEFT JOIN users owner ON owner.id = a.owner_user_id
     LEFT JOIN users esc ON esc.id = a.escalation_owner_user_id
     WHERE a.project_id = ?
     ORDER BY CASE a.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, a.due_date`,
  );

  const reviews = q(
    `SELECT * FROM reviews WHERE project_id = ? ORDER BY review_date DESC, created_at DESC`,
  );

  const history = q(
    `SELECT * FROM status_history WHERE project_id = ? ORDER BY changed_at DESC`,
  );

  const repositories = q(
    `SELECT id, provider, label, repo_url, visibility, created_at
     FROM repository_links WHERE project_id = ? ORDER BY created_at`,
  );

  const attachments = q(
    `SELECT id, kind, label, storage_key, external_url, content_type, size_bytes, created_at
     FROM attachments WHERE project_id = ? ORDER BY created_at DESC`,
  );

  return {
    project: { ...project, ...context, is_stale: isProjectStale(project) },
    members,
    milestones,
    kpis,
    issues,
    actions,
    reviews,
    history,
    repositories,
    attachments,
  };
}

function isProjectStale(project) {
  const last = new Date(`${project.last_update_at.replace(' ', 'T')}Z`);
  return (Date.now() - last.getTime()) / 86_400_000 > config.staleProjectDays;
}
