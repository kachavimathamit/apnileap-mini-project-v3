import { db } from '../db/connection.js';

/**
 * Authorization model (requirement 4 and 7).
 *
 * A user holds one or more access grants. Each grant pairs a ROLE with a SCOPE:
 *
 *   PLATFORM   -> the whole deployment          (platform administrator only)
 *   INSTITUTE  -> one institute and everything inside it
 *   DEPARTMENT -> one department and its projects
 *   PROJECT    -> a single project
 *
 * Nothing is implicit. A user with no grant covering an institute cannot see that
 * institute exists. Scope is resolved once per request and then pushed down into
 * every SQL query as a WHERE fragment, so tenant isolation is a data-layer
 * property rather than a UI convention.
 */

export const ROLES = [
  'PLATFORM_ADMIN',
  'GLOBAL_PROGRAMME_LEADER',
  'INSTITUTE_ADMIN',
  'DEAN',
  'DEPARTMENT_HEAD',
  'COORDINATOR',
  'FACULTY_MENTOR',
  'REVIEWER',
  'READ_ONLY',
  'STUDENT',
];

export const ROLE_LABELS = {
  PLATFORM_ADMIN: 'Platform Administrator',
  GLOBAL_PROGRAMME_LEADER: 'Global Programme Leader',
  INSTITUTE_ADMIN: 'Institute Administrator',
  DEAN: 'Dean / Principal',
  DEPARTMENT_HEAD: 'Department Head',
  COORDINATOR: 'Faculty Coordinator',
  FACULTY_MENTOR: 'Faculty Mentor / Guide',
  REVIEWER: 'Reviewer / Success Coach',
  READ_ONLY: 'Read-only Stakeholder',
  STUDENT: 'Student Team Member',
};

/**
 * Capability matrix. Permissions are additive across the roles a user holds for
 * the record in question.
 *
 *  project:view            see a project and its detail
 *  project:create          create a project record
 *  project:update          edit project definition, milestones, KPIs
 *  status:propose          record a status change that does not need approval
 *  status:approve          approve a status change, including a return to Green
 *  issue:create            raise a challenge / blocker
 *  issue:update            edit or resolve a challenge
 *  action:create           open a corrective action with owner and due date
 *  action:update           progress a corrective action
 *  action:verify           verify that a corrective action is genuinely complete
 *  review:create           record a review decision
 *  artefact:manage         attach repository links and documents
 *  department:manage       create or edit departments
 *  user:manage             create users and change access grants
 *  audit:view              read the audit trail
 *  report:view             read the weekly management report
 *  mentor:approve          approve or reject a Faculty Mentor's registration
 *  project:assign_guide    allocate a project to a guide, coordinator-side
 *  team:approve            approve a student team a guide entered
 *  project:edit_definition edit theme/title/other definition fields (students, before freeze)
 *  project:freeze          freeze or unfreeze a project's definition
 *
 *  Foundation Integration extension (docs/DATABASE-DESIGN.txt Section 9) -
 *  all gated on the project already having an allocated guide:
 *  theme:manage             author/claim a catalog theme (institute or platform)
 *  project:assign_theme     confirm which theme a project is developing
 *  project:manage_engines   create/approve/decompose a project's engines
 *  engine:propose           a student proposes their own engine (PROPOSED only)
 *  project:conduct_gate_review  run a formal Gate 0-4 review and award marks
 *  project:log_checkin      the guide's informal weekly process-discipline check-in
 */
