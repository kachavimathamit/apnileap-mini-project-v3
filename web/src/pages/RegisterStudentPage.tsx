import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, ErrorMessage } from '../components/ui';

/**
 * Self-registration for a student, joining a project by the code their guide
 * gives them. The account can sign in immediately but sees nothing until the
 * guide approves the team entry this creates.
 */
export function RegisterStudentPage() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', projectCode: '', teamIdentifier: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ message: string }>('/auth/register-student', {
        fullName: form.fullName, email: form.email, password: form.password,
        projectCode: form.projectCode.trim(), teamIdentifier: form.teamIdentifier.trim() || undefined,
      });
      setDone(result.message);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Join your project</h1>
        <p className="sub">
          Ask your guide for your project's code before you start - you'll need it below.
        </p>

        <ErrorMessage error={error} />

        {done ? (
          <Alert kind="success">{done}</Alert>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="fullName">Full name</label>
              <input id="fullName" type="text" required minLength={2} value={form.fullName} onChange={set('fullName')} />
            </div>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" autoComplete="username" required value={form.email} onChange={set('email')} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <p className="hint">At least 10 characters, including a letter and a number.</p>
              <input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />
            </div>
            <div className="field">
              <label htmlFor="projectCode">Project code</label>
              <p className="hint">Given to you by your guide, e.g. KLE-CSE-2026-04.</p>
              <input id="projectCode" type="text" required value={form.projectCode} onChange={set('projectCode')} />
            </div>
            <div className="field">
              <label htmlFor="teamIdentifier">Team identifier (optional)</label>
              <input id="teamIdentifier" type="text" value={form.teamIdentifier} onChange={set('teamIdentifier')} />
            </div>
            <button type="submit" className="btn--primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit registration'}
            </button>
          </form>
        )}

        <div className="auth-foot"><Link to="/login">Back to sign in</Link></div>
      </div>
    </div>
  );
}
