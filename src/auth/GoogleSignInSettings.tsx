import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { inputClass, buttonPrimaryClass, labelClass } from '../ui';

type GoogleStatus = { configured: boolean; clientId: string | null };

export function GoogleSignInSettings() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [clientId, setClientId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await parseJsonOrError(await apiFetch('/settings/google'))) as GoogleStatus;
        if (cancelled) return;
        setStatus(data);
        setClientId(data.clientId || '');
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load Google Sign-In settings.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const data = (await parseJsonOrError(await apiFetch('/settings/google', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      }))) as GoogleStatus;
      setStatus(data);
      setClientId(data.clientId || '');
      setMessage({ ok: true, text: data.configured ? 'Saved - Google Sign-In is now enabled on the login screen.' : 'Cleared - Google Sign-In is hidden on the login screen.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div>
        <h3 className="font-bold text-base mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <KeyRound size={16} />Google Sign-In
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Lets someone log in with their Google account instead of a password - only for an email that already has an
          account here. A Web application OAuth Client ID from{' '}
          <span className="font-mono text-xs">console.cloud.google.com</span>; no client secret needed. See README.md
          for the full walkthrough. Leave blank to hide the button on the login screen.
        </p>
      </div>

      {loadError && (
        <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {status && (
        <div className="text-sm flex items-center gap-1.5" style={{ color: status.configured ? 'var(--success)' : 'var(--text-muted)' }}>
          {status.configured ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {status.configured ? 'Configured - the Google button is shown on the login screen.' : 'Not configured - the Google button is hidden.'}
        </div>
      )}

      <form className="flex flex-col gap-3 max-w-sm" onSubmit={handleSave}>
        <div>
          <label className={labelClass}>Client ID</label>
          <input
            className={inputClass}
            placeholder="xxxxxxxxxx.apps.googleusercontent.com"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
          />
        </div>

        {message && (
          <div className="flex items-start gap-1.5 text-sm" style={{ color: message.ok ? 'var(--success)' : 'var(--danger)' }}>
            {message.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <button type="submit" className={`${buttonPrimaryClass} self-start`} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </section>
  );
}
