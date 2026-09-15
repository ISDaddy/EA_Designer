import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, parseJsonOrError } from '../api';
import type { ApiUser } from '../api';
import { useAuth } from '../auth/useAuth';
import { I18nContext } from './context';
import { detectBrowserLocale, type LocaleCode, type Language } from './locales';

const LOCALE_STORAGE_KEY = 'ea-designer.locale';

function readStoredLocale(): LocaleCode | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user, setUser } = useAuth();
  const [locale, setLocaleState] = useState<LocaleCode>(() => readStoredLocale() || detectBrowserLocale());
  const [translationsByLocale, setTranslationsByLocale] = useState<Record<string, Record<string, string>>>({});
  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTranslations = useCallback(async () => {
    const res = await apiFetch('/translations');
    const data = (await parseJsonOrError(res)) as { translations: Record<string, Record<string, string>> };
    setTranslationsByLocale(data.translations || {});
  }, []);

  const fetchLanguages = useCallback(async () => {
    const res = await apiFetch('/languages');
    const data = (await parseJsonOrError(res)) as { languages: Language[] };
    setLanguages(data.languages || []);
  }, []);

  // Load both once (they're small, and having every locale in memory lets switching languages be
  // instant and lets `t()` fall back to English without a refetch). Not routed through
  // fetchTranslations/fetchLanguages (used by addLanguage/removeLanguage/refreshTranslations to
  // reload afterwards) - calling a function known to set state directly from inside an effect body
  // trips the "set-state-in-effect" lint rule, even for a plain fetch-on-mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [translationsRes, languagesRes] = await Promise.all([apiFetch('/translations'), apiFetch('/languages')]);
        const translationsData = (await parseJsonOrError(translationsRes)) as { translations: Record<string, Record<string, string>> };
        const languagesData = (await parseJsonOrError(languagesRes)) as { languages: Language[] };
        if (cancelled) return;
        setTranslationsByLocale(translationsData.translations || {});
        setLanguages(languagesData.languages || []);
      } catch {
        // best-effort - t() still works via the key-as-fallback path, just untranslated
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Once we know who's logged in, their saved language preference wins over whatever the browser
  // guessed or a previous session left in localStorage. Applied during render (React's recommended
  // pattern for resetting derived state when a prop changes) rather than in an effect, so it takes
  // effect in the same pass instead of causing an extra render.
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  if (user && user.id !== syncedUserId && user.language) {
    setSyncedUserId(user.id);
    setLocaleState(user.language);
  }

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* ignore */ }
    if (user) {
      apiFetch('/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      })
        .then(res => parseJsonOrError(res))
        .then(updated => setUser(updated as ApiUser))
        .catch(() => { /* the local switch already applied; a failed save just won't persist */ });
    }
  }, [user, setUser]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const raw = translationsByLocale[locale]?.[key] ?? translationsByLocale.en?.[key] ?? key;
    if (!vars) return raw;
    return Object.entries(vars).reduce((acc, [name, value]) => acc.split(`{${name}}`).join(String(value)), raw);
  }, [translationsByLocale, locale]);

  const updateTranslation = useCallback(async (key: string, targetLocale: LocaleCode, value: string) => {
    setTranslationsByLocale(prev => ({ ...prev, [targetLocale]: { ...prev[targetLocale], [key]: value } }));
    await apiFetch(`/translations/${encodeURIComponent(key)}/${targetLocale}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  }, []);

  // Both throw (via parseJsonOrError) on failure, e.g. a duplicate code or trying to remove the
  // last language / English - left for the caller to catch and show, rather than swallowed here.
  const addLanguage = useCallback(async (code: string, label: string) => {
    await apiFetch('/languages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label }),
    }).then(res => parseJsonOrError(res));
    await Promise.all([fetchLanguages(), fetchTranslations()]);
  }, [fetchLanguages, fetchTranslations]);

  const removeLanguage = useCallback(async (code: string) => {
    await apiFetch(`/languages/${encodeURIComponent(code)}`, { method: 'DELETE' }).then(res => parseJsonOrError(res));
    await Promise.all([fetchLanguages(), fetchTranslations()]);
  }, [fetchLanguages, fetchTranslations]);

  const value = useMemo(() => ({
    locale, setLocale, t, loading, languages, addLanguage, removeLanguage,
    translationsByLocale, updateTranslation, refreshTranslations: fetchTranslations,
  }), [locale, setLocale, t, loading, languages, addLanguage, removeLanguage, translationsByLocale, updateTranslation, fetchTranslations]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
