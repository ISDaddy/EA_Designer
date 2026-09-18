export type SettingsTab = 'releaseNotes' | 'team' | 'serverSettings' | 'translations' | 'audit' | 'importExport';
// Used to validate the `tab` query param when parsing the URL on load - see parseRouteFromLocation
// in App.tsx, which keeps the address bar in sync with whichever settings tab is open so a refresh
// or a shared link lands back on the same one.
export const SETTINGS_TABS: SettingsTab[] = ['releaseNotes', 'team', 'serverSettings', 'translations', 'audit', 'importExport'];
