import { useState } from 'react';
import { api, type ProjectDetail } from '../api';
import { ErrorMessage } from './ui';

/**
 * Requirement 5.6 steps 1-5, plus the student input path from section 2.1.
 * Which forms appear depends entirely on the permissions the server returned for
 * this project - the UI never offers an action the API would refuse.
 */
export function IssueForms({ project, onDone }: { project: ProjectDetail; onDone: (message: string) => void }) {
  const can = (permission: string) => project.permissions.includes(permission);

  return (
    <>
      {can('issue:create') && <RaiseIssue projectId={project.project.id} onDone={onDone} />}
      {can('action:create') && <CreateAction project={project} onDone={onDone} />}
      {can('issue:update') && project.issues.some((i) => !['VERIFIED', 'CLOSED'].includes(i.status)) && (
        <UpdateIssue project={project} onDone={onDone} />
      )}
      {can('action:update') && project.actions.some((a) => ['OPEN', 'IN_PROGRESS'].includes(a.status)) && (
        <UpdateAction project={project} onDone={onDone} />
      )}
    </>
  );
}

function RaiseIssue({ projectId, onDone }: { projectId: string; onDone: (message: string) => void }) {
  const [form, setForm] = useState({
    title: '', description: '', rootCause: '', impact: '',
    assistanceRequired: '', supportSource: 'NONE', severity: 'MEDIUM', escalationLevel: 'NONE', evidence: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/issues`, {
        title: form.title,
        description: form.description,
        rootCause: form.rootCause || undefined,
        impact: form.impact || undefined,
        assistanceRequired: form.assistanceRequired || undefined,
        supportSource: form.supportSource,
        severity: form.severity,
        escalationLevel: form.escalationLevel,
        evidence: form.evidence || undefined,
      });
      setForm({
        title: '', description: '', rootCause: '', impact: '',
        assistanceRequired: '', supportSource: 'NONE', severity: 'MEDIUM', escalationLevel: 'NONE', evidence: '',
      });
      onDone('The challenge has been recorded.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Raise a challenge or blocker</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="field">
          <label htmlFor="issue-title">What is the challenge? (required)</label>
          <input id="issue-title" type="text" required minLength={5} value={form.title} onChange={set('title')} />
        </div>
        <div className="field">
          <label htmlFor="issue-desc">Describe the blocker (required)</label>
          <textarea id="issue-desc" required minLength={10} value={form.description} onChange={set('description')} />
        </div>
        <div className="field">
          <label htmlFor="issue-cause">Root cause</label>
          <textarea id="issue-cause" value={form.rootCause} onChange={set('rootCause')} />
        </div>
        <div className="field">
          <label htmlFor="issue-impact">Impact on deliverables or learning outcomes</label>
          <textarea id="issue-impact" value={form.impact} onChange={set('impact')} />
        </div>
        <div className="field">
          <label htmlFor="issue-help">Support required</label>
          <textarea id="issue-help" value={form.assistanceRequired} onChange={set('assistanceRequired')} />
        </div>
        <div className="field">
          <label htmlFor="issue-evidence">Evidence available</label>
          <textarea id="issue-evidence" value={form.evidence} onChange={set('evidence')} />
        </div>
        <div className="filters" style={{ marginBottom: '0.85rem' }}>
          <div className="field">
            <label htmlFor="issue-severity">Severity</label>
            <select id="issue-severity" value={form.severity} onChange={set('severity')}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="issue-source">Support source</label>
            <select id="issue-source" value={form.supportSource} onChange={set('supportSource')}>
              <option value="NONE">None required</option>
              <option value="DEPARTMENT">Department</option>
              <option value="INSTITUTE">Institute</option>
              <option value="INDUSTRY_PARTNER">Industry partner</option>
              <option value="APNILEAP">ApniLeap</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="issue-escalation">Escalation level</label>
            <select id="issue-escalation" value={form.escalationLevel} onChange={set('escalationLevel')}>
              <option value="NONE">Not escalated</option>
              <option value="DEPARTMENT">Department</option>
              <option value="INSTITUTE">Institute</option>
              <option value="PROGRAMME">Programme</option>
              <option value="INDUSTRY">Industry</option>
            </select>
          </div>
        </div>
        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Recording…' : 'Record challenge'}
        </button>
      </form>
    </details>
  );
}

function CreateAction({ project, onDone }: { project: ProjectDetail; onDone: (message: string) => void }) {
  const [issueId, setIssueId] = useState('');
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const candidates = project.members.filter((member) => member.email);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${project.project.id}/actions`, {
        issueId: issueId || undefined,
        description,
        ownerUserId: ownerUserId || undefined,
        ownerName: ownerUserId ? undefined : ownerName || undefined,
        dueDate,
      });
      setDescription(''); setOwnerName(''); setOwnerUserId(''); setDueDate(''); setIssueId('');
      onDone('The corrective action has been created.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Create a corrective action</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="field">
          <label htmlFor="action-issue">Linked challenge (optional)</label>
          <select id="action-issue" value={issueId} onChange={(e) => setIssueId(e.target.value)}>
            <option value="">Not linked to a specific challenge</option>
            {project.issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="action-desc">What will be done? (required)</label>
          <textarea id="action-desc" required minLength={10} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="filters" style={{ marginBottom: '0.85rem' }}>
          <div className="field">
            <label htmlFor="action-owner">Owner (portal user)</label>
            <select id="action-owner" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
              <option value="">Name someone not in the list</option>
              {candidates.map((member) => (
                <option key={member.id} value={(member as { user_id?: string }).user_id ?? ''}>{member.name}</option>
              ))}
            </select>
          </div>
          {!ownerUserId && (
            <div className="field">
              <label htmlFor="action-owner-name">Owner name</label>
              <input id="action-owner-name" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="action-due">Target resolution date (required)</label>
            <input id="action-due" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create corrective action'}
        </button>
      </form>
    </details>
  );
}

function UpdateIssue({ project, onDone }: { project: ProjectDetail; onDone: (message: string) => void }) {
  const open = project.issues.filter((issue) => !['VERIFIED', 'CLOSED'].includes(issue.status));
  const [issueId, setIssueId] = useState(open[0]?.id ?? '');
  const [status, setStatus] = useState('IN_PROGRESS');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const needsEvidence = ['RESOLVED', 'VERIFIED', 'CLOSED'].includes(status);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/projects/${project.project.id}/issues/${issueId}`, {
        status,
        evidence: evidence.trim() || undefined,
      });
      setEvidence('');
      onDone('The challenge has been updated.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Update or close a challenge</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="filters" style={{ marginBottom: '0.85rem' }}>
          <div className="field">
            <label htmlFor="upd-issue">Challenge</label>
            <select id="upd-issue" value={issueId} onChange={(e) => setIssueId(e.target.value)}>
              {open.map((issue) => <option key={issue.id} value={issue.id}>{issue.title}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="upd-issue-status">New status</label>
            <select id="upd-issue-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="VERIFIED">Verified</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="upd-issue-evidence">Evidence{needsEvidence ? ' (required)' : ' (optional)'}</label>
          <p className="hint">A challenge cannot be marked resolved, verified or closed without evidence.</p>
          <textarea
            id="upd-issue-evidence" value={evidence} required={needsEvidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </div>
        <button type="submit" className="btn--primary" disabled={busy || !issueId}>
          {busy ? 'Saving…' : 'Update challenge'}
        </button>
      </form>
    </details>
  );
}

function UpdateAction({ project, onDone }: { project: ProjectDetail; onDone: (message: string) => void }) {
  const open = project.actions.filter((action) => ['OPEN', 'IN_PROGRESS'].includes(action.status));
  const canVerify = project.permissions.includes('action:verify');
  const [actionId, setActionId] = useState(open[0]?.id ?? '');
  const [status, setStatus] = useState('IN_PROGRESS');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const needsEvidence = ['COMPLETED', 'VERIFIED'].includes(status);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/projects/${project.project.id}/actions/${actionId}`, {
        status,
        evidence: evidence.trim() || undefined,
      });
      setEvidence('');
      onDone('The corrective action has been updated.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Progress a corrective action</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="filters" style={{ marginBottom: '0.85rem' }}>
          <div className="field">
            <label htmlFor="upd-action">Action</label>
            <select id="upd-action" value={actionId} onChange={(e) => setActionId(e.target.value)}>
              {open.map((action) => (
                <option key={action.id} value={action.id}>
                  {action.description.slice(0, 70)}{action.description.length > 70 ? '…' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="upd-action-status">New status</label>
            <select id="upd-action-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              {canVerify && <option value="VERIFIED">Verified</option>}
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
        {!canVerify && (
          <p className="card__hint" style={{ marginBottom: '0.6rem' }}>
            Verification is reserved for reviewers, department heads and administrators, so completed work is
            confirmed by someone other than the person who did it.
          </p>
        )}
        <div className="field">
          <label htmlFor="upd-action-evidence">Evidence{needsEvidence ? ' (required)' : ' (optional)'}</label>
          <textarea
            id="upd-action-evidence" value={evidence} required={needsEvidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </div>
        <button type="submit" className="btn--primary" disabled={busy || !actionId}>
          {busy ? 'Saving…' : 'Update action'}
        </button>
      </form>
    </details>
  );
}
