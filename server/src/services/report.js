import PDFDocument from 'pdfkit';
import { db } from '../db/connection.js';
import { config } from '../config.js';
import { loadScope, describeScope } from './accessScope.js';
import { projectScopeSql } from './accessScope.js';
import { listInstitutes } from './portfolio.js';
import { sendMail } from './mailer.js';

/**
 * Weekly management report (requirement 9.2).
 *
 * The report is generated per recipient from that recipient's own scope, so two
 * people receiving the same weekly mail see different institutes. There is no
 * "full" report that is later trimmed - the trimming is the query.
 */
export function buildWeeklyReport(scope, { weekDays = 7 } = {}) {
  const ps = projectScopeSql(scope, 'p');
  const p = ps.params;
  const since = `-${weekDays} days`;

  const institutes = listInstitutes(scope);

  const instituteSummary = db
    .prepare(
      `SELECT i.id, i.short_name, i.name,
              SUM(CASE WHEN p.rag_status = 'GREEN'  THEN 1 ELSE 0 END) AS green,
              SUM(CASE WHEN p.rag_status = 'YELLOW' THEN 1 ELSE 0 END) AS yellow,
              SUM(CASE WHEN p.rag_status = 'RED'    THEN 1 ELSE 0 END) AS red,
              COUNT(*) AS total
       FROM projects p
       JOIN institutes i ON i.id = p.institute_id
       WHERE p.is_archived = 0 AND ${ps.sql}
       GROUP BY i.id
       ORDER BY red DESC, i.short_name`,
    )
    .all(...p);

  const newRed = db
    .prepare(
      `SELECT p.id, p.code, p.title, p.rag_status_since, i.short_name AS institute, d.name AS department,
              (SELECT h.rationale FROM status_history h WHERE h.project_id = p.id
                ORDER BY h.changed_at DESC LIMIT 1) AS rationale
       FROM projects p
       JOIN institutes i ON i.id = p.institute_id
       JOIN departments d ON d.id = p.department_id
       WHERE p.is_archived = 0 AND p.rag_status = 'RED'
         AND p.rag_status_since >= datetime('now', ?)
         AND ${ps.sql}
       ORDER BY p.rag_status_since DESC`,
    )
    .all(since, ...p);

  const longStandingRed = db
    .prepare(
      `SELECT p.id, p.code, p.title, p.rag_status_since,
              CAST(julianday('now') - julianday(p.rag_status_since) AS INTEGER) AS days_red,
              i.short_name AS institute, d.name AS department
       FROM projects p
       JOIN institutes i ON i.id = p.institute_id
       JOIN departments d ON d.id = p.department_id
       WHERE p.is_archived = 0 AND p.rag_status = 'RED'
         AND p.rag_status_since < datetime('now', ?)
         AND ${ps.sql}
       ORDER BY days_red DESC`,
    )
    .all(since, ...p);

  const recovering = db
    .prepare(
      `SELECT p.id, p.code, p.title, p.rag_status, i.short_name AS institute, d.name AS department,
              h.changed_at, h.previous_status, h.new_status, h.changed_by_name
       FROM status_history h
       JOIN projects p ON p.id = h.project_id
       JOIN institutes i ON i.id = p.institute_id
       JOIN departments d ON d.id = p.department_id
       WHERE h.previous_status = 'RED' AND h.new_status IN ('YELLOW', 'GREEN')
         AND h.changed_at >= datetime('now', ?)
         AND p.is_archived = 0 AND ${ps.sql}
       ORDER BY h.changed_at DESC`,
    )
    .all(since, ...p);

  const overdueActions = db
    .prepare(
      `SELECT a.id, a.description, a.due_date, COALESCE(a.owner_name, u.full_name) AS owner,
              CAST(julianday('now') - julianday(a.due_date) AS INTEGER) AS days_overdue,
              p.id AS project_id, p.code AS project_code, p.title AS project_title,
              i.short_name AS institute
       FROM corrective_actions a
       JOIN projects p ON p.id = a.project_id
       JOIN institutes i ON i.id = p.institute_id
       LEFT JOIN users u ON u.id = a.owner_user_id
       WHERE a.status IN ('OPEN', 'IN_PROGRESS') AND date(a.due_date) < date('now')
         AND p.is_archived = 0 AND ${ps.sql}
       ORDER BY days_overdue DESC`,
    )
    .all(...p);

  const staleProjects = db
    .prepare(
      `SELECT p.id, p.code, p.title, p.last_update_at, p.rag_status,
              CAST(julianday('now') - julianday(p.last_update_at) AS INTEGER) AS days_since_update,
              i.short_name AS institute, d.name AS department
       FROM projects p
       JOIN institutes i ON i.id = p.institute_id
       JOIN departments d ON d.id = p.department_id
       WHERE p.is_archived = 0
         AND julianday('now') - julianday(p.last_update_at) > ?
         AND ${ps.sql}
       ORDER BY days_since_update DESC`,
    )
    .all(config.staleProjectDays, ...p);

  const upcoming = db
    .prepare(
      `SELECT p.id, p.code, p.title, p.next_review_date, p.rag_status,
              i.short_name AS institute, d.name AS department
       FROM projects p
       JOIN institutes i ON i.id = p.institute_id
       JOIN departments d ON d.id = p.department_id
       WHERE p.is_archived = 0 AND p.next_review_date IS NOT NULL
         AND date(p.next_review_date) BETWEEN date('now') AND date('now', '+14 days')
         AND ${ps.sql}
       ORDER BY p.next_review_date`,
    )
    .all(...p);

  const upcomingMilestones = db
    .prepare(
      `SELECT m.title, m.planned_date, m.is_critical,
              p.code AS project_code, p.title AS project_title, i.short_name AS institute
       FROM milestones m
       JOIN projects p ON p.id = m.project_id
       JOIN institutes i ON i.id = p.institute_id
       WHERE m.status IN ('UPCOMING', 'CURRENT') AND m.planned_date IS NOT NULL
         AND date(m.planned_date) BETWEEN date('now') AND date('now', '+14 days')
         AND p.is_archived = 0 AND ${ps.sql}
       ORDER BY m.planned_date`,
    )
    .all(...p);

  const assistanceRequests = db
    .prepare(
      `SELECT s.id, s.title, s.assistance_required, s.support_source, s.escalation_level,
              p.id AS project_id, p.code AS project_code, p.title AS project_title,
              i.short_name AS institute
       FROM issues s
       JOIN projects p ON p.id = s.project_id
       JOIN institutes i ON i.id = p.institute_id
       WHERE s.assistance_required IS NOT NULL AND TRIM(s.assistance_required) <> ''
         AND s.status NOT IN ('VERIFIED', 'CLOSED')
         AND p.is_archived = 0 AND ${ps.sql}
       ORDER BY CASE s.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END`,
    )
    .all(...p);

  const totals = instituteSummary.reduce(
    (acc, row) => ({
      green: acc.green + row.green,
      yellow: acc.yellow + row.yellow,
      red: acc.red + row.red,
      total: acc.total + row.total,
    }),
    { green: 0, yellow: 0, red: 0, total: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    periodDays: weekDays,
    scopeDescription: describeScope(scope),
    instituteCount: institutes.length,
    totals,
    instituteSummary,
    newRed,
    longStandingRed,
    recovering,
    overdueActions,
    staleProjects,
    upcomingReviews: upcoming,
    upcomingMilestones,
    assistanceRequests,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function renderWeeklyReportHtml(report, recipientName) {
  const section = (title, rows, render) => {
    if (!rows.length) return `<h3>${escapeHtml(title)}</h3><p style="color:#666">Nothing to report.</p>`;
    return `<h3>${escapeHtml(title)}</h3><ul>${rows.map(render).join('')}</ul>`;
  };

  return `<!doctype html>
<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1c2430;max-width:760px">
<h2>Mini-Project Portfolio - Weekly Summary</h2>
<p>Prepared for ${escapeHtml(recipientName)}. Access scope: <strong>${escapeHtml(report.scopeDescription)}</strong>.<br>
Generated ${escapeHtml(report.generatedAt.slice(0, 16).replace('T', ' '))} covering the last ${report.periodDays} days.</p>

<h3>Portfolio status</h3>
<table cellpadding="6" style="border-collapse:collapse" border="1">
  <tr style="background:#f2f4f7"><th align="left">Institute</th><th>Green</th><th>Yellow</th><th>Red</th><th>Total</th></tr>
  ${report.instituteSummary
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.short_name)}</td><td align="center">${row.green}</td><td align="center">${row.yellow}</td><td align="center">${row.red}</td><td align="center">${row.total}</td></tr>`,
    )
    .join('')}
  <tr style="font-weight:bold"><td>All authorized institutes</td><td align="center">${report.totals.green}</td><td align="center">${report.totals.yellow}</td><td align="center">${report.totals.red}</td><td align="center">${report.totals.total}</td></tr>
</table>

${section('New Red projects this period', report.newRed, (r) => `<li><strong>${escapeHtml(r.title)}</strong> (${escapeHtml(r.institute)} / ${escapeHtml(r.department)}) - Red since ${escapeHtml(r.rag_status_since?.slice(0, 10))}. ${escapeHtml(r.rationale ?? '')}</li>`)}
${section('Long-standing Red projects', report.longStandingRed, (r) => `<li><strong>${escapeHtml(r.title)}</strong> (${escapeHtml(r.institute)}) - Red for ${r.days_red} days</li>`)}
${section('Recovering from Red', report.recovering, (r) => `<li><strong>${escapeHtml(r.title)}</strong> (${escapeHtml(r.institute)}) - moved Red to ${escapeHtml(r.new_status)} by ${escapeHtml(r.changed_by_name)}</li>`)}
${section('Overdue corrective actions', report.overdueActions, (r) => `<li>${escapeHtml(r.project_title)}: ${escapeHtml(r.description)} - owner ${escapeHtml(r.owner ?? 'unassigned')}, ${r.days_overdue} day(s) overdue</li>`)}
${section('Projects not recently updated', report.staleProjects, (r) => `<li>${escapeHtml(r.title)} (${escapeHtml(r.institute)}) - last update ${r.days_since_update} days ago</li>`)}
${section('Upcoming reviews', report.upcomingReviews, (r) => `<li>${escapeHtml(r.next_review_date)} - ${escapeHtml(r.title)} (${escapeHtml(r.institute)})</li>`)}
${section('Upcoming milestones', report.upcomingMilestones, (r) => `<li>${escapeHtml(r.planned_date)} - ${escapeHtml(r.title)} (${escapeHtml(r.project_title)})${r.is_critical ? ' <em>critical</em>' : ''}</li>`)}
${section('Assistance requested', report.assistanceRequests, (r) => `<li>${escapeHtml(r.project_title)}: ${escapeHtml(r.assistance_required)} (from ${escapeHtml(r.support_source ?? 'unspecified')})</li>`)}

<p style="color:#666;font-size:12px">This report contains only information within your authorized access scope.</p>
</body></html>`;
}

/**
 * A genuine, downloadable PDF (not an HTML page the user has to print
 * themselves). Streamed straight to the response so an arbitrarily long
 * report never has to be buffered whole in memory first.
 */
export function streamWeeklyReportPdf(report, recipientName, res, filename) {
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const ink = '#1c2430';
  const soft = '#5a6472';
  const line = '#d8dde5';

  doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text('Mini-Project Portfolio - Weekly Summary');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor(soft)
    .text(`Prepared for ${recipientName}. Access scope: ${report.scopeDescription}.`)
    .text(`Generated ${report.generatedAt.slice(0, 16).replace('T', ' ')} - covering the last ${report.periodDays} days.`);
  doc.moveDown(1);

  const heading = (text) => {
    if (doc.y > 700) doc.addPage();
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(13).text(text);
    doc.moveDown(0.3);
  };

  const table = (columns, rows) => {
    const startX = doc.x;
    const rowHeight = 18;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ink);
    let x = startX;
    for (const col of columns) {
      doc.text(col.label, x, doc.y, { width: col.width, continued: false });
      x += col.width;
    }
    doc.moveDown(0.2);
    doc.moveTo(startX, doc.y).lineTo(startX + columns.reduce((s, c) => s + c.width, 0), doc.y).strokeColor(line).stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9.5).fillColor(ink);
    for (const row of rows) {
      if (doc.y > 740) { doc.addPage(); }
      const y = doc.y;
      x = startX;
      for (const col of columns) {
        doc.text(String(row[col.key] ?? ''), x, y, { width: col.width });
        x += col.width;
      }
      doc.y = y + rowHeight;
    }
    doc.moveDown(0.6);
  };

  const bulletList = (title, rows, render) => {
    heading(`${title} (${rows.length})`);
    if (!rows.length) {
      doc.font('Helvetica').fontSize(10).fillColor(soft).text('Nothing to report.');
      doc.moveDown(0.8);
      return;
    }
    doc.font('Helvetica').fontSize(10).fillColor(ink);
    for (const row of rows) {
      if (doc.y > 740) doc.addPage();
      doc.text(`•  ${render(row)}`, { width: 495 });
    }
    doc.moveDown(0.8);
  };

  heading('Portfolio status');
  table(
    [
      { key: 'short_name', label: 'Institute', width: 175 },
      { key: 'green', label: 'Green', width: 80 },
      { key: 'yellow', label: 'Yellow', width: 80 },
      { key: 'red', label: 'Red', width: 80 },
      { key: 'total', label: 'Total', width: 80 },
    ],
    [...report.instituteSummary, { short_name: 'All authorized institutes', ...report.totals }],
  );

  bulletList('New Red projects this period', report.newRed,
    (r) => `${r.title} (${r.institute} / ${r.department}) - Red since ${r.rag_status_since?.slice(0, 10)}. ${r.rationale ?? ''}`);
  bulletList('Long-standing Red projects', report.longStandingRed,
    (r) => `${r.title} (${r.institute}) - Red for ${r.days_red} days`);
  bulletList('Recovering from Red', report.recovering,
    (r) => `${r.title} (${r.institute}) - moved Red to ${r.new_status} by ${r.changed_by_name}`);
  bulletList('Overdue corrective actions', report.overdueActions,
    (r) => `${r.project_title}: ${r.description} - owner ${r.owner ?? 'unassigned'}, ${r.days_overdue} day(s) overdue`);
  bulletList('Projects not recently updated', report.staleProjects,
    (r) => `${r.title} (${r.institute}) - last update ${r.days_since_update} days ago`);
  bulletList('Upcoming reviews', report.upcomingReviews,
    (r) => `${r.next_review_date} - ${r.title} (${r.institute})`);
  bulletList('Upcoming milestones', report.upcomingMilestones,
    (r) => `${r.planned_date} - ${r.title} (${r.project_title})${r.is_critical ? ' [critical]' : ''}`);
  bulletList('Assistance requested', report.assistanceRequests,
    (r) => `${r.project_title}: ${r.assistance_required} (from ${r.support_source ?? 'unspecified'})`);

  doc.font('Helvetica').fontSize(8).fillColor(soft)
    .text('This report contains only information within your authorized access scope.');

  doc.end();
}

export function renderWeeklyReportText(report, recipientName) {
  const lines = [
    'MINI-PROJECT PORTFOLIO - WEEKLY SUMMARY',
    `Prepared for: ${recipientName}`,
    `Access scope: ${report.scopeDescription}`,
    `Generated: ${report.generatedAt}`,
    '',
    'PORTFOLIO STATUS',
    ...report.instituteSummary.map(
      (r) => `  ${r.short_name}: Green ${r.green} / Yellow ${r.yellow} / Red ${r.red} (total ${r.total})`,
    ),
    `  TOTAL: Green ${report.totals.green} / Yellow ${report.totals.yellow} / Red ${report.totals.red}`,
    '',
    `NEW RED PROJECTS (${report.newRed.length})`,
    ...report.newRed.map((r) => `  - ${r.title} (${r.institute}/${r.department})`),
    '',
    `LONG-STANDING RED (${report.longStandingRed.length})`,
    ...report.longStandingRed.map((r) => `  - ${r.title} (${r.institute}) - ${r.days_red} days`),
    '',
    `RECOVERING FROM RED (${report.recovering.length})`,
    ...report.recovering.map((r) => `  - ${r.title}: RED -> ${r.new_status}`),
    '',
    `OVERDUE CORRECTIVE ACTIONS (${report.overdueActions.length})`,
    ...report.overdueActions.map((r) => `  - ${r.project_title}: ${r.description} (${r.days_overdue}d overdue)`),
    '',
    `STALE PROJECTS (${report.staleProjects.length})`,
    ...report.staleProjects.map((r) => `  - ${r.title} - ${r.days_since_update} days since update`),
    '',
    `UPCOMING REVIEWS (${report.upcomingReviews.length})`,
    ...report.upcomingReviews.map((r) => `  - ${r.next_review_date}: ${r.title}`),
    '',
    'This report contains only information within your authorized access scope.',
  ];
  return lines.join('\n');
}

/**
 * Sends the weekly report to every active user who holds `report:view`. Each mail
 * is generated from that user's own scope.
 */
export async function dispatchWeeklyReports() {
  const candidates = db
    .prepare(
      `SELECT DISTINCT u.id, u.email, u.full_name
       FROM users u
       JOIN access_grants g ON g.user_id = u.id AND g.is_active = 1
       WHERE u.is_active = 1
         AND g.role IN ('PLATFORM_ADMIN','GLOBAL_PROGRAMME_LEADER','INSTITUTE_ADMIN',
                        'DEAN','DEPARTMENT_HEAD','REVIEWER','READ_ONLY')`,
    )
    .all();

  const results = [];
  for (const user of candidates) {
    const scope = loadScope(user.id);
    if (!scope.permissions.has('report:view')) continue;
    const report = buildWeeklyReport(scope);
    if (report.totals.total === 0) continue;

    await sendMail({
      to: user.email,
      subject: `Mini-project portfolio weekly summary - ${report.totals.red} Red, ${report.totals.yellow} Yellow`,
      text: renderWeeklyReportText(report, user.full_name),
      html: renderWeeklyReportHtml(report, user.full_name),
    });
    results.push({ userId: user.id, email: user.email, projects: report.totals.total });
  }
  return results;
}

/** CSV export of the report's project-level rows (NFR: export to Excel). */
export function weeklyReportCsv(report) {
  const rows = [['Section', 'Institute', 'Department', 'Project code', 'Project', 'Detail']];
  const push = (section, list, map) => {
    for (const item of list) rows.push([section, ...map(item)]);
  };

  push('Institute summary', report.instituteSummary, (r) => [
    r.short_name, '', '', '', `Green ${r.green}, Yellow ${r.yellow}, Red ${r.red}, Total ${r.total}`,
  ]);
  push('New Red', report.newRed, (r) => [r.institute, r.department, r.code, r.title, r.rationale ?? '']);
  push('Long-standing Red', report.longStandingRed, (r) => [
    r.institute, r.department, r.code, r.title, `Red for ${r.days_red} days`,
  ]);
  push('Recovering', report.recovering, (r) => [
    r.institute, r.department, r.code, r.title, `${r.previous_status} -> ${r.new_status}`,
  ]);
  push('Overdue action', report.overdueActions, (r) => [
    r.institute, '', r.project_code, r.project_title, `${r.description} (owner ${r.owner ?? 'unassigned'}, ${r.days_overdue}d overdue)`,
  ]);
  push('Stale project', report.staleProjects, (r) => [
    r.institute, r.department, r.code, r.title, `${r.days_since_update} days since update`,
  ]);
  push('Upcoming review', report.upcomingReviews, (r) => [
    r.institute, r.department, r.code, r.title, `Review due ${r.next_review_date}`,
  ]);
  push('Assistance requested', report.assistanceRequests, (r) => [
    r.institute, '', r.project_code, r.project_title, r.assistance_required,
  ]);

  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}