const ROLE_PERMISSIONS = {
  PLATFORM_ADMIN: [
    'project:view', 'project:create', 'project:update',
    'status:propose', 'status:approve',
    'issue:create', 'issue:update',
    'action:create', 'action:update', 'action:verify',
    'review:create', 'artefact:manage',
    'progress:submit', 'progress:review',
    'department:manage', 'user:manage', 'audit:view', 'report:view',

    'mentor:approve', 'project:assign_guide', 'team:approve',
    'project:edit_definition', 'project:freeze',
    'theme:manage', 'project:assign_theme', 'project:manage_engines',
    'project:conduct_gate_review', 'project:log_checkin',
  ],
  GLOBAL_PROGRAMME_LEADER: [
    'project:view', 'status:approve',
    'issue:create', 'action:create',
    'review:create', 'progress:review', 'audit:view', 'report:view',
  ],
  INSTITUTE_ADMIN: [
    'project:view', 'project:create', 'project:update',
    'status:propose', 'status:approve',
    'issue:create', 'issue:update',
    'action:create', 'action:update', 'action:verify',
    'review:create', 'artefact:manage',
    'progress:submit', 'progress:review',
    'department:manage', 'user:manage', 'audit:view', 'report:view',

    'mentor:approve', 'project:assign_guide', 'team:approve',
    'project:edit_definition', 'project:freeze',
    'theme:manage', 'project:assign_theme', 'project:manage_engines',
    'project:conduct_gate_review', 'project:log_checkin',
  ],
  DEAN: [
    'project:view', 'status:approve',
    'issue:create', 'action:create', 'action:verify',
    'review:create', 'progress:review', 'report:view',
  ],
  DEPARTMENT_HEAD: [
    'project:view', 'status:approve',
    'issue:create', 'issue:update',
    'action:create', 'action:update', 'action:verify',
    'review:create', 'progress:review', 'report:view',
    'mentor:approve', 'team:approve',
  ],
  COORDINATOR: [
    'project:view', 'progress:review',
    'review:create', 'report:view',
    'project:assign_guide', 'team:approve',
    'theme:manage', 'project:assign_theme', 'project:manage_engines',
  ],
  FACULTY_MENTOR: [
    'project:view', 'project:update', 'status:propose',
    'issue:create', 'issue:update',
    'action:create', 'action:update',
    'artefact:manage', 'progress:submit', 'progress:review',
    'project:edit_definition', 'project:freeze',
    // A guide conducts their own teams' scheduled reviews.
    'review:create',
    // A guide claims/owns a theme, finalises it on their teams' projects,
    // approves engine decomposition, and logs weekly process check-ins.
    'theme:manage', 'project:assign_theme', 'project:manage_engines', 'project:log_checkin',
  ],
  REVIEWER: [
    'project:view', 'status:approve',
    'issue:create', 'action:create',
    'review:create', 'progress:review', 'report:view',
    // A Reviewer runs the formal Gate 0-4 review, per the Student/Guide/
    // Reviewer split in the Foundation Integration framework.
    'project:conduct_gate_review',
  ],
  READ_ONLY: ['project:view', 'report:view'],
  // Requirement 2.1: students may input the challenges and issues they face,
  // and (below) submit their own progress for guide review.
  STUDENT: ['project:view', 'issue:create', 'progress:submit', 'project:edit_definition', 'engine:propose'],
};

export function permissionsForRoles(roles) {
  const set = new Set();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return set;
}

// Prepared lazily: statements can only be compiled once the schema exists.
let grantsQuery;
function getGrantsQuery() {
  grantsQuery ??= db.prepare(`
    SELECT g.id, g.role, g.scope_type, g.institute_id, g.department_id, g.project_id
    FROM access_grants g
    WHERE g.user_id = ?
      AND g.is_active = 1
      AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
  `);
  return grantsQuery;
}

/**
 * Resolves the complete authorization picture for a user. Called once per request.
 */
export function loadScope(userId) {
  const grants = getGrantsQuery().all(userId);

  const scope = {
    userId,
    grants,
    roles: new Set(),
    isPlatformAdmin: false,
    /** Institutes the user can see in full (INSTITUTE-scoped grants). */
    instituteIds: new Set(),
    /** Departments reachable through a DEPARTMENT-scoped grant. */
    departmentIds: new Set(),
    /** Projects reachable through a PROJECT-scoped grant. */
    projectIds: new Set(),
    /** Every institute the user may know exists, for any reason. */
    visibleInstituteIds: new Set(),
  };

  for (const grant of grants) {
    scope.roles.add(grant.role);
    if (grant.scope_type === 'PLATFORM') {
      scope.isPlatformAdmin = scope.isPlatformAdmin || grant.role === 'PLATFORM_ADMIN';
      continue;
    }
    if (grant.institute_id) scope.visibleInstituteIds.add(grant.institute_id);
    if (grant.scope_type === 'INSTITUTE') scope.instituteIds.add(grant.institute_id);
    if (grant.scope_type === 'DEPARTMENT') scope.departmentIds.add(grant.department_id);
    if (grant.scope_type === 'PROJECT') scope.projectIds.add(grant.project_id);
  }

  if (scope.isPlatformAdmin) {
    for (const row of db.prepare('SELECT id FROM institutes').all()) {
      scope.visibleInstituteIds.add(row.id);
      scope.instituteIds.add(row.id);
    }
  }

  scope.permissions = permissionsForRoles(scope.roles);
  return scope;
}

function placeholders(count) {
  return new Array(count).fill('?').join(', ');
}

const DENY_ALL = { sql: '1 = 0', params: [] };

/**
 * SQL predicate restricting an `institutes` query (aliased `i`) to the user's scope.
 */
