// Which languages the app offers is admin-managed data now (Settings > Translations can add or
// remove one), not a fixed set baked into the code - so a locale is just whatever code string the
// `languages` table currently has a row for. `LocaleCode` stays a named alias (rather than every
// call site writing `string`) so it's easy to tell "this is meant to be a locale" at a glance.
export type LocaleCode = string;

export type Language = { code: LocaleCode; label: string };

// Maps a browser's `navigator.language` (e.g. "cs-CZ", "de-DE", "en-US") to a best-guess locale
// code - used to preselect a language before a user is logged in / has a saved preference. If the
// app doesn't actually offer this locale, `t()` just falls back to English until they pick one
// that exists from Settings > Language & Region.
export const detectBrowserLocale = (): LocaleCode => {
  if (typeof navigator === 'undefined') return 'en';
  const raw = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return raw.slice(0, 2).toLowerCase();
};
