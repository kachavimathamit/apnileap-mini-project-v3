import { Router } from 'express';
import { z } from 'zod';
import { db, newId } from '../db/connection.js';
import { withDepartment, withInstitute, requireInstitutePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { conflict } from '../middleware/errors.js';
import { recordAudit } from '../services/audit.js';
import { departmentDashboard, listProjects, projectFilterOptions } from '../services/portfolio.js';
import { parseProjectQuery } from './projectQuery.js';

export const departmentsRouter = Router();

departmentsRouter.get('/:departmentId', withDepartment, (req, res) => {
  const { filters, sort } = parseProjectQuery(req.query);
  recordAudit(req, {
    action: 'VIEW_DEPARTMENT_DASHBOARD',
    entityType: 'department',
    entityId: req.department.id,
    instituteId: req.department.institute_id,
  });
  res.json({
    ...departmentDashboard(req.scope, req.department, { filters, sort }),
    permissions: [...req.institutePermissions],
  });
});

departmentsRouter.get('/:departmentId/projects', withDepartment, (req, res) => {
  const { filters, sort } = parseProjectQuery(req.query);
  res.json({
    projects: listProjects(req.scope, { departmentId: req.department.id, filters, sort }),
    filterOptions: projectFilterOptions(req.scope, { departmentId: req.department.id }),
  });
});

const departmentSchema = z.object({
  instituteId: z.string().min(1).max(64),
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(160),
  headUserId: z.string().max(64).nullish(),
  coordinatorUserId: z.string().max(64).nullish(),
});

departmentsRouter.post(
  '/',
  validate(departmentSchema),
  (req, _res, next) => {
    req.params.instituteId = req.valid.instituteId;
    next();
  },
  withInstitute,
  requireInstitutePermission('department:manage'),
  (req, res, next) => {
    try {
      const { code, name, headUserId, coordinatorUserId } = req.valid;
      const duplicate = db
        .prepare('SELECT id FROM departments WHERE institute_id = ? AND code = ?')
        .get(req.institute.id, code);
      if (duplicate) return next(conflict('A department with that code already exists at this institute.'));

      const id = newId('dep');
      db.prepare(
        `INSERT INTO departments (id, institute_id, code, name, head_user_id, coordinator_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, req.institute.id, code, name, headUserId ?? null, coordinatorUserId ?? null);

      recordAudit(req, {
        action: 'DEPARTMENT_CREATED',
        entityType: 'department',
        entityId: id,
        instituteId: req.institute.id,
        detail: { code, name },
      });

      res.status(201).json({ department: db.prepare('SELECT * FROM departments WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  },
);

const departmentPatchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  headUserId: z.string().max(64).nullish(),
  coordinatorUserId: z.string().max(64).nullish(),
  isActive: z.boolean().optional(),
});

departmentsRouter.patch(
  '/:departmentId',
  withDepartment,
  requireInstitutePermission('department:manage'),
  validate(departmentPatchSchema),
  (req, res, next) => {
    try {
      const updates = [];
      const params = [];
      const { name, headUserId, coordinatorUserId, isActive } = req.valid;

      if (name !== undefined) { updates.push('name = ?'); params.push(name); }
      if (headUserId !== undefined) { updates.push('head_user_id = ?'); params.push(headUserId || null); }
      if (coordinatorUserId !== undefined) { updates.push('coordinator_user_id = ?'); params.push(coordinatorUserId || null); }
      if (isActive !== undefined) { updates.push('is_active = ?'); params.push(isActive ? 1 : 0); }
      if (!updates.length) return res.json({ department: req.department });

      params.push(req.department.id);
      db.prepare(`UPDATE departments SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      recordAudit(req, {
        action: 'DEPARTMENT_UPDATED',
        entityType: 'department',
        entityId: req.department.id,
        instituteId: req.department.institute_id,
        detail: req.valid,
      });

      res.json({ department: db.prepare('SELECT * FROM departments WHERE id = ?').get(req.department.id) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Removes a department. A department that has never held a project is a genuine
 * mistake and is hard-deleted outright. One that has projects - even archived
 * ones - is deactivated instead: its projects and their history stay intact and
 * reachable, but the department stops appearing as a place to add new work.
 */
departmentsRouter.delete(
  '/:departmentId',
  withDepartment,
  requireInstitutePermission('department:manage'),
  (req, res, next) => {
    try {
      const projectCount = db
        .prepare('SELECT COUNT(*) AS n FROM projects WHERE department_id = ?')
        .get(req.department.id).n;

      if (projectCount === 0) {
        db.prepare('DELETE FROM departments WHERE id = ?').run(req.department.id);
        recordAudit(req, {
          action: 'DEPARTMENT_DELETED',
          entityType: 'department',
          entityId: req.department.id,
          instituteId: req.department.institute_id,
          detail: { code: req.department.code },
        });
        return res.json({ ok: true, deleted: true });
      }

      db.prepare('UPDATE departments SET is_active = 0 WHERE id = ?').run(req.department.id);
      recordAudit(req, {
        action: 'DEPARTMENT_DEACTIVATED',
        entityType: 'department',
        entityId: req.department.id,
        instituteId: req.department.institute_id,
        detail: { code: req.department.code, projectCount },
      });
      res.json({
        ok: true,
        deleted: false,
        message: `This department holds ${projectCount} project(s), so it has been deactivated ` +
          'rather than deleted. Its projects and their history remain intact.',
      });
    } catch (error) {
      next(error);
    }
  },
);
