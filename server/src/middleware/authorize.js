import { db } from '../db/connection.js';
import { recordAudit } from '../services/audit.js';
import { forbidden, notFoundOrDenied } from './errors.js';
import {
  projectScopeSql,
  departmentScopeSql,
  instituteScopeSql,
  permissionsForProject,
  permissionsForInstitute,
  rolesForProject,
} from '../services/accessScope.js';

/**
 * Resource loaders. Each one re-runs the lookup with the caller's scope predicate
 * applied in SQL. If the record exists but sits outside the caller's scope, the
 * attempt is written to the audit log as a denied cross-tenant access and the
 * caller receives the same 404 as a genuinely missing record (requirement 7 and 10).
 */

function denyCrossTenant(req, entityType, entityId, instituteId) {
  recordAudit(req, {
    action: 'CROSS_TENANT_ACCESS_DENIED',
    entityType,
    entityId,
    instituteId,
    outcome: 'DENIED',
    detail: { method: req.method, path: req.originalUrl },
  });
  return notFoundOrDenied();
}

export function loadInstituteOr404(req, instituteId) {
  const scoped = instituteScopeSql(req.scope, 'i');
  const institute = db
    .prepare(`SELECT i.* FROM institutes i WHERE i.id = ? AND ${scoped.sql}`)
    .get(instituteId, ...scoped.params);
  if (institute) return institute;

  const exists = db.prepare('SELECT id FROM institutes WHERE id = ?').get(instituteId);
  throw exists ? denyCrossTenant(req, 'institute', instituteId, instituteId) : notFoundOrDenied();
}

export function loadDepartmentOr404(req, departmentId) {
  const scoped = departmentScopeSql(req.scope, 'd');
  const department = db
    .prepare(`SELECT d.* FROM departments d WHERE d.id = ? AND ${scoped.sql}`)
    .get(departmentId, ...scoped.params);
  if (department) return department;

  const exists = db.prepare('SELECT id, institute_id FROM departments WHERE id = ?').get(departmentId);
  throw exists
    ? denyCrossTenant(req, 'department', departmentId, exists.institute_id)
    : notFoundOrDenied();
}

export function loadProjectOr404(req, projectId) {
  const scoped = projectScopeSql(req.scope, 'p');
  const project = db
    .prepare(`SELECT p.* FROM projects p WHERE p.id = ? AND ${scoped.sql}`)
    .get(projectId, ...scoped.params);
  if (project) return project;

  const exists = db.prepare('SELECT id, institute_id FROM projects WHERE id = ?').get(projectId);
  throw exists ? denyCrossTenant(req, 'project', projectId, exists.institute_id) : notFoundOrDenied();
}

/**
 * Express middleware: resolves :projectId into req.project and attaches the
 * permissions and roles that apply to that specific project.
 */
export function withProject(req, _res, next) {
  try {
    req.project = loadProjectOr404(req, req.params.projectId ?? req.params.id);
    req.projectPermissions = permissionsForProject(req.scope, req.project);
    req.projectRoles = rolesForProject(req.scope, req.project);
    next();
  } catch (error) {
    next(error);
  }
}

export function withInstitute(req, _res, next) {
  try {
    req.institute = loadInstituteOr404(req, req.params.instituteId ?? req.params.id);
    req.institutePermissions = permissionsForInstitute(req.scope, req.institute.id);
    next();
  } catch (error) {
    next(error);
  }
}

export function withDepartment(req, _res, next) {
  try {
    req.department = loadDepartmentOr404(req, req.params.departmentId ?? req.params.id);
    req.institutePermissions = permissionsForInstitute(req.scope, req.department.institute_id);
    next();
  } catch (error) {
    next(error);
  }
}

/** Requires a capability on the project already loaded by withProject. */
export function requireProjectPermission(permission) {
  return (req, _res, next) => {
    if (req.projectPermissions?.has(permission)) return next();
    recordAudit(req, {
      action: 'AUTHORIZATION_DENIED',
      entityType: 'project',
      entityId: req.project?.id,
      instituteId: req.project?.institute_id,
      outcome: 'DENIED',
      detail: { required: permission, path: req.originalUrl },
    });
    next(forbidden(`Your role on this project does not allow this action (${permission}).`));
  };
}

/** Requires a capability within the institute already loaded by withInstitute/withDepartment. */
export function requireInstitutePermission(permission) {
  return (req, _res, next) => {
    if (req.institutePermissions?.has(permission)) return next();
    recordAudit(req, {
      action: 'AUTHORIZATION_DENIED',
      entityType: 'institute',
      entityId: req.institute?.id ?? req.department?.institute_id,
      instituteId: req.institute?.id ?? req.department?.institute_id,
      outcome: 'DENIED',
      detail: { required: permission, path: req.originalUrl },
    });
    next(forbidden(`Your role at this institute does not allow this action (${permission}).`));
  };
}

/** Requires a capability anywhere in the user's scope (for non-record-specific routes). */
export function requireAnyPermission(permission) {
  return (req, _res, next) => {
    if (req.scope?.permissions?.has(permission)) return next();
    recordAudit(req, {
      action: 'AUTHORIZATION_DENIED',
      outcome: 'DENIED',
      detail: { required: permission, path: req.originalUrl },
    });
    next(forbidden('You do not have permission to perform this action.'));
  };
}

export function requirePlatformAdmin(req, _res, next) {
  if (req.scope?.isPlatformAdmin) return next();
  recordAudit(req, {
    action: 'AUTHORIZATION_DENIED',
    outcome: 'DENIED',
    detail: { required: 'PLATFORM_ADMIN', path: req.originalUrl },
  });
  next(forbidden('Platform administrator access is required.'));
}
