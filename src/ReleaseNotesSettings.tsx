import { RELEASE_NOTES, APP_VERSION } from './version';
import { cardClass } from './ui';
import { useI18n } from './i18n/useI18n';

export function ReleaseNotesSettings() {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('releaseNotes.title')}</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('releaseNotes.currentVersion', { version: APP_VERSION })}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {RELEASE_NOTES.map(entry => (
          <div key={entry.version} className={`${cardClass} p-4`}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                v{entry.version} — {entry.title}
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
