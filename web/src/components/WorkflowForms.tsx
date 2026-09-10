import { useState } from 'react';
import { api, type ProjectDetail } from '../api';
import { ErrorMessage } from './ui';

/** Approve or reject a student team a guide entered. */
export function MemberDecisionButtons({
  projectId, memberId, onDone,
}: { projectId: string; memberId: string; onDone: (m: string) => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [comment, setComment] = useState('');

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setError(null);
    setBusy(decision);
    try {
      await api.post(`/projects/${projectId}/members/${memberId}/decision`, { decision, comment: comment.trim() || undefined });
      onDone(decision === 'APPROVED' ? 'The team member has been approved.' : 'The team member has been rejected.');
    } catch (caught) {
      setError(caught);
      setBusy(null);
    }
  }

  return (
    <div>
      <ErrorMessage error={error} />
      {showReject ? (
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          <input
            type="text" placeholder="Reason (required)" value={comment}
            onChange={(e) => setComment(e.target.value)} style={{ width: '14rem' }}
          />
          <button type="button" className="btn--sm btn--danger" disabled={busy !== null} onClick={() => decide('REJECTED')}>
            Confirm reject
          </button>
          <button type="button" className="btn--sm" onClick={() => setShowReject(false)}>Cancel</button>
        </div>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn--sm btn--primary" disabled={busy !== null} onClick={() => decide('APPROVED')}>
            {busy === 'APPROVED' ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" className="btn--sm btn--danger" onClick={() => setShowReject(true)}>Reject</button>
        </div>
      )}
    </div>
  );
}

interface EligibleGuide { id: string; email: string; full_name: string; designation: string | null }

/** Coordinator allocates a project to an approved guide, picked from the set of mentors who actually reach it. */
export function AssignGuideForm({ projectId, onDone }: { projectId: string; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mentors, setMentors] = useState<EligibleGuide[] | null>(null);
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function openForm() {
    setOpen(true);
    setError(null);
    try {
      const result = await api.get<{ mentors: EligibleGuide[] }>(`/projects/${projectId}/eligible-guides`);
      setMentors(result.mentors);
      if (result.mentors.length) setUserId(result.mentors[0].id);
    } catch (caught) {
      setError(caught);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/assign-guide`, { userId });
      setOpen(false);
      onDone('The guide has been allocated to this project.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="button" onClick={openForm}>Assign / reassign guide</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-3)' }}>
      <ErrorMessage error={error} />
      <p className="hint">Only mentors whose approved grant already reaches this project appear here. Assigning a new guide retires the previous one.</p>
      {mentors === null ? (
        <p className="empty">Loading eligible mentors…</p>
      ) : mentors.length === 0 ? (
        <p className="empty">No approved Faculty Mentor reaches this project yet. Their registration may still be pending.</p>
      ) : (
        <div className="inline-form">
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {mentors.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.email})</option>)}
          </select>
          <button type="submit" className="btn--primary" disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</button>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 'var(--sp-2)' }}>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** Guide freezes/unfreezes the project definition, locking students out of it. */
export function FreezeControls({
  projectId, frozen, onDone,
}: { projectId: string; frozen: boolean; onDone: (m: string) => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/${frozen ? 'unfreeze' : 'freeze'}`);
      onDone(frozen ? 'The project definition has been unfrozen.' : 'The project definition is now frozen.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ErrorMessage error={error} />
      <button type="button" className="btn--sm" onClick={toggle} disabled={busy}>
        {busy ? 'Working…' : frozen ? 'Unfreeze definition' : 'Freeze definition'}
      </button>
    </div>
  );
}

const DEFINITION_FIELDS = [
  ['title', 'Project title / theme'],
  ['need_statement', 'needStatement', 'Need statement'],
  ['problem_statement', 'problemStatement', 'Problem statement'],
  ['objective', 'objective', 'Objective'],
  ['learning_outcomes', 'learningOutcomes', 'Learning outcomes'],
  ['foundation_courses', 'foundationCourses', 'Foundation courses anchored'],
  ['functional_blocks', 'functionalBlocks', 'Functional blocks'],
  ['interfaces', 'interfaces', 'Interfaces'],
  ['dependencies', 'dependencies', 'Dependencies'],
  ['expected_deliverables', 'expectedDeliverables', 'Expected deliverables'],
] as const;

/**
 * Requirement: "students must have edit access... theme, title and other
 * details" - reachable through /projects/:id/definition, which the server
 * blocks once the guide has frozen the project (unless the actor also holds
 * project:update, i.e. is the guide or staff).
 */
export function DefinitionEditForm({
  project, locked, onDone,
}: { project: ProjectDetail['project']; locked: boolean; onDone: (m: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({
    title: project.title,
    needStatement: project.need_statement ?? '',
    problemStatement: project.problem_statement ?? '',
    objective: project.objective ?? '',
    learningOutcomes: project.learning_outcomes ?? '',
    foundationCourses: project.foundation_courses ?? '',
    functionalBlocks: project.functional_blocks ?? '',
    interfaces: project.interfaces ?? '',
    dependencies: project.dependencies ?? '',
    expectedDeliverables: project.expected_deliverables ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/projects/${project.id}/definition`, values);
      onDone('The project definition has been updated.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ErrorMessage error={error} />
      {locked && <p className="hint">This project's definition is frozen and can no longer be edited here.</p>}

      <div className="field">
        <label htmlFor="def-title">Project title / theme</label>
        <input
          id="def-title" type="text" required minLength={3} disabled={locked}
          value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
        />
      </div>

      {DEFINITION_FIELDS.slice(1).map(([, key, label]) => (
        <div className="field" key={key}>
          <label htmlFor={`def-${key}`}>{label}</label>
          <textarea
            id={`def-${key}`} disabled={locked}
            value={values[key]} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
          />
        </div>
      ))}

      <button type="submit" className="btn--primary" disabled={busy || locked}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
