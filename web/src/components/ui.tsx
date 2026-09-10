import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RagStatus } from '../api';

/**
 * Accessibility requirement: colour is never the only carrier of meaning. Each
 * status renders a coloured marker with a distinct shape, a letter, and the full
 * text label, so the portal remains readable in greyscale and for colour-blind
 * users.
 */
const RAG_TEXT: Record<RagStatus, { letter: string; label: string }> = {
  GREEN: { letter: 'G', label: 'On Track' },
  YELLOW: { letter: 'Y', label: 'At Risk' },
  RED: { letter: 'R', label: 'Intervention Required' },
};

export function StatusBadge({ status, short = false }: { status: RagStatus; short?: boolean }) {
  const meta = RAG_TEXT[status];
  return (
    <span className={`rag rag--${status}`}>
      <span className="rag__mark" aria-hidden="true">{meta.letter}</span>
      {short ? status.charAt(0) + status.slice(1).toLowerCase() : `${status.charAt(0)}${status.slice(1).toLowerCase()} - ${meta.label}`}
    </span>
  );
}

export function RagBar({ counts, total }: { counts: Record<RagStatus, number>; total: number }) {
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div>
      <div
        className="ragbar"
        role="img"
        aria-label={`${counts.GREEN} on track, ${counts.YELLOW} at risk, ${counts.RED} needing intervention, of ${total} projects`}
      >
        {(['GREEN', 'YELLOW', 'RED'] as RagStatus[]).map((status) => (
          <div key={status} className={`ragbar__seg ragbar__seg--${status}`} style={{ width: `${pct(counts[status])}%` }} />
        ))}
      </div>
      <div className="ragbar-legend">
        <span><b>{counts.GREEN}</b> Green - On Track</span>
        <span><b>{counts.YELLOW}</b> Yellow - At Risk</span>
        <span><b>{counts.RED}</b> Red - Intervention Required</span>
      </div>
    </div>
  );
}

export function Stat({
  label, value, note, tone,
}: { label: string; value: ReactNode; note?: string; tone?: 'alert' | 'warn' }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {note && <div className="stat__note">{note}</div>}
    </div>
  );
}

export function Card({ title, hint, actions, children }: {
  title?: string; hint?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card__head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <div className="card__hint">{hint}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({ kind = 'info', title, children }: {
  kind?: 'error' | 'info' | 'success' | 'warn'; title?: string; children?: ReactNode;
}) {
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      {title && children ? <div>{children}</div> : children}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const err = error as { message?: string; details?: { field: string; message: string }[] };
  return (
    <Alert kind="error">
      {err.message ?? 'Something went wrong.'}
      {err.details?.length ? (
        <ul>
          {err.details.map((detail, index) => (
            <li key={index}>{detail.field}: {detail.message}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

export function Loading({ what = 'information' }: { what?: string }) {
  return <div className="loading" role="status">Loading {what}…</div>;
}

export function Breadcrumbs({ trail }: { trail: { label: string; to?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <span key={index}>
          {index > 0 && <span aria-hidden="true">›</span>}
          {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span style={{ margin: 0 }}>{crumb.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <span className="progress-wrap">
      <span className="progress" role="img" aria-label={`${value} percent complete`}>
        <span className="progress__fill" style={{ width: `${value}%` }} />
      </span>
      <span className="progress__text">{value}%</span>
    </span>
  );
}

/** Renders a date-only value, or an em dash when nothing is recorded. */
export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span aria-label="not recorded">—</span>;
  return <>{value.slice(0, 10)}</>;
}

export function daysSince(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const parsed = new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
}

export function RelativeDays({ stamp, suffix = 'ago' }: { stamp: string | null; suffix?: string }) {
  const days = daysSince(stamp);
  if (days === null) return <>—</>;
  if (days === 0) return <>today</>;
  if (days === 1) return <>1 day {suffix}</>;
  return <>{days} days {suffix}</>;
}
