import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Crown, X } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, labelClass } from '../ui';
import { useAuth } from './useAuth';

type AdminOption = { id: string; name: string; email: string };

type ApprovalInfo = { approverName: string; approverEmail: string; decision: string | null; decidedAt: string | null };
type SuperAdminRequest = {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  target: { id: string; name: string; email: string };
  requestedBy: { id: string; name: string; email: string };
  approvals: ApprovalInfo[];
};

// The break-glass path for when no Super Admin can log in: any admin can ask that some admin
// (themselves included) be promoted, but it only takes effect once every OTHER admin approves via
// a one-time emailed link (see POST /api/superadmin-requests on the server) - a single rejection
// kills it. If the requester is the only admin, it applies immediately with no approvals needed.
export function SuperAdminRecovery({ admins }: { admins: AdminOption[] }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<SuperAdminRequest[]>([]);
  const [loadError, setLoadError] = useState('');
  const [targetId, setTargetId] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      const data = (await parseJsonOrError(await apiFetch('/superadmin-requests'))) as { requests: SuperAdminRequest[] };
      setRequests(data.requests);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load requests.');
    }
  }, []);

  useEffect(() => {
    // Not routed through `loadRequests` (used by the mutation handlers below to refresh
    // afterwards) - calling a function known to set state directly from inside an effect body
    // trips the "set-state-in-effect" lint rule, even for a plain fetch-on-mount.
    let cancelled = false;
    (async () => {
      try {
        const data = (await parseJsonOrError(await apiFetch('/superadmin-requests'))) as { requests: SuperAdminRequest[] };
        if (!cancelled) setRequests(data.requests);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load requests.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequesting(true);
    setMessage(null);
    try {
      const data = (await parseJsonOrError(await apiFetch('/superadmin-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: targetId, appUrl: window.location.origin }),
      }))) as { autoApproved?: boolean; totalApprovers: number };
      setMessage({
        ok: true,
        text: data.autoApproved
          ? 'Done - you were the only admin, so the promotion took effect immediately.'
          : `Request sent - ${data.totalApprovers} other admin${data.totalApprovers === 1 ? '' : 's'} need to approve by email before it takes effect.`,
      });
      setTargetId('');
      setShowForm(false);
      loadRequests();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setRequesting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await parseJsonOrError(await apiFetch(`/superadmin-requests/${id}`, { method: 'DELETE' }));
      loadRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel request.');
    }
  };

  const pending = requests.filter(r => r.status === 'pending');
  const resolved = requests.filter(r => r.status !== 'pending').slice(0, 5);

  return (
    <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <span className="block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Super Admin Recovery</span>
          <p className="text-xs mt-1 max-w-lg" style={{ color: 'var(--text-muted)' }}>
            For when no Super Admin can log in. Requests that an admin be promoted to Super Admin - takes effect once
            every other admin approves by email.
          </p>
        </div>
        {!showForm && admins.length > 0 && (
          <button type="button" className={buttonSecondaryClass} onClick={() => { setMessage(null); setShowForm(true); }}>
            <Crown size={14} />Request Super Admin
          </button>
        )}
      </div>

      {loadError && (
        <div className="flex items-start gap-1.5 text-sm mb-2" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {showForm && (
        <form className="flex gap-2 flex-wrap items-end mb-3 p-3 rounded-[var(--radius-input)]" style={{ background: 'var(--bg-surface-alt)' }} onSubmit={handleRequest}>
          <div>
            <label className={labelClass}>Promote</label>
            <select className={`${inputClass} w-auto`} value={targetId} onChange={e => setTargetId(e.target.value)} required>
              <option value="" disabled>Select an admin...</option>
              {admins.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email}){a.id === user?.id ? ' - you' : ''}</option>)}
            </select>
          </div>
          <button type="submit" className={buttonPrimaryClass} disabled={requesting || !targetId}>
            {requesting ? 'Requesting...' : 'Send Request'}
          </button>
          <button type="button" className={buttonSecondaryClass} onClick={() => setShowForm(false)}>Cancel</button>
        </form>
      )}

      {message && (
        <div
          className="mb-3 p-3 rounded-[var(--radius-input)] text-sm"
          style={{ background: message.ok ? 'var(--success-container)' : 'var(--warning-container)', color: message.ok ? 'var(--on-success-container)' : 'var(--on-warning-container)' }}
        >
          {message.text}
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-2 mb-2">
          {pending.map(r => (
            <div key={r.id} className="p-2.5 rounded-[var(--radius-input)] text-sm" style={{ background: 'var(--bg-surface-alt)' }}>
              <div className="flex items-center justify-between gap-2">
                <span style={{ color: 'var(--text-primary)' }}>
                  Promote <strong>{r.target.name}</strong> - requested by {r.requestedBy.name}
                </span>
                <button type="button" className="p-1 rounded-full" style={{ color: 'var(--danger)' }} title="Cancel" onClick={() => handleCancel(r.id)}>
                  <X size={14} />
                </button>
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {r.approvals.filter(a => a.decision === 'approved').length} of {r.approvals.length} approved &middot; expires {new Date(r.expiresAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <summary className="cursor-pointer select-none">Past requests</summary>
          <div className="flex flex-col gap-1 mt-2">
            {resolved.map(r => (
              <div key={r.id} className="flex items-center gap-1.5">
                {r.status === 'approved' ? <Check size={12} color="var(--success)" /> : <X size={12} color="var(--danger)" />}
                Promote {r.target.name} - {r.status}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
