import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import type { ApiUser } from '../api';
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, labelClass } from '../ui';
import { useAuth } from './useAuth';
import { AuthShell, FullScreenLoader } from './AuthShell';
import { useI18n } from '../i18n/useI18n';

export function ResetPasswordView({ token, onDone }: { token: string; onDone: () => void }) {
  const { setUser } = useAuth();
  const { t } = useI18n();
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [linkError, setLinkError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch(`/reset-password-info/${token}`)
      .then(res => parseJsonOrError(res))
      .then(data => {
        setEmail((data as { email: string }).email);
        setStatus('valid');
      })
      .catch(err => {
        setLinkError(err instanceof Error ? err.message : 'This reset link is invalid.');
        setStatus('invalid');
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await apiFetch('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
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
      <AuthShell title={t('auth.resetPassword.unavailable')}>
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{linkError}</span>
        </div>
        <button className={`${buttonSecondaryClass} justify-center`} onClick={onDone}>{t('auth.forgotPassword.backToLogin')}</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.resetPassword.title')} subtitle={email}>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <div>
          <label className={labelClass}>{t('auth.resetPassword.newPassword')}</label>
          <input
            type="password"
            autoFocus
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
          {submitting ? 'Please wait...' : t('auth.resetPassword.submit')}
        </button>
        <button type="button" className={`${buttonSecondaryClass} justify-center`} onClick={onDone}>
          {t('common.cancel')}
        </button>
      </form>
    </AuthShell>
  );
}
