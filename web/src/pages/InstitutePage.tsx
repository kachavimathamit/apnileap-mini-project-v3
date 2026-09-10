import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type InstituteDashboard } from '../api';
import { useSession } from '../session';
import {
  Breadcrumbs, Card, DateText, ErrorMessage, Loading, RagBar, Stat, StatusBadge,
} from '../components/ui';

/** Requirement 5.3: the institute dashboard. */
export function InstitutePage() {
  const { instituteId } = useParams();
  const { session } = useSession();
  const [data, setData] = useState<InstituteDashboard | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.get<InstituteDashboard>(`/institutes/${instituteId}/dashboard`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((caught) => { if (!cancelled) setError(caught); });
    return () => { cancelled = true; };
  }, [instituteId]);

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <Loading what="the institute dashboard" />;

  const multiInstitute = (session?.access.instituteCount ?? 0) > 1;
  const trendMax = Math.max(1, ...data.trend.map((point) => point.GREEN + point.YELLOW + point.RED));

  return (
    <>
      {multiInstitute && <Breadcrumbs trail={[{ label: 'Programme portfolio', to: '/' }, { label: data.institute?.shortName ?? 'Institute' }]} />}

      <div className="page-head">
        <div>
          <h1>{data.institute?.name}</h1>
          <p>
            {data.departmentCount} department{data.departmentCount === 1 ? '' : 's'} · {data.total} active project
            {data.total === 1 ? '' : 's'}{data.institute?.city ? ` · ${data.institute.city}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid--stats">
        <Stat label="Green - On Track" value={data.counts.GREEN} note={`${data.percentages.GREEN}% of projects`} />
        <Stat
          label="Yellow - At Risk" value={data.counts.YELLOW}
          note={`${data.percentages.YELLOW}% of projects`}
          tone={data.counts.YELLOW > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Red - Intervention Required" value={data.counts.RED}
          note={`${data.percentages.RED}% of projects`}
          tone={data.counts.RED > 0 ? 'alert' : undefined}
        />
        <Stat label="Departments" value={data.departmentCount} note="within your authorized scope" />
      </div>

      <div className="grid grid--two" style={{ marginTop: '1rem' }}>
        <Card title="Portfolio distribution">
          <RagBar counts={data.counts} total={data.total} />
        </Card>

        <Card title="Four-week trend" hint="Reconstructed from the recorded status history">
          <div className="trend">
            {data.trend.map((point) => {
              const height = (n: number) => `${(n / trendMax) * 78}px`;
              return (
                <div className="trend__col" key={point.date}>
                  {point.RED > 0 && <div className="trend__bar ragbar__seg--RED" style={{ height: height(point.RED) }} title={`${point.RED} Red`} />}
                  {point.YELLOW > 0 && <div className="trend__bar ragbar__seg--YELLOW" style={{ height: height(point.YELLOW) }} title={`${point.YELLOW} Yellow`} />}
                  {point.GREEN > 0 && <div className="trend__bar ragbar__seg--GREEN" style={{ height: height(point.GREEN) }} title={`${point.GREEN} Green`} />}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            {data.trend.map((point) => (
              <div className="trend__label" key={point.date} style={{ flex: 1 }}>
                {point.date.slice(5)}
                <br />
                <span style={{ color: point.RED ? 'var(--red)' : 'var(--ink-faint)' }}>{point.RED}R</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Needs attention" hint={`A project is counted as stale after ${data.attention.staleThresholdDays} days without an update`}>
        <div className="grid grid--stats">
          <Stat label="Awaiting review" value={data.attention.awaitingReview} note="never reviewed, or review date reached" />
          <Stat
            label="With overdue actions" value={data.attention.overdueActions}
            tone={data.attention.overdueActions > 0 ? 'alert' : undefined}
          />
          <Stat
            label="Not recently updated" value={data.attention.staleProjects}
            tone={data.attention.staleProjects > 0 ? 'warn' : undefined}
          />
          <Stat label="Assistance requested" value={data.attention.assistanceRequests} note="open challenges asking for support" />
        </div>
      </Card>

      <Card title="Departments" hint="Select a department to see its projects">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Head</th>
                <th>Coordinator</th>
                <th className="numeric">Projects</th>
                <th className="numeric">Green</th>
                <th className="numeric">Yellow</th>
                <th className="numeric">Red</th>
              </tr>
            </thead>
            <tbody>
              {data.departments.map((department) => (
                <tr key={department.id}>
                  <td>
                    <Link className="rowlink" to={`/departments/${department.id}`}>{department.name}</Link>
                    <span className="rowsub">{department.code}</span>
                  </td>
                  <td>{department.head_name ?? '—'}</td>
                  <td>{department.coordinator_name ?? '—'}</td>
                  <td className="numeric">{department.project_count}</td>
                  <td className="numeric">
                    {department.green_count > 0
                      ? <strong style={{ color: 'var(--green)' }}>{department.green_count}</strong>
                      : 0}
                  </td>
                  <td className="numeric">
                    {department.yellow_count > 0
                      ? <strong style={{ color: 'var(--yellow)' }}>{department.yellow_count}</strong>
                      : 0}
                  </td>
                  <td className="numeric">
                    {department.red_count > 0
                      ? <strong style={{ color: 'var(--red)' }}>{department.red_count}</strong>
                      : 0}
                  </td>
                </tr>
              ))}
              {data.departments.length === 0 && (
                <tr><td colSpan={7} className="table-empty">No departments are within your authorized scope.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Upcoming milestones" hint="Next 30 days">
        {data.upcomingMilestones.length === 0 ? (
          <p className="empty">No milestones are scheduled in the next 30 days.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Milestone</th><th>Project</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {data.upcomingMilestones.map((milestone) => (
                  <tr key={milestone.id}>
                    <td><DateText value={milestone.planned_date} /></td>
                    <td>{milestone.title}</td>
                    <td>
                      <Link className="rowlink" to={`/projects/${milestone.project_id}`}>{milestone.project_title}</Link>
                      <span className="rowsub">{milestone.project_code}</span>
                    </td>
                    <td>{milestone.is_critical ? <span className="flag flag--danger">Critical</span> : <span className="flag">Standard</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Status definitions" hint="Applied identically across every institute">
        <dl className="deflist">
          {(['GREEN', 'YELLOW', 'RED'] as const).map((status) => {
            const definition = session?.system.ragDefinitions[status];
            return (
              <div key={status}>
                <dt><StatusBadge status={status} /></dt>
                <dd>
                  {definition?.criteria}
                  <br />
                  <strong>Response:</strong> {definition?.response}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>
    </>
  );
}
