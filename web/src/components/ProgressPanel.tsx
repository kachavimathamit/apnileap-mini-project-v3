import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Card, ErrorMessage } from './ui';

/**
 * The draft -> review -> approval workflow for reported project progress.
 * A student's or mentor's number is never the official value - it only
 * becomes projects.completion_percentage once a reviewer approves it here.
 */
export interface ProgressSubmission {
  id: string;
  version: number;
  completion_percentage: number;
  work_completed: string | null;
  work_in_progress: string | null;
  work_planned_next: string | null;
  problems_encountered: string | null;
  support_required: string | null;
  expected_completion_date: string | null;
  student_remarks: string | null;
  proposed_rag_status: string | null;
  evidence: string | null;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  submitted_by_name: string | null;
  submitted_at: string | null;
  reviewed_by_name: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
}

const STATUS_FLAG: Record<string, string> = {
  DRAFT: '', PENDING_REVIEW: 'flag--warn', UNDER_REVIEW: 'flag--warn',
  APPROVED: 'flag--ok', REJECTED: 'flag--danger', CHANGES_REQUESTED: 'flag--danger',
};

const EMPTY_FORM = {
  completionPercentage: '0', workCompleted: '', workInProgress: '', workPlannedNext: '',
  problemsEncountered: '', supportRequired: '', expectedCompletionDate: '',
  studentRemarks: '', proposedRagStatus: '', evidence: '',
};

