import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { Card, ErrorMessage, Loading, RelativeDays } from '../components/ui';

interface Notification {
  id: string;
  event_type: string;
  title: string;
  body: string;
  is_read: number;
  created_at: string;
  project_id: string | null;
  project_code: string | null;
  project_title: string | null;
}

const EVENT_FLAG: Record<string, string> = {
  PROJECT_TURNED_RED: 'flag--danger',
  ACTION_OVERDUE: 'flag--danger',
  PROJECT_RECOVERED: 'flag--ok',
  PROJECT_STALE: 'flag--warn',
  REVIEW_APPROACHING: 'flag--warn',
  SUPPORT_REQUESTED: 'flag--warn',
  ACCESS_CHANGED: '',
};

/** Requirement 9.1. Recipients are derived from access grants, so alerts never leak. */
export function NotificationsPage() {
  const { refresh } = useSession();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ notifications: Notification[] }>('/me/notifications');
      setItems(result.notifications);
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function markAllRead() {
    await api.post('/me/notifications/read', {});
    await load();
    await refresh();
  }

  // Opening one alert marks only that alert read - the rest of the list is untouched.
  async function markOneRead(item: Notification) {
    if (item.is_read) return;
    setItems((current) => current?.map((n) => (n.id === item.id ? { ...n, is_read: 1 } : n)) ?? current);
    await api.post('/me/notifications/read', { ids: [item.id] });
    await refresh();
  }

  if (error) return <ErrorMessage error={error} />;
  if (!items) return <Loading what="your alerts" />;

  const unread = items.filter((item) => !item.is_read).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p>{unread} unread of {items.length} within your authorized scope.</p>
        </div>
        <button type="button" onClick={markAllRead} disabled={unread === 0}>Mark all as read</button>
      </div>

      <Card>
        {items.length === 0 ? (
          <p className="empty">You have no alerts.</p>
        ) : (
          <ul className="timeline">
            {items.map((item) => (
              <li
                key={item.id}
                className={item.is_read ? undefined : 'timeline__item--unread'}
                onClick={() => void markOneRead(item)}
              >
                <div className="when">
                  <RelativeDays stamp={item.created_at} />
                  {' · '}
                  <span className={`flag ${EVENT_FLAG[item.event_type] ?? ''}`}>
                    {item.event_type.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  {!item.is_read && <span className="flag flag--warn">unread</span>}
                </div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                {item.project_id && (
                  <p>
                    <Link to={`/projects/${item.project_id}`} onClick={() => void markOneRead(item)}>
                      Open {item.project_code ?? 'project'}
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
