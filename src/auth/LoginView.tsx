import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { inputClass, buttonPrimaryClass, labelClass } from '../ui';
import { useAuth } from './useAuth';
import { AuthShell, FullScreenLoader } from './AuthShell';
import { useI18n } from '../i18n/useI18n';

export function LoginView() {
  const { login, refresh } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<'checking' | 'setup' | 'login'>('checking');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/auth/bootstrap-status')
      .then(res => parseJsonOrError(res))
      .then(data => setMode((data as { needsSetup: boolean }).needsSetup ? 'setup' : 'login'))
      .catch(() => setMode('login'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'setup') {
        const res = await apiFetch('/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        await parseJsonOrError(res);
        await refresh();
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === 'checking') return <FullScreenLoader />;

  return (
    <AuthShell
      title={mode === 'setup' ? t('auth.setup.title') : t('auth.login.title')}
      subtitle={mode === 'setup' ? 'No one has set up this workspace yet - the first account becomes an admin.' : undefined}
    >
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {mode === 'setup' && (
          <div>
            <label className={labelClass}>{t('auth.setup.name')}</label>
            <input autoFocus className={inputClass} value={name} onChange={e => setName(e.target.value)} required />
          </div>
        )}
        <div>
          <label className={labelClass}>{t('auth.login.email')}</label>
          <input
            type="email"
            autoFocus={mode === 'login'}
            className={inputClass}
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>{t('auth.login.password')}</label>
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={mode === 'setup' ? 8 : undefined}
            required
          />
        </div>

        {error && (
          <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className={`${buttonPrimaryClass} justify-center mt-1`} disabled={submitting}>
          {submitting ? 'Please wait...' : mode === 'setup' ? t('auth.setup.submit') : t('auth.login.submit')}
        </button>
      </form>
    </AuthShell>
  );
}
