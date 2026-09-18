import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { Popover } from '../App';
import { useI18n } from '../i18n/useI18n';
import { useAuth } from '../auth/useAuth';
import { formatInTimeZone } from '../i18n/timezone';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link_view: string;
  link_id: string;
  read_at: string | null;
  created_at: string;
};

// Polling, not push - simplest option that keeps the unread badge reasonably fresh without adding
// a websocket/SSE channel just for this. 30s is frequent enough to feel responsive without hammering
// the API.
const POLL_MS = 30000;

// A bell in the header, next to the profile button - every notify() call on the backend (see
// server/index.js) lands here as an in-app row regardless of that user's per-type email opt-out,
// since in-app notifications are never opt-out-able.
export function NotificationsBell({ onNavigate }: { onNavigate: (linkView: string) => void }) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const timeZone = user?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Bumped to trigger a refetch (on mount, on a poll tick, or when the bell is opened) - inlining
  // the fetch inside the effect below (rather than calling a shared `load` function from it) avoids
  // the "set-state-in-effect" lint rule, same as the pattern in AuditLogSettings.tsx.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/notifications?limit=20');
        const data = (await parseJsonOrError(res)) as { notifications: Notification[]; unreadCount: number };
        if (cancelled) return;
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      } catch {
        // best-effort - the bell just stays at its last known state if this fails
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  useEffect(() => {
    const interval = setInterval(() => setTick(x => x + 1), POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const markRead = async (id: string) => {
    setNotifications(ns => ns.map(n => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnreadCount(c => Math.max(0, c - 1));
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
    } catch {
      // best-effort
    }
  };

  const markAllRead = async () => {
    setNotifications(ns => ns.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await apiFetch('/notifications/read-all', { method: 'POST' });
    } catch {
      // best-effort
    }
  };

  return (
    <Popover
      align="right"
      trigger={({ toggle }) => (
        <button
          className="relative p-1.5 rounded-full transition-colors"
          style={{ background: 'color-mix(in srgb, var(--text-on-header) 12%, transparent)' }}
          title={t('notifications.title')}
          onClick={() => { toggle(); setTick(x => x + 1); }}
        >
          <Bell size={14} style={{ color: 'var(--text-on-header)' }} />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
              style={{ background: 'var(--danger)', color: 'var(--on-danger)' }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-2 -m-4 p-0 max-h-[70vh]">
          <div className="flex items-center justify-between px-4 pt-4">
            <h4 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{t('notifications.title')}</h4>
            {unreadCount > 0 && (
              <button className="text-xs font-medium" style={{ color: 'var(--primary)' }} onClick={markAllRead}>
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex flex-col divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {notifications.length === 0 && (
              <p className="text-sm px-4 pb-4" style={{ color: 'var(--text-muted)' }}>{t('notifications.empty')}</p>
            )}
            {notifications.map(n => (
              <button
                key={n.id}
                className="text-left px-4 py-2.5 transition-colors hover:opacity-90"
                style={{ background: n.read_at ? 'transparent' : 'color-mix(in srgb, var(--primary) 8%, transparent)' }}
                onClick={() => {
                  if (!n.read_at) markRead(n.id);
                  if (n.link_view) { onNavigate(n.link_view); close(); }
                }}
              >
                <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                {n.body && <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.body}</span>}
                <span className="block text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {formatInTimeZone(new Date(n.created_at), timeZone, locale)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
