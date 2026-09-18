import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { RELEASE_NOTES, APP_VERSION_DISPLAY } from './version';
import { cardClass, inputClass } from './ui';
import { useI18n } from './i18n/useI18n';

export function ReleaseNotesSettings() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [versionFilter, setVersionFilter] = useState('');

  const dates = useMemo(() => Array.from(new Set(RELEASE_NOTES.map(e => e.date))), []);
  const versions = useMemo(() => RELEASE_NOTES.map(e => e.version), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return RELEASE_NOTES.filter(entry => {
      if (dateFilter && entry.date !== dateFilter) return false;
      if (versionFilter && entry.version !== versionFilter) return false;
      if (q && !entry.title.toLowerCase().includes(q) && !entry.notes.some(n => n.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [search, dateFilter, versionFilter]);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('releaseNotes.title')}</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('releaseNotes.currentVersion', { version: APP_VERSION_DISPLAY })}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            className={`${inputClass} pl-8`}
            placeholder={t('releaseNotes.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={`${inputClass} w-auto`} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option value="">{t('releaseNotes.allDates')}</option>
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className={`${inputClass} w-auto`} value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)}>
          <option value="">{t('releaseNotes.allVersions')}</option>
          {versions.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('releaseNotes.noResults')}</p>
        )}
        {filtered.map(entry => (
          <div key={entry.version} className={`${cardClass} p-4`}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                {entry.version} — {entry.title}
              </h4>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{entry.date}</span>
            </div>
            <ul className="mt-2 pl-4 list-disc flex flex-col gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {entry.notes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