export function ProgressPanel({
  projectId, permissions, officialCompletion, onDone,
}: { projectId: string; permissions: string[]; officialCompletion: number; onDone: (message: string) => void }) {
  const [submissions, setSubmissions] = useState<ProgressSubmission[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const canSubmit = permissions.includes('progress:submit');
  const canReview = permissions.includes('progress:review');

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ submissions: ProgressSubmission[] }>(`/projects/${projectId}/progress`);
      setSubmissions(result.submissions);
    } catch (caught) {
      setError(caught);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function afterChange(message: string) {
    await load();
    onDone(message);
  }

  if (error) return <ErrorMessage error={error} />;
  if (!submissions) return <p className="empty">Loading progress history…</p>;

  const editable = submissions.filter((s) => ['DRAFT', 'CHANGES_REQUESTED'].includes(s.status));
  const pending = submissions.filter((s) => ['PENDING_REVIEW', 'UNDER_REVIEW'].includes(s.status));
  const changesRequested = submissions.filter((s) => s.status === 'CHANGES_REQUESTED');

  return (
    <>
      <Card title="Approved progress" hint="What every dashboard and report currently shows for this project">
        <p style={{ fontSize: 'var(--fs-display)', fontWeight: 700, margin: 0 }}>{officialCompletion}%</p>
        <p className="card__hint" style={{ marginTop: 'var(--sp-2)' }}>
          This changes only when a reviewer approves a submitted progress update below - never the moment
          someone types a new number.
        </p>
      </Card>

      {changesRequested.length > 0 && canSubmit && (
        <Alert kind="warn" title="Changes were requested">
          {changesRequested.map((s) => (
            <p key={s.id} style={{ margin: 0 }}>
              {s.reviewed_by_name}: “{s.review_comment}” — edit the submission below and resubmit it.
            </p>
          ))}
        </Alert>
      )}

      {canReview && pending.length > 0 && (
        <Card title="Awaiting your decision" hint="A comment is required to reject or request changes">
          {pending.map((submission) => (
            <ReviewDecision key={submission.id} projectId={projectId} submission={submission} onDone={afterChange} />
          ))}
        </Card>
      )}

      {canSubmit && (
        <Card title="Submit a progress update">
          {editable.length > 0 ? (
            editable.map((submission) => (
              <EditSubmissionForm key={submission.id} projectId={projectId} submission={submission} onDone={afterChange} />
            ))
          ) : (
            <NewSubmissionForm projectId={projectId} onDone={afterChange} />
          )}
        </Card>
      )}

      <Card title="Submission history" hint="Every version, decided or not, stays on the record">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th><th>Completion</th><th>Status</th><th>Submitted by</th>
                <th>Submitted</th><th>Reviewer</th><th>Decision comment</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td>v{s.version}</td>
                  <td className="numeric">{s.completion_percentage}%</td>
                  <td><span className={`flag ${STATUS_FLAG[s.status]}`}>{s.status.replace('_', ' ').toLowerCase()}</span></td>
                  <td>{s.submitted_by_name ?? <span className="rowsub">not yet submitted</span>}</td>
                  <td>{s.submitted_at?.slice(0, 16) ?? '—'}</td>
                  <td>{s.reviewed_by_name ?? '—'}</td>
                  <td>{s.review_comment ?? '—'}</td>
                </tr>
              ))}
              {submissions.length === 0 && <tr><td colSpan={7} className="table-empty">No progress has been submitted yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function NewSubmissionForm({ projectId, onDone }: { projectId: string; onDone: (m: string) => void }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function save(submitNow: boolean) {
    setError(null);
    setBusy(submitNow ? 'submit' : 'draft');
    try {
      await api.post(`/projects/${projectId}/progress`, {
        completionPercentage: Number(form.completionPercentage),
        workCompleted: form.workCompleted || undefined,
        workInProgress: form.workInProgress || undefined,
        workPlannedNext: form.workPlannedNext || undefined,
        problemsEncountered: form.problemsEncountered || undefined,
        supportRequired: form.supportRequired || undefined,
        expectedCompletionDate: form.expectedCompletionDate || undefined,
        studentRemarks: form.studentRemarks || undefined,
        proposedRagStatus: form.proposedRagStatus || undefined,
        evidence: form.evidence || undefined,
        submitNow,
      });
      setForm(EMPTY_FORM);
      onDone(submitNow ? 'Progress submitted for guide review.' : 'Draft saved.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return <ProgressFields form={form} set={set} onSaveDraft={() => save(false)} onSubmit={() => save(true)} error={error} busy={busy} />;
}

function EditSubmissionForm({
  projectId, submission, onDone,
}: { projectId: string; submission: ProgressSubmission; onDone: (m: string) => void }) {
  const [form, setForm] = useState({
    completionPercentage: String(submission.completion_percentage),
    workCompleted: submission.work_completed ?? '',
    workInProgress: submission.work_in_progress ?? '',
    workPlannedNext: submission.work_planned_next ?? '',
    problemsEncountered: submission.problems_encountered ?? '',
    supportRequired: submission.support_required ?? '',
    expectedCompletionDate: submission.expected_completion_date ?? '',
    studentRemarks: submission.student_remarks ?? '',
    proposedRagStatus: submission.proposed_rag_status ?? '',
    evidence: submission.evidence ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function save(submitNow: boolean) {
    setError(null);
    setBusy(submitNow ? 'submit' : 'draft');
    try {
      await api.patch(`/projects/${projectId}/progress/${submission.id}`, {
        completionPercentage: Number(form.completionPercentage),
        workCompleted: form.workCompleted || undefined,
        workInProgress: form.workInProgress || undefined,
        workPlannedNext: form.workPlannedNext || undefined,
        problemsEncountered: form.problemsEncountered || undefined,
        supportRequired: form.supportRequired || undefined,
        expectedCompletionDate: form.expectedCompletionDate || undefined,
        studentRemarks: form.studentRemarks || undefined,
        proposedRagStatus: form.proposedRagStatus || undefined,
        evidence: form.evidence || undefined,
        submitNow,
      });
      onDone(submitNow ? 'Progress resubmitted for guide review.' : 'Draft updated.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!window.confirm('Discard this draft? This cannot be undone.')) return;
    try {
      await api.del(`/projects/${projectId}/progress/${submission.id}`);
      onDone('The draft has been discarded.');
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <ProgressFields
      form={form} set={set} error={error} busy={busy}
      onSaveDraft={() => save(false)} onSubmit={() => save(true)}
      extraLabel={submission.status === 'CHANGES_REQUESTED' ? 'Editing v' + submission.version + ' — resubmit when ready' : 'Editing your draft'}
      onDiscard={submission.status === 'DRAFT' ? discard : undefined}
    />
  );
}

function ProgressFields({
  form, set, onSaveDraft, onSubmit, error, busy, extraLabel, onDiscard,
}: {
  form: typeof EMPTY_FORM; set: (key: keyof typeof EMPTY_FORM) => (e: { target: { value: string } }) => void;
  onSaveDraft: () => void; onSubmit: () => void; error: unknown; busy: 'draft' | 'submit' | null;
  extraLabel?: string; onDiscard?: () => void;
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} style={{ marginBottom: 'var(--sp-4)' }}>
      <ErrorMessage error={error} />
      {extraLabel && <p className="card__hint" style={{ marginBottom: 'var(--sp-3)' }}>{extraLabel}</p>}

      <div className="filters">
        <div className="field">
          <label>Completion (%) (required)</label>
          <input type="number" min={0} max={100} required value={form.completionPercentage} onChange={set('completionPercentage')} />
        </div>
        <div className="field">
          <label>Expected completion date</label>
          <input type="date" value={form.expectedCompletionDate} onChange={set('expectedCompletionDate')} />
        </div>
        <div className="field">
          <label>Proposed status (optional)</label>
          <select value={form.proposedRagStatus} onChange={set('proposedRagStatus')}>
            <option value="">No proposal</option>
            <option value="GREEN">Green</option>
            <option value="YELLOW">Yellow</option>
            <option value="RED">Red</option>
          </select>
        </div>
      </div>

      <div className="field"><label>Work completed</label><textarea value={form.workCompleted} onChange={set('workCompleted')} /></div>
      <div className="field"><label>Work currently in progress</label><textarea value={form.workInProgress} onChange={set('workInProgress')} /></div>
      <div className="field"><label>Work planned next</label><textarea value={form.workPlannedNext} onChange={set('workPlannedNext')} /></div>
      <div className="field"><label>Problems encountered</label><textarea value={form.problemsEncountered} onChange={set('problemsEncountered')} /></div>
      <div className="field"><label>Support required</label><textarea value={form.supportRequired} onChange={set('supportRequired')} /></div>
      <div className="field"><label>Supporting evidence</label><textarea value={form.evidence} onChange={set('evidence')} /></div>
      <div className="field"><label>Remarks</label><textarea value={form.studentRemarks} onChange={set('studentRemarks')} /></div>

      <div className="btn-row">
        <button type="button" onClick={onSaveDraft} disabled={busy !== null}>
          {busy === 'draft' ? 'Saving…' : 'Save Draft'}
        </button>
        <button type="submit" className="btn--primary" disabled={busy !== null}>
          {busy === 'submit' ? 'Submitting…' : 'Submit for Guide Review'}
        </button>
        {onDiscard && (
          <button type="button" className="btn--danger" onClick={onDiscard} disabled={busy !== null}>Discard draft</button>
        )}
      </div>
    </form>
  );
}

function ReviewDecision({
  projectId, submission, onDone,
}: { projectId: string; submission: ProgressSubmission; onDone: (m: string) => void }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED') {
    setError(null);
    setBusy(decision);
    try {
      await api.post(`/projects/${projectId}/progress/${submission.id}/decision`, { decision, comment: comment.trim() || undefined });
      onDone(`Submission ${decision === 'APPROVED' ? 'approved' : decision === 'REJECTED' ? 'rejected' : 'sent back for changes'}.`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
      <ErrorMessage error={error} />
      <h4>v{submission.version} — {submission.submitted_by_name} — {submission.completion_percentage}% complete</h4>
      <dl className="deflist">
        {submission.work_completed && <div><dt>Work completed</dt><dd>{submission.work_completed}</dd></div>}
        {submission.work_in_progress && <div><dt>In progress</dt><dd>{submission.work_in_progress}</dd></div>}
        {submission.work_planned_next && <div><dt>Planned next</dt><dd>{submission.work_planned_next}</dd></div>}
        {submission.problems_encountered && <div><dt>Problems</dt><dd>{submission.problems_encountered}</dd></div>}
        {submission.support_required && <div><dt>Support required</dt><dd>{submission.support_required}</dd></div>}
        {submission.evidence && <div><dt>Evidence</dt><dd>{submission.evidence}</dd></div>}
        {submission.proposed_rag_status && <div><dt>Proposed status</dt><dd>{submission.proposed_rag_status}</dd></div>}
      </dl>
      <div className="field">
        <label>Comment (required to reject or request changes)</label>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn--primary" onClick={() => decide('APPROVED')} disabled={busy !== null}>
          {busy === 'APPROVED' ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" className="btn--danger" onClick={() => decide('REJECTED')} disabled={busy !== null}>
          {busy === 'REJECTED' ? 'Rejecting…' : 'Reject'}
        </button>
        <button type="button" onClick={() => decide('CHANGES_REQUESTED')} disabled={busy !== null}>
          {busy === 'CHANGES_REQUESTED' ? 'Sending…' : 'Request Changes'}
        </button>
      </div>
    </div>
  );
}
