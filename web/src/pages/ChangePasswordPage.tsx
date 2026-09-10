import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Alert, Card, ErrorMessage } from '../components/ui';

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { refresh, signOut } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError({ message: 'The two new passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      await refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <>
      <ErrorMessage error={error} />
      {done && <Alert kind="success">Your password has been changed.</Alert>}
      {forced && !done && (
        <Alert kind="warn" title="A password change is required">
          Your account was created or reset by an administrator. Choose your own password to continue.
        </Alert>
      )}
      <form onSubmit={submit} style={{ maxWidth: 420 }}>
        <div className="field">
          <label htmlFor="current">Current password</label>
          <input
            id="current" type="password" autoComplete="current-password" required
            value={current} onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="next">New password</label>
          <p className="hint">At least 10 characters, including a letter and a number.</p>
          <input
            id="next" type="password" autoComplete="new-password" required
            value={next} onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm new password</label>
          <input
            id="confirm" type="password" autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button type="submit" className="btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
          {forced && <button type="button" onClick={() => signOut()}>Sign out</button>}
        </div>
      </form>
    </>
  );

  if (forced) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Set your password</h1>
          <p className="sub">Mini-Project Portfolio Monitoring Portal</p>
          {form}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Change your password</h1>
          <p>Changing your password signs out every other device using your account.</p>
        </div>
      </div>
      <Card>{form}</Card>
    </>
  );
}
