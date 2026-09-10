import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, ErrorMessage, Loading } from '../components/ui';

interface PendingRow {
  id: string;
  project_id: string;
  version: number;
  completion_percentage: number;
  submitted_by_name: string | null;
  submitted_at: string | null;
  project_code: string;
  project_title: string;
  institute_short_name: string;
  department_name: string;
}

/**
 * The guide/coordinator/head review queue: every progress submission awaiting
 * a decision, scoped exactly like every other project read - nothing from
 * outside the reviewer's authorized institutes or departments appears here.
 */
export function PendingReviewsPage() {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.get<{ submissions: PendingRow[] }>('/me/pending-reviews')
      .then((result) => setRows(result.submissions))
      .catch(setError);
  }, []);

  if (error) return <ErrorMessage error={error} />;
  if (!rows) return <Loading what="pending reviews" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pending reviews</h1>
          <p>{rows.length} progress submission{rows.length === 1 ? '' : 's'} awaiting your decision.</p>
        </div>
      </div>

      <Card>
        {rows.length === 0 ? (
          <p className="empty">Nothing is currently waiting on you.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th><th>Submitted by</th><th>Version</th>
                  <th>Completion</th><th>Submitted</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className="rowlink" to={`/projects/${row.project_id}?tab=progress`}>{row.project_title}</Link>
                      <span className="rowsub">{row.project_code} · {row.institute_short_name} · {row.department_name}</span>
                    </td>
                    <td>{row.submitted_by_name ?? '—'}</td>
                    <td>v{row.version}</td>
                    <td className="numeric">{row.completion_percentage}%</td>
                    <td>{row.submitted_at?.slice(0, 16) ?? '—'}</td>
                    <td><Link className="rowlink" to={`/projects/${row.project_id}?tab=progress`}>Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
