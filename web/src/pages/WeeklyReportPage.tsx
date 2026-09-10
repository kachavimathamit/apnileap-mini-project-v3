import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile, type WeeklyReport } from '../api';
import { Card, ErrorMessage, Loading } from '../components/ui';

/** Requirement 9.2. Everything shown is already limited to the reader's scope. */
export function WeeklyReportPage() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  useEffect(() => {
    api.get<WeeklyReport>('/reports/weekly').then(setReport).catch(setError);
  }, []);

  async function handleExportCsv() {
    setExportError(null);
    setExporting('csv');
    try {
      await downloadFile('/reports/weekly.csv', `portfolio-weekly-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (caught) {
      setExportError(caught);
    } finally {
      setExporting(null);
    }
  }

  async function handleExportPdf() {
    setExportError(null);
    setExporting('pdf');
    try {
      await downloadFile('/reports/weekly.pdf', `portfolio-weekly-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (caught) {
      setExportError(caught);
    } finally {
      setExporting(null);
    }
  }

  if (error) return <ErrorMessage error={error} />;
  if (!report) return <Loading what="the weekly report" />;

  const section = <T,>(title: string, rows: T[], head: string[], render: (row: T) => React.ReactNode) => (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="empty">Nothing to report.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr>{head.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{rows.map(render)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weekly management summary</h1>
          <p>
            Covering the last {report.periodDays} days · generated {report.generatedAt.slice(0, 16).replace('T', ' ')} ·
            scope: {report.scopeDescription}
          </p>
        </div>
        <div className="btn-row">
          {/* Both exports are generated server-side from the caller's own scope and audited. */}
          <button type="button" className="button-link" onClick={handleExportCsv} disabled={exporting !== null}>
            {exporting === 'csv' ? 'Preparing CSV…' : 'Export CSV (Excel)'}
          </button>
          <button type="button" className="button-link" onClick={handleExportPdf} disabled={exporting !== null}>
            {exporting === 'pdf' ? 'Preparing…' : 'Printable version (PDF)'}
          </button>
        </div>
      </div>

      {exportError && (
        <div style={{ marginBottom: '1rem' }}>
          <ErrorMessage error={exportError} />
        </div>
      )}

      <Card title="Institute-wise status">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Institute</th>
                <th className="numeric">Green</th>
                <th className="numeric">Yellow</th>
                <th className="numeric">Red</th>
                <th className="numeric">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.instituteSummary.map((row) => (
                <tr key={row.id}>
                  <td><Link className="rowlink" to={`/institutes/${row.id}`}>{row.short_name}</Link><span className="rowsub">{row.name}</span></td>
                  <td className="numeric">{row.green > 0 ? <strong style={{ color: 'var(--green)' }}>{row.green}</strong> : 0}</td>
                  <td className="numeric">{row.yellow > 0 ? <strong style={{ color: 'var(--yellow)' }}>{row.yellow}</strong> : 0}</td>
                  <td className="numeric">{row.red > 0 ? <strong style={{ color: 'var(--red)' }}>{row.red}</strong> : 0}</td>
                  <td className="numeric">{row.total}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td>All authorized institutes</td>
                <td className="numeric" style={{ color: 'var(--green)' }}>{report.totals.green}</td>
                <td className="numeric" style={{ color: 'var(--yellow)' }}>{report.totals.yellow}</td>
                <td className="numeric" style={{ color: 'var(--red)' }}>{report.totals.red}</td>
                <td className="numeric">{report.totals.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {section('New Red projects', report.newRed, ['Project', 'Institute', 'Department', 'Red since'], (row) => (
        <tr key={row.id}>
          <td><Link className="rowlink" to={`/projects/${row.id}`}>{row.title}</Link><span className="rowsub">{row.rationale ?? ''}</span></td>
          <td>{row.institute}</td>
          <td>{row.department}</td>
          <td>{row.rag_status_since?.slice(0, 10)}</td>
        </tr>
      ))}

      {section('Long-standing Red projects', report.longStandingRed, ['Project', 'Institute', 'Days Red'], (row) => (
        <tr key={row.id}>
          <td><Link className="rowlink" to={`/projects/${row.id}`}>{row.title}</Link></td>
          <td>{row.institute}</td>
          <td className="numeric">{row.days_red}</td>
        </tr>
      ))}

      {section('Recovering from Red', report.recovering, ['Project', 'Institute', 'Transition', 'Recorded by'], (row) => (
        <tr key={`${row.id}-${row.changed_by_name}`}>
          <td><Link className="rowlink" to={`/projects/${row.id}`}>{row.title}</Link></td>
          <td>{row.institute}</td>
          <td>{row.previous_status} → {row.new_status}</td>
          <td>{row.changed_by_name}</td>
        </tr>
      ))}

      {section('Overdue corrective actions', report.overdueActions, ['Action', 'Project', 'Owner', 'Days overdue'], (row) => (
        <tr key={row.id}>
          <td>{row.description}</td>
          <td>{row.project_title}<span className="rowsub">{row.institute}</span></td>
          <td>{row.owner ?? 'unassigned'}</td>
          <td className="numeric"><strong style={{ color: 'var(--red)' }}>{row.days_overdue}</strong></td>
        </tr>
      ))}

      {section('Projects not recently updated', report.staleProjects, ['Project', 'Institute', 'Days since update'], (row) => (
        <tr key={row.id}>
          <td><Link className="rowlink" to={`/projects/${row.id}`}>{row.title}</Link></td>
          <td>{row.institute}</td>
          <td className="numeric">{row.days_since_update}</td>
        </tr>
      ))}

      {section('Upcoming reviews', report.upcomingReviews, ['Date', 'Project', 'Institute'], (row) => (
        <tr key={row.id}>
          <td>{row.next_review_date}</td>
          <td><Link className="rowlink" to={`/projects/${row.id}`}>{row.title}</Link></td>
          <td>{row.institute}</td>
        </tr>
      ))}

      {section('Upcoming milestones', report.upcomingMilestones, ['Date', 'Milestone', 'Project', 'Priority'], (row) => (
        <tr key={`${row.project_code}-${row.title}`}>
          <td>{row.planned_date}</td>
          <td>{row.title}</td>
          <td>{row.project_title}<span className="rowsub">{row.institute}</span></td>
          <td>{row.is_critical ? <span className="flag flag--danger">Critical</span> : <span className="flag">Standard</span>}</td>
        </tr>
      ))}

      {section('Assistance requested', report.assistanceRequests, ['Project', 'Challenge', 'Support required', 'From'], (row) => (
        <tr key={row.id}>
          <td><Link className="rowlink" to={`/projects/${row.project_id}`}>{row.project_title}</Link><span className="rowsub">{row.institute}</span></td>
          <td>{row.title}</td>
          <td>{row.assistance_required}</td>
          <td>{row.support_source?.replace('_', ' ').toLowerCase() ?? '—'}</td>
        </tr>
      ))}

      <p className="card__hint" style={{ marginTop: '1rem' }}>
        This report contains only information within your authorized access scope.
      </p>
    </>
  );
}
