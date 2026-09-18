import { useEffect, useState } from 'react';
import { AlertCircle, Check, Crown, X } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { buttonPrimaryClass, buttonSecondaryClass, buttonDangerClass } from '../ui';
import { AuthShell, FullScreenLoader } from './AuthShell';
import { useI18n } from '../i18n/useI18n';

type ApprovalInfo = {
  targetName: string;
  targetEmail: string;
  requestedByName: string;
  requestedByEmail: string;
  requestStatus: string;
  expiresAt: string;
  alreadyDecided: boolean;
};

// The landing page for the link emailed to every other admin during Super Admin recovery (see
// SuperAdminRecovery.tsx / POST /api/superadmin-requests on the server) - reachable via
// ?superadmin-approve=<token> regardless of whether this browser is signed in as anyone, same as
// an invite or password-reset link, since the whole point is working even when normal login is
// part of the problem.
export function SuperAdminApprovalView({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid' | 'done'>('checking');
  const [info, setInfo] = useState<ApprovalInfo | null>(null);
  const [linkError, setLinkError] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => {
    apiFetch(`/superadmin-requests/approvals/${token}`)
      .then(res => parseJsonOrError(res))
      .then(data => {
        setInfo(data as ApprovalInfo);
        setStatus('valid');
      })
      .catch(err => {
        setLinkError(err instanceof Error ? err.message : 'This approval link is invalid.');
        setStatus('invalid');
      });
  }, [token]);

  const decide = async (decision: 'approve' | 'reject') => {
    setDeciding(true);
    try {
      const data = (await parseJsonOrError(await apiFetch(`/superadmin-requests/approvals/${token}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      }))) as { status: string };
      setResult(
        decision === 'reject' ? 'You rejected this request. It will not take effect.'
        : data.status === 'approved' ? 'Approved - every admin has now signed off, and the promotion has taken effect.'
        : 'Approved - still waiting on other admins before it takes effect.'
      );
      setStatus('done');
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setDeciding(false);
    }
  };

  if (status === 'checking') return <FullScreenLoader />;

  if (status === 'invalid') {
    return (
      <AuthShell title="Super Admin recovery">
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{linkError}</span>
        </div>
        <button className={`${buttonSecondaryClass} justify-center`} onClick={onDone}>{t('auth.forgotPassword.backToLogin')}</button>
      </AuthShell>
    );
  }

  if (status === 'done') {
    return (
      <AuthShell title="Super Admin recovery">
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--success)' }}>
          <Check size={15} className="mt-0.5 shrink-0" />
          <span>{result}</span>
        </div>
        <button className={`${buttonPrimaryClass} justify-center`} onClick={onDone}>{t('auth.forgotPassword.backToLogin')}</button>
      </AuthShell>
    );
  }

  if (!info) return null;

  if (info.alreadyDecided || info.requestStatus !== 'pending') {
    return (
      <AuthShell title="Super Admin recovery">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {info.alreadyDecided ? 'You have already responded to this request.' : `This request has already been ${info.requestStatus}.`}
        </p>
        <button className={`${buttonSecondaryClass} justify-center`} onClick={onDone}>{t('auth.forgotPassword.backToLogin')}</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Super Admin recovery">
      <div className="flex flex-col gap-3">
        <p className="text-sm flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <Crown size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
          <span>
            <strong>{info.requestedByName}</strong> ({info.requestedByEmail}) has requested that{' '}
            <strong>{info.targetName}</strong> ({info.targetEmail}) be made a Super Admin, as part of the recovery
            process for when no Super Admin can log in. This only takes effect once every other admin approves.
          </span>
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Expires {new Date(info.expiresAt).toLocaleString()}. If you didn't expect this, reject it.
        </p>
        <div className="flex gap-2">
          <button className={buttonPrimaryClass} disabled={deciding} onClick={() => decide('approve')}>
            <Check size={14} />Approve
          </button>
          <button className={buttonDangerClass} disabled={deciding} onClick={() => decide('reject')}>
            <X size={14} />Reject
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
