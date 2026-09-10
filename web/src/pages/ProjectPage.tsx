import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type ProjectDetail, type RagStatus } from '../api';
import { useSession } from '../session';
import {
  Alert, Breadcrumbs, Card, DateText, ErrorMessage, Loading, Progress, RelativeDays, StatusBadge,
} from '../components/ui';
import { StatusChangeForm } from '../components/StatusChangeForm';
import { IssueForms } from '../components/IssueForms';
import { ReviewForm } from '../components/ReviewForm';
import { ScheduledReviewsPanel } from '../components/ScheduledReviewsPanel';
import { EditProjectForm } from '../components/ProjectForm';
import { ExecutionForms } from '../components/ExecutionForms';
import { TeamArtefactForms } from '../components/TeamArtefactForms';
import { ProgressPanel } from '../components/ProgressPanel';
import { AssignGuideForm, MemberDecisionButtons, FreezeControls, DefinitionEditForm } from '../components/WorkflowForms';
import { FoundationPanel } from '../components/FoundationPanel';

type Tab = 'overview' | 'definition' | 'progress' | 'execution' | 'challenges' | 'history' | 'foundation';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'definition', label: 'Project definition' },
  { id: 'foundation', label: 'Theme, engines & gates' },
  { id: 'progress', label: 'Progress' },
  { id: 'execution', label: 'Milestones & KPIs' },
  { id: 'challenges', label: 'Challenges & actions' },
  { id: 'history', label: 'Reviews & history' },
];

const SEVERITY_FLAG: Record<string, string> = {
  CRITICAL: 'flag--danger', HIGH: 'flag--danger', MEDIUM: 'flag--warn', LOW: '',
};

