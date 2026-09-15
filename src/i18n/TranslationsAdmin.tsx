import { useMemo, useRef, useState } from 'react';
import { Search, Download, Upload, Plus, X } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import { useI18n } from './useI18n';
import { inputClass, buttonSecondaryClass, labelClass } from '../ui';

// A row is edited in place per (key, locale) cell rather than as a whole-row form, since most
// edits are "fix this one language's wording for this one string" - editing cell-by-cell means
// there's nothing to submit and nothing to lose by switching rows mid-edit.
function TranslationCell({ keyName, locale }: { keyName: string; locale: string }) {
  const { translationsByLocale, updateTranslation } = useI18n();
  const [value, setValue] = useState(translationsByLocale[locale]?.[keyName] ?? '');
  const [saving, setSaving] = useState(false);
  const saved = value === (translationsByLocale[locale]?.[keyName] ?? '');

  const commit = async () => {
    if (saved) return;
    setSaving(true);
    try {
      await updateTranslation(keyName, locale, value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      type="text"
      className={`${inputClass} px-2 py-1 text-xs`}
      style={saved ? undefined : { borderColor: 'var(--warning)' }}
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

// Downloads a same-origin-authenticated response as a file - fetch (rather than a plain <a href>
// navigation) guarantees the admin session cookie is sent and lets us name the file ourselves.
async function downloadFile(path: string, filename: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Admin-only module (rendered conditionally by SettingsView) for editing the actual text shown in
// each language, adding/removing which languages exist, and bulk import/export via CSV - the
// DB-backed counterpart to the i18n module's static key catalog (server/translations-seed.js),
// which only supplies the starting values for whatever languages exist at seed time.
export function TranslationsAdmin() {
  const { translationsByLocale, loading, languages, addLanguage, removeLanguage, refreshTranslations, t } = useI18n();
  const [search, setSearch] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [languageError, setLanguageError] = useState('');
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const keys = useMemo(() => {
    const all = new Set<string>();
    Object.values(translationsByLocale).forEach(byKey => Object.keys(byKey).forEach(k => all.add(k)));
    const sorted = Array.from(all).sort();
    if (!search) return sorted;
    const needle = search.toLowerCase();
    return sorted.filter(k =>
      k.toLowerCase().includes(needle) ||
      languages.some(l => (translationsByLocale[l.code]?.[k] || '').toLowerCase().includes(needle))
    );
  }, [translationsByLocale, languages, search]);

  const submitAddLanguage = async () => {
    setLanguageError('');
    try {
      await addLanguage(newCode.trim().toLowerCase(), newLabel.trim());
      setNewCode('');
      setNewLabel('');
    } catch (err) {
      setLanguageError(err instanceof Error ? err.message : 'Failed to add language.');
    }
  };

  const doRemoveLanguage = async (code: string) => {
    if (!window.confirm(`Remove "${code}" and every translated string in it? This can't be undone.`)) return;
    setLanguageError('');
    setBusyCode(code);
    try {
      await removeLanguage(code);
    } catch (err) {
      setLanguageError(err instanceof Error ? err.message : 'Failed to remove language.');
    } finally {
      setBusyCode(null);
    }
  };

  const handleImportFile = async (file: File) => {
    setImportMessage('');
    try {
      const csv = await file.text();
      const res = await apiFetch('/translations/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = (await parseJsonOrError(res)) as { updated: number };
      await refreshTranslations();
      setImportMessage(`Imported ${data.updated} cell${data.updated === 1 ? '' : 's'}.`);
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  return (
    <section
      className="p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('settings.translations')}</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('settings.translationsBlurb')}</p>
      </div>

      <div>
        <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('settings.translations.languages')}</span>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {languages.map(l => (
            <span
              key={l.code}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full"
              style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)' }}
            >
              {l.label} <span style={{ color: 'var(--text-muted)' }}>({l.code})</span>
              {l.code !== 'en' && (
                <button
                  className="rounded-full transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  disabled={busyCode === l.code}
                  onClick={() => doRemoveLanguage(l.code)}
                  aria-label={`Remove ${l.label}`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className={labelClass}>{t('settings.translations.code')}</label>
            <input type="text" className={`${inputClass} w-24`} placeholder="e.g. fr" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t('settings.translations.label')}</label>
            <input type="text" className={`${inputClass} w-40`} placeholder="e.g. Français" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          </div>
          <button className={buttonSecondaryClass} disabled={!newCode.trim() || !newLabel.trim()} onClick={submitAddLanguage}>
            <Plus size={14} />{t('settings.translations.addLanguage')}
          </button>
        </div>
        {languageError && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{languageError}</p>}
      </div>

      <div className="flex items-center gap-2 flex-wrap border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <button className={buttonSecondaryClass} onClick={() => downloadFile('/translations/export', 'translations.csv').catch(err => setImportMessage(err.message))}>
          <Download size={14} />{t('settings.translations.exportCsv')}
        </button>
        <button className={buttonSecondaryClass} onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} />{t('settings.translations.importCsv')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
        />
        {importMessage && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{importMessage}</span>}
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          className={`${inputClass} pl-8`}
          placeholder={t('settings.translations.searchKeys')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      ) : (
        <div className="overflow-auto max-h-[60vh] border rounded-[var(--radius-card)]" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase sticky top-0" style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-muted)' }}>
              <tr>
                <th className="px-3 py-2 min-w-[220px]">{t('settings.translations.key')}</th>
                {languages.map(l => <th key={l.code} className="px-3 py-2 min-w-[200px]">{l.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-1.5 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{k}</td>
                  {languages.map(l => (
                    <td key={l.code} className="px-3 py-1.5">
                      <TranslationCell keyName={k} locale={l.code} />
                    </td>
                  ))}
                </tr>
              ))}
              {keys.length === 0 && (
                <tr><td colSpan={languages.length + 1} className="px-3 py-6 text-center" style={{ color: 'var(--text-muted)' }}>{t('settings.translations.noKeysMatch')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
