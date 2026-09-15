import { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { inputClass, buttonSecondaryClass, labelClass } from '../ui';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import { formatInTimeZone } from '../i18n/timezone';
import { logAuditView } from './logView';

type AuditEntry = {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_label: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  ip_address: string | null;
};

type RosterUser = { id: string; name: string; email: string };

const ACTIONS = ['view', 'create', 'update', 'delete', 'login', 'login_failed', 'logout'] as const;

// Every resourceType string the backend's logAudit calls actually use (see server/index.js), plus
// "page" for the frontend's own page-level view pings - kept as an explicit list rather than
// derived from the fetched entries so the filter offers every type even before any of them has
// happened yet (e.g. on a brand-new install).
const RESOURCE_TYPES = [
  'system', 'data_object', 'edge', 'integration_flow', 'integration_types', 'integration_software',
  'system_downtime', 'language', 'translation', 'translation_import', 'user', 'invite', 'session',
  'nda_acceptance', 'settings_email', 'page',
] as const;

const PAGE_SIZE = 25;

const ACTION_COLORS: Record<string, { bg: string; fg: string }> = {
  view: { bg: 'var(--bg-surface-alt)', fg: 'var(--text-secondary)' },
  create: { bg: 'var(--success-container)', fg: 'var(--on-success-container)' },
  update: { bg: 'var(--warning-container)', fg: 'var(--on-warning-container)' },
  delete: { bg: 'var(--danger-container)', fg: 'var(--on-danger-container)' },
  login: { bg: 'var(--success-container)', fg: 'var(--on-success-container)' },
  login_failed: { bg: 'var(--danger-container)', fg: 'var(--on-danger-container)' },
  logout: { bg: 'var(--bg-surface-alt)', fg: 'var(--text-secondary)' },
};

async function downloadFile(path: string, filename: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExpandableRow({ entry, timeZone, locale, t }: { entry: AuditEntry; timeZone: string; locale: string; t: (key: string, vars?: Record<string, string | number>) => string }) {
  const [open, setOpen] = useState(false);
  const hasDetails = entry.before_data !== null || entry.after_data !== null || (entry.changed_fields && entry.changed_fields.length > 0);
  const actorLabel = entry.actor_name || entry.actor_email || t('auditLog.unknownUser');
  const colors = ACTION_COLORS[entry.action] || ACTION_COLORS.view;

  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <td className="px-3 py-2 align-top whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
          {formatInTimeZone(new Date(entry.occurred_at), timeZone, locale)}
        </td>
        <td className="px-3 py-2 align-top" style={{ color: 'var(--text-primary)' }}>
          <span className="block font-medium">{actorLabel}</span>
          {entry.actor_role && <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>{entry.actor_role}</span>}
        </td>
        <td className="px-3 py-2 align-top">
          <span
            className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: colors.bg, color: colors.fg }}
          >
            {t(`auditLog.action.${entry.action}`)}
          </span>
        </td>
        <td className="px-3 py-2 align-top" style={{ color: 'var(--text-primary)' }}>
          <span className="block">{entry.resource_label || entry.resource_id || '—'}</span>
          <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
            {t(`auditLog.resourceType.${entry.resource_type}`)}
          </span>
        </td>
        <td className="px-3 py-2 align-top">
          {hasDetails && (
            <button
              className="inline-flex items-center gap-1 text-xs transition-colors"
              style={{ color: 'var(--primary)' }}
              onClick={() => setOpen(o => !o)}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {t('auditLog.column.details')}
            </button>
          )}
        </td>
      </tr>
      {open && hasDetails && (
        <tr className="border-t" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-alt)' }}>
          <td colSpan={5} className="px-3 py-3">
            {entry.changed_fields && entry.changed_fields.length > 0 && (
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                {t('auditLog.changedFields', { fields: entry.changed_fields.join(', ') })}
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {entry.before_data !== null && (
                <div>
                  <span className="block text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('auditLog.before')}</span>
                  <pre className="text-xs p-2 rounded-[var(--radius-input)] overflow-x-auto" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(entry.before_data, null, 2)}
                  </pre>
                </div>
              )}
              {entry.after_data !== null && (
                <div>
                  <span className="block text-xs font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('auditLog.after')}</span>
                  <pre className="text-xs p-2 rounded-[var(--radius-input)] overflow-x-auto" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(entry.after_data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            {entry.ip_address && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>IP: {entry.ip_address}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Admin-only module (rendered conditionally by SettingsView) for browsing and exporting the
// append-only audit trail - the reporting surface an auditor actually gets handed. Every view,
// create, update, and delete recorded elsewhere in the app (see logAudit in server/index.js and
// logAuditView on the frontend) lands here, filterable by date, user, resource type, and action.
export function AuditLogSettings() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const timeZone = user?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [exportError, setExportError] = useState('');
  const [page, setPage] = useState(0);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  const buildQuery = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (actorUserId) params.set('actorUserId', actorUserId);
    if (resourceType) params.set('resourceType', resourceType);
    if (action) params.set('action', action);
    if (search) params.set('search', search);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return params.toString();
  };

  useEffect(() => {
    // Inlined rather than routed through `buildQuery`/a shared loader function - calling a function
    // known to set state directly from inside an effect body trips the "set-state-in-effect" lint
    // rule, even for a plain fetch-on-filter-change (see the same pattern/comment in
    // TeamSettings.tsx). Building the query string inline here (rather than depending on
    // `buildQuery`, which is recreated every render) also keeps the dependency array exact.
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        if (actorUserId) params.set('actorUserId', actorUserId);
        if (resourceType) params.set('resourceType', resourceType);
        if (action) params.set('action', action);
        if (search) params.set('search', search);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(page * PAGE_SIZE));
        const res = await apiFetch(`/audit-log?${params.toString()}`);
        const data = (await parseJsonOrError(res)) as { entries: AuditEntry[]; total: number };
        if (cancelled) return;
        setEntries(data.entries);
        setTotal(data.total);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load the audit log.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, fromDate, toDate, actorUserId, resourceType, action, search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/team-roster');
        const data = (await parseJsonOrError(res)) as { users: RosterUser[] };
        if (!cancelled) setRoster(data.users);
      } catch {
        // best-effort - the actor filter just stays empty if this fails
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // "page"/"settings/audit", not a made-up "audit_log" resourceType - matches the convention the
    // other admin-only settings tabs use in SettingsView.tsx, so this row renders with a real
    // translated resource-type label instead of falling back to a raw, untranslated key.
    logAuditView('page', 'settings/audit', 'Audit Log');
  }, []);

  const resetFilters = () => {
    setFromDate(''); setToDate(''); setActorUserId(''); setResourceType(''); setAction(''); setSearch('');
    setPage(0);
  };

  const from = page * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE + entries.length, total);

  return (
    <section
      className="p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('auditLog.title')}</h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('auditLog.blurb')}</p>
        </div>
        <button
          className={buttonSecondaryClass}
          onClick={() => downloadFile(`/audit-log/export?${buildQuery()}`, 'audit-log.csv').catch(err => setExportError(err.message))}
        >
          <Download size={14} />{t('auditLog.export')}
        </button>
      </div>

      {exportError && (
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end">
        <div>
          <label className={labelClass}>{t('auditLog.filters.from')}</label>
          <input type="date" className={inputClass} value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }} />
        </div>
        <div>
          <label className={labelClass}>{t('auditLog.filters.to')}</label>
          <input type="date" className={inputClass} value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }} />
        </div>
        <div>
          <label className={labelClass}>{t('auditLog.filters.actor')}</label>
          <select className={inputClass} value={actorUserId} onChange={e => { setActorUserId(e.target.value); setPage(0); }}>
            <option value="">{t('auditLog.filters.allUsers')}</option>
            {roster.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('auditLog.filters.resourceType')}</label>
          <select className={inputClass} value={resourceType} onChange={e => { setResourceType(e.target.value); setPage(0); }}>
            <option value="">{t('auditLog.filters.allResourceTypes')}</option>
            {RESOURCE_TYPES.map(rt => <option key={rt} value={rt}>{t(`auditLog.resourceType.${rt}`)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('auditLog.filters.action')}</label>
          <select className={inputClass} value={action} onChange={e => { setAction(e.target.value); setPage(0); }}>
            <option value="">{t('auditLog.filters.allActions')}</option>
            {ACTIONS.map(a => <option key={a} value={a}>{t(`auditLog.action.${a}`)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('common.search')}</label>
          <input type="text" className={inputClass} placeholder={t('auditLog.filters.search')} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </div>
      </div>
      <div>
        <button className={buttonSecondaryClass} onClick={resetFilters}>{t('auditLog.filters.clear')}</button>
      </div>

      {loadError && (
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
            <tr>
              <th className="px-3 py-2">{t('auditLog.column.time')}</th>
              <th className="px-3 py-2">{t('auditLog.column.actor')}</th>
              <th className="px-3 py-2">{t('auditLog.column.action')}</th>
              <th className="px-3 py-2">{t('auditLog.column.resource')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <ExpandableRow key={entry.id} entry={entry} timeZone={timeZone} locale={locale} t={t} />
            ))}
            {entries.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('auditLog.noResults')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span>{loading ? t('common.loading') : t('inventory.showing', { shown: total === 0 ? '0' : `${from}-${to}`, total })}</span>
        <div className="flex gap-2">
          <button className={buttonSecondaryClass} disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            {t('common.previous')}
          </button>
          <button className={buttonSecondaryClass} disabled={to >= total} onClick={() => setPage(p => p + 1)}>
            {t('common.next')}
          </button>
        </div>
      </div>
    </section>
  );
}
