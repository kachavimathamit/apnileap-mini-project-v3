import { Router } from 'express';
import { requireAnyPermission, requirePlatformAdmin } from '../middleware/authorize.js';
import { recordAudit } from '../services/audit.js';
import {
  buildWeeklyReport,
  renderWeeklyReportHtml,
  weeklyReportCsv,
  streamWeeklyReportPdf,
  dispatchWeeklyReports,
} from '../services/report.js';

export const reportsRouter = Router();

/**
 * Requirement 9.2 / acceptance criteria: the report is built from the caller's own
 * scope, so it can only ever contain information they are authorized to see.
 */
reportsRouter.get('/weekly', requireAnyPermission('report:view'), (req, res) => {
  const report = buildWeeklyReport(req.scope);
  recordAudit(req, {
    action: 'WEEKLY_REPORT_VIEWED',
    entityType: 'report',
    detail: { institutes: report.instituteCount, projects: report.totals.total },
  });
  res.json(report);
});

/** Excel-compatible export. Exports are restricted to scope and always audited. */
reportsRouter.get('/weekly.csv', requireAnyPermission('report:view'), (req, res) => {
  const report = buildWeeklyReport(req.scope);
  recordAudit(req, {
    action: 'WEEKLY_REPORT_EXPORTED',
    entityType: 'report',
    detail: { format: 'csv', projects: report.totals.total },
  });
  const filename = `portfolio-weekly-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM so Excel reads the file as UTF-8.
  res.send(`﻿${weeklyReportCsv(report)}`);
});

/** Print-ready HTML, for anyone who wants to review it in a browser tab first. */
reportsRouter.get('/weekly.html', requireAnyPermission('report:view'), (req, res) => {
  const report = buildWeeklyReport(req.scope);
  recordAudit(req, {
    action: 'WEEKLY_REPORT_EXPORTED',
    entityType: 'report',
    detail: { format: 'html', projects: report.totals.total },
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderWeeklyReportHtml(report, req.user.full_name));
});

/** A genuine PDF export - a real downloadable file, not a "print this yourself" page. */
reportsRouter.get('/weekly.pdf', requireAnyPermission('report:view'), (req, res) => {
  const report = buildWeeklyReport(req.scope);
  recordAudit(req, {
    action: 'WEEKLY_REPORT_EXPORTED',
    entityType: 'report',
    detail: { format: 'pdf', projects: report.totals.total },
  });
  const filename = `portfolio-weekly-${new Date().toISOString().slice(0, 10)}.pdf`;
  streamWeeklyReportPdf(report, req.user.full_name, res, filename);
});

/** Triggers the scheduled mail-out on demand. */
reportsRouter.post('/weekly/send', requirePlatformAdmin, async (req, res, next) => {
  try {
    const results = await dispatchWeeklyReports();
    recordAudit(req, {
      action: 'WEEKLY_REPORT_DISPATCHED',
      entityType: 'report',
      detail: { recipients: results.length },
    });
    res.json({ ok: true, recipients: results.length, results });
  } catch (error) {
    next(error);
  }
});
