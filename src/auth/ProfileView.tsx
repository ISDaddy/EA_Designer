import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, LogOut, ShieldCheck, ShieldAlert, Smartphone, Download, AlertTriangle, Trash2 } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import type { ApiUser } from '../api';
import { useAuth } from './useAuth';
import { ROLE_LABELS } from './roles';
import { useI18n } from '../i18n/useI18n';
import { LanguageSettings } from '../i18n/LanguageSettings';
import { AppearanceSettings } from '../theme/AppearanceSettings';
import { inputClass, labelClass, buttonPrimaryClass, buttonSecondaryClass, buttonDangerClass, cardClass } from '../ui';
import { Avatar } from './Avatar';
import { fileToAvatarDataUrl } from './avatar';

type SessionInfo = {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  isCurrent: boolean;
};

// A rough, good-enough "Chrome on Windows" summary from a raw user-agent string - not meant to be
// exhaustive, just enough for someone to recognize which of their own devices a session is.
function summarizeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

// Personal account settings, reached by clicking your name in the header - as opposed to the
// shared Settings page (Team, Email, Translations, Audit Log, Release Notes), which is either
// app-wide config or open to everyone to read. Nothing here affects any other user.
export function ProfileView() {
  const { user, setUser, logout } = useAuth();
  const { t } = useI18n();

  // --- Account (name/email) ---
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountMessage, setAccountMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Keeps the form in sync if the signed-in user changes underneath it (e.g. an admin renamed
  // this account elsewhere), without clobbering in-progress edits on every keystroke - the same
  // "derived state during render" pattern ThemeContext/I18nContext use to sync from `user`.
  const fingerprint = user ? `${user.id}:${user.name}:${user.email}` : null;
  const [syncedFingerprint, setSyncedFingerprint] = useState<string | null>(null);
  if (fingerprint !== syncedFingerprint) {
    setSyncedFingerprint(fingerprint);
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
  }

  const accountDirty = user != null && (name.trim() !== user.name || email.trim().toLowerCase() !== user.email);

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountDirty) return;
    setSavingAccount(true);
    setAccountMessage(null);
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const updated = (await parseJsonOrError(res)) as ApiUser;
      setUser(updated);
      setAccountMessage({ ok: true, text: t('profile.saved') });
    } catch (err) {
      setAccountMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setSavingAccount(false);
    }
  };

  // --- Avatar ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  const saveAvatar = async (avatarUrl: string | null) => {
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl }),
      });
      const updated = (await parseJsonOrError(res)) as ApiUser;
      setUser(updated);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarFile = async (file: File) => {
    setAvatarError('');
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await saveAvatar(dataUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  // --- Password change ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ ok: false, text: t('profile.passwordMismatch') });
      return;
    }
    setChangingPassword(true);
    try {
      await parseJsonOrError(await apiFetch('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      }));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ ok: true, text: t('profile.passwordChanged') });
    } catch (err) {
      setPasswordMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setChangingPassword(false);
    }
  };

  // --- Two-factor authentication ---
  const [totpStep, setTotpStep] = useState<'idle' | 'setup' | 'backupCodes' | 'disable'>('idle');
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableTotpPassword, setDisableTotpPassword] = useState('');

  const startTotpSetup = async () => {
    setTotpError('');
    setTotpBusy(true);
    try {
      const res = await apiFetch('/auth/2fa/setup', { method: 'POST' });
      const data = (await parseJsonOrError(res)) as { secret: string; otpauthUrl: string; qrCodeDataUrl: string };
      setTotpSetupData(data);
      setTotpCode('');
      setTotpStep('setup');
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setTotpError('');
    setTotpBusy(true);
    try {
      const res = await apiFetch('/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = (await parseJsonOrError(res)) as { backupCodes: string[] };
      setBackupCodes(data.backupCodes);
      setTotpStep('backupCodes');
      if (user) setUser({ ...user, totpEnabled: true });
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setTotpBusy(false);
    }
  };

  const finishTotpSetup = () => {
    setTotpStep('idle');
    setTotpSetupData(null);
    setBackupCodes(null);
    setTotpCode('');
  };

  const confirmDisableTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setTotpError('');
    setTotpBusy(true);
    try {
      await parseJsonOrError(await apiFetch('/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disableTotpPassword }),
      }));
      if (user) setUser({ ...user, totpEnabled: false });
      setTotpStep('idle');
      setDisableTotpPassword('');
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setTotpBusy(false);
    }
  };

  // --- Sessions ---
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionsError, setSessionsError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiFetch('/auth/sessions');
      const data = (await parseJsonOrError(res)) as { sessions: SessionInfo[] };
      setSessions(data.sessions);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to load sessions.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/auth/sessions');
        const data = (await parseJsonOrError(res)) as { sessions: SessionInfo[] };
        if (!cancelled) setSessions(data.sessions);
      } catch (err) {
        if (!cancelled) setSessionsError(err instanceof Error ? err.message : 'Failed to load sessions.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const revokeSession = async (id: string) => {
    setRevokingId(id);
    setSessionsError('');
    try {
      await parseJsonOrError(await apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' }));
      await loadSessions();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to revoke session.');
    } finally {
      setRevokingId(null);
    }
  };

  // --- Export my data / delete account ---
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportData = async () => {
    setExportError('');
    setExporting(true);
    try {
      const res = await apiFetch('/auth/me/export');
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ea-designer-my-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setExporting(false);
    }
  };

  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm'>('idle');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const confirmDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError('');
    setDeleting(true);
    try {
      await parseJsonOrError(await apiFetch('/auth/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      }));
      setUser(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Something went wrong.');
      setDeleting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-canvas)' }}>
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold tracking-[var(--heading-tracking)]" style={{ color: 'var(--text-primary)' }}>{t('profile.title')}</h2>
          <button className={buttonSecondaryClass} onClick={logout}>
            <LogOut size={14} />{t('nav.logout')}
          </button>
        </div>

        {/* Account */}
        <section className={`${cardClass} p-5 flex flex-col gap-4`}>
          <div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('profile.account')}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('profile.accountBlurb')}</p>
          </div>

          <div className="flex items-center gap-4">
            <Avatar name={user.name} avatarUrl={user.avatarUrl} size={64} />
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <button type="button" className={buttonSecondaryClass} disabled={avatarBusy} onClick={() => fileInputRef.current?.click()}>
                  <Camera size={14} />{t('profile.changePhoto')}
                </button>
                {user.avatarUrl && (
                  <button type="button" className={buttonSecondaryClass} disabled={avatarBusy} onClick={() => saveAvatar(null)}>
                    <Trash2 size={14} />{t('profile.removePhoto')}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f); e.target.value = ''; }}
              />
              {avatarError && <span className="text-xs" style={{ color: 'var(--danger)' }}>{avatarError}</span>}
            </div>
          </div>

          <form className="grid sm:grid-cols-2 gap-4" onSubmit={saveAccount}>
            <div>
              <label className={labelClass}>{t('common.name')}</label>
              <input className={inputClass} value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>{t('auth.login.email')}</label>
              <input type="email" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>{t('profile.role')}</label>
              <div className="text-sm px-2.5 py-1.5" style={{ color: 'var(--text-secondary)' }}>{ROLE_LABELS[user.role]}</div>
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <button type="submit" className={buttonPrimaryClass} disabled={!accountDirty || savingAccount}>
                {savingAccount ? t('common.loading') : t('common.save')}
              </button>
              {accountMessage && (
                <span className="text-sm flex items-center gap-1" style={{ color: accountMessage.ok ? 'var(--success)' : 'var(--danger)' }}>
                  {accountMessage.ok && <Check size={14} />}{accountMessage.text}
                </span>
              )}
            </div>
          </form>
        </section>

        <LanguageSettings />
        <AppearanceSettings />

        {/* Security: password + 2FA */}
        <section className={`${cardClass} p-5 flex flex-col gap-4`}>
          <div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('profile.security')}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('profile.securityBlurb')}</p>
          </div>
          <form className="grid sm:grid-cols-3 gap-4" onSubmit={changePassword}>
            <div>
              <label className={labelClass}>{t('profile.currentPassword')}</label>
              <input type="password" className={inputClass} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>{t('profile.newPassword')}</label>
              <input type="password" className={inputClass} value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} required />
            </div>
            <div>
              <label className={labelClass}>{t('profile.confirmNewPassword')}</label>
              <input type="password" className={inputClass} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={8} required />
            </div>
            <div className="sm:col-span-3 flex items-center gap-3">
              <button type="submit" className={buttonPrimaryClass} disabled={changingPassword}>
                {changingPassword ? t('common.loading') : t('profile.changePassword')}
              </button>
              {passwordMessage && (
                <span className="text-sm flex items-center gap-1" style={{ color: passwordMessage.ok ? 'var(--success)' : 'var(--danger)' }}>
                  {passwordMessage.ok && <Check size={14} />}{passwordMessage.text}
                </span>
              )}
            </div>
          </form>

          <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <h4 className="font-semibold text-sm mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              {user.totpEnabled ? <ShieldCheck size={15} color="var(--success)" /> : <ShieldAlert size={15} color="var(--text-muted)" />}
              {t('profile.twoFactor')}
            </h4>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{t('profile.twoFactorBlurb')}</p>

            {totpStep === 'idle' && (
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: user.totpEnabled ? 'var(--success)' : 'var(--text-muted)' }}>
                  {user.totpEnabled ? t('profile.twoFactorEnabled') : t('profile.twoFactorDisabled')}
                </span>
                {user.totpEnabled ? (
                  <button type="button" className={buttonSecondaryClass} onClick={() => { setTotpError(''); setDisableTotpPassword(''); setTotpStep('disable'); }}>
                    {t('profile.disable2fa')}
                  </button>
                ) : (
                  <button type="button" className={buttonSecondaryClass} disabled={totpBusy} onClick={startTotpSetup}>
                    {t('profile.enable2fa')}
                  </button>
                )}
              </div>
            )}

            {totpStep === 'setup' && totpSetupData && (
              <form className="flex flex-col gap-3" onSubmit={confirmTotpSetup}>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('profile.scanQrCode')}</p>
                <img src={totpSetupData.qrCodeDataUrl} alt="" width={160} height={160} className="rounded-[var(--radius-input)] border" style={{ borderColor: 'var(--border-subtle)' }} />
                <p className="text-xs font-mono break-all" style={{ color: 'var(--text-muted)' }}>{t('profile.manualEntryCode', { secret: totpSetupData.secret })}</p>
                <div className="max-w-xs">
                  <label className={labelClass}>{t('profile.verificationCode')}</label>
                  <input autoFocus inputMode="numeric" className={inputClass} value={totpCode} onChange={e => setTotpCode(e.target.value)} required />
                </div>
                {totpError && <span className="text-sm" style={{ color: 'var(--danger)' }}>{totpError}</span>}
                <div className="flex gap-2">
                  <button type="submit" className={buttonPrimaryClass} disabled={totpBusy}>{t('common.confirm')}</button>
                  <button type="button" className={buttonSecondaryClass} onClick={finishTotpSetup}>{t('common.cancel')}</button>
                </div>
              </form>
            )}

            {totpStep === 'backupCodes' && backupCodes && (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('profile.backupCodesTitle')}</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('profile.backupCodesBlurb')}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-[var(--radius-input)]" style={{ background: 'var(--bg-surface-alt)' }}>
                  {backupCodes.map(c => <code key={c} className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{c}</code>)}
                </div>
                <button type="button" className={`${buttonPrimaryClass} self-start`} onClick={finishTotpSetup}>{t('profile.backupCodesSaved')}</button>
              </div>
            )}

            {totpStep === 'disable' && (
              <form className="flex flex-col gap-3 max-w-xs" onSubmit={confirmDisableTotp}>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('profile.disable2faPasswordPrompt')}</p>
                <input
                  autoFocus type="password" className={inputClass} value={disableTotpPassword}
                  onChange={e => setDisableTotpPassword(e.target.value)} required
                />
                {totpError && <span className="text-sm" style={{ color: 'var(--danger)' }}>{totpError}</span>}
                <div className="flex gap-2">
                  <button type="submit" className={buttonDangerClass} disabled={totpBusy}>{t('profile.disable2fa')}</button>
                  <button type="button" className={buttonSecondaryClass} onClick={() => setTotpStep('idle')}>{t('common.cancel')}</button>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* Sessions */}
        <section className={`${cardClass} p-5 flex flex-col gap-3`}>
          <div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('profile.sessions')}</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('profile.sessionsBlurb')}</p>
          </div>
          {sessionsError && <p className="text-sm" style={{ color: 'var(--danger)' }}>{sessionsError}</p>}
          <div className="flex flex-col gap-2">
            {(sessions ?? []).map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2 p-2.5 rounded-[var(--radius-input)]" style={{ background: 'var(--bg-surface-alt)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <Smartphone size={16} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {summarizeUserAgent(s.userAgent)}
                      {s.isCurrent && (
                        <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--success)' }}>({t('profile.thisDevice')})</span>
                      )}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {s.ipAddress ? `${s.ipAddress} · ` : ''}{new Date(s.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    className="text-xs px-2 py-1 rounded-[var(--radius-input)] shrink-0 transition-colors"
                    style={{ background: 'var(--danger-container)', color: 'var(--on-danger-container)' }}
                    disabled={revokingId === s.id}
                    onClick={() => revokeSession(s.id)}
                  >
                    {t('profile.revoke')}
                  </button>
                )}
              </div>
            ))}
            {sessions && sessions.length <= 1 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('profile.noOtherSessions')}</p>
            )}
          </div>
        </section>

        {/* Danger zone */}
        <section className={`${cardClass} p-5 flex flex-col gap-4`} style={{ borderColor: 'var(--danger)' }}>
          <h3 className="font-bold text-base flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
            <AlertTriangle size={16} />{t('profile.dangerZone')}
          </h3>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('profile.exportData')}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('profile.exportDataBlurb')}</p>
              {exportError && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{exportError}</p>}
            </div>
            <button type="button" className={buttonSecondaryClass} disabled={exporting} onClick={exportData}>
              <Download size={14} />{t('profile.exportData')}
            </button>
          </div>

          <div className="pt-3 border-t flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('profile.deleteAccount')}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('profile.deleteAccountBlurb')}</p>
              </div>
              {deleteStep === 'idle' && (
                <button type="button" className={buttonDangerClass} onClick={() => { setDeleteError(''); setDeletePassword(''); setDeleteStep('confirm'); }}>
                  <Trash2 size={14} />{t('profile.deleteAccount')}
                </button>
              )}
            </div>
            {deleteStep === 'confirm' && (
              <form className="flex flex-col gap-3 max-w-xs" onSubmit={confirmDeleteAccount}>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('profile.deleteAccountConfirmPrompt')}</p>
                <input autoFocus type="password" className={inputClass} value={deletePassword} onChange={e => setDeletePassword(e.target.value)} required />
                {deleteError && <span className="text-sm" style={{ color: 'var(--danger)' }}>{deleteError}</span>}
                <div className="flex gap-2">
                  <button type="submit" className={buttonDangerClass} disabled={deleting}>{t('profile.deleteAccountButton')}</button>
                  <button type="button" className={buttonSecondaryClass} onClick={() => setDeleteStep('idle')}>{t('common.cancel')}</button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