export function ProjectPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as Tab | null;
  const { session } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>(
    tabFromUrl && TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'overview',
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<ProjectDetail>(`/projects/${projectId}`));
    } catch (caught) {
      setError(caught);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <Loading what="the project" />;

  const { project, permissions } = data;
  const can = (permission: string) => permissions.includes(permission);

  // A pure student (no staff/guide capability on this project) gets a
  // focused set of tabs - their project details, progress and challenges -
  // rather than the full management workspace every other role sees.
  const isStudentOnly = data.roles.includes('STUDENT') && !can('project:update') && !can('progress:review');
  const visibleTabs = isStudentOnly
    ? TABS.filter((entry) => entry.id !== 'execution' && entry.id !== 'history')
    : TABS;
  const effectiveTab = visibleTabs.some((entry) => entry.id === tab) ? tab : 'overview';

  const openIssues = data.issues.filter((issue) => !['VERIFIED', 'CLOSED'].includes(issue.status));
  const openActions = data.actions.filter((action) => ['OPEN', 'IN_PROGRESS'].includes(action.status));
  const overdueActions = openActions.filter((action) => action.is_overdue);

  const trail = [
    ...((session?.access.instituteCount ?? 0) > 1 ? [{ label: 'Programme portfolio', to: '/' }] : []),
    { label: project.institute_short_name, to: `/institutes/${project.institute_id}` },
    { label: project.department_name, to: `/departments/${project.department_id}` },
    { label: project.code },
  ];

  async function refreshAfter(message: string) {
    setNotice(message);
    setActionError(null);
    await load();
  }

  /** Deletes a child record (a milestone, a link, a team member…) with a confirm prompt. */
  async function removeItem(url: string, confirmMessage: string, successMessage: string) {
    if (!window.confirm(confirmMessage)) return;
    setActionError(null);
    try {
      await api.del(url);
      await refreshAfter(successMessage);
    } catch (caught) {
      setActionError(caught);
    }
  }

  async function deleteProject() {
    if (!window.confirm(
      `Delete "${project.title}" (${project.code})? This cannot be undone. Projects with a review ` +
      'or status history cannot be deleted this way - archive them instead.',
    )) return;
    setActionError(null);
    setDeleting(true);
    try {
      await api.del(`/projects/${project.id}`);
      navigate(`/departments/${project.department_id}`, { replace: true });
    } catch (caught) {
      setActionError(caught);
      setDeleting(false);
    }
  }

  return (
    <>
      <Breadcrumbs trail={trail} />

      <div className="page-head">
        <div>
          <h1>{project.title}</h1>
          <p>
            {project.code} · {project.institute_name} · {project.department_name} · {project.semester}, {project.academic_year}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <StatusBadge status={project.rag_status} />
          {Boolean(project.is_archived) && <span className="flag flag--warn" style={{ marginLeft: '0.4rem' }}>Archived</span>}
          {Boolean(project.definition_frozen) && <span className="flag flag--warn" style={{ marginLeft: '0.4rem' }}>Definition frozen</span>}
          <div className="card__hint" style={{ marginTop: '0.3rem' }}>
            Since <DateText value={project.rag_status_since} /> (<RelativeDays stamp={project.rag_status_since} />)
          </div>
          {can('project:freeze') && (
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <FreezeControls
                projectId={project.id} frozen={Boolean(project.definition_frozen)}
                onDone={(m) => refreshAfter(m)}
              />
            </div>
          )}
        </div>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      <ErrorMessage error={actionError} />

      {/* Requirement 5.6: a Red project leads with why it is Red and what happens next. */}
      {project.rag_status === 'RED' && (
        <div className="panel panel--red">
          <h3>Intervention required</h3>
          <p>
            This project became Red on <strong><DateText value={project.rag_status_since} /></strong>
            {' '}(<RelativeDays stamp={project.rag_status_since} />).
            {data.history[0]?.rationale ? <> Recorded reason: “{data.history[0].rationale}”</> : null}
          </p>
          <p style={{ marginBottom: 'var(--sp-3)' }}>
            <span className="flag flag--danger">{openIssues.length} open challenge{openIssues.length === 1 ? '' : 's'}</span>
            <span className={`flag ${overdueActions.length ? 'flag--danger' : 'flag--ok'}`}>
              {overdueActions.length} overdue action{overdueActions.length === 1 ? '' : 's'}
            </span>
          </p>
          <div className="btn-row">
            <button type="button" onClick={() => setTab('challenges')}>
              View challenges and corrective actions
            </button>
          </div>
          <p style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
            A Red project can only return to Green with recorded evidence of resolution and approval by an
            authorized reviewer, once every high or critical challenge is closed and no corrective action is overdue.
          </p>
        </div>
      )}

      {project.is_stale && (
        <Alert kind="warn" title="This project has not been updated recently">
          The last update was <RelativeDays stamp={project.last_update_at} />. A current status cannot be
          confirmed from stale information.
        </Alert>
      )}

      <div className="tabs" role="tablist">
        {visibleTabs.map((entry) => (
          <button
            key={entry.id} type="button" role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'is-active' : ''}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'challenges' && openIssues.length > 0 ? ` (${openIssues.length})` : ''}
          </button>
        ))}
      </div>

      {effectiveTab === 'overview' && (
        <>
          <Card title="Execution">
            <dl className="deflist">
              <div><dt>Current status</dt><dd><StatusBadge status={project.rag_status} /></dd></div>
              <div><dt>Completion</dt><dd><Progress value={project.completion_percentage} /></dd></div>
              <div><dt>Last update</dt><dd><RelativeDays stamp={project.last_update_at} /></dd></div>
              <div><dt>Last review</dt><dd>{project.last_review_at ? <RelativeDays stamp={project.last_review_at} /> : 'Not yet reviewed'}</dd></div>
              <div><dt>Next review</dt><dd><DateText value={project.next_review_date} /></dd></div>
              <div><dt>Start date</dt><dd><DateText value={project.start_date} /></dd></div>
              <div><dt>Expected completion</dt><dd><DateText value={project.expected_completion_date} /></dd></div>
              <div><dt>Open challenges</dt><dd>{openIssues.length}</dd></div>
            </dl>
          </Card>

          <Card title="Team" hint="Student teams are recorded by team identifier; names are shown only where the institute has chosen to store them">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th><th>Name</th><th>Team</th><th>Contact</th><th>Status</th>
                    {can('project:update') && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((member) => (
                    <tr key={member.id}>
                      <td>{member.member_role.replace('_', ' ').toLowerCase()}</td>
                      <td>{member.name ?? <span className="rowsub">not recorded</span>}</td>
                      <td>{member.team_identifier ?? '—'}</td>
                      <td>{member.email ?? '—'}</td>
                      <td>
                        {member.status === 'PENDING' && can('team:approve') ? (
                          <MemberDecisionButtons
                            projectId={project.id} memberId={member.id}
                            onDone={(m) => refreshAfter(m)}
                          />
                        ) : (
                          <span className={`flag ${member.status === 'APPROVED' ? 'flag--ok' : member.status === 'PENDING' ? 'flag--warn' : 'flag--danger'}`}>
                            {member.status.toLowerCase()}
                          </span>
                        )}
                      </td>
                      {can('project:update') && (
                        <td>
                          <button
                            type="button" className="btn--sm btn--danger"
                            onClick={() => removeItem(
                              `/projects/${project.id}/members/${member.id}`,
                              'Remove this team member from the project?',
                              'The team member has been removed.',
                            )}
                          >
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {data.members.length === 0 && (
                    <tr><td colSpan={can('project:update') ? 6 : 5} className="table-empty">No team members recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {can('project:assign_guide') && (
              <AssignGuideForm projectId={project.id} onDone={(m) => refreshAfter(m)} />
            )}
          </Card>

          <Card title="Authorized links" hint="Repositories and documents stay in their own systems; only the link is stored here">
            {data.repositories.length === 0 && data.attachments.length === 0 ? (
              <p className="empty">No repositories or documents have been linked.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '1.1rem', listStyle: 'none' }}>
                {data.repositories.map((repository) => (
                  <li key={repository.id} style={{ marginBottom: 'var(--sp-2)' }}>
                    <a href={repository.repo_url} target="_blank" rel="noreferrer noopener">{repository.label}</a>
                    {' '}<span className="flag">{repository.provider} · {repository.visibility.toLowerCase()}</span>
                    {can('artefact:manage') && (
                      <button
                        type="button" className="btn--sm btn--danger" style={{ marginLeft: '0.5rem' }}
                        onClick={() => removeItem(
                          `/projects/${project.id}/repositories/${repository.id}`,
                          `Unlink the repository "${repository.label}"?`,
                          'The repository link has been removed.',
                        )}
                      >
                        Unlink
                      </button>
                    )}
                  </li>
                ))}
                {data.attachments.map((attachment) => (
                  <li key={attachment.id} style={{ marginBottom: 'var(--sp-2)' }}>
                    {attachment.external_url
                      ? <a href={attachment.external_url} target="_blank" rel="noreferrer noopener">{attachment.label}</a>
                      : attachment.label}
                    {' '}<span className="flag">{attachment.kind.toLowerCase()}</span>
                    {can('artefact:manage') && (
                      <button
                        type="button" className="btn--sm btn--danger" style={{ marginLeft: '0.5rem' }}
                        onClick={() => removeItem(
                          `/projects/${project.id}/attachments/${attachment.id}`,
                          `Unlink the document "${attachment.label}"?`,
                          'The document link has been removed.',
                        )}
                      >
                        Unlink
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(can('status:propose') || can('status:approve')) && (
            <Card title="Record a status change" hint="Every change is preserved with its rationale, author and timestamp">
              <StatusChangeForm
                projectId={project.id}
                currentStatus={project.rag_status as RagStatus}
                canApprove={can('status:approve')}
                blockers={data.blockers}
                onDone={() => refreshAfter('The status change has been recorded.')}
              />
            </Card>
          )}

          {can('project:update') && (
            <Card title="Edit this project">
              <EditProjectForm project={project} onSaved={refreshAfter} />
            </Card>
          )}

          {(can('project:update') || can('artefact:manage')) && (
            <Card title="Team and artefacts" hint="Add a team member, or link a repository or document">
              <TeamArtefactForms project={data} onDone={refreshAfter} />
            </Card>
          )}

          {can('project:create') && (
            <Card
              title="Delete this project"
              hint="Only available while the project has no recorded review or status history. Once it does, use the Archived checkbox in “Edit this project” instead - that preserves the record but removes it from active dashboards."
            >
              <button type="button" className="btn--danger" onClick={deleteProject} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete project'}
              </button>
            </Card>
          )}
        </>
      )}

      {effectiveTab === 'progress' && (
        <ProgressPanel
          projectId={project.id}
          permissions={permissions}
          officialCompletion={project.completion_percentage}
          onDone={refreshAfter}
        />
      )}

      {effectiveTab === 'definition' && (
        <>
        {can('project:edit_definition') && (
          <Card
            title="Edit project details"
            hint={Boolean(project.definition_frozen) && !can('project:update')
              ? `Frozen by ${project.frozen_by_name ?? 'the guide'} - you can no longer edit this.`
              : 'Theme, title and the other definition fields'}
          >
            <DefinitionEditForm
              project={project}
              locked={Boolean(project.definition_frozen) && !can('project:update')}
              onDone={(m) => refreshAfter(m)}
            />
          </Card>
        )}
        <Card title="Project definition">
          <dl className="deflist">
            {([
              ['Need statement', project.need_statement],
              ['Problem statement', project.problem_statement],
              ['Objective', project.objective],
              ['Learning outcomes', project.learning_outcomes],
              ['Foundation courses anchored', project.foundation_courses],
              ['Functional blocks', project.functional_blocks],
              ['Interfaces', project.interfaces],
              ['Dependencies', project.dependencies],
              ['Expected deliverables', project.expected_deliverables],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || <span className="rowsub">Not recorded</span>}</dd>
              </div>
            ))}
          </dl>
        </Card>
        </>
      )}

      {effectiveTab === 'foundation' && (
        <FoundationPanel
          projectId={project.id}
          themeId={project.theme_id}
          themeTitle={project.theme_title}
          guideAllocatedHint={data.members.some((m) => m.member_role === 'FACULTY_MENTOR' && m.status === 'APPROVED')}
          studentMembers={data.members.filter((m) => m.member_role === 'STUDENT' && m.status === 'APPROVED')}
          permissions={permissions}
          onDone={(m) => refreshAfter(m)}
        />
      )}

      {effectiveTab === 'execution' && (
        <>
          <Card title="Milestones">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Milestone</th><th>Planned</th><th>Actual</th><th>Status</th><th>Priority</th>
                    {can('project:update') && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.milestones.map((milestone) => (
                    <tr key={milestone.id}>
                      <td>
                        {milestone.title}
                        {milestone.description && <span className="rowsub">{milestone.description}</span>}
                      </td>
                      <td><DateText value={milestone.planned_date} /></td>
                      <td><DateText value={milestone.actual_date} /></td>
                      <td>
                        <span className={`flag ${milestone.status === 'MISSED' ? 'flag--danger' : milestone.status === 'COMPLETED' ? 'flag--ok' : milestone.status === 'CURRENT' ? 'flag--warn' : ''}`}>
                          {milestone.status.toLowerCase()}
                        </span>
                      </td>
                      <td>{milestone.is_critical ? <span className="flag flag--danger">Critical</span> : <span className="flag">Standard</span>}</td>
                      {can('project:update') && (
                        <td>
                          <button
                            type="button" className="btn--sm btn--danger"
                            onClick={() => removeItem(
                              `/projects/${project.id}/milestones/${milestone.id}`,
                              `Remove the milestone "${milestone.title}"?`,
                              'The milestone has been removed.',
                            )}
                          >
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {data.milestones.length === 0 && (
                    <tr><td colSpan={can('project:update') ? 6 : 5} className="table-empty">No milestones recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="KPI evidence" hint="Each KPI carries its target, latest measurement, evidence and accountable owner. Deleting a KPI removes every measurement recorded against it.">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>KPI</th><th>Target</th><th>Latest measurement</th><th>Measured</th><th>Evidence</th><th>Accountable</th>
                    {can('project:update') && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.kpis.map((kpi) => (
                    <tr key={kpi.id}>
                      <td>{kpi.name}{kpi.definition && <span className="rowsub">{kpi.definition}</span>}</td>
                      <td>{kpi.target_value}{kpi.unit ? ` ${kpi.unit}` : ''}</td>
                      <td>
                        {kpi.latest_value ?? '—'}
                        {kpi.latest_value !== null && (
                          <span className={`flag ${kpi.meets_target ? 'flag--ok' : 'flag--warn'}`} style={{ marginLeft: '0.4rem' }}>
                            {kpi.meets_target ? 'meets target' : 'below target'}
                          </span>
                        )}
                      </td>
                      <td><DateText value={kpi.latest_date} /></td>
                      <td>{kpi.latest_evidence ?? '—'}</td>
                      <td>{kpi.accountable_name ?? '—'}</td>
                      {can('project:update') && (
                        <td>
                          <button
                            type="button" className="btn--sm btn--danger"
                            onClick={() => removeItem(
                              `/projects/${project.id}/kpis/${kpi.id}`,
                              `Remove the KPI "${kpi.name}" and all its recorded measurements?`,
                              'The KPI has been removed.',
                            )}
                          >
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {data.kpis.length === 0 && (
                    <tr><td colSpan={can('project:update') ? 7 : 6} className="table-empty">No KPIs defined.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <ExecutionForms project={data} onDone={refreshAfter} />
        </>
      )}

      {effectiveTab === 'challenges' && (
        <>
          <Card
            title="Challenges"
            hint="Cause, impact, assistance required, owner, due date, escalation level and evidence"
          >
            {data.issues.length === 0 && <p className="empty">No challenges have been recorded.</p>}
            {data.issues.map((issue) => {
              const linked = data.actions.filter((action) => action.issue_id === issue.id);
              const isOpen = !['VERIFIED', 'CLOSED'].includes(issue.status);
              return (
                <div className={`panel ${isOpen && ['HIGH', 'CRITICAL'].includes(issue.severity) ? 'panel--red' : ''}`} key={issue.id}>
                  <h4>{issue.title}</h4>
                  <div className="btn-row" style={{ marginBottom: '0.5rem' }}>
                    <span className={`flag ${SEVERITY_FLAG[issue.severity]}`}>{issue.severity.toLowerCase()}</span>
                    <span className={`flag ${isOpen ? 'flag--warn' : 'flag--ok'}`}>{issue.status.replace('_', ' ').toLowerCase()}</span>
                    {issue.escalation_level !== 'NONE' && <span className="flag flag--warn">escalated to {issue.escalation_level.toLowerCase()}</span>}
                    <span className="flag">raised {issue.opened_at.slice(0, 10)}{issue.raised_by_name ? ` by ${issue.raised_by_name}` : ''}</span>
                    {isOpen && can('issue:update') && (
                      <button
                        type="button" className="btn--sm btn--danger"
                        onClick={() => removeItem(
                          `/projects/${project.id}/issues/${issue.id}`,
                          `Delete the challenge "${issue.title}"? This is only possible while it is open.`,
                          'The challenge has been deleted.',
                        )}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <dl className="deflist">
                    <div><dt>Description</dt><dd>{issue.description}</dd></div>
                    <div><dt>Root cause</dt><dd>{issue.root_cause || <span className="rowsub">Not recorded</span>}</dd></div>
                    <div><dt>Impact</dt><dd>{issue.impact || <span className="rowsub">Not recorded</span>}</dd></div>
                    <div>
                      <dt>Assistance required</dt>
                      <dd>
                        {issue.assistance_required || <span className="rowsub">None requested</span>}
                        {issue.support_source && issue.support_source !== 'NONE' && (
                          <span className="flag" style={{ marginLeft: '0.4rem' }}>from {issue.support_source.replace('_', ' ').toLowerCase()}</span>
                        )}
                      </dd>
                    </div>
                    <div><dt>Evidence</dt><dd>{issue.evidence || <span className="rowsub">Not recorded</span>}</dd></div>
                  </dl>

                  {linked.length > 0 && (
                    <div style={{ marginTop: 'var(--sp-4)' }}>
                      <h4>Corrective actions</h4>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Action</th><th>Owner</th><th>Due</th><th>Status</th><th>Evidence</th>
                              {can('action:update') && <th>Actions</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {linked.map((action) => (
                              <tr key={action.id}>
                                <td>{action.description}</td>
                                <td>{action.owner_display_name ?? '—'}</td>
                                <td>
                                  <DateText value={action.due_date} />
                                  {action.is_overdue ? <span className="flag flag--danger" style={{ marginLeft: '0.4rem' }}>overdue</span> : null}
                                </td>
                                <td><span className={`flag ${action.status === 'VERIFIED' ? 'flag--ok' : ''}`}>{action.status.toLowerCase()}</span></td>
                                <td>{action.evidence ?? '—'}</td>
                                {can('action:update') && (
                                  <td>
                                    {['OPEN', 'IN_PROGRESS', 'CANCELLED'].includes(action.status) && (
                                      <button
                                        type="button" className="btn--sm btn--danger"
                                        onClick={() => removeItem(
                                          `/projects/${project.id}/actions/${action.id}`,
                                          'Delete this corrective action?',
                                          'The corrective action has been deleted.',
                                        )}
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>

          {data.actions.some((action) => !action.issue_id) && (
            <Card title="Other corrective actions">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Action</th><th>Owner</th><th>Escalation owner</th><th>Due</th><th>Status</th>
                      {can('action:update') && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.actions.filter((action) => !action.issue_id).map((action) => (
                      <tr key={action.id}>
                        <td>{action.description}</td>
                        <td>{action.owner_display_name ?? '—'}</td>
                        <td>{action.escalation_owner_name ?? '—'}</td>
                        <td>
                          <DateText value={action.due_date} />
                          {action.is_overdue ? <span className="flag flag--danger" style={{ marginLeft: '0.4rem' }}>overdue</span> : null}
                        </td>
                        <td>{action.status.toLowerCase()}</td>
                        {can('action:update') && (
                          <td>
                            {['OPEN', 'IN_PROGRESS', 'CANCELLED'].includes(action.status) && (
                              <button
                                type="button" className="btn--sm btn--danger"
                                onClick={() => removeItem(
                                  `/projects/${project.id}/actions/${action.id}`,
                                  'Delete this corrective action?',
                                  'The corrective action has been deleted.',
                                )}
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <IssueForms
            project={data}
            onDone={(message) => refreshAfter(message)}
          />
        </>
      )}

      {effectiveTab === 'history' && (
        <>
          <Card title="Review history" hint="Preserved even after a project is archived">
            {data.reviews.length === 0 && <p className="empty">No reviews have been recorded.</p>}
            <ul className="timeline">
              {data.reviews.map((review) => (
                <li key={review.id}>
                  <div className="when">
                    {review.review_date.slice(0, 10)} · {review.reviewer_name} · decision:{' '}
                    <strong>{review.decision.replace('_', ' ').toLowerCase()}</strong>
                    {review.recommended_status && <> · recommended {review.recommended_status.toLowerCase()}</>}
                  </div>
                  <p>{review.comments}</p>
                  {review.corrective_action_summary && (
                    <p><strong>Corrective action:</strong> {review.corrective_action_summary}</p>
                  )}
                  {review.next_review_date && (
                    <p><strong>Next review:</strong> {review.next_review_date}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Status history" hint="Append-only: entries cannot be edited or deleted">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>When</th><th>Change</th><th>Recorded by</th><th>Rationale</th><th>Evidence</th><th>Approved by</th></tr>
                </thead>
                <tbody>
                  {data.history.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.changed_at.slice(0, 16)}</td>
                      <td>
                        {entry.previous_status ? `${entry.previous_status} → ` : 'Created as '}
                        <StatusBadge status={entry.new_status} short />
                      </td>
                      <td>{entry.changed_by_name}</td>
                      <td>{entry.rationale}</td>
                      <td>{entry.evidence ?? '—'}</td>
                      <td>{entry.approved_by_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {can('review:create') && (
            <ScheduledReviewsPanel
              projectId={project.id}
              canManageRubrics={can('review:create')}
              onDone={(m) => refreshAfter(m)}
            />
          )}

          {can('review:create') && (
            <Card title="Record a review" hint="Requirement 5.7: reviewers may approve, request changes, request evidence or escalate">
              <ReviewForm
                projectId={project.id}
                currentStatus={project.rag_status as RagStatus}
                onDone={() => refreshAfter('The review has been recorded.')}
              />
            </Card>
          )}
        </>
      )}
    </>
  );
}
