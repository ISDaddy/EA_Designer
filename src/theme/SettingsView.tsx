import { useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { TeamSettings } from '../auth/TeamSettings';
import { ServerSettings } from '../auth/ServerSettings';
import { isAdmin, isSuperAdmin } from '../auth/roles';
import { useI18n } from '../i18n/useI18n';
import { TranslationsAdmin } from '../i18n/TranslationsAdmin';
import { AuditLogSettings } from '../audit/AuditLogSettings';
import { logAuditView } from '../audit/logView';
import { ReleaseNotesSettings } from '../ReleaseNotesSettings';
import { type SettingsTab } from './settingsTabs';

// Admin-only tabs are pages of sensitive data (the team roster, server credentials, translations)
// - worth a "page view" audit entry in their own right, same as opening a specific system/object/
// integration's detail panel on the canvas. "audit" excluded - AuditLogSettings logs its own view.
const AUDIT_LOGGED_TABS: Partial<Record<SettingsTab, string>> = { team: 'Team', serverSettings: 'Server Settings', translations: 'Translations' };

export function SettingsView({ tab, setTab }: { tab: SettingsTab; setTab: (tab: SettingsTab) => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const canManageTeam = isAdmin(user?.role);
  const canManageServer = isSuperAdmin(user?.role);

  // Appearance and Language & Region moved to the Profile page (personal, per-account preferences
  // reached by clicking your name in the header) - everything left here is either shared/app-wide
  // config (Team, Server Settings, Translations, Audit Log) or open to everyone to read (Release
  // Notes). Server Settings (email + Google Sign-In) is superadmin-only, one notch above the rest.
  const tabs: { id: SettingsTab; label: string }[] = [
    ...(canManageTeam ? [
      { id: 'team' as const, label: t('settings.tab.team') },
      { id: 'translations' as const, label: t('settings.tab.translations') },
      { id: 'audit' as const, label: t('settings.tab.audit') },
    ] : []),
    ...(canManageServer ? [{ id: 'serverSettings' as const, label: t('settings.tab.serverSettings') }] : []),
    { id: 'releaseNotes', label: t('settings.tab.releaseNotes') },
  ];
  // A non-admin whose last session left `tab` on an admin-only section (or an admin who lost the
  // role elsewhere) always has a valid tab to land on rather than a blank pane. releaseNotes is the
  // only tab guaranteed to exist regardless of role, so it's the fallback.
  const activeTab = tabs.some(x => x.id === tab) ? tab : 'releaseNotes';

  useEffect(() => {
    const label = AUDIT_LOGGED_TABS[activeTab];
    if (label) logAuditView('page', `settings/${activeTab}`, label);
  }, [activeTab]);

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-canvas)' }}>
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold tracking-[var(--heading-tracking)]" style={{ color: 'var(--text-primary)' }}>{t('settings.title')}</h2>
          {tabs.length > 1 && (
            <div className="inline-flex gap-1 p-1 flex-wrap" style={{ background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-card)' }}>
              {tabs.map(x => (
                <button
                  key={x.id}
                  className="px-3 py-1 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
                  style={activeTab === x.id ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
                  onClick={() => setTab(x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeTab === 'releaseNotes' && <ReleaseNotesSettings />}
        {activeTab === 'team' && canManageTeam && <TeamSettings />}
        {activeTab === 'serverSettings' && canManageServer && <ServerSettings />}
        {activeTab === 'translations' && canManageTeam && <TranslationsAdmin />}
        {activeTab === 'audit' && canManageTeam && <AuditLogSettings />}
      </div>
    </div>
  );
}
