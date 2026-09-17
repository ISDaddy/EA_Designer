// Bump this, and add an entry to RELEASE_NOTES, with every change that ships to users - see
// CLAUDE.md. Starting deliberately low since this app is a very early alpha.
export const APP_VERSION = '0.7.0';

export type ReleaseNote = {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
};

// Newest first. Entries up through 0.6.4 are backfilled from git history (see `git log`) rather
// than written at release time, so their wording is reconstructed from commit messages.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.7.0',
    date: '2026-09-17',
    title: 'Version number and release notes',
    notes: [
      'Added a version number in the corner of the app.',
      'Added this Release Notes page under Settings.',
    ],
  },
  {
    version: '0.6.4',
    date: '2026-09-17',
    title: 'Create Object wizard for flows',
    notes: [
      'Adding a data object to a new flow between two systems is now a guided 2-step wizard (name & classification, then description) instead of a free-text field that could silently create incomplete objects.',
      "The list of existing objects to choose from is now scoped to the flow's source system and filterable by name.",
    ],
  },
  {
    version: '0.6.3',
    date: '2026-09-17',
    title: 'Fixed a missing translation',
    notes: [
      'The Data Object panel\'s "Description" label was showing the raw translation key instead of translated text; fixed for all four supported languages.',
    ],
  },
  {
    version: '0.6.2',
    date: '2026-09-16',
    title: 'Single-origin deploys and NAS hosting',
    notes: [
      'The app now works correctly behind a reverse proxy or tunnel (e.g. Cloudflare) by routing API calls through the same origin as the page, instead of needing a second port reachable from the browser.',
      'Added the tooling to run this app both locally in Docker and as a Portainer stack on a NAS, kept in sync.',
    ],
  },
  {
    version: '0.6.1',
    date: '2026-09-16',
    title: 'Self-service password reset',
    notes: [
      'Added "forgot password" - a locked-out user can reset their own password via a one-time emailed link instead of needing a manual fix, and it signs out that account\'s other sessions.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-09-15',
    title: 'System object names, translations, ownership, and audit log',
    notes: [
      'Objects can now have a different name/ID in each system they live in, with search across all of them from Inventory.',
      "The app remembers which page and selection you had open across a refresh, and it's shareable via URL.",
      'Reference lists can no longer be deleted out from under something still using them without a resolution step.',
      'Every flow now requires its own schedule, and each integration is limited to one type/software.',
      'Added user language and time zone settings, and a full translation system (Settings > Translations) covering English, Czech, German, and Finnish, with CSV import/export and add/remove-language support.',
      'Settings is now split into Appearance, Language & Region, Team, Email, Translations, and Audit Log tabs.',
      'System and integration owners are now real user accounts (self-managed by the current owners) instead of free text, with change notifications and a warning when something has only one owner.',
      'Added a POC-phase NDA acceptance gate with a per-user audit trail.',
      'Added a full audit log of every view/create/update/delete and login event, with an admin-facing filterable report and CSV export.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-09-13',
    title: 'Per-object integration mechanics and the Schedule page',
    notes: [
      "Integration pattern, frequency, type, and software are now set per object flowing through a connection, not just once for the whole connection - since one connection can carry several objects integrated differently.",
      'Added Integration Types, Software, and Frequencies as admin-maintainable reference lists.',
      'Frequencies now use a real schedule (cron, interval, or daily/weekly at a time) instead of a free-text label.',
      'Added an "at risk" flag per object flow, planned system downtime windows, and a new Schedule page showing upcoming runs and a calendar, flagging any run affected by a downtime.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-09-12',
    title: 'User accounts, roles, and invites',
    notes: [
      'Added real login with admin/editor/viewer roles enforced on every action, not just hidden in the UI.',
      'Settings > Team lets admins invite teammates by email or link, manage roles, and remove members.',
      'Settings > Email lets admins configure the mail sender used for invites, verified against Gmail before saving.',
      'Added an app logo and favicon.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-09-12',
    title: 'Theming system and Settings page',
    notes: [
      'Added a Settings page with two visual styles (Enterprise Architecture, Material 3 Expressive), several color palettes, and light/dark mode.',
      'The Inventory page now has separate Systems and Data Objects tabs.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-09-11',
    title: 'Enterprise metadata, a real API, and the Inventory view',
    notes: [
      'Systems now track an owner, status, criticality, business capability, tech stack, and description; data objects track classification; connections track a description, pattern, and frequency.',
      'Every edit now saves itself individually instead of resyncing the whole diagram, so the app stays responsive as the landscape grows.',
      'Added an Inventory page: a searchable, filterable, paginated table of every system, as an alternative to the canvas for larger landscapes.',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-09-11',
    title: 'Stability fixes',
    notes: [
      'Fixed overlapping arrows where two systems were directly connected through a shared junction.',
      "Auto-save no longer risks wiping the database if the backend isn't ready yet when the app loads.",
      'The app now works correctly when opened from a hostname other than "localhost".',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-05-06',
    title: 'Initial prototype',
    notes: [
      'First version of the canvas: draw systems and the data flows between them.',
    ],
  },
];
