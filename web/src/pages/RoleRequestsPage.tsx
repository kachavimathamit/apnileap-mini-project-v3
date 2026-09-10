import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Card, ErrorMessage, Loading } from '../components/ui';

interface RoleRequest {
  id: string;
  email: string;
  full_name: string;
  designation: string | null;
  institute_name: string;
  department_name: string;
  created_at: string;
}

/** Department Head / Institute Administrator / Platform Administrator queue for approving Faculty Mentor registrations. */
export function RoleRequestsPage() {
  const [requests, setRequests] = useState<RoleRequest[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ requests: RoleRequest[] }>('/admin/role-requests');
      setRequests(result.requests);
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorMessage error={error} />;
  if (!requests) return <Loading what="pending registrations" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mentor registrations</h1>
          <p>{requests.length} registration{requests.length === 1 ? '' : 's'} awaiting your decision.</p>
        </div>
      </div>

      {requests.length === 0 ? (
        <Card><p className="empty">Nothing is waiting on you.</p></Card>
      ) : (
        requests.map((request) => <RequestRow key={request.id} request={request} onDone={load} />)
      )}
    </>
  );
}

function RequestRow({ request, onDone }: { request: RoleRequest; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setError(null);
    setBusy(decision);
    try {
      await api.post(`/admin/role-requests/${request.id}/decision`, { decision, comment: comment.trim() || undefined });
      onDone();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <ErrorMessage error={error} />
      <h3>{request.full_name}</h3>
      <p className="card__hint">
        {request.email}{request.designation ? ` · ${request.designation}` : ''}<br />
        Requesting Faculty Mentor access to {request.institute_name} · {request.department_name}
      </p>
      <div className="field">
        <label>Comment (required to reject)</label>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn--primary" onClick={() => decide('APPROVED')} disabled={busy !== null}>
          {busy === 'APPROVED' ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" className="btn--danger" onClick={() => decide('REJECTED')} disabled={busy !== null}>
          {busy === 'REJECTED' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </Card>
  );
}
