import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, ErrorMessage } from '../components/ui';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError({ message: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/password-reset/confirm', { token, newPassword: password });
      setDone(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Choose a new password</h1>
        <p className="sub">At least 10 characters, including a letter and a number.</p>

        <ErrorMessage error={error} />
        {!token && <Alert kind="warn">This link is missing its reset token. Please request a new one.</Alert>}
        {done && <Alert kind="success">Your password has been changed. You can now sign in.</Alert>}

        {!done && (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="password">New password</label>
              <input
                id="password" type="password" autoComplete="new-password" required
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm new password</label>
              <input
                id="confirm" type="password" autoComplete="new-password" required
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button type="submit" className="btn--primary" style={{ width: '100%' }} disabled={busy || !token}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}

        <div className="auth-foot"><Link to="/login">Back to sign in</Link></div>
      </div>
    </div>
  );
}
