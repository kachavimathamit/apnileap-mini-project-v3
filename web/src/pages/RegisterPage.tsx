import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, ErrorMessage } from '../components/ui';

interface Institute { id: string; code: string; name: string }
interface Department { id: string; institute_id: string; code: string; name: string }

/**
 * Self-registration for a Faculty Mentor / Guide. The account is created
 * immediately and can sign in, but is granted no access until the department
 * head approves the request - see docs/ARCHITECTURE.md for why that is
 * enforced server-side rather than by hiding this from anyone.
 */
export function RegisterPage() {
  const [options, setOptions] = useState<{ institutes: Institute[]; departments: Department[] } | null>(null);
  const [form, setForm] = useState({
    fullName: '', email: '', password: '', designation: '', instituteId: '', departmentId: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get<{ institutes: Institute[]; departments: Department[] }>('/auth/register-options')
      .then((result) => {
        setOptions(result);
        if (result.institutes.length) {
          setForm((prev) => ({ ...prev, instituteId: result.institutes[0].id }));
        }
      })
      .catch(setError);
  }, []);

  const departmentsForInstitute = options?.departments.filter((d) => d.institute_id === form.instituteId) ?? [];

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/register', form);
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
        <h1>Register as a Faculty Mentor / Guide</h1>
        <p className="sub">
          Your account is created right away, but you will not see any projects until your
          department head approves this request.
        </p>

        <ErrorMessage error={error} />

        {done ? (
          <Alert kind="success">
            Registration submitted. You can sign in now - your department head has been asked to
            approve it, and you will gain access to your department's projects once they do.
          </Alert>
        ) : options ? (
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
              <label htmlFor="designation">Designation (optional)</label>
              <input id="designation" type="text" value={form.designation} onChange={set('designation')} />
            </div>
            <div className="field">
              <label htmlFor="institute">Institute</label>
              <select
                id="institute" required value={form.instituteId}
                onChange={(e) => setForm((prev) => ({ ...prev, instituteId: e.target.value, departmentId: '' }))}
              >
                {options.institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="department">Department</label>
              <select id="department" required value={form.departmentId} onChange={set('departmentId')}>
                <option value="">Select a department…</option>
                {departmentsForInstitute.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn--primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit registration'}
            </button>
          </form>
        ) : (
          <p className="empty">Loading institutes…</p>
        )}

        <div className="auth-foot"><Link to="/login">Back to sign in</Link></div>
      </div>
    </div>
  );
}
