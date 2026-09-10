import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, type InstituteSummary, type RagStatus } from '../api';
import { useSession } from '../session';
import { Alert, Card, ErrorMessage, Loading, RagBar, Stat } from '../components/ui';

interface ProgrammeSummary {
  institutes: number;
  counts: Record<RagStatus, number>;
  total: number;
  percentages: Record<RagStatus, number>;
  instituteBreakdown: { instituteId: string; shortName: string; name: string; projects: number; red: number }[];
}

/**
 * FR 5.2. A user authorized for exactly one institute is taken straight there and
 * never sees another institute's name; a user with several picks from the ones
 * they hold a grant for.
 */
export function PortfolioPage() {
  const { session } = useSession();
  const [institutes, setInstitutes] = useState<InstituteSummary[] | null>(null);
  const [autoSelect, setAutoSelect] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProgrammeSummary | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.get<{ institutes: InstituteSummary[]; autoSelectInstituteId: string | null }>('/institutes');
        if (cancelled) return;
        setInstitutes(list.institutes);
        setAutoSelect(list.autoSelectInstituteId);
        if (list.institutes.length > 1) {
          setSummary(await api.get<ProgrammeSummary>('/institutes/summary'));
        }
      } catch (caught) {
        if (!cancelled) setError(caught);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorMessage error={error} />;
  if (!institutes) return <Loading what="your portfolio" />;

  if (autoSelect) return <Navigate to={`/institutes/${autoSelect}`} replace />;

  if (institutes.length === 0) {
    return (
      <Alert kind="warn" title="No institute access has been granted yet">
        Your account is active but no institute, department or project has been assigned to it.
        Please contact your institute administrator.
      </Alert>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Programme portfolio</h1>
          <p>{session?.access.scopeDescription}. Select an institute to continue.</p>
        </div>
      </div>

      {summary && (
        <Card title="Consolidated status" hint={`${summary.total} projects across ${summary.institutes} authorized institutes`}>
          <div className="grid grid--stats" style={{ marginBottom: '1rem' }}>
            <Stat label="Institutes" value={summary.institutes} />
            <Stat label="Active projects" value={summary.total} />
            <Stat
              label="Intervention required"
              value={summary.counts.RED}
              note={`${summary.percentages.RED}% of the portfolio`}
              tone={summary.counts.RED > 0 ? 'alert' : undefined}
            />
            <Stat
              label="At risk"
              value={summary.counts.YELLOW}
              note={`${summary.percentages.YELLOW}% of the portfolio`}
              tone={summary.counts.YELLOW > 0 ? 'warn' : undefined}
            />
          </div>
          <RagBar counts={summary.counts} total={summary.total} />
        </Card>
      )}

      <div className="grid grid--cards" style={{ marginTop: '1rem' }}>
        {institutes.map((institute) => (
          <section className="card institute-card" key={institute.id}>
            <h2 style={{ marginBottom: '0.15rem' }}>
              <Link to={`/institutes/${institute.id}`} className="rowlink">{institute.short_name}</Link>
            </h2>
            <div className="card__hint institute-card__hint">
              {institute.name}{institute.city ? ` · ${institute.city}` : ''}
            </div>
            <div className="figure-group">
              <div>
                <div className="stat__label">Departments</div>
                <div className="figure__value">{institute.department_count}</div>
              </div>
              <div>
                <div className="stat__label">Projects</div>
                <div className="figure__value">{institute.project_count}</div>
              </div>
              <div>
                <div className="stat__label">Red</div>
                <div className={`figure__value${institute.red_count ? ' figure__value--alert' : ''}`}>
                  {institute.red_count}
                </div>
              </div>
            </div>
            <div className="institute-card__footer">
              {institute.red_count > 0 && (
                <span className="flag flag--danger">
                  {institute.red_count === 1
                    ? '1 project needs intervention'
                    : `${institute.red_count} projects need intervention`}
                </span>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
