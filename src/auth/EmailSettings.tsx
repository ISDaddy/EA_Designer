import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, labelClass } from '../ui';

type EmailStatus = { configured: boolean; smtpUser: string | null };

export function EmailSettings() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await parseJsonOrError(await apiFetch('/settings/email'))) as EmailStatus;
        if (cancelled) return;
        setStatus(data);
        setSmtpUser(data.smtpUser || '');
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load email settings.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const data = (await parseJsonOrError(await apiFetch('/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smtpUser, smtpPass }),
      }))) as EmailStatus;
      setStatus(data);
      setSmtpUser(data.smtpUser || '');
      setSmtpPass('');
      setMessage({ ok: true, text: `Saved - invite emails now send from ${data.smtpUser}.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm("Stop sending invite emails automatically? Invites will still generate a link you can copy and share yourself.")) return;
    setRemoving(true);
    setMessage(null);
    try {
      const data = (await parseJsonOrError(await apiFetch('/settings/email', { method: 'DELETE' }))) as EmailStatus;
      setStatus(data);
      setSmtpUser('');
      setSmtpPass('');
      setMessage({ ok: true, text: 'Email sending disabled.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section
      className="p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div>
        <h3 className="font-bold text-base mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Mail size={16} />Email
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          The Gmail account invite emails are sent from. Requires an <span className="font-medium">App Password</span> (needs
          2-Step Verification enabled on that account) from{' '}
          <span className="font-mono text-xs">myaccount.google.com/apppasswords</span> - not the account's normal password.
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
          {status.configured ? `Configured - sending from ${status.smtpUser}` : 'Not configured - invite links must be copied and sent manually.'}
        </div>
      )}

      <form className="flex flex-col gap-3 max-w-sm" onSubmit={handleSave}>
        <div>
          <label className={labelClass}>Sender email</label>
          <input
            type="email"
            className={inputClass}
            placeholder="you@company.com"
            value={smtpUser}
            onChange={e => setSmtpUser(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>App password</label>
          <input
            type="password"
            className={inputClass}
            placeholder={status?.configured ? 'Leave blank to keep the current password' : '16-character app password'}
            value={smtpPass}
            onChange={e => setSmtpPass(e.target.value)}
          />
        </div>

        {message && (
          <div className="flex items-start gap-1.5 text-sm" style={{ color: message.ok ? 'var(--success)' : 'var(--danger)' }}>
            {message.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertCircle size={15} className="mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" className={buttonPrimaryClass} disabled={saving}>
            {saving ? 'Verifying...' : 'Save'}
          </button>
          {status?.configured && (
            <button type="button" className={buttonSecondaryClass} onClick={handleRemove} disabled={removing}>
              {removing ? 'Removing...' : 'Remove'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
