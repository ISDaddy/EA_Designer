import { createContext } from 'react';
import type { LocaleCode, Language } from './locales';

export type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  // Looks up `key` in the active locale, falling back to English and then the key itself, so a
  // missing translation never renders as a blank string. `vars` fills in `{placeholders}`.
  t: (key: string, vars?: Record<string, string | number>) => string;
  loading: boolean;
  // The languages currently offered (Settings > Translations can add/remove one), for the
  // language picker and the Translations admin table's columns.
  languages: Language[];
  addLanguage: (code: string, label: string) => Promise<void>;
  removeLanguage: (code: string) => Promise<void>;
  // Full table for the Settings > Translations admin editor: { [locale]: { [key]: value } }.
  translationsByLocale: Record<string, Record<string, string>>;
  updateTranslation: (key: string, locale: LocaleCode, value: string) => Promise<void>;
  refreshTranslations: () => Promise<void>;
};

export const I18nContext = createContext<I18nContextValue | null>(null);
