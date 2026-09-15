import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import type { ApiUser } from '../api';
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, labelClass } from '../ui';
import { useAuth } from './useAuth';
import { AuthShell, FullScreenLoader } from './AuthShell';
import { ROLE_LABELS } from './roles';
import type { Role } from './roles';
import { useI18n } from '../i18n/useI18n';

export function AcceptInviteView({ token, onDone }: { token: string; onDone: () => void }) {
  const { setUser } = useAuth();
  const { t } = useI18n();
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [inviteError, setInviteError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch(`/invite-info/${token}`)
      .then(res => parseJsonOrError(res))
      .then(data => {
        const invite = data as { email: string; role: Role };
        setEmail(invite.email);
        setRole(invite.role);
        setStatus('valid');
      })
      .catch(err => {
        setInviteError(err instanceof Error ? err.message : 'This invite link is invalid.');
        setStatus('invalid');
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await apiFetch('/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });
      const data = await parseJsonOrError(res);
      setUser(data as ApiUser);
      onDone();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'checking') return <FullScreenLoader />;

  if (status === 'invalid') {
    return (
      <AuthShell title="Invite not available">
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{inviteError}</span>
        </div>
        <button className={`${buttonSecondaryClass} justify-center`} onClick={onDone}>Back to login</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join EA Designer" subtitle={`You've been invited as ${ROLE_LABELS[role]} - ${email}`}>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <div>
          <label className={labelClass}>{t('common.name')}</label>
          <input autoFocus className={inputClass} value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div>
          <label className={labelClass}>{t('auth.login.password')}</label>
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>

        {formError && (
          <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <button type="submit" className={`${buttonPrimaryClass} justify-center mt-1`} disabled={submitting}>
          {submitting ? 'Please wait...' : 'Accept & create account'}
        </button>
        <button type="button" className={`${buttonSecondaryClass} justify-center`} onClick={onDone}>
          Cancel
        </button>
      </form>
    </AuthShell>
  );
}
