import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session';
import { ErrorMessage } from '../components/ui';

export function LoginPage() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="sub">Mini-Project Portfolio Monitoring Portal</p>

        <ErrorMessage error={error} />

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email" type="email" autoComplete="username" required
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn--primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="auth-foot">
          <Link to="/forgot-password">Forgotten your password?</Link>
        </div>

        <div className="demo-accounts">
          <p style={{ margin: '0 0 0.5rem' }}>
            Faculty Mentor or Guide, not yet registered?{' '}
            <Link to="/register">Sign up here</Link> — your department head will need to approve
            the request before you can see any projects.
          </p>
          <p style={{ margin: 0 }}>
            Student joining a project?{' '}
            <Link to="/register-student">Sign up here</Link> — your guide will need to approve
            you before you can see the project.
          </p>
        </div>
      </div>
    </div>
  );
}
