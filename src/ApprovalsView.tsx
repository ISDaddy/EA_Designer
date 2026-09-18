import { useEffect, useState } from 'react';
import { AlertCircle, Check, X as XIcon } from 'lucide-react';
import { apiFetch, parseJsonOrError } from './api';
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, buttonDangerClass, labelClass } from './ui';
import { useAuth } from './auth/useAuth';
import { useI18n } from './i18n/useI18n';
import { formatInTimeZone } from './i18n/timezone';
import { isAdmin as isAdminRole } from './auth/roles';
import { logAuditView } from './audit/logView';

type ChangeRequest = {
  id: string;
  requested_by: string;
  requested_by_name: string | null;
  requested_by_email: string;
  action: 'create' | 'update' | 'delete';
  resource_type: 'edge' | 'edge_object_detail';
  resource_id: string;
  secondary_id: string | null;
  payload: Record<string, unknown>;
  affected_system_ids: string[];
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
};

type MinimalEdge = { id: string; source: string; target: string };
type MinimalObject = { id: string; name: string };

const STATUS_COLORS: Record<ChangeRequest['status'], { bg: string; fg: string }> = {
  pending: { bg: 'var(--warning-container)', fg: 'var(--on-warning-container)' },
  approved: { bg: 'var(--success-container)', fg: 'var(--on-success-container)' },
  rejected: { bg: 'var(--danger-container)', fg: 'var(--on-danger-container)' },
  withdrawn: { bg: 'var(--bg-surface-alt)', fg: 'var(--text-secondary)' },
};

const PAGE_SIZE = 20;

type Tab = 'awaitingMe' | 'mine' | 'all';

