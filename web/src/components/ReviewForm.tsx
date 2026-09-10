import { useState } from 'react';
import { api, type RagStatus } from '../api';
import { ErrorMessage } from './ui';

/**
 * Short labels keep the select readable at any column width; the meaning of the
 * current choice is spelled out underneath instead of being crammed into the
 * option text, where the browser would truncate it.
 */
const DECISIONS = [
  ['NOTED', 'Noted', 'Progress reviewed. Nothing is being requested of the team.'],
  ['APPROVED', 'Approved', 'The recorded status and its evidence are accepted.'],
  ['CHANGES_REQUESTED', 'Changes requested', 'Specific work must be completed before the next review.'],
  ['EVIDENCE_REQUESTED', 'Evidence requested', 'The update is returned for proof before it can be accepted.'],
  ['ESCALATED', 'Escalated', 'Support is required beyond this level of the programme.'],
] as const;

export function ReviewForm({
  projectId, currentStatus, onDone,
}: { projectId: string; currentStatus: RagStatus; onDone: () => void }) {
  const [decision, setDecision] = useState<string>('NOTED');
  const [comments, setComments] = useState('');
  const [recommendedStatus, setRecommendedStatus] = useState<string>('');
  const [summary, setSummary] = useState('');
  const [nextReviewDate, setNextReviewDate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/reviews`, {
        decision,
        comments,
        recommendedStatus: recommendedStatus || undefined,
        correctiveActionSummary: summary.trim() || undefined,
        nextReviewDate: nextReviewDate || undefined,
      });
      setComments(''); setSummary(''); setNextReviewDate(''); setRecommendedStatus('');
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

      <div className="filters">
        <div className="field">
          <label htmlFor="decision">Decision</label>
          <select id="decision" value={decision} onChange={(e) => setDecision(e.target.value)}>
            {DECISIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="recommended">Recommended status (optional)</label>
          <select id="recommended" value={recommendedStatus} onChange={(e) => setRecommendedStatus(e.target.value)}>
            <option value="">No recommendation</option>
            <option value="GREEN">Green - On Track</option>
            <option value="YELLOW">Yellow - At Risk</option>
            <option value="RED">Red - Intervention Required</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="review-next">Next review date</label>
          <input id="review-next" type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} />
        </div>
      </div>

      {/* Kept out of the .filters grid row itself - the row's boxes bottom-align
          to each other on the assumption every field is just a label + one
          control, and an extra paragraph inside one of them breaks that. */}
      <p className="hint" style={{ marginTop: 0, marginBottom: 'var(--sp-3)' }}>
        {DECISIONS.find(([value]) => value === decision)?.[2]}
      </p>

      <p className="card__hint" style={{ marginBottom: '0.6rem' }}>
        A recommendation does not change the status by itself. The current status is{' '}
        <strong>{currentStatus.toLowerCase()}</strong>; record the change separately from the Overview tab.
      </p>

      <div className="field">
        <label htmlFor="comments">Review comments (required)</label>
        <textarea
          id="comments" required minLength={10} value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="What was demonstrated, what was accepted, and what must happen before the next review."
        />
      </div>

      <div className="field">
        <label htmlFor="summary">Corrective action summary (optional)</label>
        <textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>

      <button type="submit" className="btn--primary" disabled={busy}>
        {busy ? 'Recording…' : 'Record review'}
      </button>
    </form>
  );
}
