import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, ErrorMessage } from '../components/ui';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ message: string }>('/auth/password-reset/request', { email });
      setSent(result.message);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Reset your password</h1>
        <p className="sub">We will email a link that stays valid for one hour.</p>

        <ErrorMessage error={error} />
        {sent && <Alert kind="success">{sent}</Alert>}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email" type="email" autoComplete="username" required
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn--primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <div className="auth-foot"><Link to="/login">Back to sign in</Link></div>
      </div>
    </div>
  );
}
