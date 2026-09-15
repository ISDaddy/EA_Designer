import { useEffect, useRef, useState } from 'react';
import { apiFetch, parseJsonOrError } from '../api';
import type { ApiUser } from '../api';
import { useAuth } from '../auth/useAuth';
import { useI18n } from './useI18n';
import type { LocaleCode } from './locales';
import { TIME_ZONE_OPTIONS, detectBrowserTimeZone, timeZoneLabel } from './timezone';
import { inputClass, labelClass } from '../ui';

// Personal preferences, available to every signed-in user (not just admins) - unlike the
// Translations tab, which edits the shared text (and language list) everyone sees.
export function LanguageSettings() {
  const { user, setUser } = useAuth();
  const { locale, setLocale, languages, t } = useI18n();
  const [savingTz, setSavingTz] = useState(false);
  const autoSetRef = useRef(false);

  const timeZone = user?.timeZone || detectBrowserTimeZone();
  const zoneOptions = TIME_ZONE_OPTIONS.includes(timeZone) ? TIME_ZONE_OPTIONS : [timeZone, ...TIME_ZONE_OPTIONS];

  const saveTimeZone = async (tz: string) => {
    setSavingTz(true);
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone: tz }),
      });
      const updated = await parseJsonOrError(res) as ApiUser;
      setUser(updated);
    } catch {
      // best-effort - the picker just won't reflect a failed save until the page is refreshed
    } finally {
      setSavingTz(false);
    }
  };

  // A brand-new account has no time zone yet - default it to the browser's own zone the first
  // time we see that, rather than leaving it unset until the user happens to open this page.
  useEffect(() => {
    if (user && !user.timeZone && !autoSetRef.current) {
      autoSetRef.current = true;
      saveTimeZone(detectBrowserTimeZone());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.timeZone]);

  return (
    <section
      className="p-5 flex flex-col gap-6"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('settings.languageRegion')}</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('settings.languageRegionBlurb')}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>{t('settings.language')}</label>
          <select className={inputClass} value={locale} onChange={(e) => setLocale(e.target.value as LocaleCode)}>
            {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('settings.yourTimeZone')}</label>
          <select className={inputClass} value={timeZone} disabled={savingTz} onChange={(e) => saveTimeZone(e.target.value)}>
            {zoneOptions.map(tz => <option key={tz} value={tz}>{timeZoneLabel(tz)}</option>)}
          </select>
        </div>
      </div>
    </section>
  );
}
