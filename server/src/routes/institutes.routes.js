import { Router } from 'express';
import { withInstitute } from '../middleware/authorize.js';
import { recordAudit } from '../services/audit.js';
import { listInstitutes, instituteDashboard, listDepartments, programmeSummary, listProjects, projectFilterOptions } from '../services/portfolio.js';
import { parseProjectQuery } from './projectQuery.js';

export const institutesRouter = Router();

/** FR 5.2: only institutes the user is authorized for are ever returned. */
institutesRouter.get('/', (req, res) => {
  const institutes = listInstitutes(req.scope);
  res.json({
    institutes,
    // A single-institute user is sent straight there and never sees other names.
    autoSelectInstituteId: institutes.length === 1 ? institutes[0].id : null,
    canViewProgrammeRollup: institutes.length > 1,
  });
});

/** Programme-level aggregate across every authorized institute. */
institutesRouter.get('/summary', (req, res) => {
  res.json(programmeSummary(req.scope));
});

institutesRouter.get('/:instituteId/dashboard', withInstitute, (req, res) => {
  recordAudit(req, {
    action: 'VIEW_INSTITUTE_DASHBOARD',
    entityType: 'institute',
    entityId: req.institute.id,
    instituteId: req.institute.id,
  });
  res.json({
    ...instituteDashboard(req.scope, req.institute.id),
    // The client uses these to decide which create/edit actions to offer. The
    // server re-checks on every write regardless.
    permissions: [...req.institutePermissions],
  });
});

institutesRouter.get('/:instituteId/departments', withInstitute, (req, res) => {
  res.json({ departments: listDepartments(req.scope, req.institute.id) });
});

/** Institute-wide project list, used by the "all projects" view and filters. */
institutesRouter.get('/:instituteId/projects', withInstitute, (req, res) => {
  const { filters, sort } = parseProjectQuery(req.query);
  res.json({
    projects: listProjects(req.scope, { instituteId: req.institute.id, filters, sort }),
    filterOptions: projectFilterOptions(req.scope, { instituteId: req.institute.id }),
  });
});
