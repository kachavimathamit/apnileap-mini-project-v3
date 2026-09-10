import { useState } from 'react';
import { api, type RagStatus } from '../api';
import { Alert, ErrorMessage, StatusBadge } from './ui';

/**
 * Requirement 5.6 / 6. The form states the governance rule up front rather than
 * letting the user discover it through a rejection: a return to Green needs
 * evidence, reviewer approval, and no open high-severity work.
 */
export function StatusChangeForm({
  projectId, currentStatus, canApprove, blockers, onDone,
}: {
  projectId: string;
  currentStatus: RagStatus;
  canApprove: boolean;
  blockers: { criticalIssues: number; overdueActions: number };
  onDone: () => void;
}) {
  const options = (['GREEN', 'YELLOW', 'RED'] as RagStatus[]).filter((status) => status !== currentStatus);
  const [newStatus, setNewStatus] = useState<RagStatus>(options[0]);
  const [rationale, setRationale] = useState('');
  const [evidence, setEvidence] = useState('');
  const [nextReviewDate, setNextReviewDate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const recoveringToGreen = currentStatus === 'RED' && newStatus === 'GREEN';
  const blocked = recoveringToGreen && (blockers.criticalIssues > 0 || blockers.overdueActions > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/status`, {
        newStatus,
        rationale,
        evidence: evidence.trim() || undefined,
        nextReviewDate: nextReviewDate || undefined,
      });
      setRationale(''); setEvidence(''); setNextReviewDate('');
      onDone();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ErrorMessage error={error} />

      {recoveringToGreen && !canApprove && (
        <Alert kind="warn" title="Reviewer approval is required">
          Your role can propose a status but cannot approve a return to Green from Red. Record Yellow instead,
          or ask a reviewer, department head or administrator to approve the change.
        </Alert>
      )}

      {blocked && (
        <Alert kind="error" title="This project is not yet eligible to return to Green">
          <ul>
            {blockers.criticalIssues > 0 && (
              <li>{blockers.criticalIssues} high or critical challenge(s) are still open.</li>
            )}
            {blockers.overdueActions > 0 && (
              <li>{blockers.overdueActions} corrective action(s) are overdue.</li>
            )}
          </ul>
        </Alert>
      )}

      <div className="filters">
        <div className="field">
          <label htmlFor="new-status">New status</label>
          <select id="new-status" value={newStatus} onChange={(e) => setNewStatus(e.target.value as RagStatus)}>
            {options.map((status) => (
              <option key={status} value={status}>{status.charAt(0)}{status.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="next-review">Next review date (optional)</label>
          <input id="next-review" type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} />
        </div>
        <div className="field" style={{ alignSelf: 'end' }}>
          <span className="card__hint">
            Moving from <StatusBadge status={currentStatus} short /> to <StatusBadge status={newStatus} short />
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rationale">Rationale (required)</label>
        <p className="hint">
          Why is the status changing? This is preserved permanently against the project, with your name and the time.
        </p>
        <textarea
          id="rationale" required minLength={10} value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="For example: the actuator supply is blocked at customs and both critical milestones are missed."
        />
      </div>

      <div className="field">
        <label htmlFor="evidence">
          Evidence{recoveringToGreen ? ' (required to return to Green)' : ' (optional)'}
        </label>
        <p className="hint">
          What demonstrates this? Reference a document, measurement, demonstration or attached report.
        </p>
        <textarea
          id="evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)}
          required={recoveringToGreen}
          placeholder="For example: bench test log dated 12 August plus delivery note, both reviewed on the call."
        />
      </div>

      <button type="submit" className="btn--primary" disabled={busy || blocked || (recoveringToGreen && !canApprove)}>
        {busy ? 'Recording…' : 'Record status change'}
      </button>
    </form>
  );
}
