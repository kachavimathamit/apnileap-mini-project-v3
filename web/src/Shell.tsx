import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from './session';

/**
 * FR 5.2: the shell always shows the signed-in user's active role, their access
 * scope and the last data refresh, so nobody has to guess what they are seeing.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { session, signOut, can } = useSession();
  const navigate = useNavigate();

  if (!session) return null;

  const { user, access, system, notifications, pendingReviews } = session;
  const canAdminister = access.permissions.includes('user:manage');
  const canReport = can('report:view');
  const canAudit = can('audit:view');
  const canReview = can('progress:review');
  const canApproveMentors = can('mentor:approve');

  const lastRefresh = system.lastDataRefresh
    ? `${system.lastDataRefresh.slice(0, 16).replace(' ', ' at ')}`
    : 'no project updates recorded yet';

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to main content</a>

      <header className="topbar">
        <div className="topbar__brand">
          Mini-Project Portfolio Monitoring Portal
          <span>ApniLeap mini-project programme</span>
        </div>
        <nav className="topbar__nav" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}>Portfolio</NavLink>
          {canReview && (
            <NavLink to="/reviews/pending" className={({ isActive }) => (isActive ? 'is-active' : '')}>
              Pending Reviews
              {pendingReviews.count > 0 && (
                <span className="badge-count" aria-label={`${pendingReviews.count} awaiting your decision`}>{pendingReviews.count}</span>
              )}
            </NavLink>
          )}
          {canApproveMentors && (
            <NavLink to="/admin/role-requests" className={({ isActive }) => (isActive ? 'is-active' : '')}>
              Mentor Registrations
            </NavLink>
          )}
          {canReport && (
            <NavLink to="/reports/weekly" className={({ isActive }) => (isActive ? 'is-active' : '')}>
              Weekly report
            </NavLink>
          )}
          <NavLink to="/notifications" className={({ isActive }) => (isActive ? 'is-active' : '')}>
            Alerts
            {notifications.unread > 0 && (
              <span className="badge-count" aria-label={`${notifications.unread} unread`}>{notifications.unread}</span>
            )}
          </NavLink>
          {canAdminister && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'is-active' : '')}>Administration</NavLink>
          )}
          {canAudit && (
            <NavLink to="/admin/audit" className={({ isActive }) => (isActive ? 'is-active' : '')}>Audit</NavLink>
          )}
          <NavLink to="/account/password" className={({ isActive }) => (isActive ? 'is-active' : '')}>Password</NavLink>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </button>
        </nav>
      </header>

      <div className="scopebar">
        <span><strong>{user.fullName}</strong>{user.designation ? ` · ${user.designation}` : ''}</span>
        <span>Role: <strong>{access.roleLabels.join(', ') || 'No role assigned'}</strong></span>
        <span>Access scope: <strong>{access.scopeDescription}</strong></span>
        <span>Last data refresh: <strong>{lastRefresh}</strong></span>
      </div>

      <main id="main">{children}</main>
    </div>
  );
}
