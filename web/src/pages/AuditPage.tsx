import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Card, ErrorMessage, Loading } from '../components/ui';

interface AuditEntry {
  id: string;
  occurred_at: string;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  institute_id: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  ip_address: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * Requirement 7: logins, failed authorization, views of sensitive records, edits,
 * exports and status changes. The table is append-only in the database.
 */
export function AuditPage() {
  const [outcome, setOutcome] = useState('');
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '300' });
    if (outcome) params.set('outcome', outcome);
    if (action.trim()) params.set('action', action.trim());
    return params.toString();
  }, [outcome, action]);

  useEffect(() => {
    let cancelled = false;
    api.get<{ entries: AuditEntry[] }>(`/admin/audit?${query}`)
      .then((result) => { if (!cancelled) setEntries(result.entries); })
      .catch((caught) => { if (!cancelled) setError(caught); });
    return () => { cancelled = true; };
  }, [query]);

  if (error) return <ErrorMessage error={error} />;
  if (!entries) return <Loading what="the audit trail" />;

  const denied = entries.filter((entry) => entry.outcome === 'DENIED').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p>
            {entries.length} most recent events within your authorized scope · {denied} refused.
            Entries cannot be edited or deleted.
          </p>
        </div>
      </div>

      <Card>
        <div className="filters" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label htmlFor="a-outcome">Outcome</label>
            <select id="a-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">All outcomes</option>
              <option value="SUCCESS">Success</option>
              <option value="DENIED">Denied</option>
              <option value="FAILURE">Failure</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-action">Action contains</label>
            <input
              id="a-action" type="text" value={action} onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. CROSS_TENANT, STATUS, LOGIN"
            />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Outcome</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{entry.occurred_at.slice(0, 19)}</td>
                  <td>{entry.actor_email ?? 'anonymous'}<span className="rowsub">{entry.ip_address ?? ''}</span></td>
                  <td>{entry.action.replace(/_/g, ' ').toLowerCase()}</td>
                  <td>{entry.entity_type ?? '—'}<span className="rowsub">{entry.entity_id ?? ''}</span></td>
                  <td>
                    <span className={`flag ${entry.outcome === 'DENIED' || entry.outcome === 'FAILURE' ? 'flag--danger' : 'flag--ok'}`}>
                      {entry.outcome.toLowerCase()}
                    </span>
                  </td>
                  <td style={{ maxWidth: '26rem', overflowWrap: 'anywhere' }}>
                    {entry.detail ? JSON.stringify(entry.detail) : '—'}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && <tr><td colSpan={6} className="table-empty">No audit entries match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