function describeChange(
  cr: ChangeRequest,
  getSystemLabel: (id: string | null | undefined) => string | undefined,
  edges: MinimalEdge[],
  dataObjects: MinimalObject[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const label = (id: string | null | undefined) => (id ? getSystemLabel(id) || id : '?');

  if (cr.resource_type === 'edge') {
    let source: string | undefined;
    let target: string | undefined;
    if (cr.action === 'create' || cr.action === 'update') {
      source = (cr.payload?.source as string) || edges.find(e => e.id === cr.resource_id)?.source;
      target = (cr.payload?.target as string) || edges.find(e => e.id === cr.resource_id)?.target;
    } else {
      const existing = edges.find(e => e.id === cr.resource_id);
      source = existing?.source;
      target = existing?.target;
    }
    const flow = `${label(source)} → ${label(target)}`;
    if (cr.action === 'create') return t('approvals.summary.edgeCreate', { flow });
    if (cr.action === 'delete') return t('approvals.summary.edgeDelete', { flow });
    return t('approvals.summary.edgeUpdate', { flow });
  }

  // edge_object_detail
  const parentEdge = edges.find(e => e.id === cr.resource_id);
  const flow = parentEdge ? `${label(parentEdge.source)} → ${label(parentEdge.target)}` : cr.resource_id;
  const objectName = dataObjects.find(o => o.id === cr.secondary_id)?.name || cr.secondary_id || '?';
  if (cr.action === 'delete') return t('approvals.summary.detailDelete', { object: objectName, flow });
  return t('approvals.summary.detailUpdate', { object: objectName, flow });
}

function ChangeRequestRow({
  cr, showApproveReject, showWithdraw, getSystemLabel, edges, dataObjects, timeZone, locale, t, onDecided,
}: {
  cr: ChangeRequest;
  showApproveReject: boolean;
  showWithdraw: boolean;
  getSystemLabel: (id: string | null | undefined) => string | undefined;
  edges: MinimalEdge[];
  dataObjects: MinimalObject[];
  timeZone: string;
  locale: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onDecided: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const colors = STATUS_COLORS[cr.status];

  const act = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(path, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      await parseJsonOrError(res);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('approvals.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 rounded-[var(--radius-input)] border flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {describeChange(cr, getSystemLabel, edges, dataObjects, t)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {t('approvals.requestedBy', { name: cr.requested_by_name || cr.requested_by_email })} &middot; {formatInTimeZone(new Date(cr.created_at), timeZone, locale)}
          </p>
          {cr.status !== 'pending' && cr.decision_reason && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{t('approvals.reason', { reason: cr.decision_reason })}</p>
          )}
        </div>
        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-semibold shrink-0" style={{ background: colors.bg, color: colors.fg }}>
          {t(`approvals.status.${cr.status}`)}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showApproveReject && cr.status === 'pending' && !rejecting && (
        <div className="flex gap-2">
          <button className={buttonPrimaryClass} disabled={busy} onClick={() => act(`/change-requests/${cr.id}/approve`)}>
            <Check size={14} />{t('approvals.approve')}
          </button>
          <button className={buttonSecondaryClass} disabled={busy} onClick={() => setRejecting(true)}>
            <XIcon size={14} />{t('approvals.reject')}
          </button>
        </div>
      )}

      {showApproveReject && cr.status === 'pending' && rejecting && (
        <div className="flex flex-col gap-2">
          <div>
            <label className={labelClass}>{t('approvals.rejectReasonLabel')}</label>
            <input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('approvals.rejectReasonPlaceholder')} />
          </div>
          <div className="flex gap-2">
            <button
              className={buttonDangerClass}
              disabled={busy || !reason.trim()}
              onClick={() => act(`/change-requests/${cr.id}/reject`, { reason: reason.trim() })}
            >
              {t('approvals.confirmReject')}
            </button>
            <button className={buttonSecondaryClass} disabled={busy} onClick={() => { setRejecting(false); setReason(''); }}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {showWithdraw && cr.status === 'pending' && (
        <div>
          <button className={buttonSecondaryClass} disabled={busy} onClick={() => act(`/change-requests/${cr.id}/withdraw`)}>
            {t('approvals.withdraw')}
          </button>
        </div>
      )}
    </div>
  );
}

// A full page (not a Settings tab, since it's relevant to every System Owner, not just admins) for
// deciding pending changes that touched a system outside the requester's ownership, and for
// tracking the status of one's own proposals - see resolveEdgeAuthority/createChangeRequest in
// server/index.js for how a change ends up here instead of applying immediately.
export function ApprovalsView({ getSystemLabel, edges, dataObjects }: {
  getSystemLabel: (id: string | null | undefined) => string | undefined;
  edges: MinimalEdge[];
  dataObjects: MinimalObject[];
}) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const timeZone = user?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const admin = isAdminRole(user?.role);

  const [tab, setTab] = useState<Tab>('awaitingMe');
  const [entries, setEntries] = useState<ChangeRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  const activeTab: Tab = tab === 'all' && !admin ? 'awaitingMe' : tab;

  // Inlined rather than routed through a shared loader function - calling a function known to set
  // state directly from inside an effect body trips the "set-state-in-effect" lint rule, even for a
  // plain fetch-on-filter-change (see the same pattern/comment in AuditLogSettings.tsx).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('scope', activeTab);
        params.set('status', activeTab === 'awaitingMe' ? 'pending' : statusFilter);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(page * PAGE_SIZE));
        const res = await apiFetch(`/change-requests?${params.toString()}`);
        const data = (await parseJsonOrError(res)) as { changeRequests: ChangeRequest[]; total: number };
        if (cancelled) return;
        setEntries(data.changeRequests);
        setTotal(data.total);
        setLoadError('');
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t('approvals.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, statusFilter, page, reloadTick, t]);

  useEffect(() => { logAuditView('page', 'approvals', 'Approvals'); }, []);

  const switchTab = (id: Tab) => { setTab(id); setPage(0); };
  const changeStatusFilter = (value: 'pending' | 'all') => { setStatusFilter(value); setPage(0); };

  const from = page * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE + entries.length, total);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'awaitingMe', label: t('approvals.tab.awaitingMe') },
    { id: 'mine', label: t('approvals.tab.mine') },
    ...(admin ? [{ id: 'all' as const, label: t('approvals.tab.all') }] : []),
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-canvas)' }}>
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold tracking-[var(--heading-tracking)]" style={{ color: 'var(--text-primary)' }}>{t('approvals.title')}</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('approvals.blurb')}</p>
          </div>
          <div className="inline-flex gap-1 p-1 flex-wrap" style={{ background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-card)' }}>
            {tabs.map(x => (
              <button
                key={x.id}
                className="px-3 py-1 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
                style={activeTab === x.id ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
                onClick={() => switchTab(x.id)}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab !== 'awaitingMe' && (
          <div className="flex items-center gap-2">
            <label className={labelClass}>{t('approvals.filters.status')}</label>
            <select className={`${inputClass} w-auto`} value={statusFilter} onChange={e => changeStatusFilter(e.target.value as 'pending' | 'all')}>
              <option value="pending">{t('approvals.status.pending')}</option>
              <option value="all">{t('approvals.filters.allStatuses')}</option>
            </select>
          </div>
        )}

        {loadError && (
          <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {entries.map(cr => (
            <ChangeRequestRow
              key={cr.id}
              cr={cr}
              showApproveReject={activeTab === 'awaitingMe'}
              showWithdraw={activeTab === 'mine'}
              getSystemLabel={getSystemLabel}
              edges={edges}
              dataObjects={dataObjects}
              timeZone={timeZone}
              locale={locale}
              t={t}
              onDecided={() => setReloadTick(x => x + 1)}
            />
          ))}
          {entries.length === 0 && !loading && (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('approvals.noResults')}</div>
          )}
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>{loading ? t('common.loading') : t('inventory.showing', { shown: total === 0 ? '0' : `${from}-${to}`, total })}</span>
            <div className="flex gap-2">
              <button className={buttonSecondaryClass} disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>{t('common.previous')}</button>
              <button className={buttonSecondaryClass} disabled={to >= total} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