export function instituteScopeSql(scope, alias = 'i') {
  if (scope.isPlatformAdmin) return { sql: '1 = 1', params: [] };
  const ids = [...scope.visibleInstituteIds];
  if (ids.length === 0) return DENY_ALL;
  return { sql: `${alias}.id IN (${placeholders(ids.length)})`, params: ids };
}

/**
 * SQL predicate restricting a `departments` query (aliased `d`) to the user's scope.
 * A DEPARTMENT- or PROJECT-scoped user sees only the departments they were granted.
 */
export function departmentScopeSql(scope, alias = 'd') {
  if (scope.isPlatformAdmin) return { sql: '1 = 1', params: [] };

  const clauses = [];
  const params = [];

  const institutes = [...scope.instituteIds];
  if (institutes.length) {
    clauses.push(`${alias}.institute_id IN (${placeholders(institutes.length)})`);
    params.push(...institutes);
  }

  const departments = [...scope.departmentIds];
  if (departments.length) {
    clauses.push(`${alias}.id IN (${placeholders(departments.length)})`);
    params.push(...departments);
  }

  const projects = [...scope.projectIds];
  if (projects.length) {
    clauses.push(
      `${alias}.id IN (SELECT department_id FROM projects WHERE id IN (${placeholders(projects.length)}))`,
    );
    params.push(...projects);
  }

  if (clauses.length === 0) return DENY_ALL;
  return { sql: `(${clauses.join(' OR ')})`, params };
}

/**
 * SQL predicate restricting a `projects` query (aliased `p`) to the user's scope.
 * This is the single fragment every project-reading query must include.
 */
export function projectScopeSql(scope, alias = 'p') {
  if (scope.isPlatformAdmin) return { sql: '1 = 1', params: [] };

  const clauses = [];
  const params = [];

  const institutes = [...scope.instituteIds];
  if (institutes.length) {
    clauses.push(`${alias}.institute_id IN (${placeholders(institutes.length)})`);
    params.push(...institutes);
  }

  const departments = [...scope.departmentIds];
  if (departments.length) {
    clauses.push(`${alias}.department_id IN (${placeholders(departments.length)})`);
    params.push(...departments);
  }

  const projects = [...scope.projectIds];
  if (projects.length) {
    clauses.push(`${alias}.id IN (${placeholders(projects.length)})`);
    params.push(...projects);
  }

  if (clauses.length === 0) return DENY_ALL;
  return { sql: `(${clauses.join(' OR ')})`, params };
}

/** True when the user's scope covers this institute at all. */
export function canSeeInstitute(scope, instituteId) {
  return scope.isPlatformAdmin || scope.visibleInstituteIds.has(instituteId);
}

/**
 * The roles that actually apply to a specific project. A user may be an
 * Institute Administrator at KLE and only a Faculty Mentor on one RIT project;
 * capability checks must use the roles relevant to the record being touched.
 */
export function rolesForProject(scope, project) {
  if (scope.isPlatformAdmin) return new Set(['PLATFORM_ADMIN']);
  const roles = new Set();
  for (const grant of scope.grants) {
    const matches =
      (grant.scope_type === 'INSTITUTE' && grant.institute_id === project.institute_id) ||
      (grant.scope_type === 'DEPARTMENT' && grant.department_id === project.department_id) ||
      (grant.scope_type === 'PROJECT' && grant.project_id === project.id);
    if (matches) roles.add(grant.role);
  }
  return roles;
}

export function permissionsForProject(scope, project) {
  return permissionsForRoles(rolesForProject(scope, project));
}

/** The roles that apply within one institute (used for institute-level actions). */
export function rolesForInstitute(scope, instituteId) {
  if (scope.isPlatformAdmin) return new Set(['PLATFORM_ADMIN']);
  const roles = new Set();
  for (const grant of scope.grants) {
    if (grant.institute_id === instituteId) roles.add(grant.role);
  }
  return roles;
}

export function permissionsForInstitute(scope, instituteId) {
  return permissionsForRoles(rolesForInstitute(scope, instituteId));
}

/** A short, human-readable summary of the user's access, shown on the landing page. */
export function describeScope(scope) {
  if (scope.isPlatformAdmin) return 'All institutes (platform administration)';
  const count = scope.visibleInstituteIds.size;
  if (count === 0) return 'No institute access granted';
  if (count === 1) {
    const id = [...scope.visibleInstituteIds][0];
    const row = db.prepare('SELECT short_name FROM institutes WHERE id = ?').get(id);
    const named = row?.short_name ?? 'one institute';
    if (scope.instituteIds.has(id)) return `${named} (full institute)`;
    if (scope.departmentIds.size) return `${named} (assigned departments)`;
    return `${named} (assigned projects)`;
  }
  return `${count} authorized institutes`;
}
