import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Card, ErrorMessage } from './ui';

interface Criterion { name: string; maxMarks: number; description?: string }
interface Rubric { id: string; title: string; description: string | null; criteria: Criterion[] }
interface ScheduledReview {
  id: string; review_number: number; title: string; status: 'PLANNED' | 'COMPLETED';
  rubric_id: string; rubric_title: string; rubric_criteria: Criterion[];
}

/**
 * The rubric-driven review workflow: a mentor defines one rubric, generates
 * "Review 1/2/3" slots across every team they guide from it in one action,
 * then conducts each slot with scores checked against that same rubric.
 */
export function ScheduledReviewsPanel({
  projectId, canManageRubrics, onDone,
}: { projectId: string; canManageRubrics: boolean; onDone: (m: string) => void }) {
  const [slots, setSlots] = useState<ScheduledReview[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ scheduledReviews: ScheduledReview[] }>(`/projects/${projectId}/scheduled-reviews`);
      setSlots(result.scheduledReviews);
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

  const planned = (slots ?? []).filter((s) => s.status === 'PLANNED');
  const completed = (slots ?? []).filter((s) => s.status === 'COMPLETED');

  return (
    <>
      {canManageRubrics && <RubricManager onDone={afterChange} />}

      {slots !== null && slots.length > 0 && (
        <Card title="Scheduled reviews" hint="Generated from a rubric so every team is judged on the same criteria">
          {planned.map((slot) => (
            <ConductForm key={slot.id} projectId={projectId} slot={slot} onDone={afterChange} />
          ))}
          {completed.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Rubric</th><th>Status</th></tr></thead>
                <tbody>
                  {completed.map((s) => (
                    <tr key={s.id}>
                      <td>{s.title}</td>
                      <td>{s.rubric_title}</td>
                      <td><span className="flag flag--ok">completed</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function RubricManager({ onDone }: { onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [criteria, setCriteria] = useState<Criterion[]>([{ name: '', maxMarks: 10 }]);
  const [rubrics, setRubrics] = useState<Rubric[] | null>(null);
  const [selectedRubricId, setSelectedRubricId] = useState('');
  const [reviewCount, setReviewCount] = useState('3');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'create' | 'generate' | null>(null);

  async function loadRubrics() {
    try {
      const result = await api.get<{ rubrics: Rubric[] }>('/rubrics');
      setRubrics(result.rubrics);
      if (result.rubrics.length && !selectedRubricId) setSelectedRubricId(result.rubrics[0].id);
    } catch (caught) {
      setError(caught);
    }
  }

  useEffect(() => { void loadRubrics(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateCriterion(index: number, patch: Partial<Criterion>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  async function createRubric(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy('create');
    try {
      // The rubric just needs one institute the caller can already reach; the
      // server checks every later request (generate, conduct) against scope.
      const instRes = await api.get<{ institutes: { id: string }[] }>('/institutes');
      const instituteId = instRes.institutes[0]?.id;
      if (!instituteId) throw new Error('No institute available.');

      await api.post('/rubrics', { instituteId, title: title.trim(), criteria: criteria.filter((c) => c.name.trim()) });
      setTitle('');
      setCriteria([{ name: '', maxMarks: 10 }]);
      setOpen(false);
      await loadRubrics();
      onDone('The rubric has been created.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setError(null);
    setBusy('generate');
    try {
      const result = await api.post<{ teamsAffected: number; created: number; skipped: number }>(
        `/rubrics/${selectedRubricId}/generate-reviews`,
        { reviewCount: Number(reviewCount) },
      );
      onDone(
        `Generated ${result.created} review slot(s) across ${result.teamsAffected} team(s)` +
        (result.skipped ? ` (${result.skipped} already existed).` : '.'),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Review rubrics" hint="Define criteria once, then generate the same review rounds across every team you guide">
      <ErrorMessage error={error} />

      {rubrics && rubrics.length > 0 && (
        <div className="filters" style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="field">
            <label htmlFor="rubric-select">Your rubrics</label>
            <select id="rubric-select" value={selectedRubricId} onChange={(e) => setSelectedRubricId(e.target.value)}>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>{r.title} ({r.criteria.length} criteria)</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="review-count">Number of reviews</label>
            <input id="review-count" type="number" min={1} max={10} value={reviewCount} onChange={(e) => setReviewCount(e.target.value)} />
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn--primary" onClick={generate} disabled={busy !== null || !selectedRubricId}>
              {busy === 'generate' ? 'Generating…' : 'Generate reviews for all my teams'}
            </button>
          </div>
        </div>
      )}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>+ New rubric</button>
      ) : (
        <form onSubmit={createRubric}>
          <div className="field">
            <label htmlFor="rubric-title">Rubric title</label>
            <input id="rubric-title" type="text" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {criteria.map((c, i) => (
            <div className="filters" key={i} style={{ marginBottom: 'var(--sp-2)' }}>
              <div className="field">
                <label>Criterion name</label>
                <input type="text" required minLength={2} value={c.name} onChange={(e) => updateCriterion(i, { name: e.target.value })} />
              </div>
              <div className="field">
                <label>Max marks</label>
                <input type="number" min={0} required value={c.maxMarks} onChange={(e) => updateCriterion(i, { maxMarks: Number(e.target.value) })} />
              </div>
            </div>
          ))}
          <div className="btn-row" style={{ marginBottom: 'var(--sp-3)' }}>
            <button type="button" className="btn--sm" onClick={() => setCriteria((prev) => [...prev, { name: '', maxMarks: 10 }])}>
              + Add criterion
            </button>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn--primary" disabled={busy !== null}>
              {busy === 'create' ? 'Saving…' : 'Save rubric'}
            </button>
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </Card>
  );
}

function ConductForm({
  projectId, slot, onDone,
}: { projectId: string; slot: ScheduledReview; onDone: (m: string) => void }) {
  const [decision, setDecision] = useState('NOTED');
  const [comments, setComments] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const numericScores: Record<string, number> = {};
      for (const [key, value] of Object.entries(scores)) {
        if (value.trim() !== '') numericScores[key] = Number(value);
      }
      await api.post(`/projects/${projectId}/scheduled-reviews/${slot.id}/conduct`, {
        decision, comments,
        scores: Object.keys(numericScores).length ? numericScores : undefined,
      });
      onDone(`${slot.title} has been recorded.`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel">
      <ErrorMessage error={error} />
      <h4>{slot.title} — {slot.rubric_title}</h4>
      <div className="filters" style={{ marginBottom: 'var(--sp-3)' }}>
        {slot.rubric_criteria.map((c) => (
          <div className="field" key={c.name}>
            <label htmlFor={`score-${slot.id}-${c.name}`}>{c.name} (max {c.maxMarks})</label>
            <input
              id={`score-${slot.id}-${c.name}`} type="number" min={0} max={c.maxMarks}
              value={scores[c.name] ?? ''} onChange={(e) => setScores((prev) => ({ ...prev, [c.name]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor={`decision-${slot.id}`}>Decision</label>
        <select id={`decision-${slot.id}`} value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="NOTED">Noted</option>
          <option value="APPROVED">Approved</option>
          <option value="CHANGES_REQUESTED">Changes requested</option>
          <option value="EVIDENCE_REQUESTED">Evidence requested</option>
          <option value="ESCALATED">Escalated</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`comments-${slot.id}`}>Comments (required)</label>
        <textarea id={`comments-${slot.id}`} required minLength={10} value={comments} onChange={(e) => setComments(e.target.value)} />
      </div>
      <button type="submit" className="btn--primary" disabled={busy}>
        {busy ? 'Recording…' : `Record ${slot.title}`}
      </button>
    </form>
  );
}
