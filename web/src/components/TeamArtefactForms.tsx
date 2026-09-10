import { useState } from 'react';
import { api, type ProjectDetail } from '../api';
import { Alert, ErrorMessage } from './ui';

/**
 * Team membership, repository links and document links.
 *
 * Requirement 8: the portal stores a *link* to code and files, never the files
 * themselves — GitHub keeps the source and object storage keeps large documents.
 * Stakeholder decision 15: student names are optional, so a team identifier is
 * always accepted on its own.
 */

export function AddMemberForm({
  projectId, onDone,
}: { projectId: string; onDone: (message: string) => void }) {
  const [memberRole, setMemberRole] = useState('STUDENT');
  const [displayName, setDisplayName] = useState('');
  const [teamIdentifier, setTeamIdentifier] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/members`, {
        memberRole,
        displayName: displayName.trim() || undefined,
        teamIdentifier: teamIdentifier.trim() || undefined,
      });
      setDisplayName(''); setTeamIdentifier('');
      onDone('The team member has been added.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Add a team member</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <div className="filters" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="field">
            <label htmlFor="tm-role">Role on the project</label>
            <select id="tm-role" value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
              <option value="STUDENT">Student</option>
              <option value="FACULTY_MENTOR">Faculty mentor</option>
              <option value="CO_MENTOR">Co-mentor</option>
              <option value="REVIEWER">Reviewer</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tm-team">Team identifier</label>
            <p className="hint">e.g. KLE-CSE-2026-05-TEAM</p>
            <input id="tm-team" type="text" value={teamIdentifier} onChange={(e) => setTeamIdentifier(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tm-name">Name (optional)</label>
            <input id="tm-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        </div>
        <p className="hint">
          Provide a name or a team identifier — either is enough. Student names are optional by
          design, so a team can be recorded by identifier alone where the institute prefers that.
        </p>
        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add team member'}
        </button>
      </form>
    </details>
  );
}

export function AddRepositoryForm({
  projectId, onDone,
}: { projectId: string; onDone: (message: string) => void }) {
  const [label, setLabel] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [visibility, setVisibility] = useState('PRIVATE');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/repositories`, {
        label: label.trim(),
        repoUrl: repoUrl.trim(),
        visibility,
      });
      setLabel(''); setRepoUrl('');
      onDone('The repository has been linked.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Link a source repository</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <Alert kind="info">
          Only the link is stored here. Who may open the repository is still decided by GitHub, not
          by this portal.
        </Alert>
        <div className="field">
          <label htmlFor="rp-label">Label (required)</label>
          <input id="rp-label" type="text" required minLength={2} placeholder="Project source repository" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rp-url">Repository URL (required)</label>
          <input id="rp-url" type="text" required placeholder="https://github.com/…" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rp-vis">Visibility</label>
          <select id="rp-vis" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="PRIVATE">Private</option>
            <option value="INTERNAL">Internal to the institute</option>
          </select>
        </div>
        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Linking…' : 'Link repository'}
        </button>
      </form>
    </details>
  );
}

export function AddAttachmentForm({
  projectId, onDone,
}: { projectId: string; onDone: (message: string) => void }) {
  const [kind, setKind] = useState('REPORT');
  const [label, setLabel] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/attachments`, {
        kind,
        label: label.trim(),
        externalUrl: externalUrl.trim(),
      });
      setLabel(''); setExternalUrl('');
      onDone('The document has been linked.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Link a report, presentation or recording</summary>
      <form onSubmit={submit}>
        <ErrorMessage error={error} />
        <Alert kind="info">
          This release records a link to a document held elsewhere. Uploading files into managed
          object storage is a later phase, so paste a URL your reviewers can already open.
        </Alert>
        <div className="filters" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="field">
            <label htmlFor="at-kind">Kind</label>
            <select id="at-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="REPORT">Report</option>
              <option value="PRESENTATION">Presentation</option>
              <option value="IMAGE">Image</option>
              <option value="RECORDING">Recording or demonstration</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="at-label">Label (required)</label>
            <input id="at-label" type="text" required minLength={2} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="at-url">Document URL (required)</label>
          <input id="at-url" type="text" required placeholder="https://…" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
        </div>
        <button type="submit" className="btn--primary" disabled={busy}>
          {busy ? 'Linking…' : 'Link document'}
        </button>
      </form>
    </details>
  );
}

/** All three artefact/team forms, gated on the permissions the server returned. */
export function TeamArtefactForms({
  project, onDone,
}: { project: ProjectDetail; onDone: (message: string) => void }) {
  const canTeam = project.permissions.includes('project:update');
  const canArtefacts = project.permissions.includes('artefact:manage');
  if (!canTeam && !canArtefacts) return null;

  return (
    <>
      {canTeam && <AddMemberForm projectId={project.project.id} onDone={onDone} />}
      {canArtefacts && <AddRepositoryForm projectId={project.project.id} onDone={onDone} />}
      {canArtefacts && <AddAttachmentForm projectId={project.project.id} onDone={onDone} />}
    </>
  );
}
