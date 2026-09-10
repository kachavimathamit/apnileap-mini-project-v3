import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type DepartmentDashboard } from '../api';
import { useSession } from '../session';
import {
  Alert, Breadcrumbs, Card, DateText, ErrorMessage, Loading, Progress, RagBar, RelativeDays, StatusBadge,
} from '../components/ui';
import { CreateProjectForm } from '../components/ProjectForm';

interface Filters {
  status: string;
  mentorUserId: string;
  semester: string;
  academicYear: string;
  sort: string;
  overdueActions: boolean;
  stale: boolean;
  awaitingReview: boolean;
  search: string;
}

const EMPTY: Filters = {
  status: '', mentorUserId: '', semester: '', academicYear: '', sort: 'severity',
  overdueActions: false, stale: false, awaitingReview: false, search: '',
};

/** Requirement 5.4: the department dashboard with its filters and sort options. */
export function DepartmentPage() {
  const { departmentId } = useParams();
  const { session } = useSession();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [data, setData] = useState<DepartmentDashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.mentorUserId) params.set('mentorUserId', filters.mentorUserId);
    if (filters.semester) params.set('semester', filters.semester);
    if (filters.academicYear) params.set('academicYear', filters.academicYear);
    if (filters.overdueActions) params.set('overdueActions', 'true');
    if (filters.stale) params.set('stale', 'true');
    if (filters.awaitingReview) params.set('awaitingReview', 'true');
    if (filters.search.trim()) params.set('search', filters.search.trim());
    params.set('sort', filters.sort);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.get<DepartmentDashboard>(`/departments/${departmentId}?${query}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((caught) => { if (!cancelled) setError(caught); });
    return () => { cancelled = true; };
  }, [departmentId, query]);

  async function reload(message?: string) {
    const result = await api.get<DepartmentDashboard>(`/departments/${departmentId}?${query}`);
    setData(result);
    if (message) setNotice(message);
  }

  async function saveRename() {
    setActionError(null);
    setBusy(true);
    try {
      await api.patch(`/departments/${departmentId}`, { name: newName.trim() });
      setRenaming(false);
      await reload('The department has been renamed.');
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDepartment() {
    if (!data) return;
    if (!window.confirm(
      `Remove "${data.department.name}"? Departments with no projects are deleted outright; ` +
      'departments with projects are deactivated instead, and their projects stay untouched.',
    )) return;
    setActionError(null);
    setBusy(true);
    try {
      const result = await api.del<{ ok: boolean; deleted: boolean; message?: string }>(
        `/departments/${departmentId}`,
      );
      if (result.deleted) {
        navigate(`/institutes/${data.department.instituteId}`, { replace: true });
        return;
      }
      await reload(result.message ?? 'The department has been deactivated.');
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <Loading what="the department dashboard" />;

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((previous) => ({ ...previous, [key]: value }));

  const trail = [
    ...((session?.access.instituteCount ?? 0) > 1 ? [{ label: 'Programme portfolio', to: '/' }] : []),
    { label: data.department.instituteShortName, to: `/institutes/${data.department.instituteId}` },
    { label: data.department.name },
  ];

  return (
    <>
      <Breadcrumbs trail={trail} />

      <div className="page-head">
        <div>
          <h1>{data.department.name}</h1>
          <p>
            {data.department.instituteName}
            {data.department.headName ? ` · Head: ${data.department.headName}` : ''}
            {data.department.coordinatorName ? ` · Coordinator: ${data.department.coordinatorName}` : ''}
          </p>
        </div>
        {data.permissions.includes('department:manage') && !renaming && (
          <div className="btn-row">
            <button type="button" onClick={() => { setNewName(data.department.name); setRenaming(true); }}>
              Rename
            </button>
            <button type="button" className="btn--danger" onClick={deleteDepartment} disabled={busy}>
              Delete department
            </button>
          </div>
        )}
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      <ErrorMessage error={actionError} />

      {renaming && (
        <Card title="Rename department">
          <div className="filters" style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="field">
              <label htmlFor="dept-rename">Department name</label>
              <input id="dept-rename" type="text" required minLength={2} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn--primary" onClick={saveRename} disabled={busy || !newName.trim()}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
            <button type="button" onClick={() => setRenaming(false)}>Cancel</button>
          </div>
        </Card>
      )}

      <Card title="Portfolio summary" hint={`${data.total} project${data.total === 1 ? '' : 's'} in view`}>
        <RagBar counts={data.counts} total={data.total} />
      </Card>

      {data.permissions.includes('project:create') && (
        <Card title="Add a project">
          <CreateProjectForm
            departmentId={data.department.id}
            departmentName={data.department.name}
            onCreated={(message) => reload(message)}
          />
        </Card>
      )}

      <Card
        title="Projects"
        actions={
          <button type="button" className="btn--sm" onClick={() => setFilters(EMPTY)}>Clear filters</button>
        }
      >
        <div className="filters" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label htmlFor="f-search">Search</label>
            <input
              id="f-search" type="text" placeholder="Title or code"
              value={filters.search} onChange={(e) => set('search', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">All statuses</option>
              <option value="RED">Red - Intervention Required</option>
              <option value="YELLOW">Yellow - At Risk</option>
              <option value="GREEN">Green - On Track</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-mentor">Faculty mentor</label>
            <select id="f-mentor" value={filters.mentorUserId} onChange={(e) => set('mentorUserId', e.target.value)}>
              <option value="">All mentors</option>
              {data.filterOptions.mentors.map((mentor) => (
                <option key={mentor.id} value={mentor.id}>{mentor.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-semester">Semester</label>
            <select id="f-semester" value={filters.semester} onChange={(e) => set('semester', e.target.value)}>
              <option value="">All semesters</option>
              {data.filterOptions.semesters.map((semester) => (
                <option key={semester} value={semester}>{semester}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-year">Academic year</label>
            <select id="f-year" value={filters.academicYear} onChange={(e) => set('academicYear', e.target.value)}>
              <option value="">All years</option>
              {data.filterOptions.academicYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-sort">Sort by</label>
            <select id="f-sort" value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
              <option value="severity">Severity</option>
              <option value="oldest_update">Oldest update</option>
              <option value="next_milestone">Nearest review</option>
              <option value="mentor">Mentor</option>
              <option value="name">Project name</option>
              <option value="completion">Completion</option>
            </select>
          </div>
        </div>

        <div className="btn-row" style={{ marginBottom: '1rem' }}>
          <label className="field field--inline" style={{ margin: 0 }}>
            <input type="checkbox" checked={filters.overdueActions} onChange={(e) => set('overdueActions', e.target.checked)} />
            Overdue actions only
          </label>
          <label className="field field--inline" style={{ margin: 0 }}>
            <input type="checkbox" checked={filters.stale} onChange={(e) => set('stale', e.target.checked)} />
            Not updated recently
          </label>
          <label className="field field--inline" style={{ margin: 0 }}>
            <input type="checkbox" checked={filters.awaitingReview} onChange={(e) => set('awaitingReview', e.target.checked)} />
            Awaiting review
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Faculty mentor</th>
                <th>Status</th>
                <th>Completion</th>
                <th>Last update</th>
                <th>Next review</th>
                <th className="numeric">Open issues</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link className="rowlink" to={`/projects/${project.id}`}>{project.title}</Link>
                    <span className="rowsub">{project.code} · {project.semester}, {project.academic_year}</span>
                  </td>
                  <td>{project.mentor_name ?? '—'}</td>
                  <td>
                    <StatusBadge status={project.rag_status} />
                    <div style={{ marginTop: '0.3rem' }}>
                      {project.overdue_actions > 0 && <span className="flag flag--danger">{project.overdue_actions} overdue</span>}
                      {project.is_stale ? <span className="flag flag--warn">Stale</span> : null}
                    </div>
                  </td>
                  <td><Progress value={project.completion_percentage} /></td>
                  <td><RelativeDays stamp={project.last_update_at} /></td>
                  <td><DateText value={project.next_review_date} /></td>
                  <td className="numeric">{project.open_issues}</td>
                </tr>
              ))}
              {data.projects.length === 0 && (
                <tr><td colSpan={7} className="table-empty">No projects match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
