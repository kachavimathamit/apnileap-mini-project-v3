import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Alert, Card, ErrorMessage, Loading, RelativeDays } from '../components/ui';

interface Grant {
  id: string;
  role: string;
  scope_type: string;
  institute_id: string | null;
  institute_name: string | null;
  department_name: string | null;
  project_title: string | null;
  is_active: number;
}

interface ManagedUser {
  id: string;
  email: string;
  full_name: string;
  designation: string | null;
  is_active: number;
  last_login_at: string | null;
  must_change_password: number;
  grants: Grant[];
}

interface InstituteMeta {
  id: string; code: string; short_name: string; name: string;
  city: string | null; is_active: number;
}

interface Meta {
  roles: { value: string; label: string; grantable: boolean }[];
  institutes: InstituteMeta[];
  departments: { id: string; institute_id: string; code: string; name: string }[];
  projects: { id: string; institute_id: string; department_id: string; code: string; title: string }[];
}

/** Requirement 5.1 / 7: account administration and access grants, scoped to what
 *  the administrator may actually manage. The server enforces the same limits. */
export function AdminPage() {
  const { session } = useSession();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [userResult, metaResult] = await Promise.all([
        api.get<{ users: ManagedUser[] }>('/admin/users'),
        api.get<Meta>('/admin/meta'),
      ]);
      setUsers(userResult.users);
      setMeta(metaResult);
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorMessage error={error} />;
  if (!users || !meta) return <Loading what="administration" />;

  async function act(work: Promise<unknown>, message: string) {
    setError(null);
    try {
      await work;
      setNotice(message);
      await load();
    } catch (caught) {
      setError(caught);
      setNotice(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p>
            {session?.access.isPlatformAdmin
              ? 'Platform administration: every institute.'
              : `You can administer accounts and access for ${meta.institutes.map((i) => i.short_name).join(', ')}.`}
          </p>
        </div>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      <ErrorMessage error={error} />

      {session?.access.isPlatformAdmin && (
        <InstituteManagement institutes={meta.institutes} onDone={(message) => act(Promise.resolve(), message)} refresh={load} />
      )}

      <CreateUser meta={meta} onDone={(message) => act(Promise.resolve(), message)} refresh={load} />

      <Card
        title={`Accounts (${users.length})`}
        hint={session?.access.isPlatformAdmin
          ? 'Every account on the platform, with its full set of access grants'
          : "You see only the part of each person's access that falls inside your own institute"}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Person</th><th>Access grants</th><th>Last sign-in</th><th>State</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.full_name}</strong>
                    <span className="rowsub">{user.email}</span>
                    {user.designation && <span className="rowsub">{user.designation}</span>}
                  </td>
                  <td>
                    <div className="grant-list">
                      {user.grants.filter((grant) => grant.is_active).map((grant) => (
                        <div className="grant" key={grant.id}>
                          <span className="flag">{grant.role.replace(/_/g, ' ').toLowerCase()}</span>
                          <span className="grant__scope">
                            {grant.scope_type === 'PLATFORM' && 'entire platform'}
                            {grant.scope_type === 'INSTITUTE' && grant.institute_name}
                            {grant.scope_type === 'DEPARTMENT' && `${grant.institute_name} · ${grant.department_name}`}
                            {grant.scope_type === 'PROJECT' && `${grant.institute_name} · ${grant.project_title}`}
                          </span>
                          {user.id !== session?.user.id && (
                            <button
                              type="button" className="btn--sm"
                              onClick={() => act(api.del(`/admin/grants/${grant.id}`), 'Access grant revoked.')}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {user.grants.filter((grant) => grant.is_active).length === 0 && (
                      <span className="rowsub">No active grants in your scope</span>
                    )}
                    <AddGrant userId={user.id} meta={meta} onDone={(message) => act(Promise.resolve(), message)} refresh={load} />
                  </td>
                  <td>{user.last_login_at ? <RelativeDays stamp={user.last_login_at} /> : 'never'}</td>
                  <td>
                    <span className={`flag ${user.is_active ? 'flag--ok' : 'flag--danger'}`}>
                      {user.is_active ? 'active' : 'deactivated'}
                    </span>
                    {user.must_change_password ? <span className="flag flag--warn">password reset pending</span> : null}
                  </td>
                  <td>
                    {user.id !== session?.user.id && (
                      <div className="btn-row">
                        <button
                          type="button" className={`btn--sm ${user.is_active ? 'btn--danger' : ''}`}
                          onClick={() => act(
                            api.patch(`/admin/users/${user.id}`, { isActive: !user.is_active }),
                            user.is_active
                              ? 'The account was deactivated and its sessions ended immediately.'
                              : 'The account was reactivated.',
                          )}
                        >
                          {user.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          type="button" className="btn--sm btn--danger"
                          onClick={() => {
                            if (!window.confirm(
                              `Delete the account for ${user.full_name} (${user.email}) entirely? This ` +
                              'cannot be undone. To keep the person’s name on past records but block ' +
                              'their access, use Deactivate instead.',
                            )) return;
                            act(api.del(`/admin/users/${user.id}`), 'The account has been deleted.');
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function CreateUser({ meta, onDone, refresh }: { meta: Meta; onDone: (m: string) => void; refresh: () => Promise<void> }) {
  const [form, setForm] = useState({
    email: '', fullName: '', designation: '', temporaryPassword: '',
    role: 'FACULTY_MENTOR', scopeType: 'DEPARTMENT', instituteId: meta.institutes[0]?.id ?? '',
    departmentId: '', projectId: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const departments = meta.departments.filter((d) => d.institute_id === form.instituteId);
  const projects = meta.projects.filter((p) => p.institute_id === form.instituteId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/admin/users', {
        email: form.email,
        fullName: form.fullName,
        designation: form.designation || undefined,
        temporaryPassword: form.temporaryPassword,
        grant: {
          role: form.role,
          scopeType: form.scopeType,
          instituteId: form.scopeType === 'PLATFORM' ? undefined : form.instituteId,
          departmentId: form.scopeType === 'DEPARTMENT' ? form.departmentId : undefined,
          projectId: form.scopeType === 'PROJECT' ? form.projectId : undefined,
        },
      });
      setForm({ ...form, email: '', fullName: '', designation: '', temporaryPassword: '' });
      await refresh();
      onDone('The account was created. The user must change the temporary password at first sign-in.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Create an account">
      <details className="disclosure">
        <summary>New user and initial access grant</summary>
        <form onSubmit={submit}>
          <ErrorMessage error={error} />
          <div className="filters" style={{ marginBottom: '0.85rem' }}>
            <div className="field">
              <label htmlFor="nu-name">Full name</label>
              <input id="nu-name" type="text" required value={form.fullName} onChange={set('fullName')} />
            </div>
            <div className="field">
              <label htmlFor="nu-email">Email address</label>
              <input id="nu-email" type="email" required value={form.email} onChange={set('email')} />
            </div>
            <div className="field">
              <label htmlFor="nu-designation">Designation</label>
              <input id="nu-designation" type="text" value={form.designation} onChange={set('designation')} />
            </div>
            <div className="field">
              <label htmlFor="nu-password">Temporary password</label>
              <input
                id="nu-password" type="text" required autoComplete="off"
                value={form.temporaryPassword} onChange={set('temporaryPassword')}
                placeholder="10+ characters, a letter and a number"
              />
            </div>
          </div>

          <div className="filters" style={{ marginBottom: '0.85rem' }}>
            <div className="field">
              <label htmlFor="nu-role">Role</label>
              <select id="nu-role" value={form.role} onChange={set('role')}>
                {meta.roles.filter((role) => role.grantable).map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nu-scope">Scope</label>
              <select id="nu-scope" value={form.scopeType} onChange={set('scopeType')}>
                <option value="INSTITUTE">Whole institute</option>
                <option value="DEPARTMENT">One department</option>
                <option value="PROJECT">One project</option>
                <option value="PLATFORM">Entire platform</option>
              </select>
            </div>
            {form.scopeType !== 'PLATFORM' && (
              <div className="field">
                <label htmlFor="nu-institute">Institute</label>
                <select id="nu-institute" value={form.instituteId} onChange={set('instituteId')}>
                  {meta.institutes.map((institute) => (
                    <option key={institute.id} value={institute.id}>{institute.short_name}</option>
                  ))}
                </select>
              </div>
            )}
            {form.scopeType === 'DEPARTMENT' && (
              <div className="field">
                <label htmlFor="nu-department">Department</label>
                <select id="nu-department" required value={form.departmentId} onChange={set('departmentId')}>
                  <option value="">Select…</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            {form.scopeType === 'PROJECT' && (
              <div className="field">
                <label htmlFor="nu-project">Project</label>
                <select id="nu-project" required value={form.projectId} onChange={set('projectId')}>
                  <option value="">Select…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
            )}
          </div>

          <button type="submit" className="btn--primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </details>
    </Card>
  );
}

function AddGrant({ userId, meta, onDone, refresh }: {
  userId: string; meta: Meta; onDone: (m: string) => void; refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('READ_ONLY');
  const [scopeType, setScopeType] = useState('INSTITUTE');
  const [instituteId, setInstituteId] = useState(meta.institutes[0]?.id ?? '');
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<unknown>(null);

  if (!open) {
    return (
      <button type="button" className="btn--sm" onClick={() => setOpen(true)}>+ Add access grant</button>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post(`/admin/users/${userId}/grants`, {
        role,
        scopeType,
        instituteId: scopeType === 'PLATFORM' ? undefined : instituteId,
        departmentId: scopeType === 'DEPARTMENT' ? departmentId : undefined,
        projectId: scopeType === 'PROJECT' ? projectId : undefined,
      });
      setOpen(false);
      await refresh();
      onDone('Access granted. The user has been notified.');
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-2)' }}>
      <ErrorMessage error={error} />
      {/* Each control carries its own accessible name: there is no room for a
          visible label on this row, so aria-label supplies one. */}
      <div className="inline-form">
        <select aria-label="Role to grant" value={role} onChange={(e) => setRole(e.target.value)}>
          {meta.roles.filter((r) => r.grantable).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select aria-label="Scope of the grant" value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
          <option value="INSTITUTE">Whole institute</option>
          <option value="DEPARTMENT">One department</option>
          <option value="PROJECT">One project</option>
          <option value="PLATFORM">Entire platform</option>
        </select>
        {scopeType !== 'PLATFORM' && (
          <select aria-label="Institute" value={instituteId} onChange={(e) => setInstituteId(e.target.value)}>
            {meta.institutes.map((i) => <option key={i.id} value={i.id}>{i.short_name}</option>)}
          </select>
        )}
        {scopeType === 'DEPARTMENT' && (
          <select aria-label="Department" required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Select a department…</option>
            {meta.departments.filter((d) => d.institute_id === instituteId).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
        {scopeType === 'PROJECT' && (
          <select aria-label="Project" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {meta.projects.filter((p) => p.institute_id === instituteId).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        )}
        <button type="submit" className="btn--primary">Grant access</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Institute-level CRUD, restricted to the platform administrator (matched by
 * the server: creating, editing and deleting an institute all require
 * requirePlatformAdmin). An institute with departments cannot be hard-deleted -
 * the server deactivates it instead and this reflects that outcome rather than
 * pretending it was removed.
 */
function InstituteManagement({
  institutes, onDone, refresh,
}: { institutes: InstituteMeta[]; onDone: (message: string) => void; refresh: () => Promise<void> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', shortName: '', city: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(institute: InstituteMeta) {
    setEditingId(institute.id);
    setEdit({ name: institute.name, shortName: institute.short_name, city: institute.city ?? '' });
    setError(null);
  }

  async function saveEdit(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/admin/institutes/${id}`, {
        name: edit.name.trim(),
        shortName: edit.shortName.trim(),
        city: edit.city.trim(),
      });
      setEditingId(null);
      await refresh();
      onDone('The institute has been updated.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(institute: InstituteMeta) {
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/admin/institutes/${institute.id}`, { isActive: !institute.is_active });
      await refresh();
      onDone(institute.is_active ? 'The institute has been reactivated.' : 'The institute has been deactivated.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function remove(institute: InstituteMeta) {
    if (!window.confirm(
      `Remove "${institute.name}"? Institutes with no departments are deleted outright; institutes ` +
      'with departments are deactivated instead, and everything beneath them stays untouched.',
    )) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api.del<{ ok: boolean; deleted: boolean; message?: string }>(
        `/admin/institutes/${institute.id}`,
      );
      await refresh();
      onDone(result.message ?? 'The institute has been deleted.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Institutes" hint="Create, rename or retire a participating institute">
      <ErrorMessage error={error} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Short name</th><th>City</th><th>State</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {institutes.map((institute) => (
              <tr key={institute.id}>
                <td>{institute.code}</td>
                {editingId === institute.id ? (
                  <>
                    <td><input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                    <td><input type="text" value={edit.shortName} onChange={(e) => setEdit({ ...edit, shortName: e.target.value })} /></td>
                    <td><input type="text" value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></td>
                    <td><span className={`flag ${institute.is_active ? 'flag--ok' : 'flag--danger'}`}>{institute.is_active ? 'active' : 'inactive'}</span></td>
                    <td>
                      <div className="btn-row">
                        <button type="button" className="btn--sm btn--primary" onClick={() => saveEdit(institute.id)} disabled={busy}>Save</button>
                        <button type="button" className="btn--sm" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{institute.name}</td>
                    <td>{institute.short_name}</td>
                    <td>{institute.city ?? '—'}</td>
                    <td><span className={`flag ${institute.is_active ? 'flag--ok' : 'flag--danger'}`}>{institute.is_active ? 'active' : 'inactive'}</span></td>
                    <td>
                      <div className="btn-row">
                        <button type="button" className="btn--sm" onClick={() => startEdit(institute)}>Edit</button>
                        <button type="button" className="btn--sm" onClick={() => toggleActive(institute)} disabled={busy}>
                          {institute.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button type="button" className="btn--sm btn--danger" onClick={() => remove(institute)} disabled={busy}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {institutes.length === 0 && <tr><td colSpan={6} className="table-empty">No institutes yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <CreateInstitute onDone={onDone} refresh={refresh} />
    </Card>
  );
}

function CreateInstitute({ onDone, refresh }: { onDone: (m: string) => void; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', shortName: '', city: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/admin/institutes', {
        code: form.code.trim(),
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        city: form.city.trim() || undefined,
      });
      setForm({ code: '', name: '', shortName: '', city: '' });
      setOpen(false);
      await refresh();
      onDone('The institute has been created.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="btn-row" style={{ marginTop: 'var(--sp-4)' }}>
        <button type="button" className="btn--primary" onClick={() => setOpen(true)}>+ New institute</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 'var(--sp-4)' }}>
      <ErrorMessage error={error} />
      <div className="filters">
        <div className="field">
          <label htmlFor="ni-code">Code (required)</label>
          <input id="ni-code" type="text" required minLength={2} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ni-short">Short name (required)</label>
          <input id="ni-short" type="text" required minLength={2} value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ni-name">Full name (required)</label>
          <input id="ni-name" type="text" required minLength={3} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ni-city">City</label>
          <input id="ni-city" type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </div>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn--primary" disabled={busy}>{busy ? 'Creating…' : 'Create institute'}</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
